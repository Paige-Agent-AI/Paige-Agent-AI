-- EXP00 live-incident fix (2026-10-18, GitHub #2329 / ANT-158):
-- the deployed solo_beta_fulfill_checkout raised
--   column reference "reference_id" is ambiguous
-- on its FIRST-EVER real execution because the RETURNS TABLE output parameter
-- `reference_id` collides with the unqualified `RETURNING reference_id` in the
-- enrollment update (plpgsql variable-conflict error). The original
-- 20270118010000 version had the qualified form; the 20270118040000 rewrite
-- dropped the qualification and 20270129000000 carried it forward — never
-- executed until the first real Solo Beta checkout. Body below is the deployed
-- function verbatim with exactly that one reference qualified.
CREATE OR REPLACE FUNCTION public.solo_beta_fulfill_checkout(
  _event_id text,_user_id uuid,_attempt integer,_fencing_token uuid,
  _customer_id text,_subscription_id text,_session_id text,_product_id text,_price_id text,
  _livemode boolean,_unit_amount integer,_currency text,_interval text,_interval_count integer,
  _subscription_status text,_period_start timestamptz,_period_end timestamptz,
  _trial_start timestamptz,_trial_end timestamptz,_cancel_at_period_end boolean
) RETURNS TABLE(tenant_id uuid,account_number bigint,subscription_id uuid,reference_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _offer public.platform_subscription_offers; _intake public.signup_intake;
  _tenant public.tenants; _sub public.platform_subscriptions;
  _enrollment public.solo_beta_enrollments; _event public.stripe_event_log;
  _ref uuid; _agreement_version integer; _agreement_count integer;
BEGIN
  SELECT * INTO _offer FROM public.platform_subscription_offers
  WHERE offer_code='paige-solo-beta-monthly-v1' FOR UPDATE;
  IF NOT FOUND OR _offer.status<>'live_ready' OR _offer.provider_mode<>'live'
    OR _livemode IS DISTINCT FROM true OR _product_id IS DISTINCT FROM _offer.stripe_product_id
    OR _price_id IS DISTINCT FROM _offer.stripe_price_id OR _unit_amount IS DISTINCT FROM 7450 OR lower(_currency) IS DISTINCT FROM 'usd'
    OR _interval IS DISTINCT FROM 'month' OR _interval_count IS DISTINCT FROM 1
    OR _offer.trial_days IS DISTINCT FROM 30 OR _trial_start IS NULL OR _trial_end IS NULL
    OR (_trial_end-_trial_start) IS DISTINCT FROM interval '30 days'
    OR _subscription_status NOT IN ('trialing','active') THEN
    RAISE EXCEPTION 'solo_beta_provider_contract_mismatch';
  END IF;

  SELECT * INTO _event FROM public.stripe_event_log WHERE event_id=_event_id FOR UPDATE;
  IF NOT FOUND OR _event.lifecycle_state<>'processing'
    OR _event.type<>'checkout.session.completed' OR _event.livemode IS DISTINCT FROM true
    OR _event.owner_user_id IS DISTINCT FROM _user_id
    OR _event.checkout_session_id IS DISTINCT FROM _session_id
    OR _event.stripe_subscription_id IS DISTINCT FROM _subscription_id
    OR _event.stripe_customer_id IS DISTINCT FROM _customer_id THEN
    RAISE EXCEPTION 'solo_beta_event_identity_mismatch';
  END IF;

  SELECT * INTO _enrollment FROM public.solo_beta_enrollments WHERE user_id=_user_id FOR UPDATE;
  IF NOT FOUND OR _enrollment.offer_code<>'paige-solo-beta-monthly-v1'
    OR _enrollment.checkout_attempt<>_attempt
    OR _enrollment.checkout_fencing_token IS DISTINCT FROM _fencing_token
    OR _enrollment.checkout_session_id IS DISTINCT FROM _session_id
    OR _enrollment.stripe_customer_id IS DISTINCT FROM _customer_id
    OR _enrollment.state NOT IN ('checkout_open','verification_pending','fulfilled') THEN
    RAISE EXCEPTION 'solo_beta_checkout_fence_lost';
  END IF;

  SELECT * INTO _intake FROM public.signup_intake WHERE user_id=_user_id FOR UPDATE;
  SELECT count(*)::integer,min(d.version) INTO _agreement_count,_agreement_version
  FROM public.legal_documents d WHERE d.slug='saas-standalone' AND d.is_current=true;
  IF _intake.user_id IS NULL OR _agreement_count IS DISTINCT FROM 1 OR _agreement_version IS NULL
    OR _intake.plan_slug IS DISTINCT FROM 'solo'
    OR _intake.billing_period IS DISTINCT FROM 'monthly'
    OR _intake.account_type IS DISTINCT FROM 'standalone' OR _intake.terms_accepted_at IS NULL
    OR _intake.agreement_slug IS DISTINCT FROM 'saas-standalone'
    OR _intake.agreement_version IS DISTINCT FROM _agreement_version
    OR NOT EXISTS (
      SELECT 1 FROM public.legal_acceptances a
      WHERE a.user_id=_user_id AND a.document_slug='saas-standalone'
        AND a.document_version=_agreement_version
    ) THEN RAISE EXCEPTION 'solo_beta_agreement_unpersisted';
  END IF;

  SELECT * INTO _sub FROM public.platform_subscriptions
  WHERE stripe_subscription_id=_subscription_id FOR UPDATE;
  IF FOUND THEN
    IF _sub.offer_code<>'paige-solo-beta-monthly-v1'
      OR _sub.stripe_customer_id IS DISTINCT FROM _customer_id
      OR _enrollment.stripe_subscription_id IS DISTINCT FROM _subscription_id
      OR _enrollment.tenant_id IS DISTINCT FROM _sub.tenant_id
      OR NOT EXISTS (
        SELECT 1 FROM public.tenants t JOIN public.tenant_members m ON m.tenant_id=t.id
        WHERE t.id=_sub.tenant_id AND t.owner_user_id=_user_id AND t.account_type='standalone'
          AND t.parent_tenant_id IS NULL AND m.user_id=_user_id AND m.status='active' AND m.is_owner
      ) OR NOT EXISTS (
        SELECT 1 FROM public.platform_billing_accounts b
        WHERE b.tenant_id=_sub.tenant_id AND b.stripe_customer_id=_customer_id AND b.stripe_account='legacy'
      ) THEN RAISE EXCEPTION 'solo_beta_subscription_collision'; END IF;
    SELECT r.reference_id INTO _ref FROM public.solo_beta_fulfillment_receipts r
    WHERE r.subscription_id=_sub.id;
    IF _ref IS NULL THEN RAISE EXCEPTION 'solo_beta_receipt_missing'; END IF;
    UPDATE public.stripe_event_log SET lifecycle_state='completed',processed_at=now(),completed_at=now()
    WHERE event_id=_event_id AND lifecycle_state='processing';
    RETURN QUERY SELECT t.id,t.account_number,_sub.id,_ref FROM public.tenants t WHERE t.id=_sub.tenant_id;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE owner_user_id=_user_id AND parent_tenant_id IS NULL) THEN
    RAISE EXCEPTION 'solo_beta_existing_account_requires_owner_review';
  END IF;
  SELECT * INTO _tenant FROM public.provision_tenant_as(
    _user_id,_intake.business_name,'standalone',_intake.industry,_intake.team_size,
    _intake.who_you_help,'saas-standalone',_agreement_version
  );
  IF _tenant.owner_user_id<>_user_id OR _tenant.parent_tenant_id IS NOT NULL OR _tenant.account_type<>'standalone'
    OR NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant.id
      AND m.user_id=_user_id AND m.status='active' AND m.is_owner) THEN
    RAISE EXCEPTION 'solo_beta_tenant_invariant_failed';
  END IF;

  -- Server-authored marker activates the Beta-specific shell gate. Existing
  -- tenants have no marker and preserve their established access path.
  UPDATE public.tenants
  SET features = coalesce(features, '{}'::jsonb)
    || jsonb_build_object('solo_beta_offer_code', 'paige-solo-beta-monthly-v1')
  WHERE id = _tenant.id;

  INSERT INTO public.platform_billing_accounts(tenant_id,stripe_customer_id,stripe_account,source,created_by)
  VALUES (_tenant.id,_customer_id,'legacy','checkout',_user_id);
  INSERT INTO public.platform_subscriptions(
    tenant_id,plan_id,status,billing_period,current_period_start,current_period_end,
    trial_started_at,trial_ends_at,
    stripe_subscription_id,stripe_customer_id,cancel_at_period_end,metadata,offer_code,
    provider_mode,stripe_product_id,stripe_price_id,provider_verified_at,
    provider_event_created_at,provider_event_precedence
  ) VALUES (
    _tenant.id,_offer.plan_id,_subscription_status,'monthly',_period_start,_period_end,
    _trial_start,_trial_end,
    _subscription_id,_customer_id,coalesce(_cancel_at_period_end,false),
    jsonb_build_object('offer_code',_offer.offer_code,'provider_mode','live'),
    _offer.offer_code,'live',_product_id,_price_id,now(),_event.provider_created_at,10
  ) RETURNING * INTO _sub;

  UPDATE public.user_subscriptions SET plan_slug='solo',status=_subscription_status,trial_ends_at=_trial_end,
    current_period_start=_period_start,current_period_end=_period_end,
    stripe_subscription_id=_subscription_id,updated_at=now() WHERE user_id=_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.user_subscriptions(user_id,plan_slug,status,trial_ends_at,current_period_start,current_period_end,stripe_subscription_id)
    VALUES (_user_id,'solo',_subscription_status,_trial_end,_period_start,_period_end,_subscription_id);
  END IF;
  UPDATE public.signup_intake SET consumed_at=coalesce(consumed_at,now()) WHERE user_id=_user_id;
  UPDATE public.solo_beta_enrollments
  SET state='fulfilled',stripe_subscription_id=_subscription_id,tenant_id=_tenant.id,
      last_error_code=NULL,updated_at=now()
  WHERE user_id=_user_id AND checkout_attempt=_attempt AND checkout_fencing_token=_fencing_token
  RETURNING solo_beta_enrollments.reference_id INTO _ref;
  IF _ref IS NULL THEN RAISE EXCEPTION 'solo_beta_checkout_fence_lost'; END IF;

  INSERT INTO public.solo_beta_fulfillment_receipts(event_id,user_id,tenant_id,subscription_id,offer_code,outcome,reference_id)
  VALUES (_event_id,_user_id,_tenant.id,_sub.id,_offer.offer_code,'completed',_ref);
  INSERT INTO public.platform_usage_events(tenant_id,event_type,quantity,metadata)
  VALUES (_tenant.id,'solo_beta_fulfilled',1,jsonb_build_object(
    'event_id',_event_id,'reference_id',_ref,'offer_code',_offer.offer_code,'provider_mode','live'));
  UPDATE public.stripe_event_log
  SET lifecycle_state='completed',processed_at=now(),completed_at=now(),last_error_code=NULL
  WHERE event_id=_event_id AND lifecycle_state='processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'solo_beta_event_not_processing'; END IF;
  RETURN QUERY SELECT _tenant.id,_tenant.account_number,_sub.id,_ref;
END $$;
REVOKE ALL ON FUNCTION public.solo_beta_fulfill_checkout(text,uuid,integer,uuid,text,text,text,text,text,boolean,integer,text,text,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.solo_beta_fulfill_checkout(text,uuid,integer,uuid,text,text,text,text,text,boolean,integer,text,text,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)

REVOKE ALL ON FUNCTION public.solo_beta_fulfill_checkout(text,uuid,integer,uuid,text,text,text,text,text,boolean,integer,text,text,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solo_beta_fulfill_checkout(text,uuid,integer,uuid,text,text,text,text,text,boolean,integer,text,text,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean) TO service_role;
