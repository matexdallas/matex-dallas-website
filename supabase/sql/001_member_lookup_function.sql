-- MATEX Dallas — Member status lookup (public-safe RPC)
-- =========================================================
-- Run this once in the Supabase SQL editor (Project → SQL Editor).
--
-- PURPOSE
--   Lets a member check their own status on the public website using
--   Email + Member Number as a two-factor exact match — WITHOUT adding
--   a public SELECT policy on the members table, and without exposing
--   the roster to enumeration (guessing a single field gets you nothing).
--
-- WHAT IT RETURNS ON A MATCH
--   full_name, status — nothing else. No phone, address, DOB, notes,
--   email, or member_number are ever returned.
--
-- WHY THIS IS SAFE WITHOUT A PUBLIC SELECT POLICY
--   SECURITY DEFINER lets this one narrow, hard-coded query run with
--   elevated privileges — a single row, gated by two required exact
--   matches, returning two columns. Row Level Security on `members`
--   stays fully enabled, and anon/authenticated get NO direct table
--   access — only permission to call this specific function.
--
-- Safe to re-run: uses CREATE OR REPLACE.

create or replace function public.lookup_member_status(
  p_email text,
  p_member_number text
)
returns table (
  full_name text,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    trim(concat_ws(' ', first_name, last_name)) as full_name,
    status
  from members
  where lower(trim(email)) = lower(trim(p_email))
    and trim(member_number) = trim(p_member_number)
  limit 1;
$$;

-- Lock the function down, then open it only to the roles the frontend uses
-- (anon = publishable key visitors, authenticated = logged-in users later).
revoke all on function public.lookup_member_status(text, text) from public;
grant execute on function public.lookup_member_status(text, text) to anon, authenticated;

-- Optional, recommended once the table has real volume — speeds up the
-- lookup without changing what's exposed:
-- create index if not exists idx_members_email_lower on members (lower(email));
