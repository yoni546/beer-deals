-- ---------------------------------------------------------------------------
-- One approved deal per beer, per shop, per pack size.
--
-- Two approved rows for "Goldstar six-pack at Rami Levy" are not two deals —
-- they are one deal and a mistake. Whichever way it happens (a script run
-- twice, two people reporting the same sticker, an admin approving a
-- resubmission), the result is the same: the user sees the same line twice, or
-- worse, twice at different prices with no way to tell which is true.
--
-- A partial unique index says it once, for every path into the table. The
-- deliberate consequence is that replacing a deal means taking the old one down
-- first — which is the correct order anyway, since the alternative is a moment
-- where both are on the shelf.
-- ---------------------------------------------------------------------------

-- Existing duplicates have to go before the index can exist. Keep the oldest of
-- each group: it is the one whose approval history is real.
with ranked as (
  select id,
         row_number() over (
           partition by beer_id, store_id, category
           order by created_at, id
         ) as n
    from public.deals
   where status = 'approved'
)
update public.deals d
   set status = 'inactive', approved_by = null, approved_at = null
  from ranked
 where d.id = ranked.id and ranked.n > 1;

create unique index if not exists deals_one_approved_per_shelf_idx
  on public.deals (beer_id, store_id, category)
  where status = 'approved';

-- --------------------------------------------------------------------------
-- Approving now explains the collision instead of surfacing "duplicate key
-- value violates unique constraint", which tells an admin nothing about what
-- to do next.
-- --------------------------------------------------------------------------

create or replace function public.approve_deal(p_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row      public.deals;
  incoming public.deals;
begin
  perform public.require_admin();

  select * into incoming from public.deals where id = p_deal_id;

  if incoming.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.deals d
     where d.status = 'approved'
       and d.id <> p_deal_id
       and d.beer_id = incoming.beer_id
       and d.store_id = incoming.store_id
       and d.category = incoming.category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  update public.deals
     set status      = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_deal_id
  returning * into row;

  return row;
end;
$$;
