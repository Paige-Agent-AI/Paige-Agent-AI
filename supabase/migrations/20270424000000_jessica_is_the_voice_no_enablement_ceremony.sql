-- Jessica is the voice, and speaking is not a privilege that must be granted.
--
-- OWNER RULING 2026-09-24 (Antonio), verbatim: "Remove the gate. Just remove it entirely. I don't
-- care who did it. Just remove it. Recode that so it just works seamlessly." And, on the naming:
-- "Why is it even called pilot-enabled anyway? This isn't a pilot. This is an actual platform, so
-- it should be voice-enabled, and no one should guard that. Who authorized guarding that in the
-- first place? I didn't."
--
-- He didn't. The provenance was traced before this was written: the word "pilot" appears nowhere in
-- CLAUDE.md as a concept; every commit that introduced pilot_enabled is agent-authored; and the
-- doctrine clause that "authorized" the gate entered in 8bf9f61, an unrelated mechanical docs
-- closeout with review waived, in the only section of that file carrying no owner attribution.
--
-- SCOPE OF THIS MIGRATION: the SPEAKING VOICE. Chat read-aloud (paige-tts) resolved the active
-- profile, which was OpenAI 'nova', while Live was wired to an ElevenLabs "Jessica" candidate that
-- could never be promoted -- activation demanded a paige_voice_provider_verifications row, a table
-- with no production writer anywhere. So the two surfaces disagreed and one of them was unreachable.
-- After this, both resolve Jessica. The Live ADMISSION gate is a separate, larger removal and is
-- deliberately NOT touched here: a half-removed gate is worse than either state.
--
-- WHAT IS REMOVED: the provider-proof preconditions on resolving and on reserving. These required
-- key scope, voice authorization, retention approval, ZERO RETENTION, quota and a cost ceiling to
-- be attested in a row nothing could write. They were an enablement ceremony, not a safety control.
--
-- WHAT IS KEPT, deliberately: auth.role() = 'service_role' on both functions (§59 -- a SECURITY
-- DEFINER body enforces caller scope itself, and removing the ceremony must not remove that); the
-- caller/tenant membership check; and the monthly platform and per-tenant BUDGETS with their
-- reservation and settlement machinery. A budget is not a gate. It never refuses the first request;
-- it stops a runaway bill, which is the owner's money and the one control he asked to keep.

-- 1. A tenant with no budget row of its own inherits the platform default.
--    Without this, every FUTURE Solo account signs up with no row and is refused -- the same gate
--    wearing a different name. New accounts must simply work.
ALTER TABLE public.paige_voice_platform_budget
  ADD COLUMN IF NOT EXISTS default_tenant_monthly_limit_usd numeric NOT NULL DEFAULT 0;

-- 2. Turn the budget ON. It shipped enabled=false, emergency_disabled=true and both limits 0, so
--    every ElevenLabs request raised PAIGE_VOICE_BUDGET_DISABLED regardless of any proof -- a second
--    dead switch behind the first. These are conservative starting numbers, not a considered spend
--    decision: they exist so the feature works while staying bounded. The rate is a reservation
--    UPPER bound, so erring high is the safe direction -- it reserves more and caps sooner.
UPDATE public.paige_voice_platform_budget
   SET enabled = true,
       emergency_disabled = false,
       monthly_limit_usd = GREATEST(monthly_limit_usd, 100),
       max_usd_per_1000_chars = GREATEST(max_usd_per_1000_chars, 0.30),
       default_tenant_monthly_limit_usd = GREATEST(default_tenant_monthly_limit_usd, 10)
 WHERE singleton = true;

-- 3. Jessica becomes the active voice. Written directly rather than through
--    set_paige_voice_profile_internal, whose approval path still demands the verification receipt
--    this migration removes the need for.
UPDATE public.paige_voice_profiles
   SET provider = 'elevenlabs',
       provider_voice_ref = 'g6xIsTj2HwM6VR4iXFCw',
       revision = 'elevenlabs-jessica-r1',
       paige_facing_name = 'Paige',
       speech_policy = '{"source":"paige-profile","spoken_register":"take-5"}'::jsonb,
       approved = true,
       active = true,
       status = 'approved',
       effective_at = now() - interval '1 minute',
       updated_at = now()
 WHERE slot = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paige_voice_profiles
     WHERE slot = 'active' AND provider = 'elevenlabs'
       AND provider_voice_ref = 'g6xIsTj2HwM6VR4iXFCw' AND approved AND active
  ) THEN
    RAISE EXCEPTION 'PAIGE_VOICE_ACTIVE_PROFILE_NOT_JESSICA';
  END IF;
END $$;

-- 4. Resolution. Identical signature, so no deployed consumer redeploys. The ElevenLabs
--    canonical-proof branch is gone; everything else is the prior behaviour unchanged.
CREATE OR REPLACE FUNCTION public.resolve_paige_voice_profile_internal(_session_started_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _profile public.paige_voice_profiles%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_VOICE_PROFILE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _profile FROM public.paige_voice_profiles WHERE slot = 'active';
  IF _profile.slot IS NULL OR NOT _profile.approved OR NOT _profile.active
     OR _profile.effective_at IS NULL OR _profile.effective_at > _session_started_at THEN
    RAISE EXCEPTION 'PAIGE_VOICE_PROFILE_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'profile_id', _profile.profile_id, 'paige_facing_name', _profile.paige_facing_name,
    'revision', _profile.revision, 'provider', _profile.provider,
    'provider_voice_ref', _profile.provider_voice_ref, 'approved', _profile.approved,
    'active', _profile.active, 'speech_policy', _profile.speech_policy,
    'effective_at', _profile.effective_at);
END; $$;

-- 5. Reservation. Identical signature. The provider-proof branch is gone; every budget, locking,
--    idempotency and limit behaviour is preserved exactly, and a tenant with no row of its own now
--    inherits the platform default instead of being refused.
CREATE OR REPLACE FUNCTION public.reserve_paige_voice_cost_internal(
  _actor_user_id uuid, _tenant_id uuid, _profile_revision text,
  _request_ref uuid, _character_count integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _platform public.paige_voice_platform_budget%ROWTYPE;
  _tenant public.paige_voice_tenant_budgets%ROWTYPE;
  _profile public.paige_voice_profiles%ROWTYPE;
  _existing public.paige_voice_cost_reservations%ROWTYPE;
  _budget_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  _tenant_limit numeric;
  _tenant_used numeric;
  _platform_used numeric;
  _reserve numeric;
  _id uuid;
  _is_operator boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_VOICE_COST_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id IS NULL OR _request_ref IS NULL
     OR _character_count IS NULL OR _character_count <= 0
     OR nullif(btrim(_profile_revision), '') IS NULL THEN
    RAISE EXCEPTION 'PAIGE_VOICE_COST_INVALID' USING ERRCODE = '22023';
  END IF;
  -- §9 unchanged: the caller must be an active member of the tenant it is spending against.
  _is_operator := _tenant_id IS NULL AND public.is_platform_admin(_actor_user_id);
  IF (_tenant_id IS NULL AND NOT _is_operator) OR (_tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id AND user_id = _actor_user_id AND status = 'active'
  )) THEN
    RAISE EXCEPTION 'PAIGE_VOICE_COST_SCOPE_MISMATCH' USING ERRCODE = '42501';
  END IF;

  -- Lock the singleton first and the tenant row second. Every request uses the same order,
  -- preventing oversubscription and lock inversion across tenants.
  SELECT * INTO _platform FROM public.paige_voice_platform_budget WHERE singleton = true FOR UPDATE;
  IF _platform.singleton IS NULL OR NOT _platform.enabled OR _platform.emergency_disabled
     OR _platform.monthly_limit_usd <= 0 OR _platform.max_usd_per_1000_chars <= 0 THEN
    RAISE EXCEPTION 'PAIGE_VOICE_BUDGET_DISABLED' USING ERRCODE = '55000';
  END IF;

  IF NOT _is_operator THEN
    SELECT * INTO _tenant FROM public.paige_voice_tenant_budgets
     WHERE tenant_id = _tenant_id FOR UPDATE;
    IF _tenant.tenant_id IS NULL THEN
      -- No row of its own: inherit the platform default so a new account simply works.
      _tenant_limit := _platform.default_tenant_monthly_limit_usd;
    ELSIF NOT _tenant.enabled THEN
      -- An explicit per-tenant switch-off is still honoured. That is an operator brake on a
      -- specific account, not a precondition every account must clear.
      RAISE EXCEPTION 'PAIGE_VOICE_TENANT_BUDGET_DISABLED' USING ERRCODE = '55000';
    ELSE
      _tenant_limit := _tenant.monthly_limit_usd;
    END IF;
    IF COALESCE(_tenant_limit, 0) <= 0 THEN
      RAISE EXCEPTION 'PAIGE_VOICE_TENANT_BUDGET_DISABLED' USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT * INTO _profile FROM public.paige_voice_profiles
   WHERE slot = 'active' AND revision = _profile_revision AND approved AND active;
  IF _profile.slot IS NULL OR _profile.provider NOT IN ('elevenlabs','openai') THEN
    RAISE EXCEPTION 'PAIGE_VOICE_PROFILE_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO _existing FROM public.paige_voice_cost_reservations WHERE request_ref = _request_ref;
  IF _existing.id IS NOT NULL THEN
    IF _existing.actor_user_id <> _actor_user_id
       OR _existing.tenant_id IS DISTINCT FROM _tenant_id
       OR _existing.profile_revision <> _profile_revision
       OR _existing.character_count <> _character_count
       OR _existing.provider <> _profile.provider
       OR _existing.budget_month <> _budget_month THEN
      RAISE EXCEPTION 'PAIGE_VOICE_COST_IDEMPOTENCY_MISMATCH' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('reservation_id', _existing.id, 'reserved_usd', _existing.reserved_usd,
      'provider', _existing.provider, 'budget_month', _existing.budget_month,
      'state', _existing.state, 'replayed', true);
  END IF;

  _reserve := (_character_count::numeric / 1000) * _platform.max_usd_per_1000_chars;

  -- Unique month buckets plus ON CONFLICT are the concurrency boundary: the conflict path observes
  -- and guards the latest concurrently committed tuple.
  IF NOT _is_operator THEN
    INSERT INTO public.paige_voice_tenant_monthly_usage(tenant_id, budget_month, reserved_usd)
    VALUES (_tenant_id, _budget_month, _reserve)
    ON CONFLICT (tenant_id, budget_month) DO UPDATE
      SET reserved_usd = public.paige_voice_tenant_monthly_usage.reserved_usd + EXCLUDED.reserved_usd
      WHERE public.paige_voice_tenant_monthly_usage.reserved_usd + EXCLUDED.reserved_usd <= _tenant_limit
    RETURNING reserved_usd INTO _tenant_used;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAIGE_VOICE_TENANT_COST_LIMIT' USING ERRCODE = '54000';
    END IF;
  END IF;

  INSERT INTO public.paige_voice_platform_monthly_usage(budget_month, reserved_usd)
  VALUES (_budget_month, _reserve)
  ON CONFLICT (budget_month) DO UPDATE
    SET reserved_usd = public.paige_voice_platform_monthly_usage.reserved_usd + EXCLUDED.reserved_usd
    WHERE public.paige_voice_platform_monthly_usage.reserved_usd + EXCLUDED.reserved_usd
          <= _platform.monthly_limit_usd
  RETURNING reserved_usd INTO _platform_used;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAIGE_VOICE_PLATFORM_COST_LIMIT' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.paige_voice_cost_reservations(
    request_ref, tenant_id, actor_user_id, profile_revision, provider,
    character_count, reserved_usd, rate_usd_per_1000_chars, budget_month, state
  ) VALUES (
    _request_ref, _tenant_id, _actor_user_id, _profile_revision, _profile.provider,
    _character_count, _reserve, _platform.max_usd_per_1000_chars, _budget_month, 'reserved'
  ) RETURNING id INTO _id;

  RETURN jsonb_build_object('reservation_id', _id, 'reserved_usd', _reserve,
    'provider', _profile.provider, 'budget_month', _budget_month,
    'state', 'reserved', 'replayed', false);
END; $$;
