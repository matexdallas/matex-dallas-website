-- MATEX Dallas — Admin permission tiers (superuser vs. limited admin)
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 010_members_delete_admin.sql.
--
-- WHAT THIS ADDS
--   Two capability flags on `admins`, both defaulting to false (least
--   privilege for any future admin added without explicit flags):
--     - can_edit_all_fields — can update every member field (email,
--       phone, address, status, membership_type, member_number,
--       joined_date). false = can only edit name fields (today's
--       baseline "Edit" behavior).
--     - can_delete — can delete a member row, AND can remove a logged
--       dues payment. Both are "delete something" actions; this one
--       flag gates both rather than having a separate flag per table.
--
-- ENFORCEMENT
--   This is enforced in Postgres, not just hidden in the UI:
--     1. A BEFORE UPDATE trigger on members rejects any change to a
--        non-name field unless the caller's admin row has
--        can_edit_all_fields = true.
--     2. The members DELETE policy (originally added in
--        010_members_delete_admin.sql) is replaced to also require
--        can_delete = true, not just admins-table membership.
--     3. dues_payments (006_dues_payments.sql) previously had one
--        single "for all" policy covering select/insert/update/delete
--        under the same admins-only condition. That's split into four
--        policies here so DELETE specifically can require can_delete
--        while select/insert/update stay open to any admin.
--   RLS/triggers can't be bypassed by calling the API directly instead
--   of going through admin.js's UI, unlike a check that only lived in
--   the frontend.
--
-- WHO GETS WHAT (per this project's current request)
--   - matexdallas@gmail.com (Loseini Kamara) — superuser: full field
--     edit + delete (members and dues payments).
--   - sanogo.abdoul48@yahoo.fr (Abdoulaye Sanoe) — admin: full field
--     edit + add (manual "Add Member" form AND approving pending
--     applications), but NOT delete of any kind. His account must
--     already exist in auth.users (i.e. he's signed up at least once
--     via portal-login.html) before the insert below can find him —
--     if the insert affects 0 rows, that's why; have him sign up,
--     then re-run just that insert statement.
--
-- Safe to re-run in full: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- DROP ... IF EXISTS, and ON CONFLICT make every statement idempotent.

-- ---------------------------------------------------------------------
-- 1. Capability flags
-- ---------------------------------------------------------------------
alter table admins
  add column if not exists can_edit_all_fields boolean not null default false;

alter table admins
  add column if not exists can_delete boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Enforce the edit scope at the database level (members table)
-- ---------------------------------------------------------------------
create or replace function public.enforce_members_edit_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_access boolean;
begin
  select coalesce(can_edit_all_fields, false)
    into v_full_access
    from admins
    where id = auth.uid();

  if v_full_access is true then
    return new;
  end if;

  -- Limited admin (or no admin row at all, though RLS already blocks
  -- that case from reaching here): only first/middle/last name may
  -- change. Anything else being different between OLD and NEW is
  -- rejected outright rather than silently ignored, so a limited
  -- admin gets a clear error instead of a confusing partial save.
  if new.email is distinct from old.email
     or new.phone is distinct from old.phone
     or new.status is distinct from old.status
     or new.membership_type is distinct from old.membership_type
     or new.address_line1 is distinct from old.address_line1
     or new.address_line2 is distinct from old.address_line2
     or new.city is distinct from old.city
     or new.state is distinct from old.state
     or new.postal_code is distinct from old.postal_code
     or new.joined_date is distinct from old.joined_date
     or new.member_number is distinct from old.member_number
     or new.auth_user_id is distinct from old.auth_user_id
  then
    raise exception 'not authorized to edit that field — name only for this admin account';
  end if;

  return new;
end;
$$;

drop trigger if exists members_edit_scope_guard on members;
create trigger members_edit_scope_guard
  before update on members
  for each row
  execute function public.enforce_members_edit_scope();

-- ---------------------------------------------------------------------
-- 3. Enforce the delete scope at the database level (members table)
-- ---------------------------------------------------------------------
drop policy if exists members_delete_admin on members;
create policy members_delete_admin
  on members
  for delete
  to authenticated
  using (
    exists (
      select 1 from admins a
      where a.id = auth.uid()
        and coalesce(a.can_delete, false)
    )
  );

-- ---------------------------------------------------------------------
-- 4. Enforce the delete scope at the database level (dues_payments)
-- ---------------------------------------------------------------------
-- Replaces the single "for all" policy from 006_dues_payments.sql with
-- four operation-specific ones, so DELETE alone can require can_delete
-- while select/insert/update stay available to any admin.
drop policy if exists dues_payments_admin_all on dues_payments;

drop policy if exists dues_payments_admin_select on dues_payments;
create policy dues_payments_admin_select
  on dues_payments
  for select
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists dues_payments_admin_insert on dues_payments;
create policy dues_payments_admin_insert
  on dues_payments
  for insert
  to authenticated
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists dues_payments_admin_update on dues_payments;
create policy dues_payments_admin_update
  on dues_payments
  for update
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists dues_payments_admin_delete on dues_payments;
create policy dues_payments_admin_delete
  on dues_payments
  for delete
  to authenticated
  using (
    exists (
      select 1 from admins a
      where a.id = auth.uid()
        and coalesce(a.can_delete, false)
    )
  );

-- ---------------------------------------------------------------------
-- 5. Grant the flags to the two named accounts
-- ---------------------------------------------------------------------

-- Loseini Kamara — superuser: full edit + delete.
update admins
set can_edit_all_fields = true,
    can_delete = true
where id in (select id from auth.users where lower(email) = lower('matexdallas@gmail.com'));

-- Abdoulaye Sanoe — admin: full edit + add (manual form AND approving
-- applications — both just use the existing members_insert_admin
-- policy from 004, unaffected by anything here), no delete of any
-- kind. Requires he has already signed up via portal-login.html at
-- least once (so a matching auth.users row exists) — if this affects
-- 0 rows, that's why.
insert into admins (id, note, can_edit_all_fields, can_delete)
select id, 'Abdoulaye Sanoe — admin (edit + add, no delete)', true, false
from auth.users
where lower(email) = lower('sanogo.abdoul48@yahoo.fr')
on conflict (id) do update
  set can_edit_all_fields = true,
      can_delete = false;
