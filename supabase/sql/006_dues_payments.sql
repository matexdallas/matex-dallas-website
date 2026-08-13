-- MATEX Dallas — Dues / payment tracking
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 001-005.
--
-- WHAT THIS ADDS
--   1. members.membership_type — 'single' or 'couple', used to figure
--      out what a member owes each year (matches the pricing on
--      membership.html: Single $85/yr, Couple $170/yr). Nullable —
--      existing members don't have this set yet; an admin sets it via
--      the roster or the Add Member form.
--   2. dues_payments — one row per payment an admin manually logs
--      (this does NOT process payments — donate.html's PayPal/Zelle
--      already collect the money; this just records "member X paid
--      $Y on date Z toward year N's dues" so admins can see who's
--      paid, who's partial, who hasn't).
--
-- Tracking is per calendar year (dues_year on each payment), so "paid
-- last year" doesn't count toward this year's balance.
--
-- ACCESS: entirely admin-only. Unlike membership_applications or
-- contact_messages, there is no public insert policy here at all —
-- nobody outside `admins` can read or write this table, since it's
-- financial data about specific members.

alter table members
  add column if not exists membership_type text check (membership_type in ('single', 'couple'));

create table if not exists dues_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  dues_year integer not null,
  amount numeric(10, 2) not null check (amount > 0),
  payment_method text,
  payment_date date not null default current_date,
  note text,
  recorded_by text,
  created_at timestamptz not null default now()
);

alter table dues_payments enable row level security;

drop policy if exists dues_payments_admin_all on dues_payments;
create policy dues_payments_admin_all
  on dues_payments
  for all
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

grant select, insert, update, delete on dues_payments to authenticated;
