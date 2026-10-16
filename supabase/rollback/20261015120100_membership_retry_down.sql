-- Rollback for 20261015120100_membership_retry.
delete from public.memberships where status = 'unknown';
alter table public.memberships drop constraint memberships_status_check;
alter table public.memberships
  add constraint memberships_status_check check (status in ('active', 'lapsed', 'not_found'));
alter table public.memberships drop column email_sha256, drop column retry_after;
