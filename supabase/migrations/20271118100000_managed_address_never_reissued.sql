-- ============================================================================
-- Experience 03 — a shared-domain address a business gives up is never issued to another business.
--
-- WHY. Review HIGH on #2983, reproduced on production in a rolled-back transaction: after business B
-- renamed, business A renaming itself to B's old slug was handed B's old <slug>@mail.paigeagent.ai, so it
-- would receive replies to B's past mail. Production (read 2026-10-27): 1 shared-domain address appears in
-- a business's message history and is held by no connector or identity today.
--
-- Two records carry a business's shared-domain address: channel_connectors.inbound_address decides where
-- replies are delivered, tenant_email_identities.local_part is the From printed on mail
-- (resolve_tenant_sender). Both are covered.
--
-- WHAT.
--   1. paige_retired_managed_addresses — a shared-domain address a business stopped holding, with that
--      business in retired_tenant_id. Service-only. No foreign key to tenants, and the column follows the
--      retired_tenant_id convention operator_account_deletion_plan skips, on purpose: deleting a business
--      must not delete or block on this record, and a deleted business's address must stay retired (its id
--      then matches no business, so nobody may take it).
--   2. Release: AFTER UPDATE/DELETE triggers on channel_connectors (inbound_address) and
--      tenant_email_identities (shared local_part) record the address they stop holding.
--   3. Refusal: BEFORE INSERT/UPDATE triggers refuse a shared-domain address that is retired by, or held
--      (connector or identity) by, another business, with 23505. provision_tenant_email_identity already
--      retries a 23505 with its next numbered variant, so it needs no change; set_tenant_email_identity and
--      register_solo_setup_managed_email are refused with a clear reason.
--   4. provision_paige_managed_email_connector: a slug-derived name takes the first numbered variant free of
--      another business's connector, its identity and the retired list, so creating or renaming a business
--      never fails on it and lands on the same address as the identity. Otherwise identical to
--      20270602000104.
--   5. check_solo_setup_managed_email reports a retired address unavailable. Otherwise identical to
--      20261104000000.
--   6. Backfill from message history.
--
-- NOT HERE: an identity's local part does not follow a rename (pre-existing; the old address stays reserved
-- to the business by this list). The business web hostname <slug>.paigeagent.ai is also reused when a slug is
-- freed. Release and take are not serialised per address (a race between two businesses' writes in the same
-- instant can still slip through; the unique indexes keep it to one holder). Releasing a retired address is a
-- service-role delete, deliberately without an API.
--
-- REVERSAL: drop the four triggers, restore the two function bodies from the migrations named above.
-- Proof: supabase/tests/managed_address_never_reissued.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.paige_retired_managed_addresses (
  address text PRIMARY KEY CHECK (address = lower(address) AND position('@' in address) > 1),
  retired_tenant_id uuid,
  retired_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('connector_released', 'identity_released', 'history_backfill'))
);
COMMENT ON TABLE public.paige_retired_managed_addresses IS
  'Shared PAIGE email domain addresses a business stopped holding. Never issued to another business. retired_tenant_id NULL = nobody may take it. No FK to tenants and the retired_tenant_id name are on purpose (operator account deletion skips it) (20271118100000). Written by triggers, migrations and, to release, the service role.';
ALTER TABLE public.paige_retired_managed_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_retired_managed_addresses FROM PUBLIC, anon, authenticated;

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
       AND r.retired_tenant_id IS DISTINCT FROM p_tenant_id)
$$;
REVOKE ALL ON FUNCTION public._managed_address_retired_for_other(text, uuid) FROM PUBLIC, anon, authenticated;

-- Retired by, or held (connector or shared identity) by, a business other than p_tenant_id.
CREATE OR REPLACE FUNCTION public._shared_address_taken_by_other(p_address text, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public._managed_address_retired_for_other(p_address, p_tenant_id)
      OR EXISTS (SELECT 1 FROM public.channel_connectors c
                  WHERE c.channel_type = 'email' AND lower(btrim(c.inbound_address)) = lower(btrim(p_address))
                    AND c.tenant_id IS DISTINCT FROM p_tenant_id)
      OR EXISTS (SELECT 1 FROM public.tenant_email_identities i
                  WHERE i.kind = 'shared'
                    AND lower(i.local_part) || '@' || public._paige_shared_email_domain() = lower(btrim(p_address))
                    AND i.tenant_id IS DISTINCT FROM p_tenant_id)
$$;
REVOKE ALL ON FUNCTION public._shared_address_taken_by_other(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── channel_connectors ────────────────────────────────────────────────────────
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
    INSERT INTO public.paige_retired_managed_addresses (address, retired_tenant_id, source)
    VALUES (_old, OLD.tenant_id, 'connector_released')
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
     AND split_part(lower(btrim(NEW.inbound_address)), '@', 2) = public._paige_shared_email_domain()
     AND (TG_OP = 'INSERT'
          OR lower(btrim(NEW.inbound_address)) IS DISTINCT FROM lower(btrim(OLD.inbound_address)))
     AND public._shared_address_taken_by_other(NEW.inbound_address, NEW.tenant_id) THEN
    RAISE EXCEPTION 'PAIGE_MANAGED_ADDRESS_RETIRED: % belongs or belonged to another business and is never issued here', lower(btrim(NEW.inbound_address))
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_retired_managed_address() FROM PUBLIC, anon, authenticated;

-- Address changes and new connectors only. Moving a connector to another business is not a product path:
-- no writer does it and the #2983 guard refuses it from the browser (existing proofs move one on purpose).
DROP TRIGGER IF EXISTS trg_refuse_retired_managed_address ON public.channel_connectors;
CREATE TRIGGER trg_refuse_retired_managed_address
BEFORE INSERT OR UPDATE OF inbound_address ON public.channel_connectors
FOR EACH ROW EXECUTE FUNCTION public.refuse_retired_managed_address();

DROP TRIGGER IF EXISTS trg_retire_channel_connector_managed_address ON public.channel_connectors;
CREATE TRIGGER trg_retire_channel_connector_managed_address
AFTER UPDATE OF inbound_address, tenant_id OR DELETE ON public.channel_connectors
FOR EACH ROW EXECUTE FUNCTION public.retire_channel_connector_managed_address();

-- ── tenant_email_identities (the From on mail) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.retire_tenant_email_identity_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.kind IS DISTINCT FROM 'shared' OR nullif(btrim(OLD.local_part), '') IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE'
     OR lower(NEW.local_part) IS DISTINCT FROM lower(OLD.local_part)
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    INSERT INTO public.paige_retired_managed_addresses (address, retired_tenant_id, source)
    VALUES (lower(btrim(OLD.local_part)) || '@' || public._paige_shared_email_domain(), OLD.tenant_id, 'identity_released')
    ON CONFLICT (address) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.retire_tenant_email_identity_address() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refuse_taken_tenant_email_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _address text;
BEGIN
  IF NEW.kind IS DISTINCT FROM 'shared' OR nullif(btrim(NEW.local_part), '') IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND lower(NEW.local_part) IS NOT DISTINCT FROM lower(OLD.local_part)
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  _address := lower(btrim(NEW.local_part)) || '@' || public._paige_shared_email_domain();
  -- Another business's identity is already refused by tenant_email_identities_local_part_uniq; this adds
  -- the retired list and another business's connector. 23505 lets provision_tenant_email_identity move on
  -- to its next numbered variant.
  IF public._managed_address_retired_for_other(_address, NEW.tenant_id)
     OR EXISTS (SELECT 1 FROM public.channel_connectors c
                 WHERE c.channel_type = 'email' AND lower(btrim(c.inbound_address)) = _address
                   AND c.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'IDENTITY_LOCAL_PART_TAKEN: % belongs or belonged to another business', lower(btrim(NEW.local_part))
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_taken_tenant_email_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_taken_tenant_email_identity ON public.tenant_email_identities;
CREATE TRIGGER trg_refuse_taken_tenant_email_identity
BEFORE INSERT OR UPDATE OF local_part, kind, tenant_id ON public.tenant_email_identities
FOR EACH ROW EXECUTE FUNCTION public.refuse_taken_tenant_email_identity();

DROP TRIGGER IF EXISTS trg_retire_tenant_email_identity_address ON public.tenant_email_identities;
CREATE TRIGGER trg_retire_tenant_email_identity_address
AFTER UPDATE OF local_part, kind, tenant_id OR DELETE ON public.tenant_email_identities
FOR EACH ROW EXECUTE FUNCTION public.retire_tenant_email_identity_address();

-- 4. Provisioning gives a slug-derived name the first variant no other business holds or gave up.
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

  -- A shared-domain address another business holds, or gave up, is never issued here (20271118100000).
  -- A name derived from the slug takes the first numbered variant free of all three (another business's
  -- connector, its sending identity, the retired list), the scheme provision_tenant_email_identity uses,
  -- so the connector and the identity land on the same address and creating or renaming a business
  -- never fails on it. A registered identity was checked by check_solo_setup_managed_email; the
  -- connector trigger refuses it as a backstop.
  IF NOT _registered THEN
    _base_local := _local_part;
    WHILE public._shared_address_taken_by_other(_address, p_tenant_id) LOOP
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
--    received at, and that no connector or identity holds now, is retired to that business (NULL if several
--    used it).
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
INSERT INTO public.paige_retired_managed_addresses (address, retired_tenant_id, source)
SELECT s.address, s.tenant_id, 'history_backfill'
  FROM shared s
 WHERE NOT EXISTS (SELECT 1 FROM public.channel_connectors c WHERE lower(btrim(c.inbound_address)) = s.address)
   AND NOT EXISTS (SELECT 1 FROM public.tenant_email_identities i
                    WHERE i.kind = 'shared' AND lower(i.local_part) || '@' || public._paige_shared_email_domain() = s.address)
ON CONFLICT (address) DO NOTHING;
