-- WORK IN PROGRESS: native context support. Not committed/applied/released.
-- Reuse canonical private Chat issuance and Knowledge grants; no new engine.
BEGIN;

DO $context_source_lease$
DECLARE expected record; actual record; allowed_role oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean)','0120d7a89a86905d65eff99a0ebcc1bf','authenticated','search_path=public','v'),
  ('public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb)','1f5deb1c10203c3ab210966385c3e437','service_role','search_path=public','v'),
  ('public.paige_chat_interactive_publication_context_v2(uuid,uuid)','be07fc98ebd07c788175cb852a5739e4','authenticated','search_path=""','s'),
  ('public.client_portal_frame()','b3826e6b52ba34cd40348112b8145883','authenticated','search_path=public, pg_temp','s'),
  ('public.paige_chat_customer_thread_authorized(uuid)','1f736ad4206faf196290c13939edca35','authenticated','search_path=public, pg_temp','s'),
  ('public._client_knowledge_share_current(public.tenant_knowledge_client_shares)','d14c0ae79549791e27338a040a3fe296',NULL,'search_path=""','s')
 ) e(signature,body_md5,api_role,setting,volatility) LOOP
  SELECT md5(prosrc) body_md5,proowner,prosecdef,proconfig,proacl,provolatile INTO actual
    FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  allowed_role:=(SELECT oid FROM pg_roles WHERE rolname=expected.api_role);
  IF actual.body_md5 IS DISTINCT FROM expected.body_md5
    OR pg_get_userbyid(actual.proowner) IS DISTINCT FROM 'postgres'
    OR actual.prosecdef IS DISTINCT FROM true
    OR actual.provolatile::text IS DISTINCT FROM expected.volatility
    OR actual.proconfig IS DISTINCT FROM ARRAY[expected.setting]::text[]
    OR cardinality(actual.proacl) IS DISTINCT FROM (CASE WHEN allowed_role IS NULL THEN 1 ELSE 2 END)
    OR EXISTS(SELECT 1 FROM aclexplode(actual.proacl) a WHERE a.grantor<>actual.proowner
      OR a.is_grantable OR a.privilege_type<>'EXECUTE'
      OR (a.grantee<>actual.proowner AND a.grantee IS DISTINCT FROM allowed_role)) THEN
   RAISE EXCEPTION 'Customer context source or permission changed; review before composition' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $context_source_lease$;

CREATE FUNCTION public._client_knowledge_refs_valid(p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF p_refs IS NULL OR jsonb_typeof(p_refs)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_refs)>20 THEN RETURN false; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF jsonb_typeof(r)<>'object' THEN RETURN false; END IF;
  IF NOT r ?& ARRAY['share_id','share_revision','source_fingerprint']
   OR r-ARRAY['share_id','share_revision','source_fingerprint']<>'{}'::jsonb
   OR jsonb_typeof(r->'share_id')<>'string' OR r->>'share_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(r->'share_revision')<>'number' OR r->>'share_revision' !~ '^[1-9][0-9]{0,8}$'
   OR jsonb_typeof(r->'source_fingerprint')<>'string' OR r->>'source_fingerprint' !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 END LOOP;
 RETURN (SELECT count(DISTINCT (value->>'share_id')::uuid) FROM jsonb_array_elements(p_refs))=jsonb_array_length(p_refs);
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_snapshot_valid(p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' THEN RETURN false; END IF;
 IF NOT p_snapshot ?& ARRAY['version','retrieval_refs','source_refs']
  OR p_snapshot-ARRAY['version','retrieval_refs','source_refs']<>'{}'::jsonb
  OR p_snapshot->'version' IS DISTINCT FROM '1'::jsonb
  OR NOT public._client_knowledge_refs_valid(p_snapshot->'retrieval_refs')
  OR NOT public._client_knowledge_refs_valid(p_snapshot->'source_refs') THEN RETURN false; END IF;
 RETURN jsonb_array_length(p_snapshot->'retrieval_refs')<=5
   AND (p_snapshot->'source_refs') @> (p_snapshot->'retrieval_refs');
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_snapshot_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_refs_current(p_tenant uuid,p_contact uuid,p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._client_knowledge_refs_valid(p_refs) THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) r
  WHERE NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_client_shares s
   WHERE s.id=(r->>'share_id')::uuid AND s.tenant_id=p_tenant AND s.contact_id=p_contact
    AND s.revision=(r->>'share_revision')::integer AND s.source_fingerprint=r->>'source_fingerprint'
    AND public._client_knowledge_share_current(s)));
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_current(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_refs_lock(p_actor uuid,p_tenant uuid,p_contact uuid,p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._client_knowledge_refs_valid(p_refs) OR p_actor IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL
  AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.clients WHERE id=p_contact AND tenant_id=p_tenant
  AND linked_user_id=p_actor AND status='active' AND merged_into_contact_id IS NULL FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RETURN false; END IF;
 -- Same canonical document-before-grant ordering as the owner share writer.
 PERFORM d.id FROM public.tenant_knowledge_docs d
  JOIN public.tenant_knowledge_client_shares s ON s.document_id=d.id AND s.tenant_id=d.tenant_id
  JOIN jsonb_array_elements(p_refs) r ON s.id=(r->>'share_id')::uuid
  WHERE s.tenant_id=p_tenant AND s.contact_id=p_contact ORDER BY d.id FOR SHARE OF d;
 PERFORM s.id FROM public.tenant_knowledge_client_shares s
  JOIN jsonb_array_elements(p_refs) r ON s.id=(r->>'share_id')::uuid
  WHERE s.tenant_id=p_tenant AND s.contact_id=p_contact ORDER BY s.id FOR SHARE OF s;
 -- A new statement after any lock wait rechecks the winning committed source state.
 RETURN public._client_knowledge_refs_current(p_tenant,p_contact,p_refs);
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_lock(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.client_portal_assistant_context(p_thread uuid,p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; accepted boolean;
 snapshot jsonb; retrieval jsonb; retrieval_refs jsonb; permitted_refs jsonb; history jsonb:='[]';
 turn record; turn_snapshot jsonb; turn_refs jsonb; merged_refs jsonb; ref jsonb;
 ref_cache jsonb:='{}'; cache_key text; current_ref boolean; valid_turn boolean;
 legacy boolean:=false; limited boolean:=false; remaining integer:=48000; piece text;
BEGIN
 IF actor IS NULL OR p_thread IS NULL OR p_intent IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR frame->>'actor_id' IS DISTINCT FROM actor::text
  OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT bundle_ref->'customer_knowledge' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id LIMIT 1;
 accepted:=FOUND;
 IF accepted THEN
  legacy:=snapshot IS NULL;
  IF legacy THEN snapshot:='{"version":1,"retrieval_refs":[],"source_refs":[]}';
  ELSIF NOT public._client_knowledge_snapshot_valid(snapshot) THEN
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501';
  END IF;
  IF NOT public._client_knowledge_refs_current(t.tenant_id,t.contact_id,snapshot->'source_refs') THEN
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_SOURCE_WITHDRAWN' USING ERRCODE='42501';
  END IF;
  retrieval_refs:=snapshot->'retrieval_refs';
  retrieval:=public.client_portal_knowledge_context(t.tenant_id,retrieval_refs,5,0,true)->'sources';
  permitted_refs:=snapshot->'source_refs';
 ELSE
  retrieval:=public.client_portal_knowledge_context(t.tenant_id,NULL,5,0,true)->'sources';
  SELECT coalesce(jsonb_agg(jsonb_build_object('share_id',s->'share_id','share_revision',s->'share_revision',
   'source_fingerprint',s->'source_fingerprint') ORDER BY ord),'[]'::jsonb) INTO retrieval_refs
   FROM jsonb_array_elements(retrieval) WITH ORDINALITY x(s,ord);
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
   -- Preserve private UI history, but unattested old assistant prose is not
   -- evidence for a new model turn. The customer's own words remain user data.
   IF turn.role='assistant' THEN limited:=true; CONTINUE; END IF;
   turn_refs:='[]';
  ELSIF NOT public._client_knowledge_snapshot_valid(turn_snapshot) THEN limited:=true; CONTINUE;
  ELSE turn_refs:=turn_snapshot->'source_refs'; END IF;
  IF accepted THEN
   IF NOT permitted_refs @> turn_refs THEN limited:=true; CONTINUE; END IF;
   merged_refs:=permitted_refs;
  ELSE
   SELECT coalesce(jsonb_agg(value ORDER BY value->>'share_id'),'[]'::jsonb) INTO merged_refs
    FROM(SELECT DISTINCT value FROM jsonb_array_elements(permitted_refs||turn_refs)) refs;
   IF jsonb_array_length(merged_refs)>20 THEN limited:=true; CONTINUE; END IF;
  END IF;
  valid_turn:=true;
  FOR ref IN SELECT value FROM jsonb_array_elements(turn_refs) LOOP
   cache_key:=(ref->>'share_id')||':'||(ref->>'share_revision')||':'||(ref->>'source_fingerprint');
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
  SELECT coalesce(jsonb_agg(v ORDER BY v->>'share_id'),'[]'::jsonb) INTO permitted_refs FROM (
   SELECT value v FROM jsonb_array_elements(retrieval_refs)
   UNION SELECT r.value FROM jsonb_array_elements(history) h(item)
    CROSS JOIN LATERAL jsonb_array_elements(h.item->'source_refs') r(value)
  ) refs;
  snapshot:=jsonb_build_object('version',1,'retrieval_refs',retrieval_refs,'source_refs',permitted_refs);
 END IF;
 RETURN jsonb_build_object('frame',frame,'thread_id',t.id,'intent_id',p_intent,
  'snapshot',CASE WHEN legacy THEN NULL ELSE snapshot END,'sources',retrieval,'history',history,'history_limited',limited);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_context(uuid,uuid) TO authenticated;

-- Add a customer-only adapter; the protected workspace begin/settle bodies stay
-- unchanged. Capture references in the existing native-issued accepted user row.
CREATE FUNCTION public.client_portal_assistant_begin(
 p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,
 p_bound_answer boolean DEFAULT false,p_stop boolean DEFAULT false,p_effectful boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; existing boolean; context jsonb; result jsonb; accepted_id uuid;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.audience<>'customer_private'
  OR NOT public.paige_chat_customer_thread_authorized(p_thread) THEN
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
   context:=public.client_portal_assistant_context(p_thread,p_intent);
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
REVOKE ALL ON FUNCTION public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean) TO authenticated;

-- Validate, never rewrite, terminal metadata. Original settle replay compares
-- the exact caller bundle and remains the sole native terminal writer.
CREATE FUNCTION public._client_knowledge_terminal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; supplied jsonb;
BEGIN
 IF NEW.role<>'assistant' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=NEW.thread_id;
 IF t.audience IS DISTINCT FROM 'customer_private' THEN RETURN NEW; END IF;
 supplied:=NEW.bundle_ref->'customer_knowledge';
 IF coalesce(NEW.content,'')='' AND NEW.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED')
  AND supplied IS NULL THEN RETURN NEW; END IF;
 SELECT bundle_ref->'customer_knowledge' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=NEW.interactive_intent_id
   AND interactive_actor_id=NEW.interactive_actor_id AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND OR NEW.interactive_actor_id IS DISTINCT FROM t.caller_user_id
  OR NEW.interactive_tenant_id IS DISTINCT FROM t.tenant_id THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501';
 END IF;
 IF snapshot IS NULL AND supplied IS NULL THEN RETURN NEW; END IF;
 IF NOT public._client_knowledge_snapshot_valid(snapshot) OR supplied IS DISTINCT FROM snapshot THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501';
 END IF;
 IF NOT public._client_knowledge_refs_lock(NEW.interactive_actor_id,t.tenant_id,t.contact_id,snapshot->'source_refs') THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_SOURCE_WITHDRAWN' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_terminal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e09_customer_knowledge_terminal BEFORE INSERT ON public.paige_chat_turns
 FOR EACH ROW EXECUTE FUNCTION public._client_knowledge_terminal_guard();

CREATE FUNCTION public._client_knowledge_publication_current(p_thread uuid,p_intent uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; accepted jsonb; terminal public.paige_chat_turns;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR t.audience<>'customer_private' OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL
   AND (banned_until IS NULL OR banned_until<=now())) THEN RETURN false; END IF;
 SELECT * INTO terminal FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='assistant'
  AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF coalesce(terminal.content,'')='' AND terminal.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED')
  AND terminal.bundle_ref->'customer_knowledge' IS NULL THEN RETURN true; END IF;
 SELECT bundle_ref->'customer_knowledge' INTO accepted FROM public.paige_chat_turns
  WHERE thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF accepted IS NULL THEN RETURN terminal.bundle_ref->'customer_knowledge' IS NULL; END IF;
 RETURN public._client_knowledge_snapshot_valid(accepted)
  AND terminal.bundle_ref->'customer_knowledge' IS NOT DISTINCT FROM accepted
  AND public._client_knowledge_refs_current(t.tenant_id,t.contact_id,accepted->'source_refs');
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_publication_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Apply only the leased E09 customer branch; retain workspace semantics and ACL.
DO $publication$
DECLARE definition text; prior text:='(t.audience=''customer_private'' and public.paige_chat_customer_thread_authorized(p_thread))';
BEGIN
 definition:=pg_get_functiondef('public.paige_chat_interactive_publication_context_v2(uuid,uuid)'::regprocedure);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN
  RAISE EXCEPTION 'Customer publication branch changed; review before composition' USING ERRCODE='42501';
 END IF;
 EXECUTE replace(definition,prior,'(t.audience=''customer_private'' and public.paige_chat_customer_thread_authorized(p_thread) and public._client_knowledge_publication_current(p_thread,p_intent))');
END $publication$;
COMMIT;
