-- CLI scaffold20261015065807, moved while UNAPPLIED to reserved051100.
-- E04 C7 forward-compatible presentation2. The canonical v1 freeze/retained
-- functions evolve in place; every v1 validation/business statement is retained.
-- No signed history rewrite/backfill, new store, financial calculator or provider.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public._freeze_paige_commercial_presentation(
  _actor uuid,_tenant uuid,_payload jsonb,_payload_digest text,
  _presented_body text,_presented_body_digest text,_storage_key text,_document_digest text,
  _origin text DEFAULT 'owner_ui'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s jsonb; a public.paige_agreements%ROWTYPE;
  t public.tenant_client_agreements%ROWTYPE; i public.paige_invoices%ROWTYPE;
  terms_id uuid; invoice_id uuid; agreement_id uuid; expected_digest text;
  expected_lines jsonb; saved jsonb; event_id uuid; scheduled_total numeric;
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
  s:=_payload->'source';
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
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._freeze_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public._paige_retained_commercial_payload(_a public.paige_agreements)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb:=_a.commercial_presentation; p jsonb; s jsonb;
BEGIN
  IF c IS NULL OR pg_catalog.jsonb_typeof(c) IS DISTINCT FROM 'object'
    OR (c-ARRAY['schema_version','payload','payload_digest','presented_body_sha256','content_storage_key','document_sha256'])<>'{}'::jsonb
    OR c->>'schema_version' IS DISTINCT FROM '1'
    OR pg_catalog.jsonb_typeof(c->'payload') IS DISTINCT FROM 'object'
    OR _a.presented_body_markdown IS NULL OR pg_catalog.length(_a.presented_body_markdown)=0
    OR _a.content_storage_key IS NULL OR _a.content_storage_key NOT LIKE _a.tenant_id::text||'/'||_a.id::text||'/%'
    OR pg_catalog.strpos(_a.content_storage_key,'..')>0 OR pg_catalog.strpos(_a.content_storage_key,pg_catalog.chr(92))>0
    OR coalesce(_a.content_sha256,'') !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  p:=c->'payload'; s:=p->'source';
  IF pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object'
    OR (p->>'schema_version' IS DISTINCT FROM '1' AND p->>'schema_version' IS DISTINCT FROM '2') OR p->>'amount_basis' IS DISTINCT FROM 'total'
    OR (p-(ARRAY['schema_version','source','title','body_sha256','principal_minor','currency','amount_basis','collection_terms','obligations','conditions','lines'] || CASE WHEN p->>'schema_version'='2' THEN ARRAY['engagement'] ELSE ARRAY[]::text[] END))<>'{}'::jsonb
    OR pg_catalog.jsonb_typeof(p->'principal_minor') IS DISTINCT FROM 'number'
    OR coalesce(p->>'principal_minor','') !~ '^[1-9][0-9]{0,9}$'
    OR p->>'currency' IS DISTINCT FROM 'usd' OR s->>'status' IS DISTINCT FROM 'draft'
    OR s->'content_sha256' IS DISTINCT FROM 'null'::jsonb
    OR s->>'body_source' IS DISTINCT FROM _a.body_source
    OR s->>'agreement_id' IS DISTINCT FROM _a.id::text
    OR s->>'tenant_id' IS DISTINCT FROM _a.tenant_id::text
    OR s->>'client_id' IS DISTINCT FROM _a.contact_id::text
    OR s->>'offer_id' IS DISTINCT FROM _a.offer_id::text
    OR s->>'terms_id' IS DISTINCT FROM _a.commercial_terms_id::text
    OR s->'agreement_version' IS DISTINCT FROM pg_catalog.to_jsonb(_a.version)
    OR pg_catalog.jsonb_typeof(s->'terms_version') IS DISTINCT FROM 'number'
    OR coalesce(s->>'terms_version','') !~ '^[0-9]{1,16}$'
    OR coalesce(s->>'invoice_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR p->>'title' IS DISTINCT FROM _a.title
    OR c->>'content_storage_key' IS DISTINCT FROM _a.content_storage_key
    OR c->>'document_sha256' IS DISTINCT FROM _a.content_sha256
    OR c->>'payload_digest' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(p),'UTF8')),'hex')
    OR c->>'presented_body_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_a.presented_body_markdown,'UTF8')),'hex')
    OR p->>'body_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(_a.body_markdown,''),'UTF8')),'hex')
    THEN RETURN NULL; END IF;
  IF (p->>'principal_minor')::bigint>2147483647 OR (s->>'terms_version')::numeric>9007199254740991
    OR pg_catalog.jsonb_typeof(p->'obligations') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(p->'conditions') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p->'collection_terms') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
    WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.event_type='edited'
      AND e.actor_kind IN ('owner','paige') AND e.actor_user_id IS NOT NULL
      AND e.detail->>'action'='commercial_presentation_frozen'
      AND e.detail->>'payload_digest'=c->>'payload_digest'
      AND e.detail->>'document_sha256'=_a.content_sha256
      AND e.detail->>'terms_id'=_a.commercial_terms_id::text
      AND e.detail->>'terms_version'=s->>'terms_version') THEN RETURN NULL; END IF;
  IF p->>'schema_version'='2' THEN
    IF pg_catalog.jsonb_typeof(p->'engagement') IS DISTINCT FROM 'object'
      OR NOT ((p->'engagement') ?& ARRAY['starts_on','ends_on','price_basis'])
      OR ((p->'engagement')-ARRAY['starts_on','ends_on','price_basis'])<>'{}'::jsonb
      OR coalesce(p#>>'{engagement,starts_on}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR coalesce(p#>>'{engagement,price_basis}','') NOT IN ('catalog','negotiated')
      OR (p#>'{engagement,ends_on}' IS DISTINCT FROM 'null'::jsonb
        AND coalesce(p#>>'{engagement,ends_on}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RETURN NULL; END IF;
    -- Validate retained dates, without consulting mutable current commercial terms.
    BEGIN
      IF (p#>>'{engagement,starts_on}')::date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
        OR ((p#>>'{engagement,ends_on}') IS NOT NULL AND (
          (p#>>'{engagement,ends_on}')::date<(p#>>'{engagement,starts_on}')::date
          OR (p#>>'{engagement,ends_on}')::date>DATE '9999-12-31')) THEN RETURN NULL; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL; END;
  END IF;
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION public._paige_retained_commercial_payload(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;


-- Closed owner-UI preparation command. Artifact bytes are resolved/rendered and
-- verified by the existing server-side agreement renderer, never by the caller.
CREATE OR REPLACE FUNCTION public._validate_sales_preparation(_command jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF pg_catalog.jsonb_typeof(_command) IS DISTINCT FROM 'object'
  OR _command->>'action' IS DISTINCT FROM 'collection.prepare_agreement'
  OR (_command-ARRAY['action','agreement_id','agreement_version','invoice_id','invoice_version','invoice_draft_version','terms_id','terms_version','client_id','offer_id','payload_digest'])<>'{}'::jsonb
  OR NOT (_command ?& ARRAY['action','agreement_id','agreement_version','invoice_id','invoice_version','invoice_draft_version','terms_id','terms_version','client_id','offer_id','payload_digest'])
  OR coalesce(_command->>'payload_digest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Exact preparation command required' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['agreement_id','invoice_id','terms_id','client_id','offer_id'] LOOP
  IF coalesce(_command->>k,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   RAISE EXCEPTION 'Preparation identity required' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['agreement_version','invoice_version','invoice_draft_version','terms_version'] LOOP
  IF pg_catalog.jsonb_typeof(_command->k) IS DISTINCT FROM 'number' OR coalesce(_command->>k,'') !~ '^[0-9]{1,16}$'
   OR (_command->>k)::numeric>9007199254740991 OR (k<>'terms_version' AND (_command->>k)::numeric<1) THEN
   RAISE EXCEPTION 'Exact preparation version required' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._validate_sales_preparation(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._preview_sales_preparation(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE;t public.tenant_client_agreements%ROWTYPE;i public.paige_invoices%ROWTYPE;eligible boolean;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._validate_sales_preparation(_command);
 SELECT * INTO a FROM public.paige_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id;
 SELECT * INTO t FROM public.tenant_client_agreements WHERE id=(_command->>'terms_id')::uuid AND tenant_id=_expected_tenant_id;
 SELECT * INTO i FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
 eligible:=a.id IS NOT NULL AND t.id IS NOT NULL AND i.id IS NOT NULL
  AND a.status='draft' AND a.body_source IN ('paige_draft','tenant_template')
  AND a.content_sha256 IS NULL AND a.content_storage_key IS NULL AND a.commercial_presentation IS NULL
  AND a.version::text=_command->>'agreement_version' AND a.contact_id::text=_command->>'client_id'
  AND a.offer_id::text=_command->>'offer_id' AND a.commercial_terms_id=t.id
  AND t.contact_id=a.contact_id AND t.offer_id=a.offer_id AND t.status IN ('draft','active','paused')
  AND t.collection_terms_version::text=_command->>'terms_version' AND t.starts_on IS NOT NULL
  AND coalesce(t.price_basis,'') IN ('catalog','negotiated') AND t.agreed_amount_minor>0 AND pg_catalog.lower(t.agreed_currency)='usd'
  AND i.contact_id=a.contact_id AND i.status='draft' AND i.currency='usd'
  AND i.billing_lifecycle_version::text=_command->>'invoice_version' AND i.billing_draft_version::text=_command->>'invoice_draft_version'
  AND i.billing_draft->>'agreement_id'=a.id::text AND i.billing_draft#>>'{agreement_snapshot,id}'=a.id::text AND i.billing_draft#>>'{agreement_snapshot,version}'=a.version::text
  AND i.billing_draft#>>'{commercial_terms_reference,id}'=t.id::text AND i.billing_draft#>>'{commercial_terms_reference,version}'=t.collection_terms_version::text
  AND i.billing_draft->'total_minor'=pg_catalog.to_jsonb(t.agreed_amount_minor);
 RETURN pg_catalog.jsonb_build_object('eligible',coalesce(eligible,false),'action','collection.prepare_agreement',
  'summary','Retain the exact reviewed agreement document for signing. No signature request, customer message, issued invoice, payment or completed service.',
  'consequence',CASE WHEN eligible THEN _command||pg_catalog.jsonb_build_object('kind','retain_signing_document',
   'principal_minor',t.agreed_amount_minor,'currency','usd','engagement',pg_catalog.jsonb_build_object('starts_on',t.starts_on,'ends_on',t.ends_on,'price_basis',t.price_basis)) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public._preview_sales_preparation(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE UNIQUE INDEX IF NOT EXISTS sales_agreement_preparation_pair ON public.paige_sales_collection_operations
 (tenant_id,(command->>'agreement_id'),(command->>'agreement_version')) WHERE command->>'action'='collection.prepare_agreement';
DO $$ BEGIN
 IF pg_catalog.to_regprocedure('public._read_sales_collection_before_preparation(uuid,uuid,uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.read_sales_collection_command_result(uuid,uuid,uuid,jsonb) RENAME TO _read_sales_collection_before_preparation;
 END IF;
 IF pg_catalog.to_regprocedure('public._preview_sales_collection_before_preparation(uuid,uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) RENAME TO _preview_sales_collection_before_preparation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._read_sales_collection_before_preparation(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._preview_sales_collection_before_preparation(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.read_sales_collection_command_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb;op public.paige_sales_collection_operations%ROWTYPE;
BEGIN
 -- Preserve the complete incumbent actor/operation/command and effectuation behavior first.
 prior:=public._read_sales_collection_before_preparation(_actor_user_id,_expected_tenant_id,_operation_id,_command);
 IF prior IS NOT NULL OR _command->>'action' IS DISTINCT FROM 'collection.prepare_agreement' THEN RETURN prior;END IF;
 PERFORM public._validate_sales_preparation(_command);
 SELECT * INTO op FROM public.paige_sales_collection_operations WHERE tenant_id=_expected_tenant_id
  AND command->>'action'='collection.prepare_agreement' AND command->>'agreement_id'=_command->>'agreement_id'
  AND command->>'agreement_version'=_command->>'agreement_version';
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF op.command IS DISTINCT FROM _command THEN RAISE EXCEPTION 'Signing document already prepared from different source' USING ERRCODE='22023';END IF;
 RETURN op.result;
END $$;
REVOKE ALL ON FUNCTION public.read_sales_collection_command_result(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sales_collection_command_result(uuid,uuid,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.preview_sales_collection_command(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _command->>'action'='collection.prepare_agreement' THEN RETURN public._preview_sales_preparation(_actor_user_id,_expected_tenant_id,_command);END IF;
 RETURN public._preview_sales_collection_before_preparation(_actor_user_id,_expected_tenant_id,_command);
END $$;
REVOKE ALL ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) TO service_role;

-- Artifact-backed adapter to the same private freeze writer and immutable
-- Collections operation/Rail transaction. The browser cannot supply _prepared.
CREATE OR REPLACE FUNCTION public.execute_sales_agreement_preparation(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb,_governance jsonb,_prepared jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb;preview jsonb;p jsonb;s jsonb;frozen jsonb;result jsonb;at_time timestamptz;receipt_id uuid;mode text;expected_key text;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._validate_sales_preparation(_command);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_operation_id::text,81747));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_expected_tenant_id::text||':'||(_command->>'agreement_id')||':'||(_command->>'agreement_version'),81749));
 prior:=public.read_sales_collection_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
 IF prior IS NOT NULL THEN RETURN prior;END IF;
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,'collection.prepare_agreement','sales_prepare_agreement',_governance);
 mode:=public.resolve_tool_autonomy(_expected_tenant_id,'sales_prepare_agreement');
 IF mode IS NULL OR mode NOT IN ('auto','confirm') THEN RAISE EXCEPTION 'Current preparation authority unavailable' USING ERRCODE='42501';END IF;
 PERFORM id FROM public.paige_agreements WHERE id=(_command->>'agreement_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
 PERFORM id FROM public.tenant_client_agreements WHERE id=(_command->>'terms_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
 PERFORM id FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id FOR SHARE;
 preview:=public._preview_sales_preparation(_actor_user_id,_expected_tenant_id,_command);
 IF preview->'eligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Reviewed preparation source changed' USING ERRCODE='40001';END IF;
 IF pg_catalog.jsonb_typeof(_prepared) IS DISTINCT FROM 'object'
  OR (_prepared-ARRAY['payload','payload_digest','presented_body_markdown','presented_body_sha256','content_storage_key','document_sha256'])<>'{}'::jsonb
  OR NOT (_prepared ?& ARRAY['payload','payload_digest','presented_body_markdown','presented_body_sha256','content_storage_key','document_sha256']) THEN
  RAISE EXCEPTION 'Server-prepared document required' USING ERRCODE='22023';END IF;
 p:=_prepared->'payload';s:=p->'source';
 expected_key:=_expected_tenant_id::text||'/'||(_command->>'agreement_id')||'/presented-commercial-'||_operation_id::text||'-'||(_command->>'payload_digest')||'.pdf';
 IF p->>'schema_version' IS DISTINCT FROM '2' OR _prepared->>'payload_digest' IS DISTINCT FROM _command->>'payload_digest'
  OR _prepared->>'content_storage_key' IS DISTINCT FROM expected_key
  OR s->>'tenant_id' IS DISTINCT FROM _expected_tenant_id::text OR s->>'agreement_id' IS DISTINCT FROM _command->>'agreement_id'
  OR s->>'agreement_version' IS DISTINCT FROM _command->>'agreement_version' OR s->>'invoice_id' IS DISTINCT FROM _command->>'invoice_id'
  OR s->>'invoice_version' IS DISTINCT FROM _command->>'invoice_version' OR s->>'invoice_draft_version' IS DISTINCT FROM _command->>'invoice_draft_version'
  OR s->>'terms_id' IS DISTINCT FROM _command->>'terms_id' OR s->>'terms_version' IS DISTINCT FROM _command->>'terms_version'
  OR s->>'client_id' IS DISTINCT FROM _command->>'client_id' OR s->>'offer_id' IS DISTINCT FROM _command->>'offer_id' THEN
  RAISE EXCEPTION 'Original prepared document differs' USING ERRCODE='40001';END IF;
 frozen:=public._freeze_paige_commercial_presentation(_actor_user_id,_expected_tenant_id,p,_prepared->>'payload_digest',
  _prepared->>'presented_body_markdown',_prepared->>'presented_body_sha256',_prepared->>'content_storage_key',_prepared->>'document_sha256','owner_ui');
 IF frozen->>'state' IS DISTINCT FROM 'frozen' OR frozen->>'agreement_id' IS DISTINCT FROM _command->>'agreement_id'
  OR frozen->>'payload_digest' IS DISTINCT FROM _command->>'payload_digest' OR frozen->>'document_sha256' IS DISTINCT FROM _prepared->>'document_sha256' THEN
  RAISE EXCEPTION 'Prepared document readback unavailable' USING ERRCODE='55000';END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 at_time:=pg_catalog.clock_timestamp();
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_prepare_agreement','capability_succeeded',_operation_id,NULL,NULL,NULL,NULL,
  pg_catalog.jsonb_build_object('origin','owner_ui','agreement_id',_command->>'agreement_id','agreement_version',_command->'agreement_version','payload_digest',_command->>'payload_digest'));
 SELECT id INTO receipt_id FROM public.paige_workspace_events WHERE tenant_id=_expected_tenant_id AND actor_id=_actor_user_id
  AND source_kind='capability_run' AND source_id=_operation_id AND source_revision=0 AND outcome='capability_succeeded' AND capability_key='sales_prepare_agreement'
  AND detail->>'origin'='owner_ui' AND detail->>'agreement_id'=_command->>'agreement_id' AND detail->'agreement_version'=_command->'agreement_version'
  AND detail->>'payload_digest'=_command->>'payload_digest';
 IF receipt_id IS NULL THEN RAISE EXCEPTION 'Prepared document receipt unavailable' USING ERRCODE='55000';END IF;
 result:=pg_catalog.jsonb_build_object('ok',true,'outcome','agreement_prepared','historical_receipt',true,'receipt_id',receipt_id,
  'row',pg_catalog.jsonb_build_object('id',_command->>'agreement_id','tenant_id',_expected_tenant_id,'version_at_preparation',_command->'agreement_version',
   'invoice_id',_command->>'invoice_id','invoice_version',_command->'invoice_version','invoice_draft_version',_command->'invoice_draft_version',
   'terms_id',_command->>'terms_id','terms_version',_command->'terms_version','client_id',_command->>'client_id','offer_id',_command->>'offer_id',
   'payload_digest',_command->>'payload_digest','document_sha256',_prepared->>'document_sha256','prepared_at',at_time,'actor_user_id',_actor_user_id),
  'operation',pg_catalog.jsonb_build_object('id',_operation_id,'action','collection.prepare_agreement'));
 INSERT INTO public.paige_sales_collection_operations(id,tenant_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,_actor_user_id,_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.execute_sales_agreement_preparation(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_agreement_preparation(uuid,uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.read_sales_prepared_agreement(_expected_tenant_id uuid,_invoice_id uuid,_agreement_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE package jsonb;a public.paige_agreements%ROWTYPE;p jsonb;original jsonb;
BEGIN
 IF auth.uid() IS NULL OR _expected_tenant_id IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Prepared agreement unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 package:=public.read_sales_commercial_package(_expected_tenant_id,_invoice_id);
 IF _agreement_id IS NULL OR package#>>'{agreement,id}' IS DISTINCT FROM _agreement_id::text THEN
  RAISE EXCEPTION 'Prepared agreement unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement_id AND tenant_id=_expected_tenant_id
  AND contact_id::text=package#>>'{invoice,client_id}' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prepared agreement unavailable' USING ERRCODE='42501';END IF;
 p:=public._paige_retained_commercial_payload(a);
 IF p IS NULL OR p#>>'{source,invoice_id}' IS DISTINCT FROM _invoice_id::text THEN
  RETURN pg_catalog.jsonb_build_object('schema_version',1,'state','unverified','tenant_id',_expected_tenant_id,'invoice_id',_invoice_id,'agreement_id',_agreement_id,'receipt_id',package->'receipt_id');END IF;
 SELECT result INTO original FROM public.paige_sales_collection_operations WHERE tenant_id=_expected_tenant_id
  AND command->>'action'='collection.prepare_agreement' AND command->>'agreement_id'=_agreement_id::text
  AND command->>'agreement_version'=a.version::text AND command->>'payload_digest'=a.commercial_presentation->>'payload_digest';
 IF original IS NOT NULL AND NOT public._agreement_commercial_ready(a) THEN original:=NULL;END IF;
 RETURN pg_catalog.jsonb_build_object('schema_version',1,'state','retained','tenant_id',_expected_tenant_id,'invoice_id',_invoice_id,'agreement_id',_agreement_id,
  'current_status',a.status,'payload',p,'payload_digest',a.commercial_presentation->'payload_digest','body_markdown',a.body_markdown,
  'presented_body_markdown',a.presented_body_markdown,'document_sha256',a.content_sha256,'receipt_id',package->'receipt_id','preparation',original);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_prepared_agreement(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_prepared_agreement(uuid,uuid,uuid) TO authenticated;
-- The two existing signature-entry doors share this canonical preparation gate.
-- Historical valid v1 presentations remain intact; new v2 preparations require
-- their actual immutable operation and exact human-attributed Rail receipt.
CREATE OR REPLACE FUNCTION public._agreement_commercial_ready(_a public.paige_agreements) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE p jsonb;
BEGIN
 IF _a.commercial_terms_id IS NULL THEN RETURN true;END IF;
 p:=public._paige_retained_commercial_payload(_a);
 IF p IS NULL THEN RETURN false;END IF;
 IF p->>'schema_version'='1' THEN RETURN true;END IF;
 RETURN EXISTS(SELECT 1 FROM public.paige_sales_collection_operations op
  JOIN public.paige_workspace_events e ON e.id=CASE WHEN coalesce(op.result->>'receipt_id','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN (op.result->>'receipt_id')::uuid ELSE NULL END
  WHERE op.tenant_id=_a.tenant_id AND op.command->>'action'='collection.prepare_agreement'
   AND op.command->>'agreement_id'=_a.id::text AND op.command->>'agreement_version'=_a.version::text
   AND op.command->>'payload_digest'=_a.commercial_presentation->>'payload_digest'
   AND op.result->'ok'='true'::jsonb AND op.result->>'outcome'='agreement_prepared'
   AND op.result#>>'{row,document_sha256}'=_a.content_sha256
   AND e.tenant_id=_a.tenant_id AND e.actor_id=op.actor_user_id AND e.source_kind='capability_run' AND e.source_id=op.id AND e.source_revision=0
   AND e.outcome='capability_succeeded' AND e.capability_key='sales_prepare_agreement'
   AND e.detail->>'origin'='owner_ui' AND e.detail->>'agreement_id'=_a.id::text
   AND e.detail->'agreement_version'=pg_catalog.to_jsonb(_a.version) AND e.detail->>'payload_digest'=op.command->>'payload_digest');
END $$;
REVOKE ALL ON FUNCTION public._agreement_commercial_ready(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.check_sales_agreement_preparation(_actor_user_id uuid,_expected_tenant_id uuid,_agreement_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE;
BEGIN
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 RETURN public._agreement_commercial_ready(a);
END $$;
REVOKE ALL ON FUNCTION public.check_sales_agreement_preparation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_sales_agreement_preparation(uuid,uuid,uuid) TO service_role;
DO $$ BEGIN
 IF pg_catalog.to_regprocedure('public._issue_signing_link_before_commercial_preparation(uuid,uuid,integer)') IS NULL THEN
  ALTER FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) RENAME TO _issue_signing_link_before_commercial_preparation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._issue_signing_link_before_commercial_preparation(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.issue_agreement_signing_link(_expected_tenant_id uuid,_signing_id uuid,_ttl_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();tenant uuid:=public.current_user_tenant_id();a public.paige_agreements%ROWTYPE;
BEGIN
 -- Same incumbent manual-owner prefix/TTL semantics, before private document checks.
 IF actor IS NULL OR tenant IS NULL THEN RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE='42501';END IF;
 IF _expected_tenant_id IS DISTINCT FROM tenant THEN RAISE EXCEPTION 'your active workspace changed before this could run; nothing was written' USING ERRCODE='42501';END IF;
 IF NOT public.is_tenant_admin(tenant) THEN RAISE EXCEPTION 'only an owner or admin may issue a signing link' USING ERRCODE='42501';END IF;
 IF _ttl_days IS NULL OR _ttl_days<1 OR _ttl_days>365 THEN RAISE EXCEPTION 'a signing link lasts between 1 and 365 days' USING ERRCODE='23514';END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=_signing_id AND tenant_id=tenant FOR SHARE;
 IF FOUND AND a.commercial_terms_id IS NOT NULL AND NOT public._agreement_commercial_ready(a) THEN
  RAISE EXCEPTION 'Prepare and review the exact commercial document before issuing a signing link' USING ERRCODE='23514';END IF;
 RETURN public._issue_signing_link_before_commercial_preparation(_expected_tenant_id,_signing_id,_ttl_days);
END $$;
REVOKE ALL ON FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) TO authenticated;

-- Metadata/control only. All incumbent catalogue rows and caller checks run first.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_e04_preparation(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_e04_preparation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_preparation(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_preparation(uuid) FROM service_role;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e04_preparation(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id;END IF;
 ELSE tenant:=_tenant_id;END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('sales_prepare_agreement','Retain a reviewed agreement for signing','Payments')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

-- This owner-only UI act must not be attributed to PAIGE. Preserve the exact
-- predecessor for every other key, including E4-S3 and effectuation attribution.
DO $$ BEGIN
 IF pg_catalog.to_regprocedure('public._workspace_event_display_before_e04_preparation(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_e04_preparation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_e04_preparation(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=public._workspace_event_display_before_e04_preparation(_source_kind,_outcome,_capability);
 IF _source_kind='capability_run' AND _capability='sales_prepare_agreement' THEN
  result:=result||pg_catalog.jsonb_build_object('actor_type','owner_staff','title',CASE WHEN _outcome='capability_succeeded' THEN 'Agreement document prepared'
   WHEN _outcome='capability_failed' THEN 'Agreement preparation failed' ELSE 'Agreement preparation updated' END,
   'summary','Owner agreement preparation record. Signing, messages, invoices, payments and service delivery have separate evidence.');
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
