begin;

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
