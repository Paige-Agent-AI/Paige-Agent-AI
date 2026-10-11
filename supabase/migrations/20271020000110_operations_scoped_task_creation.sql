-- Manual Operations preconditions around the existing Planning task writer.
-- No new task store, authority, scheduler, receipt ledger or automatic retry.
begin;

create or replace function public.plan_assign_task_scoped(
  p_expected_actor_id uuid, p_expected_tenant_id uuid,
  p_title text, p_assigned_to_user_id uuid,
  p_plan_id uuid default null, p_milestone_id uuid default null,
  p_due_at timestamptz default null, p_priority text default 'normal',
  p_summary text default null, p_contact_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_result jsonb;
  v_item_id uuid;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
     or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;
  perform 1 from public.profiles where user_id = v_actor for update;
  if not found then raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501'; end if;
  v_tenant := public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant) then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;
  if not exists(select 1 from public.tenants t where t.id=v_tenant and t.account_type::text='standalone' and t.parent_tenant_id is null) then
    raise exception 'PLAN_FORBIDDEN: Solo Operations unavailable' using errcode='42501'; end if;

  if p_assigned_to_user_id is distinct from v_actor and not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'PLAN_ASSIGNMENT_FORBIDDEN' using errcode='42501';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 500
     or coalesce(length(p_summary), 0) > 10000
     or p_priority is null or p_priority not in ('low','normal','high','urgent') then
    raise exception 'PLAN_TASK_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_plan_id is not null then
    perform 1 from public.plans where id = p_plan_id and tenant_id = v_tenant for update;
    if not found then raise exception 'PLAN_PROJECT_UNAVAILABLE' using errcode = '42501'; end if;
  end if;
  -- The canonical writer checks milestone tenancy. This tighter UI precondition
  -- also prevents a milestone from another plan being attached to this project.
  if p_milestone_id is not null then
    if p_plan_id is null then raise exception 'PLAN_MILESTONE_PROJECT_REQUIRED' using errcode = '22023'; end if;
    perform 1 from public.plan_items where id = p_milestone_id
      and tenant_id = v_tenant and plan_id = p_plan_id and item_type = 'milestone'
      and status <> 'cancelled' for update;
    if not found then raise exception 'PLAN_MILESTONE_UNAVAILABLE' using errcode = '42501'; end if;
  end if;
  -- Preserve canonical active-member, staff/self assignment, client validation,
  -- audit and record-only action-bus behavior. This wrapper grants no new role.
  v_result := public.plan_assign_task(
    p_title := btrim(p_title), p_assigned_to_user_id := p_assigned_to_user_id,
    p_plan_id := p_plan_id, p_milestone_id := p_milestone_id,
    p_due_at := p_due_at, p_priority := p_priority, p_summary := p_summary,
    p_contact_id := p_contact_id, p_campaign_ref := null,
    p_file_to_bus := true, p_tenant_id := v_tenant
  );
  v_item_id := nullif(v_result->>'item_id', '')::uuid;
  if (v_result->>'ok') is distinct from 'true' or v_item_id is null
     or not exists (select 1 from public.plan_items where id = v_item_id
       and tenant_id = v_tenant and created_by = v_actor and item_type = 'task') then
    raise exception 'PLAN_CREATE_UNCONFIRMED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'item_id', v_item_id,
    'tenant_id', v_tenant, 'actor_id', v_actor);
end;
$$;

revoke all on function public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)
  to authenticated;
comment on function public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)
  is 'Manual caller-JWT scope/project relationship preconditions for canonical task creation. Non-idempotent; never blindly retry an unknown outcome. Requires independent caller-RLS readback.';
commit;
