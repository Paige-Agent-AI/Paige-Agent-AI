-- Pending review management only. No canonical publication or provider dispatch.
ALTER TABLE public.tenant_knowledge_docs ADD COLUMN IF NOT EXISTS pending_review_metadata jsonb,
 ADD COLUMN IF NOT EXISTS last_review_operation jsonb;
CREATE OR REPLACE FUNCTION public.knowledge_review_metadata_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['title','summary','category','tags'] OR v-ARRAY['title','summary','category','tags']<>'{}'::jsonb
 OR jsonb_typeof(v->'title')<>'string' OR length(btrim(v->>'title')) NOT BETWEEN 1 AND 300
 OR jsonb_typeof(v->'summary') NOT IN ('string','null') OR length(v->>'summary')>2000
 OR jsonb_typeof(v->'category') NOT IN ('string','null') OR length(v->>'category')>100
 OR jsonb_typeof(v->'tags')<>'array' THEN RETURN false; END IF;
 RETURN jsonb_array_length(v->'tags')<=20 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'tags') t WHERE jsonb_typeof(t)<>'string' OR length(t#>>'{}')>60);
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
ALTER TABLE public.tenant_knowledge_docs DROP CONSTRAINT IF EXISTS knowledge_review_management_shape;
ALTER TABLE public.tenant_knowledge_docs ADD CONSTRAINT knowledge_review_management_shape CHECK (
 public.knowledge_review_metadata_valid(pending_review_metadata)
 AND (last_review_operation IS NULL OR (jsonb_typeof(last_review_operation)='object' AND octet_length(last_review_operation::text)<=1024)));
-- Internal fields stay outside all existing authenticated column grants.
-- UTF-16 code units, not PostgreSQL characters: the typed review consumer validates content()
-- by UTF-16 units (JS string length) plus UTF-8 bytes, so a save the consumer cannot read back
-- is not a valid save (independent review 2026-10-01, P2).
CREATE OR REPLACE FUNCTION public.knowledge_utf16_length(v text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT (length(v)+(SELECT count(*) FROM regexp_matches(v,'[\U00010000-\U0010FFFF]','g')))::integer
$$;
CREATE OR REPLACE FUNCTION public.guard_knowledge_review_management() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND
  ((TG_OP='INSERT' AND (NEW.pending_review_metadata IS NOT NULL OR NEW.last_review_operation IS NOT NULL)) OR
   (TG_OP='UPDATE' AND ROW(NEW.pending_review_metadata,NEW.last_review_operation) IS DISTINCT FROM ROW(OLD.pending_review_metadata,OLD.last_review_operation)))
 THEN RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- A different extraction invalidates prior saved metadata and its readback reference.
 IF TG_OP='UPDATE' AND NEW.extraction_work_id IS DISTINCT FROM OLD.extraction_work_id THEN
  NEW.pending_review_metadata:=NULL;
  IF NEW.extraction_work_id IS NOT NULL THEN NEW.last_review_operation:=NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_review_management_guard ON public.tenant_knowledge_docs;
CREATE TRIGGER knowledge_review_management_guard BEFORE INSERT OR UPDATE ON public.tenant_knowledge_docs FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_review_management();
-- One ACL statement per signature: the definer-signature-acl guard reads single-function
-- REVOKE/GRANT lists and cannot attribute a shared statement past its first entry.
REVOKE ALL ON FUNCTION public.guard_knowledge_review_management() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.knowledge_review_metadata_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.knowledge_utf16_length(text) FROM PUBLIC,anon,authenticated,service_role;

-- Safe public projection uses the existing native visibility predicate. No raw payload.
CREATE OR REPLACE FUNCTION public.knowledge_pending_projection(d public.tenant_knowledge_docs,detail boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record; w public.paige_durable_work; result jsonb; receipt text:='unknown';
BEGIN
 SELECT * INTO s FROM public.get_paige_durable_work(coalesce(d.extraction_work_id,(d.last_review_operation->>'work_id')::uuid));
 IF NOT FOUND OR s.work_kind<>'knowledge_extract' OR s.capability_key<>'knowledge.extract' THEN RETURN NULL; END IF;
 SELECT * INTO w FROM public.paige_durable_work WHERE id=s.work_id AND tenant_id=d.tenant_id;
 IF NOT FOUND OR w.request_payload->>'document_id' IS DISTINCT FROM d.id::text THEN RETURN NULL; END IF;
 IF w.status='succeeded' AND w.terminal_outcome->>'document_id'=d.id::text AND w.terminal_outcome->>'work_id'=w.id::text
 AND w.terminal_outcome->'verified_readback'='true'::jsonb AND w.terminal_outcome->>'phase'='awaiting_review'
 AND w.terminal_outcome->>'outcome' IN ('capability_succeeded','capability_completed_unrecorded') THEN receipt:=w.terminal_outcome->>'outcome'; END IF;
 result:=jsonb_build_object('contract_version',1,'tenant_id',d.tenant_id,'document_id',d.id,'revision',d.revision,'title',coalesce(d.pending_review_metadata->>'title',d.title),
 'record_state',d.record_state,'review_available',d.pending_review IS NOT NULL,'extraction_work_id',d.extraction_work_id,'work',to_jsonb(s),'extraction_outcome',receipt,
 'last_review_operation',d.last_review_operation);
 IF detail THEN result:=result||jsonb_build_object('pending_review',d.pending_review,'pending_review_metadata',d.pending_review_metadata,
 'source_coverage',d.source_coverage,'source_binding',d.source_binding,'extraction_source_binding',d.extraction_source_binding); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_pending_projection(public.tenant_knowledge_docs,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_tenant_knowledge_pending(p_expected_tenant uuid,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; item jsonb; items jsonb:='[]'; last_id uuid; more boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR NOT public.lock_knowledge_extraction_authority(auth.uid(),p_expected_tenant) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'KNOWLEDGE_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT x.* FROM public.tenant_knowledge_docs x WHERE x.tenant_id=p_expected_tenant AND x.extraction_work_id IS NOT NULL
 AND (p_after_id IS NULL OR x.id>p_after_id) AND EXISTS(SELECT 1 FROM public.get_paige_durable_work(x.extraction_work_id) s WHERE s.work_kind='knowledge_extract' AND s.capability_key='knowledge.extract')
 ORDER BY x.id LIMIT p_limit+1 LOOP
  item:=public.knowledge_pending_projection(d,false);
  IF item IS NULL THEN CONTINUE; END IF;
  IF jsonb_array_length(items)=p_limit THEN more:=true; EXIT; END IF;
  items:=items||jsonb_build_array(item); last_id:=d.id;
 END LOOP;
 RETURN jsonb_build_object('contract_version',1,'tenant_id',p_expected_tenant,'items',items,'next_cursor',CASE WHEN more THEN last_id ELSE NULL END);
END $$;
CREATE OR REPLACE FUNCTION public.read_tenant_knowledge_pending(p_expected_tenant uuid,p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.lock_knowledge_extraction_authority(auth.uid(),p_expected_tenant) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE tenant_id=p_expected_tenant AND id=p_doc_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 result:=public.knowledge_pending_projection(d,true);
 IF result IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
-- Shared mutation lock order: native work, authority rows, then canonical document.
CREATE OR REPLACE FUNCTION public.lock_knowledge_review_target(t uuid,doc uuid,work uuid,rev integer)
RETURNS public.tenant_knowledge_docs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=work FOR UPDATE;
 IF NOT FOUND OR w.tenant_id IS DISTINCT FROM t OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract' THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NULL OR NOT public.lock_knowledge_extraction_authority(auth.uid(),t) OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(work)) THEN RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=doc AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF w.request_payload->>'document_id' IS DISTINCT FROM doc::text OR d.extraction_work_id IS DISTINCT FROM work OR rev IS NULL OR d.revision<>rev THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION public.lock_knowledge_review_target(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.save_tenant_knowledge_review(p_expected_tenant uuid,p_doc_id uuid,p_work_id uuid,p_expected_revision integer,p_content text,p_metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; run uuid; outcome text:='capability_succeeded'; op jsonb;
BEGIN
 d:=public.lock_knowledge_review_target(p_expected_tenant,p_doc_id,p_work_id,p_expected_revision);
 IF d.pending_review IS NULL OR NOT EXISTS(SELECT 1 FROM public.paige_durable_work WHERE id=p_work_id AND status='succeeded') THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_NOT_READY' USING ERRCODE='55000'; END IF;
 IF p_content IS NULL OR public.knowledge_utf16_length(p_content) NOT BETWEEN 1 AND 480000 OR octet_length(p_content)>2097152 OR p_metadata IS NULL OR NOT public.knowledge_review_metadata_valid(p_metadata) THEN RAISE EXCEPTION 'KNOWLEDGE_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 run:=md5('knowledge_review_save:'||p_expected_tenant::text||':'||p_doc_id::text||':'||(d.revision+1)::text)::uuid;
 BEGIN PERFORM public.record_capability_run(p_expected_tenant,auth.uid(),'knowledge_review_save','capability_succeeded',run,NULL::text,NULL::text,NULL::uuid,NULL::text,jsonb_build_object('document_id',d.id,'revision',d.revision+1,'work_id',p_work_id));
 EXCEPTION WHEN OTHERS THEN outcome:='capability_completed_unrecorded'; END;
 op:=jsonb_build_object('operation','review_saved','work_id',p_work_id,'run_id',run,'actor_id',auth.uid(),'revision',d.revision+1,'outcome',outcome);
 UPDATE public.tenant_knowledge_docs SET pending_review=jsonb_set(pending_review,'{reviewed_content}',to_jsonb(p_content)),pending_review_metadata=jsonb_set(p_metadata,'{title}',to_jsonb(btrim(p_metadata->>'title'))),last_review_operation=op WHERE id=d.id RETURNING * INTO d;
 IF d.pending_review->>'reviewed_content' IS DISTINCT FROM p_content OR d.revision<>p_expected_revision+1 THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 RETURN public.knowledge_pending_projection(d,true)||jsonb_build_object('verified_readback',true,'outcome',outcome,'operation','review_saved','work_id',p_work_id,'run_id',run);
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
  UPDATE public.tenant_knowledge_docs SET pending_review=NULL,pending_review_metadata=NULL,extraction_input=NULL,extraction_source_binding=NULL,extraction_work_id=NULL,extraction_revision=NULL,
   last_review_operation=jsonb_build_object('operation','review_discarded','work_id',p_work_id,'run_id',run,'actor_id',auth.uid(),'revision',d.revision+1,'outcome',outcome) WHERE id=d.id RETURNING * INTO d;
  IF d.pending_review IS NOT NULL OR d.extraction_work_id IS NOT NULL THEN RAISE EXCEPTION 'KNOWLEDGE_READBACK_FAILED'; END IF;
 END IF;
 RETURN jsonb_build_object('contract_version',1,'verified_readback',true,'tenant_id',p_expected_tenant,'document_id',p_doc_id,'work_id',p_work_id,'revision',d.revision,'operation','review_discarded','document_removed',removed,'work_cancelled',false,'outcome',outcome,'run_id',run,'source_cleanup',jsonb_build_object('status','not_attempted','reason','retained_by_policy'));
END $$;
REVOKE ALL ON FUNCTION public.list_tenant_knowledge_pending(uuid,uuid,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.read_tenant_knowledge_pending(uuid,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.save_tenant_knowledge_review(uuid,uuid,uuid,integer,text,jsonb) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.discard_tenant_knowledge_review(uuid,uuid,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_tenant_knowledge_pending(uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_tenant_knowledge_pending(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_tenant_knowledge_review(uuid,uuid,uuid,integer,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_tenant_knowledge_review(uuid,uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_review_metadata_valid(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_utf16_length(text) TO authenticated,service_role;

CREATE INDEX IF NOT EXISTS knowledge_pending_discovery_idx ON public.tenant_knowledge_docs(tenant_id,id) WHERE extraction_work_id IS NOT NULL;
