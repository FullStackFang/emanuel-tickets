-- Membership cache hardening (openspec launch-member-signin, D5).
--   retry_after  : after a provider failure, RSVP/checkout skip the provider until then
--   email_sha256 : hash of the email the row was verified for; a different sign-in
--                  email forces a re-check (no plaintext email stored here)
--   'unknown'    : a row written by a failure when nothing was cached; shown as
--                  "no note", never as "we couldn't match you"
-- Rollback: supabase/rollback/20261015120100_membership_retry_down.sql

alter table public.memberships
  add column retry_after  timestamptz,
  add column email_sha256 text;

alter table public.memberships drop constraint memberships_status_check;
alter table public.memberships
  add constraint memberships_status_check check (status in ('active', 'lapsed', 'not_found', 'unknown'));
