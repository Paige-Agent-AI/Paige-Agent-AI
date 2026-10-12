-- ============================================================================
-- ANT-40 — messages is ENGINE-WRITTEN ONLY (direct PostgREST writes denied).
--
-- Failing-first contract: before the paired migration
-- (20271020000270_messages_engine_only_writes), the write assertions FAIL — the
-- ANT-38-shaped messages_insert/messages_update policies allow a tenant
-- owner/admin (and platform owner) to insert and edit message rows directly.
-- After the migration every authenticated direct write is denied by RLS while
-- the canonical engines (SECURITY DEFINER RPCs, service-role handlers,
-- triggers) and all reads keep working.
--
-- Synthetic fixtures only; the transaction always rolls back.
-- Run: psql "$DB_URL" -1 -f supabase/tests/messages_engine_only_writes.sql
-- Terminal row MESSAGES_ENGINE_ONLY_WRITES_PROVEN = pass; any RAISE = fail.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.require_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- One standalone Solo tenant; its owner (global 'user' role — the ANT-38 case),
-- one plain member, and one platform operator (global super_admin, no tenant
-- membership). A shared-support connector and a personal connector owned by
-- the tenant owner; one inbound message on each.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('b4a00000-0000-4000-8000-0000000000a1', 'ant40-tenant-a', 'Ant40 A', 'active', 'standalone', 'A40', '{}');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b4a00000-0000-4000-8000-000000000001', 'owner-a@ant40.test', now()),
  ('b4a00000-0000-4000-8000-000000000003', 'member-a@ant40.test', now());

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
  ('b4a00000-0000-4000-8000-0000000000a1', 'b4a00000-0000-4000-8000-000000000001', 'owner',  'active', true),
  ('b4a00000-0000-4000-8000-0000000000a1', 'b4a00000-0000-4000-8000-000000000003', 'member', 'active', false);

INSERT INTO public.profiles (id, user_id, active_tenant_id) VALUES
  ('b4a00000-0000-4000-8000-000000000001', 'b4a00000-0000-4000-8000-000000000001', 'b4a00000-0000-4000-8000-0000000000a1'),
  ('b4a00000-0000-4000-8000-000000000003', 'b4a00000-0000-4000-8000-000000000003', 'b4a00000-0000-4000-8000-0000000000a1')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- Global roles: the membership-sync trigger (map_tenant_role_to_app_role)
-- already grants the member's derived global role, so only the owner's plain
-- 'user' row is inserted (ON CONFLICT DO NOTHING keeps the fixture
-- deterministic against mapping changes). No super_admin fixture is possible:
-- the one_super_admin unique constraint admits exactly one platform owner
-- GLOBALLY, and both production and the CI-rebuilt database already have it.
-- That is also why no separate platform-owner denial assertion exists below —
-- once BOTH policies are gone, RLS denies direct writes by default for EVERY
-- authenticated role; the owner and member denials prove no permissive WITH
-- CHECK policy remains for anyone.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b4a00000-0000-4000-8000-000000000001', 'user')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, inbound_address, from_address, status, active, mailbox_class, mailbox_owner_user_id) VALUES
  ('b4a00000-0000-4000-8000-0000000000a2', 'b4a00000-0000-4000-8000-0000000000a1', 'email', 'resend', 'support@ant40-a.test', 'support@ant40-a.test', 'active', true, 'shared_support', NULL),
  ('b4a00000-0000-4000-8000-0000000000a3', 'b4a00000-0000-4000-8000-0000000000a1', 'email', 'gmail',  'owner@ant40-a.test',   'owner@ant40-a.test',   'active', true, 'personal',       'b4a00000-0000-4000-8000-000000000001');

INSERT INTO public.messages (id, tenant_id, connector_id, channel_type, direction, status, thread_key, sender, recipients, subject, body_text, provider_message_id, sent_at) VALUES
  ('b4a00000-0000-4000-8000-0000000000a4', 'b4a00000-0000-4000-8000-0000000000a1', 'b4a00000-0000-4000-8000-0000000000a2', 'email', 'inbound', 'received', 'email:ant40-shared:cust@x.test', '{"address":"cust@x.test"}', '[{"address":"support@ant40-a.test"}]', 'Shared question', 'hello', 'ant40-shared-1', now()),
  ('b4a00000-0000-4000-8000-0000000000a5', 'b4a00000-0000-4000-8000-0000000000a1', 'b4a00000-0000-4000-8000-0000000000a3', 'email', 'inbound', 'received', 'email:ant40-personal:friend@x.test', '{"address":"friend@x.test"}', '[{"address":"owner@ant40-a.test"}]', 'Personal note', 'psst', 'ant40-personal-1', now());

-- ── 1-3. The tenant owner cannot write messages directly ─────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"b4a00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.messages (tenant_id, connector_id, channel_type, direction, status, thread_key, sender, recipients, subject, body_text, sent_at)
    VALUES ('b4a00000-0000-4000-8000-0000000000a1', 'b4a00000-0000-4000-8000-0000000000a2', 'email', 'inbound', 'received', 'email:ant40-direct', '{"address":"x@x.test"}', '[{"address":"support@ant40-a.test"}]', 'direct', 'nope', now());
    RAISE EXCEPTION 'FAIL: tenant-owner direct INSERT was ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
END $$;

-- With no UPDATE policy, Postgres denies the write as either an RLS violation
-- or zero affected rows — both are denials; only a mutated row is a failure.
DO $$
DECLARE affected int;
BEGIN
  BEGIN
    UPDATE public.messages SET status = 'read' WHERE id = 'b4a00000-0000-4000-8000-0000000000a4';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN RAISE EXCEPTION 'FAIL: tenant-owner direct UPDATE was ALLOWED'; END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.require_true(
  (SELECT status FROM public.messages WHERE id = 'b4a00000-0000-4000-8000-0000000000a4') = 'received',
  'shared row untouched and still SELECT-visible after denied update');

DO $$
DECLARE affected int;
BEGIN
  BEGIN
    UPDATE public.messages SET subject = 'tampered' WHERE id = 'b4a00000-0000-4000-8000-0000000000a5';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN RAISE EXCEPTION 'FAIL: mailbox-owner direct UPDATE of OWN personal row was ALLOWED'; END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.require_true(
  (SELECT subject FROM public.messages WHERE id = 'b4a00000-0000-4000-8000-0000000000a5') = 'Personal note',
  'personal row untouched and still SELECT-visible after denied update');

-- Reads are unchanged by the write-narrowing: the owner still sees both rows.
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b4a00000-0000-4000-8000-0000000000a1') = 2, 'owner reads unchanged (shared + own personal)');

-- ── 4. The plain member cannot write either (owner+member denials prove no
--     permissive WITH CHECK policy remains for ANY authenticated role) ────────
SELECT set_config('request.jwt.claims', '{"sub":"b4a00000-0000-4000-8000-000000000003","role":"authenticated"}', true);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.messages (tenant_id, connector_id, channel_type, direction, status, thread_key, sender, recipients, subject, body_text, sent_at)
    VALUES ('b4a00000-0000-4000-8000-0000000000a1', 'b4a00000-0000-4000-8000-0000000000a2', 'email', 'inbound', 'received', 'email:ant40-member-direct', '{"address":"x@x.test"}', '[{"address":"support@ant40-a.test"}]', 'direct', 'nope', now());
    RAISE EXCEPTION 'FAIL: plain-member direct INSERT was ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
END $$;

-- ── 6. The canonical engine path keeps working ──────────────────────────────
-- 6a. The engine RPC is service-role-only: an authenticated member is refused
--     EXECUTE (fail-closed) — the same contract the handlers rely on.
SELECT set_config('request.jwt.claims', '{"sub":"b4a00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.record_inbound_message_intelligence('b4a00000-0000-4000-8000-0000000000a4');
    RAISE EXCEPTION 'FAIL: authenticated member could EXECUTE the engine RPC';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%permission denied%' THEN RAISE; END IF;
  END;
END $$;

-- 6b. As the service role (how handle-inbound-email / the backfill sweep call
--     it), the SECURITY DEFINER engine writes the support case with no
--     dependence on caller RLS — the dropped policies change nothing for it.
--     Re-running it is safe (idempotent upsert): that is what the sweep does.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.require_true(
  (public.record_inbound_message_intelligence('b4a00000-0000-4000-8000-0000000000a4'))->>'ok' = 'true',
  'engine runs as service role');
SELECT pg_temp.require_true(
  (public.record_inbound_message_intelligence('b4a00000-0000-4000-8000-0000000000a4'))->>'ok' = 'true',
  'engine re-run (backfill sweep semantics) is idempotent');

-- 6c. The case the engine wrote is visible to the tenant owner (reads unchanged).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b4a00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.require_true(
  (SELECT count(*) FROM public.support_cases
    WHERE tenant_id = 'b4a00000-0000-4000-8000-0000000000a1'
      AND connector_id = 'b4a00000-0000-4000-8000-0000000000a2'
      AND thread_key = 'email:ant40-shared:cust@x.test') = 1,
  'owner sees the engine-written support case');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT 'MESSAGES_ENGINE_ONLY_WRITES_PROVEN' AS result;
ROLLBACK;
