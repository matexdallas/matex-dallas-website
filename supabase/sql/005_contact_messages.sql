-- MATEX Dallas — Contact form messages
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 001-004.
--
-- WHAT THIS ADDS
--   contact_messages — the Contact page form (contact.html) writes
--   here. Same pattern as membership_applications: anyone can submit
--   (no login required), but nobody except an admin can read
--   messages back. This does NOT send email — there's no email
--   service wired up. Admins review submissions in admin.html.

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  reason text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now()
);

alter table contact_messages enable row level security;

drop policy if exists contact_messages_insert_public on contact_messages;
create policy contact_messages_insert_public
  on contact_messages
  for insert
  to anon, authenticated
  with check (true);

grant insert on contact_messages to anon, authenticated;

drop policy if exists contact_messages_select_admin on contact_messages;
create policy contact_messages_select_admin
  on contact_messages
  for select
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists contact_messages_update_admin on contact_messages;
create policy contact_messages_update_admin
  on contact_messages
  for update
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

grant select, update on contact_messages to authenticated;
