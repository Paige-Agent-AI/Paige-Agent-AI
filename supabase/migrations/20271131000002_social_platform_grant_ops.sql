-- Workspace grants for platform-provided Social channels — the God Level management door.
-- Context: 20271131000001 created public.paige_social_platform_grants (RLS-forced, all client
-- roles revoked) with the comment "the service role is expected to enforce it when serving
-- platform-provided channels to a workspace". This migration adds the ONLY client door to
-- manage those rows: three security-definer RPCs gated on the platform-owner-only resolver.
-- Fail closed: resolve_platform_operator_workspace() returns zero rows for every caller who
-- is not the platform owner, so non-owners get SOCIAL_GRANTS_FORBIDDEN and nothing else.

create or replace function public.social_platform_grant_workspaces()
returns table(id uuid, name text, slug text)
language plpgsql
stable security definer set search_path = 'public', 'pg_catalog'
as $fn$
begin
  if auth.uid() is null then
    raise exception 'SOCIAL_GRANTS_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.resolve_platform_operator_workspace()) then
    raise exception 'SOCIAL_GRANTS_FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select t.id, t.name, t.slug
    from public.tenants t
    order by t.name
    limit 500;
end
$fn$;

create or replace function public.social_platform_grants_list()
returns table(tenant_id uuid, tenant_name text, platform text, granted boolean, granted_at timestamptz)
language plpgsql
stable security definer set search_path = 'public', 'pg_catalog'
as $fn$
begin
  if auth.uid() is null then
    raise exception 'SOCIAL_GRANTS_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.resolve_platform_operator_workspace()) then
    raise exception 'SOCIAL_GRANTS_FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select g.tenant_id, t.name, g.platform, (g.revoked_at is null) as granted, g.granted_at
    from public.paige_social_platform_grants g
    join public.tenants t on t.id = g.tenant_id
    where g.revoked_at is null
    order by t.name, g.platform;
end
$fn$;

create or replace function public.social_platform_grant_set(p_tenant uuid, p_platform text, p_granted boolean)
returns table(tenant_id uuid, platform text, granted boolean)
language plpgsql
volatile security definer set search_path = 'public', 'pg_catalog'
as $fn$
declare
  v_platforms text[] := array[
    'tiktok','instagram','facebook','linkedin','youtube','x','threads','pinterest','google_business','snapchat'
  ];
  v_tenant_name text;
begin
  if auth.uid() is null then
    raise exception 'SOCIAL_GRANTS_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.resolve_platform_operator_workspace()) then
    raise exception 'SOCIAL_GRANTS_FORBIDDEN' using errcode = '42501';
  end if;
  if p_tenant is null or p_platform is null or p_granted is null or not (p_platform = any(v_platforms)) then
    raise exception 'SOCIAL_GRANT_INVALID' using errcode = '22023';
  end if;
  select t.name into v_tenant_name from public.tenants t where t.id = p_tenant;
  if v_tenant_name is null then
    raise exception 'SOCIAL_GRANT_TENANT_UNKNOWN' using errcode = '23503';
  end if;

  if p_granted then
    insert into public.paige_social_platform_grants (tenant_id, platform, granted_by, granted_at, revoked_at)
    values (p_tenant, p_platform, auth.uid(), now(), null)
    on conflict (tenant_id, platform) do update
      set granted_by = auth.uid(), granted_at = now(), revoked_at = null;
  else
    update public.paige_social_platform_grants g
    set revoked_at = now()
    where g.tenant_id = p_tenant and g.platform = p_platform and g.revoked_at is null;
  end if;

  return query
    select p_tenant, p_platform,
           exists (select 1 from public.paige_social_platform_grants g
                   where g.tenant_id = p_tenant and g.platform = p_platform and g.revoked_at is null) as granted;
end
$fn$;

grant execute on function public.social_platform_grant_workspaces() to authenticated;
grant execute on function public.social_platform_grants_list() to authenticated;
grant execute on function public.social_platform_grant_set(uuid, text, boolean) to authenticated;

comment on function public.social_platform_grant_workspaces() is
  'God Level only: the workspace picker for channel grants. Gated on resolve_platform_operator_workspace; fail closed.';
comment on function public.social_platform_grants_list() is
  'God Level only: live (non-revoked) channel grants per workspace. Gated on resolve_platform_operator_workspace; fail closed.';
comment on function public.social_platform_grant_set(uuid, text, boolean) is
  'God Level only: grant or revoke one channel for one workspace. Gated on resolve_platform_operator_workspace; fail closed.';
