-- Worker adoption repairs for the knowledge publication system (round-2 recheck of the
-- adoption slice). Both changes replace functions created in 20270533000000: editing that
-- already-recorded file cannot reach production, because deploy-migrations applies a plain
-- db push that skips recorded versions (owner ruling 2026-09-29, never --include-all), so
-- the repairs ship here as CREATE OR REPLACE instead.
--
-- 1) submit_tenant_knowledge_publication wakes the native worker at creation. Without a
--    wake a fresh row sat claimed with a 60s lease until the cron sweep reconciled it to
--    outcome_unknown having never embedded, and KNOWLEDGE_PUBLICATION_PENDING then refused
--    every later publication for that document — a lost wake permanently wedged it.
-- 2) recover_knowledge_publication gains the missed-wake requeue branch extraction's
--    recovery already has: a row whose dispatch never started (dispatch_started_attempt
--    below attempt_count) with attempts left is requeued expired -> claimed for the sweep
--    to re-drive; only a dispatch that actually started reconciles to outcome_unknown
--    (never re-embedded), exhausted attempts fail with attempt_limit, and lost authority
--    blocks — recover_knowledge_extraction's exact branch structure.

CREATE OR REPLACE FUNCTION public.submit_tenant_knowledge_publication(
 p_expected_tenant uuid,p_doc_id uuid,p_work_id uuid,p_expected_revision integer,p_intent_id uuid,p_review_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.submit_tenant_knowledge_publication(uuid,uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.submit_tenant_knowledge_publication(uuid,uuid,uuid,integer,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.recover_knowledge_publication(_limit integer DEFAULT 10)
RETURNS TABLE(work_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs; result jsonb; n integer;
BEGIN
 FOR w IN SELECT * FROM public.paige_durable_work WHERE work_kind='knowledge_publish' AND capability_key='knowledge.publish'
   AND status IN ('claimed','expired') AND (lease_until IS NULL OR lease_until<=now()) ORDER BY updated_at LIMIT least(coalesce(_limit,10),25) FOR UPDATE SKIP LOCKED LOOP
  BEGIN
   SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid AND tenant_id=w.tenant_id FOR UPDATE;
   -- FOUND, not "d IS NOT NULL": a composite with any NULL column reads as NULL in plpgsql,
   -- so the committed-generation branch silently never fired (caught by the recover proof).
   IF FOUND AND d.active_generation_id=w.id THEN
    -- Committed generation, lost acknowledgement: record the terminal truth, never re-dispatch.
    n:=(SELECT count(*) FROM public.tenant_knowledge_chunks WHERE doc_id=d.id AND generation_id=w.id);
    result:=jsonb_build_object('verified_readback',true,'document_id',d.id,'revision',d.revision,'generation_id',w.id,'chunk_count',n,'outcome','capability_succeeded','phase','published','reconciled',true);
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',result,'Knowledge publication was reconciled after a lost acknowledgement.',NULL,NULL,300,false);
   ELSIF NOT public.knowledge_actor_authorized(w.initiating_user_id,w.tenant_id) THEN
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,'Knowledge publication is paused because workspace access changed.','authority_changed','authority_changed',300,false);
   ELSIF w.dispatch_started_attempt=w.attempt_count THEN
    -- The dispatch began and its acknowledgement was lost: reconcile, never re-embed.
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'outcome_unknown',NULL,'Knowledge publication acknowledgement was lost; reconciliation recorded.',NULL,'completion_unknown',300,false);
   ELSIF w.attempt_count>=w.max_attempts THEN
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'failed',jsonb_build_object('reason','attempt_limit','document_id',w.request_payload->>'document_id'),'Knowledge publication could not start.',NULL,'attempt_limit',300,false);
   ELSE
    -- The wake never landed, so nothing was ever dispatched: requeue for the sweep to
    -- re-drive — the missed-wake recovery recover_knowledge_extraction performs.
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'expired',NULL,'Recovering a missed publication wake.',NULL,'lease_expired',300,false);
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'claimed',NULL,'Knowledge publication is queued.',NULL,NULL,60,true);
   END IF;
   RETURN QUERY SELECT w.id;
  EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT w.id;
  END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.recover_knowledge_publication(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_knowledge_publication(integer) TO service_role;
