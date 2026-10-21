-- E09 K2: relevant retrieval of customer Knowledge for CURA (the customer-facing agent).
--
-- K1 (20271111050000) decided WHAT a customer may be shown: contact and business-wide shares,
-- current for this customer, finance re-checked at read, exact pinned chunks only. K2 decides
-- WHICH of that authorized material reaches one answer: the passages closest to the customer's
-- question, instead of the five most recently shared documents.
--
-- Adds (nothing is replaced; the v1 context and the 7-argument begin stay exactly as they are):
--   * client_portal_assistant_context_v2(p_thread, p_intent, p_query_embedding)
--   * client_portal_assistant_begin(... 7 existing ..., p_query_embedding)  (an overload)
--   * internal helpers: _client_knowledge_source_v2, _client_knowledge_retrieve_v2,
--     _client_knowledge_history_refs, _client_knowledge_refs_merge_v2, _client_knowledge_authorized_count
--
-- Algorithm (fresh turn):
--   1. Build the authorized set first: one share per document that is current for THIS customer
--      (_client_knowledge_share_current_for; the customer's own share wins over a business share).
--   2. Candidates come only through _client_knowledge_chunk_admissible (exact chunk of the shared
--      pinned generation, voyage-3/1024, inside the manifest, text hashes to the manifest).
--   3. Rank by cosine distance (<=>) to the query; each share's best chunk ranks the share; top 5.
--   4. Per ranked share, passages closest to the question are taken (at most 8) while they fit in
--      4,800 characters, then presented in index order. Total stays at 5 x 4,800 = 24,000.
--   5. Unrankable shares (legacy per-customer shares without a pinned generation, or no embedded
--      chunk) fill the leftover slots by recency, exactly as before (whole document, 4,800 chars).
--   6. With no query embedding (the edge could not embed in time) the whole read is by recency.
--   Returns ranking ('relevance' when any source carries passages, else 'recency'),
--   sources_limited and authorized_count.
-- Replay (accepted turn): the stored v2 snapshot names each share, revision, fingerprint and the
-- passage indexes. Replay reads those passages by index and re-checks every hash through
-- _client_knowledge_chunk_admissible; it never re-embeds, so it is byte-identical to the turn's read.
-- A v1 (or legacy) accepted binding replays through the unchanged v1 context.
--
-- Authority: both entry points are authenticated-only and re-resolve the asker from the thread:
-- paige_chat_customer_thread_authorized(p_thread) AND client_portal_relationship_id(thread tenant)
-- = thread contact. The embedding only orders material that is already authorized; a forged vector
-- cannot add a share. No table, policy or grant on a table changes; no share is created.
BEGIN;

DO $k2_lease$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._client_knowledge_share_current_for(public.tenant_knowledge_client_shares,uuid)','03a92bef49a3596fca0a5617c865bd4c'),
  ('public._client_knowledge_chunk_admissible(public.tenant_knowledge_chunks,public.tenant_knowledge_docs,public.tenant_knowledge_client_shares)','8f3e87382fd1b39a348bba8064a89ed5'),
  ('public._client_knowledge_refs_current(uuid,uuid,jsonb)','515621d35c6e3f029d725400bdaf5519'),
  ('public._client_knowledge_refs_lock(uuid,uuid,uuid,jsonb)','26ad16705d2c9218ebfc8b895780a810'),
  ('public._client_knowledge_snapshot_valid(jsonb)','9e00aaa5151be3fc6d59ae0fb889ad0b'),
  ('public._client_knowledge_refs_valid_v2(jsonb)','3c02c796ba2b539ade716ab34986818c'),
  ('public._client_knowledge_ref_key(jsonb)','f4a0d9552b25dd1bafb48d8837c78199'),
  ('public._client_knowledge_refs_within_caps(jsonb,integer)','89a08897c37ae05899afbad3d5736d16'),
  ('public.client_portal_assistant_context(uuid,uuid)','821b50485bfb2a0932105de28a0ed356'),
  ('public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean)','f3615b716fa618c35293f5053f830d69'),
  ('public.paige_chat_customer_thread_authorized(uuid)','1f736ad4206faf196290c13939edca35'),
  ('public.client_portal_relationship_id(uuid)','da4f00851ef119e4a364aecad7292543')
 ) e(signature,body_md5) LOOP
  SELECT md5(prosrc) body_md5,proowner INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF actual.body_md5 IS DISTINCT FROM expected.body_md5 OR pg_get_userbyid(actual.proowner) IS DISTINCT FROM 'postgres' THEN
   RAISE EXCEPTION 'Customer Knowledge retrieval source changed (%); review before composition',expected.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $k2_lease$;

-- ─── 1. Authorized documents for one customer (live) ──────────────────────────────────────────────
CREATE FUNCTION public._client_knowledge_authorized_count(p_tenant uuid,p_contact uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(DISTINCT s.document_id)::integer FROM public.tenant_knowledge_client_shares s
  WHERE s.tenant_id=p_tenant AND (s.audience='business' OR s.contact_id=p_contact)
   AND public._client_knowledge_share_current_for(s,p_contact)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_authorized_count(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- ─── 2. One customer source (v2 shape) ────────────────────────────────────────────────────────────
-- Passages NULL: the document text, first 4,800 characters (exactly the v1 per-source limit 24000/5).
-- Passages given: exactly those admissible chunks of the shared pinned generation, in index order,
-- joined by a blank line; NULL when any passage is missing or fails its manifest hash. An excerpt is
-- marked content_truncated unless it is every chunk of the document.
CREATE FUNCTION public._client_knowledge_source_v2(
 s public.tenant_knowledge_client_shares,d public.tenant_knowledge_docs,p_passages integer[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE body text; found_count integer; truncated boolean;
BEGIN
 IF s.id IS NULL OR d.id IS NULL OR d.id<>s.document_id OR d.tenant_id<>s.tenant_id THEN RETURN NULL; END IF;
 IF p_passages IS NULL THEN
  body:=coalesce(d.content,'');
  truncated:=length(body)>4800;
 ELSE
  IF cardinality(p_passages) NOT BETWEEN 1 AND 8
   OR (SELECT count(DISTINCT p) FROM unnest(p_passages) p)<>cardinality(p_passages) THEN RETURN NULL; END IF;
  SELECT string_agg(ch.content,E'\n\n' ORDER BY ch.chunk_index),count(DISTINCT ch.chunk_index)
   INTO body,found_count
   FROM public.tenant_knowledge_chunks ch
   WHERE ch.doc_id=s.document_id AND ch.tenant_id=s.tenant_id AND ch.generation_id=s.generation_id
    AND ch.chunk_index=ANY(p_passages) AND public._client_knowledge_chunk_admissible(ch,d,s);
  IF found_count IS DISTINCT FROM cardinality(p_passages) THEN RETURN NULL; END IF;
  truncated:=length(body)>4800 OR cardinality(p_passages)<(d.publication_manifest->>'chunk_count')::integer;
 END IF;
 RETURN jsonb_build_object('share_id',s.id,'share_revision',s.revision,'source_fingerprint',s.source_fingerprint,
  'passages',CASE WHEN p_passages IS NULL THEN NULL ELSE to_jsonb(p_passages) END,
  'document_id',d.id,'document_revision',d.revision,'generation_id',d.active_generation_id,
  'title',left(d.title,300),'content',left(body,4800),'content_truncated',truncated,
  'customer_kind',s.customer_kind,'valid_until',s.valid_until);
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_source_v2(public.tenant_knowledge_client_shares,public.tenant_knowledge_docs,integer[])
 FROM PUBLIC,anon,authenticated,service_role;

-- ─── 3. Fresh retrieval: authorized set first, rank admissible chunks, recency fill ──────────────
-- search_path pins public, extensions (lint:vector-path): the vector operators live in extensions.
CREATE FUNCTION public._client_knowledge_retrieve_v2(p_tenant uuid,p_contact uuid,p_query extensions.vector)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE ranked record; ch record; s public.tenant_knowledge_client_shares; d public.tenant_knowledge_docs;
 sources jsonb:='[]'; refs jsonb:='[]'; chosen uuid[]:='{}'; picked integer[]; used integer; src jsonb;
BEGIN
 IF p_query IS NOT NULL AND extensions.vector_dims(p_query)<>1024 THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_QUERY_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_query IS NOT NULL THEN
  FOR ranked IN
   WITH authorized AS (
    SELECT DISTINCT ON (c.document_id) c.* FROM public.tenant_knowledge_client_shares c
     WHERE c.tenant_id=p_tenant AND (c.audience='business' OR c.contact_id=p_contact)
      AND public._client_knowledge_share_current_for(c,p_contact)
     ORDER BY c.document_id,(c.audience='contact') DESC,c.updated_at DESC,c.id)
   SELECT a.id,min(x.embedding OPERATOR(extensions.<=>) p_query) AS distance
    FROM authorized a
    JOIN public.tenant_knowledge_docs dd ON dd.id=a.document_id AND dd.tenant_id=a.tenant_id
    JOIN public.tenant_knowledge_chunks x ON x.doc_id=a.document_id AND x.tenant_id=a.tenant_id
     AND x.generation_id=a.generation_id
    WHERE a.generation_id IS NOT NULL AND x.embedding IS NOT NULL
     AND public._client_knowledge_chunk_admissible(x,dd,a)
    GROUP BY a.id ORDER BY 2,1 LIMIT 5
  LOOP
   SELECT * INTO s FROM public.tenant_knowledge_client_shares WHERE id=ranked.id;
   SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=s.document_id AND tenant_id=s.tenant_id;
   picked:='{}'; used:=0;
   FOR ch IN SELECT x.chunk_index,length(x.content) AS len FROM public.tenant_knowledge_chunks x
     WHERE x.doc_id=s.document_id AND x.tenant_id=s.tenant_id AND x.generation_id=s.generation_id
      AND x.embedding IS NOT NULL AND public._client_knowledge_chunk_admissible(x,d,s)
     ORDER BY x.embedding OPERATOR(extensions.<=>) p_query,x.chunk_index LOOP
    EXIT WHEN cardinality(picked)>=8;
    -- The closest passage is always taken; later ones only while the excerpt still fits 4,800.
    IF cardinality(picked)>0 AND used+2+ch.len>4800 THEN CONTINUE; END IF;
    used:=used+ch.len+CASE WHEN cardinality(picked)>0 THEN 2 ELSE 0 END;
    picked:=picked||ch.chunk_index;
   END LOOP;
   SELECT array_agg(p ORDER BY p) INTO picked FROM unnest(picked) p;
   src:=public._client_knowledge_source_v2(s,d,picked);
   IF src IS NULL THEN CONTINUE; END IF;
   sources:=sources||jsonb_build_array(src);
   refs:=refs||jsonb_build_array(jsonb_build_object('kind','knowledge_share','share_id',s.id,
    'share_revision',s.revision,'source_fingerprint',s.source_fingerprint,'passages',to_jsonb(picked)));
   chosen:=chosen||s.id;
  END LOOP;
 END IF;
 -- Leftover slots: authorized shares not ranked above, by recency (all of them when no query).
 FOR ranked IN
  SELECT q.id FROM (
   SELECT DISTINCT ON (c.document_id) c.* FROM public.tenant_knowledge_client_shares c
    WHERE c.tenant_id=p_tenant AND (c.audience='business' OR c.contact_id=p_contact)
     AND public._client_knowledge_share_current_for(c,p_contact)
    ORDER BY c.document_id,(c.audience='contact') DESC,c.updated_at DESC,c.id) q
  WHERE q.id<>ALL(chosen)
  ORDER BY q.updated_at DESC,q.id LIMIT greatest(0,5-jsonb_array_length(sources))
 LOOP
  SELECT * INTO s FROM public.tenant_knowledge_client_shares WHERE id=ranked.id;
  SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=s.document_id AND tenant_id=s.tenant_id;
  src:=public._client_knowledge_source_v2(s,d,NULL);
  IF src IS NULL THEN CONTINUE; END IF;
  sources:=sources||jsonb_build_array(src);
  refs:=refs||jsonb_build_array(jsonb_build_object('kind','knowledge_share','share_id',s.id,
   'share_revision',s.revision,'source_fingerprint',s.source_fingerprint));
 END LOOP;
 RETURN jsonb_build_object('sources',sources,'refs',refs);
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_retrieve_v2(uuid,uuid,extensions.vector) FROM PUBLIC,anon,authenticated,service_role;

-- ─── 4. History refs: v1 refs gain their kind; passages are a retrieval detail, not history ──────
CREATE FUNCTION public._client_knowledge_history_refs(p_refs jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(v ORDER BY public._client_knowledge_ref_key(v),v::text),'[]'::jsonb) FROM (
  SELECT DISTINCT CASE WHEN r ? 'kind' THEN r-'passages' ELSE jsonb_build_object('kind','knowledge_share')||r END v
  FROM jsonb_array_elements(coalesce(p_refs,'[]'::jsonb)) r) x
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_history_refs(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Union of v2 refs: one ref per (kind, id, revision), keeping the retrieval ref that carries passages
-- (it contains the passage-less history ref). NULL past any per-kind cap.
CREATE FUNCTION public._client_knowledge_refs_merge_v2(p_a jsonb,p_b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH u AS (SELECT value v FROM jsonb_array_elements(coalesce(p_a,'[]'::jsonb)||coalesce(p_b,'[]'::jsonb))),
 one AS (SELECT DISTINCT ON (v-'passages') v FROM u ORDER BY v-'passages',(v ? 'passages') DESC,v::text),
 merged AS (SELECT coalesce(jsonb_agg(v ORDER BY public._client_knowledge_ref_key(v),v::text),'[]'::jsonb) refs FROM one)
 SELECT CASE WHEN public._client_knowledge_refs_within_caps(refs,20) THEN refs END FROM merged
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_merge_v2(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ─── 5. The v2 assistant context ─────────────────────────────────────────────────────────────────
CREATE FUNCTION public.client_portal_assistant_context_v2(p_thread uuid,p_intent uuid,
 p_query_embedding extensions.vector DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; accepted boolean;
 snapshot jsonb; retrieval jsonb:='[]'; retrieval_refs jsonb; permitted_refs jsonb; history jsonb:='[]';
 turn record; turn_snapshot jsonb; turn_refs jsonb; merged_refs jsonb; ref jsonb; picked jsonb;
 ref_cache jsonb:='{}'; cache_key text; current_ref boolean; valid_turn boolean;
 limited boolean:=false; remaining integer:=48000; piece text; authorized integer; replay jsonb;
 s public.tenant_knowledge_client_shares; d public.tenant_knowledge_docs; src jsonb;
BEGIN
 IF actor IS NULL OR p_thread IS NULL OR p_intent IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_query_embedding IS NOT NULL AND extensions.vector_dims(p_query_embedding)<>1024 THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_QUERY_INVALID' USING ERRCODE='22023';
 END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 -- Re-resolve the asker from the thread: the native thread binding AND the caller's one open
 -- relationship with the thread's business is the thread's contact.
 IF NOT FOUND OR t.audience IS DISTINCT FROM 'customer_private'
  OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR public.client_portal_relationship_id(t.tenant_id) IS DISTINCT FROM t.contact_id
  OR frame->>'actor_id' IS DISTINCT FROM actor::text
  OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 authorized:=public._client_knowledge_authorized_count(t.tenant_id,t.contact_id);
 SELECT bundle_ref->'customer_knowledge' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id LIMIT 1;
 accepted:=FOUND;
 IF accepted AND snapshot->'version' IS DISTINCT FROM '2'::jsonb THEN
  -- A v1 (or legacy, knowledgeless) binding replays through the unchanged v1 context.
  replay:=public.client_portal_assistant_context(p_thread,p_intent);
  RETURN replay||jsonb_build_object('query_embedding_eligible',false,'ranking','recency','authorized_count',authorized,
   'sources_limited',authorized>jsonb_array_length(replay->'sources'));
 END IF;
 IF accepted THEN
  IF NOT public._client_knowledge_snapshot_valid(snapshot) THEN
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501';
  END IF;
  -- Currency, revision, fingerprint and every passage's manifest hash, re-checked now.
  IF NOT public._client_knowledge_refs_current(t.tenant_id,t.contact_id,snapshot->'source_refs') THEN
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_SOURCE_WITHDRAWN' USING ERRCODE='42501';
  END IF;
  retrieval_refs:=snapshot->'retrieval_refs';
  FOR ref IN SELECT value FROM jsonb_array_elements(retrieval_refs) WITH ORDINALITY r(value,ord) ORDER BY ord LOOP
   s:=NULL; d:=NULL;
   SELECT * INTO s FROM public.tenant_knowledge_client_shares x WHERE x.id=(ref->>'share_id')::uuid
    AND x.tenant_id=t.tenant_id AND (x.audience='business' OR x.contact_id=t.contact_id)
    AND x.revision=(ref->>'share_revision')::integer AND x.source_fingerprint=ref->>'source_fingerprint';
   SELECT * INTO d FROM public.tenant_knowledge_docs x WHERE x.id=s.document_id AND x.tenant_id=s.tenant_id;
   -- Passages by index; never re-embedded.
   src:=public._client_knowledge_source_v2(s,d,CASE WHEN ref ? 'passages' THEN
    ARRAY(SELECT (p#>>'{}')::integer FROM jsonb_array_elements(ref->'passages') WITH ORDINALITY q(p,o) ORDER BY o) END);
   IF src IS NULL THEN RAISE EXCEPTION 'CUSTOMER_CONTEXT_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
   retrieval:=retrieval||jsonb_build_array(src);
  END LOOP;
  permitted_refs:=snapshot->'source_refs';
 ELSE
  picked:=public._client_knowledge_retrieve_v2(t.tenant_id,t.contact_id,p_query_embedding);
  retrieval:=picked->'sources';
  retrieval_refs:=picked->'refs';
  permitted_refs:=retrieval_refs;
 END IF;
 FOR turn IN SELECT role,content,bundle_ref,seq FROM public.paige_chat_turns
  WHERE thread_id=t.id AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id
   AND interactive_intent_id IS NOT NULL AND interactive_intent_id<>p_intent
   AND role IN('user','assistant') AND content IS NOT NULL AND content<>''
   AND (role='user' OR interactive_terminal_state IS NOT NULL)
  ORDER BY seq DESC LIMIT 49 LOOP
  turn_snapshot:=turn.bundle_ref->'customer_knowledge';
  IF turn_snapshot IS NULL THEN
   -- Unattested old assistant prose is not evidence for a new model turn; the customer's own
   -- words remain user data.
   IF turn.role='assistant' THEN limited:=true; CONTINUE; END IF;
   turn_refs:='[]';
  ELSIF NOT public._client_knowledge_snapshot_valid(turn_snapshot) THEN limited:=true; CONTINUE;
  ELSE turn_refs:=public._client_knowledge_history_refs(turn_snapshot->'source_refs'); END IF;
  IF accepted THEN
   IF NOT permitted_refs @> turn_refs THEN limited:=true; CONTINUE; END IF;
   merged_refs:=permitted_refs;
  ELSE
   merged_refs:=public._client_knowledge_refs_merge_v2(permitted_refs,turn_refs);
   IF merged_refs IS NULL THEN limited:=true; CONTINUE; END IF;
  END IF;
  valid_turn:=true;
  FOR ref IN SELECT value FROM jsonb_array_elements(turn_refs) LOOP
   cache_key:=public._client_knowledge_ref_key(ref)||':'||ref::text;
   IF ref_cache ? cache_key THEN current_ref:=(ref_cache->>cache_key)::boolean;
   ELSE
    current_ref:=public._client_knowledge_refs_current(t.tenant_id,t.contact_id,jsonb_build_array(ref));
    ref_cache:=ref_cache||jsonb_build_object(cache_key,current_ref);
   END IF;
   IF NOT current_ref THEN valid_turn:=false; EXIT; END IF;
  END LOOP;
  IF NOT valid_turn THEN limited:=true; CONTINUE; END IF;
  IF remaining<=0 THEN limited:=true; EXIT; END IF;
  piece:=left(turn.content,least(12000,remaining));
  IF length(piece)<length(turn.content) THEN limited:=true; END IF;
  remaining:=remaining-length(piece);
  history:=jsonb_build_array(jsonb_build_object('role',turn.role,'content',piece,'source_refs',turn_refs))||history;
  permitted_refs:=merged_refs;
 END LOOP;
 WHILE jsonb_array_length(history)>0 AND history->0->>'role'<>'user' LOOP
  history:=history-0; limited:=true;
 END LOOP;
 IF NOT accepted THEN
  permitted_refs:=public._client_knowledge_refs_merge_v2(retrieval_refs,
   (SELECT coalesce(jsonb_agg(r.value),'[]'::jsonb) FROM jsonb_array_elements(history) h(item)
     CROSS JOIN LATERAL jsonb_array_elements(h.item->'source_refs') r(value)));
  snapshot:=jsonb_build_object('version',2,'retrieval_refs',retrieval_refs,'source_refs',permitted_refs);
  IF permitted_refs IS NULL OR NOT public._client_knowledge_snapshot_valid(snapshot) THEN
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN jsonb_build_object('frame',frame,'thread_id',t.id,'intent_id',p_intent,'snapshot',snapshot,
  'sources',retrieval,'history',history,'history_limited',limited,
  'ranking',CASE WHEN jsonb_path_exists(retrieval_refs,'$[*].passages') THEN 'relevance' ELSE 'recency' END,
  'authorized_count',authorized,'sources_limited',authorized>jsonb_array_length(retrieval),
  -- Observe the same canonical/legacy intent and supersedes evidence as native begin.
  -- This avoids known replay egress; begin still locks and decides admission itself.
  'query_embedding_eligible',NOT accepted AND t.interactive_latest_intent IS DISTINCT FROM p_intent
   AND NOT EXISTS(SELECT 1 FROM public.paige_chat_turns x WHERE x.thread_id=t.id AND (
    x.interactive_intent_id=p_intent OR x.bundle_ref#>>'{interactive,request_intent_id}'=p_intent::text
    OR x.interactive_supersedes_id=p_intent OR x.bundle_ref#>>'{interactive,supersedes_intent_id}'=p_intent::text)));
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector) TO authenticated;

-- ─── 6. The begin overload: the 7-argument body, with the v2 context and the asker re-resolved ────
-- Every argument is required (no defaults), so a 7-argument call can only resolve the original
-- function and an 8-argument call only this one.
CREATE FUNCTION public.client_portal_assistant_begin(
 p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,
 p_bound_answer boolean,p_stop boolean,p_effectful boolean,p_query_embedding extensions.vector)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; existing boolean; context jsonb; result jsonb; accepted_id uuid;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.audience<>'customer_private'
  OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR public.client_portal_relationship_id(t.tenant_id) IS DISTINCT FROM t.contact_id THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_bound_answer IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_RESUME_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF p_stop IS NOT TRUE THEN
  SELECT EXISTS(SELECT 1 FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='user'
   AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid()
   AND interactive_tenant_id=t.tenant_id) INTO existing;
  IF NOT existing THEN
   context:=public.client_portal_assistant_context_v2(p_thread,p_intent,p_query_embedding);
   IF NOT public._client_knowledge_refs_lock(auth.uid(),t.tenant_id,t.contact_id,
    context#>'{snapshot,source_refs}') THEN
    RAISE EXCEPTION 'CUSTOMER_CONTEXT_SOURCE_WITHDRAWN' USING ERRCODE='42501';
   END IF;
  END IF;
 END IF;
 result:=public.paige_chat_interactive_begin_v2(p_thread,p_intent,p_supersedes,p_content,
  p_bound_answer,p_stop,p_effectful);
 IF p_stop IS NOT TRUE AND NOT existing AND result->>'status'='accepted' THEN
  accepted_id:=(result->>'turn_id')::uuid;
  UPDATE public.paige_chat_turns SET bundle_ref=coalesce(bundle_ref,'{}')||
   jsonb_build_object('customer_knowledge',context->'snapshot')
   WHERE id=accepted_id AND thread_id=p_thread AND role='user'
    AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid()
    AND interactive_tenant_id=t.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector) TO authenticated;

COMMIT;
