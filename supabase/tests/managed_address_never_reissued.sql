-- ============================================================================
-- A managed address a business gives up is never issued to another business.
--
-- Failing-first contract: before 20271118100000_managed_address_never_reissued, assertion 3 FAILS —
-- when business B renames, its old <slug>@<shared domain> is released, and business A renaming itself to
-- B's old slug is given that address by PAIGE's own provisioning (so A would receive replies to B's past
-- mail). After it: the released address is recorded as retired to B; A gets the next numbered variant; no
-- connector may take B's retired address directly; Solo Setup reports it unavailable while a free name
-- stays available; B itself may take its old address back; a NEW business whose slug produces a retired
-- address is still created, with a numbered variant; deleting a connector retires its address.
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

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Fixtures: two active standalone businesses, A with its signed-in owner ─────
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

SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000a1');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000b1');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000b1') = 'mani-b@' || pg_temp.dom(),
  'fixture: B holds mani-b@');

-- 1-2. B renames: its old address is released, and recorded as retired to B.
UPDATE public.tenants SET slug = 'mani-b-moved' WHERE id = 'd2c00000-0000-4000-8000-0000000000b1';
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000b1') = 'mani-b-moved@' || pg_temp.dom(),
  '1: B''s managed address followed the rename');
SELECT pg_temp.require_true(
  NOT EXISTS (SELECT 1 FROM public.channel_connectors WHERE lower(inbound_address) = 'mani-b@' || pg_temp.dom()),
  '1: nobody holds mani-b@ after the rename');
SELECT pg_temp.require_true(
  EXISTS (SELECT 1 FROM public.paige_retired_managed_addresses
           WHERE address = 'mani-b@' || pg_temp.dom() AND tenant_id = 'd2c00000-0000-4000-8000-0000000000b1'),
  '2: mani-b@ is recorded as retired to B');

-- 3. A's owner renames A to B's old slug from the app: A is NOT given B's old address.
SELECT set_config('request.jwt.claims', '{"sub":"d2c00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.tenants SET slug = 'mani-b' WHERE id = 'd2c00000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.require_true(
  (SELECT slug FROM public.tenants WHERE id = 'd2c00000-0000-4000-8000-0000000000a1') = 'mani-b',
  '3: the rename itself still succeeded');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000a1') = 'mani-b-2@' || pg_temp.dom(),
  '3: A was given the numbered variant mani-b-2@, not B''s old address');

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

-- 5. Solo Setup tells A's owner that B's old name is unavailable; a free name stays available.
SELECT set_config('request.jwt.claims', '{"sub":"d2c00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true(
  (public.check_solo_setup_managed_email('mani-b') ->> 'available')::boolean = false,
  '5: Solo Setup reports B''s retired address unavailable');
SELECT pg_temp.require_true(
  (public.check_solo_setup_managed_email('mani-free-name') ->> 'available')::boolean = true,
  '5: Solo Setup still reports a free name available');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 6. B itself may take its old address back.
UPDATE public.channel_connectors SET inbound_address = 'mani-b@' || pg_temp.dom(), from_address = 'mani-b@' || pg_temp.dom()
 WHERE tenant_id = 'd2c00000-0000-4000-8000-0000000000b1' AND config ->> 'managed_default' = 'true';
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000b1') = 'mani-b@' || pg_temp.dom(),
  '6: B took its own old address back');

-- 7. A NEW business whose slug produces a retired address (B's mani-b-moved@, released in step 6) is
--    still created, with a numbered variant.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('d2c00000-0000-4000-8000-0000000000e1', 'mani-b-moved', 'MANI E', 'active', 'standalone', 'MNE', '{}');
SELECT public.provision_paige_managed_email_connector('d2c00000-0000-4000-8000-0000000000e1');
SELECT pg_temp.require_true(
  EXISTS (SELECT 1 FROM public.paige_retired_managed_addresses
           WHERE address = 'mani-b-moved@' || pg_temp.dom() AND tenant_id = 'd2c00000-0000-4000-8000-0000000000b1'),
  '7: mani-b-moved@ is retired to B');
SELECT pg_temp.require_true(
  pg_temp.managed_address('d2c00000-0000-4000-8000-0000000000e1') = 'mani-b-moved-2@' || pg_temp.dom(),
  '7: the new business was created and given mani-b-moved-2@');

-- 8. Deleting a connector retires its address.
DELETE FROM public.channel_connectors
 WHERE tenant_id = 'd2c00000-0000-4000-8000-0000000000e1' AND config ->> 'managed_default' = 'true';
SELECT pg_temp.require_true(
  EXISTS (SELECT 1 FROM public.paige_retired_managed_addresses
           WHERE address = 'mani-b-moved-2@' || pg_temp.dom() AND tenant_id = 'd2c00000-0000-4000-8000-0000000000e1'
             AND source = 'connector_released'),
  '8: a deleted connector''s address is retired to its business');

-- 9. The retired list is not readable from a browser session.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.paige_retired_managed_addresses LIMIT 1;
    RAISE EXCEPTION 'FAIL: 9: a browser session read the retired list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT 'MANAGED_ADDRESS_NEVER_REISSUED_PROVEN' AS result;
ROLLBACK;
