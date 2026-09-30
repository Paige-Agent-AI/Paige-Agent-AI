-- Contract A: presentation-safe, tenant/account-scoped Systems Check references.
-- Synthetic fixtures only; every write rolls back.
-- Run against an isolated preview database:
--   supabase test db --db-url "$CONTRACT_A_PREVIEW_DB_URL" supabase/tests/systems_check_signal_reference.sql

BEGIN;

SELECT plan(44);

SELECT ok(
  NOT has_function_privilege('anon', 'public.issue_systems_check_signal_reference(bigint,uuid)', 'EXECUTE'),
  'anonymous callers cannot issue Systems Check signal references'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.resolve_systems_check_signal_reference(bigint,text)', 'EXECUTE'),
  'anonymous callers cannot resolve Systems Check signal references'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.issue_systems_check_signal_reference(bigint,uuid)', 'EXECUTE'),
  'authenticated callers can reach the issuer body gate'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.resolve_systems_check_signal_reference(bigint,text)', 'EXECUTE'),
  'authenticated callers can reach the resolver body gate'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.issue_systems_check_signal_reference(bigint,uuid)', 'EXECUTE'),
  'service role cannot bypass the authenticated actor issuer gate'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.resolve_systems_check_signal_reference(bigint,text)', 'EXECUTE'),
  'service role cannot bypass the authenticated actor resolver gate'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_systems_check_signal_reference', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated callers have no direct reference-table access'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.paige_systems_check_signal_reference', 'SELECT,INSERT,UPDATE,DELETE'),
  'service role has no direct reference-table access'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.issue_systems_check_signal_reference(bigint,uuid)'::regprocedure)
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.resolve_systems_check_signal_reference(bigint,text)'::regprocedure),
  'issuer and resolver are SECURITY DEFINER functions'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=pg_catalog, public, extensions']
     FROM pg_proc WHERE oid = 'public.issue_systems_check_signal_reference(bigint,uuid)'::regprocedure)
  AND
  (SELECT proconfig @> ARRAY['search_path=pg_catalog, public, extensions']
     FROM pg_proc WHERE oid = 'public.resolve_systems_check_signal_reference(bigint,text)'::regprocedure),
  'issuer and resolver pin the exact hardened search path'
);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'signal-owner@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'signal-admin@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'signal-coach@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'signal-member@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'signal-linked-client@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'signal-no-active@tests.invalid'),
  ('a1000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'signal-inactive@tests.invalid'),
  ('b2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'signal-other-owner@tests.invalid'),
  ('c3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'signal-stale-owner@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('a1000000-0000-0000-0000-000000001111', 'signal-contract-a', 'Signal Contract A', 'active', 'standalone', 'SCA', 7100001, '{}'::jsonb),
  ('b2000000-0000-0000-0000-000000002222', 'signal-contract-b', 'Signal Contract B', 'active', 'standalone', 'SCB', 7200002, '{}'::jsonb),
  ('c3000000-0000-0000-0000-000000003333', 'signal-contract-stale', 'Signal Contract Stale', 'active', 'standalone', 'SCS', 7300003, '{}'::jsonb);

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', NULL),
  ('a1000000-0000-0000-0000-000000000002', NULL),
  ('a1000000-0000-0000-0000-000000000003', NULL),
  ('a1000000-0000-0000-0000-000000000004', NULL),
  ('a1000000-0000-0000-0000-000000000005', NULL),
  ('a1000000-0000-0000-0000-000000000006', NULL),
  ('a1000000-0000-0000-0000-000000000007', NULL),
  ('b2000000-0000-0000-0000-000000000001', NULL),
  ('c3000000-0000-0000-0000-000000000001', NULL)
ON CONFLICT (user_id) DO UPDATE
SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-000000000002', 'admin', 'active', false, now()),
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-000000000003', 'member', 'active', false, now()),
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-000000000004', 'member', 'active', false, now()),
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-000000000006', 'owner', 'active', true, now()),
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-000000000007', 'admin', 'suspended', false, now()),
  ('b2000000-0000-0000-0000-000000002222', 'a1000000-0000-0000-0000-000000000001', 'admin', 'active', false, now()),
  ('b2000000-0000-0000-0000-000000002222', 'b2000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('c3000000-0000-0000-0000-000000003333', 'c3000000-0000-0000-0000-000000000001', 'owner', 'active', true, now());

UPDATE public.profiles
   SET active_tenant_id = CASE
     WHEN user_id = 'b2000000-0000-0000-0000-000000000001' THEN 'b2000000-0000-0000-0000-000000002222'::uuid
     WHEN user_id = 'c3000000-0000-0000-0000-000000000001' THEN 'c3000000-0000-0000-0000-000000003333'::uuid
     ELSE 'a1000000-0000-0000-0000-000000001111'::uuid
   END
 WHERE user_id IN (
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000004',
   'b2000000-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000001'
 );

INSERT INTO public.clients
  (id, tenant_id, linked_user_id, created_by, first_name, last_name)
VALUES
  ('a1000000-0000-0000-0000-00000000c105', 'a1000000-0000-0000-0000-000000001111',
   'a1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001',
   'Linked', 'Client');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
  ('a1000000-0000-0000-0000-000000001111', 'a1000000-0000-0000-0000-00000000c105', 'email', 'signal-linked-client@tests.invalid', true, 0);

UPDATE public.paige_systems_check_registry
   SET check_name = 'SECRET_CHECK_NAME_DO_NOT_RETURN',
       remediation_prompt = 'SECRET_REMEDIATION_DO_NOT_RETURN'
 WHERE check_id = 'comms_configured';

INSERT INTO public.paige_systems_check_run
  (id, tenant_id, scan_flavor, started_at, completed_at, check_count, pass_count, fail_count, triggered_by)
VALUES
  ('a1000000-0000-0000-0000-00000000a001', 'a1000000-0000-0000-0000-000000001111',
   'scheduled', now() - interval '2 hours', now() - interval '119 minutes', 1, 0, 1,
   '{"prompt_preview":"SECRET_SUPERSEDED_TRIGGER"}'::jsonb),
  ('a1000000-0000-0000-0000-00000000a002', 'a1000000-0000-0000-0000-000000001111',
   'scheduled', now() - interval '1 hour', now() - interval '59 minutes', 4, 0, 2,
   '{"prompt_preview":"SECRET_CURRENT_TRIGGER"}'::jsonb),
  ('b2000000-0000-0000-0000-00000000b001', 'b2000000-0000-0000-0000-000000002222',
   'scheduled', now() - interval '1 hour', now() - interval '59 minutes', 1, 0, 1,
   '{"prompt_preview":"SECRET_OTHER_TRIGGER"}'::jsonb),
  ('c3000000-0000-0000-0000-00000000c001', 'c3000000-0000-0000-0000-000000003333',
   'scheduled', now() - interval '26 hours', now() - interval '25 hours', 1, 0, 1,
   '{"prompt_preview":"SECRET_STALE_TRIGGER"}'::jsonb);

INSERT INTO public.paige_systems_check_finding
  (id, run_id, check_id, tenant_id, status, severity_at_finding, evidence,
   paige_interpretation, paige_drafted_fix, resolved_at, resolution, resolution_action_id)
VALUES
  ('a1000000-0000-0000-0000-00000000f001', 'a1000000-0000-0000-0000-00000000a001',
   'comms_configured', 'a1000000-0000-0000-0000-000000001111', 'fail', 'high',
   '{"api_key":"SECRET_SUPERSEDED_EVIDENCE"}'::jsonb, 'SECRET_SUPERSEDED_INTERPRETATION',
   '{"prompt":"SECRET_SUPERSEDED_DRAFT"}'::jsonb, NULL, NULL, NULL),
  ('a1000000-0000-0000-0000-00000000f002', 'a1000000-0000-0000-0000-00000000a002',
   'comms_configured', 'a1000000-0000-0000-0000-000000001111', 'fail', 'high',
   '{"api_key":"SECRET_CURRENT_EVIDENCE","internal_error":"SECRET_INTERNAL_ERROR"}'::jsonb,
   'SECRET_CURRENT_INTERPRETATION', '{"prompt":"SECRET_CURRENT_DRAFT","model":"SECRET_MODEL"}'::jsonb,
   NULL, NULL, 'a1000000-0000-0000-0000-00000000ac02'),
  ('a1000000-0000-0000-0000-00000000f003', 'a1000000-0000-0000-0000-00000000a002',
   'comms_configured', 'a1000000-0000-0000-0000-000000001111', 'fail', 'high',
   '{"api_key":"SECRET_RESOLVED_EVIDENCE"}'::jsonb, 'SECRET_RESOLVED_INTERPRETATION',
   '{"prompt":"SECRET_RESOLVED_DRAFT"}'::jsonb, now() - interval '10 minutes', 'approved',
   'a1000000-0000-0000-0000-00000000ac03'),
  ('a1000000-0000-0000-0000-00000000f004', 'a1000000-0000-0000-0000-00000000a002',
   'comms_configured', 'a1000000-0000-0000-0000-000000001111', 'skip', 'high',
   '{"reason":"SECRET_UNAVAILABLE_SOURCE"}'::jsonb, 'SECRET_UNAVAILABLE_INTERPRETATION',
   '{"prompt":"SECRET_UNAVAILABLE_DRAFT"}'::jsonb, NULL, NULL, NULL),
  ('a1000000-0000-0000-0000-00000000f005', 'a1000000-0000-0000-0000-00000000a002',
   'comms_configured', 'a1000000-0000-0000-0000-000000001111', 'error', 'high',
   '{"internal_error":"SECRET_ERROR_SOURCE"}'::jsonb, 'SECRET_ERROR_INTERPRETATION',
   '{"prompt":"SECRET_ERROR_DRAFT"}'::jsonb, NULL, NULL, NULL),
  ('b2000000-0000-0000-0000-00000000f001', 'b2000000-0000-0000-0000-00000000b001',
   'comms_configured', 'b2000000-0000-0000-0000-000000002222', 'fail', 'high',
   '{"api_key":"SECRET_OTHER_EVIDENCE"}'::jsonb, 'SECRET_OTHER_INTERPRETATION',
   '{"prompt":"SECRET_OTHER_DRAFT"}'::jsonb, NULL, NULL, NULL),
  ('c3000000-0000-0000-0000-00000000f001', 'c3000000-0000-0000-0000-00000000c001',
   'comms_configured', 'c3000000-0000-0000-0000-000000003333', 'fail', 'high',
   '{"api_key":"SECRET_STALE_EVIDENCE"}'::jsonb, 'SECRET_STALE_INTERPRETATION',
   '{"prompt":"SECRET_STALE_DRAFT"}'::jsonb, NULL, NULL, NULL);

CREATE OR REPLACE FUNCTION pg_temp.expect_signal_unavailable(p_account_number bigint, p_signal_ref text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.resolve_systems_check_signal_reference(p_account_number, p_signal_ref);
  RETURN false;
EXCEPTION WHEN SQLSTATE '42501' THEN
  RETURN SQLERRM = 'SYSTEMS_CHECK_SIGNAL_UNAVAILABLE';
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_issue_unavailable(p_account_number bigint, p_finding_id uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.issue_systems_check_signal_reference(p_account_number, p_finding_id);
  RETURN false;
EXCEPTION WHEN SQLSTATE '42501' THEN
  RETURN SQLERRM = 'SYSTEMS_CHECK_SIGNAL_UNAVAILABLE';
END;
$$;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
CREATE TEMP TABLE contract_a_result AS
SELECT
  public.issue_systems_check_signal_reference(7100001, 'a1000000-0000-0000-0000-00000000f002') AS signal_ref;
ALTER TABLE contract_a_result ADD COLUMN payload jsonb;
UPDATE contract_a_result
SET payload = public.resolve_systems_check_signal_reference(7100001, signal_ref);

SELECT alike(signal_ref, 'scsig_v1_%', 'owner receives a versioned opaque signal reference') FROM contract_a_result;
SELECT is((payload ->> 'status'), 'fail', 'current own-tenant signal exposes safe status') FROM contract_a_result;
SELECT is((payload ->> 'category'), 'comms_deliverability', 'current own-tenant signal exposes safe category') FROM contract_a_result;
SELECT is((payload ->> 'source'), 'tenant_records', 'raw data-source name is mapped to a presentation-safe source') FROM contract_a_result;
SELECT is((payload ->> 'signal_kind'), 'communications_readiness', 'selected check maps to a reviewed presentation-safe signal kind') FROM contract_a_result;
SELECT is((payload ->> 'signal_label'), 'Communications readiness', 'selected check maps to a reviewed presentation-safe label') FROM contract_a_result;
SELECT is((payload ->> 'freshness'), 'current', 'current completed run is marked current') FROM contract_a_result;
SELECT is((payload ->> 'coverage'), 'partial', 'skip/error presence makes run coverage partial') FROM contract_a_result;
SELECT is((payload ->> 'next_state'), 'owner_review', 'failed signal stops at owner review') FROM contract_a_result;
SELECT is(
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys((SELECT payload FROM contract_a_result)) key),
  ARRAY['category','coverage','freshness','next_state','signal_kind','signal_label','signal_ref','source','status']::text[],
  'resolver returns exactly the curated structural allowlist'
);
SELECT ok(
  (SELECT payload::text FROM contract_a_result) !~* '(SECRET_|evidence|interpretation|draft|prompt|internal|model|triggered_by|tenant_id|run_id|check_id|resolution|title|summary|payload)',
  'raw evidence, prompts, internal metadata, identifiers, and secret-like values do not cross the boundary'
);
SELECT unalike(
  (SELECT signal_ref FROM contract_a_result),
  '%a1000000-0000-0000-0000-00000000f002%',
  'opaque reference does not embed the raw finding identifier'
);
CREATE TEMP TABLE contract_a_replacement AS
SELECT public.issue_systems_check_signal_reference(7100001, 'a1000000-0000-0000-0000-00000000f002') AS signal_ref;
SELECT isnt(
  (SELECT signal_ref FROM contract_a_result),
  (SELECT signal_ref FROM contract_a_replacement),
  'repeated issuance mints fresh random material'
);
SELECT ok(
  pg_temp.expect_signal_unavailable(7100001, (SELECT signal_ref FROM contract_a_result)),
  'replacement revokes the prior handle for the same actor and source'
);
UPDATE contract_a_result
   SET signal_ref = (SELECT signal_ref FROM contract_a_replacement);
UPDATE contract_a_result
   SET payload = public.resolve_systems_check_signal_reference(7100001, signal_ref);
SELECT is(
  (SELECT resolution_action_id::text FROM public.paige_systems_check_finding WHERE id = 'a1000000-0000-0000-0000-00000000f002'),
  'a1000000-0000-0000-0000-00000000ac02',
  'issuing and resolving preserve the canonical linked action without exposing it'
);

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT alike(public.issue_systems_check_signal_reference(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'scsig_v1_%', 'active tenant admin may issue an actor-bound safe reference');

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT alike(public.issue_systems_check_signal_reference(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'scsig_v1_%', 'active tenant coach may issue an actor-bound safe reference');

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'ordinary member is denied');

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'linked client without staff membership is denied');

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'membership fallback cannot replace an explicit active tenant');

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'inactive staff membership is denied');

SELECT set_config('request.jwt.claims', '{"sub":"b2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_signal_unavailable(7100001, (SELECT signal_ref FROM contract_a_result)), 'cross-tenant resolution is denied with the generic response');

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_signal_unavailable(7200002, (SELECT signal_ref FROM contract_a_result)), 'wrong account address is denied with the generic response');
RESET ROLE;
UPDATE public.profiles
   SET active_tenant_id = 'b2000000-0000-0000-0000-000000002222'
 WHERE user_id = 'a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_signal_unavailable(7100001, (SELECT signal_ref FROM contract_a_result)), 'same actor cannot replay an account-A handle after switching to account B');
RESET ROLE;
UPDATE public.profiles
   SET active_tenant_id = 'a1000000-0000-0000-0000-000000001111'
 WHERE user_id = 'a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('search_path', 'pg_temp, public, extensions', true);
SELECT extensions.is(
  public.resolve_systems_check_signal_reference(7100001, (SELECT signal_ref FROM contract_a_result)) ->> 'signal_kind',
  'communications_readiness'::text,
  'hostile caller search path cannot shadow the resolver dependencies'
);
SELECT set_config('search_path', '"$user", public, extensions', true);
SELECT ok(pg_temp.expect_signal_unavailable(7100001, 'scsig_v1_0000000000000000000000000000000000000000000000000000000000000000'), 'missing source is denied with the generic response');
SELECT ok(
  pg_temp.expect_signal_unavailable(
    7100001,
    (SELECT left(signal_ref, length(signal_ref) - 1) || CASE right(signal_ref, 1) WHEN '0' THEN '1' ELSE '0' END FROM contract_a_result)
  ),
  'one-character-mutated reference is denied with the generic response'
);
SELECT ok(pg_temp.expect_signal_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f002'), 'raw finding identifier is not accepted as a reference');
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f001'), 'superseded source is denied');
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f003'), 'resolved source is denied');
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f004'), 'unavailable skip source fails closed');
SELECT ok(pg_temp.expect_issue_unavailable(7100001, 'a1000000-0000-0000-0000-00000000f005'), 'error source fails closed');

RESET ROLE;
INSERT INTO public.paige_systems_check_run
  (id, tenant_id, scan_flavor, started_at, completed_at, check_count, pass_count, fail_count, triggered_by)
VALUES
  ('a1000000-0000-0000-0000-00000000a003', 'a1000000-0000-0000-0000-000000001111',
   'change_triggered', now() - interval '1 minute', NULL, 0, 0, 0,
   '{"source":"refresh","prompt_preview":"SECRET_IN_PROGRESS_TRIGGER"}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_signal_unavailable(7100001, (SELECT signal_ref FROM contract_a_result)), 'a newer incomplete run supersedes the previously current reference');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(pg_temp.expect_issue_unavailable(7300003, 'c3000000-0000-0000-0000-00000000f001'), 'stale source is denied');

SELECT * FROM finish();
ROLLBACK;
