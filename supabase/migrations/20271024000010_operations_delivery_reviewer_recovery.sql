begin;

-- Only undecided responsibility may change. Submitted source and completed review remain facts.
create or replace function public.operations_delivery_freeze_submission()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.tenant_id,new.plan_id,new.work_item_id,new.client_id,
    new.artifact_version_id,new.artifact_digest,new.revision_no,new.submitted_by,new.submitted_at)
    is distinct from row(old.id,old.tenant_id,old.plan_id,old.work_item_id,old.client_id,
    old.artifact_version_id,old.artifact_digest,old.revision_no,old.submitted_by,old.submitted_at)
    or (new.reviewer_user_id is distinct from old.reviewer_user_id and not
      (old.state='in_review' and new.state='in_review' and old.reviewed_by is null
       and new.reviewed_by is null and old.reviewed_at is null and new.reviewed_at is null
       and old.review_note is null and new.review_note is null)) then
    raise exception 'DELIVERY_SUBMISSION_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;

create function public.operations_delivery_reassign_reviewer_scoped(
  p_submission_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,
  p_expected_updated_at timestamptz,p_reviewer_user_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_row public.operations_delivery_submissions%rowtype;
  v_work public.plan_items%rowtype;v_plan public.plans%rowtype;v_digest text;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501';end if;
  -- Same profile -> plan -> item -> submission -> artifact order as existing Delivery writers.
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501';end if;
  select * into v_row from public.operations_delivery_submissions where id=p_submission_id;
  select * into v_plan from public.plans where id=v_row.plan_id for update;
  select * into v_work from public.plan_items where id=v_row.work_item_id for update;
  select * into v_row from public.operations_delivery_submissions where id=p_submission_id for update;
  if v_row.id is null or v_row.tenant_id is distinct from p_expected_tenant_id
    or v_work.id is null or v_plan.id is null or v_work.tenant_id is distinct from p_expected_tenant_id
    or v_plan.tenant_id is distinct from p_expected_tenant_id or v_work.plan_id is distinct from v_row.plan_id
    or v_work.contact_id is distinct from v_row.client_id or v_work.status='cancelled' or v_plan.status='archived'
    or not exists(select 1 from public.clients where id=v_row.client_id and tenant_id=p_expected_tenant_id and merged_into_contact_id is null)
    or not coalesce(v_work.created_by=v_actor or v_work.assigned_to_user_id=v_actor
      or (public.is_tenant_admin(p_expected_tenant_id)
        and (public.has_any_role(v_actor,array['admin','super_admin']) or public.is_platform_owner())),false) then
    raise exception 'DELIVERY_WORK_UNAVAILABLE' using errcode='42501';end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at
    or exists(select 1 from public.operations_delivery_submissions where work_item_id=v_row.work_item_id and revision_no>v_row.revision_no) then
    raise exception 'DELIVERY_REVISION_CHANGED' using errcode='40001';end if;
  if v_row.state<>'in_review' or v_row.reviewed_by is not null or v_row.reviewed_at is not null
    or v_row.review_note is not null or p_reason is null or length(trim(p_reason))=0
    or length(p_reason)>4000 or p_reviewer_user_id=v_row.reviewer_user_id then
    raise exception 'DELIVERY_REASSIGNMENT_INVALID' using errcode='22023';end if;
  if p_reviewer_user_id is null or p_reviewer_user_id=v_row.submitted_by then
    raise exception 'DELIVERY_RESPONSIBILITY_UNAVAILABLE' using errcode='42501';end if;
  perform 1 from public.tenant_members where tenant_id=p_expected_tenant_id
    and user_id=p_reviewer_user_id and status='active' for share;
  if not found then raise exception 'DELIVERY_RESPONSIBILITY_UNAVAILABLE' using errcode='42501';end if;
  select encode(extensions.digest(a.snapshot::text,'sha256'),'hex') into v_digest
    from public.studio_artifact_versions a where a.id=v_row.artifact_version_id and a.tenant_id=p_expected_tenant_id
      and coalesce(public.is_tenant_admin(p_expected_tenant_id) or exists(select 1 from public.studio_sessions
        where id=a.session_id and tenant_id=p_expected_tenant_id and owner_user_id=v_actor),false)
      and coalesce(public.is_tenant_admin_as(p_reviewer_user_id,p_expected_tenant_id) or exists(select 1 from public.studio_sessions
        where id=a.session_id and tenant_id=p_expected_tenant_id and owner_user_id=p_reviewer_user_id),false) for share;
  if v_digest is null or v_digest is distinct from v_row.artifact_digest then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  update public.operations_delivery_submissions set reviewer_user_id=p_reviewer_user_id,
    updated_at=clock_timestamp() where id=v_row.id;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
    values(v_actor,'operations_delivery','delivery_reviewer_reassigned',v_row.id,
      jsonb_build_object('tenant_id',p_expected_tenant_id,'work_item_id',v_work.id,
        'revision_no',v_row.revision_no,'previous_reviewer_user_id',v_row.reviewer_user_id,
        'reviewer_user_id',p_reviewer_user_id,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'submission_id',v_row.id,'reviewer_user_id',p_reviewer_user_id,'state','in_review');
end $$;
revoke all on function public.operations_delivery_reassign_reviewer_scoped(uuid,uuid,uuid,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.operations_delivery_reassign_reviewer_scoped(uuid,uuid,uuid,timestamptz,uuid,text) to authenticated;

commit;
