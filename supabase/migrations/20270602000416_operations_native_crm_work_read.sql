begin;
-- Caller RLS remains authoritative; this projection narrows legacy global-role
-- visibility to the selected Solo workspace. It creates no task/identity store.
create or replace function public.operations_crm_work_read(
 p_expected_actor_id uuid,p_expected_tenant_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_rows jsonb;
begin
 if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
   raise exception 'OPERATIONS_WORK_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=v_actor for update;
 if not found then raise exception 'OPERATIONS_WORK_SCOPE_CHANGED' using errcode='42501'; end if;
 v_tenant:=public.current_user_tenant_id();
 if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant) then
   raise exception 'OPERATIONS_WORK_SCOPE_CHANGED' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants t where t.id=v_tenant and t.account_type::text='standalone' and t.parent_tenant_id is null) then
   raise exception 'OPERATIONS_SOLO_UNAVAILABLE' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',r.id,'tenant_id',r.tenant_id,'user_id',r.user_id,'title',r.title,'description',r.description,
   'status',r.status,'due_date',r.due_date,'updated_at',r.updated_at,'created_at',r.created_at,
   'deal_id',r.deal_id,'biz_id',r.biz_id,
   'recorded_priority',case when r.metadata->>'priority' in ('P0','P1','P2','P3','low','normal','high','urgent') then r.metadata->>'priority' else null end,
   'estimated_minutes',case when jsonb_typeof(r.metadata->'estimated_minutes')='number' then
      case when (r.metadata->>'estimated_minutes') ~ '^[0-9]{1,10}$' then
        case when (r.metadata->>'estimated_minutes')::numeric<=2147483647 then (r.metadata->>'estimated_minutes')::integer else null end
      else null end else null end
 ) order by r.due_date nulls last,r.id),'[]'::jsonb) into v_rows
 from (select t.* from public.tasks t where t.tenant_id=v_tenant and (
   public.is_tenant_admin(v_tenant) or t.user_id=v_actor or exists(
    select 1 from public.clients c where c.tenant_id=v_tenant and c.linked_user_id=t.user_id and c.assigned_coach_user_id=v_actor
   )) order by t.due_date nulls last,t.id limit 201) r;
 return jsonb_build_object('ok',true,'actor_id',v_actor,'tenant_id',v_tenant,
   'has_more',jsonb_array_length(v_rows)>200,'tasks',(
    select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb)
    from jsonb_array_elements(v_rows) with ordinality e where e.ordinality<=200));
end; $$;
revoke all on function public.operations_crm_work_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.operations_crm_work_read(uuid,uuid) to authenticated;
comment on function public.operations_crm_work_read(uuid,uuid) is 'Bounded native CRM task projection under caller RLS and canonical Solo scope; no metadata payload, write, dispatch or separate work authority.';
commit;
