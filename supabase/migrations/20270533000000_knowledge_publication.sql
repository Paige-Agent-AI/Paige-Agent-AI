-- Knowledge canonical publication: generation schema, dormant atomic promotion RPCs,
-- retrieval filters, legacy-writer guards. No provider worker, no UI cutover, no submit
-- activation for authenticated callers (creation stays unavailable until native worker
-- adoption proves fake-provider and real authorization).
--
-- Canonical invariants (frozen packet):
--  * tenant_knowledge_docs.active_generation_id nullable; NULL preserves every legacy
--    publication untouched.
--  * tenant_knowledge_chunks.generation_id nullable; unique (doc_id, generation_id,
--    chunk_index) for non-NULL generations; legacy NULL rows unchanged.
--  * A native intent freezes document/review/source identity, expected revision, manifest
--    hash/count/model/version. Repeated exact intent returns the same work; a different
--    payload refuses; only one unresolved publication per document.
--  * Staged chunks are invisible until atomic promotion; a retired generation stays stored
--    but invisible; no cleanup in this migration.
--  * Any failure before commit preserves prior content, metadata, chunks, generation.
--  * Receipt failure after a verified publication yields capability_completed_unrecorded;
--    a committed publication is never rolled back for its receipt.

-- ─── Schema layer ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_knowledge_docs
 ADD COLUMN IF NOT EXISTS active_generation_id uuid,
 ADD COLUMN IF NOT EXISTS publication_manifest jsonb,
 ADD COLUMN IF NOT EXISTS publication_intent_hash text;
ALTER TABLE public.tenant_knowledge_chunks
 ADD COLUMN IF NOT EXISTS generation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunk_generation_uidx
 ON public.tenant_knowledge_chunks(doc_id, generation_id, chunk_index)
 WHERE generation_id IS NOT NULL;

-- Manifest shape: exact ordered hashes + counts + versions. Nothing else may ride in it.
CREATE OR REPLACE FUNCTION public.knowledge_publication_manifest_valid(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(v)<>'object'
  OR NOT v ?& ARRAY['version','model','dimensions','chunk_count','chunk_hashes']
  OR v - ARRAY['version','model','dimensions','chunk_count','chunk_hashes'] <>'{}'::jsonb
  OR jsonb_typeof(v->'version')<>'string' OR (v->>'version')<>'unicode-1000-150-v1'
  OR jsonb_typeof(v->'model')<>'string' OR length(v->>'model') NOT BETWEEN 1 AND 100
  OR jsonb_typeof(v->'dimensions')<>'number' OR (v->>'dimensions')<>'1024'
  OR jsonb_typeof(v->'chunk_count')<>'number' OR (v->>'chunk_count') !~ '^[0-9]+$'
  OR (v->>'chunk_count')::int < 1 OR (v->>'chunk_count')::int > 565
  OR jsonb_typeof(v->'chunk_hashes')<>'array'
  OR jsonb_array_length(v->'chunk_hashes') <> (v->>'chunk_count')::int THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'chunk_hashes') h
  WHERE jsonb_typeof(h)<>'string' OR h#>>'{}' !~ '^[0-9a-f]{64}$');
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_publication_manifest_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_publication_manifest_valid(jsonb) TO authenticated,service_role;

ALTER TABLE public.tenant_knowledge_docs DROP CONSTRAINT IF EXISTS knowledge_publication_shape;
ALTER TABLE public.tenant_knowledge_docs ADD CONSTRAINT knowledge_publication_shape CHECK (
 (publication_manifest IS NULL OR public.knowledge_publication_manifest_valid(publication_manifest))
 AND (active_generation_id IS NULL OR publication_manifest IS NOT NULL)
 AND (publication_intent_hash IS NULL OR length(publication_intent_hash)=64));
-- Legacy rows carry NULL in all three publication fields, so the constraint holds without
-- a rewrite; the validator itself rejects NULL manifests because only published documents
-- (which always carry one) may set them.

-- ─── Canonical chunker: unicode-1000-150-v1 ──────────────────────────────────────────────
-- Precisely specified: collapse each whitespace run to one space, trim; if the cleaned text
-- fits 1000 code points emit one chunk; else emit 1000-char substrings stepping back 150
-- from each boundary (the final chunk is the remainder). PostgreSQL substring counts Unicode
-- code points; this is DELIBERATELY not the JS UTF-16 slicer (packet decision), and the
-- version string pins the semantics for every manifest it stamps.
CREATE OR REPLACE FUNCTION public.knowledge_publication_chunks(v text)
RETURNS TABLE(chunk_index integer, chunk_text text, chunk_sha256 text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE clean text; n integer; i integer := 0; idx integer := 0; piece text;
BEGIN
 clean:=btrim(regexp_replace(v,'\s+',' ','g'));
 IF clean IS NULL OR clean='' THEN RETURN; END IF;
 n:=length(clean);
 IF n<=1000 THEN
  idx:=0; piece:=clean;
  chunk_index:=idx; chunk_text:=piece; chunk_sha256:=encode(sha256(convert_to(piece,'UTF8')),'hex'); RETURN NEXT; RETURN;
 END IF;
 WHILE i<n LOOP
  piece:=substr(clean,i+1,least(1000,n-i));
  chunk_index:=idx; chunk_text:=piece; chunk_sha256:=encode(sha256(convert_to(piece,'UTF8')),'hex');
  RETURN NEXT;
  idx:=idx+1;
  EXIT WHEN i+1000>=n;
  i:=i+1000-150;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_publication_chunks(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_publication_chunks(text) TO service_role;

-- Manifest for a review text: version, model, dims, ordered hashes.
CREATE OR REPLACE FUNCTION public.knowledge_publication_manifest(v text, _model text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE hashes jsonb:='[]'::jsonb; c record; n integer:=0;
BEGIN
 FOR c IN SELECT * FROM public.knowledge_publication_chunks(v) LOOP
  hashes:=hashes||to_jsonb(c.chunk_sha256); n:=n+1;
 END LOOP;
 IF n=0 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version','unicode-1000-150-v1','model',_model,'dimensions',1024,'chunk_count',n,'chunk_hashes',hashes);
END $$;
REVOKE ALL ON FUNCTION public.knowledge_publication_manifest(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_publication_manifest(text,text) TO service_role;

-- ─── Publication RPCs (dormant: submit carries its final JWT shape but no authenticated
-- grant until native worker adoption; start/stage/complete/settle/recover are service-only
-- worker seams). Every writer re-locks authority, the work pair, and the exact frozen
-- document revision before touching anything. ────────────────────────────────────────────
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
 -- The intent hash lives in the work payload alone: any doc UPDATE here would fire the
 -- canonical revision-bump trigger and desynchronize the frozen revision (found by the
 -- publication behavior proof: docrev drifted 3->4 and start correctly refused).
 RETURN jsonb_build_object('work_id',created.work_id,'document_id',d.id::text,'status','claimed','replayed',false,'revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION public.submit_tenant_knowledge_publication(uuid,uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.submit_tenant_knowledge_publication(uuid,uuid,uuid,integer,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.start_knowledge_publication(_work_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.start_knowledge_publication(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_knowledge_publication(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.stage_knowledge_publication(
 _work_id uuid,_server_key text,_attempt integer,_revision integer,_chunks jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.stage_knowledge_publication(uuid,text,integer,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_knowledge_publication(uuid,text,integer,integer,jsonb) TO service_role;

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
   chunk_count=n,source_binding=d.extraction_source_binding,
   source_coverage=coalesce(d.pending_review->>'coverage','unknown'),
   pending_review=NULL,pending_review_metadata=NULL,extraction_work_id=NULL,extraction_input=NULL,extraction_source_binding=NULL,extraction_revision=NULL,
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
REVOKE ALL ON FUNCTION public.complete_knowledge_publication(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_knowledge_publication(uuid,text,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_knowledge_publication_failure(_work_id uuid,_server_key text,_attempt integer,_code text,_unknown boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work; d public.tenant_knowledge_docs;
BEGIN
 SELECT * INTO w FROM public.paige_durable_work WHERE id=_work_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind<>'knowledge_publish' OR w.capability_key<>'knowledge.publish' OR w.idempotency_key IS DISTINCT FROM _server_key OR _attempt IS DISTINCT FROM w.attempt_count OR w.dispatch_started_attempt<>w.attempt_count THEN RAISE EXCEPTION 'KNOWLEDGE_ATTEMPT_STALE' USING ERRCODE='40001'; END IF;
 IF w.status='succeeded' THEN RETURN; END IF;
 SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=(w.request_payload->>'document_id')::uuid FOR UPDATE;
 IF d IS NOT NULL AND d.active_generation_id=w.id THEN RAISE EXCEPTION 'KNOWLEDGE_PUBLICATION_COMMITTED' USING ERRCODE='40001'; END IF;
 IF w.status<>'claimed' OR w.lease_until<=now() THEN RAISE EXCEPTION 'KNOWLEDGE_LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
 IF _code NOT IN ('embedding_failed','stage_invalid','stage_incomplete','provider_unavailable','authority_changed','revision_changed','completion_unknown') OR _code IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_ERROR_INVALID'; END IF;
 PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,CASE WHEN _unknown THEN 'outcome_unknown' ELSE 'failed' END,CASE WHEN _unknown THEN NULL ELSE jsonb_build_object('reason',_code,'document_id',w.request_payload->>'document_id') END,'Knowledge publication needs attention. The prior publication is unchanged.',NULL,_code,300,false);
END $$;
REVOKE ALL ON FUNCTION public.settle_knowledge_publication_failure(uuid,text,integer,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_knowledge_publication_failure(uuid,text,integer,text,boolean) TO service_role;

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
   ELSE
    -- Uncertain dispatch is reconciled, never automatically re-embedded.
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'outcome_unknown',NULL,'Knowledge publication acknowledgement was lost; reconciliation recorded.',NULL,'completion_unknown',300,false);
   END IF;
   RETURN QUERY SELECT w.id;
  EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT w.id;
  END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.recover_knowledge_publication(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_knowledge_publication(integer) TO service_role;

-- ─── Retrieval truth: every search and direct chunk read honors the active generation ───
CREATE OR REPLACE FUNCTION public.match_tenant_knowledge(
  p_tenant_id uuid,
  p_query_embedding extensions.vector,
  p_match_count integer DEFAULT 6
)
RETURNS TABLE(source_tier text, doc_id uuid, chunk_id uuid, title text, content text, similarity double precision)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- §9: a JWT caller may only search their own tenant; service-role (edge fn) is pre-scoped.
  IF auth.uid() IS NOT NULL
     AND p_tenant_id IS DISTINCT FROM public.current_user_tenant_id()
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'KB_FORBIDDEN: cross-tenant knowledge search denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    'tenant'::text                                 AS source_tier,
    c.doc_id                                        AS doc_id,
    c.id                                            AS chunk_id,
    d.title                                         AS title,
    c.content                                       AS content,
    1 - (c.embedding <=> p_query_embedding)::float  AS similarity
  FROM public.tenant_knowledge_chunks c
  JOIN public.tenant_knowledge_docs d ON d.id = c.doc_id
  WHERE c.tenant_id = p_tenant_id
    AND d.tenant_id = c.tenant_id
    AND d.record_state = 'canonical'
    AND c.embedding IS NOT NULL
    AND c.generation_id IS NOT DISTINCT FROM d.active_generation_id
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END
$function$;
GRANT EXECUTE ON FUNCTION public.match_tenant_knowledge(uuid, extensions.vector, integer) TO authenticated, service_role;

-- Generation invisibility for direct reads is enforced by this RESTRICTIVE policy intersected with
-- the landed permissive membership policy; the definer match RPC independently enforces it
-- for search. (Independent review P3: comment previously overpromised RLS alone.)
DROP POLICY IF EXISTS knowledge_canonical_chunk_read ON public.tenant_knowledge_chunks;
CREATE POLICY knowledge_canonical_chunk_read ON public.tenant_knowledge_chunks
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (tenant_id = public.current_user_tenant_id()
   AND EXISTS(SELECT 1 FROM public.tenant_knowledge_docs d
    WHERE d.id = tenant_knowledge_chunks.doc_id
      AND d.tenant_id = tenant_knowledge_chunks.tenant_id
      AND d.record_state = 'canonical'
      AND tenant_knowledge_chunks.generation_id IS NOT DISTINCT FROM d.active_generation_id));

-- ─── Legacy writer guards: old ingestion paths must not corrupt managed documents ──────
-- SQL-side: a legacy (NULL-generation) chunk write to a managed (non-NULL active generation)
-- document is refused, as is a direct legacy content/count/source rewrite.
CREATE OR REPLACE FUNCTION public.guard_knowledge_generation_writes() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 -- A legacy (NULL-generation) chunk write to a document with an active managed generation
 -- would desynchronize the publication: refuse regardless of writer role. The RPCs stage
 -- with an explicit generation_id and are unaffected.
 IF NEW.generation_id IS NULL AND EXISTS(
   SELECT 1 FROM public.tenant_knowledge_docs d
   WHERE d.id = NEW.doc_id AND d.active_generation_id IS NOT NULL) THEN
  RAISE EXCEPTION 'KNOWLEDGE_GENERATION_MANAGED' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_generation_guard ON public.tenant_knowledge_chunks;
CREATE TRIGGER knowledge_generation_guard BEFORE INSERT OR UPDATE ON public.tenant_knowledge_chunks
 FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.guard_knowledge_generation_writes();
REVOKE ALL ON FUNCTION public.guard_knowledge_generation_writes() FROM PUBLIC,anon,authenticated,service_role;

-- ─── Delete-reason compatibility: a bound canonical source is retained by policy, not
-- "unavailable". Both browser validators update with this slice per the packet. ─────────
CREATE OR REPLACE FUNCTION public.delete_tenant_knowledge(
  p_expected_tenant uuid, p_doc_id uuid, p_expected_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_doc public.tenant_knowledge_docs;
  v_child_tenant uuid;
  v_deleted uuid;
  v_run uuid;
  v_outcome text := 'capability_succeeded';
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
  IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT (COALESCE(public.is_platform_owner(),false) OR COALESCE(public.is_tenant_member(v_tenant),false)) THEN
    RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_doc FROM public.tenant_knowledge_docs WHERE tenant_id=v_tenant AND id=p_doc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 OR v_doc.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  -- Parent FOR UPDATE blocks new FK references. Lock children before checking their
  -- tenant: the existing FK covers doc_id only, so a cascade alone is insufficient.
  FOR v_child_tenant IN
    SELECT tenant_id FROM public.tenant_knowledge_chunks WHERE doc_id=p_doc_id ORDER BY id FOR UPDATE
  LOOP
    IF v_child_tenant IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'KNOWLEDGE_CHILD_SCOPE_INVALID' USING ERRCODE='42501';
    END IF;
  END LOOP;
  DELETE FROM public.tenant_knowledge_docs
  WHERE tenant_id=v_tenant AND id=p_doc_id AND revision=p_expected_revision RETURNING id INTO v_deleted;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_DELETE_NOT_VERIFIED' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_knowledge_docs WHERE id=p_doc_id)
     OR EXISTS (SELECT 1 FROM public.tenant_knowledge_chunks WHERE doc_id=p_doc_id) THEN
    RAISE EXCEPTION 'KNOWLEDGE_DELETE_NOT_VERIFIED' USING ERRCODE='P0001';
  END IF;
  v_run := md5('knowledge_delete:'||v_tenant::text||':'||p_doc_id::text||':'||v_doc.revision::text)::uuid;
  BEGIN
    PERFORM public.record_capability_run(v_tenant,v_actor,'knowledge_delete','capability_succeeded',v_run,
      NULL::text,NULL::text,NULL::uuid,NULL::text,
      jsonb_build_object('document_id',p_doc_id,'revision',v_doc.revision,
        'operation','document_delete','source_cleanup','not_attempted'));
  EXCEPTION WHEN OTHERS THEN
    v_outcome := 'capability_completed_unrecorded';
  END;
  -- The ONLY delta from the landed 20270531200000 body: a bound canonical source is
  -- retained by policy, not falsely unavailable. Envelope and authority unchanged.
  RETURN jsonb_build_object('tenant_id',v_tenant,'document_id',p_doc_id,'deleted_revision',v_doc.revision,
    'document_absent',true,'chunks_absent',true,'outcome',v_outcome,'run_id',v_run,
    'source_cleanup',jsonb_build_object('status','not_attempted','reason',
      CASE WHEN v_doc.source_binding IS NULL THEN 'canonical_source_binding_unavailable' ELSE 'retained_by_policy' END));
END $$;
REVOKE ALL ON FUNCTION public.delete_tenant_knowledge(uuid,uuid,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_tenant_knowledge(uuid,uuid,integer) TO authenticated;
