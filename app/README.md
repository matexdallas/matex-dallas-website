# MATEX member app — development version

Open `/app/` over HTTPS. Existing public website pages remain unchanged.

## Before launch

1. Review and apply `supabase/sql/013_mobile_app.sql` separately. This migration has NOT been applied by this branch.
2. Configure Supabase email OTP delivery: the verification email template must include `{{ .Token }}`. Configure production SMTP and test delivery. Existing website magic links still need their existing link template/redirect behavior preserved; include both the code and confirmation URL where appropriate.
3. Enable phone authentication and configure an SMS provider. Test phone OTP delivery and costs before launch. The project configuration is not readable through GitHub.
4. Reconcile `dues_payments` against household `payments`. Do not copy automatically or count both tables: couple records and previously entered payments require review. App balance RPC reads only memberships/payments; no legacy data has been moved.
5. Provide a membership-specific PayPal checkout link. Existing community center PayPal button is reused only via donation page; no automated payment confirmation is implemented.
6. Provide the private WhatsApp invitation. Until then, app offers an invitation request by email.
7. Post announcements in `app_announcements` via authorized admin access. Administrators can publish through `/app/?admin=1`. Push notifications are not yet implemented.
8. Test new/pending/denied/approved users, existing-member matching, couple linking, nonmember donations, admin authorization, logout, and iPhone/Android installation against staging before production.

## Implemented

Welcome/signup/sign-in; first and last name plus email OR phone; OTP forms; admin approval RPC and member matching; bottom-left admin sign-in link to existing portal; approved member navigation; household balance RPC; Zelle recipient copy; public community center donations; website-sourced leadership; event link; basic PWA shell/icons/installation. A dedicated `/app/?admin=1` entry supports administrators without member profiles, using the same OTP sign-in. The lower-left Admin Sign In link opens this entry. Authorized administrators can review accounts, publish announcements, and verify reported payments.

## Limits

No App Store binaries; no background notification service; no WhatsApp chat synchronization; member-submitted donation reports are recorded separately after verification; guest donations still use the public payment page and are not tracked in-app. Payment reporting and manual verification are implemented; automatic PayPal confirmation is not. Announcements require database setup. Existing broad legacy admin policies are retained and must be reviewed before role consolidation. Supabase keys used are the existing public publishable key only.

Service worker caches only public shell files, never API responses or member data. Member features require network access. Leadership is read from the existing website page to keep names/photos/order consistent.

Payment report verification uses a locked transaction so retrying the same report cannot record payment twice. Dues verification writes household `payments`; the legacy dashboard still reads `dues_payments`, so reconciliation and dashboard consolidation remain launch prerequisites. App admins need verified email/phone OTP; legacy password sign-in remains on the old portal.
