-- MATEX Dallas — Let a member be deleted even if an approved
-- application still points at them
-- =========================================================
-- Run this once in the Supabase SQL editor, AFTER 004_membership_applications.sql.
--
-- THE BUG THIS FIXES
--   membership_applications.created_member_id (004) was defined as a
--   plain `references members(id)` with no ON DELETE clause, which
--   defaults to Postgres's NO ACTION — it BLOCKS deleting a member if
--   any approved application's created_member_id still points at
--   them. A member added directly via "Add Member" has nothing
--   pointing at it this way and deletes fine; a member created by
--   approving an application does not, and the delete silently fails
--   at the database level (010_members_delete_admin.sql's RLS policy
--   is not the issue — this FK constraint is).
--
-- THE FIX
--   Change created_member_id to ON DELETE SET NULL: deleting a member
--   un-links the (already-approved, historical) application record
--   instead of blocking the delete or cascading into deleting the
--   application itself. The application row and its "approved" status
--   stay as a record of what happened; it just stops pointing at a
--   member that no longer exists.
--
-- Safe to re-run: drops the constraint first, so re-adding it is a no-op change.

alter table membership_applications
  drop constraint if exists membership_applications_created_member_id_fkey;

alter table membership_applications
  add constraint membership_applications_created_member_id_fkey
  foreign key (created_member_id) references members(id) on delete set null;
