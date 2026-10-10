-- Manual caller-scope preconditions, delegating canonical Planning writers.
begin;
create or replace function public.plan_create_scoped(
  p_expected_actor_id uuid, p_expected_tenant_id uuid,
  p_title text, p_horizon text, p_starts_on date, p_ends_on date,
  p_scope text default 'individual', p_owner_user_id uuid default null,
  p_summary text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_result jsonb; v_id uuid;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501';
  end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  v_tenant := public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 500
    or coalesce(length(p_summary),0)>10000 or p_scope is null or p_scope not in ('individual','team')
    or p_horizon is null or p_horizon not in ('week','month','quarter','semiannual','year','custom')
    or p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on or p_owner_user_id is null then
    raise exception 'PLAN_PROJECT_INPUT_INVALID' using errcode='22023';
  end if;
  v_result := public.plan_create(p_title:=btrim(p_title), p_horizon:=p_horizon,
    p_starts_on:=p_starts_on, p_ends_on:=p_ends_on, p_scope:=p_scope,
    p_owner_user_id:=p_owner_user_id, p_summary:=p_summary, p_campaign_ref:=null, p_tenant_id:=v_tenant);
  v_id := nullif(v_result->>'plan_id','')::uuid;
  if (v_result->>'ok') is distinct from 'true' or v_id is null
    or not exists(select 1 from public.plans where id=v_id and tenant_id=v_tenant and created_by=v_actor) then
    raise exception 'PLAN_CREATE_UNCONFIRMED' using errcode='P0001';
  end if;
  return jsonb_build_object('ok',true,'plan_id',v_id,'tenant_id',v_tenant,'actor_id',v_actor);
end; $$;

create or replace function public.plan_add_milestone_scoped(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_plan_id uuid, p_title text,
  p_summary text default null, p_due_at timestamptz default null,
  p_assigned_to_user_id uuid default null, p_priority text default 'normal'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_result jsonb; v_id uuid;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
    raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501';
  end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  v_tenant := public.current_user_tenant_id();
  if v_tenant is distinct from p_expected_tenant_id then raise exception 'PLAN_SCOPE_CHANGED' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 500
    or coalesce(length(p_summary),0)>10000 or p_priority is null or p_priority not in ('low','normal','high','urgent')
    or p_plan_id is null or p_assigned_to_user_id is null then
    raise exception 'PLAN_MILESTONE_INPUT_INVALID' using errcode='22023';
  end if;
  perform 1 from public.plans where id=p_plan_id and tenant_id=v_tenant for update;
  if not found then raise exception 'PLAN_PROJECT_UNAVAILABLE' using errcode='42501'; end if;
  v_result := public.plan_add_milestone(p_plan_id:=p_plan_id, p_title:=btrim(p_title),
    p_summary:=p_summary, p_due_at:=p_due_at, p_assigned_to_user_id:=p_assigned_to_user_id,
    p_priority:=p_priority, p_tenant_id:=v_tenant);
  v_id := nullif(v_result->>'item_id','')::uuid;
  if (v_result->>'ok') is distinct from 'true' or v_id is null
    or not exists(select 1 from public.plan_items where id=v_id and tenant_id=v_tenant
      and created_by=v_actor and plan_id=p_plan_id and item_type='milestone') then
    raise exception 'PLAN_CREATE_UNCONFIRMED' using errcode='P0001';
  end if;
  return jsonb_build_object('ok',true,'item_id',v_id,'tenant_id',v_tenant,'actor_id',v_actor);
end; $$;

revoke all on function public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text) to authenticated;
revoke all on function public.plan_add_milestone_scoped(uuid,uuid,uuid,text,text,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.plan_add_milestone_scoped(uuid,uuid,uuid,text,text,timestamptz,uuid,text) to authenticated;
commit;
