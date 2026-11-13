-- CLI-created 20261113165306; NEVER published/applied candidate forward-renumbered
-- from NEVER-published32/body094cc227 to reserved35 under Coordinator950a23fa.
-- Re-ground actual earlier30/33/34 frontier before release; no filler/history edit.
-- ONE original Studio project/request and private accepted-turn reference.
-- Explicit authoring reuses original writers. No automatic domain execution or
-- publication, new result store, provider, or direct table grant is introduced.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $baseline$
DECLARE signature text; expected text; expected_replay text; expected_acl text;
 actual_md5 text; actual_source_md5 text; actual_owner text; actual_acl text; prerequisite_detail text;
BEGIN
 -- Four finite source pairs preserve the live compact catalog and original
 -- repository replay without rewriting either original function. Differences
 -- are comments/whitespace only; quoted tokens and all ABI/security metadata match.
 -- Provenance: create/link20260716222837, artifact20260716224310,
 -- thread20260718052352. Retain until a reviewed forward change converges both
 -- original consumers. Never normalize a third source or admit the weaker Hub
 -- CREATEs before original20271126150008 identity currentness.
 FOR signature,expected,expected_replay IN SELECT * FROM (VALUES
  ('public.create_studio_session(text,text,jsonb,boolean,uuid,uuid)','6f0a0cef4d411b4ef75a00a5bb5bec42','f42d5a5d6d47fc4e7bd57e37cb909e85'),
  ('public.studio_role_ok(uuid)','1cf44d6637a20846c7e52fc35ec7b6d3',NULL::text),
  ('public.paige_studio_thread_ensure(uuid)','3535edb88dd02ceec2ec4087bf4371ad','c513ca9d8306637b33a29ce6ea16f221'),
  ('public._team_hub_visible(uuid,uuid,uuid)','944ae4d661b7ea427717b35b6fc86c4d',NULL::text),
  ('public._team_hub_is_active(uuid,uuid)','8a17dba7a1a8fd50bcc5c7457e6caa05',NULL::text),
  ('public._team_hub_participates(uuid,uuid)','c204534d91951e1a6841003f1b9976a7',NULL::text),
  ('public.save_artifact_version(uuid,text,uuid,uuid)','414256973e5858b5ace8f3d38e57d725',NULL::text),
  ('public.create_session_artifact(uuid,text,jsonb,uuid)','ee7d9b1a6201f210e88f08c9b1e4dd87','d05e6d4eb947aa6d2c9c2f0947bca02a'),
  ('public.link_session_artifact(uuid,text,uuid,uuid)','151a9d791c8c7de43e44a78f4834d5f9','83f6ab4e9b8088e101a58462e46d25a8'),
  ('public.growth_page_upsert(uuid,text,text,jsonb,jsonb,jsonb,uuid,jsonb)','b58fbbc9b18a40de26fc85e5937d2298',NULL::text),
  ('public._growth_form_go_live(uuid,uuid)','4183c4f3fc90f0ed58d751482f896620',NULL::text),
  ('public.growth_validate_blocks(jsonb)','264e09051c47a6282950b94c4ddb968c',NULL::text),
  ('public._growth_page_go_live(uuid,uuid)','d83ae6e305890c40ee72a6910dac2cea',NULL::text)
 ) AS p(signature,expected,expected_replay) LOOP
  expected_acl:=CASE WHEN signature LIKE 'public._team_hub_%' OR signature IN ('public._growth_form_go_live(uuid,uuid)','public._growth_page_go_live(uuid,uuid)')
   THEN '{postgres=X/postgres}' ELSE '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' END;
  SELECT md5(pg_get_functiondef(p.oid)),md5(p.prosrc),pg_get_userbyid(p.proowner),p.proacl::text
   INTO actual_md5,actual_source_md5,actual_owner,actual_acl FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
  prerequisite_detail:=format('definition_md5=%s; prosrc_md5=%s; search_path=%s; owner=%s; acl=%s',
   coalesce(actual_md5,'<missing>'),coalesce(actual_source_md5,'<missing>'),
   left(current_setting('search_path'),256),coalesce(actual_owner,'<missing>'),left(coalesce(actual_acl,'<missing>'),512));
  IF to_regprocedure(signature) IS NULL OR (actual_md5 IS DISTINCT FROM expected
   AND (expected_replay IS NULL OR actual_md5 IS DISTINCT FROM expected_replay))
   OR actual_owner IS DISTINCT FROM 'postgres' OR actual_acl IS DISTINCT FROM expected_acl THEN
   RAISE EXCEPTION 'EXP06 original prerequisite changed: %',signature USING ERRCODE='55000',DETAIL=prerequisite_detail;
  END IF;
  IF expected_replay IS NOT NULL THEN
   RAISE NOTICE 'EXP06 original prerequisite accepted: %',signature USING DETAIL=prerequisite_detail;
  END IF;
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
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('target','values','template_id','business_source','business_name')) THEN RETURN false; END IF;
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
 IF v ? 'business_source' THEN
  IF jsonb_typeof(v->'business_source') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v->'business_source'))<>2
   OR NOT(v->'business_source' ?& ARRAY['id','updated_at'])
   OR jsonb_typeof(v#>'{business_source,id}') IS DISTINCT FROM 'string'
   OR (v#>>'{business_source,id}') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   OR jsonb_typeof(v#>'{business_source,updated_at}') IS DISTINCT FROM 'string'
   OR (v#>>'{business_source,updated_at}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:[0-9]{2})?)$'
   OR coalesce(v#>>'{target,kind}','') NOT IN ('client','prospect')
   OR v#>>'{target,reference}' IS DISTINCT FROM v#>>'{business_source,id}' THEN RETURN false; END IF;
 END IF;
 IF v ? 'business_name' AND (NOT(v ? 'business_source') OR jsonb_typeof(v->'business_name') IS DISTINCT FROM 'string'
  OR length(btrim(v->>'business_name')) NOT BETWEEN 1 AND 4000
  OR (v->>'business_name') ~ ('['||chr(1)||'-'||chr(31)||chr(127)||'-'||chr(159)||']')) THEN RETURN false; END IF;
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

-- E03 finite business projection: original clients-admin SELECT class only.
DO $business_source_baseline$
DECLARE name text; expected text;
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clients'::regclass)
  OR md5(pg_get_functiondef('public.has_any_role(uuid,text[])'::regprocedure))<>'5f3084bb454ccf757b6f084d48ea38e9'
  OR md5(pg_get_functiondef('public.map_tenant_role_to_app_role(public.tenant_role)'::regprocedure))<>'73646fcb609b1d0c2fb99e286d224cd4' THEN
  RAISE EXCEPTION 'EXP06 original business visibility helpers changed' USING ERRCODE='55000'; END IF;
 FOR name,expected IN SELECT * FROM (VALUES
  ('clients_admins_full','050f04a23a80f5bb0d59cad80e49b5e4'),
  ('clients_customer_raw_boundary','48a843d2c9b2c295bee65bdd2a07034b'),
  ('tenant_isolation','2ebaf5880c7d5623ca270b91c71956b6')
 ) p(name,expected) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.clients'::regclass AND polname=name
   AND md5(pg_get_expr(polqual,polrelid))=expected AND md5(pg_get_expr(polwithcheck,polrelid))=expected
   AND polcmd='*' AND polroles=ARRAY['authenticated'::regrole]::oid[]
   AND polpermissive=(name='clients_admins_full')) THEN
   RAISE EXCEPTION 'EXP06 original business visibility policy changed: %',name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.clients'::regclass AND NOT polpermissive AND polcmd IN ('*','r'))<>2 THEN
  RAISE EXCEPTION 'EXP06 business restrictive visibility changed' USING ERRCODE='55000'; END IF;
END $business_source_baseline$;

CREATE FUNCTION public.studio_business_targets(p_expected_tenant uuid,p_query text,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); query text:=btrim(coalesce(p_query,'')); businesses jsonb;
BEGIN
 IF actor IS NULL OR p_expected_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM public.current_user_tenant_id()
  OR NOT coalesce(public.studio_role_ok(actor),false)
  OR NOT coalesce(public.has_any_role(actor,ARRAY['admin','super_admin']::text[]),false) THEN
  RETURN jsonb_build_object('ok',false,'code','scope_changed'); END IF;
 IF length(query)>120 OR query ~ '[[:cntrl:]]' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'entity_name',b.entity_name,'updated_at',b.updated_at)
  ORDER BY lower(b.entity_name),b.id),'[]'::jsonb) INTO businesses FROM (
   SELECT c.id,btrim(c.entity_name) AS entity_name,c.updated_at FROM public.clients c
   WHERE c.tenant_id=p_expected_tenant AND c.entity_type='business' AND nullif(btrim(c.entity_name),'') IS NOT NULL
    AND c.status<>'archived' AND c.merged_into_contact_id IS NULL AND c.merged_at IS NULL
    AND (query='' OR position(lower(query) IN lower(c.entity_name))>0)
   ORDER BY lower(btrim(c.entity_name)),c.id LIMIT p_limit
  ) b;
 RETURN jsonb_build_object('ok',true,'businesses',businesses);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
END $$;
REVOKE ALL ON FUNCTION public.studio_business_targets(uuid,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_business_targets(uuid,text,integer) TO authenticated;

-- This is expected identity/version, never confirmed provenance or authority.
-- Legacy read/reopen does not call this new-write validation.
CREATE FUNCTION public._studio_validate_business_source(p_expected_tenant uuid,p_context jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; expected jsonb; business record; version timestamptz;
BEGIN
 IF NOT (p_context ? 'business_source') THEN RETURN; END IF;
 actor:=public._studio_current_scope(p_expected_tenant); expected:=p_context->'business_source';
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','super_admin') FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT coalesce(public.has_any_role(actor,ARRAY['admin','super_admin']::text[]),false) THEN
  RAISE EXCEPTION 'STUDIO_BUSINESS_SOURCE_CHANGED: select an available business again' USING ERRCODE='42501'; END IF;
 BEGIN version:=(expected->>'updated_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'STUDIO_BUSINESS_SOURCE_CHANGED: select an available business again' USING ERRCODE='42501'; END;
 SELECT c.id,btrim(c.entity_name) AS entity_name,c.updated_at INTO business FROM public.clients c
  WHERE c.id=(expected->>'id')::uuid AND c.tenant_id=p_expected_tenant AND c.entity_type='business'
   AND nullif(btrim(c.entity_name),'') IS NOT NULL AND c.status<>'archived'
   AND c.merged_into_contact_id IS NULL AND c.merged_at IS NULL FOR SHARE NOWAIT;
 IF NOT FOUND OR business.updated_at IS DISTINCT FROM version
  OR (p_context->'target' ? 'label' AND p_context#>>'{target,label}' IS DISTINCT FROM business.entity_name)
  OR (p_context ? 'business_name' AND p_context->>'business_name' IS DISTINCT FROM business.entity_name)
  OR NOT coalesce(public.has_any_role(actor,ARRAY['admin','super_admin']::text[]),false) THEN
  RAISE EXCEPTION 'STUDIO_BUSINESS_SOURCE_CHANGED: select an available business again' USING ERRCODE='42501'; END IF;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'STUDIO_BUSINESS_SOURCE_CHANGED: business identity is changing' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public._studio_validate_business_source(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
  BEGIN PERFORM public._studio_validate_business_source(p_expected_tenant,p_project_context);
  EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed'); END;
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
 BEGIN PERFORM public._studio_validate_business_source(p_expected_tenant,p_project_context);
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed'); END;
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

-- Lost stage/assistant acknowledgments recover from the ORIGINAL loaded user
-- sources. This exposes pointers only; no bundle, assistant, status or receipt
-- is manufactured, and no project is created from history discovery.
CREATE FUNCTION public.chat_studio_sources(p_expected_tenant uuid,p_thread_id uuid,p_source_turn_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; source_ids jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 IF p_source_turn_ids IS NULL OR cardinality(p_source_turn_ids)>50 OR coalesce(array_ndims(p_source_turn_ids),1)>1 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF array_position(p_source_turn_ids,NULL) IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 PERFORM 1 FROM public.paige_chat_threads WHERE id=p_thread_id AND caller_user_id=actor AND tenant_id=p_expected_tenant
  AND audience='workspace' AND NOT is_archived FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT coalesce(jsonb_agg(s.id ORDER BY array_position(p_source_turn_ids,s.id)),'[]'::jsonb) INTO source_ids
 FROM public.paige_chat_turns s WHERE s.id=ANY(p_source_turn_ids) AND s.thread_id=p_thread_id AND s.role='user'
  AND s.interactive_actor_id=actor AND s.interactive_tenant_id=p_expected_tenant AND s.interactive_intent_id IS NOT NULL
  AND s.studio_brief IS NOT NULL AND public._chat_studio_binding_valid(s.interactive_runtime_binding,s.id,s.interactive_intent_id);
 RETURN jsonb_build_object('ok',true,'source_turn_ids',source_ids);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.chat_studio_sources(uuid,uuid,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chat_studio_sources(uuid,uuid,uuid[]) TO authenticated;

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

-- The inverse of the original page cascade must use the same canonical form
-- identity. Serialize on the ORIGINAL form before checking live dependencies.
DO $form_takedown$
DECLARE target oid; signature text; expected text; expected_acl text; metadata jsonb; body text; amended text;
BEGIN
 FOR signature,expected,expected_acl IN SELECT * FROM (VALUES
  ('public.growth_form_unpublish(uuid,uuid,uuid)','f3224f45f8ee96962de54702fc8f9ab1','{postgres=X/postgres,service_role=X/postgres}'),
  ('public._growth_admin_tenant(uuid)','6afa5f1c7fb298dc77d748abe6c70ce2','{postgres=X/postgres}'),
  ('public._studio_publish_actor(uuid,uuid)','10b5277c8cdb0a38fde88e5856f43ca4','{postgres=X/postgres}')
 ) AS p(signature,expected,expected_acl) LOOP
  IF to_regprocedure(signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(signature))) IS DISTINCT FROM expected
   OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM 'postgres'
   OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM expected_acl THEN
   RAISE EXCEPTION 'EXP06 original form takedown prerequisite changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 target:=to_regprocedure('public.growth_form_unpublish(uuid,uuid,uuid)');
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE oid=target;
 body:=pg_get_functiondef(target);
 amended:=replace(body,
  'SELECT * INTO _row FROM public.growth_forms WHERE id = p_id AND tenant_id = _tenant;',
  'SELECT * INTO _row FROM public.growth_forms WHERE id = p_id AND tenant_id = _tenant FOR UPDATE;');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 form takedown lock hunk missing' USING ERRCODE='55000'; END IF;
 body:=amended;
 amended:=replace(body,'  IF _row.status <> ''active'' THEN',
  E'  -- Waiting for the form may outlive the previously verified authority.\n  IF public._growth_admin_tenant(p_tenant_id) IS DISTINCT FROM _tenant THEN\n    RAISE EXCEPTION ''GROWTH_FORBIDDEN: workspace authority changed'' USING ERRCODE = ''42501'';\n  END IF;\n  _actor := public._studio_publish_actor(_tenant, p_actor_id);\n  IF _row.status <> ''active'' THEN');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 form takedown authority hunk missing' USING ERRCODE='55000'; END IF;
 body:=amended;
 amended:=replace(body,
  '     AND b->>''type'' = ''embedded_form'' AND btrim(b->>''form_slug'') = _row.slug LIMIT 1;',
  E'     AND ((b->>''type'' = ''embedded_form'' AND btrim(b->>''form_slug'') = _row.slug)\n       OR (b->>''type'' = ''conversion'' AND b#>>''{destination,kind}'' = ''native_form''\n         AND b#>>''{destination,formId}'' = _row.id::text)) LIMIT 1;');
 IF amended=body THEN RAISE EXCEPTION 'EXP06 form takedown dependency hunk missing' USING ERRCODE='55000'; END IF;
 EXECUTE amended;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata THEN
  RAISE EXCEPTION 'EXP06 original form takedown metadata changed' USING ERRCODE='55000'; END IF;
END $form_takedown$;


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
 -- Match studio_page_conversion's primary-choice projection: the first
 -- canonical conversion wins; otherwise replace the first original form.
 -- Other form blocks remain independent, exactly where the owner put them.
 IF chosen_index IS NULL THEN
  FOR item IN SELECT value,ordinality FROM jsonb_array_elements(blocks) WITH ORDINALITY LOOP
   IF item.value->>'type'='embedded_form' THEN chosen:=item.value; chosen_index:=item.ordinality-1; EXIT; END IF;
  END LOOP;
 END IF;
 IF chosen=p_conversion THEN
  SELECT * INTO version FROM public.studio_artifact_versions WHERE session_id=s.id AND tenant_id=p_expected_tenant
   AND kind='page' AND lineage_id=page.id AND is_current AND snapshot=to_jsonb(page);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
  RETURN jsonb_build_object('ok',true,'page',to_jsonb(page),'updated_at',page.updated_at,'version_id',version.id,'changed',false);
 END IF;
 PERFORM public._studio_validate_business_source(p_expected_tenant,coalesce(s.studio_session_scratchpad->'project_context','{}'::jsonb));
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

-- A Studio generation carries this native source outside model-facing results.
-- It is a snapshot of the ORIGINAL project, not a new admission or save token.
CREATE FUNCTION public._studio_primary_conversion(p_blocks jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE chosen jsonb;
BEGIN
 SELECT value INTO chosen FROM jsonb_array_elements(p_blocks) WITH ORDINALITY
  WHERE value->>'type'='conversion' ORDER BY ordinality LIMIT 1;
 IF chosen IS NOT NULL THEN PERFORM public._growth_validate_conversion_block(chosen); RETURN chosen; END IF;
 SELECT value INTO chosen FROM jsonb_array_elements(p_blocks) WITH ORDINALITY
  WHERE value->>'type'='embedded_form' ORDER BY ordinality LIMIT 1;
 IF chosen IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(chosen->'form_slug') IS DISTINCT FROM 'string' OR nullif(btrim(chosen->>'form_slug'),'') IS NULL THEN
  RAISE EXCEPTION 'STUDIO_INVALID_CONVERSION: original form unavailable' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('type','embedded_form','form_slug',chosen->'form_slug')
  ||CASE WHEN jsonb_typeof(chosen->'title')='string' THEN jsonb_build_object('title',chosen->'title') ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public._studio_primary_conversion(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.studio_page_save_source(p_expected_tenant uuid,p_session_id uuid,p_page_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; page public.growth_pages; context jsonb; blocks jsonb; chosen jsonb;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant)) FOR SHARE NOWAIT;
 IF NOT FOUND OR jsonb_typeof(s.artifact_refs) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 context:=coalesce(s.studio_session_scratchpad->'project_context','{}'::jsonb);
 IF NOT public._studio_project_context_valid(context) OR NOT(context ? 'target') THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 PERFORM public._studio_validate_business_source(p_expected_tenant,context);
 IF p_page_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p_page_id::text) THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  SELECT * INTO page FROM public.growth_pages WHERE id=p_page_id AND tenant_id=p_expected_tenant AND status<>'archived' FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  blocks:=CASE WHEN jsonb_typeof(page.draft_blocks_json)='array' THEN page.draft_blocks_json
   WHEN jsonb_typeof(page.blocks_json)='array' THEN page.blocks_json ELSE '[]'::jsonb END;
  chosen:=public._studio_primary_conversion(blocks);
 END IF;
 RETURN jsonb_build_object('ok',true,'tenant_id',p_expected_tenant,'session_id',s.id,'artifact_refs',s.artifact_refs,
  'project_context',context,'page_id',page.id,'updated_at',page.updated_at,'conversion',chosen);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','changed');
 WHEN invalid_parameter_value THEN RETURN jsonb_build_object('ok',false,'code','invalid');
END $$;
REVOKE ALL ON FUNCTION public.studio_page_save_source(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_page_save_source(uuid,uuid,uuid) TO authenticated;

-- Reconciliation permits exactly the original appended page/form references
-- produced by this save. An unrelated manifest edit makes the result unknown.
CREATE FUNCTION public._studio_save_manifest_matches(p_actual jsonb,p_expected jsonb,p_page uuid,p_forms jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE prior_count integer; expected_page boolean; item record; page_count integer:=0;
BEGIN
 IF jsonb_typeof(p_actual) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 prior_count:=jsonb_array_length(p_expected);
 IF jsonb_array_length(p_actual)<prior_count THEN RETURN false; END IF;
 FOR item IN SELECT value,ordinality FROM jsonb_array_elements(p_expected) WITH ORDINALITY LOOP
  IF p_actual->(item.ordinality::integer-1) IS DISTINCT FROM item.value THEN RETURN false; END IF;
 END LOOP;
 expected_page:=EXISTS(SELECT 1 FROM jsonb_array_elements(p_expected) r WHERE r->>'kind'='page' AND r->>'id'=p_page::text);
 FOR item IN SELECT value FROM jsonb_array_elements(p_actual) WITH ORDINALITY WHERE ordinality>prior_count LOOP
  IF item.value->>'kind'='page' AND item.value->>'id'=p_page::text AND NOT expected_page THEN page_count:=page_count+1;
  ELSIF item.value->>'kind'='form' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_forms) f WHERE f->>'id'=item.value->>'id')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_expected) r WHERE r->>'kind'='form' AND r->>'id'=item.value->>'id') THEN NULL;
  ELSE RETURN false; END IF;
 END LOOP;
 RETURN page_count=CASE WHEN expected_page THEN 0 ELSE 1 END;
END $$;
REVOKE ALL ON FUNCTION public._studio_save_manifest_matches(jsonb,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._studio_page_saved_result(p_session uuid,p_page public.growth_pages)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version public.studio_artifact_versions; forms jsonb; form record; refs jsonb;
BEGIN
 SELECT * INTO version FROM public.studio_artifact_versions WHERE session_id=p_session AND tenant_id=p_page.tenant_id
  AND kind='page' AND lineage_id=p_page.id AND is_current AND snapshot=to_jsonb(p_page);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 SELECT artifact_refs INTO refs FROM public.studio_sessions WHERE id=p_session AND tenant_id=p_page.tenant_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'slug',f.slug) ORDER BY f.slug,f.id),'[]'::jsonb) INTO forms
  FROM public.growth_forms f WHERE f.tenant_id=p_page.tenant_id AND f.slug IN (
   SELECT btrim(value->>'form_slug') FROM jsonb_array_elements(p_page.draft_blocks_json) WHERE value->>'type'='embedded_form');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_page.draft_blocks_json) b WHERE b->>'type'='embedded_form'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(forms) f WHERE f->>'slug'=btrim(b->>'form_slug'))) THEN
  RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 FOR form IN SELECT f.* FROM public.growth_forms f WHERE f.tenant_id=p_page.tenant_id AND f.id::text IN
  (SELECT value->>'id' FROM jsonb_array_elements(forms)) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(refs) r WHERE r->>'kind'='form' AND r->>'id'=form.id::text)
   OR NOT EXISTS(SELECT 1 FROM public.studio_artifact_versions v WHERE v.session_id=p_session AND v.tenant_id=p_page.tenant_id
    AND v.kind='form' AND v.lineage_id=form.id AND v.is_current AND v.snapshot=to_jsonb(form)) THEN
   RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'page',to_jsonb(p_page),'version_id',version.id,'forms',forms,'changed',false,'reconciled',true);
END $$;
REVOKE ALL ON FUNCTION public._studio_page_saved_result(uuid,public.growth_pages) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.studio_page_save_state(
 p_expected_tenant uuid,p_session_id uuid,p_expected_artifact_refs jsonb,p_expected_project_context jsonb,
 p_page_id uuid,p_expected_updated_at timestamptz,p_expected_conversion jsonb,
 p_slug text,p_title text,p_blocks_json jsonb,p_theme_json jsonb,p_seo_json jsonb,p_form_schema_json jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; page public.growth_pages; context jsonb; response jsonb; candidates integer;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 IF jsonb_typeof(p_expected_artifact_refs) IS DISTINCT FROM 'array'
  OR NOT public._studio_project_context_valid(p_expected_project_context) OR NOT(p_expected_project_context ? 'target')
  OR jsonb_typeof(p_blocks_json) IS DISTINCT FROM 'array' OR nullif(btrim(p_slug),'') IS NULL
  OR (p_page_id IS NULL AND (p_expected_updated_at IS NOT NULL OR p_expected_conversion IS NOT NULL))
  OR (p_page_id IS NOT NULL AND p_expected_updated_at IS NULL) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 PERFORM public.growth_validate_blocks(p_blocks_json);
 IF p_form_schema_json IS NOT NULL THEN PERFORM public.growth_validate_form_schema(p_form_schema_json); END IF;
 IF public._studio_primary_conversion(p_blocks_json) IS DISTINCT FROM p_expected_conversion THEN RETURN jsonb_build_object('ok',false,'code','changed'); END IF;
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant)) FOR SHARE NOWAIT;
 IF NOT FOUND OR jsonb_typeof(s.artifact_refs) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 context:=coalesce(s.studio_session_scratchpad->'project_context','{}'::jsonb);
 IF context IS DISTINCT FROM p_expected_project_context THEN RETURN jsonb_build_object('ok',false,'code','changed'); END IF;
 IF p_page_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_expected_artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p_page_id::text)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p_page_id::text) THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  SELECT * INTO page FROM public.growth_pages WHERE id=p_page_id AND tenant_id=p_expected_tenant AND status<>'archived' FOR SHARE NOWAIT;
 ELSE
  SELECT count(*) INTO candidates FROM public.growth_pages p WHERE p.tenant_id=p_expected_tenant AND p.slug=btrim(p_slug) AND p.status<>'archived'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) WITH ORDINALITY r(value,n)
    WHERE n>jsonb_array_length(p_expected_artifact_refs) AND value->>'kind'='page' AND value->>'id'=p.id::text);
  IF candidates<>1 THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
  SELECT p.* INTO page FROM public.growth_pages p WHERE p.tenant_id=p_expected_tenant AND p.slug=btrim(p_slug) AND p.status<>'archived'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) WITH ORDINALITY r(value,n)
    WHERE n>jsonb_array_length(p_expected_artifact_refs) AND value->>'kind'='page' AND value->>'id'=p.id::text) FOR SHARE NOWAIT;
 END IF;
 IF page.id IS NULL OR page.slug IS DISTINCT FROM btrim(p_slug)
  OR page.title IS DISTINCT FROM coalesce(nullif(btrim(p_title),''),page.title)
  OR page.draft_blocks_json IS DISTINCT FROM p_blocks_json
  OR (p_theme_json IS NOT NULL AND page.draft_theme_json IS DISTINCT FROM p_theme_json)
  OR (p_seo_json IS NOT NULL AND page.draft_seo_json IS DISTINCT FROM p_seo_json) THEN
  RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 response:=public._studio_page_saved_result(s.id,page);
 IF response->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN response; END IF;
 IF NOT public._studio_save_manifest_matches(s.artifact_refs,p_expected_artifact_refs,page.id,response->'forms') THEN
  RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 RETURN response;
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','changed');
 WHEN invalid_parameter_value THEN RETURN jsonb_build_object('ok',false,'code','invalid');
END $$;
REVOKE ALL ON FUNCTION public.studio_page_save_state(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_page_save_state(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- Atomic ORIGINAL page/create/link/version composition. No standalone writer,
-- receipt, recovery ledger or guessed UUID insertion is introduced.
CREATE FUNCTION public.studio_save_page(
 p_expected_tenant uuid,p_session_id uuid,p_expected_artifact_refs jsonb,p_expected_project_context jsonb,
 p_page_id uuid,p_expected_updated_at timestamptz,p_expected_conversion jsonb,
 p_slug text,p_title text,p_blocks_json jsonb,p_theme_json jsonb,p_seo_json jsonb,p_form_schema_json jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; s public.studio_sessions; created public.studio_sessions; page public.growth_pages; version public.studio_artifact_versions;
 context jsonb; blocks jsonb; response jsonb; form record; new_id uuid;
BEGIN
 actor:=public._studio_current_scope(p_expected_tenant);
 SELECT * INTO s FROM public.studio_sessions WHERE id=p_session_id AND tenant_id=p_expected_tenant AND status<>'archived'
  AND (owner_user_id=actor OR public.is_tenant_admin(p_expected_tenant)) FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 response:=public.studio_page_save_state(p_expected_tenant,p_session_id,p_expected_artifact_refs,p_expected_project_context,
  p_page_id,p_expected_updated_at,p_expected_conversion,p_slug,p_title,p_blocks_json,p_theme_json,p_seo_json,p_form_schema_json);
 IF response->'ok'='true'::jsonb OR response->>'code' IN ('invalid','scope_changed','not_allowed','changed') THEN RETURN response; END IF;
 context:=coalesce(s.studio_session_scratchpad->'project_context','{}'::jsonb);
 IF s.artifact_refs IS DISTINCT FROM p_expected_artifact_refs OR context IS DISTINCT FROM p_expected_project_context THEN
  RAISE EXCEPTION 'STUDIO_PAGE_CHANGED: original project source changed' USING ERRCODE='40001'; END IF;
 PERFORM public._studio_validate_business_source(p_expected_tenant,context);
 IF p_page_id IS NOT NULL THEN
  SELECT * INTO page FROM public.growth_pages WHERE id=p_page_id AND tenant_id=p_expected_tenant AND status<>'archived' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  blocks:=CASE WHEN jsonb_typeof(page.draft_blocks_json)='array' THEN page.draft_blocks_json
   WHEN jsonb_typeof(page.blocks_json)='array' THEN page.blocks_json ELSE '[]'::jsonb END;
  IF page.updated_at IS DISTINCT FROM p_expected_updated_at OR page.slug IS DISTINCT FROM btrim(p_slug)
   OR public._studio_primary_conversion(blocks) IS DISTINCT FROM p_expected_conversion THEN
   RAISE EXCEPTION 'STUDIO_PAGE_CHANGED: reopen the current original page before saving' USING ERRCODE='40001'; END IF;
 ELSE
  -- Original creator allocates the real ID and appends its original manifest.
  -- Upsert by that actual ID cannot enter the slug-conflict overwrite branch.
  created:=public.create_session_artifact(s.id,'page',jsonb_build_object('title',p_title),NULL);
  SELECT p.id INTO new_id FROM public.growth_pages p
   WHERE p.tenant_id=p_expected_tenant AND EXISTS(SELECT 1 FROM jsonb_array_elements(created.artifact_refs) r
    WHERE r->>'kind'='page' AND r->>'id'=p.id::text)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.artifact_refs) r WHERE r->>'kind'='page' AND r->>'id'=p.id::text);
  IF new_id IS NULL THEN RAISE EXCEPTION 'STUDIO_SAVE_UNKNOWN: original creation readback unavailable' USING ERRCODE='40001'; END IF;
  SELECT * INTO page FROM public.growth_pages WHERE id=new_id AND tenant_id=p_expected_tenant FOR UPDATE;
 END IF;
 page:=public.growth_page_upsert(NULL,btrim(p_slug),p_title,p_blocks_json,p_theme_json,p_seo_json,page.id,p_form_schema_json);
 IF new_id IS NOT NULL THEN
  UPDATE public.studio_sessions SET artifact_refs=(SELECT jsonb_agg(
   CASE WHEN r->>'kind'='page' AND r->>'id'=page.id::text THEN r||jsonb_build_object('title',page.title,'slug',page.slug) ELSE r END ORDER BY n)
   FROM jsonb_array_elements(artifact_refs) WITH ORDINALITY r(r,n)) WHERE id=s.id AND tenant_id=p_expected_tenant;
 END IF;
 FOR form IN SELECT f.id FROM public.growth_forms f WHERE f.tenant_id=p_expected_tenant AND f.slug IN (
  SELECT btrim(value->>'form_slug') FROM jsonb_array_elements(p_blocks_json) WHERE value->>'type'='embedded_form') ORDER BY f.id LOOP
  PERFORM 1 FROM public.growth_forms WHERE id=form.id AND tenant_id=p_expected_tenant FOR SHARE NOWAIT;
  PERFORM public.link_session_artifact(s.id,'form',form.id,NULL);
  PERFORM public.save_artifact_version(s.id,'form',form.id,NULL);
 END LOOP;
 PERFORM public.link_session_artifact(s.id,'page',page.id,NULL);
 version:=public.save_artifact_version(s.id,'page',page.id,NULL);
 response:=public._studio_page_saved_result(s.id,page);
 IF response->'ok' IS DISTINCT FROM 'true'::jsonb OR response->>'version_id' IS DISTINCT FROM version.id::text THEN
  RAISE EXCEPTION 'STUDIO_SAVE_UNKNOWN: original version readback unavailable' USING ERRCODE='40001'; END IF;
 RETURN response||jsonb_build_object('changed',true,'reconciled',false);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','scope_changed');
 WHEN lock_not_available OR unique_violation THEN
  RAISE EXCEPTION 'STUDIO_PAGE_CHANGED: original page or address changed; inspect the same source before saving' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.studio_save_page(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.studio_save_page(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- E01 source ACK9f5c7689 permits this original-row field, not schema/release
-- clearance. Original service INSERT and claim CAS stay canonical. PG17's exact
-- ACL includes built-in MAINTAIN; the isolated PG16 port has the same grants
-- without that version-specific privilege. No legacy rows are rewritten.
DO $source_preflight$
DECLARE columns_now text[];
BEGIN
 SELECT array_agg(attname::text ORDER BY attnum) INTO columns_now
 FROM pg_attribute WHERE attrelid='public.paige_pending_confirmations'::regclass
  AND attnum>0 AND NOT attisdropped;
 IF columns_now IS DISTINCT FROM ARRAY['id','user_id','tenant_id','thread_id','scoped_client_id','tool_name','fingerprint','args','summary','created_at','expires_at','consumed_at','issued_in_request','server_issued_at','claimed_in_request']
  OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.paige_pending_confirmations'::regclass) IS DISTINCT FROM 'postgres'
  OR (SELECT relacl::text FROM pg_class WHERE oid='public.paige_pending_confirmations'::regclass)
   IS DISTINCT FROM (CASE WHEN current_setting('server_version_num')::integer>=170000
    THEN '{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}'
    ELSE '{postgres=arwdDxt/postgres,authenticated=r/postgres,service_role=arwdDxt/postgres}' END)
  OR NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.paige_pending_confirmations'::regclass)
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.paige_pending_confirmations'::regclass AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL)
  OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.paige_pending_confirmations'::regclass)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.paige_pending_confirmations'::regclass
   AND polname='paige_pending_confirmations_own' AND polcmd='*' AND NOT polpermissive
   AND polroles=ARRAY['authenticated'::regrole]::oid[]
   AND pg_get_expr(polqual,polrelid)='(user_id = auth.uid())' AND pg_get_expr(polwithcheck,polrelid)='(user_id = auth.uid())')
  OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.paige_pending_confirmations'::regclass
   AND polname='paige_pending_confirmations_read' AND polcmd='r' AND polpermissive
   AND polroles=ARRAY['authenticated'::regrole]::oid[] AND polwithcheck IS NULL
   AND pg_get_expr(polqual,polrelid)='(user_id = auth.uid())')
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.paige_pending_confirmations'::regclass AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Original confirmation source protection changed; re-ground before applying' USING ERRCODE='55000';
 END IF;
END $source_preflight$;

-- No DEFAULT, backfill, row rewrite, new queue, receipt or authority.
ALTER TABLE public.paige_pending_confirmations ADD COLUMN studio_page_save_source jsonb;
ALTER TABLE public.paige_pending_confirmations ADD CONSTRAINT paige_confirmation_studio_source_kind
 CHECK(studio_page_save_source IS NULL OR
  (tool_name='growth_page_save' AND jsonb_typeof(studio_page_save_source)='object'));

-- A table-wide SELECT would expose the new column despite column revokes.
-- Preserve access to EXACTLY all fifteen incumbent columns, under unchanged RLS.
REVOKE SELECT ON TABLE public.paige_pending_confirmations FROM authenticated;
GRANT SELECT (
 id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,fingerprint,args,
 summary,created_at,expires_at,consumed_at,issued_in_request,server_issued_at,claimed_in_request
) ON TABLE public.paige_pending_confirmations TO authenticated;

-- New invoker guard: there is no incumbent confirmation table trigger to extend.
-- INSERT is already service/postgres-only. Source must be present atomically in
-- the original INSERT; NULL->source via UPDATE is refused too.
CREATE FUNCTION public._paige_confirmation_studio_source_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.studio_page_save_source IS DISTINCT FROM OLD.studio_page_save_source THEN
  RAISE EXCEPTION 'STUDIO_CONFIRMATION_SOURCE_CHANGED: original proposal source is immutable' USING ERRCODE='40001';
 END IF;
 IF OLD.studio_page_save_source IS NOT NULL AND (
  NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
  OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
  OR NEW.scoped_client_id IS DISTINCT FROM OLD.scoped_client_id OR NEW.tool_name IS DISTINCT FROM OLD.tool_name
  OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.args IS DISTINCT FROM OLD.args
  OR NEW.issued_in_request IS DISTINCT FROM OLD.issued_in_request OR NEW.server_issued_at IS DISTINCT FROM OLD.server_issued_at
 ) THEN
  RAISE EXCEPTION 'STUDIO_CONFIRMATION_BINDING_CHANGED: original proposal binding is immutable' USING ERRCODE='40001';
 END IF;
 -- consumed_at, claimed_in_request, expires_at and unrelated legacy-row updates
 -- retain their original behavior. This guard neither claims nor authorizes.
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_confirmation_studio_source_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER paige_confirmation_studio_source_immutable BEFORE UPDATE
 ON public.paige_pending_confirmations FOR EACH ROW
 EXECUTE FUNCTION public._paige_confirmation_studio_source_immutable();

DO $source_postflight$
DECLARE column_name text;
BEGIN
 FOREACH column_name IN ARRAY ARRAY['id','user_id','tenant_id','thread_id','scoped_client_id','tool_name','fingerprint','args','summary','created_at','expires_at','consumed_at','issued_in_request','server_issued_at','claimed_in_request'] LOOP
  IF NOT has_column_privilege('authenticated','public.paige_pending_confirmations',column_name,'SELECT') THEN
   RAISE EXCEPTION 'Original confirmation column read compatibility changed' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF has_column_privilege('authenticated','public.paige_pending_confirmations','studio_page_save_source','SELECT')
  OR has_column_privilege('anon','public.paige_pending_confirmations','studio_page_save_source','SELECT')
  OR has_table_privilege('authenticated','public.paige_pending_confirmations','INSERT')
  OR has_table_privilege('authenticated','public.paige_pending_confirmations','UPDATE')
  OR has_table_privilege('authenticated','public.paige_pending_confirmations','DELETE')
  OR NOT has_table_privilege('service_role','public.paige_pending_confirmations','SELECT')
  OR NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.paige_pending_confirmations'::regclass) THEN
  RAISE EXCEPTION 'Private Studio confirmation source boundary unavailable' USING ERRCODE='55000'; END IF;
END $source_postflight$;

-- E03 original intake writer extended once; old five/six argument ABIs remain.
DO $intake_tags_baseline$
DECLARE signature text; expected text;
BEGIN
 FOR signature,expected IN SELECT * FROM (VALUES
  ('public.growth_form_set_intake(uuid,boolean,uuid,uuid,text)','e963cbff6abd16df5ced5b14e5ffd856'),
  ('public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean)','aa25ff5facd65702a6d10356a619091a')
 ) p(signature,expected) LOOP
  IF md5(pg_get_functiondef(to_regprocedure(signature))) IS DISTINCT FROM expected
   OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM 'postgres'
   OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
   RAISE EXCEPTION 'EXP06 original intake source changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 IF md5(pg_get_functiondef('public.upsert_contact(jsonb,uuid,uuid,uuid,text)'::regprocedure))<>'0d05ed2429366f1215c3d7363ee56b4b'
  OR md5(pg_get_functiondef('public.growth_publish_state_guard()'::regprocedure))<>'bedfb266401e59224813f45ea5a6dfa7'
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.growth_forms'::regclass AND tgenabled='O'
   AND tgfoid='public.growth_publish_state_guard()'::regprocedure AND NOT tgisinternal AND (tgtype&4)=4 AND (tgtype&16)=16) THEN
  RAISE EXCEPTION 'EXP06 original contact writer/form browser-write guard changed' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.growth_forms'::regclass AND attname='future_tags' AND NOT attisdropped)
  OR to_regprocedure('public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[])') IS NOT NULL THEN
  RAISE EXCEPTION 'EXP06 future intake tags already installed; reconcile forward source' USING ERRCODE='55000'; END IF;
END $intake_tags_baseline$;
ALTER TABLE public.growth_forms ADD COLUMN future_tags text[] NOT NULL DEFAULT '{}'::text[];

-- Data validation only. The ORIGINAL all-column publish-state guard already
-- denies direct authenticated/anon form writes; no duplicate permission guard.
CREATE FUNCTION public._growth_forms_validate_future_tags()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tag text; seen text[]:='{}';
BEGIN
 IF NEW.future_tags IS NULL OR cardinality(NEW.future_tags)>50 OR coalesce(array_ndims(NEW.future_tags),1)>1 THEN
  RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: future tags must be at most fifty unique names' USING ERRCODE='22023'; END IF;
 FOREACH tag IN ARRAY NEW.future_tags LOOP
  IF tag IS NULL OR tag<>btrim(tag) OR length(tag) NOT BETWEEN 1 AND 80 OR tag=ANY(seen)
   OR tag ~ ('['||chr(1)||'-'||chr(31)||chr(127)||'-'||chr(159)||']') THEN
   RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: future tags need unique nonempty names of at most eighty characters' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,tag);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._growth_forms_validate_future_tags() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_growth_forms_future_tags_validate BEFORE INSERT OR UPDATE OF future_tags ON public.growth_forms
 FOR EACH ROW EXECUTE FUNCTION public._growth_forms_validate_future_tags();

DO $intake_tags_writer$
DECLARE target oid:='public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean)'::regprocedure;
 original text; body text; next text; metadata jsonb;
BEGIN
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE oid=target;
 original:=pg_get_functiondef(target); body:=original;
 next:=replace(body,'p_notify_email text, _lead_reply_enabled boolean)',
  'p_notify_email text, _lead_reply_enabled boolean, p_future_tags text[])');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake ABI hunk missing' USING ERRCODE='55000'; END IF; body:=next;
 next:=replace(body,'  _row    public.growth_forms;',E'  _row    public.growth_forms;\n  _future text[];');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake declaration hunk missing' USING ERRCODE='55000'; END IF; body:=next;
 next:=replace(body,'SELECT * INTO _form FROM public.growth_forms WHERE id = p_form_id;',
  'SELECT * INTO _form FROM public.growth_forms WHERE id = p_form_id FOR UPDATE;');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake owning row lock hunk missing' USING ERRCODE='55000'; END IF; body:=next;
 next:=replace(body,'  IF COALESCE(p_auto_create_deal, false) THEN',
  E'  IF p_future_tags IS NOT NULL THEN\n    IF coalesce(array_ndims(p_future_tags),1)>1 THEN\n      RAISE EXCEPTION ''GROWTH_INVALID_INTAKE: future tags must be one list'' USING ERRCODE=''22023'';\n    END IF;\n    _future:=ARRAY(SELECT value FROM (SELECT btrim(value) AS value,min(n) AS first_seen FROM unnest(p_future_tags) WITH ORDINALITY t(value,n) GROUP BY btrim(value)) tags ORDER BY first_seen);\n  END IF;\n\n  IF COALESCE(p_auto_create_deal, false) THEN');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake future tags hunk missing' USING ERRCODE='55000'; END IF; body:=next;
 next:=replace(body,'    lead_reply_enabled  = COALESCE(_lead_reply_enabled, lead_reply_enabled)',
  E'    lead_reply_enabled  = COALESCE(_lead_reply_enabled, lead_reply_enabled),\n    future_tags         = COALESCE(_future, future_tags)');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake form field hunk missing' USING ERRCODE='55000'; END IF; body:=next;
 next:=replace(body,'  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)',
  E'  UPDATE public.growth_form_automations SET\n    config_json=coalesce(config_json,''{}''::jsonb)||jsonb_build_object(''future_tags'',to_jsonb(_row.future_tags)),\n    updated_at=now()\n  WHERE form_id=_form.id AND tenant_id=_form.tenant_id AND target_slug=''contact_upsert'';\n\n  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake config hunk missing' USING ERRCODE='55000'; END IF; body:=next;
 next:=replace(body,'''lead_reply_enabled'', _row.lead_reply_enabled));',
  '''lead_reply_enabled'', _row.lead_reply_enabled, ''future_tags_count'', cardinality(_row.future_tags), ''future_tags_changed'', p_future_tags IS NOT NULL));');
 IF next=body THEN RAISE EXCEPTION 'EXP06 intake audit hunk missing' USING ERRCODE='55000'; END IF;
 EXECUTE next;
 -- One actual implementation. Six-argument omission delegates without changing
 -- tags; five-argument wrapper remains BYTE-EXACT and still delegates to six.
 body:=regexp_replace(original,'AS \$function\$[\s\S]*\$function\$',
  E'AS $function$\nBEGIN\n  RETURN public.growth_form_set_intake(p_form_id,p_auto_create_deal,p_pipeline_id,p_stage_id,p_notify_email,_lead_reply_enabled,NULL::text[]);\nEND;\n$function$');
 IF body=original THEN RAISE EXCEPTION 'EXP06 six-argument wrapper hunk missing' USING ERRCODE='55000'; END IF;
 EXECUTE body;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
  OR md5(pg_get_functiondef('public.growth_form_set_intake(uuid,boolean,uuid,uuid,text)'::regprocedure))<>'e963cbff6abd16df5ced5b14e5ffd856'
  OR md5(pg_get_functiondef('public.upsert_contact(jsonb,uuid,uuid,uuid,text)'::regprocedure))<>'0d05ed2429366f1215c3d7363ee56b4b' THEN
  RAISE EXCEPTION 'EXP06 intake compatibility/contact writer changed' USING ERRCODE='55000'; END IF;
END $intake_tags_writer$;
REVOKE ALL ON FUNCTION public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[]) TO authenticated;

-- E03: causal result on the ORIGINAL submission, never a second dispatch store.
DO $contact_tags_baseline$
DECLARE signature text; expected text; trigger_name text; incumbent text[]:=ARRAY[
 'id','form_id','tenant_id','contact_id','deal_id','source','external_source_id','payload_json','utm_json','referrer','ip','user_agent',
 'consent_json','funnel_session_id','processed','processed_at','created_at','processing_state','attempts','claimed_at','last_error',
 'alert_sent_at','alert_skipped_reason','visit_id','campaign_brief_id','campaign_attribution','lead_reply_skipped_reason'];
BEGIN
 IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.growth_form_submissions'::regclass
   AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM incumbent
  OR (SELECT NOT relrowsecurity OR relforcerowsecurity OR relacl::text IS DISTINCT FROM
   CASE WHEN current_setting('server_version_num')::int>=170000
    THEN '{postgres=arwdDxtm/postgres,authenticated=rwdDxtm/postgres,service_role=arwdDxtm/postgres}'
    ELSE '{postgres=arwdDxt/postgres,authenticated=rwdDxt/postgres,service_role=arwdDxt/postgres}' END
   FROM pg_class WHERE oid='public.growth_form_submissions'::regclass)
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.growth_form_submissions'::regclass AND attnum>0 AND attacl IS NOT NULL)
  OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.growth_form_submissions'::regclass)<>2
  OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.growth_form_submissions'::regclass AND polpermissive
   AND polroles=ARRAY['authenticated'::regrole]::oid[] AND polwithcheck IS NULL
   AND md5(pg_get_expr(polqual,polrelid))='379f5c4eb185f78fd5385a8553643a5e'
   AND ((polname='growth_form_submissions_tenant_read' AND polcmd='r')
     OR (polname='growth_form_submissions_tenant_update' AND polcmd='w')))<>2
  OR md5(pg_get_functiondef('public.growth_public_form(uuid,uuid,text)'::regprocedure))<>'d32a85cbc8c47d2831231916c799aeed' THEN
  RAISE EXCEPTION 'EXP06 original submission/public-form privacy contract changed' USING ERRCODE='55000'; END IF;
 FOR signature,expected IN SELECT * FROM (VALUES
  ('public.upsert_contact(jsonb,uuid,uuid,uuid,text)','0d05ed2429366f1215c3d7363ee56b4b'),
  ('public.growth_claim_submission(uuid)','ed763cd4842825b4da4400c264043eae'),
  ('public.growth_complete_submission(uuid)','76d3be4daedd234c85ff0ce3fe7cb262'),
  ('public.growth_fail_submission(uuid,text)','1e837d59e4d72d75870b3c44d9218979'),
  ('public.growth_attach_submission_deal(uuid,integer,uuid)','cced6dc8d2410b82add277fc1fdbdc3b')
 ) p(signature,expected) LOOP
  IF md5(pg_get_functiondef(to_regprocedure(signature))) IS DISTINCT FROM expected
   OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM 'postgres'
   OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature)) IS DISTINCT FROM
    (CASE WHEN signature LIKE 'public.upsert_contact%' THEN '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
     ELSE '{postgres=X/postgres,service_role=X/postgres}' END) THEN
   RAISE EXCEPTION 'EXP06 original submission/contact source changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 FOR trigger_name,signature,expected IN SELECT * FROM (VALUES
  ('growth_submission_guard_contact','public.growth_submission_guard_contact()','c37785edec881ab3bcc244a548fcd5aa'),
  ('growth_submissions_notify','public.trg_notify_form_submission()','8e30e18ee35e44dddb2f20ca0d0d7f52'),
  ('trg_growth_submission_emit_form_submitted','public.trg_growth_submission_emit_form_submitted()','f16e23e44c45b1923b9c6c6300deef19'),
  ('trg_growth_submission_stamp_campaign','public.growth_submission_stamp_campaign()','ee87eb93b42967c8776060385bd48907')
 ) p(name,signature,expected) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.growth_form_submissions'::regclass
   AND tgname=trigger_name AND tgenabled='O' AND tgfoid=to_regprocedure(signature)
   AND md5(pg_get_functiondef(tgfoid))=expected) THEN
   RAISE EXCEPTION 'EXP06 original submission trigger changed: %',trigger_name USING ERRCODE='55000'; END IF;
 END LOOP;
 -- xmin correlation relies on the unchanged original writer inserting its own
 -- audit outside its pre-write timestamp-parser savepoint, with no audit trigger.
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.growth_form_submissions'::regclass AND NOT tgisinternal)<>4
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_logs'::regclass AND NOT tgisinternal)
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.growth_form_submissions'::regclass
   AND attname='contact_tags_result' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'EXP06 submission/audit capture contract changed' USING ERRCODE='55000'; END IF;
END $contact_tags_baseline$;
ALTER TABLE public.growth_form_submissions ADD COLUMN contact_tags_result jsonb;
REVOKE SELECT ON public.growth_form_submissions FROM authenticated;
GRANT SELECT(id,form_id,tenant_id,contact_id,deal_id,source,external_source_id,payload_json,utm_json,referrer,ip,user_agent,
 consent_json,funnel_session_id,processed,processed_at,created_at,processing_state,attempts,claimed_at,last_error,
 alert_sent_at,alert_skipped_reason,visit_id,campaign_brief_id,campaign_attribution,lead_reply_skipped_reason)
 ON public.growth_form_submissions TO authenticated;

CREATE FUNCTION public._growth_submission_contact_tags_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r jsonb:=NEW.contact_tags_result; item jsonb; seen text[]:='{}'; name text; field text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.contact_tags_result IS NOT NULL THEN
  IF r IS DISTINCT FROM OLD.contact_tags_result THEN
   RAISE EXCEPTION 'FORM_CONTACT_TAGS_RESULT_IMMUTABLE' USING ERRCODE='40001'; END IF;
  -- Preserve original lifecycle/FK writes. A later contact/form/tenant retarget
  -- cannot change the saved source and is refused by the bound readers.
  RETURN NEW;
 END IF;
 IF r IS NULL THEN RETURN NEW; END IF;
 IF current_user<>'postgres' OR TG_OP='INSERT' THEN
  RAISE EXCEPTION 'FORM_CONTACT_TAGS_NATIVE_ONLY' USING ERRCODE='42501'; END IF;
 -- Fifty unique eighty-codepoint names can use 16,200 UTF8 JSONB bytes;
 -- the fixed thirteen-field native envelope reaches 16,829. Keep it bounded
 -- without rejecting the already-admitted Unicode maximum.
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR octet_length(r::text)>32768 THEN
  RAISE EXCEPTION 'FORM_CONTACT_TAGS_INVALID_RESULT' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(r))<>13
  OR NOT(r ?& ARRAY['v','submission_id','tenant_id','form_id','contact_id','automation_id','operator_user_id',
   'outcome','future_tags','config_digest','source_updated_at','saved_updated_at','audit_id'])
  OR r->'v' IS DISTINCT FROM '1'::jsonb OR r->>'submission_id' IS DISTINCT FROM NEW.id::text
  OR r->>'tenant_id' IS DISTINCT FROM NEW.tenant_id::text OR r->>'form_id' IS DISTINCT FROM NEW.form_id::text
  OR r->>'contact_id' IS DISTINCT FROM NEW.contact_id::text OR NEW.contact_id IS NULL
  OR jsonb_typeof(r->'outcome') IS DISTINCT FROM 'string' OR r->>'outcome' NOT IN ('applied','no_change')
  OR jsonb_typeof(r->'future_tags') IS DISTINCT FROM 'array'
  OR jsonb_array_length(r->'future_tags')>50 OR coalesce(r->>'config_digest','') !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(r->'source_updated_at') IS DISTINCT FROM 'string'
  OR jsonb_typeof(r->'saved_updated_at') IS DISTINCT FROM 'string'
  OR (r->>'outcome'='applied' AND jsonb_typeof(r->'audit_id') IS DISTINCT FROM 'string')
  OR (r->>'outcome'='no_change' AND (r->'audit_id' IS DISTINCT FROM 'null'::jsonb
   OR r->>'source_updated_at' IS DISTINCT FROM r->>'saved_updated_at')) THEN
  RAISE EXCEPTION 'FORM_CONTACT_TAGS_INVALID_RESULT' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['operator_user_id','automation_id','audit_id'] LOOP
  IF field IN ('automation_id','audit_id') AND r->field='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(r->field) IS DISTINCT FROM 'string' OR coalesce(r->>field,'') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'FORM_CONTACT_TAGS_INVALID_RESULT' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['source_updated_at','saved_updated_at'] LOOP
  IF length(r->>field)>64 OR (r->>field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN
   RAISE EXCEPTION 'FORM_CONTACT_TAGS_INVALID_RESULT' USING ERRCODE='22023'; END IF;
  PERFORM (r->>field)::timestamptz;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(r->'future_tags') LOOP
  name:=item#>>'{}';
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR name<>btrim(name) OR length(name) NOT BETWEEN 1 AND 80
   OR name=ANY(seen) OR name ~ ('['||chr(1)||'-'||chr(31)||chr(127)||'-'||chr(159)||']') THEN
   RAISE EXCEPTION 'FORM_CONTACT_TAGS_INVALID_RESULT' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,name);
 END LOOP;
 IF r->>'config_digest' IS DISTINCT FROM encode(sha256(convert_to((r->'future_tags')::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'FORM_CONTACT_TAGS_INVALID_RESULT' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._growth_submission_contact_tags_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER growth_submission_contact_tags_guard BEFORE INSERT OR UPDATE ON public.growth_form_submissions
 FOR EACH ROW EXECUTE FUNCTION public._growth_submission_contact_tags_guard();

-- Pure MVCC observation. An in-flight uncommitted result remains UNKNOWN; this
-- function never acquires a claim, waits on a row, no-ops a row or calls a writer.
CREATE FUNCTION public.growth_submission_contact_tags_state(p_submission_id uuid,p_contact_id uuid,p_automation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sub public.growth_form_submissions; form public.growth_forms; r jsonb;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO sub FROM public.growth_form_submissions WHERE id=p_submission_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 IF sub.contact_id IS DISTINCT FROM p_contact_id OR p_contact_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=sub.tenant_id AND status IN ('active','trial','past_due'))
  OR NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_contact_id AND tenant_id=sub.tenant_id
   AND status<>'archived' AND merged_into_contact_id IS NULL AND merged_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
 SELECT * INTO form FROM public.growth_forms WHERE id=sub.form_id AND tenant_id=sub.tenant_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
  WHERE m.tenant_id=sub.tenant_id AND m.status='active' AND m.role IN ('owner','admin')
   AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
   AND (m.user_id=form.created_by OR m.role='owner')) THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 r:=sub.contact_tags_result;
 IF r IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
 IF r->>'submission_id' IS DISTINCT FROM sub.id::text OR r->>'tenant_id' IS DISTINCT FROM sub.tenant_id::text
  OR r->>'form_id' IS DISTINCT FROM sub.form_id::text OR r->>'contact_id' IS DISTINCT FROM p_contact_id::text
  OR r->>'automation_id' IS DISTINCT FROM p_automation_id::text
  OR (p_automation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.growth_form_automations a
   JOIN public.growth_automation_targets t ON t.slug=a.target_slug
   WHERE a.id=p_automation_id AND a.form_id=form.id AND a.tenant_id=sub.tenant_id
    AND a.target_slug='contact_upsert' AND t.executor='contact_upsert')) THEN
  RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
 RETURN jsonb_build_object('ok',true,'state','recorded','replayed',true,'result',r);
END $$;
REVOKE ALL ON FUNCTION public.growth_submission_contact_tags_state(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.growth_submission_contact_tags_state(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.growth_apply_submission_contact_tags(
 p_submission_id uuid,p_claim_attempt integer,p_automation_id uuid,p_contact_id uuid,
 p_actor_user_id uuid,p_expected_updated_at text,p_expected_future_tags text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sub public.growth_form_submissions; form public.growth_forms; route public.growth_form_automations;
 contact public.clients; operator uuid; configured text[]; union_tags text[]; tag text;
 r jsonb; observed jsonb; version timestamptz; saved text; tx text; before_audits uuid[]; audits uuid[]; audit uuid;
 unchanged jsonb; outcome text; written uuid;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_submission_id IS NULL OR p_contact_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Only the admission lock block catches contention. No exception handler spans
 -- the original contact mutation or checkpoint: either both commit or both roll back.
 BEGIN
  SELECT * INTO sub FROM public.growth_form_submissions WHERE id=p_submission_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END IF;
  PERFORM 1 FROM public.tenants WHERE id=sub.tenant_id AND status IN ('active','trial','past_due') FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  SELECT * INTO form FROM public.growth_forms WHERE id=sub.form_id AND tenant_id=sub.tenant_id FOR SHARE NOWAIT;
  IF NOT FOUND OR sub.contact_id IS DISTINCT FROM p_contact_id THEN RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
  IF p_automation_id IS NOT NULL THEN
   SELECT a.* INTO route FROM public.growth_form_automations a JOIN public.growth_automation_targets t ON t.slug=a.target_slug
    WHERE a.id=p_automation_id AND a.form_id=form.id AND a.tenant_id=sub.tenant_id
     AND a.target_slug='contact_upsert' AND t.executor='contact_upsert' FOR SHARE OF a,t NOWAIT;
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
  END IF;
  SELECT * INTO contact FROM public.clients WHERE id=p_contact_id AND tenant_id=sub.tenant_id
   AND status<>'archived' AND merged_into_contact_id IS NULL AND merged_at IS NULL FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
  SELECT m.user_id INTO operator FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
   WHERE m.tenant_id=sub.tenant_id AND m.user_id=form.created_by AND m.status='active' AND m.role IN ('owner','admin')
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE OF m,u NOWAIT;
  IF operator IS NULL THEN
   SELECT m.user_id INTO operator FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
    WHERE m.tenant_id=sub.tenant_id AND m.status='active' AND m.role='owner'
     AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
    ORDER BY m.joined_at,m.user_id LIMIT 1 FOR SHARE OF m,u NOWAIT;
  END IF;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','unknown'); END;
 IF operator IS NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF sub.contact_tags_result IS NOT NULL THEN
  observed:=public.growth_submission_contact_tags_state(sub.id,p_contact_id,p_automation_id);
  RETURN observed;
 END IF;
 IF sub.processing_state<>'claimed' OR sub.attempts IS DISTINCT FROM p_claim_attempt
  OR sub.claimed_at IS NULL OR sub.claimed_at<clock_timestamp()-interval '5 minutes' THEN
  RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
 IF p_actor_user_id IS DISTINCT FROM operator THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_automation_id IS NULL THEN
  IF NOT form.auto_create_contact OR EXISTS(SELECT 1 FROM public.growth_form_automations WHERE form_id=form.id AND enabled) THEN
   RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
 ELSE
  IF NOT route.enabled OR NOT EXISTS(SELECT 1 FROM public.growth_automation_targets WHERE slug=route.target_slug AND enabled) THEN
   RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
  IF route.config_json->'future_tags' IS DISTINCT FROM to_jsonb(form.future_tags) THEN
   RETURN jsonb_build_object('ok',false,'code','config_changed'); END IF;
 END IF;
 configured:=form.future_tags;
 IF p_expected_future_tags IS DISTINCT FROM configured THEN RETURN jsonb_build_object('ok',false,'code','config_changed'); END IF;
 IF p_expected_updated_at IS NULL OR p_expected_updated_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 BEGIN version:=p_expected_updated_at::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END;
 IF version IS DISTINCT FROM contact.updated_at THEN RAISE EXCEPTION 'CONTACT_VERSION_STALE' USING ERRCODE='40001'; END IF;
 -- Preserve the entire existing array, including order/multiplicity. Append only
 -- missing configured names; existing membership alone yields no_change, no audit.
 union_tags:=coalesce(contact.tags,'{}'::text[]);
 IF coalesce(array_ndims(union_tags),1)>1 THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 FOREACH tag IN ARRAY configured LOOP IF NOT(tag=ANY(union_tags)) THEN union_tags:=array_append(union_tags,tag); END IF; END LOOP;
 IF cardinality(union_tags)>50 THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Original arbitrary legacy values may remain; never trim/dedupe/delete them.
 -- NULL elements cannot be round-tripped through the original JSON tag writer.
 IF array_position(union_tags,NULL) IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF union_tags IS NOT DISTINCT FROM coalesce(contact.tags,'{}'::text[]) THEN
  outcome:='no_change'; saved:=p_expected_updated_at; audit:=NULL;
 ELSE
  -- An actual row-version stamp obtains THIS subtransaction xid, including a
  -- caller SAVEPOINT. The pinned original triggers do not fire on claimed_at.
  unchanged:=to_jsonb(sub)-'contact_tags_result';
  UPDATE public.growth_form_submissions SET claimed_at=claimed_at WHERE id=sub.id RETURNING xmin::text INTO tx;
  IF (SELECT to_jsonb(s)-'contact_tags_result' FROM public.growth_form_submissions s WHERE id=sub.id) IS DISTINCT FROM unchanged THEN
   RAISE EXCEPTION 'FORM_CONTACT_TAGS_CAPTURE_CHANGED_LIFECYCLE' USING ERRCODE='55000'; END IF;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO before_audits FROM public.audit_logs
   WHERE xmin::text=tx AND user_id=operator AND entity='client' AND action='update_contact' AND entity_id=contact.id;
  written:=public.upsert_contact(jsonb_build_object('tags',to_jsonb(union_tags),'expected_updated_at',p_expected_updated_at),
   contact.id,sub.tenant_id,operator,'api');
  SELECT array_agg(id) INTO audits FROM public.audit_logs
   WHERE xmin::text=tx AND NOT(id=ANY(before_audits)) AND user_id=operator AND entity='client' AND action='update_contact'
    AND entity_id=contact.id AND data=jsonb_build_object('tenant_id',sub.tenant_id,'fields',jsonb_build_array('tags'),'channel','api');
  IF written IS DISTINCT FROM contact.id OR cardinality(audits) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'FORM_CONTACT_TAGS_AUDIT_AMBIGUOUS' USING ERRCODE='55000'; END IF;
  audit:=audits[1]; outcome:='applied';
  SELECT to_jsonb(c.updated_at)#>>'{}' INTO saved FROM public.clients c WHERE c.id=contact.id AND c.tenant_id=sub.tenant_id AND c.tags IS NOT DISTINCT FROM union_tags;
  IF saved IS NULL THEN RAISE EXCEPTION 'FORM_CONTACT_TAGS_POSTCONDITION_CHANGED' USING ERRCODE='55000'; END IF;
 END IF;
 r:=jsonb_build_object('v',1,'submission_id',sub.id,'tenant_id',sub.tenant_id,'form_id',sub.form_id,
  'contact_id',contact.id,'automation_id',p_automation_id,'operator_user_id',operator,'outcome',outcome,
  'future_tags',to_jsonb(configured),'config_digest',encode(sha256(convert_to(to_jsonb(configured)::text,'UTF8')),'hex'),
  'source_updated_at',p_expected_updated_at,'saved_updated_at',saved,'audit_id',audit);
 UPDATE public.growth_form_submissions SET contact_tags_result=r WHERE id=sub.id;
 RETURN jsonb_build_object('ok',true,'state','recorded','replayed',false,'result',r);
END $$;
REVOKE ALL ON FUNCTION public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[]) TO service_role;
DO $contact_tags_postflight$
DECLARE column_name text;
BEGIN
 FOREACH column_name IN ARRAY ARRAY['id','form_id','tenant_id','contact_id','deal_id','source','external_source_id','payload_json','utm_json','referrer','ip','user_agent','consent_json','funnel_session_id','processed','processed_at','created_at','processing_state','attempts','claimed_at','last_error','alert_sent_at','alert_skipped_reason','visit_id','campaign_brief_id','campaign_attribution','lead_reply_skipped_reason'] LOOP
  IF NOT has_column_privilege('authenticated','public.growth_form_submissions',column_name,'SELECT') THEN
   RAISE EXCEPTION 'EXP06 original submission column read lost: %',column_name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF has_column_privilege('authenticated','public.growth_form_submissions','contact_tags_result','SELECT')
  OR has_column_privilege('anon','public.growth_form_submissions','contact_tags_result','SELECT')
  OR NOT has_column_privilege('service_role','public.growth_form_submissions','contact_tags_result','SELECT')
  OR (SELECT proacl::text FROM pg_proc WHERE oid='public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[])'::regprocedure)
   IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  OR (SELECT proacl::text FROM pg_proc WHERE oid='public.growth_submission_contact_tags_state(uuid,uuid,uuid)'::regprocedure)
   IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  OR md5(pg_get_functiondef('public.upsert_contact(jsonb,uuid,uuid,uuid,text)'::regprocedure))<>'0d05ed2429366f1215c3d7363ee56b4b' THEN
  RAISE EXCEPTION 'EXP06 contact tag private source/original writer boundary changed' USING ERRCODE='55000'; END IF;
END $contact_tags_postflight$;
COMMIT;
