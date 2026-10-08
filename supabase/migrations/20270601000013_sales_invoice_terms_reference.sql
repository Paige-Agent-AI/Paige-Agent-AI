-- Invoice-owned reference only: reuse the one writer and existing commercial package reader.
-- No signing mutation, balance store, collection activation or provider effect.
-- Deposit bindings require current custom/typed-deposit initial obligations; other
-- recorded kinds are incompatible. Missing/stale schedules remain unresolved.
CREATE OR REPLACE FUNCTION public._sales_invoice_terms_reference_shape(_reference jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF jsonb_typeof(_reference) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(_reference))<>2
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_reference) k WHERE k NOT IN ('id','version'))
  OR jsonb_typeof(_reference->'id') IS DISTINCT FROM 'string'
  OR coalesce(_reference->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(_reference->'version') IS DISTINCT FROM 'number'
  OR coalesce(_reference->>'version','') !~ '^(0|[1-9][0-9]{0,15})$'
  OR (_reference->>'version')::bigint>9007199254740991 THEN
  RAISE EXCEPTION 'Invalid commercial terms reference' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('id',(_reference->>'id')::uuid,'version',(_reference->>'version')::bigint);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_terms_reference_shape(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_validate_invoice_terms_reference(_tenant uuid,_client uuid,_reference jsonb,_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE reference jsonb; terms public.tenant_client_agreements%ROWTYPE;
BEGIN
 reference:=public._sales_invoice_terms_reference_shape(_reference);
 SELECT * INTO terms FROM public.tenant_client_agreements WHERE id=(reference->>'id')::uuid
  AND tenant_id=_tenant AND contact_id=_client FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commercial terms unavailable' USING ERRCODE='42501';END IF;
 IF terms.collection_terms_version IS DISTINCT FROM (reference->>'version')::bigint THEN
  RAISE EXCEPTION 'Commercial terms version changed' USING ERRCODE='40001';END IF;
 IF terms.status IS NULL OR terms.status NOT IN ('draft','active','paused') THEN
  RAISE EXCEPTION 'Commercial terms inactive' USING ERRCODE='22023';END IF;
 IF terms.agreed_amount_minor IS NULL OR terms.agreed_currency IS NULL
  OR terms.agreed_amount_minor IS DISTINCT FROM (_snapshot->>'total_minor')::bigint
  OR terms.agreed_currency IS DISTINCT FROM _snapshot->>'currency' THEN
  RAISE EXCEPTION 'Invoice and commercial terms economics disagree' USING ERRCODE='22023';END IF;
 IF _snapshot->>'kind'='deposit' AND terms.collection_terms IS NOT NULL THEN
  PERFORM public._sales_collection_validate_terms(terms.collection_terms);
  IF terms.agreed_amount_minor=(terms.collection_terms->>'total_cents')::bigint
   AND terms.agreed_currency=terms.collection_terms->>'currency'
   AND (terms.collection_terms->>'kind' NOT IN ('custom','deposit') OR ((_snapshot->>'due_now_minor')::bigint IS DISTINCT FROM
     CASE WHEN terms.collection_terms->>'kind'='custom' THEN (terms.collection_terms#>>'{dates,0,amount_cents}')::bigint ELSE (terms.collection_terms->>'deposit_cents')::bigint END
    OR _snapshot->>'due_date' IS DISTINCT FROM terms.collection_terms->>'anchor_date')) THEN
   RAISE EXCEPTION 'Invoice and commercial terms initial obligation disagree' USING ERRCODE='22023';
  END IF;
 END IF;
 IF terms.offer_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.tenant_products WHERE id=terms.offer_id AND tenant_id=_tenant) THEN
   RAISE EXCEPTION 'Commercial terms unavailable' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(_snapshot->'items','[]'::jsonb)) line
    WHERE coalesce(line->'price_snapshot'->>'product_id',line->'catalog_facts'->>'product_id')=terms.offer_id::text)
    AND _snapshot->'price_snapshot'->>'product_id' IS DISTINCT FROM terms.offer_id::text THEN
   RAISE EXCEPTION 'Invoice and commercial terms offer disagree' USING ERRCODE='22023';END IF;
 END IF;
 RETURN reference;
END $$;
REVOKE ALL ON FUNCTION public._sales_validate_invoice_terms_reference(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Extend the current canonical function definition, asserting exact anchors on upstream drift.
-- Unchanged _draft owns operation identity; historical replay precedes mutable source validation.
DO $$ DECLARE body text; prior text; BEGIN
 body:=pg_get_functiondef('public._save_sales_billing_draft(uuid,uuid,uuid,bigint,uuid,jsonb)'::regprocedure);
 IF position('public._sales_validate_invoice_terms_reference' in body)>0 THEN RETURN;END IF;
 prior:=body;
 body:=replace(body,$old$'memo','commercial_conditions'))$old$,$new$'memo','commercial_conditions','commercial_terms_reference'))$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms versioned allowlist anchor changed';END IF;prior:=body;
 body:=replace(body,$old$'provider','currency','due_date','recipient_email','memo','cadence'))$old$,
  $new$'provider','currency','due_date','recipient_email','memo','cadence','commercial_terms_reference'))$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms legacy allowlist anchor changed';END IF;prior:=body;
 body:=replace(body,$old$END IF; -- payload schema branch; CAS revision remains separate.$old$,
  $new$END IF; -- payload schema branch; CAS revision remains separate.
  IF _draft ? 'commercial_terms_reference' THEN
   v_snapshot:=v_snapshot||jsonb_build_object('commercial_terms_reference',
    public._sales_validate_invoice_terms_reference(v_tenant,v_client,_draft->'commercial_terms_reference',v_snapshot));
  END IF;$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms snapshot anchor changed';END IF;
 EXECUTE body;
END $$;

DO $$ DECLARE body text; prior text; BEGIN
 body:=pg_get_functiondef('public.read_sales_commercial_package(uuid,uuid)'::regprocedure);
 IF position('commercial_terms_version_changed' in body)>0 THEN RETURN;END IF;
 prior:=body;
 body:=replace(body,$old$terms jsonb:=NULL; offers$old$,$new$terms jsonb:=NULL; reference jsonb; offers$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms package declaration anchor changed';END IF;prior:=body;
 body:=replace(body,$old$facts:=public._sales_invoice_read(_expected_tenant_id,_invoice_id,0);$old$,
  $new$facts:=public._sales_invoice_read(_expected_tenant_id,_invoice_id,0);
  IF i.billing_draft ? 'commercial_terms_reference' THEN
   reference:=public._sales_invoice_terms_reference_shape(i.billing_draft->'commercial_terms_reference');
  END IF;$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms package reference anchor changed';END IF;prior:=body;
 -- Close signing projection before resolving commercial terms independently.
 body:=replace(body,$old$IF a.commercial_terms_id IS NOT NULL THEN
      SELECT * INTO t FROM public.tenant_client_agreements WHERE id=a.commercial_terms_id$old$,
  $new$END IF;
  IF reference IS NOT NULL OR a.commercial_terms_id IS NOT NULL THEN
      IF reference IS NOT NULL AND a.commercial_terms_id IS NOT NULL
       AND a.commercial_terms_id IS DISTINCT FROM (reference->>'id')::uuid THEN
       conflicts:=array_append(conflicts,'agreement_commercial_terms_conflict');
      END IF;
      SELECT * INTO t FROM public.tenant_client_agreements WHERE id=coalesce((reference->>'id')::uuid,a.commercial_terms_id)$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms package independent source anchor changed';END IF;prior:=body;
 body:=replace(body,$old$IF t.status NOT IN ('draft','active') THEN$old$,
  $new$IF reference IS NOT NULL AND t.collection_terms_version IS DISTINCT FROM (reference->>'version')::bigint THEN
       conflicts:=array_append(conflicts,'commercial_terms_version_changed');
      END IF;
      IF t.status IS NULL OR t.status NOT IN ('draft','active') THEN$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms package version anchor changed';END IF;prior:=body;
 body:=replace(body,$old$ELSE missing:=array_append(missing,'commercial_terms');END IF;
  END IF;
  IF jsonb_typeof(i.billing_draft->'delivery_channel_intents')$old$,
  $new$ELSE missing:=array_append(missing,'commercial_terms');END IF;
  IF jsonb_typeof(i.billing_draft->'delivery_channel_intents')$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms package branch anchor changed';END IF;prior:=body;
 body:=replace(body,$old$'delivery_channels',i.billing_draft->'delivery_channel_intents'),$old$,
  $new$'delivery_channels',i.billing_draft->'delivery_channel_intents')
     ||CASE WHEN reference IS NOT NULL THEN jsonb_build_object('commercial_terms_reference',reference) ELSE '{}'::jsonb END,$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice terms package projection anchor changed';END IF;
 EXECUTE body;
END $$;

-- Replay-safe narrow read extension; use validated chronological first custom obligation, never labels.
DO $$ DECLARE body text; prior text; BEGIN
 body:=pg_get_functiondef('public.read_sales_commercial_package(uuid,uuid)'::regprocedure);
 IF position('initial obligation binding' in body)>0 THEN RETURN;END IF;
 prior:=body;
 body:=replace(body,$old$IF t.offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(offers)$old$,
 $new$-- initial obligation binding
      IF i.billing_draft->>'kind'='deposit' AND t.collection_terms IS NOT NULL
       AND t.agreed_amount_minor=(t.collection_terms->>'total_cents')::bigint
       AND t.agreed_currency=t.collection_terms->>'currency'
       AND (t.collection_terms->>'kind' NOT IN ('custom','deposit') OR ((i.billing_draft->>'due_now_minor')::bigint IS DISTINCT FROM
        CASE WHEN t.collection_terms->>'kind'='custom' THEN (t.collection_terms#>>'{dates,0,amount_cents}')::bigint ELSE (t.collection_terms->>'deposit_cents')::bigint END
        OR i.billing_draft->>'due_date' IS DISTINCT FROM t.collection_terms->>'anchor_date')) THEN
       conflicts:=array_append(conflicts,'invoice_terms_conflict');
       terms:=jsonb_set(terms,'{schedule}','null'::jsonb);
      END IF;
      IF t.offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(offers)$new$);
 IF body=prior THEN RAISE EXCEPTION 'Invoice initial obligation read anchor changed';END IF;
 EXECUTE body;
END $$;
