-- ---------------------------------------------------------------------------
-- 0037 — the watchlist: "tell me when this one is under ₪25".
--
-- WHAT THE APP COULD DO BEFORE. Exactly one beer could reach a phone: favourite
-- #1, and only on a deal that passed the administrator's global thresholds (25 %
-- off, under ₪30). Favourites #2–#4 shape the app and never the phone, on purpose
-- (PRODUCT.md). So somebody who wanted to be told about a SIXTH beer, or about
-- their own price rather than an admin's percentage, had nowhere to say it.
--
-- WHAT THIS ADDS, AND WHAT IT DOES NOT REPLACE. The pipeline (0012) is untouched
-- in shape: the same outbox, the same worker, the same per-person protections.
-- This adds a second reason a person may be told, beside "it is your number one",
-- and lets that person name their own ceiling.
--
-- THE PROTECTIONS STAY, ALL OF THEM. Cooldown per beer, the daily cap and quiet
-- hours are not thresholds for an offer -- they are protections for a person --
-- and a watch is not permission to ignore them. Somebody who watches eight beers
-- gets the same two notifications a day as everybody else. That is the point: a
-- watchlist is a statement about what matters, not a subscription to noise.
--
-- WHAT A WATCH DOES RELAX, deliberately: the verified-SAVING requirement. "Never
-- announce an unverified saving" exists because the message claims a percentage,
-- and for a watch hit the message does not -- it states the price, which is the
-- fact the person asked to be told. A trusted saving and a trusted price are
-- different things, and conflating them would make the feature impossible for
-- every chain whose reference price we cannot vouch for.
--
-- TEN AT A TIME. A watchlist of two hundred beers is a notification firehose
-- wearing a feature's clothes, and the daily cap would then decide which of them
-- a person hears about -- arbitrarily. Ten is more than anybody's shopping list
-- and small enough that each entry is a choice.
-- ---------------------------------------------------------------------------

create table if not exists public.watchlist (
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  beer_id           uuid not null references public.beers (id) on delete cascade,
  -- Null = "treat it like my number one": the administrator's thresholds decide.
  -- A number = "tell me at this price or below", whatever the percentage says.
  max_price_agorot  integer check (max_price_agorot is null or max_price_agorot between 100 and 100000),
  created_at        timestamptz not null default now(),
  primary key (profile_id, beer_id)
);

comment on table public.watchlist is
  'Beers a person wants to hear about beyond favourite #1, each with an optional price ceiling of their own (0037).';

create index if not exists watchlist_beer_idx on public.watchlist (beer_id);

alter table public.watchlist enable row level security;

grant select, insert, update, delete on public.watchlist to authenticated;
-- The notification worker reads it (src/lib/push/worker.ts) with the service role,
-- which is the one caller that is not a person. Read only: a watch is set by the
-- person whose watch it is, never on their behalf.
grant select on public.watchlist to service_role;

-- Yours, and nobody else's -- the same shape as user_favorite_beers (0003).
create policy watchlist_read_own on public.watchlist
  for select to authenticated using (profile_id = auth.uid());

create policy watchlist_write_own on public.watchlist
  for insert to authenticated with check (profile_id = auth.uid());

create policy watchlist_update_own on public.watchlist
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy watchlist_delete_own on public.watchlist
  for delete to authenticated using (profile_id = auth.uid());

-- The cap, in the database rather than in the form: the form is a courtesy.
create or replace function public.watchlist_at_most_ten()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Counting the OTHER beers, not all of them. A BEFORE INSERT trigger fires before
  -- Postgres has detected the conflict, so `insert … on conflict do update` reaches
  -- here even when it is about to update — and somebody at the limit would not have
  -- been able to change a price they had already set. A test caught it.
  if (select count(*) from public.watchlist w
       where w.profile_id = new.profile_id and w.beer_id <> new.beer_id) >= 10 then
    raise exception 'אפשר לעקוב אחרי עשר בירות. הסירו אחת כדי להוסיף חדשה.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists watchlist_at_most_ten on public.watchlist;
create trigger watchlist_at_most_ten
  before insert on public.watchlist
  for each row execute function public.watchlist_at_most_ten();

-- --------------------------------------------------------------------------
-- Setting one, and taking it off.
--
-- A function rather than a bare insert so that "watch it" and "watch it at this
-- price" are one call that cannot half-succeed, and so the price is validated in
-- one place. The policies above still stand behind it.
-- --------------------------------------------------------------------------

create or replace function public.watch_beer(p_beer_id uuid, p_max_price_agorot integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_max_price_agorot is not null and p_max_price_agorot not between 100 and 100000 then
    raise exception 'המחיר צריך להיות בין ₪1 ל-₪1000.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.beers b where b.id = p_beer_id) then
    raise exception 'beer not found' using errcode = 'P0002';
  end if;

  -- A person whose profile row has not been created yet (they arrive before
  -- onboarding finishes) can still watch a beer. Same guard as set_display_name.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  insert into public.watchlist (profile_id, beer_id, max_price_agorot)
  values (uid, p_beer_id, p_max_price_agorot)
  on conflict (profile_id, beer_id) do update set max_price_agorot = excluded.max_price_agorot;
end;
$$;

revoke execute on function public.watch_beer(uuid, integer) from public, anon;
grant execute on function public.watch_beer(uuid, integer) to authenticated;

create or replace function public.unwatch_beer(p_beer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.watchlist where profile_id = uid and beer_id = p_beer_id;
end;
$$;

revoke execute on function public.unwatch_beer(uuid) from public, anon;
grant execute on function public.unwatch_beer(uuid) to authenticated;
