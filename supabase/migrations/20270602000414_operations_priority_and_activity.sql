begin;
-- Additive source-version guard for the existing canonical priority parameter.
create or replace function public.plan_update_item_priority_versioned(
  p_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,p_expected_updated_at timestamptz,
  p_priority text,p_status text default null,p_due_at timestamptz default null,p_assigned_to_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_row public.plan_items%rowtype;v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  v_tenant:=public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant) then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  if not exists(select 1 from public.tenants t where t.id=v_tenant and t.account_type::text='standalone' and t.parent_tenant_id is null) then
    raise exception 'PLAN_FORBIDDEN: Solo Operations unavailable' using errcode='42501'; end if;

  select * into v_row from public.plan_items where id=p_item_id for update;
  if not found or v_row.tenant_id is distinct from v_tenant then raise exception 'PLAN_ITEM_UNAVAILABLE' using errcode='42501'; end if;
  if not coalesce(public.is_tenant_admin(v_tenant) or v_row.created_by=v_actor,false) then
    raise exception 'PLAN_FIELDS_FORBIDDEN' using errcode='42501'; end if;
  if p_assigned_to_user_id is not null and p_assigned_to_user_id is distinct from v_row.assigned_to_user_id and not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'PLAN_ASSIGNMENT_FORBIDDEN' using errcode='42501'; end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'PLAN_WORK_CHANGED' using errcode='40001'; end if;
  if p_priority is null or p_priority not in ('low','normal','high','urgent') then
    raise exception 'PLAN_PRIORITY_INVALID' using errcode='22023'; end if;
  v_result:=public.plan_update_item(p_item_id:=p_item_id,p_status:=p_status,p_due_at:=p_due_at,
    p_assigned_to_user_id:=p_assigned_to_user_id,p_priority:=p_priority,p_tenant_id:=v_tenant);
  if (v_result->>'ok') is distinct from 'true' then raise exception 'PLAN_UPDATE_UNCONFIRMED' using errcode='P0001'; end if;
  return jsonb_build_object('ok',true,'item_id',p_item_id,'actor_id',v_actor,'tenant_id',v_tenant);
end; $$;

-- A bounded projection of the source audit, never raw payloads or a new ledger.
create or replace function public.plan_item_activity_scoped(
  p_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_row public.plan_items%rowtype;v_events jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  v_tenant:=public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant) then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  if not exists(select 1 from public.tenants t where t.id=v_tenant and t.account_type::text='standalone' and t.parent_tenant_id is null) then
    raise exception 'PLAN_FORBIDDEN: Solo Operations unavailable' using errcode='42501'; end if;

  select * into v_row from public.plan_items where id=p_item_id and tenant_id=v_tenant;
  if not found or not coalesce((public.is_tenant_admin(v_tenant)
    or v_row.created_by=v_actor or v_row.assigned_to_user_id=v_actor),false) then
    raise exception 'PLAN_ITEM_UNAVAILABLE' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('recorded_at',a.created_at,'action',a.action,'actor_id',a.user_id,
    'status',case when a.data->>'status' in ('open','in_progress','blocked','done','cancelled') then a.data->>'status' else null end)
    order by a.created_at desc),'[]'::jsonb) into v_events
  from (select created_at,action,user_id,data from public.audit_logs
    where entity='plan_item' and entity_id=p_item_id
      and action in ('plan_assign_task','plan_add_milestone','plan_set_reminder','plan_update_item','plan_remove_item')
    order by created_at desc limit 25) a;
  return jsonb_build_object('ok',true,'item_id',p_item_id,'actor_id',v_actor,'tenant_id',v_tenant,'events',v_events);
end; $$;
revoke all on function public.plan_update_item_priority_versioned(uuid,uuid,uuid,timestamptz,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.plan_update_item_priority_versioned(uuid,uuid,uuid,timestamptz,text,text,timestamptz,uuid) to authenticated;
revoke all on function public.plan_item_activity_scoped(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.plan_item_activity_scoped(uuid,uuid,uuid) to authenticated;
commit;
