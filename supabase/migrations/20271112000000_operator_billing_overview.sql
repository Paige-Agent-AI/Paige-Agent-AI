-- =============================================================================
-- EXP00 O-2 — Platform Operator billing overview (read-only, L1 only).
--
-- The company's own commercial truth in ONE authorized projection: subscription
-- states with trial-vs-paid distinction, real collected cash from paid invoices
-- (NEVER from trial subscriptions — §13/L1-L2 doctrine), failed/open receivables,
-- upcoming renewals, the billing account's payment-method facts, and the invoice
-- list with hosted links. NO new money machinery: this reads what the Stripe
-- webhook chain already wrote. Every action (refund, cancel, plan change) stays
-- owner-held in Stripe — this surface performs none of them.
--
-- Gate: is_platform_admin() on auth.uid() — same as O-1's commercial RPCs.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.operator_billing_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin boolean;
BEGIN
  SELECT public.is_platform_admin(auth.uid()) INTO v_admin;
  IF NOT COALESCE(v_admin, false) THEN
    RAISE EXCEPTION 'operator_billing_overview: platform administrator required'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'subscriptions_total', (SELECT count(*) FROM public.platform_subscriptions),
      'trialing', (SELECT count(*) FROM public.platform_subscriptions WHERE status = 'trialing'),
      'active_paid', (SELECT count(*) FROM public.platform_subscriptions
                       WHERE status = 'active' AND stripe_subscription_id IS NOT NULL),
      'past_due', (SELECT count(*) FROM public.platform_subscriptions WHERE status = 'past_due'),
      'canceled', (SELECT count(*) FROM public.platform_subscriptions WHERE status = 'canceled'),
      -- Real ARR: ONLY live Stripe-backed active subs (a comped row with a NULL
      -- stripe id is not revenue) — the same criterion the owner-context ARR
      -- block and the revenue-integrity chain enforce.
      'arr_cents', COALESCE((
        SELECT sum(CASE s.billing_period
                     WHEN 'annual' THEN COALESCE(NULLIF(p.annual_price_cents, 0), p.monthly_price_cents * 12)
                     ELSE p.monthly_price_cents * 12
                   END)
        FROM public.platform_subscriptions s
        JOIN public.platform_subscription_plans p ON p.id = s.plan_id
        WHERE s.status = 'active' AND s.stripe_subscription_id IS NOT NULL
      ), 0),
      -- Collected cash: PAID invoices only. A trialing subscription is contracted
      -- intent, never collected revenue.
      'collected_cash_cents', COALESCE((
        SELECT sum(total_cents) FROM public.platform_invoices
        WHERE status = 'paid' AND paid_at IS NOT NULL
      ), 0),
      -- Collectible receivables only; written-off (uncollectible) amounts stay
      -- in the attention COUNT below, never overstated as collectible money.
      'open_receivables_cents', COALESCE((
        SELECT sum(total_cents) FROM public.platform_invoices
        WHERE status IN ('open', 'past_due')
      ), 0),
      'failed_or_open_invoices', (SELECT count(*) FROM public.platform_invoices
                                  WHERE status IN ('open', 'past_due', 'uncollectible')),
      'upcoming_renewals_30d', (SELECT count(*) FROM public.platform_subscriptions
                                 WHERE status IN ('active', 'trialing')
                                   AND cancel_at_period_end = false
                                   AND current_period_end BETWEEN now() AND now() + interval '30 days'),
      'billing_accounts', (SELECT count(*) FROM public.platform_billing_accounts)
    ),
    'subscriptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', s.tenant_id,
        'tenant_name', t.name,
        'plan_name', p.name,
        'plan_slug', p.slug,
        'status', s.status,
        'billing_period', s.billing_period,
        'monthly_cents', p.monthly_price_cents,
        'annual_cents', p.annual_price_cents,
        'trial_started_at', s.trial_started_at,
        'trial_ends_at', s.trial_ends_at,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end,
        'stripe_subscription_id', s.stripe_subscription_id,
        'provider_mode', s.provider_mode,
        'offer_code', s.offer_code,
        'is_paid', (s.stripe_subscription_id IS NOT NULL AND s.status = 'active')
      ) ORDER BY s.created_at DESC)
      FROM public.platform_subscriptions s
      LEFT JOIN public.tenants t ON t.id = s.tenant_id
      LEFT JOIN public.platform_subscription_plans p ON p.id = s.plan_id
    ), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'invoice_number', i.invoice_number,
        'tenant_name', t.name,
        'status', i.status,
        'total_cents', i.total_cents,
        'currency', i.currency,
        'period_start', i.period_start,
        'period_end', i.period_end,
        'paid_at', i.paid_at,
        'hosted_invoice_url', i.hosted_invoice_url
      ) ORDER BY COALESCE(i.paid_at, i.created_at) DESC)
      FROM public.platform_invoices i
      LEFT JOIN public.tenants t ON t.id = i.tenant_id
    ), '[]'::jsonb),
    'billing_accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', a.tenant_id,
        'tenant_name', t.name,
        'stripe_customer_id', a.stripe_customer_id,
        'payment_method_brand', a.payment_method_brand,
        'payment_method_last4', a.payment_method_last4,
        'payment_method_exp_month', a.payment_method_exp_month,
        'payment_method_exp_year', a.payment_method_exp_year,
        'payment_method_connected_at', a.payment_method_connected_at
      ) ORDER BY a.created_at DESC)
      FROM public.platform_billing_accounts a
      LEFT JOIN public.tenants t ON t.id = a.tenant_id
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.operator_billing_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operator_billing_overview() TO authenticated;

COMMENT ON FUNCTION public.operator_billing_overview() IS
  'EXP00 O-2: read-only L1 billing overview for platform admins — subscriptions with trial-vs-paid truth, collected cash from PAID invoices only, receivables, renewals, billing accounts. Performs no money action.';
