-- EXP07 broadcast slice — one table + three service-role RPCs, the tenant_media_assets
-- pattern exactly: RLS ON with ZERO policies (service-role only), the door is the only
-- writer, one live session per tenant enforced at the DATABASE level (a partial unique
-- index, not a hopeful check), and the forward-only lifecycle lives in the RPC (live →
-- ended; ended is terminal). Metadata only — room mechanics live at the provider; usage
-- meters to platform_usage_events under the EXISTING media_usd exactly-once index
-- (tenant_id + metadata.job_id), so broadcast and media share one meter with no second
-- ledger (the billing supersession's shape).
BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_broadcast_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'live',
  meeting_id text NOT NULL,
  host_participant_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT tenant_broadcast_sessions_status_chk CHECK (status IN ('live','ended'))
);

COMMENT ON TABLE public.tenant_broadcast_sessions IS
  'EXP07 live broadcast sessions. Metadata only — the room/admission live at the provider; usage meters to platform_usage_events (media_usd, exactly-once by job_id). Service-role only via the broadcast-command door; one live session per tenant is enforced by index.';

-- ONE live room per workspace — the honest product rule of slice 1, enforced where a
-- race cannot beat it.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_broadcast_sessions_one_live
  ON public.tenant_broadcast_sessions (tenant_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS tenant_broadcast_sessions_tenant_created
  ON public.tenant_broadcast_sessions (tenant_id, created_at DESC);

ALTER TABLE public.tenant_broadcast_sessions ENABLE ROW LEVEL SECURITY;

-- ── RPCs (SECURITY DEFINER, service-role only) ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tenant_broadcast_session_open(
  p_tenant_id uuid, p_title text, p_meeting_id text, p_host_participant_id text, p_created_by uuid
) RETURNS public.tenant_broadcast_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.tenant_broadcast_sessions;
BEGIN
  INSERT INTO public.tenant_broadcast_sessions (tenant_id, title, meeting_id, host_participant_id, created_by)
  VALUES (p_tenant_id, p_title, p_meeting_id, p_host_participant_id, p_created_by)
  RETURNING * INTO r;
  RETURN r;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;  -- a live session already exists — the door refuses honestly, never overwrites
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_broadcast_session_open(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_broadcast_session_open(uuid, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tenant_broadcast_session_active(
  p_tenant_id uuid
) RETURNS public.tenant_broadcast_sessions
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT * FROM public.tenant_broadcast_sessions
  WHERE tenant_id = p_tenant_id AND status = 'live'
  ORDER BY created_at DESC LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_broadcast_session_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_broadcast_session_active(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tenant_broadcast_session_end(
  p_id uuid, p_tenant_id uuid
) RETURNS public.tenant_broadcast_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.tenant_broadcast_sessions;
BEGIN
  UPDATE public.tenant_broadcast_sessions
  SET status = 'ended', ended_at = now()
  WHERE id = p_id AND tenant_id = p_tenant_id AND status = 'live'
  RETURNING * INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_broadcast_session_end(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_broadcast_session_end(uuid, uuid) TO service_role;

COMMIT;
