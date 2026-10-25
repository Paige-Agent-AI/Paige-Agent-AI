-- Owner Oct24 D2 ruling: explicitly review one's own exact version, then
-- release it for a SEPARATE client decision. Staff self-review stays refused.
-- Extend original canonical Delivery rows/writers; no new approval engine,
-- client grant, provider send, Planning authority or applied-history edit.
begin;
set local lock_timeout='5s';
do $guard$
declare original record; actual text; actual_header jsonb; definition text;
begin
  for original in select * from (values
    ('operations_delivery_artifact_scoped','725570b6b1e90a02275755e217466e55','{"arguments":"p_submission_id uuid, p_expected_actor_id uuid, p_expected_tenant_id uuid","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true,"config":["search_path=\"\""]}'::jsonb),
    ('operations_delivery_freeze_submission','c2bbbd896cfa51f756f3c3866258587e','{"arguments":"","result":"trigger","owner":"postgres","acl":"{postgres=X/postgres}","security_definer":false,"config":["search_path=\"\""]}'::jsonb),
    ('operations_delivery_list_scoped','062707a4dd3c0bac92c5f3317021334d','{"arguments":"p_work_item_id uuid, p_expected_actor_id uuid, p_expected_tenant_id uuid","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true,"config":["search_path=\"\""]}'::jsonb),
    ('operations_delivery_reassign_reviewer_scoped','9ffd6f6bd80283856d8e3acff1005c01','{"arguments":"p_submission_id uuid, p_expected_actor_id uuid, p_expected_tenant_id uuid, p_expected_updated_at timestamp with time zone, p_reviewer_user_id uuid, p_reason text","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true,"config":["search_path=\"\""]}'::jsonb),
    ('operations_delivery_review_scoped','a0039fcc9a1ffe318cede82264b989cb','{"arguments":"p_submission_id uuid, p_expected_actor_id uuid, p_expected_tenant_id uuid, p_expected_updated_at timestamp with time zone, p_decision text, p_note text","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true,"config":["search_path=\"\""]}'::jsonb),
    ('operations_delivery_reviews_scoped','858c5e1f6cad208111a6b2438b4686c7','{"arguments":"p_expected_actor_id uuid, p_expected_tenant_id uuid, p_limit integer DEFAULT 40","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true,"config":["search_path=\"\""]}'::jsonb),
    ('operations_delivery_submit_scoped','e97e99702a61ea2be38ab05e78302255','{"arguments":"p_work_item_id uuid, p_artifact_version_id uuid, p_reviewer_user_id uuid, p_expected_actor_id uuid, p_expected_tenant_id uuid, p_expected_work_updated_at timestamp with time zone, p_expected_revision_no integer","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true,"config":["search_path=\"\""]}'::jsonb)
  ) as expected(name,body_md5,header) loop
    select md5(p.prosrc),pg_catalog.jsonb_build_object(
      'arguments',pg_catalog.pg_get_function_arguments(p.oid),'result',pg_catalog.pg_get_function_result(p.oid),
      'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl::text,
      'security_definer',p.prosecdef,'config',p.proconfig)
      into actual,actual_header from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=original.name;
    if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=original.name)<>1
      or actual is distinct from original.body_md5 or actual_header is distinct from original.header then
      raise exception 'Original Delivery source/security changed; reconcile before applying: %',original.name;
    end if;
  end loop;
  select pg_catalog.pg_get_constraintdef(oid) into definition from pg_catalog.pg_constraint
    where conrelid='public.operations_delivery_submissions'::regclass and conname='operations_delivery_submissions_check';
  if definition is distinct from 'CHECK ((reviewer_user_id <> submitted_by))' then
    raise exception 'Original Delivery review identity changed; reconcile before applying';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.operations_delivery_submissions'::regclass
    and tgname='operations_delivery_submission_immutable' and tgtype=19 and tgenabled='O'
    and tgfoid='public.operations_delivery_freeze_submission()'::regprocedure) then
    raise exception 'Original Delivery immutable trigger changed; reconcile before applying';
  end if;
end $guard$;

-- Existing rows retain the truthful second-person interpretation. Only the
-- original scoped writers may choose owner_self_review for a current owner.
alter table public.operations_delivery_submissions add column review_mode text not null default 'second_person';
alter table public.operations_delivery_submissions drop constraint operations_delivery_submissions_check;
alter table public.operations_delivery_submissions add constraint operations_delivery_review_identity
  check((review_mode='second_person' and reviewer_user_id<>submitted_by)
    or (review_mode='owner_self_review' and reviewer_user_id=submitted_by));

create or replace function public.operations_delivery_freeze_submission()
returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='UPDATE' then
  if row(new.id,new.tenant_id,new.plan_id,new.work_item_id,new.client_id,
    new.artifact_version_id,new.artifact_digest,new.revision_no,new.submitted_by,new.submitted_at)
    is distinct from row(old.id,old.tenant_id,old.plan_id,old.work_item_id,old.client_id,
    old.artifact_version_id,old.artifact_digest,old.revision_no,old.submitted_by,old.submitted_at)
    or (row(new.reviewer_user_id,new.review_mode) is distinct from row(old.reviewer_user_id,old.review_mode) and not
      (old.state='in_review' and new.state='in_review' and old.reviewed_by is null
       and new.reviewed_by is null and old.reviewed_at is null and new.reviewed_at is null
       and old.review_note is null and new.review_note is null)) then
    raise exception 'DELIVERY_SUBMISSION_IMMUTABLE' using errcode='42501';
  end if;
  end if;
  -- Identity/mode is constrained on the original row. Owner status is checked at
  -- nomination and decision, not retroactively imposed on historical reviews.
  if new.review_mode='owner_self_review' then
    if TG_OP='INSERT' or new.reviewer_user_id is distinct from old.reviewer_user_id
      or new.review_mode is distinct from old.review_mode or new.state is distinct from old.state then
      -- Use the canonical owner predicate, and hold its existing membership row
      -- until the same native transaction finishes so concurrent demotion waits.
      perform 1 from public.tenant_members where tenant_id=new.tenant_id
        and user_id=new.submitted_by and status='active' and is_owner for share;
      if not found or not public.is_tenant_owner(new.submitted_by,new.tenant_id) then
        raise exception 'DELIVERY_OWNER_REVIEW_UNAVAILABLE' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end $$;

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
    or not coalesce(v_work.created_by=v_actor or v_work.assigned_to_user_id=v_actor
      or (public.is_tenant_admin(p_expected_tenant_id)
        and (public.has_any_role(v_actor,array['admin','super_admin']) or public.is_platform_owner())),false) then
    raise exception 'DELIVERY_WORK_UNAVAILABLE' using errcode='42501'; end if;
  if p_expected_work_updated_at is null or v_work.updated_at is distinct from p_expected_work_updated_at then
    raise exception 'DELIVERY_WORK_CHANGED' using errcode='40001'; end if;
  if not exists(select 1 from public.clients where id=v_work.contact_id and tenant_id=p_expected_tenant_id and merged_into_contact_id is null)
    or p_reviewer_user_id is null or (p_reviewer_user_id=v_actor
      and not public.is_tenant_owner(v_actor,p_expected_tenant_id))
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
    artifact_version_id,artifact_digest,revision_no,submitted_by,reviewer_user_id,review_mode)
  values(p_expected_tenant_id,v_plan.id,v_work.id,v_work.contact_id,v_artifact.id,
    encode(extensions.digest(v_artifact.snapshot::text,'sha256'),'hex'),v_revision+1,v_actor,p_reviewer_user_id,case when p_reviewer_user_id=v_actor then 'owner_self_review' else 'second_person' end)
  returning id into v_id;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
  values(v_actor,'operations_delivery','delivery_submitted',v_id,jsonb_build_object('tenant_id',p_expected_tenant_id,'revision_no',v_revision+1,'work_item_id',v_work.id,'review_mode',case when p_reviewer_user_id=v_actor then 'owner_self_review' else 'second_person' end));
  return jsonb_build_object('ok',true,'submission_id',v_id,'revision_no',v_revision+1,'state','in_review','review_mode',case when p_reviewer_user_id=v_actor then 'owner_self_review' else 'second_person' end);
end $$;

create or replace function public.operations_delivery_review_scoped(
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
    or v_row.reviewer_user_id is distinct from v_actor
    or (v_row.submitted_by=v_actor and (v_row.review_mode<>'owner_self_review'
      or not public.is_tenant_owner(v_actor,p_expected_tenant_id)))
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
  values(v_actor,'operations_delivery','delivery_reviewed',v_row.id,jsonb_build_object('tenant_id',p_expected_tenant_id,'state',p_decision,'revision_no',v_row.revision_no,'review_mode',v_row.review_mode));
  return jsonb_build_object('ok',true,'submission_id',v_row.id,'state',p_decision,'review_mode',v_row.review_mode);
end $$;

create or replace function public.operations_delivery_reassign_reviewer_scoped(
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
  if p_reviewer_user_id is null or (p_reviewer_user_id=v_row.submitted_by
    and not public.is_tenant_owner(p_reviewer_user_id,p_expected_tenant_id)) then
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
  update public.operations_delivery_submissions set reviewer_user_id=p_reviewer_user_id,review_mode=case when p_reviewer_user_id=v_row.submitted_by then 'owner_self_review' else 'second_person' end,
    updated_at=clock_timestamp() where id=v_row.id;
  insert into public.audit_logs(user_id,entity,action,entity_id,data)
    values(v_actor,'operations_delivery','delivery_reviewer_reassigned',v_row.id,
      jsonb_build_object('tenant_id',p_expected_tenant_id,'work_item_id',v_work.id,
        'revision_no',v_row.revision_no,'previous_reviewer_user_id',v_row.reviewer_user_id,
        'reviewer_user_id',p_reviewer_user_id,'review_mode',case when p_reviewer_user_id=v_row.submitted_by then 'owner_self_review' else 'second_person' end,'reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'submission_id',v_row.id,'reviewer_user_id',p_reviewer_user_id,'state','in_review','review_mode',case when p_reviewer_user_id=v_row.submitted_by then 'owner_self_review' else 'second_person' end);
end $$;

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
    'submitted_at',s.submitted_at,'reviewer_user_id',s.reviewer_user_id,'review_mode',s.review_mode,'state',s.state,
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

create or replace function public.operations_delivery_artifact_scoped(
  p_submission_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_s public.operations_delivery_submissions%rowtype;
  v_visible jsonb;v_a public.studio_artifact_versions%rowtype;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  select * into v_s from public.operations_delivery_submissions where id=p_submission_id and tenant_id=p_expected_tenant_id;
  if v_s.id is null then raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  v_visible:=public.operations_delivery_list_scoped(v_s.work_item_id,p_expected_actor_id,p_expected_tenant_id);
  if not exists(select 1 from jsonb_array_elements(v_visible->'submissions') row where row->>'id'=v_s.id::text) then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  select * into v_a from public.studio_artifact_versions a where a.id=v_s.artifact_version_id and a.tenant_id=p_expected_tenant_id
    and coalesce(public.is_tenant_admin(p_expected_tenant_id) or exists(select 1 from public.studio_sessions
      where id=a.session_id and tenant_id=p_expected_tenant_id and owner_user_id=v_actor),false);
  if v_a.id is null or encode(extensions.digest(v_a.snapshot::text,'sha256'),'hex') is distinct from v_s.artifact_digest
    or v_a.kind<>'content' or v_a.snapshot->>'kind' is distinct from 'text'
    or jsonb_typeof(v_a.snapshot->'title') is distinct from 'string'
    or jsonb_typeof(v_a.snapshot->'body') is distinct from 'string'
    or length(trim(v_a.snapshot->>'title'))=0 or length(v_a.snapshot->>'title')>500
    or length(trim(v_a.snapshot->>'body'))=0 or length(v_a.snapshot->>'body')>200000 then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  return jsonb_build_object('actor_id',v_actor,'tenant_id',v_s.tenant_id,'submission_id',v_s.id,
    'work_item_id',v_s.work_item_id,'plan_id',v_s.plan_id,'client_id',v_s.client_id,
    'artifact_version_id',v_a.id,'artifact_digest',v_s.artifact_digest,'revision_no',v_s.revision_no,
    'reviewer_user_id',v_s.reviewer_user_id,'submitted_by',v_s.submitted_by,'review_mode',v_s.review_mode,'state',v_s.state,
    'title',v_a.snapshot->>'title','body',v_a.snapshot->>'body','updated_at',v_s.updated_at);
end $$;

create or replace function public.operations_delivery_reviews_scoped(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_limit integer default 40
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_s public.operations_delivery_submissions%rowtype;
  v_artifact jsonb; v_work_version timestamptz;
  v_reviews jsonb:='[]'::jsonb;
  v_scanned integer:=0; v_unavailable integer:=0; v_more boolean:=false;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
    or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members
      where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants
      where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'DELIVERY_REVIEW_LIMIT_INVALID' using errcode='22023';
  end if;
  for v_s in select s.* from public.operations_delivery_submissions s
    where s.tenant_id=p_expected_tenant_id and s.reviewer_user_id=v_actor and s.state='in_review'
      and not exists(select 1 from public.operations_delivery_submissions newer
        where newer.tenant_id=s.tenant_id and newer.work_item_id=s.work_item_id and newer.revision_no>s.revision_no)
    order by s.submitted_at,s.id limit p_limit+1
  loop
    v_scanned:=v_scanned+1;
    if v_scanned>p_limit then v_more:=true;exit;end if;
    if v_s.review_mode='owner_self_review' and not public.is_tenant_owner(v_actor,p_expected_tenant_id) then
      v_unavailable:=v_unavailable+1;continue;
    end if;
    begin
      v_artifact:=public.operations_delivery_artifact_scoped(v_s.id,v_actor,p_expected_tenant_id);
    exception when insufficient_privilege then
      v_unavailable:=v_unavailable+1;continue;
    end;
    -- The delegated volatile reader can observe a newer state than the cursor.
    -- Never label a changed review/reviewer/revision as this caller's pending work.
    if v_artifact->>'submission_id' is distinct from v_s.id::text
      or v_artifact->>'state' is distinct from 'in_review'
      or v_artifact->>'reviewer_user_id' is distinct from v_actor::text
      or v_artifact->>'review_mode' is distinct from v_s.review_mode
      or v_artifact->>'revision_no' is distinct from v_s.revision_no::text
      or v_artifact->>'artifact_version_id' is distinct from v_s.artifact_version_id::text
      or v_artifact->>'artifact_digest' is distinct from v_s.artifact_digest
      or (v_artifact->>'updated_at')::timestamptz is distinct from v_s.updated_at
      or not exists(select 1 from public.operations_delivery_submissions current_s
        where current_s.id=v_s.id and current_s.tenant_id=p_expected_tenant_id
          and current_s.state='in_review' and current_s.reviewer_user_id=v_actor
          and current_s.review_mode=v_s.review_mode
          and current_s.updated_at=v_s.updated_at and current_s.revision_no=v_s.revision_no
          and not exists(select 1 from public.operations_delivery_submissions newer
            where newer.tenant_id=current_s.tenant_id and newer.work_item_id=current_s.work_item_id
              and newer.revision_no>current_s.revision_no)) then
      v_unavailable:=v_unavailable+1;continue;
    end if;
    select w.updated_at into v_work_version from public.plan_items w
      where w.id=v_s.work_item_id and w.tenant_id=p_expected_tenant_id;
    if v_work_version is null then v_unavailable:=v_unavailable+1;continue;end if;
    v_reviews:=v_reviews||jsonb_build_array(jsonb_build_object(
      'submission_id',v_s.id,'work_item_id',v_s.work_item_id,'plan_id',v_s.plan_id,'client_id',v_s.client_id,
      'artifact_version_id',v_s.artifact_version_id,'artifact_digest',v_s.artifact_digest,
      'revision_no',v_s.revision_no,'submitted_by',v_s.submitted_by,'reviewer_user_id',v_actor,'review_mode',v_s.review_mode,
      'submission_updated_at',v_s.updated_at,'work_updated_at',v_work_version,'title',v_artifact->>'title'));
  end loop;
  -- A workspace or membership change cannot turn the earlier nominations into a
  -- ready result under a newly revoked scope, including the partial-count path.
  if public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members
      where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active') then
    raise exception 'DELIVERY_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('actor_id',v_actor,'tenant_id',p_expected_tenant_id,
    'reviews',v_reviews,'unavailable_count',v_unavailable,'has_more',v_more);
end $$;

-- Keep the same original immutable-row guard, now including inserted owner facts.
drop trigger operations_delivery_submission_immutable on public.operations_delivery_submissions;
create trigger operations_delivery_submission_immutable before insert or update
  on public.operations_delivery_submissions for each row execute function public.operations_delivery_freeze_submission();
-- CREATE OR REPLACE preserves every existing function signature/owner/ACL.
-- No new table or function grants and no client decision/release writer change.
comment on column public.operations_delivery_submissions.review_mode is
  'Exact submitted-version internal review method. owner_self_review requires canonical current business ownership at nomination/decision; client release and client acceptance remain separate original records.';
commit;
