-- PAIGE Spine foundation contract: real caller roles, tenant isolation, fixed fields,
-- lifecycle, and raw-content non-disclosure. Synthetic fixtures; always rolled back.
BEGIN;

SELECT plan(21);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_pipeline_spine_evidence(text,integer)', 'EXECUTE'),
  'anonymous callers cannot execute the evidence adapter'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_pipeline_spine_evidence(text,integer)', 'EXECUTE'),
  'authenticated callers can reach the hardened safe lens'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.get_pipeline_spine_evidence(text,integer)', 'EXECUTE'),
  'service role cannot bypass the human caller boundary'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_pipeline_spine_evidence(text,integer)'::regprocedure),
  'adapter is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=pg_catalog, public']
     FROM pg_proc WHERE oid = 'public.get_pipeline_spine_evidence(text,integer)'::regprocedure),
  'adapter pins its search path'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_client_events', 'SELECT'),
  'authenticated callers retain no direct Rail table access'
);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'spine-owner@tests.invalid'),
  ('f1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'spine-member@tests.invalid'),
  ('f2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'spine-other@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('f1000000-0000-0000-0000-000000001111', 'spine-contract-a', 'Spine Contract A', 'active', 'standalone', 'SPA', 8100001, '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000002222', 'spine-contract-b', 'Spine Contract B', 'active', 'standalone', 'SPB', 8200002, '{}'::jsonb);

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('f1000000-0000-0000-0000-000000000001', NULL),
  ('f1000000-0000-0000-0000-000000000002', NULL),
  ('f2000000-0000-0000-0000-000000000001', NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('f1000000-0000-0000-0000-000000001111', 'f1000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('f1000000-0000-0000-0000-000000001111', 'f1000000-0000-0000-0000-000000000002', 'member', 'active', false, now()),
  ('f2000000-0000-0000-0000-000000002222', 'f2000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('f2000000-0000-0000-0000-000000002222', 'f1000000-0000-0000-0000-000000000001', 'admin', 'active', false, now());

UPDATE public.profiles SET active_tenant_id = 'f1000000-0000-0000-0000-000000001111'
 WHERE user_id IN ('f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002');
UPDATE public.profiles SET active_tenant_id = 'f2000000-0000-0000-0000-000000002222'
 WHERE user_id = 'f2000000-0000-0000-0000-000000000001';

INSERT INTO public.user_roles (user_id, role) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'admin'),
  ('f2000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.clients
  (id, tenant_id, account_number, created_by, first_name, last_name)
VALUES
  ('f1000000-0000-0000-0000-00000000c101', 'f1000000-0000-0000-0000-000000001111', 'CLT-SPINE-A',
   'f1000000-0000-0000-0000-000000000001', 'Safe', 'Subject'),
  ('f2000000-0000-0000-0000-00000000c201', 'f2000000-0000-0000-0000-000000002222', 'CLT-SPINE-B',
   'f2000000-0000-0000-0000-000000000001', 'Other', 'Subject');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
  ('f1000000-0000-0000-0000-000000001111', 'f1000000-0000-0000-0000-00000000c101', 'email', 'spine-a@tests.invalid', true, 0),
  ('f2000000-0000-0000-0000-000000002222', 'f2000000-0000-0000-0000-00000000c201', 'email', 'spine-b@tests.invalid', true, 0);

INSERT INTO public.paige_client_events
  (id, tenant_id, contact_id, event_kind, surface, actor_type, actor_user_id, audience,
   visibility, title, summary, payload, ref_table, ref_id, occurred_at, created_at)
VALUES
  ('f1000000-0000-0000-0000-00000000e101', 'f1000000-0000-0000-0000-000000001111',
   'f1000000-0000-0000-0000-00000000c101', 'owner.crm_mutation', 'campaigns_pipeline', 'owner_staff',
   'f1000000-0000-0000-0000-000000000001', 'owner', 'owner_internal',
   'SECRET_CURRENT_TITLE', 'SECRET_CURRENT_SUMMARY',
   '{"policy_result":"allowed","actor_kind":"human","deal_id":"SECRET_DEAL","stage_name":"SECRET_STAGE"}'::jsonb,
   'deals', 'f1000000-0000-0000-0000-00000000d101', now() - interval '1 day', now() - interval '23 hours'),
  ('f1000000-0000-0000-0000-00000000e102', 'f1000000-0000-0000-0000-000000001111',
   'f1000000-0000-0000-0000-00000000c101', 'owner.crm_mutation', 'campaigns_pipeline', 'paige_agent',
   NULL, 'owner', 'owner_internal', 'SECRET_STALE_TITLE', 'SECRET_STALE_SUMMARY',
   '{"policy_result":"allowed","actor_kind":"paige","deal_id":"SECRET_STALE_DEAL"}'::jsonb,
   'deals', 'f1000000-0000-0000-0000-00000000d102', now() - interval '31 days', now() - interval '31 days'),
  ('f1000000-0000-0000-0000-00000000e103', 'f1000000-0000-0000-0000-000000001111',
   'f1000000-0000-0000-0000-00000000c101', 'owner.crm_mutation', 'campaigns_pipeline', 'owner_staff',
   'f1000000-0000-0000-0000-000000000001', 'owner', 'owner_internal', 'SECRET_EXPIRED_TITLE', NULL,
   '{"policy_result":"allowed","actor_kind":"human"}'::jsonb, 'deals',
   'f1000000-0000-0000-0000-00000000d103', now() - interval '366 days', now() - interval '366 days'),
  ('f1000000-0000-0000-0000-00000000e104', 'f1000000-0000-0000-0000-000000001111',
   'f1000000-0000-0000-0000-00000000c101', 'owner.crm_mutation', 'campaigns_pipeline', 'owner_staff',
   'f1000000-0000-0000-0000-000000000001', 'owner', 'owner_internal', 'SECRET_DENIED_TITLE', NULL,
   '{"policy_result":"denied","actor_kind":"human"}'::jsonb, 'deals',
   'f1000000-0000-0000-0000-00000000d104', now() - interval '1 hour', now() - interval '1 hour'),
  ('f2000000-0000-0000-0000-00000000e201', 'f2000000-0000-0000-0000-000000002222',
   'f2000000-0000-0000-0000-00000000c201', 'owner.crm_mutation', 'campaigns_pipeline', 'owner_staff',
   'f2000000-0000-0000-0000-000000000001', 'owner', 'owner_internal', 'SECRET_OTHER_TITLE', NULL,
   '{"policy_result":"allowed","actor_kind":"human"}'::jsonb, 'deals',
   'f2000000-0000-0000-0000-00000000d201', now() - interval '1 hour', now() - interval '1 hour');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

CREATE TEMP TABLE spine_result AS
SELECT * FROM public.get_pipeline_spine_evidence('clt-spine-a', 1000);

SELECT is((SELECT count(*)::integer FROM spine_result), 2, 'only allowed, unexpired own-client outcomes are returned');
SELECT is((SELECT availability FROM spine_result WHERE signal_id = 'f1000000-0000-0000-0000-00000000e101'), 'available', 'current outcome is available');
SELECT is((SELECT availability FROM spine_result WHERE signal_id = 'f1000000-0000-0000-0000-00000000e102'), 'stale', 'older retained outcome is stale');
SELECT is((SELECT min(schema_version) FROM spine_result), 1, 'projection declares schema version one');
SELECT is((SELECT min(audience) FROM spine_result), 'owner_internal', 'projection stays owner-internal');
SELECT ok((SELECT bool_and(subject_ref = 'CLT-SPINE-A') FROM spine_result), 'only the public-safe client reference crosses the subject boundary');
SELECT ok((SELECT bool_and(source_record_ref = outcome_ref AND source_record_ref LIKE 'rail:%') FROM spine_result), 'outcome references resolve to the existing Rail record');
SELECT ok(
  (SELECT row_to_json(spine_result)::text FROM spine_result ORDER BY occurred_at DESC LIMIT 1)
    !~* '(SECRET_|"title"|"summary"|"payload"|actor_user_id|deal_id|stage_name|"ref_id")',
  'raw content and internal identifiers do not cross the adapter'
);
SELECT is(
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(to_jsonb((SELECT r FROM spine_result r LIMIT 1))) key),
  ARRAY['audience','availability','classification','expires_at','facts','kind','lifecycle','occurred_at','outcome_ref','recorded_at','safe_summary','schema_version','signal_id','source_actor_type','source_record_ref','source_system','subject_ref','subject_type','tenant_id']::text[],
  'adapter returns exactly the fixed-field contract'
);
SELECT is((SELECT count(*)::integer FROM public.get_pipeline_spine_evidence('CLT-SPINE-B', 50)), 0, 'wrong-tenant public reference returns no evidence');
SELECT is((SELECT count(*)::integer FROM public.get_pipeline_spine_evidence('CLT-SPINE-A', 0)), 1, 'limit is clamped to at least one');

SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is((SELECT count(*)::integer FROM public.get_pipeline_spine_evidence('CLT-SPINE-A', 50)), 0, 'ordinary member cannot use staff-only Rail evidence');

SELECT set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT count(*)::integer FROM public.get_pipeline_spine_evidence('CLT-SPINE-A', 50)), 0, 'other tenant cannot read account A evidence');

RESET ROLE;
UPDATE public.profiles SET active_tenant_id = 'f2000000-0000-0000-0000-000000002222'
 WHERE user_id = 'f1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT count(*)::integer FROM public.get_pipeline_spine_evidence('CLT-SPINE-A', 50)), 0, 'account switch invalidates prior tenant scope');

SELECT set_config('search_path', 'pg_temp, public, extensions', true);
SELECT is((SELECT count(*)::integer FROM public.get_pipeline_spine_evidence('CLT-SPINE-B', 50)), 1, 'hostile caller search path cannot shadow adapter dependencies');

SELECT * FROM finish();
ROLLBACK;
