-- M0 — RESEARCH TENANT LINEAGE (owner ruling 2026-10-03, with the lineage corrections).
-- Synthetic tenant fixtures only; always rolled back. Proves the ruling's matrix A–J where
-- each proof is CI-checkable; the engine-side lineage logic (no first-membership fallback for
-- persistence, the expected_tenant_id cross-check, sources inherit) is pinned by
-- src/__tests__/deep-research-m0-contract.test.ts against the real source.
BEGIN;
SELECT plan(28);

-- ── Fixtures: Tenant A (Owner A, Owner A2, Admin A, Member A) + Tenant B (Owner B, Member B)
-- + a dual-member user (active in B, also a member of A) ─────────────────────────────────
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('d7100000-0000-4000-8000-000000000001','authenticated','authenticated','res-owner-a@tests.invalid'),
 ('d7100000-0000-4000-8000-000000000002','authenticated','authenticated','res-owner-a2@tests.invalid'),
 ('d7100000-0000-4000-8000-000000000003','authenticated','authenticated','res-admin-a@tests.invalid'),
 ('d7100000-0000-4000-8000-000000000004','authenticated','authenticated','res-member-a@tests.invalid'),
 ('d7200000-0000-4000-8000-000000000001','authenticated','authenticated','res-owner-b@tests.invalid'),
 ('d7200000-0000-4000-8000-000000000002','authenticated','authenticated','res-member-b@tests.invalid'),
 ('d7300000-0000-4000-8000-000000000001','authenticated','authenticated','res-dual@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('d7100000-0000-4000-8000-00000000001111','res-tenant-a','Research Tenant A','active','standalone','RTA',8810001,'{}'),
 ('d7200000-0000-4000-8000-00000000002222','res-tenant-b','Research Tenant B','active','standalone','RTB',8820002,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('d7100000-0000-4000-8000-00000000001111','d7100000-0000-4000-8000-000000000001','owner','active',true, now() - interval '30 days'),
 ('d7100000-0000-4000-8000-00000000001111','d7100000-0000-4000-8000-000000000002','owner','active',false,now() - interval '29 days'),
 ('d7100000-0000-4000-8000-00000000001111','d7100000-0000-4000-8000-000000000003','admin','active',false,now() - interval '28 days'),
 ('d7100000-0000-4000-8000-00000000001111','d7100000-0000-4000-8000-000000000004','member','active',false,now() - interval '27 days'),
 ('d7200000-0000-4000-8000-00000000002222','d7200000-0000-4000-8000-000000000001','owner','active',true, now() - interval '26 days'),
 ('d7200000-0000-4000-8000-00000000002222','d7200000-0000-4000-8000-000000000002','member','active',false,now() - interval '25 days'),
 ('d7100000-0000-4000-8000-00000000001111','d7300000-0000-4000-8000-000000000001','member','active',false,now() - interval '24 days'),
 ('d7200000-0000-4000-8000-00000000002222','d7300000-0000-4000-8000-000000000001','member','active',false,now() - interval '23 days');
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-00000000001111'),
 ('d7100000-0000-4000-8000-000000000002','d7100000-0000-4000-8000-00000000001111'),
 ('d7100000-0000-4000-8000-000000000003','d7100000-0000-4000-8000-00000000001111'),
 ('d7100000-0000-4000-8000-000000000004','d7100000-0000-4000-8000-00000000001111'),
 ('d7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-00000000002222'),
 ('d7200000-0000-4000-8000-000000000002','d7200000-0000-4000-8000-00000000002222'),
 ('d7300000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-00000000002222')
ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;

-- Seeded runs (as table owner — the engine's service-role write shape).
INSERT INTO public.research_runs(id,tenant_id,user_id,question,domain,caller,findings,coverage,stop_reason,configured,created_at) VALUES
 ('d7100000-0000-4000-8000-0000000000r001','d7100000-0000-4000-8000-00000000001111','d7100000-0000-4000-8000-000000000001','A market question','marketing','chat','[]'::jsonb,'{}'::jsonb,'answered',true, now() - interval '2 hours'),
 ('d7200000-0000-4000-8000-0000000000r002','d7200000-0000-4000-8000-00000000002222','d7200000-0000-4000-8000-000000000001','B vendor question','ops','chat','[]'::jsonb,'{}'::jsonb,'answered',true, now() - interval '1 hour');
INSERT INTO public.research_sources(tenant_id,run_id,user_id,source_index,url,title,snippet,reliability_score,tier,reliability,published_at,fetched_at,excluded) VALUES
 ('d7100000-0000-4000-8000-00000000001111','d7100000-0000-4000-8000-0000000000r001','d7100000-0000-4000-8000-000000000001',0,'https://a.example.com/src','Source A','snip',0.9,'T1','high',now(),now(),false),
 ('d7200000-0000-4000-8000-00000000002222','d7200000-0000-4000-8000-0000000000r002','d7200000-0000-4000-8000-000000000001',0,'https://b.example.com/src','Source B','snip',0.8,'T2','medium',now(),now(),false);

-- Helper: act as a user (JWT claims simulation — the canonical pattern).
CREATE OR REPLACE FUNCTION pg_temp.act_as(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
  PERFORM set_config('request.jwt.claim.sub', uid, false);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.act_clear() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
END $$;

-- ══ A. tenant A's run persists under tenant A and A's people can read it ══════════════════
SELECT pg_temp.act_as('d7100000-0000-4000-8000-000000000001');
SELECT is(
  (SELECT count(*) FROM public.list_workspace_research(50, 0)),
  1::bigint,
  'A: workspace-A owner lists exactly the tenant-A run'
);
SELECT is(
  (SELECT (json->>'source_count') IS NOT NULL FROM public.get_workspace_research_run('d7100000-0000-4000-8000-0000000000r001') AS json_row(json)),
  true,
  'A: get returns the run (json shape present)'
);

-- Every role inside A sees A's research (canonical semantics inherited, not redesigned).
SELECT pg_temp.act_as('d7100000-0000-4000-8000-000000000002');
SELECT is(
  (SELECT count(*) FROM public.list_workspace_research(50, 0)),
  1::bigint,
  'A: a SECOND owner of A (multiple owners remain valid) sees A''s research'
);
SELECT pg_temp.act_as('d7100000-0000-4000-8000-000000000003');
SELECT is(
  (SELECT count(*) FROM public.list_workspace_research(50, 0)),
  1::bigint,
  'A: tenant-A ADMIN sees A''s research through the canonical read path'
);
SELECT pg_temp.act_as('d7100000-0000-4000-8000-000000000004');
SELECT is(
  (SELECT count(*) FROM public.list_workspace_research(50, 0)),
  1::bigint,
  'A: tenant-A MEMBER sees A''s research (read is workspace-scoped)'
);

-- ══ B/C. Tenant B cannot read tenant A's run — by role at any strength ═══════════════════
SELECT pg_temp.act_as('d7200000-0000-4000-8000-000000000002');
SELECT is(
  (SELECT count(*) FROM public.list_workspace_research(50, 0)),
  1::bigint,
  'B: tenant-B member lists ONLY tenant B''s own run — nothing of tenant A leaks into the list'
);
SELECT is(
  (SELECT id::text FROM public.list_workspace_research(50, 0) LIMIT 1),
  'd7200000-0000-4000-8000-0000000000r002',
  'B: the one row tenant B sees IS B''s run (not A''s)'
);
SELECT is(
  (SELECT public.get_workspace_research_run('d7100000-0000-4000-8000-0000000000r001') IS NULL),
  true,
  'B: tenant-B member gets uniform NULL for tenant A''s run (unknown ≡ foreign)'
);
-- A tenant-B admin-equivalent: make B's member an admin, then retry (same shape, stronger role).
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('d7200000-0000-4000-8000-00000000002222','d7200000-0000-4000-8000-000000000002','admin','active',false,now());
SELECT is(
  (SELECT public.get_workspace_research_run('d7100000-0000-4000-8000-0000000000r001') IS NULL),
  true,
  'C: tenant-B ADMIN still gets NULL for tenant A''s run — the same role in another tenant grants nothing'
);

-- ══ D/E. The dual-member user's scope follows the ACTIVE workspace ═══════════════════════
SELECT pg_temp.act_as('d7300000-0000-4000-8000-000000000001');
SELECT is(
  (SELECT (j->>'id') FROM public.get_workspace_research_run('d7200000-0000-4000-8000-0000000000r002') AS x(j)),
  'd7200000-0000-4000-8000-0000000000r002',
  'D: the dual member (active=B) reads B''s run'
);
SELECT is(
  (SELECT public.get_workspace_research_run('d7100000-0000-4000-8000-0000000000r001') IS NULL),
  true,
  'D: the same person CANNOT read A''s run while operating workspace B'
);
-- Switch the active workspace: the scope follows WITHOUT any membership change.
UPDATE public.profiles SET active_tenant_id='d7100000-0000-4000-8000-00000000001111' WHERE user_id='d7300000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT (j->>'id') FROM public.get_workspace_research_run('d7100000-0000-4000-8000-0000000000r001') AS x(j)),
  'd7100000-0000-4000-8000-0000000000r001',
  'E: after switching the active workspace to A, the same person now reads A''s run'
);
SELECT is(
  (SELECT public.get_workspace_research_run('d7200000-0000-4000-8000-0000000000r002') IS NULL),
  true,
  'E: ...and no longer reads B''s run — workspace switch switches scope, not memberships'
);
UPDATE public.profiles SET active_tenant_id='d7200000-0000-4000-8000-00000000002222' WHERE user_id='d7300000-0000-4000-8000-000000000001';

-- ══ H. Caller-supplied tenant ids cannot widen the read ══════════════════════════════════
-- The RPCs take NO tenant parameter; the negative control is structural (signature) plus the
-- B/C behavior above. Assert the signatures carry no tenant argument:
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('list_workspace_research','get_workspace_research_run')
      AND pg_get_function_identity_arguments(p.oid) ~* 'tenant'),
  0::bigint,
  'H: neither read RPC accepts a tenant parameter — scope is never caller-supplied'
);

-- ══ G/J. Fail-closed constraints: no lineage, no persistence ══════════════════════════════
SELECT throws_ok(
  'INSERT INTO public.research_runs(id,user_id,question,domain,caller,findings,coverage,stop_reason,configured) VALUES (''d7100000-0000-4000-8000-0000000000r003'',''d7100000-0000-4000-8000-000000000001'',''X'',''general'',''chat'',''[]'',''{}'',''answered'',true)',
  NULL,
  'G: an insert WITHOUT tenant lineage is refused (NOT NULL fail-closed — the old engine shape cannot persist a guessed-ownership run)'
);
SELECT lives_ok(
  'INSERT INTO public.research_sources(tenant_id,run_id,user_id,source_index,url,title,snippet,reliability_score,tier,reliability,published_at,fetched_at,excluded) VALUES (''d7100000-0000-4000-8000-00000000001111'',''d7100000-0000-4000-8000-0000000000r001'',''d7100000-0000-4000-8000-000000000001'',1,''https://a.example.com/s2'',''S2'',''s'',0.5,''T3'',''low'',now(),now(),false)',
  'E: a source insert WITH the parent run''s inherited lineage succeeds (the control for the refusal below)'
);
SELECT throws_ok(
  'INSERT INTO public.research_sources(run_id,user_id,source_index,url,title,snippet,reliability_score,tier,reliability,published_at,fetched_at,excluded) VALUES (''d7100000-0000-4000-8000-0000000000r001'',''d7100000-0000-4000-8000-000000000001'',2,''https://a.example.com/s3'',''S3'',''s'',0.5,''T3'',''low'',now(),now(),false)',
  NULL,
  'G: a source insert WITHOUT tenant_id is refused — sources cannot outlive their lineage'
);

-- ══ J. Zero-row truthfulness: nothing was backfilled ══════════════════════════════════════
-- (The migration adds columns only; these fixtures are this test's own. Asserted as a shape:
-- the lineage columns exist and are NOT NULL with canonical FKs.)
SELECT is(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='research_runs' AND column_name='tenant_id' AND is_nullable='NO'),
  1::bigint,
  'J/M0: research_runs.tenant_id exists NOT NULL (no nullable-by-convenience escape)'
);
SELECT is(
  (SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_type='FOREIGN KEY' AND table_name IN ('research_runs','research_sources')),
  2::bigint,
  'M0: both tables carry canonical tenant FK lineage'
);

-- ══ Legacy policies are GONE; tenant-bound shapes are live ════════════════════════════════
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE tablename IN ('research_runs','research_sources')
      AND qual::text ~* 'has_role\(auth\.uid\(\), ''?admin''?\)' AND qual NOT LIKE '%tenant_id%'),
  0::bigint,
  'M0: no cross-tenant has_role(admin) policy survives on the research tables'
);
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE tablename IN ('research_runs','research_sources')
      AND qual::text ~ 'tenant_id = public.current_user_tenant_id\(\)'),
  4::bigint,
  'M0: tenant-bound policies (member view + owner/admin manage, both tables) are live'
);
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE tablename IN ('research_runs','research_sources') AND policyname LIKE 'Service role%'),
  2::bigint,
  'M0: the service-role write boundary policies are preserved'
);

-- ══ RPC grants: authenticated only ════════════════════════════════════════════════════════
SELECT ok(NOT has_function_privilege('anon','public.list_workspace_research(int,int)','EXECUTE'),
  'anon cannot execute the research list RPC');
SELECT ok(has_function_privilege('authenticated','public.list_workspace_research(int,int)','EXECUTE'),
  'authenticated can execute the research list RPC');
SELECT ok(NOT has_function_privilege('anon','public.get_workspace_research_run(uuid)','EXECUTE'),
  'anon cannot execute the research get RPC');
SELECT ok(NOT has_table_privilege('authenticated','public.research_runs','SELECT'),
  'the base tables remain un-granted to browser callers (the RPC is the only read door)');
SELECT ok(NOT has_table_privilege('authenticated','public.research_sources','SELECT'),
  'research_sources also stays un-granted (no broad base-table exposure)');

-- NEGATIVE CONTROL (ruling section 7): remove the tenant binding and the isolation MUST fail.
-- A binding-less twin of the list RPC (same fixtures, same caller, NO tenant WHERE): tenant
-- B's member now sees tenant A's run -- proving the tenant binding is exactly what the
-- isolation tests above depend on. The guard is load-bearing, not decorative.
CREATE OR REPLACE FUNCTION pg_temp.list_research_unbound() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT r.id FROM public.research_runs r
  ORDER BY r.created_at DESC
$$;
SELECT pg_temp.act_as('d7200000-0000-4000-8000-000000000002');
SELECT is(
  (SELECT count(*) FROM pg_temp.list_research_unbound()),
  2::bigint,
  'NEGATIVE CONTROL: without the tenant binding the same caller sees BOTH tenants'' runs -- the binding above is what makes the isolation real'
);

SELECT pg_temp.act_clear();
SELECT * FROM finish();
ROLLBACK;
