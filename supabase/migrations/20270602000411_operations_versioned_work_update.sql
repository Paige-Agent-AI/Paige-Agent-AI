begin;

-- Forward hardening of the already released Operations scope wrapper.
create or replace function public.plan_update_item_scoped(
  p_item_id uuid,
  p_expected_actor_id uuid,
  p_expected_tenant_id uuid,
  p_status text default null,
  p_due_at timestamptz default null,
  p_assigned_to_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_row public.plan_items%rowtype;
  v_staff boolean;
  v_result jsonb;
begin
  if v_actor is null or p_expected_actor_id is null
     or v_actor is distinct from p_expected_actor_id
     or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;

  -- Scope switches update this same profile row. Holding its lock through the
  -- canonical mutation serializes the precondition with a concurrent switch.
  perform 1 from public.profiles where user_id = v_actor for update;
  if not found then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;
  -- Preserve the platform's canonical membership/delegated-scope resolver;
  -- do not replace it with a raw active_tenant_id or a second role authority.
  v_tenant := public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant) then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;

  select * into v_row from public.plan_items
    where id = p_item_id for update;
  if not found or v_row.tenant_id is distinct from v_tenant then
    raise exception 'PLAN_ITEM_UNAVAILABLE' using errcode = '42501';
  end if;

  -- Target-tenant authority is checked before delegating the legacy writer.
  -- A global role elsewhere must not grant management of this tenant's work.
  v_staff := public.is_tenant_admin(v_tenant);
  if not coalesce(v_staff or v_row.created_by = v_actor or v_row.assigned_to_user_id = v_actor, false) then
    raise exception 'PLAN_ITEM_UNAVAILABLE' using errcode = '42501';
  end if;
  if not coalesce(v_staff, false) and v_row.created_by is distinct from v_actor
     and (p_due_at is not null or p_assigned_to_user_id is not null) then
    raise exception 'PLAN_FIELDS_FORBIDDEN' using errcode = '42501';
  end if;
  if p_assigned_to_user_id is not null and p_assigned_to_user_id is distinct from v_row.assigned_to_user_id
     and not coalesce(v_staff, false) then
    raise exception 'PLAN_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
  end if;

  -- The existing writer retains staff/creator/assignee authority, assignee
  -- membership, validation, completion timestamps and its canonical audit.
  v_result := public.plan_update_item(
    p_item_id := p_item_id, p_status := p_status, p_due_at := p_due_at,
    p_assigned_to_user_id := p_assigned_to_user_id, p_tenant_id := v_tenant
  );
  if (v_result->>'ok') is distinct from 'true'
     or (v_result->>'item_id') is distinct from p_item_id::text then
    raise exception 'PLAN_UPDATE_UNCONFIRMED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'item_id', p_item_id,
    'tenant_id', v_tenant, 'actor_id', v_actor);
end;
$$;


-- Additive manual concurrency guard. No replacement task or audit authority.
create or replace function public.plan_update_item_versioned(
  p_item_id uuid, p_expected_actor_id uuid, p_expected_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_status text default null, p_due_at timestamptz default null,
  p_assigned_to_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_row public.plan_items%rowtype;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
     or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;
  perform 1 from public.profiles where user_id = v_actor for update;
  if not found then raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501'; end if;
  v_tenant := public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode = '42501';
  end if;
  select * into v_row from public.plan_items where id = p_item_id for update;
  if not found or v_row.tenant_id is distinct from v_tenant then
    raise exception 'PLAN_ITEM_UNAVAILABLE' using errcode = '42501';
  end if;
  -- Canonical writers touch updated_at. Compare the untouched source string at
  -- PostgreSQL precision while retaining the lock through the existing writer.
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'PLAN_WORK_CHANGED' using errcode = '40001';
  end if;
  return public.plan_update_item_scoped(p_item_id, p_expected_actor_id,
    p_expected_tenant_id, p_status, p_due_at, p_assigned_to_user_id);
end;
$$;
revoke all on function public.plan_update_item_versioned(uuid,uuid,uuid,timestamptz,text,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.plan_update_item_versioned(uuid,uuid,uuid,timestamptz,text,timestamptz,uuid)
  to authenticated;
comment on function public.plan_update_item_versioned(uuid,uuid,uuid,timestamptz,text,timestamptz,uuid)
  is 'Manual source-version guard around scoped canonical Planning mutation. No automated retry, external dispatch, client acceptance or separate receipt ledger.';
commit;
