begin;
-- Missing lifecycle seam on the existing Planning source, not a new PM store.
create or replace function public.plan_update_project_scoped(
  p_plan_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,p_expected_updated_at timestamptz,
  p_status text,p_owner_user_id uuid,p_starts_on date,p_ends_on date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_plan public.plans%rowtype;v_staff boolean;
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

  select * into v_plan from public.plans where id=p_plan_id for update;
  if not found or v_plan.tenant_id is distinct from v_tenant then
    raise exception 'PLAN_PROJECT_UNAVAILABLE' using errcode='42501'; end if;
  v_staff:=public.is_tenant_admin(v_tenant);
  if not coalesce(v_staff or v_plan.created_by=v_actor or v_plan.owner_user_id=v_actor,false) then
    raise exception 'PLAN_PROJECT_UNAVAILABLE' using errcode='42501'; end if;
  if p_expected_updated_at is null or v_plan.updated_at is distinct from p_expected_updated_at then
    raise exception 'PLAN_WORK_CHANGED' using errcode='40001'; end if;
  if p_owner_user_id is distinct from v_plan.owner_user_id and not coalesce(v_staff,false) then
    raise exception 'PLAN_OWNER_CHANGE_FORBIDDEN' using errcode='42501'; end if;
  if p_owner_user_id is null or not exists(select 1 from public.tenant_members where tenant_id=v_tenant and user_id=p_owner_user_id and status='active') then
    raise exception 'PLAN_OWNER_UNAVAILABLE' using errcode='42501'; end if;
  if p_status is null or p_status not in ('draft','active','completed','archived') or p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on then
    raise exception 'PLAN_PROJECT_INVALID' using errcode='22023'; end if;
  -- Serialize existing children before testing completion; preserve them unchanged.
  perform 1 from public.plan_items where plan_id=p_plan_id and tenant_id=v_tenant order by id for update;
  if p_status in ('completed','archived') and exists(select 1 from public.plan_items where plan_id=p_plan_id and tenant_id=v_tenant and status not in ('done','cancelled')) then
    raise exception 'PLAN_PROJECT_UNFINISHED_WORK' using errcode='23514'; end if;
  update public.plans set status=p_status,owner_user_id=p_owner_user_id,starts_on=p_starts_on,ends_on=p_ends_on where id=p_plan_id;
  insert into public.audit_logs(user_id,entity,entity_id,action,data) values(v_actor,'plan',p_plan_id,'plan_update',
    jsonb_build_object('tenant_id',v_tenant,'previous_status',v_plan.status,'status',p_status,
      'previous_owner_user_id',v_plan.owner_user_id,'owner_user_id',p_owner_user_id,
      'previous_starts_on',v_plan.starts_on,'starts_on',p_starts_on,'previous_ends_on',v_plan.ends_on,'ends_on',p_ends_on));
  return jsonb_build_object('ok',true,'plan_id',p_plan_id,'actor_id',v_actor,'tenant_id',v_tenant);
end; $$;
revoke all on function public.plan_update_project_scoped(uuid,uuid,uuid,timestamptz,text,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.plan_update_project_scoped(uuid,uuid,uuid,timestamptz,text,uuid,date,date) to authenticated;
commit;
