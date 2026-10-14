-- E04 prospective commercial presentation, canonical agreement store only.
-- CLI-generated locally, ordered in the previously reserved 20271101163000 slot.
-- No backfill, activation, signature, provider call, or terms effectuation here.
ALTER TABLE public.paige_agreements ADD COLUMN IF NOT EXISTS commercial_presentation jsonb;
ALTER TABLE public.paige_agreements ADD COLUMN IF NOT EXISTS presented_body_markdown text;

CREATE OR REPLACE FUNCTION public._paige_commercial_canonical_json(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text;
BEGIN
  CASE pg_catalog.jsonb_typeof(v)
    WHEN 'object' THEN
      SELECT '{'||coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(key)::text||':'||
        public._paige_commercial_canonical_json(value),',' ORDER BY key COLLATE "C"),'')||'}'
        INTO result FROM pg_catalog.jsonb_each(v);
    WHEN 'array' THEN
      SELECT '['||coalesce(pg_catalog.string_agg(public._paige_commercial_canonical_json(value),',' ORDER BY ordinal),'')||']'
        INTO result FROM pg_catalog.jsonb_array_elements(v) WITH ORDINALITY AS x(value,ordinal);
    WHEN 'number' THEN result:=pg_catalog.trim_scale((v#>>'{}')::numeric)::text;
    ELSE result:=v::text;
  END CASE;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._paige_commercial_canonical_json(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._paige_commercial_presentation_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.commercial_presentation IS NOT NULL AND (
    NEW.commercial_presentation IS DISTINCT FROM OLD.commercial_presentation OR
    NEW.presented_body_markdown IS DISTINCT FROM OLD.presented_body_markdown OR
    NEW.content_storage_key IS DISTINCT FROM OLD.content_storage_key OR
    NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR
    NEW.body_markdown IS DISTINCT FROM OLD.body_markdown OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.contact_id IS DISTINCT FROM OLD.contact_id OR
    NEW.commercial_terms_id IS DISTINCT FROM OLD.commercial_terms_id OR
    NEW.offer_id IS DISTINCT FROM OLD.offer_id) THEN
    RAISE EXCEPTION 'The presented commercial version is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_commercial_presentation_immutable() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_paige_commercial_presentation_immutable ON public.paige_agreements;
CREATE TRIGGER trg_paige_commercial_presentation_immutable BEFORE UPDATE ON public.paige_agreements
FOR EACH ROW EXECUTE FUNCTION public._paige_commercial_presentation_immutable();

-- Only the trusted existing agreement sender may freeze renderer-produced bytes.
-- Actor is server-derived; this function repeats the existing Sales actor floor,
-- locks exact canonical source versions, and refuses client/service-scope drift.
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
    OR _payload->>'schema_version' IS DISTINCT FROM '1'
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
  IF (_payload - ARRAY['schema_version','source','title','body_sha256','principal_minor','currency',
       'amount_basis','collection_terms','obligations','conditions','lines']) <> '{}'::jsonb
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
