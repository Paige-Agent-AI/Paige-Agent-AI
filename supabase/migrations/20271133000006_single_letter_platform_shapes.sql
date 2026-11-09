-- Single-letter platform keys are real: X.
--
-- The adapter's TypeScript side already allows them ("Single-letter keys are real
-- ('x')" — zernio.ts normalizePlatform, landed with the provider port), but four SQL
-- shapes never caught up and still demand two-plus characters — so an X connect that
-- survives the provider (fixed in the same PR: the door now calls /connect/twitter)
-- dies at the LAST step: the readback apply raises, adoption inserts violate their
-- CHECK, and publishing targets refuse the platform row. The grants table already
-- lists 'x' explicitly — the intent was always there; these shapes are the holdouts.
-- Plain statements, no wrapping transaction (the resolver-migration style that
-- applies cleanly; a begin; without commit; silently rolls back — lesson 2026-11-06).

alter table public.paige_social_accounts
  drop constraint if exists paige_social_accounts_platform_shape;
alter table public.paige_social_accounts
  add constraint paige_social_accounts_platform_shape check (platform ~ '^[a-z][a-z0-9_]{0,31}$');

alter table public.paige_social_targets
  drop constraint if exists paige_social_targets_platform_check;
alter table public.paige_social_targets
  add constraint paige_social_targets_platform_check check (platform ~ '^[a-z][a-z0-9_]{0,31}$');

create or replace function public.social_apply_connection_readback(
  _tenant_id uuid,
  _connection_id uuid,
  _attempt_id uuid,
  _token_hash text,
  _actor_id uuid,
  _accounts jsonb,
  _observed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_catalog'
as $$
declare
  connection_provider text;
  confirmation uuid;
  active_count integer:=0;
  reauth_count integer:=0;
  item jsonb;
  account_keys text[]:='{}'::text[];
  provider_account_id text;
  platform_name text;
  account_status text;
  capabilities text[];
begin
  if auth.role()<>'service_role' then
    raise exception 'SOCIAL_READBACK_FORBIDDEN' using errcode='42501';
  end if;
  if _accounts is null or jsonb_typeof(_accounts)<>'array' or jsonb_array_length(_accounts)>64 then
    raise exception 'SOCIAL_READBACK_INVALID' using errcode='22023';
  end if;

  select c.provider_key,a.confirmation_id into connection_provider,confirmation
  from public.paige_social_connections c
  join public.paige_social_connection_attempts a
    on a.tenant_id=c.tenant_id and a.connection_id=c.id
  join public.paige_pending_confirmations p on p.id=a.confirmation_id
  where c.tenant_id=_tenant_id and c.id=_connection_id
    and c.status='authorizing'
    and a.id=_attempt_id and a.token_hash=_token_hash
    and a.state='processing' and a.expires_at>now()
    and a.created_by=_actor_id
    and p.user_id=_actor_id and p.tenant_id=_tenant_id
    and p.tool_name='social_connection_start'
    and p.server_issued_at is not null and p.consumed_at is not null
  for update of c,a;
  if connection_provider is null or confirmation is null then
    raise exception 'SOCIAL_CONNECTION_ATTEMPT_INVALID' using errcode='P0001';
  end if;

  for item in select value from jsonb_array_elements(_accounts) loop
    provider_account_id:=nullif(btrim(item->>'providerAccountId'),'');
    platform_name:=lower(nullif(btrim(item->>'platform'),''));
    account_status:=nullif(btrim(item->>'status'),'');
    select coalesce(array_agg(distinct value order by value),'{}'::text[])
      into capabilities
    from jsonb_array_elements_text(coalesce(item->'capabilities','[]'::jsonb)) value
    where value ~ '^[a-z][a-z0-9_.:-]{0,79}$';
    if provider_account_id is null or length(provider_account_id)>240
       or platform_name is null or platform_name !~ '^[a-z][a-z0-9_]{0,31}$'
       or account_status not in ('connected','needs_reauth') then
      raise exception 'SOCIAL_ACCOUNT_READBACK_INVALID' using errcode='22023';
    end if;
    account_keys:=array_append(account_keys,encode(extensions.digest(platform_name||chr(31)||provider_account_id,'sha256'),'hex'));
    insert into public.paige_social_accounts(
      tenant_id,provider_key,connection_id,platform,account_id,account_kind,
      handle,display_name,avatar_url,status,selected,selected_at,connected_by,
      connected_at,last_verified_at,last_synced_at,revoked_at,capabilities,
      capabilities_verified_at,updated_at
    ) values (
      _tenant_id,connection_provider,_connection_id,platform_name,provider_account_id,'profile',
      nullif(left(item->>'handle',160),''),nullif(left(item->>'displayName',200),''),
      case when item->>'avatarUrl' ~ '^https://' then left(item->>'avatarUrl',2048) else null end,
      account_status,false,null,_actor_id,
      case when account_status='connected' then _observed_at else null end,
      _observed_at,_observed_at,null,capabilities,_observed_at,_observed_at
    )
    on conflict(tenant_id,provider_key,platform,account_id) do update set
      connection_id=excluded.connection_id,
      handle=excluded.handle,
      display_name=excluded.display_name,
      avatar_url=excluded.avatar_url,
      status=excluded.status,
      selected=case when excluded.status='connected' then public.paige_social_accounts.selected else false end,
      selected_at=case when excluded.status='connected' then public.paige_social_accounts.selected_at else null end,
      connected_by=excluded.connected_by,
      connected_at=case when excluded.status='connected' then coalesce(public.paige_social_accounts.connected_at,excluded.connected_at) else public.paige_social_accounts.connected_at end,
      last_verified_at=excluded.last_verified_at,
      last_synced_at=excluded.last_synced_at,
      revoked_at=null,
      capabilities=excluded.capabilities,
      capabilities_verified_at=excluded.capabilities_verified_at,
      updated_at=excluded.updated_at;
    if account_status='connected' then active_count:=active_count+1; else reauth_count:=reauth_count+1; end if;
  end loop;

  update public.paige_social_accounts
  set status='disconnected',selected=false,selected_at=null,updated_at=_observed_at
  where tenant_id=_tenant_id and connection_id=_connection_id
    and not (encode(extensions.digest(platform||chr(31)||account_id,'sha256'),'hex')=any(account_keys));

  update public.paige_social_connection_attempts
  set state='completed',processing_at=null,completed_at=_observed_at,provider_status='readback_verified'
  where id=_attempt_id;
  update public.paige_social_connections
  set status=case when active_count>0 then 'connected'
                  when reauth_count>0 then 'needs_reauth'
                  else 'setup_required' end,
      connected_by=_actor_id,last_verified_at=_observed_at,disconnected_at=null,
      failure_code=null,updated_at=_observed_at
  where tenant_id=_tenant_id and id=_connection_id;

  return jsonb_build_object('connection_id',_connection_id,'account_count',active_count+reauth_count,
    'connected_count',active_count,'needs_reauth_count',reauth_count,'verified_at',_observed_at);
end $$;

revoke all on function public.social_apply_connection_readback(uuid,uuid,uuid,text,uuid,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.social_apply_connection_readback(uuid,uuid,uuid,text,uuid,jsonb,timestamptz)
  to service_role;
