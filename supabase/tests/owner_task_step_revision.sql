-- Rollback-only proof on the rebuilt schema. Synthetic SQL-role fixtures are
-- not ordinary Auth/JWT or customer-cohort acceptance. No external effects.
begin;

do $revision$
declare
  actors uuid[]:=array['e0560000-0000-4000-8000-000000000001','e0560000-0000-4000-8000-000000000002']::uuid[];
  businesses uuid[]:=array['e0560000-0000-4000-8000-000000001001','e0560000-0000-4000-8000-000000001002']::uuid[];
  process_id uuid; step_ids uuid[]; p public.paige_automations;
  expected_process jsonb; expected_acts jsonb; request jsonb; answer jsonb; saved jsonb;
  before_version timestamptz; audit_id uuid; i integer;
begin
  perform set_config('request.jwt.claims','{}',true);
  for i in 1..2 loop
    insert into auth.users(id,aud,role,email)
      values(actors[i],'authenticated','authenticated','operations-revision-'||i||'@tests.invalid');
    insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)
      values(businesses[i],'test-operations-revision-'||i,'Test Operations Revision '||i,'active','standalone',
        case when i=1 then 'ORA' else 'ORB' end,9956000+i,'{}');
    insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
      values(businesses[i],actors[i],(case when i=1 then 'owner' else 'admin' end)::public.tenant_role,'active',i=1,now());
    insert into public.profiles(user_id,active_tenant_id)values(actors[i],businesses[i])
      on conflict(user_id)do update set active_tenant_id=excluded.active_tenant_id;
  end loop;
  for i in 1..2 loop
    process_id:=gen_random_uuid(); step_ids:=array[gen_random_uuid(),gen_random_uuid()];
    insert into public.paige_automations(id,tenant_id,name,trigger_key,created_by)
      values(process_id,businesses[i],'Test original revision '||i,'contact.created',actors[i]);
    insert into public.paige_automation_acts(id,automation_id,position,action_kind,config)values
      (step_ids[1],process_id,1,'owner.task','{"title":"Inspect the internal handoff"}'),
      (step_ids[2],process_id,2,'owner.task','{"title":"{{unresolved.purpose}}"}');
    select * into strict p from public.paige_automations where id=process_id;
    expected_process:=public._owner_task_process_review(p);before_version:=p.updated_at;
    select jsonb_agg(jsonb_build_object('id',a.id,'position',a.position,'action_kind',a.action_kind,
      'tool_key',a.tool_key,'config',a.config)order by a.position,a.id)into expected_acts
      from public.paige_automation_acts a where a.automation_id=process_id;
    request:=jsonb_build_object('reviewed_acts',expected_acts,'revision',jsonb_build_object(
      'act_id',step_ids[2],'config',jsonb_build_object('title','Review the confirmed next responsibility')));
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actors[3-i])::text,true);
    execute 'set local role authenticated';
    begin
      perform public.control_owner_task_automation(process_id,'revise_step',before_version,expected_process,request);
      raise exception 'FAIL: foreign business revised original work';
    exception when sqlstate '22023' then
      if sqlerrm<>'OWNER_TASK_CONTROL_NOT_FOUND' then raise;end if;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actors[i])::text,true);
    execute 'set local role authenticated';
    answer:=public.control_owner_task_automation(process_id,'revise_step',before_version,expected_process,request);
    execute 'reset role';
    if answer->>'automation_id' is distinct from process_id::text or answer->>'state' is distinct from 'draft'
      or answer->'armed_at' is distinct from 'null'::jsonb or answer->'changed' is distinct from 'true'::jsonb
      or answer->'execution_started' is distinct from 'false'::jsonb
      or answer->'process' is distinct from expected_process
      or answer#>'{acts,0}' is distinct from expected_acts->0
      or answer#>>'{acts,1,id}' is distinct from step_ids[2]::text
      or answer#>>'{acts,1,config,title}' is distinct from 'Review the confirmed next responsibility'
      or (answer->>'updated_at')::timestamptz is not distinct from before_version then
      raise exception 'FAIL: original exact draft revision was not read back';
    end if;
    audit_id:=(answer->>'configuration_audit_id')::uuid;
    if audit_id is null or not exists(select 1 from public.audit_logs where id=audit_id
      and user_id=actors[i] and entity_id=process_id and action='owner_task_automation.revise_step') then
      raise exception 'FAIL: original configuration audit is missing or belongs to another actor';
    end if;
    saved:=answer;
    execute 'set local role authenticated';
    begin
      perform public.control_owner_task_automation(process_id,'revise_step',before_version,expected_process,request);
      raise exception 'FAIL: stale replay rewrote the original draft';
    exception when sqlstate '40001' then
      if sqlerrm<>'OWNER_TASK_CONTROL_STALE' then raise;end if;
    end;
    request:=jsonb_set(request,'{reviewed_acts}',saved->'acts');
    answer:=public.control_owner_task_automation(process_id,'revise_step',(saved->>'updated_at')::timestamptz,expected_process,request);
    execute 'reset role';
    if answer->'changed' is distinct from 'false'::jsonb
      or answer->'configuration_audit_id' is distinct from 'null'::jsonb
      or answer->>'updated_at' is distinct from saved->>'updated_at'
      or (select count(*)from public.audit_logs where entity_id=process_id and action='owner_task_automation.revise_step')<>1
      or (select count(*)from public.paige_automation_acts where automation_id=process_id)<>2 then
      raise exception 'FAIL: unchanged reconciliation duplicated configuration or audit';
    end if;
    if exists(select 1 from public.tasks where tenant_id=businesses[i])
      or exists(select 1 from public.paige_workspace_events where tenant_id=businesses[i])
      or exists(select 1 from public.paige_pending_approvals where tenant_id=businesses[i])
      or exists(select 1 from public.paige_act_executions where tenant_id=businesses[i]) then
      raise exception 'FAIL: editing an inactive draft created executable work or a business receipt';
    end if;
    perform set_config('request.jwt.claims','{}',true);
  end loop;
end $revision$;

rollback;

do $clean$
begin
  if exists(select 1 from auth.users where id in('e0560000-0000-4000-8000-000000000001','e0560000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.tenants where id in('e0560000-0000-4000-8000-000000001001','e0560000-0000-4000-8000-000000001002')) then
    raise exception 'FAIL: revision fixture did not roll back';
  end if;
end $clean$;
