-- =============================================================================
-- EXP00 O-4 + O-5 — customer activation timeline + lifecycle recovery signals.
--
-- Extends operator_customer_history (O-1) with two sections, both READ-ONLY and
-- truthful by construction:
--
--   activation — a timeline of REAL first-value events, each with its own
--     timestamp from the canonical record that produced it. A stage that has
--     no record simply does not appear. No engagement scores, no invented
--     completion, no churn prediction (ALG-02/ALG-04 discipline: observed
--     facts only).
--
--   recovery — the genuine lifecycle-exception detectors (O-5): the stranded
--     signup (subscription exists in Stripe but provisioning never fulfilled —
--     the exact class of the 2026-10-18 live incident), welcome-email
--     attention states, and uncompleted webhook events with recorded errors.
--     Recovery ACTIONS remain owner-held (Stripe resend / the documented
--     re-arm path); this RPC performs and authorizes none.
--
-- The function body is O-1's deployed body verbatim, with the two sections
-- appended before the closing paren.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.operator_customer_history(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_timeline jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.solo_beta_enrollments WHERE user_id = p_user_id;

  -- ── activation: only stages whose canonical record exists ──
  SELECT jsonb_agg(stage ORDER BY (stage->>'at')) INTO v_timeline
  FROM (
    SELECT jsonb_build_object('stage', 'enrolled', 'at', e.created_at,
      'detail', 'Solo Beta enrollment created') AS stage
    FROM public.solo_beta_enrollments e WHERE e.user_id = p_user_id AND e.created_at IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('stage', 'checkout_claimed', 'at', e.checkout_claimed_at,
      'detail', 'Checkout claimed (payment completed)') AS stage
    FROM public.solo_beta_enrollments e WHERE e.user_id = p_user_id AND e.checkout_claimed_at IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('stage', 'subscription_created', 'at', ps.created_at,
      'detail', 'Live Stripe subscription recorded') AS stage
    FROM public.platform_subscriptions ps
    WHERE ps.tenant_id = v_tenant AND ps.provider_mode = 'live' AND ps.created_at IS NOT NULL
      AND ps.stripe_subscription_id = (SELECT stripe_subscription_id FROM public.solo_beta_enrollments WHERE user_id = p_user_id)
    UNION ALL
    SELECT jsonb_build_object('stage', 'workspace_provisioned', 'at', t.created_at,
      'detail', concat_ws(' ', 'Workspace', t.account_number::text, 'provisioned')) AS stage
    FROM public.tenants t WHERE t.id = v_tenant AND t.created_at IS NOT NULL
    UNION ALL
    (SELECT jsonb_build_object('stage', 'meet_paige_started', 'at', th.created_at,
      'detail', 'First conversation opened') AS stage
    FROM public.paige_chat_threads th
    WHERE th.tenant_id = v_tenant
    ORDER BY th.created_at ASC LIMIT 1)
    UNION ALL
    (SELECT jsonb_build_object('stage', 'first_governed_action', 'at', a.executed_at,
      'detail', 'Governed action executed: ' || coalesce(a.action_kind, 'unknown')) AS stage
    FROM public.paige_actions a
    WHERE a.tenant_id = v_tenant AND a.executed_at IS NOT NULL
    ORDER BY a.executed_at ASC LIMIT 1)
    UNION ALL
    SELECT jsonb_build_object('stage', 'welcome_email_sent', 'at', w.sent_at,
      'detail', 'Welcome email accepted by provider') AS stage
    FROM public.solo_beta_welcome_deliveries w WHERE w.user_id = p_user_id AND w.sent_at IS NOT NULL
  ) stages;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'enrollment', (
      SELECT jsonb_build_object(
        'state', e.state, 'reference_id', e.reference_id,
        'checkout_session', e.checkout_session_id,
        'stripe_subscription', e.stripe_subscription_id,
        'stripe_customer', e.stripe_customer_id,
        'tenant_id', e.tenant_id, 'enrolled_at', e.checkout_claimed_at
      )
      FROM public.solo_beta_enrollments e WHERE e.user_id = p_user_id
    ),
    'intake', (
      SELECT jsonb_build_object(
        'business_name', si.business_name, 'industry', si.industry,
        'team_size', si.team_size, 'plan_slug', si.plan_slug,
        'agreement_version', si.agreement_version,
        'terms_accepted_at', si.terms_accepted_at
      )
      FROM public.signup_intake si WHERE si.user_id = p_user_id
    ),
    'subscription', (
      SELECT jsonb_build_object(
        'status', ps.status, 'provider_mode', ps.provider_mode,
        'trial_started_at', ps.trial_started_at, 'trial_ends_at', ps.trial_ends_at,
        'current_period_end', ps.current_period_end,
        'cancel_at_period_end', ps.cancel_at_period_end,
        'stripe_subscription_id', ps.stripe_subscription_id
      )
      FROM public.platform_subscriptions ps
      WHERE ps.tenant_id = (SELECT tenant_id FROM public.solo_beta_enrollments WHERE user_id = p_user_id)
        AND ps.provider_mode = 'live'
        AND ps.stripe_subscription_id = (SELECT stripe_subscription_id FROM public.solo_beta_enrollments WHERE user_id = p_user_id)
      LIMIT 1
    ),
    'workspace', (
      SELECT jsonb_build_object(
        'account_number', t.account_number, 'name', t.name,
        'account_type', t.account_type, 'status', t.status,
        'beta_entitled', t.features->>'solo_beta_offer_code' = 'paige-solo-beta-monthly-v1'
      )
      FROM public.tenants t
      WHERE t.id = (SELECT tenant_id FROM public.solo_beta_enrollments WHERE user_id = p_user_id)
    ),
    'welcome', (
      SELECT jsonb_build_object(
        'state', w.state, 'attempts', w.attempt_count,
        'last_error', w.last_error_code,
        'provider_message_id', w.provider_message_id,
        'first_attempt_at', w.first_attempt_at,
        'sent_at', w.sent_at
      )
      FROM public.solo_beta_welcome_deliveries w WHERE w.user_id = p_user_id
    ),
    'webhook_events', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type', l.type, 'state', l.lifecycle_state,
        'attempts', l.attempt_count, 'error', l.last_error_code,
        'received_at', l.received_at, 'completed_at', l.completed_at
      ) ORDER BY l.received_at), '[]'::jsonb)
      FROM public.stripe_event_log l WHERE l.owner_user_id = p_user_id
    ),
    'fulfillment_receipts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'event_id', r.event_id, 'outcome', r.outcome,
        'reference_id', r.reference_id
      )), '[]'::jsonb)
      FROM public.solo_beta_fulfillment_receipts r WHERE r.user_id = p_user_id
    ),
    -- ── O-4: observed activation timeline (no invented stages) ──
    'activation', COALESCE(v_timeline, '[]'::jsonb),
    'activation_summary', jsonb_build_object(
      'stages_observed', jsonb_array_length(COALESCE(v_timeline, '[]'::jsonb)),
      'last_activity_at', (
        SELECT max(th.last_message_at) FROM public.paige_chat_threads th WHERE th.tenant_id = v_tenant
      ),
      'chat_threads', (
        SELECT count(*) FROM public.paige_chat_threads th WHERE th.tenant_id = v_tenant
      )
    ),
    -- ── O-5: lifecycle-exception detectors (reads only; actions stay owner-held) ──
    'recovery', jsonb_build_object(
      'stranded_signup', EXISTS (
        SELECT 1 FROM public.solo_beta_enrollments e
        WHERE e.user_id = p_user_id
          AND e.state <> 'fulfilled'
          AND e.stripe_subscription_id IS NOT NULL
      ),
      'welcome_attention', EXISTS (
        SELECT 1 FROM public.solo_beta_welcome_deliveries w
        WHERE w.user_id = p_user_id
          AND w.state IN ('needs_attention', 'retryable_failure')
      ),
      'welcome_last_error', (
        SELECT w.last_error_code FROM public.solo_beta_welcome_deliveries w WHERE w.user_id = p_user_id
      ),
      'welcome_attempts', (
        SELECT w.attempt_count FROM public.solo_beta_welcome_deliveries w WHERE w.user_id = p_user_id
      ),
      'uncompleted_webhook_events', (
        SELECT count(*) FROM public.stripe_event_log l
        WHERE l.owner_user_id = p_user_id
          AND l.completed_at IS NULL
          AND l.last_error_code IS NOT NULL
      ),
      'enrollment_last_error', (
        SELECT e.last_error_code FROM public.solo_beta_enrollments e WHERE e.user_id = p_user_id
      )
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.operator_customer_history(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operator_customer_history(uuid) TO authenticated;

COMMENT ON FUNCTION public.operator_customer_history(uuid) IS
  'EXP00 O-1 + O-4 + O-5: platform-admin customer drill-down — lifecycle records, observed activation timeline (no invented stages), and recovery detectors (stranded signup, welcome attention, uncompleted webhooks). Performs no action.';
