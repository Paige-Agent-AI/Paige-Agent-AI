-- ============================================================================
-- E7 — calendar_link_shareable: repeatable §32/§59 CI proof.
--
-- Proves the ONE new function added by
--   20270315000000_calendar_link_shareable.sql
-- against the REAL calendars/calendar_hosts DDL and the REAL caller-scope gate
-- `_assert_can_manage_preset` (applied here from the shipped lifecycle migration,
-- never re-implemented — so a drift in the gate is caught, not hidden).
--
-- Shareability truth under test: a calendar is publicly shareable IFF
-- `enabled = true` AND it has >= 1 host — mirroring public-booking `loadCalendar`.
-- Every other lifecycle (draft / paused / archived / setup-required) has
-- `enabled <> true` and MUST refuse with reason 'CALENDAR_NOT_PUBLIC'; an enabled
-- calendar with zero hosts refuses with 'CALENDAR_NO_HOST'.
--
-- IDIOM: matches supabase/tests/calendar_booking_preset_seam.sql — isolated DB,
-- roles created, a faithful minimal schema, the REAL migrations applied with \ir
-- (each twice, in order: clean application + per-migration replay/idempotence),
-- then the boundary matrix. The count-enforcing pgTAP shim makes a skipped
-- assertion impossible to pass silently (§39). §2: synthetic fixtures only.
--
-- AUTH MODEL (§59 — the grant is never the guard, proven as two facts):
--   • BEHAVIOURAL tests run as the suite owner and drive identity purely through
--     auth.uid() (request.jwt.claims); every 42501/P0002 here is the FUNCTION BODY's
--     check (via _assert_can_manage_preset), never an EXECUTE-grant denial.
--   • The GRANT boundary is proven separately (has_function_privilege across
--     anon/authenticated/service_role + a live SET ROLE anon refusal).
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'calendar_link_shareable_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated calendar_link_shareable_contract database (got %)', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Inline pgTAP-compatible, count-enforcing assertion shim. ─────────────────
CREATE TABLE _pgtap_state(planned integer NOT NULL, executed integer NOT NULL);
CREATE FUNCTION plan(integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN DELETE FROM _pgtap_state; INSERT INTO _pgtap_state VALUES($1,0); RETURN '1..'||$1; END $$;
CREATE FUNCTION _pgtap_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN UPDATE _pgtap_state SET executed=executed+1; IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: no plan set'; END IF; END $$;
CREATE FUNCTION ok(boolean, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', $2; END IF; RETURN 'ok - '||$2; END $$;
CREATE FUNCTION is(anyelement, anyelement, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM $2 THEN RAISE EXCEPTION 'FAIL: %  (got %, expected %)', $3, $1, $2; END IF;
  RETURN 'ok - '||$3; END $$;
CREATE FUNCTION throws_ok(text, text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  BEGIN EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = $2 THEN RETURN 'ok - '||$3; END IF;
    RAISE EXCEPTION 'FAIL: % — got [%] %, wanted SQLSTATE %', $3, SQLSTATE, SQLERRM, $2;
  END;
  RAISE EXCEPTION 'FAIL: % — call succeeded, expected SQLSTATE %', $3, $2;
END $$;
CREATE FUNCTION finish() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE p integer; e integer;
BEGIN SELECT planned, executed INTO p, e FROM _pgtap_state;
  IF p IS DISTINCT FROM e THEN RAISE EXCEPTION 'FAIL: planned % assertions, executed %', p, e; END IF;
  RETURN NEXT format('ok - all %s assertions executed', e);
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth shim: identity driven by request.jwt.claims (set per case). ─────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;

-- ── Faithful minimal schema (calendars base DDL 20260708210000 + the CHECK set
--    the lifecycle migration expects) + calendar_hosts + authority helpers. ────
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

-- ── Seed people + tenants. ───────────────────────────────────────────────────
INSERT INTO auth.users(id,email) VALUES
  ('11111111-1111-1111-1111-111111111111','ownerA@x'),
  ('33333333-3333-3333-3333-333333333333','coachA@x'),
  ('55555555-5555-5555-5555-555555555555','ownerB@x');
INSERT INTO public.tenants(id,name,account_type) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Tenant A','standalone'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Tenant B','standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner','active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','member','active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','55555555-5555-5555-5555-555555555555','owner','active');

-- ── APPLY THE REAL MIGRATIONS, IN ORDER, EACH TWICE (clean + replay). The first
--    two ship _assert_can_manage_preset + published_at + archived_at; the third is
--    the function under test. ──────────────────────────────────────────────────
\ir ../migrations/20270301000000_calendar_booking_preset_lifecycle.sql
\ir ../migrations/20270301000000_calendar_booking_preset_lifecycle.sql
\ir ../migrations/20270302000000_calendar_preset_duplicate_archive_restore.sql
\ir ../migrations/20270302000000_calendar_preset_duplicate_archive_restore.sql
\ir ../migrations/20270315000000_calendar_link_shareable.sql
\ir ../migrations/20270315000000_calendar_link_shareable.sql

-- ── Seed calendars in every lifecycle state (columns now exist). ─────────────
INSERT INTO public.calendars(id,tenant_id,created_by,slug,type,title,enabled) VALUES
  ('c1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','cal-live','personal','Live Cal',true),
  ('c2222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','cal-draft','personal','Draft Cal',false),
  ('c3333333-3333-3333-3333-333333333333','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','cal-paused','personal','Paused Cal',false),
  ('c4444444-4444-4444-4444-444444444444','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','cal-archived','personal','Archived Cal',false),
  ('c5555555-5555-5555-5555-555555555555','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','cal-nohost','personal','Enabled No Host',true),
  ('c6666666-6666-6666-6666-666666666666','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','55555555-5555-5555-5555-555555555555','cal-b','personal','Tenant B Cal',true);
-- Paused = published once then disabled; Archived = archived_at set.
UPDATE public.calendars SET published_at = now() - interval '2 days' WHERE id='c3333333-3333-3333-3333-333333333333';
UPDATE public.calendars SET archived_at  = now() - interval '1 day'  WHERE id='c4444444-4444-4444-4444-444444444444';
-- Hosts for every calendar EXCEPT cal-nohost (which tests CALENDAR_NO_HOST).
INSERT INTO public.calendar_hosts(calendar_id,user_id) VALUES
  ('c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'),
  ('c2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111'),
  ('c3333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111'),
  ('c4444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111'),
  ('c6666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555');

-- ============================================================================
--                              ASSERTION MATRIX
-- ============================================================================
SELECT plan(24);
SELECT set_config('app.platform_admin', 'false', false);

-- ── STRUCTURE + GRANTS (§59 — the EXECUTE boundary, proven independently). ───
SELECT ok((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='calendar_link_shareable') = 1,
          'S1 calendar_link_shareable exists after replay');
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='calendar_link_shareable'),
          'S2 calendar_link_shareable is SECURITY DEFINER');
SELECT ok((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='calendar_link_shareable'
               AND array_to_string(p.proconfig,',') LIKE '%search_path%')),
          'S3 calendar_link_shareable pins search_path');
SELECT ok(NOT has_function_privilege('anon','public.calendar_link_shareable(uuid,uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.calendar_link_shareable(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.calendar_link_shareable(uuid,uuid)','EXECUTE'),
      'G1 calendar_link_shareable: anon revoked; authenticated + service_role granted');

-- ── BEHAVIOURAL — manager JWT (owner A), platform_admin=false. ───────────────
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL)), true,  'B1 LIVE (enabled + host) is shareable');
SELECT ok((SELECT reason FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL)) IS NULL,   'B2 LIVE reason is NULL');
SELECT is((SELECT slug  FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL)), 'cal-live','B3 LIVE returns the slug');
SELECT is((SELECT title FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL)), 'Live Cal','B4 LIVE returns the title');
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c2222222-2222-2222-2222-222222222222', NULL)), false, 'B5 DRAFT is not shareable');
SELECT is((SELECT reason FROM public.calendar_link_shareable('c2222222-2222-2222-2222-222222222222', NULL)), 'CALENDAR_NOT_PUBLIC', 'B6 DRAFT reason CALENDAR_NOT_PUBLIC');
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c3333333-3333-3333-3333-333333333333', NULL)), false, 'B7 PAUSED is not shareable');
SELECT is((SELECT reason FROM public.calendar_link_shareable('c3333333-3333-3333-3333-333333333333', NULL)), 'CALENDAR_NOT_PUBLIC', 'B8 PAUSED reason CALENDAR_NOT_PUBLIC');
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c4444444-4444-4444-4444-444444444444', NULL)), false, 'B9 ARCHIVED is not shareable');
SELECT is((SELECT reason FROM public.calendar_link_shareable('c4444444-4444-4444-4444-444444444444', NULL)), 'CALENDAR_NOT_PUBLIC', 'B10 ARCHIVED reason CALENDAR_NOT_PUBLIC');
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c5555555-5555-5555-5555-555555555555', NULL)), false, 'B11 enabled-but-no-host is not shareable');
SELECT is((SELECT reason FROM public.calendar_link_shareable('c5555555-5555-5555-5555-555555555555', NULL)), 'CALENDAR_NO_HOST', 'B12 no-host reason CALENDAR_NO_HOST');

-- ── §59 caller scope — a non-manager (coach) is refused by the BODY (42501). ─
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false);
SELECT throws_ok($$ SELECT * FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL) $$, '42501', 'B13 non-manager JWT refused 42501');

-- ── forged / missing calendar → P0002 (raised by _assert_can_manage_preset). ─
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
SELECT throws_ok($$ SELECT * FROM public.calendar_link_shareable('c9999999-9999-9999-9999-999999999999', NULL) $$, 'P0002', 'B14 forged calendar id refused P0002');

-- ── platform admin (different, non-member uid) can manage → shareable reflects state. ─
SELECT set_config('app.platform_admin', 'true', false);
SELECT set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false);
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL)), true, 'B15 platform admin resolves shareability');
SELECT set_config('app.platform_admin', 'false', false);

-- ── SERVICE ROLE (auth.uid() NULL): trusted only for the tenant it names. ────
SELECT set_config('request.jwt.claims', '', false);
SELECT is((SELECT shareable FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), true, 'SR1 service role + correct tenant resolves shareability');
SELECT throws_ok($$ SELECT * FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$, '42501', 'SR2 service role + WRONG tenant refused 42501');
SELECT throws_ok($$ SELECT * FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', NULL) $$, '42501', 'SR3 service role + NULL tenant refused 42501');
SELECT throws_ok($$ SELECT * FROM public.calendar_link_shareable('c9999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$, 'P0002', 'SR4 service role + forged calendar refused P0002');

-- ── ROLE LAYER: a live SET ROLE anon call is refused at the grant layer. ─────
SET ROLE anon;
SELECT throws_ok($$ SELECT * FROM public.calendar_link_shareable('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$, '42501', 'RL1 SET ROLE anon refused at EXECUTE grant');
RESET ROLE;

SELECT * FROM finish();
