-- UNVERSIONED original Chat/Knowledge host reference candidate. No intake,
-- publication, business-fact approval, Memory approval or Work execution.
BEGIN;
-- E01_CHAT_INSTALL_GUARD_BEGIN
DO $chat_install$
DECLARE expected record; f record; installed integer:=0; columns integer; indexes integer;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._paige_chat_knowledge_scope(uuid,uuid,uuid)','dd38278257509b3ec5a16000f58cbaf3',false,'void',0,ARRAY[]::text[]),
  ('public._paige_chat_knowledge_source(uuid,uuid,uuid)','16155b2b73477bc0dc467f76813be923',false,'jsonb',0,ARRAY[]::text[]),
  ('public._paige_chat_knowledge_intake_source(uuid,uuid,uuid)','fbd970644c893f7717f2c51459e625c9',false,'jsonb',0,ARRAY[]::text[]),
  ('public.inspect_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid)','913352d249bfb06f34d639da54302626',true,'jsonb',0,ARRAY['authenticated']::text[]),
  ('public.stage_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)','4a95dc21530706619f6c95789b1be6a6',true,'jsonb',0,ARRAY['authenticated']::text[]),
  ('public.inspect_paige_chat_knowledge_link(uuid,uuid,uuid,uuid)','5f7588388f3f1c64d931c8f0c943f8dd',true,'jsonb',0,ARRAY['authenticated']::text[]),
  ('public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)','1f6bd209b4caebfe7c0c535103a85985',true,'jsonb',0,ARRAY['authenticated']::text[]),
  ('public.list_paige_chat_knowledge_links(uuid,uuid,uuid,uuid,integer)','635b3cf0ed4604b9b7f34ada2588449a',true,'jsonb',2,ARRAY['authenticated']::text[])
 ) v(signature,body_hash,definer,return_type,defaults_count,grantees) LOOP
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF NOT FOUND THEN CONTINUE; END IF;
  installed:=installed+1;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f'
   OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.prorettype<>expected.return_type::regtype
   OR f.proretset OR f.proisstrict OR f.proleakproof OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM (CASE WHEN expected.defaults_count=2 THEN 'NULL::uuid, 20' ELSE NULL END)
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_INSTALL_DRIFT'; END IF;
 END LOOP;
 IF installed NOT IN (0,8) THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_PARTIAL_INSTALL'; END IF;
 IF has_table_privilege('authenticated','public.paige_durable_work','UPDATE')
  OR has_table_privilege('anon','public.paige_durable_work','UPDATE')
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_durable_work'::regclass) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_STORAGE_DRIFT'; END IF;
 SELECT count(*) INTO columns FROM pg_attribute WHERE attrelid='public.paige_durable_work'::regclass
  AND attname='chat_source_link' AND NOT attisdropped;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.paige_durable_work'::regclass
  AND attname='chat_source_link' AND NOT attisdropped AND (atttypid<>'jsonb'::regtype OR attnotnull OR atthasdef)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_COLUMN_DRIFT'; END IF;
 SELECT count(*) INTO indexes FROM pg_class WHERE oid=to_regclass('public.paige_work_chat_knowledge_source');
 IF installed=0 AND (columns<>0 OR indexes<>0) OR installed=8 AND (columns<>1 OR indexes<>1) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_PARTIAL_INSTALL'; END IF;
 IF installed=8 AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.paige_work_chat_knowledge_source')
  AND i.indrelid='public.paige_durable_work'::regclass AND i.indisvalid AND i.indisready AND NOT i.indisunique
  AND pg_get_indexdef(i.indexrelid)='CREATE INDEX paige_work_chat_knowledge_source ON public.paige_durable_work USING btree (tenant_id, initiating_user_id, ((chat_source_link ->> ''threadId''::text)), id) WHERE (chat_source_link IS NOT NULL)') THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_INDEX_DRIFT'; END IF;
END $chat_install$;
-- E01_CHAT_INSTALL_GUARD_END
ALTER TABLE public.paige_durable_work ADD COLUMN IF NOT EXISTS chat_source_link jsonb;
CREATE INDEX IF NOT EXISTS paige_work_chat_knowledge_source ON public.paige_durable_work
 (tenant_id,initiating_user_id,(chat_source_link->>'threadId'),id)
 WHERE chat_source_link IS NOT NULL;

CREATE OR REPLACE FUNCTION public._paige_chat_knowledge_scope(_tenant uuid,_actor uuid,_thread uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF _actor IS NULL OR auth.uid() IS DISTINCT FROM _actor
  OR NOT public.lock_knowledge_extraction_authority(_actor,_tenant) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF _thread IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM public.paige_chat_threads t WHERE t.id=_thread
  AND t.tenant_id=_tenant AND t.caller_user_id=_actor AND t.audience='workspace'
  AND t.lens='coach' AND t.contact_id IS NULL AND t.studio_session_id IS NULL
  AND t.is_archived=false FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_THREAD_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $$;

-- Resolve the existing publication receipt, not caller JSON or a generic work
-- success. Work precedes document locks, matching the original worker ordering.
CREATE OR REPLACE FUNCTION public._paige_chat_knowledge_source(_tenant uuid,_actor uuid,_work uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.paige_durable_work; x public.paige_durable_work; d jsonb; p jsonb;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work AND tenant_id=_tenant
  AND initiating_user_id=_actor AND work_kind='knowledge_publish' AND capability_key='knowledge.publish' FOR SHARE;
 IF NOT FOUND OR w.status<>'succeeded' OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(w.id)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF NOT pg_catalog.pg_input_is_valid(coalesce(w.request_payload->>'document_id',''),'uuid')
  OR NOT pg_catalog.pg_input_is_valid(coalesce(w.request_payload->>'extraction_work_id',''),'uuid') THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 -- No lock on extraction work after taking the publication work: it is already
 -- terminal. The original document reader validates that exact association.
 SELECT * INTO x FROM public.paige_durable_work WHERE id=(w.request_payload->>'extraction_work_id')::uuid
  AND tenant_id=_tenant AND work_kind='knowledge_extract' AND capability_key='knowledge.extract' AND status='succeeded';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(x.id))
  OR coalesce(x.request_payload->>'input_hash','') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 d:=public.read_tenant_knowledge_review(_tenant,(w.request_payload->>'document_id')::uuid);
 p:=d->'publication';
 IF d->>'record_state' IS DISTINCT FROM 'canonical' OR d->'pending_review' IS DISTINCT FROM 'null'::jsonb
  OR p->>'association' IS DISTINCT FROM 'matched' OR p->>'work_status' IS DISTINCT FROM 'succeeded'
  OR p->>'work_id' IS DISTINCT FROM w.id::text OR p->>'generation_id' IS DISTINCT FROM w.id::text
  OR coalesce(p->>'outcome','') NOT IN ('capability_succeeded','capability_completed_unrecorded')
  OR d->>'revision' IS DISTINCT FROM w.terminal_outcome->>'revision'
  OR (d->'source_binding'<>'null'::jsonb AND d#>>'{source_binding,sha256}' IS DISTINCT FROM x.request_payload->>'input_hash')
  OR x.request_payload->>'document_id' IS DISTINCT FROM d->>'document_id'
  OR w.intent_id IS NULL OR x.intent_id IS NULL THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('documentId',d->>'document_id','documentRevision',(d->>'revision')::integer,
  'sourceSha256',x.request_payload->>'input_hash','textSha256',w.request_payload->>'review_hash',
  'extractionWorkId',x.id,'extractionIntentId',x.intent_id,'publicationWorkId',w.id,
  'publicationIntentId',w.intent_id,'generationId',p->>'generation_id','publicationOutcome',p->>'outcome');
END $$;

CREATE OR REPLACE FUNCTION public.inspect_paige_chat_knowledge_link(
 _expected_tenant uuid,_expected_actor uuid,_thread_id uuid,_publication_work_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; source jsonb; link jsonb; host_thread uuid:=_thread_id;
BEGIN
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,_thread_id);
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_publication_work_id AND tenant_id=_expected_tenant
  AND initiating_user_id=_expected_actor AND work_kind='knowledge_publish' AND capability_key='knowledge.publish' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(w.id)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF w.chat_source_link IS NULL THEN RETURN jsonb_build_object('status','absent_at_read'); END IF;
 link:=w.chat_source_link;
 IF jsonb_typeof(link)<>'object' OR link->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR link->'linkRevision' NOT IN ('1'::jsonb,'2'::jsonb) OR NOT link ? 'linkRevision' OR NOT link ? 'turnId'
  OR (link->'turnId'<>'null'::jsonb AND NOT pg_catalog.pg_input_is_valid(coalesce(link->>'turnId',''),'uuid'))
  OR NOT pg_catalog.pg_input_is_valid(coalesce(link->>'threadId',''),'uuid')
  OR link->>'actorId' IS DISTINCT FROM _expected_actor::text OR link->>'tenantId' IS DISTINCT FROM _expected_tenant::text THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 IF host_thread IS NULL THEN host_thread:=(link->>'threadId')::uuid; END IF;
 IF link->>'threadId' IS DISTINCT FROM host_thread::text THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,host_thread);
 BEGIN
  source:=public._paige_chat_knowledge_source(_expected_tenant,_expected_actor,w.id);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '40001' OR SQLSTATE 'P0002' THEN
  RETURN jsonb_build_object('status','recorded','current',false,'reason','source_unavailable_or_changed');
 END;
 IF link - ARRAY['schemaVersion','actorId','tenantId','threadId','turnId','linkRevision'] IS DISTINCT FROM source THEN
  RETURN jsonb_build_object('status','recorded','current',false,'reason','source_unavailable_or_changed'); END IF;
 IF link->>'turnId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_chat_turns t
  WHERE t.id=(link->>'turnId')::uuid AND t.thread_id=host_thread AND t.role='user'
   AND t.interactive_actor_id=_expected_actor AND t.interactive_tenant_id=_expected_tenant
   AND t.interactive_intent_id IS NOT NULL
   AND t.bundle_ref->'paige_record_links' @> jsonb_build_array(jsonb_build_object('destination','business_knowledge','record_id',link->>'documentId'))) THEN
  RETURN jsonb_build_object('status','recorded','current',false,'reason','message_unavailable_or_changed'); END IF;
 RETURN jsonb_build_object('status','recorded','current',true,'reference',link);
END $$;

CREATE OR REPLACE FUNCTION public.save_paige_chat_knowledge_link(
 _expected_tenant uuid,_expected_actor uuid,_thread_id uuid,_turn_id uuid,_publication_work_id uuid,
 _document_id uuid,_document_revision integer,_extraction_intent_id uuid,_source_sha256 text,_expected_link_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; source jsonb; prior jsonb; target jsonb; turn public.paige_chat_turns;
 rev integer; links jsonb; host_thread uuid:=_thread_id; intake public.paige_durable_work;
BEGIN
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,_thread_id);
 IF _document_id IS NULL OR _document_revision IS NULL OR _document_revision<1
  OR _extraction_intent_id IS NULL OR _source_sha256 IS NULL OR _source_sha256 !~ '^[0-9a-f]{64}$'
  OR _expected_link_revision IS NULL OR _expected_link_revision<0 OR _expected_link_revision>1
  OR (_thread_id IS NULL AND _turn_id IS NOT NULL) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 -- The original extraction identity serializes intake and publication linkage.
 -- Always lock it BEFORE publication work, so two observers cannot mint two chats.
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_publication_work_id AND tenant_id=_expected_tenant
  AND initiating_user_id=_expected_actor AND work_kind='knowledge_publish' AND capability_key='knowledge.publish';
 IF NOT FOUND OR NOT pg_catalog.pg_input_is_valid(coalesce(w.request_payload->>'extraction_work_id',''),'uuid') THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO intake FROM public.paige_durable_work WHERE id=(w.request_payload->>'extraction_work_id')::uuid
  AND tenant_id=_expected_tenant AND work_kind='knowledge_extract' AND capability_key='knowledge.extract' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_publication_work_id AND tenant_id=_expected_tenant
  AND initiating_user_id=_expected_actor AND work_kind='knowledge_publish' AND capability_key='knowledge.publish' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 source:=public._paige_chat_knowledge_source(_expected_tenant,_expected_actor,w.id);
 IF source->>'extractionWorkId' IS DISTINCT FROM intake.id::text THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 IF source->>'documentId' IS DISTINCT FROM _document_id::text
  OR source->>'documentRevision' IS DISTINCT FROM _document_revision::text
  OR source->>'extractionIntentId' IS DISTINCT FROM _extraction_intent_id::text
  OR source->>'sourceSha256' IS DISTINCT FROM _source_sha256 THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 prior:=w.chat_source_link;
 IF prior IS NOT NULL THEN
  PERFORM public.inspect_paige_chat_knowledge_link(_expected_tenant,_expected_actor,_thread_id,w.id);
  IF host_thread IS NULL THEN host_thread:=(prior->>'threadId')::uuid; END IF;
 END IF;
 IF prior IS NOT NULL AND (prior->>'threadId' IS DISTINCT FROM host_thread::text
  OR prior->>'actorId' IS DISTINCT FROM _expected_actor::text
  OR prior - ARRAY['schemaVersion','actorId','tenantId','threadId','turnId','linkRevision'] IS DISTINCT FROM source) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 rev:=coalesce((prior->>'linkRevision')::integer,0);
 IF intake.chat_source_link IS NOT NULL THEN
  IF public.inspect_paige_chat_knowledge_intake(_expected_tenant,_expected_actor,NULL,intake.id)->>'current' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
  IF host_thread IS NULL THEN host_thread:=(intake.chat_source_link->>'threadId')::uuid; END IF;
  IF intake.chat_source_link->>'threadId' IS DISTINCT FROM host_thread::text
   OR (intake.chat_source_link->>'turnId' IS NOT NULL AND intake.chat_source_link->>'turnId' IS DISTINCT FROM _turn_id::text) THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 END IF;
 IF host_thread IS NULL THEN
  IF _expected_link_revision<>0 THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
  -- Same original Work lock makes creation+annotation atomic and replay-safe.
  -- This is a real conversation, never a synthetic user/assistant/system turn.
  host_thread:=public.paige_chat_thread_create(NULL,'coach','New chat',NULL);
 END IF;
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,host_thread);
 target:=source||jsonb_build_object('schemaVersion',1,'actorId',_expected_actor,'tenantId',_expected_tenant,
  'threadId',host_thread,'turnId',_turn_id,'linkRevision',rev);
 IF prior IS NOT NULL AND prior=target THEN
  RETURN public.inspect_paige_chat_knowledge_link(_expected_tenant,_expected_actor,_thread_id,w.id);
 END IF;
 IF rev<>_expected_link_revision OR (prior IS NOT NULL AND prior->>'turnId' IS NOT NULL)
  OR (w.thread_id IS NOT NULL AND w.thread_id<>host_thread) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 IF _turn_id IS NOT NULL THEN
  SELECT * INTO turn FROM public.paige_chat_turns WHERE id=_turn_id AND thread_id=host_thread FOR UPDATE;
  IF NOT FOUND OR turn.role<>'user' OR turn.interactive_actor_id IS DISTINCT FROM _expected_actor
   OR turn.interactive_tenant_id IS DISTINCT FROM _expected_tenant OR turn.interactive_intent_id IS NULL THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_MESSAGE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  links:=coalesce(turn.bundle_ref->'paige_record_links','[]'::jsonb);
  IF jsonb_typeof(links)<>'array' THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_MESSAGE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF NOT links @> jsonb_build_array(jsonb_build_object('destination','business_knowledge','record_id',_document_id)) THEN
   IF jsonb_array_length(links)>=6 THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_LIMIT' USING ERRCODE='54000'; END IF;
   links:=links||jsonb_build_array(jsonb_build_object('destination','business_knowledge','record_id',_document_id));
  END IF;
  UPDATE public.paige_chat_turns SET
   bundle_ref=jsonb_set(coalesce(bundle_ref,'{}'::jsonb),'{paige_record_links}',links) WHERE id=turn.id;
 END IF;
 -- Only this original row's host annotation changes. E13 immutable identity,
 -- including thread_id, is deliberately never rewritten. Worker/version,
 -- request/authority/terminal receipt and every execution field remain untouched.
 target:=jsonb_set(target,'{linkRevision}',to_jsonb(rev+1));
 UPDATE public.paige_durable_work SET chat_source_link=target WHERE id=w.id;
 RETURN public.inspect_paige_chat_knowledge_link(_expected_tenant,_expected_actor,host_thread,w.id);
END $$;

-- Admission is a durable original extraction, NOT reviewed content/publication.
CREATE OR REPLACE FUNCTION public._paige_chat_knowledge_intake_source(_tenant uuid,_actor uuid,_work uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE x public.paige_durable_work; p public.paige_durable_work; d jsonb; binding jsonb;
BEGIN
 SELECT * INTO x FROM public.paige_durable_work WHERE id=_work AND tenant_id=_tenant AND initiating_user_id=_actor
  AND work_kind='knowledge_extract' AND capability_key='knowledge.extract' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(x.id))
  OR NOT pg_catalog.pg_input_is_valid(coalesce(x.request_payload->>'document_id',''),'uuid')
  OR NOT pg_catalog.pg_input_is_valid(coalesce(x.request_payload->>'revision',''),'integer')
  OR (x.request_payload->>'revision')::integer<1 OR x.intent_id IS NULL
  OR coalesce(x.request_payload->>'input_hash','') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 d:=public.read_tenant_knowledge_review(_tenant,(x.request_payload->>'document_id')::uuid);
 IF d->>'extraction_work_id'=x.id::text THEN binding:=d->'extraction_source_binding';
 ELSIF d->'extraction_work_id'='null'::jsonb AND d->>'record_state'='canonical'
  AND d#>>'{publication,association}'='matched'
  AND pg_catalog.pg_input_is_valid(coalesce(d#>>'{publication,work_id}',''),'uuid') THEN
  SELECT * INTO p FROM public.paige_durable_work WHERE id=(d#>>'{publication,work_id}')::uuid
   AND tenant_id=_tenant AND work_kind='knowledge_publish' AND capability_key='knowledge.publish';
  IF NOT FOUND OR p.request_payload->>'extraction_work_id' IS DISTINCT FROM x.id::text THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  binding:=d->'source_binding';
 ELSE RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 IF binding<>'null'::jsonb AND (binding->>'sha256' IS DISTINCT FROM x.request_payload->>'input_hash'
  OR NOT public.knowledge_source_binding_valid(binding,_tenant)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('phase','intake','documentId',d->>'document_id','documentRevision',(d->>'revision')::integer,
  'sourceRevision',(x.request_payload->>'revision')::integer,'sourceSha256',x.request_payload->>'input_hash',
  'extractionWorkId',x.id,'extractionIntentId',x.intent_id);
END $$;

CREATE OR REPLACE FUNCTION public.inspect_paige_chat_knowledge_intake(
 _expected_tenant uuid,_expected_actor uuid,_thread_id uuid,_extraction_work_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x public.paige_durable_work; link jsonb; source jsonb; host_thread uuid:=_thread_id;
BEGIN
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,host_thread);
 SELECT * INTO x FROM public.paige_durable_work WHERE id=_extraction_work_id AND tenant_id=_expected_tenant
  AND initiating_user_id=_expected_actor AND work_kind='knowledge_extract' AND capability_key='knowledge.extract' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(x.id)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF x.chat_source_link IS NULL THEN RETURN jsonb_build_object('status','absent_at_read'); END IF;
 link:=x.chat_source_link;
 IF jsonb_typeof(link)<>'object' OR link->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR link->>'phase' IS DISTINCT FROM 'intake' OR link->'linkRevision' NOT IN ('1'::jsonb,'2'::jsonb)
  OR NOT link ? 'linkRevision' OR NOT link ? 'turnId'
  OR NOT pg_catalog.pg_input_is_valid(coalesce(link->>'threadId',''),'uuid')
  OR (link->'turnId'<>'null'::jsonb AND NOT pg_catalog.pg_input_is_valid(coalesce(link->>'turnId',''),'uuid'))
  OR link->>'actorId' IS DISTINCT FROM _expected_actor::text OR link->>'tenantId' IS DISTINCT FROM _expected_tenant::text THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 IF host_thread IS NULL THEN host_thread:=(link->>'threadId')::uuid; END IF;
 IF link->>'threadId' IS DISTINCT FROM host_thread::text THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,host_thread);
 BEGIN source:=public._paige_chat_knowledge_intake_source(_expected_tenant,_expected_actor,x.id);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '40001' OR SQLSTATE 'P0002' THEN
  RETURN jsonb_build_object('status','recorded','current',false,'reason','source_unavailable_or_changed'); END;
 -- Normal extraction/review advances the document; the admission receipt is
 -- immutable. Current document revision is returned separately, never approval.
 IF link-ARRAY['schemaVersion','actorId','tenantId','threadId','turnId','linkRevision','documentRevision']
  IS DISTINCT FROM source-'documentRevision' THEN
  RETURN jsonb_build_object('status','recorded','current',false,'reason','source_unavailable_or_changed'); END IF;
 IF link->>'turnId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_chat_turns t WHERE t.id=(link->>'turnId')::uuid
  AND t.thread_id=host_thread AND t.role='user' AND t.interactive_actor_id=_expected_actor AND t.interactive_tenant_id=_expected_tenant
  AND t.interactive_intent_id IS NOT NULL AND t.bundle_ref->'paige_record_links' @>
   jsonb_build_array(jsonb_build_object('destination','business_knowledge','record_id',link->>'documentId'))) THEN
  RETURN jsonb_build_object('status','recorded','current',false,'reason','message_unavailable_or_changed'); END IF;
 RETURN jsonb_build_object('status','recorded','current',true,'reference',link,
  'currentDocumentRevision',(source->>'documentRevision')::integer,'extractionStatus',x.status);
END $$;

CREATE OR REPLACE FUNCTION public.stage_paige_chat_knowledge_intake(
 _expected_tenant uuid,_expected_actor uuid,_thread_id uuid,_turn_id uuid,_extraction_work_id uuid,
 _document_id uuid,_expected_source_revision integer,_extraction_intent_id uuid,_source_sha256 text,_expected_link_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x public.paige_durable_work; source jsonb; prior jsonb; target jsonb; host_thread uuid:=_thread_id;
 rev integer; turn public.paige_chat_turns; links jsonb; paired jsonb;
BEGIN
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,host_thread);
 IF _document_id IS NULL OR _extraction_intent_id IS NULL OR _source_sha256 IS NULL OR _source_sha256 !~ '^[a-f0-9]{64}$'
  OR (_expected_source_revision IS NOT NULL AND _expected_source_revision<1)
  OR _expected_link_revision IS NULL OR _expected_link_revision NOT IN (0,1)
  OR (_thread_id IS NULL AND _turn_id IS NOT NULL) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM public.paige_durable_work WHERE id=_extraction_work_id AND tenant_id=_expected_tenant
  AND initiating_user_id=_expected_actor AND work_kind='knowledge_extract' AND capability_key='knowledge.extract' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 source:=public._paige_chat_knowledge_intake_source(_expected_tenant,_expected_actor,x.id);
 IF source->>'documentId' IS DISTINCT FROM _document_id::text OR source->>'sourceSha256' IS DISTINCT FROM _source_sha256
  OR source->>'extractionIntentId' IS DISTINCT FROM _extraction_intent_id::text
  OR (_expected_source_revision IS NOT NULL AND source->>'sourceRevision' IS DISTINCT FROM _expected_source_revision::text) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 prior:=x.chat_source_link;
 IF prior IS NOT NULL THEN
  IF public.inspect_paige_chat_knowledge_intake(_expected_tenant,_expected_actor,host_thread,x.id)->>'current' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
  IF host_thread IS NULL THEN host_thread:=(prior->>'threadId')::uuid; END IF;
  source:=jsonb_set(source,'{documentRevision}',prior->'documentRevision');
 END IF;
 rev:=coalesce((prior->>'linkRevision')::integer,0);
 IF prior IS NULL THEN
  SELECT p.chat_source_link INTO paired FROM public.paige_durable_work p JOIN public.tenant_knowledge_docs d
   ON d.id=_document_id AND d.tenant_id=_expected_tenant AND d.active_generation_id=p.id
   WHERE p.tenant_id=_expected_tenant AND p.initiating_user_id=_expected_actor
    AND p.work_kind='knowledge_publish' AND p.capability_key='knowledge.publish'
    AND p.request_payload->>'extraction_work_id'=x.id::text AND p.chat_source_link IS NOT NULL;
  IF paired IS NOT NULL THEN
   IF paired->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR paired->>'actorId' IS DISTINCT FROM _expected_actor::text OR paired->>'tenantId' IS DISTINCT FROM _expected_tenant::text
    OR paired->>'extractionWorkId' IS DISTINCT FROM x.id::text OR paired->>'documentId' IS DISTINCT FROM _document_id::text
    OR NOT pg_catalog.pg_input_is_valid(coalesce(paired->>'threadId',''),'uuid') THEN
    RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
   IF host_thread IS NULL THEN host_thread:=(paired->>'threadId')::uuid; END IF;
   IF paired->>'threadId' IS DISTINCT FROM host_thread::text THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
  END IF;
 END IF;
 IF host_thread IS NULL THEN
  IF _expected_link_revision<>0 THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
  host_thread:=public.paige_chat_thread_create(NULL,'coach','New chat',NULL);
 END IF;
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,host_thread);
 target:=source||jsonb_build_object('schemaVersion',1,'actorId',_expected_actor,'tenantId',_expected_tenant,
  'threadId',host_thread,'turnId',_turn_id,'linkRevision',rev);
 IF prior=target THEN RETURN public.inspect_paige_chat_knowledge_intake(_expected_tenant,_expected_actor,host_thread,x.id); END IF;
 IF rev<>_expected_link_revision OR (prior IS NOT NULL AND (prior->>'turnId' IS NOT NULL
  OR prior->>'threadId' IS DISTINCT FROM host_thread::text OR prior->>'actorId' IS DISTINCT FROM _expected_actor::text
  OR prior-ARRAY['schemaVersion','actorId','tenantId','threadId','turnId','linkRevision'] IS DISTINCT FROM source)) THEN
  RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_CONFLICT' USING ERRCODE='40001'; END IF;
 IF _turn_id IS NOT NULL THEN
  SELECT * INTO turn FROM public.paige_chat_turns WHERE id=_turn_id AND thread_id=host_thread FOR UPDATE;
  IF NOT FOUND OR turn.role<>'user' OR turn.interactive_actor_id IS DISTINCT FROM _expected_actor
   OR turn.interactive_tenant_id IS DISTINCT FROM _expected_tenant OR turn.interactive_intent_id IS NULL THEN
   RAISE EXCEPTION 'CHAT_KNOWLEDGE_MESSAGE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  links:=coalesce(turn.bundle_ref->'paige_record_links','[]'::jsonb);
  IF jsonb_typeof(links)<>'array' THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_MESSAGE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF NOT links @> jsonb_build_array(jsonb_build_object('destination','business_knowledge','record_id',_document_id)) THEN
   IF jsonb_array_length(links)>=6 THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_LINK_LIMIT' USING ERRCODE='54000'; END IF;
   links:=links||jsonb_build_array(jsonb_build_object('destination','business_knowledge','record_id',_document_id)); END IF;
  UPDATE public.paige_chat_turns SET bundle_ref=jsonb_set(coalesce(bundle_ref,'{}'),'{paige_record_links}',links) WHERE id=turn.id;
 END IF;
 UPDATE public.paige_durable_work SET chat_source_link=jsonb_set(target,'{linkRevision}',to_jsonb(rev+1)) WHERE id=x.id;
 RETURN public.inspect_paige_chat_knowledge_intake(_expected_tenant,_expected_actor,host_thread,x.id);
END $$;

CREATE OR REPLACE FUNCTION public.list_paige_chat_knowledge_links(
 _expected_tenant uuid,_expected_actor uuid,_thread_id uuid,_after_work_id uuid DEFAULT NULL,_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w record; items jsonb:='[]'; result jsonb; last_id uuid; total integer:=0;
BEGIN
 PERFORM public._paige_chat_knowledge_scope(_expected_tenant,_expected_actor,_thread_id);
 IF _thread_id IS NULL OR _limit IS NULL OR _limit<1 OR _limit>20 THEN RAISE EXCEPTION 'CHAT_KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 FOR w IN SELECT x.id,x.work_kind FROM public.paige_durable_work x WHERE x.tenant_id=_expected_tenant AND x.initiating_user_id=_expected_actor
  AND x.chat_source_link->>'threadId'=_thread_id::text AND x.chat_source_link IS NOT NULL
  AND ((x.work_kind='knowledge_publish' AND x.capability_key='knowledge.publish') OR
   (x.work_kind='knowledge_extract' AND x.capability_key='knowledge.extract' AND NOT EXISTS(SELECT 1 FROM public.paige_durable_work p
    WHERE p.tenant_id=x.tenant_id AND p.initiating_user_id=x.initiating_user_id AND p.work_kind='knowledge_publish' AND p.capability_key='knowledge.publish'
     AND p.chat_source_link->>'threadId'=_thread_id::text AND p.chat_source_link->>'extractionWorkId'=x.id::text)))
  AND (_after_work_id IS NULL OR x.id>_after_work_id) ORDER BY x.id LIMIT _limit LOOP
  IF w.work_kind='knowledge_extract' THEN result:=public.inspect_paige_chat_knowledge_intake(_expected_tenant,_expected_actor,_thread_id,w.id);
  ELSE result:=public.inspect_paige_chat_knowledge_link(_expected_tenant,_expected_actor,_thread_id,w.id); END IF;
  -- Unavailable historic links expose neither source IDs nor private labels.
  items:=items||jsonb_build_array(result); last_id:=w.id; total:=total+1;
 END LOOP;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN total=_limit THEN last_id ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION public._paige_chat_knowledge_scope(uuid,uuid,uuid),public._paige_chat_knowledge_source(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._paige_chat_knowledge_intake_source(uuid,uuid,uuid),public.inspect_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid),public.stage_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inspect_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid),public.stage_paige_chat_knowledge_intake(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.inspect_paige_chat_knowledge_link(uuid,uuid,uuid,uuid),public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer),public.list_paige_chat_knowledge_links(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inspect_paige_chat_knowledge_link(uuid,uuid,uuid,uuid),public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer),public.list_paige_chat_knowledge_links(uuid,uuid,uuid,uuid,integer) TO authenticated;
COMMIT;
