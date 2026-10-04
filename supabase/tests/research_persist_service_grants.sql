-- INT-309 — THE RESEARCH PERSISTENCE GRANTS (permission denied for table research_runs).
-- Synthetic tenant fixtures only; always rolled back. Proves the ruling's matrix A–J:
--   A. before the grant (simulated by revoking inside a savepoint) service_role INSERT is DENIED
--   B. after the grant, service_role INSERT research_runs is allowed under canonical constraints
--   C. service_role INSERT research_sources is allowed
--   D/E. authenticated INSERT both tables is still REFUSED
--   F. anon read AND write are still REFUSED
--   G. the governed read RPCs stay executable by authenticated, not by anon
--   H. RLS/policies are unchanged (the M0 eight)
--   I. tenant_id remains NOT NULL
--   J. sources attach only to real runs (FK) and every run pins a real tenant (FK)
-- and the MUTATION: revoking the service-role INSERT grants makes the persistence proof fail.
-- NOTE the role discipline: inserts run as service_role (the engine's writer); every readback
-- runs as postgres, because service_role deliberately holds NO SELECT on these tables.
BEGIN;
SELECT plan(30);

-- ── Fixtures: one synthetic tenant + owner (the engine's lineage resolution shape) ──────
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('d7400000-0000-4000-8000-000000000001','authenticated','authenticated','res-grant-owner@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('d7400000-0000-4000-8000-000000000111','res-grant-tenant','Research Grant Tenant','active','standalone','RGT',8840001,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('d7400000-0000-4000-8000-000000000111','d7400000-0000-4000-8000-000000000001','owner','active',true,now());

-- ── A + MUTATION: without the grant the engine's exact write is denied ──────────────────
-- (Savepoint-scoped revoke proves BOTH the pre-repair state and the mutation in one motion;
--  the rollback restores the granted state the later proofs rely on.)
SAVEPOINT before_grant;
REVOKE INSERT ON public.research_runs FROM service_role;
REVOKE INSERT ON public.research_sources FROM service_role;
-- The probe must run AS service_role: a REVOKE from service_role does not touch the
-- session role's own privileges, so probing as postgres would insert fine and prove
-- nothing (review P1 — this is the live failure mode, reproduced at the writer role).
SET ROLE service_role;
SELECT throws_ok(
  $$INSERT INTO public.research_runs (id, tenant_id, user_id, question)
      VALUES ('d7400000-2222-4333-8444-555555555555', 'd7400000-0000-4000-8000-000000000111',
              'd7400000-0000-4000-8000-000000000001', 'mutation probe')$$,
  '42501',
  'A/mutation: service_role INSERT research_runs denied without the grant (the live 20:18/20:20 failure reproduced)'
);
RESET ROLE;
ROLLBACK TO before_grant;

-- ── B: the engine's run insert shape is allowed ─────────────────────────────────────────
SET ROLE service_role;
INSERT INTO public.research_runs (id, tenant_id, user_id, question, domain, caller, findings, coverage, stop_reason, configured)
VALUES ('d7400000-3333-4333-8444-555555555555', 'd7400000-0000-4000-8000-000000000111',
        'd7400000-0000-4000-8000-000000000001', 'grant probe run', 'general', 'chat',
        '[]'::jsonb, '{"stop_reason":"answered","configured":true}'::jsonb, 'answered', true);

-- ── C: the engine's sources insert shape is allowed (same lineage as the parent run) ────
INSERT INTO public.research_sources (run_id, tenant_id, user_id, source_index, url, title, snippet, reliability_score, tier, reliability, published_at, excluded)
VALUES ('d7400000-3333-4333-8444-555555555555', 'd7400000-0000-4000-8000-000000000111',
        'd7400000-0000-4000-8000-000000000001', 1, 'https://tests.invalid/source', 'Grant probe source',
        'snippet', 0.5, 'primary', 'high', now(), false);

-- ── I/J at the constraint layer, as the writer role: the canonical constraints still bite ──
SELECT throws_ok(
  $$INSERT INTO public.research_runs (id, user_id, question) VALUES ('d7400000-4444-4333-8444-555555555555', 'd7400000-0000-4000-8000-000000000001', 'no tenant')$$,
  '23502',
  'I: tenant_id remains NOT NULL — no lineage-less run can ever persist');
SELECT throws_ok(
  $$INSERT INTO public.research_sources (run_id, tenant_id, user_id, source_index, url, reliability_score)
      VALUES ('d7400000-5555-4333-8444-555555555555', 'd7400000-0000-4000-8000-000000000111', 'd7400000-0000-4000-8000-000000000001', 1, 'https://tests.invalid/x', 0.5)$$,
  '23503',
  'J: a source cannot attach to a phantom run (run_id FK) — sources exist only under their parent run');
SELECT throws_ok(
  $$INSERT INTO public.research_runs (id, tenant_id, user_id, question) VALUES ('d7400000-6666-4333-8444-555555555555', 'd7500000-0000-4000-8000-000000000111', 'd7400000-0000-4000-8000-000000000001', 'foreign tenant')$$,
  '23503',
  'J: tenant_id FK still pins every run to a real tenant (the forged-tenant insert refused)');
RESET ROLE;

-- readbacks as postgres (service_role holds no SELECT by design):
SELECT is((SELECT count(*) FROM public.research_runs WHERE id = 'd7400000-3333-4333-8444-555555555555'), 1::bigint,
  'B: service_role INSERT research_runs allowed (the exact persistRun shape)');
SELECT is((SELECT count(*) FROM public.research_sources WHERE run_id = 'd7400000-3333-4333-8444-555555555555'), 1::bigint,
  'C: service_role INSERT research_sources allowed (sources inherit the parent run lineage VERBATIM)');
SELECT is((SELECT tenant_id FROM public.research_sources WHERE run_id = 'd7400000-3333-4333-8444-555555555555'),
  'd7400000-0000-4000-8000-000000000111'::uuid,
  'C: the persisted source carries the SAME tenant as its parent run (engine supplies one lineage for both)');

-- ── D/E/F: the browser roles keep ZERO base-table write/read privilege ──────────────────
SELECT has_table_privilege_is('authenticated', 'public.research_runs', 'INSERT', false,
  'D: authenticated INSERT research_runs still refused');
SELECT has_table_privilege_is('authenticated', 'public.research_sources', 'INSERT', false,
  'E: authenticated INSERT research_sources still refused');
SELECT has_table_privilege_is('anon', 'public.research_runs', 'SELECT', false,
  'F: anon READ research_runs still refused');
SELECT has_table_privilege_is('anon', 'public.research_runs', 'INSERT', false,
  'F: anon WRITE research_runs still refused');
SELECT has_table_privilege_is('anon', 'public.research_sources', 'SELECT', false,
  'F: anon READ research_sources still refused');
SELECT has_table_privilege_is('anon', 'public.research_sources', 'INSERT', false,
  'F: anon WRITE research_sources still refused');

-- ── Minimality: service_role gains INSERT ONLY — no SELECT/UPDATE/DELETE convenience ────
SELECT has_table_privilege_is('service_role', 'public.research_runs', 'INSERT', true,
  'minimality: service_role holds exactly INSERT on research_runs');
SELECT has_table_privilege_is('service_role', 'public.research_runs', 'SELECT', false,
  'minimality: service_role does NOT hold SELECT on research_runs (reads go through the governed RPCs)');
SELECT has_table_privilege_is('service_role', 'public.research_runs', 'UPDATE', false,
  'minimality: service_role does NOT hold UPDATE on research_runs');
SELECT has_table_privilege_is('service_role', 'public.research_runs', 'DELETE', false,
  'minimality: service_role does NOT hold DELETE on research_runs');
SELECT has_table_privilege_is('service_role', 'public.research_sources', 'INSERT', true,
  'minimality: service_role holds exactly INSERT on research_sources');
SELECT has_table_privilege_is('service_role', 'public.research_sources', 'SELECT', false,
  'minimality: service_role does NOT hold SELECT on research_sources');
SELECT has_table_privilege_is('service_role', 'public.research_sources', 'UPDATE', false,
  'minimality: service_role does NOT hold UPDATE on research_sources');
SELECT has_table_privilege_is('service_role', 'public.research_sources', 'DELETE', false,
  'minimality: service_role does NOT hold DELETE on research_sources');
SELECT has_table_privilege_is('authenticated', 'public.research_runs', 'SELECT', false,
  'D: authenticated holds NO base-table read on research_runs (reads are the governed RPCs')');
SELECT has_table_privilege_is('authenticated', 'public.research_sources', 'SELECT', false,
  'E: authenticated holds NO base-table read on research_sources');

-- ── G: the governed read RPCs remain exactly as M0 left them ────────────────────────────
SELECT ok(has_function_privilege('authenticated','public.list_workspace_research(integer,integer)','EXECUTE'),
  'G: authenticated still executes list_workspace_research');
SELECT ok(has_function_privilege('authenticated','public.get_workspace_research_run(uuid)','EXECUTE'),
  'G: authenticated still executes get_workspace_research_run');
SELECT ok(NOT has_function_privilege('anon','public.get_workspace_research_run(uuid)','EXECUTE'),
  'G: anon still cannot execute the governed get');
SELECT ok(NOT has_function_privilege('anon','public.list_workspace_research(integer,integer)','EXECUTE'),
  'G: anon still cannot execute the governed list');

-- ── H: the M0 policy set is unchanged (the same eight, no new, no dropped) ───────────────
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('research_runs','research_sources')), 8,
  'H: RLS policy count unchanged (the M0 eight)');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='research_runs'), 4,
  'H: research_runs keeps its four policies');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='research_sources'), 4,
  'H: research_sources keeps its four policies');

SELECT * FROM finish();
ROLLBACK;
