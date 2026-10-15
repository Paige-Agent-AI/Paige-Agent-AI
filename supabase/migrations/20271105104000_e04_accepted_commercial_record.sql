-- CLI scaffold 20261015040822, forwarded while UNAPPLIED to the reserved E04
-- slot above the released E02 frontier. No historical migration rewrite.
-- Read retained commercial evidence only: no signature, effectuation, obligation,
-- invoice, payment, provider or admission effect and no historical backfill.
BEGIN;
SET LOCAL lock_timeout='5s';

-- ONE immutable-presentation validator, shared by signing and owner inspection.
-- It validates provenance and bindings, not a second financial calculation.
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
    OR p->>'schema_version' IS DISTINCT FROM '1' OR p->>'amount_basis' IS DISTINCT FROM 'total'
    OR (p-ARRAY['schema_version','source','title','body_sha256','principal_minor','currency','amount_basis','collection_terms','obligations','conditions','lines'])<>'{}'::jsonb
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
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION public._paige_retained_commercial_payload(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._paige_accepted_commercial_payload(_a public.paige_agreements)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF _a.status IS DISTINCT FROM 'completed' OR _a.completed_at IS NULL
    OR coalesce(_a.sealed_sha256,'') !~ '^[a-f0-9]{64}$'
    OR _a.sealed_storage_key IS NULL OR _a.sealed_storage_key NOT LIKE _a.tenant_id::text||'/'||_a.id::text||'/%'
    OR pg_catalog.strpos(_a.sealed_storage_key,'..')>0 OR pg_catalog.strpos(_a.sealed_storage_key,pg_catalog.chr(92))>0
    OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=_a.id AND s.tenant_id=_a.tenant_id)
    OR EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=_a.id AND
      (s.tenant_id IS DISTINCT FROM _a.tenant_id OR s.status IS DISTINCT FROM 'signed'
        OR s.signed_at IS NULL OR s.signed_at>_a.completed_at OR s.esign_consent_at IS NULL
        OR s.esign_consent_at>s.signed_at OR coalesce(s.esign_consent_sha256,'') !~ '^[a-f0-9]{64}$'
        OR s.esign_consent_slug IS NULL OR s.esign_consent_version IS NULL OR pg_catalog.btrim(coalesce(s.typed_name,''))=''))
    THEN RETURN NULL; END IF;
  RETURN public._paige_retained_commercial_payload(_a);
END $$;
REVOKE ALL ON FUNCTION public._paige_accepted_commercial_payload(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the original token/view/status contract; replace only its duplicated
-- capsule validation with the same private validator used by the owner read.
DO $$ DECLARE body text; first_pos integer; last_pos integer;
  ending text:=$anchor$    _term_summary:=_payload#>>'{collection_terms,kind}';
  END IF;$anchor$;
BEGIN
  body:=pg_catalog.pg_get_functiondef('public.peek_agreement_signing(text)'::regprocedure);
  IF pg_catalog.strpos(body,'public._paige_retained_commercial_payload(_a)')>0 THEN RETURN; END IF;
  first_pos:=pg_catalog.strpos(body,'  IF _a.commercial_presentation IS NOT NULL THEN');
  last_pos:=pg_catalog.strpos(body,ending);
  IF first_pos=0 OR last_pos<=first_pos THEN RAISE EXCEPTION 'Original signing presentation anchor changed'; END IF;
  body:=pg_catalog.overlay(body,$replacement$  IF _a.commercial_presentation IS NOT NULL THEN
    _payload:=public._paige_retained_commercial_payload(_a);
    IF _payload IS NULL THEN
      RETURN QUERY SELECT NULL::text,NULL::text,NULL::text,NULL::text,NULL::jsonb,NULL::text,
        NULL::bigint,NULL::text,NULL::text,NULL::timestamptz,NULL::text,false;
      RETURN;
    END IF;
    _amount_minor:=(_payload->>'principal_minor')::bigint;
    _amount_currency:=_payload->>'currency';
    _term_summary:=_payload#>>'{collection_terms,kind}';
  END IF;$replacement$,first_pos,last_pos-first_pos+pg_catalog.length(ending));
  IF pg_catalog.strpos(body,'  _a record;')=0 THEN RAISE EXCEPTION 'Original signing row declaration changed'; END IF;
  body:=pg_catalog.replace(body,'  _a record;','  _a public.paige_agreements%ROWTYPE;');
  EXECUTE body;
END $$;

-- Extend the incumbent package projector and its existing read receipt. Never
-- derive accepted economics from today's mutable terms or re-count principal.
DO $$ DECLARE body text; prior text;
BEGIN
  body:=pg_catalog.pg_get_functiondef('public.read_sales_commercial_package(uuid,uuid)'::regprocedure);
  IF pg_catalog.strpos(body,'accepted_commercial_terms')>0 THEN RETURN; END IF;
  prior:=body;
  body:=pg_catalog.replace(body,'terms jsonb:=NULL;', 'accepted jsonb:=NULL; accepted_payload jsonb:=NULL; terms jsonb:=NULL;');
  IF body=prior THEN RAISE EXCEPTION 'Original package declaration changed'; END IF; prior:=body;
  body:=pg_catalog.replace(body,'  result:=jsonb_build_object(', $replacement$
  IF a.status='completed' THEN
    accepted_payload:=public._paige_accepted_commercial_payload(a);
    IF accepted_payload IS NOT NULL AND accepted_payload#>>'{source,invoice_id}'=i.id::text THEN
      accepted:=jsonb_build_object('schema_version',1,'basis','completed_immutable_presentation',
        'agreement_id',a.id,'agreement_version',a.version,'completed_at',a.completed_at,
        'commercial_terms_id',a.commercial_terms_id,'commercial_terms_version',accepted_payload#>'{source,terms_version}',
        'invoice_id',i.id,'invoice_draft_version',accepted_payload#>'{source,invoice_draft_version}',
        'principal_minor',accepted_payload->'principal_minor','currency',accepted_payload->'currency',
        'obligations',accepted_payload->'obligations','conditions',accepted_payload->'conditions');
      missing:=array_remove(missing,'signed_terms_compatibility');
      IF t.id IS DISTINCT FROM a.commercial_terms_id OR t.collection_terms_version::text IS DISTINCT FROM accepted_payload#>>'{source,terms_version}'
        OR t.agreed_amount_minor::text IS DISTINCT FROM accepted_payload->>'principal_minor'
        OR lower(t.agreed_currency) IS DISTINCT FROM accepted_payload->>'currency'
        OR t.collection_terms IS DISTINCT FROM accepted_payload->'collection_terms' THEN
        conflicts:=array_append(conflicts,'accepted_commercial_terms_changed');
      END IF;
      IF i.billing_draft_version::text IS DISTINCT FROM accepted_payload#>>'{source,invoice_draft_version}'
        OR i.billing_draft->'commercial_conditions' IS DISTINCT FROM accepted_payload->'conditions'
        OR i.billing_draft->'total_minor' IS DISTINCT FROM accepted_payload->'principal_minor' THEN
        conflicts:=array_append(conflicts,'accepted_invoice_changed');
      END IF;
    END IF;
  END IF;
  result:=jsonb_build_object($replacement$);
  IF body=prior THEN RAISE EXCEPTION 'Original package result anchor changed'; END IF; prior:=body;
  body:=pg_catalog.replace(body,$anchor$'compatibility',jsonb_build_object($anchor$,
    $replacement$'accepted_commercial_terms',accepted,'compatibility',jsonb_build_object($replacement$);
  IF body=prior THEN RAISE EXCEPTION 'Original package compatibility anchor changed'; END IF; prior:=body;
  body:=pg_catalog.replace(body,$anchor$CASE WHEN a.status='completed' THEN 'unverified_no_frozen_commercial_snapshot' ELSE 'not_signed' END$anchor$,
    $replacement$CASE WHEN accepted IS NOT NULL THEN 'recorded_immutable_presentation' WHEN a.status='completed' THEN 'unverified_no_frozen_commercial_snapshot' ELSE 'not_signed' END$replacement$);
  IF body=prior THEN RAISE EXCEPTION 'Original package signed economics anchor changed'; END IF;
  EXECUTE body;
END $$;

-- Explicit full-text OWNER read only. The model projection above contains neither
-- legal text, private Storage paths, signer identities nor access tokens.
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
