-- ISOLATED PostgreSQL boundary proof for public.match_paige_memory (§53/§59, R3a).
-- Never run against a production database. Self-contained: it reproduces a MINIMAL, faithful
-- schema (roles, auth.uid()/auth.role() JWT shims, the tables the function reads, and faithful
-- is_platform_operator / is_tenant_admin / can_access_contact helpers), applies the REAL migration
-- with \ir (twice — proving replay/idempotence), then drives every authorization boundary the
-- owner enumerated: legitimate service-role retrieval, self, authorized same-tenant owner/admin,
-- authorized coach, operator, cross-tenant denial, forged target combinations, global-admin
-- ambiguity, per-branch data gating, malformed/negative threshold, no-identity refusal, retry
-- idempotence, no leaked content/metadata on refusal, and the anon-revoked grant.
--
-- The helpers are faithful reproductions (not the shipped code) so the proof exercises how
-- match_paige_memory COMPOSES them; the helpers themselves are proven in their own migrations.
-- agency_can_manage_child is stubbed false (no agency in these fixtures) and that path is not
-- under test here.
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'paige_memory_authz_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated paige_memory_authz_contract database';
  END IF;
END $$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── auth JWT shims: identity is driven by request.jwt.claims (set_config per case). ──
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::json->>'role'
$$;

-- ── Minimal fixture tables (only the columns the function + can_access_contact read). ──
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE public.tenants (id uuid PRIMARY KEY);
CREATE TABLE public.tenant_members (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  lead_owner_user_id uuid,
  cs_primary_user_id uuid,
  assigned_coach_user_id uuid,
  linked_user_id uuid
);
CREATE TABLE public.coach_clients (
  coach_user_id uuid NOT NULL, client_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.paige_coach_assignments (
  contact_id uuid NOT NULL, rep_user_id uuid NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.client_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid NOT NULL,
  client_id uuid,
  memory_type text NOT NULL,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  embedding extensions.vector(3),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.chat_message_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_user_id uuid,
  role text NOT NULL,
  content_excerpt text NOT NULL,
  embedding extensions.vector(3),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Faithful helper reproductions (see header). ──
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'platform_admin')
$$;
CREATE OR REPLACE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_super_admin(auth.uid()) OR public.is_platform_admin(auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant AND user_id = auth.uid() AND status = 'active' AND role IN ('owner','admin')
  )
$$;
-- No agency in these fixtures; the agency reach of can_access_contact is proven in its own migration.
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid, _actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT false
$$;
CREATE OR REPLACE FUNCTION public.can_access_contact(_user_id uuid, _contact_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _contact_id
        AND (
          public.agency_can_manage_child(c.tenant_id, _user_id)
          OR EXISTS (SELECT 1 FROM public.tenant_members tm
                       WHERE tm.tenant_id = c.tenant_id AND tm.user_id = _user_id
                         AND tm.status = 'active' AND tm.role IN ('owner','admin'))
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _contact_id
        AND (c.lead_owner_user_id = _user_id OR c.cs_primary_user_id = _user_id
             OR c.assigned_coach_user_id = _user_id OR c.linked_user_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.paige_coach_assignments a
      WHERE a.contact_id = _contact_id AND a.active = true AND a.rep_user_id = _user_id
    )
$$;

-- ── The function under test: apply the REAL migration TWICE (replay / idempotence). ──
\ir ../migrations/20270304000000_match_paige_memory_resource_scoped_authz.sql
\ir ../migrations/20270304000000_match_paige_memory_resource_scoped_authz.sql

-- ── Denial assertion helper: the call must raise EXACTLY 'Unauthorized' (no data-bearing text). ──
CREATE OR REPLACE FUNCTION public._assert_denied(
  _q extensions.vector, _tu uuid, _tc uuid, _th double precision, _mc int, _sc int, _label text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _raised boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.match_paige_memory(_q, _tu, _tc, _th, _mc, _sc);
  EXCEPTION WHEN OTHERS THEN
    _raised := true;
    IF SQLERRM <> 'Unauthorized' THEN
      RAISE EXCEPTION '% : refusal was wrong or data-bearing: %', _label, SQLERRM;
    END IF;
  END;
  IF NOT _raised THEN
    RAISE EXCEPTION '% : expected Unauthorized, none raised', _label;
  END IF;
END $$;

-- ── Fixtures: two tenants, their people, their memory. ──
INSERT INTO public.tenants(id) VALUES
  ('00000000-0000-4000-8000-0000000000a0'), ('00000000-0000-4000-8000-0000000000b0');
INSERT INTO public.user_roles(user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000dead','admin'),        -- attacker: GLOBAL admin, no tenant/operator authority
  ('00000000-0000-4000-8000-00000000a001','admin'),        -- ownerA: also global admin (realistic sync) — still not operator
  ('00000000-0000-4000-8000-000000005a5a','super_admin'),  -- operator (super_admin)
  ('00000000-0000-4000-8000-0000000000ad','platform_admin');-- operator (delegated platform_admin) [C15/N2]
INSERT INTO public.tenant_members(tenant_id, user_id, role, status) VALUES
  ('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-00000000a001','owner','active'),
  ('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-00000000a0c1','member','active'),
  ('00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-00000000b001','owner','active'),
  ('00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-00000000b0c1','member','active'),
  -- V is a MULTI-TENANT subject: an active member of tenant A, but with memory that belongs to tenant B.
  ('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-00000000d00d','member','active');
INSERT INTO public.clients(id, tenant_id, assigned_coach_user_id, linked_user_id) VALUES
  ('00000000-0000-4000-8000-0000000000ca','00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-00000000a0ca','00000000-0000-4000-8000-00000000a0c1'), -- contactA: assigned coach = coachA [C6]
  ('00000000-0000-4000-8000-0000000000cb','00000000-0000-4000-8000-0000000000b0',NULL,'00000000-0000-4000-8000-00000000b0c1'),
  ('00000000-0000-4000-8000-0000000000cd','00000000-0000-4000-8000-0000000000b0',NULL,'00000000-0000-4000-8000-00000000d00d'); -- V's contact, in tenant B [C14/Finding 1]
INSERT INTO public.coach_clients(coach_user_id, client_user_id, status) VALUES
  ('00000000-0000-4000-8000-00000000a0ca','00000000-0000-4000-8000-00000000a0c1','active');
INSERT INTO public.client_memory(client_user_id, client_id, memory_type, content, is_active, embedding) VALUES
  ('00000000-0000-4000-8000-00000000a0c1','00000000-0000-4000-8000-0000000000ca','session_summary','A-mem-secret',true,'[1,0,0]'),
  ('00000000-0000-4000-8000-00000000b0c1','00000000-0000-4000-8000-0000000000cb','session_summary','B-mem-secret',true,'[1,0,0]'),
  -- V is a member of tenant A, but this memory row belongs to tenant B (client_id=cd → tenant B). A
  -- tenant-A admin must NOT reach it via the user branch (Finding 1). [C14]
  ('00000000-0000-4000-8000-00000000d00d','00000000-0000-4000-8000-0000000000cd','session_summary','V-tenantB-secret',true,'[1,0,0]'),
  -- Opposite embedding: similarity to the query is -1, so it is returned ONLY if the threshold is left
  -- below 0 (i.e. the clamp is missing). Discriminates the threshold clamp. [C11]
  ('00000000-0000-4000-8000-00000000a0c1',NULL,'session_summary','A-opposite-secret',true,'[-1,0,0]');
INSERT INTO public.chat_message_embeddings(message_id, user_id, client_user_id, role, content_excerpt, embedding) VALUES
  (gen_random_uuid(),'00000000-0000-4000-8000-00000000a0c1',NULL,'user','A-chat-secret','[1,0,0]'),
  (gen_random_uuid(),'00000000-0000-4000-8000-00000000b0c1',NULL,'user','B-chat-secret','[1,0,0]');
-- Count-clamp subject W: 60 same-similarity rows, so the [0,50] LIMIT clamp is observable. [C16]
INSERT INTO public.client_memory(client_user_id, memory_type, content, is_active, embedding)
  SELECT '00000000-0000-4000-8000-0000000000e0','session_summary','W-mem-'||g,true,'[1,0,0]'
  FROM generate_series(1,60) g;

-- ── The boundary matrix. Every assertion RAISEs on failure; a final sentinel prints on success. ──
DO $$
DECLARE
  q       extensions.vector := '[1,0,0]'::extensions.vector;
  A_user   uuid := '00000000-0000-4000-8000-00000000a0c1';
  B_user   uuid := '00000000-0000-4000-8000-00000000b0c1';
  ownerA   uuid := '00000000-0000-4000-8000-00000000a001';
  coachA   uuid := '00000000-0000-4000-8000-00000000a0ca';
  attacker uuid := '00000000-0000-4000-8000-00000000dead';
  super    uuid := '00000000-0000-4000-8000-000000005a5a';
  padmin   uuid := '00000000-0000-4000-8000-0000000000ad';
  V        uuid := '00000000-0000-4000-8000-00000000d00d';
  W        uuid := '00000000-0000-4000-8000-0000000000e0';
  cA uuid := '00000000-0000-4000-8000-0000000000ca';
  cB uuid := '00000000-0000-4000-8000-0000000000cb';
  n int; leaked int;
BEGIN
  -- C1 service_role: legitimate retrieval works and is scoped to the passed target.
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, A_user, cA, 0.7, 5, 5);
  IF n <> 2 THEN RAISE EXCEPTION 'C1 service legitimate retrieval: expected 2 rows, got %', n; END IF;
  SELECT count(*) INTO leaked FROM public.match_paige_memory(q, A_user, cA, 0.7, 5, 5) WHERE content LIKE 'B-%' OR content LIKE 'V-%';
  IF leaked <> 0 THEN RAISE EXCEPTION 'C1 service leaked cross-tenant content'; END IF;

  -- C2 self sees own memory + own chat only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',A_user,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, A_user, NULL, 0.7, 5, 5);
  IF n <> 2 THEN RAISE EXCEPTION 'C2 self: expected 2 rows, got %', n; END IF;

  -- C2-retry: calling again returns the same (retry idempotence).
  SELECT count(*) INTO n FROM public.match_paige_memory(q, A_user, NULL, 0.7, 5, 5);
  IF n <> 2 THEN RAISE EXCEPTION 'C2-retry: expected 2 rows, got %', n; END IF;

  -- C3 self cannot read another user's memory.
  PERFORM public._assert_denied(q, B_user, cB, 0.7, 5, 5, 'C3 self-cross');

  -- C4 FORGED-ID: self via caller-supplied _target_client_id, victim as _target_user_id, with a
  -- negative threshold + huge counts. Must refuse — the structural bypass is closed.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',attacker,'role','authenticated')::text, false);
  PERFORM public._assert_denied(q, B_user, attacker, -1, 100000, 100000, 'C4 forged-id');

  -- C5 GLOBAL-ADMIN ambiguity: a global 'admin' with no tenant/operator authority over B is refused.
  PERFORM public._assert_denied(q, B_user, cB, 0.7, 5, 5, 'C5 global-admin');

  -- C6 authorized staff reads a specific client's memory through the CLIENT branch (can_access_contact
  -- honors coachA as contactA's assigned coach). The user branch is gated off (coachA is not self/op).
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coachA,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, A_user, cA, 0.7, 5, 5);
  IF n <> 1 THEN RAISE EXCEPTION 'C6 authorized-contact (assigned coach): expected 1 row, got %', n; END IF;

  -- C7 same-tenant owner/admin reads a client's memory in their own tenant via the CLIENT branch.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ownerA,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, A_user, cA, 0.7, 5, 5);
  IF n <> 1 THEN RAISE EXCEPTION 'C7 same-tenant admin (contact branch): expected 1 row, got %', n; END IF;

  -- C8 cross-tenant denial: owner of A cannot read tenant B (neither user nor contact branch admits).
  PERFORM public._assert_denied(q, B_user, cB, 0.7, 5, 5, 'C8 cross-tenant');

  -- C9 PER-BRANCH GATING: ownerA is authorized for contact A; passing victim B as _target_user_id
  -- with contact A as _target_client_id must return ONLY A's rows, never B's.
  SELECT count(*) INTO n FROM public.match_paige_memory(q, B_user, cA, 0.7, 5, 5);
  IF n <> 1 THEN RAISE EXCEPTION 'C9 per-branch gating: expected 1 (A only) row, got %', n; END IF;
  SELECT count(*) INTO leaked FROM public.match_paige_memory(q, B_user, cA, 0.7, 5, 5) WHERE content LIKE 'B-%';
  IF leaked <> 0 THEN RAISE EXCEPTION 'C9 per-branch gating LEAKED B content via _target_user_id'; END IF;

  -- C10 operator (super_admin) may read cross-tenant (legitimate operator work, §53).
  PERFORM set_config('request.jwt.claims', json_build_object('sub',super,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, B_user, cB, 0.7, 5, 5);
  IF n <> 2 THEN RAISE EXCEPTION 'C10 operator: expected 2 rows, got %', n; END IF;

  -- C11 threshold clamp + gating: self with threshold=-1 gets only A's above-clamp rows. The clamp
  -- forces the floor to 0, so the opposite-embedding row (similarity -1) is EXCLUDED — if the clamp
  -- were missing, threshold=-1 would admit it. This assertion fails if the clamp is removed.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',A_user,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, A_user, NULL, -1, 100000, 100000);
  IF n <> 2 THEN RAISE EXCEPTION 'C11 threshold-clamp self: expected 2 rows (opposite excluded), got %', n; END IF;
  SELECT count(*) INTO leaked FROM public.match_paige_memory(q, A_user, NULL, -1, 100000, 100000)
   WHERE content LIKE 'B-%' OR content LIKE 'A-opposite%';
  IF leaked <> 0 THEN RAISE EXCEPTION 'C11 threshold clamp missing / cross-tenant leak (opposite or B row returned)'; END IF;

  -- C14 FINDING-1 REGRESSION (multi-tenant subject): V is an active member of tenant A but the memory
  -- row belongs to tenant B. A tenant-A admin passing V's user id must be REFUSED — the old per-user
  -- is_tenant_admin branch would have returned V's tenant-B memory. Cross-tenant read is closed.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ownerA,'role','authenticated')::text, false);
  PERFORM public._assert_denied(q, V, NULL, 0.7, 5, 5, 'C14 multi-tenant subject via user branch');

  -- C15 delegated operator (platform_admin) may read cross-tenant, like super_admin (§53).
  PERFORM set_config('request.jwt.claims', json_build_object('sub',padmin,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, B_user, cB, 0.7, 5, 5);
  IF n <> 2 THEN RAISE EXCEPTION 'C15 platform_admin operator: expected 2 rows, got %', n; END IF;

  -- C16 COUNT CLAMP: W has 60 same-similarity rows; a service call asking for 100000 must return the
  -- clamped 50, not 60. This assertion fails if the [0,50] count clamp is removed.
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',false);
  SELECT count(*) INTO n FROM public.match_paige_memory(q, W, NULL, 0.7, 100000, 100000);
  IF n <> 50 THEN RAISE EXCEPTION 'C16 count clamp: expected 50 (clamped from 60), got %', n; END IF;

  -- C12 no identity and not service_role: refused.
  PERFORM set_config('request.jwt.claims','{}',false);
  PERFORM public._assert_denied(q, A_user, cA, 0.7, 5, 5, 'C12 no-identity');
END $$;

-- C13 grant hygiene: anon can never execute; the two real callers can (§59 lint intent).
DO $$ BEGIN
  IF has_function_privilege('anon',
       'public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer)','EXECUTE') THEN
    RAISE EXCEPTION 'C13 grant: anon can execute match_paige_memory';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer)','EXECUTE') THEN
    RAISE EXCEPTION 'C13 grant: authenticated cannot execute match_paige_memory';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer)','EXECUTE') THEN
    RAISE EXCEPTION 'C13 grant: service_role cannot execute match_paige_memory';
  END IF;
END $$;

SELECT 'PASS: match_paige_memory resource-scoped authz — forged-id closed, global-admin trap closed, per-branch gating, threshold+count clamps demonstrated, cross-USER limited to self/operator, staff cross-CONTACT via can_access_contact, multi-tenant-subject user-branch denied (Finding 1), super_admin + platform_admin operator reads, cross-tenant denied, no leaked content on refusal, replay-idempotent, anon-revoked' AS result;
