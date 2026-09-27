-- Analytics Evidence Bundle: synthetic fixtures only; every write rolls back.
-- Run in an isolated migration-proof database after all committed migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(51);

SELECT ok(
  NOT has_function_privilege('anon', 'public.issue_analytics_evidence_bundle(text,text,uuid)', 'EXECUTE'),
  'anonymous callers cannot issue Analytics evidence'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.issue_analytics_evidence_bundle(text,text,uuid)', 'EXECUTE'),
  'service role cannot bypass the authenticated actor issuer gate'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.issue_analytics_evidence_bundle(text,text,uuid)', 'EXECUTE'),
  'authenticated callers can reach the issuer body gate'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.resolve_analytics_evidence_reference(text)', 'EXECUTE'),
  'authenticated callers can reach the resolver body gate'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.analytics_evidence_reference', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated callers have no direct reference-registry access'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.analytics_evidence_reference', 'SELECT,INSERT,UPDATE,DELETE'),
  'service role has no direct reference-registry access'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.issue_analytics_evidence_bundle(text,text,uuid)'::regprocedure)
  AND (SELECT provolatile = 'v' FROM pg_proc WHERE oid = 'public.issue_analytics_evidence_bundle(text,text,uuid)'::regprocedure)
  AND (SELECT provolatile = 'v' FROM pg_proc WHERE oid = 'public.resolve_analytics_evidence_reference(text)'::regprocedure),
  'issuer and resolver are SECURITY DEFINER and VOLATILE'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""']
     FROM pg_proc WHERE oid = 'public.issue_analytics_evidence_bundle(text,text,uuid)'::regprocedure)
  AND (SELECT proconfig @> ARRAY['search_path=""']
     FROM pg_proc WHERE oid = 'public.resolve_analytics_evidence_reference(text)'::regprocedure)
  AND (SELECT proconfig @> ARRAY['search_path=""']
     FROM pg_proc WHERE oid = 'public.analytics_sales_funnel_evidence_bundle(uuid,text,timestamptz,timestamptz,timestamptz)'::regprocedure),
  'all definer functions pin an empty search path'
);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('ae100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'analytics-owner-a@tests.invalid'),
  ('ae100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'analytics-coach-a@tests.invalid'),
  ('be200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'analytics-owner-b@tests.invalid'),
  ('ce300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'analytics-owner-c@tests.invalid'),
  ('de400000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'analytics-admin-a@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('ae100000-0000-0000-0000-000000001111', 'analytics-contract-a', 'Analytics Contract A', 'active', 'standalone', 'ACA', 8100001, '{}'::jsonb),
  ('be200000-0000-0000-0000-000000002222', 'analytics-contract-b', 'Analytics Contract B', 'active', 'standalone', 'ACB', 8200002, '{}'::jsonb),
  ('ce300000-0000-0000-0000-000000003333', 'analytics-contract-c', 'Analytics Contract C', 'active', 'standalone', 'ACC', 8300003, '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('ae100000-0000-0000-0000-000000001111', 'ae100000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('be200000-0000-0000-0000-000000002222', 'ae100000-0000-0000-0000-000000000001', 'admin', 'active', false, now()),
  ('ae100000-0000-0000-0000-000000001111', 'ae100000-0000-0000-0000-000000000002', 'member', 'active', false, now()),
  ('be200000-0000-0000-0000-000000002222', 'be200000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('ce300000-0000-0000-0000-000000003333', 'ce300000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('ae100000-0000-0000-0000-000000001111', 'de400000-0000-0000-0000-000000000001', 'admin', 'active', false, now());

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('ae100000-0000-0000-0000-000000000001', 'ae100000-0000-0000-0000-000000001111'),
  ('ae100000-0000-0000-0000-000000000002', 'ae100000-0000-0000-0000-000000001111'),
  ('be200000-0000-0000-0000-000000000001', 'be200000-0000-0000-0000-000000002222'),
  ('ce300000-0000-0000-0000-000000000001', 'ce300000-0000-0000-0000-000000003333'),
  ('de400000-0000-0000-0000-000000000001', 'ae100000-0000-0000-0000-000000001111')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.pipelines (id, tenant_id, name, is_default) VALUES
  ('ae100000-0000-0000-0000-00000000a001', 'ae100000-0000-0000-0000-000000001111', 'Primary sales', true),
  ('ae100000-0000-0000-0000-00000000a002', 'ae100000-0000-0000-0000-000000001111', 'Secondary sales', false),
  ('be200000-0000-0000-0000-00000000b001', 'be200000-0000-0000-0000-000000002222', 'Other sales', true),
  ('ce300000-0000-0000-0000-00000000c001', 'ce300000-0000-0000-0000-000000003333', 'Empty sales', true);

INSERT INTO public.pipeline_stages (id, pipeline_id, tenant_id, label, order_index, probability, stage_type) VALUES
  ('ae100000-0000-0000-0000-00000000a101', 'ae100000-0000-0000-0000-00000000a001', 'ae100000-0000-0000-0000-000000001111', 'Lead', 1, 10, 'open'),
  ('ae100000-0000-0000-0000-00000000a102', 'ae100000-0000-0000-0000-00000000a001', 'ae100000-0000-0000-0000-000000001111', 'Won', 2, 100, 'won'),
  ('ae100000-0000-0000-0000-00000000a201', 'ae100000-0000-0000-0000-00000000a002', 'ae100000-0000-0000-0000-000000001111', 'Secondary', 1, 10, 'open'),
  ('be200000-0000-0000-0000-00000000b101', 'be200000-0000-0000-0000-00000000b001', 'be200000-0000-0000-0000-000000002222', 'Other lead', 1, 10, 'open'),
  ('ce300000-0000-0000-0000-00000000c101', 'ce300000-0000-0000-0000-00000000c001', 'ce300000-0000-0000-0000-000000003333', 'First stage', 1, 10, 'open');

INSERT INTO public.deals
  (id, title, pipeline_id, stage_id, value_cents, currency, status, tenant_id, created_at, updated_at)
VALUES
  ('ae100000-0000-0000-0000-00000000d001', 'SECRET DEAL A', 'ae100000-0000-0000-0000-00000000a001', 'ae100000-0000-0000-0000-00000000a101', 990001, 'USD', 'open', 'ae100000-0000-0000-0000-000000001111', now() - interval '2 days', now() - interval '1 day'),
  ('ae100000-0000-0000-0000-00000000d002', 'SECRET EXCLUDED A', 'ae100000-0000-0000-0000-00000000a002', 'ae100000-0000-0000-0000-00000000a201', 880002, 'USD', 'open', 'ae100000-0000-0000-0000-000000001111', now() - interval '3 days', now() - interval '1 day'),
  ('ae100000-0000-0000-0000-00000000d003', 'SECRET OLD A', 'ae100000-0000-0000-0000-00000000a001', 'ae100000-0000-0000-0000-00000000a102', 770003, 'USD', 'won', 'ae100000-0000-0000-0000-000000001111', now() - interval '60 days', now() - interval '50 days'),
  ('be200000-0000-0000-0000-00000000d001', 'SECRET DEAL B', 'be200000-0000-0000-0000-00000000b001', 'be200000-0000-0000-0000-00000000b101', 660004, 'USD', 'open', 'be200000-0000-0000-0000-000000002222', now() - interval '1 day', now() - interval '1 hour');

CREATE TEMP TABLE analytics_unavailable_cases (name text PRIMARY KEY, bundle jsonb NOT NULL);
UPDATE public.pipelines SET is_default = false
 WHERE tenant_id = 'be200000-0000-0000-0000-000000002222';
INSERT INTO analytics_unavailable_cases VALUES (
  'no_default',
  public.analytics_sales_funnel_evidence_bundle(
    'be200000-0000-0000-0000-000000002222', 'last_30_days', now() - interval '30 days', now(), now()
  )
);
SELECT is((SELECT bundle->>'truth_state' FROM analytics_unavailable_cases WHERE name = 'no_default'), 'UNAVAILABLE', 'no default pipeline is unavailable');
SELECT is((SELECT bundle#>>'{coverage,candidate_count}' FROM analytics_unavailable_cases WHERE name = 'no_default'), '1', 'no-default coverage retains the candidate count');
SELECT is((SELECT bundle#>>'{coverage,excluded_count}' FROM analytics_unavailable_cases WHERE name = 'no_default'), '1', 'no-default coverage explicitly excludes every candidate');

UPDATE public.pipelines SET is_default = true
 WHERE id = 'be200000-0000-0000-0000-00000000b001';
INSERT INTO public.pipelines (id, tenant_id, name, is_default) VALUES
  ('be200000-0000-0000-0000-00000000b002', 'be200000-0000-0000-0000-000000002222', 'Ambiguous default', true);
INSERT INTO analytics_unavailable_cases VALUES (
  'multiple_defaults',
  public.analytics_sales_funnel_evidence_bundle(
    'be200000-0000-0000-0000-000000002222', 'last_30_days', now() - interval '30 days', now(), now()
  )
);
SELECT is((SELECT bundle->>'truth_state' FROM analytics_unavailable_cases WHERE name = 'multiple_defaults'), 'UNAVAILABLE', 'multiple default pipelines are unavailable');
SELECT is((SELECT bundle#>>'{coverage,candidate_count}' FROM analytics_unavailable_cases WHERE name = 'multiple_defaults'), '1', 'multiple-default coverage retains the candidate count');
SELECT is((SELECT bundle#>>'{coverage,excluded_count}' FROM analytics_unavailable_cases WHERE name = 'multiple_defaults'), '1', 'multiple-default coverage explicitly excludes every candidate');
DELETE FROM public.pipelines
 WHERE id = 'be200000-0000-0000-0000-00000000b002';

CREATE TEMP TABLE analytics_test_refs (name text PRIMARY KEY, evidence_ref text NOT NULL);
GRANT SELECT, INSERT ON analytics_test_refs TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"be200000-0000-0000-0000-000000000001","role":"authenticated"}', true);
INSERT INTO analytics_test_refs
SELECT 'populated', public.issue_analytics_evidence_bundle(
  'sales_funnel.created_deals_by_current_stage',
  'last_30_days',
  'be200000-0000-0000-0000-000000002222'
)->>'evidence_ref';
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'populated'))->>'truth_state'), 'LIVE', 'complete populated evidence issued to the active owner is LIVE');
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'populated'))#>>'{coverage,candidate_count}'), '1', 'complete populated issuance retains its candidate count');
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'populated'))#>>'{coverage,excluded_count}'), '0', 'complete populated issuance has no hidden exclusion');

SELECT set_config('request.jwt.claims', '{"sub":"ce300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
INSERT INTO analytics_test_refs
SELECT 'first_use', public.issue_analytics_evidence_bundle(
  'sales_funnel.created_deals_by_current_stage',
  'last_30_days',
  'ce300000-0000-0000-0000-000000003333'
)->>'evidence_ref';
SELECT matches((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'), '^aneb_v1_[0-9a-f]{64}$', 'first-use issuance returns an opaque reference');
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))->>'truth_state'), 'LIVE', 'authoritative first-use zero evidence is LIVE');
SELECT ok(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))#>>'{range,start}')::timestamptz
    = (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))#>>'{range,end}')::timestamptz - interval '30 days',
  'first-use issuance carries the exact server-derived last-30-days boundary'
);
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))#>>'{coverage,candidate_count}'), '0', 'first-use issuance confirms no candidate records');
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))#>>'{coverage,contributing_count}'), '0', 'first-use issuance confirms no contributing records');
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))#>>'{coverage,excluded_count}'), '0', 'first-use issuance confirms no excluded records');
SELECT is((public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'first_use'))#>>'{values,stages,0,count}'), '0', 'first-use issuance returns a source-backed zero stage count');

SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

INSERT INTO analytics_test_refs
SELECT 'initial', public.issue_analytics_evidence_bundle(
  'sales_funnel.created_deals_by_current_stage',
  'last_30_days',
  'ae100000-0000-0000-0000-000000001111'
)->>'evidence_ref';

INSERT INTO analytics_test_refs
SELECT 'quarter', public.issue_analytics_evidence_bundle(
  'sales_funnel.created_deals_by_current_stage',
  'current_quarter',
  'ae100000-0000-0000-0000-000000001111'
)->>'evidence_ref';
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{range,key}'),
  'last_30_days',
  'issuing another range does not revoke the still-valid first-range reference'
);

SELECT set_config('request.jwt.claims', '{"sub":"de400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial')) $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'a different authorized actor in the same tenant cannot resolve the owner reference'
);
INSERT INTO analytics_test_refs
SELECT 'role_loss', public.issue_analytics_evidence_bundle(
  'sales_funnel.created_deals_by_current_stage',
  'last_30_days',
  'ae100000-0000-0000-0000-000000001111'
)->>'evidence_ref';
RESET ROLE;
UPDATE public.tenant_members
   SET role = 'member'
 WHERE tenant_id = 'ae100000-0000-0000-0000-000000001111'
   AND user_id = 'de400000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"de400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'role_loss')) $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'an issuer who loses admin authority cannot resolve the prior reference'
);
SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT matches(
  (SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'),
  '^aneb_v1_[0-9a-f]{64}$',
  'issuer returns a versioned opaque 256-bit reference'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))->>'truth_state'),
  'PARTIAL',
  'an excluded non-default-pipeline record makes truth PARTIAL'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{coverage,candidate_count}'),
  '2',
  'candidate count includes every active-tenant deal in the exact range'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{coverage,contributing_count}'),
  '1',
  'contributing count includes only the unique default pipeline with a safe stage binding'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{coverage,excluded_count}'),
  '1',
  'coverage states the exact excluded-record count'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{values,stages,0,count}'),
  '1',
  'the first stage carries the real contributing count'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{values,stages,1,count}'),
  '0',
  'a source-backed empty stage is returned as a confirmed zero'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{metric,version}'),
  '1.0.0',
  'formula version is immutable and explicit'
);
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{range,key}'),
  'last_30_days',
  'the requested server-owned range key stays attached'
);
SELECT ok(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{range,start}')::timestamptz
    = (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))#>>'{range,end}')::timestamptz - interval '30 days',
  'the exact last-30-days boundary is server-derived'
);
SELECT ok(
  public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))::text NOT LIKE '%SECRET%'
  AND public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))::text NOT LIKE '%990001%'
  AND public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))::text NOT LIKE '%value_cents%',
  'bundle excludes deal titles, monetary values, and raw business rows'
);
SELECT is(
  jsonb_array_length(public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial'))->'source_references'),
  3,
  'bundle carries bounded deal, pipeline, and stage source references'
);

SELECT throws_ok(
  $$ SELECT public.issue_analytics_evidence_bundle('sales_funnel.created_deals_by_current_stage','last_30_days','be200000-0000-0000-0000-000000002222') $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'wrong account epoch fails closed'
);
SELECT throws_ok(
  $$ SELECT public.issue_analytics_evidence_bundle('revenue.total','last_30_days','ae100000-0000-0000-0000-000000001111') $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'unsupported metric identity fails closed'
);
SELECT throws_ok(
  $$ SELECT public.issue_analytics_evidence_bundle('sales_funnel.created_deals_by_current_stage','custom','ae100000-0000-0000-0000-000000001111') $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'unsupported caller-defined range fails closed'
);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference('aneb_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'unknown reference fails closed'
);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference('not-an-analytics-reference') $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'malformed reference fails closed before lookup'
);

SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.issue_analytics_evidence_bundle('sales_funnel.created_deals_by_current_stage','last_30_days','ae100000-0000-0000-0000-000000001111') $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'coach cannot issue the owner-facing metric bundle'
);

SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
RESET ROLE;
UPDATE public.profiles SET active_tenant_id = 'be200000-0000-0000-0000-000000002222'
 WHERE user_id = 'ae100000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial')) $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'reference cannot cross an active-account switch'
);

RESET ROLE;
UPDATE public.profiles SET active_tenant_id = 'ae100000-0000-0000-0000-000000001111'
 WHERE user_id = 'ae100000-0000-0000-0000-000000000001';
INSERT INTO public.deals
  (id, title, pipeline_id, stage_id, value_cents, currency, status, tenant_id, created_at, updated_at)
VALUES
  ('ae100000-0000-0000-0000-00000000d004', 'SECRET LATE DEAL', 'ae100000-0000-0000-0000-00000000a001', 'ae100000-0000-0000-0000-00000000a101', 550005, 'USD', 'open', 'ae100000-0000-0000-0000-000000001111', now() - interval '1 hour', now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'initial')) $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'a changed source revision makes the prior reference stale'
);

INSERT INTO analytics_test_refs
SELECT 'fresh', public.issue_analytics_evidence_bundle(
  'sales_funnel.created_deals_by_current_stage',
  'last_30_days',
  'ae100000-0000-0000-0000-000000001111'
)->>'evidence_ref';
SELECT is(
  (public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'fresh'))->>'truth_state'),
  'PARTIAL',
  'a fresh reference resolves after source change'
);

RESET ROLE;
UPDATE public.analytics_evidence_reference
   SET issued_at = now() - interval '16 minutes',
       expires_at = now() - interval '1 second'
 WHERE token_digest = encode(extensions.digest(convert_to((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'fresh'), 'UTF8'), 'sha256'), 'hex');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ae100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.resolve_analytics_evidence_reference((SELECT evidence_ref FROM analytics_test_refs WHERE name = 'fresh')) $$,
  '42501', 'ANALYTICS_EVIDENCE_UNAVAILABLE',
  'expired reference fails closed'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::text FROM public.analytics_evidence_reference WHERE issued_to = 'ae100000-0000-0000-0000-000000000001' AND range_key = 'last_30_days' AND revoked_at IS NULL),
  '1',
  'issuing a same-range replacement revokes the prior actor/account/metric reference'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'analytics_evidence_reference'
       AND column_name IN ('metric_value', 'payload', 'prompt', 'recommendation', 'outcome')
  ),
  'reference registry cannot store metric values, prompts, recommendations, or outcomes'
);

SELECT * FROM finish();
ROLLBACK;
