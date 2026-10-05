-- S3A asynchronous provider facts. No settlement/allocation or second receivable ledger.
BEGIN;
CREATE TABLE IF NOT EXISTS public.paige_invoice_provider_operations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 invoice_id uuid NOT NULL,
 client_id uuid NOT NULL REFERENCES public.clients(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 invoice_version bigint NOT NULL CHECK(invoice_version>0),
 issued_snapshot_version bigint NOT NULL CHECK(issued_snapshot_version>0),
 provider text NOT NULL CHECK(provider IN ('stripe','paypal')),
 merchant_account_id text NOT NULL CHECK(length(merchant_account_id) BETWEEN 1 AND 128),
 merchant_binding_version bigint NOT NULL CHECK(merchant_binding_version>0),
 environment text NOT NULL CHECK(environment IN ('test','live')),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 2147483647),
 currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 purpose text NOT NULL CHECK(purpose IN ('full','partial','deposit','installment')),
 command jsonb NOT NULL,
 authority_fingerprint text NOT NULL CHECK(authority_fingerprint ~ '^[0-9a-f]{16}$'),
 idempotency_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown','failed','expired','cancelled')),
 dispatch_claim_token uuid,
 dispatch_started_at timestamptz,
 provider_object_id text CHECK(provider_object_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 provider_status text CHECK(provider_status ~ '^[a-zA-Z0-9_.-]{1,64}$'),
 provider_url text CHECK(length(provider_url)<=2000 AND provider_url ~ '^https://checkout\.stripe\.com/'),
 expires_at timestamptz,
 cancellation_reason text CHECK(cancellation_reason IN ('merchant_changed','readiness_unavailable','invoice_changed','recovery_abandoned')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.paige_invoices(tenant_id,id),
 CHECK((state='prepared' AND dispatch_claim_token IS NULL AND dispatch_started_at IS NULL)
   OR (state='cancelled' AND dispatch_claim_token IS NULL AND dispatch_started_at IS NULL AND provider_object_id IS NULL AND coalesce(provider_status,'')='not_dispatched' AND cancellation_reason IS NOT NULL)
   OR (state<>'prepared' AND dispatch_claim_token IS NOT NULL AND dispatch_started_at IS NOT NULL)),
 CHECK(state NOT IN ('provider_accepted','customer_action_required') OR provider_object_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_provider_object_identity ON public.paige_invoice_provider_operations(provider,merchant_account_id,environment,provider_object_id) WHERE provider_object_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_provider_invoice_inflight ON public.paige_invoice_provider_operations(tenant_id,invoice_id)
 WHERE state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown');
ALTER TABLE public.paige_invoice_provider_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_invoice_provider_operations FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.paige_invoice_provider_operations IS 'Invoice-bound asynchronous provider request facts. Not balance/settlement/approval/scheduler authority. S3A cannot write settled.';

CREATE OR REPLACE FUNCTION public._sales_payment_operation_service() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_payment_operation_service() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_payment_operation_service() TO service_role;

CREATE OR REPLACE FUNCTION public._sales_payment_operation_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment operation history is immutable' USING ERRCODE='42501'; END IF;
 IF ROW(NEW.id,NEW.tenant_id,NEW.invoice_id,NEW.client_id,NEW.actor_user_id,NEW.invoice_version,NEW.issued_snapshot_version,
  NEW.provider,NEW.merchant_account_id,NEW.merchant_binding_version,NEW.environment,NEW.amount_minor,NEW.currency,NEW.purpose,
  NEW.command,NEW.authority_fingerprint,NEW.idempotency_key,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.invoice_id,OLD.client_id,OLD.actor_user_id,OLD.invoice_version,OLD.issued_snapshot_version,
  OLD.provider,OLD.merchant_account_id,OLD.merchant_binding_version,OLD.environment,OLD.amount_minor,OLD.currency,OLD.purpose,
  OLD.command,OLD.authority_fingerprint,OLD.idempotency_key,OLD.created_at)
 OR (OLD.provider_object_id IS NOT NULL AND NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id)
 OR (OLD.dispatch_claim_token IS NOT NULL AND NEW.dispatch_claim_token IS DISTINCT FROM OLD.dispatch_claim_token)
 OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at) THEN
  RAISE EXCEPTION 'Payment operation identity is immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_payment_operation_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS sales_payment_operation_immutable ON public.paige_invoice_provider_operations;
CREATE TRIGGER sales_payment_operation_immutable BEFORE UPDATE OR DELETE ON public.paige_invoice_provider_operations
 FOR EACH ROW EXECUTE FUNCTION public._sales_payment_operation_immutable();

-- The invoice command namespace is shared, even though async provider facts have a separate home.
CREATE OR REPLACE FUNCTION public._sales_invoice_operation_namespace_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text,81742));
 IF (TG_TABLE_NAME='paige_invoice_provider_operations' AND EXISTS(SELECT 1 FROM public.paige_invoice_operations WHERE id=NEW.id))
  OR (TG_TABLE_NAME='paige_invoice_operations' AND EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations WHERE id=NEW.id)) THEN
  RAISE EXCEPTION 'Operation belongs to another invoice action' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_operation_namespace_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS sales_provider_operation_namespace_guard ON public.paige_invoice_provider_operations;
CREATE TRIGGER sales_provider_operation_namespace_guard BEFORE INSERT ON public.paige_invoice_provider_operations
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_operation_namespace_guard();
DROP TRIGGER IF EXISTS sales_invoice_operation_namespace_guard ON public.paige_invoice_operations;
CREATE TRIGGER sales_invoice_operation_namespace_guard BEFORE INSERT ON public.paige_invoice_operations
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_operation_namespace_guard();

CREATE OR REPLACE FUNCTION public.prepare_sales_invoice_payment_request(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; m public.tenant_stripe_accounts%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE; balance bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>4000
  OR (SELECT count(*) FROM jsonb_object_keys(_command))<>12
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN ('action','invoice_id','client_id','expected_version','issued_snapshot_version','provider','merchant_account_id','merchant_binding_version','environment','amount_minor','currency','purpose'))
  OR _command->>'action' IS DISTINCT FROM 'invoice.payment_request'
  OR coalesce(_command->>'amount_minor','') !~ '^[1-9][0-9]{0,9}$'
  OR (_command->>'amount_minor')::bigint>2147483647
  OR _command->>'purpose' NOT IN ('full','partial','deposit','installment') THEN
  RAISE EXCEPTION 'Invalid payment request' USING ERRCODE='22023';
 END IF;
 -- Same canonical command lock/order as execute_sales_invoice_command: actor, operation, invoice.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
 -- A common invoice lock serializes preparation, receipts, voiding and dispatch claims.
 SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id;
 IF FOUND THEN
  IF op.tenant_id IS DISTINCT FROM _expected_tenant_id THEN
   RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
  IF op.actor_user_id IS DISTINCT FROM _actor_user_id OR op.command IS DISTINCT FROM _command THEN
   RAISE EXCEPTION 'Payment operation reused with different input' USING ERRCODE='22023';
  END IF;
  RETURN to_jsonb(op)-'dispatch_claim_token';
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations WHERE id=_operation_id) THEN
  RAISE EXCEPTION 'Operation belongs to another invoice action' USING ERRCODE='22023';
 END IF;
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,'invoice.payment_request','sales_create_payment_request',_governance);
 IF public.resolve_tool_autonomy(_expected_tenant_id,'sales_create_payment_request')='off' THEN
  RAISE EXCEPTION 'Payment request authority unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=r.contact_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND OR r.contact_id IS DISTINCT FROM (_command->>'client_id')::uuid THEN
  RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'issued' OR r.billing_issued_at IS NULL OR r.billing_document IS NULL
  OR r.billing_lifecycle_version IS DISTINCT FROM (_command->>'expected_version')::bigint
  OR r.billing_issued_snapshot_version IS DISTINCT FROM (_command->>'issued_snapshot_version')::bigint THEN
  RAISE EXCEPTION 'Invoice changed or unavailable for payment' USING ERRCODE='40001'; END IF;
 SELECT (public._sales_invoice_read(_expected_tenant_id,r.id)->>'remaining_cents')::bigint INTO balance;
 IF lower(r.currency) IS DISTINCT FROM _command->>'currency' OR (_command->>'amount_minor')::bigint>balance OR balance<=0
  OR (_command->>'purpose'='full' AND (_command->>'amount_minor')::bigint<>balance) THEN
  RAISE EXCEPTION 'Payment amount or currency unavailable' USING ERRCODE='22023'; END IF;
 -- PayPal must acquire its own proven merchant binding before this adapter is activated.
 IF _command->>'provider' IS DISTINCT FROM 'stripe' THEN RAISE EXCEPTION 'Payment provider unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR m.stripe_account_id IS DISTINCT FROM _command->>'merchant_account_id'
  OR m.binding_version IS DISTINCT FROM (_command->>'merchant_binding_version')::bigint
  OR m.provider_environment IS DISTINCT FROM _command->>'environment'
  OR NOT coalesce(m.charges_enabled AND m.payouts_enabled AND m.details_submitted AND m.sales_payment_permission,false)
  OR m.sales_readback_at IS NULL OR m.sales_readback_at<clock_timestamp()-interval '5 minutes' THEN
  RAISE EXCEPTION 'Payment merchant unavailable; refresh readiness' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id
  AND state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')) THEN
  RAISE EXCEPTION 'Payment request already in progress; reconcile it first' USING ERRCODE='55000'; END IF;
 INSERT INTO public.paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,
  provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key)
 VALUES(_operation_id,_expected_tenant_id,r.id,r.contact_id,_actor_user_id,r.billing_lifecycle_version,r.billing_issued_snapshot_version,
  'stripe',m.stripe_account_id,m.binding_version,m.provider_environment,(_command->>'amount_minor')::bigint,lower(r.currency),_command->>'purpose',
  _command,_governance->>'approved_fingerprint','sales-payment-'||_operation_id::text) RETURNING * INTO op;
 -- This proves preparation only, not provider acceptance, a charge or settlement.
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_prepare_payment_request','capability_succeeded',md5(_operation_id::text||':prepared')::uuid,NULL);
 RETURN to_jsonb(op)-'dispatch_claim_token';
END $$;
REVOKE ALL ON FUNCTION public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sales_invoice_payment_request(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; r public.paige_invoices%ROWTYPE; m public.tenant_stripe_accounts%ROWTYPE; balance bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND OR _claim_token IS NULL THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(op.actor_user_id,_expected_tenant_id);
 IF public.resolve_tool_autonomy(_expected_tenant_id,'sales_create_payment_request')='off' THEN
  RAISE EXCEPTION 'Payment request authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF op.state<>'prepared' THEN RAISE EXCEPTION 'Payment dispatch already claimed; reconcile existing operation' USING ERRCODE='55000'; END IF;
 SELECT * INTO m FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR m.stripe_account_id IS DISTINCT FROM op.merchant_account_id OR m.binding_version IS DISTINCT FROM op.merchant_binding_version
  OR m.provider_environment IS DISTINCT FROM op.environment OR NOT coalesce(m.charges_enabled AND m.payouts_enabled AND m.details_submitted AND m.sales_payment_permission,false)
  OR m.sales_readback_at IS NULL OR m.sales_readback_at<clock_timestamp()-interval '5 minutes' THEN
  RAISE EXCEPTION 'Payment merchant unavailable; refresh readiness' USING ERRCODE='42501'; END IF;
 balance:=(public._sales_invoice_read(_expected_tenant_id,r.id)->>'remaining_cents')::bigint;
 PERFORM 1 FROM public.clients WHERE id=op.client_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'issued' OR r.contact_id IS DISTINCT FROM op.client_id OR r.billing_lifecycle_version IS DISTINCT FROM op.invoice_version
  OR r.billing_issued_snapshot_version IS DISTINCT FROM op.issued_snapshot_version OR lower(r.currency) IS DISTINCT FROM op.currency
  OR balance<op.amount_minor THEN RAISE EXCEPTION 'Invoice changed or unavailable for payment' USING ERRCODE='40001'; END IF;
 UPDATE public.paige_invoice_provider_operations SET state='dispatching',dispatch_claim_token=_claim_token,dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=op.id RETURNING * INTO op;
 PERFORM public.record_capability_run(_expected_tenant_id,op.actor_user_id,'sales_dispatch_payment_request','capability_succeeded',md5(op.id::text||':dispatching')::uuid,NULL);
 -- Server-only response. The claim token must never be forwarded to model/customer callers.
 RETURN to_jsonb(op);
END $$;
REVOKE ALL ON FUNCTION public.claim_sales_invoice_payment_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_invoice_payment_request(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_sales_invoice_payment_request(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid,
 _state text,_provider_object_id text,_provider_status text,_provider_url text,_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR _claim_token IS NULL OR op.dispatch_claim_token IS DISTINCT FROM _claim_token THEN
  RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF _state IS NULL OR _state NOT IN ('provider_accepted','customer_action_required','outcome_unknown','failed','expired','cancelled')
  OR (_provider_object_id IS NOT NULL AND _provider_object_id !~ '^cs_[A-Za-z0-9_]{1,124}$')
  OR (_provider_status IS NOT NULL AND _provider_status !~ '^[a-zA-Z0-9_.-]{1,64}$')
  OR (_provider_url IS NOT NULL AND (length(_provider_url)>2000 OR _provider_url !~ '^https://checkout\.stripe\.com/c/pay/[A-Za-z0-9_/#.?%=&:+-]+$'))
  OR (_state IN ('provider_accepted','customer_action_required') AND _provider_object_id IS NULL) THEN
  RAISE EXCEPTION 'Invalid safe provider result' USING ERRCODE='22023'; END IF;
 IF op.state IN ('failed','expired','cancelled') THEN
  IF op.state=_state AND op.provider_object_id IS NOT DISTINCT FROM _provider_object_id AND op.provider_status IS NOT DISTINCT FROM _provider_status
   AND op.provider_url IS NOT DISTINCT FROM _provider_url AND op.expires_at IS NOT DISTINCT FROM _expires_at THEN RETURN to_jsonb(op)-'dispatch_claim_token'; END IF;
  RAISE EXCEPTION 'Payment operation is final' USING ERRCODE='55000'; END IF;
 IF op.state NOT IN ('dispatching','provider_accepted','customer_action_required','outcome_unknown') THEN
  RAISE EXCEPTION 'Payment dispatch has not been claimed' USING ERRCODE='55000'; END IF;
 IF op.provider_object_id IS NOT NULL AND op.provider_object_id IS DISTINCT FROM _provider_object_id THEN
  RAISE EXCEPTION 'Provider identity conflicts with existing operation' USING ERRCODE='22023'; END IF;
 UPDATE public.paige_invoice_provider_operations SET state=_state,provider_object_id=_provider_object_id,provider_status=_provider_status,
  provider_url=_provider_url,expires_at=_expires_at,updated_at=clock_timestamp() WHERE id=op.id RETURNING * INTO op;
 PERFORM public._record_workspace_rail_event(_expected_tenant_id,NULL,'capability_run',md5(op.id::text||':'||_state)::uuid,0,
  CASE WHEN _state='outcome_unknown' THEN 'capability_outcome_unknown' WHEN _state='failed' THEN 'capability_failed' ELSE 'capability_succeeded' END,NULL,'sales_create_payment_request');
 IF _state IN ('failed','expired','cancelled') THEN PERFORM public.settle_sales_payment_reconciliation_work(_expected_tenant_id,op.id); END IF;
 RETURN to_jsonb(op)-'dispatch_claim_token';
END $$;
REVOKE ALL ON FUNCTION public.finalize_sales_invoice_payment_request(uuid,uuid,uuid,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sales_invoice_payment_request(uuid,uuid,uuid,text,text,text,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_request(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE;
BEGIN
 PERFORM public._sales_payment_operation_service(); PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN (to_jsonb(op)-'dispatch_claim_token')||jsonb_build_object('rail_run_ids',jsonb_build_object(
  'prepared',md5(op.id::text||':prepared')::uuid,'dispatching',md5(op.id::text||':dispatching')::uuid,
  'current_state',md5(op.id::text||':'||CASE WHEN op.state='settled' THEN 'settlement' ELSE op.state END)::uuid,
  'allocation',CASE WHEN op.state='settled' THEN md5(op.id::text||':allocation')::uuid ELSE NULL END));
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_payment_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_payment_request(uuid,uuid,uuid) TO service_role;

-- Internal reconciler only. Never route this RPC as a model/UI read capability.
CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_dispatch(_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(op);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_payment_dispatch(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_payment_dispatch(uuid,uuid) TO service_role;

-- Recovery may abandon a request only when the atomic dispatch claim proves no provider call began.
-- This is not cancellation of an external payment, and grants no new collection authority.
CREATE OR REPLACE FUNCTION public.cancel_prepared_sales_invoice_payment_request(_expected_tenant_id uuid,_operation_id uuid,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE;
BEGIN
 PERFORM public._sales_payment_operation_service();
 IF _reason IS NULL OR _reason NOT IN ('merchant_changed','readiness_unavailable','invoice_changed','recovery_abandoned') THEN
  RAISE EXCEPTION 'Invalid payment recovery reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(op.id::text,81742));
 PERFORM 1 FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF op.state='cancelled' AND op.dispatch_started_at IS NULL AND op.dispatch_claim_token IS NULL THEN RETURN to_jsonb(op)-'dispatch_claim_token'; END IF;
 IF op.state<>'prepared' OR op.dispatch_started_at IS NOT NULL OR op.dispatch_claim_token IS NOT NULL OR op.provider_object_id IS NOT NULL THEN
  RAISE EXCEPTION 'Provider dispatch may have begun; reconcile instead' USING ERRCODE='55000'; END IF;
 UPDATE public.paige_invoice_provider_operations SET state='cancelled',provider_status='not_dispatched',cancellation_reason=_reason,updated_at=clock_timestamp()
 WHERE id=op.id RETURNING * INTO op;
 PERFORM public.record_capability_run(_expected_tenant_id,op.actor_user_id,'sales_cancel_prepared_payment','capability_succeeded',md5(op.id::text||':cancelled')::uuid,NULL);
 RETURN to_jsonb(op)-'dispatch_claim_token';
END $$;
REVOKE ALL ON FUNCTION public.cancel_prepared_sales_invoice_payment_request(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_prepared_sales_invoice_payment_request(uuid,uuid,text) TO service_role;

-- Compose with the existing delivery fence. Do not replace or weaken delivery checks.
CREATE OR REPLACE FUNCTION public._sales_invoice_payment_request_mutation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid; invoice uuid;
BEGIN
 IF TG_TABLE_NAME='paige_invoice_payments' THEN
  tenant:=NEW.tenant_id; invoice:=NEW.invoice_id;
  PERFORM 1 FROM public.paige_invoices WHERE id=invoice AND tenant_id=tenant FOR UPDATE;
 ELSE
  IF TG_OP='UPDATE' AND ROW(NEW.billing_lifecycle_version,NEW.status) IS NOT DISTINCT FROM ROW(OLD.billing_lifecycle_version,OLD.status) THEN RETURN NEW; END IF;
  tenant:=OLD.tenant_id; invoice:=OLD.id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations WHERE tenant_id=tenant AND invoice_id=invoice
  AND state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')) THEN
  RAISE EXCEPTION 'Payment request is unresolved. Reconcile or expire it before changing invoice payments or state.' USING ERRCODE='P5501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_request_mutation_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS sales_invoice_payment_request_version_guard ON public.paige_invoices;
CREATE TRIGGER sales_invoice_payment_request_version_guard BEFORE UPDATE OF billing_lifecycle_version,status OR DELETE ON public.paige_invoices
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_payment_request_mutation_guard();
DROP TRIGGER IF EXISTS sales_invoice_payment_request_receipt_guard ON public.paige_invoice_payments;
CREATE TRIGGER sales_invoice_payment_request_receipt_guard BEFORE INSERT ON public.paige_invoice_payments
 FOR EACH ROW EXECUTE FUNCTION public._sales_invoice_payment_request_mutation_guard();

-- Extend, never replace, the canonical Trust catalogue and its predecessor scope gate.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_provider_request(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_provider_request;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_provider_request(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_provider_request(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('sales_create_payment_request','Request a customer invoice payment','Payments')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
-- S4 appends verified provider facts to the existing receipt ledger. Manual history is unchanged.
ALTER TABLE public.paige_invoice_provider_operations
 ADD COLUMN IF NOT EXISTS verified_readback jsonb,
 ADD COLUMN IF NOT EXISTS settled_at timestamptz,
 ADD COLUMN IF NOT EXISTS allocation_payment_id uuid;
ALTER TABLE public.paige_invoice_provider_operations DROP CONSTRAINT IF EXISTS paige_invoice_provider_operations_state_check;
ALTER TABLE public.paige_invoice_provider_operations ADD CONSTRAINT paige_invoice_provider_operations_state_check
 CHECK(state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown','settled','failed','expired','cancelled'));
CREATE UNIQUE INDEX IF NOT EXISTS sales_provider_operation_invoice_identity ON public.paige_invoice_provider_operations(tenant_id,invoice_id,id);
ALTER TABLE public.paige_invoice_payments
 ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'manual_recorded',
 ADD COLUMN IF NOT EXISTS provider_operation_id uuid,
 ADD COLUMN IF NOT EXISTS provider text,
 ADD COLUMN IF NOT EXISTS merchant_account_id text,
 ADD COLUMN IF NOT EXISTS provider_environment text,
 ADD COLUMN IF NOT EXISTS provider_transaction_id text,
 ADD COLUMN IF NOT EXISTS provider_settlement_id text,
 ADD COLUMN IF NOT EXISTS provider_verified_at timestamptz;
ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS paige_invoice_payments_method_check;
ALTER TABLE public.paige_invoice_payments ADD CONSTRAINT paige_invoice_payments_method_check
 CHECK(method IN ('zelle','cash','wire','check','bank_transfer','other','stripe','paypal'));
ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS sales_provider_receipt_shape;
ALTER TABLE public.paige_invoice_payments ADD CONSTRAINT sales_provider_receipt_shape CHECK(
 (evidence_kind='manual_recorded' AND method IN ('zelle','cash','wire','check','bank_transfer','other')
  AND provider_operation_id IS NULL AND provider IS NULL AND merchant_account_id IS NULL AND provider_environment IS NULL
  AND provider_transaction_id IS NULL AND provider_settlement_id IS NULL AND provider_verified_at IS NULL)
 OR (evidence_kind='provider_verified' AND kind='receipt' AND provider_operation_id IS NOT NULL
  AND provider IN ('stripe','paypal') AND method=provider AND merchant_account_id IS NOT NULL AND provider_environment IN ('test','live')
  AND provider_transaction_id ~ '^[A-Za-z0-9_-]{1,128}$' AND provider_settlement_id ~ '^[A-Za-z0-9_-]{1,128}$'
  AND provider_transaction_id IS NOT NULL AND provider_settlement_id IS NOT NULL AND provider_verified_at IS NOT NULL
  AND import_provenance IS NULL));
ALTER TABLE public.paige_invoice_payments DROP CONSTRAINT IF EXISTS sales_provider_receipt_scope;
ALTER TABLE public.paige_invoice_payments ADD CONSTRAINT sales_provider_receipt_scope FOREIGN KEY(tenant_id,invoice_id,provider_operation_id)
 REFERENCES public.paige_invoice_provider_operations(tenant_id,invoice_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_provider_receipt_once ON public.paige_invoice_payments(provider_operation_id) WHERE provider_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_provider_settlement_once ON public.paige_invoice_payments(provider,merchant_account_id,provider_environment,provider_settlement_id) WHERE evidence_kind='provider_verified';
CREATE UNIQUE INDEX IF NOT EXISTS sales_provider_transaction_once ON public.paige_invoice_payments(provider,merchant_account_id,provider_environment,provider_transaction_id) WHERE evidence_kind='provider_verified';
ALTER TABLE public.paige_invoice_provider_operations DROP CONSTRAINT IF EXISTS sales_provider_allocation_scope;
ALTER TABLE public.paige_invoice_provider_operations ADD CONSTRAINT sales_provider_allocation_scope FOREIGN KEY(tenant_id,invoice_id,allocation_payment_id)
 REFERENCES public.paige_invoice_payments(tenant_id,invoice_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.paige_invoice_provider_operations DROP CONSTRAINT IF EXISTS sales_provider_settled_shape;
ALTER TABLE public.paige_invoice_provider_operations ADD CONSTRAINT sales_provider_settled_shape CHECK(
 (state='settled' AND verified_readback IS NOT NULL AND settled_at IS NOT NULL AND allocation_payment_id IS NOT NULL)
 OR (state<>'settled' AND verified_readback IS NULL AND settled_at IS NULL AND allocation_payment_id IS NULL));

CREATE OR REPLACE FUNCTION public._sales_provider_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='paige_invoice_provider_operations' THEN
  IF OLD.verified_readback IS NOT NULL AND ROW(NEW.verified_readback,NEW.settled_at,NEW.allocation_payment_id,NEW.state)
   IS DISTINCT FROM ROW(OLD.verified_readback,OLD.settled_at,OLD.allocation_payment_id,OLD.state) THEN
   RAISE EXCEPTION 'Verified payment history is immutable; append a governed correction' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.kind='reversal' AND EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE id=NEW.reverses_payment_id AND evidence_kind='provider_verified') THEN
  RAISE EXCEPTION 'Provider payments require provider reversal reconciliation, not a manual correction' USING ERRCODE='42501'; END IF;
 IF NEW.evidence_kind='provider_verified' THEN
  SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=NEW.provider_operation_id AND tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id;
  IF NOT FOUND OR op.state<>'settled' OR op.allocation_payment_id IS DISTINCT FROM NEW.id
   OR op.amount_minor IS DISTINCT FROM NEW.amount_cents::bigint OR op.currency IS DISTINCT FROM NEW.currency
   OR op.provider IS DISTINCT FROM NEW.provider OR op.merchant_account_id IS DISTINCT FROM NEW.merchant_account_id OR op.environment IS DISTINCT FROM NEW.provider_environment
   OR op.verified_readback->>'provider_transaction_id' IS DISTINCT FROM NEW.provider_transaction_id
   OR op.verified_readback->>'provider_settlement_id' IS DISTINCT FROM NEW.provider_settlement_id THEN
   RAISE EXCEPTION 'Verified provider allocation unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_provider_receipt_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS sales_provider_receipt_guard ON public.paige_invoice_payments;
CREATE TRIGGER sales_provider_receipt_guard BEFORE INSERT ON public.paige_invoice_payments FOR EACH ROW EXECUTE FUNCTION public._sales_provider_receipt_guard();
DROP TRIGGER IF EXISTS sales_provider_settled_immutable ON public.paige_invoice_provider_operations;
CREATE TRIGGER sales_provider_settled_immutable BEFORE UPDATE ON public.paige_invoice_provider_operations FOR EACH ROW EXECUTE FUNCTION public._sales_provider_receipt_guard();

CREATE OR REPLACE FUNCTION public.allocate_verified_sales_invoice_payment(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid,_readback jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; merchant public.tenant_stripe_accounts%ROWTYPE;
 received_at timestamptz; remaining bigint; allocation uuid; verified_at timestamptz:=clock_timestamp();
BEGIN
 PERFORM public._sales_payment_operation_service();
 IF jsonb_typeof(_readback) IS DISTINCT FROM 'object' OR octet_length(_readback::text)>8000 OR (SELECT count(*) FROM jsonb_object_keys(_readback))<>15
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_readback) k WHERE k NOT IN ('provider','merchant_account_id','environment','provider_object_id','provider_transaction_id','provider_settlement_id','amount_minor','currency','status','readback_reference','invoice_id','client_id','invoice_version','issued_snapshot_version','provider_received_at'))
  OR _readback->>'status' IS DISTINCT FROM 'verified' OR coalesce(_readback->>'provider_transaction_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
  OR coalesce(_readback->>'provider_settlement_id','') !~ '^[A-Za-z0-9_-]{1,128}$' OR coalesce(_readback->>'readback_reference','') !~ '^[A-Za-z0-9_-]{1,200}$'
  OR coalesce(_readback->>'provider_received_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$' THEN
  RAISE EXCEPTION 'Invalid verified provider readback' USING ERRCODE='22023'; END IF;
 received_at:=(_readback->>'provider_received_at')::timestamptz;
 IF received_at>verified_at OR received_at<'1900-01-01'::timestamptz THEN RAISE EXCEPTION 'Invalid provider payment time' USING ERRCODE='22023'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND OR _claim_token IS NULL OR op.dispatch_claim_token IS DISTINCT FROM _claim_token THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(op.id::text,81742));
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF _readback->>'provider' IS DISTINCT FROM op.provider OR _readback->>'merchant_account_id' IS DISTINCT FROM op.merchant_account_id
  OR _readback->>'environment' IS DISTINCT FROM op.environment OR _readback->>'invoice_id' IS DISTINCT FROM op.invoice_id::text
  OR _readback->>'client_id' IS DISTINCT FROM op.client_id::text OR _readback->'invoice_version' IS DISTINCT FROM to_jsonb(op.invoice_version)
  OR _readback->'issued_snapshot_version' IS DISTINCT FROM to_jsonb(op.issued_snapshot_version)
  OR _readback->'amount_minor' IS DISTINCT FROM to_jsonb(op.amount_minor) OR _readback->>'currency' IS DISTINCT FROM op.currency
  OR coalesce(_readback->>'provider_object_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
  OR (op.provider_object_id IS NOT NULL AND _readback->>'provider_object_id' IS DISTINCT FROM op.provider_object_id) THEN
  RAISE EXCEPTION 'Verified provider readback does not match operation' USING ERRCODE='22023'; END IF;
 IF op.state='settled' THEN
  -- Request IDs may change on a subsequent authenticated GET; the immutable transaction facts may not.
  IF (op.verified_readback-'readback_reference') IS DISTINCT FROM (_readback-'readback_reference') THEN
   RAISE EXCEPTION 'Verified settlement conflicts with existing allocation' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('operation_id',op.id,'state','settled','allocation_payment_id',op.allocation_payment_id,'replayed',true,
   'row',public._sales_invoice_read(_expected_tenant_id,op.invoice_id));
 END IF;
 IF op.state NOT IN ('dispatching','provider_accepted','customer_action_required','outcome_unknown') THEN RAISE EXCEPTION 'Payment request cannot settle in current state' USING ERRCODE='55000'; END IF;
 IF op.provider='stripe' THEN
  SELECT * INTO merchant FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR SHARE;
  IF NOT FOUND OR merchant.stripe_account_id IS DISTINCT FROM op.merchant_account_id OR merchant.binding_version IS DISTINCT FROM op.merchant_binding_version
   OR merchant.provider_environment IS DISTINCT FROM op.environment THEN RAISE EXCEPTION 'Payment merchant binding changed; reconcile identity first' USING ERRCODE='42501'; END IF;
 ELSE
  -- PayPal's permission/readback binding must be integrated before allocation may be activated.
  RAISE EXCEPTION 'Payment merchant reconciliation unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.clients WHERE id=op.client_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND OR invoice.contact_id IS DISTINCT FROM op.client_id THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF invoice.status<>'issued' OR invoice.billing_lifecycle_version IS DISTINCT FROM op.invoice_version
  OR invoice.billing_issued_snapshot_version IS DISTINCT FROM op.issued_snapshot_version OR lower(invoice.currency) IS DISTINCT FROM op.currency THEN
  RAISE EXCEPTION 'Invoice changed before verified allocation' USING ERRCODE='40001'; END IF;
 remaining:=(public._sales_invoice_read(_expected_tenant_id,invoice.id)->>'remaining_cents')::bigint;
 IF remaining<op.amount_minor THEN RAISE EXCEPTION 'Verified payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
 allocation:=md5(op.id::text||':allocation')::uuid;
 -- The fence closes only within this transaction. Receipt/version/Rail failure restores it.
 UPDATE public.paige_invoice_provider_operations SET state='settled',provider_object_id=_readback->>'provider_object_id',provider_status='verified',
  verified_readback=_readback,settled_at=received_at,allocation_payment_id=allocation,updated_at=verified_at WHERE id=op.id;
 INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,evidence_kind,
  provider_operation_id,provider,merchant_account_id,provider_environment,provider_transaction_id,provider_settlement_id,provider_verified_at)
 VALUES(allocation,_expected_tenant_id,invoice.id,op.actor_user_id,'receipt',op.amount_minor::integer,op.currency,op.provider,received_at,'provider_verified',
  op.id,op.provider,op.merchant_account_id,op.environment,_readback->>'provider_transaction_id',_readback->>'provider_settlement_id',verified_at);
 UPDATE public.paige_invoices SET billing_lifecycle_version=billing_lifecycle_version+1,updated_at=verified_at WHERE id=invoice.id AND tenant_id=_expected_tenant_id;
 -- Provider reconciliation is a system fact, not a fresh act by the original owner.
 -- Keep that author on the immutable operation/receipt; use the canonical private
 -- writer only inside this narrow service-only SECURITY DEFINER transaction.
 PERFORM public._record_workspace_rail_event(_expected_tenant_id,NULL,'capability_run',md5(op.id::text||':settlement')::uuid,0,'capability_succeeded',NULL,'sales_verify_payment_settlement');
 PERFORM public._record_workspace_rail_event(_expected_tenant_id,NULL,'capability_run',allocation,0,'capability_succeeded',NULL,'sales_allocate_payment');
 PERFORM public.settle_sales_payment_reconciliation_work(_expected_tenant_id,op.id);
 RETURN jsonb_build_object('operation_id',op.id,'state','settled','allocation_payment_id',allocation,'replayed',false,'row',public._sales_invoice_read(_expected_tenant_id,invoice.id));
END $$;
REVOKE ALL ON FUNCTION public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.list_pending_sales_invoice_payment_operations(_expected_tenant_id uuid,_merchant_account_id text,_environment text,_limit integer DEFAULT 100,_after_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb; ids uuid[]; more boolean;
BEGIN
 PERFORM public._sales_payment_operation_service();
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 OR _environment IS NULL OR _environment NOT IN ('test','live')
  OR coalesce(_merchant_account_id,'') !~ '^acct_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid provider reconciliation page' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id AND stripe_account_id=_merchant_account_id AND provider_environment=_environment) THEN
  RAISE EXCEPTION 'Payment merchant unavailable' USING ERRCODE='42501'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM(SELECT id FROM public.paige_invoice_provider_operations
  WHERE tenant_id=_expected_tenant_id AND provider='stripe' AND merchant_account_id=_merchant_account_id AND environment=_environment
  AND state IN ('dispatching','provider_accepted','customer_action_required','outcome_unknown') AND (_after_id IS NULL OR id>_after_id) ORDER BY id LIMIT _limit+1) bounded;
 more:=coalesce(array_length(ids,1),0)>_limit;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO rows FROM unnest(ids[1:_limit]) id;
 RETURN jsonb_build_object('operation_ids',rows,'has_more',more,'next_cursor',CASE WHEN more THEN ids[_limit] ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.list_pending_sales_invoice_payment_operations(uuid,text,text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_sales_invoice_payment_operations(uuid,text,text,integer,uuid) TO service_role;
-- Preserve the established reader and its scope/receipt pagination contract.
DO $$ BEGIN
 IF to_regprocedure('public._sales_invoice_read_before_provider(uuid,uuid,integer)') IS NULL THEN
  ALTER FUNCTION public._sales_invoice_read(uuid,uuid,integer) RENAME TO _sales_invoice_read_before_provider;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_read_before_provider(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._sales_invoice_read(_tenant uuid,_invoice uuid,_payment_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; manual bigint; verified bigint; payments jsonb;
BEGIN
 result:=public._sales_invoice_read_before_provider(_tenant,_invoice,_payment_limit);
 SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='manual_recorded'),0),
 coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='provider_verified'),0)
 INTO manual,verified FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=_invoice;
 SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('evidence_kind',p.evidence_kind,'provider',p.provider,'provider_verified_at',p.provider_verified_at,
  'provenance',CASE WHEN p.evidence_kind='provider_verified' THEN 'provider_verified' WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END) ORDER BY row.ordinality),'[]'::jsonb)
 INTO payments FROM jsonb_array_elements(result->'payments') WITH ORDINALITY row(value,ordinality)
 JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN result||jsonb_build_object('manual_recorded_cents',manual,'provider_verified_cents',verified,'allocated_cents',manual+verified,'payments',payments,
  'settlement',CASE WHEN result->>'status'='void' THEN 'void'
   WHEN verified>0 AND manual>0 AND (result->>'remaining_cents')::bigint=0 THEN 'mixed_recorded_settled'
   WHEN verified>0 AND (result->>'remaining_cents')::bigint=0 THEN 'provider_verified_settled'
   WHEN verified>0 AND manual>0 THEN 'mixed_recorded_partial'
   WHEN verified>0 THEN 'provider_verified_partial' ELSE result->>'settlement' END);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) TO service_role;
DO $$ BEGIN
 IF to_regprocedure('public._sales_invoice_payment_ledger_before_provider(uuid,uuid,integer,jsonb)') IS NULL THEN
  ALTER FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) RENAME TO _sales_invoice_payment_ledger_before_provider;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger_before_provider(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(_tenant uuid,_invoice uuid,_limit integer,_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; truth jsonb; rows jsonb;
BEGIN
 result:=public._sales_invoice_payment_ledger_before_provider(_tenant,_invoice,_limit,_cursor);
 truth:=public._sales_invoice_read(_tenant,_invoice,0);
 SELECT coalesce(jsonb_agg(row.value||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified',
  'provider',p.provider,'provider_operation_id',p.provider_operation_id,'provider_verified_at',p.provider_verified_at) ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
 INTO rows FROM jsonb_array_elements(result->'payment_ledger'->'rows') WITH ORDINALITY row(value,ordinality)
 LEFT JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN jsonb_set(result||jsonb_build_object('manual_recorded_cents',truth->'manual_recorded_cents','provider_verified_cents',truth->'provider_verified_cents',
  'allocated_cents',truth->'allocated_cents','settlement',truth->'settlement'),'{payment_ledger,rows}',rows);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $$ BEGIN
 IF to_regprocedure('public._read_public_sales_invoice_before_provider(text)') IS NULL THEN
  ALTER FUNCTION public.read_public_sales_invoice(text) RENAME TO _read_public_sales_invoice_before_provider;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._read_public_sales_invoice_before_provider(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.read_public_sales_invoice(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; grant_row public.paige_invoice_access_grants%ROWTYPE; truth jsonb;
BEGIN
 result:=public._read_public_sales_invoice_before_provider(_token_hash);
 IF result IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO grant_row FROM public.paige_invoice_access_grants WHERE token_hash=_token_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 truth:=public._sales_invoice_read(grant_row.tenant_id,grant_row.invoice_id,0);
 RETURN result||jsonb_build_object('manual_recorded_cents',truth->'manual_recorded_cents','provider_verified_cents',truth->'provider_verified_cents',
  'allocated_cents',truth->'allocated_cents','settlement',truth->'settlement');
END $$;
REVOKE ALL ON FUNCTION public.read_public_sales_invoice(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_sales_invoice(text) TO service_role;

DO $$ BEGIN
 IF to_regprocedure('public._list_sales_collection_register_before_provider(uuid,text,integer,jsonb)') IS NULL THEN
  ALTER FUNCTION public.list_sales_collection_register(uuid,text,integer,jsonb) RENAME TO _list_sales_collection_register_before_provider;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_sales_collection_register_before_provider(uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.list_sales_collection_register(_expected_tenant_id uuid,_entity text DEFAULT 'invoice',_limit integer DEFAULT 50,_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; rows jsonb;
BEGIN
 result:=public._list_sales_collection_register_before_provider(_expected_tenant_id,_entity,_limit,_cursor);
 IF _entity='invoice' THEN
  SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('manual_recorded_cents',coalesce(p.manual,0),'provider_verified_cents',coalesce(p.verified,0),
   'collection_required',(row.value->>'remaining_cents')::bigint>0 AND row.value->>'status' IN ('issued','recorded')) ORDER BY row.ordinality),'[]'::jsonb)
  INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY row(value,ordinality)
  LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='manual_recorded') manual,
   sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='provider_verified') verified
   FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=(row.value->>'id')::uuid) p ON true;
 ELSE
  SELECT coalesce(jsonb_agg(row.value||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified','provider',p.provider) ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
  INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY row(value,ordinality)
  LEFT JOIN public.paige_invoice_payments p ON p.tenant_id=_expected_tenant_id AND p.id=(row.value->>'id')::uuid;
 END IF;
 RETURN result||jsonb_build_object('rows',rows,'balance_basis','canonical_receipt_allocations');
END $$;
REVOKE ALL ON FUNCTION public.list_sales_collection_register(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sales_collection_register(uuid,text,integer,jsonb) TO authenticated;
DO $$ BEGIN
 IF to_regprocedure('public._preview_sales_invoice_before_provider(uuid,uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) RENAME TO _preview_sales_invoice_before_provider;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._preview_sales_invoice_before_provider(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.preview_sales_invoice_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public._preview_sales_invoice_before_provider(_actor_user_id,_expected_tenant_id,_command);
 IF _command->>'action'='invoice.reverse_manual_payment' AND EXISTS(SELECT 1 FROM public.paige_invoice_payments
  WHERE tenant_id=_expected_tenant_id AND invoice_id=(_command->>'invoice_id')::uuid
   AND id=(_command->>'payment_id')::uuid AND evidence_kind='provider_verified') THEN
  RETURN result||jsonb_build_object('eligible',false,'summary','This payment was confirmed by the payment provider. A provider refund or reversal must be reconciled before its allocation can change.');
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb) TO service_role;
-- One read-only projection for owner and existing bearer-grant surfaces. No provider
-- request is dispatched or reconciled by a read; a stale URL never becomes authority.
CREATE OR REPLACE FUNCTION public._sales_invoice_payment_projection(_tenant uuid,_invoice uuid,_operation uuid,_remaining bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; usable boolean;
BEGIN
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=_tenant AND id=_invoice FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE tenant_id=_tenant AND invoice_id=_invoice AND id=_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 usable:=op.provider='stripe' AND op.state='customer_action_required' AND op.expires_at IS NOT NULL AND op.expires_at>clock_timestamp()
  AND invoice.status='issued' AND op.invoice_version=coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version)
  AND op.issued_snapshot_version=invoice.billing_issued_snapshot_version AND op.client_id=invoice.contact_id
  AND op.currency=lower(invoice.currency) AND _remaining>0 AND op.amount_minor<=_remaining
  AND op.provider_url ~ '^https://checkout[.]stripe[.]com/c/pay/[A-Za-z0-9_?=&%#./:+-]+$'
  AND EXISTS(SELECT 1 FROM public.tenant_stripe_accounts merchant WHERE merchant.tenant_id=_tenant
   AND merchant.stripe_account_id=op.merchant_account_id AND merchant.binding_version=op.merchant_binding_version
   AND merchant.provider_environment=op.environment AND merchant.charges_enabled AND merchant.sales_payment_permission);
 RETURN jsonb_build_object('amount_minor',op.amount_minor,'currency',op.currency,'state',op.state,
  'provider_url',CASE WHEN usable THEN op.provider_url ELSE NULL END,'expires_at',op.expires_at);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_projection(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_sales_invoice_payment_operations(_expected_tenant_id uuid,_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE truth jsonb; rows jsonb; count_rows bigint;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 PERFORM 1 FROM public.paige_invoices WHERE tenant_id=_expected_tenant_id AND id=_invoice_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 truth:=public._sales_invoice_read(_expected_tenant_id,_invoice_id,0);
 SELECT count(*) INTO count_rows FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND invoice_id=_invoice_id;
 SELECT coalesce(jsonb_agg(public._sales_invoice_payment_projection(_expected_tenant_id,_invoice_id,op.id,(truth->>'remaining_cents')::bigint)
  ||jsonb_build_object('id',op.id,'provider',op.provider,'purpose',op.purpose,'invoice_version',op.invoice_version,
   'issued_snapshot_version',op.issued_snapshot_version,'created_at',op.created_at,'updated_at',op.updated_at,
   'reconciliation_status',CASE WHEN w.status IN ('claimed','blocked','expired','succeeded','failed','cancelled') THEN w.status ELSE NULL END,
   'reconciliation_reason',CASE WHEN w.blocked_reason IN ('provider_pending','provider_outcome_unknown','reconciliation_exhausted') THEN w.blocked_reason ELSE NULL END) ORDER BY op.created_at DESC,op.id DESC),'[]'::jsonb)
 INTO rows FROM(SELECT * FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND invoice_id=_invoice_id ORDER BY created_at DESC,id DESC LIMIT 25) op
 LEFT JOIN public.paige_durable_work w ON w.id=op.reconciliation_work_id AND w.tenant_id=op.tenant_id AND w.intent_id=op.id
  AND w.initiating_user_id=op.actor_user_id AND w.work_kind='sales_payment_reconciliation' AND w.capability_key='sales.payment_reconcile';
 RETURN jsonb_build_object('rows',rows,'invoice_number',truth->'invoice_number','remaining_cents',truth->'remaining_cents','has_more',count_rows>25);
END $$;
REVOKE ALL ON FUNCTION public.list_sales_invoice_payment_operations(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_sales_invoice_payment_operations(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_public_sales_invoice_payment_request(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE truth jsonb; grant_row public.paige_invoice_access_grants%ROWTYPE; invoice public.paige_invoices%ROWTYPE; op_id uuid; request jsonb;
BEGIN
 -- Preserve the existing bearer contract: no alternate grant or identity store.
 truth:=public.read_public_sales_invoice(_token_hash);
 IF truth IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO grant_row FROM public.paige_invoice_access_grants WHERE token_hash=_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=grant_row.tenant_id AND id=grant_row.invoice_id
  AND status='issued' AND billing_issued_snapshot_version=grant_row.issued_snapshot_version FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 truth:=public._sales_invoice_read(invoice.tenant_id,invoice.id,0);
 SELECT id INTO op_id FROM public.paige_invoice_provider_operations WHERE tenant_id=invoice.tenant_id AND invoice_id=invoice.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF FOUND THEN request:=public._sales_invoice_payment_projection(invoice.tenant_id,invoice.id,op_id,(truth->>'remaining_cents')::bigint); END IF;
 RETURN jsonb_build_object('invoice_number',invoice.invoice_number,'remaining_cents',truth->'remaining_cents','payment_request',request);
END $$;
REVOKE ALL ON FUNCTION public.read_public_sales_invoice_payment_request(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_sales_invoice_payment_request(text) TO service_role;
-- GET-only financial reconciliation adopts the ONE durable-work envelope. These
-- narrow wrappers neither relax its general/C4 authority rules nor dispatch money.
ALTER TABLE public.paige_invoice_provider_operations ADD COLUMN IF NOT EXISTS reconciliation_work_id uuid REFERENCES public.paige_durable_work(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS sales_payment_reconciliation_work_once ON public.paige_invoice_provider_operations(reconciliation_work_id) WHERE reconciliation_work_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public._sales_payment_reconciliation_payload(_operation uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('operation_id',id,'tenant_id',tenant_id,'invoice_id',invoice_id,'client_id',client_id,
  'provider',provider,'merchant_account_id',merchant_account_id,'merchant_binding_version',merchant_binding_version,'environment',environment,
  'amount_minor',amount_minor,'currency',currency,'invoice_version',invoice_version,'issued_snapshot_version',issued_snapshot_version)
 FROM public.paige_invoice_provider_operations WHERE id=_operation
$$;
REVOKE ALL ON FUNCTION public._sales_payment_reconciliation_payload(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._sales_payment_reconciliation_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.reconciliation_work_id IS NOT NULL AND NEW.reconciliation_work_id IS DISTINCT FROM OLD.reconciliation_work_id THEN
  RAISE EXCEPTION 'Payment reconciliation identity is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.reconciliation_work_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_durable_work w WHERE w.id=NEW.reconciliation_work_id
  AND w.tenant_id=NEW.tenant_id AND w.initiating_user_id=NEW.actor_user_id AND w.intent_id=NEW.id AND w.thread_id IS NULL
  AND w.work_kind='sales_payment_reconciliation' AND w.capability_key='sales.payment_reconcile'
  AND w.scope_epoch='sales_payment_operation:'||NEW.id::text AND w.request_payload=public._sales_payment_reconciliation_payload(NEW.id)
  AND w.authority_context=jsonb_build_object('tenant_id',NEW.tenant_id::text,'actor_user_id',NEW.actor_user_id::text,
   'operation_id',NEW.id::text,'provenance','authorized_payment_system_readback','allowed_effect','provider_get_and_canonical_reconciliation')) THEN
  RAISE EXCEPTION 'Payment reconciliation scope unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._sales_payment_reconciliation_link_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS sales_payment_reconciliation_link_guard ON public.paige_invoice_provider_operations;
CREATE TRIGGER sales_payment_reconciliation_link_guard BEFORE UPDATE OF reconciliation_work_id ON public.paige_invoice_provider_operations FOR EACH ROW EXECUTE FUNCTION public._sales_payment_reconciliation_link_guard();

CREATE OR REPLACE FUNCTION public.register_sales_payment_reconciliation_work(_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; w public.paige_durable_work%ROWTYPE; context jsonb; payload jsonb;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND id=_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF op.state='prepared' OR op.dispatch_claim_token IS NULL THEN RAISE EXCEPTION 'Payment reconciliation unavailable before dispatch' USING ERRCODE='55000'; END IF;
 payload:=public._sales_payment_reconciliation_payload(op.id);
 context:=jsonb_build_object('tenant_id',op.tenant_id::text,'actor_user_id',op.actor_user_id::text,'operation_id',op.id::text,
  'provenance','authorized_payment_system_readback','allowed_effect','provider_get_and_canonical_reconciliation');
 -- The historical initiating actor is derived from the already-authorized operation.
 -- Inactive membership does not prevent confirming money already dispatched. This
 -- is intentionally NOT generic create_paige_durable_work or fresh owner authority.
 IF op.reconciliation_work_id IS NULL THEN
  INSERT INTO public.paige_durable_work(tenant_id,initiating_user_id,intent_id,thread_id,capability_key,work_kind,authority_context,scope_epoch,
   idempotency_key,lease_until,max_attempts,request_payload)
  VALUES(op.tenant_id,op.actor_user_id,op.id,NULL,'sales.payment_reconcile','sales_payment_reconciliation',context,
   'sales_payment_operation:'||op.id::text,'paige-work:'||gen_random_uuid()::text,now()+interval '5 minutes',25,payload)
  ON CONFLICT(tenant_id,initiating_user_id,intent_id) DO NOTHING;
  SELECT * INTO w FROM public.paige_durable_work WHERE tenant_id=op.tenant_id AND initiating_user_id=op.actor_user_id AND intent_id=op.id FOR UPDATE;
  IF NOT FOUND OR w.capability_key<>'sales.payment_reconcile' OR w.work_kind<>'sales_payment_reconciliation'
   OR w.thread_id IS NOT NULL OR w.authority_context IS DISTINCT FROM context OR w.request_payload IS DISTINCT FROM payload
   OR w.scope_epoch IS DISTINCT FROM 'sales_payment_operation:'||op.id::text THEN
   RAISE EXCEPTION 'Payment reconciliation identity collision' USING ERRCODE='42501'; END IF;
  UPDATE public.paige_invoice_provider_operations SET reconciliation_work_id=w.id WHERE id=op.id;
 ELSE
  SELECT * INTO w FROM public.paige_durable_work WHERE id=op.reconciliation_work_id;
 END IF;
 RETURN jsonb_build_object('work_id',w.id,'work_status',w.status,'attempt_count',w.attempt_count,'max_attempts',w.max_attempts);
END $$;
REVOKE ALL ON FUNCTION public.register_sales_payment_reconciliation_work(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_sales_payment_reconciliation_work(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.register_pending_sales_payment_reconciliation_work(_expected_tenant_id uuid,_merchant_account_id text,_environment text,_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op record; rows jsonb:='[]'; more boolean;
BEGIN
 PERFORM public._sales_payment_operation_service();
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 25 OR NOT EXISTS(SELECT 1 FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id
  AND stripe_account_id=_merchant_account_id AND provider_environment=_environment) THEN RAISE EXCEPTION 'Payment merchant unavailable' USING ERRCODE='42501'; END IF;
 FOR op IN SELECT id FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND provider='stripe'
  AND merchant_account_id=_merchant_account_id AND environment=_environment AND reconciliation_work_id IS NULL
  AND state IN ('dispatching','provider_accepted','customer_action_required','outcome_unknown') ORDER BY id LIMIT _limit
 LOOP rows:=rows||jsonb_build_array(public.register_sales_payment_reconciliation_work(_expected_tenant_id,op.id)); END LOOP;
 SELECT EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND provider='stripe'
  AND merchant_account_id=_merchant_account_id AND environment=_environment AND reconciliation_work_id IS NULL
  AND state IN ('dispatching','provider_accepted','customer_action_required','outcome_unknown')) INTO more;
 RETURN jsonb_build_object('registered',rows,'has_more',more);
END $$;
REVOKE ALL ON FUNCTION public.register_pending_sales_payment_reconciliation_work(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_pending_sales_payment_reconciliation_work(uuid,text,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sales_payment_reconciliation_work(_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.paige_durable_work%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE; rows jsonb:='[]';
BEGIN
 PERFORM public._sales_payment_operation_service();
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid reconciliation batch' USING ERRCODE='22023'; END IF;
 FOR w IN SELECT * FROM public.paige_durable_work WHERE work_kind='sales_payment_reconciliation'
  AND ((status='claimed' AND (dispatch_started_attempt<attempt_count OR lease_until<=now()))
   OR (status='blocked' AND blocked_reason IN ('provider_pending','provider_outcome_unknown') AND updated_at<=now()-
    CASE WHEN EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations pending WHERE pending.reconciliation_work_id=paige_durable_work.id
     AND pending.state='customer_action_required' AND pending.expires_at>now()) THEN interval '1 hour' ELSE interval '5 minutes' END)
   OR status='expired') ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT _limit
 LOOP
  SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE reconciliation_work_id=w.id AND tenant_id=w.tenant_id;
  IF NOT FOUND OR w.request_payload IS DISTINCT FROM public._sales_payment_reconciliation_payload(op.id)
   OR w.initiating_user_id<>op.actor_user_id OR w.intent_id<>op.id OR w.capability_key<>'sales.payment_reconcile' THEN
   RAISE EXCEPTION 'Payment reconciliation scope unavailable' USING ERRCODE='42501'; END IF;
  IF w.status='claimed' AND w.lease_until<=now() THEN
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'expired',NULL,'The previous reconciliation lease expired; checking canonical payment state.',NULL,'lease_expired',300,false);
   w.status:='expired';
  END IF;
  IF w.status IN ('blocked','expired') THEN
   IF w.attempt_count>=w.max_attempts THEN
    -- Preserve a truthful nonterminal exception. Never reset a terminal job or
    -- disguise provider ambiguity as successful payment.
    UPDATE public.paige_durable_work SET status='blocked',blocked_reason='reconciliation_exhausted',error_code='reconciliation_exhausted',lease_until=NULL,
     safe_summary='Automatic payment checks reached their limit. The payment still needs reconciliation.',updated_at=now(),version=version+1 WHERE id=w.id;
    CONTINUE;
   END IF;
   -- This attempt is reconciliation itself: GET only, and any previously applied
   -- allocation is read from the exactly-once canonical operation before proceeding.
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'claimed',NULL,'Checking the payment provider against the existing payment operation.',NULL,NULL,300,w.status='expired');
   SELECT * INTO w FROM public.paige_durable_work WHERE id=w.id;
  END IF;
  UPDATE public.paige_durable_work SET dispatch_started_attempt=attempt_count,heartbeat_at=now(),lease_until=now()+interval '5 minutes',
   safe_summary='Checking the payment provider against the existing payment operation.',updated_at=now(),version=version+1 WHERE id=w.id RETURNING * INTO w;
  rows:=rows||jsonb_build_array(jsonb_build_object('work_id',w.id,'server_idempotency_key',w.idempotency_key,'attempt_count',w.attempt_count,
   'lease_until',w.lease_until,'tenant_id',w.tenant_id,'operation_id',op.id));
 END LOOP;
 RETURN jsonb_build_object('claims',rows);
END $$;
REVOKE ALL ON FUNCTION public.claim_sales_payment_reconciliation_work(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_payment_reconciliation_work(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_sales_payment_reconciliation_work(_expected_tenant_id uuid,_work_id uuid,_server_idempotency_key text,_attempt_count integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.paige_durable_work%ROWTYPE;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO w FROM public.paige_durable_work WHERE tenant_id=_expected_tenant_id AND id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'sales_payment_reconciliation' OR w.idempotency_key IS DISTINCT FROM _server_idempotency_key
  OR w.attempt_count IS DISTINCT FROM _attempt_count OR w.dispatch_started_attempt<>_attempt_count OR w.status<>'claimed' OR w.lease_until<=now()
  OR NOT EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations op WHERE op.reconciliation_work_id=w.id AND op.tenant_id=w.tenant_id
   AND w.request_payload=public._sales_payment_reconciliation_payload(op.id)) THEN RAISE EXCEPTION 'Reconciliation lease unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.heartbeat_paige_durable_work(w.id,w.idempotency_key,300);
 RETURN jsonb_build_object('work_id',w.id,'attempt_count',w.attempt_count,'lease_until',now()+interval '5 minutes');
END $$;
REVOKE ALL ON FUNCTION public.heartbeat_sales_payment_reconciliation_work(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_sales_payment_reconciliation_work(uuid,uuid,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_sales_payment_reconciliation_work(_expected_tenant_id uuid,_work_id uuid,_server_idempotency_key text,_attempt_count integer,_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.paige_durable_work%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE; terminal text; reason text;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO w FROM public.paige_durable_work WHERE tenant_id=_expected_tenant_id AND id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'sales_payment_reconciliation' OR w.idempotency_key IS DISTINCT FROM _server_idempotency_key
  OR w.attempt_count IS DISTINCT FROM _attempt_count OR w.dispatch_started_attempt<>_attempt_count THEN RAISE EXCEPTION 'Reconciliation lease unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE reconciliation_work_id=w.id AND tenant_id=w.tenant_id;
 IF NOT FOUND OR w.request_payload IS DISTINCT FROM public._sales_payment_reconciliation_payload(op.id) THEN RAISE EXCEPTION 'Payment reconciliation scope unavailable' USING ERRCODE='42501'; END IF;
 IF _outcome IS NULL OR _outcome NOT IN ('pending','unknown','settled','failed','expired','cancelled') THEN RAISE EXCEPTION 'Invalid reconciliation outcome' USING ERRCODE='22023'; END IF;
 IF w.status IN ('succeeded','failed','cancelled') THEN
  IF w.terminal_outcome->>'operation_state' IS DISTINCT FROM op.state OR _outcome IS DISTINCT FROM op.state THEN RAISE EXCEPTION 'Reconciliation work is terminal' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('work_id',w.id,'work_status',w.status,'operation_state',op.state,'replayed',true);
 END IF;
 IF op.state IN ('settled','failed','expired','cancelled') THEN
  IF _outcome IS DISTINCT FROM op.state OR (op.state='settled' AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments p WHERE p.id=op.allocation_payment_id
   AND p.provider_operation_id=op.id AND p.evidence_kind='provider_verified' AND p.tenant_id=op.tenant_id AND p.invoice_id=op.invoice_id)) THEN
   RAISE EXCEPTION 'Canonical payment readback required' USING ERRCODE='42501'; END IF;
  RETURN public.settle_sales_payment_reconciliation_work(_expected_tenant_id,op.id);
 ELSE
  IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'Reconciliation lease unavailable' USING ERRCODE='42501'; END IF;
  IF _outcome NOT IN ('pending','unknown') THEN RAISE EXCEPTION 'Canonical payment readback required' USING ERRCODE='42501'; END IF;
  reason:=CASE WHEN w.attempt_count>=w.max_attempts THEN 'reconciliation_exhausted' WHEN _outcome='unknown' THEN 'provider_outcome_unknown' ELSE 'provider_pending' END;
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,
   CASE WHEN reason='reconciliation_exhausted' THEN 'Automatic payment checks reached their limit. The payment still needs reconciliation.'
    WHEN _outcome='unknown' THEN 'The payment could not be confirmed yet. It remains under reconciliation.' ELSE 'The provider has not confirmed settlement yet.' END,
   reason,CASE WHEN reason='provider_pending' THEN NULL ELSE reason END,300,false);
 END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=w.id;
 RETURN jsonb_build_object('work_id',w.id,'work_status',w.status,'operation_state',op.state,'blocked_reason',w.blocked_reason,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.complete_sales_payment_reconciliation_work(uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_payment_reconciliation_work(uuid,uuid,text,integer,text) TO service_role;
CREATE OR REPLACE FUNCTION public.settle_sales_payment_reconciliation_work(_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; w public.paige_durable_work%ROWTYPE; terminal text; evidence jsonb; summary text;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND id=_operation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF op.state NOT IN ('settled','failed','expired','cancelled') OR (op.state='settled' AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments p
  WHERE p.id=op.allocation_payment_id AND p.provider_operation_id=op.id AND p.evidence_kind='provider_verified'
   AND p.tenant_id=op.tenant_id AND p.invoice_id=op.invoice_id AND p.amount_cents=op.amount_minor AND p.currency=op.currency)) THEN
  RAISE EXCEPTION 'Canonical payment readback required' USING ERRCODE='42501'; END IF;
 IF op.reconciliation_work_id IS NULL THEN RETURN jsonb_build_object('work_id',NULL,'work_status',NULL,'operation_state',op.state); END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE tenant_id=op.tenant_id AND id=op.reconciliation_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'sales_payment_reconciliation' OR w.capability_key<>'sales.payment_reconcile'
  OR w.initiating_user_id<>op.actor_user_id OR w.intent_id<>op.id OR w.request_payload IS DISTINCT FROM public._sales_payment_reconciliation_payload(op.id) THEN
  RAISE EXCEPTION 'Payment reconciliation scope unavailable' USING ERRCODE='42501'; END IF;
 terminal:=CASE WHEN op.state='settled' THEN 'succeeded' ELSE 'failed' END;
 evidence:=jsonb_build_object('verified_readback',true,'operation_id',op.id,'operation_state',op.state);
 IF w.status IN ('succeeded','failed','cancelled') THEN
  IF w.status<>terminal OR w.terminal_outcome IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'Reconciliation work is terminal' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('work_id',w.id,'work_status',w.status,'operation_state',op.state,'replayed',true);
 END IF;
 summary:=CASE WHEN op.state='settled' THEN 'The provider-confirmed payment is allocated to the invoice.' ELSE 'The payment request has ended without a confirmed payment.' END;
 -- A late authenticated provider fact may satisfy exhausted/expired work. This
 -- closes that existing identity; it grants no new attempt and resets no terminal.
 -- General durable/C4 transitions remain unchanged.
 IF w.status='claimed' AND w.lease_until>now() THEN
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,terminal,evidence,summary,NULL,NULL,300,false);
 ELSE
  UPDATE public.paige_durable_work SET status=terminal,terminal_outcome=evidence,settled_at=clock_timestamp(),lease_until=NULL,
   blocked_reason=NULL,error_code=NULL,safe_summary=summary,updated_at=clock_timestamp(),version=version+1 WHERE id=w.id;
 END IF;
 PERFORM public._record_workspace_rail_event(w.tenant_id,NULL,'capability_run',w.id,0,CASE WHEN terminal='succeeded' THEN 'capability_succeeded' ELSE 'capability_failed' END,NULL,'sales_payment_reconcile');
 RETURN jsonb_build_object('work_id',w.id,'work_status',terminal,'operation_state',op.state,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.settle_sales_payment_reconciliation_work(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sales_payment_reconciliation_work(uuid,uuid) TO service_role;
COMMIT;
