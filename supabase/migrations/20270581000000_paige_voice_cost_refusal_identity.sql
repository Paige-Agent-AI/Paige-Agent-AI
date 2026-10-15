-- INT-321: a refused voice-cost reservation says WHICH limit refused it, and when it resets.
--
-- Defect reproduced on prod 2026-10-05: "Play message aloud" showed "Voice playback is temporarily
-- paused" for a workspace that had simply used its own $10 monthly allowance ($9.93 of $10) while
-- the platform was at $9.95 of $100. The reservation already raised a distinct identity for the
-- tenant cap ('PAIGE_VOICE_TENANT_COST_LIMIT') and the platform cap ('PAIGE_VOICE_PLATFORM_COST_LIMIT')
-- -- both SQLSTATE 54000 -- but it gave the caller no way to learn WHEN the month rolls over, and it
-- folded the operator's emergency brake into the same 'PAIGE_VOICE_BUDGET_DISABLED' as a missing or
-- zero-limit configuration.
--
-- WHAT CHANGES, and nothing else (diff this body against 20270424000000 section 5):
--   1. The tenant and platform cost-limit RAISEs carry USING DETAIL: a JSON object with the
--      canonical budget_month this function already computes and resets_at = the first instant of
--      the next UTC month. The reset is derived from the SAME _budget_month the cap is keyed on, so
--      the caller never has to guess it from its own clock. MESSAGE and ERRCODE are unchanged, so
--      every consumer matching on them (pgTAP throws_ok, the concurrency proof's
--      SQLSTATE||':'||SQLERRM) is unaffected.
--   2. The emergency brake raises its own identity, 'PAIGE_VOICE_EMERGENCY_DISABLED', same ERRCODE
--      55000, BEFORE the unchanged configuration check. A missing row, enabled=false, or a zero
--      limit/rate still raises 'PAIGE_VOICE_BUDGET_DISABLED' exactly as before.
--
-- WHAT DOES NOT CHANGE: signature, LANGUAGE/VOLATILE/SECURITY DEFINER/search_path, the
-- service_role-only caller check (§59), the tenant-membership scope check, lock order, idempotency
-- replay, the guarded ON CONFLICT month buckets, the reservation row, the return shape, and every
-- limit value. No budget is raised here: the $100 platform cap, the $10 default tenant allowance and
-- the $0.30/1,000-char reservation ceiling are untouched (the owner's separate $40 default ruling is
-- its own migration, 20270581010000). CREATE OR REPLACE keeps the existing
-- owner and grants (service_role EXECUTE only; PUBLIC/anon/authenticated revoked in 20270329000000);
-- the assertion at the end proves that on apply.
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
  _limit_detail text;
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
  -- INT-321: the operator's emergency brake is its own state, not "budget not configured".
  IF _platform.singleton IS NOT NULL AND _platform.emergency_disabled THEN
    RAISE EXCEPTION 'PAIGE_VOICE_EMERGENCY_DISABLED' USING ERRCODE = '55000';
  END IF;
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
  -- INT-321: both monthly caps reset at the first instant of the next UTC month of the SAME
  -- _budget_month they are keyed on. Carried as DETAIL so MESSAGE and ERRCODE stay unchanged.
  _limit_detail := jsonb_build_object(
    'budget_month', _budget_month,
    'resets_at', to_char((_budget_month + interval '1 month')::date, 'YYYY-MM-DD') || 'T00:00:00Z'
  )::text;

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
      RAISE EXCEPTION 'PAIGE_VOICE_TENANT_COST_LIMIT' USING ERRCODE = '54000', DETAIL = _limit_detail;
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
    RAISE EXCEPTION 'PAIGE_VOICE_PLATFORM_COST_LIMIT' USING ERRCODE = '54000', DETAIL = _limit_detail;
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

-- Grants survive CREATE OR REPLACE; prove it rather than assume it (§59: the in-body
-- service_role check is the guard, and the grant must still be service_role-only).
DO $$
DECLARE _fn text := 'public.reserve_paige_voice_cost_internal(uuid,uuid,text,uuid,integer)';
BEGIN
  IF has_function_privilege('anon', _fn, 'EXECUTE')
     OR has_function_privilege('authenticated', _fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', _fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'INT-321: reserve_paige_voice_cost_internal grants drifted';
  END IF;
  IF position('PAIGE_VOICE_EMERGENCY_DISABLED' IN pg_get_functiondef(_fn::regprocedure)) = 0
     OR position('FOR UPDATE' IN pg_get_functiondef(_fn::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'INT-321: reserve_paige_voice_cost_internal body did not apply';
  END IF;
  -- §59: a SECURITY DEFINER function without a pinned search_path can be steered by a caller's
  -- schema objects. CREATE OR REPLACE rewrites both attributes, so prove they survived.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = _fn::regprocedure
       AND prosecdef
       AND proconfig @> ARRAY['search_path=public']::text[]
  ) THEN
    RAISE EXCEPTION 'INT-321: reserve_paige_voice_cost_internal lost SECURITY DEFINER or search_path=public';
  END IF;
END $$;
