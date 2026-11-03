-- Preserve original authority, state and receipt logic while taking the actor Auth lock first.
-- Applied 20015/20016/20017 are immutable; this forward repair removes cross-API lock inversions.
DO $repair$
DECLARE r record; target oid; before_meta jsonb; definition text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('submit_tenant_knowledge_publication','166a5b2246dfb4e373ccd394c0ee389a','c7b3a7e1d49b06f04b385b34a3287d87',$old$
DECLARE actor uuid:=auth.uid(); d public.tenant_knowledge_docs; x public.paige_durable_work;
 request_hash text; created record; manifest jsonb; reviewed text;
BEGIN
 IF actor IS NULL OR NOT public.lock_knowledge_extraction_authority(actor,p_expected_tenant) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF p_doc_id IS NULL OR p_work_id IS NULL OR p_intent_id IS NULL OR p_expected_revision IS NULL OR p_review_hash IS NULL OR length(p_review_hash)<>64 THEN RAISE EXCEPTION 'KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM public.paige_durable_work WHERE id=p_work_id AND tenant_id=p_expected_tenant FOR SHARE;
 IF NOT FOUND OR x.work_kind<>'knowledge_extract' OR x.capability_key<>'knowledge.extract'
  OR x.status<>'succeeded' OR x.request_payload->>'document_id' IS DISTINCT FROM p_doc_id::text THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_NOT_READY' USING ERRCODE='55000'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=p_doc_id AND tenant_id=p_expected_tenant AND extraction_work_id=p_work_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF d.revision<>p_expected_revision THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF d.pending_review IS NULL OR d.pending_review->>'reviewed_content' IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_NOT_READY' USING ERRCODE='55000'; END IF;
 reviewed:=d.pending_review->>'reviewed_content';
 IF encode(sha256(convert_to(reviewed,'UTF8')),'hex') IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 manifest:=public.knowledge_publication_manifest(reviewed,'voyage-3');
 IF manifest IS NULL OR NOT public.knowledge_publication_manifest_valid(manifest) THEN RAISE EXCEPTION 'KNOWLEDGE_OUTPUT_INVALID' USING ERRCODE='22023'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('document',d.id,'revision',p_expected_revision,'review',p_review_hash,'manifest',manifest,'source',d.extraction_source_binding-'bound_at')::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||d.id::text||':publish',0));
 -- Exact intent replay is checked BEFORE the single-unresolved rule: an identical replay of
 -- a live intent IS that publication, not a second one (independent recheck catch).
 SELECT * INTO x FROM public.paige_durable_work WHERE tenant_id=p_expected_tenant AND initiating_user_id=actor AND intent_id=p_intent_id AND work_kind='knowledge_publish' FOR UPDATE;
 IF FOUND THEN
  IF x.request_payload->>'request_hash' IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('work_id',x.id,'document_id',d.id::text,'status',x.status,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_durable_work WHERE tenant_id=p_expected_tenant AND work_kind='knowledge_publish'
   AND status IN ('claimed','blocked','expired','outcome_unknown') AND request_payload->>'document_id'=d.id::text) THEN RAISE EXCEPTION 'KNOWLEDGE_PUBLICATION_PENDING' USING ERRCODE='55000'; END IF;
 SELECT * INTO created FROM public.create_paige_durable_work(p_expected_tenant,actor,p_intent_id,NULL,'knowledge.publish','knowledge_publish',jsonb_build_object('tenant_id',p_expected_tenant,'actor_user_id',actor,'source','knowledge_publication'),'tenant:'||p_expected_tenant::text,60,3);
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',d.id,'extraction_work_id',p_work_id,'revision',p_expected_revision,'review_hash',p_review_hash,'manifest',manifest,'source',d.extraction_source_binding,'request_hash',request_hash),safe_summary='Knowledge publication is queued.',version=version+1 WHERE id=created.work_id;
 -- Same worker and cron recovery path as extraction: the missed wake never loses the
 -- envelope, and recover reconciles rather than re-embedding (added with worker adoption).
 BEGIN
  PERFORM net.http_post(url:='https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-document-worker',headers:=jsonb_build_object('Content-Type','application/json','x-cron-token',public.cron_token_header()),body:=jsonb_build_object('mode','knowledge-publish','work_id',created.work_id));
 EXCEPTION WHEN OTHERS THEN NULL; END;
 -- The intent hash lives in the work payload alone: any doc UPDATE here would fire the
 -- canonical revision-bump trigger and desynchronize the frozen revision (found by the
 -- publication behavior proof: docrev drifted 3->4 and start correctly refused).
 RETURN jsonb_build_object('work_id',created.work_id,'document_id',d.id::text,'status','claimed','replayed',false,'revision',p_expected_revision);
END $old$,$new$
DECLARE actor uuid:=auth.uid(); d public.tenant_knowledge_docs; x public.paige_durable_work;
 request_hash text; created record; manifest jsonb; reviewed text;
BEGIN
 IF actor IS NULL OR NOT public.lock_knowledge_extraction_authority(actor,p_expected_tenant) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF p_doc_id IS NULL OR p_work_id IS NULL OR p_intent_id IS NULL OR p_expected_revision IS NULL OR p_review_hash IS NULL OR length(p_review_hash)<>64 THEN RAISE EXCEPTION 'KNOWLEDGE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM public.paige_durable_work WHERE id=p_work_id AND tenant_id=p_expected_tenant FOR SHARE;
 IF NOT FOUND OR x.work_kind<>'knowledge_extract' OR x.capability_key<>'knowledge.extract'
  OR x.status<>'succeeded' OR x.request_payload->>'document_id' IS DISTINCT FROM p_doc_id::text THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_NOT_READY' USING ERRCODE='55000'; END IF;
 -- Existing replay Work precedes the document, matching native recovery.
 PERFORM 1 FROM public.paige_durable_work
 WHERE tenant_id=p_expected_tenant AND initiating_user_id=actor AND intent_id=p_intent_id
  AND work_kind='knowledge_publish' FOR UPDATE;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=p_doc_id AND tenant_id=p_expected_tenant AND extraction_work_id=p_work_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF d.revision<>p_expected_revision THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF d.pending_review IS NULL OR d.pending_review->>'reviewed_content' IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_NOT_READY' USING ERRCODE='55000'; END IF;
 reviewed:=d.pending_review->>'reviewed_content';
 IF encode(sha256(convert_to(reviewed,'UTF8')),'hex') IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 manifest:=public.knowledge_publication_manifest(reviewed,'voyage-3');
 IF manifest IS NULL OR NOT public.knowledge_publication_manifest_valid(manifest) THEN RAISE EXCEPTION 'KNOWLEDGE_OUTPUT_INVALID' USING ERRCODE='22023'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('document',d.id,'revision',p_expected_revision,'review',p_review_hash,'manifest',manifest,'source',d.extraction_source_binding-'bound_at')::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||d.id::text||':publish',0));
 -- Exact intent replay is checked BEFORE the single-unresolved rule: an identical replay of
 -- a live intent IS that publication, not a second one (independent recheck catch).
 SELECT * INTO x FROM public.paige_durable_work WHERE tenant_id=p_expected_tenant AND initiating_user_id=actor AND intent_id=p_intent_id AND work_kind='knowledge_publish' FOR UPDATE;
 IF FOUND THEN
  IF x.request_payload->>'request_hash' IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('work_id',x.id,'document_id',d.id::text,'status',x.status,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_durable_work WHERE tenant_id=p_expected_tenant AND work_kind='knowledge_publish'
   AND status IN ('claimed','blocked','expired','outcome_unknown') AND request_payload->>'document_id'=d.id::text) THEN RAISE EXCEPTION 'KNOWLEDGE_PUBLICATION_PENDING' USING ERRCODE='55000'; END IF;
 SELECT * INTO created FROM public.create_paige_durable_work(p_expected_tenant,actor,p_intent_id,NULL,'knowledge.publish','knowledge_publish',jsonb_build_object('tenant_id',p_expected_tenant,'actor_user_id',actor,'source','knowledge_publication'),'tenant:'||p_expected_tenant::text,60,3);
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',d.id,'extraction_work_id',p_work_id,'revision',p_expected_revision,'review_hash',p_review_hash,'manifest',manifest,'source',d.extraction_source_binding,'request_hash',request_hash),safe_summary='Knowledge publication is queued.',version=version+1 WHERE id=created.work_id;
 -- Same worker and cron recovery path as extraction: the missed wake never loses the
 -- envelope, and recover reconciles rather than re-embedding (added with worker adoption).
 BEGIN
  PERFORM net.http_post(url:='https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-document-worker',headers:=jsonb_build_object('Content-Type','application/json','x-cron-token',public.cron_token_header()),body:=jsonb_build_object('mode','knowledge-publish','work_id',created.work_id));
 EXCEPTION WHEN OTHERS THEN NULL; END;
 -- The intent hash lives in the work payload alone: any doc UPDATE here would fire the
 -- canonical revision-bump trigger and desynchronize the frozen revision (found by the
 -- publication behavior proof: docrev drifted 3->4 and start correctly refused).
 RETURN jsonb_build_object('work_id',created.work_id,'document_id',d.id::text,'status','claimed','replayed',false,'revision',p_expected_revision);
END $new$),
 ('start_knowledge_extraction','bae1d3185bc0892008298bff93e71fc6','81f7e234a137dea1409e9772ab41f82c',$old$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() OR w.dispatch_started_attempt>=w.attempt_count THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_CLAIMABLE' USING ERRCODE='55000'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,'Knowledge extraction is paused because workspace access changed.','authority_changed','authority_changed',300,false);
  RETURN jsonb_build_object('status','blocked','work_id',w.id);
 END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id AND extraction_work_id=w.id FOR UPDATE;
 IF NOT FOUND OR d.revision<>(w.request_payload->>'revision')::integer THEN
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,'Knowledge extraction is paused because the document changed.','revision_changed','revision_changed',300,false);
  RETURN jsonb_build_object('status','blocked','work_id',w.id);
 END IF;
 UPDATE public.paige_durable_work SET dispatch_started_attempt=attempt_count,lease_until=now()+interval '2 minutes',heartbeat_at=now(),version=version+1 WHERE id=w.id;
 RETURN jsonb_build_object('status','claimed','work_id',w.id,'server_key',w.idempotency_key,'attempt',w.attempt_count,'tenant_id',w.tenant_id,'actor_id',w.initiating_user_id,'document_id',d.id,'revision',d.revision,'input',d.extraction_input,'source',d.extraction_source_binding,'input_hash',w.request_payload->>'input_hash');
END $old$,$new$
DECLARE login_lock_actor uuid; login_lock_tenant uuid; w public.paige_durable_work; d public.tenant_knowledge_docs;
BEGIN
 SELECT initiating_user_id,tenant_id INTO login_lock_actor,login_lock_tenant
 FROM public.paige_durable_work WHERE id=_work_id;
 PERFORM 1 FROM auth.users WHERE id=login_lock_actor FOR NO KEY UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF FOUND AND (w.initiating_user_id IS DISTINCT FROM login_lock_actor
  OR w.tenant_id IS DISTINCT FROM login_lock_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF NOT FOUND OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() OR w.dispatch_started_attempt>=w.attempt_count THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_CLAIMABLE' USING ERRCODE='55000'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,'Knowledge extraction is paused because workspace access changed.','authority_changed','authority_changed',300,false);
  RETURN jsonb_build_object('status','blocked','work_id',w.id);
 END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id AND extraction_work_id=w.id FOR UPDATE;
 IF NOT FOUND OR d.revision<>(w.request_payload->>'revision')::integer THEN
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,'Knowledge extraction is paused because the document changed.','revision_changed','revision_changed',300,false);
  RETURN jsonb_build_object('status','blocked','work_id',w.id);
 END IF;
 UPDATE public.paige_durable_work SET dispatch_started_attempt=attempt_count,lease_until=now()+interval '2 minutes',heartbeat_at=now(),version=version+1 WHERE id=w.id;
 RETURN jsonb_build_object('status','claimed','work_id',w.id,'server_key',w.idempotency_key,'attempt',w.attempt_count,'tenant_id',w.tenant_id,'actor_id',w.initiating_user_id,'document_id',d.id,'revision',d.revision,'input',d.extraction_input,'source',d.extraction_source_binding,'input_hash',w.request_payload->>'input_hash');
END $new$),
 ('complete_knowledge_extraction','ad8ba3ba3ea7bd788bca70eccb639899','82406858b84b91cd38171709272611df',$old$
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
END $old$,$new$
DECLARE login_lock_actor uuid; login_lock_tenant uuid; w public.paige_durable_work; d public.tenant_knowledge_docs; outcome text:='capability_succeeded'; result jsonb; stamped jsonb;
BEGIN
 SELECT initiating_user_id,tenant_id INTO login_lock_actor,login_lock_tenant
 FROM public.paige_durable_work WHERE id=_work_id;
 PERFORM 1 FROM auth.users WHERE id=login_lock_actor FOR NO KEY UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF FOUND AND (w.initiating_user_id IS DISTINCT FROM login_lock_actor
  OR w.tenant_id IS DISTINCT FROM login_lock_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
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
END $new$),
 ('lock_knowledge_review_target','d08ba248781cc5e1d571cb3e980d5169','479dac9a4699a1335ab59e4e781be8c9',$old$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=work FOR UPDATE;
 IF NOT FOUND OR w.tenant_id IS DISTINCT FROM t OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NULL OR NOT public.lock_knowledge_extraction_authority(auth.uid(),t) OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(work)) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=doc AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF w.request_payload->>'document_id' IS DISTINCT FROM doc::text OR d.extraction_work_id IS DISTINCT FROM work OR rev IS NULL OR d.revision<>rev THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN d;
END $old$,$new$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=auth.uid() FOR NO KEY UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=work FOR UPDATE;
 IF NOT FOUND OR w.tenant_id IS DISTINCT FROM t OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NULL OR NOT public.lock_knowledge_extraction_authority(auth.uid(),t) OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(work)) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=doc AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF w.request_payload->>'document_id' IS DISTINCT FROM doc::text OR d.extraction_work_id IS DISTINCT FROM work OR rev IS NULL OR d.revision<>rev THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN d;
END $new$),
 ('start_knowledge_publication','13e9177548bc46f1e3549c55e5d8afa2','cbf3b87f65d268247f992e55da765992',$old$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; c record; chunks jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_publish' OR w.capability_key<>'knowledge.publish' THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF w.status<>'claimed' THEN RETURN jsonb_build_object('status',w.status,'work_id',w.id); END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id FOR UPDATE;
 IF NOT FOUND OR d.revision<>(w.request_payload->>'revision')::integer
  OR d.pending_review->>'reviewed_content' IS NULL
  OR encode(sha256(convert_to(d.pending_review->>'reviewed_content','UTF8')),'hex') IS DISTINCT FROM w.request_payload->>'review_hash'
  OR public.knowledge_publication_manifest(d.pending_review->>'reviewed_content',w.request_payload->'manifest'->>'model') IS DISTINCT FROM w.request_payload->'manifest' THEN
  RAISE EXCEPTION 'KNOWLEDGE_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 FOR c IN SELECT * FROM public.knowledge_publication_chunks(d.pending_review->>'reviewed_content') LOOP
  chunks:=chunks||jsonb_build_object('index',c.chunk_index,'text',c.chunk_text,'sha256',c.chunk_sha256);
 END LOOP;
 UPDATE public.paige_durable_work SET dispatch_started_attempt=attempt_count,lease_until=now()+interval '2 minutes',heartbeat_at=now(),version=version+1 WHERE id=w.id;
 RETURN jsonb_build_object('status','claimed','work_id',w.id,'server_key',w.idempotency_key,'attempt',w.attempt_count,'revision',d.revision,'model',w.request_payload->'manifest'->>'model','dimensions',1024,'chunks',chunks);
END $old$,$new$
DECLARE login_lock_actor uuid; login_lock_tenant uuid; w public.paige_durable_work; d public.tenant_knowledge_docs; c record; chunks jsonb:='[]'::jsonb;
BEGIN
 SELECT initiating_user_id,tenant_id INTO login_lock_actor,login_lock_tenant
 FROM public.paige_durable_work WHERE id=_work_id;
 PERFORM 1 FROM auth.users WHERE id=login_lock_actor FOR NO KEY UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF FOUND AND (w.initiating_user_id IS DISTINCT FROM login_lock_actor
  OR w.tenant_id IS DISTINCT FROM login_lock_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF NOT FOUND OR w.work_kind<>'knowledge_publish' OR w.capability_key<>'knowledge.publish' THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF w.status<>'claimed' THEN RETURN jsonb_build_object('status',w.status,'work_id',w.id); END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id FOR UPDATE;
 IF NOT FOUND OR d.revision<>(w.request_payload->>'revision')::integer
  OR d.pending_review->>'reviewed_content' IS NULL
  OR encode(sha256(convert_to(d.pending_review->>'reviewed_content','UTF8')),'hex') IS DISTINCT FROM w.request_payload->>'review_hash'
  OR public.knowledge_publication_manifest(d.pending_review->>'reviewed_content',w.request_payload->'manifest'->>'model') IS DISTINCT FROM w.request_payload->'manifest' THEN
  RAISE EXCEPTION 'KNOWLEDGE_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 FOR c IN SELECT * FROM public.knowledge_publication_chunks(d.pending_review->>'reviewed_content') LOOP
  chunks:=chunks||jsonb_build_object('index',c.chunk_index,'text',c.chunk_text,'sha256',c.chunk_sha256);
 END LOOP;
 UPDATE public.paige_durable_work SET dispatch_started_attempt=attempt_count,lease_until=now()+interval '2 minutes',heartbeat_at=now(),version=version+1 WHERE id=w.id;
 RETURN jsonb_build_object('status','claimed','work_id',w.id,'server_key',w.idempotency_key,'attempt',w.attempt_count,'revision',d.revision,'model',w.request_payload->'manifest'->>'model','dimensions',1024,'chunks',chunks);
END $new$),
 ('stage_knowledge_publication','6847083ced382b938b364250c74ccb6b','ad728fe4df212f7edfabecfed3457998',$old$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; c jsonb; i integer; n integer; hashes jsonb; vec double precision[]; piece text; staged integer:=0;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_publish' OR w.capability_key<>'knowledge.publish' OR w.idempotency_key IS DISTINCT FROM _server_key THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF _attempt IS NULL OR w.attempt_count<>_attempt OR w.dispatch_started_attempt<>_attempt THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF w.status='succeeded' THEN RETURN jsonb_build_object('staged',0,'already_complete',true); END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id FOR UPDATE;
 IF NOT FOUND OR d.revision<>_revision OR d.revision IS DISTINCT FROM (w.request_payload->>'revision')::integer THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 hashes:=w.request_payload->'manifest'->'chunk_hashes'; n:=jsonb_array_length(hashes);
 IF _chunks IS NULL OR jsonb_typeof(_chunks)<>'array' OR jsonb_array_length(_chunks)=0 OR jsonb_array_length(_chunks)>n THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INVALID' USING ERRCODE='22023'; END IF;
 -- Fence: an abandoned stage cannot be extended by a re-dispatched worker because the
 -- attempt check above (attempt_count + dispatch_started_attempt) refuses the old attempt.
 FOR c IN SELECT * FROM jsonb_array_elements(_chunks) LOOP
  IF c->>'index' IS NULL OR (c->>'index')::int NOT BETWEEN 0 AND n-1 OR c->>'sha256' IS DISTINCT FROM hashes->>((c->>'index')::int)
   OR jsonb_typeof(c->'embedding')<>'array' OR jsonb_array_length(c->'embedding')<>1024
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'embedding') e WHERE jsonb_typeof(e)<>'number' OR (e#>>'{}')::double precision IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)) THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INVALID' USING ERRCODE='22023'; END IF;
  SELECT array_agg((e#>>'{}')::double precision ORDER BY ord) INTO vec FROM jsonb_array_elements(c->'embedding') WITH ORDINALITY e(e,ord);
  i:=(c->>'index')::int;
  -- Content is the SERVER-derived canonical chunk text, never caller-supplied and never
  -- empty: retrieval reads c.content directly, so an unstored text would silently degrade
  -- every published generation to title-only matches (independent review P2).
  SELECT chunk_text INTO piece FROM public.knowledge_publication_chunks(d.pending_review->>'reviewed_content') WHERE chunk_index=i;
  IF piece IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.tenant_knowledge_chunks(id,doc_id,tenant_id,chunk_index,content,embedding,generation_id)
   VALUES(md5(d.id::text||':'||w.id::text||':'||i)::uuid,d.id,w.tenant_id,i,piece,vec,w.id)
   ON CONFLICT DO NOTHING;
  staged:=staged+1;
 END LOOP;
 UPDATE public.paige_durable_work SET heartbeat_at=now(),version=version+1 WHERE id=w.id;
 RETURN jsonb_build_object('staged',staged,'total_expected',n);
END $old$,$new$
DECLARE login_lock_actor uuid; login_lock_tenant uuid; w public.paige_durable_work; d public.tenant_knowledge_docs; c jsonb; i integer; n integer; hashes jsonb; vec double precision[]; piece text; staged integer:=0;
BEGIN
 SELECT initiating_user_id,tenant_id INTO login_lock_actor,login_lock_tenant
 FROM public.paige_durable_work WHERE id=_work_id;
 PERFORM 1 FROM auth.users WHERE id=login_lock_actor FOR NO KEY UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF FOUND AND (w.initiating_user_id IS DISTINCT FROM login_lock_actor
  OR w.tenant_id IS DISTINCT FROM login_lock_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF NOT FOUND OR w.work_kind<>'knowledge_publish' OR w.capability_key<>'knowledge.publish' OR w.idempotency_key IS DISTINCT FROM _server_key THEN RAISE EXCEPTION 'KNOWLEDGE_WORK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF _attempt IS NULL OR w.attempt_count<>_attempt OR w.dispatch_started_attempt<>_attempt THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(w.initiating_user_id,w.tenant_id) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF w.status='succeeded' THEN RETURN jsonb_build_object('staged',0,'already_complete',true); END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id FOR UPDATE;
 IF NOT FOUND OR d.revision<>_revision OR d.revision IS DISTINCT FROM (w.request_payload->>'revision')::integer THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 hashes:=w.request_payload->'manifest'->'chunk_hashes'; n:=jsonb_array_length(hashes);
 IF _chunks IS NULL OR jsonb_typeof(_chunks)<>'array' OR jsonb_array_length(_chunks)=0 OR jsonb_array_length(_chunks)>n THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INVALID' USING ERRCODE='22023'; END IF;
 -- Fence: an abandoned stage cannot be extended by a re-dispatched worker because the
 -- attempt check above (attempt_count + dispatch_started_attempt) refuses the old attempt.
 FOR c IN SELECT * FROM jsonb_array_elements(_chunks) LOOP
  IF c->>'index' IS NULL OR (c->>'index')::int NOT BETWEEN 0 AND n-1 OR c->>'sha256' IS DISTINCT FROM hashes->>((c->>'index')::int)
   OR jsonb_typeof(c->'embedding')<>'array' OR jsonb_array_length(c->'embedding')<>1024
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'embedding') e WHERE jsonb_typeof(e)<>'number' OR (e#>>'{}')::double precision IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)) THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INVALID' USING ERRCODE='22023'; END IF;
  SELECT array_agg((e#>>'{}')::double precision ORDER BY ord) INTO vec FROM jsonb_array_elements(c->'embedding') WITH ORDINALITY e(e,ord);
  i:=(c->>'index')::int;
  -- Content is the SERVER-derived canonical chunk text, never caller-supplied and never
  -- empty: retrieval reads c.content directly, so an unstored text would silently degrade
  -- every published generation to title-only matches (independent review P2).
  SELECT chunk_text INTO piece FROM public.knowledge_publication_chunks(d.pending_review->>'reviewed_content') WHERE chunk_index=i;
  IF piece IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_STAGE_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.tenant_knowledge_chunks(id,doc_id,tenant_id,chunk_index,content,embedding,generation_id)
   VALUES(md5(d.id::text||':'||w.id::text||':'||i)::uuid,d.id,w.tenant_id,i,piece,vec,w.id)
   ON CONFLICT DO NOTHING;
  staged:=staged+1;
 END LOOP;
 UPDATE public.paige_durable_work SET heartbeat_at=now(),version=version+1 WHERE id=w.id;
 RETURN jsonb_build_object('staged',staged,'total_expected',n);
END $new$),
 ('complete_knowledge_publication','42a227f727ff894a01fb2b59850d0b14','f665ff694fd9e306fb0c7f36b3e305b6',$old$
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
END $old$,$new$
DECLARE login_lock_actor uuid; login_lock_tenant uuid; w public.paige_durable_work; d public.tenant_knowledge_docs; outcome text:='capability_succeeded'; result jsonb; n integer; staged_n integer; run uuid; manifest jsonb;
BEGIN
 SELECT initiating_user_id,tenant_id INTO login_lock_actor,login_lock_tenant
 FROM public.paige_durable_work WHERE id=_work_id;
 PERFORM 1 FROM auth.users WHERE id=login_lock_actor FOR NO KEY UPDATE;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF FOUND AND (w.initiating_user_id IS DISTINCT FROM login_lock_actor
  OR w.tenant_id IS DISTINCT FROM login_lock_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
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
END $new$),
 ('lock_solo_reviewed_setup_scope','cfd3332240798913d006d58f31f2f54e','6ed364c089ce05eb089f6230fbbe8c76',$old$
DECLARE context jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor OR p_tenant IS NULL THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 -- Take the original Setup selection lock and tenant write lock before E13's
 -- shared authority locks. Receipt calls must not both hold SHARE and then
 -- upgrade the same profile/tenant. Cross-API lock/recovery proof remains owed.
 PERFORM public.solo_setup_lock_expected_tenant(p_tenant);
 PERFORM 1 FROM public.tenants WHERE id=p_tenant FOR UPDATE;
 IF NOT public.lock_knowledge_extraction_authority(p_actor,p_tenant) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor AND status='active')
  OR public.solo_setup_access_scope() NOT IN ('owner_full','admin_operational') THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_setup_business_context_meta WHERE tenant_id=p_tenant FOR UPDATE;
 context:=public.get_solo_business_context();
 IF context->>'tenantId' IS DISTINCT FROM p_tenant::text THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 RETURN context;
END $old$,$new$
DECLARE context jsonb;
BEGIN
 IF p_actor IS NOT NULL AND p_actor IS NOT DISTINCT FROM auth.uid() THEN
  PERFORM 1 FROM auth.users WHERE id=p_actor FOR NO KEY UPDATE;
 END IF;
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor OR p_tenant IS NULL THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 -- Take the original Setup selection lock and tenant write lock before E13's
 -- shared authority locks. Receipt calls must not both hold SHARE and then
 -- upgrade the same profile/tenant. Cross-API lock/recovery proof remains owed.
 PERFORM public.solo_setup_lock_expected_tenant(p_tenant);
 PERFORM 1 FROM public.tenants WHERE id=p_tenant FOR UPDATE;
 IF NOT public.lock_knowledge_extraction_authority(p_actor,p_tenant) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor AND status='active')
  OR public.solo_setup_access_scope() NOT IN ('owner_full','admin_operational') THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_setup_business_context_meta WHERE tenant_id=p_tenant FOR UPDATE;
 context:=public.get_solo_business_context();
 IF context->>'tenantId' IS DISTINCT FROM p_tenant::text THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 RETURN context;
END $new$)
 ) AS repairs(name,old_hash,new_hash,old_body,new_body) LOOP
  r.old_body:=replace(r.old_body,E'\r\n',E'\n');
  r.new_body:=replace(r.new_body,E'\r\n',E'\n');
  target:=to_regprocedure('public.'||r.name||CASE r.name
   WHEN 'submit_tenant_knowledge_publication' THEN '(uuid,uuid,uuid,integer,uuid,text)'
   WHEN 'complete_knowledge_extraction' THEN '(uuid,text,integer,integer,text,text,jsonb)'
   WHEN 'lock_knowledge_review_target' THEN '(uuid,uuid,uuid,integer)'
   WHEN 'stage_knowledge_publication' THEN '(uuid,text,integer,integer,jsonb)'
   WHEN 'complete_knowledge_publication' THEN '(uuid,text,integer,integer)'
   WHEN 'lock_solo_reviewed_setup_scope' THEN '(uuid,uuid)' ELSE '(uuid)' END);
  IF target IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_AUTH_ORDER_SOURCE_MISSING: %',r.name; END IF;
  SELECT to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) INTO before_meta,definition FROM pg_proc p WHERE p.oid=target;
  IF ((before_meta->>'proowner')::oid='postgres'::regrole AND before_meta->>'provolatile'='v'
    AND before_meta->'proconfig'=to_jsonb(ARRAY['search_path=""']::text[])
    AND (SELECT prosecdef=(r.name<>'lock_solo_reviewed_setup_scope')
      AND proacl IS NOT DISTINCT FROM CASE WHEN r.name IN ('lock_knowledge_review_target','lock_solo_reviewed_setup_scope')
       THEN ARRAY['postgres=X/postgres']::aclitem[]
       WHEN r.name='submit_tenant_knowledge_publication' THEN ARRAY['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[]
       ELSE ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[] END
      FROM pg_proc WHERE oid=target)) IS DISTINCT FROM TRUE THEN
   RAISE EXCEPTION 'KNOWLEDGE_AUTH_ORDER_METADATA_DRIFT: %',r.name;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target)=r.new_hash THEN CONTINUE; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM r.old_hash
    OR position(r.old_body in definition)=0 THEN
   RAISE EXCEPTION 'KNOWLEDGE_AUTH_ORDER_SOURCE_DRIFT: %, hash %, expected %, body position %',r.name,(SELECT md5(prosrc) FROM pg_proc WHERE oid=target),r.old_hash,position(r.old_body in definition);
  END IF;
  EXECUTE replace(definition,r.old_body,r.new_body);
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM r.new_hash
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM before_meta THEN
   RAISE EXCEPTION 'KNOWLEDGE_AUTH_ORDER_READBACK_FAILED: %',r.name;
  END IF;
 END LOOP;
END $repair$;
