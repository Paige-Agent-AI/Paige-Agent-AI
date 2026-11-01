-- Own no-data managed Preview ONLY. All synthetic identities/records roll back.
-- Real schema/roles/native functions; SQL claims are NOT ordinary Auth/JWT proof.
-- Explicit clock fixture: BEGIN's now() predates clock_timestamp() at arming.
-- Observe the synthetic later event with real server clock after the arm, as
-- separate customer transactions do. Original temporal guard remains unchanged.
begin;
do $lifecycle$
declare
  actors uuid[]:=array['e0550000-0000-4000-8000-000000000001','e0550000-0000-4000-8000-000000000002']::uuid[];
  businesses uuid[]:=array['e0550000-0000-4000-8000-000000001001','e0550000-0000-4000-8000-000000001002']::uuid[];
  process_id uuid; contact_id uuid; event_id uuid; step_ids uuid[]; correlations text[];
  p public.paige_automations; expected_process jsonb; expected_acts jsonb; answer jsonb;
  first_result jsonb; second_result jsonb; i integer; step integer;
begin
  for i in 1..2 loop
    insert into auth.users(id,aud,role,email) values(actors[i],'authenticated','authenticated','operations-chain-'||i||'@tests.invalid');
    insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)
      values(businesses[i],'test-operations-chain-'||i,'Test Operations Chain '||i,'active','standalone',
        case when i=1 then 'OTA' else 'OTB' end,9955000+i,'{}');
    insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
      values(businesses[i],actors[i],(case when i=1 then 'owner' else 'admin' end)::public.tenant_role,'active',i=1,now());
    insert into public.profiles(user_id,active_tenant_id) values(actors[i],businesses[i])
      on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
  end loop;
  for i in 1..2 loop
    process_id:=gen_random_uuid(); contact_id:=gen_random_uuid();
    step_ids:=array[gen_random_uuid(),gen_random_uuid()];
    correlations:=array[gen_random_uuid()::text,gen_random_uuid()::text];
    insert into public.paige_automations(id,tenant_id,name,trigger_key,created_by)
      values(process_id,businesses[i],'Test original two-step chain '||i,'contact.created',actors[i]);
    for step in 1..2 loop
      insert into public.paige_automation_acts(id,automation_id,position,action_kind,config)
        values(step_ids[step],process_id,step,'owner.task',
          jsonb_build_object('title','Review internal responsibility '||step,'description','Synthetic full-schema native proof'));
    end loop;
    select * into strict p from public.paige_automations where id=process_id;
    expected_process:=public._owner_task_process_review(p);
    select jsonb_agg(jsonb_build_object('id',a.id,'position',a.position,'action_kind',a.action_kind,
      'tool_key',a.tool_key,'config',a.config)order by a.position,a.id)into expected_acts
      from public.paige_automation_acts a where a.automation_id=process_id;
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actors[3-i])::text,true);
    execute 'set local role authenticated';
    begin
      perform public.control_owner_task_automation(process_id,'arm',p.updated_at,expected_process,expected_acts);
      raise exception 'FAIL: foreign actor armed the chain';
    exception when sqlstate '22023' then
      if sqlerrm<>'OWNER_TASK_CONTROL_NOT_FOUND' then raise;end if;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actors[i])::text,true);
    execute 'set local role authenticated';
    answer:=public.control_owner_task_automation(process_id,'arm',p.updated_at,expected_process,expected_acts);
    execute 'reset role';
    if answer->>'state' is distinct from 'live' or answer->'execution_started' is distinct from 'false'::jsonb
      or answer->'acts' is distinct from expected_acts then raise exception 'FAIL: exact two-step review not armed';end if;
    if exists(select 1 from public.tasks where tenant_id=businesses[i]) then raise exception 'FAIL: arming created a task';end if;
    perform set_config('request.jwt.claims','{}',true);
    insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number,source)
      values(contact_id,businesses[i],actors[i],'Synthetic','Chain',contact_id::text,'test');
    select id into strict event_id from public.paige_native_events where subject_id=contact_id;
    update public.paige_native_events set occurred_at=clock_timestamp(),created_at=clock_timestamp()
      where id=event_id;
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    execute 'set local role service_role';
    for step in 1..2 loop
      perform public.paige_record_act_execution(event_id,process_id,step_ids[step],step,businesses[i],
        'native','owner.task','confirm','approval_pending',null,correlations[step],correlations[step],null,
        jsonb_build_object('snapshot_args',expected_acts->(step-1)->'config'),null,null,null);
    end loop;
    perform public.paige_approve_act_execution(event_id,step_ids[1],actors[i]);
    perform public.paige_claim_act_dispatch(event_id,step_ids[1],gen_random_uuid(),interval '10 minutes',true);
    first_result:=public.execute_owner_task_act(event_id,step_ids[1],correlations[1]);
    if first_result->>'state' is distinct from 'found' or first_result#>'{result,receipt_recorded}' is distinct from 'true'::jsonb
      or first_result#>>'{result,readback,id}' is null or first_result#>>'{result,correlation_id}' is null
      then raise exception 'FAIL: first canonical Task/result/Rail missing';end if;
    answer:=public.execute_owner_task_act(event_id,step_ids[2],correlations[2]);
    if answer->>'reason' is distinct from 'native_approval_required' then raise exception 'FAIL: first approval authorized second step';end if;
    perform public.paige_approve_act_execution(event_id,step_ids[2],actors[i]);
    perform public.paige_claim_act_dispatch(event_id,step_ids[2],gen_random_uuid(),interval '10 minutes',true);
    second_result:=public.execute_owner_task_act(event_id,step_ids[2],correlations[2]);
    if second_result->>'state' is distinct from 'found' or second_result#>'{result,receipt_recorded}' is distinct from 'true'::jsonb
      or second_result#>>'{result,readback,id}' is null
      or second_result#>>'{result,correlation_id}' is null
      or first_result#>>'{result,correlation_id}' is not distinct from second_result#>>'{result,correlation_id}'
      or first_result#>>'{result,readback,id}' is not distinct from second_result#>>'{result,readback,id}' then
      raise exception 'FAIL: second original independent Task/result/Rail missing';end if;
    if public.read_owner_task_act(event_id,step_ids[1],correlations[1])#>>'{result,readback,id}'
      is distinct from first_result#>>'{result,readback,id}'
      or public.execute_owner_task_act(event_id,step_ids[2],correlations[2])#>>'{result,readback,id}'
      is distinct from second_result#>>'{result,readback,id}' then raise exception 'FAIL: original result recovery changed identity';end if;
    execute 'reset role';
    perform set_config('request.jwt.claims','{}',true);
    if (select count(*)from public.tasks where tenant_id=businesses[i])<>2
      or (select count(*)from public.tasks where tenant_id=businesses[i] and id::text=any(array[
        first_result#>>'{result,readback,id}',second_result#>>'{result,readback,id}']))<>2
      or (select count(*)from public.paige_workspace_events where tenant_id=businesses[i]
        and source_id::text=first_result#>>'{result,correlation_id}')<>1
      or (select count(*)from public.paige_workspace_events where tenant_id=businesses[i]
        and source_id::text=second_result#>>'{result,correlation_id}')<>1
      then raise exception 'FAIL: missing or duplicated canonical Tasks/Rails';end if;
    raise notice 'PASS: actual schema cohort %, independent approval/Tasks/Rails and no-repeat recovery',i;
  end loop;
end $lifecycle$;
rollback;
