-- Platform-provided Social connections (owner green light 2026-11-04, ANT-162 slice 1).
-- Labeling for hub-adopted connections, per-workspace platform-channel grants
-- (empty by default: no workspace sees platform channels until a row exists),
-- the status projection gains the label, and a service-role adoption writer
-- that verifies the governed social_connection_adopt approval exactly like the
-- other social writers. Tenant-consented connections are untouched.

alter table public.paige_social_connections
  add column if not exists provided_by_platform boolean not null default false;

comment on column public.paige_social_connections.provided_by_platform is
  'True only for connections adopted from the platform operator hub under a governed social_connection_adopt approval. Tenant-consented connections stay false.';

create table if not exists public.paige_social_platform_grants (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint paige_social_platform_grants_pkey primary key (tenant_id, platform),
  constraint paige_social_platform_grants_platform_shape check (
    platform in ('tiktok','instagram','facebook','linkedin','youtube','x','threads','pinterest','google_business','snapchat')
  )
);

alter table public.paige_social_platform_grants enable row level security;
alter table public.paige_social_platform_grants force row level security;
revoke all on public.paige_social_platform_grants from public, anon, authenticated;

comment on table public.paige_social_platform_grants is
  'Per-workspace visibility of platform-provided Social channels. A row exists only where the operator turned a channel on for a workspace; the service role is the only writer.';

drop function if exists public.social_connection_status();
create function public.social_connection_status()
returns table(id uuid, requested_platform text, label text, status text,
              authorization_expires_at timestamptz, last_verified_at timestamptz,
              disconnected_at timestamptz, failure_code text, account_count bigint,
              provided_by_platform boolean)
language plpgsql
stable security definer set search_path to 'public','pg_catalog'
as $fn$
declare t uuid:=public.social_current_tenant_id(); u uuid:=auth.uid();
begin
  if u is null or t is null then raise exception 'SOCIAL_CONNECTION_STATUS_FORBIDDEN' using errcode='42501'; end if;
  return query
  select c.id,c.requested_platform,c.label,c.status,c.authorization_expires_at,c.last_verified_at,
         c.disconnected_at,c.failure_code,count(a.id),c.provided_by_platform
  from public.paige_social_connections c
  left join public.paige_social_accounts a
    on a.tenant_id=c.tenant_id and a.connection_id=c.id and a.status not in ('disconnected','revoked')
  where c.tenant_id=t
  group by c.id,c.requested_platform,c.label,c.status,c.authorization_expires_at,
           c.last_verified_at,c.disconnected_at,c.failure_code,c.provided_by_platform
  order by c.created_at,c.id;
end $fn$;

revoke all on function public.social_connection_status() from public, anon, service_role;
grant execute on function public.social_connection_status() to authenticated;

-- The adoption writer. Only the exact approved arguments (profileId + the accounts
-- the provider's own readback returned) may be written; every row lands labeled
-- provided_by_platform=true. Hub profile keys embed the tenant so two workspaces
-- adopting the same hub stay distinct rows under the global
-- (provider_key, provider_profile_key) uniqueness.
create or replace function public.social_adopt_platform_channels(
  _tenant_id uuid, _actor_id uuid, _confirmation_id uuid,
  _hub_profile_id text, _accounts jsonb, _observed_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $fn$
declare
  rec jsonb; k text; cid uuid; adopted int:=0; caps text[];
begin
  if auth.role()<>'service_role' then raise exception 'SOCIAL_ADOPT_FORBIDDEN' using errcode='42501'; end if;
  if not exists (
    select 1 from public.paige_pending_confirmations p
    where p.id=_confirmation_id and p.user_id=_actor_id and p.tenant_id=_tenant_id
      and p.tool_name='social_connection_adopt' and p.server_issued_at is not null and p.consumed_at is not null
      and p.args->>'profileId'=_hub_profile_id
  ) then raise exception 'SOCIAL_ADOPT_APPROVAL_INVALID' using errcode='42501'; end if;
  if _accounts is null or jsonb_typeof(_accounts)<>'array' or jsonb_array_length(_accounts)=0 then
    raise exception 'SOCIAL_ADOPT_READBACK_EMPTY' using errcode='P0002';
  end if;

  for rec in select * from jsonb_array_elements(_accounts) loop
    k := rec->>'platform';
    if k is null then raise exception 'SOCIAL_ADOPT_ACCOUNT_INVALID' using errcode='P0002'; end if;
    select coalesce(array_agg(v), '{}') into caps
      from jsonb_array_elements_text(coalesce(rec->'capabilities','[]'::jsonb)) as x(v);

    insert into public.paige_social_connections (
      tenant_id, provider_key, provider_profile_key, requested_platform, label,
      status, provided_by_platform, connected_by, last_verified_at
    ) values (
      _tenant_id, 'zernio',
      'hub:' || _tenant_id::text || ':' || _hub_profile_id || ':' || k,
      k, 'Platform connection', 'connected', true, _actor_id, _observed_at
    )
    on conflict (provider_key, provider_profile_key) do update
      set status='connected', provided_by_platform=true, disconnected_at=null,
          failure_code=null, last_verified_at=_observed_at, updated_at=now()
    returning id into cid;

    insert into public.paige_social_accounts (
      tenant_id, connection_id, provider_key, platform, account_id, account_kind,
      handle, display_name, avatar_url, status, capabilities, connected_by,
      connected_at, last_verified_at
    ) values (
      _tenant_id, cid, 'zernio', k,
      rec->>'providerAccountId', coalesce(rec->>'accountKind','channel'),
      rec->>'handle', rec->>'displayName', rec->>'avatarUrl',
      case when rec->>'status'='needs_reauth' then 'needs_reauth' else 'connected' end,
      caps, _actor_id, _observed_at, _observed_at
    )
    on conflict (tenant_id, provider_key, platform, account_id) do update
      set handle=coalesce(excluded.handle, public.paige_social_accounts.handle),
          display_name=coalesce(excluded.display_name, public.paige_social_accounts.display_name),
          avatar_url=coalesce(excluded.avatar_url, public.paige_social_accounts.avatar_url),
          status=excluded.status, capabilities=excluded.capabilities,
          last_verified_at=_observed_at, updated_at=now();
    adopted := adopted + 1;
  end loop;

  return jsonb_build_object('adopted', adopted, 'hub_profile_id', _hub_profile_id,
                            'observed_at', _observed_at);
end $fn$;

revoke all on function public.social_adopt_platform_channels(uuid, uuid, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
