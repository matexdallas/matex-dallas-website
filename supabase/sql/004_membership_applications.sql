-- MATEX Dallas — New member applications
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 001, 002, and 003.
--
-- WHAT THIS ADDS
--   1. membership_applications — a public "apply to join" form
--      (join.html) writes here. Anyone can submit one (no login
--      required) but nobody — not even the applicant — can read them
--      back except an admin. This is an INSERT-only public policy on
--      a brand-new table, not a SELECT policy on `members`, so it
--      doesn't touch the "no public SELECT policy on members"
--      constraint at all.
--   2. An admin INSERT policy on `members`, so approving an
--      application can create the real member row directly from the
--      admin portal UI instead of a manual SQL step.
--
-- Approving an application is still a deliberate admin action (no
-- auto-approval, no auto-generated member numbers written by
-- anonymous users) — the admin portal shows a suggested next member
-- number that the admin confirms or edits before it's created.

-- ---------------------------------------------------------------------
-- 1. Applications table
-- ---------------------------------------------------------------------
create table if not exists membership_applications (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text not null,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  membership_type text check (membership_type in ('single', 'couple')),
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  created_member_id uuid references members(id)
);

alter table membership_applications enable row level security;

-- Public can submit an application — no login required. No SELECT
-- policy for anon/authenticated exists, so nobody can read these back
-- except an admin (below). This keeps applicant PII private, same
-- spirit as never exposing the members roster publicly.
drop policy if exists applications_insert_public on membership_applications;
create policy applications_insert_public
  on membership_applications
  for insert
  to anon, authenticated
  with check (true);

grant insert on membership_applications to anon, authenticated;

drop policy if exists applications_select_admin on membership_applications;
create policy applications_select_admin
  on membership_applications
  for select
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists applications_update_admin on membership_applications;
create policy applications_update_admin
  on membership_applications
  for update
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

grant select, update on membership_applications to authenticated;

-- ---------------------------------------------------------------------
-- 2. Let admins create members (needed so "Approve" can insert the
--    real row from the admin portal UI)
-- ---------------------------------------------------------------------
drop policy if exists members_insert_admin on members;
create policy members_insert_admin
  on members
  for insert
  to authenticated
  with check (exists (select 1 from admins a where a.id = auth.uid()));

grant insert on members to authenticated;
