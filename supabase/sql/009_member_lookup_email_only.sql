-- MATEX Dallas — Member status lookup, email-only (public-safe RPC)
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 001.
--
-- WHAT THIS CHANGES
--   Adds a single-argument overload of lookup_member_status(p_email) so
--   member-lookup.html can look someone up by email alone, no member
--   number required.
--
-- KNOWN TRADE-OFF — READ BEFORE RELYING ON THIS
--   The original two-factor function (001_member_lookup_function.sql)
--   required email AND member number specifically to prevent
--   enumeration: knowing only one fact about a member (their email)
--   was not enough to learn anything else about them. This overload
--   removes that protection for the email-only path — anyone who
--   knows or guesses a member's email can now retrieve that member's
--   full name and status through this function. There is no proof of
--   inbox ownership; nothing is emailed to verify the requester is
--   actually that person. Client-side rate limiting exists in
--   member-lookup.js (5 attempts) but that's trivially bypassed by
--   anyone calling the RPC directly — it does not stop scripted
--   enumeration.
--   If that trade-off stops being acceptable, drop this overload and
--   go back to requiring member_number, or move to an email-verified
--   flow (send the result to the inbox, or reuse the existing
--   magic-link sign-in in portal-login.html) instead.
--
-- WHAT IT RETURNS ON A MATCH
--   full_name, status — nothing else. No phone, address, DOB, notes,
--   email, or member_number are ever returned. Same as the two-factor
--   version.
--
-- The original two-argument lookup_member_status(email, member_number)
-- is left in place (it's a distinct overload, not replaced) in case
-- you want to reintroduce the two-factor form later.
--
-- Safe to re-run: uses CREATE OR REPLACE.

create or replace function public.lookup_member_status(
  p_email text
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
  limit 1;
$$;

revoke all on function public.lookup_member_status(text) from public;
grant execute on function public.lookup_member_status(text) to anon, authenticated;
