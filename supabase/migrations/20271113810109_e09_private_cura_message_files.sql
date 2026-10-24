-- EXP09: private files bound to the original customer intent, not another history.
-- No new store, executor, sender, provider activation or business-sharing writer.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $lease$
DECLARE e record; p record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
  ('public.client_portal_assistant_begin_sessions(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector)','cbf566b34dd050eb611b509c6718d547'),
  ('public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)','2fd88298c72c251bf1fff20dc6576d1a'),
  ('public.paige_chat_interactive_publication_context_v2(uuid,uuid)','d59baa5dbffa2987d346eb656ef74e36'),
  ('public._client_portal_chat_files_authorize(uuid,uuid)','18ff71ce490f6ee182c97e7be3898491'),
  ('public._client_portal_chat_files_solo_scope(uuid)','1fca45c01f2ed32608a9c1fcb0a92562'),
  ('public._client_progress_scope_current(uuid,uuid,uuid)','cef5bd234d501bce4268cb572b013a78')) x(signature,body_md5) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(e.signature);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM e.body_md5
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.pronargdefaults<>(CASE WHEN e.signature LIKE 'public.client_portal_assistant_context_v2(%' THEN 1 ELSE 0 END)
   OR p.proacl IS DISTINCT FROM (CASE WHEN e.signature LIKE 'public.client_portal_assistant_%'
     OR e.signature LIKE 'public.paige_chat_interactive_publication_%'
    THEN ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
    ELSE ARRAY['postgres=X/postgres']::aclitem[] END) THEN
   RAISE EXCEPTION 'Original private file/Chat contract changed: %',e.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public._client_chat_file_ids_valid(p_ids jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_ids) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_ids)<1 OR jsonb_array_length(p_ids)>5 THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_ids) x(v)
  WHERE jsonb_typeof(v) IS DISTINCT FROM 'string'
   OR v#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND (SELECT count(DISTINCT v) FROM jsonb_array_elements(p_ids) x(v))=jsonb_array_length(p_ids);
END $$;
REVOKE ALL ON FUNCTION public._client_chat_file_ids_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Internal projection for an already resolved original actor/relationship. Never a
-- service-role customer identity substitute. Public doors below use original Auth.
CREATE FUNCTION public._client_chat_files_projection(p_actor uuid,p_tenant uuid,p_contact uuid,p_thread uuid,p_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.client_files; o storage.objects; item jsonb; result jsonb:='[]'; assistant jsonb;
BEGIN
 IF NOT public._client_chat_file_ids_valid(p_ids)
  OR NOT public._client_progress_scope_current(p_actor,p_tenant,p_contact)
  OR NOT public._client_portal_chat_files_solo_scope(p_contact)
  OR NOT EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=p_thread
   AND t.caller_user_id=p_actor AND t.tenant_id=p_tenant AND t.contact_id=p_contact
   AND t.audience='customer_private' AND t.lens='client' AND NOT t.is_archived AND t.auto_delete_at>now()) THEN RETURN NULL; END IF;
 SELECT CASE WHEN jsonb_typeof(t.features->'portal_config')='object'
  THEN t.features#>'{portal_config,assistant}' ELSE NULL END INTO assistant FROM public.tenants t WHERE t.id=p_tenant;
 IF assistant IS NOT NULL AND (jsonb_typeof(assistant)<>'object'
  OR (assistant ? 'enabled' AND (jsonb_typeof(assistant->'enabled')<>'boolean' OR assistant->'enabled'='false'::jsonb))) THEN RETURN NULL; END IF;
 FOR item IN SELECT v FROM jsonb_array_elements(p_ids) WITH ORDINALITY x(v,n) ORDER BY n LOOP
  SELECT * INTO f FROM public.client_files WHERE id=(item#>>'{}')::uuid
   AND tenant_id=p_tenant AND contact_id=p_contact AND uploaded_by_user_id=p_actor
   AND customer_chat_thread_id IS NOT NULL AND visibility='client_upload' AND upload_state='ready';
  IF NOT FOUND OR f.storage_path IS DISTINCT FROM p_tenant::text||'/'||p_contact::text||'/client_upload/'||p_actor::text||'/'||f.id::text
   OR f.size_bytes IS NULL OR f.size_bytes<1 OR f.size_bytes>20971520
   OR f.mime_type IS NULL OR f.mime_type NOT IN('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document') THEN RETURN NULL; END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='client-files' AND name=f.storage_path;
  IF NOT FOUND OR o.owner_id IS DISTINCT FROM p_actor::text OR o.metadata->>'size' IS DISTINCT FROM f.size_bytes::text
   OR o.metadata->>'mimetype' IS DISTINCT FROM f.mime_type THEN RETURN NULL; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('file',public._client_portal_file_projection(f)
   ||jsonb_build_object('customer_chat_thread_id',f.customer_chat_thread_id),
   'object',jsonb_build_object('id',o.id,'updated_at',to_jsonb(o)->'updated_at','version',to_jsonb(o)->'version','metadata',o.metadata)));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._client_chat_files_projection(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_chat_files_snapshot_valid(p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN coalesce(p_snapshot ?& ARRAY['version','kind','tenant_id','contact_id','thread_id','file_ids','source_fingerprint']
  AND p_snapshot-ARRAY['version','kind','tenant_id','contact_id','thread_id','file_ids','source_fingerprint']='{}'::jsonb
  AND p_snapshot->'version'='1'::jsonb AND p_snapshot->>'kind'='customer_private_files'
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['tenant_id','contact_id','thread_id']) x(k) WHERE
   jsonb_typeof(p_snapshot->k) IS DISTINCT FROM 'string'
   OR p_snapshot->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND public._client_chat_file_ids_valid(p_snapshot->'file_ids')
  AND jsonb_typeof(p_snapshot->'source_fingerprint')='string'
  AND p_snapshot->>'source_fingerprint' ~ '^[0-9a-f]{64}$',false);
END $$;
REVOKE ALL ON FUNCTION public._client_chat_files_snapshot_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_chat_files_snapshot_current(p_actor uuid,p_tenant uuid,p_contact uuid,p_thread uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE projection jsonb;
BEGIN
 IF NOT public._client_chat_files_snapshot_valid(p_snapshot)
  OR p_snapshot->>'tenant_id' IS DISTINCT FROM p_tenant::text OR p_snapshot->>'contact_id' IS DISTINCT FROM p_contact::text
  OR p_snapshot->>'thread_id' IS DISTINCT FROM p_thread::text THEN RETURN false; END IF;
 projection:=public._client_chat_files_projection(p_actor,p_tenant,p_contact,p_thread,p_snapshot->'file_ids');
 RETURN projection IS NOT NULL AND p_snapshot->>'source_fingerprint'=encode(sha256(convert_to(projection::text,'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public._client_chat_files_snapshot_current(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_chat_files_snapshot_lock(p_actor uuid,p_tenant uuid,p_contact uuid,p_thread uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._client_chat_files_snapshot_valid(p_snapshot) THEN RETURN false; END IF;
 -- Same original identity -> tenant -> relationship ordering used by original Sessions.
 PERFORM 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.clients WHERE id=p_contact AND tenant_id=p_tenant AND linked_user_id=p_actor
  AND status='active' AND merged_into_contact_id IS NULL AND portal_access_state='open' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.client_files WHERE id IN(SELECT (v#>>'{}')::uuid FROM jsonb_array_elements(p_snapshot->'file_ids') x(v)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM storage.objects o WHERE o.bucket_id='client-files' AND EXISTS(SELECT 1 FROM public.client_files f
  WHERE f.id IN(SELECT (v#>>'{}')::uuid FROM jsonb_array_elements(p_snapshot->'file_ids') x(v)) AND f.storage_path=o.name) ORDER BY o.id FOR SHARE;
 RETURN public._client_chat_files_snapshot_current(p_actor,p_tenant,p_contact,p_thread,p_snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_chat_files_snapshot_lock(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.client_portal_assistant_files_context(p_thread uuid,p_intent uuid,p_file_ids jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); t public.paige_chat_threads; contact uuid; snapshot jsonb; accepted boolean; projection jsonb;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR p_intent IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'CUSTOMER_FILES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 contact:=public._client_portal_chat_files_authorize(p_thread,t.tenant_id);
 IF contact IS DISTINCT FROM t.contact_id OR t.caller_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'CUSTOMER_FILES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bundle_ref->'customer_files' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id;
 accepted:=FOUND;
 IF accepted THEN
  IF snapshot IS NULL THEN
   IF p_file_ids IS NOT NULL AND p_file_ids<>'[]'::jsonb THEN RAISE EXCEPTION 'CUSTOMER_FILES_REPLAY_CHANGED' USING ERRCODE='42501'; END IF;
   RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode','legacy','snapshot',NULL,'files','[]'::jsonb);
  END IF;
  IF NOT public._client_chat_files_snapshot_current(actor,t.tenant_id,contact,p_thread,snapshot)
   OR (p_file_ids IS NOT NULL AND p_file_ids IS DISTINCT FROM snapshot->'file_ids') THEN
   RAISE EXCEPTION 'CUSTOMER_FILES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT public._client_chat_file_ids_valid(p_file_ids) THEN RAISE EXCEPTION 'CUSTOMER_FILES_SELECTION_INVALID' USING ERRCODE='22023'; END IF;
  projection:=public._client_chat_files_projection(actor,t.tenant_id,contact,p_thread,p_file_ids);
  IF projection IS NULL THEN RAISE EXCEPTION 'CUSTOMER_FILES_FORBIDDEN' USING ERRCODE='42501'; END IF;
  snapshot:=jsonb_build_object('version',1,'kind','customer_private_files','tenant_id',t.tenant_id,'contact_id',contact,
   'thread_id',p_thread,'file_ids',p_file_ids,'source_fingerprint',encode(sha256(convert_to(projection::text,'UTF8')),'hex'));
 END IF;
 projection:=public._client_chat_files_projection(actor,t.tenant_id,contact,p_thread,snapshot->'file_ids');
 IF projection IS NULL THEN RAISE EXCEPTION 'CUSTOMER_FILES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 -- Native caller only; this object is not a browser transcript/bundle projection.
 RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode',CASE WHEN accepted THEN 'bound' ELSE 'fresh' END,
  'snapshot',snapshot,'files',projection);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_files_context(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_files_context(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.client_portal_assistant_begin_files(p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,
 p_bound_answer boolean,p_stop boolean,p_effectful boolean,p_query_embedding extensions.vector,p_file_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; context jsonb; result jsonb; existing boolean;
BEGIN
 IF p_stop IS TRUE OR p_bound_answer IS TRUE OR p_effectful IS NOT TRUE THEN
  RAISE EXCEPTION 'CUSTOMER_FILES_MESSAGE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_FILES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 context:=public.client_portal_assistant_files_context(p_thread,p_intent,p_file_ids);
 existing:=context->>'mode'='bound';
 IF context->>'mode' NOT IN('fresh','bound') OR NOT public._client_chat_files_snapshot_lock(auth.uid(),t.tenant_id,t.contact_id,p_thread,context->'snapshot') THEN
  RAISE EXCEPTION 'CUSTOMER_FILES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 result:=public.client_portal_assistant_begin_sessions(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,p_stop,p_effectful,p_query_embedding);
 IF NOT existing AND result->>'status'='accepted' THEN
  UPDATE public.paige_chat_turns SET bundle_ref=coalesce(bundle_ref,'{}')||jsonb_build_object('customer_files',context->'snapshot')
   WHERE id=(result->>'turn_id')::uuid AND thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
    AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_FILES_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_begin_files(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_begin_files(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,jsonb) TO authenticated;

CREATE FUNCTION public._client_chat_files_terminal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; supplied jsonb;
BEGIN
 IF NEW.role<>'assistant' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=NEW.thread_id;
 IF t.audience IS DISTINCT FROM 'customer_private' THEN RETURN NEW; END IF;
 supplied:=NEW.bundle_ref->'customer_files';
 IF coalesce(NEW.content,'')='' AND NEW.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED') AND supplied IS NULL THEN RETURN NEW; END IF;
 SELECT bundle_ref->'customer_files' INTO snapshot FROM public.paige_chat_turns WHERE thread_id=t.id AND role='user'
  AND interactive_intent_id=NEW.interactive_intent_id AND interactive_actor_id=NEW.interactive_actor_id AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND OR NEW.interactive_actor_id IS DISTINCT FROM t.caller_user_id OR NEW.interactive_tenant_id IS DISTINCT FROM t.tenant_id THEN
  RAISE EXCEPTION 'CUSTOMER_FILES_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 IF snapshot IS NULL AND supplied IS NULL THEN RETURN NEW; END IF;
 IF supplied IS DISTINCT FROM snapshot OR NOT public._client_chat_files_snapshot_lock(NEW.interactive_actor_id,t.tenant_id,t.contact_id,t.id,snapshot) THEN
  RAISE EXCEPTION 'CUSTOMER_FILES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._client_chat_files_terminal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e09_customer_files_terminal BEFORE INSERT ON public.paige_chat_turns FOR EACH ROW EXECUTE FUNCTION public._client_chat_files_terminal_guard();

CREATE FUNCTION public._client_chat_files_publication_current(p_thread uuid,p_intent uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; terminal public.paige_chat_turns;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread) OR t.caller_user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
 SELECT * INTO terminal FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='assistant' AND interactive_intent_id=p_intent
  AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF coalesce(terminal.content,'')='' AND terminal.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED') AND terminal.bundle_ref->'customer_files' IS NULL THEN RETURN true; END IF;
 SELECT bundle_ref->'customer_files' INTO snapshot FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='user'
  AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF snapshot IS NULL THEN RETURN terminal.bundle_ref->'customer_files' IS NULL; END IF;
 RETURN terminal.bundle_ref->'customer_files' IS NOT DISTINCT FROM snapshot
  AND public._client_chat_files_snapshot_current(auth.uid(),t.tenant_id,t.contact_id,p_thread,snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_chat_files_publication_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $history$
DECLARE target oid:=to_regprocedure('public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)');prior text;definition text;
 anchor text:=$anchor$  turn_snapshot:=turn.bundle_ref->'customer_knowledge';$anchor$;
 addition text:=$addition$  IF turn.role='assistant' AND turn.bundle_ref ? 'customer_files'
   AND NOT public._client_chat_files_snapshot_current(actor,t.tenant_id,t.contact_id,t.id,turn.bundle_ref->'customer_files') THEN
   limited:=true; CONTINUE;
  END IF;
$addition$;
BEGIN
 SELECT prosrc INTO prior FROM pg_proc WHERE oid=target;
 IF md5(prior) IS DISTINCT FROM '2fd88298c72c251bf1fff20dc6576d1a' OR length(prior)-length(replace(prior,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Original customer history changed' USING ERRCODE='42501'; END IF;
 definition:=pg_get_functiondef(target);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN RAISE EXCEPTION 'Original customer history body ambiguous' USING ERRCODE='42501'; END IF;
 EXECUTE replace(definition,prior,replace(prior,anchor,addition||anchor));
END $history$;
DO $publication$
DECLARE target oid:=to_regprocedure('public.paige_chat_interactive_publication_context_v2(uuid,uuid)');prior text;definition text;
 anchor text:=$anchor$and public._client_sessions_publication_current(p_thread,p_intent)$anchor$;
BEGIN
 SELECT prosrc INTO prior FROM pg_proc WHERE oid=target;
 IF md5(prior) IS DISTINCT FROM 'd59baa5dbffa2987d346eb656ef74e36' OR length(prior)-length(replace(prior,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Original customer publication changed' USING ERRCODE='42501'; END IF;
 definition:=pg_get_functiondef(target);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN RAISE EXCEPTION 'Original publication body ambiguous' USING ERRCODE='42501'; END IF;
 EXECUTE replace(definition,prior,replace(prior,anchor,anchor||' and public._client_chat_files_publication_current(p_thread,p_intent)'));
END $publication$;
COMMIT;
