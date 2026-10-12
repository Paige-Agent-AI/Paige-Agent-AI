-- ANT-37: schedule the model watch on the incumbent pg_cron pattern (daily 03:17 UTC — off the
-- top of any hour so it never queues behind the 13:02 heartbeat burst). The function is
-- metadata-only (zero spend, existing credentials) and informational (no routing authority).

select cron.schedule(
  'paige-model-watch-daily',
  '17 3 * * *',
  $$
  select net.http_post(
    url     := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-model-watch',
    headers := jsonb_build_object('Content-Type','application/json', 'x-cron-token', public.cron_token_header()),
    body    := '{}'::jsonb
  );
  $$
);
