-- ORIGINAL signing records and PDF sealer. No signature writer, approval,
-- token/effect-hold change, provider effect, backfill or new evidence store.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Preserve every original event type. A field-values fact is not another
-- signature: it must reference the actual original signature/consent receipts.
-- Stop on a changed check instead of overwriting another owner's extension.
DO $$
DECLARE definition text; original text;
BEGIN
 original := 'CHECK ((event_type = ANY (ARRAY[''created''::text, ''edited''::text, ''sent''::text, ''delivered''::text, ''viewed''::text, ''consented''::text, ''signed''::text, ''declined''::text, ''completed''::text, ''voided''::text, ''expired''::text, ''sealed''::text, ''downloaded''::text, ''resent''::text])))';
 SELECT pg_catalog.pg_get_constraintdef(oid) INTO definition FROM pg_catalog.pg_constraint
  WHERE conrelid='public.paige_agreement_events'::regclass AND conname='paige_agreement_events_event_type_check';
 IF definition IS DISTINCT FROM original
  AND definition IS DISTINCT FROM pg_catalog.replace(original,'''resent''::text','''resent''::text, ''field_values_recorded''::text') THEN
  RAISE EXCEPTION 'Original agreement event types changed; reconcile before applying';
 END IF;
 IF definition=original THEN
  ALTER TABLE public.paige_agreement_events DROP CONSTRAINT paige_agreement_events_event_type_check;
  ALTER TABLE public.paige_agreement_events ADD CONSTRAINT paige_agreement_events_event_type_check
   CHECK(event_type IN ('created','edited','sent','delivered','viewed','consented','signed','declined','completed','voided','expired','sealed','downloaded','resent','field_values_recorded'));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public._read_prepared_agreement_seal(_agreement uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 a public.paige_agreements%ROWTYPE;
 p public.paige_agreement_document_preparations%ROWTYPE;
 s public.paige_agreement_signers%ROWTYPE;
 m jsonb; source jsonb; input jsonb; f public.paige_agreement_events%ROWTYPE;
 signed_event public.paige_agreement_events%ROWTYPE;
 consent_event public.paige_agreement_events%ROWTYPE;
 inputs jsonb:='[]'::jsonb; signers jsonb:='[]'::jsonb;
 unavailable jsonb; receipt_count bigint;
BEGIN
 SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement FOR SHARE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('state','unavailable'); END IF;
 unavailable:=pg_catalog.jsonb_build_object('state','unavailable','agreement_id',a.id,'tenant_id',a.tenant_id);
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=a.id AND is_current FOR SHARE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.paige_agreement_document_preparations WHERE agreement_id=a.id) THEN RETURN unavailable; END IF;
  RETURN pg_catalog.jsonb_build_object('state','legacy','agreement_id',a.id,'tenant_id',a.tenant_id);
 END IF;
 IF a.status NOT IN ('sent','viewed','partially_signed')
  OR p.tenant_id IS DISTINCT FROM a.tenant_id OR p.client_id IS DISTINCT FROM a.contact_id
  OR p.source_version IS DISTINCT FROM a.version
  OR p.content_storage_key IS DISTINCT FROM a.content_storage_key
  OR p.document_sha256 IS DISTINCT FROM a.content_sha256
  OR p.preparation_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.manifest_canonical,'UTF8')),'hex') THEN RETURN unavailable; END IF;
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
  OR pg_catalog.jsonb_array_length(m->'signers') NOT BETWEEN 1 AND 100
  OR pg_catalog.jsonb_typeof(m->'fields') IS DISTINCT FROM 'array'
  OR (m->'schema_version'='1'::jsonb AND p.commercial_payload_digest IS NOT NULL)
  OR (m->'schema_version'='2'::jsonb AND
   (p.commercial_payload_digest IS NULL
    OR m#>>'{commercial,payload_digest}' IS DISTINCT FROM p.commercial_payload_digest
    OR a.commercial_presentation->>'payload_digest' IS DISTINCT FROM p.commercial_payload_digest)) THEN RETURN unavailable; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
  WHERE e.id=p.event_id AND e.tenant_id=a.tenant_id AND e.agreement_id=a.id
   AND e.event_type='edited' AND e.actor_kind='owner' AND e.actor_user_id=p.actor_user_id
   AND e.detail->>'action'='document_preparation_recorded'
   AND e.detail->>'preparation_id'=p.id::text
   AND e.detail->>'preparation_sha256'=p.preparation_sha256
   AND e.detail->>'document_sha256'=p.document_sha256
   AND e.detail->>'source_version'=p.source_version::text) THEN RETURN unavailable; END IF;

 FOR s IN SELECT * FROM public.paige_agreement_signers
  WHERE agreement_id=a.id ORDER BY signing_order,id FOR SHARE
 LOOP
  IF s.tenant_id IS DISTINCT FROM a.tenant_id OR s.status<>'signed' OR s.signed_at IS NULL
   OR s.esign_consent_at IS NULL OR s.esign_consent_at>s.signed_at
   OR p.created_at>s.signed_at OR s.esign_consent_slug IS NULL OR s.esign_consent_version IS NULL
   OR s.esign_consent_version<1 OR s.esign_consent_sha256 IS NULL
   OR s.esign_consent_sha256 !~ '^[a-f0-9]{64}$' OR pg_catalog.length(pg_catalog.btrim(coalesce(s.typed_name,'')))<2 THEN RETURN unavailable; END IF;
  SELECT count(*) INTO receipt_count FROM public.paige_agreement_events
   WHERE tenant_id=a.tenant_id AND agreement_id=a.id AND signer_id=s.id AND event_type='field_values_recorded';
  IF receipt_count<>1 THEN RETURN unavailable; END IF;
  SELECT * INTO f FROM public.paige_agreement_events
   WHERE tenant_id=a.tenant_id AND agreement_id=a.id AND signer_id=s.id AND event_type='field_values_recorded';
  SELECT * INTO signed_event FROM public.paige_agreement_events
   WHERE id=(f.detail->>'signed_event_id')::uuid AND tenant_id=a.tenant_id AND agreement_id=a.id AND signer_id=s.id;
  IF NOT FOUND THEN RETURN unavailable; END IF;
  SELECT * INTO consent_event FROM public.paige_agreement_events
   WHERE id=(f.detail->>'consented_event_id')::uuid AND tenant_id=a.tenant_id AND agreement_id=a.id AND signer_id=s.id;
  IF NOT FOUND THEN RETURN unavailable; END IF;
  IF signed_event.event_type<>'signed' OR consent_event.event_type<>'consented'
   OR signed_event.actor_kind<>'signer' OR consent_event.actor_kind<>'signer' OR f.actor_kind<>'signer'
   OR signed_event.actor_email IS DISTINCT FROM s.email OR consent_event.actor_email IS DISTINCT FROM s.email
   OR f.actor_email IS DISTINCT FROM s.email OR signed_event.id=consent_event.id
   OR signed_event.seq<=consent_event.seq OR f.seq<=signed_event.seq
   OR signed_event.created_at IS DISTINCT FROM s.signed_at
   OR consent_event.created_at IS DISTINCT FROM s.esign_consent_at OR f.created_at IS DISTINCT FROM s.signed_at
   OR signed_event.detail->>'signature_record_id' IS DISTINCT FROM s.id::text
   OR consent_event.detail->>'signature_record_id' IS DISTINCT FROM s.id::text
   OR signed_event.detail->>'document_sha256' IS DISTINCT FROM p.document_sha256
   OR consent_event.detail->>'document_sha256' IS DISTINCT FROM p.document_sha256
   OR signed_event.detail->>'document_version' IS DISTINCT FROM a.version::text
   OR consent_event.detail->>'document_version' IS DISTINCT FROM a.version::text THEN RETURN unavailable; END IF;
  input:=f.detail->'field_input';
  IF pg_catalog.jsonb_typeof(input) IS DISTINCT FROM 'object'
   OR input->'schema_version' IS DISTINCT FROM '1'::jsonb
   OR input->>'preparation_id' IS DISTINCT FROM p.id::text
   OR input->>'preparation_sha256' IS DISTINCT FROM p.preparation_sha256
   OR input->>'document_sha256' IS DISTINCT FROM p.document_sha256
   OR input->>'signer_id' IS DISTINCT FROM s.id::text
   OR (input->>'signed_at')::timestamptz IS DISTINCT FROM s.signed_at
   OR pg_catalog.jsonb_typeof(input->'values') IS DISTINCT FROM 'array'
   OR input->>'field_input_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    public._paige_commercial_canonical_json(input-'field_input_sha256'),'UTF8')),'hex') THEN RETURN unavailable; END IF;
  inputs:=inputs||pg_catalog.jsonb_build_array(input);
  -- Keep the exact recorded input's timestamp spelling AFTER native microsecond
  -- equality. Do not round it through JavaScript milliseconds for PDF stamping.
  signers:=signers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'id',s.id,'full_name',s.full_name,'email',s.email,'signer_role',s.signer_role,'signing_order',s.signing_order,
   'status',s.status,'typed_name',s.typed_name,'signed_at',input->'signed_at','esign_consent_at',s.esign_consent_at,
   'esign_consent_slug',s.esign_consent_slug,'esign_consent_version',s.esign_consent_version,
   'signing_ip',s.signing_ip,'signing_user_agent',s.signing_user_agent,'signature_image_png',s.signature_image_png));
 END LOOP;
 IF pg_catalog.jsonb_array_length(inputs)<>pg_catalog.jsonb_array_length(m->'signers') THEN RETURN unavailable; END IF;
 RETURN pg_catalog.jsonb_build_object('state','prepared','agreement_id',a.id,'tenant_id',a.tenant_id,
  'client_id',a.contact_id,'source_version',a.version,'document_sha256',p.document_sha256,'content_storage_key',p.content_storage_key,
  'prepared_fields',pg_catalog.jsonb_build_object('preparation_id',p.id,
   'preparation',pg_catalog.jsonb_build_object('manifest',m,'preparation_sha256',p.preparation_sha256,'ready_for_review',true,'issues','[]'::jsonb),
   'inputs',inputs),'signers',signers);
EXCEPTION WHEN data_exception THEN RETURN unavailable;
END $$;
REVOKE ALL ON FUNCTION public._read_prepared_agreement_seal(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_seal(uuid) TO service_role;
COMMENT ON FUNCTION public._read_prepared_agreement_seal(uuid) IS
 'EXP04 private original-sealer source read. Requires actual original signatures, consent receipts and atomically retained assigned-field facts. No approval/signature/send/payment authority. Missing old evidence is not reconstructed.';
COMMIT;
