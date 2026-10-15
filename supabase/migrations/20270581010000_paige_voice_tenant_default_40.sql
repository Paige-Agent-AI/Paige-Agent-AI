-- Owner ruling (Antonio, 2026-10-05): every Solo workspace's monthly message-playback allowance is
-- $40. "Move every Solo to the 40 dollar limit." · "If you do it to mine, do it to every last one of
-- them." · "I do not want anything done specific to mine."
--
-- This is POLICY, recorded alongside INT-321 but separate from its defect fix (20270581000000, which
-- changes no limit). Production already holds default_tenant_monthly_limit_usd = 40 (written by
-- service SQL with audit rows); this migration makes the repo agree with prod so a fresh environment,
-- a branch project, or a rebuild lands on the same value.
--
-- WHAT CHANGES, and nothing else:
--   1. The platform default allowance a workspace inherits when it has no budget row of its own is
--      raised to $40 where it is below $40. GREATEST() makes it idempotent and it never lowers a
--      higher value. monthly_limit_usd (the $100 platform cap), max_usd_per_1000_chars, enabled and
--      emergency_disabled are NOT touched.
--   2. A per-workspace override that merely repeats the default (enabled AND monthly_limit_usd =
--      the default) is removed, so that workspace inherits the default like every other one and a
--      future change to the default reaches it too. Generic by construction — no workspace is named
--      (§63). An override that DIFFERS from the default, or an explicit switch-off (enabled=false),
--      is a deliberate per-workspace decision and is kept.
--   3. Each change writes a paige_audit_log row attributed to this migration (no human actor), and
--      a closing assertion proves the end state.
DO $$
DECLARE
  _before numeric;
  _after numeric;
  _removed uuid[];
BEGIN
  SELECT default_tenant_monthly_limit_usd INTO _before
    FROM public.paige_voice_platform_budget WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paige_voice_tenant_default_40: platform budget singleton is missing';
  END IF;

  UPDATE public.paige_voice_platform_budget
     SET default_tenant_monthly_limit_usd = GREATEST(default_tenant_monthly_limit_usd, 40)
   WHERE singleton = true AND default_tenant_monthly_limit_usd < 40
  RETURNING default_tenant_monthly_limit_usd INTO _after;

  IF _after IS NOT NULL THEN
    INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, payload)
    VALUES (NULL, 'migration', 'voice.budget.platform.default_tenant_limit',
            'paige_voice_platform_budget',
            jsonb_build_object('migration', '20270581010000', 'ruling', 'owner 2026-10-05: every Solo at $40',
                               'default_tenant_monthly_limit_usd_before', _before,
                               'default_tenant_monthly_limit_usd_after', _after));
  END IF;

  WITH removed AS (
    DELETE FROM public.paige_voice_tenant_budgets t
     USING public.paige_voice_platform_budget p
     WHERE p.singleton = true
       AND t.enabled
       AND t.monthly_limit_usd = p.default_tenant_monthly_limit_usd
    RETURNING t.tenant_id, t.monthly_limit_usd
  ), audited AS (
    INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
    SELECT NULL, 'migration', 'voice.budget.tenant.override_removed', 'paige_voice_tenant_budgets',
           r.tenant_id, r.tenant_id,
           jsonb_build_object('migration', '20270581010000',
                              'reason', 'override repeated the platform default; workspace now inherits it',
                              'monthly_limit_usd', r.monthly_limit_usd)
      FROM removed r
    RETURNING target_id
  )
  SELECT coalesce(array_agg(target_id), '{}') INTO _removed FROM audited;

  RAISE NOTICE 'paige_voice_tenant_default_40: default % -> %, redundant overrides removed: %',
    _before, coalesce(_after, _before), coalesce(array_length(_removed, 1), 0);
END $$;

-- Prove the end state rather than assume it.
DO $$
DECLARE _p public.paige_voice_platform_budget%ROWTYPE;
BEGIN
  SELECT * INTO _p FROM public.paige_voice_platform_budget WHERE singleton = true;
  IF _p.singleton IS NULL OR _p.default_tenant_monthly_limit_usd < 40 THEN
    RAISE EXCEPTION 'paige_voice_tenant_default_40: default tenant allowance is below $40';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.paige_voice_tenant_budgets
     WHERE enabled AND monthly_limit_usd = _p.default_tenant_monthly_limit_usd
  ) THEN
    RAISE EXCEPTION 'paige_voice_tenant_default_40: an override that repeats the default remains';
  END IF;
END $$;
