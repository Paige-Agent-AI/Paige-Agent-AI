-- INERT O5 companion. Original manual record/correction/target/preview/receipt only.

-- Depends on the existing actual-position and collectibility candidates. No provider

-- call, second balance, receipt store, permission grant or production activation.

DO $manual_source$

DECLARE r record;p pg_proc%ROWTYPE;

BEGIN

 FOR r IN SELECT * FROM (VALUES

('public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)','e176660d985e862db589fc11d9c2d4fa','59e7d7273b26ddd8487a649f302c525e',false,'void','search_path=""','{postgres=X/postgres}',ARRAY['_invoice','_command']),
('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','72ff0f531dced2bcec5d675f7d09a97c','32d720cfc173d16bef0564abbf26d6f2',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance']),
('public._sales_invoice_prior_preview(uuid,uuid,jsonb)','88a9d11a25e67257e215999a18092e2c','cae753fff111f8b5697abf86350328ea',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_command']),
('public._preview_sales_invoice_before_provider(uuid,uuid,jsonb)','8a348d0712cd814427ff05cab0a090bd','0984be5b78c147cd16a3c3319f27531a',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_command']),
('public.read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)','8bed0f4bf7912e11e8e3f5bb820b2d93','56ec1895857826f62c786f6f7287fdd9',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres,service_role=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command'])

 ) x(signature,before_hash,after_hash,definer,result_type,setting,acl,args) LOOP

 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);

 IF NOT FOUND OR md5(p.prosrc) NOT IN(r.before_hash,r.after_hash) OR pg_get_userbyid(p.proowner)<>'postgres'

  OR p.prosecdef IS DISTINCT FROM r.definer OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'

  OR p.pronargdefaults<>0 OR p.prorettype IS DISTINCT FROM to_regtype(r.result_type) OR p.proretset

  OR p.proconfig IS DISTINCT FROM ARRAY[r.setting] OR p.proacl::text IS DISTINCT FROM r.acl OR p.proargnames IS DISTINCT FROM r.args THEN

  RAISE EXCEPTION 'Original manual financial source/authority changed; reconcile before applying' USING ERRCODE='23514';END IF;

 END LOOP;

 FOR r IN SELECT * FROM (VALUES

 ('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)','bdb0960fa3d88b21cca90b79636dc7e1'),

 ('public._sales_invoice_collectible_balance(public.paige_invoices)','97ad63a1e9284ae38d8fade870f1c119')

 ) x(signature,body_hash) LOOP

 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);

 IF NOT FOUND OR md5(p.prosrc)<>r.body_hash OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef OR p.proisstrict

  OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0

  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN

  RAISE EXCEPTION 'Original actual financial dependency changed; reconcile before applying' USING ERRCODE='23514';END IF;

 END LOOP;

END $manual_source$;



CREATE OR REPLACE FUNCTION public._sales_invoice_require_manual_allocations(_invoice public.paige_invoices,_command jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $require$
DECLARE allocations jsonb; observation jsonb; item jsonb;
BEGIN
 allocations:=public._sales_invoice_manual_allocation_intent(_command);
 IF allocations IS NULL THEN RETURN; END IF;
 IF _command->>'invoice_id' IS DISTINCT FROM _invoice.id::text
  OR _command->'expected_version' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_lifecycle_version)
  OR _command->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency) THEN
  RAISE EXCEPTION 'Accepted payment allocation changed; review again' USING ERRCODE='40001'; END IF;
 SELECT b.financial_position INTO STRICT observation FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id,3,NULL::jsonb) b;
 IF observation->>'financial_standing' IS DISTINCT FROM 'recorded' THEN
  RAISE EXCEPTION 'Accepted payment allocation unavailable; inspect original receipts' USING ERRCODE='40001'; END IF;
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(allocations) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(observation->'obligations') o WHERE pg_catalog.jsonb_build_object('reference',o.value->'reference','source_digest',o.value->'source_digest','due_date',o.value->'due_date','scheduled_minor',o.value->'scheduled_minor','remaining_minor',o.value->'actual_outstanding_minor')=item->'obligation') THEN
   RAISE EXCEPTION 'Accepted payment allocation changed; review again' USING ERRCODE='40001'; END IF;
 END LOOP;
END $require$;

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
  IF action IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') AND EXISTS(
   SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=_expected_tenant_id AND e.source_kind='capability_run'
    AND e.source_id=_operation_id AND (e.actor_id IS DISTINCT FROM _actor_user_id OR e.capability_key IS DISTINCT FROM tool
     OR e.source_revision IS DISTINCT FROM 0 OR e.outcome='capability_succeeded')) THEN
   RAISE EXCEPTION 'Operation already belongs to another action' USING ERRCODE='22023';END IF;
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
    IF action='invoice.record_manual_payment' THEN
      IF coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR _command->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(_command->>'method','') NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR nullif(_command->>'received_at','') IS NULL OR length(_command->>'reference')>200 OR length(_command->>'notes')>2000 THEN
        RAISE EXCEPTION 'Check payment amount, method, currency and date' USING ERRCODE='22023'; END IF;
      amount:=(_command->>'amount_cents')::bigint;
      IF amount>2147483647 OR amount>public._sales_invoice_collectible_balance(r) THEN RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
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
  IF action IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') AND NOT EXISTS(
   SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=_expected_tenant_id AND e.actor_id=_actor_user_id
    AND e.source_kind='capability_run' AND e.source_id=_operation_id AND e.source_revision=0
    AND e.outcome='capability_succeeded' AND e.capability_key=tool) THEN
   RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
  result:=jsonb_build_object('ok',true,'row',public._sales_invoice_read(_expected_tenant_id,r.id),'operation',jsonb_build_object('id',_operation_id,'action',action));
  IF action='invoice.link_create' THEN result:=result||jsonb_build_object('link',jsonb_build_object('grant_id',grant_id,'expires_at',expiry,'token_returned',false,'link_recovery_required',true)); END IF;
  INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,_command,result);
  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public._sales_invoice_prior_preview(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; facts jsonb; eligible boolean:=false; summary text; receipt public.paige_invoice_payments%ROWTYPE; amount bigint; financial jsonb;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version) IS DISTINCT FROM (_command->>'expected_version')::bigint
    THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  facts:=public._sales_invoice_read(_expected_tenant_id,r.id);
  IF _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') AND r.status='issued' THEN
   BEGIN
    SELECT b.financial_position INTO STRICT financial FROM public._sales_invoice_financial_position_rows(_expected_tenant_id,r.id,3,NULL::jsonb) b;
   EXCEPTION WHEN SQLSTATE '55000' THEN financial:=NULL;
   END;
   facts:=facts||jsonb_build_object('remaining_cents',CASE WHEN financial->>'financial_standing'='recorded' THEN financial->'actual_outstanding_minor' END);
  END IF;
  CASE _command->>'action'
  WHEN 'invoice.publish' THEN
    eligible:=r.status='draft' AND r.billing_draft->'schema_version' IN ('2'::jsonb,'3'::jsonb) AND r.amount_total_cents>0
      AND nullif(r.billing_draft->>'due_date','') IS NOT NULL AND r.billing_draft->>'processor_intent' IS NULL
      AND jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))>0
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other'));
    summary:='Publish the saved invoice as a frozen off-platform obligation. No email, online charge or payment receipt is created.';
  WHEN 'invoice.record_manual_payment' THEN
    IF coalesce(_command->>'amount_cents','') ~ '^[1-9][0-9]{0,9}$' THEN amount:=(_command->>'amount_cents')::bigint; END IF;
    eligible:=r.status='issued' AND financial->>'financial_standing'='recorded' AND amount>0 AND amount<=2147483647 AND amount<=(facts->>'remaining_cents')::bigint AND _command->>'currency'='usd'
      AND coalesce(_command->>'method','') IN ('zelle','cash','wire','check','bank_transfer','other');
    summary:='Review the reported human receipt against current payment evidence and original assignments.';
  WHEN 'invoice.reverse_manual_payment' THEN
    SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND invoice_id=r.id AND tenant_id=_expected_tenant_id AND kind='receipt';
    eligible:=FOUND AND r.status='issued' AND coalesce(length(trim(_command->>'reason')),0) BETWEEN 1 AND 500
      AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id);
    summary:='Append a correction reversing '||coalesce(receipt.amount_cents::text,'the unavailable receipt')||' USD cents. Original receipt remains in history; no money is refunded.';
  WHEN 'invoice.void' THEN
    eligible:=r.status='issued' AND coalesce(length(trim(_command->>'reason')),0) BETWEEN 1 AND 500;
    summary:='Void this obligation and revoke its customer links. Existing human-recorded receipts remain visible; this does not refund a payment.';
  WHEN 'invoice.link_create' THEN
    eligible:=r.status='issued' AND coalesce(_command->>'expires_in_days','') ~ '^[1-9][0-9]?$'
      AND (_command->>'expires_in_days')::integer<=30 AND coalesce(_command->>'grant_scope','share')='share';
    summary:='Create an expiring customer-access link. Previous share links are revoked; delivery links remain independent. No email is sent.';
  ELSE RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023';
  END CASE;
  RETURN (CASE WHEN _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
    jsonb_build_object('manual_financial',jsonb_build_object('financial_evidence_version',3,'financial_standing',CASE WHEN financial->>'financial_standing'='recorded' THEN 'recorded' ELSE 'needs_review' END,'refund_payable_minor',financial->'refund_payable_minor')) ELSE '{}'::jsonb END)||jsonb_build_object('invoice_id',r.id,'invoice_number',r.invoice_number,'version',facts->'version','issued_snapshot_version',r.billing_issued_snapshot_version,
    'document_input_digest',r.billing_document_digest,'amount_cents',r.amount_total_cents,'remaining_cents',facts->'remaining_cents',
    'currency',lower(r.currency),'status',r.status,'action',_command->>'action','eligible',coalesce(eligible,false),'summary',summary);
END $$;

CREATE OR REPLACE FUNCTION public._preview_sales_invoice_before_provider(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; invoice public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; amount bigint; balance bigint; date_label text; method_label text; invoice_label text; current_label text; financial jsonb;
BEGIN
 result:=public._sales_invoice_preview_before_payment_breakdown(_actor_user_id,_expected_tenant_id,_command);
 IF _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
  SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
  balance:=(result->>'remaining_cents')::bigint;financial:=result->'manual_financial';
  current_label:=CASE WHEN financial->>'financial_standing'='recorded' THEN
   format('Current outstanding: $%s USD.',to_char(balance::numeric/100,'FM999999999999990.00'))
   ||CASE WHEN (financial->>'refund_payable_minor')::bigint>0 THEN
    format(' A separate $%s USD refund is owed.',to_char((financial->>'refund_payable_minor')::numeric/100,'FM999999999999990.00')) ELSE '' END
   ELSE 'The current balance needs payment evidence and assignment verification.' END;
  IF result->>'eligible' IS DISTINCT FROM 'true' THEN
   RETURN result||jsonb_build_object('summary',current_label||' Review this invoice before recording or correcting a receipt.');END IF;
  invoice_label:=CASE WHEN invoice.invoice_number LIKE 'DRAFT-%' THEN 'previously issued invoice' ELSE 'invoice '||invoice.invoice_number END;
  IF _command->>'action'='invoice.record_manual_payment' THEN
   amount:=(_command->>'amount_cents')::bigint; date_label:=to_char((_command->>'received_at')::timestamptz AT TIME ZONE 'UTC','FMMonth DD, YYYY')||' (UTC)';
   method_label:=initcap(replace(_command->>'method','_',' '));
   result:=jsonb_set(result,'{summary}',to_jsonb(format('Record $%s USD received by %s on %s for %s. %s This is a human-recorded payment, without provider verification or money movement.',
    to_char(amount::numeric/100,'FM999999999999990.00'),method_label,date_label,invoice_label,current_label)));
  ELSE
   SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
   result:=jsonb_set(result,'{summary}',to_jsonb(format('Reverse the recorded $%s USD payment for %s. %s This corrects the business record without refunding or transferring money.',
    to_char(receipt.amount_cents::numeric/100,'FM999999999999990.00'),invoice_label,current_label)));
  END IF;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_command_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; payment public.paige_invoice_payments%ROWTYPE;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO op FROM public.paige_invoice_operations WHERE id=_operation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF op.actor_user_id IS DISTINCT FROM _actor_user_id OR op.tenant_id IS DISTINCT FROM _expected_tenant_id OR op.command IS DISTINCT FROM _command
    THEN RAISE EXCEPTION 'Operation reused with different input' USING ERRCODE='22023'; END IF;
  IF op.command->>'action'='invoice.record_provider_disposition' THEN
   PERFORM public._sales_invoice_provider_disposition_receipt(op);
  END IF;
  IF op.command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
   IF op.result->'ok' IS DISTINCT FROM 'true'::jsonb OR op.result#>>'{operation,id}' IS DISTINCT FROM op.id::text
    OR op.result#>>'{operation,action}' IS DISTINCT FROM op.command->>'action' OR NOT EXISTS(
     SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=op.tenant_id AND e.actor_id=op.actor_user_id
      AND e.source_kind='capability_run' AND e.source_id=op.id AND e.source_revision=0 AND e.outcome='capability_succeeded'
      AND e.capability_key=(CASE op.command->>'action' WHEN 'invoice.record_manual_payment' THEN 'sales_record_manual_payment' ELSE 'sales_reverse_manual_payment' END)) THEN
    RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
   SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=op.invoice_id AND i.tenant_id=op.tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
   SELECT * INTO payment FROM public.paige_invoice_payments p WHERE p.id=op.id AND p.invoice_id=op.invoice_id
    AND p.tenant_id=op.tenant_id AND p.actor_user_id=op.actor_user_id AND p.evidence_kind='manual_recorded'
    AND p.provider_operation_id IS NULL AND p.provider_environment IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
   IF op.command->>'action'='invoice.record_manual_payment' THEN
    PERFORM public._sales_invoice_manual_receipt_allocations(invoice,payment);
   ELSIF payment.kind IS DISTINCT FROM 'reversal' OR payment.reverses_payment_id IS DISTINCT FROM (op.command->>'payment_id')::uuid
    OR NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments p WHERE p.id=payment.reverses_payment_id AND p.tenant_id=payment.tenant_id
     AND p.invoice_id=payment.invoice_id AND p.kind='receipt' AND p.evidence_kind='manual_recorded' AND p.provider_operation_id IS NULL
     AND p.provider_environment IS NULL AND p.amount_cents=payment.amount_cents AND p.currency=payment.currency) THEN
    RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
  END IF;
  RETURN op.result;
END $$;
