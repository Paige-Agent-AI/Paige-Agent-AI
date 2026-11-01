-- EXP04 O5 test-only actual accepted obligations/manual writer repair. NOT a forward migration.
-- Reuse the original functions, commands, signed evidence, locks, receipt history,
-- approval, actor and Rail. Caller owns the rollback transaction.
DO $actual_guard$
DECLARE r record; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','73c5a267f0e82184af5175f2a2ea5337','4f52d722c9b965de563aa307e94e0f31',false,'search_path=""',ARRAY['_invoice','_signing_id']),
('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','c60acebbbb08b7bd7d1a9b23a47f595d','72ff0f531dced2bcec5d675f7d09a97c',true,'search_path=pg_catalog, public',ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance'])
 ) s(signature,before_hash,after_hash,definer,setting,args) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN (r.before_hash,r.after_hash)
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM r.definer
   OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY[r.setting]
   OR p.proargnames IS DISTINCT FROM r.args OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'Original invoice financial source/authority changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'79b52a906a3ee48a254461d176f17f23' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'s' OR p.proparallel<>'u' OR p.pronargdefaults<>1 OR p.prorettype<>'record'::regtype
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_invoice','invoice_id','amount_minor','allocated_minor','remaining_minor','manual_minor','provider_minor','test_provider_minor','receivable_allocated_minor','receivable_remaining_minor','live_provider_minor'] THEN
  RAISE EXCEPTION 'Canonical actual invoice position unavailable; reconcile before applying' USING ERRCODE='23514';
 END IF;
END $actual_guard$;

CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(_invoice paige_invoices, _signing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE signing public.paige_agreements%ROWTYPE; terms public.tenant_client_agreements%ROWTYPE;
 payload jsonb; effective jsonb; base jsonb; obligations jsonb:='[]'::jsonb;
 obligation jsonb; v_reference jsonb; balance record; sequence bigint; scheduled bigint;
 allocated numeric; allocated_total numeric:=0; scheduled_total bigint:=0; manual_allocations jsonb; manual_allocated numeric;
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
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id);
 -- Original allocation evidence below is LIVE or explicitly business-recorded.
 -- TEST never enters actual receivable, cannot fulfill an obligation and need not
 -- hide the customer's still-outstanding accepted payment plan.
 manual_allocations:=public._sales_invoice_manual_allocations(_invoice);
 IF manual_allocations IS NULL THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required'); END IF;
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
  IF scheduled>0 THEN
   obligations:=obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'reference',v_reference,'source_digest',terms.effective_source_digest,'due_date',obligation->>'due_date',
    'scheduled_minor',scheduled,'remaining_minor',scheduled-allocated));
  END IF;
 END LOOP;
 IF scheduled_total IS DISTINCT FROM _invoice.amount_total_cents::bigint THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 IF allocated_total IS DISTINCT FROM balance.receivable_allocated_minor THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required');
 END IF;
 RETURN base||pg_catalog.jsonb_build_object('state','available','obligations',obligations);
END $function$;

CREATE OR REPLACE FUNCTION public._sales_invoice_prior_execute(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _command jsonb, _governance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; result jsonb; prior jsonb;
  action text:=_command->>'action'; tool text; amount bigint; received bigint; document jsonb; client jsonb; tenant jsonb;
  grant_id uuid; expiry timestamptz; hash text; scope text; allowed text[]; expected bigint;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>(CASE WHEN action='invoice.record_manual_payment' AND _command ? 'allocations' THEN 131072 ELSE 8000 END) THEN
    RAISE EXCEPTION 'Invalid invoice command' USING ERRCODE='22023'; END IF;
  tool:=CASE action WHEN 'invoice.publish' THEN 'sales_publish_invoice' WHEN 'invoice.record_manual_payment' THEN 'sales_record_manual_payment'
    WHEN 'invoice.reverse_manual_payment' THEN 'sales_reverse_manual_payment' WHEN 'invoice.void' THEN 'sales_void_invoice'
    WHEN 'invoice.link_create' THEN 'sales_create_invoice_link' END;
  IF tool IS NULL THEN RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023'; END IF;
  PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,action,tool,_governance);
  allowed:=ARRAY['action','invoice_id','expected_version','template'];
  IF action='invoice.record_manual_payment' THEN allowed:=allowed||ARRAY['amount_cents','currency','method','received_at','reference','notes','allocations'];
  ELSIF action='invoice.reverse_manual_payment' THEN allowed:=allowed||ARRAY['payment_id','reason'];
  ELSIF action='invoice.void' THEN allowed:=allowed||ARRAY['reason'];
  ELSIF action='invoice.link_create' THEN allowed:=allowed||ARRAY['expires_in_days','grant_scope','delivery_operation_id']; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE NOT(k=ANY(allowed)))
    OR coalesce(_command->>'expected_version','') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid invoice fields' USING ERRCODE='22023'; END IF;
  expected:=(_command->>'expected_version')::bigint;
  PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
  prior:=public.read_sales_invoice_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF EXISTS(SELECT 1 FROM public.messages WHERE meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text) THEN
    RAISE EXCEPTION 'Operation already belongs to invoice delivery' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version)<>expected THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  IF action='invoice.publish' THEN
    IF r.status<>'draft' OR r.billing_issued_at IS NOT NULL OR r.amount_total_cents<1 OR lower(r.currency)<>'usd'
      OR (r.billing_draft->'schema_version' IS DISTINCT FROM '2'::jsonb AND r.billing_draft->'schema_version' IS DISTINCT FROM '3'::jsonb) OR nullif(r.billing_draft->>'due_date','') IS NULL THEN RAISE EXCEPTION 'Complete this draft before publication' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))<1 OR r.billing_draft->>'processor_intent' IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m
      WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other')) THEN
      RAISE EXCEPTION 'Online merchant issuance is unavailable; choose off-platform methods' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(c) INTO client FROM public.clients c WHERE id=r.contact_id AND tenant_id=_expected_tenant_id;
    SELECT to_jsonb(t) INTO tenant FROM public.tenants t WHERE id=_expected_tenant_id;
    document:=jsonb_build_object('renderer_version','paige-invoice-html-v1','invoice_number',r.invoice_number,'published_at',now(),
      'issuer_name',coalesce(nullif(tenant->>'name',''),nullif(tenant->>'business_name',''),'Business'),
      'client_name',coalesce(nullif(client->>'entity_name',''),nullif(trim(coalesce(client->>'first_name','')||' '||coalesce(client->>'last_name','')),''),'Client'),
      'snapshot',r.billing_draft,'total_cents',r.amount_total_cents,'currency','usd');
    UPDATE public.paige_invoices SET status='issued',billing_lifecycle_version=expected+1,billing_issued_snapshot_version=billing_draft_version,
      billing_issued_at=now(),billing_issued_by=_actor_user_id,billing_document=document,
      billing_document_digest=encode(extensions.digest(convert_to(document::text,'UTF8'),'sha256'),'hex') WHERE id=r.id;
  ELSE
    IF r.status<>'issued' THEN RAISE EXCEPTION 'Invoice is not active' USING ERRCODE='22023'; END IF;
    SELECT b.receivable_allocated_minor INTO STRICT received
      FROM public._sales_invoice_financial_position_rows(_expected_tenant_id,r.id) b;
    IF action='invoice.record_manual_payment' THEN
      IF coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR _command->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(_command->>'method','') NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR nullif(_command->>'received_at','') IS NULL OR length(_command->>'reference')>200 OR length(_command->>'notes')>2000 THEN
        RAISE EXCEPTION 'Check payment amount, method, currency and date' USING ERRCODE='22023'; END IF;
      amount:=(_command->>'amount_cents')::bigint;
      IF amount>2147483647 OR received<0 OR received+amount>r.amount_total_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
      IF (_command->>'received_at')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Received date cannot be in the future' USING ERRCODE='22023'; END IF;
      PERFORM public._sales_invoice_require_manual_allocations(r,_command);
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'receipt',amount,'usd',_command->>'method',(_command->>'received_at')::timestamptz,_command->>'reference',_command->>'notes');
    ELSIF action='invoice.reverse_manual_payment' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain the correction' USING ERRCODE='22023'; END IF;
      SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=r.id AND kind='receipt';
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id) THEN
        RAISE EXCEPTION 'Receipt unavailable or already reversed' USING ERRCODE='22023'; END IF;
      IF receipt.evidence_kind IS DISTINCT FROM 'manual_recorded' OR receipt.provider_operation_id IS NOT NULL OR receipt.provider_environment IS NOT NULL THEN
        RAISE EXCEPTION 'Provider payments require their original provider reconciliation; manual correction cannot reverse them' USING ERRCODE='22023'; END IF;
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'reversal',receipt.amount_cents,receipt.currency,receipt.method,receipt.received_at,receipt.id,_command->>'reason');
    ELSIF action='invoice.void' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain why this invoice is void' USING ERRCODE='22023'; END IF;
      UPDATE public.paige_invoices SET status='void' WHERE id=r.id;
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE invoice_id=r.id AND revoked_at IS NULL;
    ELSIF action='invoice.link_create' THEN
      IF coalesce(_command->>'expires_in_days','') !~ '^[1-9][0-9]?$' OR (_command->>'expires_in_days')::integer>30 THEN
        RAISE EXCEPTION 'Link expiry must be between one and 30 days' USING ERRCODE='22023'; END IF;
      scope:=coalesce(_command->>'grant_scope','share');
      IF scope<>'share' OR _command ? 'delivery_operation_id' THEN RAISE EXCEPTION 'Delivery grants use the governed sender' USING ERRCODE='22023'; END IF;
      hash:=_governance#>>'{generated_link,token_hash}';grant_id:=(_governance#>>'{generated_link,grant_id}')::uuid;
      IF coalesce(hash,'') !~ '^[0-9a-f]{64}$' OR grant_id IS NULL THEN RAISE EXCEPTION 'Trusted link material required' USING ERRCODE='42501'; END IF;
      expiry:=now()+make_interval(days=(_command->>'expires_in_days')::integer);
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id AND scope='share' AND revoked_at IS NULL;
      INSERT INTO public.paige_invoice_access_grants(id,tenant_id,invoice_id,issued_snapshot_version,scope,token_hash,expires_at,actor_user_id)
        VALUES(grant_id,_expected_tenant_id,r.id,r.billing_issued_snapshot_version,'share',hash,expiry,_actor_user_id);
    END IF;
    UPDATE public.paige_invoices SET billing_lifecycle_version=expected+1 WHERE id=r.id;
  END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
  result:=jsonb_build_object('ok',true,'row',public._sales_invoice_read(_expected_tenant_id,r.id),'operation',jsonb_build_object('id',_operation_id,'action',action));
  IF action='invoice.link_create' THEN result:=result||jsonb_build_object('link',jsonb_build_object('grant_id',grant_id,'expires_at',expiry,'token_returned',false,'link_recovery_required',true)); END IF;
  INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,_command,result);
  RETURN result;
END $function$;
