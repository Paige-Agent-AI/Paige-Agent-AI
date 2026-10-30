begin;

-- Correct one exact saved draft/paused step through its original controller.
-- A configuration audit is not a Task/Rail result. This never enables work.
do $revision$
declare installed record; spec record; patched text; restored text; metadata jsonb;
  replay boolean;
begin
  select p.*,pg_get_functiondef(p.oid) as definition into strict installed from pg_proc p
    where p.oid='public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)'::regprocedure;
  if installed.proowner<>'postgres'::regrole or not installed.prosecdef
    or installed.proconfig is distinct from array['search_path=""']::text[]
    or not has_function_privilege('authenticated',installed.oid,'EXECUTE')
    or has_function_privilege('anon',installed.oid,'EXECUTE')
    or has_function_privilege('service_role',installed.oid,'EXECUTE')
    or exists(select 1 from aclexplode(coalesce(installed.proacl,acldefault('f',installed.proowner))) a
      where a.grantee not in (installed.proowner,'authenticated'::regrole)) then
    raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: original control authority changed';
  end if;
  if not exists(select 1 from pg_proc p where p.oid='public._owner_task_literal_chain_supported(jsonb)'::regprocedure
    and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='i'
    and p.proconfig=array['search_path=""']::text[] and md5(p.prosrc)='ea7a87e7f5e22571111e6c73cb9f3d3a'
    and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)) then
    raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: original literal-chain predicate changed';
  end if;
  metadata:=(to_jsonb(installed)-'prosrc'-'definition'-'proargdefaults')
    ||jsonb_build_object('proargdefaults',pg_get_expr(installed.proargdefaults,0));
  replay:=position('owner_task_step_revision_v1' in installed.prosrc)>0;
  if not replay and md5(installed.prosrc)<>'4715db485e40d36cd222e2fcc7f5903f' then
    raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: original control body changed';
  end if;
  patched:=installed.prosrc; restored:=installed.prosrc;
  for spec in select * from(values
    ($old_decl$  p public.paige_automations; a public.paige_automation_acts; acts jsonb; n integer; changed boolean:=false;$old_decl$,
     $new_decl$  p public.paige_automations; a public.paige_automation_acts; acts jsonb; n integer; changed boolean:=false;
  revision_data jsonb; revision_act uuid; revision_config jsonb; original_config jsonb;
  revision_acts jsonb; revision_audit jsonb;$new_decl$),
    ($old_input$  if _action is null or _action not in ('arm','pause') or _automation_id is null$old_input$,
     $new_input$  -- owner_task_step_revision_v1: normalize only this closed nonexecuting operation.
  if _action='revise_step' then
    if jsonb_typeof(_expected_acts) is distinct from 'object' then
      raise exception 'OWNER_TASK_CONTROL_INVALID' using errcode='22023';
    end if;
    if jsonb_typeof(_expected_acts->'reviewed_acts') is distinct from 'array'
      or jsonb_typeof(_expected_acts->'revision') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(_expected_acts) k where k not in ('reviewed_acts','revision')) then
      raise exception 'OWNER_TASK_CONTROL_INVALID' using errcode='22023';
    end if;
    if jsonb_array_length(_expected_acts->'reviewed_acts') not between 1 and 20 then
      raise exception 'OWNER_TASK_CONTROL_UNSUPPORTED' using errcode='22023';
    end if;
    revision_data:=_expected_acts->'revision';
    if jsonb_typeof(revision_data->'act_id') is distinct from 'string'
      or (revision_data->>'act_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(revision_data->'config') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(revision_data) k where k not in ('act_id','config')) then
      raise exception 'OWNER_TASK_CONTROL_INVALID' using errcode='22023';
    end if;
    revision_act:=(revision_data->>'act_id')::uuid; revision_config:=revision_data->'config';
    _expected_acts:=_expected_acts->'reviewed_acts';
  end if;
  if _action is null or _action not in ('arm','pause','revise_step') or _automation_id is null$new_input$),
    ($old_arm$  if _action='arm' then$old_arm$,
     $new_arm$  if _action='revise_step' then
    if p.state::text not in ('draft','paused') or p.owner_task_armed_at is not null
      or p.created_by is null or p.trigger_config<>'{}'::jsonb or p.conditions<>'[]'::jsonb
      or not exists(select 1 from public.tenants where id=tenant and account_type::text='standalone'
        and parent_tenant_id is null and not public.is_company_workspace(id) and archived_at is null
        and status::text in ('active','trial','past_due') for share nowait) then
      raise exception 'OWNER_TASK_CONTROL_UNSUPPORTED' using errcode='22023';
    end if;
    select source->'config' into original_config from jsonb_array_elements(acts) as x(source)
      where source->>'id'=revision_act::text;
    if original_config is null then
      raise exception 'OWNER_TASK_CONTROL_UNSUPPORTED' using errcode='22023';
    end if;
    select jsonb_agg(case when source->>'id'=revision_act::text
        then jsonb_set(source,'{config}',revision_config,false) else source end order by position)
      into revision_acts from jsonb_array_elements(acts) with ordinality as x(source,position);
    if not public._owner_task_literal_chain_supported(revision_acts) then
      raise exception 'OWNER_TASK_CONTROL_UNSUPPORTED' using errcode='22023';
    end if;
    if revision_acts is distinct from acts then
      update public.paige_automation_acts set config=revision_config where id=revision_act and automation_id=p.id;
      if not found then raise exception 'OWNER_TASK_CONTROL_STALE' using errcode='40001'; end if;
      select * into p from public.paige_automations where id=_automation_id and tenant_id=tenant;
      select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'position',x.position,
        'action_kind',x.action_kind,'tool_key',x.tool_key,'config',x.config) order by x.position,x.id),'[]'::jsonb)
        into acts from public.paige_automation_acts x where automation_id=p.id;
      if acts is distinct from revision_acts or p.updated_at is not distinct from _expected_updated_at
        or public._owner_task_process_review(p) is distinct from _expected_process then
        raise exception 'OWNER_TASK_CONTROL_STALE' using errcode='40001';
      end if;
      changed:=true;
    end if;
  elsif _action='arm' then$new_arm$),
    ($old_audit$  if changed then
    insert into public.audit_logs(user_id,action,entity,entity_id,data)$old_audit$,
     $new_audit$  if changed and _action='revise_step' then
    insert into public.audit_logs(user_id,action,entity,entity_id,data)
      values(actor,'owner_task_automation.revise_step','paige_automation',p.id,jsonb_build_object(
        'tenant_id',tenant,'state',p.state,'granted_lane',p.granted_lane,'armed_at',p.owner_task_armed_at,
        'updated_at',p.updated_at,'act_id',revision_act,'previous_config_hash',md5(original_config::text),
        'config_hash',md5(revision_config::text),'future_events_only',true,'execution_started',false))
      returning to_jsonb(id) into revision_audit;
  elsif changed then
    insert into public.audit_logs(user_id,action,entity,entity_id,data)$new_audit$),
    ($old_result$    'acts',acts,'changed',changed,'future_events_only',true,'execution_started',false);$old_result$,
     $new_result$    'acts',acts,'changed',changed,'future_events_only',true,'execution_started',false)
    ||case when _action='revise_step' then jsonb_build_object('configuration_audit_id',revision_audit) else '{}'::jsonb end;$new_result$)
  ) as s(old_text,new_text)
  loop
    if replay then
      if (length(restored)-length(replace(restored,spec.new_text,'')))/length(spec.new_text)<>1 then
        raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: incomplete correction extension';
      end if;
      restored:=replace(restored,spec.new_text,spec.old_text);
    else
      if (length(patched)-length(replace(patched,spec.old_text,'')))/length(spec.old_text)<>1 then
        raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: original control span changed';
      end if;
      patched:=replace(patched,spec.old_text,spec.new_text);
    end if;
  end loop;
  if replay then
    if md5(restored)<>'4715db485e40d36cd222e2fcc7f5903f' then
      raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: unrelated source changed';
    end if;
    return;
  end if;
  execute replace(installed.definition,installed.prosrc,patched);
  if (select (to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(proargdefaults,0))
      from pg_proc p where oid=installed.oid) is distinct from metadata
    or (select prosrc from pg_proc where oid=installed.oid) is distinct from patched then
    raise exception 'OWNER_TASK_REVISION_SOURCE_DRIFT: original control identity or metadata changed';
  end if;
end $revision$;

commit;
