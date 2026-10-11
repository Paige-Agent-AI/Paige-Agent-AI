begin;

-- Delivery-specific facts only: Planning and Studio remain the work/artifact sources.
create table public.operations_delivery_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  plan_id uuid not null references public.plans(id),
  work_item_id uuid not null references public.plan_items(id),
  client_id uuid not null references public.clients(id),
  artifact_version_id uuid not null references public.studio_artifact_versions(id),
  artifact_digest text not null check (length(artifact_digest)=64),
  revision_no integer not null check (revision_no>0),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewer_user_id uuid not null references auth.users(id),
  state text not null default 'in_review' check (state in ('in_review','revision_requested','approved')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(work_item_id,revision_no),
  check(reviewer_user_id<>submitted_by),
  check((state='in_review' and reviewed_by is null and reviewed_at is null)
    or (state<>'in_review' and reviewed_by=reviewer_user_id and reviewed_at is not null)),
  check(state<>'revision_requested' or length(trim(review_note))>0)
);
alter table public.operations_delivery_submissions enable row level security;
revoke all on public.operations_delivery_submissions from public,anon,authenticated;
-- No direct table grant: scoped projection below is the sole staff read path.

create function public.operations_delivery_freeze_submission()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.tenant_id,new.plan_id,new.work_item_id,new.client_id,
    new.artifact_version_id,new.artifact_digest,new.revision_no,new.submitted_by,
    new.submitted_at,new.reviewer_user_id)
    is distinct from row(old.id,old.tenant_id,old.plan_id,old.work_item_id,old.client_id,
    old.artifact_version_id,old.artifact_digest,old.revision_no,old.submitted_by,
    old.submitted_at,old.reviewer_user_id) then
    raise exception 'DELIVERY_SUBMISSION_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
create trigger operations_delivery_submission_immutable before update
on public.operations_delivery_submissions for each row execute function public.operations_delivery_freeze_submission();

create function public.operations_delivery_submit_scoped(
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
    or not coalesce(public.is_tenant_admin(p_expected_tenant_id) or v_plan.created_by=v_actor
      or v_plan.owner_user_id=v_actor or v_work.assigned_to_user_id=v_actor,false) then
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

revoke all on function public.operations_delivery_freeze_submission() from public,anon,authenticated;
revoke all on function public.operations_delivery_submit_scoped(uuid,uuid,uuid,uuid,uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.operations_delivery_submit_scoped(uuid,uuid,uuid,uuid,uuid,timestamptz,integer) to authenticated;

create function public.operations_delivery_review_scoped(
  p_submission_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,
  p_expected_updated_at timestamptz,p_decision text,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_row public.operations_delivery_submissions%rowtype;
  v_work public.plan_items%rowtype;v_plan public.plans%rowtype;v_digest text;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  select * into v_row from public.operations_delivery_submissions where id=p_submission_id;
  select * into v_plan from public.plans where id=v_row.plan_id for update;
  select * into v_work from public.plan_items where id=v_row.work_item_id for update;
  select * into v_row from public.operations_delivery_submissions where id=p_submission_id for update;
  if v_row.id is null or v_row.tenant_id is distinct from p_expected_tenant_id
    or v_row.reviewer_user_id is distinct from v_actor or v_row.submitted_by=v_actor
    or v_work.id is null or v_plan.id is null or v_work.tenant_id is distinct from v_row.tenant_id
    or v_plan.tenant_id is distinct from v_row.tenant_id or v_work.plan_id is distinct from v_row.plan_id
    or v_work.contact_id is distinct from v_row.client_id or v_work.status='cancelled' or v_plan.status='archived'
    or not exists(select 1 from public.clients where id=v_row.client_id and tenant_id=v_row.tenant_id and merged_into_contact_id is null) then
    raise exception 'DELIVERY_REVIEW_UNAVAILABLE' using errcode='42501'; end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at
    or exists(select 1 from public.operations_delivery_submissions where work_item_id=v_row.work_item_id and revision_no>v_row.revision_no) then
    raise exception 'DELIVERY_REVISION_CHANGED' using errcode='40001'; end if;
  select encode(extensions.digest(a.snapshot::text,'sha256'),'hex') into v_digest
    from public.studio_artifact_versions a where a.id=v_row.artifact_version_id and a.tenant_id=v_row.tenant_id
      and (public.is_tenant_admin(v_row.tenant_id) or exists(select 1 from public.studio_sessions
        where id=a.session_id and tenant_id=v_row.tenant_id and owner_user_id=v_actor)) for share;
  if v_digest is null or v_digest is distinct from v_row.artifact_digest then
    raise exception 'DELIVERY_SOURCE_CHANGED' using errcode='40001'; end if;
  if v_row.state<>'in_review' or p_decision is null or p_decision not in ('approved','revision_requested')
    or length(coalesce(p_note,''))>4000 or (p_decision='revision_requested' and length(trim(coalesce(p_note,'')))=0) then
    raise exception 'DELIVERY_DECISION_INVALID' using errcode='22023'; end if;
  update public.operations_delivery_submissions set state=p_decision,review_note=nullif(trim(p_note),''),
    reviewed_by=v_actor,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_row.id;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
  values(v_actor,'operations_delivery','delivery_reviewed',v_row.id,jsonb_build_object('tenant_id',p_expected_tenant_id,'state',p_decision,'revision_no',v_row.revision_no));
  return jsonb_build_object('ok',true,'submission_id',v_row.id,'state',p_decision);
end $$;

create function public.operations_delivery_list_scoped(p_work_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
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
    and coalesce(public.is_tenant_admin(p_expected_tenant_id) or v_plan.created_by=v_actor
      or v_plan.owner_user_id=v_actor or v_work.assigned_to_user_id=v_actor
      or s.submitted_by=v_actor or s.reviewer_user_id=v_actor,false);
  return jsonb_build_object('work_item_id',v_work.id,'submissions',v_result);
end $$;
revoke all on function public.operations_delivery_review_scoped(uuid,uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.operations_delivery_list_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_review_scoped(uuid,uuid,uuid,timestamptz,text,text) to authenticated;
grant execute on function public.operations_delivery_list_scoped(uuid,uuid,uuid) to authenticated;

-- Internal approval is deliberately not client acceptance. A separately verified
-- client artifact projection/release contract is required before that transition.
commit;
