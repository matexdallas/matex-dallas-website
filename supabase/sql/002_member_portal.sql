-- MATEX Dallas — Member Portal foundation
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 001_member_lookup_function.sql.
--
-- WHAT THIS ADDS
--   1. members.auth_user_id — links a Supabase Auth login to an existing
--      member row. Stays NULL until an admin approves a request (see the
--      runbook at the bottom of this file). No self-service auto-link.
--   2. portal_access_requests — a member submits one of these after
--      logging in, so an admin can manually match them to their member
--      row and approve. No admin UI yet (that's the future admin
--      portal) — approval is a manual SQL step for now.
--   3. RLS policies scoped to the requesting user's own auth.uid() —
--      NOT public/anon policies. A member only ever sees their own row,
--      and only after being linked.
--
-- Still fully compliant with "no public SELECT policy on members":
-- these policies require `auth.uid() = members.auth_user_id`, i.e. the
-- caller must be logged in AND already approved-and-linked. An
-- anonymous visitor (no session) can select nothing.

-- ---------------------------------------------------------------------
-- 1. Link column on members
-- ---------------------------------------------------------------------
alter table members
  add column if not exists auth_user_id uuid unique references auth.users(id);

comment on column members.auth_user_id is
  'Set only by an admin after manually approving a portal_access_requests row. NULL = no portal access yet.';

-- Defensive — should already be enabled per MATEX's existing setup.
alter table members enable row level security;

drop policy if exists members_select_own on members;
create policy members_select_own
  on members
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- No insert/update/delete policies for authenticated/anon here — members
-- can only read their own row, never write it, from the frontend.

-- ---------------------------------------------------------------------
-- 2. Portal access requests
-- ---------------------------------------------------------------------
create table if not exists portal_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_full_name text not null,
  claimed_member_number text not null,
  claimed_phone_last4 text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

alter table portal_access_requests enable row level security;

-- A logged-in user can file their own request...
drop policy if exists portal_requests_insert_own on portal_access_requests;
create policy portal_requests_insert_own
  on portal_access_requests
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- ...and check the status of their own request(s). No update/delete —
-- only an admin (via the SQL editor, which runs as postgres and bypasses
-- RLS) can review and change status.
drop policy if exists portal_requests_select_own on portal_access_requests;
create policy portal_requests_select_own
  on portal_access_requests
  for select
  to authenticated
  using (user_id = auth.uid());

grant select, insert on portal_access_requests to authenticated;

-- ---------------------------------------------------------------------
-- ADMIN RUNBOOK — approving a portal access request (manual, for now)
-- ---------------------------------------------------------------------
-- 1. See what's pending:
--      select * from portal_access_requests where status = 'pending' order by created_at;
--
-- 2. Find the matching member using what they claimed:
--      select id, first_name, last_name, member_number, phone
--      from members
--      where member_number = '<claimed_member_number>';
--
-- 3. If it's a real match, link it and mark the request approved:
--      update members
--        set auth_user_id = '<user_id from the request>'
--        where id = '<matching member id>';
--
--      update portal_access_requests
--        set status = 'approved', reviewed_at = now(), reviewed_by = 'your name'
--        where id = '<request id>';
--
--    If it's not a match, instead:
--      update portal_access_requests
--        set status = 'denied', reviewed_at = now(), reviewed_by = 'your name',
--            admin_note = 'why it was denied'
--        where id = '<request id>';
