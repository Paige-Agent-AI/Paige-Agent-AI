begin;
-- Explicit per-version client grant/decision facts; Studio remains the artifact home.
create table public.operations_delivery_client_releases (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.operations_delivery_submissions(id),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id),
  client_user_id uuid not null references auth.users(id),
  released_by uuid not null references auth.users(id),
  released_at timestamptz not null default now(),
  state text not null default 'awaiting_client' check(state in ('awaiting_client','client_revision_requested','accepted')),
  decision_by uuid references auth.users(id),
  decision_at timestamptz,
  client_note text,
  updated_at timestamptz not null default now(),
  check((state='awaiting_client' and decision_by is null and decision_at is null)
    or (state<>'awaiting_client' and decision_by=client_user_id and decision_at is not null)),
  check(state<>'client_revision_requested' or length(trim(client_note))>0)
);
alter table public.operations_delivery_client_releases enable row level security;
revoke all on public.operations_delivery_client_releases from public,anon,authenticated;

create function public.operations_delivery_release_scoped(
  p_submission_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_s public.operations_delivery_submissions%rowtype;
  v_p public.plans%rowtype;v_w public.plan_items%rowtype;v_c public.clients%rowtype;
  v_a public.studio_artifact_versions%rowtype;v_id uuid;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if not found or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_SCOPE_CHANGED' using errcode='42501'; end if;
  select * into v_s from public.operations_delivery_submissions where id=p_submission_id;
  select * into v_p from public.plans where id=v_s.plan_id for update;
  select * into v_w from public.plan_items where id=v_s.work_item_id for update;
  select * into v_s from public.operations_delivery_submissions where id=p_submission_id for update;
  select * into v_c from public.clients where id=v_s.client_id for share;
  select * into v_a from public.studio_artifact_versions where id=v_s.artifact_version_id for share;
  if v_s.id is null or v_s.tenant_id is distinct from p_expected_tenant_id or v_s.state<>'approved'
    or v_p.id is null or v_w.id is null or v_c.id is null or v_a.id is null
    or v_p.tenant_id is distinct from v_s.tenant_id or v_w.tenant_id is distinct from v_s.tenant_id
    or v_c.tenant_id is distinct from v_s.tenant_id or v_a.tenant_id is distinct from v_s.tenant_id
    or v_w.plan_id is distinct from v_s.plan_id or v_w.contact_id is distinct from v_s.client_id
    or v_w.status='cancelled' or v_p.status='archived' or v_c.merged_into_contact_id is not null
    or not coalesce(public.is_tenant_admin(v_s.tenant_id) or v_p.owner_user_id=v_actor or v_p.created_by=v_actor,false)
    or not coalesce(public.is_tenant_admin(v_s.tenant_id) or exists(select 1 from public.studio_sessions
      where id=v_a.session_id and tenant_id=v_s.tenant_id and owner_user_id=v_actor),false) then
    raise exception 'DELIVERY_RELEASE_UNAVAILABLE' using errcode='42501'; end if;
  if p_expected_updated_at is null or v_s.updated_at is distinct from p_expected_updated_at
    or exists(select 1 from public.operations_delivery_submissions where work_item_id=v_s.work_item_id and revision_no>v_s.revision_no)
    or encode(extensions.digest(v_a.snapshot::text,'sha256'),'hex') is distinct from v_s.artifact_digest then
    raise exception 'DELIVERY_SOURCE_CHANGED' using errcode='40001'; end if;
  if v_c.linked_user_id is null or exists(select 1 from public.tenant_members
    where tenant_id=v_s.tenant_id and user_id=v_c.linked_user_id and status='active') then
    raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  if v_a.kind<>'content' or v_a.snapshot->>'kind' is distinct from 'text'
    or jsonb_typeof(v_a.snapshot->'title') is distinct from 'string'
    or jsonb_typeof(v_a.snapshot->'body') is distinct from 'string'
    or length(trim(v_a.snapshot->>'title'))=0 or length(v_a.snapshot->>'title')>500
    or length(trim(v_a.snapshot->>'body'))=0 or length(v_a.snapshot->>'body')>200000 then
    raise exception 'DELIVERY_ARTIFACT_UNSUPPORTED' using errcode='22023'; end if;
  if exists(select 1 from public.operations_delivery_client_releases where submission_id=v_s.id) then
    raise exception 'DELIVERY_ALREADY_RELEASED' using errcode='40001'; end if;
  insert into public.operations_delivery_client_releases(submission_id,tenant_id,client_id,client_user_id,released_by)
    values(v_s.id,v_s.tenant_id,v_s.client_id,v_c.linked_user_id,v_actor) returning id into v_id;
  insert into public.audit_logs(user_id,entity,entity_id,action,data)
    values(v_actor,'operations_delivery',v_s.id,'delivery_released',jsonb_build_object('tenant_id',v_s.tenant_id,'release_id',v_id));
  return jsonb_build_object('ok',true,'release_id',v_id,'state','awaiting_client');
end $$;

create function public.operations_delivery_client_read_scoped(p_release_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  select jsonb_build_object('actor_id',v_actor,'tenant_id',r.tenant_id,'release_id',r.id,
    'submission_id',s.id,'state',r.state,'revision_no',s.revision_no,'artifact_digest',s.artifact_digest,
    'title',a.snapshot->>'title','body',a.snapshot->>'body','updated_at',r.updated_at)
  into v_result from public.operations_delivery_client_releases r
  join public.operations_delivery_submissions s on s.id=r.submission_id and s.tenant_id=r.tenant_id and s.client_id=r.client_id
  join public.clients c on c.id=r.client_id and c.tenant_id=r.tenant_id and c.linked_user_id=r.client_user_id and c.merged_into_contact_id is null
  join public.tenants t on t.id=r.tenant_id and t.account_type::text='standalone' and t.parent_tenant_id is null
  join public.plans p on p.id=s.plan_id and p.tenant_id=r.tenant_id and p.status<>'archived'
  join public.plan_items w on w.id=s.work_item_id and w.tenant_id=r.tenant_id and w.plan_id=p.id and w.contact_id=c.id and w.status<>'cancelled'
  join public.studio_artifact_versions a on a.id=s.artifact_version_id and a.tenant_id=r.tenant_id
  where r.id=p_release_id and r.tenant_id=p_expected_tenant_id and r.client_user_id=v_actor and s.state='approved'
    and not exists(select 1 from public.tenant_members where tenant_id=r.tenant_id and user_id=v_actor and status='active')
    and not exists(select 1 from public.operations_delivery_submissions where work_item_id=s.work_item_id and revision_no>s.revision_no)
    and encode(extensions.digest(a.snapshot::text,'sha256'),'hex')=s.artifact_digest
    and a.kind='content' and a.snapshot->>'kind'='text';
  if v_result is null then raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  return v_result;
end $$;
revoke all on function public.operations_delivery_release_scoped(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_release_scoped(uuid,uuid,uuid,timestamptz) to authenticated;
grant execute on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) to authenticated;
create function public.operations_delivery_client_decide_scoped(
  p_release_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,
  p_expected_updated_at timestamptz,p_decision text,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_r public.operations_delivery_client_releases%rowtype;
  v_s public.operations_delivery_submissions%rowtype;v_read jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  select * into v_r from public.operations_delivery_client_releases where id=p_release_id;
  select * into v_s from public.operations_delivery_submissions where id=v_r.submission_id;
  -- Preserve Planning's plan→work→submission lock order.
  perform 1 from public.plans where id=v_s.plan_id for update;
  perform 1 from public.plan_items where id=v_s.work_item_id for update;
  perform 1 from public.operations_delivery_submissions where id=v_s.id for share;
  select * into v_r from public.operations_delivery_client_releases where id=p_release_id for update;
  perform 1 from public.clients where id=v_r.client_id for share;
  perform 1 from public.studio_artifact_versions where id=v_s.artifact_version_id for share;
  v_read:=public.operations_delivery_client_read_scoped(p_release_id,p_expected_actor_id,p_expected_tenant_id);
  if p_expected_updated_at is null or v_r.updated_at is distinct from p_expected_updated_at or v_r.state<>'awaiting_client' then
    raise exception 'DELIVERY_CLIENT_DECISION_CHANGED' using errcode='40001'; end if;
  if p_decision is null or p_decision not in ('accepted','client_revision_requested')
    or length(coalesce(p_note,''))>4000 or (p_decision='client_revision_requested' and length(trim(coalesce(p_note,'')))=0) then
    raise exception 'DELIVERY_CLIENT_DECISION_INVALID' using errcode='22023'; end if;
  update public.operations_delivery_client_releases set state=p_decision,decision_by=v_actor,
    decision_at=clock_timestamp(),client_note=nullif(trim(p_note),''),updated_at=clock_timestamp() where id=v_r.id;
  insert into public.audit_logs(user_id,entity,entity_id,action,data)
    values(v_actor,'operations_delivery',v_s.id,'delivery_client_decision',
      jsonb_build_object('tenant_id',v_r.tenant_id,'release_id',v_r.id,'state',p_decision,'artifact_digest',v_read->>'artifact_digest'));
  return public.operations_delivery_client_read_scoped(p_release_id,p_expected_actor_id,p_expected_tenant_id);
end $$;

create function public.operations_delivery_freeze_client_release()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.submission_id,new.tenant_id,new.client_id,new.client_user_id,new.released_by,new.released_at)
    is distinct from row(old.id,old.submission_id,old.tenant_id,old.client_id,old.client_user_id,old.released_by,old.released_at)
    or old.state<>'awaiting_client' then
    raise exception 'DELIVERY_CLIENT_RELEASE_IMMUTABLE' using errcode='42501'; end if;
  return new;
end $$;
create trigger operations_delivery_client_release_immutable before update on public.operations_delivery_client_releases
  for each row execute function public.operations_delivery_freeze_client_release();
revoke all on function public.operations_delivery_freeze_client_release() from public,anon,authenticated;
revoke all on function public.operations_delivery_client_decide_scoped(uuid,uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.operations_delivery_client_decide_scoped(uuid,uuid,uuid,timestamptz,text,text) to authenticated;
-- Staff readback uses the existing submission projection as its authorization gate.
create function public.operations_delivery_client_status_scoped(
  p_work_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_authorized jsonb;v_result jsonb;
begin
  v_authorized:=public.operations_delivery_list_scoped(p_work_item_id,p_expected_actor_id,p_expected_tenant_id);
  select coalesce(jsonb_agg(jsonb_build_object('release_id',r.id,'submission_id',r.submission_id,
    'state',r.state,'released_by',r.released_by,'released_at',r.released_at,
    'decision_by',r.decision_by,'decision_at',r.decision_at,'client_note',r.client_note,
    'updated_at',r.updated_at) order by r.released_at desc),'[]'::jsonb) into v_result
  from public.operations_delivery_client_releases r
  where r.tenant_id=p_expected_tenant_id and exists(select 1
    from jsonb_array_elements(v_authorized->'submissions') s where s->>'id'=r.submission_id::text);
  return jsonb_build_object('work_item_id',p_work_item_id,'client_releases',v_result);
end $$;
revoke all on function public.operations_delivery_client_status_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_client_status_scoped(uuid,uuid,uuid) to authenticated;

-- Extend the same canonical submission writer; no parallel revision executor.
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
  if v_previous.id is not null and v_previous.state<>'revision_requested'
    and not (v_previous.state='approved' and exists(select 1 from public.operations_delivery_client_releases r
      where r.submission_id=v_previous.id and r.tenant_id=p_expected_tenant_id
        and r.state='client_revision_requested')) then
    raise exception 'DELIVERY_REVISION_NOT_REQUESTED' using errcode='22023'; end if;
  -- A client-requested revision requires new immutable source content. The original
  -- staff approval/client decision remain historical facts on their original version.
  if v_previous.id is not null and v_previous.state='approved' and
    (v_artifact.id=v_previous.artifact_version_id or
     encode(extensions.digest(v_artifact.snapshot::text,'sha256'),'hex')=v_previous.artifact_digest) then
    raise exception 'DELIVERY_NEW_ARTIFACT_REQUIRED' using errcode='22023'; end if;
  insert into public.operations_delivery_submissions(tenant_id,plan_id,work_item_id,client_id,
    artifact_version_id,artifact_digest,revision_no,submitted_by,reviewer_user_id)
  values(p_expected_tenant_id,v_plan.id,v_work.id,v_work.contact_id,v_artifact.id,
    encode(extensions.digest(v_artifact.snapshot::text,'sha256'),'hex'),v_revision+1,v_actor,p_reviewer_user_id)
  returning id into v_id;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
  values(v_actor,'operations_delivery','delivery_submitted',v_id,jsonb_build_object('tenant_id',p_expected_tenant_id,'revision_no',v_revision+1,'work_item_id',v_work.id));
  return jsonb_build_object('ok',true,'submission_id',v_id,'revision_no',v_revision+1,'state','in_review');
end $$;


commit;
