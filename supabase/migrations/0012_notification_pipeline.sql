-- ---------------------------------------------------------------------------
-- 0012 · Notification pipeline (outbox, deliveries, rules)
--
-- Replaces "the approveDeal action decides and sends" with data-driven
-- notifications that ingestion and moderation both feed:
--
--   price_observations INSERT (promotion, live)   ┐
--   deals UPDATE → approved (legacy submissions)  ┴→ notification_events  (outbox)
--        │  a worker (src/lib/push/worker.ts) reads pending events
--        ▼
--   rules (src/lib/push/rules.ts)  →  web-push  →  notification_deliveries (every attempt)
--
-- What this fixes (audit §13): a notification could only ever be triggered by the
-- approve button; a deal seen while nobody was subscribed never notified anyone
-- later; nothing recorded the outcome per person; thresholds looked at a "was"
-- price nobody had verified.
--
-- Additive. Rollback: drop the two triggers and their functions, the three
-- tables/functions below, and the three app_settings columns. push_log and the
-- deals.notified_at column are left in place (history).
-- ---------------------------------------------------------------------------

-- 1. Rules the admin can tune (in addition to the existing thresholds).
alter table public.app_settings
  add column notify_daily_cap   smallint not null default 2  check (notify_daily_cap between 1 and 10),
  -- Israel local hours. Equal start and end means "no quiet hours".
  add column notify_quiet_start smallint not null default 22 check (notify_quiet_start between 0 and 23),
  add column notify_quiet_end   smallint not null default 8  check (notify_quiet_end between 0 and 23);

-- 2. The outbox: one row per newly live promotion (or newly approved legacy deal).
create table public.notification_events (
  id          bigint generated always as identity primary key,
  -- Idempotency. A promotion re-observed tomorrow at the same price is the same news.
  dedupe_key  text not null unique,
  -- The key offers_feed exposes ('obs:<id>' or 'deal:<uuid>'): the worker renders from it.
  offer_key   text not null,
  beer_id     uuid not null references public.beers (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- After this, nobody is told: a deal that ended is not news.
  expires_at  timestamptz not null,
  status      text not null default 'pending' check (status in ('pending', 'done')),
  -- Why nobody was notified, or 'sent'. Machine-readable; see src/lib/push/rules.ts.
  outcome     text,
  processed_at timestamptz
);

create index notification_events_pending_idx on public.notification_events (created_at) where status = 'pending';

-- 3. One row per (event, person), plus one per test push. Written for EVERY attempt.
create table public.notification_deliveries (
  id           bigint generated always as identity primary key,
  event_id     bigint references public.notification_events (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  beer_id      uuid references public.beers (id) on delete set null,
  kind         text not null default 'offer' check (kind in ('offer', 'test')),
  -- retry = a transient failure (5xx, network); the worker tries again, up to 3 attempts.
  status       text not null check (status in ('sent', 'skipped', 'retry', 'failed')),
  reason       text,
  attempts     smallint not null default 0,
  subscriptions_total smallint not null default 0,
  subscriptions_ok    smallint not null default 0,
  http_status  integer,
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  -- Never send the same news to the same person twice. (Test pushes have no event.)
  unique (event_id, user_id)
);

create index notification_deliveries_sent_idx on public.notification_deliveries (user_id, sent_at desc) where status = 'sent';
create index notification_deliveries_recent_idx on public.notification_deliveries (created_at desc);

-- Nobody reads or writes these through the API. The worker uses the service role;
-- admins read through the definer function below.
alter table public.notification_events     enable row level security;
alter table public.notification_deliveries enable row level security;

grant select, update on public.notification_events to service_role;
grant select, insert, update on public.notification_deliveries to service_role;
-- The trigger functions below are SECURITY DEFINER; the worker also reads the feed.
grant select on public.offers_feed, public.offers_ranked, public.promotions_current, public.regular_prices_current to service_role;

-- 4. Enqueue: a promotion becoming live.
create or replace function public.enqueue_promotion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'promotion' or new.status <> 'live' then
    return new;
  end if;

  -- Invented prices never wake anyone up.
  if exists (select 1 from public.sources s where s.id = new.source_id and s.slug = 'sample-data') then
    return new;
  end if;

  insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
  select 'promo:' || new.sku_id || ':' || new.store_id || ':' || new.identity_key || ':' || new.price_agorot
                   || ':' || coalesce(new.valid_from::date::text, ''),
         'obs:' || new.id,
         k.beer_id,
         coalesce(new.valid_to, now() + interval '24 hours')
    from public.skus k
   where k.id = new.sku_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create trigger price_observations_enqueue_notification
  after insert on public.price_observations
  for each row execute function public.enqueue_promotion_notification();

-- 5. Enqueue: a legacy user-submitted deal being approved (until that flow is retired).
create or replace function public.enqueue_deal_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.notes is distinct from 'מבצע לדוגמה' then
    insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
    values ('deal:' || new.id, 'deal:' || new.id, new.beer_id, now() + interval '24 hours')
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger deals_enqueue_notification
  after update of status on public.deals
  for each row execute function public.enqueue_deal_notification();

-- 6. Admins can see what was sent, to whom (shortened id), and why not.
create or replace function public.admin_recent_deliveries(p_limit integer default 50)
returns table (
  id bigint,
  created_at timestamptz,
  kind text,
  status text,
  reason text,
  attempts smallint,
  subscriptions_ok smallint,
  subscriptions_total smallint,
  http_status integer,
  beer_name text,
  recipient text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select d.id, d.created_at, d.kind, d.status, d.reason, d.attempts,
         d.subscriptions_ok, d.subscriptions_total, d.http_status,
         b.name_he,
         left(d.user_id::text, 8)
    from public.notification_deliveries d
    left join public.beers b on b.id = d.beer_id
   order by d.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_recent_deliveries(integer) from public;
grant execute on function public.admin_recent_deliveries(integer) to authenticated;

-- 7. The rules, in one call (the old three-argument function stays for older callers).
create or replace function public.update_notification_rules(
  p_min_discount_percent integer,
  p_max_price_agorot     integer,
  p_cooldown_hours       integer,
  p_daily_cap            integer,
  p_quiet_start          integer,
  p_quiet_end            integer
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.app_settings;
begin
  perform public.require_super_admin();

  update public.app_settings
     set notify_min_discount_percent = p_min_discount_percent,
         notify_max_price_agorot     = p_max_price_agorot,
         notify_cooldown_hours       = p_cooldown_hours,
         notify_daily_cap            = p_daily_cap,
         notify_quiet_start          = p_quiet_start,
         notify_quiet_end            = p_quiet_end,
         updated_by                  = auth.uid()
   where id
  returning * into row;

  return row;
end;
$$;

revoke all on function public.update_notification_rules(integer, integer, integer, integer, integer, integer) from public;
grant execute on function public.update_notification_rules(integer, integer, integer, integer, integer, integer) to authenticated;

-- 8. The settings row is readable by the worker.
grant select on public.app_settings to service_role;
