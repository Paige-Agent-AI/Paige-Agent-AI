-- Add only a server-correlated, owner-safe publication association to the
-- incumbent review reader. No publication, replay, new intent, writer or grant.
CREATE OR REPLACE FUNCTION public.read_tenant_knowledge_review(p_expected_tenant uuid,p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tenant uuid; v_doc public.tenant_knowledge_docs;
 w public.paige_durable_work; candidate public.paige_durable_work; visible record;
 chosen uuid; matched integer:=0; unresolved integer:=0; manifest jsonb; review_hash text; request_hash text;
 publication jsonb:=jsonb_build_object('contract_version',1,'association','unavailable',
   'work_id',NULL,'work_status',NULL,'generation_id',NULL,'outcome',NULL);
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
 SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
 IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF NOT (coalesce(public.is_platform_owner(),false) OR coalesce(public.is_tenant_member(v_tenant),false)) THEN
  RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- Freeze this document's generation/review while resolving its association.
 -- Work is read without a row lock: workers lock work before the document.
 SELECT * INTO v_doc FROM public.tenant_knowledge_docs WHERE tenant_id=v_tenant AND id=p_doc_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 <<association>>
 BEGIN
  IF NOT public.knowledge_actor_authorized(v_actor,v_tenant) THEN EXIT association; END IF;
  IF v_doc.pending_review IS NOT NULL THEN
   IF v_doc.extraction_work_id IS NULL OR v_doc.pending_review->>'reviewed_content' IS NULL THEN EXIT association; END IF;
   review_hash:=encode(sha256(convert_to(v_doc.pending_review->>'reviewed_content','UTF8')),'hex');
   manifest:=public.knowledge_publication_manifest(v_doc.pending_review->>'reviewed_content','voyage-3');
   IF manifest IS NULL OR NOT public.knowledge_publication_manifest_valid(manifest) THEN EXIT association; END IF;
   request_hash:=encode(sha256(convert_to(jsonb_build_object('document',v_doc.id,'revision',v_doc.revision,
    'review',review_hash,'manifest',manifest,'source',v_doc.extraction_source_binding-'bound_at')::text,'UTF8')),'hex');
   FOR candidate IN SELECT x.* FROM public.paige_durable_work x
    WHERE x.tenant_id=v_tenant AND (x.work_kind='knowledge_publish' OR x.capability_key='knowledge.publish')
      AND x.request_payload->>'document_id'=v_doc.id::text LOOP
    -- The entire document's unresolved set matters, not just matching payloads.
    -- A stale/unknown/hidden publication must never be misreported as not submitted.
    IF candidate.work_kind IS DISTINCT FROM 'knowledge_publish' OR candidate.capability_key IS DISTINCT FROM 'knowledge.publish'
      OR candidate.status NOT IN ('claimed','expired','blocked','outcome_unknown','failed','cancelled','succeeded')
      OR candidate.request_payload->>'version' IS DISTINCT FROM '1'
      OR NOT pg_catalog.pg_input_is_valid(coalesce(candidate.request_payload->>'extraction_work_id',''),'uuid')
      OR NOT pg_catalog.pg_input_is_valid(coalesce(candidate.request_payload->>'revision',''),'integer')
      OR (candidate.request_payload->>'revision')::integer<1
      OR coalesce(candidate.request_payload->>'review_hash','') !~ '^[0-9a-f]{64}$'
      OR coalesce(candidate.request_payload->>'request_hash','') !~ '^[0-9a-f]{64}$'
      OR NOT public.knowledge_publication_manifest_valid(candidate.request_payload->'manifest')
      OR NOT EXISTS(SELECT 1 FROM public.get_paige_durable_work(candidate.id)) THEN EXIT association; END IF;
    IF candidate.request_payload->>'revision'=v_doc.revision::text AND
      (candidate.request_payload->>'extraction_work_id' IS DISTINCT FROM v_doc.extraction_work_id::text
       OR candidate.request_payload->>'review_hash' IS DISTINCT FROM review_hash) THEN EXIT association; END IF;
    IF candidate.status IN ('claimed','expired','blocked','outcome_unknown') THEN
     unresolved:=unresolved+1;
     IF unresolved>1 OR candidate.request_payload->>'extraction_work_id' IS DISTINCT FROM v_doc.extraction_work_id::text
       OR candidate.request_payload->>'revision' IS DISTINCT FROM v_doc.revision::text
       OR candidate.request_payload->>'review_hash' IS DISTINCT FROM review_hash
       OR candidate.request_payload->>'request_hash' IS DISTINCT FROM request_hash
       OR candidate.request_payload->>'version' IS DISTINCT FROM '1'
       OR candidate.request_payload->'manifest' IS DISTINCT FROM manifest
       OR candidate.request_payload->'source' IS DISTINCT FROM coalesce(v_doc.extraction_source_binding,'null'::jsonb)
       THEN EXIT association; END IF;
     chosen:=candidate.id;
    END IF;
    IF candidate.request_payload->>'extraction_work_id'=v_doc.extraction_work_id::text
      AND candidate.request_payload->>'revision'=v_doc.revision::text
      AND candidate.request_payload->>'review_hash'=review_hash THEN
     IF candidate.request_payload->>'request_hash' IS DISTINCT FROM request_hash
       OR candidate.request_payload->>'version' IS DISTINCT FROM '1'
       OR candidate.request_payload->'manifest' IS DISTINCT FROM manifest
       OR candidate.request_payload->'source' IS DISTINCT FROM coalesce(v_doc.extraction_source_binding,'null'::jsonb)
       OR candidate.status='succeeded' OR candidate.id=v_doc.active_generation_id THEN EXIT association; END IF;
     matched:=matched+1;
     IF unresolved=0 THEN chosen:=candidate.id; END IF;
    END IF;
   END LOOP;
   -- Both sets must be empty. This is NOT "no exact match OR no active work".
   IF matched=0 AND unresolved=0 THEN
    publication:=publication||jsonb_build_object('association','not_submitted');
    EXIT association;
   END IF;
   -- A unique unresolved exact attempt supersedes earlier failed/cancelled tries.
   -- Multiple terminal candidates have no canonical "latest intent" pointer.
   IF unresolved=0 AND matched<>1 THEN EXIT association; END IF;
   SELECT * INTO w FROM public.paige_durable_work WHERE id=chosen AND tenant_id=v_tenant;
   SELECT * INTO visible FROM public.get_paige_durable_work(w.id);
   IF NOT FOUND OR visible.work_status IS DISTINCT FROM w.status THEN EXIT association; END IF;
   publication:=publication||jsonb_build_object('association','matched','work_id',w.id,'work_status',visible.work_status);
   -- A prior active generation is intentionally never exposed for a replacement.
  ELSIF v_doc.active_generation_id IS NOT NULL THEN
   SELECT * INTO w FROM public.paige_durable_work WHERE id=v_doc.active_generation_id AND tenant_id=v_tenant;
   IF NOT FOUND OR w.work_kind IS DISTINCT FROM 'knowledge_publish' OR w.capability_key IS DISTINCT FROM 'knowledge.publish'
     OR w.request_payload->>'document_id' IS DISTINCT FROM v_doc.id::text
     OR w.request_payload->>'version' IS DISTINCT FROM '1'
     OR NOT pg_catalog.pg_input_is_valid(coalesce(w.request_payload->>'extraction_work_id',''),'uuid')
     OR NOT pg_catalog.pg_input_is_valid(coalesce(w.request_payload->>'revision',''),'integer')
     OR (w.request_payload->>'revision')::integer<1
     OR w.request_payload->>'review_hash' IS DISTINCT FROM encode(sha256(convert_to(v_doc.content,'UTF8')),'hex')
     OR w.request_payload->>'request_hash' IS DISTINCT FROM v_doc.publication_intent_hash
     OR w.request_payload->'manifest' IS DISTINCT FROM v_doc.publication_manifest
     OR NOT public.knowledge_publication_manifest_valid(v_doc.publication_manifest)
     OR NOT EXISTS(SELECT 1 FROM public.paige_durable_work x
       WHERE x.id=(w.request_payload->>'extraction_work_id')::uuid AND x.tenant_id=v_tenant
         AND x.work_kind='knowledge_extract' AND x.capability_key='knowledge.extract' AND x.status='succeeded'
         AND x.request_payload->>'document_id'=v_doc.id::text)
     OR w.request_payload->'source' IS DISTINCT FROM coalesce(v_doc.source_binding,'null'::jsonb) THEN EXIT association; END IF;
   SELECT * INTO visible FROM public.get_paige_durable_work(w.id);
   IF NOT FOUND OR visible.work_status IS DISTINCT FROM w.status OR w.status IN ('failed','cancelled') THEN EXIT association; END IF;
   publication:=publication||jsonb_build_object('association','matched','work_id',w.id,'work_status',visible.work_status);
   IF w.status='succeeded' THEN
    IF w.terminal_outcome->'verified_readback' IS DISTINCT FROM 'true'::jsonb
      OR w.terminal_outcome->>'phase' IS DISTINCT FROM 'published'
      OR w.terminal_outcome->>'document_id' IS DISTINCT FROM v_doc.id::text
      OR w.terminal_outcome->>'generation_id' IS DISTINCT FROM w.id::text
      OR w.terminal_outcome->>'revision' IS DISTINCT FROM ((w.request_payload->>'revision')::bigint+1)::text
      OR (w.request_payload->>'revision')::integer>=v_doc.revision
      OR w.terminal_outcome->>'chunk_count' IS DISTINCT FROM v_doc.chunk_count::text
      OR (SELECT count(*) FROM public.tenant_knowledge_chunks c WHERE c.doc_id=v_doc.id AND c.tenant_id=v_tenant AND c.generation_id=w.id)<>v_doc.chunk_count
      OR EXISTS(SELECT 1 FROM public.tenant_knowledge_chunks c WHERE c.doc_id=v_doc.id AND c.generation_id=w.id AND c.tenant_id IS DISTINCT FROM v_tenant)
      OR coalesce(w.terminal_outcome->>'outcome','') NOT IN ('capability_succeeded','capability_completed_unrecorded')
      THEN publication:=jsonb_set(publication,'{association}','"unavailable"'); publication:=publication||jsonb_build_object('work_id',NULL,'work_status',NULL); EXIT association; END IF;
    publication:=publication||jsonb_build_object('generation_id',w.id,'outcome',w.terminal_outcome->>'outcome');
   END IF;
  ELSIF v_doc.extraction_work_id IS NULL AND v_doc.record_state='canonical'
    AND NOT EXISTS(SELECT 1 FROM public.paige_durable_work x WHERE x.tenant_id=v_tenant
      AND (x.work_kind='knowledge_publish' OR x.capability_key='knowledge.publish')
      AND x.request_payload->>'document_id'=v_doc.id::text) THEN
   -- Verified idle legacy canonical content may enter the incumbent explicit
   -- correction input. It is NOT a saved review and cannot enable Publish.
   -- Any document-bound publication history, even malformed, prevents this path.
   publication:=publication||jsonb_build_object('association','not_submitted');
  END IF;
 EXCEPTION WHEN data_exception THEN
  -- Malformed historic payloads are unreadable association, never proof of absence.
  publication:=jsonb_build_object('contract_version',1,'association','unavailable',
    'work_id',NULL,'work_status',NULL,'generation_id',NULL,'outcome',NULL);
 END association;
 RETURN jsonb_build_object('tenant_id',v_tenant,'document_id',v_doc.id,'revision',v_doc.revision,
  'record_state',v_doc.record_state,'source_coverage',v_doc.source_coverage,
  'source_binding',v_doc.source_binding,'pending_review',v_doc.pending_review,
  'extraction_work_id',v_doc.extraction_work_id,'extraction_source_binding',v_doc.extraction_source_binding,
  'publication',publication);
END $$;
-- CREATE OR REPLACE preserves the incumbent owner and ACL. No new grants.

-- Both the saved-review candidate loop and legacy-idle NOT EXISTS use this
-- exact tenant/document predicate. Keep OR: a malformed envelope carrying only
-- one publication marker must remain visible to the reader's refusal checks.
-- Ordinary CREATE INDEX supports transactional migration replay; unlike a
-- concurrent build it cannot leave a failed invalid index. It can briefly block
-- envelope writes while building, so normal release lock monitoring still applies.
CREATE INDEX IF NOT EXISTS paige_durable_work_knowledge_document_idx
 ON public.paige_durable_work (tenant_id, (request_payload->>'document_id'))
 WHERE (work_kind='knowledge_publish' OR capability_key='knowledge.publish');
