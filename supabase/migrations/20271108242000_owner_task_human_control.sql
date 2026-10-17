-- Human control of ONE existing contact.created / owner.task process.
-- Configuration only: confirm remains mandatory; no event replay or task is run.
begin;

-- No backfill: a legacy live row has no evidence of human activation. Its owner
-- must pause/review/re-arm. updated_at is NOT activation authority: incumbent act
-- fingerprint bookkeeping also touches it and older callers can supply it.
alter table public.paige_automations add column owner_task_armed_at timestamptz;

create or replace function public._owner_task_process_review(_p public.paige_automations)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('id',(_p).id,'tenant_id',(_p).tenant_id,'name',(_p).name,
    'category',(_p).category,'trigger_key',(_p).trigger_key,'trigger_config',(_p).trigger_config,
    'conditions',(_p).conditions,'created_by',(_p).created_by,'state',(_p).state,
    'granted_lane',(_p).granted_lane,'owner_task_armed_at',(_p).owner_task_armed_at);
$$;
revoke all on function public._owner_task_process_review(public.paige_automations) from public,anon,authenticated,service_role;

-- INVOKER deliberately follows the weekly-control guard: direct authenticated /
-- service writes retain their role, while the canonical SECURITY DEFINER writer
-- runs as its database owner. No caller-controlled GUC, JSON flag or nonce.
create or replace function public.guard_owner_task_process_control()
returns trigger language plpgsql set search_path='' as $$
declare owner_name text; relevant boolean; semantic_change boolean;
begin
  select pg_catalog.pg_get_userbyid(p.proowner) into owner_name from pg_catalog.pg_proc p
    where p.oid='public.guard_owner_task_process_control()'::regprocedure;
  if tg_op='INSERT' then
    if new.owner_task_armed_at is not null then
      raise exception 'OWNER_TASK_HUMAN_CONTROL_REQUIRED' using errcode='42501';
    end if;
    return new;
  end if;
  relevant:=old.owner_task_armed_at is not null or new.owner_task_armed_at is not null
    or ((old.trigger_key='contact.created' or new.trigger_key='contact.created') and exists(
      select 1 from public.paige_automation_acts where automation_id=old.id and action_kind='owner.task'));
  if not relevant then return new; end if;
  if new.owner_task_armed_at is not null and new.owner_task_armed_at is distinct from old.owner_task_armed_at
    and current_user<>owner_name then
    raise exception 'OWNER_TASK_HUMAN_CONTROL_REQUIRED' using errcode='42501';
  end if;
  if new.state='live' and old.state is distinct from 'live' and current_user<>owner_name then
    raise exception 'OWNER_TASK_HUMAN_CONTROL_REQUIRED' using errcode='42501';
  end if;
  if new.owner_task_armed_at is not null and (new.state<>'live' or new.granted_lane<>'confirm'
    or new.trigger_key<>'contact.created') then
    -- The brake always works; turning off authority cannot retain an activation.
    new.owner_task_armed_at:=null;
  end if;
  semantic_change:=(to_jsonb(new)-array['updated_at','acts_fingerprint','owner_task_armed_at'])
    is distinct from (to_jsonb(old)-array['updated_at','acts_fingerprint','owner_task_armed_at']);
  if (semantic_change or new.acts_fingerprint is distinct from old.acts_fingerprint)
    and new.owner_task_armed_at is not distinct from old.owner_task_armed_at then
    new.owner_task_armed_at:=null;
    if old.owner_task_armed_at is not null and new.state='live' then new.state:='paused'; end if;
  end if;
  if old.owner_task_armed_at is not null and new.owner_task_armed_at is null and new.state='live' then
    new.state:='paused';
  end if;
  if semantic_change or new.acts_fingerprint is distinct from old.acts_fingerprint
    or new.owner_task_armed_at is distinct from old.owner_task_armed_at then
    new.updated_at:=clock_timestamp();
  else
    -- A no-op act fingerprint refresh is bookkeeping, not a new review/version.
    new.updated_at:=old.updated_at;
  end if;
  return new;
end $$;
revoke all on function public.guard_owner_task_process_control() from public,anon,authenticated,service_role;
create trigger owner_task_process_control before insert or update on public.paige_automations
for each row execute function public.guard_owner_task_process_control();

-- Exact act semantics, not the old MD5 fingerprint, revoke the current grant.
-- The writer already owns the act; lock affected parents in stable order NOWAIT
-- so an inverse edit cannot wait in a cycle with control's act->parent locks.
create or replace function public.guard_owner_task_act_control()
returns trigger language plpgsql set search_path='' as $$
declare parents uuid[]; owner_task_change boolean;
begin
  if tg_op='UPDATE' and row(new.id,new.automation_id,new.position,new.action_kind,new.tool_key,new.config)
    is not distinct from row(old.id,old.automation_id,old.position,old.action_kind,old.tool_key,old.config) then return new; end if;
  parents:=case when tg_op='INSERT' then array[new.automation_id]
    when tg_op='DELETE' then array[old.automation_id] else array[old.automation_id,new.automation_id] end;
  owner_task_change:=case when tg_op='INSERT' then new.action_kind='owner.task'
    when tg_op='DELETE' then old.action_kind='owner.task'
    else coalesce(old.action_kind='owner.task',false) or coalesce(new.action_kind='owner.task',false) end;
  perform 1 from public.paige_automations p where id=any(parents) and (owner_task_armed_at is not null
    or (trigger_key='contact.created' and state='live' and (owner_task_change or exists(
      select 1 from public.paige_automation_acts a where a.automation_id=p.id and a.action_kind='owner.task'))))
    order by id for update nowait;
  update public.paige_automations set owner_task_armed_at=null,state=case when state='live' then 'paused' else state end,
    updated_at=clock_timestamp() where id=any(parents) and (owner_task_armed_at is not null
      or (trigger_key='contact.created' and state='live' and (owner_task_change or exists(
        select 1 from public.paige_automation_acts a where a.automation_id=paige_automations.id and a.action_kind='owner.task'))));
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_owner_task_act_control() from public,anon,authenticated,service_role;
create trigger owner_task_act_control before insert or update or delete on public.paige_automation_acts
for each row execute function public.guard_owner_task_act_control();

create or replace function public.control_owner_task_automation(
  _automation_id uuid,_action text,_expected_updated_at timestamptz,_expected_process jsonb,_expected_acts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.current_user_tenant_id();
  p public.paige_automations; a public.paige_automation_acts; acts jsonb; n integer; changed boolean:=false;
begin
  if actor is null or tenant is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then
    raise exception 'OWNER_TASK_CONTROL_FORBIDDEN' using errcode='42501';
  end if;
  if _action is null or _action not in ('arm','pause') or _automation_id is null
    or _expected_updated_at is null or jsonb_typeof(_expected_process) is distinct from 'object'
    or jsonb_typeof(_expected_acts) is distinct from 'array' then
    raise exception 'OWNER_TASK_CONTROL_INVALID' using errcode='22023';
  end if;
  -- Same actor/tenant order as the canonical CRM/native writer. An operator or
  -- agency privilege alone is insufficient: this exact ordinary seat is required.
  perform 1 from public.tenants where id=tenant for share nowait;
  if not found then raise exception 'OWNER_TASK_CONTROL_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=actor and active_tenant_id=tenant for share nowait;
  if not found then raise exception 'OWNER_TASK_CONTROL_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from public.tenant_members where tenant_id=tenant and user_id=actor and status='active'
    and role::text in ('owner','admin') for share nowait;
  if not found then raise exception 'OWNER_TASK_CONTROL_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from auth.users where id=actor and deleted_at is null
    and (banned_until is null or banned_until<=clock_timestamp()) for share nowait;
  if not found then raise exception 'OWNER_TASK_CONTROL_FORBIDDEN' using errcode='42501'; end if;
  -- Lock complete ordered act set before parent, re-read under the parent FK
  -- lock. The tenant predicate is checked before acquiring another tenant's acts.
  if not exists(select 1 from public.paige_automations where id=_automation_id and tenant_id=tenant) then
    raise exception 'OWNER_TASK_CONTROL_NOT_FOUND' using errcode='22023';
  end if;
  perform 1 from public.paige_automation_acts where automation_id=_automation_id order by id for update nowait;
  select * into p from public.paige_automations where id=_automation_id and tenant_id=tenant for update nowait;
  if p.id is null then raise exception 'OWNER_TASK_CONTROL_NOT_FOUND' using errcode='22023'; end if;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',x.id,'position',x.position,
    'action_kind',x.action_kind,'tool_key',x.tool_key,'config',x.config) order by x.position,x.id),'[]'::jsonb)
    into n,acts from public.paige_automation_acts x where automation_id=p.id;
  if p.updated_at is distinct from _expected_updated_at or public._owner_task_process_review(p) is distinct from _expected_process
    or acts is distinct from _expected_acts then raise exception 'OWNER_TASK_CONTROL_STALE' using errcode='40001'; end if;
  if p.trigger_key is distinct from 'contact.created' or not exists(
    select 1 from public.paige_automation_acts where automation_id=p.id and action_kind='owner.task') then
    raise exception 'OWNER_TASK_CONTROL_UNSUPPORTED' using errcode='22023';
  end if;
  if _action='arm' then
    select * into a from public.paige_automation_acts where automation_id=p.id order by position,id limit 1;
    if p.state='live' and p.owner_task_armed_at is null then
      raise exception 'OWNER_TASK_CONTROL_LEGACY_REVIEW_REQUIRED' using errcode='22023';
    end if;
    if n<>1 or a.position<>1 or a.action_kind is distinct from 'owner.task' or a.tool_key is not null
      or p.created_by is null or p.trigger_config<>'{}'::jsonb or p.conditions<>'[]'::jsonb
      or jsonb_typeof(a.config) is distinct from 'object'
      or jsonb_typeof(a.config->'title') is distinct from 'string' or length(btrim(a.config->>'title')) not between 1 and 500
      or (a.config ? 'description' and (jsonb_typeof(a.config->'description') is distinct from 'string' or length(a.config->>'description')>10000))
      or exists(select 1 from jsonb_object_keys(a.config) k where k not in ('title','description'))
      or (a.config->>'title') ~ '(\{\{|\$\{|\{%|<%)' or coalesce(a.config->>'description','') ~ '(\{\{|\$\{|\{%|<%)'
      or not exists(select 1 from public.tenants where id=tenant and archived_at is null
        and coalesce(lifecycle_execution_paused,false)=false and status::text in ('active','trial','past_due')) then
      raise exception 'OWNER_TASK_CONTROL_UNSUPPORTED' using errcode='22023';
    end if;
    if p.state is distinct from 'live' or p.granted_lane is distinct from 'confirm' or p.owner_task_armed_at is null then
      update public.paige_automations set state='live',granted_lane='confirm',owner_task_armed_at=clock_timestamp()
        where id=p.id returning * into p; changed:=true;
    end if;
  elsif p.state is distinct from 'paused' or p.owner_task_armed_at is not null then
    update public.paige_automations set state='paused',owner_task_armed_at=null where id=p.id returning * into p;
    changed:=true;
  end if;
  if changed then
    insert into public.audit_logs(user_id,action,entity,entity_id,data)
      values(actor,'owner_task_automation.'||_action,'paige_automation',p.id,jsonb_build_object(
        'tenant_id',tenant,'state',p.state,'granted_lane',p.granted_lane,'armed_at',p.owner_task_armed_at,
        'updated_at',p.updated_at,'future_events_only',true,'execution_started',false));
  end if;
  return jsonb_build_object('automation_id',p.id,'state',p.state,'granted_lane',p.granted_lane,
    'armed_at',p.owner_task_armed_at,'updated_at',p.updated_at,'process',public._owner_task_process_review(p),
    'acts',acts,'changed',changed,'future_events_only',true,'execution_started',false);
end $$;
revoke all on function public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb) to authenticated;

-- Existing native capture/validation remains ONE authoritative implementation.
-- Include the immutable activation in new holds; never rewrite a previous hold.
create or replace function public._owner_task_source_snapshot(_event_id uuid,_act_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.paige_automation_acts; p public.paige_automations; e public.paige_native_events;
  c public.clients; chain jsonb; n integer; v jsonb;
begin
  if auth.uid() is not null then raise exception 'OWNER_TASK_INTERNAL_ONLY' using errcode='42501'; end if;
  select * into a from public.paige_automation_acts where id=_act_id;
  if not found then raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023'; end if;
  perform 1 from public.paige_automation_acts where automation_id=a.automation_id order by id for update nowait;
  select * into p from public.paige_automations where id=a.automation_id for update nowait;
  select * into a from public.paige_automation_acts where id=_act_id and automation_id=p.id;
  select count(*),jsonb_agg(jsonb_build_object('id',x.id,'position',x.position,'action_kind',x.action_kind,
    'tool_key',x.tool_key,'config',x.config) order by x.position,x.id) into n,chain
    from public.paige_automation_acts x where x.automation_id=p.id;
  if p.id is null or a.id is null or n<>1 or a.action_kind is distinct from 'owner.task' or a.tool_key is not null
    or p.trigger_key is distinct from 'contact.created' or p.state is distinct from 'live' or p.granted_lane is distinct from 'confirm'
    or p.owner_task_armed_at is null
    or jsonb_typeof(a.config) is distinct from 'object' or jsonb_typeof(a.config->'title') is distinct from 'string'
    or coalesce(btrim(a.config->>'title'),'')='' or (a.config ? 'description' and jsonb_typeof(a.config->'description') is distinct from 'string')
    or exists(select 1 from jsonb_object_keys(a.config) k where k not in ('title','description')) then
    raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023';
  end if;
  select * into e from public.paige_native_events where id=_event_id for share nowait;
  if e.id is null or e.tenant_id is distinct from p.tenant_id or e.event_key is distinct from 'contact.created'
    or e.subject_table is distinct from 'clients' or e.dedup_key is distinct from 'contact.created:'||e.subject_id::text
    or e.payload->>'contact_id' is distinct from e.subject_id::text
    or e.occurred_at<p.owner_task_armed_at or e.created_at<p.owner_task_armed_at then
    raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023';
  end if;
  select * into c from public.clients where id=e.subject_id and tenant_id=p.tenant_id for update nowait;
  if c.id is null then raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023'; end if;
  v:=jsonb_build_object('v',1,'process',jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'name',p.name,
    'category',p.category,'trigger_key',p.trigger_key,'trigger_config',p.trigger_config,'conditions',p.conditions,
    'created_by',p.created_by,'state',p.state,'granted_lane',p.granted_lane,'owner_task_armed_at',p.owner_task_armed_at),'acts',chain,
    'event',jsonb_build_object('id',e.id,'tenant_id',e.tenant_id,'event_key',e.event_key,
      'subject_table',e.subject_table,'subject_id',e.subject_id,'dedup_key',e.dedup_key,'contact_id',e.payload->'contact_id'),
    'contact',jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'updated_at',c.updated_at,'status',c.status));
  return v;
end $$;
revoke all on function public._owner_task_source_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
commit;
