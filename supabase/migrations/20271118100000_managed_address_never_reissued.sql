-- ============================================================================
-- Experience 03 — a managed address a business gives up is never issued to another business.
--
-- WHY. Review HIGH on #2983. A business's managed address is <slug>@mail.paigeagent.ai. Renaming the
-- business re-provisions its connector in place, so the old address is released, and the next business
-- whose slug (or Solo-registered name) produces it is given it by PAIGE's own provisioning. Replies to the
-- first business's past mail then reach the second. Production (read 2026-10-27): 1 address on the shared
-- domain appears in a business's message history and is held by no connector today.
--
-- WHAT.
--   1. paige_retired_managed_addresses — one row per released address on the shared domain, with the
--      business that held it (NULL = more than one did, so nobody may take it). Service-only.
--   2. trg_retire_channel_connector_managed_address (AFTER UPDATE/DELETE on channel_connectors): when a
--      connector stops holding an address on the shared domain, the address is recorded as retired.
--   3. trg_refuse_retired_managed_address (BEFORE INSERT/UPDATE): no connector may take an address
--      retired by another business (23505 PAIGE_MANAGED_ADDRESS_RETIRED). The business that gave it up may
--      take it back (renaming back to its old name).
--   4. provision_paige_managed_email_connector: a slug-derived name skips a retired address with a
--      numbered variant (left(name,36) || '-' || n, as provision_tenant_email_identity does), so creating or
--      renaming a business never fails on it. Body otherwise identical to 20270602000104.
--   5. check_solo_setup_managed_email reports a retired address as unavailable, so the Solo Setup screen
--      says so before registering. Body otherwise identical to 20261104000000.
--   6. Backfill from message history: shared-domain addresses that appear as a business's sender (outbound)
--      or recipient (inbound) and that no connector holds now.
--
-- NOT HERE: the business web hostname <slug>.paigeagent.ai is also reused when a slug is freed; that is a
-- separate surface. Releasing a retired address is a service-role delete, deliberately without an API.
--
-- REVERSAL: drop both triggers, restore the two function bodies from the migrations named above; the table
-- can stay (it is only read by those).
-- Proof: supabase/tests/managed_address_never_reissued.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.paige_retired_managed_addresses (
  address text PRIMARY KEY CHECK (address = lower(address) AND position('@' in address) > 1),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  retired_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('connector_released', 'history_backfill'))
);
COMMENT ON TABLE public.paige_retired_managed_addresses IS
  'Managed addresses on the shared PAIGE email domain that a business gave up. Never issued to another business. tenant_id NULL = nobody may take it. Written only by triggers and migrations (20271118100000).';
ALTER TABLE public.paige_retired_managed_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_retired_managed_addresses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.paige_retired_managed_addresses TO service_role;

CREATE OR REPLACE FUNCTION public._paige_shared_email_domain()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT lower(coalesce((SELECT nullif(shared_domain, '') FROM public.platform_email_settings LIMIT 1), 'mail.paigeagent.ai'))
$$;
REVOKE ALL ON FUNCTION public._paige_shared_email_domain() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._managed_address_retired_for_other(p_address text, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.paige_retired_managed_addresses r
     WHERE r.address = lower(btrim(p_address))
       AND r.tenant_id IS DISTINCT FROM p_tenant_id)
$$;
REVOKE ALL ON FUNCTION public._managed_address_retired_for_other(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.retire_channel_connector_managed_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _old text := lower(btrim(OLD.inbound_address));
BEGIN
  IF _old IS NULL OR split_part(_old, '@', 2) <> public._paige_shared_email_domain() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE'
     OR lower(btrim(NEW.inbound_address)) IS DISTINCT FROM _old
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    -- A connector removed because its business is being deleted retires the address to nobody: the
    -- business row is already gone, and a deleted business's address must not be re-issued either.
    INSERT INTO public.paige_retired_managed_addresses (address, tenant_id, source)
    SELECT _old, t.id, 'connector_released'
      FROM (SELECT 1) one LEFT JOIN public.tenants t ON t.id = OLD.tenant_id
    ON CONFLICT (address) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.retire_channel_connector_managed_address() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refuse_retired_managed_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.inbound_address IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR lower(btrim(NEW.inbound_address)) IS DISTINCT FROM lower(btrim(OLD.inbound_address))
          OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)
     AND public._managed_address_retired_for_other(NEW.inbound_address, NEW.tenant_id) THEN
    RAISE EXCEPTION 'PAIGE_MANAGED_ADDRESS_RETIRED: % was used by another business and is never issued again', lower(btrim(NEW.inbound_address))
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_retired_managed_address() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_retired_managed_address ON public.channel_connectors;
CREATE TRIGGER trg_refuse_retired_managed_address
BEFORE INSERT OR UPDATE OF inbound_address, tenant_id ON public.channel_connectors
FOR EACH ROW EXECUTE FUNCTION public.refuse_retired_managed_address();

DROP TRIGGER IF EXISTS trg_retire_channel_connector_managed_address ON public.channel_connectors;
CREATE TRIGGER trg_retire_channel_connector_managed_address
AFTER UPDATE OF inbound_address, tenant_id OR DELETE ON public.channel_connectors
FOR EACH ROW EXECUTE FUNCTION public.retire_channel_connector_managed_address();

-- 4. Provisioning skips a retired address for a slug-derived name.
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
  _base_local text;
  _n int := 1;
  _registered boolean := false;
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
    _registered := true;
  END IF;
  _address := _local_part || '@' || _shared_domain;

  -- A managed address another business gave up is never issued again (20271118100000). A name
  -- derived from the slug takes the next free numbered variant, the way provision_tenant_email_identity
  -- already does, so creating or renaming a business never fails on it. A registered identity was
  -- checked by check_solo_setup_managed_email; the connector trigger refuses it as a backstop.
  IF NOT _registered THEN
    _base_local := _local_part;
    WHILE public._managed_address_retired_for_other(_address, p_tenant_id) LOOP
      _n := _n + 1;
      _local_part := left(_base_local, 36) || '-' || _n::text;
      _address := _local_part || '@' || _shared_domain;
    END LOOP;
  END IF;

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

-- 5. Solo Setup's availability check reports a retired address as unavailable.
create or replace function public.check_solo_setup_managed_email(_local_part text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_tid uuid := public.solo_setup_assert_canonical_tenant();
  v_local text := lower(btrim(coalesce(_local_part,'')));
  v_domain text;
  v_reply_to text;
  v_taken boolean;
begin
  if public.solo_setup_access_scope()<>'owner_full' then
    raise exception 'Only the workspace Owner can register a Paige-managed email' using errcode='42501';
  end if;
  if v_local !~ '^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$' or position('..' in v_local)>0 then
    raise exception 'Enter a valid local email name of 1-64 characters' using errcode='22023';
  end if;
  select coalesce(nullif(shared_domain,''),'mail.paigeagent.ai'),lower(default_reply_to)
    into v_domain,v_reply_to from public.platform_email_settings limit 1;
  v_domain := lower(coalesce(v_domain,'mail.paigeagent.ai'));
  -- The existing sanitizer appends -team to ALL platform-reserved names.
  -- Compare only that exact transformation: do not truncate valid longer names.
  select public.sanitize_email_local_part(v_local)=v_local||'-team'
    or v_local||'@'||v_domain=v_reply_to
    or exists(select 1 from public.tenant_email_identities i
      where lower(i.local_part)=v_local and i.tenant_id<>v_tid)
    -- An address another business gave up is never issued again (20271118100000).
    or public._managed_address_retired_for_other(v_local||'@'||v_domain, v_tid)
    or exists(select 1 from public.channel_connectors c where c.channel_type='email'
      and (lower(c.inbound_address)=v_local||'@'||v_domain or lower(c.from_address)=v_local||'@'||v_domain)
      and not coalesce(c.tenant_id=v_tid and c.provider='resend' and c.config->>'managed_default'='true',false))
    into v_taken;
  return jsonb_build_object('localPart',v_local,'domain',v_domain,
    'address',v_local||'@'||v_domain,'available',not coalesce(v_taken,false),
    'registrationAvailable',exists(select 1 from public.tenants t where t.id=v_tid
      and t.status::text in ('trial','active') and not coalesce((t.features->>'system_workspace')::boolean,false)
      and not exists(select 1 from public.tenant_email_identities i where i.tenant_id=v_tid and i.status<>'active')));
end $$;

revoke all on function public.provision_paige_managed_email_connector(uuid) from public,anon,authenticated;
grant execute on function public.provision_paige_managed_email_connector(uuid) to service_role;
revoke all on function public.check_solo_setup_managed_email(text) from public,anon;
grant execute on function public.check_solo_setup_managed_email(text) to authenticated;


-- 6. Backfill from message history. An address on the shared domain that a business sent from or
--    received at, and that no connector holds now, is retired to that business (NULL if several used it).
WITH used AS (
  SELECT m.tenant_id, lower(btrim(m.sender ->> 'address')) AS address
    FROM public.messages m
   WHERE m.channel_type = 'email' AND m.direction = 'outbound' AND m.sender ->> 'address' IS NOT NULL
  UNION
  SELECT m.tenant_id, lower(btrim(r ->> 'address'))
    FROM public.messages m,
         jsonb_array_elements(CASE WHEN jsonb_typeof(m.recipients) = 'array' THEN m.recipients ELSE '[]'::jsonb END) r
   WHERE m.channel_type = 'email' AND m.direction = 'inbound' AND r ->> 'address' IS NOT NULL
), shared AS (
  SELECT u.address, CASE WHEN count(DISTINCT u.tenant_id) = 1 THEN min(u.tenant_id::text)::uuid END AS tenant_id
    FROM used u
   WHERE split_part(u.address, '@', 2) = public._paige_shared_email_domain()
     AND position('@' in u.address) > 1
   GROUP BY u.address
)
INSERT INTO public.paige_retired_managed_addresses (address, tenant_id, source)
SELECT s.address, s.tenant_id, 'history_backfill'
  FROM shared s
 WHERE NOT EXISTS (SELECT 1 FROM public.channel_connectors c WHERE lower(btrim(c.inbound_address)) = s.address)
ON CONFLICT (address) DO NOTHING;
