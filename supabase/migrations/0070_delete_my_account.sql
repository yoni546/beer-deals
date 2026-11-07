-- ---------------------------------------------------------------------------
-- 0070 — a person can delete their account, and everything about them, from inside the app.
--
-- WHY NOW. Both app stores require it of any app that creates an account (Google Play's
-- account-deletion policy; App Store Review Guideline 5.1.1(v)), and this app creates one for every
-- visitor: an anonymous Supabase user with a profile — a first name, a town and a point, the four
-- beers, a watchlist, push subscriptions, reports. "Anonymous" is about the sign-in, not the data.
--
-- WHAT IT DELETES. The auth user, and through `on delete cascade` everything keyed to it: the profile
-- (0001) and through it the favourites, the watchlist (0037), the published credit name (0030) and its
-- change log (0033); push subscriptions and deliveries (0001, 0012); deal reports (0031); a submitter
-- block (0035). What is not theirs to take is kept and loses the link to them: a deal they submitted is a
-- claim about a shop's price, so `deals.created_by` is set null by its foreign key (0001) and the deal,
-- with any photo attached to it, stays — the price stays, who sent it does not.
--
-- WHO MAY. Only the signed-in person, and only for themselves: the function takes no argument and
-- reads auth.uid(). An administrator is refused here — removing an admin is a decision for another
-- admin (the admin screens), not a button that could lock the owner out of their own app.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from public.admins where user_id = v_me) then
    raise exception 'an administrator cannot delete their own account here' using errcode = '42501';
  end if;

  delete from auth.users where id = v_me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Deletes the caller''s auth user and, by cascade, every row about them (0070). Approved deals they sent are kept without their name.';
