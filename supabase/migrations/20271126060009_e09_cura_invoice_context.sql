-- EXP09 owner-authorized original invoice context.
-- CLI origin 20261030140549; forward carrier follows published EXP08 through
-- 20271126040008 and EXP05 Task 20271126050005. No applied history rewritten.
-- Reuse EXP04 financial authority/query/observation. No financial writer/provider.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $incumbents$
DECLARE e record; p pg_proc;
BEGIN
 FOR e IN SELECT * FROM (VALUES
  ('public._client_portal_financial_actor_current(uuid,uuid,uuid)','abef20691667b3b5a769ffc81507ff96',false,'v',0,1),
  ('public._client_portal_invoice_observation_for_client(uuid,uuid)','83f32502da913d873d3454e4fc12671d',false,'v',0,1),
  ('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)','a307bf9e57e5b2ad692c74a329e683cd',false,'v',0,1),
  ('public.client_portal_assistant_begin_link(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb)','b0a074560e3b363ac92220d4d1f1b8bb',true,'v',0,2),
  ('public.client_portal_assistant_context(uuid,uuid)','821b50485bfb2a0932105de28a0ed356',true,'s',0,2),
  ('public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)','79f72092a1742329d597bf9783781d71',true,'s',1,2),
  ('public.paige_chat_interactive_publication_context_v2(uuid,uuid)','e1fb8cf480ce73b6a15f56d9e6b6e0f3',true,'s',0,2)
 ) x(identity,body_md5,definer,volatility,defaults,acl_kind) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(e.identity);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM e.body_md5 OR pg_get_userbyid(p.proowner)<>'postgres'
   OR p.prosecdef IS DISTINCT FROM e.definer OR p.provolatile::text<>e.volatility OR p.pronargdefaults<>e.defaults
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.proacl IS DISTINCT FROM (CASE e.acl_kind WHEN 1 THEN ARRAY['postgres=X/postgres']::aclitem[]
    ELSE ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[] END) THEN
   RAISE EXCEPTION 'Original invoice prerequisite changed: %',e.identity USING ERRCODE='23514'; END IF;
 END LOOP;
END $incumbents$;

CREATE FUNCTION public._client_invoices_snapshot_valid(p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF NOT coalesce(p_snapshot ?& ARRAY['version','kind','actor_id','tenant_id','contact_id','thread_id','intent_id','observation_identity','captured_at']
  AND p_snapshot-ARRAY['version','kind','actor_id','tenant_id','contact_id','thread_id','intent_id','observation_identity','captured_at']='{}'::jsonb
  AND p_snapshot->'version'='1'::jsonb AND p_snapshot->>'kind'='customer_invoices'
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['actor_id','tenant_id','contact_id','thread_id','intent_id']) x(k)
   WHERE jsonb_typeof(p_snapshot->k) IS DISTINCT FROM 'string'
    OR p_snapshot->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND jsonb_typeof(p_snapshot->'observation_identity')='string' AND p_snapshot->>'observation_identity' ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(p_snapshot->'captured_at')='string' AND length(p_snapshot->>'captured_at')<=40
  AND p_snapshot->>'captured_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$',false) THEN RETURN false; END IF;
 RETURN isfinite((p_snapshot->>'captured_at')::timestamptz);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._client_invoices_snapshot_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- PRIVATE trusted original actor, never a public/service-role actor argument.
-- VOLATILE retains the original financial Auth -> tenant -> CRM SHARE locks.
CREATE FUNCTION public._client_invoices_snapshot_current(p_actor uuid,p_tenant uuid,p_contact uuid,p_thread uuid,p_intent uuid,p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE config jsonb; assistant jsonb; observation jsonb;
BEGIN
 IF NOT public._client_invoices_snapshot_valid(p_snapshot)
  OR p_snapshot->>'actor_id' IS DISTINCT FROM p_actor::text OR p_snapshot->>'tenant_id' IS DISTINCT FROM p_tenant::text
  OR p_snapshot->>'contact_id' IS DISTINCT FROM p_contact::text OR p_snapshot->>'thread_id' IS DISTINCT FROM p_thread::text
  OR p_snapshot->>'intent_id' IS DISTINCT FROM p_intent::text THEN RETURN false; END IF;
 IF NOT public._client_portal_financial_actor_current(p_actor,p_tenant,p_contact) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=p_thread AND t.caller_user_id=p_actor
  AND t.tenant_id=p_tenant AND t.contact_id=p_contact AND t.audience='customer_private' AND t.lens='client'
  AND NOT t.is_archived AND t.auto_delete_at>now()) THEN RETURN false; END IF;
 SELECT features->'portal_config' INTO config FROM public.tenants WHERE id=p_tenant;
 IF config IS NOT NULL AND jsonb_typeof(config)<>'object' THEN RETURN false; END IF;
 assistant:=config->'assistant';
 IF assistant IS NOT NULL AND (jsonb_typeof(assistant)<>'object'
  OR (assistant ? 'enabled' AND assistant->'enabled' IS DISTINCT FROM 'true'::jsonb)) THEN RETURN false; END IF;
 observation:=public._client_portal_invoice_observation_for_client(p_tenant,p_contact);
 RETURN observation->>'observation_identity' IS NOT DISTINCT FROM p_snapshot->>'observation_identity';
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._client_invoices_snapshot_current(uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.client_portal_assistant_invoices_context(p_thread uuid,p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; snapshot jsonb; accepted boolean;
 observation jsonb; facts jsonb; billing jsonb;
BEGIN
 IF actor IS NULL OR p_thread IS NULL OR p_intent IS NULL THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR t.caller_user_id IS DISTINCT FROM actor OR t.audience IS DISTINCT FROM 'customer_private'
  OR frame->>'actor_id' IS DISTINCT FROM actor::text OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bundle_ref->'customer_invoices' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id;
 accepted:=FOUND;
 IF accepted AND snapshot IS NULL THEN
  RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode','legacy','snapshot',NULL,'billing',NULL);
 END IF;
 -- A legacy general conversation carries NO financial facts and does not gain
 -- financial authority. Fresh/bound invoice reads retain the ORIGINAL Auth and
 -- request-business header evaluation; refusal never disables general CURA.
 IF public._client_portal_billing_client(t.tenant_id) IS DISTINCT FROM t.contact_id THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 observation:=public._client_portal_invoice_observation_for_client(t.tenant_id,t.contact_id);
 IF NOT accepted THEN
  snapshot:=jsonb_build_object('version',1,'kind','customer_invoices','actor_id',actor,'tenant_id',t.tenant_id,
   'contact_id',t.contact_id,'thread_id',p_thread,'intent_id',p_intent,
   'observation_identity',observation->'observation_identity','captured_at',observation->'read_at'); END IF;
 IF NOT public._client_invoices_snapshot_current(actor,t.tenant_id,t.contact_id,p_thread,p_intent,snapshot)
  OR observation->>'observation_identity' IS DISTINCT FROM snapshot->>'observation_identity' THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 facts:=observation->'facts';
 -- Same fixed five-row query/full balances; no internal provenance in model data.
 -- Retain accepted capture time, not the volatile timestamp of this revalidation.
 billing:=jsonb_build_object('tenant_id',t.tenant_id,'contact_id',t.contact_id,'captured_at',snapshot->'captured_at',
  'calendar',jsonb_build_object('state',observation#>'{calendar,state}','zone',observation#>'{calendar,zone}',
   'local_date',observation#>'{calendar,local_date}'),'invoices',facts->'invoices','balances',facts->'balances',
  'invoice_count',facts->'invoice_count','open_count',facts->'open_count','has_more',facts->'has_more','next_cursor',facts->'next_cursor');
 RETURN jsonb_build_object('thread_id',p_thread,'intent_id',p_intent,'mode',CASE WHEN accepted THEN 'bound' ELSE 'fresh' END,
  'snapshot',snapshot,'billing',billing);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_invoices_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_invoices_context(uuid,uuid) TO authenticated;

-- Used only when invoice context is available. Other customers retain the existing
-- general CURA begin path; financial refusal must never grant facts or disable it.
CREATE FUNCTION public.client_portal_assistant_begin_invoices(p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,
 p_bound_answer boolean,p_stop boolean,p_effectful boolean,p_query_embedding extensions.vector,p_url text,p_file_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; context jsonb; result jsonb;
BEGIN
 IF p_stop IS DISTINCT FROM false OR p_bound_answer IS DISTINCT FROM false OR p_effectful IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_MESSAGE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_INVOICES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 context:=public.client_portal_assistant_invoices_context(p_thread,p_intent);
 IF p_url IS NOT NULL THEN
  result:=public.client_portal_assistant_begin_link(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,p_stop,p_effectful,p_query_embedding,p_url,p_file_ids);
 ELSIF p_file_ids IS NOT NULL THEN
  result:=public.client_portal_assistant_begin_files(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,p_stop,p_effectful,p_query_embedding,p_file_ids);
 ELSE
  result:=public.client_portal_assistant_begin_sessions(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,p_stop,p_effectful,p_query_embedding);
 END IF;
 IF context->>'mode'<>'legacy' THEN
  IF NOT public._client_invoices_snapshot_current(auth.uid(),t.tenant_id,t.contact_id,p_thread,p_intent,context->'snapshot') THEN
   RAISE EXCEPTION 'CUSTOMER_INVOICES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
  IF context->>'mode'='fresh' AND result->>'status'='accepted' THEN
   UPDATE public.paige_chat_turns SET bundle_ref=coalesce(bundle_ref,'{}')||jsonb_build_object('customer_invoices',context->'snapshot')
    WHERE id=(result->>'turn_id')::uuid AND thread_id=p_thread AND role='user' AND interactive_intent_id=p_intent
     AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_INVOICES_BINDING_INVALID' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_begin_invoices(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_begin_invoices(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb) TO authenticated;

CREATE FUNCTION public._client_invoices_terminal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; supplied jsonb;
BEGIN
 IF NEW.role<>'assistant' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=NEW.thread_id;
 IF t.audience IS DISTINCT FROM 'customer_private' THEN RETURN NEW; END IF;
 supplied:=NEW.bundle_ref->'customer_invoices';
 IF coalesce(NEW.content,'')='' AND NEW.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED') AND supplied IS NULL THEN RETURN NEW; END IF;
 SELECT bundle_ref->'customer_invoices' INTO snapshot FROM public.paige_chat_turns WHERE thread_id=t.id AND role='user'
  AND interactive_intent_id=NEW.interactive_intent_id AND interactive_actor_id=NEW.interactive_actor_id AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND OR NEW.interactive_actor_id IS DISTINCT FROM t.caller_user_id OR NEW.interactive_tenant_id IS DISTINCT FROM t.tenant_id THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 IF snapshot IS NULL AND supplied IS NULL THEN RETURN NEW; END IF;
 IF supplied IS DISTINCT FROM snapshot OR NOT public._client_invoices_snapshot_current(
  NEW.interactive_actor_id,t.tenant_id,t.contact_id,t.id,NEW.interactive_intent_id,snapshot) THEN
  RAISE EXCEPTION 'CUSTOMER_INVOICES_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._client_invoices_terminal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e09_customer_invoices_terminal BEFORE INSERT ON public.paige_chat_turns
 FOR EACH ROW EXECUTE FUNCTION public._client_invoices_terminal_guard();

CREATE FUNCTION public._client_invoices_publication_current(p_thread uuid,p_intent uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.paige_chat_threads; snapshot jsonb; terminal public.paige_chat_turns;
BEGIN
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread) OR t.caller_user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
 SELECT * INTO terminal FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='assistant' AND interactive_intent_id=p_intent
  AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF coalesce(terminal.content,'')='' AND terminal.interactive_terminal_state IN('WITHHELD','INTERRUPTED','REFUSED')
  AND terminal.bundle_ref->'customer_invoices' IS NULL THEN RETURN true; END IF;
 SELECT bundle_ref->'customer_invoices' INTO snapshot FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='user'
  AND interactive_intent_id=p_intent AND interactive_actor_id=auth.uid() AND interactive_tenant_id=t.tenant_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF snapshot IS NULL THEN RETURN terminal.bundle_ref->'customer_invoices' IS NULL; END IF;
 RETURN terminal.bundle_ref->'customer_invoices' IS NOT DISTINCT FROM snapshot
  AND public._client_invoices_snapshot_current(auth.uid(),t.tenant_id,t.contact_id,p_thread,p_intent,snapshot);
END $$;
REVOKE ALL ON FUNCTION public._client_invoices_publication_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Whole-body inverses retain every original owner/platform/Knowledge branch.
-- PostgREST STABLE POST is READ ONLY; explicit VOLATILE allows the ORIGINAL
-- financial SHARE-lock contract, changing no other metadata, argument or ACL.
DO $compose$
DECLARE target oid; e record; prior text; body text; definition text; before_meta jsonb; after_meta jsonb;
 h text:=$h$  turn_snapshot:=turn.bundle_ref->'customer_knowledge';$h$;
 added text:=$h$  IF turn.role='assistant' AND turn.bundle_ref ? 'customer_invoices'
   AND NOT public._client_invoices_snapshot_current(actor,t.tenant_id,t.contact_id,t.id,turn.interactive_intent_id,turn.bundle_ref->'customer_invoices') THEN
   limited:=true; CONTINUE;
  END IF;
$h$;
 s text:='FOR turn IN SELECT role,content,bundle_ref,seq FROM public.paige_chat_turns';
 a text:='and public._client_public_link_publication_current(p_thread,p_intent)';
BEGIN
 FOR e IN SELECT * FROM (VALUES
  ('public.client_portal_assistant_context(uuid,uuid)','821b50485bfb2a0932105de28a0ed356',true),
  ('public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)','79f72092a1742329d597bf9783781d71',true),
  ('public.paige_chat_interactive_publication_context_v2(uuid,uuid)','e1fb8cf480ce73b6a15f56d9e6b6e0f3',false)
 ) x(identity,body_md5,history) LOOP
  target:=to_regprocedure(e.identity);
  -- CREATE OR REPLACE reparses DEFAULT expressions, moving parser :location
  -- offsets. Normalize ONLY those offsets, retaining the entire default AST,
  -- resolved argument/default text and every other original metadata field.
  SELECT prosrc,(to_jsonb(p)-ARRAY['prosrc','provolatile','proargdefaults'])||jsonb_build_object(
   'proargdefaults',regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g'),
   'arguments',pg_get_function_arguments(p.oid)) INTO prior,before_meta FROM pg_proc p WHERE oid=target;
  IF md5(prior) IS DISTINCT FROM e.body_md5 THEN RAISE EXCEPTION 'Invoice incumbent changed: %',e.identity USING ERRCODE='23514'; END IF;
  IF e.history THEN
   IF length(prior)-length(replace(prior,h,''))<>length(h) OR length(prior)-length(replace(prior,s,''))<>length(s) THEN
    RAISE EXCEPTION 'Original history anchor ambiguous' USING ERRCODE='23514'; END IF;
   body:=replace(replace(prior,h,added||h),s,replace(s,'bundle_ref,seq','bundle_ref,seq,interactive_intent_id'));
   IF replace(replace(body,added,''),replace(s,'bundle_ref,seq','bundle_ref,seq,interactive_intent_id'),s)<>prior THEN
    RAISE EXCEPTION 'Whole original history inverse differs' USING ERRCODE='23514'; END IF;
  ELSE
   IF length(prior)-length(replace(prior,a,''))<>length(a) THEN
    RAISE EXCEPTION 'Original publication anchor ambiguous' USING ERRCODE='23514'; END IF;
   body:=replace(prior,a,a||' and public._client_invoices_publication_current(p_thread,p_intent)');
   IF replace(body,a||' and public._client_invoices_publication_current(p_thread,p_intent)',a)<>prior THEN
    RAISE EXCEPTION 'Whole original publication inverse differs' USING ERRCODE='23514'; END IF;
  END IF;
  definition:=pg_get_functiondef(target);
  IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN
   RAISE EXCEPTION 'Original function body ambiguous' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,prior,body);
  EXECUTE format('ALTER FUNCTION %s VOLATILE',e.identity);
  SELECT (to_jsonb(p)-ARRAY['prosrc','provolatile','proargdefaults'])||jsonb_build_object(
   'proargdefaults',regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g'),
   'arguments',pg_get_function_arguments(p.oid)) INTO after_meta FROM pg_proc p WHERE oid=target;
  IF before_meta IS DISTINCT FROM after_meta OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND provolatile='v' AND prosrc=body) THEN
   RAISE EXCEPTION 'Original metadata changed beyond explicit volatility: % fields %',e.identity,
    (SELECT jsonb_agg(k) FROM jsonb_object_keys(before_meta) q(k) WHERE before_meta->k IS DISTINCT FROM after_meta->k)
    USING ERRCODE='23514'; END IF;
 END LOOP;
END $compose$;
COMMIT;
