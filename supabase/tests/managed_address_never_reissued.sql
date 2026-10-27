-- ============================================================================
-- A shared-domain address a business gives up is never issued to another business — neither as the
-- connector address replies are delivered to, nor as the identity From printed on mail.
--
-- Failing-first contract. Before 20271118100000_managed_address_never_reissued this file errors at
-- assertion 2 (the retired list does not exist). The behaviour it guards was reproduced on production
-- separately, in a rolled-back transaction: after business B renamed, business A renaming itself to B's old
-- slug was handed B's old address (assertion 3's FAIL). Assertion 6 (an owner setting the From to a retired
-- address) also succeeds without the migration.
--
-- After it: B's released address is retired to B; A gets a numbered variant; no connector may take a
-- retired address directly; B may take its own back; an owner may not set the From to a retired address;
-- Solo Setup reports a retired-only address unavailable and a free one available; a new business whose
-- slug produces a retired address is created with the SAME numbered variant for its connector and its
-- identity; a variant held by another business is skipped rather than failing the rename; a deleted
-- connector and a changed identity retire their old addresses; a browser cannot read the list.
--
-- Synthetic fixtures only; the transaction always rolls back.
-- Run: psql "$DB_URL" -1 -f supabase/tests/managed_address_never_reissued.sql
-- Terminal row MANAGED_ADDRESS_NEVER_REISSUED_PROVEN = pass; any RAISE = fail.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.require_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

CREATE FUNCTION pg_temp.dom() RETURNS text LANGUAGE sql AS $$
  SELECT lower(coalesce((SELECT nullif(shared_domain, '') FROM public.platform_email_settings LIMIT 1), 'mail.paigeagent.ai'))
$$;

CREATE FUNCTION pg_temp.managed_address(t uuid) RETURNS text LANGUAGE sql AS $$
  SELECT lower(inbound_address) FROM public.channel_connectors
   WHERE tenant_id = t AND channel_type = 'email' AND provider = 'resend' AND config ->> 'managed_default' = 'true'
$$;

CREATE FUNCTION pg_temp.identity_local(t uuid) RETURNS text LANGUAGE sql AS $$
  SELECT lower(local_part) FROM public.tenant_email_identities WHERE tenant_id = t
$$;

CREATE FUNCTION pg_temp.retired_to(addr text, t uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.paige_retired_managed_addresses
                  WHERE address = addr || '@' || pg_temp.dom() AND tenant_id IS NOT DISTINCT FROM t)
$$;

CREATE FUNCTION pg_temp.as_owner_a() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"sub":"d2c00000-0000-4000-8000-000000000001","role":"authenticated"}', true)
$$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;

SELECT pg_temp.as_service();

-- ── Fixtures: two active standalone businesses, A with its signed-in owner (tenant owner + admin) ──
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('d2c00000-0000-4000-8000-0000000000a1', 'mani-a', 'MANI A', 'active', 'standalone', 'MNA', '{}'),
  ('d2c00000-0000-4000-8000-0000000000b1', 'mani-b', 'MANI B', 'active', 'standalone', 'MNB', '{}');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('d2c00000-0000-4000-8000-000000000001', 'owner-a@mani.test', now());
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
  ('d2c00000-0000-4000-8000-0000000000a1', 'd2c00000-0000-4000-8000-000000000001', 'owner', 'active', true);
INSERT INTO public.profiles (id, user_id, active_tenant_id) VALUES
  ('d2c00000-0000-4000-8000-000000000001', 'd2c00000-0000-4000-8000-000000000001', 'd2c00000-0000-4000-8000-0000000000a1')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d2c00000-0000-4000-8000-000000000001', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000a1');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000b1');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000b1') = 'mani-b@' || pg_temp.dom(),
  'fixture: B holds mani-b@');

-- 1-2. B renames: its connector follows, and the address it gave up is retired to B.
UPDATE public.tenants SET slug = 'mani-b-moved' WHERE id = 'd2c00000-0000-4000-8000-0000000000b1';
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000b1') = 'mani-b-moved@' || pg_temp.dom(),
  '1: B''s managed address followed the rename');
SELECT pg_temp.require_true(pg_temp.retired_to('mani-b', 'd2c00000-0000-4000-8000-0000000000b1'),
  '2: mani-b@ is recorded as retired to B');

-- 3. A's owner renames A to B's old slug from the app: the rename succeeds and A gets a numbered variant.
SELECT pg_temp.as_owner_a();
SET LOCAL ROLE authenticated;
UPDATE public.tenants SET slug = 'mani-b' WHERE id = 'd2c00000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT pg_temp.as_service();
SELECT pg_temp.require_true(
  (SELECT slug FROM public.tenants WHERE id = 'd2c00000-0000-4000-8000-0000000000a1') = 'mani-b',
  '3: the rename itself still succeeded');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000a1') = 'mani-b-2@' || pg_temp.dom(),
  '3: A was given mani-b-2@, not B''s old address');

-- 4. No connector may take B's retired address directly (backstop for every writer).
DO $$
BEGIN
  BEGIN
    UPDATE public.channel_connectors SET inbound_address = 'mani-b@' || pg_temp.dom()
     WHERE tenant_id = 'd2c00000-0000-4000-8000-0000000000a1' AND config ->> 'managed_default' = 'true';
    RAISE EXCEPTION 'FAIL: 4: A''s connector took B''s retired address';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE 'PAIGE_MANAGED_ADDRESS_RETIRED%' THEN
      RAISE EXCEPTION 'FAIL: 4: refused by something else: %', SQLERRM;
    END IF;
  END;
END $$;

-- 5. B may take its own old address back. This releases mani-b-moved@, retired to B and held by nobody.
UPDATE public.channel_connectors SET inbound_address = 'mani-b@' || pg_temp.dom(), from_address = 'mani-b@' || pg_temp.dom()
 WHERE tenant_id = 'd2c00000-0000-4000-8000-0000000000b1' AND config ->> 'managed_default' = 'true';
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000b1') = 'mani-b@' || pg_temp.dom(),
  '5: B took its own old address back');
SELECT pg_temp.require_true(pg_temp.retired_to('mani-b-moved', 'd2c00000-0000-4000-8000-0000000000b1'),
  '5: mani-b-moved@ is retired to B');
SELECT pg_temp.require_true(
  NOT EXISTS (SELECT 1 FROM public.channel_connectors WHERE lower(inbound_address) = 'mani-b-moved@' || pg_temp.dom())
  AND NOT EXISTS (SELECT 1 FROM public.tenant_email_identities WHERE lower(local_part) = 'mani-b-moved'),
  'fixture: nobody holds mani-b-moved@ now, so only the retired list can make it unavailable');

-- 6. A's owner may not set A's From to B's retired address.
SELECT pg_temp.as_owner_a();
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.set_tenant_email_identity(p_local_part => 'mani-b-moved');
    RAISE EXCEPTION 'FAIL: 6: A''s From was set to B''s retired address';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE 'IDENTITY_LOCAL_PART_TAKEN%' THEN
      RAISE EXCEPTION 'FAIL: 6: refused by something else: %', SQLERRM;
    END IF;
  END;
END $$;

-- 7. Solo Setup tells A's owner a retired-only address is unavailable, and a free one available.
SELECT pg_temp.require_true(
  (public.check_solo_setup_managed_email('mani-b-moved') ->> 'available')::boolean = false,
  '7: Solo Setup reports a retired-only address unavailable');
SELECT pg_temp.require_true(
  (public.check_solo_setup_managed_email('mani-free-name') ->> 'available')::boolean = true,
  '7: Solo Setup still reports a free name available');
RESET ROLE;
SELECT pg_temp.as_service();

-- 8. A NEW business whose slug produces a retired address is created, and its connector and its
--    identity (the From) land on the same numbered variant.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('d2c00000-0000-4000-8000-0000000000e1', 'mani-b-moved', 'MANI E', 'active', 'standalone', 'MNE', '{}');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000e1');
SELECT public.provision_tenant_email_identity('d2c00000-0000-4000-8000-0000000000e1');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000e1') = 'mani-b-moved-2@' || pg_temp.dom(),
  '8: the new business''s connector is mani-b-moved-2@');
SELECT pg_temp.require_true(
  pg_temp.identity_local('d2c00000-0000-4000-8000-0000000000e1') = 'mani-b-moved-2',
  '8: the new business''s From is mani-b-moved-2, matching its connector');

-- 9. A variant another business already holds is skipped, not a failed signup or rename.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('d2c00000-0000-4000-8000-0000000000c1', 'mani-c', 'MANI C', 'active', 'standalone', 'MNC', '{}'),
  ('d2c00000-0000-4000-8000-0000000000c2', 'mani-c-2', 'MANI X', 'active', 'standalone', 'MNX', '{}');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000c1');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000c2');
UPDATE public.tenants SET slug = 'mani-c-away' WHERE id = 'd2c00000-0000-4000-8000-0000000000c1';
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('d2c00000-0000-4000-8000-0000000000f1', 'mani-c', 'MANI F', 'active', 'standalone', 'MNF', '{}');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000f1');
SELECT public.provision_tenant_email_identity('d2c00000-0000-4000-8000-0000000000f1');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000f1') = 'mani-c-3@' || pg_temp.dom(),
  '9: F skipped retired mani-c@ and X''s mani-c-2@ and got mani-c-3@');
SELECT pg_temp.require_true(
  pg_temp.identity_local('d2c00000-0000-4000-8000-0000000000f1') = 'mani-c-3',
  '9: F''s From matches its connector');

-- 10. Releases retire: a deleted connector, and a changed identity.
DELETE FROM public.channel_connectors
 WHERE tenant_id = 'd2c00000-0000-4000-8000-0000000000e1' AND config ->> 'managed_default' = 'true';
SELECT pg_temp.require_true(
  EXISTS (SELECT 1 FROM public.paige_retired_managed_addresses
           WHERE address = 'mani-b-moved-2@' || pg_temp.dom() AND tenant_id = 'd2c00000-0000-4000-8000-0000000000e1'
             AND source = 'connector_released'),
  '10: a deleted connector''s address is retired to its business');
SELECT public.set_tenant_email_identity(p_local_part => 'mani-f-renamed', p_tenant_id => 'd2c00000-0000-4000-8000-0000000000f1');
SELECT pg_temp.require_true(
  EXISTS (SELECT 1 FROM public.paige_retired_managed_addresses
           WHERE address = 'mani-c-3@' || pg_temp.dom() AND tenant_id = 'd2c00000-0000-4000-8000-0000000000f1'),
  '10: a changed identity''s old address is retired to its business');

-- 11. The retired list is not readable from a browser session.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.paige_retired_managed_addresses LIMIT 1;
    RAISE EXCEPTION 'FAIL: 11: a browser session read the retired list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT 'MANAGED_ADDRESS_NEVER_REISSUED_PROVEN' AS result;
ROLLBACK;
