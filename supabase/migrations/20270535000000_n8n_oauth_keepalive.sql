-- The n8n OAuth grant keepalive (owner report 2026-10-03: "I keep losing my n8n MCP
-- connection and having to reconnect it" — grants were re-OAuthed 09-04, 09-05, 09-06,
-- 09-11, 09-13, 09-23, 10-02). Platform-wide: every enabled n8n OAuth connection of every
-- current and future Solo tenant, no tenant-specific anything.
--
-- Two objects:
--   1. public.list_n8n_keepalive_targets() — the keepalive's target list: every enabled
--      n8n OAuth connection with its tenant's CURRENT OWNER, resolved through the SAME
--      canonical authority check (is_tenant_owner) the lease fence itself enforces. The
--      keepalive then drives the EXISTING governed lease (n8n_oauth_service acquire →
--      refresh → rotate → probe → release) AS that owner — no new authority, no parallel
--      refresh path, no credential access beyond the lease's own fenced read.
--      SECURITY DEFINER + EXECUTE on service_role ONLY: the target list and the owner
--      mapping are internal scheduling facts, not browser-callable surface.
--   2. The pg_cron schedule (every 6 hours) posting to the function with the platform's
--      cron token — the same shape as paige-media-sweeper (unschedule-then-schedule, so
--      re-running this migration never double-schedules).

CREATE OR REPLACE FUNCTION public.list_n8n_keepalive_targets()
RETURNS table (tenant_id uuid, owner_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT c.tenant_id,
         (SELECT m.user_id FROM public.tenant_members m
           WHERE m.tenant_id = c.tenant_id
             AND public.is_tenant_owner(m.user_id, c.tenant_id)
           ORDER BY m.user_id LIMIT 1) AS owner_id
  FROM public.tenant_mcp_connections c
  WHERE c.provider = 'n8n' AND c.enabled AND c.auth_kind = 'oauth';
$$;

REVOKE ALL ON FUNCTION public.list_n8n_keepalive_targets() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.list_n8n_keepalive_targets() TO service_role;

COMMENT ON FUNCTION public.list_n8n_keepalive_targets() IS
 'Keepalive targets: every enabled n8n OAuth connection with its current owner (the lease fence''s own authority check). service_role only.';

do $$
begin
  perform cron.unschedule('n8n-oauth-keepalive')
  where exists (select 1 from cron.job where jobname = 'n8n-oauth-keepalive');
  perform cron.schedule(
    'n8n-oauth-keepalive',
    '0 */6 * * *',
    $cron$
      select net.http_post(
        url     := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/n8n-oauth-keepalive',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-token', public.cron_token_header()),
        body    := '{}'::jsonb
      );
    $cron$
  );
end $$;
