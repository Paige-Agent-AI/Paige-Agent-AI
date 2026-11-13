-- CLI-created 20261113165306; NEVER published/applied candidate forward-renumbered
-- to reserved32 under Coordinator45cfb235: EXP08 published30, EXP07 local31,
-- withdrawn unpublished29 has no filler. Re-ground applied frontier before release.
-- ONE original Studio project/request and private accepted-turn reference.
-- Explicit authoring reuses original writers. No automatic domain execution or
-- publication, new result store, provider, or direct table grant is introduced.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $baseline$
DECLARE signature text; expected text; expected_acl text;
BEGIN
 FOR signature,expected IN SELECT * FROM (VALUES
  ('public.create_studio_session(text,text,jsonb,boolean,uuid,uuid)','6f0a0cef4d411b4ef75a00a5bb5bec42'),
  ('public.studio_role_ok(uuid)','1cf44d6637a20846c7e52fc35ec7b6d3'),
  ('public.paige_studio_thread_ensure(uuid)','3535edb88dd02ceec2ec4087bf4371ad'),
  ('public._team_hub_visible(uuid,uuid,uuid)','944ae4d661b7ea427717b35b6fc86c4d'),
  ('public._team_hub_is_active(uuid,uuid)','8a17dba7a1a8fd50bcc5c7457e6caa05'),
  ('public._team_hub_participates(uuid,uuid)','c204534d91951e1a6841003f1b9976a7'),
  ('public.save_artifact_version(uuid,text,uuid,uuid)','414256973e5858b5ace8f3d38e57d725'),
  ('public.growth_page_upsert(uuid,text,text,jsonb,jsonb,jsonb,uuid,jsonb)','b58fbbc9b18a40de26fc85e5937d2298'),
  ('public._growth_form_go_live(uuid,uuid)','4183c4f3fc90f0ed58d751482f896620'),
  ('public.growth_validate_blocks(jsonb)','264e09051c47a6282950b94c4ddb968c'),
  ('public._growth_page_go_live(uuid,uuid)','d83ae6e305890c40ee72a6910dac2cea')
 ) AS p(signature,expected) LOOP
  expected_acl:=CASE WHEN signature LIKE 'public._team_hub_%' OR signature IN ('public._growth_form_go_live(uuid,uuid)','public._growth_page_go_live(uuid,uuid)')
   THEN '{postgres=X/postgres}' ELSE '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' END;
  IF to_regprocedure(signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(signature))) IS DISTINCT FROM expected
   OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM 'postgres'
   OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM expected_acl THEN
   RAISE EXCEPTION 'EXP06 original prerequisite changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.team_hub_agent_turns'::regclass)
  OR has_table_privilege('authenticated','public.team_hub_agent_turns','INSERT,UPDATE')
  OR has_any_column_privilege('authenticated','public.team_hub_agent_turns','INSERT,UPDATE') THEN
  RAISE EXCEPTION 'Original accepted-turn storage is not protected' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.studio_sessions'::regclass
  AND attname='studio_start_request_id' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'Studio binding already exists; reconcile forward history' USING ERRCODE='55000'; END IF;
END $baseline$;

ALTER TABLE public.studio_sessions ADD COLUMN studio_start_request_id uuid, ADD COLUMN studio_start_digest text;
ALTER TABLE public.studio_sessions ADD CONSTRAINT studio_start_binding_pair CHECK (
 (studio_start_request_id IS NULL AND studio_start_digest IS NULL)
 OR (studio_start_request_id IS NOT NULL AND studio_start_digest ~ '^[0-9a-f]{64}$'));
CREATE UNIQUE INDEX studio_session_original_start ON public.studio_sessions(tenant_id,owner_user_id,studio_start_request_id)
 WHERE studio_start_request_id IS NOT NULL;
ALTER TABLE public.team_hub_agent_turns ADD COLUMN studio_brief jsonb, ADD COLUMN studio_session_id uuid;
ALTER TABLE public.team_hub_agent_turns ADD CONSTRAINT team_hub_studio_brief_size CHECK (
 studio_brief IS NULL OR (jsonb_typeof(studio_brief)='object' AND octet_length(studio_brief::text)<=20000));

-- User-authored project input, NOT source confirmation or access evidence.
CREATE FUNCTION public._studio_project_context_valid(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE entry record; target jsonb; value text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>32768
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('target','values','template_id')) THEN RETURN false; END IF;
 IF v ? 'template_id' AND v->>'template_id' IS DISTINCT FROM 'nexus-editorial-landing-v1' THEN RETURN false; END IF;
 IF v ? 'target' THEN
  target:=v->'target';
  IF jsonb_typeof(target) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(target) k WHERE k NOT IN ('kind','reference','label'))
   OR jsonb_typeof(target->'kind') IS DISTINCT FROM 'string'
   OR target->>'kind' NOT IN ('workspace','client','prospect','custom') OR NOT(target ? 'kind') THEN RETURN false; END IF;
  IF target->>'kind'<>'workspace' AND (jsonb_typeof(target->'reference') IS DISTINCT FROM 'string'
   OR target->>'reference' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') THEN RETURN false; END IF;
  IF target->>'kind'='workspace' AND target ? 'reference' THEN RETURN false; END IF;
  IF target ? 'label' AND (jsonb_typeof(target->'label') IS DISTINCT FROM 'string'
   OR length(btrim(target->>'label')) NOT BETWEEN 1 AND 200 OR target->>'label' ~ '[[:cntrl:]]') THEN RETURN false; END IF;
 END IF;
 IF v ? 'values' THEN
  IF jsonb_typeof(v->'values') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR entry IN SELECT * FROM jsonb_each(v->'values') LOOP
   IF entry.key NOT IN ('publicName','dbaName','offers','idealCustomer','customerSegments','serviceArea','brandVoice',
    'doNotAssume','productName','primaryColor','accentColor','font','logoUrl','logoDarkUrl','tagline')
    OR jsonb_typeof(entry.value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
   value:=entry.value#>>'{}';
   IF length(value)>4000 OR translate(value,E'\n\r\t','') ~ '[[:cntrl:]]'
    OR value ~* '(secret|token|password|credential|authorization|api[_ -]?key)[[:space:]]*[:=][[:space:]]*[^[:space:]]{4,}'
    OR value ~* '(sk_live_|github_pat_|ghp_|Bearer[[:space:]]|-----BEGIN [A-Z ]*PRIVATE KEY)' THEN RETURN false; END IF;
   IF entry.key IN ('primaryColor','accentColor') AND value<>'' AND value !~ '^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$' THEN RETURN false; END IF;
   IF entry.key IN ('logoUrl','logoDarkUrl') AND value<>'' AND (value !~ '^https://[^/@[:space:]]+\.[^/@[:space:]]+/'
    OR value ~* '(secret|token|password|signature|api[_-]?key)=') THEN RETURN false; END IF;
  END LOOP;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._studio_project_context_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the original Studio eligibility gate, including governed agency
-- management. Lock current identity/workspace first; refuse contention instead
-- of waiting on a departure while retaining a child row.
CREATE FUNCTION public._studio_current_scope(p_expected_tenant uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); active_tenant uuid;
BEGIN
 IF actor IS NULL OR p_expected_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM public.current_user_tenant_id() THEN
  RAISE EXCEPTION 'STUDIO_SCOPE_CHANGED: choose the current workspace' USING ERRCODE='42501'; END IF;
 BEGIN
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'STUDIO_FORBIDDEN: current identity required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=p_expected_tenant AND user_id=actor FOR SHARE NOWAIT;
  PERFORM 1 FROM public.tenants WHERE id=p_expected_tenant AND status IN ('trial','active','past_due') FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'STUDIO_FORBIDDEN: active workspace required' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=actor FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'STUDIO_FORBIDDEN: workspace authority is changing' USING ERRCODE='42501'; END;
 IF active_tenant IS DISTINCT FROM p_expected_tenant OR NOT coalesce(public.studio_role_ok(actor),false) THEN
  RAISE EXCEPTION 'STUDIO_FORBIDDEN: workspace owner or admin required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION public._studio_current_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- New binding fields never inherit permission from an existing table-wide
-- browser grant. Original definer writers can bind them; direct DML cannot.
CREATE FUNCTION public._studio_start_binding_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated','service_role') AND
  ((TG_OP='INSERT' AND (NEW.studio_start_request_id IS NOT NULL OR NEW.studio_start_digest IS NOT NULL))
   OR (TG_OP='UPDATE' AND (NEW.studio_start_request_id IS DISTINCT FROM OLD.studio_start_request_id
     OR NEW.studio_start_digest IS DISTINCT FROM OLD.studio_start_digest))) THEN
  RAISE EXCEPTION 'STUDIO_FORBIDDEN: original start writer required' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.studio_start_request_id IS NOT NULL AND
  (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
   OR NEW.studio_start_request_id IS DISTINCT FROM OLD.studio_start_request_id OR NEW.studio_start_digest IS DISTINCT FROM OLD.studio_start_digest) THEN
  RAISE EXCEPTION 'STUDIO_START_BOUND: original request binding is immutable' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._studio_start_binding_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER studio_original_start_guard BEFORE INSERT OR UPDATE ON public.studio_sessions FOR EACH ROW EXECUTE FUNCTION public._studio_start_binding_guard();

CREATE FUNCTION public.studio_start_project(p_expected_tenant uuid,p_request_id uuid,p_brief text,p_project_context jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; fingerprint text; thread_id uuid; created boolean:=false;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 IF p_request_id IS NULL OR p_brief IS NULL OR length(btrim(p_brief)) NOT BETWEEN 1 AND 32000
  OR translate(p_brief,E'\n\r\t','') ~ '[[:cntrl:]]' OR NOT public._studio_project_context_valid(p_project_context) THEN
  RAISE EXCEPTION 'STUDIO_INVALID_INPUT: check the project brief and context' USING ERRCODE='22023'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('brief',btrim(p_brief),'context',p_project_context)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO s FROM public.studio_sessions WHERE tenant_id=p_expected_tenant AND owner_user_id=actor AND studio_start_request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF s.studio_start_digest IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'STUDIO_START_BOUND: this request already has different content' USING ERRCODE='40001'; END IF;
  IF s.status='archived' THEN RAISE EXCEPTION 'STUDIO_NOT_FOUND: original project unavailable' USING ERRCODE='42501'; END IF;
 ELSE
  s:=public.create_studio_session(left(regexp_replace(btrim(p_brief),'\s+',' ','g'),60),btrim(p_brief),'[]'::jsonb,false,NULL,NULL);
  UPDATE public.studio_sessions SET studio_start_request_id=p_request_id,studio_start_digest=fingerprint,
   studio_session_scratchpad=coalesce(studio_session_scratchpad,'{}'::jsonb)||jsonb_build_object('project_context',p_project_context)
   WHERE id=s.id AND tenant_id=p_expected_tenant AND owner_user_id=actor RETURNING * INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'STUDIO_START_UNKNOWN: original project readback unavailable' USING ERRCODE='40001'; END IF;
  created:=true;
 END IF;
 thread_id:=public.paige_studio_thread_ensure(s.id);
 IF NOT EXISTS(SELECT 1 FROM public.paige_chat_threads WHERE id=thread_id AND caller_user_id=actor AND tenant_id=p_expected_tenant
  AND studio_session_id=s.id AND NOT is_archived) THEN RAISE EXCEPTION 'STUDIO_START_UNKNOWN: original thread readback unavailable' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('ok',true,'state','ready','session_id',s.id,'thread_id',thread_id,'created',created);
END $$;
REVOKE ALL ON FUNCTION public.studio_start_project(uuid,uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_start_project(uuid,uuid,text,jsonb) TO authenticated;

-- UNKNOWN recovery is read-only: no create, touch, thread ensure or generation.
CREATE FUNCTION public.studio_lookup_project_start(p_expected_tenant uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; thread_id uuid;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO s FROM public.studio_sessions WHERE tenant_id=p_expected_tenant AND owner_user_id=actor
  AND studio_start_request_id=p_request_id AND status<>'archived';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 SELECT id INTO thread_id FROM public.paige_chat_threads WHERE caller_user_id=actor AND tenant_id=p_expected_tenant
  AND studio_session_id=s.id AND NOT is_archived;
 IF thread_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 RETURN jsonb_build_object('ok',true,'state','ready','session_id',s.id,'thread_id',thread_id,'created',false);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.studio_lookup_project_start(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_lookup_project_start(uuid,uuid) TO authenticated;

CREATE FUNCTION public.studio_project_context(p_expected_tenant uuid,p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; context jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT s.studio_session_scratchpad->'project_context' INTO context FROM public.studio_sessions s
  WHERE s.id=p_session_id AND s.tenant_id=p_expected_tenant AND s.status<>'archived'
   AND (s.owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant));
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 RETURN jsonb_build_object('ok',true,'context',coalesce(context,'{}'::jsonb));
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.studio_project_context(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_project_context(uuid,uuid) TO authenticated;

CREATE FUNCTION public.studio_set_project_context(p_expected_tenant uuid,p_session_id uuid,p_project_context jsonb,p_expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; context jsonb; s public.studio_sessions;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 IF NOT public._studio_project_context_valid(p_project_context) THEN RAISE EXCEPTION 'STUDIO_INVALID_CONTEXT: check the project context' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant)) FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 context:=coalesce(s.studio_session_scratchpad->'project_context','{}'::jsonb);
 IF context=p_project_context THEN RETURN jsonb_build_object('ok',true,'context',context,'changed',false); END IF;
 IF p_expected_context IS NULL OR p_expected_context IS DISTINCT FROM context THEN
  RAISE EXCEPTION 'STUDIO_CONTEXT_CHANGED: the project context changed; reload it before saving' USING ERRCODE='40001'; END IF;
 UPDATE public.studio_sessions SET studio_session_scratchpad=coalesce(studio_session_scratchpad,'{}'::jsonb)||jsonb_build_object('project_context',p_project_context)
  WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
   AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant)) RETURNING studio_session_scratchpad->'project_context' INTO context;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 RETURN jsonb_build_object('ok',true,'context',context,'changed',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN lock_not_available THEN RAISE EXCEPTION 'STUDIO_CONTEXT_CHANGED: this project is being edited; reload before saving' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.studio_set_project_context(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_set_project_context(uuid,uuid,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public._team_hub_studio_scope(t public.team_hub_agent_turns)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.team_hub_channels; config jsonb; active_tenant uuid;
BEGIN
 BEGIN
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM auth.users WHERE id=t.asker_user_id AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=t.tenant_id AND user_id=t.asker_user_id AND status='active' AND role IN ('owner','admin') AND team_hub_access FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants WHERE id=t.tenant_id AND status IN ('trial','active','past_due') AND account_type='standalone' AND parent_tenant_id IS NULL FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=t.asker_user_id FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END;
 IF active_tenant IS DISTINCT FROM t.tenant_id OR NOT coalesce(public._team_hub_participates(t.tenant_id,t.asker_user_id),false)
  OR t.agent_key NOT IN ('paige','nexus') OR t.intent IS DISTINCT FROM 'dm' THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public._team_hub_visible(t.tenant_id,t.asker_user_id,t.channel_id);
 IF NOT FOUND OR c.kind IS DISTINCT FROM 'agent_dm' OR c.agent_key IS DISTINCT FROM t.agent_key
  OR c.visibility IS DISTINCT FROM 'private' OR c.created_by IS DISTINCT FROM t.asker_user_id THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.team_hub_channels WHERE id=c.id AND archived_at IS NULL FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.team_hub_channel_members WHERE channel_id=c.id AND user_id=t.asker_user_id FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.team_hub_messages WHERE id=t.source_message_id AND tenant_id=t.tenant_id AND channel_id=t.channel_id
  AND author_user_id=t.asker_user_id AND author_kind='user' AND deleted_at IS NULL FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 IF t.posted_message_id IS NOT NULL THEN
  PERFORM 1 FROM public.team_hub_messages WHERE id=t.posted_message_id AND tenant_id=t.tenant_id AND channel_id=t.channel_id
   AND author_user_id=t.asker_user_id AND author_kind='agent' AND agent_key=t.agent_key AND deleted_at IS NULL FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF t.agent_key='nexus' THEN
  BEGIN SELECT s.config INTO STRICT config FROM public.paige_subagents s WHERE s.tenant_id IS NULL AND s.slug='nexus' AND s.enabled FOR SHARE NOWAIT;
  EXCEPTION WHEN no_data_found OR too_many_rows OR lock_not_available THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END;
  IF config#>>'{capability_scope,mode}' IS DISTINCT FROM 'allowlist' OR coalesce(config#>>'{capability_scope,access}','') NOT IN ('read','card')
   OR jsonb_typeof(config#>'{capability_scope,tools}') IS DISTINCT FROM 'array' OR NOT (config#>'{capability_scope,tools}') @> '["growth_list"]'::jsonb
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(config#>'{capability_scope,tools}') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
   RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501'; END IF;
 END IF;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'Private Studio preparation unavailable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public._team_hub_studio_scope(public.team_hub_agent_turns) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._team_hub_studio_turn_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb:=NEW.studio_brief;
BEGIN
 IF TG_OP='UPDATE' AND NEW.token_hash IS DISTINCT FROM OLD.token_hash AND NEW.posted_message_id IS NULL THEN
  NEW.studio_brief:=NULL; NEW.studio_session_id:=NULL; RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.posted_message_id IS NULL AND NEW.posted_message_id IS NULL AND NEW.consumed_at IS NOT NULL THEN
  NEW.studio_brief:=NULL; NEW.studio_session_id:=NULL; RETURN NEW; END IF;
 IF v IS NULL THEN
  IF NEW.studio_session_id IS NOT NULL THEN RAISE EXCEPTION 'Original Studio preparation required' USING ERRCODE='22023'; END IF;
  RETURN NEW;
 END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k<>'brief')
  OR jsonb_typeof(v->'brief') IS DISTINCT FROM 'string' OR length(btrim(v->>'brief')) NOT BETWEEN 1 AND 10000
  OR translate(v->>'brief',E'\n\r\t','') ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid Studio preparation' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND OLD.studio_brief IS NOT NULL AND OLD.posted_message_id IS NOT NULL
  AND (NEW.studio_brief IS DISTINCT FROM OLD.studio_brief OR (OLD.studio_session_id IS NOT NULL AND NEW.studio_session_id IS DISTINCT FROM OLD.studio_session_id)) THEN
  RAISE EXCEPTION 'Studio preparation is already bound' USING ERRCODE='40001'; END IF;
 IF TG_OP='UPDATE' AND NEW.posted_message_id IS DISTINCT FROM OLD.posted_message_id AND NEW.accepted_at<clock_timestamp()-interval '5 minutes' THEN
  RAISE EXCEPTION 'Studio preparation expired before publication' USING ERRCODE='42501'; END IF;
 PERFORM public._team_hub_studio_scope(NEW);
 IF NEW.studio_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.studio_sessions s WHERE s.id=NEW.studio_session_id
  AND s.tenant_id=NEW.tenant_id AND s.owner_user_id=NEW.asker_user_id AND s.studio_start_request_id=NEW.id AND s.status<>'archived') THEN
  RAISE EXCEPTION 'Original Studio binding unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_studio_turn_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER team_hub_studio_turn_scope BEFORE INSERT OR UPDATE ON public.team_hub_agent_turns FOR EACH ROW EXECUTE FUNCTION public._team_hub_studio_turn_guard();

CREATE FUNCTION public.team_hub_studio_scope(p_turn_id uuid,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=p_turn_id AND token_hash=p_token_hash AND consumed_at IS NULL AND accepted_at>=clock_timestamp()-interval '5 minutes';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_studio_scope(t);
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_studio_scope(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_studio_scope(uuid,text) TO service_role;

CREATE FUNCTION public.team_hub_stage_studio_brief(p_turn_id uuid,p_token_hash text,p_brief text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=p_turn_id AND token_hash=p_token_hash AND consumed_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_studio_scope(t);
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=p_turn_id AND token_hash=p_token_hash AND consumed_at IS NULL FOR UPDATE;
 IF NOT FOUND OR t.accepted_at<clock_timestamp()-interval '5 minutes' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 UPDATE public.team_hub_agent_turns SET studio_brief=jsonb_build_object('brief',p_brief) WHERE id=t.id;
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_stage_studio_brief(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_stage_studio_brief(uuid,text,text) TO service_role;

CREATE FUNCTION public.team_hub_studio_reference(p_expected_tenant uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; t public.team_hub_agent_turns;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE tenant_id=p_expected_tenant AND asker_user_id=actor
  AND posted_message_id=p_message_id AND consumed_at IS NOT NULL AND studio_brief IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_studio_scope(t);
 IF t.studio_session_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.studio_sessions WHERE id=t.studio_session_id AND tenant_id=p_expected_tenant
   AND owner_user_id=actor AND studio_start_request_id=t.id AND status<>'archived') THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
  RETURN jsonb_build_object('ok',true,'state','ready','session_id',t.studio_session_id);
 END IF;
 RETURN jsonb_build_object('ok',true,'state','prepared','brief',t.studio_brief->>'brief');
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_studio_reference(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_studio_reference(uuid,uuid) TO authenticated;

CREATE FUNCTION public.team_hub_start_studio(p_expected_tenant uuid,p_message_id uuid,p_project_context jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; t public.team_hub_agent_turns; started jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE tenant_id=p_expected_tenant AND asker_user_id=actor
  AND posted_message_id=p_message_id AND consumed_at IS NOT NULL AND studio_brief IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_studio_scope(t);
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=t.id AND posted_message_id=p_message_id AND consumed_at IS NOT NULL AND studio_brief IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_studio_scope(t);
 started:=public.studio_start_project(p_expected_tenant,t.id,t.studio_brief->>'brief',p_project_context);
 IF t.studio_session_id IS NOT NULL AND t.studio_session_id::text IS DISTINCT FROM started->>'session_id' THEN
  RAISE EXCEPTION 'STUDIO_START_UNKNOWN: original binding changed' USING ERRCODE='40001'; END IF;
 UPDATE public.team_hub_agent_turns SET studio_session_id=(started->>'session_id')::uuid WHERE id=t.id;
 RETURN started;
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_start_studio(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_start_studio(uuid,uuid,jsonb) TO authenticated;

-- Chat preparation belongs to the ORIGINAL R2-admitted user source. The
-- incumbent whole-row authority guard protects every admitted-row field from
-- non-postgres mutation, including these additions. No R2 helper is changed.
DO $chat_baseline$
DECLARE signature text; expected text; expected_acl text;
BEGIN
 FOR signature,expected IN SELECT * FROM (VALUES
  ('public.paige_chat_interactive_runtime_context(uuid,uuid,uuid,uuid)','89dde6a0361dcf52515e7f676f6c6055'),
  ('public.paige_chat_interactive_executor_v2(uuid,uuid,uuid,uuid,text)','3762add7463c1a84aadbbfd322fd5bbb'),
  ('public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid)','d40e32d4ff3787247b8b88acc3f2d532'),
  ('public.paige_chat_interactive_acquire_bound(uuid,uuid,uuid,uuid,uuid,uuid,text)','1f8aa4ce07cc06041e6eefb108ab5c85'),
  ('public.paige_chat_turn_authority_guard()','e9fab911a9715ab1b8a27ca96c105fff'),
  ('public.paige_chat_interactive_columns_guard()','2d26d104a54b3f99f53a20a3e3443e5d'),
  ('public.paige_chat_runtime_columns_guard()','082bd3f8d7ca8307bde6c7776efce725'),
  ('public.agency_can_manage_child(uuid,uuid)','e1ca114dad1467e2726b96da86fa03b5')
 ) AS p(signature,expected) LOOP
  expected_acl:=CASE WHEN signature IN ('public.paige_chat_turn_authority_guard()','public.paige_chat_runtime_columns_guard()','public.paige_chat_interactive_columns_guard()')
   THEN '{postgres=X/postgres}' ELSE '{postgres=X/postgres,service_role=X/postgres}' END;
  IF to_regprocedure(signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(signature))) IS DISTINCT FROM expected
   OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM 'postgres'
   OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM expected_acl THEN
   RAISE EXCEPTION 'EXP06 original Chat prerequisite changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.paige_chat_turns'::regclass AND NOT tgisinternal AND tgenabled='O'
  AND tgfoid='public.paige_chat_turn_authority_guard()'::regprocedure AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.paige_chat_turns'::regclass AND NOT tgisinternal AND tgenabled='O'
   AND tgfoid='public.paige_chat_runtime_columns_guard()'::regprocedure AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.paige_chat_threads'::regclass AND NOT tgisinternal AND tgenabled='O'
   AND tgfoid='public.paige_chat_runtime_columns_guard()'::regprocedure AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.paige_chat_threads'::regclass AND NOT tgisinternal AND tgenabled='O'
   AND tgfoid='public.paige_chat_interactive_columns_guard()'::regprocedure AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16)
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_chat_turns'::regclass) THEN
  RAISE EXCEPTION 'Original Chat issued-row authority guards unavailable' USING ERRCODE='55000'; END IF;
END $chat_baseline$;

ALTER TABLE public.paige_chat_turns ADD COLUMN studio_brief jsonb, ADD COLUMN studio_session_id uuid;
ALTER TABLE public.paige_chat_turns ADD CONSTRAINT chat_studio_original_source CHECK (
 (studio_brief IS NULL AND studio_session_id IS NULL) OR ((
  role='user' AND interactive_intent_id IS NOT NULL AND interactive_actor_id IS NOT NULL AND interactive_tenant_id IS NOT NULL
  AND jsonb_typeof(interactive_runtime_binding)='object' AND interactive_runtime_binding->>'mode'='normal'
  AND interactive_runtime_binding->>'admission_turn_id'=id::text
  AND interactive_runtime_binding->>'intent_id'=interactive_intent_id::text
  AND jsonb_typeof(studio_brief)='object' AND (studio_brief-'brief')='{}'::jsonb
  AND jsonb_typeof(studio_brief->'brief')='string' AND length(btrim(studio_brief->>'brief')) BETWEEN 1 AND 10000
  AND octet_length(studio_brief::text)<=65536
 ) IS TRUE));

-- Explicit actor composition for service-only preparation: studio_role_ok
-- cannot be called with another actor under a service JWT. Reuse the ORIGINAL
-- agency eligibility predicate after locking its actual authority records.
CREATE FUNCTION public._chat_studio_actor_scope(p_actor uuid,p_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE active_tenant uuid; native_admin boolean; parent uuid;
BEGIN
 IF p_actor IS NULL OR p_tenant IS NULL THEN RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END IF;
 BEGIN
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor FOR SHARE NOWAIT;
  SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor AND status='active' AND role IN ('owner','admin')) INTO native_admin;
  SELECT parent_tenant_id INTO parent FROM public.tenants WHERE id=p_tenant AND status IN ('trial','active','past_due') FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=p_actor FOR SHARE NOWAIT;
  IF active_tenant IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END IF;
  IF NOT native_admin THEN
   IF parent IS NULL THEN RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END IF;
   PERFORM 1 FROM public.tenants WHERE id=parent FOR SHARE NOWAIT;
   PERFORM 1 FROM public.tenant_members WHERE tenant_id=parent AND user_id=p_actor FOR SHARE NOWAIT;
   PERFORM 1 FROM public.agency_team_members WHERE agency_tenant_id=parent AND user_id=p_actor FOR SHARE NOWAIT;
   IF NOT coalesce(public.agency_can_manage_child(p_tenant,p_actor),false) THEN
    RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END IF;
  END IF;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'Studio source authority unavailable' USING ERRCODE='42501'; END;
END $$;
REVOKE ALL ON FUNCTION public._chat_studio_actor_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._chat_studio_binding_valid(binding jsonb,p_source uuid,p_intent uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(binding)='object' AND binding->'v'='1'::jsonb
  AND binding->>'function_slug'='paige-ai-chat' AND binding->>'mode'='normal'
  AND binding->>'intent_id'=p_intent::text AND binding->>'admission_turn_id'=p_source::text
  AND binding->>'request_nonce' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND binding->>'execution_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND binding->>'deployment_id' ~ '^[a-z0-9]{10,32}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9]{1,12}$',false)
$$;
REVOKE ALL ON FUNCTION public._chat_studio_binding_valid(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._chat_studio_executing_source(p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb; t public.paige_chat_threads; source public.paige_chat_turns; count_rows integer;
BEGIN
 IF p_thread IS NULL OR p_intent IS NULL OR p_request_nonce IS NULL THEN RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._chat_studio_actor_scope(p_actor,p_tenant);
 -- ORIGINAL rollout→thread/executor ordering and actual Stop/terminal evidence.
 state:=public.paige_chat_interactive_runtime_context(p_thread,p_actor,p_tenant,p_intent);
 IF state->>'latest' IS DISTINCT FROM p_intent::text OR state->>'executor' IS DISTINCT FROM p_intent::text
  OR state->'stopped' IS DISTINCT FROM 'false'::jsonb OR state->'terminal' IS DISTINCT FROM 'false'::jsonb
  OR state->'recovery_read_only' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.caller_user_id IS DISTINCT FROM p_actor OR t.tenant_id IS DISTINCT FROM p_tenant
  OR t.audience IS DISTINCT FROM 'workspace' OR t.is_archived IS DISTINCT FROM false THEN RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO count_rows FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='user'
  AND interactive_intent_id=p_intent AND interactive_actor_id=p_actor AND interactive_tenant_id=p_tenant;
 IF count_rows<>1 THEN RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM public.paige_chat_turns WHERE thread_id=p_thread AND role='user'
  AND interactive_intent_id=p_intent AND interactive_actor_id=p_actor AND interactive_tenant_id=p_tenant FOR UPDATE;
 IF NOT public._chat_studio_binding_valid(source.interactive_runtime_binding,source.id,p_intent)
  OR source.interactive_runtime_binding IS DISTINCT FROM t.interactive_runtime_binding
  OR source.interactive_runtime_binding->>'request_nonce' IS DISTINCT FROM p_request_nonce::text THEN
  RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 RETURN source.id;
END $$;
REVOKE ALL ON FUNCTION public._chat_studio_executing_source(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.chat_studio_scope(p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source uuid;
BEGIN
 source:=public._chat_studio_executing_source(p_thread,p_actor,p_tenant,p_intent,p_request_nonce);
 RETURN jsonb_build_object('ok',true,'source_turn_id',source);
EXCEPTION WHEN insufficient_privilege OR lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.chat_studio_scope(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_studio_scope(uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.chat_stage_studio_brief(p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid,p_brief text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source uuid; prior jsonb; selected text:=btrim(p_brief);
BEGIN
 IF selected IS NULL OR length(selected) NOT BETWEEN 1 AND 10000 OR translate(selected,E'\n\r\t','') ~ '[[:cntrl:]]' THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 source:=public._chat_studio_executing_source(p_thread,p_actor,p_tenant,p_intent,p_request_nonce);
 SELECT studio_brief INTO prior FROM public.paige_chat_turns WHERE id=source;
 IF prior IS NOT NULL THEN
  IF prior IS DISTINCT FROM jsonb_build_object('brief',selected) THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'source_turn_id',source,'outcome','existing');
 END IF;
 UPDATE public.paige_chat_turns SET studio_brief=jsonb_build_object('brief',selected) WHERE id=source AND studio_brief IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 RETURN jsonb_build_object('ok',true,'source_turn_id',source,'outcome','staged');
EXCEPTION WHEN insufficient_privilege OR lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.chat_stage_studio_brief(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_stage_studio_brief(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

-- Historical preparation derives only the issued source row. A later terminal
-- or newer executor never turns a historical reference into another admission.
CREATE FUNCTION public._chat_studio_historical_source(p_tenant uuid,p_actor uuid,p_source uuid)
RETURNS public.paige_chat_turns LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source public.paige_chat_turns; t public.paige_chat_threads;
BEGIN
 SELECT * INTO source FROM public.paige_chat_turns WHERE id=p_source AND role='user'
  AND interactive_actor_id=p_actor AND interactive_tenant_id=p_tenant AND interactive_intent_id IS NOT NULL;
 IF NOT FOUND OR NOT public._chat_studio_binding_valid(source.interactive_runtime_binding,source.id,source.interactive_intent_id) THEN
  RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=source.thread_id AND caller_user_id=p_actor AND tenant_id=p_tenant
  AND audience='workspace' AND NOT is_archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 IF source.studio_brief IS NULL THEN RAISE EXCEPTION 'Studio source unavailable' USING ERRCODE='42501'; END IF;
 RETURN source;
END $$;
REVOKE ALL ON FUNCTION public._chat_studio_historical_source(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.chat_studio_reference(p_expected_tenant uuid,p_source_turn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; source public.paige_chat_turns;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 source:=public._chat_studio_historical_source(p_expected_tenant,actor,p_source_turn_id);
 IF source.studio_session_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.studio_sessions WHERE id=source.studio_session_id AND tenant_id=p_expected_tenant
   AND owner_user_id=actor AND studio_start_request_id=source.id AND status<>'archived') THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
  RETURN jsonb_build_object('ok',true,'state','ready','session_id',source.studio_session_id);
 END IF;
 RETURN jsonb_build_object('ok',true,'state','prepared','brief',source.studio_brief->>'brief');
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.chat_studio_reference(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chat_studio_reference(uuid,uuid) TO authenticated;

CREATE FUNCTION public.chat_studio_start(p_expected_tenant uuid,p_source_turn_id uuid,p_project_context jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; source public.paige_chat_turns; started jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 source:=public._chat_studio_historical_source(p_expected_tenant,actor,p_source_turn_id);
 PERFORM 1 FROM public.paige_chat_turns WHERE id=source.id FOR UPDATE;
 source:=public._chat_studio_historical_source(p_expected_tenant,actor,p_source_turn_id);
 started:=public.studio_start_project(p_expected_tenant,source.id,source.studio_brief->>'brief',p_project_context);
 IF source.studio_session_id IS NOT NULL AND source.studio_session_id::text IS DISTINCT FROM started->>'session_id' THEN
  RAISE EXCEPTION 'STUDIO_START_UNKNOWN: original Chat binding changed' USING ERRCODE='40001'; END IF;
 IF source.studio_session_id IS NULL THEN
  UPDATE public.paige_chat_turns SET studio_session_id=(started->>'session_id')::uuid WHERE id=source.id;
 END IF;
 RETURN started;
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.chat_studio_start(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chat_studio_start(uuid,uuid,jsonb) TO authenticated;

-- Stored conversion policy mirrors conversion-destination.ts. This is lexical
-- admission only, never DNS, account authority, external execution or delivery.
CREATE FUNCTION public._growth_conversion_decode_uri(v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE output bytea:=''::bytea; position integer:=1; piece text;
BEGIN
 WHILE position<=length(v) LOOP
  piece:=substr(v,position,1);
  IF piece='%' THEN
   piece:=substr(v,position+1,2);
   IF length(piece)<>2 OR piece !~ '^[0-9a-fA-F]{2}$' THEN RETURN NULL; END IF;
   output:=output||decode(piece,'hex'); position:=position+3;
  ELSE output:=output||convert_to(piece,'UTF8'); position:=position+1; END IF;
 END LOOP;
 RETURN convert_from(output,'UTF8');
EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._growth_conversion_decode_uri(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._growth_conversion_decode_uri(text) TO anon,authenticated,service_role;

CREATE FUNCTION public._growth_conversion_destination_valid(d jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kind text:=d->>'kind'; url text:=d->>'url'; parts text[]; host text; path text; query text;
 decoded text; item text; seen text[]:='{}'; provider text; shape text; component text;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'kind') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 IF kind='native_form' THEN
  RETURN jsonb_typeof(d->'formId')='string' AND d->>'formId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('kind','formId'));
 ELSIF kind='native_booking' THEN
  RETURN jsonb_typeof(d->'slug')='string' AND length(d->>'slug') BETWEEN 1 AND 128 AND d->>'slug' ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('kind','slug'));
 END IF;
 IF kind NOT IN ('external_form','external_booking') OR jsonb_typeof(d->'mode') IS DISTINCT FROM 'string' OR d->>'mode' NOT IN ('link','embed')
  OR jsonb_typeof(d->'url') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'provider') IS DISTINCT FROM 'string'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('kind','mode','url','provider'))
  OR length(url) NOT BETWEEN 1 AND 2048 OR url ~ '[[:space:]<>]' OR position(chr(92) IN url)>0 THEN RETURN false; END IF;
 decoded:=url;
 FOR i IN 1..2 LOOP
  decoded:=public._growth_conversion_decode_uri(decoded);
  IF decoded IS NULL OR decoded ~ '[[:cntrl:]]' OR decoded ~ U&'[\007f-\009f\200b-\200f\202a-\202e\2066-\2069\feff]'
   OR position(chr(92) IN decoded)>0 OR decoded ~ '[<>]' THEN RETURN false; END IF;
 END LOOP;
 -- Normalized canonical URLs only: no credentials, custom port, IP literal,
 -- fragment, protocol-relative input, or uppercase/noncanonical host.
 parts:=regexp_match(url,'^https://([a-z0-9.-]+)(/[^?#]*)?([?][^#]*)?$');
 IF parts IS NULL THEN RETURN false; END IF;
 host:=parts[1]; path:=coalesce(nullif(parts[2],''),'/'); query:=substr(coalesce(parts[3],''),2);
 IF position('.' IN host)=0 OR host ~ '^[0-9.]+$' OR host ~ '^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+)){0,3}$'
  OR host ~ '\.$' THEN RETURN false; END IF;
 FOREACH component IN ARRAY string_to_array(host,'.') LOOP
  IF component !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN RETURN false; END IF;
 END LOOP;
 FOREACH item IN ARRAY ARRAY['localhost','local','localdomain','internal','intranet','lan','home','home.arpa','corp','test','invalid','example','onion','nip.io','sslip.io','localtest.me','lvh.me'] LOOP
  IF host=item OR right(host,length(item)+1)='.'||item THEN RETURN false; END IF;
 END LOOP;
 IF query<>'' THEN
  IF host<>'calendly.com' THEN RETURN false; END IF;
  FOREACH item IN ARRAY string_to_array(public._growth_conversion_decode_uri(query),'&') LOOP
   IF item='' THEN CONTINUE; END IF;
   IF item !~ '^(hide_landing_page_details|hide_event_type_details)=[01]$' OR split_part(item,'=',1)=ANY(seen) THEN RETURN false; END IF;
   seen:=array_append(seen,split_part(item,'=',1));
  END LOOP;
 END IF;
 provider:=CASE host WHEN 'form.jotform.com' THEN 'jotform' WHEN 'api.leadconnectorhq.com' THEN 'gohighlevel'
  WHEN 'calendly.com' THEN 'calendly' WHEN 'cal.com' THEN 'calcom' ELSE 'other' END;
 IF d->>'provider' IS DISTINCT FROM provider THEN RETURN false; END IF;
 IF host='form.jotform.com' AND path ~ '^/[0-9]{5,32}/?$' THEN shape:='external_form';
 ELSIF host='api.leadconnectorhq.com' AND path ~ '^/widget/form/[A-Za-z0-9_-]{1,128}/?$' THEN shape:='external_form';
 ELSIF host='api.leadconnectorhq.com' AND path ~ '^/widget/bookings/[A-Za-z0-9_-]{1,128}/?$' THEN shape:='external_booking';
 ELSIF host IN ('calendly.com','cal.com') AND path ~ '^/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(/[A-Za-z0-9][A-Za-z0-9_-]{0,127})?/?$'
  AND lower(split_part(path,'/',2))<>ALL(ARRAY['app','api','auth','login','logout','signup','settings','admin','account','help','docs','blog','pricing','features','integrations','embed','assets','event_types','scheduled_events','routing','workflows','availability']) THEN shape:='external_booking';
 END IF;
 RETURN coalesce(d->>'mode'='link' OR shape=kind,false);
END $$;
REVOKE ALL ON FUNCTION public._growth_conversion_destination_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._growth_conversion_destination_valid(jsonb) TO anon,authenticated,service_role;

CREATE FUNCTION public._growth_validate_conversion_block(b jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE key text; max_length integer;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(b) k WHERE k NOT IN ('type','destination','title','description','label'))
  OR public._growth_conversion_destination_valid(b->'destination') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'GROWTH_INVALID_BLOCKS: choose a supported conversion destination' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY ARRAY['title','description','label'] LOOP
  max_length:=CASE key WHEN 'title' THEN 160 WHEN 'description' THEN 400 ELSE 60 END;
  IF b ? key AND (jsonb_typeof(b->key) IS DISTINCT FROM 'string' OR length(b->>key)>max_length) THEN
   RAISE EXCEPTION 'GROWTH_INVALID_BLOCKS: conversion text exceeds its bound' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._growth_validate_conversion_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._growth_validate_conversion_block(jsonb) TO anon,authenticated,service_role;

-- Format is never ownership. Every original page writer passes this tenant-
-- resolved table guard; the public calendar's exact first-class/legacy
-- precedence is preserved. A draft form may be selected, then the ORIGINAL
-- page publication cascade publishes it. Booking calendars are never activated.
CREATE FUNCTION public._growth_validate_conversion_resources(p_tenant uuid,p_blocks jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb; d jsonb; calendar public.calendars; legacy_tenant uuid; legacy_enabled boolean; total integer; usable boolean;
BEGIN
 IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' THEN RETURN; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) WHERE value->>'type'='conversion' LOOP
  PERFORM public._growth_validate_conversion_block(b); d:=b->'destination';
  IF d->>'kind'='native_form' THEN
   -- The original publication cascade updates this same row. Prehold its
   -- non-key update lock so two pages cannot deadlock upgrading shared locks;
   -- ordinary public reads and FK key-share checks remain compatible.
   PERFORM 1 FROM public.growth_forms WHERE id=(d->>'formId')::uuid AND tenant_id=p_tenant AND status<>'archived' FOR NO KEY UPDATE NOWAIT;
   IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_CONVERSION_UNAVAILABLE: choose a form in this workspace' USING ERRCODE='42501'; END IF;
  ELSIF d->>'kind'='native_booking' THEN
   SELECT count(*) INTO total FROM public.calendars WHERE slug=d->>'slug';
   IF total>1 THEN RAISE EXCEPTION 'GROWTH_CONVERSION_UNAVAILABLE: calendar identity is ambiguous' USING ERRCODE='42501'; END IF;
   SELECT * INTO calendar FROM public.calendars WHERE slug=d->>'slug' FOR SHARE NOWAIT;
   usable:=FOUND AND calendar.enabled;
   IF usable THEN
    PERFORM 1 FROM public.calendar_hosts WHERE calendar_id=calendar.id FOR SHARE NOWAIT;
    usable:=FOUND;
   END IF;
   IF usable THEN
    IF calendar.tenant_id IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'GROWTH_CONVERSION_UNAVAILABLE: choose a published calendar in this workspace' USING ERRCODE='42501'; END IF;
   ELSE
    SELECT count(*) INTO total FROM public.staff_calendar_settings WHERE booking_page_slug=d->>'slug';
    IF total<>1 THEN RAISE EXCEPTION 'GROWTH_CONVERSION_UNAVAILABLE: choose a published calendar in this workspace' USING ERRCODE='42501'; END IF;
    SELECT tenant_id,booking_page_enabled INTO legacy_tenant,legacy_enabled FROM public.staff_calendar_settings WHERE booking_page_slug=d->>'slug' FOR SHARE NOWAIT;
    IF legacy_tenant IS DISTINCT FROM p_tenant OR legacy_enabled IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'GROWTH_CONVERSION_UNAVAILABLE: choose a published calendar in this workspace' USING ERRCODE='42501'; END IF;
   END IF;
  END IF;
 END LOOP;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'GROWTH_CONVERSION_UNAVAILABLE: destination is changing; review it again' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public._growth_validate_conversion_resources(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._growth_conversion_page_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM public._growth_validate_conversion_resources(NEW.tenant_id,NEW.blocks_json);
  PERFORM public._growth_validate_conversion_resources(NEW.tenant_id,NEW.draft_blocks_json);
 ELSE
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.blocks_json IS DISTINCT FROM OLD.blocks_json
   OR (NEW.status='published' AND OLD.status<>'published') THEN
   PERFORM public._growth_validate_conversion_resources(NEW.tenant_id,NEW.blocks_json);
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.draft_blocks_json IS DISTINCT FROM OLD.draft_blocks_json THEN
   PERFORM public._growth_validate_conversion_resources(NEW.tenant_id,NEW.draft_blocks_json);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._growth_conversion_page_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER growth_conversion_page_scope BEFORE INSERT OR UPDATE OF tenant_id,blocks_json,draft_blocks_json,status ON public.growth_pages
 FOR EACH ROW EXECUTE FUNCTION public._growth_conversion_page_guard();

-- Bounded named-hunk extension. Preserve original function identity, ACLs,
-- argument defaults, metadata and every prior block/publish branch.
DO $growth$
DECLARE target oid; metadata jsonb; body text; amended text;
BEGIN
 target:=to_regprocedure('public.growth_validate_blocks(jsonb)');
 IF target IS NULL OR md5(pg_get_functiondef(target)) IS DISTINCT FROM '264e09051c47a6282950b94c4ddb968c' THEN
  RAISE EXCEPTION 'EXP06 original block validator changed' USING ERRCODE='55000'; END IF;
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE oid=target;
 body:=pg_get_functiondef(target);
 amended:=replace(body,'''two_column'',''image'',''gallery'',''steps'',''chatbot''','''two_column'',''image'',''gallery'',''steps'',''chatbot'',''conversion''');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 validator type hunk missing' USING ERRCODE='55000'; END IF;
 body:=amended;
 amended:=replace(body,'    IF _btype = ''rich_text''',E'    IF _btype = ''conversion'' THEN\n      PERFORM public._growth_validate_conversion_block(_block);\n    END IF;\n\n    IF _btype = ''rich_text''');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 validator dispatch hunk missing' USING ERRCODE='55000'; END IF;
 EXECUTE amended;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata THEN
  RAISE EXCEPTION 'EXP06 validator metadata changed' USING ERRCODE='55000'; END IF;
 target:=to_regprocedure('public._growth_page_go_live(uuid,uuid)');
 IF target IS NULL OR md5(pg_get_functiondef(target)) IS DISTINCT FROM 'd83ae6e305890c40ee72a6910dac2cea' THEN
  RAISE EXCEPTION 'EXP06 original page cascade changed' USING ERRCODE='55000'; END IF;
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE oid=target;
 body:=pg_get_functiondef(target);
 amended:=replace(body,E'     WHERE b->>''type'' = ''embedded_form'' AND NULLIF(btrim(COALESCE(b->>''form_slug'', '''')), '''') IS NOT NULL\n  LOOP',
  E'     WHERE b->>''type'' = ''embedded_form'' AND NULLIF(btrim(COALESCE(b->>''form_slug'', '''')), '''') IS NOT NULL\n    UNION\n    SELECT f.slug FROM jsonb_array_elements(_blocks) b\n      JOIN public.growth_forms f ON f.id::text=b#>>''{destination,formId}'' AND f.tenant_id=_tenant AND f.status<>''archived''\n     WHERE b->>''type''=''conversion'' AND b#>>''{destination,kind}''=''native_form''\n  LOOP');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 original form cascade hunk missing' USING ERRCODE='55000'; END IF;
 -- Validate before any dependent form publication; the table guard repeats at
 -- final page write. These checks grant no additional publication authority.
 body:=amended;
 amended:=replace(body,'  -- A signup section with no form behind it would publish as an empty box.',
  E'  PERFORM public._growth_validate_conversion_resources(_tenant,_blocks);\n\n  -- A signup section with no form behind it would publish as an empty box.');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 page resource hunk missing' USING ERRCODE='55000'; END IF;
 EXECUTE amended;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata THEN
  RAISE EXCEPTION 'EXP06 page cascade metadata changed' USING ERRCODE='55000'; END IF;
END $growth$;

-- Source-bound refinement reads the saved choice; a model cannot replace it
-- with an invented URL or lose it by regenerating the page. No touch or write.
CREATE FUNCTION public.studio_page_conversion(p_expected_tenant uuid,p_session_id uuid,p_page_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; page public.growth_pages; blocks jsonb; chosen jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant));
 IF NOT FOUND OR jsonb_typeof(s.artifact_refs) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p_page_id::text) THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO page FROM public.growth_pages WHERE id=p_page_id AND tenant_id=p_expected_tenant AND status<>'archived';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 blocks:=CASE WHEN jsonb_typeof(page.draft_blocks_json)='array' THEN page.draft_blocks_json
  WHEN jsonb_typeof(page.blocks_json)='array' THEN page.blocks_json ELSE '[]'::jsonb END;
 SELECT value INTO chosen FROM jsonb_array_elements(blocks) WITH ORDINALITY WHERE value->>'type'='conversion' ORDER BY ordinality LIMIT 1;
 IF chosen IS NOT NULL THEN
  PERFORM public._growth_validate_conversion_block(chosen);
 ELSE
  SELECT value INTO chosen FROM jsonb_array_elements(blocks) WITH ORDINALITY WHERE value->>'type'='embedded_form' ORDER BY ordinality LIMIT 1;
  IF chosen IS NOT NULL THEN
   IF jsonb_typeof(chosen->'form_slug') IS DISTINCT FROM 'string' OR nullif(btrim(chosen->>'form_slug'),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','unavailable'); END IF;
   -- Return only the original canonical typed projection, not arbitrary extra
   -- fields an older block may carry. The identity remains exactly as saved.
   chosen:=jsonb_build_object('type','embedded_form','form_slug',chosen->'form_slug')
    || CASE WHEN jsonb_typeof(chosen->'title')='string' THEN jsonb_build_object('title',chosen->'title') ELSE '{}'::jsonb END;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'conversion',chosen,'page_id',page.id,'updated_at',page.updated_at);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN invalid_parameter_value THEN RETURN jsonb_build_object('ok',false,'code','unavailable');
END $$;
REVOKE ALL ON FUNCTION public.studio_page_conversion(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_page_conversion(uuid,uuid,uuid) TO authenticated;

DO $receipt_privacy$
BEGIN
 IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.paige_workspace_events'::regclass)
  OR has_table_privilege('authenticated','public.paige_workspace_events','SELECT')
  OR has_any_column_privilege('authenticated','public.paige_workspace_events','SELECT')
  OR has_table_privilege('anon','public.paige_workspace_events','SELECT') THEN
  RAISE EXCEPTION 'Original private publication Rail boundary changed' USING ERRCODE='55000'; END IF;
END $receipt_privacy$;

-- Original native event IDs are the receipt source. Project only the permitted
-- publication facts; private Rail details and approval/runtime metadata stay
-- private. A reference read never dispatches or records another capability run.
CREATE FUNCTION public.studio_publication_receipts(p_expected_tenant uuid,p_session_id uuid,p_page_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; page public.growth_pages; receipts jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant));
 IF NOT FOUND OR jsonb_typeof(s.artifact_refs) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p_page_id::text) THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO page FROM public.growth_pages WHERE id=p_page_id AND tenant_id=p_expected_tenant AND status<>'archived';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'occurred_at',r.occurred_at,'capability_key',r.capability_key,'outcome',r.outcome)
  ORDER BY r.occurred_at DESC,r.id DESC),'[]'::jsonb) INTO receipts FROM (
   SELECT e.id,e.occurred_at,e.capability_key,e.outcome FROM public.paige_workspace_events e
   WHERE e.tenant_id=p_expected_tenant AND e.source_kind='capability_run'
    AND e.capability_key IN ('growth_page_publish','growth_page_unpublish')
    AND e.detail @> jsonb_build_object('page_id',page.id,'door','growth-publish-command')
   ORDER BY e.occurred_at DESC,e.id DESC LIMIT 5
  ) r;
 RETURN jsonb_build_object('ok',true,'receipts',receipts);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.studio_publication_receipts(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_publication_receipts(uuid,uuid,uuid) TO authenticated;

-- One bounded optimistic edit through ORIGINAL page/version writers. A stale
-- retry reads only the same already-saved conversion; it cannot replace another
-- person's newer blocks, or create a fresh version to escape uncertainty.
CREATE FUNCTION public.studio_set_page_conversion(p_expected_tenant uuid,p_session_id uuid,p_page_id uuid,p_expected_updated_at timestamptz,p_conversion jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; page public.growth_pages; blocks jsonb; chosen jsonb;
 item record; chosen_index integer; version public.studio_artifact_versions;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 IF jsonb_typeof(p_conversion) IS DISTINCT FROM 'object' OR p_conversion->>'type' IS DISTINCT FROM 'conversion' THEN
  RAISE EXCEPTION 'STUDIO_INVALID_CONVERSION: choose a conversion destination' USING ERRCODE='22023'; END IF;
 PERFORM public._growth_validate_conversion_block(p_conversion);
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant)) FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p_page_id::text) THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO page FROM public.growth_pages WHERE id=p_page_id AND tenant_id=p_expected_tenant AND status<>'archived' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 blocks:=CASE WHEN jsonb_typeof(page.draft_blocks_json)='array' THEN page.draft_blocks_json
  WHEN jsonb_typeof(page.blocks_json)='array' THEN page.blocks_json ELSE '[]'::jsonb END;
 FOR item IN SELECT value,ordinality FROM jsonb_array_elements(blocks) WITH ORDINALITY LOOP
  IF item.value->>'type'='conversion' THEN chosen:=item.value; chosen_index:=item.ordinality-1; EXIT; END IF;
 END LOOP;
 IF chosen=p_conversion THEN
  SELECT * INTO version FROM public.studio_artifact_versions WHERE session_id=s.id AND tenant_id=p_expected_tenant
   AND kind='page' AND lineage_id=page.id AND is_current AND snapshot=to_jsonb(page);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
  RETURN jsonb_build_object('ok',true,'page',to_jsonb(page),'updated_at',page.updated_at,'version_id',version.id,'changed',false);
 END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM page.updated_at THEN
  RAISE EXCEPTION 'STUDIO_PAGE_CHANGED: the page changed; reopen its current version before saving' USING ERRCODE='40001'; END IF;
 IF chosen_index IS NULL THEN blocks:=blocks||jsonb_build_array(p_conversion);
 ELSE blocks:=jsonb_set(blocks,ARRAY[chosen_index::text],p_conversion,false); END IF;
 page:=public.growth_page_upsert(NULL,page.slug,page.title,blocks,page.draft_theme_json,page.draft_seo_json,page.id,NULL);
 version:=public.save_artifact_version(s.id,'page',page.id,NULL);
 IF version.snapshot IS DISTINCT FROM to_jsonb(page) OR version.lineage_id IS DISTINCT FROM page.id OR NOT version.is_current THEN
  RAISE EXCEPTION 'STUDIO_SAVE_UNKNOWN: original version readback unavailable' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('ok',true,'page',to_jsonb(page),'updated_at',page.updated_at,'version_id',version.id,'changed',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN lock_not_available THEN RAISE EXCEPTION 'STUDIO_PAGE_CHANGED: this page is being edited; reopen before saving' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.studio_set_page_conversion(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_set_page_conversion(uuid,uuid,uuid,timestamptz,jsonb) TO authenticated;
COMMIT;
