-- Reuse the original230004 locked source validation before a document is frozen.
-- This private invoker returns no source data and performs no commercial write.
-- Existing caller-JWT/Trust/Kit approval and original freeze remain authoritative.
-- This is the original validation phase, not a write authorization. Callers
-- retain their own exact source CAS/state checks; freeze keeps its replay/CAS tail.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

CREATE OR REPLACE FUNCTION public._validate_paige_commercial_presentation(
  _actor uuid,_tenant uuid,_payload jsonb,_payload_digest text,
  _presented_body text,_presented_body_digest text,_storage_key text,_document_digest text,
  _origin text DEFAULT 'owner_ui'
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  s jsonb; a public.paige_agreements%ROWTYPE;
  t public.tenant_client_agreements%ROWTYPE; i public.paige_invoices%ROWTYPE;
  terms_id uuid; invoice_id uuid; agreement_id uuid; expected_digest text;
  expected_lines jsonb; scheduled_total numeric; k text;
BEGIN
  PERFORM public._sales_invoice_actor(_actor,_tenant);
  IF pg_catalog.jsonb_typeof(_payload) IS DISTINCT FROM 'object'
    OR (_payload->>'schema_version' IS DISTINCT FROM '1' AND _payload->>'schema_version' IS DISTINCT FROM '2')
    OR _payload->>'currency' IS DISTINCT FROM 'usd'
    OR _payload->>'amount_basis' IS DISTINCT FROM 'total'
    OR _origin IS NULL OR _origin NOT IN ('owner_ui','paige_chat')
    OR pg_catalog.jsonb_typeof(_payload->'source') IS DISTINCT FROM 'object'
    OR _payload_digest IS NULL OR _payload_digest !~ '^[a-f0-9]{64}$'
    OR _presented_body_digest IS NULL OR _presented_body_digest !~ '^[a-f0-9]{64}$'
    OR _document_digest IS NULL OR _document_digest !~ '^[a-f0-9]{64}$'
    OR _presented_body IS NULL OR pg_catalog.length(_presented_body)=0
    OR pg_catalog.length(_presented_body)>300000 THEN
    RAISE EXCEPTION 'Complete supported presentation required' USING ERRCODE='22023';
  END IF;
  IF (_payload - (ARRAY['schema_version','source','title','body_sha256','principal_minor','currency',
       'amount_basis','collection_terms','obligations','conditions','lines'] || CASE WHEN _payload->>'schema_version'='2' THEN ARRAY['engagement'] ELSE ARRAY[]::text[] END)) <> '{}'::jsonb
    OR NOT (_payload ?& ARRAY['schema_version','source','title','body_sha256','principal_minor','currency',
       'amount_basis','collection_terms','obligations','conditions','lines']) THEN
    RAISE EXCEPTION 'Exact presentation contract required' USING ERRCODE='22023';
  END IF;
  expected_digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    public._paige_commercial_canonical_json(_payload),'UTF8')),'hex');
  IF expected_digest IS DISTINCT FROM _payload_digest OR
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_presented_body,'UTF8')),'hex')
      IS DISTINCT FROM _presented_body_digest THEN
    RAISE EXCEPTION 'Presentation digest changed' USING ERRCODE='22023';
  END IF;
  -- Preserve the formatter's closed native types; a recomputed checksum is not
  -- authority to coerce strings into accepted economics or source revisions.
  IF pg_catalog.jsonb_typeof(_payload->'schema_version') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_payload->'title') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(_payload->'principal_minor') IS DISTINCT FROM 'number'
    OR coalesce(_payload->>'principal_minor','') !~ '^[1-9][0-9]{0,15}$'
    OR (_payload->>'principal_minor')::numeric>2147483647 THEN
    RAISE EXCEPTION 'Exact presentation types required' USING ERRCODE='22023';
  END IF;
  s:=_payload->'source';
  FOREACH k IN ARRAY ARRAY['agreement_version','terms_version','invoice_version','invoice_draft_version'] LOOP
    IF pg_catalog.jsonb_typeof(s->k) IS DISTINCT FROM 'number'
      OR coalesce(s->>k,'') !~ '^[0-9]{1,16}$'
      OR (s->>k)::numeric>9007199254740991
      OR (k<>'terms_version' AND (s->>k)::numeric<1) THEN
      RAISE EXCEPTION 'Exact source revision types required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['tenant_id','client_id','offer_id','agreement_id','terms_id','invoice_id'] LOOP
    IF pg_catalog.jsonb_typeof(s->k) IS DISTINCT FROM 'string'
      OR coalesce(s->>k,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
      RAISE EXCEPTION 'Exact source identity types required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['agreement_updated_at','terms_updated_at','invoice_updated_at'] LOOP
    IF pg_catalog.jsonb_typeof(s->k) IS DISTINCT FROM 'string'
      OR pg_catalog.length(s->>k)>50
      OR coalesce(s->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'Exact source timestamp types required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (s - ARRAY['tenant_id','client_id','offer_id','agreement_id','agreement_version','agreement_updated_at',
       'body_source','status','content_sha256','terms_id','terms_version','terms_updated_at','invoice_id',
       'invoice_version','invoice_draft_version','invoice_updated_at']) <> '{}'::jsonb
    OR NOT (s ?& ARRAY['tenant_id','client_id','offer_id','agreement_id','agreement_version','agreement_updated_at',
       'body_source','status','content_sha256','terms_id','terms_version','terms_updated_at','invoice_id',
       'invoice_version','invoice_draft_version','invoice_updated_at'])
    OR s->>'status' IS DISTINCT FROM 'draft' OR s->'content_sha256' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Exact source contract required' USING ERRCODE='22023';
  END IF;
  BEGIN
    agreement_id:=(s->>'agreement_id')::uuid;
    terms_id:=(s->>'terms_id')::uuid;
    invoice_id:=(s->>'invoice_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid presentation identity' USING ERRCODE='22023';
  END;
  IF (s->>'tenant_id') IS DISTINCT FROM _tenant::text
    OR _storage_key IS NULL
    OR _storage_key NOT LIKE _tenant::text||'/'||agreement_id::text||'/%'
    OR pg_catalog.strpos(_storage_key,'..')>0
    OR pg_catalog.strpos(_storage_key,pg_catalog.chr(92))>0 THEN
    RAISE EXCEPTION 'Presentation source unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.paige_agreements
    WHERE id=agreement_id AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presentation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO t FROM public.tenant_client_agreements
    WHERE id=terms_id AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presentation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.paige_invoices
    WHERE id=invoice_id AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presentation unavailable' USING ERRCODE='42501'; END IF;

  IF a.contact_id::text IS DISTINCT FROM s->>'client_id'
    OR a.commercial_terms_id IS DISTINCT FROM terms_id
    OR a.offer_id::text IS DISTINCT FROM s->>'offer_id'
    OR t.contact_id IS DISTINCT FROM a.contact_id OR t.offer_id IS DISTINCT FROM a.offer_id
    OR i.contact_id IS DISTINCT FROM a.contact_id THEN
    RAISE EXCEPTION 'Presentation linkage changed' USING ERRCODE='42501';
  END IF;
  IF a.status IS DISTINCT FROM 'draft' OR a.body_source NOT IN ('paige_draft','tenant_template')
    OR a.body_source IS DISTINCT FROM s->>'body_source'
    OR t.status IS NULL OR t.status NOT IN ('draft','active','paused')
    OR a.version IS DISTINCT FROM (s->>'agreement_version')::integer
    OR t.collection_terms_version IS DISTINCT FROM (s->>'terms_version')::bigint
    OR t.updated_at IS DISTINCT FROM (s->>'terms_updated_at')::timestamptz
    OR i.status IS DISTINCT FROM 'draft' OR i.currency IS DISTINCT FROM 'usd'
    OR i.billing_lifecycle_version IS DISTINCT FROM (s->>'invoice_version')::bigint
    OR i.billing_draft_version IS DISTINCT FROM (s->>'invoice_draft_version')::bigint
    OR i.updated_at IS DISTINCT FROM (s->>'invoice_updated_at')::timestamptz
    OR i.billing_draft->'commercial_terms_reference'->>'id' IS DISTINCT FROM terms_id::text
    OR i.billing_draft->'commercial_terms_reference'->>'version' IS DISTINCT FROM s->>'terms_version'
    OR i.billing_draft->'agreement_snapshot'->>'id' IS DISTINCT FROM agreement_id::text
    OR i.billing_draft->'agreement_snapshot'->>'version' IS DISTINCT FROM s->>'agreement_version'
    OR _payload->>'title' IS DISTINCT FROM a.title
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(a.body_markdown,'UTF8')),'hex')
      IS DISTINCT FROM _payload->>'body_sha256'
    OR (_payload->>'principal_minor')::bigint IS DISTINCT FROM t.agreed_amount_minor
    OR (_payload->>'principal_minor')::bigint IS DISTINCT FROM (i.billing_draft->>'total_minor')::bigint
    OR pg_catalog.lower(t.agreed_currency) IS DISTINCT FROM 'usd'
    OR _payload->'collection_terms' IS DISTINCT FROM t.collection_terms
    OR _payload->'conditions' IS DISTINCT FROM i.billing_draft->'commercial_conditions' THEN
    RAISE EXCEPTION 'Original presentation source changed' USING ERRCODE='40001';
  END IF;
  -- v2 adds explicit immutable service facts; v1 execution remains unchanged.
  -- The same locked canonical terms own these facts, not a payment-date inference.
  IF _payload->>'schema_version'='2' AND (
    i.billing_draft->>'agreement_id' IS DISTINCT FROM a.id::text
    OR
    pg_catalog.jsonb_typeof(_payload->'engagement') IS DISTINCT FROM 'object'
    OR NOT ((_payload->'engagement') ?& ARRAY['starts_on','ends_on','price_basis'])
    OR ((_payload->'engagement')-ARRAY['starts_on','ends_on','price_basis'])<>'{}'::jsonb
    OR t.starts_on IS NULL OR coalesce(t.price_basis,'') NOT IN ('catalog','negotiated')
    OR _payload->'engagement' IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'starts_on',t.starts_on,'ends_on',t.ends_on,'price_basis',t.price_basis)
  ) THEN RAISE EXCEPTION 'Exact service commencement and agreed price required' USING ERRCODE='40001'; END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'unit_minor',coalesce(value->'unit_minor',value->'catalog_facts'->'unit_minor'),
    'quantity',value->'quantity') ORDER BY ordinal)
    INTO expected_lines FROM pg_catalog.jsonb_array_elements(i.billing_draft->'items') WITH ORDINALITY AS x(value,ordinal);
  IF expected_lines IS NULL OR _payload->'lines' IS DISTINCT FROM expected_lines
    OR pg_catalog.jsonb_typeof(_payload->'obligations') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(_payload->'obligations')=0
    OR pg_catalog.jsonb_array_length(_payload->'obligations')>240 THEN
    RAISE EXCEPTION 'Complete presented lines and schedule required' USING ERRCODE='22023';
  END IF;
  -- Structural integrity only. Dates and obligation generation remain owned by
  -- the existing Collections producer; this function creates no second engine.
  IF pg_catalog.jsonb_array_length(_payload->'obligations') IS DISTINCT FROM (t.collection_terms->>'count')::integer
    OR t.collection_terms->>'kind' IS NOT DISTINCT FROM 'recurring'
    OR t.collection_terms->'late_fee'->>'fixed_cents' IS DISTINCT FROM '0'
    OR t.collection_terms->'late_fee'->>'rate_bps' IS DISTINCT FROM '0'
    OR t.collection_terms->'interest'->>'annual_bps' IS DISTINCT FROM '0'
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(_payload->'obligations') WITH ORDINALITY AS x(value,ordinal)
      WHERE pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'object'
        OR (value - ARRAY['sequence','due_date','amount_cents','currency','label']) <> '{}'::jsonb
        OR NOT (value ?& ARRAY['sequence','due_date','amount_cents','currency','label'])
        OR value->>'sequence' IS DISTINCT FROM ordinal::text
        OR value->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(value->>'amount_cents','') !~ '^[0-9]+$'
        OR coalesce(value->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'Exact finite principal obligations required' USING ERRCODE='22023';
  END IF;
  SELECT sum((value->>'amount_cents')::numeric) INTO scheduled_total
    FROM pg_catalog.jsonb_array_elements(_payload->'obligations');
  IF scheduled_total IS DISTINCT FROM (_payload->>'principal_minor')::numeric THEN
    RAISE EXCEPTION 'Obligations do not match the recorded principal' USING ERRCODE='22023';
  END IF;
  IF t.collection_terms->>'cadence' = 'custom' AND EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(_payload->'obligations') WITH ORDINALITY AS x(value,ordinal)
      WHERE value->>'due_date' IS DISTINCT FROM t.collection_terms->'dates'->(ordinal::integer-1)->>'due_date'
        OR value->'amount_cents' IS DISTINCT FROM t.collection_terms->'dates'->(ordinal::integer-1)->'amount_cents'
        OR value->'label' IS DISTINCT FROM t.collection_terms->'dates'->(ordinal::integer-1)->'label') THEN
    RAISE EXCEPTION 'Explicit dated obligations changed' USING ERRCODE='22023';
  END IF;

  RETURN;
END $$;
REVOKE ALL ON FUNCTION public._validate_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._freeze_paige_commercial_presentation(
  _actor uuid,_tenant uuid,_payload jsonb,_payload_digest text,
  _presented_body text,_presented_body_digest text,_storage_key text,_document_digest text,
  _origin text DEFAULT 'owner_ui'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s jsonb; a public.paige_agreements%ROWTYPE;
  agreement_id uuid; terms_id uuid; saved jsonb; event_id uuid;
BEGIN
  PERFORM public._validate_paige_commercial_presentation(_actor,_tenant,_payload,_payload_digest,
    _presented_body,_presented_body_digest,_storage_key,_document_digest,_origin);
  s:=_payload->'source';agreement_id:=(s->>'agreement_id')::uuid;terms_id:=(s->>'terms_id')::uuid;
  -- The validator already holds these same original rows for this transaction.
  SELECT * INTO a FROM public.paige_agreements WHERE id=agreement_id AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presentation unavailable' USING ERRCODE='42501'; END IF;
  saved:=pg_catalog.jsonb_build_object('schema_version',1,'payload',_payload,'payload_digest',_payload_digest,
    'presented_body_sha256',_presented_body_digest,'content_storage_key',_storage_key,'document_sha256',_document_digest);
  IF a.commercial_presentation IS NOT NULL THEN
    IF a.commercial_presentation IS DISTINCT FROM saved OR a.presented_body_markdown IS DISTINCT FROM _presented_body
      OR a.content_storage_key IS DISTINCT FROM _storage_key OR a.content_sha256 IS DISTINCT FROM _document_digest THEN
      RAISE EXCEPTION 'Original frozen presentation differs' USING ERRCODE='40001';
    END IF;
    RETURN pg_catalog.jsonb_build_object('state','frozen','agreement_id',agreement_id,
      'payload_digest',_payload_digest,'document_sha256',_document_digest,'replayed',true);
  END IF;
  IF a.updated_at IS DISTINCT FROM (s->>'agreement_updated_at')::timestamptz
    OR a.content_storage_key IS NOT NULL OR a.content_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'Agreement changed before presentation' USING ERRCODE='40001';
  END IF;
  UPDATE public.paige_agreements SET commercial_presentation=saved,presented_body_markdown=_presented_body,
    content_storage_key=_storage_key,content_sha256=_document_digest
    WHERE id=agreement_id AND tenant_id=_tenant;
  INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,actor_user_id,detail)
    VALUES(agreement_id,_tenant,'edited',CASE WHEN _origin='paige_chat' THEN 'paige' ELSE 'owner' END,_actor,
      pg_catalog.jsonb_build_object('action','commercial_presentation_frozen','payload_digest',_payload_digest,
        'document_sha256',_document_digest,'terms_id',terms_id,'terms_version',s->>'terms_version'))
    RETURNING id INTO event_id;
  RETURN pg_catalog.jsonb_build_object('state','frozen','agreement_id',agreement_id,'payload_digest',_payload_digest,
    'document_sha256',_document_digest,'event_id',event_id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public._freeze_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._freeze_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)
  TO service_role;

COMMIT;
