-- EXP09: bind the original customer-safe Progress source to original private native turns.
-- No new history/store/executor, provider action, Identity grant or business-work writer.
BEGIN;
DO $lease$
DECLARE expected record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._client_portal_progress_projection(uuid,uuid,integer)','0989fc980b2490ebc308478c557fc111'),
  ('public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)','208b4d1b7a1c58bd489a92daf94d4fa8'),
  ('public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector)','72ffe10c2b1c9aeadcb6f7006aad8b88'),
  ('public.paige_chat_interactive_publication_context_v2(uuid,uuid)','5a795e8962ce5f10fd27599f12d420b7')
 ) e(signature,body_md5) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(expected.signature)
   AND pg_catalog.md5(p.prosrc)=expected.body_md5 AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN
   RAISE EXCEPTION 'Original customer Progress/Chat source changed; reconcile (%)',expected.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public._client_progress_snapshot_valid(p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN coalesce(p_snapshot ?& ARRAY['version','kind','tenant_id','contact_id','source_fingerprint']
  AND p_snapshot-ARRAY['version','kind','tenant_id','contact_id','source_fingerprint']='{}'::jsonb
  AND p_snapshot->'version'='1'::jsonb AND p_snapshot->>'kind'='customer_progress'
  AND jsonb_typeof(p_snapshot->'tenant_id')='string'
  AND p_snapshot->>'tenant_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND jsonb_typeof(p_snapshot->'contact_id')='string'
  AND p_snapshot->>'contact_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND jsonb_typeof(p_snapshot->'source_fingerprint')='string'
  AND p_snapshot->>'source_fingerprint' ~ '^[0-9a-f]{64}$',false);
END $$;
REVOKE ALL ON FUNCTION public._client_progress_snapshot_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Trusted original native actor only. Never a role/email/route or manufactured Auth claim.
CREATE FUNCTION public._client_progress_scope_current(p_actor uuid,p_tenant uuid,p_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_actor IS NOT NULL AND p_tenant IS NOT NULL AND p_contact IS NOT NULL
  AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=now()))
  AND EXISTS(SELECT 1 FROM public.clients c JOIN public.tenants t ON t.id=c.tenant_id
   WHERE c.id=p_contact AND c.tenant_id=p_tenant AND c.linked_user_id=p_actor AND c.status='active'
    AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' AND t.status='active'),false)
$$;
REVOKE ALL ON FUNCTION public._client_progress_scope_current(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_progress_snapshot_current(p_actor uuid,p_tenant uuid,p_contact uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE projection jsonb;
BEGIN
 IF NOT public._client_progress_snapshot_valid(p_snapshot)
  OR p_snapshot->>'tenant_id' IS DISTINCT FROM p_tenant::text
  OR p_snapshot->>'contact_id' IS DISTINCT FROM p_contact::text
  OR NOT public._client_progress_scope_current(p_actor,p_tenant,p_contact) THEN RETURN false; END IF;
 projection:=public._client_portal_progress_projection(p_tenant,p_contact,100)-'server_now';
 RETURN projection IS NOT NULL AND p_snapshot->>'source_fingerprint'=
  encode(sha256(convert_to(projection::text,'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public._client_progress_snapshot_current(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Same Auth -> tenant -> CRM row locks as original Knowledge; source rows locked in ID order.
-- Existing rows cannot be withdrawn/repointed while a bound native admission/terminal commits.
CREATE FUNCTION public._client_progress_snapshot_lock(p_actor uuid,p_tenant uuid,p_contact uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM auth.users u WHERE u.id=p_actor AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=p_tenant AND t.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.clients c WHERE c.id=p_contact AND c.tenant_id=p_tenant AND c.linked_user_id=p_actor
  AND c.status='active' AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.plan_items i WHERE i.tenant_id=p_tenant AND i.contact_id=p_contact
  AND i.client_shared_at IS NOT NULL AND i.item_type IN('milestone','task') AND i.status<>'cancelled'
  ORDER BY i.id FOR SHARE;
 RETURN public._client_progress_snapshot_current(p_actor,p_tenant,p_contact,p_snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_progress_snapshot_lock(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.client_portal_assistant_progress_context(p_thread uuid,p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; snapshot jsonb; accepted boolean; projection jsonb;
BEGIN
 IF p_thread IS NULL OR p_intent IS NULL OR actor IS NULL THEN
  RAISE EXCEPTION 'CUSTOMER_PROGRESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR t.audience IS DISTINCT FROM 'customer_private'
  OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR public.client_portal_relationship_id(t.tenant_id) IS DISTINCT FROM t.contact_id
  OR frame->>'actor_id' IS DISTINCT FROM actor::text
  OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text
  OR NOT public._client_progress_scope_current(actor,t.tenant_id,t.contact_id) THEN
  RAISE EXCEPTION 'CUSTOMER_PROGRESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bundle_ref->'customer_progress' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id LIMIT 1;
 accepted:=FOUND;
 IF accepted AND snapshot IS NULL THEN
  -- Never add current facts to an already accepted Knowledge-only/legacy question.
  RETURN jsonb_build_object('frame',frame,'thread_id',t.id,'intent_id',p_intent,
   'mode','legacy','snapshot',NULL,'progress',NULL);
 END IF;
 projection:=public._client_portal_progress_projection(t.tenant_id,t.contact_id,100)-'server_now';
 IF projection IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PROGRESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF accepted THEN
  IF NOT public._client_progress_snapshot_current(actor,t.tenant_id,t.contact_id,snapshot) THEN
   RAISE EXCEPTION 'CUSTOMER_PROGRESS_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 ELSE
  snapshot:=jsonb_build_object('version',1,'kind','customer_progress','tenant_id',t.tenant_id,'contact_id',t.contact_id,
   'source_fingerprint',encode(sha256(convert_to(projection::text,'UTF8')),'hex'));
 END IF;
 RETURN jsonb_build_object('frame',frame,'thread_id',t.id,'intent_id',p_intent,
  'mode',CASE WHEN accepted THEN 'bound' ELSE 'fresh' END,'snapshot',snapshot,'progress',projection);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_progress_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_progress_context(uuid,uuid) TO authenticated;

-- One original begin/executor. New entry only adds native source provenance atomically.
CREATE FUNCTION public.client_portal_assistant_begin_progress(
 p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,
 p_bound_answer boolean,p_stop boolean,p_effectful boolean,p_query_embedding extensions.vector)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; existing boolean; context jsonb; result jsonb; accepted_id uuid;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.audience IS DISTINCT FROM 'customer_private'
  OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR public.client_portal_relationship_id(t.tenant_id) IS DISTINCT FROM t.contact_id
  OR NOT public._client_progress_scope_current(auth.uid(),t.tenant_id,t.contact_id) THEN
  RAISE EXCEPTION 'CUSTOMER_PROGRESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.paige_chat_turns WHERE thread_id=t.id AND role='user'
  AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid()
  AND interactive_tenant_id=t.tenant_id) INTO existing;
 IF p_stop IS NOT TRUE AND NOT existing THEN
  context:=public.client_portal_assistant_progress_context(p_thread,p_intent);
  IF context->>'mode' IS DISTINCT FROM 'fresh' OR NOT public._client_progress_snapshot_lock(
   auth.uid(),t.tenant_id,t.contact_id,context->'snapshot') THEN
   RAISE EXCEPTION 'CUSTOMER_PROGRESS_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 END IF;
 result:=public.client_portal_assistant_begin(p_thread,p_intent,p_supersedes,p_content,
  p_bound_answer,p_stop,p_effectful,p_query_embedding);
 IF p_stop IS NOT TRUE AND NOT existing AND result->>'status'='accepted' THEN
  accepted_id:=(result->>'turn_id')::uuid;
  UPDATE public.paige_chat_turns SET bundle_ref=coalesce(bundle_ref,'{}')||
   jsonb_build_object('customer_progress',context->'snapshot')
   WHERE id=accepted_id AND thread_id=t.id AND role='user' AND interactive_intent_id=p_intent
    AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_PROGRESS_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_begin_progress(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_begin_progress(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector) TO authenticated;

CREATE FUNCTION public._client_progress_terminal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; supplied jsonb;
BEGIN
 IF NEW.role<>'assistant' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=NEW.thread_id;
 IF t.audience IS DISTINCT FROM 'customer_private' THEN RETURN NEW; END IF;
 supplied:=NEW.bundle_ref->'customer_progress';
 IF coalesce(NEW.content,'')='' AND NEW.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED')
  AND supplied IS NULL THEN RETURN NEW; END IF;
 SELECT bundle_ref->'customer_progress' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=NEW.interactive_intent_id
   AND interactive_actor_id=NEW.interactive_actor_id AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND OR NEW.interactive_actor_id IS DISTINCT FROM t.caller_user_id
  OR NEW.interactive_tenant_id IS DISTINCT FROM t.tenant_id THEN
  RAISE EXCEPTION 'CUSTOMER_PROGRESS_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 IF snapshot IS NULL AND supplied IS NULL THEN RETURN NEW; END IF;
 IF NOT public._client_progress_snapshot_valid(snapshot) OR supplied IS DISTINCT FROM snapshot THEN
  RAISE EXCEPTION 'CUSTOMER_PROGRESS_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 IF NOT public._client_progress_snapshot_lock(NEW.interactive_actor_id,t.tenant_id,t.contact_id,snapshot) THEN
  RAISE EXCEPTION 'CUSTOMER_PROGRESS_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._client_progress_terminal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e09_customer_progress_terminal BEFORE INSERT ON public.paige_chat_turns
 FOR EACH ROW EXECUTE FUNCTION public._client_progress_terminal_guard();

CREATE FUNCTION public._client_progress_publication_current(p_thread uuid,p_intent uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); t public.paige_chat_threads; snapshot jsonb; terminal public.paige_chat_turns;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR t.audience IS DISTINCT FROM 'customer_private'
  OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR NOT public._client_progress_scope_current(actor,t.tenant_id,t.contact_id) THEN RETURN false; END IF;
 SELECT * INTO terminal FROM public.paige_chat_turns WHERE thread_id=t.id AND role='assistant'
  AND interactive_intent_id=p_intent AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF coalesce(terminal.content,'')='' AND terminal.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED')
  AND terminal.bundle_ref->'customer_progress' IS NULL THEN RETURN true; END IF;
 SELECT bundle_ref->'customer_progress' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF snapshot IS NULL THEN RETURN terminal.bundle_ref->'customer_progress' IS NULL; END IF;
 RETURN terminal.bundle_ref->'customer_progress' IS NOT DISTINCT FROM snapshot
  AND public._client_progress_snapshot_current(actor,t.tenant_id,t.contact_id,snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_progress_publication_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve every old K2 branch/header/ACL. Only stale Progress assistant facts are omitted from
-- NEW model context; original RLS-authorized customer UI history is not changed or deleted.
DO $history$
DECLARE target oid:=to_regprocedure('public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)');
 prior text; definition text;
 anchor text:=$anchor$  turn_snapshot:=turn.bundle_ref->'customer_knowledge';$anchor$;
 addition text:=$addition$  IF turn.role='assistant' AND turn.bundle_ref ? 'customer_progress'
   AND NOT public._client_progress_snapshot_current(actor,t.tenant_id,t.contact_id,turn.bundle_ref->'customer_progress') THEN
   limited:=true; CONTINUE;
  END IF;
$addition$;
BEGIN
 SELECT prosrc INTO prior FROM pg_proc WHERE oid=target;
 IF md5(prior) IS DISTINCT FROM '208b4d1b7a1c58bd489a92daf94d4fa8'
  OR length(prior)-length(replace(prior,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Original K2 history changed; reconcile' USING ERRCODE='42501'; END IF;
 definition:=pg_get_functiondef(target);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN
  RAISE EXCEPTION 'Original K2 body is not unique' USING ERRCODE='42501'; END IF;
 EXECUTE replace(definition,prior,replace(prior,anchor,addition||anchor));
END $history$;

DO $publication$
DECLARE target oid:=to_regprocedure('public.paige_chat_interactive_publication_context_v2(uuid,uuid)');
 prior text; definition text;
 anchor text:=$anchor$and public._client_knowledge_publication_current(p_thread,p_intent)$anchor$;
BEGIN
 SELECT prosrc INTO prior FROM pg_proc WHERE oid=target;
 IF md5(prior) IS DISTINCT FROM '5a795e8962ce5f10fd27599f12d420b7'
  OR length(prior)-length(replace(prior,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Original customer publication branch changed; reconcile' USING ERRCODE='42501'; END IF;
 definition:=pg_get_functiondef(target);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN
  RAISE EXCEPTION 'Original publication body is not unique' USING ERRCODE='42501'; END IF;
 EXECUTE replace(definition,prior,replace(prior,anchor,anchor||' and public._client_progress_publication_current(p_thread,p_intent)'));
END $publication$;
COMMIT;
