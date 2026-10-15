-- P1-B: invoice-owned commercial facts; no tax calculator, signing mutation or ledger.
CREATE OR REPLACE FUNCTION public._sales_validate_commercial_conditions(_conditions jsonb,_items jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE treatment jsonb; charge jsonb; k text; line jsonb; idx integer;
 amounts bigint[]:=array_fill(0::bigint,ARRAY[50]); seen integer[]; amount bigint;
BEGIN
 IF _conditions IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(_conditions)<>'object' OR _conditions->'schema_version' IS DISTINCT FROM '1'::jsonb
  OR (SELECT count(*) FROM jsonb_object_keys(_conditions))<>3
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_conditions) x WHERE x NOT IN ('schema_version','tax','fees'))
  OR jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid commercial conditions' USING ERRCODE='22023';
 END IF;
 FOREACH k IN ARRAY ARRAY['tax','fees'] LOOP
  treatment:=_conditions->k; seen:=ARRAY[]::integer[];
  IF jsonb_typeof(treatment) IS DISTINCT FROM 'object'
   OR (SELECT count(*) FROM jsonb_object_keys(treatment))<>4
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(treatment) x WHERE x NOT IN ('state','charges','source','policy'))
   OR coalesce(treatment->>'state','') NOT IN ('unknown','not_applicable','recorded')
   OR jsonb_typeof(treatment->'charges') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Invalid commercial treatment' USING ERRCODE='22023';
  END IF;
  IF treatment->>'state'='unknown' THEN
   IF treatment->'source' IS DISTINCT FROM 'null'::jsonb OR treatment->'policy' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Unknown conditions cannot assert a source' USING ERRCODE='22023'; END IF;
  ELSIF jsonb_typeof(treatment->'source') IS DISTINCT FROM 'string' OR jsonb_typeof(treatment->'policy') IS DISTINCT FROM 'string'
   OR length(btrim(treatment->>'source')) NOT BETWEEN 1 AND 200
   OR length(btrim(treatment->>'policy')) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'Recorded conditions require source and policy' USING ERRCODE='22023';
  END IF;
  IF (treatment->>'state'='recorded' AND jsonb_array_length(treatment->'charges') NOT BETWEEN 1 AND 10)
   OR (treatment->>'state'<>'recorded' AND jsonb_array_length(treatment->'charges')<>0) THEN
   RAISE EXCEPTION 'Treatment and charges disagree' USING ERRCODE='22023'; END IF;
  FOR charge IN SELECT value FROM jsonb_array_elements(treatment->'charges') LOOP
   IF jsonb_typeof(charge) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(charge))<>3
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(charge) x WHERE x NOT IN ('line_index','amount_minor','currency'))
    OR jsonb_typeof(charge->'line_index') IS DISTINCT FROM 'number' OR coalesce(charge->>'line_index','') !~ '^[0-9]{1,2}$'
    OR jsonb_typeof(charge->'amount_minor') IS DISTINCT FROM 'number' OR coalesce(charge->>'amount_minor','') !~ '^[0-9]{1,10}$'
    OR charge->>'currency' IS DISTINCT FROM 'usd' THEN
    RAISE EXCEPTION 'Invalid recorded charge' USING ERRCODE='22023'; END IF;
   idx:=(charge->>'line_index')::integer; amount:=(charge->>'amount_minor')::bigint;
   IF idx NOT BETWEEN 0 AND 49 OR idx>=jsonb_array_length(_items) OR idx=ANY(seen) OR amount NOT BETWEEN 1 AND 2147483647 THEN
    RAISE EXCEPTION 'Recorded charge unavailable' USING ERRCODE='22023'; END IF;
   seen:=array_append(seen,idx); line:=_items->idx;
   IF jsonb_typeof(line) IS DISTINCT FROM 'object'
    OR jsonb_typeof(line->'unit_minor') IS DISTINCT FROM 'number'
    OR coalesce(line->>'unit_minor','') !~ '^[0-9]{1,10}$'
    OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number'
    OR coalesce(line->>'quantity','') !~ '^[0-9]{1,4}$'
    OR (line->>'unit_minor')::bigint NOT BETWEEN 1 AND 2147483647
    OR (line->>'quantity')::bigint NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Charge line unavailable' USING ERRCODE='22023'; END IF;
   amounts[idx+1]:=amounts[idx+1]+amount;
   IF amounts[idx+1]>(line->>'unit_minor')::bigint*(line->>'quantity')::bigint THEN
    RAISE EXCEPTION 'Charge exceeds included invoice line' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._sales_validate_commercial_conditions(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_validate_commercial_conditions(jsonb,jsonb) TO service_role;

-- Extend the ONE canonical writer. Exact anchors fail migration on upstream drift.
-- Full original _draft continues to own operation fingerprint/replay; no stripped wrapper.
DO $$ DECLARE body text; prior text; BEGIN
 body:=pg_get_functiondef('public._save_sales_billing_draft(uuid,uuid,uuid,bigint,uuid,jsonb)'::regprocedure); prior:=body;
 IF position('public._sales_validate_commercial_conditions' in body)>0 THEN RETURN; END IF;
 body:=replace(body,
  $old$'billing_address','agreement_id','processor_intent','payment_method_intents','delivery_channel_intents','due_date','memo'))$old$,
  $new$'billing_address','agreement_id','processor_intent','payment_method_intents','delivery_channel_intents','due_date','memo','commercial_conditions'))$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial draft allowlist anchor changed'; END IF; prior:=body;
 body:=replace(body,
  $old$|| CASE WHEN v_fixed IS NOT NULL THEN jsonb_build_object('deposit_minor',v_fixed) ELSE '{}'::jsonb END;$old$,
  $new$|| CASE WHEN v_fixed IS NOT NULL THEN jsonb_build_object('deposit_minor',v_fixed) ELSE '{}'::jsonb END;
    IF _draft ? 'commercial_conditions' THEN
      PERFORM public._sales_validate_commercial_conditions(_draft->'commercial_conditions',v_lines);
      IF v_exists AND v_row.billing_draft->'commercial_conditions' = _draft->'commercial_conditions'
        AND (jsonb_array_length(_draft->'commercial_conditions'->'tax'->'charges')>0
          OR jsonb_array_length(_draft->'commercial_conditions'->'fees'->'charges')>0)
        AND v_row.billing_draft->'items' IS DISTINCT FROM v_lines THEN
        RAISE EXCEPTION 'Recorded charges require review after invoice line changes' USING ERRCODE='22023';
      END IF;
      v_snapshot:=v_snapshot||jsonb_build_object('commercial_conditions',_draft->'commercial_conditions');
    END IF;$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial draft snapshot anchor changed'; END IF;
 EXECUTE body;
END $$;

-- Only the existing read projection changes. Balance/receipt/tenant owners stay intact.
DO $$ DECLARE body text; prior text; BEGIN
 body:=pg_get_functiondef('public.read_sales_commercial_package(uuid,uuid)'::regprocedure); prior:=body;
 IF position('canonical_relationship_and_invoice_source_version' in body)>0 THEN RETURN; END IF;
 body:=replace(body,
  $old$missing text[]:=ARRAY['tax_and_fee_treatment'];$old$,
  $new$missing text[]:=ARRAY[]::text[];$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial package missing-field anchor changed'; END IF; prior:=body;
 body:=replace(body,
  $old$IF jsonb_typeof(i.billing_draft->'items')='array' THEN$old$,
  $new$PERFORM public._sales_validate_commercial_conditions(i.billing_draft->'commercial_conditions',i.billing_draft->'items');
  IF i.billing_draft->'commercial_conditions' IS NULL
    OR i.billing_draft->'commercial_conditions'->'tax'->>'state'='unknown'
    OR i.billing_draft->'commercial_conditions'->'fees'->>'state'='unknown' THEN
    missing:=array_append(missing,'tax_and_fee_treatment');
  END IF;
  IF jsonb_typeof(i.billing_draft->'items')='array' THEN$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial package treatment anchor changed'; END IF; prior:=body;
 body:=replace(body,
  $old$product_id:=nullif(line->'catalog_facts'->>'product_id','')::uuid;$old$,
  $new$-- Both are invoice-frozen facts, never today's mutable Catalog price.
      line:=line||jsonb_build_object('catalog_facts',coalesce(line->'catalog_facts',line->'price_snapshot'));
      product_id:=nullif(line->'catalog_facts'->>'product_id','')::uuid;$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial package frozen offer anchor changed'; END IF; prior:=body;
 body:=replace(body,
  $old$agreement:=jsonb_build_object('id',a.id,$old$,
  $new$IF i.billing_draft->'agreement_snapshot'->>'version' IS NULL THEN
      missing:=array_append(missing,'agreement_source_version');
    ELSIF i.billing_draft->'agreement_snapshot'->>'id' IS DISTINCT FROM a.id::text
      OR i.billing_draft->'agreement_snapshot'->>'version' IS DISTINCT FROM a.version::text THEN
      conflicts:=array_append(conflicts,'agreement_version_mismatch');
    END IF;
    IF a.offer_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.tenant_products p WHERE p.id=a.offer_id
        AND p.tenant_id=_expected_tenant_id) THEN
        RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(offers) o WHERE o->>'id'=a.offer_id::text) THEN
        conflicts:=array_append(conflicts,'agreement_offer_conflict');
      END IF;
    END IF;
    agreement:=jsonb_build_object('id',a.id,$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial package agreement anchor changed'; END IF; prior:=body;
 body:=replace(body,
  $old$IF t.collection_terms IS NOT NULL THEN$old$,
  $new$IF t.status NOT IN ('draft','active') THEN
        conflicts:=array_append(conflicts,'commercial_terms_inactive');
      END IF;
      IF t.collection_terms IS NOT NULL THEN$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial package terms anchor changed'; END IF; prior:=body;
 body:=replace(body,
  $old$'offers',offers,'agreement',agreement,'commercial_terms',terms,'missing_fields',to_jsonb(missing),$old$,
  $new$'offers',offers,'agreement',agreement,'commercial_terms',terms,
    'commercial_conditions',i.billing_draft->'commercial_conditions',
    'compatibility',jsonb_build_object('basis','canonical_relationship_and_invoice_source_version',
      'signed_economics',CASE WHEN a.status='completed' THEN 'unverified_no_frozen_commercial_snapshot' ELSE 'not_signed' END),
    'missing_fields',to_jsonb(missing),$new$);
 IF body=prior THEN RAISE EXCEPTION 'Commercial package result anchor changed'; END IF;
 EXECUTE body;
END $$;
