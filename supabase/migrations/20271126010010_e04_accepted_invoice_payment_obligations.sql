-- EXP04 O3/O4: original accepted schedule + original invoice/payment evidence.
-- LOCAL until ordered after EXP09's already-applied26010009 and exact proof/review.
-- No table, ledger, calendar calculation, provider action or authority replacement.
BEGIN;

DO $guard$
DECLARE expected record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.read_sales_accepted_agreement(uuid,uuid,uuid)','ffc7795288582b4eca5b506e5aada042'),
  ('public._paige_accepted_commercial_payload(public.paige_agreements)','235026b37dfde7b0f151588c680c8ca9'),
  ('public._sales_collection_accepted_total_evidence(public.tenant_client_agreements)','86404f3e9e26ef646e7c2db458f9218b'),
  ('public._sales_invoice_balance_rows(uuid,uuid)','8c69e94f10a5115c7af42b8781b4fd41')
 ) AS source(signature,body_md5) LOOP
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid=pg_catalog.to_regprocedure(expected.signature)) IS DISTINCT FROM expected.body_md5 THEN
   RAISE EXCEPTION 'Original accepted invoice source changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $guard$;

-- Replay accepts only the original writers or these exact reviewed forward bodies.
-- Another concurrent writer revision must be reconciled instead of overwritten.
DO $writer_guard$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)','f613c53896ad1749049e5b3d89f7ee60','8bae7da7b9efc5c5ed21615b57df51ff'),
  ('public.claim_sales_invoice_payment_request(uuid,uuid,uuid)','fa5f6d0fdc4251c01d46544e86297abc','6a542fbff334c53d43c4fe6d734d138c'),
  ('public.list_sales_invoice_payment_operations(uuid,uuid)','d168b91b94d425e0b154cc8b69dd04cf','e93247daa8af2ae7a90c098e8a65984c')
 ) AS source(signature,original_md5,forward_md5) LOOP
  SELECT pg_catalog.md5(p.prosrc) INTO actual FROM pg_catalog.pg_proc p
   WHERE p.oid=pg_catalog.to_regprocedure(expected.signature);
  IF actual IS DISTINCT FROM expected.original_md5 AND actual IS DISTINCT FROM expected.forward_md5 THEN
   RAISE EXCEPTION 'Original payment writer changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $writer_guard$;

-- Private composition only. The caller owns the original invoice lock and authority;
-- public entry below first invokes the unchanged original authenticated owner reader.
CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(
 _invoice public.paige_invoices,_signing_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $source$
DECLARE signing public.paige_agreements%ROWTYPE; terms public.tenant_client_agreements%ROWTYPE;
 payload jsonb; effective jsonb; base jsonb; obligations jsonb:='[]'::jsonb;
 obligation jsonb; v_reference jsonb; balance record; sequence bigint; scheduled bigint;
 allocated numeric; allocated_total numeric:=0; scheduled_total bigint:=0;
BEGIN
 IF _invoice.id IS NULL OR _invoice.tenant_id IS NULL OR _invoice.contact_id IS NULL OR _signing_id IS NULL THEN
  RAISE EXCEPTION 'Accepted invoice source unavailable' USING ERRCODE='22023';
 END IF;
 base:=pg_catalog.jsonb_build_object('schema_version',1,'tenant_id',_invoice.tenant_id,
  'client_id',_invoice.contact_id,'invoice_id',_invoice.id,
  'invoice_version',_invoice.billing_lifecycle_version,'invoice_draft_version',_invoice.billing_draft_version,
  'issued_snapshot_version',_invoice.billing_issued_snapshot_version,'obligations','[]'::jsonb);
 IF _invoice.status IS DISTINCT FROM 'issued' OR _invoice.billing_issued_snapshot_version IS NULL
  OR _invoice.billing_issued_at IS NULL OR _invoice.billing_document IS NULL THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','invoice_not_issued');
 END IF;
 SELECT * INTO signing FROM public.paige_agreements WHERE id=_signing_id
  AND tenant_id=_invoice.tenant_id AND contact_id=_invoice.contact_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable'); END IF;
 SELECT * INTO terms FROM public.tenant_client_agreements WHERE id=signing.commercial_terms_id
  AND tenant_id=_invoice.tenant_id AND contact_id=_invoice.contact_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable'); END IF;
 IF terms.status IS DISTINCT FROM 'active' THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','commercial_terms_inactive');
 END IF;
 -- These original helpers alone own consent, exact accepted payload/economics,
 -- effectuation-operation and Rail provenance. Do not copy their evidence joins.
 payload:=public._paige_accepted_commercial_payload(signing);
 effective:=public._sales_collection_accepted_total_evidence(terms);
 IF payload IS NULL OR effective IS NULL
  OR payload->'schema_version' IS DISTINCT FROM '2'::jsonb
  OR terms.effective_signing_id IS DISTINCT FROM signing.id
  OR _invoice.billing_draft#>>'{agreement_snapshot,id}' IS DISTINCT FROM signing.id::text
  OR _invoice.billing_draft#>>'{commercial_terms_reference,id}' IS DISTINCT FROM terms.id::text
  OR payload#>>'{source,invoice_id}' IS DISTINCT FROM _invoice.id::text
  OR payload#>'{source,invoice_draft_version}' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_draft_version)
  OR payload#>>'{source,client_id}' IS DISTINCT FROM _invoice.contact_id::text
  OR payload#>>'{source,tenant_id}' IS DISTINCT FROM _invoice.tenant_id::text
  OR payload#>>'{source,agreement_id}' IS DISTINCT FROM signing.id::text
  OR payload#>>'{source,terms_id}' IS DISTINCT FROM terms.id::text
  OR payload#>'{source,terms_version}' IS DISTINCT FROM pg_catalog.to_jsonb(terms.effective_terms_version)
  OR signing.commercial_presentation->>'payload_digest' IS DISTINCT FROM terms.effective_source_digest
  OR payload->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency)
  OR payload->'principal_minor' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.amount_total_cents)
  OR pg_catalog.jsonb_typeof(payload->'obligations') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(payload->'obligations') NOT BETWEEN 1 AND 240 THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 SELECT * INTO STRICT balance FROM public._sales_invoice_balance_rows(_invoice.tenant_id,_invoice.id);
 -- Original balance source already distinguishes TEST provider evidence. It must
 -- not become proof that a customer's actual commercial obligation was fulfilled.
 IF balance.test_provider_minor>0 THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','test_payment_evidence');
 END IF;
 FOR obligation,sequence IN SELECT value,ordinality FROM pg_catalog.jsonb_array_elements(payload->'obligations') WITH ORDINALITY LOOP
  IF obligation->'sequence' IS DISTINCT FROM pg_catalog.to_jsonb(sequence)
   OR pg_catalog.jsonb_typeof(obligation->'amount_cents') IS DISTINCT FROM 'number'
   OR coalesce(obligation->>'amount_cents','') !~ '^(0|[1-9][0-9]{0,9})$'
   OR (obligation->>'amount_cents')::bigint>2147483647
   OR obligation->>'currency' IS DISTINCT FROM payload->>'currency'
   OR coalesce(obligation->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
  END IF;
  scheduled:=(obligation->>'amount_cents')::bigint;
  scheduled_total:=scheduled_total+scheduled;
  v_reference:=pg_catalog.jsonb_build_object('commercial_terms_id',terms.id,'signing_id',signing.id,
   'signing_version',signing.version,'terms_version',terms.effective_terms_version,'sequence',sequence);
  -- Only an original receipt linked to the exact immutable settled provider
  -- operation can allocate this target here. No FIFO, pending checkout or guessed
  -- manual receipt assignment. Existing manual/correction allocation is a separate
  -- original-writer integration; absence is reported below, never invented.
  SELECT coalesce(pg_catalog.sum(payment.amount_cents),0) INTO allocated
   FROM public.paige_invoice_payments payment
   JOIN public.paige_invoice_provider_operations operation ON operation.id=payment.provider_operation_id
    AND operation.tenant_id=payment.tenant_id AND operation.invoice_id=payment.invoice_id
   WHERE payment.tenant_id=_invoice.tenant_id AND payment.invoice_id=_invoice.id
    AND payment.kind='receipt' AND payment.evidence_kind='provider_verified'
    AND payment.provider_environment='live' AND operation.environment='live'
    AND operation.state='settled' AND operation.allocation_payment_id=payment.id
    AND operation.client_id=_invoice.contact_id AND operation.amount_minor=payment.amount_cents
    AND payment.currency=operation.currency AND payment.provider=operation.provider
    AND operation.currency=payload->>'currency' AND operation.verified_readback IS NOT NULL
    AND operation.command->>'action'='invoice.payment_request'
    AND operation.command#>'{obligation,reference}'=v_reference
    AND operation.command#>>'{obligation,source_digest}'=terms.effective_source_digest
    AND operation.command#>>'{obligation,due_date}'=obligation->>'due_date'
    AND operation.command#>'{obligation,scheduled_minor}'=pg_catalog.to_jsonb(scheduled)
    AND operation.command#>'{obligation,remaining_minor}'=pg_catalog.to_jsonb(operation.amount_minor);
  IF allocated<0 OR allocated>scheduled THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_conflict');
  END IF;
  allocated_total:=allocated_total+allocated;
  IF scheduled>0 THEN
   obligations:=obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'reference',v_reference,'source_digest',terms.effective_source_digest,'due_date',obligation->>'due_date',
    'scheduled_minor',scheduled,'remaining_minor',scheduled-allocated));
  END IF;
 END LOOP;
 IF scheduled_total IS DISTINCT FROM _invoice.amount_total_cents::bigint THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 IF allocated_total IS DISTINCT FROM balance.allocated_minor THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required');
 END IF;
 RETURN base||pg_catalog.jsonb_build_object('state','available','obligations',obligations);
END $source$;
REVOKE ALL ON FUNCTION public._sales_invoice_accepted_obligations(public.paige_invoices,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Distinct API admission: Supabase does not support overloaded API functions.
-- Compose the unchanged original three-argument reader/OID/ACL/JSON; no fallback.
CREATE OR REPLACE FUNCTION public.read_sales_accepted_invoice_obligations(
 _expected_tenant_id uuid,_invoice_id uuid,_agreement_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $read$
DECLARE original jsonb; observation jsonb; invoice public.paige_invoices%ROWTYPE;
BEGIN
 original:=public.read_sales_accepted_agreement(_expected_tenant_id,_invoice_id,_agreement_id);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501'; END IF;
 observation:=public._sales_invoice_accepted_obligations(invoice,_agreement_id);
 IF original->>'state' IS DISTINCT FROM 'recorded' THEN
  observation:=observation||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable','obligations','[]'::jsonb);
 END IF;
 -- The new source locks must not preserve a role/workspace retired while waiting.
 IF auth.uid() IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 RETURN original||pg_catalog.jsonb_build_object('payment_obligations',observation);
END $read$;
REVOKE ALL ON FUNCTION public.read_sales_accepted_invoice_obligations(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_accepted_invoice_obligations(uuid,uuid,uuid) TO authenticated;

-- Original command service can resolve only the exact accepted selector after
-- canonical explicit-actor authorization. This is NOT a caller-JWT substitute.
CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_obligation(
 _actor_user_id uuid,_expected_tenant_id uuid,_invoice_id uuid,_reference jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $payment_read$
DECLARE invoice public.paige_invoices%ROWTYPE; observation jsonb; obligation jsonb;
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF pg_catalog.jsonb_typeof(_reference) IS DISTINCT FROM 'object'
  OR coalesce(_reference->>'signing_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'Invalid accepted payment selector' USING ERRCODE='22023';
 END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 observation:=public._sales_invoice_accepted_obligations(invoice,(_reference->>'signing_id')::uuid);
 IF observation->>'state' IS DISTINCT FROM 'available' THEN
  RAISE EXCEPTION 'Accepted payment obligation unavailable; review again' USING ERRCODE='40001';
 END IF;
 SELECT item.value INTO obligation FROM pg_catalog.jsonb_array_elements(observation->'obligations') item
  WHERE item.value->'reference'=_reference;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001'; END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 RETURN pg_catalog.jsonb_build_object('tenant_id',invoice.tenant_id,'client_id',invoice.contact_id,
  'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'issued_snapshot_version',invoice.billing_issued_snapshot_version,'obligation',obligation);
END $payment_read$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb) TO service_role;

-- One final target check for the ORIGINAL preparation and dispatch writers.
-- Their canonical actor/operation/invoice locks and approval remain authoritative.
CREATE OR REPLACE FUNCTION public._sales_invoice_require_accepted_obligation(
 _invoice public.paige_invoices,_command jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $target$
DECLARE observation jsonb; obligation jsonb;
BEGIN
 -- Existing unbound full/partial/deposit/installment requests retain their contract.
 IF NOT (_command ? 'obligation') THEN RETURN; END IF;
 IF pg_catalog.jsonb_typeof(_command->'obligation') IS DISTINCT FROM 'object'
  OR coalesce(_command->>'purpose','') NOT IN ('deposit','installment')
  OR coalesce(_command#>>'{obligation,reference,signing_id}','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'Invalid accepted payment obligation' USING ERRCODE='22023';
 END IF;
 IF _command->>'invoice_id' IS DISTINCT FROM _invoice.id::text
  OR _command->>'client_id' IS DISTINCT FROM _invoice.contact_id::text
  OR _command->'expected_version' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_lifecycle_version)
  OR _command->'issued_snapshot_version' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_issued_snapshot_version)
  OR _command->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency) THEN
  RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001';
 END IF;
 observation:=public._sales_invoice_accepted_obligations(_invoice,(_command#>>'{obligation,reference,signing_id}')::uuid);
 IF observation->>'state' IS DISTINCT FROM 'available' THEN
  RAISE EXCEPTION 'Accepted payment obligation unavailable; review again' USING ERRCODE='40001';
 END IF;
 SELECT item.value INTO obligation FROM pg_catalog.jsonb_array_elements(observation->'obligations') item
  WHERE item.value=_command->'obligation';
 IF NOT FOUND OR obligation->'remaining_minor' IS DISTINCT FROM _command->'amount_minor'
  OR (obligation->>'remaining_minor')::bigint<=0 THEN
  RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001';
 END IF;
 IF _command->>'purpose'='deposit' AND obligation#>'{reference,sequence}' IS DISTINCT FROM '1'::jsonb THEN
  RAISE EXCEPTION 'Only the initial accepted obligation can be a deposit' USING ERRCODE='22023';
 END IF;
END $target$;
REVOKE ALL ON FUNCTION public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve original service-only API/OID/ACL and all incumbent control ordering.
CREATE OR REPLACE FUNCTION public.prepare_sales_invoice_payment_request(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _command jsonb, _governance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.paige_invoices%ROWTYPE; m public.tenant_stripe_accounts%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE; balance bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>4000
  OR (SELECT count(*) FROM jsonb_object_keys(_command))<>(CASE WHEN _command ? 'obligation' THEN 13 ELSE 12 END)
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN ('action','invoice_id','client_id','expected_version','issued_snapshot_version','provider','merchant_account_id','merchant_binding_version','environment','amount_minor','currency','purpose','obligation'))
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
 PERFORM public._sales_invoice_require_accepted_obligation(r,_command);
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
END $function$;

CREATE OR REPLACE FUNCTION public.claim_sales_invoice_payment_request(_expected_tenant_id uuid, _operation_id uuid, _claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
 PERFORM public._sales_invoice_require_accepted_obligation(r,op.command);
 UPDATE public.paige_invoice_provider_operations SET state='dispatching',dispatch_claim_token=_claim_token,dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=op.id RETURNING * INTO op;
 PERFORM public.record_capability_run(_expected_tenant_id,op.actor_user_id,'sales_dispatch_payment_request','capability_succeeded',md5(op.id::text||':dispatching')::uuid,NULL);
 -- Server-only response. The claim token must never be forwarded to model/customer callers.
 RETURN to_jsonb(op);
END $function$;


CREATE OR REPLACE FUNCTION public.list_sales_invoice_payment_operations(_expected_tenant_id uuid, _invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
   'reconciliation_reason',CASE WHEN w.blocked_reason IN ('provider_pending','provider_outcome_unknown','reconciliation_exhausted') THEN w.blocked_reason ELSE NULL END) || CASE WHEN op.command ? 'obligation' THEN jsonb_build_object('obligation_reference',op.command#>'{obligation,reference}') ELSE '{}'::jsonb END ORDER BY op.created_at DESC,op.id DESC),'[]'::jsonb)
 INTO rows FROM(SELECT * FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND invoice_id=_invoice_id ORDER BY created_at DESC,id DESC LIMIT 25) op
 LEFT JOIN public.paige_durable_work w ON w.id=op.reconciliation_work_id AND w.tenant_id=op.tenant_id AND w.intent_id=op.id
  AND w.initiating_user_id=op.actor_user_id AND w.work_kind='sales_payment_reconciliation' AND w.capability_key='sales_invoice.payment_request';
 RETURN jsonb_build_object('rows',rows,'invoice_number',truth->'invoice_number','remaining_cents',truth->'remaining_cents','has_more',count_rows>25);
END $function$;

REVOKE ALL ON FUNCTION public.list_sales_invoice_payment_operations(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_sales_invoice_payment_operations(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.claim_sales_invoice_payment_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_invoice_payment_request(uuid,uuid,uuid) TO service_role;

DO $preserve$
BEGIN
 IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
     WHERE p.oid='public.read_sales_accepted_agreement(uuid,uuid,uuid)'::regprocedure)
    IS DISTINCT FROM 'ffc7795288582b4eca5b506e5aada042' THEN
  RAISE EXCEPTION 'Original accepted agreement reader must remain unchanged' USING ERRCODE='23514';
 END IF;
END $preserve$;
COMMIT;
