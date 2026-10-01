-- team.authority contract: the grant surface, the JWT-only caller path, the active-seat gate,
-- the always-two-rows honesty invariant, and — the reason this file exists rather than a local
-- proof — that the two facts stay SEPARATE and each comes from its own canonical source.
-- Synthetic fixtures; always rolled back.
--
-- The load-bearing fixture is `bcr-split`: a user who is the legal OWNER of workspace B while
-- holding a plain MEMBER seat in workspace A, which is their ACTIVE workspace. That one row is what
-- makes two otherwise-invisible regressions loud:
--
--   1. is_tenant_owner(uid) instead of is_tenant_owner(uid, tenant). The second parameter defaults
--      to NULL and the body then means "owner of ANY workspace". Measured against this fixture on
--      production 2026-09-03: the correct form returns false, the one-argument form returns TRUE.
--      Five real workspaces would report a non-owner as owner today.
--   2. Collapsing permission and ownership the way get_paige_team_context() does
--      (is_owner OR role = 'owner'). Under this fixture the caller's role is 'member' and their
--      ownership is false, so a collapse cannot hide behind them agreeing — which they do for all
--      13 real members on production, and which is exactly why a proof built only on real-shaped
--      data would pass while the defect shipped.
BEGIN;

SELECT plan(19);

-- ── Grant surface (§59 — the grant is never the guard, but it is still the outer boundary) ──
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_team_authority_readiness()', 'EXECUTE'),
  'anonymous callers cannot execute the team authority contract'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_team_authority_readiness()', 'EXECUTE'),
  'authenticated callers can reach the team authority contract'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.get_team_authority_readiness()', 'EXECUTE'),
  'service_role is REFUSED: both facts describe the caller, and a service caller is nobody — '
  'so the path that would need an unvalidated tenant argument is never opened at all'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_team_authority_readiness()'::regprocedure),
  'contract is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
     FROM pg_proc WHERE oid = 'public.get_team_authority_readiness()'::regprocedure),
  'contract pins its search path, pg_temp included'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_proc
    WHERE oid = 'public.get_team_authority_readiness()'::regprocedure
      AND pronargs = 0),
  1,
  'the contract takes NO arguments — there is no tenant a caller could steer (§9/§588)'
);

-- ── Fixtures ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ta-owner-a@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ta-member-a@tests.invalid'),
  ('d1000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'ta-split@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features, brand)
VALUES
  ('d1000000-0000-0000-0000-00000000aaaa', 'ta-workspace-a', 'TA Workspace A', 'active', 'standalone', 'TWA', 8700001, '{}'::jsonb, '{}'::jsonb),
  ('d1000000-0000-0000-0000-00000000bbbb', 'ta-workspace-b', 'TA Workspace B', 'active', 'standalone', 'TWB', 8700002, '{}'::jsonb, '{}'::jsonb);

-- Seats BEFORE the active-tenant pointer: `trg_guard_active_tenant` refuses an active_tenant_id
-- pointed at a workspace where the user holds no seat (lessons-learned 0d).
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('d1000000-0000-0000-0000-00000000aaaa', 'd1000000-0000-0000-0000-000000000001', 'owner',  'active', true,  now()),
  ('d1000000-0000-0000-0000-00000000aaaa', 'd1000000-0000-0000-0000-000000000002', 'member', 'active', false, now()),
  -- THE SPLIT: legal owner of B, plain member of A.
  ('d1000000-0000-0000-0000-00000000bbbb', 'd1000000-0000-0000-0000-000000000009', 'owner',  'active', true,  now()),
  ('d1000000-0000-0000-0000-00000000aaaa', 'd1000000-0000-0000-0000-000000000009', 'member', 'active', false, now());

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000aaaa'),
  ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000aaaa'),
  -- ...and A is where they are ACTIVE, so "owner of any workspace" and "owner here" disagree.
  ('d1000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-00000000aaaa')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- A GLOBAL staff role on the plain member. `user_roles` carries no tenant_id, so a gate written
-- against has_any_role() would ADMIT this caller as staff of a workspace where they are a member.
-- Without this row the member assertions below would pass for the wrong reason (§59 global-role trap).
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d1000000-0000-0000-0000-000000000002', 'sales_rep'),
  ('d1000000-0000-0000-0000-000000000009', 'admin')
ON CONFLICT DO NOTHING;

-- ── The workspace's own owner ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

CREATE TEMP TABLE ta_owner AS SELECT * FROM public.get_team_authority_readiness();

SELECT is((SELECT count(*)::integer FROM ta_owner), 2, 'exactly two rows, always — no signal is never an empty result');
SELECT is((SELECT value FROM ta_owner WHERE fact_key = 'viewer_permission'), 'owner', 'the owner reads their real role');
SELECT is((SELECT value FROM ta_owner WHERE fact_key = 'viewer_is_legal_owner'), 'true', 'and their real ownership');
SELECT ok(
  (SELECT bool_and(status = 'available' AND source = 'team') FROM ta_owner),
  'both facts name their source system, so PAIGE can never present one domain''s fact as another''s'
);

SELECT is(
  (SELECT count(distinct tenant_id)::integer FROM ta_owner), 1,
  'every row names ONE workspace — the one the read resolved'
);
SELECT is(
  (SELECT distinct tenant_id FROM ta_owner), 'd1000000-0000-0000-0000-00000000aaaa'::uuid,
  'and it is the caller''s ACTIVE workspace, which is what a Chat caller binds against: '
  'get_paige_persona_context() resolves a linked client''s workspace ahead of '
  'current_user_tenant_id(), so the two can differ and an unbound block would speak about the wrong one'
);

-- ── THE SPLIT CALLER: owner of B, member of A, active in A ──────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000009","role":"authenticated"}', true);

CREATE TEMP TABLE ta_split AS SELECT * FROM public.get_team_authority_readiness();

SELECT is(
  (SELECT value FROM ta_split WHERE fact_key = 'viewer_is_legal_owner'),
  'false',
  'ownership is scoped to the RESOLVED workspace: a legal owner of another workspace is NOT an '
  'owner here. Dropping the tenant argument from is_tenant_owner() turns this row TRUE — measured '
  'on production, correct=false vs one-argument=true for exactly this shape'
);
SELECT is(
  (SELECT value FROM ta_split WHERE fact_key = 'viewer_permission'),
  'member',
  'and their permission here is the RAW seat role, not the collapsed is_owner-OR-role field that '
  'get_paige_team_context() computes — which would read "owner" for anyone whose role says so'
);
SELECT ok(
  (SELECT (SELECT value FROM ta_split WHERE fact_key = 'viewer_permission')
       IS DISTINCT FROM (SELECT value FROM ta_split WHERE fact_key = 'viewer_is_legal_owner')),
  'permission and ownership are genuinely two answers here — the fixture that makes a collapse visible'
);

-- ── A plain member holding a GLOBAL staff role is still just a member ───────────
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  (SELECT value FROM public.get_team_authority_readiness() WHERE fact_key = 'viewer_is_legal_owner'),
  'false',
  'a global staff role confers no ownership of this workspace (§59 global-role trap)'
);

-- ── No identity at all ──────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '', true);

CREATE TEMP TABLE ta_anon AS SELECT * FROM public.get_team_authority_readiness();

SELECT is((SELECT count(*)::integer FROM ta_anon), 2, 'a caller with no identity still receives two rows, not an empty set');
SELECT ok(
  (SELECT bool_and(status = 'unavailable' AND value IS NULL AND source IS NULL AND reason IS NOT NULL) FROM ta_anon),
  'and learns nothing: no value, no provenance, but a named reason so "could not" is distinguishable from "none"'
);

SELECT ok(
  (SELECT bool_and(tenant_id IS NULL) FROM ta_anon),
  'a caller with no identity resolved no workspace, so the rows name none — unbindable by '
  'construction, which is what makes the adapter suppress them rather than narrate them'
);

SELECT * FROM finish();
ROLLBACK;
