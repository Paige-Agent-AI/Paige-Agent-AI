-- EXP09: one deliberately selected public link in the ORIGINAL private turn.
-- Binding/currentness only: no HTTP, search, new record store, actor role or grant.
-- CLI-created 20261029125006, never applied/pushed as local 20271122090009.
-- Forward-reconciled above actual E07 20271126000000 after original E04 80004/5
-- completed. Not applied. Existing files/Knowledge/executor bodies stay exact.
BEGIN;
SET LOCAL lock_timeout='2s';

DO $lease$
DECLARE e record; p record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
  ('public.client_portal_assistant_begin_sessions(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector)','cbf566b34dd050eb611b509c6718d547',0,'v','search_path=""',2),
  ('public.client_portal_assistant_begin_files(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,jsonb)','34daa034fc23a2e17f7cdf9d55348b8d',0,'v','search_path=""',2),
  ('public.paige_chat_interactive_publication_context_v2(uuid,uuid)','daee74f9b160e0dcb1bf4da318f3056b',0,'s','search_path=""',2),
  ('public._client_progress_scope_current(uuid,uuid,uuid)','cef5bd234d501bce4268cb572b013a78',0,'s','search_path=""',1),
  ('public.paige_chat_customer_thread_authorized(uuid)','1f736ad4206faf196290c13939edca35',0,'s','search_path=public, pg_temp',2),
  ('public.client_portal_frame()','b3826e6b52ba34cd40348112b8145883',0,'s','search_path=public, pg_temp',2),
  ('public.client_portal_relationship_id(uuid)','ff84ba24689e5043d7d15ed3d9150268',1,'s','search_path=public, pg_temp',3)
 ) x(signature,body_md5,defaults,volatility,setting,acl_kind) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(e.signature);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM e.body_md5
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
   OR p.proconfig IS DISTINCT FROM ARRAY[e.setting]::text[]
   OR p.pronargdefaults<>e.defaults OR p.provolatile::text<>e.volatility
   OR p.proacl IS DISTINCT FROM (CASE e.acl_kind
    WHEN 1 THEN ARRAY['postgres=X/postgres']::aclitem[]
    WHEN 2 THEN ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
    ELSE ARRAY['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[] END) THEN
   RAISE EXCEPTION 'Original customer link prerequisite changed: %',e.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

-- Syntax narrowing, NOT an SSRF/publicness assertion. The ONE original fetch
-- service must still perform all public DNS/address/redirect/transport checks.
CREATE FUNCTION public._client_public_link_url_valid(p_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(length(p_url) BETWEEN 1 AND 500 AND p_url=trim(p_url)
  AND p_url ~ '^https://[^/@]+(/|$)' AND p_url !~ '[[:space:][:cntrl:]?#]'
  AND position(chr(92) IN p_url)=0,false)
$$;
REVOKE ALL ON FUNCTION public._client_public_link_url_valid(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_public_link_snapshot_valid(p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN coalesce(p_snapshot ?& ARRAY['version','kind','actor_id','tenant_id','contact_id','thread_id','intent_id','url']
  AND p_snapshot-ARRAY['version','kind','actor_id','tenant_id','contact_id','thread_id','intent_id','url']='{}'::jsonb
  AND p_snapshot->'version'='1'::jsonb AND p_snapshot->>'kind'='customer_public_link'
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['actor_id','tenant_id','contact_id','thread_id','intent_id']) x(k)
   WHERE jsonb_typeof(p_snapshot->k) IS DISTINCT FROM 'string'
    OR p_snapshot->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND jsonb_typeof(p_snapshot->'url')='string' AND public._client_public_link_url_valid(p_snapshot->>'url'),false);
END $$;
REVOKE ALL ON FUNCTION public._client_public_link_snapshot_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- The original relationship and assistant availability narrow this read. This
-- does not make a customer a workspace member or enable any provider/search.
CREATE FUNCTION public._client_public_link_snapshot_current(p_actor uuid,p_tenant uuid,p_contact uuid,p_thread uuid,p_intent uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE config jsonb; assistant jsonb;
BEGIN
 IF NOT public._client_public_link_snapshot_valid(p_snapshot)
  OR p_snapshot->>'actor_id' IS DISTINCT FROM p_actor::text
  OR p_snapshot->>'tenant_id' IS DISTINCT FROM p_tenant::text
  OR p_snapshot->>'contact_id' IS DISTINCT FROM p_contact::text
  OR p_snapshot->>'thread_id' IS DISTINCT FROM p_thread::text
  OR p_snapshot->>'intent_id' IS DISTINCT FROM p_intent::text
  OR NOT public._client_progress_scope_current(p_actor,p_tenant,p_contact)
  OR NOT EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=p_thread
   AND t.caller_user_id=p_actor AND t.tenant_id=p_tenant AND t.contact_id=p_contact
   AND t.audience='customer_private' AND t.lens='client' AND NOT t.is_archived AND t.auto_delete_at>now()) THEN RETURN false; END IF;
 SELECT features->'portal_config' INTO config FROM public.tenants WHERE id=p_tenant;
 IF config IS NOT NULL AND jsonb_typeof(config)<>'object' THEN RETURN false; END IF;
 assistant:=config->'assistant';
 RETURN assistant IS NULL OR (jsonb_typeof(assistant)='object'
  AND (NOT assistant ? 'enabled' OR assistant->'enabled'='true'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public._client_public_link_snapshot_current(uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_public_link_snapshot_lock(p_actor uuid,p_tenant uuid,p_contact uuid,p_thread uuid,p_intent uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._client_public_link_snapshot_valid(p_snapshot) THEN RETURN false; END IF;
 -- Same Auth -> tenant -> CRM ordering as original Knowledge/files/Sessions.
 PERFORM 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.clients WHERE id=p_contact AND tenant_id=p_tenant AND linked_user_id=p_actor
  AND status='active' AND merged_into_contact_id IS NULL AND portal_access_state='open' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN public._client_public_link_snapshot_current(p_actor,p_tenant,p_contact,p_thread,p_intent,p_snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_public_link_snapshot_lock(uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.client_portal_assistant_link_context(p_thread uuid,p_intent uuid,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; snapshot jsonb; accepted boolean;
BEGIN
 IF actor IS NULL OR p_thread IS NULL OR p_intent IS NULL THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR t.caller_user_id IS DISTINCT FROM actor OR t.audience IS DISTINCT FROM 'customer_private'
  OR public.client_portal_relationship_id(t.tenant_id) IS DISTINCT FROM t.contact_id
  OR frame->>'actor_id' IS DISTINCT FROM actor::text
  OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bundle_ref->'customer_public_link' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id;
 accepted:=FOUND;
 IF accepted THEN
  IF snapshot IS NULL THEN
   IF p_url IS NOT NULL THEN RAISE EXCEPTION 'CUSTOMER_LINK_REPLAY_CHANGED' USING ERRCODE='42501'; END IF;
   RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode','legacy','snapshot',NULL);
  END IF;
  IF p_url IS NOT NULL AND p_url IS DISTINCT FROM snapshot->>'url' THEN
   RAISE EXCEPTION 'CUSTOMER_LINK_REPLAY_CHANGED' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT public._client_public_link_url_valid(p_url) THEN
   RAISE EXCEPTION 'CUSTOMER_LINK_SELECTION_INVALID' USING ERRCODE='22023'; END IF;
  snapshot:=jsonb_build_object('version',1,'kind','customer_public_link','actor_id',actor,'tenant_id',t.tenant_id,
   'contact_id',t.contact_id,'thread_id',p_thread,'intent_id',p_intent,'url',p_url);
 END IF;
 IF NOT public._client_public_link_snapshot_current(actor,t.tenant_id,t.contact_id,p_thread,p_intent,snapshot) THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode',CASE WHEN accepted THEN 'bound' ELSE 'fresh' END,'snapshot',snapshot);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_link_context(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_link_context(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.client_portal_assistant_begin_link(p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,
 p_bound_answer boolean,p_stop boolean,p_effectful boolean,p_query_embedding extensions.vector,p_url text,p_file_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; context jsonb; result jsonb; existing boolean;
BEGIN
 IF p_stop IS DISTINCT FROM false OR p_bound_answer IS DISTINCT FROM false OR p_effectful IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_MESSAGE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_LINK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 context:=public.client_portal_assistant_link_context(p_thread,p_intent,p_url);
 existing:=context->>'mode'='bound';
 IF context->>'mode' NOT IN('fresh','bound')
  OR NOT public._client_public_link_snapshot_lock(auth.uid(),t.tenant_id,t.contact_id,p_thread,p_intent,context->'snapshot') THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 -- Preserve both existing native paths; a link never broadens file permissions.
 IF p_file_ids IS NULL THEN
  result:=public.client_portal_assistant_begin_sessions(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,p_stop,p_effectful,p_query_embedding);
 ELSE
  result:=public.client_portal_assistant_begin_files(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,p_stop,p_effectful,p_query_embedding,p_file_ids);
 END IF;
 IF NOT existing AND result->>'status'='accepted' THEN
  UPDATE public.paige_chat_turns SET bundle_ref=coalesce(bundle_ref,'{}')||jsonb_build_object('customer_public_link',context->'snapshot')
   WHERE id=(result->>'turn_id')::uuid AND thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
    AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_LINK_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_begin_link(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_begin_link(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb) TO authenticated;

CREATE FUNCTION public._client_public_link_terminal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; supplied jsonb;
BEGIN
 IF NEW.role<>'assistant' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=NEW.thread_id;
 IF t.audience IS DISTINCT FROM 'customer_private' THEN RETURN NEW; END IF;
 supplied:=NEW.bundle_ref->'customer_public_link';
 IF coalesce(NEW.content,'')='' AND NEW.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED') AND supplied IS NULL THEN RETURN NEW; END IF;
 SELECT bundle_ref->'customer_public_link' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=NEW.interactive_intent_id
   AND interactive_actor_id=NEW.interactive_actor_id AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND OR NEW.interactive_actor_id IS DISTINCT FROM t.caller_user_id OR NEW.interactive_tenant_id IS DISTINCT FROM t.tenant_id THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 IF snapshot IS NULL AND supplied IS NULL THEN RETURN NEW; END IF;
 IF supplied IS DISTINCT FROM snapshot
  OR NOT public._client_public_link_snapshot_lock(NEW.interactive_actor_id,t.tenant_id,t.contact_id,t.id,NEW.interactive_intent_id,snapshot) THEN
  RAISE EXCEPTION 'CUSTOMER_LINK_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._client_public_link_terminal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e09_customer_public_link_terminal BEFORE INSERT ON public.paige_chat_turns
 FOR EACH ROW EXECUTE FUNCTION public._client_public_link_terminal_guard();

CREATE FUNCTION public._client_public_link_publication_current(p_thread uuid,p_intent uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; terminal public.paige_chat_turns;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread) OR t.caller_user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
 SELECT * INTO terminal FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='assistant' AND interactive_intent_id=p_intent
  AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF coalesce(terminal.content,'')='' AND terminal.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED')
  AND terminal.bundle_ref->'customer_public_link' IS NULL THEN RETURN true; END IF;
 SELECT bundle_ref->'customer_public_link' INTO snapshot FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='user'
  AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF snapshot IS NULL THEN RETURN terminal.bundle_ref->'customer_public_link' IS NULL; END IF;
 RETURN terminal.bundle_ref->'customer_public_link' IS NOT DISTINCT FROM snapshot
  AND public._client_public_link_snapshot_current(auth.uid(),t.tenant_id,t.contact_id,p_thread,p_intent,snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_public_link_publication_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $publication$
DECLARE target oid:=to_regprocedure('public.paige_chat_interactive_publication_context_v2(uuid,uuid)'); prior text; definition text;
 anchor text:='and public._client_chat_files_publication_current(p_thread,p_intent)';
BEGIN
 SELECT prosrc INTO prior FROM pg_proc WHERE oid=target;
 IF md5(prior) IS DISTINCT FROM 'daee74f9b160e0dcb1bf4da318f3056b'
  OR length(prior)-length(replace(prior,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Original customer publication changed' USING ERRCODE='42501'; END IF;
 definition:=pg_get_functiondef(target);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN
  RAISE EXCEPTION 'Original customer publication body ambiguous' USING ERRCODE='42501'; END IF;
 EXECUTE replace(definition,prior,replace(prior,anchor,anchor||' and public._client_public_link_publication_current(p_thread,p_intent)'));
END $publication$;
COMMIT;
