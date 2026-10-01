-- PAIGE Voice V1a budget control (INT-104 / INT-089 / INT-100).
-- Synthetic fixtures only; every write rolls back.
--
-- Proves:
--   * the shipped platform defaults are the bounded starting values set by #1447 (migration
--     20270424000000): enabled, emergency-stop off, a $100 monthly cap, a $0.30 per-1,000-char
--     ceiling, a per-tenant default; no tenant row is written implicitly;
--   * tenant budget authority is a server-resolved capability held only by that tenant's owner/admin;
--   * a platform role cannot write inside a tenant, while the platform owner alone may set the global cap;
--   * reservations against the active profile (ElevenLabs Jessica since #1447) and a second active
--     revision consume the same tenant + platform monthly budgets;
--   * exact cap succeeds, over-cap fails, idempotency is scope-bound, old months do not consume this
--     month, and ambiguous post-dispatch outcomes remain charged until explicitly reconciled;
--   * the reservation implementation owns both lock rows and guarded counters. A separate two-session
--     proof exercises the real race; this assertion prevents a lock-free implementation from passing.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(48);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_voice_platform_budget', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated callers have no direct platform-budget table access'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.paige_voice_tenant_budgets', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated callers have no direct tenant-budget table access'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.paige_voice_platform_budget', 'INSERT,UPDATE,DELETE'),
  'service role cannot bypass the platform cap-setting RPC'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.paige_voice_tenant_budgets', 'INSERT,UPDATE,DELETE'),
  'service role cannot bypass the tenant cap-setting RPC'
);
SELECT ok(NOT has_function_privilege('anon', 'public.set_paige_voice_tenant_budget(uuid,boolean,numeric)', 'EXECUTE'), 'anon cannot set a tenant voice budget');
SELECT ok(has_function_privilege('authenticated', 'public.set_paige_voice_tenant_budget(uuid,boolean,numeric)', 'EXECUTE'), 'authenticated callers reach the tenant capability gate');
SELECT ok(NOT has_function_privilege('service_role', 'public.set_paige_voice_tenant_budget(uuid,boolean,numeric)', 'EXECUTE'), 'service role has no silent tenant cap-setting grant');
SELECT ok(NOT has_function_privilege('anon', 'public.set_paige_voice_platform_budget(boolean,boolean,numeric,numeric)', 'EXECUTE'), 'anon cannot set the platform voice budget');
SELECT ok(has_function_privilege('authenticated', 'public.set_paige_voice_platform_budget(boolean,boolean,numeric,numeric)', 'EXECUTE'), 'authenticated callers reach the platform capability gate');
SELECT ok(NOT has_function_privilege('service_role', 'public.set_paige_voice_platform_budget(boolean,boolean,numeric,numeric)', 'EXECUTE'), 'service role has no silent platform cap-setting grant');

SELECT is((SELECT enabled FROM public.paige_voice_platform_budget WHERE singleton), true, 'platform budget ships enabled (20270424000000)');
SELECT is((SELECT emergency_disabled FROM public.paige_voice_platform_budget WHERE singleton), false, 'emergency disable ships off (20270424000000)');
SELECT is((SELECT monthly_limit_usd FROM public.paige_voice_platform_budget WHERE singleton), 100::numeric, 'platform monthly cap ships bounded at $100');
SELECT is((SELECT max_usd_per_1000_chars FROM public.paige_voice_platform_budget WHERE singleton), 0.30::numeric, 'platform unit-price ceiling ships bounded at $0.30 per 1,000 chars');
SELECT is((SELECT count(*)::integer FROM public.paige_voice_tenant_budgets), 0, 'no tenant receives an implicit budget');

INSERT INTO auth.users(id,aud,role,email) VALUES
  ('10400000-0000-4000-8000-000000000001','authenticated','authenticated','voice-owner-a@tests.invalid'),
  ('10400000-0000-4000-8000-000000000002','authenticated','authenticated','voice-admin-a@tests.invalid'),
  ('10400000-0000-4000-8000-000000000003','authenticated','authenticated','voice-member-a@tests.invalid'),
  ('10400000-0000-4000-8000-000000000004','authenticated','authenticated','voice-platform-owner@tests.invalid'),
  ('10400000-0000-4000-8000-000000000005','authenticated','authenticated','voice-owner-b@tests.invalid');

INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
  ('10400000-0000-4000-8000-0000000000a1','voice-budget-a','Voice Budget A','active','standalone','VBA','{}'),
  ('10400000-0000-4000-8000-0000000000b1','voice-budget-b','Voice Budget B','active','standalone','VBB','{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
  ('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000001','owner','active',true,now()),
  ('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000002','admin','active',false,now()),
  ('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000003','member','active',false,now()),
  ('10400000-0000-4000-8000-0000000000b1','10400000-0000-4000-8000-000000000005','owner','active',true,now());
INSERT INTO public.user_roles(user_id,role) VALUES
  ('10400000-0000-4000-8000-000000000004','super_admin'),
  ('10400000-0000-4000-8000-000000000003','platform_admin')
ON CONFLICT DO NOTHING;

SELECT is(public._paige_voice_tenant_budget_capabilities('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000001'), ARRAY['voice.budget.configure_tenant'], 'tenant owner holds the tenant-budget capability');
SELECT is(public._paige_voice_tenant_budget_capabilities('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000002'), ARRAY['voice.budget.configure_tenant'], 'tenant admin holds the tenant-budget capability');
SELECT is(public._paige_voice_tenant_budget_capabilities('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000003'), ARRAY[]::text[], 'ordinary member holds no tenant-budget capability even with a global platform role');
SELECT is(public._paige_voice_tenant_budget_capabilities('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000004'), ARRAY[]::text[], 'platform owner holds no write capability inside a tenant');
SELECT is(public._paige_voice_tenant_budget_capabilities('10400000-0000-4000-8000-0000000000a1','10400000-0000-4000-8000-000000000005'), ARRAY[]::text[], 'another tenant owner holds no capability in tenant A');
SELECT is(public._paige_voice_platform_budget_capabilities('10400000-0000-4000-8000-000000000004'), ARRAY['voice.budget.configure_platform'], 'platform owner holds the global-budget capability');
SELECT is(public._paige_voice_platform_budget_capabilities('10400000-0000-4000-8000-000000000001'), ARRAY[]::text[], 'tenant owner holds no global-budget capability');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT throws_ok(
  $$SELECT public.set_paige_voice_tenant_budget('10400000-0000-4000-8000-0000000000a1',true,0.20)$$,
  '42501','PAIGE_VOICE_TENANT_BUDGET_FORBIDDEN','ordinary member cannot set the tenant budget'
);
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT throws_ok(
  $$SELECT public.set_paige_voice_tenant_budget('10400000-0000-4000-8000-0000000000a1',true,0.20)$$,
  '42501','PAIGE_VOICE_TENANT_BUDGET_FORBIDDEN','platform owner cannot write inside a tenant'
);
SELECT lives_ok(
  $$SELECT public.set_paige_voice_platform_budget(true,false,0.30,0.10)$$,
  'platform owner may set the global budget through the platform function'
);
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.set_paige_voice_tenant_budget('10400000-0000-4000-8000-0000000000a1',true,0.20)$$,
  'tenant owner may set its own budget through the capability-gated RPC'
);
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.set_paige_voice_tenant_budget('10400000-0000-4000-8000-0000000000a1',true,0.20)$$,
  'tenant admin may set its own budget through the same capability gate'
);
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.set_paige_voice_tenant_budget('10400000-0000-4000-8000-0000000000b1',true,0.20)$$,
  'the other tenant owner may configure only its own tenant'
);
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.set_paige_voice_platform_budget(true,true,0.30,0.10)$$,
  'platform owner may engage the emergency disable without erasing configured limits'
);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok(
  $$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000100',1)$$,
  '55000','PAIGE_VOICE_BUDGET_DISABLED','emergency disable refuses before any provider dispatch'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10400000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.set_paige_voice_platform_budget(true,false,0.30,0.10)$$, 'platform owner may explicitly clear the emergency disable');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

-- ElevenLabs Jessica is the active profile (20270424000000). Exact tenant cap = two 1,000-char
-- reservations at the $0.10 ceiling set above; the arithmetic is the ceiling's, not the provider's.
SELECT lives_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000101',1000)$$, 'first reservation on the active profile succeeds');
SELECT lives_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000102',1000)$$, 'exact tenant cap succeeds');
SELECT throws_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000103',1)$$, '54000','PAIGE_VOICE_TENANT_COST_LIMIT','one character over the tenant cap fails');

-- Tenant B has independent headroom, but its first reservation reaches the shared platform cap exactly.
SELECT lives_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000005','10400000-0000-4000-8000-0000000000b1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000104',1000)$$, 'a second tenant may use its own budget up to the exact global cap');
SELECT throws_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000005','10400000-0000-4000-8000-0000000000b1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000105',1)$$, '54000','PAIGE_VOICE_PLATFORM_COST_LIMIT','one character over the global cap fails');

SELECT is(
  (public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000101',1000)->>'reservation_id'),
  (SELECT id::text FROM public.paige_voice_cost_reservations WHERE request_ref='10400000-0000-4000-8000-000000000101'),
  'idempotent replay returns the original reservation'
);
SELECT throws_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000005','10400000-0000-4000-8000-0000000000b1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000101',1000)$$, '23505','PAIGE_VOICE_COST_IDEMPOTENCY_MISMATCH','idempotency key cannot cross tenants');

-- Monthly reset: prior-month committed spend does not consume the new month's caps.
UPDATE public.paige_voice_cost_reservations SET budget_month=(date_trunc('month',now() AT TIME ZONE 'UTC')::date - 1) WHERE tenant_id='10400000-0000-4000-8000-0000000000a1';
UPDATE public.paige_voice_platform_monthly_usage SET budget_month=(date_trunc('month',now() AT TIME ZONE 'UTC')::date - 1);
UPDATE public.paige_voice_tenant_monthly_usage SET budget_month=(date_trunc('month',now() AT TIME ZONE 'UTC')::date - 1) WHERE tenant_id='10400000-0000-4000-8000-0000000000a1';
SELECT lives_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000106',2000)$$, 'prior-month spend does not consume the current-month tenant cap');

-- Ambiguous dispatch stays charged; explicit reconciliation can release it later.
SELECT lives_ok($$SELECT public.settle_paige_voice_cost_internal((SELECT id FROM public.paige_voice_cost_reservations WHERE request_ref='10400000-0000-4000-8000-000000000106'),'10400000-0000-4000-8000-000000000001','ambiguous')$$, 'post-dispatch ambiguity settles to an explicit counted state');
SELECT is((SELECT state FROM public.paige_voice_cost_reservations WHERE request_ref='10400000-0000-4000-8000-000000000106'),'ambiguous','ambiguous reservation is durable');
SELECT throws_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-jessica-r1','10400000-0000-4000-8000-000000000107',1)$$, '54000','PAIGE_VOICE_TENANT_COST_LIMIT','ambiguous spend continues to consume the cap');
SELECT lives_ok($$SELECT public.settle_paige_voice_cost_internal((SELECT id FROM public.paige_voice_cost_reservations WHERE request_ref='10400000-0000-4000-8000-000000000106'),'10400000-0000-4000-8000-000000000001','released')$$, 'an internal reconciliation may release proven-no-charge ambiguous spend');

-- Switch only the synthetic active profile identity to prove the same reservation path covers ElevenLabs.
INSERT INTO public.paige_voice_provider_verifications(id,provider,provider_voice_ref,key_scope_verified,voice_authorized,retention_policy_approved,zero_retention_confirmed,quota_verified,hard_cost_limit_usd,max_usd_per_1000_chars,verified_at,evidence_ref,verified_by_actor_id)
VALUES('10400000-0000-4000-8000-000000000201','elevenlabs','cgSgspJ2msm6clMCkdW9',true,true,true,true,true,0.30,0.10,now(),'synthetic-budget-proof','10400000-0000-4000-8000-000000000004');
UPDATE public.paige_voice_readiness
SET transport_enabled=true,key_scope_verified=true,voice_authorized=true,retention_policy_approved=true,
    zero_retention_confirmed=true,quota_verified=true,hard_cost_limit_usd=0.30,max_usd_per_1000_chars=0.10,
    provider_verification_id='10400000-0000-4000-8000-000000000201',
    account_verification_receipt_ref='synthetic-budget-proof',account_verified_at=now()
WHERE singleton=true;
UPDATE public.paige_voice_profiles
SET provider='elevenlabs',
    provider_voice_ref='cgSgspJ2msm6clMCkdW9',
    active=true,
    approved=true,
    revision='elevenlabs-budget-proof-r1',
    effective_at=now(),
    provider_verification_id='10400000-0000-4000-8000-000000000201',
    provider_verification_receipt_ref='synthetic-budget-proof',
    provider_verified_at=now()
WHERE slot='active';
SELECT lives_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000001','10400000-0000-4000-8000-0000000000a1','elevenlabs-budget-proof-r1','10400000-0000-4000-8000-000000000108',1)$$, 'the same budget controller covers an ElevenLabs profile');
SELECT is((SELECT provider FROM public.paige_voice_cost_reservations WHERE request_ref='10400000-0000-4000-8000-000000000108'),'elevenlabs','reservation records the actual selected provider');

SELECT lives_ok($$SELECT public.reserve_paige_voice_cost_internal('10400000-0000-4000-8000-000000000003',NULL,'elevenlabs-budget-proof-r1','10400000-0000-4000-8000-000000000109',1)$$, 'platform staff without a tenant consumes the platform budget only');
SELECT is((SELECT tenant_id FROM public.paige_voice_cost_reservations WHERE request_ref='10400000-0000-4000-8000-000000000109'),NULL::uuid,'operator reservation never fabricates a tenant');

SELECT matches(pg_get_functiondef('public.reserve_paige_voice_cost_internal(uuid,uuid,text,uuid,integer)'::regprocedure),'FOR[[:space:]]+UPDATE[[:space:][:print:]]+ON CONFLICT','reservation implementation combines row locks with guarded month buckets for concurrent cap enforcement');

SELECT * FROM finish();
ROLLBACK;
