-- Systems Check source-integrity security contract.
-- Synthetic fixtures only; every write rolls back.

BEGIN;

SELECT plan(35);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_systems_check_run', 'INSERT,UPDATE,DELETE'),
  'authenticated callers cannot directly mutate Systems Check runs'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_systems_check_finding', 'INSERT,UPDATE,DELETE'),
  'authenticated callers cannot directly mutate Systems Check findings'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_systems_check_baseline', 'INSERT,UPDATE,DELETE'),
  'authenticated callers cannot directly mutate Systems Check baselines'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.paige_systems_check_run', 'SELECT')
  AND has_table_privilege('authenticated', 'public.paige_systems_check_finding', 'SELECT'),
  'existing authenticated Systems Check reads remain available through RLS'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.approve_systems_check_finding(text,bigint,uuid)', 'EXECUTE'),
  'authenticated callers can reach the governed approval body gate'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.approve_systems_check_finding(text,bigint,uuid)', 'EXECUTE'),
  'anonymous callers cannot approve Systems Check findings'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.approve_systems_check_finding(text,bigint,uuid)', 'EXECUTE'),
  'service role cannot impersonate a human approval'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.approve_systems_check_finding(text,bigint,uuid)'::regprocedure),
  'approval seam is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""']
     FROM pg_proc WHERE oid = 'public.approve_systems_check_finding(text,bigint,uuid)'::regprocedure),
  'approval seam uses an empty search path'
);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'integrity-owner@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'integrity-admin@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'integrity-coach@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'integrity-member@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'integrity-linked-client@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'integrity-no-active@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'integrity-inactive@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'integrity-platform-owner@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'integrity-platform-admin@tests.invalid'),
  ('e2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'integrity-other-owner@tests.invalid'),
  ('f3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'integrity-stale-owner@tests.invalid');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'admin'),
  ('d1000000-0000-0000-0000-000000000002', 'admin'),
  ('d1000000-0000-0000-0000-000000000003', 'sales_rep'),
  ('e2000000-0000-0000-0000-000000000001', 'admin'),
  ('f3000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
VALUES ('d1000000-0000-0000-0000-000000000008', 'super_admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
VALUES ('d1000000-0000-0000-0000-000000000009', 'platform_admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('d1000000-0000-0000-0000-000000001111', 'integrity-a', 'Integrity Account A', 'active', 'standalone', 'SIA', 8100001, '{}'::jsonb),
  ('e2000000-0000-0000-0000-000000002222', 'integrity-b', 'Integrity Account B', 'active', 'standalone', 'SIB', 8200002, '{}'::jsonb),
  ('f3000000-0000-0000-0000-000000003333', 'integrity-stale', 'Integrity Account Stale', 'active', 'standalone', 'SIS', 8300003, '{}'::jsonb);

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', NULL),
  ('d1000000-0000-0000-0000-000000000002', NULL),
  ('d1000000-0000-0000-0000-000000000003', NULL),
  ('d1000000-0000-0000-0000-000000000004', NULL),
  ('d1000000-0000-0000-0000-000000000005', NULL),
  ('d1000000-0000-0000-0000-000000000006', NULL),
  ('d1000000-0000-0000-0000-000000000007', NULL),
  ('e2000000-0000-0000-0000-000000000001', NULL),
  ('f3000000-0000-0000-0000-000000000001', NULL)
ON CONFLICT (user_id) DO UPDATE
SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-000000000002', 'admin', 'active', false, now()),
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-000000000003', 'member', 'active', false, now()),
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-000000000004', 'member', 'active', false, now()),
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-000000000006', 'owner', 'active', true, now()),
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-000000000007', 'admin', 'suspended', false, now()),
  ('e2000000-0000-0000-0000-000000002222', 'd1000000-0000-0000-0000-000000000001', 'admin', 'active', false, now()),
  ('e2000000-0000-0000-0000-000000002222', 'e2000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('f3000000-0000-0000-0000-000000003333', 'f3000000-0000-0000-0000-000000000001', 'owner', 'active', true, now());

UPDATE public.profiles
   SET active_tenant_id = CASE
     WHEN user_id = 'e2000000-0000-0000-0000-000000000001' THEN 'e2000000-0000-0000-0000-000000002222'::uuid
     WHEN user_id = 'f3000000-0000-0000-0000-000000000001' THEN 'f3000000-0000-0000-0000-000000003333'::uuid
     ELSE 'd1000000-0000-0000-0000-000000001111'::uuid
   END
 WHERE user_id IN (
   'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000002',
   'd1000000-0000-0000-0000-000000000003',
   'd1000000-0000-0000-0000-000000000004',
   'e2000000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-000000000001'
 );

INSERT INTO public.clients
  (id, tenant_id, linked_user_id, created_by, first_name, last_name)
VALUES
  ('d1000000-0000-0000-0000-00000000c105', 'd1000000-0000-0000-0000-000000001111',
   'd1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001',
   'Linked', 'Client');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
  ('d1000000-0000-0000-0000-000000001111', 'd1000000-0000-0000-0000-00000000c105', 'email', 'integrity-linked-client@tests.invalid', true, 0);

INSERT INTO public.paige_systems_check_run
  (id, tenant_id, scan_flavor, started_at, completed_at, check_count, pass_count, fail_count, triggered_by)
VALUES
  ('d1000000-0000-0000-0000-00000000a001', 'd1000000-0000-0000-0000-000000001111', 'scheduled', now() - interval '2 hours', now() - interval '119 minutes', 1, 0, 1, '{}'::jsonb),
  ('d1000000-0000-0000-0000-00000000a002', 'd1000000-0000-0000-0000-000000001111', 'scheduled', now() - interval '1 hour', now() - interval '59 minutes', 7, 0, 7, '{}'::jsonb),
  ('e2000000-0000-0000-0000-00000000b001', 'e2000000-0000-0000-0000-000000002222', 'scheduled', now() - interval '1 hour', now() - interval '59 minutes', 1, 0, 1, '{}'::jsonb),
  ('f3000000-0000-0000-0000-00000000c001', 'f3000000-0000-0000-0000-000000003333', 'scheduled', now() - interval '26 hours', now() - interval '25 hours', 1, 0, 1, '{}'::jsonb),
  ('d1000000-0000-0000-0000-00000000ff01', NULL, 'scheduled', now() - interval '1 hour', now() - interval '59 minutes', 2, 0, 2, '{}'::jsonb);

INSERT INTO public.paige_actions
  (id, tenant_id, action_kind, from_department, to_department, title, payload, draft_content, status, autonomy_lane)
VALUES
  ('d1000000-0000-0000-0000-00000000ac01', 'd1000000-0000-0000-0000-000000001111', 'systems.remediate', 'operations_pmo', 'technology_automation', 'Integrity action',
   '{"finding_id":"d1000000-0000-0000-0000-00000000f002","run_id":"d1000000-0000-0000-0000-00000000a002"}'::jsonb,
   '{"body":"Prepared remediation"}'::jsonb, 'drafted', 'confirm'),
  ('d1000000-0000-0000-0000-00000000ac02', 'd1000000-0000-0000-0000-000000001111', 'systems.remediate', 'operations_pmo', 'technology_automation', 'Mismatched integrity action',
   '{"finding_id":"e2000000-0000-0000-0000-00000000f001","run_id":"e2000000-0000-0000-0000-00000000b001"}'::jsonb,
   '{"body":"Prepared remediation"}'::jsonb, 'drafted', 'confirm');

INSERT INTO public.paige_systems_check_finding
  (id, run_id, check_id, tenant_id, status, severity_at_finding, evidence,
   paige_interpretation, paige_drafted_fix, resolved_at, resolution, resolution_action_id)
VALUES
  ('d1000000-0000-0000-0000-00000000f001', 'd1000000-0000-0000-0000-00000000a001', 'comms_configured', 'd1000000-0000-0000-0000-000000001111', 'fail', 'high', '{"source":"superseded"}'::jsonb, 'Superseded', '{}'::jsonb, NULL, NULL, NULL),
  ('d1000000-0000-0000-0000-00000000f002', 'd1000000-0000-0000-0000-00000000a002', 'comms_configured', 'd1000000-0000-0000-0000-000000001111', 'fail', 'high', '{"source":"current"}'::jsonb, 'Current', '{}'::jsonb, NULL, NULL, 'd1000000-0000-0000-0000-00000000ac01'),
  ('d1000000-0000-0000-0000-00000000f003', 'd1000000-0000-0000-0000-00000000a002', 'website_connected', 'd1000000-0000-0000-0000-000000001111', 'fail', 'high', '{"source":"resolved"}'::jsonb, 'Resolved', '{}'::jsonb, now() - interval '5 minutes', 'approved', NULL),
  ('d1000000-0000-0000-0000-00000000f004', 'd1000000-0000-0000-0000-00000000a002', 'social_accounts_connected', 'd1000000-0000-0000-0000-000000001111', 'pass', 'medium', '{"source":"pass"}'::jsonb, 'Pass', '{}'::jsonb, NULL, NULL, NULL),
  ('d1000000-0000-0000-0000-00000000f005', 'd1000000-0000-0000-0000-00000000a002', 'automation_wired', 'd1000000-0000-0000-0000-000000001111', 'fail', 'high', '{"source":"no-action"}'::jsonb, 'No action', '{}'::jsonb, NULL, NULL, NULL),
  ('d1000000-0000-0000-0000-00000000f006', 'd1000000-0000-0000-0000-00000000a002', 'company_info_populated', 'd1000000-0000-0000-0000-000000001111', 'fail', 'high', '{"source":"mismatch"}'::jsonb, 'Mismatch', '{}'::jsonb, NULL, NULL, 'd1000000-0000-0000-0000-00000000ac02'),
  ('d1000000-0000-0000-0000-00000000f007', 'd1000000-0000-0000-0000-00000000a002', 'crm_has_customers', 'd1000000-0000-0000-0000-000000001111', 'fail', 'high', '{"source":"owner"}'::jsonb, 'Owner', '{}'::jsonb, NULL, NULL, NULL),
  ('e2000000-0000-0000-0000-00000000f001', 'e2000000-0000-0000-0000-00000000b001', 'comms_configured', 'e2000000-0000-0000-0000-000000002222', 'fail', 'high', '{"source":"other"}'::jsonb, 'Other', '{}'::jsonb, NULL, NULL, NULL),
  ('f3000000-0000-0000-0000-00000000f001', 'f3000000-0000-0000-0000-00000000c001', 'comms_configured', 'f3000000-0000-0000-0000-000000003333', 'fail', 'high', '{"source":"stale"}'::jsonb, 'Stale', '{}'::jsonb, NULL, NULL, NULL),
  ('d1000000-0000-0000-0000-00000000ff02', 'd1000000-0000-0000-0000-00000000ff01', 'operator_db_health', NULL, 'fail', 'high', '{"source":"operator"}'::jsonb, 'Operator', '{}'::jsonb, NULL, NULL, NULL),
  ('d1000000-0000-0000-0000-00000000ff03', 'd1000000-0000-0000-0000-00000000ff01', 'operator_rls_coverage', NULL, 'fail', 'high', '{"source":"operator-admin"}'::jsonb, 'Operator admin', '{}'::jsonb, NULL, NULL, NULL);

CREATE OR REPLACE FUNCTION pg_temp.expect_approval_denied(p_scope text, p_account bigint, p_finding uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.approve_systems_check_finding(p_scope, p_account, p_finding);
  RETURN false;
EXCEPTION WHEN SQLSTATE '42501' THEN
  RETURN SQLERRM = 'SYSTEMS_CHECK_APPROVAL_UNAVAILABLE';
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_direct_finding_update_denied(p_finding uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.paige_systems_check_finding
     SET paige_interpretation = 'forged browser truth'
   WHERE id = p_finding;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END;
$$;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_direct_finding_update_denied('d1000000-0000-0000-0000-00000000f005'), 'real authenticated direct finding update is denied');
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f001'), 'superseded finding is denied');
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f003'), 'resolved finding is denied');
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f004'), 'non-failing finding is denied');
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f006'), 'mismatched action source binding is denied');
SELECT ok(pg_temp.expect_approval_denied('tenant', 8200002, 'd1000000-0000-0000-0000-00000000f005'), 'wrong account address is denied');
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'e2000000-0000-0000-0000-00000000f001'), 'cross-tenant finding is denied');
SELECT ok(pg_temp.expect_approval_denied('unexpected', 8100001, 'd1000000-0000-0000-0000-00000000f005'), 'malformed scope is denied');
SELECT ok(pg_temp.expect_approval_denied('operator', NULL, 'd1000000-0000-0000-0000-00000000f005'), 'tenant finding cannot cross into operator scope');
SELECT is(
  public.approve_systems_check_finding('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f007') ->> 'status',
  'approved',
  'active tenant owner may record the current owner decision'
);

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f005'), 'ordinary member is denied');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f005'), 'linked client is denied');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f005'), 'missing active account is denied');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f005'), 'inactive tenant staff member is denied');

SELECT set_config('request.jwt.claims', '{"sub":"f3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('tenant', 8300003, 'f3000000-0000-0000-0000-00000000f001'), 'stale finding is denied');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  public.approve_systems_check_finding('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f005') ->> 'status',
  'approved',
  'active tenant admin may record the current owner decision'
);

RESET ROLE;
SELECT is((SELECT resolution FROM public.paige_systems_check_finding WHERE id='d1000000-0000-0000-0000-00000000f005'), 'approved', 'approved decision is durable');
SELECT is((SELECT evidence->>'source' FROM public.paige_systems_check_finding WHERE id='d1000000-0000-0000-0000-00000000f005'), 'no-action', 'finding truth remains immutable while decision fields change');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT is(
  public.approve_systems_check_finding('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f002') ->> 'action_status',
  'done',
  'active tenant coach may approve a correctly source-bound remediation action'
);

RESET ROLE;
SELECT is((SELECT status FROM public.paige_actions WHERE id='d1000000-0000-0000-0000-00000000ac01'), 'done', 'existing Action Bus item is advanced durably');
SELECT is((SELECT resolution FROM public.paige_systems_check_finding WHERE id='d1000000-0000-0000-0000-00000000f002'), 'approved', 'action-linked finding records the owner decision');
SELECT ok(EXISTS(SELECT 1 FROM public.audit_logs WHERE entity='systems_check_finding' AND action='approve' AND entity_id='d1000000-0000-0000-0000-00000000f002'), 'approval writes an actor-linked audit record');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('tenant', 8100001, 'd1000000-0000-0000-0000-00000000f002'), 'replay against an already-resolved finding is denied');
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_approval_denied('operator', 8100001, 'd1000000-0000-0000-0000-00000000ff02'), 'operator scope rejects a tenant account address');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
SELECT is(
  public.approve_systems_check_finding('operator', NULL, 'd1000000-0000-0000-0000-00000000ff03')->>'status',
  'approved',
  'delegated platform admin may record the current operator finding decision'
);

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
SELECT is(
  public.approve_systems_check_finding('operator', NULL, 'd1000000-0000-0000-0000-00000000ff02') ->> 'status',
  'approved',
  'platform owner may record the current operator finding decision'
);

SELECT * FROM finish();
ROLLBACK;
