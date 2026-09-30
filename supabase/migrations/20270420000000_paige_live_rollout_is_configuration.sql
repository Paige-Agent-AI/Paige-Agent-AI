-- INT-104: Live Conversation is ONE shared capability for every Solo account.
--
-- WHY THIS EXISTS. 20270412000000 shipped an admission predicate that pinned the product to a
-- single person. It read the paige_voice_readiness singleton and required
--     r.pilot_actor_user_id = _actor_user_id        -- the speaker had to be ONE stored user id
--     r.pilot_authorized_by = _actor_user_id        -- and that user had to hold super_admin
-- so a Solo account that was not the platform operator was STRUCTURALLY incapable of Live, however
-- correct its standing, workspace, thread and permissions. That is a rollout restriction expressed
-- in the product's identity and permission model, which is the one place it may never live.
--
-- WHAT CHANGES. The predicate stops being an identity check and becomes a CONFIGURATION check:
-- "is this (actor, workspace) admitted by the current rollout configuration, and is the provider
-- proof intact?" Product eligibility — who the caller is, which workspace, which thread, which
-- permissions — is resolved by the callers through the canonical resolvers and is untouched here.
--
-- WHAT DOES NOT CHANGE, AND SAYING SO PLAINLY. Broadening the product does NOT broaden who may
-- speak today. The provider gate stays shut. Default provider retention is still an acceptance and
-- not a verified zero-retention claim; physical speaker identity is still unenforced (#1417). Every
-- account other than an admitted subject is refused, and the pgTAP suite proves that refusal rather
-- than asserting it. Opening the audience later is an INSERT into the configuration table below —
-- not an edit to this predicate, and not a product change.
--
-- WHY CONSENT CANNOT BE INHERITED. An admitted subject's row records ITS OWN acceptance, and a CHECK
-- requires the acceptor to be the subject. That makes inherited consent UNREPRESENTABLE — there is no
-- row shape in which one person's acceptance stands as another's authorization — which is not the
-- same as unforgeable: a service-role writer sets all three columns at once, so the CHECK constrains
-- the shape of the record, and the operator remains answerable for its truth. Today's only
-- production writer takes the subject from the verified session of the caller, so no account
-- identifier is read from, or typed into, any request.
--
-- §58, NAMED RATHER THAN LEFT TO BE DISCOVERED. One shipped behaviour does change. Because the old
-- predicate matched the singleton's pilot_tenant_id, authorizing a second workspace implicitly
-- revoked the first. That was an artifact of there being one row, not a designed control, and it is
-- the wrong default once more than one subject can be admitted — silently killing an existing
-- workspace's access is a worse surprise than leaving it. So it is gone deliberately, and the
-- consequence is stated plainly: withdrawal is now explicit, and the only withdrawal seam an edge
-- caller has is the global disable-live-pilot. Per-workspace and per-subject withdrawal are
-- configuration writes; no edge action for them is built here.
--
-- THE INSPECTION RECEIPT STAYS BOUND TO THE AUTHORIZER, NEVER TO THE SUBJECT. public.paige_audit_log
-- is INSERTable by any authenticated user under a `actor_user_id = auth.uid()` policy, and its
-- actor_role column is free text with no CHECK — so a Solo user can write themselves a row reading
-- actor_role 'super_admin' with a payload satisfying every provider-proof key below. That is only
-- harmless because the predicate reads the ONE receipt the owner-gated writer recorded
-- (r.pilot_inspection_id) and requires its author to be a platform owner. Re-keying the receipt to
-- the admitted subject would let every Solo account forge the provider half of this gate.
--
-- SIGNATURES ARE PRESERVED DELIBERATELY (§37). paige_live_pilot_authorized_internal(uuid,uuid) and
-- set_paige_live_pilot_internal(uuid,uuid,boolean,text,uuid) keep their exact argument shapes, so
-- the three deployed consumers (paige-live-session, paige-live-relay, paige-ai-chat) and the one
-- deployed writer caller (paige-voice-profile-admin) are byte-for-byte unchanged and need no
-- redeploy. Forward-only; no applied migration is edited.
--
-- ROLLBACK: authenticated platform-owner disable-live-pilot (no workspace argument needed). That
-- flips the readiness envelope off AND revokes every admitted subject, so re-enabling requires a
-- fresh acceptance rather than reviving a stale one. Retain the schema and audit history; never
-- restore the identity-coupled reader.

BEGIN;

-- ---------------------------------------------------------------------------
-- Operational configuration: WHO may use Live today.
-- Platform-owned, service-role only, missing row = refused — the same posture as
-- paige_live_tenant_availability, which remains the per-workspace half of the same gate.
-- This is not an entitlement, a role label, a tier feature, a transcript or a usage meter.
-- No tenant or account is seeded here; the table ships empty.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paige_live_pilot_subjects (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The platform operator who admitted this subject. Kept distinct from the subject so authority
  -- and eligibility can never collapse back into one person the way they did in 20270412000000.
  admitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  -- Revocation preserves the record instead of deleting it.
  revoked_at timestamptz,
  -- §68: no authority is permanent. An admission that nobody has revisited is not evidence that
  -- the rollout is still safe, and a stale row for a departed member is exactly the lingering
  -- admission this closes. Re-admitting is a configuration write, not a product change.
  expires_at timestamptz NOT NULL,
  accepted_default_provider_retention boolean NOT NULL DEFAULT false,
  accepted_procedural_single_speaker boolean NOT NULL DEFAULT false,
  -- Who performed the acceptance. The CHECK below makes inherited consent unrepresentable.
  -- CASCADE, matching user_id: the CHECK below holds these equal, so two different delete actions
  -- on the same row would resolve by internal trigger ordering rather than by a stated contract.
  acceptance_actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id),
  CONSTRAINT paige_live_pilot_consent_is_never_inherited
    CHECK (acceptance_actor_user_id = user_id),
  CONSTRAINT paige_live_pilot_admission_expires
    CHECK (expires_at > admitted_at),
  CONSTRAINT paige_live_pilot_subject_acceptance_complete
    CHECK (revoked_at IS NOT NULL
      OR (accepted_default_provider_retention = true AND accepted_procedural_single_speaker = true))
);

ALTER TABLE public.paige_live_pilot_subjects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paige_live_pilot_subjects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.paige_live_pilot_subjects TO service_role;
-- Intentionally no anon/authenticated policy. A browser, a tenant owner or a tenant admin cannot
-- read or write this rollout decision even for their own account, so no tenant role can self-admit.

COMMENT ON TABLE public.paige_live_pilot_subjects IS
  'Operational rollout configuration for Live Conversation: which authenticated subjects are admitted today. Not a product permission, entitlement or tier feature. Opening the audience is an INSERT here, never a change to the product.';
COMMENT ON COLUMN public.paige_live_pilot_subjects.acceptance_actor_user_id IS
  'The subject''s own acceptance. A CHECK requires this to equal user_id, so one subject''s consent can never be reused as another''s authorization.';

COMMENT ON COLUMN public.paige_voice_readiness.pilot_actor_user_id IS
  'Historical: the subject admitted by the most recent authorization, retained for audit continuity and the pre-existing completeness CHECK. It is NOT the admission gate — paige_live_pilot_subjects is. Do not reintroduce a predicate that reads this column as eligibility.';

-- ---------------------------------------------------------------------------
-- The admission predicate. Same signature; configuration semantics.
--
-- PRODUCT ELIGIBILITY IS NOT RE-RESOLVED HERE, ON PURPOSE (§18 one home). The canonical resolvers
-- already own it and this function must not narrow them:
--   * paige-live-session resolves the caller's own workspace through current_user_tenant_id() and
--     their own thread through a caller_user_id-scoped paige_chat_threads read before calling this.
--   * paige-live-relay re-resolves standing on every admission decision with the same alternatives
--     current_user_tenant_id() uses — active tenant_members OR agency_can_manage_child OR
--     agency_team_role OR is_platform_admin — and re-checks the caller-owned thread after the claim.
--   * paige-ai-chat checks the resolved tenant and the caller-owned thread before calling this.
-- A direct tenant_members join here would silently strip agency-managed and operator standing that
-- current_user_tenant_id() grants, so this function deliberately asks only the configuration and
-- provider-proof question it owns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paige_live_pilot_authorized_internal(_actor_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  -- The EXECUTE grant is not the guard; this is. Only the server's service identity may ask.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id IS NULL OR _tenant_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    -- Configuration, half one: this subject is admitted, and accepted for themselves.
    FROM public.paige_live_pilot_subjects s
    -- Configuration, half two: Live is switched on for this workspace. A missing row refuses.
    -- Bound to the PARAMETER deliberately. Reaching _tenant_id transitively through a row column
    -- works today and silently stops working the next time someone edits the WHERE clause, which
    -- would let one workspace's enabled row satisfy the gate for a different workspace.
    JOIN public.paige_live_tenant_availability a
      ON a.tenant_id = _tenant_id AND a.enabled = true
    -- The rollout envelope: the pilot is open at all, under a dated operator authorization.
    -- Deliberately NOT matched against r.pilot_tenant_id — that would re-pin the whole rollout to
    -- one workspace, which is the single-account shape in a different column. Per-workspace is the
    -- availability join above; per-subject is the configuration row.
    JOIN public.paige_voice_readiness r
      ON r.singleton = true AND r.pilot_enabled = true
    JOIN public.paige_voice_profiles candidate
      ON candidate.slot = 'candidate'
    JOIN public.paige_audit_log inspection
      ON inspection.id = r.pilot_inspection_id
    WHERE s.user_id = _actor_user_id
      AND s.tenant_id = _tenant_id
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.accepted_default_provider_retention = true
      AND s.accepted_procedural_single_speaker = true
      -- Authority is revocable: if the operator who admitted this subject loses platform-owner
      -- standing, the admission fails closed without anyone having to remember to withdraw it.
      AND public.is_platform_owner(s.admitted_by)
      AND public.is_platform_owner(r.pilot_authorized_by)
      AND r.pilot_authorized_at IS NOT NULL
      AND r.pilot_authorized_at <= now() + interval '1 minute'
      AND r.pilot_authorization_source = 'owner_authorization'
      AND nullif(btrim(r.pilot_evidence_ref), '') IS NOT NULL
      -- Honest privacy state, unchanged: default retention accepted, zero retention unavailable,
      -- single speaker procedural only, physical speaker identity not enforced (#1417).
      AND r.pilot_retention_state = 'default_provider_retention'
      AND r.pilot_zero_retention_state = 'UNAVAILABLE'
      AND r.pilot_single_speaker_accepted = true
      AND r.pilot_speaker_identity_enforced = false
      AND candidate.provider = 'elevenlabs'
      AND candidate.revision = 'elevenlabs-jessica-take5-r1'
      AND candidate.provider_voice_ref = 'g6xIsTj2HwM6VR4iXFCw'
      AND candidate.speech_policy->>'spoken_register' = 'take-5'
      AND candidate.approved = false AND candidate.active = false
      AND inspection.actor_user_id = r.pilot_authorized_by
      AND inspection.actor_role = 'super_admin'
      AND inspection.action = 'platform.paige_voice_profile.inspect'
      AND inspection.target_type = 'paige_voice_profiles'
      AND inspection.payload->>'phase' = 'inspection_completed'
      AND inspection.payload->>'profile_revision' = candidate.revision
      AND inspection.payload #>> '{inspection,code}' = 'metadata_only'
      AND inspection.payload #>> '{inspection,subscription,transport}' = 'ok'
      AND inspection.payload #>> '{inspection,voice,transport}' = 'ok'
      AND inspection.payload #>> '{inspection,voice,accessible}' = 'true'
      AND inspection.payload #>> '{inspection,voice,referenceMatches}' = 'true'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- The writer. Same five-argument signature, so no deployed caller changes.
-- _actor_user_id is the authenticated platform operator taken from the verified session by
-- paige-voice-profile-admin; it is never a request-body value. Because the operator authorizes from
-- their own authenticated session, they are today both the authorizer and the admitted subject —
-- which is a CONFIGURATION fact about who may speak now, no longer a product requirement that the
-- speaker hold super_admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_paige_live_pilot_internal(
  _actor_user_id uuid, _tenant_id uuid, _enabled boolean,
  _evidence_ref text, _inspection_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _inspection public.paige_audit_log%ROWTYPE;
  _candidate public.paige_voice_profiles%ROWTYPE;
  _revoked integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR _actor_user_id IS NULL
     OR public.is_platform_owner(_actor_user_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  IF NOT _enabled THEN
    -- Preserve the proof history and all legacy readiness/profile fields.
    UPDATE public.paige_voice_readiness
       SET pilot_enabled = false, updated_by = _actor_user_id, updated_at = now()
     WHERE singleton = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_LIVE_PILOT_READINESS_MISSING' USING ERRCODE = '55000'; END IF;
    -- Disable means nobody is admitted, not merely that the envelope is off. Withdraw every
    -- subject so a later re-enable cannot revive a stale acceptance as fresh authorization.
    WITH withdrawn AS (
      UPDATE public.paige_live_pilot_subjects
         SET revoked_at = now(), updated_at = now()
       WHERE revoked_at IS NULL
       RETURNING 1
    ) SELECT count(*)::integer INTO _revoked FROM withdrawn;
    INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, payload)
      VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.disable',
        'paige_voice_readiness',
        jsonb_build_object('enabled', false, 'subjects_withdrawn', _revoked));
    RETURN jsonb_build_object('enabled', false);
  END IF;

  IF _tenant_id IS NULL OR nullif(btrim(_evidence_ref), '') IS NULL
     OR _inspection_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.tenants WHERE id = _tenant_id
     ) THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_PROOF_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _candidate FROM public.paige_voice_profiles WHERE slot = 'candidate';
  SELECT * INTO _inspection FROM public.paige_audit_log
    WHERE id = _inspection_id FOR SHARE;
  IF _candidate.slot IS NULL OR _candidate.provider <> 'elevenlabs'
     OR _candidate.revision <> 'elevenlabs-jessica-take5-r1'
     OR _candidate.provider_voice_ref <> 'g6xIsTj2HwM6VR4iXFCw'
     OR _candidate.speech_policy->>'spoken_register' IS DISTINCT FROM 'take-5'
     OR _candidate.approved OR _candidate.active
     OR _inspection.id IS NULL
     OR _inspection.actor_user_id IS DISTINCT FROM _actor_user_id
     OR _inspection.actor_role IS DISTINCT FROM 'super_admin'
     OR _inspection.action IS DISTINCT FROM 'platform.paige_voice_profile.inspect'
     OR _inspection.target_type IS DISTINCT FROM 'paige_voice_profiles'
     OR _inspection.created_at < now() - interval '5 minutes'
     OR _inspection.created_at > now() + interval '1 minute'
     OR _inspection.payload->>'phase' IS DISTINCT FROM 'inspection_completed'
     OR _inspection.payload->>'profile_revision' IS DISTINCT FROM _candidate.revision
     OR _inspection.payload #>> '{inspection,code}' IS DISTINCT FROM 'metadata_only'
     OR _inspection.payload #>> '{inspection,subscription,transport}' IS DISTINCT FROM 'ok'
     OR _inspection.payload #>> '{inspection,voice,transport}' IS DISTINCT FROM 'ok'
     OR _inspection.payload #>> '{inspection,voice,accessible}' IS DISTINCT FROM 'true'
     OR _inspection.payload #>> '{inspection,voice,referenceMatches}' IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_PROOF_REQUIRED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.paige_voice_readiness
     SET pilot_enabled = true,
         pilot_actor_user_id = _actor_user_id,
         pilot_tenant_id = _tenant_id,
         pilot_authorized_at = now(),
         pilot_authorized_by = _actor_user_id,
         pilot_authorization_source = 'owner_authorization',
         pilot_evidence_ref = btrim(_evidence_ref),
         pilot_retention_state = 'default_provider_retention',
         pilot_zero_retention_state = 'UNAVAILABLE',
         pilot_single_speaker_accepted = true,
         pilot_speaker_identity_enforced = false,
         pilot_inspection_id = _inspection_id,
         updated_by = _actor_user_id, updated_at = now()
   WHERE singleton = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_LIVE_PILOT_READINESS_MISSING' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.paige_live_tenant_availability(tenant_id, enabled, updated_at)
    VALUES (_tenant_id, true, now())
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, updated_at = now();
  -- Admit the authenticated actor as a rollout subject. The acceptance is recorded as their own,
  -- which is what the CHECK requires; an operator cannot accept on a third party's behalf.
  INSERT INTO public.paige_live_pilot_subjects(
      user_id, tenant_id, admitted_by, admitted_at, revoked_at, expires_at,
      accepted_default_provider_retention, accepted_procedural_single_speaker,
      acceptance_actor_user_id, updated_at)
    VALUES (_actor_user_id, _tenant_id, _actor_user_id, now(), NULL,
      now() + interval '14 days', true, true, _actor_user_id, now())
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET admitted_by = EXCLUDED.admitted_by, admitted_at = now(), revoked_at = NULL,
          expires_at = EXCLUDED.expires_at,
          accepted_default_provider_retention = true, accepted_procedural_single_speaker = true,
          acceptance_actor_user_id = EXCLUDED.acceptance_actor_user_id, updated_at = now();
  INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, tenant_id, payload)
    VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.authorize',
      'paige_voice_readiness', _tenant_id,
      jsonb_build_object('enabled', true, 'inspection_id', _inspection_id,
        'admitted_subject_user_id', _actor_user_id,
        'retention_state', 'default_provider_retention',
        'zero_retention_state', 'UNAVAILABLE',
        'single_speaker_acceptance', 'procedural_only'));
  RETURN jsonb_build_object('enabled', true,
    'retention_state', 'default_provider_retention',
    'zero_retention_state', 'UNAVAILABLE');
END;
$$;

REVOKE ALL ON FUNCTION public.paige_live_pilot_authorized_internal(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paige_live_pilot_authorized_internal(uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_paige_live_pilot_internal(uuid,uuid,boolean,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_paige_live_pilot_internal(uuid,uuid,boolean,text,uuid)
  TO service_role;

COMMIT;
