-- ============================================================================
-- Inbound routing fields (channel_connectors.inbound_address / inbound_domain) are written by
-- PAIGE's server code only.
--
-- Failing-first contract: before 20271118090000_channel_connector_inbound_routing_server_only the
-- four "refused" assertions FAIL — a workspace admin's browser session can set or change either
-- column on its own connector, and so claim an unheld address or domain and receive its mail.
-- After it they are refused (42501) while: other columns stay editable by the admin, a connector
-- with neither column set can still be created, renaming the business from the app still moves its
-- managed address (a SECURITY DEFINER trigger reached from the admin's own write), and the service
-- role still writes both columns.
--
-- Synthetic fixtures only; the transaction always rolls back.
-- Run: psql "$DB_URL" -1 -f supabase/tests/channel_connector_inbound_routing_server_only.sql
-- Terminal row INBOUND_ROUTING_SERVER_ONLY_PROVEN = pass; any RAISE = fail.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.require_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- One active standalone business with its owner (tenant owner + global admin, the shape the
-- channel_connectors RLS policies admit). Creating the business provisions its managed connector
-- through the tenants trigger.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('c1b00000-0000-4000-8000-0000000000a1', 'irso-biz-a', 'IRSO Biz A', 'active', 'standalone', 'IRA', '{}');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c1b00000-0000-4000-8000-000000000001', 'owner-a@irso.test', now());

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
  ('c1b00000-0000-4000-8000-0000000000a1', 'c1b00000-0000-4000-8000-000000000001', 'owner', 'active', true);

INSERT INTO public.profiles (id, user_id, active_tenant_id) VALUES
  ('c1b00000-0000-4000-8000-000000000001', 'c1b00000-0000-4000-8000-000000000001', 'c1b00000-0000-4000-8000-0000000000a1')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1b00000-0000-4000-8000-000000000001', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Make sure the managed connector exists (idempotent if the tenants trigger already made it).
SELECT public.provision_paige_managed_email_connector('c1b00000-0000-4000-8000-0000000000a1');

SELECT pg_temp.require_true(
  (SELECT count(*) = 1 FROM public.channel_connectors
    WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND config ->> 'managed_default' = 'true'
      AND lower(inbound_address) = 'irso-biz-a@' || coalesce((SELECT nullif(shared_domain, '') FROM public.platform_email_settings LIMIT 1), 'mail.paigeagent.ai')),
  'fixture: the managed connector exists with its slug address');

-- ── As the business owner, from the browser ──────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"c1b00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- 1. Other columns stay editable.
UPDATE public.channel_connectors SET display_name = 'Renamed by owner'
 WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND config ->> 'managed_default' = 'true';
SELECT pg_temp.require_true(
  (SELECT count(*) = 1 FROM public.channel_connectors
    WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND display_name = 'Renamed by owner'),
  '1: owner can still edit a non-routing column');

-- 2-5. Setting or changing either routing column is refused.
DO $$
BEGIN
  BEGIN
    UPDATE public.channel_connectors SET inbound_address = 'unheld-slug@mail.paigeagent.ai'
     WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND config ->> 'managed_default' = 'true';
    RAISE EXCEPTION 'FAIL: 2: owner changed inbound_address from the browser';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.channel_connectors SET inbound_domain = 'unclaimed-customer.example'
     WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND config ->> 'managed_default' = 'true';
    RAISE EXCEPTION 'FAIL: 3: owner set inbound_domain from the browser';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, inbound_address, from_address, status, active)
    VALUES ('c1b00000-0000-4000-8000-0000000000a1', 'email', 'resend', 'another-unheld@mail.paigeagent.ai', 'x@irso.test', 'active', true);
    RAISE EXCEPTION 'FAIL: 4: owner inserted a connector with inbound_address';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, inbound_domain, from_address, status, active)
    VALUES ('c1b00000-0000-4000-8000-0000000000a1', 'email', 'resend', 'unclaimed-customer.example', 'x@irso.test', 'active', true);
    RAISE EXCEPTION 'FAIL: 5: owner inserted a connector with inbound_domain';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- 6. A connector with neither routing column can still be created.
INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active)
VALUES ('c1b00000-0000-4000-8000-0000000000a1', 'sms', 'twilio', NULL, 'active', false);
SELECT pg_temp.require_true(
  (SELECT count(*) = 1 FROM public.channel_connectors
    WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND channel_type = 'sms'),
  '6: owner can still create a connector that sets no routing column');

-- 7. Renaming the business from the app still moves its managed address (the tenants trigger runs
--    provision_paige_managed_email_connector, SECURITY DEFINER, from this browser write).
UPDATE public.tenants SET slug = 'irso-biz-a-renamed' WHERE id = 'c1b00000-0000-4000-8000-0000000000a1';

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT pg_temp.require_true(
  (SELECT count(*) = 1 FROM public.channel_connectors
    WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND config ->> 'managed_default' = 'true'
      AND split_part(lower(inbound_address), '@', 1) = 'irso-biz-a-renamed'),
  '7: renaming the business from the app moved its managed address');
SELECT pg_temp.require_true(
  (SELECT count(*) = 0 FROM public.channel_connectors
    WHERE lower(inbound_address) IN ('unheld-slug@mail.paigeagent.ai', 'another-unheld@mail.paigeagent.ai')
       OR inbound_domain = 'unclaimed-customer.example'),
  '2-5: no refused claim persisted');

-- 8. The service role (edge functions) still writes both columns.
SET LOCAL ROLE service_role;
UPDATE public.channel_connectors SET inbound_domain = 'irso-verified.example'
 WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND channel_type = 'sms';
SELECT pg_temp.require_true(
  (SELECT count(*) = 1 FROM public.channel_connectors
    WHERE tenant_id = 'c1b00000-0000-4000-8000-0000000000a1' AND inbound_domain = 'irso-verified.example'),
  '8: the service role still writes routing columns');
RESET ROLE;

SELECT 'INBOUND_ROUTING_SERVER_ONLY_PROVEN' AS result;
ROLLBACK;
