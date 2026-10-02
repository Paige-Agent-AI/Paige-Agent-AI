-- Native extraction only: pending review, never publication or embeddings.
-- UTF-16 code units, not PostgreSQL characters: every typed consumer validates Knowledge text
-- by UTF-16 units (JS string length) plus UTF-8 bytes, so SQL that accepts more units than the
-- consumer can read back is not a valid accept (same alignment as the review-save contract).
CREATE OR REPLACE FUNCTION public.knowledge_utf16_length(v text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT (length(v)+(SELECT count(*) FROM regexp_matches(v,'[\U00010000-\U0010FFFF]','g')))::integer
$$;
REVOKE ALL ON FUNCTION public.knowledge_utf16_length(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_utf16_length(text) TO authenticated,service_role;
ALTER TABLE public.tenant_knowledge_docs
 ADD COLUMN IF NOT EXISTS extraction_input text,
 ADD COLUMN IF NOT EXISTS extraction_source_binding jsonb,
 ADD COLUMN IF NOT EXISTS extraction_work_id uuid REFERENCES public.paige_durable_work(id),
 ADD COLUMN IF NOT EXISTS extraction_revision integer;
ALTER TABLE public.tenant_knowledge_docs DROP CONSTRAINT IF EXISTS knowledge_extraction_shape;
ALTER TABLE public.tenant_knowledge_docs ADD CONSTRAINT knowledge_extraction_shape CHECK (
 (extraction_input IS NULL OR public.knowledge_utf16_length(extraction_input) BETWEEN 1 AND 480000)
 AND public.knowledge_source_binding_valid(extraction_source_binding,tenant_id)
 AND (extraction_revision IS NULL OR extraction_revision>0));
-- Preserve all legacy explicit writes, but table privileges must not override the
-- exclusion of lifecycle fields. Definer RPCs are the only authenticated write door.
REVOKE INSERT,UPDATE ON public.tenant_knowledge_docs FROM authenticated;
GRANT INSERT (id,tenant_id,title,content,summary,category,tags,source,source_url,share_to_network,
 network_review_status,network_reviewed_at,network_reviewed_by,promoted_to_canon_id,token_count,
 chunk_count,created_by,created_at,updated_at,revision),
 UPDATE (id,tenant_id,title,content,summary,category,tags,source,source_url,share_to_network,
 network_review_status,network_reviewed_at,network_reviewed_by,promoted_to_canon_id,token_count,
 chunk_count,created_by,created_at,updated_at,revision) ON public.tenant_knowledge_docs TO authenticated;
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
     OR NEW.extraction_work_id IS NOT NULL OR NEW.extraction_revision IS NOT NULL THEN
    RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSIF ROW(NEW.record_state,NEW.source_coverage,NEW.source_binding,NEW.pending_review,NEW.extraction_input,NEW.extraction_source_binding,NEW.extraction_work_id,NEW.extraction_revision)
    IS DISTINCT FROM ROW(OLD.record_state,OLD.source_coverage,OLD.source_binding,OLD.pending_review,OLD.extraction_input,OLD.extraction_source_binding,OLD.extraction_work_id,OLD.extraction_revision) THEN
   RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Hold the rows backing the existing actor predicate through each write transaction.
-- Role interpretation remains in knowledge_actor_authorized and canonical helpers.
CREATE OR REPLACE FUNCTION public.lock_knowledge_extraction_authority(_actor uuid,_tenant uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM auth.users WHERE id=_actor FOR SHARE;
 PERFORM 1 FROM public.tenants WHERE id=_tenant FOR SHARE;
 PERFORM 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant FOR SHARE;
 PERFORM 1 FROM public.user_roles WHERE user_id=_actor FOR SHARE;
 PERFORM 1 FROM public.profiles WHERE user_id=_actor AND active_tenant_id=_tenant FOR SHARE;
 RETURN FOUND AND public.knowledge_actor_authorized(_actor,_tenant);
END $$;
REVOKE ALL ON FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) TO service_role;

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
  UPDATE public.tenant_knowledge_docs SET extraction_input=_input,extraction_source_binding=_source,extraction_work_id=created.work_id,extraction_revision=revision+1,pending_review=NULL WHERE id=doc RETURNING * INTO d;
 END IF;
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',doc,'request_hash',request_hash,'input_hash',input_hash,'revision',d.revision),safe_summary='Knowledge extraction is queued.',version=version+1 WHERE id=created.work_id;
 -- Same native worker and cron recovery path. Missed wake never loses the envelope.
 BEGIN
  PERFORM net.http_post(url:='https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-document-worker',headers:=jsonb_build_object('Content-Type','application/json','x-cron-token',public.cron_token_header()),body:=jsonb_build_object('mode','knowledge-run','work_id',created.work_id));
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN jsonb_build_object('work_id',created.work_id,'document_id',doc,'revision',d.revision,'status','claimed','replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.start_knowledge_extraction(_work_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.complete_knowledge_extraction(_work_id uuid,_server_key text,_attempt integer,_revision integer,_content text,_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; outcome text:='capability_succeeded'; result jsonb;
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
  OR encode(sha256(convert_to(_content,'UTF8')),'hex') IS DISTINCT FROM _hash THEN RAISE EXCEPTION 'KNOWLEDGE_OUTPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id AND extraction_work_id=w.id FOR UPDATE;
 IF NOT FOUND OR d.revision<>_revision THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF d.extraction_source_binding IS NOT NULL THEN
  PERFORM 1 FROM storage.objects WHERE id=(d.extraction_source_binding->>'object_id')::uuid AND bucket_id='tenant-knowledge' AND name=d.extraction_source_binding->>'object_name' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 END IF;
 UPDATE public.tenant_knowledge_docs SET pending_review=jsonb_build_object('schema_version',1,'extracted_content',_content,'reviewed_content',NULL,'extraction_version','utf8-v1','coverage','complete'),extraction_input=NULL WHERE id=d.id RETURNING * INTO d;
 IF d.pending_review->>'extracted_content' IS DISTINCT FROM _content THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 BEGIN
  PERFORM public.record_capability_run(w.tenant_id,w.initiating_user_id,'knowledge_extract','capability_succeeded',w.id,NULL::text,NULL::text,NULL::uuid,NULL::text,jsonb_build_object('document_id',d.id,'revision',d.revision,'phase','awaiting_review'));
 EXCEPTION WHEN OTHERS THEN outcome:='capability_completed_unrecorded'; END;
 result:=jsonb_build_object('verified_readback',true,'document_id',d.id,'revision',d.revision,'work_id',w.id,'phase','awaiting_review','outcome',outcome);
 PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',result,'Knowledge text is ready for review. Nothing has been published.',NULL,NULL,300,false);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.settle_knowledge_extraction_failure(_work_id uuid,_server_key text,_attempt integer,_code text,_unknown boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' OR w.idempotency_key IS DISTINCT FROM _server_key OR _attempt IS DISTINCT FROM w.attempt_count OR w.dispatch_started_attempt<>w.attempt_count THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF w.status='succeeded' THEN RETURN; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 IF _code NOT IN ('source_changed','source_unavailable','input_invalid','authority_changed','revision_changed','completion_unknown') OR _code IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_ERROR_INVALID'; END IF;
 PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,CASE WHEN _unknown THEN 'outcome_unknown' ELSE 'failed' END,CASE WHEN _unknown THEN NULL ELSE jsonb_build_object('reason',_code,'document_id',w.request_payload->>'document_id') END,'Knowledge extraction needs attention. Published content is unchanged.',NULL,_code,300,false);
END $$;

CREATE OR REPLACE FUNCTION public.recover_knowledge_extraction(_limit integer DEFAULT 10)
RETURNS TABLE(work_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work;
BEGIN
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'KNOWLEDGE_LIMIT_INVALID'; END IF;
 FOR w IN SELECT * FROM public.paige_durable_work WHERE work_kind='knowledge_extract' AND capability_key='knowledge.extract' AND status='claimed' AND lease_until<=now() ORDER BY lease_until LIMIT _limit FOR UPDATE SKIP LOCKED LOOP
  IF NOT public.knowledge_actor_authorized(w.initiating_user_id,w.tenant_id) THEN
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,'Knowledge extraction is paused because workspace access changed.','authority_changed','authority_changed',300,false);
  ELSIF w.dispatch_started_attempt=w.attempt_count THEN
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'outcome_unknown',NULL,'Knowledge extraction needs reconciliation before another attempt.',NULL,'completion_unknown',300,false);
  ELSIF w.attempt_count>=w.max_attempts THEN
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'failed',jsonb_build_object('reason','attempt_limit'),'Knowledge extraction could not start.',NULL,'attempt_limit',300,false);
  ELSE
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'expired',NULL,'Recovering a missed extraction wake.',NULL,'lease_expired',300,false);
   PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'claimed',NULL,'Knowledge extraction is queued.',NULL,NULL,60,true);
   RETURN QUERY SELECT w.id;
  END IF;
 END LOOP;
END $$;
-- One ACL statement per signature: the definer-signature-acl guard reads single-function
-- REVOKE/GRANT lists and cannot attribute a shared statement past its first entry.
REVOKE ALL ON FUNCTION public.submit_knowledge_extraction(uuid,uuid,uuid,uuid,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_knowledge_extraction(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_knowledge_extraction_failure(uuid,text,integer,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recover_knowledge_extraction(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_knowledge_extraction(uuid,uuid,uuid,uuid,integer,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_knowledge_extraction(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_knowledge_extraction_failure(uuid,text,integer,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_knowledge_extraction(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.read_tenant_knowledge_review(p_expected_tenant uuid,p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tenant uuid; v_doc public.tenant_knowledge_docs;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
 SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
 IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF NOT (coalesce(public.is_platform_owner(),false) OR coalesce(public.is_tenant_member(v_tenant),false)) THEN
  RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_doc FROM public.tenant_knowledge_docs WHERE tenant_id=v_tenant AND id=p_doc_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('tenant_id',v_tenant,'document_id',v_doc.id,'revision',v_doc.revision,
  'record_state',v_doc.record_state,'source_coverage',v_doc.source_coverage,
  'source_binding',v_doc.source_binding,'pending_review',v_doc.pending_review,
  'extraction_work_id',v_doc.extraction_work_id,'extraction_source_binding',v_doc.extraction_source_binding);
END $$;
REVOKE ALL ON FUNCTION public.read_tenant_knowledge_review(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_tenant_knowledge_review(uuid,uuid) TO authenticated;


-- Object identity lookup uses SQL because Storage's schema is not a public REST API.
CREATE OR REPLACE FUNCTION public.resolve_knowledge_extraction_source(_actor uuid,_tenant uuid,_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.knowledge_actor_authorized(_actor,_tenant) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF _path IS NULL OR length(_path) NOT BETWEEN 38 AND 1024 OR left(_path,37)<>_tenant::text||'/' OR _path ~ '(^|/)\.\.?(/|$)|\\|%|//' THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('object_id',id,'object_name',name,'bucket','tenant-knowledge') INTO result FROM storage.objects WHERE bucket_id='tenant-knowledge' AND name=_path;
 IF result IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.resolve_knowledge_extraction_source(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_knowledge_extraction_source(uuid,uuid,text) TO service_role;
