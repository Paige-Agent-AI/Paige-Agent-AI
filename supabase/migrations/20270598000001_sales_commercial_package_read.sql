-- Governed read projection over existing records; not a package ledger or approval.
CREATE OR REPLACE FUNCTION public.read_sales_commercial_package(
  _expected_tenant_id uuid, _invoice_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i public.paige_invoices%ROWTYPE; a public.paige_agreements%ROWTYPE;
  t public.tenant_client_agreements%ROWTYPE; facts jsonb; agreement jsonb:=NULL;
  terms jsonb:=NULL; offers jsonb:='[]'::jsonb; line jsonb; dates jsonb;
  missing text[]:=ARRAY['tax_and_fee_treatment']; conflicts text[]:=ARRAY[]::text[];
  agreement_id uuid; product_id uuid; run uuid:=gen_random_uuid(); result jsonb;
BEGIN
  IF _expected_tenant_id IS NULL OR _invoice_id IS NULL
    OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
    RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  SELECT * INTO i FROM public.paige_invoices WHERE id=_invoice_id
    AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clients c
    WHERE c.id=i.contact_id AND c.tenant_id=_expected_tenant_id) THEN
    RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';
  END IF;
  -- The existing reader alone owns allocated/outstanding balance truth.
  facts:=public._sales_invoice_read(_expected_tenant_id,_invoice_id,0);
  IF i.billing_draft->>'client_id' IS NOT NULL
    AND i.billing_draft->>'client_id' IS DISTINCT FROM i.contact_id::text THEN
    RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(i.billing_draft->'items')='array' THEN
    IF jsonb_array_length(i.billing_draft->'items')>50 THEN
      RAISE EXCEPTION 'Commercial package is too large' USING ERRCODE='22023';
    END IF;
    FOR line IN SELECT value FROM jsonb_array_elements(i.billing_draft->'items') LOOP
      product_id:=nullif(line->'catalog_facts'->>'product_id','')::uuid;
      IF product_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM public.tenant_products p WHERE p.id=product_id
          AND p.tenant_id=_expected_tenant_id) THEN
          RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';
        END IF;
        offers:=offers || jsonb_build_array(jsonb_build_object('id',product_id,
          'price_id',line->'catalog_facts'->'price_id','unit_minor',line->'catalog_facts'->'unit_minor',
          'currency',line->'catalog_facts'->'currency','quantity',line->'quantity',
          'price_basis','frozen_invoice_catalog_facts'));
      END IF;
    END LOOP;
  END IF;
  IF jsonb_array_length(offers)=0 THEN missing:=array_append(missing,'canonical_offer'); END IF;
  agreement_id:=nullif(i.billing_draft->>'agreement_id','')::uuid;
  IF agreement_id IS NULL THEN missing:=array_append(missing,'agreement_or_document');
  ELSE
    SELECT * INTO a FROM public.paige_agreements WHERE id=agreement_id
      AND tenant_id=_expected_tenant_id AND contact_id=i.contact_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';END IF;
    agreement:=jsonb_build_object('id',a.id,'version',a.version,'status',a.status,
      'body_source',a.body_source,'commercial_terms_id',a.commercial_terms_id,
      'document_available',CASE WHEN a.status='completed' THEN a.sealed_sha256 IS NOT NULL
        AND a.sealed_storage_key IS NOT NULL ELSE a.content_sha256 IS NOT NULL END,
      'treatment',CASE WHEN a.status='completed' THEN 'include_existing_signed_document'
        WHEN a.status IN ('draft','sent','viewed','partially_signed') THEN 'unsigned_canonical_agreement'
        ELSE 'unavailable' END);
    IF a.status='completed' THEN
      missing:=array_append(missing,'signed_terms_compatibility');
      IF a.sealed_sha256 IS NULL OR a.sealed_storage_key IS NULL THEN missing:=array_append(missing,'agreement_document');END IF;
    ELSIF a.status IN ('draft','sent','viewed','partially_signed') THEN
      missing:=array_append(missing,'signature_before_collection_policy');
      IF a.expires_at IS NOT NULL AND a.expires_at<=now() THEN conflicts:=array_append(conflicts,'agreement_expired');END IF;
    ELSE conflicts:=array_append(conflicts,'agreement_unavailable');END IF;
    IF a.commercial_terms_id IS NOT NULL THEN
      SELECT * INTO t FROM public.tenant_client_agreements WHERE id=a.commercial_terms_id
        AND tenant_id=_expected_tenant_id AND contact_id=i.contact_id FOR SHARE;
      IF NOT FOUND OR (t.offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_products p
        WHERE p.id=t.offer_id AND p.tenant_id=_expected_tenant_id)) THEN
        RAISE EXCEPTION 'Commercial package unavailable' USING ERRCODE='42501';
      END IF;
      IF t.collection_terms IS NOT NULL THEN
        PERFORM public._sales_collection_validate_terms(t.collection_terms);
        SELECT coalesce(jsonb_agg(jsonb_build_object('due_date',d->'due_date','amount_cents',d->'amount_cents') ORDER BY n),'[]')
          INTO dates FROM jsonb_array_elements(t.collection_terms->'dates') WITH ORDINALITY AS x(d,n);
      ELSE missing:=array_append(missing,'collection_schedule');END IF;
      terms:=jsonb_build_object('id',t.id,'version',t.collection_terms_version,'updated_at',t.updated_at,'status',t.status,
        'offer_id',t.offer_id,'amount_minor',t.agreed_amount_minor,'currency',t.agreed_currency,
        'record_owner','commercial_collection_terms','schedule',CASE WHEN t.collection_terms IS NULL THEN NULL ELSE
          jsonb_build_object('kind',t.collection_terms->'kind','total_cents',t.collection_terms->'total_cents',
            'currency',t.collection_terms->'currency','cadence',t.collection_terms->'cadence',
            'anchor_date',t.collection_terms->'anchor_date','count',t.collection_terms->'count',
            'end_date',t.collection_terms->'end_date','deposit_cents',t.collection_terms->'deposit_cents','dates',dates) END);
      IF t.collection_terms IS NOT NULL AND (t.agreed_amount_minor IS DISTINCT FROM (t.collection_terms->>'total_cents')::bigint
        OR t.agreed_currency IS DISTINCT FROM t.collection_terms->>'currency') THEN conflicts:=array_append(conflicts,'recorded_terms_stale');END IF;
      IF i.billing_draft->>'total_minor' IS NULL THEN missing:=array_append(missing,'obligation_total');
      ELSIF t.agreed_amount_minor IS DISTINCT FROM (i.billing_draft->>'total_minor')::bigint
        OR t.agreed_currency IS DISTINCT FROM lower(i.currency) THEN conflicts:=array_append(conflicts,'invoice_terms_conflict');END IF;
      IF t.offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(offers) o WHERE o->>'id'=t.offer_id::text)
        THEN conflicts:=array_append(conflicts,'offer_terms_conflict');END IF;
      IF a.offer_id IS NOT NULL AND a.offer_id IS DISTINCT FROM t.offer_id THEN conflicts:=array_append(conflicts,'signing_offer_terms_conflict');END IF;
    ELSE missing:=array_append(missing,'commercial_terms');END IF;
  END IF;
  IF jsonb_typeof(i.billing_draft->'delivery_channel_intents') IS DISTINCT FROM 'array' THEN
    missing:=array_append(missing,'delivery_channel');
  ELSIF jsonb_array_length(i.billing_draft->'delivery_channel_intents')=0 THEN
    missing:=array_append(missing,'delivery_channel');
  END IF;
  result:=jsonb_build_object('schema_version',1,'tenant_id',_expected_tenant_id,
    'invoice',jsonb_build_object('id',i.id,'client_id',i.contact_id,'status',i.status,'version',facts->'version',
      'draft_version',i.billing_draft_version,'issued_snapshot_version',facts->'issued_snapshot_version',
      'obligation_total_minor',i.billing_draft->'total_minor','due_now_minor',i.billing_draft->'due_now_minor',
      'remaining_scheduled_minor',i.billing_draft->'remainder_minor','currency',facts->'currency',
      'receivable_total_minor',facts->'amount_total_cents','allocated_minor',facts->'allocated_cents',
      'manual_recorded_minor',facts->'manual_recorded_cents','provider_verified_minor',facts->'provider_verified_cents',
      'outstanding_minor',facts->'remaining_cents','due_date',i.due_date,
      'delivery_channels',i.billing_draft->'delivery_channel_intents'),
    'offers',offers,'agreement',agreement,'commercial_terms',terms,'missing_fields',to_jsonb(missing),
    'conflicts',to_jsonb(conflicts),'authority','not_evaluated','execution','not_started',
    'state',CASE WHEN cardinality(conflicts)>0 THEN 'conflict' ELSE 'needs_input' END);
  IF octet_length(result::text)>65536 THEN RAISE EXCEPTION 'Commercial package is too large' USING ERRCODE='22023';END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'read_sales_commercial_package','capability_succeeded',run,NULL);
  RETURN result || jsonb_build_object('receipt_id',run);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_commercial_package(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_commercial_package(uuid,uuid) TO authenticated;
