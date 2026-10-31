-- Exact original function-source SHA256 before additive forward derivation:
-- freeze_knowledge_lifecycle: 07b705b2c6a9a9af065f9bfcb7747b309661c8b646a4e301e8f8d194b41cae3d
-- submit_knowledge_extraction: 5f3fbfb980579a195b92e7cfdbd08c2e4508503ec3d8ca6aaec210d3843e8f3b
-- complete_knowledge_extraction: 8fc731e797620d56aeac45a415488c3364a722d33a2ee65b6d38e884b773dbd3
-- complete_knowledge_publication: 9209606683aad7f7a83899d94c722f0444cacb5b3d432baf78547b33db33c208
-- discard_tenant_knowledge_review: 4d6820f9e4410d8e014c31d7134dbb00ce998622c0503f1993d0b6a04774b7d8
-- settle_knowledge_extraction_failure: fd84adfc52a6acc7f9daa106a0322fa8315a43592fe0b2eb9be8ceb73e4f0fe2
-- read_tenant_knowledge_review: 051a4b1d3a59d8b798cc4c4466892e80787361c732d5774364a393166c1743cd

-- Refuse unknown incoming bodies/ACLs/owners; accept only original or this exact
-- candidate on repeat. Never silently overwrite a peer repair or widen authority.
DO $e13_source_guard$
DECLARE expected record; actual record; id oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_binary_evidence_valid(jsonb)',ARRAY['5a1e56308b311adb0e28746ccd03b973'],false,true,true,true),
  ('public.freeze_knowledge_lifecycle()',ARRAY['bb355085d5fe1cfcd35bf1ace065660f','3ea8b4881ba07a6f82affd4210cad799'],true,false,false,false),
  ('public.submit_knowledge_extraction(uuid,uuid,uuid,uuid,integer,text,text,jsonb)',ARRAY['65dc6ea1c61519defdf77ea88b946117','4d1aacd69a03322642b149cbce6c5c56'],true,true,false,true),
  ('public.complete_knowledge_extraction(uuid,text,integer,integer,text,text,jsonb)',ARRAY['ad8ba3ba3ea7bd788bca70eccb639899'],false,true,false,true),
  ('public.complete_knowledge_extraction(uuid,text,integer,integer,text,text)',ARRAY['c0ba3532087d99760043289dfa9e9a63','ba8e9f6ebd298437bc35e9d1e3bb944f'],true,true,false,true),
  ('public.complete_knowledge_publication(uuid,text,integer,integer)',ARRAY['42a227f727ff894a01fb2b59850d0b14','1f6b283cc18ec1ca5f1028001d2d4cae'],true,true,false,true),
  ('public.discard_tenant_knowledge_review(uuid,uuid,uuid,integer)',ARRAY['de0615fb79ae3d2344d76f7bc9d277f3','3a7dde8b1fb1b87c153eaba9045375ad'],true,true,true,false),
  ('public.settle_knowledge_extraction_failure(uuid,text,integer,text,boolean)',ARRAY['263f4d4d5a03a6483b1973e68aa94576','b17fefbf2427a1ad30ff5c89ccf109c4'],true,true,false,true),
  ('public.read_tenant_knowledge_review(uuid,uuid,boolean)',ARRAY['4f48f5ab5e75cd6170b071dd9e3c791c'],false,true,true,false),
  ('public.read_tenant_knowledge_review(uuid,uuid)',ARRAY['00ee42237e83f41fbf222f52e8019f99'],true,true,true,false)
 ) v(signature,body_hashes,required,definer,auth_execute,service_execute) LOOP
  id:=to_regprocedure(expected.signature);
  IF id IS NULL THEN
   IF expected.required THEN RAISE EXCEPTION 'KNOWLEDGE_BINARY_SOURCE_FUNCTION_MISSING: %',expected.signature; END IF;
   CONTINUE;
  END IF;
  SELECT * INTO actual FROM pg_proc WHERE oid=id;
  IF NOT (md5(replace(actual.prosrc,E'\r\n',E'\n'))=ANY(expected.body_hashes))
   OR actual.proowner<>to_regrole(current_user) OR actual.prosecdef IS DISTINCT FROM expected.definer
   OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR has_function_privilege('anon',id,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) a
    WHERE a.grantor<>actual.proowner OR a.privilege_type<>'EXECUTE'
     OR (a.grantee<>actual.proowner AND NOT ((expected.auth_execute AND a.grantee=to_regrole('authenticated')::oid)
      OR (expected.service_execute AND a.grantee=to_regrole('service_role')::oid)))
     OR (a.grantee<>actual.proowner AND a.is_grantable))
   OR has_function_privilege('authenticated',id,'EXECUTE') IS DISTINCT FROM expected.auth_execute
   OR has_function_privilege('service_role',id,'EXECUTE') IS DISTINCT FROM expected.service_execute
   THEN RAISE EXCEPTION 'KNOWLEDGE_BINARY_SOURCE_DRIFT: %',expected.signature; END IF;
 END LOOP;
 IF to_regprocedure('public.knowledge_binary_evidence_valid(jsonb)') IS NULL AND EXISTS(
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_knowledge_docs'
   AND column_name IN ('source_evidence','extraction_evidence'))
  THEN RAISE EXCEPTION 'KNOWLEDGE_BINARY_SOURCE_COLUMN_CONFLICT'; END IF;
END $e13_source_guard$;
-- EXP13 LOCAL FORWARD CANDIDATE. Publication/order ACK and review REQUIRED.
-- Same original Knowledge rows, extraction work, authority and publication.
-- Raw file hash is never relabelled as extracted-text identity. No activation.
CREATE OR REPLACE FUNCTION public.knowledge_binary_evidence_valid(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; a integer; b integer; ordinal integer; previous_end integer:=0; previous_ordinal integer:=0; n integer; boundaries integer[];
BEGIN
 IF v IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(v)<>'object' OR octet_length(v::text)>4000000
  OR NOT v ?& ARRAY['schema_version','format','source_sha256','text_sha256','extraction_version','coverage','segments','limits','extracted_content']
  OR v-ARRAY['schema_version','format','source_sha256','text_sha256','extraction_version','coverage','segments','limits','extracted_content']<>'{}'::jsonb
  OR v->'schema_version'<>'1'::jsonb OR jsonb_typeof(v->'format')<>'string' OR v->>'format' NOT IN ('pdf','docx','text')
  OR jsonb_typeof(v->'extracted_content')<>'string'
  OR public.knowledge_utf16_length(v->>'extracted_content') NOT BETWEEN 1 AND 480000
  OR octet_length(v->>'extracted_content')>2097152
  OR jsonb_typeof(v->'source_sha256')<>'string' OR v->>'source_sha256' !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(v->'text_sha256')<>'string' OR v->>'text_sha256' !~ '^[0-9a-f]{64}$'
  OR encode(sha256(convert_to(v->>'extracted_content','UTF8')),'hex') IS DISTINCT FROM v->>'text_sha256'
  OR jsonb_typeof(v->'extraction_version')<>'string' OR v->>'extraction_version' !~ '^[a-z0-9.-]{1,100}$'
  OR jsonb_typeof(v->'coverage')<>'string'
  OR (v->>'format' IN ('pdf','docx') AND v->>'coverage'<>'partial')
  OR (v->>'format'='text' AND v->>'coverage' NOT IN ('complete','partial'))
  OR jsonb_typeof(v->'segments')<>'array' OR jsonb_array_length(v->'segments') NOT BETWEEN 1 AND 2000
  OR jsonb_typeof(v->'limits')<>'array' OR jsonb_array_length(v->'limits')>20 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'limits') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[A-Z][A-Z0-9_]{0,99}$') THEN RETURN false; END IF;
 n:=public.knowledge_utf16_length(v->>'extracted_content');
 FOR s IN SELECT * FROM jsonb_array_elements(v->'segments') LOOP
  IF jsonb_typeof(s)<>'object' OR NOT s ?& ARRAY['kind','ordinal','start','end']
   OR s-ARRAY['kind','ordinal','start','end']<>'{}'::jsonb
   OR s->>'kind' IS DISTINCT FROM (CASE v->>'format' WHEN 'pdf' THEN 'page' WHEN 'docx' THEN 'paragraph' ELSE 'text' END)
   OR jsonb_typeof(s->'ordinal')<>'number' OR s->>'ordinal' !~ '^[0-9]+$' OR (s->>'ordinal')::numeric NOT BETWEEN 1 AND 1000000
   OR jsonb_typeof(s->'start')<>'number' OR s->>'start' !~ '^[0-9]+$' OR (s->>'start')::numeric NOT BETWEEN 0 AND 480000
   OR jsonb_typeof(s->'end')<>'number' OR s->>'end' !~ '^[0-9]+$' OR (s->>'end')::numeric NOT BETWEEN 1 AND 480000 THEN RETURN false; END IF;
  a:=(s->>'start')::int; b:=(s->>'end')::int; ordinal:=(s->>'ordinal')::int;
  IF a<previous_end OR b<=a OR b>n OR ordinal<=previous_ordinal THEN RETURN false; END IF;
  previous_end:=b; previous_ordinal:=ordinal;
 END LOOP;
 -- The original consumer uses UTF16 offsets. Only non-BMP characters have an
 -- interior offset which must be refused; scan these once, not once per quote.
 IF n<>length(v->>'extracted_content') THEN
  SELECT array_agg(DISTINCT point) INTO boundaries FROM (
   SELECT (x->>'start')::int AS point FROM jsonb_array_elements(v->'segments') x
   UNION ALL SELECT (x->>'end')::int FROM jsonb_array_elements(v->'segments') x
  ) endpoints;
  IF EXISTS(SELECT 1 FROM (
   SELECT sum(length(parts[1])+2) OVER (ORDER BY seq)-1 AS invalid_offset
   FROM regexp_matches(v->>'extracted_content','([^\U00010000-\U0010FFFF]*)([\U00010000-\U0010FFFF])','g') WITH ORDINALITY r(parts,seq)
  ) forbidden WHERE invalid_offset=ANY(boundaries)) THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_binary_evidence_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_binary_evidence_valid(jsonb) TO authenticated,service_role;
ALTER TABLE public.tenant_knowledge_docs
 ADD COLUMN IF NOT EXISTS extraction_evidence jsonb,
 ADD COLUMN IF NOT EXISTS source_evidence jsonb;
ALTER TABLE public.tenant_knowledge_docs DROP CONSTRAINT IF EXISTS knowledge_binary_source_evidence_shape;
ALTER TABLE public.tenant_knowledge_docs ADD CONSTRAINT knowledge_binary_source_evidence_shape CHECK (
 public.knowledge_binary_evidence_valid(source_evidence)
 AND public.knowledge_binary_evidence_valid(extraction_evidence)
 AND (source_evidence IS NULL OR (source_binding IS NOT NULL AND source_evidence->>'source_sha256'=source_binding->>'sha256'))
 AND (extraction_evidence IS NULL OR (extraction_source_binding IS NOT NULL AND pending_review IS NOT NULL
  AND extraction_evidence->>'source_sha256'=extraction_source_binding->>'sha256'
  AND extraction_evidence->>'extracted_content'=pending_review->>'extracted_content')));


CREATE OR REPLACE FUNCTION public.freeze_knowledge_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.extraction_work_id IS NOT NULL
   AND ROW(NEW.id,NEW.tenant_id) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id) THEN
  RAISE EXCEPTION 'KNOWLEDGE_PENDING_IDENTITY_IMMUTABLE' USING ERRCODE='42501';
 END IF;
 IF current_user IN ('authenticated','anon') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.record_state<>'canonical' OR NEW.source_coverage<>'unknown' OR NEW.source_binding IS NOT NULL
     OR NEW.pending_review IS NOT NULL OR NEW.extraction_input IS NOT NULL OR NEW.extraction_source_binding IS NOT NULL
     OR NEW.extraction_work_id IS NOT NULL OR NEW.extraction_revision IS NOT NULL
     OR NEW.extraction_evidence IS NOT NULL OR NEW.source_evidence IS NOT NULL THEN
    RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSIF ROW(NEW.record_state,NEW.source_coverage,NEW.source_binding,NEW.pending_review,NEW.extraction_input,NEW.extraction_source_binding,NEW.extraction_work_id,NEW.extraction_revision,NEW.extraction_evidence,NEW.source_evidence)
    IS DISTINCT FROM ROW(OLD.record_state,OLD.source_coverage,OLD.source_binding,OLD.pending_review,OLD.extraction_input,OLD.extraction_source_binding,OLD.extraction_work_id,OLD.extraction_revision,OLD.extraction_evidence,OLD.source_evidence) THEN
   RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.submit_knowledge_extraction(
 _actor uuid,_tenant uuid,_intent uuid,_doc_id uuid,_expected_revision integer,
 _title text,_input text,_source jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; doc uuid;
 request_hash text; created record; input_hash text;
BEGIN
 IF NOT public.lock_knowledge_extraction_authority(_actor,_tenant) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF _intent IS NULL OR _title IS NULL OR length(btrim(_title)) NOT BETWEEN 1 AND 300
   OR (_doc_id IS NULL)<>(_expected_revision IS NULL) THEN RAISE EXCEPTION 'KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF _source IS NULL THEN
  IF _input IS NULL OR public.knowledge_utf16_length(_input) NOT BETWEEN 1 AND 480000 OR octet_length(_input)>2097152 THEN RAISE EXCEPTION 'KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  input_hash:=encode(sha256(convert_to(_input,'UTF8')),'hex');
 ELSE
  IF _input IS NOT NULL OR NOT public.knowledge_source_binding_valid(_source,_tenant)
    OR (_source->>'byte_size')::numeric>2097152 THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM storage.objects WHERE id=(_source->>'object_id')::uuid AND bucket_id='tenant-knowledge' AND name=_source->>'object_name' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  input_hash:=_source->>'sha256';
 END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('target',_doc_id,'revision',_expected_revision,'title',btrim(_title),'hash',input_hash,'source',_source-'bound_at')::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text||':'||_actor::text||':'||_intent::text,0));
 SELECT * INTO w FROM public.paige_durable_work WHERE tenant_id=_tenant AND initiating_user_id=_actor AND intent_id=_intent FOR UPDATE;
 IF FOUND THEN
  IF w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' OR w.request_payload->>'request_hash' IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('work_id',w.id,'document_id',w.request_payload->>'document_id','status',w.status,'replayed',true);
 END IF;
 IF _doc_id IS NOT NULL THEN
  SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=_doc_id AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF d.revision<>_expected_revision THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF d.extraction_work_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.paige_durable_work WHERE id=d.extraction_work_id AND status NOT IN ('failed','cancelled')) THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_PENDING' USING ERRCODE='55000'; END IF;
  doc:=d.id;
 ELSE doc:=gen_random_uuid(); END IF;
 SELECT * INTO created FROM public.create_paige_durable_work(_tenant,_actor,_intent,NULL,'knowledge.extract','knowledge_extract',jsonb_build_object('tenant_id',_tenant,'actor_user_id',_actor,'source','knowledge_extraction'),'tenant:'||_tenant::text,60,3);
 IF _doc_id IS NULL THEN
  INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state,source,extraction_input,extraction_source_binding,extraction_work_id,extraction_revision)
  VALUES(doc,_tenant,btrim(_title),'',_actor,'draft',CASE WHEN _source IS NULL THEN 'paste' ELSE 'upload' END,_input,_source,created.work_id,1) RETURNING * INTO d;
 ELSE
  UPDATE public.tenant_knowledge_docs SET extraction_input=_input,extraction_source_binding=_source,extraction_work_id=created.work_id,extraction_revision=revision+1,pending_review=NULL,extraction_evidence=NULL WHERE id=doc RETURNING * INTO d;
 END IF;
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',doc,'request_hash',request_hash,'input_hash',input_hash,'revision',d.revision),safe_summary='Knowledge extraction is queued.',version=version+1 WHERE id=created.work_id;
 -- Same native worker and cron recovery path. Missed wake never loses the envelope.
 BEGIN
  PERFORM net.http_post(url:='https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-document-worker',headers:=jsonb_build_object('Content-Type','application/json','x-cron-token',public.cron_token_header()),body:=jsonb_build_object('mode','knowledge-run','work_id',created.work_id));
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN jsonb_build_object('work_id',created.work_id,'document_id',doc,'revision',d.revision,'status','claimed','replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.complete_knowledge_extraction(_work_id uuid,_server_key text,_attempt integer,_revision integer,_content text,_hash text,_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; outcome text:='capability_succeeded'; result jsonb; stamped jsonb;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' OR w.idempotency_key IS DISTINCT FROM _server_key THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF _attempt IS NULL OR w.attempt_count<>_attempt OR w.dispatch_started_attempt<>_attempt THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF w.status='succeeded' THEN RETURN w.terminal_outcome; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 IF _revision IS NULL OR _revision IS DISTINCT FROM (w.request_payload->>'revision')::integer
  OR _content IS NULL OR public.knowledge_utf16_length(_content) NOT BETWEEN 1 AND 480000 OR octet_length(_content)>2097152
  OR _hash IS DISTINCT FROM w.request_payload->>'input_hash'
  OR (_evidence IS NULL AND encode(sha256(convert_to(_content,'UTF8')),'hex') IS DISTINCT FROM _hash) THEN RAISE EXCEPTION 'KNOWLEDGE_OUTPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id AND extraction_work_id=w.id FOR UPDATE;
 IF NOT FOUND OR d.revision<>_revision THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF d.extraction_source_binding IS NOT NULL THEN
  PERFORM 1 FROM storage.objects WHERE id=(d.extraction_source_binding->>'object_id')::uuid AND bucket_id='tenant-knowledge' AND name=d.extraction_source_binding->>'object_name' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 END IF;
 IF _evidence IS NOT NULL THEN
  IF _evidence ? 'extracted_content' OR d.extraction_source_binding IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_OUTPUT_INVALID' USING ERRCODE='22023'; END IF;
  stamped:=_evidence||jsonb_build_object('extracted_content',_content);
  IF NOT public.knowledge_binary_evidence_valid(stamped)
   OR stamped->>'source_sha256' IS DISTINCT FROM _hash
   OR stamped->>'source_sha256' IS DISTINCT FROM d.extraction_source_binding->>'sha256'
   OR (stamped->>'format'='pdf' AND (d.extraction_source_binding->>'object_name' !~* '\.pdf$' OR d.extraction_source_binding->>'mime_type'<>'application/pdf'))
   OR (stamped->>'format'='docx' AND (d.extraction_source_binding->>'object_name' !~* '\.docx$' OR d.extraction_source_binding->>'mime_type'<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
   OR (stamped->>'format'='text' AND d.extraction_source_binding->>'object_name' !~* '\.(txt|md|markdown|csv|json)$')
   THEN RAISE EXCEPTION 'KNOWLEDGE_OUTPUT_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 UPDATE public.tenant_knowledge_docs SET extraction_evidence=stamped,pending_review=jsonb_build_object('schema_version',1,'extracted_content',_content,'reviewed_content',NULL,'extraction_version',coalesce(stamped->>'extraction_version','utf8-v1'),'coverage',coalesce(stamped->>'coverage','complete')),extraction_input=NULL WHERE id=d.id RETURNING * INTO d;
 IF d.pending_review->>'extracted_content' IS DISTINCT FROM _content THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 BEGIN
  PERFORM public.record_capability_run(w.tenant_id,w.initiating_user_id,'knowledge_extract','capability_succeeded',w.id,NULL::text,NULL::text,NULL::uuid,NULL::text,jsonb_build_object('document_id',d.id,'revision',d.revision,'phase','awaiting_review'));
 EXCEPTION WHEN OTHERS THEN outcome:='capability_completed_unrecorded'; END;
 result:=jsonb_build_object('verified_readback',true,'document_id',d.id,'revision',d.revision,'work_id',w.id,'phase','awaiting_review','outcome',outcome);
 IF stamped IS NOT NULL THEN result:=result||jsonb_build_object('source_sha256',stamped->>'source_sha256','text_sha256',stamped->>'text_sha256'); END IF;
 PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',result,'Knowledge text is ready for review. Nothing has been published.',NULL,NULL,300,false);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text,jsonb) TO service_role;
-- Incumbent six-argument ABI remains UTF8-only. Same guarded implementation.
CREATE OR REPLACE FUNCTION public.complete_knowledge_extraction(_work_id uuid,_server_key text,_attempt integer,_revision integer,_content text,_hash text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.complete_knowledge_extraction(_work_id,_server_key,_attempt,_revision,_content,_hash,NULL::jsonb)
$$;
REVOKE ALL ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_knowledge_publication(
 _work_id uuid,_server_key text,_attempt integer,_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; outcome text:='capability_succeeded'; result jsonb; n integer; staged_n integer; run uuid; manifest jsonb;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_publish' OR w.capability_key<>'knowledge.publish' OR w.idempotency_key IS DISTINCT FROM _server_key THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF w.status='succeeded' THEN RETURN w.terminal_outcome; END IF;
 IF _attempt IS DISTINCT FROM w.attempt_count OR w.dispatch_started_attempt<>w.attempt_count THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id FOR UPDATE;
 IF NOT FOUND OR d.revision<>_revision OR d.revision IS DISTINCT FROM (w.request_payload->>'revision')::integer THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF d.active_generation_id=w.id THEN RETURN w.terminal_outcome; END IF;
 manifest:=w.request_payload->'manifest'; n:=(manifest->>'chunk_count')::int;
 SELECT count(*) INTO staged_n FROM public.tenant_knowledge_chunks WHERE doc_id=d.id AND generation_id=w.id;
 IF staged_n<>n OR EXISTS(SELECT 1 FROM generate_series(0,n-1) g WHERE NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_chunks WHERE doc_id=d.id AND generation_id=w.id AND chunk_index=g)) THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INCOMPLETE' USING ERRCODE='55000'; END IF;
 IF encode(sha256(convert_to(d.pending_review->>'reviewed_content','UTF8')),'hex') IS DISTINCT FROM w.request_payload->>'review_hash'
  OR public.knowledge_publication_manifest(d.pending_review->>'reviewed_content',manifest->>'model') IS DISTINCT FROM manifest THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 -- THE atomic promotion: content, staged metadata, active generation, counts, source and
 -- coverage switch together; any earlier failure leaves the prior publication untouched.
 UPDATE public.tenant_knowledge_docs SET
   record_state='canonical',
   content=d.pending_review->>'reviewed_content',
   title=coalesce(btrim(d.pending_review_metadata->>'title'),d.title),
   summary=d.pending_review_metadata->>'summary',category=d.pending_review_metadata->>'category',
   tags=coalesce((SELECT array_agg(value#>>'{}' ORDER BY ord)::text[] FROM jsonb_array_elements(coalesce(d.pending_review_metadata->'tags','[]'::jsonb)) WITH ORDINALITY AS t(value,ord)),d.tags),
   active_generation_id=w.id,publication_manifest=manifest,publication_intent_hash=w.request_payload->>'request_hash',
   chunk_count=n,source_binding=d.extraction_source_binding,source_evidence=d.extraction_evidence,
   source_coverage=coalesce(d.pending_review->>'coverage','unknown'),
   pending_review=NULL,pending_review_metadata=NULL,extraction_evidence=NULL,extraction_work_id=NULL,extraction_input=NULL,extraction_source_binding=NULL,extraction_revision=NULL,
   updated_at=now()
 WHERE id=d.id RETURNING * INTO d;
 IF d.active_generation_id IS DISTINCT FROM w.id OR d.pending_review IS NOT NULL OR d.chunk_count<>n THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 run:=md5('knowledge_publication:'||w.tenant_id::text||':'||d.id::text||':'||w.id::text)::uuid;
 BEGIN
  PERFORM public.record_capability_run(w.tenant_id,w.initiating_user_id,'knowledge_publish','capability_succeeded',run,NULL::text,NULL::text,NULL::uuid,NULL::text,jsonb_build_object('document_id',d.id,'revision',d.revision,'generation_id',w.id,'chunk_count',n));
 EXCEPTION WHEN OTHERS THEN outcome:='capability_completed_unrecorded'; END;
 result:=jsonb_build_object('verified_readback',true,'document_id',d.id,'revision',d.revision,'generation_id',w.id,'chunk_count',n,'outcome',outcome,'phase','published');
 PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',result,'Knowledge is published through the canonical generation.',NULL,NULL,300,false);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.discard_tenant_knowledge_review(p_expected_tenant uuid,p_doc_id uuid,p_work_id uuid,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; run uuid; outcome text:='capability_succeeded'; removed boolean; child record;
BEGIN
 d:=public.lock_knowledge_review_target(p_expected_tenant,p_doc_id,p_work_id,p_expected_revision);
 IF NOT EXISTS(SELECT 1 FROM public.paige_durable_work WHERE id=p_work_id AND status IN ('succeeded','failed','cancelled')) THEN RAISE EXCEPTION 'KNOWLEDGE_DISCARD_IN_FLIGHT' USING ERRCODE='55000'; END IF;
 removed:=d.record_state='draft';
 IF removed THEN
  FOR child IN SELECT tenant_id FROM public.tenant_knowledge_chunks WHERE doc_id=d.id ORDER BY id FOR UPDATE LOOP
   IF child.tenant_id IS DISTINCT FROM p_expected_tenant THEN RAISE EXCEPTION 'KNOWLEDGE_CHILD_SCOPE_MISMATCH' USING ERRCODE='42501'; END IF;
  END LOOP;
 END IF;
 run:=md5('knowledge_review_discard:'||p_expected_tenant::text||':'||p_doc_id::text||':'||d.revision::text)::uuid;
 BEGIN PERFORM public.record_capability_run(p_expected_tenant,auth.uid(),'knowledge_review_discard','capability_succeeded',run,NULL::text,NULL::text,NULL::uuid,NULL::text,jsonb_build_object('document_id',d.id,'revision',d.revision,'work_id',p_work_id));
 EXCEPTION WHEN OTHERS THEN outcome:='capability_completed_unrecorded'; END;
 IF removed THEN
  DELETE FROM public.tenant_knowledge_docs WHERE id=d.id;
  IF EXISTS(SELECT 1 FROM public.tenant_knowledge_docs WHERE id=d.id) OR EXISTS(SELECT 1 FROM public.tenant_knowledge_chunks WHERE doc_id=d.id) THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 ELSE
  UPDATE public.tenant_knowledge_docs SET pending_review=NULL,pending_review_metadata=NULL,extraction_evidence=NULL,extraction_input=NULL,extraction_source_binding=NULL,extraction_work_id=NULL,extraction_revision=NULL,
   last_review_operation=jsonb_build_object('operation','review_discarded','work_id',p_work_id,'run_id',run,'actor_id',auth.uid(),'revision',d.revision+1,'outcome',outcome) WHERE id=d.id RETURNING * INTO d;
  IF d.pending_review IS NOT NULL OR d.extraction_work_id IS NOT NULL THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 END IF;
 RETURN jsonb_build_object('contract_version',1,'verified_readback',true,'tenant_id',p_expected_tenant,'document_id',p_doc_id,'work_id',p_work_id,'revision',d.revision,'operation','review_discarded','document_removed',removed,'work_cancelled',false,'outcome',outcome,'run_id',run,'source_cleanup',jsonb_build_object('status','not_attempted','reason','retained_by_policy'));
END $$;

CREATE OR REPLACE FUNCTION public.settle_knowledge_extraction_failure(_work_id uuid,_server_key text,_attempt integer,_code text,_unknown boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' OR w.idempotency_key IS DISTINCT FROM _server_key OR _attempt IS DISTINCT FROM w.attempt_count OR w.dispatch_started_attempt<>w.attempt_count THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF w.status='succeeded' THEN RETURN; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 IF _code NOT IN ('source_changed','source_unavailable','input_invalid','authority_changed','revision_changed','completion_unknown','file_encrypted','file_package_unsafe','file_type_mismatch','file_too_large','file_no_readable_text','file_text_invalid','file_text_limit','file_unsupported','file_parse_failed','file_cancelled') OR _code IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_ERROR_INVALID'; END IF;
 PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,CASE WHEN _unknown THEN 'outcome_unknown' ELSE 'failed' END,CASE WHEN _unknown THEN NULL ELSE jsonb_build_object('reason',_code,'document_id',w.request_payload->>'document_id') END,'Knowledge extraction needs attention. Published content is unchanged.',NULL,_code,300,false);
END $$;

CREATE OR REPLACE FUNCTION public.read_tenant_knowledge_review(p_expected_tenant uuid,p_doc_id uuid,p_include_source_evidence boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; d public.tenant_knowledge_docs;
BEGIN
 result:=public.read_tenant_knowledge_review(p_expected_tenant,p_doc_id);
 IF p_include_source_evidence IS DISTINCT FROM true THEN RAISE EXCEPTION 'KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 -- Incumbent reader holds the actor/workspace and document locks for this same
 -- transaction. No service-role existence lookup or second permission resolver.
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE tenant_id=p_expected_tenant AND id=p_doc_id FOR SHARE;
 IF NOT FOUND OR d.revision::text IS DISTINCT FROM result->>'revision'
  OR d.id::text IS DISTINCT FROM result->>'document_id' OR d.tenant_id::text IS DISTINCT FROM result->>'tenant_id'
  THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN result||jsonb_build_object('evidence_contract_version',1,'source_evidence',d.source_evidence,'extraction_evidence',d.extraction_evidence);
END $$;
REVOKE ALL ON FUNCTION public.read_tenant_knowledge_review(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_tenant_knowledge_review(uuid,uuid,boolean) TO authenticated;
