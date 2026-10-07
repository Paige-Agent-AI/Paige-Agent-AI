-- Canonical merchant reservation only. No charge, financial-ledger or Billing changes.
BEGIN;
ALTER TABLE public.tenant_stripe_accounts ALTER COLUMN stripe_account_id DROP NOT NULL;
ALTER TABLE public.tenant_stripe_accounts ADD COLUMN IF NOT EXISTS onboarding_id uuid, ADD COLUMN IF NOT EXISTS onboarding_started_at timestamptz, ADD COLUMN IF NOT EXISTS onboarding_claim uuid;
ALTER TABLE public.tenant_stripe_accounts DROP CONSTRAINT IF EXISTS sales_onboarding_pending;
ALTER TABLE public.tenant_stripe_accounts ADD CONSTRAINT sales_onboarding_pending CHECK(stripe_account_id IS NOT NULL OR (onboarding_id IS NOT NULL AND onboarding_started_at IS NOT NULL AND onboarding_claim IS NOT NULL AND provider_environment IS NOT NULL AND provider_environment IN ('test','live')));
CREATE UNIQUE INDEX IF NOT EXISTS sales_merchant_onboarding_identity ON public.tenant_stripe_accounts(onboarding_id) WHERE onboarding_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sales_stripe_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR (NEW.onboarding_id,NEW.onboarding_started_at,NEW.onboarding_claim) IS DISTINCT FROM (OLD.onboarding_id,OLD.onboarding_started_at,OLD.onboarding_claim)) THEN
  RAISE EXCEPTION 'Merchant reservation identity is immutable' USING ERRCODE='22023'; END IF;
 IF NEW.provider_environment IS NOT NULL AND NEW.provider_environment NOT IN ('test','live') THEN RAISE EXCEPTION 'Invalid provider environment' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND OLD.onboarding_id IS NOT NULL AND (NEW.provider_environment IS DISTINCT FROM OLD.provider_environment OR (OLD.stripe_account_id IS NOT NULL AND NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id)) THEN RAISE EXCEPTION 'Onboarded merchant identity is immutable' USING ERRCODE='22023'; END IF;
 IF TG_OP='INSERT' THEN NEW.binding_version:=1;NEW.sales_readback_at:=NULL;NEW.sales_payment_permission:=false;
 ELSIF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id OR NEW.provider_environment IS DISTINCT FROM OLD.provider_environment THEN NEW.binding_version:=OLD.binding_version+1;NEW.sales_readback_at:=NULL;NEW.sales_payment_permission:=false;
 ELSE NEW.binding_version:=OLD.binding_version; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.reserve_sales_merchant_onboarding(_actor_user_id uuid,_expected_tenant_id uuid,_environment text,_operation_id uuid,_claim uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.tenant_stripe_accounts%ROWTYPE; dispatch boolean:=false;
BEGIN
 PERFORM public._sales_payment_operation_service();PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _environment IS NULL OR _environment NOT IN ('test','live') OR _operation_id IS NULL OR _claim IS NULL THEN RAISE EXCEPTION 'Invalid merchant reservation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_expected_tenant_id::text,81743));
 SELECT * INTO r FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.tenant_stripe_accounts(tenant_id,stripe_account_id,account_type,provider_environment,onboarding_id,onboarding_started_at,onboarding_claim)
   VALUES(_expected_tenant_id,NULL,'express',_environment,_operation_id,clock_timestamp(),_claim) RETURNING * INTO r;
  dispatch:=true;
 ELSIF r.provider_environment IS DISTINCT FROM _environment THEN RAISE EXCEPTION 'Merchant environment unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('binding',to_jsonb(r),'dispatch',dispatch);
END $$;
CREATE OR REPLACE FUNCTION public.persist_sales_merchant_onboarding(_actor_user_id uuid,_expected_tenant_id uuid,_environment text,_operation_id uuid,_claim uuid,_expected_version bigint,_merchant_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.tenant_stripe_accounts%ROWTYPE;
BEGIN
 PERFORM public._sales_payment_operation_service();PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _merchant_id IS NULL OR _merchant_id!~'^acct_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid merchant identity' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR r.onboarding_id IS DISTINCT FROM _operation_id OR r.onboarding_claim IS DISTINCT FROM _claim OR r.provider_environment IS DISTINCT FROM _environment OR r.binding_version IS DISTINCT FROM _expected_version OR r.stripe_account_id IS NOT NULL THEN RAISE EXCEPTION 'Merchant binding changed' USING ERRCODE='40001'; END IF;
 UPDATE public.tenant_stripe_accounts SET stripe_account_id=_merchant_id WHERE tenant_id=_expected_tenant_id RETURNING * INTO r;
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_merchant_onboarding','capability_succeeded',md5(r.onboarding_id::text||':bound')::uuid,NULL);
 RETURN to_jsonb(r);
END $$;
CREATE OR REPLACE FUNCTION public.record_sales_merchant_onboarding_readback(_actor_user_id uuid,_expected_tenant_id uuid,_merchant_id text,_expected_version bigint,_environment text,_charges_enabled boolean,_payouts_enabled boolean,_details_submitted boolean,_payment_permission boolean,_country text,_currency text,_requirements jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE version bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 version:=public.record_sales_stripe_readback(_expected_tenant_id,_merchant_id,_expected_version,_environment,_charges_enabled,_payouts_enabled,_details_submitted,_payment_permission,_country,_currency,_requirements);
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_merchant_readback','capability_succeeded',gen_random_uuid(),NULL);
 RETURN version;
END $$;
REVOKE ALL ON FUNCTION public.reserve_sales_merchant_onboarding(uuid,uuid,text,uuid,uuid),public.persist_sales_merchant_onboarding(uuid,uuid,text,uuid,uuid,bigint,text),public.record_sales_merchant_onboarding_readback(uuid,uuid,text,bigint,text,boolean,boolean,boolean,boolean,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_sales_merchant_onboarding(uuid,uuid,text,uuid,uuid),public.persist_sales_merchant_onboarding(uuid,uuid,text,uuid,uuid,bigint,text),public.record_sales_merchant_onboarding_readback(uuid,uuid,text,bigint,text,boolean,boolean,boolean,boolean,text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.record_sales_stripe_readback(
  _tenant_id uuid, _merchant_id text, _expected_version bigint, _environment text,
  _charges_enabled boolean, _payouts_enabled boolean, _details_submitted boolean,
  _payment_permission boolean, _country text, _currency text, _requirements jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.tenant_stripe_accounts;
BEGIN
  IF _environment NOT IN ('test','live') OR _environment IS NULL OR
     _merchant_id IS NULL OR _merchant_id !~ '^acct_[A-Za-z0-9]+$' OR
     _expected_version IS NULL OR _expected_version<1 OR
     _charges_enabled IS NULL OR _payouts_enabled IS NULL OR _details_submitted IS NULL OR
     _payment_permission IS NULL THEN
    RAISE EXCEPTION 'Invalid merchant readback' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM public.tenant_stripe_accounts WHERE tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND OR r.stripe_account_id IS DISTINCT FROM _merchant_id OR r.binding_version<>_expected_version OR
     (r.provider_environment IS NOT NULL AND r.provider_environment<>_environment) THEN
    RAISE EXCEPTION 'Merchant binding changed; refresh the current binding' USING ERRCODE='40001';
  END IF;
  UPDATE public.tenant_stripe_accounts SET provider_environment=_environment,
    charges_enabled=_charges_enabled,payouts_enabled=_payouts_enabled,details_submitted=_details_submitted,
    sales_payment_permission=_payment_permission,sales_readback_at=clock_timestamp(),
    country=_country,default_currency=_currency,requirements=_requirements WHERE tenant_id=_tenant_id;
  -- First provider environment identification advances the binding and clears readiness by trigger.
  -- Stamp readback only after binding identity is stable, still holding the same row lock.
  UPDATE public.tenant_stripe_accounts SET sales_payment_permission=_payment_permission,
    sales_readback_at=clock_timestamp() WHERE tenant_id=_tenant_id RETURNING binding_version INTO r.binding_version;
  RETURN r.binding_version;
END $$;
COMMIT;
