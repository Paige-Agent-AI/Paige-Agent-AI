-- Reuse canonical commercial writer, current actor gate, approval contract and Collections operations.
-- Fixed draft obligation only: no invoice, signing agreement, mandate or provider execution.
CREATE OR REPLACE FUNCTION public._validate_sales_commercial_terms_command(_command jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF jsonb_typeof(_command) IS DISTINCT FROM 'object'
  OR octet_length(_command::text)>12000
  OR _command->>'action' IS DISTINCT FROM 'collection.create_commercial_terms'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN
   ('action','client_id','offer_id','term_kind','agreed_amount_minor','agreed_currency','billing_interval',
    'interval_count','installments_total','payment_schedule','starts_on','ends_on','title','notes'))
  OR (SELECT count(*) FROM jsonb_object_keys(_command))<>14
  OR coalesce(_command->>'client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(_command->>'offer_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(_command->'agreed_amount_minor') IS DISTINCT FROM 'number'
  OR coalesce(_command->>'agreed_amount_minor','') !~ '^[1-9][0-9]{0,9}$'
  OR coalesce(_command->>'agreed_currency','') !~ '^[a-z]{3}$'
  OR coalesce(_command->>'term_kind','') NOT IN ('one_time','installment')
  OR coalesce(_command->>'payment_schedule','') NOT IN ('on_signing','on_start','in_advance','in_arrears','on_milestone','custom')
  OR coalesce(_command->>'starts_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR (_command->'ends_on'<>'null'::jsonb AND coalesce(_command->>'ends_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  OR jsonb_typeof(_command->'title') NOT IN ('null','string') OR length(_command->>'title')>200
  OR (_command->>'title') IS DISTINCT FROM nullif(btrim(_command->>'title'),'')
  OR (_command->>'notes') IS DISTINCT FROM nullif(btrim(_command->>'notes'),'')
  OR jsonb_typeof(_command->'notes') NOT IN ('null','string') OR length(_command->>'notes')>2000 THEN
  RAISE EXCEPTION 'Invalid fixed commercial record command' USING ERRCODE='22023';
 END IF;
 IF (_command->>'starts_on')::date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
  OR ((_command->>'ends_on') IS NOT NULL AND
   ((_command->>'ends_on')::date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
    OR (_command->>'ends_on')::date<(_command->>'starts_on')::date)) THEN
  RAISE EXCEPTION 'Commercial date bounds invalid' USING ERRCODE='22023'; END IF;
 IF (_command->>'agreed_amount_minor')::bigint>2147483647 THEN
  RAISE EXCEPTION 'Commercial amount exceeds supported range' USING ERRCODE='22023'; END IF;
 IF _command->>'term_kind'='one_time' THEN
  IF _command->'billing_interval'<>'null'::jsonb OR _command->'interval_count'<>'null'::jsonb
   OR _command->'installments_total'<>'null'::jsonb THEN
   RAISE EXCEPTION 'One-time commercial terms cannot imply recurring billing' USING ERRCODE='22023'; END IF;
 ELSE
  IF _command->>'billing_interval' IS DISTINCT FROM 'month'
   OR jsonb_typeof(_command->'interval_count') IS DISTINCT FROM 'number'
   OR coalesce(_command->>'interval_count','') !~ '^[1-9][0-9]?$'
   OR jsonb_typeof(_command->'installments_total') IS DISTINCT FROM 'number'
   OR coalesce(_command->>'installments_total','') !~ '^[1-9][0-9]{0,2}$' THEN
   RAISE EXCEPTION 'Finite installment count and cadence required' USING ERRCODE='22023'; END IF;
  IF (_command->>'interval_count')::integer>12 OR (_command->>'installments_total')::integer NOT BETWEEN 2 AND 240 THEN
   RAISE EXCEPTION 'Finite installment bounds exceeded' USING ERRCODE='22023'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._validate_sales_commercial_terms_command(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._preview_sales_commercial_terms_command(
 _actor_user_id uuid,_expected_tenant_id uuid,_command jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE eligible boolean;client_label text;offer_label text;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._validate_sales_commercial_terms_command(_command);
 eligible:=EXISTS(SELECT 1 FROM public.clients WHERE id=(_command->>'client_id')::uuid AND tenant_id=_expected_tenant_id)
  AND EXISTS(SELECT 1 FROM public.tenant_products WHERE id=(_command->>'offer_id')::uuid AND tenant_id=_expected_tenant_id);
 SELECT public._sales_collection_client_name((_command->>'client_id')::uuid,_expected_tenant_id) INTO client_label;
 SELECT name INTO offer_label FROM public.tenant_products WHERE id=(_command->>'offer_id')::uuid AND tenant_id=_expected_tenant_id;
 RETURN jsonb_build_object('context',jsonb_build_object('client_id',_command->>'client_id','offer_id',_command->>'offer_id',
  'client_name',left(client_label,200),'offer_name',left(offer_label,200),'labels_truncated',coalesce(length(client_label)>200 OR length(offer_label)>200,false)),
  'eligible',eligible,'summary',
  format('Create draft commercial terms for customer %s and offer %s: %s %s minor units; %s; starts %s; ends %s; interval %s months; installment count %s; payment timing %s. No invoice, signature, activated schedule or payment is created.',_command->>'client_id',_command->>'offer_id',upper(_command->>'agreed_currency'),_command->>'agreed_amount_minor',_command->>'term_kind',_command->>'starts_on',coalesce(_command->>'ends_on','not specified'),coalesce(_command->>'interval_count','not applicable'),coalesce(_command->>'installments_total','not applicable'),_command->>'payment_schedule'),
  'consequence',jsonb_build_object('client_id',_command->>'client_id','offer_id',_command->>'offer_id',
   'amount_cents',_command->'agreed_amount_minor','currency',_command->>'agreed_currency',
   'term_kind',_command->>'term_kind','billing_interval',_command->'billing_interval',
   'interval_count',_command->'interval_count','installments_total',_command->'installments_total',
   'payment_schedule',_command->>'payment_schedule','starts_on',_command->>'starts_on','ends_on',_command->'ends_on',
   'state_after','draft','record_owner','commercial_collection_terms','provider_execution','not_started'));
END $$;
REVOKE ALL ON FUNCTION public._preview_sales_commercial_terms_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._create_sales_commercial_terms_command(
 _actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb; saved jsonb; result jsonb; mode text;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 PERFORM public._validate_sales_commercial_terms_command(_command);
 -- Same lock and immutable operation owner as the existing Collections command.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81747));
 prior:=public.read_sales_collection_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,
  'collection.create_commercial_terms','sales_create_commercial_terms',_governance);
 IF _governance->>'approval_channel' IS DISTINCT FROM 'operator_card' THEN
  RAISE EXCEPTION 'High-risk commercial creation requires the canonical reviewed approval' USING ERRCODE='42501'; END IF;
 mode:=public.resolve_tool_autonomy(_expected_tenant_id,'sales_create_commercial_terms');
 IF mode IS NULL OR mode NOT IN ('auto','confirm') THEN
  RAISE EXCEPTION 'Current commercial write authority unavailable' USING ERRCODE='42501'; END IF;
 -- Hold canonical resource ownership stable through the common writer and its readback.
 PERFORM id FROM public.clients WHERE id=(_command->>'client_id')::uuid AND tenant_id=_expected_tenant_id FOR SHARE;
 PERFORM id FROM public.tenant_products WHERE id=(_command->>'offer_id')::uuid AND tenant_id=_expected_tenant_id FOR SHARE;
 saved:=public._save_client_agreement(_actor_user_id,_expected_tenant_id,NULL,
  (_command->>'client_id')::uuid,(_command->>'offer_id')::uuid,_command->>'term_kind','negotiated',NULL,
  (_command->>'agreed_amount_minor')::bigint,_command->>'agreed_currency',_command->>'billing_interval',
  (_command->>'interval_count')::integer,(_command->>'installments_total')::integer,_command->>'payment_schedule',
  (_command->>'starts_on')::date,NULL,(_command->>'ends_on')::date,_command->>'title',_command->>'notes',NULL);
 IF saved->>'tenant_id' IS DISTINCT FROM _expected_tenant_id::text
  OR saved->>'contact_id' IS DISTINCT FROM lower(_command->>'client_id')
  OR saved->>'offer_id' IS DISTINCT FROM lower(_command->>'offer_id')
  OR saved->>'agreed_amount_minor' IS DISTINCT FROM _command->>'agreed_amount_minor'
  OR saved->>'agreed_currency' IS DISTINCT FROM _command->>'agreed_currency'
  OR saved->>'created_by' IS DISTINCT FROM _actor_user_id::text
  OR saved->>'status' IS DISTINCT FROM 'draft'
  OR saved->>'term_kind' IS DISTINCT FROM _command->>'term_kind'
  OR saved->>'price_basis' IS DISTINCT FROM 'negotiated'
  OR saved->>'billing_interval' IS DISTINCT FROM _command->>'billing_interval'
  OR saved->>'interval_count' IS DISTINCT FROM _command->>'interval_count'
  OR saved->>'installments_total' IS DISTINCT FROM _command->>'installments_total'
  OR saved->>'payment_schedule' IS DISTINCT FROM _command->>'payment_schedule'
  OR saved->>'starts_on' IS DISTINCT FROM _command->>'starts_on'
  OR saved->>'ends_on' IS DISTINCT FROM _command->>'ends_on'
  OR saved->>'title' IS DISTINCT FROM _command->>'title'
  OR saved->>'notes' IS DISTINCT FROM _command->>'notes' THEN
  RAISE EXCEPTION 'Commercial record readback unavailable' USING ERRCODE='55000'; END IF;
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_create_commercial_terms','capability_succeeded',_operation_id,NULL);
 result:=jsonb_build_object('ok',true,'outcome','commercial_terms_created','row',
  jsonb_build_object('id',saved->>'id','tenant_id',saved->>'tenant_id','client_id',saved->>'contact_id',
   'offer_id',saved->>'offer_id','status',saved->>'status','amount_cents',saved->'agreed_amount_minor',
   'currency',saved->>'agreed_currency','title',saved->'title'),
  'operation',jsonb_build_object('id',_operation_id,'action','collection.create_commercial_terms'));
 INSERT INTO public.paige_sales_collection_operations(id,tenant_id,actor_user_id,command,result)
 VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._create_sales_commercial_terms_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.preview_sales_collection_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE agreement public.tenant_client_agreements%ROWTYPE;batch public.paige_sales_import_batches%ROWTYPE;review jsonb;
  action text:=_command->>'action';eligible boolean:=false;summary text;invoice public.paige_invoices%ROWTYPE;payment public.paige_invoice_payments%ROWTYPE;received bigint;consequence jsonb;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>600000 THEN RAISE EXCEPTION 'Invalid collection command' USING ERRCODE='22023';END IF;
  IF action='collection.create_commercial_terms' THEN
    RETURN public._preview_sales_commercial_terms_command(_actor_user_id,_expected_tenant_id,_command);
  END IF;
  IF action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    IF jsonb_typeof(_command->'expected_version') IS DISTINCT FROM 'number' OR coalesce(_command->>'expected_version','') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'Invalid imported invoice version' USING ERRCODE='22023';END IF;
    SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
    eligible:=FOUND AND invoice.status='recorded' AND invoice.billing_import_provenance IS NOT NULL AND invoice.billing_import_version=(_command->>'expected_version')::bigint;
    IF action='collection.record_receipt' THEN
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','invoice_id','expected_version','amount_cents','currency','method','received_at','reference','notes']))
        OR jsonb_typeof(_command->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR (_command->>'amount_cents')::bigint>2147483647
        OR coalesce(_command->>'currency','') !~ '^[a-z]{3}$' OR _command->>'method' IS NULL OR _command->>'method' NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR coalesce(_command->>'received_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
        OR (_command->>'reference' IS NOT NULL AND (jsonb_typeof(_command->'reference')<>'string' OR length(_command->>'reference')>200))
        OR (_command->>'notes' IS NOT NULL AND (jsonb_typeof(_command->'notes')<>'string' OR length(_command->>'notes')>2000)) THEN RAISE EXCEPTION 'Invalid imported invoice receipt' USING ERRCODE='22023';END IF;
      IF to_char((_command->>'received_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(_command->>'received_at',19)
        OR (_command->>'received_at')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Received date cannot be in the future' USING ERRCODE='22023';END IF;
      SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
      eligible:=eligible AND lower(invoice.currency)=_command->>'currency' AND received+(_command->>'amount_cents')::bigint<=invoice.amount_total_cents;
      summary:='Record the owner-reported off-platform receipt against this imported obligation. This does not charge money or verify a provider payment.';
    ELSE
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','invoice_id','expected_version','payment_id','reason']))
        OR jsonb_typeof(_command->'reason') IS DISTINCT FROM 'string' OR coalesce(length(trim(_command->>'reason')),0)=0 OR length(_command->>'reason')>500 THEN RAISE EXCEPTION 'Receipt reversal reason required' USING ERRCODE='22023';END IF;
      SELECT * INTO payment FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=invoice.id AND kind='receipt';
      SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
      eligible:=eligible AND payment.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=payment.id);
      summary:='Append one full correction reversing the human-recorded receipt. Original history remains; no money is refunded.';
    END IF;
  ELSIF action='collection.save_terms' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','agreement_id','expected_version','terms']))
      OR coalesce(_command->>'expected_version','') !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'Invalid collection fields' USING ERRCODE='22023';END IF;
    PERFORM public._sales_collection_validate_terms(_command->'terms');
    SELECT * INTO agreement FROM public.tenant_client_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id;
    eligible:=FOUND AND agreement.collection_terms_version=(_command->>'expected_version')::bigint AND agreement.status IN ('draft','active','paused')
      AND agreement.agreed_amount_minor=(_command#>>'{terms,total_cents}')::bigint AND agreement.agreed_currency=_command#>>'{terms,currency}'
      AND EXISTS(SELECT 1 FROM public.clients WHERE id=agreement.contact_id AND tenant_id=_expected_tenant_id);
    summary:='Save this client agreement collection schedule and agreed fee metadata. No invoice, accrual or charge is created.';
  ELSIF action='collection.stage_import' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','source_account','rows'])) THEN RAISE EXCEPTION 'Invalid import fields' USING ERRCODE='22023';END IF;
    review:=public._sales_collection_review_import(_expected_tenant_id,_command->>'source_account',_command->'rows');eligible:=true;
    summary:='Stage up to 200 mapped historical CSV records for review. No invoice or receipt is created; conflicts remain explicit.';
  ELSIF action='collection.commit_import' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k<>ALL(ARRAY['action','batch_id','expected_digest'])) OR coalesce(_command->>'expected_digest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid reviewed import identity' USING ERRCODE='22023';END IF;
    SELECT * INTO batch FROM public.paige_sales_import_batches WHERE id=(_command->>'batch_id')::uuid AND tenant_id=_expected_tenant_id AND actor_user_id=_actor_user_id;
    IF FOUND AND batch.state='staged' AND batch.content_digest=_command->>'expected_digest' THEN
      review:=public._sales_collection_review_import(_expected_tenant_id,batch.source_account,batch.rows);eligible:=coalesce((review->>'eligible_commit')::boolean,false);
    END IF;
    summary:='Import the exact reviewed CSV batch into canonical invoices and human-recorded receipts. No customer is created, payment charged or provider verification claimed.';
  ELSE RAISE EXCEPTION 'Unknown collection action' USING ERRCODE='22023';END IF;
  IF eligible AND action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    consequence:=jsonb_build_object('invoice_number',invoice.invoice_number,'currency',lower(invoice.currency),
      'original_total_cents',invoice.amount_total_cents,'remaining_cents',invoice.amount_total_cents-received,
      'amount_cents',CASE WHEN action='collection.record_receipt' THEN (_command->>'amount_cents')::integer ELSE payment.amount_cents END,
      'method',CASE WHEN action='collection.record_receipt' THEN _command->>'method' ELSE payment.method END,
      'received_at',CASE WHEN action='collection.record_receipt' THEN (_command->>'received_at')::timestamptz ELSE payment.received_at END,
      'resulting_remaining_cents',invoice.amount_total_cents-received+CASE WHEN action='collection.record_receipt' THEN -(_command->>'amount_cents')::integer ELSE payment.amount_cents END);
  END IF;
  RETURN jsonb_build_object('eligible',eligible,'summary',summary,'review',review,'consequence',consequence);
END $$;
CREATE OR REPLACE FUNCTION public.execute_sales_collection_command(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE action text:=_command->>'action';tool text;result jsonb;prior jsonb;preview jsonb;review jsonb;
  agreement public.tenant_client_agreements%ROWTYPE;batch public.paige_sales_import_batches%ROWTYPE;
  binding public.paige_sales_import_bindings%ROWTYPE;row jsonb;target uuid;payment uuid;provenance jsonb;received bigint;invoice public.paige_invoices%ROWTYPE;written integer:=0;matched integer:=0;new_invoice_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF action='collection.create_commercial_terms' THEN
    RETURN public._create_sales_commercial_terms_command(_actor_user_id,_expected_tenant_id,_operation_id,_command,_governance);
  END IF;
  IF _operation_id IS NULL THEN RAISE EXCEPTION 'Collection operation required' USING ERRCODE='22023';END IF;
  tool:=CASE action WHEN 'collection.save_terms' THEN 'sales_save_collection_terms' WHEN 'collection.stage_import' THEN 'sales_stage_collection_import' WHEN 'collection.commit_import' THEN 'sales_commit_collection_import' WHEN 'collection.record_receipt' THEN 'sales_record_manual_payment' WHEN 'collection.reverse_receipt' THEN 'sales_reverse_manual_payment' END;
  IF tool IS NULL THEN RAISE EXCEPTION 'Unknown collection action' USING ERRCODE='22023';END IF;
  PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,action,tool,_governance);
  PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81747));
  prior:=public.read_sales_collection_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
  IF prior IS NOT NULL THEN RETURN prior;END IF;
  IF action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
  ELSIF action='collection.save_terms' THEN
    SELECT * INTO agreement FROM public.tenant_client_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
  ELSIF action='collection.commit_import' THEN
    SELECT * INTO batch FROM public.paige_sales_import_batches WHERE id=(_command->>'batch_id')::uuid AND tenant_id=_expected_tenant_id AND actor_user_id=_actor_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed import unavailable' USING ERRCODE='42501';END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(_expected_tenant_id::text||':'||batch.source_account,81748));
    -- Existing receipt writers lock invoices too. Stable order avoids cross-import deadlocks.
    PERFORM i.id FROM public.paige_invoices i WHERE i.tenant_id=_expected_tenant_id AND i.id IN (
      SELECT (r.value->>'invoice_id')::uuid FROM jsonb_array_elements(batch.rows) r WHERE r.value->>'invoice_id' IS NOT NULL
      UNION
      SELECT b.invoice_id FROM jsonb_array_elements(batch.rows) r JOIN public.paige_sales_import_bindings b
        ON b.tenant_id=_expected_tenant_id AND b.source_account=batch.source_account AND b.entity='invoice' AND b.entity_id=r.value->>'invoice_entity_id'
      UNION
      SELECT (mapped.value->>'invoice_id')::uuid FROM jsonb_array_elements(batch.rows) receipt
        JOIN jsonb_array_elements(batch.rows) mapped ON mapped.value->>'entity'='invoice' AND mapped.value->>'entity_id'=receipt.value->>'invoice_entity_id'
        WHERE mapped.value->>'invoice_id' IS NOT NULL
    ) ORDER BY i.id FOR UPDATE;
  END IF;
  preview:=public.preview_sales_collection_command(_actor_user_id,_expected_tenant_id,_command);
  IF preview->'eligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Collection input is stale, unavailable or conflicted' USING ERRCODE='22023';END IF;
  IF action IN ('collection.record_receipt','collection.reverse_receipt') THEN
    IF action='collection.record_receipt' THEN
      INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes)
        VALUES(_operation_id,invoice.id,_expected_tenant_id,_actor_user_id,'receipt',(_command->>'amount_cents')::integer,_command->>'currency',_command->>'method',(_command->>'received_at')::timestamptz,_command->>'reference',_command->>'notes');
    ELSE
      SELECT to_jsonb(p) INTO row FROM public.paige_invoice_payments p WHERE p.id=(_command->>'payment_id')::uuid AND p.invoice_id=invoice.id AND p.tenant_id=_expected_tenant_id;
      INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
        VALUES(_operation_id,invoice.id,_expected_tenant_id,_actor_user_id,'reversal',(row->>'amount_cents')::integer,row->>'currency',row->>'method',(row->>'received_at')::timestamptz,(row->>'id')::uuid,_command->>'reason');
    END IF;
    UPDATE public.paige_invoices SET billing_import_version=billing_import_version+1 WHERE id=invoice.id AND billing_import_version=(_command->>'expected_version')::bigint RETURNING * INTO invoice;
    IF NOT FOUND THEN RAISE EXCEPTION 'Imported invoice changed' USING ERRCODE='40001';END IF;
    SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE invoice_id=invoice.id AND tenant_id=_expected_tenant_id;
    result:=jsonb_build_object('ok',true,'row',jsonb_build_object('id',invoice.id,'tenant_id',invoice.tenant_id,'status',invoice.status,'version',invoice.billing_import_version,'currency',lower(invoice.currency),'amount_cents',invoice.amount_total_cents,'manual_recorded_cents',received,'remaining_cents',invoice.amount_total_cents-received));
  ELSIF action='collection.save_terms' THEN
    UPDATE public.tenant_client_agreements SET collection_terms=_command->'terms',collection_terms_version=collection_terms_version+1
      WHERE id=agreement.id AND tenant_id=_expected_tenant_id AND collection_terms_version=(_command->>'expected_version')::bigint RETURNING * INTO agreement;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collection terms changed' USING ERRCODE='40001';END IF;
    result:=jsonb_build_object('ok',true,'row',jsonb_build_object('id',agreement.id,'tenant_id',agreement.tenant_id,'collection_terms',agreement.collection_terms,'collection_terms_version',agreement.collection_terms_version));
  ELSIF action='collection.stage_import' THEN
    review:=preview->'review';
    INSERT INTO public.paige_sales_import_batches(id,tenant_id,actor_user_id,source_account,rows,content_digest,review)
      VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command->>'source_account',_command->'rows',encode(extensions.digest((_command->'rows')::text,'sha256'),'hex'),review) RETURNING * INTO batch;
    result:=jsonb_build_object('ok',true,'batch',jsonb_build_object('id',batch.id,'content_digest',batch.content_digest,'state',batch.state,'review',batch.review,'source_account',batch.source_account,'rows',batch.rows));
  ELSE
    FOR row IN SELECT value FROM jsonb_array_elements(batch.rows) ORDER BY CASE WHEN value->>'entity'='invoice' THEN 0 ELSE 1 END LOOP
      SELECT * INTO binding FROM public.paige_sales_import_bindings WHERE tenant_id=_expected_tenant_id AND source_account=batch.source_account AND entity=row->>'entity' AND entity_id=row->>'entity_id';
      IF FOUND THEN matched:=matched+1;CONTINUE;END IF;
      provenance:=jsonb_build_object('source','csv','source_account',batch.source_account,'entity_id',row->>'entity_id','batch_id',batch.id,'imported_by',_actor_user_id,'imported_at',clock_timestamp(),'evidence','owner_imported_unverified');
      IF row->>'entity'='invoice' THEN
        target:=(row->>'invoice_id')::uuid;payment:=NULL;
        IF target IS NULL THEN
          target:=gen_random_uuid();
          INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,memo,line_items,created_by,billing_import_provenance,billing_import_version)
            VALUES(target,_expected_tenant_id,(row->>'client_id')::uuid,'CSV-'||target::text,'recorded',(row->>'amount_cents')::integer,row->>'currency',(row->>'due_date')::date,row->>'memo','[]',_actor_user_id,provenance||jsonb_build_object('source_invoice_number',row->>'invoice_number'),1);
          new_invoice_ids:=array_append(new_invoice_ids,target);
          written:=written+1;
        ELSE matched:=matched+1;END IF;
      ELSE
        target:=(row->>'invoice_id')::uuid;
        IF target IS NULL THEN SELECT invoice_id INTO target FROM public.paige_sales_import_bindings WHERE tenant_id=_expected_tenant_id AND source_account=batch.source_account AND entity='invoice' AND entity_id=row->>'invoice_entity_id';END IF;
        payment:=(row->>'payment_id')::uuid;
        IF payment IS NULL THEN
          SELECT * INTO invoice FROM public.paige_invoices WHERE id=target AND tenant_id=_expected_tenant_id FOR UPDATE;
          IF NOT FOUND OR invoice.status NOT IN ('issued','recorded') OR lower(invoice.currency)<>row->>'currency' THEN RAISE EXCEPTION 'Receipt invoice changed' USING ERRCODE='42501';END IF;
          SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received FROM public.paige_invoice_payments WHERE invoice_id=target AND tenant_id=_expected_tenant_id;
          IF received+(row->>'amount_cents')::bigint>invoice.amount_total_cents THEN RAISE EXCEPTION 'Receipt exceeds remaining amount' USING ERRCODE='22023';END IF;
          payment:=gen_random_uuid();
          INSERT INTO public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,import_provenance)
            VALUES(payment,target,_expected_tenant_id,_actor_user_id,'receipt',(row->>'amount_cents')::integer,row->>'currency',row->>'method',(row->>'received_at')::timestamptz,row->>'reference',provenance);
          IF NOT(target=ANY(new_invoice_ids)) THEN
            UPDATE public.paige_invoices SET
              billing_import_version=CASE WHEN status='recorded' THEN billing_import_version+1 ELSE billing_import_version END,
              billing_lifecycle_version=CASE WHEN status='issued' THEN billing_lifecycle_version+1 ELSE billing_lifecycle_version END
              WHERE id=target AND tenant_id=_expected_tenant_id;
          END IF;
          written:=written+1;
        ELSE matched:=matched+1;END IF;
      END IF;
      INSERT INTO public.paige_sales_import_bindings(tenant_id,source_account,entity,entity_id,invoice_id,payment_id,row_digest,batch_id)
        VALUES(_expected_tenant_id,batch.source_account,row->>'entity',row->>'entity_id',target,payment,encode(extensions.digest(row::text,'sha256'),'hex'),batch.id);
    END LOOP;
    UPDATE public.paige_sales_import_batches SET state='committed',committed_at=clock_timestamp() WHERE id=batch.id;
    result:=jsonb_build_object('ok',true,'batch',jsonb_build_object('id',batch.id,'state','committed','written',written,'matched',matched,'provenance','owner_imported_unverified'));
  END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
  result:=result||jsonb_build_object('operation',jsonb_build_object('id',_operation_id,'action',action));
  INSERT INTO public.paige_sales_collection_operations(id,tenant_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
-- Extend the installed catalogue without replacing other lanes' rows or scope gate.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_commercial_create(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_commercial_create;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_commercial_create(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_commercial_create(uuid) FROM service_role;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_commercial_create(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id;END IF;
 ELSE tenant:=_tenant_id;END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('sales_create_commercial_terms','Create customer commercial terms','Payments')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
