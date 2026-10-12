begin;
-- ANT-152: intersect canonical Planning item read with tenant-scoped Operations authority.
-- Plan ownership and historical submission do not grant current item visibility.
-- Explicit reviewer nomination remains per-submission and revalidates Studio authority/digest.
create or replace function public.operations_delivery_submit_scoped(
  p_work_item_id uuid,p_artifact_version_id uuid,p_reviewer_user_id uuid,
  p_expected_actor_id uuid,p_expected_tenant_id uuid,p_expected_work_updated_at timestamptz,
  p_expected_revision_no integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_plan public.plans%rowtype;v_work public.plan_items%rowtype;
  v_artifact public.studio_artifact_versions%rowtype;v_previous public.operations_delivery_submissions%rowtype;
  v_id uuid;v_revision integer;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  select * into v_work from public.plan_items where id=p_work_item_id;
  select * into v_plan from public.plans where id=v_work.plan_id for update;
  select * into v_work from public.plan_items where id=p_work_item_id for update;
  if v_work.id is null or v_plan.id is null or v_work.plan_id is distinct from v_plan.id
    or v_work.tenant_id is distinct from p_expected_tenant_id or v_plan.tenant_id is distinct from p_expected_tenant_id
    or v_work.item_type not in ('task','milestone') or v_work.status='cancelled' or v_plan.status='archived'
    or not coalesce((public.is_tenant_admin(p_expected_tenant_id)
      and (public.has_any_role(v_actor,array['admin','super_admin']) or public.is_platform_owner()))
      or v_work.created_by=v_actor or v_work.assigned_to_user_id=v_actor,false) then
    raise exception 'DELIVERY_WORK_UNAVAILABLE' using errcode='42501'; end if;
  if p_expected_work_updated_at is null or v_work.updated_at is distinct from p_expected_work_updated_at then
    raise exception 'DELIVERY_WORK_CHANGED' using errcode='40001'; end if;
  if not exists(select 1 from public.clients where id=v_work.contact_id and tenant_id=p_expected_tenant_id and merged_into_contact_id is null)
    or p_reviewer_user_id is null or p_reviewer_user_id=v_actor
    or not exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=p_reviewer_user_id and status='active') then
    raise exception 'DELIVERY_RESPONSIBILITY_UNAVAILABLE' using errcode='42501'; end if;
  select * into v_artifact from public.studio_artifact_versions where id=p_artifact_version_id for share;
  if v_artifact.id is null or v_artifact.tenant_id is distinct from p_expected_tenant_id
    or not coalesce(public.is_tenant_admin(p_expected_tenant_id) or exists(select 1 from public.studio_sessions
      where id=v_artifact.session_id and tenant_id=p_expected_tenant_id and owner_user_id=v_actor),false)
    or not coalesce(public.is_tenant_admin_as(p_reviewer_user_id,p_expected_tenant_id)
      or exists(select 1 from public.studio_sessions where id=v_artifact.session_id
        and tenant_id=p_expected_tenant_id and owner_user_id=p_reviewer_user_id),false) then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501'; end if;
  select * into v_previous from public.operations_delivery_submissions where work_item_id=p_work_item_id order by revision_no desc limit 1 for update;
  v_revision:=coalesce(v_previous.revision_no,0);
  if p_expected_revision_no is distinct from v_revision then
    raise exception 'DELIVERY_REVISION_CHANGED' using errcode='40001'; end if;
  if v_previous.id is not null and v_previous.state<>'revision_requested' then
    raise exception 'DELIVERY_REVISION_NOT_REQUESTED' using errcode='22023'; end if;
  insert into public.operations_delivery_submissions(tenant_id,plan_id,work_item_id,client_id,
    artifact_version_id,artifact_digest,revision_no,submitted_by,reviewer_user_id)
  values(p_expected_tenant_id,v_plan.id,v_work.id,v_work.contact_id,v_artifact.id,
    encode(extensions.digest(v_artifact.snapshot::text,'sha256'),'hex'),v_revision+1,v_actor,p_reviewer_user_id)
  returning id into v_id;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
  values(v_actor,'operations_delivery','delivery_submitted',v_id,jsonb_build_object('tenant_id',p_expected_tenant_id,'revision_no',v_revision+1,'work_item_id',v_work.id));
  return jsonb_build_object('ok',true,'submission_id',v_id,'revision_no',v_revision+1,'state','in_review');
end $$;

revoke all on function public.operations_delivery_submit_scoped(uuid,uuid,uuid,uuid,uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.operations_delivery_submit_scoped(uuid,uuid,uuid,uuid,uuid,timestamptz,integer) to authenticated;

create or replace function public.operations_delivery_list_scoped(p_work_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_work public.plan_items%rowtype;v_plan public.plans%rowtype;v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
    or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  select * into v_work from public.plan_items where id=p_work_item_id;
  select * into v_plan from public.plans where id=v_work.plan_id;
  if v_work.id is null or v_plan.id is null or v_work.tenant_id is distinct from p_expected_tenant_id
    or v_plan.tenant_id is distinct from p_expected_tenant_id then
    raise exception 'DELIVERY_WORK_UNAVAILABLE' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'tenant_id',s.tenant_id,'plan_id',s.plan_id,
    'work_item_id',s.work_item_id,'client_id',s.client_id,'artifact_version_id',s.artifact_version_id,
    'artifact_digest',s.artifact_digest,'revision_no',s.revision_no,'submitted_by',s.submitted_by,
    'submitted_at',s.submitted_at,'reviewer_user_id',s.reviewer_user_id,'state',s.state,
    'review_note',s.review_note,'reviewed_by',s.reviewed_by,'reviewed_at',s.reviewed_at,
    'updated_at',s.updated_at) order by s.revision_no desc),'[]'::jsonb) into v_result
  from public.operations_delivery_submissions s where s.work_item_id=v_work.id and s.tenant_id=p_expected_tenant_id
    and coalesce((public.is_tenant_admin(p_expected_tenant_id)
      and (public.has_any_role(v_actor,array['admin','super_admin']) or public.is_platform_owner()))
      or v_work.created_by=v_actor or v_work.assigned_to_user_id=v_actor
      or (s.reviewer_user_id=v_actor and exists(select 1 from public.studio_artifact_versions a
        where a.id=s.artifact_version_id and a.tenant_id=p_expected_tenant_id
          and encode(extensions.digest(a.snapshot::text,'sha256'),'hex')=s.artifact_digest
          and (public.is_tenant_admin(p_expected_tenant_id) or exists(select 1 from public.studio_sessions
            where id=a.session_id and tenant_id=p_expected_tenant_id and owner_user_id=v_actor)))),false);
  return jsonb_build_object('work_item_id',v_work.id,'submissions',v_result);
end $$;
revoke all on function public.operations_delivery_list_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_list_scoped(uuid,uuid,uuid) to authenticated;


commit;

