-- Generated with `supabase migration new`; ordered after the existing repository ledger.
-- Generic server-owned execution restriction. No identities or customer rows are changed.
alter table public.tenants add column if not exists comms_provider_execution_disabled boolean not null default false;

create or replace function public.enforce_comms_provider_tenant_restriction()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_disabled boolean;
begin
  select coalesce(raw_app_meta_data->>'comms_provider_execution' = 'disabled', false)
    into owner_disabled from auth.users where id = new.owner_user_id;
  if tg_op = 'INSERT' then
    -- The authoritative owner marker is set before canonical provisioning's first INSERT.
    new.comms_provider_execution_disabled := coalesce(owner_disabled, false);
  else
    if old.comms_provider_execution_disabled and not new.comms_provider_execution_disabled then
      raise exception 'COMMS_PROVIDER_EXECUTION_RESTRICTION_IMMUTABLE' using errcode = '42501';
    end if;
    if new.comms_provider_execution_disabled is distinct from old.comms_provider_execution_disabled
       and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' in ('authenticated', 'anon') then
      raise exception 'COMMS_PROVIDER_EXECUTION_RESTRICTION_SERVER_ONLY' using errcode = '42501';
    end if;
    new.comms_provider_execution_disabled := old.comms_provider_execution_disabled
      or new.comms_provider_execution_disabled or coalesce(owner_disabled, false);
  end if;
  return new;
end $$;
revoke all on function public.enforce_comms_provider_tenant_restriction() from public, anon, authenticated;
drop trigger if exists a00_comms_provider_tenant_restriction on public.tenants;
create trigger a00_comms_provider_tenant_restriction before insert or update on public.tenants
for each row execute function public.enforce_comms_provider_tenant_restriction();

create or replace function public.comms_provider_execution_allowed(
  _tenant_id uuid default null, _actor_user_id uuid default null, _recipient_email text default null
) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare subject_id uuid; owner_id uuid; restricted boolean; recipient_id uuid;
begin
  if _tenant_id is null and _actor_user_id is null and _recipient_email is null then return false; end if;
  if _recipient_email is not null and (_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then return false; end if;
  if _tenant_id is not null then
    select owner_user_id, comms_provider_execution_disabled into owner_id, restricted
      from public.tenants where id = _tenant_id;
    if not found or restricted then return false; end if;
  end if;
  if _actor_user_id is not null and not exists(select 1 from auth.users where id = _actor_user_id) then return false; end if;
  if _recipient_email is not null then
    select id into recipient_id from auth.users where lower(email) = lower(_recipient_email);
  end if;
  foreach subject_id in array array[owner_id, _actor_user_id, recipient_id] loop
    if subject_id is null then continue; end if;
    if exists(select 1 from auth.users where id = subject_id
      and raw_app_meta_data->>'comms_provider_execution' = 'disabled') then return false; end if;
    if exists(select 1 from public.tenants t where t.comms_provider_execution_disabled
      and (t.owner_user_id = subject_id or exists(select 1 from public.tenant_members m
        where m.tenant_id = t.id and m.user_id = subject_id and m.status = 'active'))) then return false; end if;
  end loop;
  -- An unmatched recipient is legitimate for existing platform invite delivery.
  return true;
end $$;
revoke all on function public.comms_provider_execution_allowed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.comms_provider_execution_allowed(uuid, uuid, text) to service_role;

create or replace function public.enforce_comms_provider_message_queue()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient jsonb;
begin
  if new.direction = 'outbound' and new.status in ('queued', 'sent') then
    if tg_op = 'UPDATE' and old.tenant_id is distinct from new.tenant_id
      and old.tenant_id is not null and not public.comms_provider_execution_allowed(old.tenant_id, null, null) then
      raise exception 'COMMS_PROVIDER_EXECUTION_DISABLED' using errcode = '42501';
    end if;
    if new.tenant_id is not null and not public.comms_provider_execution_allowed(new.tenant_id, null, null) then
      raise exception 'COMMS_PROVIDER_EXECUTION_DISABLED' using errcode = '42501';
    end if;
    for recipient in select value from jsonb_array_elements(new.recipients) loop
      if new.channel_type = 'email' and recipient->>'address' is not null and not public.comms_provider_execution_allowed(new.tenant_id, null, recipient->>'address') then
        raise exception 'COMMS_PROVIDER_EXECUTION_DISABLED' using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.enforce_comms_provider_message_queue() from public, anon, authenticated;
drop trigger if exists a00_comms_provider_message_queue on public.messages;
create trigger a00_comms_provider_message_queue before insert or update on public.messages
for each row execute function public.enforce_comms_provider_message_queue();

-- Preserve the canonical managed-sender contract; add only the authority floor.
CREATE OR REPLACE FUNCTION public.provision_paige_managed_email_connector(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant public.tenants%ROWTYPE;
  _shared_domain text;
  _local_part text;
  _address text;
  _reply_to text;
  _connector_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONNECTOR_TENANT_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _tenant
    FROM public.tenants
   WHERE id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_CONNECTOR_TENANT_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  -- A connector never raises the server-owned provider execution floor.
  IF NOT public.comms_provider_execution_allowed(p_tenant_id) THEN
    UPDATE public.channel_connectors
       SET active = false, status = 'disabled'
     WHERE tenant_id = p_tenant_id
       AND channel_type = 'email'
       AND provider = 'resend'
       AND config ->> 'managed_default' = 'true';
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('paige-managed-email:' || p_tenant_id::text, 0));

  -- account_type + parent_tenant_id classify the topology, not inheritance:
  -- agency roots, sub-accounts (child workspaces), and solo standalones each own their sender.
  IF _tenant.status NOT IN ('trial'::public.tenant_status, 'active'::public.tenant_status)
     OR _tenant.account_type NOT IN ('agency', 'standalone', 'enterprise', 'sub_account')
     OR coalesce((_tenant.features ->> 'system_workspace')::boolean, false) THEN
    UPDATE public.channel_connectors
       SET active = false, status = 'disabled'
     WHERE tenant_id = p_tenant_id
       AND channel_type = 'email'
       AND provider = 'resend'
       AND config ->> 'managed_default' = 'true';
    RETURN NULL;
  END IF;

  SELECT coalesce(nullif(shared_domain, ''), 'mail.paigeagent.ai'),
         coalesce(nullif(default_reply_to, ''), 'support@paigeagent.ai')
    INTO _shared_domain, _reply_to
    FROM public.platform_email_settings
   LIMIT 1;

  _shared_domain := coalesce(_shared_domain, 'mail.paigeagent.ai');
  _reply_to := coalesce(_reply_to, 'support@paigeagent.ai');
  _local_part := public.sanitize_email_local_part(coalesce(nullif(_tenant.slug, ''), _tenant.name, 'client'));
  -- Only an explicitly opted-in top-level Solo uses the registry selection.
  -- All other tiers retain the existing slug-derived sender behavior.
  IF _tenant.account_type = 'standalone' AND _tenant.parent_tenant_id IS NULL
     AND EXISTS (SELECT 1 FROM public.tenant_setup_business_context_meta m
       WHERE m.tenant_id=p_tenant_id AND m.managed_email_local_part IS NOT NULL) THEN
    SELECT coalesce(i.local_part,_local_part) INTO _local_part
      FROM public.tenant_email_identities i WHERE i.tenant_id=p_tenant_id;
    IF _local_part IS NULL THEN
      RAISE EXCEPTION 'Registered managed identity is missing' USING ERRCODE='40001';
    END IF;
  END IF;
  _address := _local_part || '@' || _shared_domain;

  IF EXISTS (
    SELECT 1
      FROM public.channel_connectors c
     WHERE c.channel_type = 'email'
       AND lower(c.inbound_address) = lower(_address)
       AND NOT (
         c.tenant_id = p_tenant_id
         AND c.provider = 'resend'
         AND c.config ->> 'managed_default' = 'true'
       )
  ) THEN
    RAISE EXCEPTION 'PAIGE_MANAGED_EMAIL_ADDRESS_CONFLICT: %', _address
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.channel_connectors (
    tenant_id, channel_type, provider, inbound_address, inbound_domain,
    display_name, from_name, from_address, reply_to, status, active, config
  ) VALUES (
    p_tenant_id, 'email', 'resend', _address, NULL,
    'Paige email', coalesce(nullif(_tenant.name, ''), 'Paige'), _address, _reply_to,
    'active', true,
    jsonb_build_object(
      'managed_default', true,
      'source', 'tenant_domain_spine',
      'web_hostname', _tenant.slug || '.paigeagent.ai'
    )
  )
  ON CONFLICT (tenant_id)
    WHERE channel_type = 'email'
      AND provider = 'resend'
      AND config ->> 'managed_default' = 'true'
  DO UPDATE SET
    inbound_address = EXCLUDED.inbound_address,
    inbound_domain = NULL,
    display_name = EXCLUDED.display_name,
    from_name = EXCLUDED.from_name,
    from_address = EXCLUDED.from_address,
    reply_to = EXCLUDED.reply_to,
    status = 'active',
    active = true,
    config = coalesce(public.channel_connectors.config, '{}'::jsonb)
      || EXCLUDED.config
  RETURNING id INTO _connector_id;

  RETURN _connector_id;
END;
$function$;
revoke all on function public.provision_paige_managed_email_connector(uuid) from public,anon,authenticated;
grant execute on function public.provision_paige_managed_email_connector(uuid) to service_role;



