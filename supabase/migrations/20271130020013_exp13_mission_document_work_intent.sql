-- EXP13: source-backed data in the ORIGINAL immutable Mission briefs.
-- No Task execution/approval, new store, role expansion or provider activation.
-- New never-applied forward; preserve lower published E03 carrier release order.
BEGIN;
DO $incumbents$
DECLARE e record;f record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
('public.business_mission_owner_context()','2c169bb7d526793d576d4319fa247877','e2cbe6036c6c93b89267a04bfec6580c',false),
('public.create_business_mission(uuid,text,text,date,text,text,text[],text,text,text[],text[],text,text,uuid)','376905394d357673c6a25489c8bef76a','95826ce81a14c43451bb957bc6513bbf',true),
('public.revise_business_mission_brief(uuid,integer,uuid,text,date,text,text,text[],text,text,text[],text[],text,text,text)','5bd923dfeaaaea466b32521ff0ff518a','864457dc23f377f60077cd3feb94c311',true),
('public.get_business_mission(uuid)','10b50f49c3b16fc23b40527ce1166f13','0d3f0340815b97a6ad1f9dc2e5447573',true)
 ) v(signature,body_hash,definition_hash,authenticated) LOOP
  IF to_regprocedure(e.signature) IS NULL THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=to_regprocedure(e.signature);
  IF md5(f.prosrc)<>e.body_hash OR md5(pg_get_functiondef(f.oid))<>e.definition_hash
   OR f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR NOT f.prosecdef OR f.prorettype<>(CASE WHEN e.authenticated THEN 'jsonb'::regtype ELSE 'record'::regtype END)
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
     WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner OR a.is_grantable
      OR (a.grantee<>f.proowner AND NOT(e.authenticated AND a.grantee='authenticated'::regrole)))
   OR (e.authenticated AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INSTALL_DRIFT'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_mission_brief_versions' AND column_name='document_work_intent')
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname IN ('normalize_business_mission_document_intent','lock_business_mission_document_sources','project_business_mission_document_intent'))
  OR EXISTS(SELECT 1 FROM pg_depend d WHERE d.refclassid='pg_proc'::regclass AND d.deptype='n' AND d.refobjid IN (
    'public.create_business_mission(uuid,text,text,date,text,text,text[],text,text,text[],text[],text,text,uuid)'::regprocedure,
    'public.revise_business_mission_brief(uuid,integer,uuid,text,date,text,text,text[],text,text,text[],text[],text,text,text)'::regprocedure)) THEN
  RAISE EXCEPTION 'MISSION_DOCUMENT_INSTALL_DRIFT'; END IF;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)'::regprocedure))<>'c875eff4e94775dfeb6e140957d47507'
  OR has_function_privilege('authenticated','public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'MISSION_DOCUMENT_INSTALL_DRIFT'; END IF;
END $incumbents$;
DO $source_dependencies$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_utf16_length(text)','ac0ec20d31948a93814074a35bc59e81','sql','i','s','integer',false,0,NULL::text,ARRAY['authenticated','service_role']::text[]),
  ('public.knowledge_actor_authorized(uuid,uuid)','a05876e786e8a6e7e3e15783cde684aa','sql','s','u','boolean',true,0,NULL::text,ARRAY['service_role']::text[]),
  ('public.lock_knowledge_extraction_authority(uuid,uuid)','788d27bc980fee58e6272c3e53ca6096','plpgsql','v','u','boolean',true,0,NULL::text,ARRAY['service_role']::text[]),
  ('public.read_tenant_knowledge(uuid,uuid,integer,integer)','9ee43da246514e9fb88b96a23c584d37','plpgsql','v','u','jsonb',true,3,'NULL::uuid, 50, 0',ARRAY['authenticated']::text[])
 ) v(signature,body_hash,language,volatility,parallel,return_type,definer,defaults_count,defaults_text,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.proparallel::text<>expected.parallel
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proisstrict OR f.proleakproof
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';
  END IF;
 END LOOP;
END $source_dependencies$;
DO $source_installed$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','615d47584f14264053a80397dcce74ee','plpgsql','i','s','boolean',false,0,NULL::text,ARRAY[]::text[]),
  ('public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','c875eff4e94775dfeb6e140957d47507','plpgsql','v','u','jsonb',false,0,NULL::text,ARRAY[]::text[])
 ) v(signature,body_hash,language,volatility,parallel,return_type,definer,defaults_count,defaults_text,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.proparallel::text<>expected.parallel
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proisstrict OR f.proleakproof
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';
  END IF;
 END LOOP;
END $source_installed$;
ALTER TABLE public.business_mission_brief_versions ADD COLUMN document_work_intent jsonb;
-- ORIGINAL Mission brief data admission. Private helpers; no new execution door.
CREATE FUNCTION public.normalize_business_mission_document_intent(p_tenant uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $intent$
DECLARE
 s jsonb;r jsonb;e jsonb;step jsonb;who jsonb;task jsonb;v text;due date;
 sources jsonb:='[]';steps jsonb:='[]';source_ids text[]:='{}';step_ids text[]:='{}';resolved text[]:='{}';layer text[];
 doc uuid;step_id uuid;person uuid;assignee uuid;quote_units integer:=0;i integer;
BEGIN
 IF p_tenant IS NULL THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
 IF p_intent IS NULL OR p_intent='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR pg_column_size(p_intent)>524288
  OR NOT(p_intent ?& ARRAY['contractVersion','sources','steps']) OR (SELECT count(*) FROM jsonb_object_keys(p_intent))<>3
  OR p_intent->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(p_intent->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(p_intent->'steps') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_intent->'sources') NOT BETWEEN 1 AND 20 OR jsonb_array_length(p_intent->'steps') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_intent->'sources') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['reference','title','excerpts'])
   OR (SELECT count(*) FROM jsonb_object_keys(s))<>3 OR jsonb_typeof(s->'reference') IS DISTINCT FROM 'object'
   OR jsonb_typeof(s->'title') IS DISTINCT FROM 'string' OR btrim(s->>'title')=''
   OR public.knowledge_utf16_length(s->>'title')>300 OR jsonb_typeof(s->'excerpts') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  r:=s->'reference';
  IF NOT(r ?& ARRAY['contractVersion','tenantId','documentId','revision','contentSha256']) OR (SELECT count(*) FROM jsonb_object_keys(r))<>5
   OR r->'contractVersion' IS DISTINCT FROM '1'::jsonb OR r->>'tenantId' IS DISTINCT FROM p_tenant::text
   OR jsonb_typeof(r->'documentId') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'revision') IS DISTINCT FROM 'number'
   OR (r->>'revision' COLLATE pg_catalog."C") !~ '^[1-9][0-9]{0,9}$'
   OR (r->>'revision')::numeric>2147483647 OR jsonb_typeof(r->'contentSha256') IS DISTINCT FROM 'string'
   OR (r->>'contentSha256' COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN doc:=(r->>'documentId')::uuid; EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
  IF doc IS NULL OR r->>'documentId' IS DISTINCT FROM doc::text OR doc::text=ANY(source_ids)
   OR jsonb_array_length(s->'excerpts') NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(s->'excerpts') LOOP
   IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR NOT(e ?& ARRAY['start','end','text'])
    OR (SELECT count(*) FROM jsonb_object_keys(e))<>3 OR jsonb_typeof(e->'start') IS DISTINCT FROM 'number'
    OR jsonb_typeof(e->'end') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'text') IS DISTINCT FROM 'string'
    OR (e->>'start' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$' OR (e->>'end' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   IF (e->>'end')::integer<= (e->>'start')::integer OR (e->>'end')::integer>480000
    OR public.knowledge_utf16_length(e->>'text')<>(e->>'end')::integer-(e->>'start')::integer THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   quote_units:=quote_units+public.knowledge_utf16_length(e->>'text');
   IF quote_units>12000 THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  source_ids:=array_append(source_ids,doc::text);
  sources:=sources||jsonb_build_array(jsonb_build_object('reference',r,'title',s->>'title','excerpts',s->'excerpts'));
 END LOOP;
 FOR step IN SELECT value FROM jsonb_array_elements(p_intent->'steps') LOOP
  IF jsonb_typeof(step) IS DISTINCT FROM 'object'
   OR NOT(step ?& ARRAY['id','title','description','responsible','dueOn','dependencies','sourceIds','basis','proposedTask'])
   OR (SELECT count(*) FROM jsonb_object_keys(step))<>9 OR jsonb_typeof(step->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(step->'title') IS DISTINCT FROM 'string' OR btrim(step->>'title')=''
   OR public.knowledge_utf16_length(step->>'title')>180 OR jsonb_typeof(step->'description') IS DISTINCT FROM 'string'
   OR btrim(step->>'description')='' OR public.knowledge_utf16_length(step->>'description')>4000
   OR jsonb_typeof(step->'responsible') IS DISTINCT FROM 'object' OR jsonb_typeof(step->'proposedTask') IS DISTINCT FROM 'object'
   OR jsonb_typeof(step->'dependencies') IS DISTINCT FROM 'array' OR jsonb_typeof(step->'sourceIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(step->'basis') IS DISTINCT FROM 'string' OR step->>'basis' NOT IN ('recommendation','source_obligation') THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN step_id:=(step->>'id')::uuid; EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
  IF step_id IS NULL OR step->>'id' IS DISTINCT FROM step_id::text OR step_id::text=ANY(step_ids)
   OR jsonb_array_length(step->'dependencies')>49 OR jsonb_array_length(step->'sourceIds')>20
   OR (step->>'basis'='source_obligation' AND jsonb_array_length(step->'sourceIds')=0) THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  IF step->'dueOn'<>'null'::jsonb THEN
   IF jsonb_typeof(step->'dueOn') IS DISTINCT FROM 'string' OR (step->>'dueOn' COLLATE pg_catalog."C") !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   BEGIN due:=(step->>'dueOn')::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
   IF to_char(due,'YYYY-MM-DD') IS DISTINCT FROM step->>'dueOn' THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(step->'sourceIds') x WHERE jsonb_typeof(x.value)<>'string' OR NOT(x.value#>>'{}'=ANY(source_ids)))
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(step->'sourceIds'))<>jsonb_array_length(step->'sourceIds')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(step->'dependencies') x WHERE jsonb_typeof(x.value)<>'string')
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(step->'dependencies'))<>jsonb_array_length(step->'dependencies') THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  who:=step->'responsible';task:=step->'proposedTask';person:=NULL;assignee:=NULL;
  IF who->>'kind'='unassigned' AND (SELECT count(*) FROM jsonb_object_keys(who))=1 THEN NULL;
  ELSIF who->>'kind'='person' AND who ? 'userId' AND (SELECT count(*) FROM jsonb_object_keys(who))=2 AND jsonb_typeof(who->'userId')='string' THEN
   BEGIN person:=(who->>'userId')::uuid; EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
   IF person IS NULL OR who->>'userId' IS DISTINCT FROM person::text THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  ELSIF who->>'kind'='specialist' AND who ? 'alias' AND (SELECT count(*) FROM jsonb_object_keys(who))=2
   AND jsonb_typeof(who->'alias')='string' AND btrim(who->>'alias')<>'' AND public.knowledge_utf16_length(who->>'alias')<=80 THEN
   who:=jsonb_build_object('kind','specialist','alias',btrim(who->>'alias'));
  ELSE RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT(task ?& ARRAY['action','assigneeUserId']) OR (SELECT count(*) FROM jsonb_object_keys(task))<>2
   OR task->>'action' IS DISTINCT FROM 'task.create' THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  IF task->'assigneeUserId'<>'null'::jsonb THEN
   IF jsonb_typeof(task->'assigneeUserId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   BEGIN assignee:=(task->>'assigneeUserId')::uuid; EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
   IF assignee IS NULL OR person IS DISTINCT FROM assignee OR task->>'assigneeUserId' IS DISTINCT FROM assignee::text THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  step_ids:=array_append(step_ids,step_id::text);
  steps:=steps||jsonb_build_array(step||jsonb_build_object('title',btrim(step->>'title'),'description',btrim(step->>'description'),'responsible',who));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(steps) s CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'dependencies') d
  WHERE NOT(d.value=ANY(step_ids))) THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
 -- Bounded topological validation, not an exponential recursive path walk.
 FOR i IN 1..50 LOOP
  SELECT array_agg(s.value->>'id') INTO layer FROM jsonb_array_elements(steps) s
   WHERE NOT(s.value->>'id'=ANY(resolved)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(s.value->'dependencies') d WHERE NOT(d.value=ANY(resolved)));
  IF layer IS NULL THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  resolved:=resolved||layer;
  EXIT WHEN cardinality(resolved)=cardinality(step_ids);
 END LOOP;
 RETURN jsonb_build_object('contractVersion',1,'sources',sources,'steps',steps);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
 RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023';
END $intent$;
REVOKE ALL ON FUNCTION public.normalize_business_mission_document_intent(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lock_business_mission_document_sources(p_actor uuid,p_tenant uuid,p_intent jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $sources$
DECLARE s jsonb;actual jsonb;
BEGIN
 IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF p_intent IS NULL THEN RETURN; END IF;
 -- Deterministic original source locks. The original helper retains caller,
 -- active tenant, member/profile locks, permitted read, version/hash and UTF16.
 FOR s IN SELECT value FROM jsonb_array_elements(p_intent->'sources') ORDER BY value->'reference'->>'documentId' LOOP
  actual:=public.lock_knowledge_source_evidence(p_actor,p_tenant,s->'reference',s->'excerpts');
  IF actual->>'title' IS DISTINCT FROM s->>'title' THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 END LOOP;
END $sources$;
REVOKE ALL ON FUNCTION public.lock_business_mission_document_sources(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.project_business_mission_document_intent(p_tenant uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $project$
DECLARE s jsonb;permitted jsonb;doc jsonb;e jsonb;status text:='available';h text;
BEGIN
 IF p_intent IS NULL THEN RETURN jsonb_build_object('document_work_intent',NULL,'document_work_intent_status','none','document_work_intent_hash',NULL); END IF;
 h:=encode(sha256(convert_to(p_intent::text,'UTF8')),'hex');
 FOR s IN SELECT value FROM jsonb_array_elements(p_intent->'sources') LOOP
  BEGIN permitted:=public.read_tenant_knowledge(p_tenant,(s->'reference'->>'documentId')::uuid,1,0);
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN status:='source_unavailable';EXIT; END;
  IF permitted->>'tenant_id' IS DISTINCT FROM p_tenant::text OR jsonb_array_length(permitted->'documents') IS DISTINCT FROM 1 THEN status:='source_unavailable';EXIT; END IF;
  doc:=permitted->'documents'->0;
  IF doc->>'revision' IS DISTINCT FROM s->'reference'->>'revision'
   OR encode(sha256(convert_to(doc->>'content','UTF8')),'hex') IS DISTINCT FROM s->'reference'->>'contentSha256' THEN status:='source_changed';EXIT; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(s->'excerpts') LOOP
   IF NOT public.knowledge_utf16_excerpt_matches(doc->>'content',(e->>'start')::integer,(e->>'end')::integer,e->>'text') THEN status:='source_changed';EXIT; END IF;
  END LOOP;
  EXIT WHEN status<>'available';
 END LOOP;
 -- Persisted history remains immutable, but a later source loss is never a raw
 -- quote disclosure or renewed Task authority. Keep only opaque intent identity.
 RETURN jsonb_build_object('document_work_intent',CASE WHEN status='available' THEN p_intent ELSE NULL END,
  'document_work_intent_status',status,'document_work_intent_hash',h);
END $project$;
REVOKE ALL ON FUNCTION public.project_business_mission_document_intent(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Keep original regprocedures/defaults/OIDs. New forms require ALL arguments;
-- the legacy adapters call the SAME writer once, with intent omitted.
create or replace function public.create_business_mission(p_request_key uuid,p_title text,p_desired_outcome text,p_deadline_on date,p_baseline text,p_strategy text,
  p_constraints text[],p_success_definition text,p_owner_authority text,p_assumptions text[],
  p_missing_information text[],p_next_action text,p_request_source text,p_request_thread_id uuid,p_document_work_intent_present boolean,p_document_work_intent jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;t uuid;m public.business_missions%rowtype;h text;j jsonb;r public.business_mission_mutation_receipts%rowtype;answer jsonb;intent jsonb;
begin
  select c.actor_id,c.tenant_id into a,t from public.business_mission_owner_context() c;
  if p_document_work_intent_present is null or (not p_document_work_intent_present and p_document_work_intent is not null) then raise exception 'MISSION_DOCUMENT_INTENT_INVALID' using errcode='22023'; end if;
  if p_document_work_intent_present then intent:=public.normalize_business_mission_document_intent(t,p_document_work_intent); end if;
  if p_request_key is null then raise exception 'MISSION_REQUEST_KEY_REQUIRED' using errcode='22023'; end if;
  if p_request_source not in ('owner_ui','paige_chat') then raise exception 'MISSION_BAD_SOURCE' using errcode='22023'; end if;
  if (p_request_source='owner_ui' and p_request_thread_id is not null) or (p_request_source='paige_chat' and p_request_thread_id is null) then raise exception 'MISSION_SOURCE_CONTEXT_INVALID' using errcode='22023'; end if;
  if p_request_thread_id is not null and not exists(select 1 from public.paige_chat_threads ct where ct.id=p_request_thread_id and ct.tenant_id=t and ct.caller_user_id=a and ct.lens='coach' and ct.contact_id is null) then raise exception 'MISSION_THREAD_CONTEXT_INVALID' using errcode='42501'; end if;
  if p_deadline_on is not null and p_deadline_on<current_date then raise exception 'MISSION_DEADLINE_IN_PAST' using errcode='22023'; end if;
  j:=jsonb_build_object('title',btrim(coalesce(p_title,'')),'desired_outcome',btrim(coalesce(p_desired_outcome,'')),'deadline_on',p_deadline_on,
    'baseline',btrim(coalesce(p_baseline,'')),'strategy',btrim(coalesce(p_strategy,'')),'constraints',coalesce(p_constraints,'{}'),
    'success_definition',btrim(coalesce(p_success_definition,'')),'owner_authority',btrim(coalesce(p_owner_authority,'')),
    'assumptions',coalesce(p_assumptions,'{}'),'missing_information',coalesce(p_missing_information,'{}'),'next_action',nullif(btrim(coalesce(p_next_action,'')),''),
    'request_source',p_request_source,'request_thread_id',p_request_thread_id);if p_document_work_intent_present then j:=j||jsonb_build_object('document_work_intent',intent); end if;h:=md5(j::text);
  insert into public.business_mission_mutation_receipts(tenant_id,actor_user_id,request_key,operation,payload_hash) values(t,a,p_request_key,'create',h) on conflict do nothing;
  if not found then
    select * into r from public.business_mission_mutation_receipts x where x.tenant_id=t and x.actor_user_id=a and x.request_key=p_request_key for update;
    if r.operation<>'create' or r.payload_hash<>h then raise exception 'MISSION_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    if r.result is null then raise exception 'MISSION_REQUEST_INCOMPLETE' using errcode='40001'; end if;
    return r.result||jsonb_build_object('replayed',true);
  end if;
  if p_document_work_intent_present then
    perform public.lock_business_mission_document_sources(a,t,intent);
    -- Source/authority locks may have waited. Recheck ORIGINAL Mission ownership
    -- under those locks; Knowledge membership is not Mission write authority.
    perform 1 from public.business_mission_owner_context() c where c.actor_id=a and c.tenant_id=t;
    if not found then raise exception 'MISSION_OWNER_REQUIRED' using errcode='42501'; end if;
  end if;

  insert into public.business_missions(tenant_id,requested_by,request_source,request_thread_id,title,next_action)
    values(t,a,p_request_source,p_request_thread_id,btrim(p_title),nullif(btrim(coalesce(p_next_action,'')),'')) returning * into m;
  insert into public.business_mission_brief_versions(tenant_id,mission_id,version,desired_outcome,deadline_on,baseline,strategy,constraints,success_definition,
    owner_authority,assumptions,missing_information,revision_reason,created_by,document_work_intent)
    values(t,m.id,1,btrim(p_desired_outcome),p_deadline_on,btrim(p_baseline),btrim(p_strategy),coalesce(p_constraints,'{}'),btrim(p_success_definition),
    btrim(p_owner_authority),coalesce(p_assumptions,'{}'),coalesce(p_missing_information,'{}'),'Initial mission brief',a,intent);
  answer:=jsonb_build_object('ok',true,'mission_id',m.id,'revision',1,'state','proposed','replayed',false);
  update public.business_mission_mutation_receipts set mission_id=m.id,result=answer where tenant_id=t and actor_user_id=a and request_key=p_request_key;
  insert into public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,target_id,payload) values(t,a,'owner','business_mission.created','business_mission',m.id,jsonb_build_object('revision',1,'state','proposed','request_source',p_request_source));
  return answer;
end $$;
REVOKE ALL ON FUNCTION public.create_business_mission(uuid,text,text,date,text,text,text[],text,text,text[],text[],text,text,uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_business_mission(uuid,text,text,date,text,text,text[],text,text,text[],text[],text,text,uuid,boolean,jsonb) TO authenticated;
create or replace function public.revise_business_mission_brief(p_mission_id uuid,p_expected_revision integer,p_request_key uuid,p_desired_outcome text,p_deadline_on date,
  p_baseline text,p_strategy text,p_constraints text[],p_success_definition text,p_owner_authority text,p_assumptions text[],p_missing_information text[],
  p_revision_reason text,p_title text,p_next_action text,p_document_work_intent_present boolean,p_document_work_intent jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;t uuid;m public.business_missions%rowtype;h text;j jsonb;n integer;r public.business_mission_mutation_receipts%rowtype;answer jsonb;intent jsonb;
begin
  select c.actor_id,c.tenant_id into a,t from public.business_mission_owner_context() c;
  if p_document_work_intent_present is null or (not p_document_work_intent_present and p_document_work_intent is not null) then raise exception 'MISSION_DOCUMENT_INTENT_INVALID' using errcode='22023'; end if;
  if p_document_work_intent_present then intent:=public.normalize_business_mission_document_intent(t,p_document_work_intent); end if;
  if p_request_key is null then raise exception 'MISSION_REQUEST_KEY_REQUIRED' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'MISSION_EXPECTED_REVISION_REQUIRED' using errcode='22023'; end if;
  if p_deadline_on is not null and p_deadline_on<current_date then raise exception 'MISSION_DEADLINE_IN_PAST' using errcode='22023'; end if;
  j:=jsonb_build_object('mission_id',p_mission_id,'expected_revision',p_expected_revision,'desired_outcome',btrim(coalesce(p_desired_outcome,'')),'deadline_on',p_deadline_on,'baseline',btrim(coalesce(p_baseline,'')),
    'strategy',btrim(coalesce(p_strategy,'')),'constraints',coalesce(p_constraints,'{}'),'success_definition',btrim(coalesce(p_success_definition,'')),
    'owner_authority',btrim(coalesce(p_owner_authority,'')),'assumptions',coalesce(p_assumptions,'{}'),'missing_information',coalesce(p_missing_information,'{}'),
    'revision_reason',btrim(coalesce(p_revision_reason,'')),'title',nullif(btrim(coalesce(p_title,'')),''),'next_action',nullif(btrim(coalesce(p_next_action,'')),''));if p_document_work_intent_present then j:=j||jsonb_build_object('document_work_intent',intent); end if;h:=md5(j::text);
  insert into public.business_mission_mutation_receipts(tenant_id,actor_user_id,request_key,operation,payload_hash) values(t,a,p_request_key,'revise',h) on conflict do nothing;
  if not found then
    select * into r from public.business_mission_mutation_receipts x where x.tenant_id=t and x.actor_user_id=a and x.request_key=p_request_key for update;
    if r.operation<>'revise' or r.payload_hash<>h then raise exception 'MISSION_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    if r.result is null then raise exception 'MISSION_REQUEST_INCOMPLETE' using errcode='40001'; end if;
    return r.result||jsonb_build_object('replayed',true);
  end if;
  if p_document_work_intent_present then
    perform public.lock_business_mission_document_sources(a,t,intent);
    -- Source/authority locks may have waited. Recheck ORIGINAL Mission ownership
    -- under those locks; Knowledge membership is not Mission write authority.
    perform 1 from public.business_mission_owner_context() c where c.actor_id=a and c.tenant_id=t;
    if not found then raise exception 'MISSION_OWNER_REQUIRED' using errcode='42501'; end if;
  end if;
  select * into m from public.business_missions x where x.tenant_id=t and x.id=p_mission_id for update;
  if not found then raise exception 'MISSION_NOT_FOUND' using errcode='P0002'; end if;
  if m.revision is distinct from p_expected_revision then raise exception 'MISSION_REVISION_CONFLICT' using errcode='40001'; end if;
  if m.lifecycle_state in ('completed','stopped') then raise exception 'MISSION_CLOSED' using errcode='22023'; end if;n:=m.revision+1;
  if not p_document_work_intent_present then select v.document_work_intent into intent from public.business_mission_brief_versions v where v.tenant_id=t and v.mission_id=p_mission_id order by v.version desc limit 1; end if;
  insert into public.business_mission_brief_versions(tenant_id,mission_id,version,desired_outcome,deadline_on,baseline,strategy,constraints,success_definition,
    owner_authority,assumptions,missing_information,revision_reason,created_by,document_work_intent)
    values(t,p_mission_id,n,btrim(p_desired_outcome),p_deadline_on,btrim(p_baseline),btrim(p_strategy),coalesce(p_constraints,'{}'),btrim(p_success_definition),
    btrim(p_owner_authority),coalesce(p_assumptions,'{}'),coalesce(p_missing_information,'{}'),btrim(p_revision_reason),a,intent);
  update public.business_missions set title=coalesce(nullif(btrim(coalesce(p_title,'')),''),title),next_action=coalesce(nullif(btrim(coalesce(p_next_action,'')),''),next_action),revision=n,updated_at=now() where tenant_id=t and id=p_mission_id;
  answer:=jsonb_build_object('ok',true,'mission_id',p_mission_id,'revision',n,'state',m.lifecycle_state,'replayed',false);
  update public.business_mission_mutation_receipts set mission_id=p_mission_id,result=answer where tenant_id=t and actor_user_id=a and request_key=p_request_key;
  insert into public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,target_id,payload) values(t,a,'owner','business_mission.brief_revised','business_mission',p_mission_id,jsonb_build_object('revision',n,'previous_revision',m.revision));
  return answer;
end $$;
REVOKE ALL ON FUNCTION public.revise_business_mission_brief(uuid,integer,uuid,text,date,text,text,text[],text,text,text[],text[],text,text,text,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.revise_business_mission_brief(uuid,integer,uuid,text,date,text,text,text[],text,text,text[],text[],text,text,text,boolean,jsonb) TO authenticated;
create or replace function public.create_business_mission(p_request_key uuid,p_title text,p_desired_outcome text,p_deadline_on date,p_baseline text,p_strategy text,
  p_constraints text[] default '{}',p_success_definition text default '',p_owner_authority text default '',p_assumptions text[] default '{}',
  p_missing_information text[] default '{}',p_next_action text default null,p_request_source text default 'owner_ui',p_request_thread_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.create_business_mission(p_request_key,p_title,p_desired_outcome,p_deadline_on,p_baseline,p_strategy,p_constraints,p_success_definition,p_owner_authority,p_assumptions,p_missing_information,p_next_action,p_request_source,p_request_thread_id,false,NULL::jsonb); end $$;
create or replace function public.revise_business_mission_brief(p_mission_id uuid,p_expected_revision integer,p_request_key uuid,p_desired_outcome text,p_deadline_on date,
  p_baseline text,p_strategy text,p_constraints text[],p_success_definition text,p_owner_authority text,p_assumptions text[],p_missing_information text[],
  p_revision_reason text,p_title text default null,p_next_action text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.revise_business_mission_brief(p_mission_id,p_expected_revision,p_request_key,p_desired_outcome,p_deadline_on,p_baseline,p_strategy,p_constraints,p_success_definition,p_owner_authority,p_assumptions,p_missing_information,p_revision_reason,p_title,p_next_action,false,NULL::jsonb); end $$;
create or replace function public.get_business_mission(p_mission_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a uuid;t uuid;r jsonb;begin select c.actor_id,c.tenant_id into a,t from public.business_mission_owner_context() c;
  select jsonb_build_object('mission',jsonb_build_object('id',m.id,'title',m.title,'state',m.lifecycle_state,'state_reason',m.state_reason,'next_action',m.next_action,'revision',m.revision,'created_at',m.created_at,'updated_at',m.updated_at,'closure_outcome',m.closure_outcome,'outcome_summary',m.outcome_summary,'outcome_unknowns',m.outcome_unknowns,'request_source',m.request_source,'request_thread_id',m.request_thread_id),
    'brief',(to_jsonb(b)-'tenant_id'-'mission_id'-'created_by')||public.project_business_mission_document_intent(t,b.document_work_intent)) into r
    from public.business_missions m join lateral(select v.* from public.business_mission_brief_versions v where v.tenant_id=m.tenant_id and v.mission_id=m.id order by v.version desc limit 1)b on true
    where m.tenant_id=t and m.id=p_mission_id;if r is null then raise exception 'MISSION_NOT_FOUND' using errcode='P0002';end if;return r;end $$;

DO $installed$
DECLARE e record;f record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
('public.create_business_mission(uuid,text,text,date,text,text,text[],text,text,text[],text[],text,text,uuid,boolean,jsonb)','465958780cbb6c8afb29d2cce012e871','jsonb','v',true,0,true),
('public.revise_business_mission_brief(uuid,integer,uuid,text,date,text,text,text[],text,text,text[],text[],text,text,text,boolean,jsonb)','7987bfc8792a49db24d9fc7f69fac135','jsonb','v',true,0,true),
('public.create_business_mission(uuid,text,text,date,text,text,text[],text,text,text[],text[],text,text,uuid)','b01170f9211a46a34405c7efb8e109bb','jsonb','v',true,8,true),
('public.revise_business_mission_brief(uuid,integer,uuid,text,date,text,text,text[],text,text,text[],text[],text,text,text)','9e4d9197c4758ba9e97378b46d502cdd','jsonb','v',true,2,true),
('public.get_business_mission(uuid)','478c85c7e5ab16a813691e56bf9e40ab','jsonb','v',true,0,true),
('public.normalize_business_mission_document_intent(uuid,jsonb)','a8748f857f6df9773c01f602da2941b4','jsonb','i',false,0,false),
('public.lock_business_mission_document_sources(uuid,uuid,jsonb)','d65424091c1eece11f4a210e0f700198','void','v',false,0,false),
('public.project_business_mission_document_intent(uuid,jsonb)','ff34a962ba58c7dfe3841de1425d61f7','jsonb','v',false,0,false)
 ) v(signature,body_hash,return_type,volatility,definer,defaults_count,authenticated) LOOP
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=to_regprocedure(e.signature);
  IF md5(f.prosrc)<>e.body_hash OR f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f' OR f.proretset OR f.proisstrict OR f.proleakproof
   OR f.prosecdef IS DISTINCT FROM e.definer OR f.provolatile::text<>e.volatility OR f.proparallel<>'u'
   OR f.prorettype<>e.return_type::regtype OR f.pronargdefaults<>e.defaults_count
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner OR a.is_grantable
     OR (a.grantee<>f.proowner AND NOT(e.authenticated AND a.grantee='authenticated'::regrole)))
   OR (e.authenticated AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INSTALL_DRIFT'; END IF;
 END LOOP;
END $installed$;
COMMIT;
