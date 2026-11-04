-- Multi-tenancy, step 4 of 4 (spec §7.2). Schools can be in any US time zone,
-- so the 10-minute tick runs around the clock. Each school's local-time
-- constants decide what actually runs; off-hours ticks do nothing.
-- cron.schedule upserts by job name.
select cron.schedule(
  'controlpad-attendance-tick',
  '*/10 * * * *',
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
