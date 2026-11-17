-- CLI-created, unused forward carrier after verified production frontier 27.
-- Extend the existing Zapier OAuth attempt/grant, never a second credential store.
-- No grant, provider activation, recurring process or customer record is created.
begin;

do $original_writer$
begin
 if (select md5(prosrc) from pg_proc where oid=
   'public.zapier_api_store_grant(uuid,uuid,text,text,timestamptz,text[],uuid,uuid)'::regprocedure)
   is distinct from 'c6e1d0935f21927221c084f0df8bccfe' then
  raise exception 'ZAPIER_ORIGINAL_GRANT_WRITER_CHANGED';
 end if;
 if (select md5(prosrc) from pg_proc where oid='public.zapier_api_disconnect(uuid,uuid)'::regprocedure)
   is distinct from '90e6aeaf282af0f19106f8c30bdb7d55' then
  raise exception 'ZAPIER_ORIGINAL_DISCONNECT_WRITER_CHANGED';
 end if;
end $original_writer$;

alter table public.tenant_zapier_api_oauth_attempts add column requested_scopes text[] not null
 default array['profile','zap:account:all']::text[];
alter table public.tenant_zapier_api_oauth_attempts add constraint zapier_api_requested_scopes_closed check (
 requested_scopes=array['profile','zap:account:all']::text[] or
 requested_scopes=array['profile','zap:account:all','zap','zap:write','zap:update','zap:pause','zap:runs','connection:read']::text[]
);

create function private.zapier_api_requested_scopes(p_profile text)
returns text[] language plpgsql immutable set search_path='' as $$
begin
 if p_profile='read_only' then return array['profile','zap:account:all']::text[]; end if;
 if p_profile='workflow_management' then
  return array['profile','zap:account:all','zap','zap:write','zap:update','zap:pause','zap:runs','connection:read']::text[];
 end if;
 raise exception 'ZAPIER_PERMISSION_PROFILE_INVALID' using errcode='22023';
end $$;
revoke all on function private.zapier_api_requested_scopes(text) from public,anon,authenticated,service_role;

-- Preserve the original three-argument begin ABI for old read-only callers.
-- The new connector calls this distinct name; no PostgREST overload ambiguity.
create function public.zapier_api_begin_scoped_oauth(_tenant uuid,_actor uuid,_state_hash text,_permission_profile text)
returns uuid language plpgsql security definer set search_path='' as $$
declare attempt_id uuid; requested text[];
begin
 requested:=private.zapier_api_requested_scopes(_permission_profile);
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,919));
 -- Serialize consent with tenant/member revocation; the original begin keeps
 -- the one-active-attempt advisory lock and cancellation semantics.
 perform 1 from public.tenants t where t.id=_tenant for share;
 perform 1 from public.tenant_members m where m.tenant_id=_tenant and m.user_id=_actor for share;
 if public.is_tenant_owner(_actor,_tenant) is distinct from true then
  raise exception 'ZAPIER_OAUTH_FORBIDDEN' using errcode='42501'; end if;
 if _permission_profile='workflow_management' and not exists(
  select 1 from public.tenants t join public.tenant_members m on m.tenant_id=t.id
  where t.id=_tenant and t.status='active' and t.archived_at is null
   and t.account_type::text='standalone' and t.parent_tenant_id is null and not public.is_company_workspace(t.id)
   and m.user_id=_actor and m.status='active' and m.role::text='owner'
 ) then raise exception 'ZAPIER_SOLO_OWNER_REQUIRED' using errcode='42501'; end if;
 attempt_id:=public.zapier_api_begin_oauth(_tenant,_actor,_state_hash);
 update public.tenant_zapier_api_oauth_attempts set requested_scopes=requested where id=attempt_id;
 return attempt_id;
end $$;
revoke all on function public.zapier_api_begin_scoped_oauth(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.zapier_api_begin_scoped_oauth(uuid,uuid,text,text) to service_role;

-- Same original encrypted writer, same ABI/OID/defaults and service-only ACL.
-- Completion is bound to the original stored OAuth request; refresh is bound to
-- the original connection generation/scopes. Callback/model input cannot upgrade it.
create or replace function public.zapier_api_store_grant(_tenant uuid,_actor uuid,_access text,_refresh text,
 _expires timestamptz,_scopes text[],_attempt uuid default null,_expected_generation uuid default null)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare requested text[]; sorted_requested text[]; sorted_granted text[];
begin
 if _tenant is null or _actor is null or nullif(_access,'') is null or nullif(_refresh,'') is null
  or _expires is null or _expires<=clock_timestamp() or _scopes is null
  or ((_attempt is null)=(_expected_generation is null)) then
  raise exception 'ZAPIER_GRANT_INVALID' using errcode='22023'; end if;
 -- Reuse ORIGINAL begin_oauth's tenant mutex before either domain row lock.
 -- Disconnect uses the same order, so attempt->connection / connection->attempt
 -- cannot form a cycle while finalizing or refreshing the original grant.
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,919));
 -- Take these locks BEFORE the owner/class decision and retain them through
 -- any wait for an OAuth attempt or the original connection upsert. A revoked
 -- membership/archive cannot slip into that wait and commit before this grant.
 perform 1 from public.tenants t where t.id=_tenant for share;
 perform 1 from public.tenant_members m where m.tenant_id=_tenant and m.user_id=_actor for share;
 if public.is_tenant_owner(_actor,_tenant) is distinct from true then
  raise exception 'ZAPIER_GRANT_FORBIDDEN' using errcode='42501'; end if;
 if _attempt is not null then
  select a.requested_scopes into requested from public.tenant_zapier_api_oauth_attempts a
   where a.id=_attempt and a.tenant_id=_tenant and a.actor_id=_actor and a.status='exchanging'
    and a.expires_at>clock_timestamp() for update;
  if not found then raise exception 'ZAPIER_OAUTH_NOT_ACTIVE' using errcode='40001'; end if;
 else
  select c.oauth_scopes into requested from public.tenant_zapier_api_connections c
   where c.tenant_id=_tenant and c.generation=_expected_generation for update;
  if not found then raise exception 'ZAPIER_GRANT_STALE' using errcode='40001'; end if;
 end if;
 select array_agg(s order by s) into sorted_requested from unnest(requested) s;
 select array_agg(s order by s) into sorted_granted from unnest(_scopes) s;
 if sorted_requested is null or sorted_granted is distinct from sorted_requested then
  raise exception 'ZAPIER_GRANT_SCOPE_CHANGED' using errcode='42501'; end if;
 if requested @> array['zap:write']::text[] and not exists(
  select 1 from public.tenants t join public.tenant_members m on m.tenant_id=t.id
  where t.id=_tenant and t.status='active' and t.archived_at is null
   and t.account_type::text='standalone' and t.parent_tenant_id is null and not public.is_company_workspace(t.id)
   and m.user_id=_actor and m.status='active' and m.role::text='owner'
 ) then raise exception 'ZAPIER_SOLO_OWNER_REQUIRED' using errcode='42501'; end if;
 if _attempt is not null then
  update public.tenant_zapier_api_oauth_attempts set status='success' where id=_attempt;
 end if;
 if _expected_generation is not null then
  update public.tenant_zapier_api_connections set updated_by=_actor,access_token_ct=public.platform_encrypt(_access),
   refresh_token_ct=public.platform_encrypt(_refresh),access_token_expires_at=_expires,oauth_scopes=_scopes,
   status='needs_attention',failure_code=null,accessible_zap_count=null,last_checked_at=null,last_success_at=null,
   generation=gen_random_uuid(),revision=revision+1,updated_at=clock_timestamp()
  where tenant_id=_tenant and generation=_expected_generation;
  if not found then raise exception 'ZAPIER_GRANT_STALE' using errcode='40001'; end if;
 else
  insert into public.tenant_zapier_api_connections(tenant_id,updated_by,access_token_ct,refresh_token_ct,
   access_token_expires_at,oauth_scopes,status)
  values(_tenant,_actor,public.platform_encrypt(_access),public.platform_encrypt(_refresh),_expires,_scopes,'needs_attention')
  on conflict(tenant_id) do update set updated_by=_actor,access_token_ct=public.platform_encrypt(_access),
   refresh_token_ct=public.platform_encrypt(_refresh),access_token_expires_at=_expires,oauth_scopes=_scopes,
   status='needs_attention',failure_code=null,accessible_zap_count=null,last_checked_at=null,last_success_at=null,
   generation=gen_random_uuid(),revision=public.tenant_zapier_api_connections.revision+1,updated_at=clock_timestamp();
 end if;
end $$;
revoke all on function public.zapier_api_store_grant(uuid,uuid,text,text,timestamptz,text[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.zapier_api_store_grant(uuid,uuid,text,text,timestamptz,text[],uuid,uuid) to service_role;

create or replace function public.zapier_api_disconnect(_tenant uuid,_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if _tenant is null or _actor is null then raise exception 'ZAPIER_DISCONNECT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text,919));
 perform 1 from public.tenants t where t.id=_tenant for share;
 perform 1 from public.tenant_members m where m.tenant_id=_tenant and m.user_id=_actor for share;
 if public.is_tenant_owner(_actor,_tenant) is distinct from true then
  raise exception 'ZAPIER_DISCONNECT_FORBIDDEN' using errcode='42501'; end if;
 delete from public.tenant_zapier_api_connections where tenant_id=_tenant;
 update public.tenant_zapier_api_oauth_attempts set status='cancelled'
  where tenant_id=_tenant and status in ('pending','exchanging');
 perform public._record_workspace_rail_event(_tenant,_actor,'zapier_api_connection',gen_random_uuid(),0,'zapier_api_disconnected');
end $$;
revoke all on function public.zapier_api_disconnect(uuid,uuid) from public,anon,authenticated;
grant execute on function public.zapier_api_disconnect(uuid,uuid) to service_role;

-- One native read-admission snapshot over the original membership and encrypted
-- connection metadata. It grants no action authority and reveals no credential.
-- The existing connector uses it before dispatch AND before result disclosure;
-- do not split role and generation into independently awaited checks.
create function public.zapier_api_workflow_read_authorized(_expected_tenant uuid,_expected_actor uuid,
 _generation uuid,_required_scope text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid()=_expected_actor and public.current_user_tenant_id()=_expected_tenant
  and _required_scope=any(array['zap:account:all','zap','connection:read','zap:runs']::text[])
  and exists(select 1 from public.tenants t join public.tenant_members m on m.tenant_id=t.id
   where t.id=_expected_tenant and t.status='active' and t.archived_at is null
    and t.account_type::text='standalone' and t.parent_tenant_id is null and not public.is_company_workspace(t.id)
    and m.user_id=_expected_actor and m.status='active' and m.role::text='owner' and m.is_owner
    and (_generation is null or exists(select 1 from public.tenant_zapier_api_connections c
     where c.tenant_id=t.id and c.generation=_generation and c.access_token_expires_at>clock_timestamp()
      and c.oauth_scopes @> array[_required_scope]::text[]))),false);
$$;
revoke all on function public.zapier_api_workflow_read_authorized(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.zapier_api_workflow_read_authorized(uuid,uuid,uuid,text) to authenticated,service_role;

-- One readiness projection, without credentials or implied permission to execute.
create or replace function public.get_zapier_api_readiness()
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare t uuid:=public.current_user_tenant_id(); u uuid:=auth.uid();
 c public.tenant_zapier_api_connections; a public.tenant_zapier_api_oauth_attempts; management boolean;
begin
 if u is null or t is null or not exists(select 1 from public.tenant_members m
  where m.tenant_id=t and m.user_id=u and m.status='active') then
  raise exception 'ZAPIER_FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.tenant_zapier_api_connections where tenant_id=t;
 select * into a from public.tenant_zapier_api_oauth_attempts where tenant_id=t order by created_at desc limit 1;
 management:=coalesce(c.oauth_scopes @> private.zapier_api_requested_scopes('workflow_management'),false);
 return jsonb_build_object('tenant_id',t,'can_manage',public.is_tenant_owner(u,t),'state',case
   when a.status in ('pending','exchanging') and a.expires_at>clock_timestamp() then 'connecting'
   when c.tenant_id is null then 'not_connected' else c.status end,
  'failure_code',c.failure_code,'accessible_zap_count',case when c.status='connected' then c.accessible_zap_count else null end,
  'last_checked_at',c.last_checked_at,'last_success_at',c.last_success_at,'has_local_connection',c.tenant_id is not null,
  'has_pending_authorization',coalesce(a.status in ('pending','exchanging') and a.expires_at>clock_timestamp(),false),
  'workflow_management_authorized',management,
  'can_authorize_workflow_management',exists(select 1 from public.tenants wt join public.tenant_members wm on wm.tenant_id=wt.id
   where wt.id=t and wt.status='active' and wt.archived_at is null and wt.account_type::text='standalone'
    and wt.parent_tenant_id is null and not public.is_company_workspace(wt.id)
    and wm.user_id=u and wm.status='active' and wm.role::text='owner' and wm.is_owner),
  'capabilities',jsonb_build_array('Read accessible Zap workflows','Run a contained connection check'),
  'limitations',case when management then jsonb_build_array('Connection permissions do not approve workflow changes or live triggers')
   else jsonb_build_array('Workflow management requires separate authorization','Does not grant PAIGE tool execution') end);
end $$;
revoke all on function public.get_zapier_api_readiness() from public,anon;
grant execute on function public.get_zapier_api_readiness() to authenticated,service_role;

commit;
