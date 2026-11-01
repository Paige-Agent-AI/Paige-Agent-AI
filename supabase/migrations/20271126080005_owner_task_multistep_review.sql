begin;

-- Extend the existing internal-task vertical, not the event engine or autonomy.
-- The complete ordered chain is reviewed; every occurrence/act still needs its
-- own original approval and native Task/receipt. No dependency completion order
-- or external/provider action is introduced by a recorded position.
do $helper_guard$
declare p record;
begin
  select * into p from pg_proc where oid=to_regprocedure('public._owner_task_literal_chain_supported(jsonb)');
  if found and (p.proowner<>'postgres'::regrole or p.prosecdef or p.provolatile<>'i'
    or p.proconfig is distinct from array['search_path=""']::text[]
    or md5(p.prosrc)<>'ea7a87e7f5e22571111e6c73cb9f3d3a'
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)) then
    raise exception 'OWNER_TASK_MULTISTEP_SOURCE_DRIFT: private literal-chain predicate changed';
  end if;
end $helper_guard$;

create or replace function public._owner_task_literal_chain_supported(_chain jsonb)
returns boolean language sql immutable security invoker set search_path='' as $chain$
  select case
    when jsonb_typeof(_chain) is distinct from 'array' then false
    when jsonb_array_length(_chain) not between 1 and 20 then false
    else (select count(distinct step->>'id')=jsonb_array_length(_chain) from jsonb_array_elements(_chain) as x(step))
      and not exists(
        select 1 from jsonb_array_elements(_chain) with ordinality as x(step,position)
        where case
          when jsonb_typeof(step) is distinct from 'object' then true
          when jsonb_typeof(step->'id') is distinct from 'string'
            or step->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or step->'position' is distinct from to_jsonb(position)
            or step->>'action_kind' is distinct from 'owner.task'
            or step->'tool_key' is distinct from 'null'::jsonb then true
          when jsonb_typeof(step->'config') is distinct from 'object' then true
          else jsonb_typeof(step->'config'->'title') is distinct from 'string'
            or length(btrim(step->'config'->>'title')) not between 1 and 500
            or (step->'config' ? 'description' and (
              jsonb_typeof(step->'config'->'description') is distinct from 'string'
              or length(step->'config'->>'description')>10000))
            or exists(select 1 from jsonb_object_keys(step) k where k not in ('id','position','action_kind','tool_key','config'))
            or exists(select 1 from jsonb_object_keys(step->'config') k where k not in ('title','description'))
            or (step->'config'->>'title') ~ '(\{\{|\$\{|\{%|<%)'
            or coalesce(step->'config'->>'description','') ~ '(\{\{|\$\{|\{%|<%)'
          end)
    end;
$chain$;
revoke all on function public._owner_task_literal_chain_supported(jsonb) from public,anon,authenticated,service_role;

do $multistep$
declare spec record; installed record; metadata jsonb; restored text;
begin
  for spec in select * from (values
    ('public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)',
      '482c0d9a996d45f084dc46067519f7c4',true,
      'if n<>1 or a.position<>1',
      $new_control$if /* owner_task_multistep_v1 */ not public._owner_task_literal_chain_supported(acts)
      or (n>1 and not exists(select 1 from public.tenants where id=tenant
        and account_type::text='standalone' and parent_tenant_id is null
        and not public.is_company_workspace(id) for share nowait)) or a.position<>1$new_control$),
    ('public._owner_task_source_snapshot(uuid,uuid)',
      'f87fb95e2b6c02009b73a68468183dba',false,
      'if p.id is null or a.id is null or n<>1',
      $new_snapshot$if p.id is null or a.id is null or /* owner_task_multistep_v1 */ not public._owner_task_literal_chain_supported(chain)
    or (n>1 and not exists(select 1 from public.tenants where id=p.tenant_id
      and account_type::text='standalone' and parent_tenant_id is null
      and not public.is_company_workspace(id) for share nowait))$new_snapshot$),
    ('public.paige_owner_task_hold_context()',
      '57bfcbd265264ddcb93051fa5f8050ea',false,
      $old_hold$snap#>>'{acts,0,id}' is distinct from new.act_id::text or snap#>>'{acts,0,position}' is distinct from new.act_position::text
        or snap#>'{acts,0,config}' is distinct from new.detail->'snapshot_args'$old_hold$,
      $new_hold$/* owner_task_multistep_v1 */ (select source_act from pg_catalog.jsonb_array_elements(snap->'acts') as source(source_act)
          where source_act->>'id'=new.act_id::text and source_act->'position'=to_jsonb(new.act_position))
        is distinct from jsonb_build_object('id',new.act_id,'position',new.act_position,'action_kind','owner.task',
          'tool_key',null,'config',new.detail->'snapshot_args')$new_hold$),
    ('public._read_owner_task_act(uuid,uuid,text)',
      'ee93f5e2c3bd3ad46a06e4a2823cc2f5',false,
      $old_read$l.detail#>'{owner_task_source,acts,0,config}' is distinct from l.detail->'snapshot_args'$old_read$,
      $new_read$/* owner_task_multistep_v1 */ (select source_act from pg_catalog.jsonb_array_elements(l.detail#>'{owner_task_source,acts}') as source(source_act)
        where source_act->>'id'=l.act_id::text and source_act->'position'=to_jsonb(l.act_position))
      is distinct from jsonb_build_object('id',l.act_id,'position',l.act_position,'action_kind','owner.task',
        'tool_key',null,'config',l.detail->'snapshot_args')$new_read$)
  ) as s(signature,known_source,authenticated_execute,old_text,new_text)
  loop
    select p.*,pg_get_functiondef(p.oid) as definition into strict installed
      from pg_proc p where p.oid=spec.signature::regprocedure;
    if installed.proowner<>'postgres'::regrole or not installed.prosecdef
      or installed.proconfig is distinct from array['search_path=""']::text[]
      or has_function_privilege('authenticated',installed.oid,'EXECUTE') is distinct from spec.authenticated_execute
      or has_function_privilege('anon',installed.oid,'EXECUTE')
      or has_function_privilege('service_role',installed.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(installed.proacl,acldefault('f',installed.proowner))) a
        where a.grantee<>installed.proowner and (not spec.authenticated_execute or a.grantee<>'authenticated'::regrole)) then
      raise exception 'OWNER_TASK_MULTISTEP_SOURCE_DRIFT: native authority metadata changed';
    end if;
    metadata:=(to_jsonb(installed)-'prosrc'-'proargdefaults'-'definition')
      || jsonb_build_object('proargdefaults',pg_get_expr(installed.proargdefaults,0));
    if position('owner_task_multistep_v1' in installed.prosrc)>0 then
      restored:=replace(installed.prosrc,spec.new_text,spec.old_text);
      if (length(installed.prosrc)-length(replace(installed.prosrc,spec.new_text,'')))/length(spec.new_text)<>1
        or md5(restored)<>spec.known_source then
        raise exception 'OWNER_TASK_MULTISTEP_SOURCE_DRIFT: incomplete native repair';
      end if;
      continue;
    end if;
    if md5(installed.prosrc)<>spec.known_source
      or (length(installed.prosrc)-length(replace(installed.prosrc,spec.old_text,'')))/length(spec.old_text)<>1 then
      raise exception 'OWNER_TASK_MULTISTEP_SOURCE_DRIFT: native body changed';
    end if;
    execute replace(installed.definition,spec.old_text,spec.new_text);
    if (select (to_jsonb(p)-'prosrc'-'proargdefaults')
          || jsonb_build_object('proargdefaults',pg_get_expr(proargdefaults,0)) from pg_proc p where p.oid=installed.oid)
          is distinct from metadata
      or (select md5(replace(prosrc,spec.new_text,spec.old_text)) from pg_proc where oid=installed.oid)<>spec.known_source then
      raise exception 'OWNER_TASK_MULTISTEP_SOURCE_DRIFT: identity or unrelated source changed';
    end if;
  end loop;
end $multistep$;

commit;
