-- INERT O5 companion: original accepted source and original payment writer checks.
-- Not a migration/activation. No receipt/history/provider/approval/tenant rewrite.
DO $original_consumers$
DECLARE r record;p pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','4f52d722c9b965de563aa307e94e0f31','60f37a887ee106ef7761260fdeb6b637',false,'search_path=""'),
('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)','fd0ec0aabf95d46b8f052af027cbf6ce','bdb0960fa3d88b21cca90b79636dc7e1',false,'search_path=""'),
('public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb)','1de192b462e93708741b3933c15b0b8b','e07fdfc39975c26c2ec07f0ac290ba2c',false,'search_path=""'),
('public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)','8bae7da7b9efc5c5ed21615b57df51ff','efefcdbf889d8524bd2b2440c4b8e055',true,'search_path=pg_catalog, public'),
('public.claim_sales_invoice_payment_request(uuid,uuid,uuid)','6a542fbff334c53d43c4fe6d734d138c','316accdf44a20806402c40cf690f0b14',true,'search_path=pg_catalog, public'),
('public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)','d68a90d2773bbb1700fb29c89966229e','17310e2c68bc386ecbc0f2850476006d',true,'search_path=pg_catalog, public')
,
('public.read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)','662fc0645d50fa24d3a0626d22598e51','04bfed78729d469de33c16c820358859',true,'search_path=""')
,
('public._sales_invoice_payment_request_mutation_guard()','6036f48c4bfd0c46fd20803be0e29070','ccbc654b650c3a096ae9779646448a5f',true,'search_path=pg_catalog, public'),
('public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)','d32856b434999f944b88a1499124c913','950fdbc386da780ae6ccefa89d0a0043',true,'search_path=""')
 ) x(signature,before_hash,after_hash,definer,setting) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF NOT FOUND OR md5(p.prosrc) NOT IN (r.before_hash,r.after_hash)
  OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM r.definer
  OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
  OR p.pronargdefaults<>0 OR p.proconfig IS DISTINCT FROM ARRAY[r.setting]
  OR p.proargnames IS DISTINCT FROM (CASE r.signature
 WHEN 'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)' THEN ARRAY['_invoice','_signing_id']
 WHEN 'public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)' THEN ARRAY['_tenant','_invoice','_evidence_version','_proposal','invoice_id','financial_position']
 WHEN 'public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb)' THEN ARRAY['_invoice','_command']
 WHEN 'public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)' THEN ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance']
 WHEN 'public.claim_sales_invoice_payment_request(uuid,uuid,uuid)' THEN ARRAY['_expected_tenant_id','_operation_id','_claim_token']
 WHEN 'public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)' THEN ARRAY['_expected_tenant_id','_operation_id','_claim_token','_readback']
 WHEN 'public.read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)' THEN ARRAY['_actor_user_id','_expected_tenant_id','_invoice_id','_reference']
 WHEN 'public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)' THEN ARRAY['_expected_tenant_id','_operation_id','_claim_token','_expected_observation_version','_snapshot','_reference'] END)
  OR p.proacl::text IS DISTINCT FROM (CASE WHEN r.signature='public._sales_invoice_payment_request_mutation_guard()' THEN '{postgres=X/postgres}' WHEN r.definer THEN '{postgres=X/postgres,service_role=X/postgres}' ELSE '{postgres=X/postgres}' END) THEN
  RAISE EXCEPTION 'Original financial consumer source/authority changed; reconcile before applying' USING ERRCODE='23514';
 END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)','56ae7991f59c2d40d5a6bea5fae562ad'),
('public._sales_invoice_collectible_balance(public.paige_invoices)','97ad63a1e9284ae38d8fade870f1c119')
 ) x(signature,body_hash) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF FOUND AND (md5(p.prosrc)<>r.body_hash OR pg_get_userbyid(p.proowner)<>'postgres'
  OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
  OR p.pronargdefaults<>0 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proretset OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM (CASE r.signature WHEN 'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)' THEN ARRAY['_invoice','_signing_id','_evidence_version'] ELSE ARRAY['_invoice'] END)
  OR p.prorettype IS DISTINCT FROM (CASE r.signature WHEN 'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)' THEN 'jsonb'::regtype ELSE 'bigint'::regtype END)
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Private financial consumer source/authority changed; reconcile before applying' USING ERRCODE='23514';
 END IF;
 END LOOP;
END $original_consumers$;

CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(_invoice paige_invoices, _signing_id uuid, _evidence_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE signing public.paige_agreements%ROWTYPE; terms public.tenant_client_agreements%ROWTYPE;
 payload jsonb; effective jsonb; base jsonb; obligations jsonb:='[]'::jsonb;
 obligation jsonb; v_reference jsonb; balance record; sequence bigint; scheduled bigint;
 allocated numeric; allocated_total numeric:=0; scheduled_total bigint:=0; manual_allocations jsonb; manual_allocated numeric;
BEGIN
 IF _evidence_version IS NULL OR _evidence_version NOT IN (1,3) THEN
  RAISE EXCEPTION 'Accepted obligation source version unavailable' USING ERRCODE='22023';END IF;
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
 IF _evidence_version=1 THEN
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id);
 -- Original allocation evidence below is LIVE or explicitly business-recorded.
 -- TEST never enters actual receivable, cannot fulfill an obligation and need not
 -- hide the customer's still-outstanding accepted payment plan.
 manual_allocations:=public._sales_invoice_manual_allocations(_invoice);
 IF manual_allocations IS NULL THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required'); END IF;
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
  -- manual receipt assignment. Explicit business-recorded allocations below use
  -- the SAME original immutable operation/receipt; absence stays unassigned.
  IF _evidence_version=3 THEN allocated:=0; ELSE
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
  SELECT coalesce(pg_catalog.sum((a.value->>'amount_cents')::bigint),0) INTO manual_allocated
   FROM pg_catalog.jsonb_array_elements(manual_allocations) a
   WHERE a.value#>'{obligation,reference}'=v_reference
    AND a.value#>>'{obligation,source_digest}'=terms.effective_source_digest
    AND a.value#>>'{obligation,due_date}'=obligation->>'due_date'
    AND a.value#>'{obligation,scheduled_minor}'=pg_catalog.to_jsonb(scheduled);
  allocated:=allocated+manual_allocated;
  IF allocated<0 OR allocated>scheduled THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_conflict');
  END IF;
  allocated_total:=allocated_total+allocated;
  END IF;
  IF scheduled>0 THEN
   obligations:=obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'reference',v_reference,'source_digest',terms.effective_source_digest,'due_date',obligation->>'due_date',
    'scheduled_minor',scheduled,'remaining_minor',scheduled-allocated));
  END IF;
 END LOOP;
 IF scheduled_total IS DISTINCT FROM _invoice.amount_total_cents::bigint THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 IF _evidence_version=1 THEN
  IF allocated_total IS DISTINCT FROM balance.receivable_allocated_minor THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required');
  END IF;
 END IF;
 RETURN base||pg_catalog.jsonb_build_object('state','available','obligations',obligations)
  ||CASE WHEN _evidence_version=3 THEN pg_catalog.jsonb_build_object('financial_source_only',true) ELSE '{}'::jsonb END;
END $function$;
REVOKE ALL ON FUNCTION public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_collectible_balance(_invoice public.paige_invoices)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $collectible$
DECLARE position jsonb; amount bigint;
BEGIN
 SELECT b.financial_position INTO STRICT position
 FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id,3,NULL::jsonb) b;
 IF position->>'financial_standing' IS DISTINCT FROM 'recorded'
  OR jsonb_typeof(position->'actual_outstanding_minor') IS DISTINCT FROM 'number'
  OR coalesce(position->>'actual_outstanding_minor','') !~ '^(0|[1-9][0-9]{0,9})$' THEN
  RAISE EXCEPTION 'Original invoice financial verification required before a payment request' USING ERRCODE='40001';END IF;
 amount:=(position->>'actual_outstanding_minor')::bigint;
 IF amount>2147483647 THEN RAISE EXCEPTION 'Original invoice financial amount unavailable' USING ERRCODE='55000';END IF;
 RETURN amount;
END $collectible$;
REVOKE ALL ON FUNCTION public._sales_invoice_collectible_balance(public.paige_invoices) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(_invoice paige_invoices, _signing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 RETURN public._sales_invoice_accepted_obligations(_invoice,_signing_id,1);
END $function$;

CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid,_evidence_version integer,_proposal jsonb)
RETURNS TABLE(invoice_id uuid,financial_position jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; source jsonb; payment_position jsonb; history jsonb;
 positions jsonb; histories jsonb; original_histories jsonb; accepted jsonb; targets jsonb; target jsonb;
 matched jsonb; gross numeric; retained numeric; credits numeric; manual numeric; scheduled numeric;
 outstanding numeric:=0;refund_payable numeric:=0;total_credit numeric:=0;total_gross numeric:=0;
 known boolean:=true; proposed boolean:=false; has_plan boolean; source_hash text; projected jsonb:='[]'; manual_allocations jsonb; total_manual numeric:=0;
BEGIN
 IF _tenant IS NULL OR _invoice IS NULL OR _evidence_version IS DISTINCT FROM 3 THEN
  RAISE EXCEPTION 'Financial evidence version unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=_invoice AND i.tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 SELECT b.financial_position INTO STRICT source FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3) b;
 positions:=source->'provider_payment_positions';histories:='[]';original_histories:='[]';
 IF jsonb_typeof(positions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Original payment positions unavailable' USING ERRCODE='55000';END IF;
 IF _proposal IS NOT NULL THEN
  PERFORM public._sales_invoice_provider_disposition_command(_proposal);
  IF _proposal->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice)
   OR _proposal->'expected_version' IS DISTINCT FROM to_jsonb(invoice.billing_lifecycle_version) THEN
   RAISE EXCEPTION 'Invoice financial source changed' USING ERRCODE='40001';END IF;
 END IF;
 FOR payment_position IN SELECT value FROM jsonb_array_elements(positions) WHERE value->>'environment'='live' LOOP
  history:=public._sales_invoice_provider_disposition_history(invoice,payment_position);
  original_histories:=original_histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
  IF _proposal IS NOT NULL AND payment_position->'provider_operation_id'=_proposal->'provider_operation_id' THEN
   IF payment_position->'verification_pending' IS DISTINCT FROM 'false'::jsonb OR payment_position->'retained_minor'='null'::jsonb THEN
    RAISE EXCEPTION 'Original payment verification pending' USING ERRCODE='55000';END IF;
   IF payment_position->'observation_id' IS DISTINCT FROM _proposal->'observation_id'
    OR payment_position->'observation_version' IS DISTINCT FROM _proposal->'observation_version'
    OR history->'version' IS DISTINCT FROM _proposal->'expected_disposition_version' THEN
    RAISE EXCEPTION 'Original payment decision source changed' USING ERRCODE='40001';END IF;
   IF _proposal->>'decision'='credit_returned_principal' AND (_proposal->>'credit_minor')::bigint>(payment_position->>'captured_minor')::bigint THEN
    RAISE EXCEPTION 'Credit exceeds original captured principal' USING ERRCODE='22023';END IF;
   history:=history||jsonb_build_object('credit_minor',CASE WHEN _proposal->>'decision'='balance_due' THEN 0 ELSE (_proposal->>'credit_minor')::bigint END,
    'observation_id',_proposal->'observation_id','observation_version',_proposal->'observation_version');
   proposed:=true;
  END IF;
  known:=known AND payment_position->'verification_pending'='false'::jsonb
   AND ((history->'version'='0'::jsonb AND payment_position->'commercial_review_required'='false'::jsonb) OR
    (history->'observation_id'=payment_position->'observation_id' AND history->'observation_version'=payment_position->'observation_version'));
  histories:=histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
 END LOOP;
 IF _proposal IS NOT NULL AND NOT proposed THEN RAISE EXCEPTION 'Original LIVE payment unavailable' USING ERRCODE='42501';END IF;
 has_plan:=invoice.billing_draft#>'{agreement_snapshot,id}' IS NOT NULL OR invoice.billing_draft#>'{commercial_terms_reference,id}' IS NOT NULL;
 IF has_plan THEN
  IF coalesce(invoice.billing_draft#>>'{agreement_snapshot,id}','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Original accepted obligation unavailable' USING ERRCODE='55000';END IF;
  accepted:=public._sales_invoice_accepted_obligations(invoice,(invoice.billing_draft#>>'{agreement_snapshot,id}')::uuid,3);
  IF accepted->>'state' IS DISTINCT FROM 'available' THEN
   RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing','allocation_required','actual_outstanding_minor',NULL,
    'refund_payable_minor',NULL,'credit_minor',NULL,'obligations','[]'::jsonb,'accepted_source_state',accepted->>'reason');RETURN;
  END IF;
  targets:=accepted->'obligations';
  manual_allocations:=public._sales_invoice_manual_allocations(invoice);
  IF manual_allocations IS NULL THEN RAISE EXCEPTION 'Original manual allocation required' USING ERRCODE='55000';END IF;
 ELSE
  targets:=jsonb_build_array(jsonb_build_object('reference',NULL,'scheduled_minor',invoice.amount_total_cents,
   'remaining_minor',source->'receivable_remaining_minor'));
 END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(targets) LOOP
  scheduled:=(target->>'scheduled_minor')::numeric;gross:=0;retained:=0;credits:=0;
  FOR payment_position IN SELECT value FROM jsonb_array_elements(histories) LOOP
   IF NOT has_plan OR (payment_position#>'{obligation,reference}'=target->'reference'
    AND payment_position#>'{obligation,source_digest}'=target->'source_digest'
    AND payment_position#>'{obligation,due_date}'=target->'due_date'
    AND payment_position#>'{obligation,scheduled_minor}'=target->'scheduled_minor') THEN
    gross:=gross+(payment_position->>'captured_minor')::numeric;
    retained:=retained+coalesce((payment_position->>'retained_minor')::numeric,0);
    credits:=credits+(payment_position#>>'{financial_decision,credit_minor}')::numeric;
   END IF;
  END LOOP;
  total_gross:=total_gross+gross;
  IF has_plan THEN
   SELECT coalesce(sum((a.value->>'amount_cents')::numeric),0) INTO manual FROM jsonb_array_elements(manual_allocations) a
    WHERE a.value#>'{obligation,reference}'=target->'reference'
     AND a.value#>'{obligation,source_digest}'=target->'source_digest'
     AND a.value#>'{obligation,due_date}'=target->'due_date'
     AND a.value#>'{obligation,scheduled_minor}'=target->'scheduled_minor';
  ELSE manual:=(source->>'manual_minor')::numeric;END IF;
  total_manual:=total_manual+manual;
  IF manual<0 OR credits<0 OR credits>scheduled THEN
   RAISE EXCEPTION 'Original obligation allocation conflict' USING ERRCODE='55000';END IF;
  outstanding:=outstanding+greatest(scheduled-credits-manual-retained,0);
  refund_payable:=refund_payable+greatest(manual+retained-(scheduled-credits),0);
  total_credit:=total_credit+credits;
  projected:=projected||jsonb_build_array(target||jsonb_build_object('credit_minor',credits,'actual_allocated_minor',CASE WHEN known THEN manual+retained END,
   'actual_outstanding_minor',CASE WHEN known THEN greatest(scheduled-credits-manual-retained,0) END,
   'refund_payable_minor',CASE WHEN known THEN greatest(manual+retained-(scheduled-credits),0) END));
 END LOOP;
 IF total_gross IS DISTINCT FROM (source->>'live_provider_minor')::numeric
  OR total_manual IS DISTINCT FROM (source->>'manual_minor')::numeric THEN
  RAISE EXCEPTION 'Original obligation allocation required' USING ERRCODE='55000';END IF;
 source_hash:=encode(sha256(convert_to(jsonb_build_object('invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'client_id',invoice.contact_id,'document_digest',invoice.billing_document_digest,'source',source,
  'original_payment_decisions',original_histories,'accepted_obligations',targets,'manual_allocations',manual_allocations)::text,'UTF8')),'hex');
 RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing',CASE WHEN known THEN 'recorded' ELSE 'needs_review' END,
  'actual_outstanding_minor',CASE WHEN known THEN outstanding END,'refund_payable_minor',CASE WHEN known THEN refund_payable END,
  'credit_minor',total_credit,'obligations',projected,'provider_decisions',histories,'original_payment_decisions',original_histories,
  'financial_source_hash',source_hash);
END $$;

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
 SELECT b.financial_position INTO STRICT observation FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id,3,NULL::jsonb) b;
 IF observation->>'financial_standing' IS DISTINCT FROM 'recorded' THEN
  RAISE EXCEPTION 'Accepted payment obligation unavailable; review again' USING ERRCODE='40001';
 END IF;
 SELECT pg_catalog.jsonb_build_object('reference',item.value->'reference','source_digest',item.value->'source_digest',
  'due_date',item.value->'due_date','scheduled_minor',item.value->'scheduled_minor','remaining_minor',item.value->'actual_outstanding_minor')
 INTO obligation FROM pg_catalog.jsonb_array_elements(observation->'obligations') item
 WHERE pg_catalog.jsonb_build_object('reference',item.value->'reference','source_digest',item.value->'source_digest',
  'due_date',item.value->'due_date','scheduled_minor',item.value->'scheduled_minor','remaining_minor',item.value->'actual_outstanding_minor')=_command->'obligation';
 IF NOT FOUND OR obligation->'remaining_minor' IS DISTINCT FROM _command->'amount_minor'
  OR (obligation->>'remaining_minor')::bigint<=0 THEN
  RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001';
 END IF;
 IF _command->>'purpose'='deposit' AND obligation#>'{reference,sequence}' IS DISTINCT FROM '1'::jsonb THEN
  RAISE EXCEPTION 'Only the initial accepted obligation can be a deposit' USING ERRCODE='22023';
 END IF;
END $target$;

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
 balance:=public._sales_invoice_collectible_balance(r);
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
 balance:=public._sales_invoice_collectible_balance(r);
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
 remaining:=public._sales_invoice_collectible_balance(invoice);
 IF remaining<op.amount_minor THEN RAISE EXCEPTION 'Verified payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_require_accepted_obligation(invoice,op.command);
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

CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_obligation(
 _actor_user_id uuid,_expected_tenant_id uuid,_invoice_id uuid,_reference jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $payment_read$
DECLARE invoice public.paige_invoices%ROWTYPE; observation jsonb; obligation jsonb; selector jsonb;
 financial_mode boolean:=coalesce(_reference ? 'financial_evidence_version',false);
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF financial_mode THEN
  IF pg_catalog.jsonb_typeof(_reference) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(_reference::text)>4000
   OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(_reference))<>2
   OR _reference-ARRAY['financial_evidence_version','reference']<>'{}'::jsonb
   OR _reference->'financial_evidence_version' IS DISTINCT FROM '3'::jsonb THEN
   RAISE EXCEPTION 'Invalid payment financial context request' USING ERRCODE='22023';END IF;
  selector:=CASE WHEN _reference->'reference'='null'::jsonb THEN NULL ELSE _reference->'reference' END;
 ELSE selector:=_reference;END IF;
 IF (NOT financial_mode OR selector IS NOT NULL) AND (pg_catalog.jsonb_typeof(selector) IS DISTINCT FROM 'object'
  OR coalesce(selector->>'signing_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
  RAISE EXCEPTION 'Invalid accepted payment selector' USING ERRCODE='22023';
 END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF financial_mode AND (invoice.status IS DISTINCT FROM 'issued' OR invoice.billing_issued_snapshot_version IS NULL
  OR invoice.billing_issued_at IS NULL OR invoice.billing_document IS NULL) THEN
  RAISE EXCEPTION 'Invoice changed or unavailable for payment' USING ERRCODE='40001';END IF;
 SELECT b.financial_position INTO STRICT observation FROM public._sales_invoice_financial_position_rows(invoice.tenant_id,invoice.id,3,NULL::jsonb) b;
 IF observation->>'financial_standing' IS DISTINCT FROM 'recorded' THEN
  RAISE EXCEPTION 'Accepted payment obligation unavailable; review again' USING ERRCODE='40001';
 END IF;
 IF selector IS NOT NULL THEN
 SELECT pg_catalog.jsonb_build_object('reference',item.value->'reference','source_digest',item.value->'source_digest',
  'due_date',item.value->'due_date','scheduled_minor',item.value->'scheduled_minor','remaining_minor',item.value->'actual_outstanding_minor')
 INTO obligation FROM pg_catalog.jsonb_array_elements(observation->'obligations') item
  WHERE item.value->'reference'=selector;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF financial_mode THEN
  RETURN pg_catalog.jsonb_build_object('financial_evidence_version',3,'tenant_id',invoice.tenant_id,'client_id',invoice.contact_id,
   'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,'issued_snapshot_version',invoice.billing_issued_snapshot_version,
   'status',invoice.status,'currency',pg_catalog.lower(invoice.currency),'financial_standing',observation->'financial_standing',
   'actual_outstanding_minor',observation->'actual_outstanding_minor','refund_payable_minor',observation->'refund_payable_minor',
   'source_hash',observation->'financial_source_hash','obligation',obligation);
 END IF;
 RETURN pg_catalog.jsonb_build_object('tenant_id',invoice.tenant_id,'client_id',invoice.contact_id,
  'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'issued_snapshot_version',invoice.billing_issued_snapshot_version,'obligation',obligation);
END $payment_read$;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_request_mutation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid; invoice uuid; payment public.paige_invoice_provider_operations%ROWTYPE; observation public.paige_invoice_operations%ROWTYPE;
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
  -- A real provider observation must remain recordable while a later request
  -- is pending. Only its exact invoice-version advance is exempt; no receipt,
  -- state, signed document, customer or economic write passes this branch.
  IF TG_TABLE_NAME='paige_invoices' AND TG_OP='UPDATE' THEN
   IF NEW.billing_lifecycle_version=OLD.billing_lifecycle_version+1
   AND (to_jsonb(NEW)-ARRAY['billing_lifecycle_version','updated_at'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['billing_lifecycle_version','updated_at']) THEN
   PERFORM public._sales_payment_operation_service();
   FOR payment IN SELECT p.* FROM public.paige_invoice_provider_operations p
    JOIN public.paige_invoice_operations e ON e.id=p.provider_observation_operation_id
     AND e.tenant_id=p.tenant_id AND e.invoice_id=p.invoice_id
    WHERE p.tenant_id=tenant AND p.invoice_id=invoice AND p.state='settled'
     AND p.provider_observation_version>0
     AND e.result->'invoice_version'=to_jsonb(NEW.billing_lifecycle_version) LOOP
    SELECT * INTO STRICT observation FROM public.paige_invoice_operations e WHERE e.id=payment.provider_observation_operation_id;
    PERFORM public._sales_provider_observation_entry(payment,observation,payment.provider_observation_version-1,true);
    RETURN NEW;
   END LOOP;
   END IF;
  END IF;
  RAISE EXCEPTION 'Payment request is unresolved. Reconcile or expire it before changing invoice payments or state.' USING ERRCODE='P5501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.record_sales_invoice_provider_observation(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid,
 _expected_observation_version bigint,_snapshot jsonb,_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.paige_invoice_provider_operations%rowtype;i public.paige_invoices%rowtype;prior public.paige_invoice_operations%rowtype;
 context jsonb;snapshot jsonb;source_hash text;identity uuid;command jsonb;result jsonb;current_result jsonb;
begin
 perform public._sales_payment_operation_service();
 if _expected_observation_version is null or _expected_observation_version<0 or _expected_observation_version>9007199254740990
  or coalesce(_reference,'') !~ '^[A-Za-z0-9_-]{1,200}$' then raise exception 'Invalid observation request' using errcode='22023';end if;
 select * into op from public.paige_invoice_provider_operations where tenant_id=_expected_tenant_id and id=_operation_id;
 if not found or _claim_token is null or op.dispatch_claim_token is distinct from _claim_token then
  raise exception 'Original payment unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(op.id::text,81742));
 select * into i from public.paige_invoices where id=op.invoice_id and tenant_id=op.tenant_id for update;
 select * into op from public.paige_invoice_provider_operations where id=_operation_id and tenant_id=_expected_tenant_id for update;
 snapshot:=public._sales_provider_observation_snapshot(_snapshot,op.currency,op.amount_minor);
 if snapshot->>'provider_transaction_id' is distinct from op.verified_readback->>'provider_transaction_id'
  or snapshot->>'provider_settlement_id' is distinct from op.verified_readback->>'provider_settlement_id' then
  raise exception 'Observation does not match original capture' using errcode='22023';end if;
 source_hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 identity:=md5(op.id::text||':provider-observation:'||_expected_observation_version::text||':'||source_hash)::uuid;
 command:=jsonb_build_object('action','invoice.provider_observation','provider_operation_id',op.id,
  'expected_observation_version',_expected_observation_version,'source_hash',source_hash,'snapshot',snapshot,'readback_reference',_reference);
 select * into prior from public.paige_invoice_operations where id=identity;
 if found then
  if prior.tenant_id<>op.tenant_id or prior.invoice_id<>op.invoice_id or prior.actor_user_id<>op.actor_user_id
   or prior.command-'readback_reference' is distinct from command-'readback_reference' then
   raise exception 'Observation identity collision' using errcode='22023';end if;
  perform public._sales_provider_observation_entry(op,prior,_expected_observation_version,true);
  return prior.result||jsonb_build_object('replayed',true,'current_observation_version',op.provider_observation_version,'is_current',op.provider_observation_operation_id=prior.id);
 end if;
 if op.provider_observation_version<>_expected_observation_version then raise exception 'Payment observation changed; read its current source again' using errcode='40001';end if;
 context:=public.read_sales_invoice_provider_observation_context(op.tenant_id,op.id);
 if op.provider_observation_operation_id is not null then
  select * into prior from public.paige_invoice_operations where id=op.provider_observation_operation_id and tenant_id=op.tenant_id and invoice_id=op.invoice_id;
  if not found or prior.command->>'action'<>'invoice.provider_observation' or prior.command->>'provider_operation_id'<>op.id::text then
   raise exception 'Original observation history unavailable' using errcode='55000';end if;
  perform public._sales_provider_observation_entry(op,prior,op.provider_observation_version-1,true);
  -- A complete readback cannot silently discard a previously verified refund
  -- or dispute. Missing facts are unavailable evidence, never restored cash.
  if exists(select 1 from jsonb_array_elements(prior.command#>'{snapshot,refunds}') old_fact
    where not exists(select 1 from jsonb_array_elements(snapshot->'refunds') current_fact
     where current_fact.value->'id'=old_fact.value->'id'))
   or exists(select 1 from jsonb_array_elements(prior.command#>'{snapshot,disputes}') old_fact
    where not exists(select 1 from jsonb_array_elements(snapshot->'disputes') current_fact
     where current_fact.value->'id'=old_fact.value->'id')) then
   raise exception 'Provider observation incomplete; reconcile the original verified history' using errcode='55000';end if;
  if prior.command->'snapshot'=snapshot then
   return prior.result||jsonb_build_object('replayed',true,'current_observation_version',op.provider_observation_version,'is_current',true);
  end if;
 end if;
 if i.billing_lifecycle_version>=9007199254740991 then raise exception 'Invoice observation version unavailable' using errcode='55000';end if;
 result:=jsonb_build_object('state','observed','effect','provider_observation_only','observation_id',identity,'provider_operation_id',op.id,
  'observation_version',_expected_observation_version+1,'source_hash',source_hash,'snapshot',snapshot,'invoice_version',i.billing_lifecycle_version+1,'rail_recorded',true);
 insert into public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result)
 values(identity,op.tenant_id,op.invoice_id,op.actor_user_id,command,result) returning * into prior;
 update public.paige_invoice_provider_operations set provider_observation_version=_expected_observation_version+1,
  provider_observation_operation_id=identity,updated_at=clock_timestamp() where id=op.id returning * into op;

 perform public._record_workspace_rail_event(op.tenant_id,null,'capability_run',identity,0,'capability_succeeded',null,
  'sales_payment_reconcile',null,null,null,jsonb_build_object('effect','provider_observation_only','observation_id',identity,
   'provider_operation_id',op.id,'source_hash',source_hash));
 update public.paige_invoices set billing_lifecycle_version=billing_lifecycle_version+1,updated_at=clock_timestamp() where id=i.id;
 perform public._sales_provider_observation_entry(op,prior,_expected_observation_version,true);
 return result||jsonb_build_object('replayed',false,'current_observation_version',_expected_observation_version+1,'is_current',true);
end $$;
