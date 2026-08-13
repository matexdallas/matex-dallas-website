-- MATEX Dallas — Admin Portal foundation
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 001 and 002.
--
-- WHAT THIS ADDS
--   1. admins — an explicit allow-list of auth.users who are admins.
--      Nobody is in this table until you put them there by hand (see
--      the runbook at the bottom). No self-service, no public policy.
--   2. Admin-scoped RLS policies on members and portal_access_requests
--      that let an admin see everything and approve/deny requests
--      from the UI, instead of the manual SQL runbook in 002. These
--      policies are gated on `exists (select 1 from admins where id =
--      auth.uid())` — still not public, still not anon.
--   3. requester_email on portal_access_requests, captured from the
--      member's session at submission time, so an admin can see who
--      asked without needing access to auth.users.
--
-- Being an admin already implies full trust (you already had direct
-- SQL access to grant it), so admin UPDATE access to `members` is not
-- column-restricted at the RLS layer. The admin portal UI itself only
-- performs auth_user_id linking for now — editing member details
-- (status, contact info, dues) is deliberately a separate future
-- build, not exposed in this first version.

-- ---------------------------------------------------------------------
-- 1. Admin allow-list
-- ---------------------------------------------------------------------
create table if not exists admins (
  id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

-- An admin can check their own admin status (used by the frontend to
-- decide whether to show the admin UI or "access denied"). This does
-- NOT let a member see who else is an admin — only their own row.
drop policy if exists admins_select_own on admins;
create policy admins_select_own
  on admins
  for select
  to authenticated
  using (id = auth.uid());

grant select on admins to authenticated;

-- ---------------------------------------------------------------------
-- 2. Let admins see/link all members
-- ---------------------------------------------------------------------
drop policy if exists members_select_admin on members;
create policy members_select_admin
  on members
  for select
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists members_update_admin on members;
create policy members_update_admin
  on members
  for update
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

grant select, update on members to authenticated;

-- ---------------------------------------------------------------------
-- 3. Let admins see/review all portal access requests
-- ---------------------------------------------------------------------
alter table portal_access_requests
  add column if not exists requester_email text;

drop policy if exists portal_requests_select_admin on portal_access_requests;
create policy portal_requests_select_admin
  on portal_access_requests
  for select
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists portal_requests_update_admin on portal_access_requests;
create policy portal_requests_update_admin
  on portal_access_requests
  for update
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

grant update on portal_access_requests to authenticated;

-- ---------------------------------------------------------------------
-- RUNBOOK — making yourself (or anyone) an admin (manual, for now)
-- ---------------------------------------------------------------------
-- 1. Sign up / log in normally at portal-login.html with the account
--    that should have admin access.
--
-- 2. Find that account's auth user id:
--      select id, email from auth.users where email = 'you@example.com';
--
-- 3. Add them as an admin:
--      insert into admins (id, note) values ('<user id from step 2>', 'why they are an admin');
--
-- To remove admin access:
--      delete from admins where id = '<user id>';
