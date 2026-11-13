-- EXP05: atomic preparation on the original process/acts/Rail. This is a domain
-- writer, not approval, activation or execution. Original callers must still use
-- the canonical Trust/Harness gate. No legacy rows or grants are changed.
begin;
set local lock_timeout='3s';

create function private.automation_draft_scope(_expected_tenant uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t uuid:=public.current_user_tenant_id();
begin
 if u is null or t is null or t is distinct from _expected_tenant
  or coalesce(auth.jwt()->>'role','')<>'authenticated' then
  raise exception 'AUTOMATION_DRAFT_FORBIDDEN' using errcode='42501'; end if;
 -- Same ordinary seat and current business, with no Operator privilege override.
 perform 1 from public.tenants where id=t and archived_at is null
  and status::text in ('active','trial','past_due') for share nowait;
 if not found then raise exception 'AUTOMATION_DRAFT_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=u and active_tenant_id=t for share nowait;
 if not found then raise exception 'AUTOMATION_DRAFT_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenant_members where tenant_id=t and user_id=u and status='active'
  and role::text in ('owner','admin') for share nowait;
 if not found then raise exception 'AUTOMATION_DRAFT_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from auth.users where id=u and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share nowait;
 if not found then raise exception 'AUTOMATION_DRAFT_FORBIDDEN' using errcode='42501'; end if;
end $$;
revoke all on function private.automation_draft_scope(uuid) from public,anon,authenticated,service_role;

create function private.automation_draft_args(_draft jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare s jsonb;
begin
 if jsonb_typeof(_draft) is distinct from 'object' or pg_column_size(_draft)>32768
  or exists(select 1 from jsonb_object_keys(_draft) k where k not in ('name','category','trigger_key','steps'))
  or jsonb_typeof(_draft->'name') is distinct from 'string' or length(btrim(_draft->>'name')) not between 1 and 120
  or jsonb_typeof(_draft->'trigger_key') is distinct from 'string' or length(btrim(_draft->>'trigger_key')) not between 1 and 200
  or (_draft ? 'category' and (jsonb_typeof(_draft->'category') is distinct from 'string' or length(_draft->>'category')>40))
  or jsonb_typeof(_draft->'steps') is distinct from 'array' then
  raise exception 'AUTOMATION_DRAFT_INVALID' using errcode='22023'; end if;
 if jsonb_array_length(_draft->'steps') not between 1 and 20 then
  raise exception 'AUTOMATION_DRAFT_INVALID' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(_draft->'steps') loop
  if jsonb_typeof(s) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(s) k where k not in ('action_kind','tool_key','config'))
   or (s ? 'action_kind')=(s ? 'tool_key')
   or (s ? 'action_kind' and (jsonb_typeof(s->'action_kind') is distinct from 'string' or length(btrim(s->>'action_kind')) not between 1 and 200))
   or (s ? 'tool_key' and (jsonb_typeof(s->'tool_key') is distinct from 'string' or length(btrim(s->>'tool_key')) not between 1 and 200))
   or (s ? 'config' and jsonb_typeof(s->'config') is distinct from 'object') then
   raise exception 'AUTOMATION_DRAFT_INVALID' using errcode='22023'; end if;
 end loop;
 return jsonb_build_object('name',_draft->>'name','category',coalesce(_draft->>'category','general'),
  'trigger_key',_draft->>'trigger_key','steps',(select jsonb_agg(
   (value-'config')||jsonb_build_object('config',coalesce(value->'config','{}'::jsonb)) order by ord)
   from jsonb_array_elements(_draft->'steps') with ordinality x(value,ord)));
end $$;
revoke all on function private.automation_draft_args(jsonb) from public,anon,authenticated,service_role;

create function public.read_automation_draft(_request_id uuid,_expected_tenant_id uuid,_expected_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a public.paige_automations; d jsonb; acts jsonb; receipt uuid; phase text;
begin
 perform private.automation_draft_scope(_expected_tenant_id);
 d:=private.automation_draft_args(_expected_draft);
 if _request_id is null then raise exception 'AUTOMATION_DRAFT_INVALID' using errcode='22023'; end if;
 select * into a from public.paige_automations where id=_request_id
  and tenant_id=_expected_tenant_id and created_by=auth.uid() for share nowait;
 if not found then return jsonb_build_object('phase','absent','request_id',_request_id); end if;
 perform 1 from public.paige_automation_acts where automation_id=a.id order by position for share nowait;
 select coalesce(jsonb_agg((case when action_kind is not null then jsonb_build_object('action_kind',action_kind)
  else jsonb_build_object('tool_key',tool_key) end)||jsonb_build_object('config',config) order by position),'[]'::jsonb) into acts
  from public.paige_automation_acts where automation_id=a.id;
 select id into receipt from public.paige_workspace_events where tenant_id=_expected_tenant_id
  and actor_id=auth.uid() and source_kind='capability_run' and source_id=_request_id and source_revision=0
  and capability_key='automation_draft' and outcome='capability_succeeded'
  and detail->>'automation_id'=a.id::text
  and detail->>'draft_sha256'=encode(pg_catalog.sha256(pg_catalog.convert_to(d::text,'UTF8')),'hex')
  and (detail->>'saved_created_at')=(to_jsonb(a.created_at)#>>'{}');
 phase:=case when a.name=d->>'name' and a.category=d->>'category' and a.trigger_key=d->>'trigger_key'
  and a.trigger_config='{}'::jsonb and a.conditions='[]'::jsonb and acts=d->'steps'
  and a.state='draft' and a.granted_lane='confirm' and a.owner_task_armed_at is null
  then case when receipt is null then 'saved_unreceipted' else 'saved' end else 'changed' end;
 return jsonb_build_object('phase',phase,'request_id',_request_id,'tenant_id',a.tenant_id,'actor_id',a.created_by,
  'automation_id',a.id,'receipt_id',receipt,'state',a.state,'granted_lane',a.granted_lane,
  'updated_at',a.updated_at,'steps',jsonb_array_length(acts),'execution_started',false);
end $$;
revoke all on function public.read_automation_draft(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_automation_draft(uuid,uuid,jsonb) to authenticated;

create function public.save_automation_draft(_request_id uuid,_expected_tenant_id uuid,_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set timezone='UTC' as $$
declare d jsonb; saved jsonb; s jsonb; n integer:=0; created timestamptz;
begin
 perform private.automation_draft_scope(_expected_tenant_id);
 if _request_id is null then raise exception 'AUTOMATION_DRAFT_INVALID' using errcode='22023'; end if;
 d:=private.automation_draft_args(_draft);
 -- The operation UUID is server-bound by the original surface. It is the
 -- original record's primary key, not a second idempotency table or draft store.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_expected_tenant_id::text||':'||_request_id::text,1005));
 saved:=public.read_automation_draft(_request_id,_expected_tenant_id,d);
 if saved->>'phase'<>'absent' then return saved; end if;
 if exists(select 1 from public.paige_automations where id=_request_id) then
  raise exception 'AUTOMATION_DRAFT_FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.paige_automation_triggers where key=d->>'trigger_key')
  -- This specialized definition already has its own exact native writer.
  or d->>'trigger_key'='schedule.weekly_commitment_check' then
  raise exception 'AUTOMATION_DRAFT_TRIGGER_UNAVAILABLE' using errcode='22023'; end if;
 insert into public.paige_automations(id,tenant_id,name,category,trigger_key,created_by,granted_lane,state)
  values(_request_id,_expected_tenant_id,d->>'name',d->>'category',d->>'trigger_key',auth.uid(),'confirm','draft') returning created_at into created;
 for s in select value from jsonb_array_elements(d->'steps') loop
  n:=n+1;
  insert into public.paige_automation_acts(automation_id,position,action_kind,tool_key,config)
   values(_request_id,n,s->>'action_kind',s->>'tool_key',s->'config');
 end loop;
 -- Definition, ordered acts and the ORIGINAL Rail commit or roll back together.
 perform public.record_capability_run(_expected_tenant_id,auth.uid(),'automation_draft','capability_succeeded',_request_id,
  null::text,null::text,null::uuid,null::text,jsonb_build_object('automation_id',_request_id,'steps',n,
   'state','draft','granted_lane','confirm','execution_started',false,'saved_created_at',created,
   'draft_sha256',encode(pg_catalog.sha256(pg_catalog.convert_to(d::text,'UTF8')),'hex')));
 saved:=public.read_automation_draft(_request_id,_expected_tenant_id,d);
 if saved->>'phase' is distinct from 'saved' then
  raise exception 'AUTOMATION_DRAFT_READBACK_UNVERIFIED' using errcode='40001'; end if;
 return saved;
end $$;
revoke all on function public.save_automation_draft(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_automation_draft(uuid,uuid,jsonb) to authenticated;
commit;
