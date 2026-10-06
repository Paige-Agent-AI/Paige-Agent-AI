-- Adopt the existing pg_cron/pg_net wake-up and canonical cron-token contract.
-- This is an infrastructure tick for paige_durable_work, not a Sales scheduler.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='sales-payment-reconcile') THEN
  PERFORM cron.unschedule('sales-payment-reconcile');
 END IF;
END $$;
SELECT cron.schedule('sales-payment-reconcile','*/5 * * * *',$job$
 SELECT net.http_post(
  url:='https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/sales-payment-reconcile',
  headers:=jsonb_build_object('Content-Type','application/json','x-cron-token',public.cron_token_header()),
  body:='{}'::jsonb
 );
$job$);
