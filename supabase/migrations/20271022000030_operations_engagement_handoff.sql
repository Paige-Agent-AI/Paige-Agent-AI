-- Proposed forward allocation: applied250, queued signing260; recheck before merge.
-- Original Planning records own work; this source link is not a project engine.
begin;
create unique index if not exists plans_operations_engagement_once
 on public.plans(tenant_id,(metadata->'operations_engagement'->>'commercial_terms_id'))
 where metadata->'operations_engagement'->>'commercial_terms_id' is not null;

create unique index if not exists plans_operations_handoff_request_once
 on public.plans(tenant_id,(metadata->'operations_engagement'->>'request_id'))
 where metadata->'operations_engagement'->>'request_id' is not null;

create or replace function public.operations_engagement_handoff(
 p_expected_actor_id uuid,p_expected_tenant_id uuid,p_agreement_id uuid,
 p_expected_contact_id uuid,p_expected_terms_id uuid,p_expected_offer_id uuid,
 p_expected_version integer,p_expected_content_sha256 text,p_expected_sealed_sha256 text,
 p_expected_terms_updated_at timestamptz,p_request_id uuid,
 p_title text,p_owner_user_id uuid,p_starts_on date,p_ends_on date,
 p_milestones jsonb,p_summary text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_source public.paige_agreements%rowtype;
 v_terms public.tenant_client_agreements%rowtype;v_prior public.plans%rowtype;
 v_draft jsonb;v_provenance jsonb;v_project jsonb;v_plan_id uuid;v_step jsonb;
 v_result jsonb;v_ids jsonb:='[]'::jsonb;v_due timestamptz;v_assignee uuid;
begin
 if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
  raise exception 'OPERATIONS_HANDOFF_SCOPE_CHANGED' using errcode='42501';end if;
 perform 1 from public.profiles where user_id=v_actor for update;
 if not found then raise exception 'OPERATIONS_HANDOFF_SCOPE_CHANGED' using errcode='42501';end if;
 v_tenant:=public.current_user_tenant_id();
 if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant)
  or not coalesce(public.is_tenant_admin(v_tenant),false) then
  raise exception 'OPERATIONS_HANDOFF_FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.tenants where id=v_tenant and account_type::text='standalone' and parent_tenant_id is null) then
  raise exception 'OPERATIONS_SOLO_UNAVAILABLE' using errcode='42501';end if;
 if p_request_id is null or p_owner_user_id is null or p_title is null
  or length(btrim(p_title)) not between 1 and 500 or coalesce(length(p_summary),0)>10000
  or p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on
  or jsonb_typeof(p_milestones) is distinct from 'array' then
  raise exception 'OPERATIONS_HANDOFF_INPUT_INVALID' using errcode='22023';end if;
 if jsonb_array_length(p_milestones) not between 1 and 50 then
  raise exception 'OPERATIONS_HANDOFF_SCOPE_REQUIRED' using errcode='22023';end if;
 select * into v_source from public.paige_agreements where id=p_agreement_id and tenant_id=v_tenant for share;
 if not found or v_source.commercial_terms_id is null then
  raise exception 'OPERATIONS_HANDOFF_SOURCE_UNAVAILABLE' using errcode='42501';end if;
 select * into v_terms from public.tenant_client_agreements
  where id=v_source.commercial_terms_id and tenant_id=v_tenant for share;
 if not found or v_terms.contact_id is distinct from v_source.contact_id
  or v_terms.offer_id is distinct from v_source.offer_id or v_terms.status::text<>'active'
  or v_source.status<>'completed' or v_source.completed_at is null
  or v_source.version is null or v_source.version<1
  or v_source.sealed_storage_key is null or btrim(v_source.sealed_storage_key)=''
  or v_source.content_sha256 is null or v_source.sealed_sha256 is null
  or v_source.content_sha256 !~ '^[0-9a-f]{64}$'
  or v_source.sealed_sha256 !~ '^[0-9a-f]{64}$' then
  raise exception 'OPERATIONS_HANDOFF_SOURCE_INELIGIBLE' using errcode='42501';end if;
 if not exists(select 1 from public.clients where id=v_source.contact_id and tenant_id=v_tenant)
  or not exists(select 1 from public.tenant_products where id=v_source.offer_id and tenant_id=v_tenant) then
  raise exception 'OPERATIONS_HANDOFF_SOURCE_INELIGIBLE' using errcode='42501';end if;
 if v_source.contact_id is distinct from p_expected_contact_id
  or v_source.commercial_terms_id is distinct from p_expected_terms_id
  or v_source.offer_id is distinct from p_expected_offer_id
  or p_expected_version is null or v_source.version is distinct from p_expected_version
  or v_source.content_sha256 is distinct from p_expected_content_sha256
  or v_source.sealed_sha256 is distinct from p_expected_sealed_sha256
  or p_expected_terms_updated_at is null or v_terms.updated_at is distinct from p_expected_terms_updated_at then
  raise exception 'OPERATIONS_HANDOFF_SOURCE_CHANGED' using errcode='40001';end if;
 -- Serialize original commercial engagement across actors and retry/event keys.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text||':'||v_terms.id::text,0));
 if exists(select 1 from public.plans where tenant_id=v_tenant
  and metadata->'operations_engagement'->>'request_id'=p_request_id::text
  and metadata->'operations_engagement'->>'commercial_terms_id' is distinct from v_terms.id::text) then
  raise exception 'OPERATIONS_HANDOFF_REQUEST_REUSED' using errcode='40001';end if;
 v_draft:=jsonb_build_object('title',btrim(p_title),'summary',p_summary,'owner_user_id',p_owner_user_id,
  'starts_on',p_starts_on,'ends_on',p_ends_on,'milestones',p_milestones,'scope_origin','owner_reviewed');
 v_provenance:=jsonb_build_object('agreement_id',v_source.id,'commercial_terms_id',v_terms.id,
  'contact_id',v_source.contact_id,'offer_id',v_source.offer_id,'version',v_source.version,
  'content_sha256',v_source.content_sha256,'sealed_sha256',v_source.sealed_sha256,
  'terms_updated_at',v_terms.updated_at,'request_id',p_request_id,'scope_draft',v_draft);
 select * into v_prior from public.plans where tenant_id=v_tenant
  and metadata->'operations_engagement'->>'commercial_terms_id'=v_terms.id::text for update;
 if found then
  if v_prior.metadata->'operations_engagement'->>'request_id' is distinct from p_request_id::text
   or v_prior.metadata->'operations_engagement'->'scope_draft' is distinct from v_draft
   or v_prior.metadata->'operations_engagement'->>'agreement_id' is distinct from v_source.id::text
   or v_prior.metadata->'operations_engagement'->>'version' is distinct from v_source.version::text
   or (v_prior.metadata->'operations_engagement'->>'terms_updated_at')::timestamptz is distinct from v_terms.updated_at
   or v_prior.metadata->'operations_engagement'->>'content_sha256' is distinct from v_source.content_sha256
   or v_prior.metadata->'operations_engagement'->>'sealed_sha256' is distinct from v_source.sealed_sha256 then
   raise exception 'OPERATIONS_HANDOFF_ALREADY_LINKED: inspect existing project' using errcode='40001';end if;
  return jsonb_build_object('ok',true,'actor_id',v_actor,'tenant_id',v_tenant,'plan_id',v_prior.id,
   'milestone_ids',v_prior.metadata->'operations_engagement'->'milestone_ids',
   'replayed',true,'client_accepted',false);
 end if;
 -- Existing scoped Planning writers enforce active Team and legacy action authority.
 v_project:=public.plan_create_scoped(v_actor,v_tenant,btrim(p_title),'custom',p_starts_on,p_ends_on,
  'team',p_owner_user_id,p_summary);
 v_plan_id:=nullif(v_project->>'plan_id','')::uuid;
 if (v_project->>'ok') is distinct from 'true' or v_plan_id is null then
  raise exception 'OPERATIONS_HANDOFF_UNCONFIRMED' using errcode='P0001';end if;
 for v_step in select value from jsonb_array_elements(p_milestones) loop
  if jsonb_typeof(v_step) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(v_step) k where k not in ('title','summary','due_at','assigned_to_user_id','priority'))
   or jsonb_typeof(v_step->'title') is distinct from 'string'
   or length(btrim(v_step->>'title')) not between 1 and 500
   or (v_step ? 'summary' and jsonb_typeof(v_step->'summary') not in ('string','null'))
   or coalesce(length(v_step->>'summary'),0)>10000
   or jsonb_typeof(v_step->'assigned_to_user_id') is distinct from 'string'
   or (v_step ? 'priority' and jsonb_typeof(v_step->'priority') is distinct from 'string')
   or coalesce(v_step->>'priority','normal') not in ('low','normal','high','urgent') then
   raise exception 'OPERATIONS_HANDOFF_MILESTONE_INVALID' using errcode='22023';end if;
  v_assignee:=(v_step->>'assigned_to_user_id')::uuid;
  v_due:=null;
  if v_step->>'due_at' is not null then
   if jsonb_typeof(v_step->'due_at')<>'string' or v_step->>'due_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'OPERATIONS_HANDOFF_MILESTONE_DATE_INVALID' using errcode='22023';end if;
   v_due:=(v_step->>'due_at')::timestamptz;
  end if;
  v_result:=public.plan_add_milestone_scoped(v_actor,v_tenant,v_plan_id,v_step->>'title',
   v_step->>'summary',v_due,v_assignee,coalesce(v_step->>'priority','normal'));
  if (v_result->>'ok') is distinct from 'true' or v_result->>'item_id' is null then
   raise exception 'OPERATIONS_HANDOFF_UNCONFIRMED' using errcode='P0001';end if;
  update public.plan_items set contact_id=v_source.contact_id,
   metadata=metadata||jsonb_build_object('operations_engagement',jsonb_build_object(
    'agreement_id',v_source.id,'commercial_terms_id',v_terms.id,'version',v_source.version))
   where id=(v_result->>'item_id')::uuid and tenant_id=v_tenant and plan_id=v_plan_id;
  v_ids:=v_ids||jsonb_build_array(v_result->>'item_id');
 end loop;
 update public.plans set metadata=metadata||jsonb_build_object('operations_engagement',
  v_provenance||jsonb_build_object('milestone_ids',v_ids)) where id=v_plan_id and tenant_id=v_tenant;
 insert into public.audit_logs(user_id,entity,action,entity_id,data) values(v_actor,'plan',
  'operations_engagement_handoff',v_plan_id,jsonb_build_object('tenant_id',v_tenant,
   'agreement_id',v_source.id,'commercial_terms_id',v_terms.id,'version',v_source.version,'milestone_count',jsonb_array_length(v_ids)));
 return jsonb_build_object('ok',true,'actor_id',v_actor,'tenant_id',v_tenant,'plan_id',v_plan_id,
  'milestone_ids',v_ids,'replayed',false,'client_accepted',false);
end; $$;
revoke all on function public.operations_engagement_handoff(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text,uuid,date,date,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.operations_engagement_handoff(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text,uuid,date,date,jsonb,text) to authenticated;
commit;
