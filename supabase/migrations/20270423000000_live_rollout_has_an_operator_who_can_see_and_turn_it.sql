-- INT-104: the operator can SEE the Live rollout and TURN it, from the product.
--
-- WHY THIS EXISTS. 20270422000000 reduced "who may speak today" to one setting and gave
-- paige-voice-profile-admin an action to change it. Neither has a surface. Measured: grepping src/
-- for `authorize-live-pilot`, `disable-live-pilot` and `paige-voice-profile-admin` returns nothing —
-- no component, hook or page calls that function at all. So the only way to open Live today is a
-- hand-written authenticated HTTP request, which means the owner cannot turn on his own product.
-- A setting only an engineer can change is not a setting anyone has (§70), and a capability whose
-- logic is reachable solely by someone with a terminal is the dead end §10 exists to forbid.
--
-- WHAT THIS ADDS. One read: paige_live_rollout_status(), a platform-owner-gated projection of the
-- state that already exists. It is the READ half of a control plane whose WRITE half already ships
-- (set_paige_live_rollout_scope_internal and set_paige_live_pilot_internal, both service-role only
-- behind the edge function's owner gate). Nothing new becomes writable here.
--
-- §9/§59 — the body enforces the caller, not the grant. It is SECURITY DEFINER because
-- paige_voice_readiness is service-role-only by design, so it RAISES 42501 for anyone who is not a
-- platform owner rather than leaning on EXECUTE. The grant to `authenticated` is what lets the
-- owner's browser call it at all; the RAISE is what stops everyone else, and the suite proves that
-- with an ordinary tenant admin.
--
-- §13 — it returns counts and states, never a subject's identity. An operator surface needs to know
-- that four people are admitted, not who they are; the individuals are the tenants' business.
-- Nothing here reads, logs or returns a provider key, a voice reference or an evidence ref.
--
-- Forward-only. Rollback: DROP FUNCTION public.paige_live_rollout_status();

BEGIN;

CREATE OR REPLACE FUNCTION public.paige_live_rollout_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _readiness public.paige_voice_readiness%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_owner(auth.uid()) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAIGE_LIVE_ROLLOUT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _readiness FROM public.paige_voice_readiness WHERE singleton = true;
  IF _readiness.singleton IS NULL THEN
    -- Honest absence, not a fabricated default (§13). A missing readiness row is a real state and
    -- the surface says so rather than drawing an "off" switch that nothing is behind.
    RETURN jsonb_build_object('readiness_present', false);
  END IF;

  RETURN jsonb_build_object(
    'readiness_present', true,
    -- The envelope: is the pilot open at all, and on what evidence.
    'pilot_enabled', _readiness.pilot_enabled,
    'rollout_scope', _readiness.pilot_rollout_scope,
    'authorized_at', _readiness.pilot_authorized_at,
    'authorization_source', _readiness.pilot_authorization_source,
    -- The two things that stay honestly unresolved, surfaced so no operator can open this believing
    -- they are settled. These are read from the stored state, never asserted by this function.
    'retention_state', _readiness.pilot_retention_state,
    'zero_retention_state', _readiness.pilot_zero_retention_state,
    'speaker_identity_enforced', _readiness.pilot_speaker_identity_enforced,
    -- Who it reaches today, as COUNTS. Never a user id, never an email, never a workspace name.
    'admitted_subjects', (
      SELECT count(*)::integer FROM public.paige_live_pilot_subjects
       WHERE revoked_at IS NULL AND expires_at > now()
    ),
    'workspaces_enabled_outright', (
      SELECT count(*)::integer FROM public.paige_live_tenant_availability WHERE enabled = true
    ),
    'workspaces_switched_off', (
      SELECT count(*)::integer FROM public.paige_live_tenant_availability WHERE enabled = false
    ),
    -- How many accounts the scope WOULD reach if it were opened, so the decision is made with the
    -- size of its audience visible rather than guessed.
    'solo_class_tenants', (
      SELECT count(*)::integer FROM public.tenants t
       WHERE t.parent_tenant_id IS NULL
         AND coalesce(t.account_type, 'standalone') NOT IN ('agency', 'sub_account')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paige_live_rollout_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paige_live_rollout_status() TO authenticated, service_role;

COMMENT ON FUNCTION public.paige_live_rollout_status() IS
  'Platform-owner-only projection of the Live rollout: the envelope, the one setting, the unresolved provider states, and how many accounts are reached or would be. RAISES 42501 for every other caller — the grant lets a browser call it, the body decides who is answered. Counts only; no subject identity leaves this function.';

COMMIT;
