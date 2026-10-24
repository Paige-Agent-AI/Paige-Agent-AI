-- Prospective reconciliation of the ORIGINAL #2190 private evidence validators.
-- Current schema2/native signature evidence, same agreement/signers/events.
-- No historical inference, public grant, activation, obligation or financial act.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE expected record; current_body text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)'))
   IS DISTINCT FROM '3a2fa340fca9838aa9c6737f1e41ae61' THEN
  RAISE EXCEPTION 'Original native signature writer changed; reconcile accepted evidence before applying' USING ERRCODE='23514';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('public._paige_retained_commercial_payload(public.paige_agreements)','5347818ecd1dda3b7b28129e1b8f8033'),
  ('public._paige_accepted_commercial_payload(public.paige_agreements)','235026b37dfde7b0f151588c680c8ca9'),
  ('public.read_sales_accepted_agreement(uuid,uuid,uuid)','ffc7795288582b4eca5b506e5aada042')
 ) AS definitions(identity,body_hash) LOOP
  SELECT md5(prosrc) INTO current_body FROM pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF FOUND AND current_body IS DISTINCT FROM expected.body_hash THEN
   RAISE EXCEPTION 'Existing accepted commercial validator changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $migration$;

CREATE OR REPLACE FUNCTION public._paige_retained_commercial_payload(_a public.paige_agreements)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb:=_a.commercial_presentation; p jsonb; s jsonb;
BEGIN
 -- This verifies the immutable original producer's capsule/provenance. It does
 -- not re-price from today's mutable terms or parse supplied legal language.
 IF c IS NULL OR pg_catalog.jsonb_typeof(c) IS DISTINCT FROM 'object'
  OR (c-ARRAY['schema_version','payload','payload_digest','presented_body_sha256','content_storage_key','document_sha256'])<>'{}'::jsonb
  OR c->'schema_version' IS DISTINCT FROM '1'::jsonb
  OR pg_catalog.jsonb_typeof(c->'payload') IS DISTINCT FROM 'object'
  OR _a.contact_id IS NULL OR _a.offer_id IS NULL OR _a.commercial_terms_id IS NULL
  OR _a.body_source NOT IN ('paige_draft','tenant_template')
  OR _a.presented_body_markdown IS NULL OR pg_catalog.length(_a.presented_body_markdown)=0
  OR _a.content_storage_key IS NULL
  OR _a.content_storage_key NOT LIKE _a.tenant_id::text||'/'||_a.id::text||'/%'
  OR pg_catalog.strpos(_a.content_storage_key,'..')>0 OR pg_catalog.strpos(_a.content_storage_key,pg_catalog.chr(92))>0
  OR coalesce(_a.content_sha256,'') !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 p:=c->'payload'; s:=p->'source';
 IF pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object'
  OR (p->'schema_version' IS DISTINCT FROM '1'::jsonb AND p->'schema_version' IS DISTINCT FROM '2'::jsonb)
  OR p->>'amount_basis' IS DISTINCT FROM 'total'
  OR (p-ARRAY['schema_version','source','title','body_sha256','principal_minor','currency','amount_basis','collection_terms','obligations','conditions','lines']
    -CASE WHEN p->'schema_version'='2'::jsonb THEN ARRAY['engagement'] ELSE ARRAY[]::text[] END)<>'{}'::jsonb
  OR pg_catalog.jsonb_typeof(p->'principal_minor') IS DISTINCT FROM 'number'
  OR coalesce(p->>'principal_minor','') !~ '^[1-9][0-9]{0,9}$'
  OR p->>'currency' IS DISTINCT FROM 'usd'
  OR s->>'status' IS DISTINCT FROM 'draft' OR s->'content_sha256' IS DISTINCT FROM 'null'::jsonb
  OR s->>'body_source' IS DISTINCT FROM _a.body_source
  OR s->>'agreement_id' IS DISTINCT FROM _a.id::text
  OR s->>'tenant_id' IS DISTINCT FROM _a.tenant_id::text
  OR s->>'client_id' IS DISTINCT FROM _a.contact_id::text
  OR s->>'offer_id' IS DISTINCT FROM _a.offer_id::text
  OR s->>'terms_id' IS DISTINCT FROM _a.commercial_terms_id::text
  OR (s-ARRAY['tenant_id','client_id','offer_id','agreement_id','agreement_version','agreement_updated_at','body_source','status','content_sha256',
    'terms_id','terms_version','terms_updated_at','invoice_id','invoice_version','invoice_draft_version','invoice_updated_at'])<>'{}'::jsonb
  OR s->'agreement_version' IS DISTINCT FROM pg_catalog.to_jsonb(_a.version)
  OR pg_catalog.jsonb_typeof(s->'terms_version') IS DISTINCT FROM 'number'
  OR coalesce(s->>'terms_version','') !~ '^[0-9]{1,16}$'
  OR coalesce(s->>'invoice_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR pg_catalog.jsonb_typeof(s->'invoice_version') IS DISTINCT FROM 'number'
  OR coalesce(s->>'invoice_version','') !~ '^[1-9][0-9]{0,15}$'
  OR pg_catalog.jsonb_typeof(s->'invoice_draft_version') IS DISTINCT FROM 'number'
  OR coalesce(s->>'invoice_draft_version','') !~ '^[1-9][0-9]{0,15}$'
  OR p->>'title' IS DISTINCT FROM _a.title
  OR c->>'content_storage_key' IS DISTINCT FROM _a.content_storage_key
  OR c->>'document_sha256' IS DISTINCT FROM _a.content_sha256
  OR c->>'payload_digest' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(p),'UTF8')),'hex')
  OR c->>'presented_body_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_a.presented_body_markdown,'UTF8')),'hex')
  OR p->>'body_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(_a.body_markdown,''),'UTF8')),'hex') THEN RETURN NULL; END IF;
 IF (p->>'principal_minor')::bigint>2147483647 OR (s->>'terms_version')::numeric>9007199254740991
  OR (s->>'invoice_version')::numeric>9007199254740991
  OR (s->>'invoice_draft_version')::numeric>9007199254740991
  OR pg_catalog.jsonb_typeof(p->'obligations') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_typeof(p->'conditions') IS DISTINCT FROM 'object'
  OR pg_catalog.jsonb_typeof(p->'collection_terms') IS DISTINCT FROM 'object'
  OR pg_catalog.jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF p->'schema_version'='2'::jsonb AND (pg_catalog.jsonb_typeof(p->'engagement') IS DISTINCT FROM 'object'
  OR ((p->'engagement')-ARRAY['starts_on','ends_on','price_basis'])<>'{}'::jsonb
  OR pg_catalog.jsonb_typeof(p#>'{engagement,starts_on}') IS DISTINCT FROM 'string'
  OR (pg_catalog.jsonb_typeof(p#>'{engagement,ends_on}') IS DISTINCT FROM 'string' AND p#>'{engagement,ends_on}' IS DISTINCT FROM 'null'::jsonb)
  OR pg_catalog.jsonb_typeof(p#>'{engagement,price_basis}') IS DISTINCT FROM 'string') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
  WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.event_type='edited'
   AND e.actor_kind IN ('owner','paige') AND e.actor_user_id IS NOT NULL
   AND e.detail->>'action'='commercial_presentation_frozen'
   AND e.detail->>'payload_digest'=c->>'payload_digest'
   AND e.detail->>'document_sha256'=_a.content_sha256
   AND e.detail->>'terms_id'=_a.commercial_terms_id::text
   AND e.detail->>'terms_version'=s->>'terms_version') THEN RETURN NULL; END IF;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION public._paige_retained_commercial_payload(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._paige_accepted_commercial_payload(_a public.paige_agreements)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF _a.status IS DISTINCT FROM 'completed' OR _a.completed_at IS NULL
  OR coalesce(_a.sealed_sha256,'') !~ '^[a-f0-9]{64}$'
  OR _a.sealed_storage_key IS NULL
  OR _a.sealed_storage_key NOT LIKE _a.tenant_id::text||'/'||_a.id::text||'/%'
  OR pg_catalog.strpos(_a.sealed_storage_key,'..')>0 OR pg_catalog.strpos(_a.sealed_storage_key,pg_catalog.chr(92))>0
  OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_signers s
    WHERE s.agreement_id=_a.id AND s.tenant_id=_a.tenant_id AND s.signer_role='counterparty')
  OR EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=_a.id AND
   (s.tenant_id IS DISTINCT FROM _a.tenant_id OR s.status IS DISTINCT FROM 'signed'
    OR s.signed_at IS NULL OR s.signed_at>_a.completed_at OR s.esign_consent_at IS NULL
    OR s.esign_consent_at>s.signed_at OR coalesce(s.esign_consent_sha256,'') !~ '^[a-f0-9]{64}$'
    OR pg_catalog.btrim(coalesce(s.esign_consent_slug,''))='' OR s.esign_consent_version IS NULL OR s.esign_consent_version<1
    OR pg_catalog.length(pg_catalog.btrim(coalesce(s.typed_name,''))) NOT BETWEEN 2 AND 200
    OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
      WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.signer_id=s.id
       AND e.event_type='consented' AND e.actor_kind='signer' AND e.actor_email=s.email AND e.created_at=s.esign_consent_at
       AND e.detail->>'signature_record_id'=s.id::text
       AND e.detail->'document_version'=pg_catalog.to_jsonb(_a.version) AND e.detail->>'document_sha256'=_a.content_sha256)
    OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
      WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.signer_id=s.id
       AND e.event_type='signed' AND e.actor_kind='signer' AND e.actor_email=s.email AND e.created_at=s.signed_at
       AND e.detail->>'signature_record_id'=s.id::text
       AND e.detail->'document_version'=pg_catalog.to_jsonb(_a.version) AND e.detail->>'document_sha256'=_a.content_sha256)))
  OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
    WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.event_type='sealed' AND e.actor_kind='system'
     AND e.detail->>'sealed_sha256'=_a.sealed_sha256 AND e.detail->>'presented_sha256'=_a.content_sha256)
  OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
    WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.event_type='completed' AND e.actor_kind='system')
  THEN RETURN NULL; END IF;
 -- File download/hash readback stays in the ORIGINAL document/seal endpoint.
 -- Missing historical audit remains unverified; this read never manufactures it.
 RETURN public._paige_retained_commercial_payload(_a);
END $$;
REVOKE ALL ON FUNCTION public._paige_accepted_commercial_payload(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;

-- Reuse #2190's explicit owner read. The existing commercial package keeps its
-- original closed DTO; older deployed callers receive no unexpected new keys.
CREATE OR REPLACE FUNCTION public.read_sales_accepted_agreement(_expected_tenant_id uuid,_invoice_id uuid,_agreement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE package jsonb; a public.paige_agreements%ROWTYPE; payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR _expected_tenant_id IS NULL
  OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 package:=public.read_sales_commercial_package(_expected_tenant_id,_invoice_id);
 IF _agreement_id IS NULL OR package#>>'{agreement,id}' IS DISTINCT FROM _agreement_id::text THEN
  RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement_id AND tenant_id=_expected_tenant_id
  AND contact_id::text=package#>>'{invoice,client_id}' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501'; END IF;
 -- Any wait on the original package/agreement must not preserve retired actor
 -- authority. The canonical actor reader owns the current role/tenant checks.
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 payload:=public._paige_accepted_commercial_payload(a);
 IF payload IS NULL OR payload#>>'{source,invoice_id}' IS DISTINCT FROM _invoice_id::text THEN
  RETURN pg_catalog.jsonb_build_object('schema_version',1,'state','unverified','tenant_id',_expected_tenant_id,
   'invoice_id',_invoice_id,'agreement_id',_agreement_id,'receipt_id',package->'receipt_id');
 END IF;
 RETURN pg_catalog.jsonb_build_object('schema_version',1,'state','recorded','tenant_id',_expected_tenant_id,
  'invoice_id',_invoice_id,'agreement_id',_agreement_id,'completed_at',a.completed_at,
  'payload',payload,'payload_digest',a.commercial_presentation->'payload_digest',
  'body_markdown',a.body_markdown,'presented_body_markdown',a.presented_body_markdown,
  'document_sha256',a.content_sha256,'sealed_sha256',a.sealed_sha256,
  'receipt_id',package->'receipt_id');
END $$;
REVOKE ALL ON FUNCTION public.read_sales_accepted_agreement(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_accepted_agreement(uuid,uuid,uuid) TO authenticated;
COMMIT;
