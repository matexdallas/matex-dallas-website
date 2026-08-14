-- MATEX Dallas — Atomic application approval (admin-only RPC)
-- =========================================================
-- Run this in the Supabase SQL editor, any time after
-- 004_membership_applications.sql and 007_members_member_number_unique.sql.
--
-- WHY THIS EXISTS
--   admin.js used to approve an application in three separate,
--   non-atomic network calls: read the application, INSERT a members
--   row, then UPDATE the application to "approved". If the third call
--   failed after the second succeeded (a network blip, anything), the
--   application still showed as pending, and nothing stopped an admin
--   from clicking "Confirm" again — creating a second, duplicate
--   member row for the same person. 007 turned that into a loud
--   error instead of a silent duplicate; this is the actual fix.
--
--   This function does the read + insert + update as one Postgres
--   transaction: if anything fails partway through, the whole thing
--   rolls back and nothing is left half-done. It also re-checks
--   status = 'pending' under a row lock (`for update`), so two admins
--   (or one admin double-clicking) approving the same application at
--   the same moment can't both succeed — the second one gets a clean
--   "already reviewed" error instead of a duplicate member.
--
-- SECURITY
--   SECURITY DEFINER lets this run with elevated privileges, but it
--   re-checks admin membership itself on every call (`exists (select 1
--   from admins ...)`) exactly like every RLS policy elsewhere in this
--   project — a non-admin calling this gets a plain "not authorized"
--   error, nothing more.
--
-- Safe to re-run: uses CREATE OR REPLACE.

create or replace function public.approve_membership_application(
  p_application_id uuid,
  p_member_number text
)
returns uuid  -- the new member's id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app membership_applications%rowtype;
  v_member_id uuid;
begin
  if not exists (select 1 from admins a where a.id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if p_member_number is null or trim(p_member_number) = '' then
    raise exception 'member_number is required';
  end if;

  -- Lock the application row so a concurrent approval can't also pass
  -- this check before this transaction commits.
  select *
  into v_app
  from membership_applications
  where id = p_application_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'application not found, or already reviewed';
  end if;

  insert into members (
    member_number, first_name, middle_name, last_name, email, phone,
    address_line1, address_line2, city, state, postal_code,
    status, joined_date, membership_type
  ) values (
    trim(p_member_number), v_app.first_name, v_app.middle_name, v_app.last_name,
    v_app.email, v_app.phone, v_app.address_line1, v_app.address_line2,
    v_app.city, v_app.state, v_app.postal_code,
    'active', current_date, v_app.membership_type
  )
  returning id into v_member_id;

  update membership_applications
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = coalesce(auth.jwt() ->> 'email', 'admin'),
      created_member_id = v_member_id
  where id = p_application_id;

  return v_member_id;
end;
$$;

revoke all on function public.approve_membership_application(uuid, text) from public;
grant execute on function public.approve_membership_application(uuid, text) to authenticated;
