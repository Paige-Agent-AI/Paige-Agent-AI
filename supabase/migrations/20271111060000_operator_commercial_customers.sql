-- EXP00 O-1: Platform Operator Customers desk — canonical L1 commercial read.
-- One row per Solo Beta customer enrollment, projecting the authoritative
-- records the Operator already owns: enrollment, subscription, tenant,
-- membership, welcome outbox, and fulfillment receipts. No new store, no
-- tenant-private data, no L2 business content. Platform-admin gated.
--
-- Sources (all existing): solo_beta_enrollments, platform_subscriptions,
-- tenants, tenant_members, solo_beta_welcome_deliveries,
-- signup_intake, stripe_event_log.

CREATE OR REPLACE FUNCTION public.operator_commercial_customers()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'customers', (
      SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'enrolled_at') DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'user_id', e.user_id,
          'business_name', COALESCE(si.business_name, t.name),
          'account_number', t.account_number,
          'tenant_id', e.tenant_id,
          'enrollment_state', e.state,
          'enrolled_at', e.checkout_claimed_at,
          'reference_id', e.reference_id,
          'subscription_status', ps.status,
          'provider_mode', ps.provider_mode,
          'trial_ends_at', ps.trial_ends_at,
          'current_period_end', ps.current_period_end,
          'cancel_at_period_end', ps.cancel_at_period_end,
          'offer_code', ps.offer_code,
          'welcome_state', wd.state,
          'welcome_attempts', wd.attempt_count,
          'welcome_last_error', wd.last_error_code,
          'workspace_provisioned', e.tenant_id IS NOT NULL,
          'owner_membership_active', om.active_count > 0,
          'last_event_state', sel.lifecycle_state,
          'last_event_error', sel.last_error_code
        ) AS row
        FROM public.solo_beta_enrollments e
        LEFT JOIN public.platform_subscriptions ps
          ON ps.tenant_id = e.tenant_id
         AND ps.stripe_subscription_id = e.stripe_subscription_id
        LEFT JOIN public.tenants t ON t.id = e.tenant_id
        LEFT JOIN public.signup_intake si ON si.user_id = e.user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_count
          FROM public.tenant_members m
          WHERE m.tenant_id = e.tenant_id
            AND m.user_id = e.user_id
            AND m.status = 'active' AND m.is_owner
        ) om ON true
        LEFT JOIN LATERAL (
          SELECT state, attempt_count, last_error_code
          FROM public.solo_beta_welcome_deliveries w
          WHERE w.user_id = e.user_id
          ORDER BY w.first_attempt_at DESC LIMIT 1
        ) wd ON true
        LEFT JOIN LATERAL (
          SELECT lifecycle_state, last_error_code
          FROM public.stripe_event_log l
          WHERE l.type = 'checkout.session.completed'
            AND l.owner_user_id = e.user_id
          ORDER BY l.received_at DESC LIMIT 1
        ) sel ON true
      ) sub
    ),
    'summary', jsonb_build_object(
      'total_enrollments', (SELECT COUNT(*) FROM public.solo_beta_enrollments),
      'fulfilled', (SELECT COUNT(*) FROM public.solo_beta_enrollments WHERE state = 'fulfilled'),
      'pending', (SELECT COUNT(*) FROM public.solo_beta_enrollments WHERE state IN ('checkout_open','verification_pending')),
      'active_trials', (SELECT COUNT(*) FROM public.platform_subscriptions WHERE status = 'trialing' AND provider_mode = 'live'),
      'active_paid', (SELECT COUNT(*) FROM public.platform_subscriptions WHERE status = 'active' AND provider_mode = 'live'),
      'welcomes_sent', (SELECT COUNT(*) FROM public.solo_beta_welcome_deliveries WHERE state = 'sent'),
      'welcomes_needing_attention', (SELECT COUNT(*) FROM public.solo_beta_welcome_deliveries WHERE state = 'needs_attention'),
      'welcomes_retrying', (SELECT COUNT(*) FROM public.solo_beta_welcome_deliveries WHERE state = 'retryable_failure'),
      'collected_cents', 0  -- L1 truth: $0 until Stripe confirms a real collection
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.operator_commercial_customers() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operator_commercial_customers() TO authenticated;

-- Individual customer drill-down: full lifecycle history from canonical records.
CREATE OR REPLACE FUNCTION public.operator_customer_history(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501';
  END IF;

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
        'first_attempt_at', w.first_attempt_at
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
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.operator_customer_history(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operator_customer_history(uuid) TO authenticated;
