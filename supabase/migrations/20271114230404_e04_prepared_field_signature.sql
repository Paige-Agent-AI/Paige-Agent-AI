-- LOCAL WORK IN PROGRESS: canonical prepared-field/signature extension.
-- This calculation alone is not signature, consent, approval or actor evidence.
-- The complete original writer and native fences must consume it atomically.
BEGIN;
SET LOCAL lock_timeout='3s';

DO $guard$
DECLARE expected record; actual pg_catalog.pg_proc%ROWTYPE; original_owner oid;
BEGIN
 SELECT proowner INTO original_owner FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public._read_agreement_signing_fields(text)');
 IF NOT FOUND THEN RAISE EXCEPTION 'Original prepared signing source changed' USING ERRCODE='23514'; END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('public._read_agreement_signing_fields(text)','db2c56efd37ecb7c31b720909d581fbb','db2c56efd37ecb7c31b720909d581fbb',true,true,true,'jsonb',ARRAY['_token_hash']::text[]),
  ('public._read_prepared_agreement_seal(uuid)','04dc664b0bba6330167736fbaafe765a','04dc664b0bba6330167736fbaafe765a',true,true,true,'jsonb',ARRAY['_agreement']::text[]),
  ('public._paige_commercial_canonical_json(jsonb)','bbfeef876dc866c6d276d2be2662ae74','bbfeef876dc866c6d276d2be2662ae74',true,false,false,'text',ARRAY['v']::text[]),
  ('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)','3a2fa340fca9838aa9c6737f1e41ae61','d7e9d5d48b46d1b61b3aa30d33b876d4',true,false,true,'jsonb',ARRAY['_token_hash','_agreement_version','_content_sha256','_content_storage_key','_typed_name','_signature_image_png','_consent_read','_consent_esign','_consent_slug','_consent_version','_consent_sha256','_ip','_user_agent']::text[]),
  ('public._paige_preparation_legacy_token_hold()','46c36eb38a54080388b25f7ff315d0b9','fe9a5356e594dce069eaeb1e44de14c9',true,true,false,'trigger',NULL::text[]),
  ('public._paige_preparation_legacy_effect_hold()','b4581030968e238115700a14da16f9b7','c5eb4550df13b24f732ed190229e7fdc',true,true,false,'trigger',NULL::text[]),
  ('private.e04_prepared_field_input(jsonb,uuid,timestamp with time zone,jsonb)',NULL,'0568b3cb5ed0d32bdc326c37d76aebaa',false,true,true,'jsonb',ARRAY['_source','_signer','_at','_proposed']::text[]),
  ('private.e04_prepared_signed_fields(public.paige_agreement_signers)',NULL,'0d363d0a4d071c265bbd1526d3dcec6d',false,true,true,'boolean',ARRAY['_candidate']::text[]),
  ('private.e04_prepared_signature_context(public.paige_agreement_signers)',NULL,'f149482a79d4b19b60b536aa90c6aaea',false,true,true,'jsonb',ARRAY['_candidate']::text[]),
  ('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text,jsonb)',NULL,'03cac431afd80024397110bc7d5038b7',false,false,true,'jsonb',ARRAY['_token_hash','_agreement_version','_content_sha256','_content_storage_key','_typed_name','_signature_image_png','_consent_read','_consent_esign','_consent_slug','_consent_version','_consent_sha256','_ip','_user_agent','_prepared_fields']::text[]),
  ('private.e04_prepared_completion_record(public.paige_agreements)',NULL,'a8d323fdfeea6a5654dcf8863ae9f249',false,true,false,'jsonb',ARRAY['_candidate']::text[]),
  ('public._complete_prepared_agreement_seal(uuid,uuid,text,text,text)',NULL,'2c796531b75aa8c618eefe8bd56bdca6',false,true,true,'jsonb',ARRAY['_tenant','_agreement','_source_sha256','_sealed_storage_key','_sealed_sha256']::text[])
 ) AS checks(identity,old_body,own_body,required,definer,service,result_type,argument_names) LOOP
  SELECT * INTO actual FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(expected.identity);
  IF NOT FOUND THEN
   IF expected.required THEN RAISE EXCEPTION 'Original prepared signing source changed' USING ERRCODE='23514'; END IF;
   CONTINUE;
  END IF;
  IF (pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.own_body
    AND (expected.old_body IS NULL OR pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.old_body))
   OR actual.proowner IS DISTINCT FROM original_owner OR actual.prosecdef IS DISTINCT FROM expected.definer
   OR actual.pronargdefaults<>0 OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR actual.proargnames IS DISTINCT FROM expected.argument_names
   OR actual.prorettype IS DISTINCT FROM pg_catalog.to_regtype(expected.result_type)
   OR actual.proleakproof OR actual.proisstrict
   OR pg_catalog.has_function_privilege('anon',actual.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('authenticated',actual.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('service_role',actual.oid,'EXECUTE') IS DISTINCT FROM expected.service
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(actual.proacl,pg_catalog.acldefault('f',actual.proowner))) acl
    WHERE acl.privilege_type='EXECUTE' AND acl.grantee NOT IN (original_owner,'service_role'::regrole::oid)) THEN
   RAISE EXCEPTION 'Original prepared signing source changed' USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('public.paige_agreements','trg_paige_preparation_legacy_effect_hold','public._paige_preparation_legacy_effect_hold()',ARRAY['status','content_storage_key','content_sha256','sealed_storage_key','sealed_sha256']::text[]),
  ('public.paige_agreement_signers','trg_paige_preparation_legacy_token_hold','public._paige_preparation_legacy_token_hold()',ARRAY['token_hash','token_expires_at','token_revoked_at','status']::text[])
 ) AS checks(relation,trigger_name,function_name,columns) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass(expected.relation)
   AND t.tgname=expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=19 AND t.tgnargs=0
   AND t.tgqual IS NULL AND t.tgfoid=pg_catalog.to_regprocedure(expected.function_name)
   AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY item.ordinality)
     FROM pg_catalog.unnest(t.tgattr::smallint[]) WITH ORDINALITY item(attribute,ordinality)
     JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=item.attribute) IS NOT DISTINCT FROM expected.columns) THEN
   RAISE EXCEPTION 'Original prepared signing fence changed' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION private.e04_prepared_field_input(
 _source jsonb,_signer uuid,_at timestamptz,_proposed jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE answer jsonb; field jsonb; value jsonb; field_id text; kind text; code integer;
 seen text[]:='{}'::text[]; normalized jsonb:='[]'::jsonb; own_ids text[]:='{}'::text[];
 signed_at text; result jsonb; trim_chars text:=''; controls text:=''; text_controls text;
BEGIN
 -- Same code-point sets as the incumbent pure TypeScript validator, with
 -- linear native string operations rather than a quadratic UTF-8 substring loop.
 FOREACH code IN ARRAY ARRAY[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279] LOOP
  trim_chars:=trim_chars||pg_catalog.chr(code);
 END LOOP;
 FOR code IN 1..31 LOOP controls:=controls||pg_catalog.chr(code); END LOOP;
 controls:=controls||pg_catalog.chr(127);
 text_controls:=pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(controls,pg_catalog.chr(9),''),pg_catalog.chr(10),''),pg_catalog.chr(13),'');
 IF _signer IS NULL OR _at IS NULL OR NOT pg_catalog.isfinite(_at)
  OR pg_catalog.jsonb_typeof(_source) IS DISTINCT FROM 'object'
  OR _source->>'kind' IS DISTINCT FROM 'prepared'
  OR _source->>'signer_id' IS DISTINCT FROM _signer::text
  OR coalesce(_source->>'preparation_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR coalesce(_source->>'preparation_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(_source#>>'{document,sha256}','') !~ '^[a-f0-9]{64}$'
  OR pg_catalog.jsonb_typeof(_source->'fields') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(_source->'fields') NOT BETWEEN 1 AND 500
  OR pg_catalog.jsonb_typeof(_proposed) IS DISTINCT FROM 'object'
  OR (_proposed-ARRAY['preparation_id','preparation_sha256','values'])<>'{}'::jsonb
  OR NOT(_proposed ?& ARRAY['preparation_id','preparation_sha256','values'])
  OR _proposed->>'preparation_id' IS DISTINCT FROM _source->>'preparation_id'
  OR _proposed->>'preparation_sha256' IS DISTINCT FROM _source->>'preparation_sha256'
  OR pg_catalog.jsonb_typeof(_proposed->'values') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(_proposed->'values')>500
  OR pg_catalog.octet_length(pg_catalog.convert_to(public._paige_commercial_canonical_json(_proposed->'values'),'UTF8'))>524288 THEN
  RAISE EXCEPTION 'Prepared field input is not valid' USING ERRCODE='23514'; END IF;

 -- The caller resolves this projection from ORIGINAL native token/preparation
 -- authority under the original parent/signer locks. This pure calculation
 -- cannot establish authority from an arbitrary client-supplied projection.
 FOR field IN SELECT entry.value FROM pg_catalog.jsonb_array_elements(_source->'fields') entry(value) LOOP
  IF pg_catalog.jsonb_typeof(field) IS DISTINCT FROM 'object'
   OR coalesce(field->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR field->>'id'=ANY(own_ids) OR coalesce(field->>'kind','') NOT IN ('signature','initials','signed_date','text','checkbox')
   OR pg_catalog.jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Prepared field source is not valid' USING ERRCODE='23514'; END IF;
  own_ids:=pg_catalog.array_append(own_ids,field->>'id');
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(_source->'fields') entry(value)
  WHERE entry.value->>'kind'='signature' AND entry.value->'required'='true'::jsonb) THEN
  RAISE EXCEPTION 'Original required signature field is missing' USING ERRCODE='23514'; END IF;
 FOR answer IN SELECT entry.value FROM pg_catalog.jsonb_array_elements(_proposed->'values') entry(value) LOOP
  IF pg_catalog.jsonb_typeof(answer) IS DISTINCT FROM 'object'
   OR (answer-ARRAY['field_id','value'])<>'{}'::jsonb OR NOT(answer ?& ARRAY['field_id','value'])
   OR pg_catalog.jsonb_typeof(answer->'field_id') IS DISTINCT FROM 'string'
   OR answer->>'field_id'=ANY(seen) THEN
   RAISE EXCEPTION 'Prepared field input is not valid' USING ERRCODE='23514'; END IF;
  field_id:=answer->>'field_id';
  SELECT entry.value INTO field FROM pg_catalog.jsonb_array_elements(_source->'fields') entry(value)
   WHERE entry.value->>'id'=field_id;
  IF NOT FOUND OR field->>'kind'='signed_date' THEN
   RAISE EXCEPTION 'Prepared field input is not assigned to this signer' USING ERRCODE='23514'; END IF;
  kind:=field->>'kind';value:=answer->'value';
  IF kind='signature' THEN
   IF value IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Explicit original signature is required' USING ERRCODE='23514'; END IF;
  ELSIF kind='checkbox' THEN
   IF pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Checkbox field value is required' USING ERRCODE='23514'; END IF;
  ELSE
   IF pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'string'
    OR ((field->>'required')::boolean AND pg_catalog.btrim(value#>>'{}',trim_chars)='') THEN
    RAISE EXCEPTION 'Text field value is required' USING ERRCODE='23514'; END IF;
   IF pg_catalog.translate(value#>>'{}',CASE WHEN kind='text' THEN text_controls ELSE controls END,'') IS DISTINCT FROM value#>>'{}' THEN
    RAISE EXCEPTION 'Field contains unsupported control characters' USING ERRCODE='23514'; END IF;
  END IF;
  seen:=pg_catalog.array_append(seen,field_id);
 END LOOP;
 signed_at:=pg_catalog.to_char(_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 FOR field IN SELECT entry.value FROM pg_catalog.jsonb_array_elements(_source->'fields') entry(value) LOOP
  field_id:=field->>'id';kind:=field->>'kind';
  IF kind='signed_date' THEN value:=pg_catalog.to_jsonb(signed_at);
  ELSE
   SELECT entry.value->'value' INTO value FROM pg_catalog.jsonb_array_elements(_proposed->'values') entry(value)
    WHERE entry.value->>'field_id'=field_id;
   IF NOT FOUND THEN
    IF (field->>'required')::boolean THEN
     RAISE EXCEPTION 'A required assigned field is missing' USING ERRCODE='23514'; END IF;
    CONTINUE;
   END IF;
  END IF;
  normalized:=normalized||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field_id',field_id,'kind',kind,'value',value));
 END LOOP;
 result:=pg_catalog.jsonb_build_object('schema_version',1,'preparation_id',_source->'preparation_id',
  'preparation_sha256',_source->'preparation_sha256','document_sha256',_source#>'{document,sha256}',
  'signer_id',_signer,'signed_at',signed_at,'values',normalized);
 RETURN result||pg_catalog.jsonb_build_object('field_input_sha256',pg_catalog.encode(pg_catalog.sha256(
  pg_catalog.convert_to(public._paige_commercial_canonical_json(result),'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_field_input(jsonb,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.e04_prepared_field_input(jsonb,uuid,timestamptz,jsonb) TO service_role;

-- Read the SAME original signed row, consent/signature pair and field event.
-- A BEFORE trigger may pass its exact proposed NEW row; all immutable source
-- and original event identities still come from their canonical tables.
CREATE OR REPLACE FUNCTION private.e04_prepared_signed_fields(_candidate public.paige_agreement_signers)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
 f public.paige_agreement_events%ROWTYPE; se public.paige_agreement_events%ROWTYPE; ce public.paige_agreement_events%ROWTYPE;
 source jsonb; answers jsonb; expected jsonb; input jsonb; n integer;
BEGIN
 IF _candidate.id IS NULL OR _candidate.status IS DISTINCT FROM 'signed' OR _candidate.signed_at IS NULL
  OR _candidate.esign_consent_at IS DISTINCT FROM _candidate.signed_at
  OR pg_catalog.length(pg_catalog.btrim(coalesce(_candidate.typed_name,''))) NOT BETWEEN 2 AND 200
  OR coalesce(_candidate.esign_consent_sha256,'') !~ '^[a-f0-9]{64}$'
  OR _candidate.esign_consent_slug IS NULL OR _candidate.esign_consent_version IS NULL
  OR _candidate.esign_consent_version<1 THEN RETURN false; END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=_candidate.agreement_id AND tenant_id=_candidate.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=a.id AND tenant_id=a.tenant_id AND is_current;
 IF NOT FOUND OR p.client_id IS DISTINCT FROM a.contact_id OR p.source_version IS DISTINCT FROM a.version
  OR p.content_storage_key IS DISTINCT FROM a.content_storage_key OR p.document_sha256 IS DISTINCT FROM a.content_sha256
  OR p.preparation_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.manifest_canonical,'UTF8')),'hex')
  OR p.manifest_canonical IS DISTINCT FROM public._paige_commercial_canonical_json(p.manifest_canonical::jsonb)
  OR p.manifest_canonical::jsonb#>>'{source,tenant_id}' IS DISTINCT FROM a.tenant_id::text
  OR p.manifest_canonical::jsonb#>>'{source,agreement_id}' IS DISTINCT FROM a.id::text
  OR p.manifest_canonical::jsonb#>>'{source,client_id}' IS DISTINCT FROM a.contact_id::text
  OR (p.manifest_canonical::jsonb#>>'{source,version}')::integer IS DISTINCT FROM p.source_version
  OR (p.manifest_canonical::jsonb#>>'{source,updated_at}')::timestamptz IS DISTINCT FROM p.source_updated_at
  OR p.manifest_canonical::jsonb#>>'{document,sha256}' IS DISTINCT FROM p.document_sha256
  OR (p.manifest_canonical::jsonb#>>'{document,byte_length}')::integer IS DISTINCT FROM p.document_byte_length
  OR p.manifest_canonical::jsonb->'signers' IS DISTINCT FROM public._agreement_preparation_parties(a.tenant_id,a.id)
  OR p.created_at>_candidate.signed_at THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e WHERE e.id=p.event_id
  AND e.tenant_id=a.tenant_id AND e.agreement_id=a.id AND e.event_type='edited'
  AND e.actor_kind='owner' AND e.actor_user_id=p.actor_user_id
  AND e.detail->>'action'='document_preparation_recorded'
  AND e.detail->>'preparation_id'=p.id::text AND e.detail->>'preparation_sha256'=p.preparation_sha256
  AND e.detail->>'document_sha256'=p.document_sha256 AND e.detail->>'source_version'=p.source_version::text) THEN RETURN false; END IF;
 SELECT count(*) INTO n FROM public.paige_agreement_events
  WHERE agreement_id=a.id AND tenant_id=a.tenant_id AND signer_id=_candidate.id AND event_type='field_values_recorded';
 IF n<>1 THEN RETURN false; END IF;
 SELECT * INTO f FROM public.paige_agreement_events
  WHERE agreement_id=a.id AND tenant_id=a.tenant_id AND signer_id=_candidate.id AND event_type='field_values_recorded';
 IF pg_catalog.jsonb_typeof(f.detail) IS DISTINCT FROM 'object'
  OR (f.detail-ARRAY['field_input','consented_event_id','signed_event_id'])<>'{}'::jsonb
  OR NOT(f.detail ?& ARRAY['field_input','consented_event_id','signed_event_id']) THEN RETURN false; END IF;
 SELECT * INTO ce FROM public.paige_agreement_events WHERE id=(f.detail->>'consented_event_id')::uuid
  AND agreement_id=a.id AND tenant_id=a.tenant_id AND signer_id=_candidate.id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO se FROM public.paige_agreement_events WHERE id=(f.detail->>'signed_event_id')::uuid
  AND agreement_id=a.id AND tenant_id=a.tenant_id AND signer_id=_candidate.id;
 IF NOT FOUND OR ce.event_type IS DISTINCT FROM 'consented' OR se.event_type IS DISTINCT FROM 'signed'
  OR ce.actor_kind IS DISTINCT FROM 'signer' OR se.actor_kind IS DISTINCT FROM 'signer' OR f.actor_kind IS DISTINCT FROM 'signer'
  OR ce.actor_email IS DISTINCT FROM _candidate.email OR se.actor_email IS DISTINCT FROM _candidate.email OR f.actor_email IS DISTINCT FROM _candidate.email
  OR ce.id=se.id OR se.seq<=ce.seq OR f.seq<=se.seq
  OR ce.created_at IS DISTINCT FROM _candidate.esign_consent_at OR se.created_at IS DISTINCT FROM _candidate.signed_at
  OR f.created_at IS DISTINCT FROM _candidate.signed_at
  OR ce.ip IS DISTINCT FROM _candidate.signing_ip OR se.ip IS DISTINCT FROM _candidate.signing_ip OR f.ip IS DISTINCT FROM _candidate.signing_ip
  OR ce.user_agent IS DISTINCT FROM _candidate.signing_user_agent OR se.user_agent IS DISTINCT FROM _candidate.signing_user_agent OR f.user_agent IS DISTINCT FROM _candidate.signing_user_agent
  OR ce.detail->>'signature_record_id' IS DISTINCT FROM _candidate.id::text OR se.detail->>'signature_record_id' IS DISTINCT FROM _candidate.id::text
  OR ce.detail->>'document_version' IS DISTINCT FROM a.version::text OR se.detail->>'document_version' IS DISTINCT FROM a.version::text
  OR ce.detail->>'document_sha256' IS DISTINCT FROM p.document_sha256 OR se.detail->>'document_sha256' IS DISTINCT FROM p.document_sha256 THEN RETURN false; END IF;
 input:=f.detail->'field_input';
 IF pg_catalog.jsonb_typeof(input) IS DISTINCT FROM 'object'
  OR pg_catalog.jsonb_typeof(input->'values') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('field_id',entry.value->'field_id','value',entry.value->'value') ORDER BY entry.ordinal),'[]'::jsonb)
 INTO answers FROM pg_catalog.jsonb_array_elements(input->'values') WITH ORDINALITY entry(value,ordinal)
 WHERE entry.value->>'kind'<>'signed_date';
 source:=pg_catalog.jsonb_build_object('kind','prepared','signer_id',_candidate.id,'preparation_id',p.id,
  'preparation_sha256',p.preparation_sha256,'document',p.manifest_canonical::jsonb->'document',
  'fields',(SELECT pg_catalog.jsonb_agg(entry.value ORDER BY entry.ordinal)
   FROM pg_catalog.jsonb_array_elements(p.manifest_canonical::jsonb->'fields') WITH ORDINALITY entry(value,ordinal)
   WHERE entry.value->>'signer_id'=_candidate.id::text));
 expected:=private.e04_prepared_field_input(source,_candidate.id,_candidate.signed_at,
  pg_catalog.jsonb_build_object('preparation_id',p.id,'preparation_sha256',p.preparation_sha256,'values',answers));
 RETURN expected IS NOT DISTINCT FROM input;
EXCEPTION WHEN data_exception OR check_violation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_signed_fields(public.paige_agreement_signers) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.e04_prepared_signed_fields(public.paige_agreement_signers) TO service_role;

-- The original preparation table deliberately has NO direct service-role
-- SELECT or write grant. Preserve that boundary: pending recipients reuse the
-- original token-derived reader; returning signatures use original event facts.
CREATE OR REPLACE FUNCTION private.e04_prepared_signature_context(_candidate public.paige_agreement_signers)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.paige_agreement_signers%ROWTYPE; a public.paige_agreements%ROWTYPE;
 p public.paige_agreement_document_preparations%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.paige_agreement_signers WHERE id=_candidate.id
  AND agreement_id=_candidate.agreement_id AND tenant_id=_candidate.tenant_id;
 IF NOT FOUND OR pg_catalog.to_jsonb(s) IS DISTINCT FROM pg_catalog.to_jsonb(_candidate)
  OR s.token_hash IS NULL OR s.token_revoked_at IS NOT NULL OR s.token_expires_at IS NULL
  OR s.token_expires_at<=pg_catalog.clock_timestamp() THEN
  RAISE EXCEPTION 'Original signing record is unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=s.agreement_id AND tenant_id=s.tenant_id;
 IF NOT FOUND OR s.status NOT IN ('pending','viewed','signed') OR a.status NOT IN ('sent','viewed','partially_signed','completed')
  OR (a.status<>'completed' AND a.expires_at IS NOT NULL AND a.expires_at<=pg_catalog.clock_timestamp()) THEN
  RAISE EXCEPTION 'Original signing record is unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=a.id AND tenant_id=a.tenant_id AND is_current FOR SHARE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.paige_agreement_document_preparations WHERE agreement_id=a.id) THEN
   RAISE EXCEPTION 'Original prepared source is unavailable' USING ERRCODE='23514'; END IF;
  RETURN pg_catalog.jsonb_build_object('kind','legacy','tenant_id',a.tenant_id,'agreement_id',a.id,'signer_id',s.id);
 END IF;
 -- Pending prepared records disclose only the kind here. The canonical writer
 -- first preserves ALL original consent/document/order refusal semantics, then
 -- calls the incumbent token-derived reader immediately before the actual act.
 IF s.status IN ('pending','viewed') THEN RETURN pg_catalog.jsonb_build_object('kind','prepared'); END IF;
 IF NOT private.e04_prepared_signed_fields(s) THEN
  RAISE EXCEPTION 'Original prepared signature evidence is unavailable' USING ERRCODE='23514'; END IF;
 RETURN pg_catalog.jsonb_build_object('kind','prepared','tenant_id',a.tenant_id,'agreement_id',a.id,'signer_id',s.id,
  'source_version',a.version,'content_storage_key',p.content_storage_key,'preparation_id',p.id,
  'preparation_sha256',p.preparation_sha256,'document',p.manifest_canonical::jsonb->'document',
  'fields',(SELECT pg_catalog.jsonb_agg(entry.value ORDER BY entry.ordinal)
   FROM pg_catalog.jsonb_array_elements(p.manifest_canonical::jsonb->'fields') WITH ORDINALITY entry(value,ordinal)
   WHERE entry.value->>'signer_id'=s.id::text));
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_signature_context(public.paige_agreement_signers) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.e04_prepared_signature_context(public.paige_agreement_signers) TO service_role;

CREATE OR REPLACE FUNCTION public._record_agreement_signature(
  _token_hash text,_agreement_version integer,_content_sha256 text,_content_storage_key text,
  _typed_name text,_signature_image_png text,_consent_read boolean,_consent_esign boolean,
  _consent_slug text,_consent_version integer,_consent_sha256 text,_ip inet,_user_agent text,_prepared_fields jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  initial public.paige_agreement_signers%ROWTYPE;
  signer public.paige_agreement_signers%ROWTYPE;
  agreement public.paige_agreements%ROWTYPE;
  act_at timestamptz;
  consent_event uuid;
  signature_event uuid;
  remaining bigint;
  event_detail jsonb;
  prepared_source jsonb; field_input jsonb; field_event uuid;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501';
  END IF;
  -- Resolve original identity from the credential. Never accept tenant/signer IDs.
  SELECT * INTO initial FROM public.paige_agreement_signers WHERE token_hash=_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501'; END IF;

  -- Short native transaction only: no file/provider work while holding these locks.
  -- Same parent serializes signature progress with original void/expiry updates.
  SELECT * INTO agreement FROM public.paige_agreements
    WHERE id=initial.agreement_id AND tenant_id=initial.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501'; END IF;
  SELECT * INTO signer FROM public.paige_agreement_signers
    WHERE id=initial.id AND agreement_id=agreement.id AND tenant_id=agreement.tenant_id FOR UPDATE;
  act_at:=pg_catalog.clock_timestamp();
  IF NOT FOUND OR signer.token_hash IS DISTINCT FROM _token_hash
    OR signer.token_revoked_at IS NOT NULL OR signer.token_expires_at IS NULL
    OR signer.token_expires_at<=act_at THEN
    RAISE EXCEPTION 'Signing credential is not usable' USING ERRCODE='42501';
  END IF;
  IF agreement.status NOT IN ('sent','viewed','partially_signed','completed')
    OR (agreement.status<>'completed' AND agreement.expires_at IS NOT NULL AND agreement.expires_at<=act_at) THEN
    RAISE EXCEPTION 'Agreement cannot be signed in its current state' USING ERRCODE='23514';
  END IF;

  prepared_source:=private.e04_prepared_signature_context(signer);
  IF prepared_source->>'kind'='legacy' AND _prepared_fields IS NOT NULL THEN
    RAISE EXCEPTION 'Assigned fields do not belong to a legacy agreement' USING ERRCODE='23514'; END IF;
  IF signer.status='signed' THEN
    IF prepared_source->>'kind'='prepared' THEN
      IF NOT private.e04_prepared_signed_fields(signer) THEN
        RAISE EXCEPTION 'Original prepared signature evidence is unavailable' USING ERRCODE='23514'; END IF;
      IF _prepared_fields IS NOT NULL THEN
        field_input:=private.e04_prepared_field_input(prepared_source,signer.id,signer.signed_at,_prepared_fields);
        IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e WHERE e.agreement_id=agreement.id AND e.tenant_id=agreement.tenant_id
          AND e.signer_id=signer.id AND e.event_type='field_values_recorded' AND e.detail->'field_input'=field_input) THEN
          RAISE EXCEPTION 'Recorded field answers cannot be replaced' USING ERRCODE='23514'; END IF;
      END IF;
    END IF;
    -- Read actual retained evidence. Never retroactively invent missing old events.
    SELECT id INTO consent_event FROM public.paige_agreement_events
      WHERE agreement_id=agreement.id AND tenant_id=agreement.tenant_id AND signer_id=signer.id
        AND event_type='consented' AND actor_kind='signer' ORDER BY seq LIMIT 1;
    SELECT id INTO signature_event FROM public.paige_agreement_events
      WHERE agreement_id=agreement.id AND tenant_id=agreement.tenant_id AND signer_id=signer.id
        AND event_type='signed' AND actor_kind='signer' ORDER BY seq LIMIT 1;
  ELSE
    IF signer.status NOT IN ('pending','viewed') OR agreement.status='completed' THEN
      RAISE EXCEPTION 'Agreement cannot be signed in its current state' USING ERRCODE='23514';
    END IF;
    IF agreement.version IS DISTINCT FROM _agreement_version
      OR agreement.content_sha256 IS DISTINCT FROM _content_sha256
      OR agreement.content_storage_key IS DISTINCT FROM _content_storage_key
      OR _content_sha256 IS NULL OR _content_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Retained presentation changed before signing' USING ERRCODE='23514';
    END IF;
    IF _consent_read IS DISTINCT FROM true OR _consent_esign IS DISTINCT FROM true
      OR pg_catalog.length(pg_catalog.btrim(coalesce(_typed_name,''))) NOT BETWEEN 2 AND 200
      OR pg_catalog.length(coalesce(_typed_name,''))>200
      OR pg_catalog.length(pg_catalog.btrim(coalesce(_consent_slug,''))) NOT BETWEEN 1 AND 100
      OR _consent_version IS NULL OR _consent_version<1
      OR _consent_sha256 IS NULL OR _consent_sha256 !~ '^[a-f0-9]{64}$'
      OR pg_catalog.length(coalesce(_signature_image_png,''))>400000 THEN
      RAISE EXCEPTION 'Explicit signature and consent evidence is required' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.paige_agreement_signers earlier
      WHERE earlier.agreement_id=agreement.id AND earlier.tenant_id=agreement.tenant_id
        AND earlier.signing_order<signer.signing_order AND earlier.status<>'signed') THEN
      RAISE EXCEPTION 'Earlier signatures are still outstanding' USING ERRCODE='23514';
    END IF;
    IF prepared_source->>'kind'='prepared' THEN
      prepared_source:=public._read_agreement_signing_fields(_token_hash);
      field_input:=private.e04_prepared_field_input(prepared_source,signer.id,act_at,_prepared_fields);
    END IF;
    -- Original pair and assigned-field receipt precede the mark in this SAME
    -- short transaction. The prepared BEFORE fence can verify actual records;
    -- no forgeable execution marker or deferred missing-field bypass is used.
    event_detail:=pg_catalog.jsonb_build_object('signature_record_id',signer.id,
      'document_version',agreement.version,'document_sha256',agreement.content_sha256);
    INSERT INTO public.paige_agreement_events
      (agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,ip,user_agent,detail,created_at)
      VALUES(agreement.id,agreement.tenant_id,signer.id,'consented','signer',signer.email,_ip,
        pg_catalog.left(coalesce(_user_agent,''),500),event_detail,act_at) RETURNING id INTO consent_event;
    INSERT INTO public.paige_agreement_events
      (agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,ip,user_agent,detail,created_at)
      VALUES(agreement.id,agreement.tenant_id,signer.id,'signed','signer',signer.email,_ip,
        pg_catalog.left(coalesce(_user_agent,''),500),event_detail,act_at) RETURNING id INTO signature_event;
    IF prepared_source->>'kind'='prepared' THEN
      INSERT INTO public.paige_agreement_events
        (agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,ip,user_agent,detail,created_at)
        VALUES(agreement.id,agreement.tenant_id,signer.id,'field_values_recorded','signer',signer.email,_ip,
          pg_catalog.left(coalesce(_user_agent,''),500),pg_catalog.jsonb_build_object('field_input',field_input,
            'consented_event_id',consent_event,'signed_event_id',signature_event),act_at) RETURNING id INTO field_event;
    END IF;
    -- Unchanged native original token/effect/order/tier/consent triggers still enforce this UPDATE.
    UPDATE public.paige_agreement_signers SET status='signed',signed_at=act_at,typed_name=_typed_name,
      signature_image_png=_signature_image_png,esign_consent_at=act_at,esign_consent_slug=_consent_slug,
      esign_consent_version=_consent_version,esign_consent_sha256=_consent_sha256,
      signing_ip=_ip,signing_user_agent=pg_catalog.left(coalesce(_user_agent,''),500)
      WHERE id=signer.id AND agreement_id=agreement.id AND tenant_id=agreement.tenant_id;
  END IF;
  SELECT count(*) INTO remaining FROM public.paige_agreement_signers
    WHERE agreement_id=agreement.id AND tenant_id=agreement.tenant_id AND status<>'signed';
  -- Completion still requires the ORIGINAL real PDF seal and verified Storage readback.
  IF signer.status<>'signed' AND remaining>0 AND agreement.status IN ('sent','viewed') THEN
    UPDATE public.paige_agreements SET status='partially_signed'
      WHERE id=agreement.id AND tenant_id=agreement.tenant_id;
    agreement.status:='partially_signed';
  END IF;
  RETURN pg_catalog.jsonb_build_object('state','recorded','replayed',signer.status='signed',
    'signing_id',agreement.id,'signer_id',signer.id,'signed_at',CASE WHEN signer.status='signed' THEN signer.signed_at ELSE act_at END,
    'consented_event_id',consent_event,'signed_event_id',signature_event,
    'audit_complete',consent_event IS NOT NULL AND signature_event IS NOT NULL,
    'outstanding_count',remaining,'agreement_status',agreement.status);
END $$;
REVOKE ALL ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._record_agreement_signature(
  _token_hash text,_agreement_version integer,_content_sha256 text,_content_storage_key text,
  _typed_name text,_signature_image_png text,_consent_read boolean,_consent_esign boolean,
  _consent_slug text,_consent_version integer,_consent_sha256 text,_ip inet,_user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 RETURN public._record_agreement_signature(_token_hash,_agreement_version,_content_sha256,_content_storage_key,
  _typed_name,_signature_image_png,_consent_read,_consent_esign,_consent_slug,_consent_version,_consent_sha256,_ip,_user_agent,NULL::jsonb);
END $$;
REVOKE ALL ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text) TO service_role;

CREATE OR REPLACE FUNCTION public._paige_preparation_legacy_token_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.paige_agreement_document_preparations%ROWTYPE; a public.paige_agreements%ROWTYPE;
 receipt jsonb; credential jsonb;
BEGIN
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=OLD.agreement_id AND tenant_id=OLD.tenant_id AND is_current;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('viewed','signed'))
  OR (OLD.token_revoked_at IS NOT NULL AND NEW.token_revoked_at IS NULL) THEN
  -- Only the original writer's exact mark, backed by its ALREADY inserted
  -- immutable consent/signature/assigned-field events in the SAME transaction.
  -- Identity, original credential, expiry and revocation cannot change here.
  IF OLD.status IN ('pending','viewed') AND NEW.status='signed' THEN
   receipt:=public._read_agreement_signing_fields(OLD.token_hash);
  END IF;
  IF NOT (OLD.status IN ('pending','viewed') AND NEW.status='signed'
   AND receipt->>'preparation_id' IS NOT DISTINCT FROM p.id::text
   AND receipt->>'signer_id' IS NOT DISTINCT FROM OLD.id::text
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['status','signed_at','typed_name','signature_image_png','esign_consent_at','esign_consent_slug','esign_consent_version','esign_consent_sha256','signing_ip','signing_user_agent','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['status','signed_at','typed_name','signature_image_png','esign_consent_at','esign_consent_slug','esign_consent_version','esign_consent_sha256','signing_ip','signing_user_agent','updated_at'])
   AND private.e04_prepared_signed_fields(NEW)) THEN
  RAISE EXCEPTION 'Prepared-document signing requires the canonical approved send integration' USING ERRCODE='23514';
  END IF; END IF;
 IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.token_expires_at IS DISTINCT FROM OLD.token_expires_at THEN
  -- Preserve ORIGINAL void_agreement_signing: it first authorizes/voids through
  -- void_paige_agreement, revokes access and records the original void event,
  -- then irreversibly removes the credential. This cannot replace or revive it.
  IF NEW.token_hash IS NULL AND NEW.token_expires_at IS NULL
   AND OLD.token_revoked_at IS NOT NULL AND NEW.token_revoked_at IS NOT DISTINCT FROM OLD.token_revoked_at
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['token_hash','token_expires_at','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['token_hash','token_expires_at','updated_at'])
   AND EXISTS(SELECT 1 FROM public.paige_agreements v WHERE v.id=OLD.agreement_id
    AND v.tenant_id=OLD.tenant_id AND v.status='voided' AND v.voided_at IS NOT NULL)
   AND EXISTS(SELECT 1 FROM public.paige_agreement_events e WHERE e.agreement_id=OLD.agreement_id
    AND e.tenant_id=OLD.tenant_id AND e.event_type='voided' AND e.actor_kind='owner'
    AND e.actor_user_id=auth.uid()) THEN RETURN NEW; END IF;
  IF OLD.token_hash IS NOT NULL OR OLD.token_revoked_at IS NOT NULL OR OLD.status<>'pending'
   OR NEW.token_hash IS NULL OR NEW.token_expires_at IS NULL OR NEW.token_revoked_at IS NOT NULL
   OR (pg_catalog.to_jsonb(NEW)-ARRAY['token_hash','token_expires_at','updated_at'])
    IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['token_hash','token_expires_at','updated_at']) THEN
   RAISE EXCEPTION 'Prepared-document credential replacement refused' USING ERRCODE='23514'; END IF;
  receipt:=private.e04_prepared_issuance_write(OLD.tenant_id,OLD.agreement_id,p.id);
 SELECT entry.value INTO credential FROM pg_catalog.jsonb_array_elements(receipt->'credentials') entry(value) WHERE entry.value->>'signer_id'=OLD.id::text;
  SELECT * INTO a FROM public.paige_agreements WHERE id=OLD.agreement_id AND tenant_id=OLD.tenant_id;
  IF receipt IS NULL OR credential IS NULL OR NEW.token_hash !~ '^[a-f0-9]{64}$'
   OR credential->>'token_commitment' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.token_hash,'UTF8')),'hex')
   OR (credential->>'expires_at')::timestamptz IS DISTINCT FROM NEW.token_expires_at
   OR a.status IS DISTINCT FROM 'draft' OR a.content_storage_key IS DISTINCT FROM p.content_storage_key
   OR a.content_sha256 IS DISTINCT FROM p.document_sha256 THEN
   RAISE EXCEPTION 'Prepared-document credential lacks exact original issuance' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_preparation_legacy_token_hold() FROM PUBLIC,anon,authenticated,service_role;

-- Extensions of the original agreement record and audit stream only.
-- Real renderer/Storage readback precedes this private service boundary.
CREATE OR REPLACE FUNCTION private.e04_prepared_completion_record(_candidate public.paige_agreements)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; p public.paige_agreement_document_preparations%ROWTYPE;
 se public.paige_agreement_events%ROWTYPE; ce public.paige_agreement_events%ROWTYPE;
 source jsonb; n bigint; digest text;
BEGIN
 IF _candidate.id IS NULL OR _candidate.status IS DISTINCT FROM 'completed' OR _candidate.completed_at IS NULL
  OR NOT pg_catalog.isfinite(_candidate.completed_at)
  OR coalesce(_candidate.sealed_sha256,'') !~ '^[a-f0-9]{64}$'
  OR coalesce(_candidate.sealed_storage_key,'') !~ ('^'||_candidate.tenant_id::text||'/'||_candidate.id::text||'/sealed-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$') THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=_candidate.id AND tenant_id=_candidate.tenant_id;
 IF NOT FOUND OR (pg_catalog.to_jsonb(a)-ARRAY['status','completed_at','sealed_storage_key','sealed_sha256','updated_at'])
  IS DISTINCT FROM (pg_catalog.to_jsonb(_candidate)-ARRAY['status','completed_at','sealed_storage_key','sealed_sha256','updated_at']) THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=a.id AND tenant_id=a.tenant_id AND is_current;
 IF NOT FOUND OR p.client_id IS DISTINCT FROM a.contact_id OR p.source_version IS DISTINCT FROM a.version
  OR p.content_storage_key IS DISTINCT FROM a.content_storage_key OR p.document_sha256 IS DISTINCT FROM a.content_sha256 THEN RETURN NULL; END IF;
 SELECT count(*) INTO n FROM public.paige_agreement_signers WHERE agreement_id=a.id AND tenant_id=a.tenant_id;
 IF n<1 OR EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=a.id AND s.tenant_id=a.tenant_id
  AND (s.status IS DISTINCT FROM 'signed' OR private.e04_prepared_signed_fields(s) IS DISTINCT FROM true
   OR s.signed_at IS NULL OR _candidate.completed_at<s.signed_at)) THEN RETURN NULL; END IF;
 SELECT count(*) INTO n FROM public.paige_agreement_events WHERE agreement_id=a.id AND tenant_id=a.tenant_id
  AND event_type='sealed' AND detail->>'action'='prepared_seal_recorded';
 IF n<>1 THEN RETURN NULL; END IF;
 SELECT * INTO se FROM public.paige_agreement_events WHERE agreement_id=a.id AND tenant_id=a.tenant_id
  AND event_type='sealed' AND detail->>'action'='prepared_seal_recorded';
 SELECT count(*) INTO n FROM public.paige_agreement_events WHERE agreement_id=a.id AND tenant_id=a.tenant_id
  AND event_type='completed' AND detail->>'action'='prepared_seal_recorded';
 IF n<>1 THEN RETURN NULL; END IF;
 SELECT * INTO ce FROM public.paige_agreement_events WHERE agreement_id=a.id AND tenant_id=a.tenant_id
  AND event_type='completed' AND detail->>'action'='prepared_seal_recorded';
 IF se.actor_kind IS DISTINCT FROM 'system' OR ce.actor_kind IS DISTINCT FROM 'system'
  OR se.actor_user_id IS NOT NULL OR ce.actor_user_id IS NOT NULL OR se.signer_id IS NOT NULL OR ce.signer_id IS NOT NULL
  OR se.actor_email IS NOT NULL OR ce.actor_email IS NOT NULL OR se.ip IS NOT NULL OR ce.ip IS NOT NULL
  OR se.user_agent IS NOT NULL OR ce.user_agent IS NOT NULL OR se.id=ce.id OR ce.seq<=se.seq
  OR se.created_at IS DISTINCT FROM _candidate.completed_at OR ce.created_at IS DISTINCT FROM _candidate.completed_at
  OR pg_catalog.jsonb_typeof(se.detail) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(ce.detail) IS DISTINCT FROM 'object'
  OR (se.detail-ARRAY['action','preparation_id','preparation_sha256','source_sha256','sealed_storage_key','sealed_sha256','presented_sha256'])<>'{}'::jsonb
  OR NOT(se.detail ?& ARRAY['action','preparation_id','preparation_sha256','source_sha256','sealed_storage_key','sealed_sha256','presented_sha256'])
  OR (ce.detail-ARRAY['action','preparation_id','source_sha256','sealed_event_id','sealed_sha256'])<>'{}'::jsonb
  OR NOT(ce.detail ?& ARRAY['action','preparation_id','source_sha256','sealed_event_id','sealed_sha256'])
  OR se.detail->>'preparation_id' IS DISTINCT FROM p.id::text OR ce.detail->>'preparation_id' IS DISTINCT FROM p.id::text
  OR se.detail->>'preparation_sha256' IS DISTINCT FROM p.preparation_sha256
  OR se.detail->>'presented_sha256' IS DISTINCT FROM a.content_sha256
  OR se.detail->>'sealed_storage_key' IS DISTINCT FROM _candidate.sealed_storage_key
  OR se.detail->>'sealed_sha256' IS DISTINCT FROM _candidate.sealed_sha256
  OR ce.detail->>'sealed_sha256' IS DISTINCT FROM _candidate.sealed_sha256
  OR ce.detail->>'sealed_event_id' IS DISTINCT FROM se.id::text
  OR coalesce(se.detail->>'source_sha256','') !~ '^[a-f0-9]{64}$'
  OR ce.detail->>'source_sha256' IS DISTINCT FROM se.detail->>'source_sha256' THEN RETURN NULL; END IF;
 IF a.status<>'completed' THEN
  source:=public._read_prepared_agreement_seal(a.id);
  IF source->>'state' IS DISTINCT FROM 'prepared' THEN RETURN NULL; END IF;
  digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(source),'UTF8')),'hex');
  IF se.detail->>'source_sha256' IS DISTINCT FROM digest THEN RETURN NULL; END IF;
 ELSIF a.completed_at IS DISTINCT FROM _candidate.completed_at OR a.sealed_storage_key IS DISTINCT FROM _candidate.sealed_storage_key
  OR a.sealed_sha256 IS DISTINCT FROM _candidate.sealed_sha256 THEN RETURN NULL;
 END IF;
 RETURN pg_catalog.jsonb_build_object('state','recorded','agreement_id',a.id,'tenant_id',a.tenant_id,
  'preparation_id',p.id,'source_sha256',se.detail->'source_sha256','sealed_storage_key',_candidate.sealed_storage_key,
  'sealed_sha256',_candidate.sealed_sha256,'completed_at',_candidate.completed_at,'sealed_event_id',se.id,'completed_event_id',ce.id);
EXCEPTION WHEN data_exception THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_completion_record(public.paige_agreements) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._complete_prepared_agreement_seal(
 _tenant uuid,_agreement uuid,_source_sha256 text,_sealed_storage_key text,_sealed_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.paige_agreements%ROWTYPE; source jsonb; receipt jsonb; source_digest text;
 preparation uuid; preparation_sha text; act_at timestamptz; sealed_event uuid;
BEGIN
 IF _tenant IS NULL OR _agreement IS NULL THEN RAISE EXCEPTION 'Original agreement unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.paige_agreements WHERE id=_agreement AND tenant_id=_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original agreement unavailable' USING ERRCODE='42501'; END IF;
 IF a.status='completed' THEN
  receipt:=private.e04_prepared_completion_record(a);
  IF receipt IS NULL THEN RAISE EXCEPTION 'Original completed evidence unavailable' USING ERRCODE='23514'; END IF;
  RETURN receipt||pg_catalog.jsonb_build_object('replayed',true);
 END IF;
 -- Empty evidence can only reconcile the SAME original record, never complete it.
 IF _source_sha256 IS NULL AND _sealed_storage_key IS NULL AND _sealed_sha256 IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('state','unavailable','agreement_id',a.id,'tenant_id',a.tenant_id);
 END IF;
 IF a.status NOT IN ('sent','viewed','partially_signed') OR a.completed_at IS NOT NULL
  OR a.sealed_storage_key IS NOT NULL OR a.sealed_sha256 IS NOT NULL
  OR coalesce(_source_sha256,'') !~ '^[a-f0-9]{64}$' OR coalesce(_sealed_sha256,'') !~ '^[a-f0-9]{64}$'
  OR coalesce(_sealed_storage_key,'') !~ ('^'||a.tenant_id::text||'/'||a.id::text||'/sealed-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$') THEN
  RAISE EXCEPTION 'Original completion source changed' USING ERRCODE='23514'; END IF;
 source:=public._read_prepared_agreement_seal(a.id);
 IF source->>'state' IS DISTINCT FROM 'prepared' OR source->>'tenant_id' IS DISTINCT FROM a.tenant_id::text
  OR source->>'agreement_id' IS DISTINCT FROM a.id::text THEN
  RAISE EXCEPTION 'Original signing facts unavailable' USING ERRCODE='23514'; END IF;
 source_digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public._paige_commercial_canonical_json(source),'UTF8')),'hex');
 IF _source_sha256 IS DISTINCT FROM source_digest THEN RAISE EXCEPTION 'Original completion source changed' USING ERRCODE='23514'; END IF;
 preparation:=(source#>>'{prepared_fields,preparation_id}')::uuid;
 preparation_sha:=source#>>'{prepared_fields,preparation,preparation_sha256}';
 act_at:=pg_catalog.clock_timestamp();
 INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,detail,created_at)
  VALUES(a.id,a.tenant_id,'sealed','system',pg_catalog.jsonb_build_object('action','prepared_seal_recorded',
   'preparation_id',preparation,'preparation_sha256',preparation_sha,'source_sha256',source_digest,
   'sealed_storage_key',_sealed_storage_key,'sealed_sha256',_sealed_sha256,'presented_sha256',a.content_sha256),act_at)
  RETURNING id INTO sealed_event;
 INSERT INTO public.paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,detail,created_at)
  VALUES(a.id,a.tenant_id,'completed','system',pg_catalog.jsonb_build_object('action','prepared_seal_recorded',
   'preparation_id',preparation,'source_sha256',source_digest,'sealed_event_id',sealed_event,'sealed_sha256',_sealed_sha256),act_at);
 UPDATE public.paige_agreements SET status='completed',completed_at=act_at,
  sealed_storage_key=_sealed_storage_key,sealed_sha256=_sealed_sha256 WHERE id=a.id AND tenant_id=a.tenant_id RETURNING * INTO a;
 receipt:=private.e04_prepared_completion_record(a);
 IF receipt IS NULL THEN RAISE EXCEPTION 'Original completed evidence unavailable' USING ERRCODE='23514'; END IF;
 RETURN receipt||pg_catalog.jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public._complete_prepared_agreement_seal(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._complete_prepared_agreement_seal(uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public._paige_preparation_legacy_effect_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.paige_agreement_document_preparations%ROWTYPE; receipt jsonb; expected_commercial jsonb;
BEGIN
 SELECT * INTO p FROM public.paige_agreement_document_preparations
  WHERE agreement_id=OLD.id AND tenant_id=OLD.tenant_id AND is_current;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('sent','viewed','partially_signed','completed'))
  OR NEW.sealed_storage_key IS DISTINCT FROM OLD.sealed_storage_key
  OR NEW.sealed_sha256 IS DISTINCT FROM OLD.sealed_sha256 THEN
  -- Only a real ORIGINAL canonical message/Rail publication receipt may let
  -- this draft record become sent. Other fields and all recipient/signature/
  -- sealed-file transitions remain under the original closed fences.
  IF OLD.status='draft' AND NEW.status='sent'
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['status','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['status','updated_at'])
   AND private.e04_prepared_publication_record(OLD.tenant_id,OLD.id,p.id) IS NOT NULL THEN RETURN NEW; END IF;
  -- Original partial progress requires actual complete field/signature facts
  -- for every marked recipient. Completion/sealed-file transitions stay closed.
  IF OLD.status IN ('sent','viewed') AND NEW.status='partially_signed'
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['status','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['status','updated_at'])
   AND EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=OLD.id AND s.tenant_id=OLD.tenant_id AND s.status='signed')
   AND NOT EXISTS(SELECT 1 FROM public.paige_agreement_signers s WHERE s.agreement_id=OLD.id AND s.tenant_id=OLD.tenant_id
    AND s.status='signed' AND NOT private.e04_prepared_signed_fields(s)) THEN RETURN NEW; END IF;
  -- Only an actual original sealed/completed receipt pair and current signed
  -- facts permit this one completion. No temporary authority marker is used.
  IF OLD.status IN ('sent','viewed','partially_signed') AND NEW.status='completed'
   AND (pg_catalog.to_jsonb(NEW)-ARRAY['status','completed_at','sealed_storage_key','sealed_sha256','updated_at'])
    IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['status','completed_at','sealed_storage_key','sealed_sha256','updated_at'])
   AND private.e04_prepared_completion_record(NEW) IS NOT NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Prepared-document signature requests require the canonical approved send integration' USING ERRCODE='23514'; END IF;
 IF NEW.content_storage_key IS DISTINCT FROM OLD.content_storage_key OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 THEN
  IF OLD.status<>'draft' OR NEW.status<>'draft' OR OLD.content_storage_key IS NOT NULL OR OLD.content_sha256 IS NOT NULL
   OR NEW.content_storage_key IS DISTINCT FROM p.content_storage_key OR NEW.content_sha256 IS DISTINCT FROM p.document_sha256
   OR (pg_catalog.to_jsonb(NEW)-ARRAY['content_storage_key','content_sha256','commercial_presentation','presented_body_markdown','updated_at'])
    IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['content_storage_key','content_sha256','commercial_presentation','presented_body_markdown','updated_at']) THEN
   RAISE EXCEPTION 'Prepared-document freeze differs from the reviewed source' USING ERRCODE='23514'; END IF;
  receipt:=private.e04_prepared_issuance_write(OLD.tenant_id,OLD.id,p.id);
  IF receipt IS NULL THEN RAISE EXCEPTION 'Prepared-document freeze requires original approved issuance' USING ERRCODE='23514'; END IF;
  IF p.commercial_payload_digest IS NOT NULL THEN
   expected_commercial:=pg_catalog.jsonb_build_object('schema_version',1,'payload',p.manifest_canonical::jsonb#>'{commercial,payload}',
    'payload_digest',p.commercial_payload_digest,'presented_body_sha256',p.manifest_canonical::jsonb#>'{commercial,presented_body_sha256}',
    'content_storage_key',p.content_storage_key,'document_sha256',p.document_sha256);
   IF NEW.commercial_presentation IS DISTINCT FROM expected_commercial
    OR NEW.presented_body_markdown IS DISTINCT FROM p.manifest_canonical::jsonb#>>'{commercial,presented_body_markdown}' THEN
    RAISE EXCEPTION 'Prepared commercial presentation differs from reviewed terms' USING ERRCODE='23514'; END IF;
  ELSIF NEW.commercial_presentation IS DISTINCT FROM OLD.commercial_presentation
   OR NEW.presented_body_markdown IS DISTINCT FROM OLD.presented_body_markdown THEN
   RAISE EXCEPTION 'Unreviewed commercial presentation refused' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_preparation_legacy_effect_hold() FROM PUBLIC,anon,authenticated,service_role;

-- Prepared seal, forward drift guards and full negative/concurrency proof remain PROOF OWED.
COMMIT;
