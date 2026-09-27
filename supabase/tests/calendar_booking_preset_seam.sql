-- ============================================================================
-- CALENDAR booking-preset server seam — repeatable §32 CI proof (E6 hardening).
--
-- Converts the one-off local-Postgres transcript at
-- docs/evidence/proofs/booking-preset-lifecycle/ into a PERMANENT, self-contained
-- pgTAP suite that a CI service Postgres runs on every PR touching the seam. It
-- proves the two SHIPPED E3 migrations —
--   20270301000000_calendar_booking_preset_lifecycle.sql        (Draft→Publish→Pause)
--   20270302000000_calendar_preset_duplicate_archive_restore.sql (Duplicate·Archive·Restore)
-- against the REAL calendars/calendar_hosts DDL (+ shipped CHECK constraints) and
-- the authority helpers, driving every §59 in-body caller-scope boundary via
-- auth.uid() simulation (request.jwt.claims) + SET ROLE grant enforcement.
--
-- IDIOM (matches the repo's self-contained authz-boundary proofs, esp.
-- supabase/tests/match_paige_memory_authz.sql): an isolated database is required,
-- roles are created, a minimal FAITHFUL schema is reproduced, the REAL migrations
-- are applied with \ir (each applied TWICE, in order, proving both clean in-order
-- application AND per-migration replay/idempotence), then the boundary matrix runs.
--
-- ASSERTION VOCABULARY: pgTAP (plan/ok/is/lives_ok/throws_ok/throws_like/finish). The
-- stock postgres CI image ships no `pgtap` extension, so — exactly as the Business
-- Vault suite does (scripts/proof/business-vault-local-pgtap-shim.sql) — a tiny
-- count-enforcing adapter provides those functions inline. finish() FAILS unless
-- planned == executed, so a skipped/aborted assertion can never pass silently (§39).
--
-- AUTH MODEL (§59 — the grant is never the guard, proven as two separate facts):
--   • BEHAVIOURAL tests run as the suite owner and drive identity purely through
--     auth.uid() (request.jwt.claims). The migration's SECURITY DEFINER bodies branch
--     on auth.uid(), NOT on the DB role, so this isolates the IN-BODY guard: every
--     42501 raised here is the body's check, never an EXECUTE-grant denial.
--   • GRANT tests prove the EXECUTE boundary separately: has_function_privilege for
--     every RPC across anon/authenticated/service_role, plus a live SET ROLE anon
--     call that must be refused at the role layer.
--   is_platform_admin() is a faithful test shim toggled by the app.platform_admin GUC
--   (the operator path), matching the one-off proof this replaces.
--
-- §2: a generic scheduling seam — zero finance content. Synthetic fixtures only;
-- never run against a production database (the isolated-DB guard enforces this).
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Isolated-database guard: this fixture creates roles + a synthetic schema and
--    must never touch a real database. ────────────────────────────────────────
DO $$ BEGIN
  IF current_database() <> 'calendar_preset_seam_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated calendar_preset_seam_contract database (got %)', current_database();
  END IF;
END $$;

-- ── Supabase roles the migrations GRANT/REVOKE against. ──────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Inline pgTAP-compatible, count-enforcing assertion shim (self-contained). ──
CREATE TABLE _pgtap_state(planned integer NOT NULL, executed integer NOT NULL);

CREATE FUNCTION plan(integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN DELETE FROM _pgtap_state; INSERT INTO _pgtap_state VALUES($1,0); RETURN '1..'||$1; END $$;

-- SECURITY DEFINER so the tick still records when a test runs under SET ROLE anon.
CREATE FUNCTION _pgtap_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN UPDATE _pgtap_state SET executed=executed+1; IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: no plan set'; END IF; END $$;

CREATE FUNCTION ok(boolean, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', $2; END IF; RETURN 'ok - '||$2; END $$;

CREATE FUNCTION is(anyelement, anyelement, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM $2 THEN RAISE EXCEPTION 'FAIL: %  (got %, expected %)', $3, $1, $2; END IF;
  RETURN 'ok - '||$3; END $$;

CREATE FUNCTION lives_ok(text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick(); EXECUTE $1; RETURN 'ok - '||$2;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL: % — unexpected [%] %', $2, SQLSTATE, SQLERRM; END $$;

-- SQLSTATE-only refusal: proves WHICH error class, robust to message wording.
CREATE FUNCTION throws_ok(text, text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  BEGIN EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = $2 THEN RETURN 'ok - '||$3; END IF;
    RAISE EXCEPTION 'FAIL: % — got [%] %, wanted SQLSTATE %', $3, SQLSTATE, SQLERRM, $2;
  END;
  RAISE EXCEPTION 'FAIL: % — call succeeded, expected SQLSTATE %', $3, $2;
END $$;

-- SQLSTATE + message-prefix: for the tagged block reasons that SHARE a SQLSTATE
-- (several refusals are 22023), where the specific tag IS the thing being proven.
CREATE FUNCTION throws_like(text, text, text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  BEGIN EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = $2 AND SQLERRM LIKE $3 THEN RETURN 'ok - '||$4; END IF;
    RAISE EXCEPTION 'FAIL: % — got [%] %, wanted [%] LIKE %', $4, SQLSTATE, SQLERRM, $2, $3;
  END;
  RAISE EXCEPTION 'FAIL: % — call succeeded, expected [%] LIKE %', $4, $2, $3;
END $$;

CREATE FUNCTION finish() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE p integer; e integer;
BEGIN SELECT planned, executed INTO p, e FROM _pgtap_state;
  IF p IS DISTINCT FROM e THEN RAISE EXCEPTION 'FAIL: planned % assertions, executed %', p, e; END IF;
  RETURN NEXT format('ok - all %s assertions executed', e);
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth shim: identity is driven by request.jwt.claims (set per case). ──────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;

-- ── Fixture tables: the REAL calendars base DDL (20260708210000) + the shipped
--    CHECK constraints. published_at and archived_at are DELIBERATELY absent — the
--    migrations' ALTERs must add them (and the backfill of published_at must run). ─
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, account_type text, parent_tenant_id uuid);
CREATE TABLE public.tenant_members (
  tenant_id uuid, user_id uuid, role text, status text DEFAULT 'active',
  PRIMARY KEY (tenant_id, user_id));
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, entity text,
  action text, entity_id uuid, data jsonb, created_at timestamptz DEFAULT now());

CREATE TABLE public.calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'personal',
  title text, description text, logo_url text, accent text, cover_url text, color text,
  duration_min integer NOT NULL DEFAULT 30,
  buffer_before_min integer NOT NULL DEFAULT 0,
  buffer_after_min integer NOT NULL DEFAULT 0,
  min_notice_min integer NOT NULL DEFAULT 60,
  booking_horizon_days integer NOT NULL DEFAULT 60,
  capacity integer NOT NULL DEFAULT 8,
  redirect_url text,
  timezone text NOT NULL DEFAULT 'America/New_York',
  availability_json jsonb,
  date_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  group_id uuid,
  theme text NOT NULL DEFAULT 'light',
  subtitle text,
  show_company_name boolean NOT NULL DEFAULT true,
  location_type text NOT NULL DEFAULT 'google_meet',
  location_value text,
  location_options jsonb,
  intake_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  appointment_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  notify_config jsonb NOT NULL DEFAULT
    '{"confirm_guest":true,"confirm_host":true,"reminders":[{"channel":"email","offset_min":1440}]}'::jsonb,
  assignment_strategy jsonb NOT NULL DEFAULT '{"mode":"balanced"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendars_type_chk CHECK (type IN ('personal','round_robin','collective','event')),
  CONSTRAINT calendars_capacity_chk CHECK (capacity > 0),
  CONSTRAINT calendars_theme_chk CHECK (theme IN ('light','dark')),
  CONSTRAINT calendars_location_type_chk
    CHECK (location_type IN ('in_person','phone','google_meet','zoom','custom','ask_invitee')));

CREATE TABLE public.calendar_hosts (
  calendar_id uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (calendar_id, user_id));

-- ── Authority helpers — VERBATIM shapes from 20260708210000 (is_platform_admin is a
--    faithful test shim toggled by the app.platform_admin GUC, the operator path). ─
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.platform_admin', true),'')::boolean, false) $$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin')) $$;
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND user_id=auth.uid() AND status='active') $$;
CREATE OR REPLACE FUNCTION public.is_calendar_host(_cal uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.calendar_hosts WHERE calendar_id=_cal AND user_id=auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.can_manage_calendar(_cal uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calendars c
     WHERE c.id=_cal
       AND (c.created_by=auth.uid()
            OR public.is_platform_admin()
            OR (c.tenant_id IS NOT NULL AND public.is_tenant_admin(c.tenant_id)))) $$;

-- ── Seed: tenants A & B, their people, memberships. ──────────────────────────
INSERT INTO auth.users(id,email) VALUES
  ('11111111-1111-1111-1111-111111111111','ownerA@x'),
  ('22222222-2222-2222-2222-222222222222','adminA@x'),
  ('33333333-3333-3333-3333-333333333333','memberA@x'),
  ('44444444-4444-4444-4444-444444444444','member2A@x'),
  ('55555555-5555-5555-5555-555555555555','ownerB@x'),
  ('66666666-6666-6666-6666-666666666666','host2A@x');
INSERT INTO public.tenants(id,name,account_type) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Tenant A','standalone'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Tenant B','standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner','active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','admin','active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','member','active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444','member','active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66666666-6666-6666-6666-666666666666','member','active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','55555555-5555-5555-5555-555555555555','owner','active');

-- A pre-existing ENABLED calendar, as prod has today, seeded BEFORE the migrations so
-- migration 1's published_at BACKFILL is genuinely exercised (proved in T16). No
-- published_at column exists yet — the ALTER must add it.
INSERT INTO public.calendars(tenant_id,created_by,slug,type,enabled,availability_json,location_type,created_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','p-preexisting','personal',true,
          '[{"day":1,"start":"09:00","end":"17:00"}]'::jsonb,'phone', now() - interval '30 days');

-- ── APPLY THE REAL MIGRATIONS, IN ORDER, EACH TWICE (clean in-order application +
--    per-migration replay/idempotence). Ordering note: migration 1 is re-run BEFORE
--    migration 2 (never after) — migration 2 evolves get_calendar_presets' return
--    signature, and a CREATE OR REPLACE cannot narrow it back, exactly as the real
--    once-each-in-order deploy pipeline runs them. ─────────────────────────────
\ir ../migrations/20270301000000_calendar_booking_preset_lifecycle.sql
\ir ../migrations/20270301000000_calendar_booking_preset_lifecycle.sql
\ir ../migrations/20270302000000_calendar_preset_duplicate_archive_restore.sql
\ir ../migrations/20270302000000_calendar_preset_duplicate_archive_restore.sql

-- ============================================================================
--                              ASSERTION MATRIX
-- ============================================================================
SELECT plan(112);

SELECT set_config('app.platform_admin', 'false', false);

-- ── REPLAY / STRUCTURE: the migrations produced the objects the seam needs. ──
SELECT ok((SELECT count(*) FROM information_schema.columns
             WHERE table_schema='public' AND table_name='calendars'
               AND column_name='published_at') = 1,
          'R1 migration 1 added calendars.published_at');
SELECT ok((SELECT count(*) FROM information_schema.columns
             WHERE table_schema='public' AND table_name='calendars'
               AND column_name='archived_at') = 1,
          'R2 migration 2 added calendars.archived_at');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN (
               'create_calendar_preset','update_calendar_preset','publish_calendar_preset',
               'pause_calendar_preset','get_calendar_presets','duplicate_calendar_preset',
               'archive_calendar_preset','restore_calendar_preset',
               '_assert_can_manage_preset','_calendar_preset_block_reason')),
          10, 'R3 all 10 seam functions exist after replay');

-- ── GRANTS (§59 — the EXECUTE boundary, proven independently of the in-body guard).
--    Every public RPC: anon REVOKED, authenticated + service_role GRANTED. ──────
SELECT ok(NOT has_function_privilege('anon','public.create_calendar_preset(uuid,text,jsonb,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.create_calendar_preset(uuid,text,jsonb,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.create_calendar_preset(uuid,text,jsonb,uuid)','EXECUTE'),
      'G1 create_calendar_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.update_calendar_preset(uuid,jsonb,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.update_calendar_preset(uuid,jsonb,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.update_calendar_preset(uuid,jsonb,uuid)','EXECUTE'),
      'G2 update_calendar_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.publish_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.publish_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.publish_calendar_preset(uuid,uuid)','EXECUTE'),
      'G3 publish_calendar_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.pause_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.pause_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.pause_calendar_preset(uuid,uuid)','EXECUTE'),
      'G4 pause_calendar_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.get_calendar_presets(uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.get_calendar_presets(uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.get_calendar_presets(uuid)','EXECUTE'),
      'G5 get_calendar_presets: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.duplicate_calendar_preset(uuid,text,text,uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.duplicate_calendar_preset(uuid,text,text,uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.duplicate_calendar_preset(uuid,text,text,uuid,uuid)','EXECUTE'),
      'G6 duplicate_calendar_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.archive_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.archive_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.archive_calendar_preset(uuid,uuid)','EXECUTE'),
      'G7 archive_calendar_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public.restore_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.restore_calendar_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.restore_calendar_preset(uuid,uuid)','EXECUTE'),
      'G8 restore_calendar_preset: anon revoked; authenticated + service_role granted');
-- The two internal helpers: _assert_can_manage_preset is authenticated+service only;
-- _calendar_preset_block_reason is REVOKED from anon/PUBLIC/authenticated (owner-only,
-- reached solely by its DEFINER callers) so it can't probe another tenant's config.
SELECT ok(NOT has_function_privilege('anon','public._assert_can_manage_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public._assert_can_manage_preset(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public._assert_can_manage_preset(uuid,uuid)','EXECUTE'),
      'G9 _assert_can_manage_preset: anon revoked; authenticated + service_role granted');
SELECT ok(NOT has_function_privilege('anon','public._calendar_preset_block_reason(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public._calendar_preset_block_reason(uuid)','EXECUTE')
      AND NOT has_function_privilege('service_role','public._calendar_preset_block_reason(uuid)','EXECUTE'),
      'G10 _calendar_preset_block_reason: revoked from anon + authenticated + service_role (owner-only)');

-- A live SET ROLE anon call is refused at the ROLE layer (42501 permission denied) —
-- the REVOKE bites at runtime, not merely in the catalog.
SET ROLE anon;
SELECT throws_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-anon','{}'::jsonb)$$,
  '42501', 'G11 SET ROLE anon: create_calendar_preset refused at the role layer');
SELECT throws_ok(
  $$SELECT * FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '42501', 'G12 SET ROLE anon: get_calendar_presets refused at the role layer');
RESET ROLE;

-- ── LIFECYCLE (T1–T24), ported from the one-off proof into pgTAP. ─────────────

-- T1 — member (coach) self-creates a DRAFT; creator becomes host; draft-by-default.
SELECT set_config('request.jwt.claims', json_build_object('sub','33333333-3333-3333-3333-333333333333','role','authenticated')::text, false);
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-one','{"type":"personal","title":"Intro","availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb)$$,
  'T1 member self-creates a preset');
SELECT ok((SELECT enabled=false AND published_at IS NULL FROM public.calendars WHERE slug='p-one'),
          'T1 draft-by-default: enabled=false, published_at NULL');
SELECT ok((SELECT exists(SELECT 1 FROM public.calendar_hosts h JOIN public.calendars c ON c.id=h.calendar_id
             WHERE c.slug='p-one' AND h.user_id='33333333-3333-3333-3333-333333333333' AND h.priority=0)),
          'T1 creator registered as host at priority 0');
SELECT ok((SELECT exists(SELECT 1 FROM public.audit_logs WHERE action='create_calendar_preset')),
          'T1 audit row written');

-- T2 — a member of A may NOT create for tenant B (42501, in-body membership guard).
SELECT throws_ok(
  $$SELECT public.create_calendar_preset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','p-b','{}'::jsonb)$$,
  '42501', 'T2 cross-tenant create refused (membership required)');

-- T3 — admin of A creates further drafts.
SELECT set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, false);
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-two','{"availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb)$$,
  'T3 tenant admin creates a draft');

-- T4 — duplicate slug is a clean 23505.
SELECT throws_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-one','{}'::jsonb)$$,
  '23505', 'T4 duplicate slug refused (unique_violation)');

-- T5 — publish REFUSED with no open window; the preset stays a draft.
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-nowin','{"type":"personal"}'::jsonb)$$,
  'T5 create a windowless draft');
SELECT throws_like(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-nowin'))$$,
  '22023', 'PRESET_NO_HOURS%', 'T5 publish refused: PRESET_NO_HOURS (no open window)');
SELECT ok((SELECT enabled=false FROM public.calendars WHERE slug='p-nowin'),
          'T5 refused publish left it a draft');

-- T6 — round_robin with ONE host is refused (honesty floor: needs >=2); a 2nd host fixes it.
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-rr','{"type":"round_robin","availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb)$$,
  'T6 create a round_robin draft (1 host)');
SELECT throws_like(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  '22023', 'PRESET_NEEDS_HOSTS%', 'T6 round_robin with 1 host refused: PRESET_NEEDS_HOSTS');
INSERT INTO public.calendar_hosts(calendar_id,user_id,priority)
  SELECT id,'66666666-6666-6666-6666-666666666666',1 FROM public.calendars WHERE slug='p-rr';
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  'T6 round_robin publishes once it has 2 hosts');
SELECT ok((SELECT enabled=true AND published_at IS NOT NULL FROM public.calendars WHERE slug='p-rr'),
          'T6 round_robin is Live (enabled=true, published_at set)');

-- T7 — personal preset with window + default method + creator host publishes LIVE.
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-one'))$$,
  'T7 personal preset publishes');
SELECT ok((SELECT enabled=true AND published_at IS NOT NULL FROM public.calendars WHERE slug='p-one'),
          'T7 personal preset is Live');

-- T8 — republish is idempotent and preserves the original published_at.
SELECT set_config('test.pub_before', (SELECT published_at::text FROM public.calendars WHERE slug='p-one'), false);
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-one'))$$,
  'T8 republish lives');
SELECT is((SELECT published_at::text FROM public.calendars WHERE slug='p-one'),
          current_setting('test.pub_before'), 'T8 republish preserves the original published_at');

-- T9 — pause a live preset: enabled=false but published_at RETAINED (Paused ≠ Draft).
SELECT lives_ok(
  $$SELECT public.pause_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-one'))$$,
  'T9 pause a live preset');
SELECT ok((SELECT enabled=false AND published_at IS NOT NULL FROM public.calendars WHERE slug='p-one'),
          'T9 pause keeps published_at (reads as Paused, not Draft)');

-- T10 — update applies config; can NEVER flip enabled/published_at/slug (not in allowlist).
SELECT lives_ok(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), '{"title":"Renamed","enabled":true,"published_at":"2020-01-01T00:00:00Z"}'::jsonb)$$,
  'T10 update a draft with an injected enabled/published_at patch');
SELECT ok((SELECT title='Renamed' AND enabled=false AND published_at IS NULL AND slug='p-two'
             FROM public.calendars WHERE slug='p-two'),
          'T10 update changes config only; enabled/published_at/slug immune to patch injection');

-- T11 — owner of B cannot manage A's preset (42501 on every lifecycle verb).
SELECT set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, false);
SELECT throws_ok($$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), '{"title":"x"}'::jsonb)$$,
  '42501', 'T11 owner B cannot update A''s preset');
SELECT throws_ok($$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'))$$,
  '42501', 'T11 owner B cannot publish A''s preset');
SELECT throws_ok($$SELECT public.pause_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'))$$,
  '42501', 'T11 owner B cannot pause A''s preset');

-- T12 — a platform admin manages across tenants.
SELECT set_config('app.platform_admin', 'true', false);
SELECT lives_ok(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), '{"title":"By operator"}'::jsonb)$$,
  'T12 platform admin manages cross-tenant');
SELECT ok((SELECT title='By operator' FROM public.calendars WHERE slug='p-two'),
          'T12 platform admin edit persisted');
SELECT set_config('app.platform_admin', 'false', false);

-- T13 — service role (auth.uid() NULL): trusted ONLY for the tenant it names.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-svc','{"availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb, '33333333-3333-3333-3333-333333333333')$$,
  'T13 service-role create for the named tenant');
SELECT ok((SELECT exists(SELECT 1 FROM public.calendar_hosts h JOIN public.calendars c ON c.id=h.calendar_id
             WHERE c.slug='p-svc' AND h.user_id='33333333-3333-3333-3333-333333333333')),
          'T13 service-role create registers the passed creator as host');
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-svc'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'T13 service-role publishes for the named tenant');
SELECT throws_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501', 'T13 service-role refused on a tenant that mismatches the row');
SELECT throws_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), NULL)$$,
  '42501', 'T13 service-role refused with a NULL tenant');

-- T14 — a plain member who is neither creator nor admin cannot manage (42501).
SELECT set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, false);
SELECT throws_ok(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-one'), '{"title":"x"}'::jsonb)$$,
  '42501', 'T14 plain member (not creator/admin) cannot manage');

-- T15 — a missing preset is a clean P0002, not a silent no-op.
SELECT set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, false);
SELECT throws_ok(
  $$SELECT public.publish_calendar_preset('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'P0002', 'T15 missing preset raises PRESET_NOT_FOUND (P0002)');

-- T16 — migration 1's OWN backfill set published_at on the pre-existing enabled row
-- (seeded before the migration), to created_at (not now()).
SELECT ok((SELECT published_at IS NOT NULL AND published_at = created_at
             FROM public.calendars WHERE slug='p-preexisting'),
          'T16 backfill: pre-existing enabled preset reads as published (=created_at), never Draft');

-- T17 — get_calendar_presets: tenant-scoped read + correct derived lifecycle.
SELECT ok((SELECT count(*) FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')) >= 5,
          'T17 admin reads the tenant''s presets');
SELECT is((SELECT lifecycle FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') WHERE slug='p-one'),
          'paused', 'T17 p-one derives as Paused (enabled=false, published_at set)');
SELECT is((SELECT lifecycle FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') WHERE slug='p-rr'),
          'live', 'T17 p-rr derives as Live');
SELECT is((SELECT lifecycle FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') WHERE slug='p-nowin'),
          'draft', 'T17 p-nowin derives as Draft (never published)');
-- cross-tenant read refused
SELECT set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, false);
SELECT throws_ok(
  $$SELECT * FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '42501', 'T17 owner B cannot read tenant A''s presets');
-- service-role read is trusted for the named tenant and scoped to it
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT ok((SELECT count(*) FROM public.get_calendar_presets('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) = 0
       AND (SELECT count(*) FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')) >= 5,
          'T17 service-role read is scoped to the named tenant only');

-- T18 — the public /book/:slug resolver gates on exactly `enabled = true`. Mirror that
-- predicate to prove neither a Draft (p-nowin) nor a Paused (p-one) preset is admitted.
SELECT ok((SELECT count(*) FROM public.calendars WHERE slug='p-nowin' AND enabled=true) = 0
       AND (SELECT count(*) FROM public.calendars WHERE slug='p-one'   AND enabled=true) = 0,
          'T18 resolver gate (enabled=true) admits neither a Draft nor a Paused preset');

-- ── Shared publish bar + auto-pause (§39 finding: publish and the update auto-pause
--    gate share ONE bar so the two write paths cannot drift). ───────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, false);

-- T19 — editing a LIVE preset below the publish bar AUTO-PAUSES it (enabled=false,
-- published_at RETAINED, and the return reports auto_paused + the blocking reason).
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-live-edit','{"type":"personal","title":"Edit me","availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb)$$,
  'T19 create p-live-edit');
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-edit'))$$,
  'T19 publish p-live-edit');
SELECT ok((SELECT enabled=true FROM public.calendars WHERE slug='p-live-edit'), 'T19 preset is Live before the breaking edit');
SELECT set_config('test.autopause',
  (SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-edit'), '{"availability_json":[]}'::jsonb)::text), false);
SELECT ok((current_setting('test.autopause')::jsonb->>'auto_paused')::boolean,
          'T19 breaking edit returns auto_paused=true');
SELECT ok((current_setting('test.autopause')::jsonb->>'reason') LIKE 'PRESET_NO_HOURS%',
          'T19 auto_pause reason is the blocking bar (PRESET_NO_HOURS)');
SELECT ok((SELECT enabled=false AND published_at IS NOT NULL FROM public.calendars WHERE slug='p-live-edit'),
          'T19 auto-paused: enabled=false, published_at RETAINED (reads as Paused)');

-- T20 — a NON-breaking edit to a Live preset leaves it Live (auto_paused=false).
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-live-ok','{"type":"personal","title":"Keep me live","availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb)$$,
  'T20 create p-live-ok');
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-ok'))$$,
  'T20 publish p-live-ok');
SELECT set_config('test.stayslive',
  (SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-ok'), '{"title":"Renamed but still bookable"}'::jsonb)::text), false);
SELECT ok(NOT (current_setting('test.stayslive')::jsonb->>'auto_paused')::boolean,
          'T20 valid edit to a Live preset does not auto-pause');
SELECT ok((SELECT enabled=true AND title='Renamed but still bookable' FROM public.calendars WHERE slug='p-live-ok'),
          'T20 Live preset stays Live after a valid, still-bookable edit');

-- T21 — editing a DRAFT never triggers auto-pause (only a Live preset can be paused).
SELECT set_config('test.draftedit',
  (SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-nowin'), '{"title":"still a draft"}'::jsonb)::text), false);
SELECT ok(NOT (current_setting('test.draftedit')::jsonb->>'auto_paused')::boolean,
          'T21 editing a Draft does not auto-pause');
SELECT ok((SELECT enabled=false AND published_at IS NULL FROM public.calendars WHERE slug='p-nowin'),
          'T21 Draft stays a Draft after an edit');

-- T22 — a malformed group_id is refused with a tagged 22023, never a raw 22P02; an
-- empty group_id is allowed (it clears the group).
SELECT throws_like(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), '{"group_id":"not-a-uuid"}'::jsonb)$$,
  '22023', 'PRESET_BAD_GROUP%', 'T22 malformed group_id refused with tagged PRESET_BAD_GROUP');
SELECT lives_ok(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'), '{"group_id":""}'::jsonb)$$,
  'T22 empty group_id is allowed (clears the group)');

-- T23 — publish routes through the ONE bar, stricter than the old inline check: a bare
-- `ask_invitee` (no concrete option) is NOT a usable method; one concrete option fixes it.
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-ask','{"type":"personal","location_type":"ask_invitee","location_options":[],"availability_json":[{"day":1,"start":"09:00","end":"17:00"}]}'::jsonb)$$,
  'T23 create a bare-ask_invitee draft');
SELECT throws_like(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-ask'))$$,
  '22023', 'PRESET_NO_METHOD%', 'T23 publish refused: PRESET_NO_METHOD (bare ask_invitee)');
SELECT lives_ok(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-ask'), '{"location_options":[{"type":"phone","value":null}]}'::jsonb)$$,
  'T23 add one concrete method');
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-ask'))$$,
  'T23 publishes once a concrete method exists');

-- T24 — the publish bar validates window SHAPE (HH:MM), not just presence.
SELECT lives_ok(
  $$SELECT public.create_calendar_preset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p-badtime','{"type":"personal","availability_json":[{"day":1,"start":"9:00","end":"17:00"}]}'::jsonb)$$,
  'T24 create a draft with a malformed time ("9:00")');
SELECT throws_like(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-badtime'))$$,
  '22023', 'PRESET_NO_HOURS%', 'T24 malformed window shape is not a bookable window: PRESET_NO_HOURS');

-- ── DUPLICATE · ARCHIVE · RESTORE (T25–T34), migration 2. ────────────────────
SELECT set_config('app.platform_admin', 'false', false);
SELECT set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, false);

-- T25 — admin duplicates the LIVE round-robin preset: copy is a DRAFT with a fresh slug,
-- faithful config, the source host pool (2 hosts), and an audit row.
SELECT lives_ok(
  $$SELECT public.duplicate_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), 'p-rr-copy', 'RR Copy')$$,
  'T25 duplicate the live round_robin preset');
SELECT ok((SELECT enabled=false AND published_at IS NULL AND archived_at IS NULL AND title='RR Copy' AND type='round_robin'
             FROM public.calendars WHERE slug='p-rr-copy'),
          'T25 duplicate is a fresh DRAFT with the given title + copied type');
SELECT ok((SELECT c2.availability_json = c1.availability_json AND c2.duration_min = c1.duration_min
             FROM public.calendars c1, public.calendars c2 WHERE c1.slug='p-rr' AND c2.slug='p-rr-copy'),
          'T25 duplicate copies config faithfully (availability_json + duration_min)');
SELECT is((SELECT count(*)::int FROM public.calendar_hosts h JOIN public.calendars c ON c.id=h.calendar_id WHERE c.slug='p-rr-copy'),
          2, 'T25 duplicate carries the source host pool (2 hosts)');
SELECT ok((SELECT exists(SELECT 1 FROM public.audit_logs WHERE action='duplicate_calendar_preset')),
          'T25 duplicate audit row written');

-- T26 — duplicate into a taken slug is a clean 23505 (never a silent overwrite).
SELECT throws_ok(
  $$SELECT public.duplicate_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), 'p-one', NULL)$$,
  '23505', 'T26 duplicate into a taken slug refused (unique_violation)');

-- T27 — owner of B cannot duplicate A's preset (must manage the SOURCE): 42501.
SELECT set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, false);
SELECT throws_ok(
  $$SELECT public.duplicate_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), 'p-steal', NULL)$$,
  '42501', 'T27 owner B cannot duplicate A''s preset (manage-the-source required)');

-- T28 — service-role duplicate: trusted for the named tenant, must supply a creator,
-- and a tenant that mismatches the source is refused.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT lives_ok(
  $$SELECT public.duplicate_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), 'p-rr-svc', 'SVC copy', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333')$$,
  'T28 service-role duplicate for the named tenant + creator');
SELECT ok((SELECT exists(SELECT 1 FROM public.calendar_hosts h JOIN public.calendars c ON c.id=h.calendar_id
             WHERE c.slug='p-rr-svc' AND h.user_id='33333333-3333-3333-3333-333333333333')),
          'T28 service-role duplicate registers the passed creator as a host');
SELECT throws_ok(
  $$SELECT public.duplicate_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), 'p-rr-mismatch', NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333')$$,
  '42501', 'T28 service-role duplicate refused on a tenant that mismatches the source');
SELECT throws_ok(
  $$SELECT public.duplicate_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), 'p-rr-nocreator', NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL)$$,
  '22023', 'T28 service-role duplicate refused with no creator (PRESET_CREATOR_REQUIRED)');

-- T29 — archive the LIVE p-rr: archived_at set, enabled=false, published_at preserved;
-- idempotent (a second archive keeps the first instant); off the public resolver gate.
SELECT set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, false);
SELECT lives_ok(
  $$SELECT public.archive_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  'T29 archive the live preset');
SELECT ok((SELECT archived_at IS NOT NULL AND enabled=false AND published_at IS NOT NULL FROM public.calendars WHERE slug='p-rr'),
          'T29 archive sets archived_at + enabled=false, keeps published_at');
SELECT ok((SELECT count(*) FROM public.calendars WHERE slug='p-rr' AND enabled=true) = 0,
          'T29 archived preset fails the public resolver gate (enabled<>true) — off the air');
SELECT set_config('test.arch_first', (SELECT archived_at::text FROM public.calendars WHERE slug='p-rr'), false);
SELECT lives_ok(
  $$SELECT public.archive_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  'T29 re-archive lives');
SELECT is((SELECT archived_at::text FROM public.calendars WHERE slug='p-rr'),
          current_setting('test.arch_first'), 'T29 archive is idempotent (archived_at preserved)');

-- T30 — an archived preset is FROZEN: publish and edit both raise the tagged
-- PRESET_ARCHIVED (§13 — no silent un-archive-and-go-live, no silent edit).
SELECT throws_like(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  '22023', 'PRESET_ARCHIVED%', 'T30 publish of an archived preset refused with PRESET_ARCHIVED');
SELECT throws_like(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), '{"title":"nope"}'::jsonb)$$,
  '22023', 'PRESET_ARCHIVED%', 'T30 update of an archived preset refused with PRESET_ARCHIVED');

-- T30b — a non-manager (owner B) cannot archive/restore A's preset (42501).
SELECT set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, false);
SELECT throws_ok($$SELECT public.archive_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-ok'))$$,
  '42501', 'T30b owner B cannot archive A''s preset');
SELECT throws_ok($$SELECT public.restore_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  '42501', 'T30b owner B cannot restore A''s preset');

-- T31 — restore p-rr: archived_at cleared, enabled STAYS false, returns to Paused (had
-- been published) — never straight to Live. Then editable + re-publishable.
SELECT set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, false);
SELECT lives_ok(
  $$SELECT public.restore_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  'T31 restore the archived preset');
SELECT ok((SELECT archived_at IS NULL AND enabled=false AND published_at IS NOT NULL FROM public.calendars WHERE slug='p-rr'),
          'T31 restore clears archived_at, keeps enabled=false + published_at (→ Paused)');
SELECT is((SELECT lifecycle FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') WHERE slug='p-rr'),
          'paused', 'T31 restored preset derives as Paused');
SELECT lives_ok(
  $$SELECT public.update_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'), '{"title":"Restored RR"}'::jsonb)$$,
  'T31 a restored preset can be edited again');
SELECT lives_ok(
  $$SELECT public.publish_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-rr'))$$,
  'T31 a restored preset can be re-published through the validated seam');
SELECT ok((SELECT enabled=true FROM public.calendars WHERE slug='p-rr'), 'T31 restored preset is Live again');

-- T32 — archive a never-published DRAFT and restore it: returns to Draft (published_at
-- still NULL), proving restore honors the original lifecycle.
SELECT lives_ok(
  $$SELECT public.archive_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-nowin'))$$,
  'T32 archive a never-published draft');
SELECT is((SELECT lifecycle FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') WHERE slug='p-nowin'),
          'archived', 'T32 archived draft derives as archived (precedence over draft)');
SELECT lives_ok(
  $$SELECT public.restore_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-nowin'))$$,
  'T32 restore the archived draft');
SELECT ok((SELECT archived_at IS NULL AND enabled=false AND published_at IS NULL FROM public.calendars WHERE slug='p-nowin'),
          'T32 restored draft returns to Draft (published_at still NULL)');

-- T33 — the read exposes archived_at and derives 'archived' with precedence.
SELECT lives_ok(
  $$SELECT public.archive_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-two'))$$,
  'T33 archive p-two');
SELECT ok((SELECT lifecycle='archived' AND archived_at IS NOT NULL
             FROM public.get_calendar_presets('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') WHERE slug='p-two'),
          'T33 get_calendar_presets exposes archived_at and derives the archived lifecycle');

-- T34 — service-role archive/restore is trusted for the named tenant, refused on a mismatch.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT lives_ok(
  $$SELECT public.archive_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-ok'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'T34 service-role archive for the named tenant');
SELECT throws_ok(
  $$SELECT public.restore_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-ok'), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501', 'T34 service-role restore refused on a tenant that mismatches the row');
SELECT lives_ok(
  $$SELECT public.restore_calendar_preset((SELECT id FROM public.calendars WHERE slug='p-live-ok'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'T34 service-role restore for the named tenant');

SELECT * FROM finish();
