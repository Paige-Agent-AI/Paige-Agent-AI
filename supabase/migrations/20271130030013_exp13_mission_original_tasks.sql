-- Same original governed CRM Task effect and creation result. No new executor/store/grant.
-- New never-applied CLI-created forward after immutable Mission30020013 and E08 lower8/9.
BEGIN;
DO $guard$
DECLARE e record;f record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
 ('public.execute_crm_command_reversible(uuid,uuid,jsonb,text)','caea59ab335ecaf295391c41a1a0522f','735683a44be0fb4a83aafc40e0306576'),
 ('public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)','8e18a5d96e8fc986177560cab0a5d64a','9ebb3d3a80db7c221211be26dbf6fc6e'),
 ('public.read_crm_command_result(uuid,uuid,jsonb,text)','71a939f1b7e332073adee2917ba366ef','f31306ab24924413dae6517c52a26a0c'),
 ('public.normalize_business_mission_document_intent(uuid,jsonb)','a8748f857f6df9773c01f602da2941b4','551e8c360d98a6496fb7a8324d9e7670'),
 ('public.lock_knowledge_extraction_authority(uuid,uuid)','788d27bc980fee58e6272c3e53ca6096','62bfaef3ba7a5a3ce0cca0ca1a36b922'),
 ('public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','615d47584f14264053a80397dcce74ee','a7a51c6e07496a9b8103737eea7aa9d4'),
 ('public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','c875eff4e94775dfeb6e140957d47507','a435f61e5693496b044d8d7f23d21d32')
 ) v(signature,body_hash,definition_hash) LOOP
  IF to_regprocedure(e.signature) IS NULL THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=to_regprocedure(e.signature);
  IF md5(f.prosrc)<>e.body_hash OR md5(pg_get_functiondef(f.oid))<>e.definition_hash OR f.proowner<>'postgres'::regrole
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner OR a.is_grantable
      OR (a.grantee<>f.proowner AND NOT(a.grantee='service_role'::regrole AND e.signature IN
       ('public.execute_crm_command_reversible(uuid,uuid,jsonb,text)','public.read_crm_command_result(uuid,uuid,jsonb,text)','public.lock_knowledge_extraction_authority(uuid,uuid)'))))
   OR (e.signature IN ('public.execute_crm_command_reversible(uuid,uuid,jsonb,text)','public.read_crm_command_result(uuid,uuid,jsonb,text)','public.lock_knowledge_extraction_authority(uuid,uuid)')
     AND NOT has_function_privilege('service_role',f.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN ('inspect_business_mission_task_result','lock_business_mission_task_source'))
  OR EXISTS(SELECT 1 FROM public.tasks WHERE metadata ? 'mission_source_v1')
  OR EXISTS(SELECT 1 FROM public.crm_command_results WHERE result ? 'mission_source_v1' OR result#>'{readback,metadata,mission_source_v1}' IS NOT NULL) THEN
  RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
END $guard$;
-- Private admission inside the ORIGINAL governed Task writer; no public read or effect.
CREATE FUNCTION public.inspect_business_mission_task_result(p_tenant uuid,p_actor uuid,p_mission uuid,p_step uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $inspect$
DECLARE prior public.crm_command_results; current_task public.tasks; matches integer;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'CRM_INTERNAL_EXECUTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO matches FROM public.crm_command_results r WHERE r.tenant_id=p_tenant AND r.action='task.create'
  AND r.result#>>'{mission_source_v1,missionId}'=p_mission::text AND r.result#>>'{mission_source_v1,stepId}'=p_step::text;
 IF matches=0 THEN RETURN jsonb_build_object('inspection',true,'status','not_created'); END IF;
 IF matches<>1 THEN RETURN jsonb_build_object('inspection',true,'status','ambiguous'); END IF;
 SELECT * INTO STRICT prior FROM public.crm_command_results r WHERE r.tenant_id=p_tenant AND r.action='task.create'
  AND r.result#>>'{mission_source_v1,missionId}'=p_mission::text AND r.result#>>'{mission_source_v1,stepId}'=p_step::text FOR SHARE;
 SELECT * INTO current_task FROM public.tasks t WHERE t.tenant_id=p_tenant AND t.id=(prior.result#>>'{readback,id}')::uuid FOR SHARE;
 IF NOT FOUND OR NOT public.crm_actor_can_access_record(p_tenant,p_actor,'task',current_task.id) THEN
  RETURN jsonb_build_object('inspection',true,'status','historical_unavailable'); END IF;
 RETURN jsonb_build_object('inspection',true,'status','available','origin',prior.result->'mission_source_v1',
  'receipt',jsonb_build_object('correlation_id',prior.result->'correlation_id','receipt_recorded',prior.result->'receipt_recorded','created_at',prior.created_at),
  'task',jsonb_build_object('id',current_task.id,'tenant_id',current_task.tenant_id,'title',current_task.title,'description',current_task.description,
    'status',current_task.status,'assignee_user_id',current_task.user_id,'due_date',current_task.due_date,'updated_at',current_task.updated_at));
END $inspect$;
REVOKE ALL ON FUNCTION public.inspect_business_mission_task_result(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lock_business_mission_task_source(p_tenant uuid,p_actor uuid,p_binding jsonb,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $admit$
DECLARE mission public.business_missions; brief public.business_mission_brief_versions; doc public.tenant_knowledge_docs;
 intent jsonb; step jsonb; source_ref jsonb; quote jsonb; previous jsonb; schedule jsonb;
 selected_mission uuid; selected_step uuid; due_at timestamptz; refs jsonb:='[]'::jsonb;
BEGIN
 -- Caller is the existing service-only writer AFTER its tenant/actor/assignee locks.
 IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL OR p_tenant IS NULL OR p_actor IS NULL THEN
  RAISE EXCEPTION 'CRM_INTERNAL_EXECUTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object' OR NOT(p_binding ?& ARRAY['contractVersion','missionId','missionRevision','briefVersion','intentSha256','stepId','schedule'])
  OR (SELECT count(*) FROM jsonb_object_keys(p_binding))<>7 OR p_binding->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(p_binding->'missionId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_binding->'stepId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_binding->'missionRevision') IS DISTINCT FROM 'number' OR jsonb_typeof(p_binding->'briefVersion') IS DISTINCT FROM 'number'
  OR (p_binding->>'missionRevision' COLLATE pg_catalog."C") !~ '^[1-9][0-9]{0,9}$'
  OR (p_binding->>'briefVersion' COLLATE pg_catalog."C") !~ '^[1-9][0-9]{0,9}$'
  OR (p_binding->>'missionRevision')::numeric>2147483647 OR (p_binding->>'briefVersion')::numeric>2147483647
  OR jsonb_typeof(p_binding->'intentSha256') IS DISTINCT FROM 'string' OR (p_binding->>'intentSha256' COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_MISSION_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 selected_mission:=(p_binding->>'missionId')::uuid;selected_step:=(p_binding->>'stepId')::uuid;
 IF selected_mission::text IS DISTINCT FROM p_binding->>'missionId' OR selected_step::text IS DISTINCT FROM p_binding->>'stepId' THEN
  RAISE EXCEPTION 'CRM_MISSION_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 -- Existing tenant FOR UPDATE serializes this check AND Task/result insert across actors.
 previous:=public.inspect_business_mission_task_result(p_tenant,p_actor,selected_mission,selected_step);
 IF previous->>'status'='available' THEN RAISE EXCEPTION 'CRM_MISSION_TASK_EXISTS' USING ERRCODE='23505'; END IF;
 IF previous->>'status'<>'not_created' THEN RAISE EXCEPTION 'CRM_MISSION_PREVIOUS_EFFECT_UNAVAILABLE' USING ERRCODE='23505'; END IF;
 IF NOT public.lock_knowledge_extraction_authority(p_actor,p_tenant) THEN RAISE EXCEPTION 'CRM_MISSION_SOURCE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT public.is_tenant_owner(p_actor,p_tenant) OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN
  RAISE EXCEPTION 'CRM_MISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO mission FROM public.business_missions m WHERE m.id=selected_mission AND m.tenant_id=p_tenant FOR SHARE;
 IF NOT FOUND OR mission.revision IS DISTINCT FROM (p_binding->>'missionRevision')::integer THEN RAISE EXCEPTION 'CRM_MISSION_PLAN_CHANGED' USING ERRCODE='40001'; END IF;
 IF mission.lifecycle_state<>'active' THEN RAISE EXCEPTION 'CRM_MISSION_NOT_ACTIVE' USING ERRCODE='22023'; END IF;
 SELECT * INTO brief FROM public.business_mission_brief_versions b WHERE b.mission_id=selected_mission AND b.tenant_id=p_tenant ORDER BY b.version DESC LIMIT 1 FOR SHARE;
 IF NOT FOUND OR brief.version IS DISTINCT FROM (p_binding->>'briefVersion')::integer OR brief.document_work_intent IS NULL
  OR encode(sha256(convert_to(brief.document_work_intent::text,'UTF8')),'hex') IS DISTINCT FROM p_binding->>'intentSha256' THEN
  RAISE EXCEPTION 'CRM_MISSION_PLAN_CHANGED' USING ERRCODE='40001'; END IF;
 intent:=public.normalize_business_mission_document_intent(p_tenant,brief.document_work_intent);
 SELECT value INTO step FROM jsonb_array_elements(intent->'steps') WHERE value->>'id'=selected_step::text;
 IF NOT FOUND OR jsonb_typeof(p_patch->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_patch->'description') IS DISTINCT FROM 'string'
  OR btrim(p_patch->>'title') IS DISTINCT FROM step->>'title' OR btrim(p_patch->>'description') IS DISTINCT FROM step->>'description'
  OR (p_patch->>'assignee_user_id')::uuid IS DISTINCT FROM coalesce(nullif(step->'proposedTask'->>'assigneeUserId','')::uuid,p_actor)
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('title','description','assignee_user_id','due_date','metadata'))
  OR p_patch->'metadata' IS DISTINCT FROM jsonb_build_object('mission_source_v1',p_binding) THEN
  RAISE EXCEPTION 'CRM_MISSION_STEP_CHANGED' USING ERRCODE='40001'; END IF;
 schedule:=p_binding->'schedule';
 IF jsonb_typeof(schedule) IS DISTINCT FROM 'object' OR NOT(schedule ?& ARRAY['dueAt','timeZone','reason'])
  OR (SELECT count(*) FROM jsonb_object_keys(schedule))<>3 THEN RAISE EXCEPTION 'CRM_MISSION_SCHEDULE_INVALID' USING ERRCODE='22023'; END IF;
 IF schedule->'dueAt'='null'::jsonb THEN
  IF schedule->'timeZone' IS DISTINCT FROM 'null'::jsonb OR schedule->'reason' IS DISTINCT FROM 'null'::jsonb OR nullif(p_patch->>'due_date','') IS NOT NULL THEN
   RAISE EXCEPTION 'CRM_MISSION_SCHEDULE_INVALID' USING ERRCODE='22023'; END IF;
 ELSE
  IF jsonb_typeof(schedule->'dueAt') IS DISTINCT FROM 'string' OR (schedule->>'dueAt' COLLATE pg_catalog."C") !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   OR jsonb_typeof(schedule->'timeZone') IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=schedule->>'timeZone')
   OR jsonb_typeof(schedule->'reason') IS DISTINCT FROM 'string' OR length(btrim(schedule->>'reason')) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'CRM_MISSION_SCHEDULE_INVALID' USING ERRCODE='22023'; END IF;
  due_at:=(schedule->>'dueAt')::timestamptz;
  IF due_at IS DISTINCT FROM (p_patch->>'due_date')::timestamptz THEN RAISE EXCEPTION 'CRM_MISSION_SCHEDULE_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 FOR source_ref IN SELECT value FROM jsonb_array_elements(intent->'sources') ORDER BY value->'reference'->>'documentId' LOOP
  SELECT * INTO doc FROM public.tenant_knowledge_docs d WHERE d.id=(source_ref->'reference'->>'documentId')::uuid AND d.tenant_id=p_tenant AND d.record_state='canonical' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_MISSION_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF doc.revision::text IS DISTINCT FROM source_ref->'reference'->>'revision' OR doc.title IS DISTINCT FROM source_ref->>'title'
   OR encode(sha256(convert_to(doc.content,'UTF8')),'hex') IS DISTINCT FROM source_ref->'reference'->>'contentSha256' THEN
   RAISE EXCEPTION 'CRM_MISSION_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  FOR quote IN SELECT value FROM jsonb_array_elements(source_ref->'excerpts') LOOP
   IF NOT public.knowledge_utf16_excerpt_matches(doc.content,(quote->>'start')::integer,(quote->>'end')::integer,quote->>'text') THEN
    RAISE EXCEPTION 'CRM_MISSION_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  END LOOP;
  refs:=refs||jsonb_build_array(source_ref->'reference');
 END LOOP;
 -- Recheck actual owner predicate after any source lock wait; no copied claims.
 IF NOT public.is_tenant_owner(p_actor,p_tenant) THEN RAISE EXCEPTION 'CRM_MISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN p_binding||jsonb_build_object('sources',refs,'basis',step->'basis','dueOn',step->'dueOn','dependencies',step->'dependencies');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'CRM_MISSION_SOURCE_INVALID' USING ERRCODE='22023';
 WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'CRM_MISSION_SCHEDULE_INVALID' USING ERRCODE='22023';
 WHEN deadlock_detected THEN RAISE EXCEPTION 'CRM_MISSION_SOURCE_BUSY' USING ERRCODE='40001';
END $admit$;
REVOKE ALL ON FUNCTION public.lock_business_mission_task_source(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.execute_crm_command_reversible(uuid,uuid,jsonb,text)'::regprocedure);
 IF (length(d)-length(replace(d,$old0$  v_result jsonb;$old0$,'')))/length($old0$  v_result jsonb;$old0$)<>1 THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
 d:=replace(d,$old0$  v_result jsonb;$old0$,$new0$  v_mission_origin jsonb;
  v_result jsonb;$new0$);
 IF (length(d)-length(replace(d,$old1$    perform pg_catalog.set_config('app.suppress_task_assignment_notification','on',true);
    insert into public.tasks$old1$,'')))/length($old1$    perform pg_catalog.set_config('app.suppress_task_assignment_notification','on',true);
    insert into public.tasks$old1$)<>1 THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
 d:=replace(d,$old1$    perform pg_catalog.set_config('app.suppress_task_assignment_notification','on',true);
    insert into public.tasks$old1$,$new1$    if v_patch->'metadata' ? 'mission_source_v1' then
      v_mission_origin:=public.lock_business_mission_task_source(v_tenant,v_actor,v_patch->'metadata'->'mission_source_v1',v_patch);
      v_patch:=jsonb_set(v_patch,'{metadata}',(v_patch->'metadata')-'mission_source_v1');
    end if;
    perform pg_catalog.set_config('app.suppress_task_assignment_notification','on',true);
    insert into public.tasks$new1$);
 IF (length(d)-length(replace(d,$old2$    if v_action = 'task.update' then
$old2$,'')))/length($old2$    if v_action = 'task.update' then
$old2$)<>1 THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
 d:=replace(d,$old2$    if v_action = 'task.update' then
$old2$,$new2$    if v_action = 'task.update' then
      if v_patch->'metadata' ? 'mission_source_v1' then raise exception 'CRM_MISSION_ORIGIN_RESERVED' using errcode='22023'; end if;
$new2$);
 IF (length(d)-length(replace(d,$old3$  insert into public.crm_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,action,result)$old3$,'')))/length($old3$  insert into public.crm_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,action,result)$old3$)<>1 THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
 d:=replace(d,$old3$  insert into public.crm_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,action,result)$old3$,$new3$  if v_mission_origin is not null then v_result:=v_result||jsonb_build_object('mission_source_v1',v_mission_origin); end if;
  insert into public.crm_command_results(tenant_id,idempotency_key,command_hash,actor_user_id,action,result)$new3$);
 EXECUTE d;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.execute_crm_command_reversible(uuid,uuid,jsonb,text)'::regprocedure))<>'18ab20fa7779aae51ca903d9e8b970e5' THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
END $patch$;
DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)'::regprocedure);
 IF (length(d)-length(replace(d,$old0$  -- Preview-bound destructive commands$old0$,'')))/length($old0$  -- Preview-bound destructive commands$old0$)<>1 THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
 d:=replace(d,$old0$  -- Preview-bound destructive commands$old0$,$new0$  if _command->>'action'='task.inspect_mission_result' then
    if (select count(*) from pg_catalog.jsonb_object_keys(_command))<>3
      or not(_command ?& array['action','mission_id','step_id'])
      or pg_catalog.jsonb_typeof(_command->'mission_id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(_command->'step_id') is distinct from 'string'
      or (_command->>'mission_id' collate pg_catalog."C") !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (_command->>'step_id' collate pg_catalog."C") !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'CRM_MISSION_SOURCE_INVALID' using errcode='22023'; end if;
    return public.inspect_business_mission_task_result(_tenant_id,_actor_id,(_command->>'mission_id')::uuid,(_command->>'step_id')::uuid);
  end if;
  -- Preview-bound destructive commands$new0$);
 EXECUTE d;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)'::regprocedure))<>'66c93114f819b42771fd7aecbbb6ed9f' THEN RAISE EXCEPTION 'CRM_MISSION_INSTALL_DRIFT'; END IF;
END $patch$;
COMMIT;
