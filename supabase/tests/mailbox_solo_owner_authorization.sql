-- ============================================================================
-- ANT-38 — mailbox authority is TENANT-scoped, not global-admin-scoped.
--
-- Failing-first contract: before the paired migration
-- (20270602000501_mailbox_tenant_scoped_authority), every LEGITIMATE-AUTHORITY
-- assertion below fails — an ordinary Solo owner (tenant_members.role='owner',
-- global role 'user') is refused by the global-admin gate on messages RLS,
-- read_message_content, read_support_cases and the labels/classifications/
-- cases/sync-state policies. After the migration, all pass and every negative
-- (plain member, foreign tenant, wrong workspace, same-tenant staff on a
-- private mailbox, agency parent on a child, revoked connector) still refuses.
--
-- Synthetic fixtures only; the transaction always rolls back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -1
--        -f supabase/tests/mailbox_solo_owner_authorization.sql
\set ON_ERROR_STOP on
-- Terminal row MAILBOX_SOLO_OWNER_AUTHZ_PROVEN = pass; any RAISE = fail.
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.require_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Two standalone Solo tenants (A = established, B = parity twin), one agency
-- parent P with one sub_account child C. Fixed synthetic uuids throughout.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('b3800000-0000-4000-8000-0000000000a1', 'ant38-tenant-a', 'Ant38 A', 'active', 'standalone', 'A38', '{}'),
  ('b3800000-0000-4000-8000-0000000000b1', 'ant38-tenant-b', 'Ant38 B', 'active', 'standalone', 'B38', '{}'),
  ('b3800000-0000-4000-8000-0000000000e1', 'ant38-agency-p', 'Ant38 P', 'active', 'agency',      'P38', '{}'),
  ('b3800000-0000-4000-8000-0000000000c1', 'ant38-child-c',  'Ant38 C', 'active', 'sub_account', 'C38', '{}');
UPDATE public.tenants SET parent_tenant_id = 'b3800000-0000-4000-8000-0000000000e1' WHERE id = 'b3800000-0000-4000-8000-0000000000c1';

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b3800000-0000-4000-8000-000000000001', 'owner-a@ant38.test', now()),
  ('b3800000-0000-4000-8000-000000000002', 'staff-a@ant38.test', now()),
  ('b3800000-0000-4000-8000-000000000003', 'member-a@ant38.test', now()),
  ('b3800000-0000-4000-8000-000000000004', 'owner-b@ant38.test', now()),
  ('b3800000-0000-4000-8000-000000000005', 'owner-p@ant38.test', now()),
  ('b3800000-0000-4000-8000-000000000006', 'owner-c@ant38.test', now());

-- People. owner_a is THE case: tenant owner, global role 'user' — no global admin.
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-000000000001', 'owner',  'active', true),
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-000000000002', 'admin',  'active', false),
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-000000000003', 'member', 'active', false),
  ('b3800000-0000-4000-8000-0000000000b1', 'b3800000-0000-4000-8000-000000000004', 'owner',  'active', true),
  ('b3800000-0000-4000-8000-0000000000b1', 'b3800000-0000-4000-8000-000000000001', 'admin',  'active', false),
  ('b3800000-0000-4000-8000-0000000000e1', 'b3800000-0000-4000-8000-000000000005', 'owner',  'active', true),
  ('b3800000-0000-4000-8000-0000000000c1', 'b3800000-0000-4000-8000-000000000006', 'owner',  'active', true),
  ('b3800000-0000-4000-8000-0000000000c1', 'b3800000-0000-4000-8000-000000000005', 'member', 'active', false);

INSERT INTO public.profiles (id, user_id, active_tenant_id) VALUES
  ('b3800000-0000-4000-8000-000000000001', 'b3800000-0000-4000-8000-000000000001', 'b3800000-0000-4000-8000-0000000000a1'),
  ('b3800000-0000-4000-8000-000000000002', 'b3800000-0000-4000-8000-000000000002', 'b3800000-0000-4000-8000-0000000000a1'),
  ('b3800000-0000-4000-8000-000000000003', 'b3800000-0000-4000-8000-000000000003', 'b3800000-0000-4000-8000-0000000000a1'),
  ('b3800000-0000-4000-8000-000000000004', 'b3800000-0000-4000-8000-000000000004', 'b3800000-0000-4000-8000-0000000000b1'),
  ('b3800000-0000-4000-8000-000000000005', 'b3800000-0000-4000-8000-000000000005', 'b3800000-0000-4000-8000-0000000000e1'),
  ('b3800000-0000-4000-8000-000000000006', 'b3800000-0000-4000-8000-000000000006', 'b3800000-0000-4000-8000-0000000000c1')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- Global roles: every fixture user is a plain global 'user' (or lower) — proving
-- nothing below depends on a global admin/platform role.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b3800000-0000-4000-8000-000000000001', 'user'),
  ('b3800000-0000-4000-8000-000000000002', 'user'),
  ('b3800000-0000-4000-8000-000000000004', 'user');

-- Connectors: a shared support mailbox on A, a personal mailbox on A owned by
-- owner_a, a shared mailbox on B, and a shared mailbox on child C.
INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, inbound_address, from_address, status, active, mailbox_class, mailbox_owner_user_id) VALUES
  ('b3800000-0000-4000-8000-0000000000a2', 'b3800000-0000-4000-8000-0000000000a1', 'email', 'resend', 'support@ant38-a.test', 'support@ant38-a.test', 'active', true, 'shared_support', NULL),
  ('b3800000-0000-4000-8000-0000000000a3', 'b3800000-0000-4000-8000-0000000000a1', 'email', 'gmail',  'owner@ant38-a.test',   'owner@ant38-a.test',   'active', true, 'personal',       'b3800000-0000-4000-8000-000000000001'),
  ('b3800000-0000-4000-8000-0000000000b2', 'b3800000-0000-4000-8000-0000000000b1', 'email', 'resend', 'support@ant38-b.test', 'support@ant38-b.test', 'active', true, 'shared_support', NULL),
  ('b3800000-0000-4000-8000-0000000000c2', 'b3800000-0000-4000-8000-0000000000c1', 'email', 'resend', 'support@ant38-c.test', 'support@ant38-c.test', 'active', true, 'shared_support', NULL);

-- Messages on each surface.
INSERT INTO public.messages (id, tenant_id, connector_id, channel_type, direction, status, thread_key, sender, recipients, subject, body_text, provider_message_id, sent_at) VALUES
  ('b3800000-0000-4000-8000-0000000000a4', 'b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a2', 'email', 'inbound', 'received', 'email:t-a-shared:cust@x.test', '{"address":"cust@x.test"}', '[{"address":"support@ant38-a.test"}]', 'Shared A question', 'hello', 'ant38-a-shared-1', now()),
  ('b3800000-0000-4000-8000-0000000000a5', 'b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a3', 'email', 'inbound', 'received', 'email:t-a-personal:friend@x.test', '{"address":"friend@x.test"}', '[{"address":"owner@ant38-a.test"}]', 'Personal A note', 'psst', 'ant38-a-personal-1', now()),
  ('b3800000-0000-4000-8000-0000000000b4', 'b3800000-0000-4000-8000-0000000000b1', 'b3800000-0000-4000-8000-0000000000b2', 'email', 'inbound', 'received', 'email:t-b-shared:cust@x.test', '{"address":"cust@x.test"}', '[{"address":"support@ant38-b.test"}]', 'Shared B question', 'hello', 'ant38-b-shared-1', now()),
  ('b3800000-0000-4000-8000-0000000000c4', 'b3800000-0000-4000-8000-0000000000c1', 'b3800000-0000-4000-8000-0000000000c2', 'email', 'inbound', 'received', 'email:t-c-shared:cust@x.test', '{"address":"cust@x.test"}', '[{"address":"support@ant38-c.test"}]', 'Shared C question', 'hello', 'ant38-c-shared-1', now());

-- Labels, classification, case, sync state on tenant A's shared + personal rows.
INSERT INTO public.message_labels (tenant_id, message_id, label, source, mailbox_class, mailbox_owner_user_id) VALUES
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a4', 'needs-reply', 'auto', 'shared_support', NULL),
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a5', 'personal',   'auto', 'personal',       'b3800000-0000-4000-8000-000000000001');
INSERT INTO public.message_classifications (tenant_id, message_id, mailbox_class, mailbox_owner_user_id, intent, confidence, risk_tier) VALUES
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a4', 'shared_support', NULL, 'question', 0.9, 'routine'),
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a5', 'personal', 'b3800000-0000-4000-8000-000000000001', 'personal', 0.9, 'routine');
INSERT INTO public.support_cases (tenant_id, connector_id, thread_key, status, last_inbound_at) VALUES
  ('b3800000-0000-4000-8000-0000000000a1', 'b3800000-0000-4000-8000-0000000000a2', 'email:t-a-shared:cust@x.test', 'awaiting_owner', now());
INSERT INTO public.mailbox_sync_state (connector_id, tenant_id, mailbox_class, last_sync_status) VALUES
  ('b3800000-0000-4000-8000-0000000000a3', 'b3800000-0000-4000-8000-0000000000a1', 'personal', 'ok');

-- ── Scenario 1: the ordinary Solo owner (global 'user') reads their business inbox ──
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true(public.current_user_tenant_id() = 'b3800000-0000-4000-8000-0000000000a1', 'owner workspace resolves');
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 2, 'owner sees BOTH shared and own-personal messages');
SELECT pg_temp.require_true((SELECT count(*) FROM public.message_labels WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 2, 'owner sees labels');
SELECT pg_temp.require_true((SELECT count(*) FROM public.message_classifications WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 2, 'owner sees classifications');
SELECT pg_temp.require_true((SELECT count(*) FROM public.support_cases WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 1, 'owner sees support cases');
SELECT pg_temp.require_true((SELECT count(*) FROM public.mailbox_sync_state WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 1, 'owner sees own mailbox sync state');
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a4'))->>'ok' = 'true', 'owner reads shared message content');
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a5'))->>'ok' = 'true', 'owner reads OWN personal message content');
SELECT pg_temp.require_true(jsonb_typeof(public.read_support_cases(NULL, false)) = 'array', 'owner lists support cases');
SELECT pg_temp.require_true((SELECT count(*) FROM jsonb_array_elements(public.read_support_cases(NULL, false))) = 1, 'support case list non-empty for owner');
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000b1') = 0, 'owner sees nothing of tenant B');

-- ── Scenario 2: authorized tenant ADMIN staff work the shared inbox, not the private one ──
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 1, 'staff admin sees ONLY the shared message');
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a4'))->>'ok' = 'true', 'staff admin reads shared content');
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a5'))->>'code' = 'PERSONAL_MAILBOX_NOT_OWNER', 'staff admin refused on personal mailbox');
SELECT pg_temp.require_true((SELECT count(*) FROM public.message_labels WHERE mailbox_class = 'personal') = 0, 'staff admin sees no personal labels');

-- ── Scenario 3: plain member staff — least privilege, no business inbox ──
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 0, 'plain member sees no business inbox');
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a4'))->>'code' = 'WORKSPACE_ROLE_REQUIRED', 'plain member refused content read');

-- ── Scenario 4: foreign tenant owner — full refusal ──
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 0, 'foreign owner sees nothing of A');
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000b1') = 1, 'foreign owner sees own tenant B (parity twin, same path)');

-- ── Scenario 5: wrong workspace — owner standing elsewhere loses tenant A rows ──
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles SET active_tenant_id = 'b3800000-0000-4000-8000-0000000000b1' WHERE user_id = 'b3800000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000a1') = 0, 'wrong workspace: tenant A rows gone');
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000b1') = 1, 'wrong workspace: B visible via membership fallback');
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a4')) IS NULL, 'wrong workspace: content read of A message returns null');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles SET active_tenant_id = 'b3800000-0000-4000-8000-0000000000a1' WHERE user_id = 'b3800000-0000-4000-8000-000000000001';

-- ── Scenario 6: agency parent standing on the child — boundary holds ──
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles SET active_tenant_id = 'b3800000-0000-4000-8000-0000000000c1' WHERE user_id = 'b3800000-0000-4000-8000-000000000005';
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true(public.current_user_tenant_id() = 'b3800000-0000-4000-8000-0000000000c1', 'agency parent standing on child resolves child workspace');
SELECT pg_temp.require_true((SELECT count(*) FROM public.messages WHERE tenant_id = 'b3800000-0000-4000-8000-0000000000c1') = 0, 'agency parent with child MEMBER standing: child business mail still refused (owner/admin of THAT tenant required)');

-- ── Scenario 7: revoked/disconnected personal mailbox refuses its owner ──
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.channel_connectors SET status = 'disabled', active = false WHERE id = 'b3800000-0000-4000-8000-0000000000a3';
SELECT set_config('request.jwt.claims', '{"sub":"b3800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true((public.read_message_content('b3800000-0000-4000-8000-0000000000a5'))->>'code' = 'MAILBOX_INACTIVE', 'revoked consent: owner refused (fail-closed)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT 'MAILBOX_SOLO_OWNER_AUTHZ_PROVEN' AS result;
ROLLBACK;
