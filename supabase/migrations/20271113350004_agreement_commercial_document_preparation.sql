-- Bind the exact reviewed commercial presentation to the original private
-- document/field manifest. No new table/column/store, signature or money effect.
-- Manifest2 is internal-only until the canonical API/renderer consumes it.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $source_guard$
DECLARE retained text; validated text;
BEGIN
  SELECT md5(prosrc) INTO retained FROM pg_catalog.pg_proc WHERE oid=
    pg_catalog.to_regprocedure('public._retain_agreement_document_preparation(uuid,uuid,uuid,uuid,integer,timestamptz,uuid,uuid,text,text,text,text)');
  SELECT md5(prosrc) INTO validated FROM pg_catalog.pg_proc WHERE oid=
    pg_catalog.to_regprocedure('public._validate_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)');
  IF retained IS NULL OR retained NOT IN ('e0545cfc24527b448ca575aa3cc43e86','ab4f8d36f18ecef8650edb85c1d6b89b') THEN
    RAISE EXCEPTION 'Original preparation writer changed; reconcile before applying' USING ERRCODE='23514'; END IF;
  IF validated IS DISTINCT FROM '61056f39c2e8c9a5fa7aab3641820a1b' THEN
    RAISE EXCEPTION 'Original commercial validator changed; reconcile before applying' USING ERRCODE='23514'; END IF;
END $source_guard$;

CREATE OR REPLACE FUNCTION public._retain_agreement_document_preparation(
  _actor uuid,_tenant uuid,_agreement uuid,_client uuid,_version integer,_updated_at timestamptz,
  _request uuid,_expected_current uuid,_storage_key text,_manifest_canonical text,_manifest_digest text,
  _commercial_payload_digest text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
  m jsonb; commercial jsonb; commercial_source jsonb; parties jsonb; current_id uuid; revision bigint; event uuid;
BEGIN
  PERFORM public._sales_invoice_actor(_actor,_tenant);
  SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement preparation unavailable in this business' USING ERRCODE='42501'; END IF;
  IF _request IS NULL OR _client IS NULL OR _version IS NULL OR _updated_at IS NULL
    OR _manifest_canonical IS NULL OR pg_catalog.octet_length(_manifest_canonical) NOT BETWEEN 2 AND 1048576
    OR _manifest_digest IS NULL OR _manifest_digest !~ '^[a-f0-9]{64}$'
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_manifest_canonical,'UTF8')),'hex') IS DISTINCT FROM _manifest_digest
    OR (_commercial_payload_digest IS NOT NULL AND _commercial_payload_digest !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Exact preparation bytes and identity required' USING ERRCODE='22023'; END IF;
  m:=_manifest_canonical::jsonb;
  IF pg_catalog.jsonb_typeof(m) IS DISTINCT FROM 'object'
    OR NOT(m ?& ARRAY['schema_version','source','document','signers','fields'])
    OR m->'schema_version' NOT IN ('1'::jsonb,'2'::jsonb)
    OR (m->'schema_version'='1'::jsonb AND (m-ARRAY['schema_version','source','document','signers','fields'])<>'{}'::jsonb)
    OR (m->'schema_version'='2'::jsonb AND (
      NOT(m ? 'commercial') OR (m-ARRAY['schema_version','source','document','signers','fields','commercial'])<>'{}'::jsonb))
    OR pg_catalog.jsonb_typeof(m->'source') IS DISTINCT FROM 'object'
    OR ((m->'source')-ARRAY['tenant_id','agreement_id','client_id','version','updated_at'])<>'{}'::jsonb
    OR NOT((m->'source') ?& ARRAY['tenant_id','agreement_id','client_id','version','updated_at'])
    OR (m#>>'{source,tenant_id}')::uuid IS DISTINCT FROM _tenant OR (m#>>'{source,agreement_id}')::uuid IS DISTINCT FROM _agreement
    OR (m#>>'{source,client_id}')::uuid IS DISTINCT FROM _client OR (m#>>'{source,version}')::integer IS DISTINCT FROM _version
    OR (m#>>'{source,updated_at}')::timestamptz IS DISTINCT FROM _updated_at
    OR pg_catalog.jsonb_typeof(m->'document') IS DISTINCT FROM 'object'
    OR ((m->'document')-ARRAY['sha256','byte_length','pages'])<>'{}'::jsonb OR NOT((m->'document') ?& ARRAY['sha256','byte_length','pages'])
    OR coalesce(m#>>'{document,sha256}','') !~ '^[a-f0-9]{64}$'
    OR pg_catalog.jsonb_typeof(m#>'{document,byte_length}') IS DISTINCT FROM 'number'
    OR (m#>>'{document,byte_length}')::numeric NOT BETWEEN 5 AND 26214400
    OR (m#>>'{document,byte_length}')::numeric<>pg_catalog.trunc((m#>>'{document,byte_length}')::numeric)
    OR pg_catalog.jsonb_typeof(m#>'{document,pages}') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(m#>'{document,pages}') NOT BETWEEN 1 AND 250
    OR pg_catalog.jsonb_typeof(m->'signers') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(m->'signers')>100
    OR pg_catalog.jsonb_typeof(m->'fields') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(m->'fields')>500
    OR _storage_key IS NULL OR pg_catalog.split_part(_storage_key,'/',1)<>_tenant::text
    OR pg_catalog.split_part(_storage_key,'/',2)<>_agreement::text
    OR pg_catalog.array_length(pg_catalog.string_to_array(_storage_key,'/'),1)<>3
    OR pg_catalog.split_part(_storage_key,'/',3) !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,240}\.pdf$' THEN
    RAISE EXCEPTION 'Exact native preparation contract required' USING ERRCODE='22023'; END IF;

  -- Manifest1 and its historical digest behavior remain unchanged. Manifest2
  -- binds the original commercial payload and exact presented words to this
  -- SAME PDF/map/source; neither a checksum nor retention is approval.
  IF m->'schema_version'='2'::jsonb THEN
    commercial:=m->'commercial';
    IF pg_catalog.jsonb_typeof(commercial) IS DISTINCT FROM 'object'
      OR (commercial-ARRAY['payload','payload_digest','presented_body_markdown','presented_body_sha256'])<>'{}'::jsonb
      OR NOT(commercial ?& ARRAY['payload','payload_digest','presented_body_markdown','presented_body_sha256'])
      OR pg_catalog.jsonb_typeof(commercial->'payload') IS DISTINCT FROM 'object'
      OR commercial#>'{payload,schema_version}' IS DISTINCT FROM '2'::jsonb
      OR pg_catalog.jsonb_typeof(commercial->'payload_digest') IS DISTINCT FROM 'string'
      OR coalesce(commercial->>'payload_digest','') !~ '^[a-f0-9]{64}$'
      OR _commercial_payload_digest IS DISTINCT FROM commercial->>'payload_digest'
      OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        public._paige_commercial_canonical_json(commercial->'payload'),'UTF8')),'hex') IS DISTINCT FROM _commercial_payload_digest
      OR pg_catalog.jsonb_typeof(commercial->'presented_body_markdown') IS DISTINCT FROM 'string'
      OR pg_catalog.length(commercial->>'presented_body_markdown') NOT BETWEEN 1 AND 300000
      OR pg_catalog.jsonb_typeof(commercial->'presented_body_sha256') IS DISTINCT FROM 'string'
      OR coalesce(commercial->>'presented_body_sha256','') !~ '^[a-f0-9]{64}$'
      OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(commercial->>'presented_body_markdown','UTF8')),'hex')
        IS DISTINCT FROM commercial->>'presented_body_sha256' THEN
      RAISE EXCEPTION 'Exact commercial preparation contract required' USING ERRCODE='22023'; END IF;
    commercial_source:=commercial#>'{payload,source}';
    IF pg_catalog.jsonb_typeof(commercial_source) IS DISTINCT FROM 'object'
      OR commercial_source->>'tenant_id' IS DISTINCT FROM _tenant::text
      OR commercial_source->>'client_id' IS DISTINCT FROM _client::text
      OR commercial_source->>'agreement_id' IS DISTINCT FROM _agreement::text
      OR commercial_source->'agreement_version' IS DISTINCT FROM pg_catalog.to_jsonb(_version)
      OR (commercial_source->>'agreement_updated_at')::timestamptz IS DISTINCT FROM _updated_at THEN
      RAISE EXCEPTION 'Commercial preparation belongs to another source' USING ERRCODE='23514'; END IF;
  END IF;

  SELECT * INTO p FROM public.paige_agreement_document_preparations WHERE id=_request FOR UPDATE;
  IF FOUND THEN
    IF p.tenant_id<>_tenant OR p.agreement_id<>_agreement OR p.actor_user_id<>_actor OR p.client_id<>_client
      OR p.source_version<>_version OR p.source_updated_at<>_updated_at OR p.content_storage_key<>_storage_key
      OR p.manifest_canonical<>_manifest_canonical OR p.preparation_sha256<>_manifest_digest
      OR p.commercial_payload_digest IS DISTINCT FROM _commercial_payload_digest THEN
      RAISE EXCEPTION 'Preparation request does not match this recorded intent' USING ERRCODE='23514'; END IF;
    RETURN pg_catalog.jsonb_build_object('state','recorded','historical_receipt',true,'id',p.id,'event_id',p.event_id,
      'revision_no',p.revision_no,'document_sha256',p.document_sha256,'preparation_sha256',p.preparation_sha256,
      'is_selected',p.is_current,'replayed',true);
  END IF;
  IF a.contact_id IS DISTINCT FROM _client OR a.version IS DISTINCT FROM _version OR a.updated_at IS DISTINCT FROM _updated_at
    OR a.status<>'draft' OR a.content_storage_key IS NOT NULL OR a.content_sha256 IS NOT NULL
    OR a.sealed_storage_key IS NOT NULL OR a.sealed_sha256 IS NOT NULL OR a.commercial_presentation IS NOT NULL THEN
    RAISE EXCEPTION 'Agreement source changed or is already retained' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.paige_agreement_signers WHERE agreement_id=_agreement AND tenant_id=_tenant FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.paige_agreement_signers WHERE agreement_id=_agreement AND tenant_id=_tenant
    AND (status<>'pending' OR token_hash IS NOT NULL OR signed_at IS NOT NULL OR declined_at IS NOT NULL
      OR esign_consent_at IS NOT NULL OR esign_consent_slug IS NOT NULL OR esign_consent_version IS NOT NULL OR esign_consent_sha256 IS NOT NULL)) THEN
    RAISE EXCEPTION 'A signing request is already underway' USING ERRCODE='23514'; END IF;
  parties:=public._agreement_preparation_parties(_tenant,_agreement);
  IF parties IS DISTINCT FROM m->'signers' THEN RAISE EXCEPTION 'Agreement parties changed' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(m->'fields') f WHERE
    pg_catalog.jsonb_typeof(f) IS DISTINCT FROM 'object'
    OR (f-ARRAY['id','signer_id','kind','page','x','y','width','height','required','label'])<>'{}'::jsonb
    OR NOT(f ?& ARRAY['id','signer_id','kind','page','x','y','width','height','required','label'])
    OR f->>'kind' NOT IN ('signature','initials','signed_date','text','checkbox')
    OR NOT EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.id=(f->>'signer_id')::uuid AND s.agreement_id=_agreement AND s.tenant_id=_tenant))
    OR (SELECT count(DISTINCT (f->>'id')::uuid) FROM pg_catalog.jsonb_array_elements(m->'fields') f)<>pg_catalog.jsonb_array_length(m->'fields') THEN
    RAISE EXCEPTION 'Exact original signer field assignment required' USING ERRCODE='23514'; END IF;
  -- Original actor/source/party/token/CAS guards above remain authoritative.
  -- Validate current locked terms/invoice only for a NEW preparation intent.
  -- Exact recorded replays above are historical receipts, never fresh readiness.
  IF m->'schema_version'='2'::jsonb THEN
    PERFORM public._validate_paige_commercial_presentation(_actor,_tenant,
      commercial->'payload',_commercial_payload_digest,commercial->>'presented_body_markdown',
      commercial->>'presented_body_sha256',_storage_key,m#>>'{document,sha256}','owner_ui');
  END IF;
  SELECT id INTO current_id FROM public.paige_agreement_document_preparations
    WHERE agreement_id=_agreement AND tenant_id=_tenant AND is_current FOR UPDATE;
  IF current_id IS DISTINCT FROM _expected_current THEN RAISE EXCEPTION 'Selected preparation changed' USING ERRCODE='23514'; END IF;
  SELECT coalesce(pg_catalog.max(revision_no),0)+1 INTO revision FROM public.paige_agreement_document_preparations WHERE agreement_id=_agreement;
  UPDATE public.paige_agreement_document_preparations SET is_current=false WHERE id=current_id;
  INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,actor_user_id,detail)
    VALUES(_agreement,_tenant,'edited','owner',_actor,pg_catalog.jsonb_build_object('action','document_preparation_recorded',
      'preparation_id',_request,'preparation_sha256',_manifest_digest,'document_sha256',m#>>'{document,sha256}','source_version',_version)) RETURNING id INTO event;
  INSERT INTO public.paige_agreement_document_preparations(id,agreement_id,tenant_id,revision_no,client_id,source_version,source_updated_at,
    actor_user_id,content_storage_key,document_sha256,document_byte_length,manifest_canonical,preparation_sha256,commercial_payload_digest,event_id)
    VALUES(_request,_agreement,_tenant,revision,_client,_version,_updated_at,_actor,_storage_key,m#>>'{document,sha256}',
      (m#>>'{document,byte_length}')::integer,_manifest_canonical,_manifest_digest,_commercial_payload_digest,event);
  RETURN pg_catalog.jsonb_build_object('state','recorded','historical_receipt',true,'id',_request,'event_id',event,'revision_no',revision,
    'document_sha256',m#>>'{document,sha256}','preparation_sha256',_manifest_digest,'is_selected',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public._retain_agreement_document_preparation(uuid,uuid,uuid,uuid,integer,timestamptz,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._retain_agreement_document_preparation(uuid,uuid,uuid,uuid,integer,timestamptz,uuid,uuid,text,text,text,text) TO service_role;

COMMIT;
