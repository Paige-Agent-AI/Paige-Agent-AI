-- INERT O5 source candidate. Caller owns the disposable transaction.
-- Extend original invoice position/command/journal/Rail. No new financial store,
-- provider request, approval authority, schedule, signed amendment or public grant.
DO $original_position_source$
DECLARE r record;p pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public._sales_invoice_financial_position_rows(uuid,uuid)','79b52a906a3ee48a254461d176f17f23',1,ARRAY['_tenant','_invoice','invoice_id','amount_minor','allocated_minor','remaining_minor','manual_minor','provider_minor','test_provider_minor','receivable_allocated_minor','receivable_remaining_minor','live_provider_minor']),
 ('public._sales_invoice_financial_position_rows(uuid,uuid,integer)','a7ed0b1ba940c0e5b70b8cf0742356bb',0,ARRAY['_tenant','_invoice','_evidence_version','invoice_id','financial_position'])
 ) x(signature,body_md5,defaults,args) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF NOT FOUND OR md5(p.prosrc)<>r.body_md5 OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict
   OR p.proleakproof OR p.provolatile<>'s' OR p.proparallel<>'u' OR p.pronargdefaults<>r.defaults
   OR p.prorettype<>'record'::regtype OR p.proargnames IS DISTINCT FROM r.args
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'Original invoice position source changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $original_position_source$;

DO $accepted_position_source$
DECLARE p pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)');
 IF NOT FOUND OR md5(p.prosrc)<>'4f52d722c9b965de563aa307e94e0f31' OR pg_get_userbyid(p.proowner)<>'postgres'
  OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
  OR p.prorettype<>'jsonb'::regtype OR p.proargnames IS DISTINCT FROM ARRAY['_invoice','_signing_id']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original accepted invoice source changed; reconcile before applying' USING ERRCODE='23514';END IF;
END $accepted_position_source$;

DO $private_source_guard$
DECLARE r record;p pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_provider_disposition_command(jsonb)','0ea6025702c9694ce9280593e1b606d0','void',ARRAY['_command']),
('public._sales_invoice_provider_disposition_history(public.paige_invoices,jsonb)','702541a74b3d130273b0bbf31cc8b158','jsonb',ARRAY['_invoice','_payment']),
('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)','fd0ec0aabf95d46b8f052af027cbf6ce','record',ARRAY['_tenant','_invoice','_evidence_version','_proposal','invoice_id','financial_position']),
('public._sales_invoice_provider_disposition_review(uuid,uuid,jsonb)','656219ca9ff0d7159c4f367de38f7fa1','jsonb',ARRAY['_actor','_tenant','_command']),
('public._sales_invoice_provider_disposition_receipt(public.paige_invoice_operations)','0569823560c5827a32010ef9572c20ba','void',ARRAY['_entry']),
('public._sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb)','fbfa85be667382e21f24019f589a12af','jsonb',ARRAY['_actor','_tenant','_operation','_command','_governance'])
 ) x(signature,body_md5,result_type,args) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF FOUND AND (md5(p.prosrc)<>r.body_md5 OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef OR p.proisstrict
   OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
   OR p.prorettype<>r.result_type::regtype OR p.proargnames IS DISTINCT FROM r.args
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
   RAISE EXCEPTION 'Private invoice financial source changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $private_source_guard$;

CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_command(_command jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE credit boolean; key text;
BEGIN
 credit:=_command->>'decision'='credit_returned_principal';
 IF jsonb_typeof(_command) IS DISTINCT FROM 'object'
  OR _command->>'action' IS DISTINCT FROM 'invoice.record_provider_disposition'
  OR coalesce(_command->>'decision','') NOT IN('balance_due','credit_returned_principal')
  OR (SELECT count(*) FROM jsonb_object_keys(_command))<>(CASE WHEN credit THEN 10 ELSE 9 END)
  OR _command-ARRAY['action','invoice_id','expected_version','provider_operation_id','observation_id',
    'observation_version','expected_disposition_version','decision','reason',CASE WHEN credit THEN 'credit_minor' ELSE 'decision' END]<>'{}'::jsonb
  OR jsonb_typeof(_command->'reason') IS DISTINCT FROM 'string'
  OR length(btrim(_command->>'reason'))<1 OR length(_command->>'reason')>500 THEN
  RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';
 END IF;
 FOREACH key IN ARRAY ARRAY['invoice_id','provider_operation_id','observation_id'] LOOP
  IF jsonb_typeof(_command->key) IS DISTINCT FROM 'string'
   OR coalesce(_command->>key,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['expected_version','observation_version','expected_disposition_version'] LOOP
  IF jsonb_typeof(_command->key) IS DISTINCT FROM 'number' OR coalesce(_command->>key,'') !~ '^(0|[1-9][0-9]{0,15})$'
   OR (_command->>key)::bigint>9007199254740990
   OR (key<>'expected_disposition_version' AND (_command->>key)::bigint<1) THEN
   RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';END IF;
 END LOOP;
 IF credit AND (jsonb_typeof(_command->'credit_minor') IS DISTINCT FROM 'number'
  OR coalesce(_command->>'credit_minor','') !~ '^[1-9][0-9]{0,9}$'
  OR (_command->>'credit_minor')::bigint>2147483647) THEN
  RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_command(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Original immutable operation history is the only credit/disposition record.
-- A later provider event never silently discards the retained owner decision.
CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_history(_invoice public.paige_invoices,_payment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE entry public.paige_invoice_operations%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE;
 observation public.paige_invoice_operations%ROWTYPE; profile jsonb; result jsonb; command jsonb;
 version bigint:=0; credit bigint:=0; next_credit bigint; next_version bigint; invoice_version bigint;
 last_id uuid; last_observation uuid; last_observation_version bigint; unchanged boolean; key text;
BEGIN
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=(_payment->>'provider_operation_id')::uuid
  AND tenant_id=_invoice.tenant_id AND invoice_id=_invoice.id AND state='settled' AND environment='live';
 IF NOT FOUND OR op.client_id IS DISTINCT FROM _invoice.contact_id OR op.currency IS DISTINCT FROM lower(_invoice.currency)
  OR _payment->'captured_minor' IS DISTINCT FROM to_jsonb(op.amount_minor) THEN
  RAISE EXCEPTION 'Original financial payment unavailable' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations e
  WHERE e.command->>'action'='invoice.record_provider_disposition' AND e.command->>'provider_operation_id'=op.id::text
   AND (jsonb_typeof(e.result->'disposition_version') IS DISTINCT FROM 'number'
    OR coalesce(e.result->>'disposition_version','') !~ '^[1-9][0-9]{0,15}$'
    OR (e.result->>'disposition_version')::bigint>9007199254740991)) THEN
  RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
 FOR entry IN SELECT e.* FROM public.paige_invoice_operations e
  WHERE e.command->>'action'='invoice.record_provider_disposition' AND e.command->>'provider_operation_id'=op.id::text
  ORDER BY (e.result->>'disposition_version')::bigint,e.result->>'outcome',e.id LOOP
  command:=entry.command;result:=entry.result;profile:=result->'provider_disposition_review';
  BEGIN PERFORM public._sales_invoice_provider_disposition_command(command);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END;
  unchanged:=result->>'outcome'='financial_decision_unchanged';
  next_version:=version+CASE WHEN unchanged THEN 0 ELSE 1 END;
  next_credit:=CASE WHEN command->>'decision'='balance_due' THEN 0 ELSE (command->>'credit_minor')::bigint END;
  invoice_version:=(command->>'expected_version')::bigint+CASE WHEN unchanged THEN 0 ELSE 1 END;
  IF entry.tenant_id IS DISTINCT FROM _invoice.tenant_id OR entry.invoice_id IS DISTINCT FROM _invoice.id OR entry.actor_user_id IS NULL
   OR command->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice.id)
   OR command->'expected_disposition_version' IS DISTINCT FROM to_jsonb(version)
   OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(result))<>12
   OR result-ARRAY['ok','outcome','effect','payment_moved','customer_notified','rail_recorded','receipt_id','operation',
     'provider_disposition_review','disposition_version','invoice_version','row']<>'{}'::jsonb
   OR result->'ok' IS DISTINCT FROM 'true'::jsonb OR result->'payment_moved' IS DISTINCT FROM 'false'::jsonb
   OR result->'customer_notified' IS DISTINCT FROM 'false'::jsonb OR result->'rail_recorded' IS DISTINCT FROM 'true'::jsonb
   OR result->>'effect' IS DISTINCT FROM 'internal_financial_disposition_only'
   OR coalesce(result->>'outcome','') NOT IN('financial_decision_recorded','financial_decision_unchanged')
   OR result->'operation' IS DISTINCT FROM jsonb_build_object('id',entry.id,'action',command->>'action')
   OR result->'disposition_version' IS DISTINCT FROM to_jsonb(next_version)
   OR result->'invoice_version' IS DISTINCT FROM to_jsonb(invoice_version)
   OR jsonb_typeof(result->'row') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(result->'row'))<>3
   OR result#>'{row,id}' IS DISTINCT FROM to_jsonb(_invoice.id) OR result#>'{row,tenant_id}' IS DISTINCT FROM to_jsonb(_invoice.tenant_id)
   OR result#>'{row,version}' IS DISTINCT FROM to_jsonb(invoice_version)
   OR invoice_version>_invoice.billing_lifecycle_version OR next_credit>op.amount_minor
   OR (unchanged AND (version=0 OR credit<>next_credit))
   OR jsonb_typeof(profile) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(profile))<>25
   OR profile-ARRAY['review_version','financial_evidence_version','effect','invoice_id','invoice_version','client_id','client_name',
    'currency','provider_operation_id','observation_id','observation_version','disposition_version','decision','captured_minor',
    'retained_minor','returned_minor','credit_before_minor','credit_after_minor','standing_before','outstanding_before_minor',
    'outstanding_after_minor','refund_payable_before_minor','refund_payable_after_minor','standing_after','source_hash']<>'{}'::jsonb
   OR profile->'review_version' IS DISTINCT FROM '2'::jsonb OR profile->'financial_evidence_version' IS DISTINCT FROM '3'::jsonb
   OR profile->>'effect' IS DISTINCT FROM 'internal_financial_disposition_only'
   OR profile->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice.id) OR profile->'invoice_version' IS DISTINCT FROM command->'expected_version'
   OR profile->'client_id' IS DISTINCT FROM to_jsonb(_invoice.contact_id) OR profile->>'currency' IS DISTINCT FROM op.currency
   OR jsonb_typeof(profile->'client_name') IS DISTINCT FROM 'string' OR length(btrim(profile->>'client_name'))<1 OR length(profile->>'client_name')>500
   OR profile->'provider_operation_id' IS DISTINCT FROM to_jsonb(op.id)
   OR profile->'observation_id' IS DISTINCT FROM command->'observation_id' OR profile->'observation_version' IS DISTINCT FROM command->'observation_version'
   OR profile->'disposition_version' IS DISTINCT FROM to_jsonb(version) OR profile->'decision' IS DISTINCT FROM command->'decision'
   OR profile->'captured_minor' IS DISTINCT FROM to_jsonb(op.amount_minor)
   OR profile->'credit_before_minor' IS DISTINCT FROM to_jsonb(credit) OR profile->'credit_after_minor' IS DISTINCT FROM to_jsonb(next_credit)
   OR coalesce(profile->>'source_hash','') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  FOREACH key IN ARRAY ARRAY['retained_minor','returned_minor'] LOOP
   IF jsonb_typeof(profile->key) IS DISTINCT FROM 'number' OR coalesce(profile->>key,'') !~ '^(0|[1-9][0-9]{0,9})$'
    OR (profile->>key)::bigint>op.amount_minor THEN
    RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  END LOOP;
  IF (profile->>'retained_minor')::bigint+(profile->>'returned_minor')::bigint<>op.amount_minor THEN
   RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  FOREACH key IN ARRAY ARRAY['before','after'] LOOP
   IF profile->>('standing_'||key)='needs_review' THEN
    IF profile->('outstanding_'||key||'_minor') IS DISTINCT FROM 'null'::jsonb
     OR profile->('refund_payable_'||key||'_minor') IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
   ELSIF profile->>('standing_'||key)='recorded' THEN
    IF jsonb_typeof(profile->('outstanding_'||key||'_minor')) IS DISTINCT FROM 'number'
     OR coalesce(profile->>('outstanding_'||key||'_minor'),'') !~ '^(0|[1-9][0-9]{0,9})$'
     OR (profile->>('outstanding_'||key||'_minor'))::bigint>2147483647
     OR jsonb_typeof(profile->('refund_payable_'||key||'_minor')) IS DISTINCT FROM 'number'
     OR coalesce(profile->>('refund_payable_'||key||'_minor'),'') !~ '^(0|[1-9][0-9]{0,9})$'
     OR (profile->>('refund_payable_'||key||'_minor'))::bigint>2147483647 THEN
     RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
   ELSE RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  END LOOP;
  IF unchanged AND (profile->'standing_before' IS DISTINCT FROM profile->'standing_after'
   OR profile->'outstanding_before_minor' IS DISTINCT FROM profile->'outstanding_after_minor'
   OR profile->'refund_payable_before_minor' IS DISTINCT FROM profile->'refund_payable_after_minor') THEN
   RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  SELECT e.* INTO observation FROM public.paige_invoice_operations e WHERE e.id=(entry.command->>'observation_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original financial decision source unavailable' USING ERRCODE='55000';END IF;
  PERFORM public._sales_provider_observation_entry(op,observation,(command->>'observation_version')::bigint-1,true);
  IF NOT EXISTS(SELECT 1 FROM public.paige_workspace_events e WHERE e.id::text=result->>'receipt_id'
   AND e.tenant_id=entry.tenant_id AND e.actor_id=entry.actor_user_id AND e.source_kind='capability_run'
   AND e.source_id=entry.id AND e.source_revision=0 AND e.outcome='capability_succeeded'
   AND e.capability_key='sales_record_provider_disposition' AND e.actor_agent_slug IS NULL) THEN
   RAISE EXCEPTION 'Original financial decision receipt unavailable' USING ERRCODE='55000';END IF;
  IF NOT unchanged THEN
   version:=next_version;credit:=next_credit;last_id:=entry.id;
   last_observation:=(command->>'observation_id')::uuid;last_observation_version:=(command->>'observation_version')::bigint;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('version',version,'credit_minor',credit,'decision_operation_id',last_id,
  'observation_id',last_observation,'observation_version',last_observation_version);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_history(public.paige_invoices,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- One canonical native calculation, extended with original accepted targets.
-- The three-argument overload owns cash evidence; legacy seven/ten-field APIs
-- stay untouched. The optional proposal is read-only, never a recorded credit.
CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid,_evidence_version integer,_proposal jsonb)
RETURNS TABLE(invoice_id uuid,financial_position jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; source jsonb; payment_position jsonb; history jsonb;
 positions jsonb; histories jsonb; original_histories jsonb; accepted jsonb; targets jsonb; target jsonb;
 matched jsonb; gross numeric; retained numeric; credits numeric; manual numeric; scheduled numeric;
 outstanding numeric:=0;refund_payable numeric:=0;total_credit numeric:=0;total_gross numeric:=0;
 known boolean:=true; proposed boolean:=false; has_plan boolean; source_hash text; projected jsonb:='[]';
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
   AND (payment_position->'commercial_review_required'='false'::jsonb OR
    (history->'observation_id'=payment_position->'observation_id' AND history->'observation_version'=payment_position->'observation_version'));
  histories:=histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
 END LOOP;
 IF _proposal IS NOT NULL AND NOT proposed THEN RAISE EXCEPTION 'Original LIVE payment unavailable' USING ERRCODE='42501';END IF;
 has_plan:=invoice.billing_draft#>'{agreement_snapshot,id}' IS NOT NULL OR invoice.billing_draft#>'{commercial_terms_reference,id}' IS NOT NULL;
 IF has_plan THEN
  IF coalesce(invoice.billing_draft#>>'{agreement_snapshot,id}','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Original accepted obligation unavailable' USING ERRCODE='55000';END IF;
  accepted:=public._sales_invoice_accepted_obligations(invoice,(invoice.billing_draft#>>'{agreement_snapshot,id}')::uuid);
  IF accepted->>'state' IS DISTINCT FROM 'available' THEN
   RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing','allocation_required','actual_outstanding_minor',NULL,
    'refund_payable_minor',NULL,'credit_minor',NULL,'obligations','[]'::jsonb,'accepted_source_state',accepted->>'reason');RETURN;
  END IF;
  targets:=accepted->'obligations';
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
  manual:=scheduled-(target->>'remaining_minor')::numeric-gross;
  IF manual<0 OR credits<0 OR credits>scheduled THEN
   RAISE EXCEPTION 'Original obligation allocation conflict' USING ERRCODE='55000';END IF;
  outstanding:=outstanding+greatest(scheduled-credits-manual-retained,0);
  refund_payable:=refund_payable+greatest(manual+retained-(scheduled-credits),0);
  total_credit:=total_credit+credits;
  projected:=projected||jsonb_build_array(target||jsonb_build_object('credit_minor',credits,'actual_allocated_minor',CASE WHEN known THEN manual+retained END,
   'actual_outstanding_minor',CASE WHEN known THEN greatest(scheduled-credits-manual-retained,0) END,
   'refund_payable_minor',CASE WHEN known THEN greatest(manual+retained-(scheduled-credits),0) END));
 END LOOP;
 IF total_gross IS DISTINCT FROM (source->>'live_provider_minor')::numeric THEN
  RAISE EXCEPTION 'Original obligation allocation required' USING ERRCODE='55000';END IF;
 source_hash:=encode(sha256(convert_to(jsonb_build_object('invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'client_id',invoice.contact_id,'document_digest',invoice.billing_document_digest,'source',source,
  'original_payment_decisions',original_histories,'accepted_obligations',targets)::text,'UTF8')),'hex');
 RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing',CASE WHEN known THEN 'recorded' ELSE 'needs_review' END,
  'actual_outstanding_minor',CASE WHEN known THEN outstanding END,'refund_payable_minor',CASE WHEN known THEN refund_payable END,
  'credit_minor',total_credit,'obligations',projected,'provider_decisions',histories,'original_payment_decisions',original_histories,
  'financial_source_hash',source_hash);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_review(_actor uuid,_tenant uuid,_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; before_state jsonb; after_state jsonb; payment_position jsonb;
 history jsonb; client_name text; profile jsonb;
BEGIN
 PERFORM public._sales_invoice_provider_disposition_command(_command);
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 IF invoice.status IS DISTINCT FROM 'issued' OR lower(invoice.currency) IS DISTINCT FROM 'usd'
  OR invoice.billing_issued_snapshot_version IS NULL OR invoice.billing_document IS NULL
  OR invoice.billing_lifecycle_version IS DISTINCT FROM (_command->>'expected_version')::bigint THEN
  RAISE EXCEPTION 'Invoice financial source changed' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations p WHERE p.tenant_id=_tenant AND p.invoice_id=invoice.id
  AND p.environment='live' AND p.state IN('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')) THEN
  RAISE EXCEPTION 'Resolve the original pending payment request before changing its financial treatment' USING ERRCODE='55000';END IF;
 SELECT b.financial_position INTO STRICT before_state FROM public._sales_invoice_financial_position_rows(_tenant,invoice.id,3,NULL::jsonb) b;
 SELECT b.financial_position INTO STRICT after_state FROM public._sales_invoice_financial_position_rows(_tenant,invoice.id,3,_command) b;
 IF before_state->>'financial_standing'='allocation_required' OR after_state->>'financial_standing'='allocation_required' THEN
  RAISE EXCEPTION 'Original accepted payment allocation required' USING ERRCODE='55000';END IF;
 SELECT value INTO payment_position FROM jsonb_array_elements(before_state->'original_payment_decisions')
  WHERE value->'provider_operation_id'=_command->'provider_operation_id';
 IF NOT FOUND THEN RAISE EXCEPTION 'Original LIVE payment unavailable' USING ERRCODE='42501';END IF;
 history:=payment_position->'financial_decision';
 client_name:=public._sales_collection_client_name(_tenant,invoice.contact_id);
 IF client_name IS NULL OR length(btrim(client_name))<1 OR length(client_name)>500 THEN
  RAISE EXCEPTION 'Original financial client unavailable' USING ERRCODE='55000';END IF;
 profile:=jsonb_build_object('review_version',2,'financial_evidence_version',3,'effect','internal_financial_disposition_only',
  'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,'client_id',invoice.contact_id,'client_name',client_name,'currency','usd',
  'provider_operation_id',_command->'provider_operation_id','observation_id',_command->'observation_id','observation_version',_command->'observation_version',
  'disposition_version',history->'version','decision',_command->'decision','captured_minor',payment_position->'captured_minor',
  'retained_minor',payment_position->'retained_minor','returned_minor',payment_position->'returned_minor',
  'credit_before_minor',history->'credit_minor','credit_after_minor',CASE WHEN _command->>'decision'='balance_due' THEN 0 ELSE (_command->>'credit_minor')::bigint END,
  'standing_before',before_state->'financial_standing','outstanding_before_minor',before_state->'actual_outstanding_minor',
  'refund_payable_before_minor',before_state->'refund_payable_minor','standing_after',after_state->'financial_standing',
  'outstanding_after_minor',after_state->'actual_outstanding_minor','refund_payable_after_minor',after_state->'refund_payable_minor',
  'source_hash',before_state->'financial_source_hash');
 RETURN jsonb_build_object('eligible',true,'invoice_number',invoice.invoice_number,'currency','usd','provider_disposition',profile,
  'summary','Record the reviewed internal credit or debt decision. This does not move money, amend signed terms or notify the client.');
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_receipt(_entry public.paige_invoice_operations)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; cash jsonb; payment_position jsonb;
BEGIN
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_entry.invoice_id AND tenant_id=_entry.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original financial invoice unavailable' USING ERRCODE='55000';END IF;
 SELECT b.financial_position INTO STRICT cash FROM public._sales_invoice_financial_position_rows(_entry.tenant_id,_entry.invoice_id,3) b;
 SELECT value INTO payment_position FROM jsonb_array_elements(cash->'provider_payment_positions')
  WHERE value->'provider_operation_id'=_entry.command->'provider_operation_id' AND value->>'environment'='live';
 IF NOT FOUND THEN RAISE EXCEPTION 'Original financial payment unavailable' USING ERRCODE='55000';END IF;
 PERFORM public._sales_invoice_provider_disposition_history(invoice,payment_position);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_receipt(public.paige_invoice_operations) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_record_provider_disposition(_actor uuid,_tenant uuid,_operation uuid,_command jsonb,_governance jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; prior jsonb; preview jsonb; profile jsonb; source jsonb; payment_position jsonb;
 history jsonb; unchanged boolean; receipt_id uuid; result jsonb; next_version bigint; next_disposition bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 PERFORM public._sales_invoice_provider_disposition_command(_command);
 PERFORM public._sales_invoice_governance(_actor,_tenant,'invoice.record_provider_disposition','sales_record_provider_disposition',_governance);
 IF _operation IS NULL THEN RAISE EXCEPTION 'Invalid invoice operation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation::text,81742));
 prior:=public.read_sales_invoice_command_result(_actor,_tenant,_operation,_command);
 IF prior IS NOT NULL THEN RETURN prior;END IF;
 IF EXISTS(SELECT 1 FROM public.messages m WHERE m.meta#>>'{sales_invoice_binding,operation_id}'=_operation::text)
  OR EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations p WHERE p.id=_operation)
  OR EXISTS(SELECT 1 FROM public.paige_durable_work w WHERE w.id=_operation) THEN
  RAISE EXCEPTION 'Operation already belongs to another action' USING ERRCODE='22023';END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 -- All original provider-observation writers lock invoice before the payment row.
 -- Never take their provider-operation advisory lock after holding the invoice.
 preview:=public._sales_invoice_provider_disposition_review(_actor,_tenant,_command);
 profile:=preview->'provider_disposition';
 IF _governance->'approved_financial_review' IS DISTINCT FROM profile THEN
  RAISE EXCEPTION 'Approved financial consequence changed; review again' USING ERRCODE='40001';END IF;
 SELECT b.financial_position INTO STRICT source FROM public._sales_invoice_financial_position_rows(_tenant,invoice.id,3,NULL::jsonb) b;
 SELECT value INTO payment_position FROM jsonb_array_elements(source->'original_payment_decisions')
  WHERE value->'provider_operation_id'=_command->'provider_operation_id';
 history:=payment_position->'financial_decision';
 -- Recheck the original receipt namespace after invoice/accepted-source waits.
 -- A prior success without its immutable operation is an integrity exception,
 -- never a receipt to borrow for another write. Exact completed replay returned
 -- above; same-action failed attempts may retain their original failure history.
 IF EXISTS(SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=_tenant
  AND e.source_kind='capability_run' AND e.source_id=_operation
  AND (e.capability_key IS DISTINCT FROM 'sales_record_provider_disposition'
   OR e.actor_id IS DISTINCT FROM _actor OR e.source_revision IS DISTINCT FROM 0 OR e.outcome='capability_succeeded')) THEN
  RAISE EXCEPTION 'Operation already belongs to another action' USING ERRCODE='22023';END IF;
 unchanged:=(history->>'version')::bigint>0 AND history->'credit_minor'=profile->'credit_after_minor'
  AND history->'observation_id'=_command->'observation_id' AND history->'observation_version'=_command->'observation_version';
 next_version:=invoice.billing_lifecycle_version+CASE WHEN unchanged THEN 0 ELSE 1 END;
 next_disposition:=(_command->>'expected_disposition_version')::bigint+CASE WHEN unchanged THEN 0 ELSE 1 END;
 IF NOT unchanged THEN
  UPDATE public.paige_invoices SET billing_lifecycle_version=next_version,updated_at=clock_timestamp() WHERE id=invoice.id;
 END IF;
 PERFORM public.record_capability_run(_tenant,_actor,'sales_record_provider_disposition','capability_succeeded',_operation,NULL);
 SELECT e.id INTO receipt_id FROM public.paige_workspace_events e WHERE e.tenant_id=_tenant AND e.actor_id=_actor
  AND e.source_kind='capability_run' AND e.source_id=_operation AND e.source_revision=0 AND e.outcome='capability_succeeded'
  AND e.capability_key='sales_record_provider_disposition' AND e.actor_agent_slug IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial decision receipt unavailable' USING ERRCODE='55000';END IF;
 result:=jsonb_build_object('ok',true,'outcome',CASE WHEN unchanged THEN 'financial_decision_unchanged' ELSE 'financial_decision_recorded' END,
  'effect','internal_financial_disposition_only','payment_moved',false,'customer_notified',false,'rail_recorded',true,'receipt_id',receipt_id,
  'operation',jsonb_build_object('id',_operation,'action','invoice.record_provider_disposition'),'provider_disposition_review',profile,
  'disposition_version',next_disposition,'invoice_version',next_version,
  'row',jsonb_build_object('id',invoice.id,'tenant_id',_tenant,'version',next_version));
 INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result)
  VALUES(_operation,_tenant,invoice.id,_actor,_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Insert only new-action delegation into the ORIGINAL entry bodies. Every
-- previous byte, OID, argument, owner, volatility, search path and ACL remains.
DO $original_doors$
DECLARE r record;p pg_proc%ROWTYPE;original_body text;candidate text;definition text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.preview_sales_invoice_command(uuid,uuid,jsonb)','9ecfe85e6d8638082ee14f9b13acff47',
  E'BEGIN\n result:=public._preview_sales_invoice_before_provider',
  E'BEGIN\n IF _command->>''action''=''invoice.record_provider_disposition'' THEN\n  RETURN public._sales_invoice_provider_disposition_review(_actor_user_id,_expected_tenant_id,_command);\n END IF;\n result:=public._preview_sales_invoice_before_provider',
  ARRAY['_actor_user_id','_expected_tenant_id','_command']),
 ('public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb)','b4da1d303e969a5bb33d89cd60103375',
  E'BEGIN\n IF _command->>''action'' IS DISTINCT FROM ''invoice.settings_update'' THEN',
  E'BEGIN\n IF _command->>''action''=''invoice.record_provider_disposition'' THEN\n  RETURN public._sales_invoice_record_provider_disposition(_actor_user_id,_expected_tenant_id,_operation_id,_command,_governance);\n END IF;\n IF _command->>''action'' IS DISTINCT FROM ''invoice.settings_update'' THEN',
  ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance']),
 ('public.read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)','94fd1e3deb3547b4bb72388b2a0549e9',
  E'  RETURN op.result;',
  E'  IF op.command->>''action''=''invoice.record_provider_disposition'' THEN\n   PERFORM public._sales_invoice_provider_disposition_receipt(op);\n  END IF;\n  RETURN op.result;',
  ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command'])
 ) x(signature,body_md5,anchor,extension,args) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF NOT FOUND OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
   OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] OR p.proargnames IS DISTINCT FROM r.args
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
   RAISE EXCEPTION 'Original invoice financial door changed; reconcile before applying' USING ERRCODE='23514';END IF;
  original_body:=p.prosrc;
  IF strpos(original_body,r.extension)>0 THEN original_body:=replace(original_body,r.extension,r.anchor);END IF;
  IF md5(original_body)<>r.body_md5 OR array_length(string_to_array(original_body,r.anchor),1)<>2 THEN
   RAISE EXCEPTION 'Original invoice financial door changed; reconcile before applying' USING ERRCODE='23514';END IF;
  candidate:=replace(original_body,r.anchor,r.extension);
  IF replace(candidate,r.extension,r.anchor) IS DISTINCT FROM original_body THEN
   RAISE EXCEPTION 'Original invoice source inverse mismatch' USING ERRCODE='23514';END IF;
  IF p.prosrc IS DISTINCT FROM candidate THEN
   definition:=pg_get_functiondef(p.oid);
   IF array_length(string_to_array(definition,p.prosrc),1)<>2 THEN
    RAISE EXCEPTION 'Original invoice definition boundary changed' USING ERRCODE='23514';END IF;
   EXECUTE replace(definition,p.prosrc,candidate);
  END IF;
 END LOOP;
END $original_doors$;
