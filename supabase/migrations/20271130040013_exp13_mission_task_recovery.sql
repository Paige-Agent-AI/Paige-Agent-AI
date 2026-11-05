-- Read-only recovery of ORIGINAL creating results after source redaction.
-- Preserve both already Preview-applied E13 carriers and every effect/approval gate.
BEGIN;
DO $guard$
DECLARE f record;e record;
BEGIN
 FOR e IN SELECT * FROM(VALUES
 ('public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)','66c93114f819b42771fd7aecbbb6ed9f','872269f03b6c53d340a050448b0b4fdf',true),
 ('public.inspect_business_mission_task_result(uuid,uuid,uuid,uuid)','b5faa103462399cc5fbeea83a9867516','0f2256cadb94b59328eb28c897b960a9',false)
 )v(signature,body_hash,definition_hash,definer) LOOP
  IF to_regprocedure(e.signature) IS NULL THEN RAISE EXCEPTION 'CRM_MISSION_RECOVERY_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=to_regprocedure(e.signature);
  IF md5(f.prosrc)<>e.body_hash OR md5(pg_get_functiondef(f.oid))<>e.definition_hash OR f.proowner<>'postgres'::regrole
   OR f.prosecdef IS DISTINCT FROM e.definer OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner
    OR a.grantor<>f.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN RAISE EXCEPTION 'CRM_MISSION_RECOVERY_INSTALL_DRIFT'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='inspect_business_mission_task_results') THEN
  RAISE EXCEPTION 'CRM_MISSION_RECOVERY_INSTALL_DRIFT'; END IF;
END $guard$;
CREATE FUNCTION public.inspect_business_mission_task_results(p_tenant uuid,p_actor uuid,p_mission uuid,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $list$
DECLARE s record;item jsonb;items jsonb:='[]'::jsonb;shown integer:=0;more boolean:=false;
BEGIN
 -- Called only after the ORIGINAL private reader's tenant/profile/owner-admin locks.
 IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'CRM_INTERNAL_EXECUTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_tenant IS NULL OR p_actor IS NULL OR p_mission IS NULL OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'CRM_MISSION_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT r.result#>>'{mission_source_v1,stepId}' AS step_id,min(r.created_at) AS first_created
  FROM public.crm_command_results r WHERE r.tenant_id=p_tenant AND r.action='task.create' AND r.result#>>'{mission_source_v1,missionId}'=p_mission::text
  GROUP BY r.result#>>'{mission_source_v1,stepId}' ORDER BY first_created,step_id LIMIT 21 OFFSET p_offset LOOP
  IF shown=20 THEN more:=true;EXIT; END IF;
  item:=public.inspect_business_mission_task_result(p_tenant,p_actor,p_mission,s.step_id::uuid);
  -- Task summary only. Raw source and historical Task description are never enumerated.
  IF item->>'status'='available' THEN item:=jsonb_set(item,'{task}',(item->'task')-'description'); END IF;
  items:=items||jsonb_build_array(jsonb_build_object('stepId',s.step_id)||item);shown:=shown+1;
 END LOOP;
 RETURN jsonb_build_object('listing',true,'missionId',p_mission,'offset',p_offset,'records',items,'has_more',more,'next_offset',CASE WHEN more THEN p_offset+shown ELSE NULL END);
END $list$;
REVOKE ALL ON FUNCTION public.inspect_business_mission_task_results(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE d text;old text:=$old$  if _command->>'action'='task.inspect_mission_result' then
$old$;addition text:=$new$  if _command->>'action'='task.inspect_mission_result' then
    if _command ? 'offset' then
      if (select count(*) from pg_catalog.jsonb_object_keys(_command))<>3 or not(_command ?& array['action','mission_id','offset'])
       or pg_catalog.jsonb_typeof(_command->'mission_id') is distinct from 'string'
       or (_command->>'mission_id' collate pg_catalog."C") !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(_command->'offset') is distinct from 'number'
       or (_command->>'offset' collate pg_catalog."C") !~ '^(0|[1-9][0-9]{0,9})$' or (_command->>'offset')::numeric>2147483647 then
       raise exception 'CRM_MISSION_SOURCE_INVALID' using errcode='22023'; end if;
      return public.inspect_business_mission_task_results(_tenant_id,_actor_id,(_command->>'mission_id')::uuid,(_command->>'offset')::integer);
    end if;
$new$;
BEGIN
 d:=pg_get_functiondef('public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)'::regprocedure);
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'CRM_MISSION_RECOVERY_INSTALL_DRIFT'; END IF;
 EXECUTE replace(d,old,addition);
END $patch$;
DO $verify$
DECLARE f record;
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)'::regprocedure))<>'9fae5fa40c050629239b24e852e683b9' THEN
  RAISE EXCEPTION 'CRM_MISSION_RECOVERY_INSTALL_DRIFT'; END IF;
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.inspect_business_mission_task_results(uuid,uuid,uuid,integer)'::regprocedure;
 IF md5(f.prosrc)<>'1e2dfbc219dea8ba153b69b1b4d80026' OR f.proowner<>'postgres'::regrole OR f.prosecdef OR f.provolatile<>'v' OR f.proparallel<>'u'
  OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR f.prorettype<>'jsonb'::regtype
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner OR a.grantor<>f.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
  RAISE EXCEPTION 'CRM_MISSION_RECOVERY_INSTALL_DRIFT'; END IF;
END $verify$;
COMMIT;
