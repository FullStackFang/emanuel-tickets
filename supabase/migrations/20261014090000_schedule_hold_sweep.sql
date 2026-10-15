-- Schedule the authoritative hold sweep (design D3, task 3.3). Runs every minute
-- inside Postgres via pg_cron, so no app server or Vercel Cron is involved and
-- inventory returns even when nobody is buying. Idempotent: re-running replaces
-- the job rather than duplicating it.

create extension if not exists pg_cron;

grant usage on schema cron to postgres;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'release-expired-reservations';

select cron.schedule(
  'release-expired-reservations',
  '* * * * *',
  $$ select public.release_expired_reservations(); $$
);
