-- INT-104 Stage 1 scoped Live pilot; additive extension of readiness.
-- This extends the existing voice-readiness singleton; it does not enable
-- legacy transport, approve/activate a profile, or assert zero retention.
-- The Edge owner action obtains actor/workspace from the authenticated session,
-- requires explicit acceptance of default provider retention and procedural
-- single-speaker use, and passes its own fresh inspection ID.
-- This database cannot identify the physical speaker. It records acceptance only.
-- Safe rollback: the platform owner calls set_paige_live_pilot_internal with
-- _enabled=false (other arguments NULL), leaving proof history and columns
-- in place. Remove columns only in a later additive migration after callers move.

BEGIN;

ALTER TABLE public.paige_voice_readiness
  ADD COLUMN pilot_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN pilot_actor_user_id uuid,
  ADD COLUMN pilot_tenant_id uuid,
  ADD COLUMN pilot_authorized_at timestamptz,
  ADD COLUMN pilot_authorized_by uuid,
  ADD COLUMN pilot_authorization_source text,
  ADD COLUMN pilot_evidence_ref text,
  ADD COLUMN pilot_retention_state text,
  ADD COLUMN pilot_zero_retention_state text NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN pilot_single_speaker_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN pilot_speaker_identity_enforced boolean NOT NULL DEFAULT false,
  ADD COLUMN pilot_inspection_id uuid REFERENCES public.paige_audit_log(id);

ALTER TABLE public.paige_voice_readiness
  ADD CONSTRAINT paige_voice_pilot_source_valid
    CHECK (pilot_authorization_source IS NULL OR pilot_authorization_source = 'owner_authorization'),
  ADD CONSTRAINT paige_voice_pilot_retention_valid
    CHECK (pilot_retention_state IS NULL OR pilot_retention_state = 'default_provider_retention'),
  ADD CONSTRAINT paige_voice_pilot_zero_retention_honest
    CHECK (pilot_zero_retention_state = 'UNAVAILABLE'),
  ADD CONSTRAINT paige_voice_pilot_no_speaker_recognition
    CHECK (pilot_speaker_identity_enforced = false),
  ADD CONSTRAINT paige_voice_pilot_complete_if_enabled
    CHECK (NOT pilot_enabled OR (
      pilot_actor_user_id IS NOT NULL AND pilot_tenant_id IS NOT NULL
      AND pilot_authorized_at IS NOT NULL AND pilot_authorized_by IS NOT NULL
      AND pilot_authorization_source IS NOT NULL
      AND pilot_authorization_source = 'owner_authorization'
      AND nullif(btrim(pilot_evidence_ref), '') IS NOT NULL
      AND pilot_retention_state IS NOT NULL
      AND pilot_retention_state = 'default_provider_retention'
      AND pilot_zero_retention_state = 'UNAVAILABLE'
      AND pilot_single_speaker_accepted = true
      AND pilot_speaker_identity_enforced = false
      AND pilot_inspection_id IS NOT NULL
    ));

COMMENT ON COLUMN public.paige_voice_readiness.pilot_single_speaker_accepted IS
  'Procedural owner acceptance only. The system does not identify or enforce the physical speaker.';
COMMENT ON COLUMN public.paige_voice_readiness.pilot_zero_retention_state IS
  'Zero retention remains UNAVAILABLE for the scoped default-retention pilot.';

CREATE FUNCTION public.paige_live_pilot_authorized_internal(_actor_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id IS NULL OR _tenant_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.paige_voice_readiness r
    JOIN public.paige_live_tenant_availability a
      ON a.tenant_id = r.pilot_tenant_id AND a.enabled = true
    JOIN public.paige_voice_profiles candidate
      ON candidate.slot = 'candidate'
    JOIN public.paige_audit_log inspection
      ON inspection.id = r.pilot_inspection_id
    WHERE r.singleton = true AND r.pilot_enabled = true
      AND r.pilot_actor_user_id = _actor_user_id
      AND r.pilot_tenant_id = _tenant_id
      AND r.pilot_authorized_by = _actor_user_id
      AND public.is_platform_owner(r.pilot_authorized_by)
      AND r.pilot_authorized_at IS NOT NULL
      AND r.pilot_authorized_at <= now() + interval '1 minute'
      AND r.pilot_authorization_source = 'owner_authorization'
      AND nullif(btrim(r.pilot_evidence_ref), '') IS NOT NULL
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

CREATE FUNCTION public.set_paige_live_pilot_internal(
  _actor_user_id uuid, _tenant_id uuid, _enabled boolean,
  _evidence_ref text, _inspection_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _inspection public.paige_audit_log%ROWTYPE;
  _candidate public.paige_voice_profiles%ROWTYPE;
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
    INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, payload)
      VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.disable',
        'paige_voice_readiness', jsonb_build_object('enabled', false));
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
  INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, tenant_id, payload)
    VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.authorize',
      'paige_voice_readiness', _tenant_id,
      jsonb_build_object('enabled', true, 'inspection_id', _inspection_id,
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
