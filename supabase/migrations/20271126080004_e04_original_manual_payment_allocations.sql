-- EXP04 original manual receipt allocation, with no new financial ledger.
-- Forward after the published E08/E05/E09 chain through20271126070005.
-- Reconcile actual serialized frontier before apply; never edit applied history.
-- Original invoices, receipts, immutable operations, approval and Rail only.
BEGIN;
DO $guard$
DECLARE r record; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','30fc276b44df8139a6fc6e87d53f2fb5','73c5a267f0e82184af5175f2a2ea5337',false,'{postgres=X/postgres}','search_path=""'),
('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','fcbb272628a13b5dc218bb72489b5c0a','c60acebbbb08b7bd7d1a9b23a47f595d',true,'{postgres=X/postgres}','search_path=pg_catalog, public'),
('public.preview_sales_invoice_command(uuid,uuid,jsonb)','6a7e67779cc1f1cf04f7ba9b63306b29','9ecfe85e6d8638082ee14f9b13acff47',true,'{postgres=X/postgres,service_role=X/postgres}','search_path=pg_catalog, public')
 ) s(signature,before_hash,after_hash,definer,acl,setting) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN (r.before_hash,r.after_hash) OR p.prosecdef IS DISTINCT FROM r.definer OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY[r.setting] OR p.proacl::text IS DISTINCT FROM r.acl THEN
   RAISE EXCEPTION 'Original invoice allocation source/authority changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_manual_allocation_intent(jsonb)','ec8901155ca379109b5943bd70f7b21f'),
('public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments)','e78b33d1d51b1d8c17917c8b187aab49'),
('public._sales_invoice_manual_allocations(public.paige_invoices)','3c61f861589053563c036341548117bf'),
('public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)','e176660d985e862db589fc11d9c2d4fa')
 ) s(signature,body_hash) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF FOUND AND (pg_catalog.md5(p.prosrc) IS DISTINCT FROM r.body_hash OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.provolatile::text IS DISTINCT FROM (CASE r.signature WHEN 'public._sales_invoice_manual_allocation_intent(jsonb)' THEN 'i' WHEN 'public._sales_invoice_manual_allocations(public.paige_invoices)' THEN 's' WHEN 'public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments)' THEN 's' ELSE 'v' END) OR p.prorettype IS DISTINCT FROM (CASE WHEN r.signature='public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)' THEN 'void'::regtype ELSE 'jsonb'::regtype END) OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
   RAISE EXCEPTION 'Existing private allocation helper changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_actor(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM '27202521ef9750d3246ee5e5e11018aa'
  OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
  OR p.prorettype<>'void'::regtype OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original invoice authority changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $guard$;

DO $owner_guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid)');
 IF FOUND AND (pg_catalog.md5(p.prosrc) IS DISTINCT FROM 'ee99c79a9b855c788d10e3c3ed653c52' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_invoice_id','_expected_version','_payment_id']) THEN
  RAISE EXCEPTION 'Original receipt inspection API changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $owner_guard$;


-- A closed transport validator, not authority or provider evidence. Original
-- source/currentness is checked separately under the original invoice lock.
CREATE OR REPLACE FUNCTION public._sales_invoice_manual_allocation_intent(_command jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $intent$
DECLARE item jsonb; obligation jsonb; reference jsonb; allocations jsonb; source jsonb;
 seen jsonb:='[]'::jsonb; amount bigint; total bigint:=0; key text;
BEGIN
 IF pg_catalog.jsonb_typeof(_command) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
 IF NOT (_command ? 'allocations') THEN RETURN NULL; END IF;
 IF _command->>'action' IS DISTINCT FROM 'invoice.record_manual_payment'
  OR _command->>'currency' IS DISTINCT FROM 'usd'
  OR pg_catalog.jsonb_typeof(_command->'amount_cents') IS DISTINCT FROM 'number'
  OR coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$'
  OR pg_catalog.jsonb_typeof(_command->'allocations') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
 IF (_command->>'amount_cents')::bigint>2147483647
  OR pg_catalog.jsonb_array_length(_command->'allocations') NOT BETWEEN 1 AND 240 THEN
  RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
 allocations:=_command->'allocations';
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(allocations) LOOP
  IF pg_catalog.jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item))<>2 OR item-ARRAY['obligation','amount_cents']<>'{}'::jsonb
   OR pg_catalog.jsonb_typeof(item->'amount_cents') IS DISTINCT FROM 'number'
   OR coalesce(item->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$'
   OR pg_catalog.jsonb_typeof(item->'obligation') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  obligation:=item->'obligation';reference:=obligation->'reference';
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(obligation))<>5
   OR obligation-ARRAY['reference','source_digest','due_date','scheduled_minor','remaining_minor']<>'{}'::jsonb
   OR pg_catalog.jsonb_typeof(reference) IS DISTINCT FROM 'object'
   OR pg_catalog.jsonb_typeof(obligation->'source_digest') IS DISTINCT FROM 'string'
   OR pg_catalog.jsonb_typeof(obligation->'due_date') IS DISTINCT FROM 'string'
   OR coalesce(obligation->>'source_digest','') !~ '^[a-f0-9]{64}$'
   OR coalesce(obligation->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(reference))<>5
   OR reference-ARRAY['commercial_terms_id','signing_id','signing_version','terms_version','sequence']<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  FOREACH key IN ARRAY ARRAY['commercial_terms_id','signing_id'] LOOP
   IF pg_catalog.jsonb_typeof(reference->key) IS DISTINCT FROM 'string'
    OR coalesce(reference->>key,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['signing_version','terms_version','sequence'] LOOP
   IF pg_catalog.jsonb_typeof(reference->key) IS DISTINCT FROM 'number'
    OR coalesce(reference->>key,'') !~ '^(0|[1-9][0-9]{0,15})$' THEN
    RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
   IF (reference->>key)::bigint>9007199254740991
    OR key<>'terms_version' AND (reference->>key)::bigint<1
    OR key='sequence' AND (reference->>key)::bigint>240 THEN
    RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['scheduled_minor','remaining_minor'] LOOP
   IF pg_catalog.jsonb_typeof(obligation->key) IS DISTINCT FROM 'number'
    OR coalesce(obligation->>key,'') !~ '^[1-9][0-9]{0,9}$' THEN
    RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
   IF (obligation->>key)::bigint>2147483647 THEN
    RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  END LOOP;
  PERFORM (obligation->>'due_date')::date;
  amount:=(item->>'amount_cents')::bigint;
  IF amount>(obligation->>'remaining_minor')::bigint
   OR (obligation->>'remaining_minor')::bigint>(obligation->>'scheduled_minor')::bigint
   OR seen @> pg_catalog.jsonb_build_array(reference)
   OR source IS NOT NULL AND source IS DISTINCT FROM pg_catalog.jsonb_build_object('reference',reference-'sequence','digest',obligation->'source_digest') THEN
   RAISE EXCEPTION 'Invalid manual payment allocation' USING ERRCODE='22023'; END IF;
  source:=pg_catalog.jsonb_build_object('reference',reference-'sequence','digest',obligation->'source_digest');
  seen:=seen||pg_catalog.jsonb_build_array(reference);total:=total+amount;
 END LOOP;
 IF total IS DISTINCT FROM (_command->>'amount_cents')::bigint THEN
  RAISE EXCEPTION 'Manual payment allocations must match the received amount' USING ERRCODE='22023'; END IF;
 RETURN allocations;
END $intent$;
REVOKE ALL ON FUNCTION public._sales_invoice_manual_allocation_intent(jsonb) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public._sales_invoice_manual_receipt_allocations(_invoice public.paige_invoices,payment public.paige_invoice_payments)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $receipt$
DECLARE operation public.paige_invoice_operations%ROWTYPE; allocations jsonb;
BEGIN
 IF payment.tenant_id IS DISTINCT FROM _invoice.tenant_id OR payment.invoice_id IS DISTINCT FROM _invoice.id
  OR payment.kind IS DISTINCT FROM 'receipt' OR payment.evidence_kind IS DISTINCT FROM 'manual_recorded'
  OR payment.currency IS DISTINCT FROM pg_catalog.lower(_invoice.currency) THEN
  RAISE EXCEPTION 'Original received-payment evidence unavailable' USING ERRCODE='22023'; END IF;
  SELECT * INTO operation FROM public.paige_invoice_operations o WHERE o.id=payment.id AND o.tenant_id=payment.tenant_id
   AND o.invoice_id=payment.invoice_id AND o.actor_user_id=payment.actor_user_id;
  IF NOT FOUND OR operation.command->>'action' IS DISTINCT FROM 'invoice.record_manual_payment'
   OR operation.command->>'invoice_id' IS DISTINCT FROM payment.invoice_id::text
   OR operation.command->'amount_cents' IS DISTINCT FROM pg_catalog.to_jsonb(payment.amount_cents)
   OR operation.command->>'currency' IS DISTINCT FROM payment.currency
   OR operation.command->>'method' IS DISTINCT FROM payment.method
   OR operation.command->>'reference' IS DISTINCT FROM payment.reference
   OR operation.command->>'notes' IS DISTINCT FROM payment.notes
   OR (operation.command->>'received_at')::timestamptz IS DISTINCT FROM payment.received_at
   OR operation.result->'ok' IS DISTINCT FROM 'true'::jsonb
   OR operation.result#>>'{operation,id}' IS DISTINCT FROM operation.id::text
   OR operation.result#>>'{operation,action}' IS DISTINCT FROM 'invoice.record_manual_payment'
   OR payment.provider_operation_id IS NOT NULL OR payment.provider_environment IS NOT NULL THEN RAISE EXCEPTION 'Original received-payment evidence unavailable' USING ERRCODE='22023'; END IF;
  allocations:=public._sales_invoice_manual_allocation_intent(operation.command);

 RETURN allocations;
END $receipt$;
REVOKE ALL ON FUNCTION public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments) FROM PUBLIC,anon,authenticated,service_role;

-- Derive only from original immutable operations and receipts. No copied ledger.
-- A valid original full reversal has zero allocation effect, including legacy
-- unassigned receipts. Other missing/malformed provenance remains unassigned.
CREATE OR REPLACE FUNCTION public._sales_invoice_manual_allocations(_invoice public.paige_invoices)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $manual$
DECLARE payment public.paige_invoice_payments%ROWTYPE; operation public.paige_invoice_operations%ROWTYPE;
 reverse_row public.paige_invoice_payments%ROWTYPE; allocations jsonb; result jsonb:='[]'::jsonb; reverse_count bigint;
BEGIN
 FOR payment IN SELECT * FROM public.paige_invoice_payments p WHERE p.tenant_id=_invoice.tenant_id
  AND p.invoice_id=_invoice.id AND p.kind='receipt' AND p.evidence_kind='manual_recorded' LOOP
  SELECT count(*) INTO reverse_count FROM public.paige_invoice_payments p WHERE p.reverses_payment_id=payment.id;
  IF reverse_count>1 THEN RETURN NULL; END IF;
  IF reverse_count=1 THEN
   SELECT * INTO STRICT reverse_row FROM public.paige_invoice_payments p WHERE p.reverses_payment_id=payment.id;
   IF reverse_row.kind IS DISTINCT FROM 'reversal' OR reverse_row.tenant_id IS DISTINCT FROM payment.tenant_id
    OR reverse_row.invoice_id IS DISTINCT FROM payment.invoice_id OR reverse_row.amount_cents IS DISTINCT FROM payment.amount_cents
    OR reverse_row.currency IS DISTINCT FROM payment.currency OR reverse_row.evidence_kind IS DISTINCT FROM 'manual_recorded'
    OR reverse_row.provider_operation_id IS NOT NULL THEN RETURN NULL; END IF;
   CONTINUE;
  END IF;
  allocations:=public._sales_invoice_manual_receipt_allocations(_invoice,payment);
  IF allocations IS NULL THEN RETURN NULL; END IF;
  result:=result||allocations;
 END LOOP;
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_parameter_value THEN RETURN NULL;
END $manual$;
REVOKE ALL ON FUNCTION public._sales_invoice_manual_allocations(public.paige_invoices) FROM PUBLIC,anon,authenticated,service_role;

-- Invoked by the original preview and, crucially, by the ORIGINAL executor AFTER
-- its actor/approval/replay/version/issued-invoice/payment checks and invoice lock.
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
 observation:=public._sales_invoice_accepted_obligations(_invoice,(allocations#>>'{0,obligation,reference,signing_id}')::uuid);
 IF observation->>'state' IS DISTINCT FROM 'available' THEN
  RAISE EXCEPTION 'Accepted payment allocation unavailable; inspect original receipts' USING ERRCODE='40001'; END IF;
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(allocations) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(observation->'obligations') o WHERE o.value=item->'obligation') THEN
   RAISE EXCEPTION 'Accepted payment allocation changed; review again' USING ERRCODE='40001'; END IF;
 END LOOP;
END $require$;
REVOKE ALL ON FUNCTION public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb) FROM PUBLIC,anon,authenticated,service_role;


-- Original owner admission and immutable source only. No Portal DTO/reader change.
CREATE OR REPLACE FUNCTION public.read_sales_invoice_manual_allocations(_expected_tenant_id uuid,_invoice_id uuid,_expected_version bigint,_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $owner$
DECLARE invoice public.paige_invoices%ROWTYPE; payment public.paige_invoice_payments%ROWTYPE;
 correction public.paige_invoice_payments%ROWTYPE; correction_count bigint; assignments jsonb; base jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 IF _expected_version IS NULL OR _expected_version<1 OR coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version)<>_expected_version THEN
  RAISE EXCEPTION 'Invoice version conflict; reload original invoice' USING ERRCODE='40001'; END IF;
 SELECT * INTO payment FROM public.paige_invoice_payments WHERE id=_payment_id AND tenant_id=_expected_tenant_id AND invoice_id=invoice.id
  AND kind='receipt' AND evidence_kind='manual_recorded' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original manual receipt unavailable' USING ERRCODE='42501'; END IF;
 base:=pg_catalog.jsonb_build_object('invoice_id',invoice.id,'invoice_version',_expected_version,'payment_id',payment.id,
  'amount_cents',payment.amount_cents,'currency',payment.currency,'reversal_payment_id',NULL,'allocations','[]'::jsonb);
 BEGIN
  assignments:=public._sales_invoice_manual_receipt_allocations(invoice,payment);
  SELECT count(*) INTO correction_count FROM public.paige_invoice_payments WHERE reverses_payment_id=payment.id;
  IF correction_count>1 THEN RAISE EXCEPTION 'Conflicting original correction' USING ERRCODE='22023'; END IF;
  IF correction_count=1 THEN
   SELECT * INTO STRICT correction FROM public.paige_invoice_payments WHERE reverses_payment_id=payment.id;
   IF correction.kind IS DISTINCT FROM 'reversal' OR correction.tenant_id IS DISTINCT FROM payment.tenant_id
    OR correction.invoice_id IS DISTINCT FROM payment.invoice_id OR correction.amount_cents IS DISTINCT FROM payment.amount_cents
    OR correction.currency IS DISTINCT FROM payment.currency OR correction.evidence_kind IS DISTINCT FROM 'manual_recorded'
    OR correction.provider_operation_id IS NOT NULL OR correction.provider_environment IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting original correction' USING ERRCODE='22023'; END IF;
   base:=base||pg_catalog.jsonb_build_object('reversal_payment_id',correction.id);
  END IF;
  RETURN base||pg_catalog.jsonb_build_object('state',CASE WHEN assignments IS NULL THEN 'unassigned' ELSE 'assigned' END,'allocations',coalesce(assignments,'[]'::jsonb));
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_parameter_value THEN
  RETURN base||pg_catalog.jsonb_build_object('state','unverified');
 END;
END $owner$;
REVOKE ALL ON FUNCTION public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid) TO authenticated;

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
 SELECT * INTO STRICT balance FROM public._sales_invoice_balance_rows(_invoice.tenant_id,_invoice.id);
 -- Original balance source already distinguishes TEST provider evidence. It must
 -- not become proof that a customer's actual commercial obligation was fulfilled.
 IF balance.test_provider_minor>0 THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','test_payment_evidence');
 END IF;
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
 IF allocated_total IS DISTINCT FROM balance.allocated_minor THEN
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
    SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0) INTO received
      FROM public.paige_invoice_payments WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id;
    IF action='invoice.record_manual_payment' THEN
      IF coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR _command->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(_command->>'method','') NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR nullif(_command->>'received_at','') IS NULL OR length(_command->>'reference')>200 OR length(_command->>'notes')>2000 THEN
        RAISE EXCEPTION 'Check payment amount, method, currency and date' USING ERRCODE='22023'; END IF;
      amount:=(_command->>'amount_cents')::bigint;
      IF amount>2147483647 OR received+amount>r.amount_total_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION public.preview_sales_invoice_command(_actor_user_id uuid, _expected_tenant_id uuid, _command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb; invoice public.paige_invoices%ROWTYPE; allocation_summary text;
BEGIN
 result:=public._preview_sales_invoice_before_provider(_actor_user_id,_expected_tenant_id,_command);
 IF _command->>'action'='invoice.reverse_manual_payment' AND EXISTS(SELECT 1 FROM public.paige_invoice_payments
  WHERE tenant_id=_expected_tenant_id AND invoice_id=(_command->>'invoice_id')::uuid
   AND id=(_command->>'payment_id')::uuid AND evidence_kind='provider_verified') THEN
  RETURN result||jsonb_build_object('eligible',false,'summary','This payment was confirmed by the payment provider. A provider refund or reversal must be reconciled before its allocation can change.');
 END IF;
 IF result->'eligible'='true' AND _command->>'action'='invoice.record_manual_payment' AND _command ? 'allocations' THEN
  SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=_expected_tenant_id AND id=(_command->>'invoice_id')::uuid FOR SHARE;
  PERFORM public._sales_invoice_require_manual_allocations(invoice,_command);
  SELECT pg_catalog.string_agg(pg_catalog.format('Payment %s · $%s USD · due %s · accepted terms version %s · signing version %s',
   a.value#>>'{obligation,reference,sequence}',pg_catalog.to_char((a.value->>'amount_cents')::numeric/100,'FM999999999999990.00'),
   a.value#>>'{obligation,due_date}',a.value#>>'{obligation,reference,terms_version}',a.value#>>'{obligation,reference,signing_version}'),E'\n' ORDER BY a.ordinality)
   INTO allocation_summary FROM pg_catalog.jsonb_array_elements(_command->'allocations') WITH ORDINALITY a;
  result:=result||pg_catalog.jsonb_build_object('manual_allocations',_command->'allocations',
   'summary',(result->>'summary')||E'\nAccepted payment assignments:\n'||allocation_summary);
 END IF;
 RETURN result;
END $function$;
DO $guard$
DECLARE r record; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','30fc276b44df8139a6fc6e87d53f2fb5','73c5a267f0e82184af5175f2a2ea5337',false,'{postgres=X/postgres}','search_path=""'),
('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','fcbb272628a13b5dc218bb72489b5c0a','c60acebbbb08b7bd7d1a9b23a47f595d',true,'{postgres=X/postgres}','search_path=pg_catalog, public'),
('public.preview_sales_invoice_command(uuid,uuid,jsonb)','6a7e67779cc1f1cf04f7ba9b63306b29','9ecfe85e6d8638082ee14f9b13acff47',true,'{postgres=X/postgres,service_role=X/postgres}','search_path=pg_catalog, public')
 ) s(signature,before_hash,after_hash,definer,acl,setting) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM r.after_hash OR p.prosecdef IS DISTINCT FROM r.definer OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY[r.setting] OR p.proacl::text IS DISTINCT FROM r.acl THEN
   RAISE EXCEPTION 'Original invoice allocation source/authority changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_manual_allocation_intent(jsonb)','ec8901155ca379109b5943bd70f7b21f'),
('public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments)','e78b33d1d51b1d8c17917c8b187aab49'),
('public._sales_invoice_manual_allocations(public.paige_invoices)','3c61f861589053563c036341548117bf'),
('public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)','e176660d985e862db589fc11d9c2d4fa')
 ) s(signature,body_hash) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF NOT FOUND OR (pg_catalog.md5(p.prosrc) IS DISTINCT FROM r.body_hash OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.provolatile::text IS DISTINCT FROM (CASE r.signature WHEN 'public._sales_invoice_manual_allocation_intent(jsonb)' THEN 'i' WHEN 'public._sales_invoice_manual_allocations(public.paige_invoices)' THEN 's' WHEN 'public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments)' THEN 's' ELSE 'v' END) OR p.prorettype IS DISTINCT FROM (CASE WHEN r.signature='public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)' THEN 'void'::regtype ELSE 'jsonb'::regtype END) OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
   RAISE EXCEPTION 'Existing private allocation helper changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_actor(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM '27202521ef9750d3246ee5e5e11018aa'
  OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
  OR p.prorettype<>'void'::regtype OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original invoice authority changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $guard$;

DO $owner_guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid)');
 IF NOT FOUND OR (pg_catalog.md5(p.prosrc) IS DISTINCT FROM 'ee99c79a9b855c788d10e3c3ed653c52' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_invoice_id','_expected_version','_payment_id']) THEN
  RAISE EXCEPTION 'Original receipt inspection API changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $owner_guard$;

COMMIT;
