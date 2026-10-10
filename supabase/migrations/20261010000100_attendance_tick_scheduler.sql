-- Run the attendance tick every 10 minutes from Supabase (Vercel Hobby only
-- allows once-a-day crons). The job calls the app's protected endpoint.
--
-- Requires two Vault secrets, created once by the project owner in the
-- Supabase SQL editor (see docs/SETUP.md §5):
--   controlpad_app_url     e.g. https://controlpad.vercel.app  (no trailing slash)
--   controlpad_cron_secret same value as CRON_SECRET in Vercel
-- Until both exist, each run fails harmlessly and nothing is sent.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 10:00–23:50 UTC = roughly 6am–7:50pm Eastern (5am–6:50pm in winter).
-- cron.schedule upserts by job name, so re-running this is safe.
select cron.schedule(
  'controlpad-attendance-tick',
  '*/10 10-23 * * *',
  $job$
    select net.http_get(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'controlpad_app_url'
      ) || '/api/cron/attendance-tick',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'controlpad_cron_secret'
        )
      ),
      timeout_milliseconds := 30000
    );
  $job$
);
