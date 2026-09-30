-- Live Conversation opens. Speaking is no longer a privilege that must be granted.
--
-- OWNER RULING 2026-09-24 (Antonio): "Remove the gate. Just remove it entirely... Recode that so it
-- just works seamlessly." And, on scope: "I don't want this to be dedicated just to me. I want this
-- to be dedicated to solo accounts... that's where we're going to start making money from."
-- Then, after Jessica landed in chat read-aloud: "But I still want her on my live, though. That was
-- the whole objective... Just get Jessica live on my solo shell right now."
--
-- 20270424000000 made Jessica the voice for chat read-aloud. This opens Live to Solo accounts.
--
-- WHAT WAS BLOCKING IT. paige_live_pilot_authorized_internal required, simultaneously: a per-subject
-- allowlist row admitted by a platform owner; paige_voice_readiness.pilot_enabled = true with eight
-- further pilot_* fields in exact states; a paige_audit_log inspection receipt whose payload matched
-- the candidate profile on five nested keys; and the candidate profile pinned to approved=false.
-- pilot_enabled could only be set by an edge action that no screen in the product called, and that
-- action derived the workspace from current_user_tenant_id() -- null for the tenant-less platform
-- operator, the only tier permitted to call it. So the gate could not be opened by anyone, from
-- anywhere, and every Live attempt returned 403 live_audio_not_enabled.
--
-- paige_live_accept_terms() carried the same envelope requirement, which is why the consent button
-- appeared to do nothing: the RPC refused before it wrote, exactly as designed.
--
-- WHAT IS REMOVED: the subject allowlist, the pilot envelope and all its fields, the inspection
-- receipt, and the candidate-profile proof. An enablement ceremony, not a safety control.
--
-- WHAT IS KEPT, deliberately, and each for a stated reason:
--   * auth.role() = 'service_role' on the admission predicate (§59 -- a SECURITY DEFINER body
--     enforces caller scope itself; removing the ceremony must not remove that).
--   * ACTIVE MEMBERSHIP of the tenant being spoken about. This is the one line that says act-as is
--     not membership: current_user_tenant_id() honours profiles.active_tenant_id for a
--     platform_admin with no membership at all, which is right for READING a tenant's data under
--     §51 Tier 1 and wrong for admitting yourself to its live audio. Without it a delegated
--     platform_admin could point active_tenant_id at any customer's Solo account and self-admit --
--     a door §53 freezes is_platform_owner() specifically to keep shut, reopened one layer down.
--   * live_conversation_tier_allows() -- the Solo tier baseline, reused rather than re-derived
--     (§18). Solo and Enterprise, never an agency or a sub-account. This is product scope, which
--     the owner set; it is not the ceremony he removed.
--   * The per-workspace switch-off in paige_live_tenant_availability. A missing row still means
--     "follow the tier", so a newly provisioned Solo account works with no operator action -- but an
--     explicit `enabled = false` still stops one account. An operator brake is not a precondition
--     every account must clear.
--   * The consent record. paige_live_accept_terms() still writes the subject's own acknowledgement
--     that audio goes to the provider under default retention and that the microphone is treated as
--     one speaker. Admission no longer reads it, so it is a record rather than a gate -- but it is
--     the honest disclosure a person should make once, and it stays.
--
-- Both functions are replaced at identical signatures, so none of the four deployed callers
-- (paige-live-relay, paige-live-session, paige-ai-chat, the frontend) redeploys.

CREATE OR REPLACE FUNCTION public.paige_live_pilot_authorized_internal(_actor_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id IS NULL OR _tenant_id IS NULL THEN RETURN false; END IF;

  RETURN
    -- Real membership, not act-as. See the note above; this is load-bearing.
    EXISTS (
      SELECT 1 FROM public.tenant_members m
       WHERE m.user_id = _actor_user_id AND m.tenant_id = _tenant_id AND m.status = 'active'
    )
    -- The Solo tier baseline. Every active member of a Solo account is eligible, not only its
    -- owner: Live is a modality over the book a member can already reach in chat, not new access
    -- to it, and the relay re-checks active standing on every renewal.
    AND public.live_conversation_tier_allows(_tenant_id)
    -- An explicit operator switch-off still stops one workspace. A missing row is not a refusal.
    AND NOT EXISTS (
      SELECT 1 FROM public.paige_live_tenant_availability a
       WHERE a.tenant_id = _tenant_id AND a.enabled = false
    );
END;
$$;

COMMENT ON FUNCTION public.paige_live_pilot_authorized_internal(uuid, uuid) IS
  'May this actor speak with Paige about this workspace? Active membership of the tenant, plus the Solo tier baseline, minus an explicit per-workspace switch-off. There is no enablement flag, allowlist, envelope or provider-inspection receipt: the owner removed that ceremony on 2026-09-24. Name retained so the four deployed callers do not redeploy.';

-- Self-service acceptance. Still takes no identity argument: the subject is auth.uid() and the
-- workspace is the canonical resolver's answer, so nothing about who is accepting can be supplied
-- by the caller. The envelope lookup is gone; the acknowledgement it records is not.
CREATE OR REPLACE FUNCTION public.paige_live_accept_terms()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'PAIGE_LIVE_NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;
  _tenant := public.current_user_tenant_id();
  IF _tenant IS NULL THEN
    -- A signed-in person with no resolvable workspace is REFUSED, not thrown at: this is a
    -- user-facing RPC and an exception surfaces as a broken screen.
    RETURN jsonb_build_object('accepted', false, 'code', 'live_audio_not_enabled');
  END IF;

  -- Act-as is not membership. Same reasoning as the predicate above.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.user_id = _uid AND m.tenant_id = _tenant AND m.status = 'active'
  ) THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'live_audio_not_enabled');
  END IF;

  IF NOT public.live_conversation_tier_allows(_tenant)
     OR EXISTS (
       SELECT 1 FROM public.paige_live_tenant_availability a
        WHERE a.tenant_id = _tenant AND a.enabled = false
     ) THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'live_audio_not_enabled');
  END IF;

  -- Already acknowledged? Say so and write nothing. Without this the call is a loop any
  -- authenticated member can run to append unbounded rows to the platform-wide audit log.
  IF EXISTS (
    SELECT 1 FROM public.paige_live_pilot_subjects s
     WHERE s.user_id = _uid AND s.tenant_id = _tenant
       AND s.revoked_at IS NULL AND s.expires_at > now()
       AND s.accepted_default_provider_retention AND s.accepted_procedural_single_speaker
  ) THEN
    RETURN jsonb_build_object('accepted', true, 'unchanged', true,
      'retention_state', 'default_provider_retention',
      'zero_retention_state', 'UNAVAILABLE');
  END IF;

  -- Self-admitted now: the acknowledgement is the subject's own, and no platform owner stands
  -- behind it because none is required any more. The table's CHECK that the acceptance actor is
  -- the subject is satisfied by construction.
  INSERT INTO public.paige_live_pilot_subjects(
      user_id, tenant_id, admitted_by, admitted_at, revoked_at, expires_at,
      accepted_default_provider_retention, accepted_procedural_single_speaker,
      acceptance_actor_user_id, updated_at)
    VALUES (_uid, _tenant, _uid, now(), NULL, now() + interval '365 days',
            true, true, _uid, now())
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET admitted_by = EXCLUDED.admitted_by, admitted_at = now(), revoked_at = NULL,
          expires_at = EXCLUDED.expires_at,
          accepted_default_provider_retention = true, accepted_procedural_single_speaker = true,
          acceptance_actor_user_id = EXCLUDED.acceptance_actor_user_id, updated_at = now();

  INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, tenant_id, payload)
    VALUES (_uid, 'authenticated', 'paige_live.accept_terms', 'paige_live_pilot_subjects', _tenant,
      jsonb_build_object('retention_state', 'default_provider_retention',
                         'zero_retention_state', 'UNAVAILABLE',
                         'single_speaker_acceptance', 'procedural_only'));

  RETURN jsonb_build_object('accepted', true,
    'retention_state', 'default_provider_retention',
    'zero_retention_state', 'UNAVAILABLE');
END;
$$;

REVOKE ALL ON FUNCTION public.paige_live_accept_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paige_live_accept_terms() TO authenticated, service_role;

COMMENT ON FUNCTION public.paige_live_accept_terms() IS
  'A Solo user acknowledges Live''s terms for THEMSELVES. Takes no identity argument: the subject is auth.uid() and the workspace is current_user_tenant_id(). Records the acknowledgement; it is no longer a precondition of admission, because the owner removed that ceremony on 2026-09-24.';
