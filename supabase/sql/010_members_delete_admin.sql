-- MATEX Dallas — Let admins delete a member
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 003_admin_portal.sql.
--
-- WHAT THIS ADDS
--   A DELETE policy + grant on `members` for admins, same
--   admins-only gate as every other admin policy in this project
--   (`exists (select 1 from admins a where a.id = auth.uid())`).
--   Nothing previously allowed deleting a member row at all — not
--   even an admin could, at the database level, regardless of what
--   the UI showed.
--
-- CASCADE NOTE
--   dues_payments.member_id has `on delete cascade` (see
--   006_dues_payments.sql), so deleting a member also deletes their
--   logged dues payment history. portal_access_requests is not
--   foreign-keyed to members (it matches by member_number, a plain
--   text column), so deleting a member does not touch any pending or
--   past access request rows.
--
-- Safe to re-run: DROP POLICY IF EXISTS makes this idempotent.

drop policy if exists members_delete_admin on members;
create policy members_delete_admin
  on members
  for delete
  to authenticated
  using (exists (select 1 from admins a where a.id = auth.uid()));

grant delete on members to authenticated;
