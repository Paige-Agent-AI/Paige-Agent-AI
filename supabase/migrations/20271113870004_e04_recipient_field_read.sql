-- Original agreement/token/preparation records only. Ordinary recipient read;
-- no signing, consent, view event, token mint, send, approval or hold replacement.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public._read_agreement_signing_fields(_token_hash text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 initial public.paige_agreement_signers%ROWTYPE;
 s public.paige_agreement_signers%ROWTYPE;
 a public.paige_agreements%ROWTYPE;
 p public.paige_agreement_document_preparations%ROWTYPE;
 m jsonb; source jsonb; own_fields jsonb;
 at_time timestamptz;
BEGIN
 IF _token_hash IS NULL OR _token_hash !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO initial FROM public.paige_agreement_signers WHERE token_hash=_token_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501'; END IF;
 -- Match the original writer's parent-before-signer lock order. Revalidate the
 -- actual stored credential after the locks; a concurrent revocation must win.
 SELECT * INTO a FROM public.paige_agreements
  WHERE id=initial.agreement_id AND tenant_id=initial.tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.paige_agreement_signers
  WHERE id=initial.id AND agreement_id=a.id AND tenant_id=a.tenant_id FOR SHARE;
 at_time:=pg_catalog.clock_timestamp();
 IF NOT FOUND OR s.token_hash IS DISTINCT FROM _token_hash
  OR s.token_revoked_at IS NOT NULL OR s.token_expires_at IS NULL OR s.token_expires_at<=at_time
  OR s.status NOT IN ('pending','viewed') OR a.status NOT IN ('sent','viewed','partially_signed')
  OR (a.expires_at IS NOT NULL AND a.expires_at<=at_time)
  OR EXISTS(SELECT 1 FROM public.paige_agreement_signers earlier
   WHERE earlier.agreement_id=a.id AND earlier.tenant_id=a.tenant_id
    AND earlier.signing_order<s.signing_order AND earlier.status<>'signed') THEN
  RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501';
 END IF;

 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=a.id AND is_current FOR SHARE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.paige_agreement_document_preparations WHERE agreement_id=a.id) THEN
   RAISE EXCEPTION 'Assigned fields could not be verified' USING ERRCODE='23514';
  END IF;
  RETURN pg_catalog.jsonb_build_object('kind','legacy','tenant_id',a.tenant_id,'agreement_id',a.id,'signer_id',s.id);
 END IF;
 -- Reuse the original native canonical JSON and party identity constructor.
 -- A retained preparation is not current-source proof merely because it exists.
 IF p.tenant_id IS DISTINCT FROM a.tenant_id OR p.client_id IS DISTINCT FROM a.contact_id
  OR p.source_version IS DISTINCT FROM a.version
  OR p.content_storage_key IS DISTINCT FROM a.content_storage_key
  OR p.document_sha256 IS DISTINCT FROM a.content_sha256
  OR p.preparation_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.manifest_canonical,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Assigned fields could not be verified' USING ERRCODE='23514';
 END IF;
 m:=p.manifest_canonical::jsonb; source:=m->'source';
 IF pg_catalog.jsonb_typeof(m) IS DISTINCT FROM 'object'
  OR p.manifest_canonical IS DISTINCT FROM public._paige_commercial_canonical_json(m)
  OR (m->'schema_version' IS DISTINCT FROM '1'::jsonb AND m->'schema_version' IS DISTINCT FROM '2'::jsonb)
  OR source->>'tenant_id' IS DISTINCT FROM a.tenant_id::text
  OR source->>'agreement_id' IS DISTINCT FROM a.id::text
  OR source->>'client_id' IS DISTINCT FROM a.contact_id::text
  OR (source->>'version')::integer IS DISTINCT FROM p.source_version
  OR (source->>'updated_at')::timestamptz IS DISTINCT FROM p.source_updated_at
  OR m#>>'{document,sha256}' IS DISTINCT FROM p.document_sha256
  OR (m#>>'{document,byte_length}')::integer IS DISTINCT FROM p.document_byte_length
  OR m->'signers' IS DISTINCT FROM public._agreement_preparation_parties(a.tenant_id,a.id)
  OR pg_catalog.jsonb_typeof(m->'signers') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(m->'signers') NOT BETWEEN 1 AND 100
  OR pg_catalog.jsonb_typeof(m->'fields') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(m->'fields') NOT BETWEEN 1 AND 500
  OR (m->'schema_version'='1'::jsonb AND p.commercial_payload_digest IS NOT NULL)
  OR (m->'schema_version'='2'::jsonb AND
   (p.commercial_payload_digest IS NULL
    OR m#>>'{commercial,payload_digest}' IS DISTINCT FROM p.commercial_payload_digest
    OR a.commercial_presentation->>'payload_digest' IS DISTINCT FROM p.commercial_payload_digest)) THEN
  RAISE EXCEPTION 'Assigned fields could not be verified' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
  WHERE e.id=p.event_id AND e.tenant_id=a.tenant_id AND e.agreement_id=a.id
   AND e.event_type='edited' AND e.actor_kind='owner' AND e.actor_user_id=p.actor_user_id
   AND e.detail->>'action'='document_preparation_recorded'
   AND e.detail->>'preparation_id'=p.id::text
   AND e.detail->>'preparation_sha256'=p.preparation_sha256
   AND e.detail->>'document_sha256'=p.document_sha256
   AND e.detail->>'source_version'=p.source_version::text) THEN
  RAISE EXCEPTION 'Assigned fields could not be verified' USING ERRCODE='23514';
 END IF;

 -- Closed per-recipient field projection: no other signer's identity, mark,
 -- field or answer. The source key below remains inside this service-only
 -- boundary for the original handler's document check; its public reply omits it.
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'id',f->'id','kind',f->'kind','page',f->'page','x',f->'x','y',f->'y',
  'width',f->'width','height',f->'height','required',f->'required','label',f->'label') ORDER BY ordinal),'[]'::jsonb)
 INTO own_fields FROM pg_catalog.jsonb_array_elements(m->'fields') WITH ORDINALITY AS fields(f,ordinal)
 WHERE f->>'signer_id'=s.id::text;
 IF pg_catalog.jsonb_array_length(own_fields)<1
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(own_fields) f WHERE f->>'kind'='signature') THEN
  RAISE EXCEPTION 'Assigned fields could not be verified' USING ERRCODE='23514';
 END IF;
 RETURN pg_catalog.jsonb_build_object('kind','prepared','tenant_id',a.tenant_id,'agreement_id',a.id,'signer_id',s.id,
  'source_version',a.version,'content_storage_key',p.content_storage_key,
  'preparation_id',p.id,'preparation_sha256',p.preparation_sha256,'document',m->'document','fields',own_fields);
EXCEPTION WHEN data_exception THEN
 RAISE EXCEPTION 'Assigned fields could not be verified' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public._read_agreement_signing_fields(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._read_agreement_signing_fields(text) TO service_role;
COMMENT ON FUNCTION public._read_agreement_signing_fields(text) IS
 'Original token-derived private assigned-field read. Existing signer/document/preparation/event identity only; no consent/signature/view/send/payment write or prepared-hold release. Missing evidence is unavailable, never inferred legacy authority.';
COMMIT;
