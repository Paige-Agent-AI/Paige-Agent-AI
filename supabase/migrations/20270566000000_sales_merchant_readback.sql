-- Sales S1: server-owned merchant identity/readiness. No charge, transaction or allocation writer.
-- CLI-created migration advanced above production frontier64 and open research reservation65.
BEGIN;
ALTER TABLE public.tenant_stripe_accounts
  ADD COLUMN IF NOT EXISTS binding_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider_environment text,
  ADD COLUMN IF NOT EXISTS sales_readback_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_payment_permission boolean NOT NULL DEFAULT false;
-- Existing flags have unproven provenance. They remain readable by storefront but cannot authorize Sales.
REVOKE INSERT, UPDATE, DELETE ON public.tenant_stripe_accounts FROM authenticated, anon;
DROP POLICY IF EXISTS tsa_admin_manage ON public.tenant_stripe_accounts;

CREATE OR REPLACE FUNCTION public.sales_stripe_binding_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Merchant tenant identity is immutable' USING ERRCODE='22023';
  END IF;
  IF NEW.provider_environment IS NOT NULL AND NEW.provider_environment NOT IN ('test','live') THEN
    RAISE EXCEPTION 'Invalid provider environment' USING ERRCODE='22023';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.binding_version:=1; NEW.sales_readback_at:=NULL; NEW.sales_payment_permission:=false;
  ELSIF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id OR
        NEW.provider_environment IS DISTINCT FROM OLD.provider_environment THEN
    NEW.binding_version:=OLD.binding_version+1;
    NEW.sales_readback_at:=NULL; NEW.sales_payment_permission:=false;
  ELSE
    NEW.binding_version:=OLD.binding_version;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sales_stripe_binding_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sales_stripe_binding_guard ON public.tenant_stripe_accounts;
CREATE TRIGGER sales_stripe_binding_guard BEFORE INSERT OR UPDATE ON public.tenant_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sales_stripe_binding_guard();

-- CAS applies authenticated provider readback to exactly the still-current tenant binding.
-- Only the server adapter may invoke this, never a browser/model readiness declaration.
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
  IF NOT FOUND OR r.stripe_account_id<>_merchant_id OR r.binding_version<>_expected_version OR
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
REVOKE ALL ON FUNCTION public.record_sales_stripe_readback(uuid,text,bigint,text,boolean,boolean,boolean,boolean,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sales_stripe_readback(uuid,text,bigint,text,boolean,boolean,boolean,boolean,text,text,jsonb) TO service_role;
COMMIT;
