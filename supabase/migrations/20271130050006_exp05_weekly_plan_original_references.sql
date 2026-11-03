-- ONE original E05 Planning-stage extension; no writer, post, approval or history policy change.
-- Existing source/owner/ABI/ACL/limits retained. Fresh readback source437b5c12 on Nov3.
begin;
do $weekly_plan_links$
declare definition text;
begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure) is distinct from '437b5c12b5261b73a38e6a34104c5387' then
  raise exception 'WEEKLY_PLAN_REFERENCE_SOURCE_CHANGED'; end if;
 select pg_get_functiondef('public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,$old0$WHERE value->>'record_kind'='planning_item' OR value->>'destination'='calendar'$old0$,'')))/length($old0$WHERE value->>'record_kind'='planning_item' OR value->>'destination'='calendar'$old0$) <> 1 then raise exception 'WEEKLY_PLAN_REFERENCE_ANCHOR_CHANGED'; end if;
 definition:=replace(definition,$old0$WHERE value->>'record_kind'='planning_item' OR value->>'destination'='calendar'$old0$,$new0$WHERE value->>'record_kind' IN ('planning_item','planning_plan') OR value->>'destination' IN ('calendar','operations_weekly_plan')$new0$);
 if (length(definition)-length(replace(definition,$old1$link->>'record_kind' IS DISTINCT FROM 'planning_item'$old1$,'')))/length($old1$link->>'record_kind' IS DISTINCT FROM 'planning_item'$old1$) <> 1 then raise exception 'WEEKLY_PLAN_REFERENCE_ANCHOR_CHANGED'; end if;
 definition:=replace(definition,$old1$link->>'record_kind' IS DISTINCT FROM 'planning_item'$old1$,$new1$coalesce(link->>'record_kind','') NOT IN ('planning_item','planning_plan')$new1$);
 if (length(definition)-length(replace(definition,$old2$'operations_work','business_time_zone','executive','calendar'$old2$,'')))/length($old2$'operations_work','business_time_zone','executive','calendar'$old2$) <> 1 then raise exception 'WEEKLY_PLAN_REFERENCE_ANCHOR_CHANGED'; end if;
 definition:=replace(definition,$old2$'operations_work','business_time_zone','executive','calendar'$old2$,$new2$'operations_work','operations_weekly_plan','business_time_zone','executive','calendar'$new2$);
 if (length(definition)-length(replace(definition,$old3$  IF dest='calendar' AND$old3$,'')))/length($old3$  IF dest='calendar' AND$old3$) <> 1 then raise exception 'WEEKLY_PLAN_REFERENCE_ANCHOR_CHANGED'; end if;
 definition:=replace(definition,$old3$  IF dest='calendar' AND$old3$,$new3$  IF dest='operations_weekly_plan' AND (planning IS NULL OR jsonb_typeof(link->'record_id') IS DISTINCT FROM 'null') THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  IF dest='calendar' AND$new3$);
 if (length(definition)-length(replace(definition,$old4$     ELSE t.agent_key='zion' AND$old4$,'')))/length($old4$     ELSE t.agent_key='zion' AND$old4$) <> 1 then raise exception 'WEEKLY_PLAN_REFERENCE_ANCHOR_CHANGED'; end if;
 definition:=replace(definition,$old4$     ELSE t.agent_key='zion' AND$old4$,$new4$     WHEN link->>'record_kind'='planning_plan' THEN planning IS NOT NULL
      AND planning->'plans' @> jsonb_build_array(ref)
     ELSE t.agent_key='zion' AND$new4$);
 if (length(definition)-length(replace(definition,$old5$jsonb_build_object('record_kind','planning_item')$old5$,'')))/length($old5$jsonb_build_object('record_kind','planning_item')$old5$) <> 1 then raise exception 'WEEKLY_PLAN_REFERENCE_ANCHOR_CHANGED'; end if;
 definition:=replace(definition,$old5$jsonb_build_object('record_kind','planning_item')$old5$,$new5$jsonb_build_object('record_kind',link->>'record_kind')$new5$);
 execute definition;
end $weekly_plan_links$;
commit;
