-- EXP08 Team Hub: a scheduled stale-file sweep. Contract:
-- docs/delivery/exp08-team-hub-increment3-attachments-contract.md §4 (team_hub_claim_stale_files) and §5.
-- Increment 3 swept a person's stale uploads only when that person next finished an upload, so someone
-- who never uploaded again left up to 20 unreadable files until account retirement. This adds:
--   1. team_hub_stale_file_uploaders(p_limit): service role only. The uploaders who have sweep work now,
--      by exactly team_hub_claim_stale_files's own two conditions: an unposted pending or ready file older
--      than a day, or a discarded or refused file whose object is still stored. Oldest work first. It
--      returns ids only; the claim itself, and what it marks and returns, is the unchanged increment-3 door.
--   2. An hourly pg_cron job that posts to the team-hub-file-sweep edge function with the incumbent
--      x-cron-token header. The function loops the uploaders through team_hub_claim_stale_files and removes
--      only canonical <tenant>/team-hub/<file> paths, as team-hub-file already does.
-- Nothing is read or returned beyond file paths the claim already returns to the service role.
-- Rollback: cron.unschedule('team-hub-file-sweep') and drop the function.

BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.team_hub_stale_file_uploaders(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE lim int:=greatest(1,least(200,coalesce(p_limit,50))); uploaders jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT coalesce(jsonb_agg(w.uploaded_by ORDER BY w.oldest, w.uploaded_by),'[]'::jsonb) INTO uploaders
 FROM (SELECT x.uploaded_by, min(x.created_at) AS oldest FROM public.team_hub_files x
   WHERE (x.state IN ('pending','ready') AND x.message_id IS NULL AND x.created_at<=now()-interval '1 day')
      OR (x.state IN ('discarded','rejected')
          AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=x.storage_path))
   GROUP BY x.uploaded_by ORDER BY min(x.created_at), x.uploaded_by LIMIT lim) w;
 RETURN jsonb_build_object('ok',true,'uploaders',uploaders);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_stale_file_uploaders(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_stale_file_uploaders(int) TO service_role;

-- The incumbent pg_cron pattern (paige-media-sweeper, paige-model-watch-daily). Minute 41, off the top of
-- the hour so it never queues behind the hourly burst. A database without pg_cron (a disposable proof)
-- skips the schedule and keeps the function.
DO $do$
BEGIN
 IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
 PERFORM cron.unschedule('team-hub-file-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='team-hub-file-sweep');
 PERFORM cron.schedule(
  'team-hub-file-sweep',
  '41 * * * *',
  $cron$
   select net.http_post(
    url     := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/team-hub-file-sweep',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token', public.cron_token_header()),
    body    := '{}'::jsonb
   );
  $cron$
 );
END $do$;

COMMIT;
