-- ============================================================================
-- A2P platform-user consent evidence — schema, grants, RLS and send-gate proof.
--
-- Failing-first contract: before the paired migration, the first assertion fails
-- because consent_granted_at (and the rest of the platform-user evidence shape)
-- does not exist. Synthetic fixtures only; the transaction always rolls back.
--
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -1
--        -f supabase/tests/a2p_platform_user_consent.sql
-- Terminal row A2P_PLATFORM_USER_CONSENT_PROVEN = pass; any RAISE = fail.
-- ============================================================================
BEGIN;

DO $schema$
DECLARE
  missing_columns text[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
  FROM (
    VALUES
      ('consent_granted_at'),
      ('revoked_at'),
      ('source_url'),
      ('disclosure_version')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'communications_consents'
      AND c.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL_SCHEMA: missing communications_consents columns %', missing_columns;
  END IF;

  IF to_regprocedure('public.normalize_e164_phone(text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL_SCHEMA: normalize_e164_phone(text) is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.communications_consents'::regclass
      AND conname = 'comms_consents_platform_user_evidence_shape'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL_SCHEMA: platform-user evidence constraint is absent or unvalidated';
  END IF;

  IF to_regclass('public.comms_consents_active_platform_user_sms_uidx') IS NULL
     OR to_regclass('public.comms_consents_platform_user_history_idx') IS NULL THEN
    RAISE EXCEPTION 'FAIL_SCHEMA: active/history platform-user consent indexes are missing';
  END IF;

  -- #2087 (migration 20271027100000): a signed-in user reads, and may withdraw or revoke, but never
  -- writes consent; every writer is a service-role server path.
  IF NOT has_table_privilege('authenticated', 'public.communications_consents', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.communications_consents', 'revoked_at', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.communications_consents', 'withdrawn_at', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL_GRANTS: authenticated lost read or withdrawal';
  END IF;

  IF has_table_privilege('authenticated', 'public.communications_consents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.communications_consents', 'DELETE')
     OR has_column_privilege('authenticated', 'public.communications_consents', 'phone', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL_GRANTS: authenticated can write consent';
  END IF;

  IF has_table_privilege('anon', 'public.communications_consents', 'SELECT')
     OR has_table_privilege('anon', 'public.communications_consents', 'INSERT')
     OR has_table_privilege('anon', 'public.communications_consents', 'UPDATE')
     OR has_table_privilege('anon', 'public.communications_consents', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL_GRANTS: anon has direct consent-table DML';
  END IF;

  IF public.normalize_e164_phone('+1 (470) 200-3444') IS DISTINCT FROM '+14702003444' THEN
    RAISE EXCEPTION 'FAIL_E164: supported formatting did not normalize';
  END IF;

  IF public.normalize_e164_phone('470-200-3444') IS NOT NULL
     OR public.normalize_e164_phone('+0123456789') IS NOT NULL
     OR public.normalize_e164_phone('+1CALLPAIGE') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL_E164: ambiguous or invalid phone was accepted';
  END IF;
END
$schema$;

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('a2c00000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'a2p-consent-a@example.invalid'),
  ('a2c00000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'a2p-consent-b@example.invalid'),
  ('a2c00000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'a2p-consent-owner@example.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('a2c00000-0000-4000-8000-00000000aaa1', 'a2p-consent-a', 'A2P Consent A', 'active', 'standalone', 'A2A', '{}'::jsonb),
  ('a2c00000-0000-4000-8000-00000000bbb1', 'a2p-consent-b', 'A2P Consent B', 'active', 'standalone', 'A2B', '{}'::jsonb);

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('a2c00000-0000-4000-8000-0000000000a1', 'a2c00000-0000-4000-8000-00000000aaa1'),
  ('a2c00000-0000-4000-8000-0000000000b1', 'a2c00000-0000-4000-8000-00000000bbb1'),
  ('a2c00000-0000-4000-8000-0000000000f1', NULL);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('a2c00000-0000-4000-8000-00000000aaa1', 'a2c00000-0000-4000-8000-0000000000a1', 'admin', 'active', false, now()),
  ('a2c00000-0000-4000-8000-00000000bbb1', 'a2c00000-0000-4000-8000-0000000000b1', 'owner', 'active', true, now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a2c00000-0000-4000-8000-0000000000a1', 'admin'),
  ('a2c00000-0000-4000-8000-0000000000f1', 'super_admin')
ON CONFLICT DO NOTHING;

-- Two tenantless platform-user rows and two legacy tenant/contact-style rows.
INSERT INTO public.communications_consents (
  id, user_id, tenant_id, contact_id, email, phone,
  sms_transactional, source, consent_granted_at, source_url,
  disclosure_version, ip_address, user_agent
) VALUES
  ('a2c00000-0000-4000-8000-0000000010a1', 'a2c00000-0000-4000-8000-0000000000a1', NULL, NULL,
   'a2p-consent-a@example.invalid', '+14702003444', true, 'platform_signup', now(),
   'https://paigeagent.ai/auth?mode=signup', 'platform-sms-v1', '192.0.2.10', 'proof-a'),
  ('a2c00000-0000-4000-8000-0000000010b1', 'a2c00000-0000-4000-8000-0000000000b1', NULL, NULL,
   'a2p-consent-b@example.invalid', '+14702003445', true, 'platform_signup', now(),
   'https://paigeagent.ai/auth?mode=signup', 'platform-sms-v1', '192.0.2.11', 'proof-b'),
  ('a2c00000-0000-4000-8000-0000000020a1', NULL, 'a2c00000-0000-4000-8000-00000000aaa1', NULL,
   'tenant-a-contact@example.invalid', '+14702003446', true, 'legacy_tenant_form', NULL,
   NULL, NULL, NULL, NULL),
  ('a2c00000-0000-4000-8000-0000000020b1', NULL, 'a2c00000-0000-4000-8000-00000000bbb1', NULL,
   'tenant-b-contact@example.invalid', '+14702003447', true, 'legacy_tenant_form', NULL,
   NULL, NULL, NULL, NULL);

DO $behavior$
DECLARE
  n integer;
  blocked boolean;
BEGIN
  -- Constraints are non-vacuous: platform evidence must be strict E.164.
  blocked := false;
  BEGIN
    INSERT INTO public.communications_consents (
      user_id, phone, sms_transactional, source, consent_granted_at,
      source_url, disclosure_version
    ) VALUES (
      'a2c00000-0000-4000-8000-0000000000a1', '470-200-9999', true,
      'platform_signup', now(), 'https://paigeagent.ai/auth?mode=signup', 'platform-sms-v1'
    );
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL_E164: invalid platform evidence row inserted'; END IF;

  -- Only one active platform-user consent may exist for a user/phone pair.
  blocked := false;
  BEGIN
    INSERT INTO public.communications_consents (
      user_id, phone, sms_transactional, source, consent_granted_at,
      source_url, disclosure_version
    ) VALUES (
      'a2c00000-0000-4000-8000-0000000000a1', '+14702003444', true,
      'platform_signup', now(), 'https://paigeagent.ai/auth?mode=signup', 'platform-sms-v1'
    );
  EXCEPTION WHEN unique_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL_ACTIVE_UNIQUE: duplicate active consent inserted'; END IF;

  -- Real authenticated caller A: own platform row + own-tenant legacy row only.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"a2c00000-0000-4000-8000-0000000000a1","role":"authenticated"}',
    true
  );

  SELECT count(*) INTO n
  FROM public.communications_consents
  WHERE consent_granted_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL_OWN_READ: user A saw % platform rows, expected 1', n; END IF;

  SELECT count(*) INTO n
  FROM public.communications_consents
  WHERE id = 'a2c00000-0000-4000-8000-0000000010b1';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL_OTHER_USER: user A read user B platform consent'; END IF;

  SELECT count(*) INTO n
  FROM public.communications_consents
  WHERE tenant_id = 'a2c00000-0000-4000-8000-00000000bbb1';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL_CROSS_TENANT: user A read tenant B consent'; END IF;

  SELECT count(*) INTO n
  FROM public.communications_consents
  WHERE tenant_id = 'a2c00000-0000-4000-8000-00000000aaa1';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL_TENANT_REGRESSION: tenant A admin lost own-tenant consent'; END IF;

  -- Platform-owner oversight remains intact.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"a2c00000-0000-4000-8000-0000000000f1","role":"authenticated"}',
    true
  );
  SELECT count(*) INTO n
  FROM public.communications_consents
  WHERE consent_granted_at IS NOT NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL_OWNER_OVERSIGHT: platform owner saw % platform rows, expected 2', n; END IF;

  PERFORM set_config('role', 'postgres', true);

  -- The send gate accepts formatting, then fails closed after revocation.
  IF NOT public.has_sms_consent('+1 (470) 200-3444', false) THEN
    RAISE EXCEPTION 'FAIL_SEND_GATE: normalized active consent was not found';
  END IF;
  UPDATE public.communications_consents
  SET revoked_at = now()
  WHERE id = 'a2c00000-0000-4000-8000-0000000010a1';
  IF public.has_sms_consent('+14702003444', false) THEN
    RAISE EXCEPTION 'FAIL_SEND_GATE: revoked consent still authorizes SMS';
  END IF;

  blocked := false;
  BEGIN
    UPDATE public.communications_consents
    SET disclosure_version = 'rewritten-after-consent'
    WHERE id = 'a2c00000-0000-4000-8000-0000000010a1';
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL_IMMUTABILITY: disclosure evidence was rewritten'; END IF;

  blocked := false;
  BEGIN
    UPDATE public.communications_consents
    SET revoked_at = NULL
    WHERE id = 'a2c00000-0000-4000-8000-0000000010a1';
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL_REVOCATION: revoked_at was cleared'; END IF;
END
$behavior$;

SELECT 'A2P_PLATFORM_USER_CONSENT_PROVEN' AS proof;
ROLLBACK;
