-- ============================================================================
-- FUNDING COACH BLUEPRINT (FCB-2a) — the unlisted `funding_coach` bundle, proven.
--
-- Converts the ANT-29 bundle candidate into a PERMANENT, self-contained pgTAP
-- suite (Linear P-ANT-11; GitHub PR for ANT-29). It applies the REAL recorded
-- Marketplace migration chain (\ir, in supabase_migrations order) on top of a
-- minimal FAITHFUL shim of the external dependencies (auth, tenants/membership,
-- tier vocabulary), then drives the REAL install/teardown machinery through the
-- public RPCs — proving the bundle's entire lifecycle without any edge function
-- or provider in play:
--
--   registry truth (unlisted bundle composing funding v1.1.0 + funding_preset
--   + a six-phase coach journey ladder) · the unlisted-items-deny for ordinary
--   tenants AND agency tenants (PRESERVED, never weakened) · platform-owner
--   install fan-out with child ownership/refs/ledger · deferred Knowledge
--   embedding + finalize/orphan-reconcile · idempotent reinstall · full
--   reversible teardown · shared-child refcounts in BOTH orders (standalone→
--   bundle and bundle→standalone) · cross-tenant install denial · preservation
--   of a grandfathered funding tenant's entitlement through the whole cycle.
--
-- IDIOM (matches supabase/tests/calendar_booking_preset_seam.sql and the
-- Business Vault suite): isolated database, roles created, count-enforcing
-- inline pgTAP adapter (finish() fails unless planned == executed), identity
-- driven purely through request.jwt.claims. Synthetic fixtures only — no real
-- tenants, no customer data, never run against production (guard below).
--
-- FCB-2a RULES THIS SUITE ENFORCES: no new install kinds (the bundle uses only
-- skill_flag/playbook_preset/journey_stages/kb_pack/bundle_items), no catalog
-- visibility for an unlisted item, installs only through the authorized
-- platform-owner path, and teardown that leaves the tenant's pre-install
-- features EXACTLY restored.
-- ============================================================================

\set ON_ERROR_STOP on

-- ── Isolated-database guard ─────────────────────────────────────────────────
DO $$ BEGIN
  IF current_database() <> 'funding_coach_bundle_proof' THEN
    RAISE EXCEPTION 'This fixture requires the isolated funding_coach_bundle_proof database (got %)', current_database();
  END IF;
END $$;

-- ── Supabase roles the migrations GRANT against ─────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Inline pgTAP-compatible, count-enforcing assertion shim ─────────────────
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
CREATE FUNCTION jis(jsonb, jsonb, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM $2 THEN RAISE EXCEPTION 'FAIL: %  (got %, expected %)', $3, $1::text, $2::text; END IF;
  RETURN 'ok - '||$3; END $$;
CREATE FUNCTION lives_ok(text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick(); EXECUTE $1; RETURN 'ok - '||$2;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL: % — unexpected [%] %', $2, SQLSTATE, SQLERRM; END $$;
CREATE FUNCTION throws_ok(text, text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  BEGIN EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = $2 THEN RETURN 'ok - '||$3; END IF;
    RAISE EXCEPTION 'FAIL: % — got [%] %, wanted SQLSTATE %', $3, SQLSTATE, SQLERRM, $2;
  END;
  RAISE EXCEPTION 'FAIL: % — call succeeded, expected SQLSTATE %', $3, $2;
END $$;
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

-- ── auth shim: identity driven by request.jwt.claims ────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
CREATE OR REPLACE FUNCTION _set_actor(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN u IS NULL THEN '' ELSE jsonb_build_object('sub', u::text, 'role', 'authenticated')::text END,
    false);
END $$;
CREATE OR REPLACE FUNCTION _clear_actor() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', false)
$$;

-- ── Minimal FAITHFUL shim of the marketplace chain's external dependencies ──
--    (faithful = the live prod bodies' mechanism on minimal tables; the two
--    documented divergences: tier derives from tenants.account_type instead of
--    platform_subscriptions, and the is_company_workspace clause of the admin/
--    member checks is dropped — neither is exercised by this suite's matrix.)
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('admin','super_admin','platform_admin')),
  tenant_id uuid,
  PRIMARY KEY (user_id, role)
);
CREATE TABLE public.tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  account_type     text NOT NULL DEFAULT 'standalone'
                   CHECK (account_type IN ('standalone','agency','enterprise','sub_account')),
  parent_tenant_id uuid REFERENCES public.tenants(id),
  features         jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id    uuid,
  slug             text UNIQUE,
  status           text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.tenant_members (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status    text NOT NULL DEFAULT 'active',
  role      text NOT NULL DEFAULT 'member',
  is_owner  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE public.agency_team_members (
  agency_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_role      text,
  status           text NOT NULL DEFAULT 'active',
  PRIMARY KEY (agency_tenant_id, user_id)
);
-- The install node's finalize branch and teardown write/read these; the real
-- table carries more columns — none the marketplace chain touches.
CREATE TABLE public.tenant_knowledge_docs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title     text,
  tags      text[] NOT NULL DEFAULT '{}'
);

-- The tier substrate's real current_tenant_tier reads the subscription tables;
-- minimal faithful shape (seeded EMPTY: no subscription -> tier falls back to the
-- tenants.account_type derivation this shim documents as its divergence).
CREATE TABLE public.platform_subscription_plans (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text NOT NULL,
  name      text,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.platform_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id    uuid REFERENCES public.platform_subscription_plans(id),
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The legacy global journey ladder (20260627213729) the write model migrates
-- clients OFF of; real shape, seeded empty (no clients reference it here).
CREATE TABLE public.paige_journey_stages (
  id            integer PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  label         text NOT NULL,
  description   text,
  display_order integer NOT NULL,
  color_hex     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The legacy transitions table the write model widens (slug columns; to_stage_id
-- nullable); real shape per prod.
CREATE TABLE public.paige_journey_stage_transitions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid,
  from_stage_id  integer REFERENCES public.paige_journey_stages(id),
  to_stage_id    integer REFERENCES public.paige_journey_stages(id),
  transitioned_at timestamptz NOT NULL DEFAULT now(),
  transitioned_by uuid,
  source_event   text,
  metadata       jsonb
);

-- The journey write model (20260802160000) migrates clients.journey_stage_*
-- and reads the clients table; minimal faithful shape (id/tenant/linked user +
-- the legacy stage column the migration migrates from).
CREATE TABLE public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name              text,
  linked_user_id    uuid REFERENCES auth.users(id),
  journey_stage_id  integer,
  journey_stage_slug text
);

-- The publish path's admin-notification write; real column set per prod.
CREATE TABLE public.paige_admin_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity            text,
  title               text,
  body                text,
  link_to             text,
  source_workflow_key text,
  contact_id          uuid,
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  assigned_role       text,
  assigned_user_id    uuid,
  scope               text
);

-- The operator publish seam (20260714192708:129) audit-writes here; the real
-- table carries more columns — none the marketplace chain touches.
CREATE TABLE public.paige_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid,
  actor_role     text,
  action         text,
  target_type    text,
  target_id      uuid,
  payload        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  tenant_id      uuid
);

CREATE OR REPLACE FUNCTION public.is_super_admin(u uuid DEFAULT auth.uid())
 RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT u IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = u AND role IN ('super_admin','platform_admin'))
$$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_super_admin() $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_super_admin(u) $$;
CREATE OR REPLACE FUNCTION public.is_platform_operator(u uuid DEFAULT auth.uid())
 RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_super_admin(u) $$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(t uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = t AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin'))
$$;
CREATE OR REPLACE FUNCTION public.is_tenant_member(t uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = t AND user_id = auth.uid() AND status = 'active')
$$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin_as(_actor uuid, _tenant uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _actor
       AND status = 'active' AND role IN ('owner','admin'))
$$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(u uuid DEFAULT auth.uid())
 RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT u IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = u AND role IN ('super_admin','platform_admin'))
$$;
CREATE OR REPLACE FUNCTION public.agency_team_role(agency uuid, actor uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.tenant_members m
                  WHERE m.tenant_id = agency AND m.user_id = actor AND m.status = 'active' AND m.role = 'owner')
      THEN 'agency_owner'
    ELSE (SELECT atm.agency_role FROM public.agency_team_members atm
            WHERE atm.agency_tenant_id = agency AND atm.user_id = actor AND atm.status = 'active' LIMIT 1)
  END
$$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
 RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULL::uuid $$;  -- every suite call passes tenants explicitly
CREATE OR REPLACE FUNCTION public.current_tenant_tier(_tenant_id uuid DEFAULT public.current_user_tenant_id())
 RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((SELECT CASE lower(account_type)
      WHEN 'enterprise' THEN 'Enterprise'
      WHEN 'agency'     THEN 'Agency'
      ELSE 'Solo' END FROM public.tenants WHERE id = _tenant_id), 'Solo');
END $$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(t uuid)
 RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- ── The REAL Marketplace migration chain, in recorded order ─────────────────
\ir ../migrations/20260714155542_marketplace_registry_spine.sql
\ir ../migrations/20260714160223_marketplace_install_seam.sql
\ir ../migrations/20260714161507_marketplace_seam_hardening.sql
\ir ../migrations/20260714162420_marketplace_list_roadmap.sql
\ir ../migrations/20260714162642_marketplace_catalog_read_membership.sql
\ir ../migrations/20260714180518_marketplace_bundle_refcount_1_schema.sql
\ir ../migrations/20260714180550_marketplace_bundle_refcount_2_finance_guard.sql
\ir ../migrations/20260714180619_marketplace_bundle_refcount_3_helpers.sql
\ir ../migrations/20260714180712_marketplace_bundle_refcount_4_install_node.sql
\ir ../migrations/20260714180743_marketplace_bundle_refcount_5_public_rpcs.sql
\ir ../migrations/20260714181443_marketplace_bundle_refcount_6_hardening.sql
\ir ../migrations/20260714192450_marketplace_operator_seam_1_freeze_and_auth.sql
\ir ../migrations/20260714192625_marketplace_operator_seam_2_upsert_item.sql
\ir ../migrations/20260714192708_marketplace_operator_seam_3_publish_version.sql
\ir ../migrations/20260714192756_marketplace_operator_seam_4_status_setcurrent_featured_default.sql
\ir ../migrations/20260714192837_marketplace_operator_seam_5_deprecate_and_catalog.sql
\ir ../migrations/20260714235406_marketplace_mcp_actor_seam.sql
\ir ../migrations/20260714270000_marketplace_registry_spine.sql
\ir ../migrations/20260714280000_marketplace_install_seam.sql
\ir ../migrations/20260714290000_marketplace_seam_hardening.sql
\ir ../migrations/20260714300000_marketplace_list_roadmap.sql
\ir ../migrations/20260714310000_marketplace_catalog_read_membership.sql
\ir ../migrations/20260714320000_marketplace_kb_playbooks_seed.sql
\ir ../migrations/20260714330000_marketplace_bundle_refcount.sql
\ir ../migrations/20260714340000_marketplace_operator_management_seam.sql
\ir ../migrations/20260725152540_marketplace_vertical_playbooks_seed.sql
\ir ../migrations/20260725190000_marketplace_uninstall_clears_orphan_skill.sql
\ir ../migrations/20260726004746_marketplace_installs_payment_refs.sql
\ir ../migrations/20260802120000_practice_blueprints_slice1_substrate.sql
\ir ../migrations/20260802145000_reconcile_marketplace_publish_allowlist.sql
\ir ../migrations/20260802150000_blueprints_slice2_business_coach_publish.sql
\ir ../migrations/20260802160000_blueprints_slice2_tenant_aware_journey_write_model.sql
\ir ../migrations/20260804120000_marketplace_funding_preset_seed.sql
\ir ../migrations/20260805120000_blueprints_slice3_funding_and_horizontal_publish.sql
\ir ../migrations/20260805140000_fix271_marketplace_table_grants.sql
\ir ../migrations/20260805170000_marketplace_items_tier_metadata_substrate.sql
\ir ../migrations/20260805221722_w272c_agency_preset_academy_enterprise_only.sql
\ir ../migrations/20260805230000_w277_slice1_agency_item_allowlist.sql
-- The candidate under test (this PR's own seed; applied twice below to prove
-- its own replay idempotence — ON CONFLICT DO NOTHING must hold on re-run).
\ir ../migrations/20271020000000_funding_coach_blueprint_bundle_seed.sql
\ir ../migrations/20271020000000_funding_coach_blueprint_bundle_seed.sql

-- ── Fixtures: synthetic only ────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'fcb-owner@synthetic.test'),
  ('00000000-0000-4000-8000-000000000002', 'fcb-a@synthetic.test'),
  ('00000000-0000-4000-8000-000000000003', 'fcb-b@synthetic.test'),
  ('00000000-0000-4000-8000-000000000004', 'fcb-c@synthetic.test'),
  ('00000000-0000-4000-8000-000000000005', 'fcb-d@synthetic.test'),
  ('00000000-0000-4000-8000-000000000006', 'fcb-ag@synthetic.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'platform_admin');  -- the authorized Platform-owner fixture
WITH t AS (
  INSERT INTO public.tenants (id, name, account_type, features)
  VALUES ('10000000-0000-4000-8000-000000000001','FCB Synthetic One','standalone','{}'::jsonb)
  RETURNING id)
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_owner)
SELECT id, '00000000-0000-4000-8000-000000000002', 'owner', true FROM t;
WITH t AS (
  INSERT INTO public.tenants (id, name, account_type, features)
  VALUES ('10000000-0000-4000-8000-000000000002','FCB Synthetic Two','standalone','{}'::jsonb)
  RETURNING id)
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_owner)
SELECT id, '00000000-0000-4000-8000-000000000003', 'owner', true FROM t;
WITH t AS (
  INSERT INTO public.tenants (id, name, account_type, features)
  VALUES ('10000000-0000-4000-8000-000000000003','FCB Synthetic Three','standalone','{}'::jsonb)
  RETURNING id)
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_owner)
SELECT id, '00000000-0000-4000-8000-000000000004', 'owner', true FROM t;
WITH t AS (
  INSERT INTO public.tenants (id, name, account_type, features)
  VALUES ('10000000-0000-4000-8000-000000000004','FCB Grandfathered Funding','standalone',
          jsonb_build_object('playbook','funding','paige_funding_skill','true'))
  RETURNING id)
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_owner)
SELECT id, '00000000-0000-4000-8000-000000000005', 'owner', true FROM t;
WITH t AS (
  INSERT INTO public.tenants (id, name, account_type, features)
  VALUES ('10000000-0000-4000-8000-000000000005','FCB Synthetic Agency','agency','{}'::jsonb)
  RETURNING id)
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_owner)
SELECT id, '00000000-0000-4000-8000-000000000006', 'owner', true FROM t;

-- ═══════════════════════════════════════════════════════════════════════════
SELECT plan(68);

-- ── §1 REGISTRY TRUTH — the candidate is exactly what FCB-2a authorizes ─────
SELECT ok(
  (SELECT count(*)::int FROM public.marketplace_items WHERE slug='funding_coach') = 1,
  '1.1 funding_coach exists exactly once in the registry');
SELECT is(
  (SELECT item_type::text FROM public.marketplace_items WHERE slug='funding_coach'), 'bundle',
  '1.2 it is a BUNDLE (the existing bundling layer — no parallel install system)');
SELECT is(
  (SELECT status FROM public.marketplace_items WHERE slug='funding_coach'), 'unlisted',
  '1.3 it is UNLISTED — invisible in every tenant catalog until the owner publishes (ANT-35)');
SELECT is(
  (SELECT is_finance FROM public.marketplace_items WHERE slug='funding_coach'), true,
  '1.4 it carries the finance flag (opt-in only; the finance guard keeps it off defaults)');
SELECT is(
  (SELECT default_for_new_tenants FROM public.marketplace_items WHERE slug='funding_coach'), false,
  '1.5 never a default for new tenants (§2)');
SELECT is(
  (SELECT (available_to_tiers - 'Agency' - 'Enterprise' - 'Solo') = '[]'::jsonb
     AND jsonb_array_length(available_to_tiers) = 3
   FROM public.marketplace_items WHERE slug='funding_coach'), true,
  '1.6 tier availability is exactly Solo+Agency+Enterprise (matches the funding skill pattern)');
SELECT is(
  (SELECT publish_status FROM public.marketplace_items WHERE slug='funding_coach'), 'approved',
  '1.7 publish_status approved (version published; listing status stays the gate)');
SELECT jis(
  (SELECT v.install_manifest->'bundle_items' FROM public.marketplace_items i
     JOIN public.marketplace_item_versions v ON v.id=i.current_version_id
    WHERE i.slug='funding_coach'), '["funding","funding_preset"]'::jsonb,
  '1.8 it composes the EXISTING funding skill + funding_preset KB pack as children');
SELECT is(
  (SELECT jsonb_array_length(
     (SELECT (fn->'stages') FROM jsonb_array_elements(v.install_manifest->'functions') fn
      WHERE fn->>'kind'='journey_stages' LIMIT 1))
   FROM public.marketplace_items i
     JOIN public.marketplace_item_versions v ON v.id=i.current_version_id
    WHERE i.slug='funding_coach'), 6,
  '1.9 its own manifest carries a six-phase coach journey ladder (existing journey_stages kind)');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_items i
     JOIN public.marketplace_item_versions v ON v.id=i.current_version_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.install_manifest->'functions','[]'::jsonb)) fn
    WHERE i.slug='funding_coach' AND fn->>'kind' NOT IN ('journey_stages'))::int, 0,
  '1.10 the bundle itself introduces NO other install kind (children bring their own)');
SELECT is(
  (SELECT v.payload_class::text FROM public.marketplace_items i
     JOIN public.marketplace_item_versions v ON v.id=i.current_version_id
    WHERE i.slug='funding_coach'), 'config_only',
  '1.11 config_only — zero code, zero provider effects');

-- ── §2 THE UNLISTED DENY — preserved, never weakened ─────────────────────────
SELECT _set_actor('00000000-0000-4000-8000-000000000002');  -- T1 owner, NOT a platform owner
SELECT throws_like(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')$$,
  '42501', '%not available%',
  '2.1 a tenant admin CANNOT install an unlisted item (the preserved denial)');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_catalog_for_tenant('10000000-0000-4000-8000-000000000001')
    WHERE slug='funding_coach'), 0,
  '2.2 the unlisted bundle is INVISIBLE in the tenant catalog');
SELECT _set_actor('00000000-0000-4000-8000-000000000006');  -- agency tenant owner
SELECT throws_like(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000005','funding_coach')$$,
  '42501', '%not available%',
  '2.3 an AGENCY admin is refused identically — unlisted means unlisted for every non-owner');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_catalog_for_tenant('10000000-0000-4000-8000-000000000005')
    WHERE slug='funding_coach'), 0,
  '2.4 …and invisible in the agency catalog too');
SELECT _clear_actor();
SELECT throws_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')$$,
  '42501',
  '2.5 an anonymous caller is refused before anything runs');
SELECT _set_actor('00000000-0000-4000-8000-000000000003');  -- T2 owner
SELECT throws_like(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')$$,
  '42501', '%not authorized%',
  '2.6 cross-tenant denial: T2''s admin cannot install into T1 (wrapper authz, before visibility)');

-- ── §3 OWNER INSTALL — the authorized path fans out correctly ────────────────
SELECT _set_actor('00000000-0000-4000-8000-000000000001');  -- platform_admin fixture
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')$$,
  '3.1 the platform owner installs the bundle cleanly');
SELECT is(
  (public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')
     ->>'already_installed'), 'true',
  '3.2 the re-call is an idempotent no-op (already_installed) — the first call above did the real install');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_installs
    WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND status='active'), 3,
  '3.3 exactly three active installs: bundle + funding + funding_preset');
SELECT is(
  (SELECT bool_and(NOT held_directly) FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000001' AND i.slug IN ('funding','funding_preset')), true,
  '3.4 children are held VIA the bundle (held_directly=false)');
SELECT is(
  (SELECT held_directly FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000001' AND i.slug='funding_coach'), true,
  '3.5 the bundle itself is held directly');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_install_bundle_links
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 2,
  '3.6 two bundle links record the child relationships');
SELECT is(
  (SELECT (features->'enabled_skills') ? 'funding'
   FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000001'), true,
  '3.7 the funding SKILL is enabled by the child install (the funding vertical gate)');
SELECT is(
  (SELECT features->>'playbook' FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000001'), 'funding',
  '3.8 the funding PLAYBOOK preset applied');
SELECT is(
  (SELECT jsonb_array_length(features->'playbook_config'->'portal'->'modules')
   FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000001') >= 6, true,
  '3.9 the preset''s portal modules landed in the tenant''s playbook config');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_journey_stages
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 11,
  '3.10 eleven journey stages: 5 client-pipeline (funding child) + 6 coach phases (bundle)');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_journey_stages js
    JOIN public.marketplace_installs mi ON mi.id=js.source_install_id
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE js.tenant_id='10000000-0000-4000-8000-000000000001' AND i.slug='funding_coach'), 6,
  '3.11 the six coach phases are owned by the BUNDLE install (teardown- attributable)');
SELECT is(
  (SELECT (mi.seeded_refs->>'embedding_pending')::boolean
   FROM public.marketplace_installs mi JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000001' AND i.slug='funding_preset'), true,
  '3.12 funding_preset is DEFERRED_EMBEDDING pending (Knowledge embeds via the edge, as designed)');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_install_ledger
    WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND event_type='install'
      AND gross_cents=0), 3,
  '3.13 three ledger receipts, all zero-gross (free items; children bill zero per the §17 rule)');

-- ── §4 REINSTALL IDEMPOTENCE ────────────────────────────────────────────────
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')$$,
  '4.1 a third install call succeeds (no-op)');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_installs
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 3,
  '4.2 still exactly three install rows (no duplicates)');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_journey_stages
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 11,
  '4.3 still eleven journey stages (no duplicate seeds)');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_install_ledger
    WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND event_type='install'), 3,
  '4.4 no duplicate ledger receipts');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_install_bundle_links
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 2,
  '4.5 no duplicate bundle links');

-- ── §5 DEFERRED EMBEDDING FINALIZE + ORPHAN RECONCILE ───────────────────────
-- (the edge function's KB leg, proven at the DB seam it drives: install node
-- with the winning doc ids reconciles same-tag orphans and clears the pending flag)
SELECT lives_ok(
  $$WITH seeded AS (
     INSERT INTO public.tenant_knowledge_docs (tenant_id, title, tags)
     SELECT '10000000-0000-4000-8000-000000000001', 'FCB doc '||g, ARRAY['marketplace:funding_preset']
       FROM generate_series(1,2) g RETURNING id)
   SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000001','funding_preset',
     ARRAY(SELECT id FROM seeded))$$,
  '5.1 finalize with the winning doc ids completes');
SELECT is(
  (SELECT (mi.seeded_refs->>'embedding_pending')::boolean
   FROM public.marketplace_installs mi JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000001' AND i.slug='funding_preset'), false,
  '5.2 embedding_pending cleared');
SELECT is(
  (SELECT jsonb_array_length(mi.seeded_refs->'kb_doc_ids')
   FROM public.marketplace_installs mi JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000001' AND i.slug='funding_preset'), 2,
  '5.3 the winning doc ids are recorded in seeded_refs');
-- (Orphan-reconcile — the pending→finalize transition deleting stale same-tag
--  docs — is proven in §8.2 on T3, whose funding_preset install is genuinely
--  still PENDING. A re-finalize of a COMPLETED install is already_active and
--  must NOT re-wipe docs; that boundary is the reason the case moved.)

-- ── §6 FULL TEARDOWN — reversible, tenant features restored exactly ─────────
SELECT lives_ok(
  $$SELECT public.uninstall_marketplace_item('10000000-0000-4000-8000-000000000001','funding_coach')$$,
  '6.1 uninstalling the bundle completes');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_installs
    WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND status='active'), 0,
  '6.2 bundle AND both children are uninstalled (no direct holds remained)');
SELECT is(
  (SELECT features FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000001'),
  '{"enabled_skills": []}'::jsonb,
  '6.3 features are pristine: no playbook, no config, no stamps — only set_tenant_skill''s universal empty-array write-back remains (the no-skills representation)');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_journey_stages
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 0,
  '6.4 all journey stages (child pipeline + coach ladder) removed');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_knowledge_docs
    WHERE tenant_id='10000000-0000-4000-8000-000000000001'), 0,
  '6.5 the embedded Knowledge docs were removed with the child');

-- ── §7 SHARED CHILD OWNERSHIP — standalone→bundle (T2) ──────────────────────
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000002','funding')$$,
  '7.1 T2 installs the funding SKILL standalone first');
SELECT is(
  (SELECT held_directly FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000002' AND i.slug='funding'), true,
  '7.2 standalone funding is held directly');
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000002','funding_coach')$$,
  '7.3 T2 then installs the bundle');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_installs
    WHERE tenant_id='10000000-0000-4000-8000-000000000002' AND status='active'), 3,
  '7.4 the bundle ADDED funding_preset; funding itself was not duplicated');
SELECT is(
  (SELECT held_directly FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000002' AND i.slug='funding'), true,
  '7.5 the shared child kept its direct hold');
SELECT is(
  (SELECT count(*)::int FROM public.marketplace_install_bundle_links
    WHERE tenant_id='10000000-0000-4000-8000-000000000002'), 2,
  '7.6 the pre-existing child is linked to the bundle install');
CREATE TEMP TABLE _t2_uninstall_result AS
  SELECT public.uninstall_marketplace_item('10000000-0000-4000-8000-000000000002','funding_coach') AS r;
SELECT is(
  (SELECT r->'children_torn_down' @> '[{"item_slug":"funding","torn_down":false}]'::jsonb
     FROM _t2_uninstall_result), true,
  '7.7 uninstalling the bundle RETAINS the directly-held funding child (children_torn_down carries torn_down:false + retained_holds)');
SELECT is(
  (SELECT mi.status FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000002' AND i.slug='funding'), 'active',
  '7.8 the funding skill install survives the bundle teardown');
SELECT is(
  (SELECT (features->'enabled_skills') ? 'funding'
   FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000002'), true,
  '7.9 the funding entitlement SURVIVES the bundle uninstall (still enabled)');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_journey_stages
    WHERE tenant_id='10000000-0000-4000-8000-000000000002'), 5,
  '7.10 the child-owned pipeline stages remain; only the bundle''s six were removed');

-- ── §8 SHARED CHILD OWNERSHIP — bundle→standalone (T3) ──────────────────────
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000003','funding_coach')$$,
  '8.1 T3 installs the BUNDLE first');
SELECT is(
  (SELECT bool_and(NOT held_directly) FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000003' AND i.slug='funding'), true,
  '8.2 the child starts bundle-held');
-- Deferred-embedding ORPHAN RECONCILE, on T3's genuinely-pending funding_preset:
-- three same-tag docs exist (two winners + one stale); the finalize transition
-- with the winning ids must delete the stale one.
SELECT lives_ok(
  $$INSERT INTO public.tenant_knowledge_docs (tenant_id, title, tags)
   SELECT '10000000-0000-4000-8000-000000000003', 'FCB doc '||g, ARRAY['marketplace:funding_preset']
     FROM generate_series(1,3) g$$,
  '8.2a plant three same-tag docs (two will win, one is stale)');
SELECT lives_ok(
  $$WITH winners AS (
     SELECT array_agg(id) AS ids FROM public.tenant_knowledge_docs
      WHERE tenant_id='10000000-0000-4000-8000-000000000003'
        AND title <> 'FCB doc 3' AND 'marketplace:funding_preset'=ANY(tags))
   SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000003','funding_preset',
     (SELECT ids FROM winners))$$,
  '8.2b finalize the pending child with the winning doc ids');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_knowledge_docs
    WHERE tenant_id='10000000-0000-4000-8000-000000000003'
      AND 'marketplace:funding_preset'=ANY(tags)), 2,
  '8.2c the stale same-tag doc was reconciled away (exactly the winners remain)');
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000003','funding')$$,
  '8.3 T3 then installs the funding skill standalone');
SELECT is(
  (SELECT held_directly FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000003' AND i.slug='funding'), true,
  '8.4 the standalone install UPGRADES the child to directly-held');
SELECT lives_ok(
  $$SELECT public.uninstall_marketplace_item('10000000-0000-4000-8000-000000000003','funding_coach')$$,
  '8.5 T3 uninstalls the bundle');
SELECT is(
  (SELECT mi.status FROM public.marketplace_installs mi
    JOIN public.marketplace_items i ON i.id=mi.item_id
   WHERE mi.tenant_id='10000000-0000-4000-8000-000000000003' AND i.slug='funding'), 'active',
  '8.6 the upgraded child is retained through the bundle teardown');

-- ── §9 GRANDFATHERED FUNDING TENANT — entitlement preserved (T4) ────────────
SELECT lives_ok(
  $$SELECT public.install_marketplace_item('10000000-0000-4000-8000-000000000004','funding_coach')$$,
  '9.1 a grandfathered funding tenant installs the bundle over its existing entitlement');
SELECT is(
  (SELECT (features->>'paige_funding_skill') FROM public.tenants
    WHERE id='10000000-0000-4000-8000-000000000004'), 'true',
  '9.2 its legacy funding marker is untouched by the install');
SELECT lives_ok(
  $$SELECT public.uninstall_marketplace_item('10000000-0000-4000-8000-000000000004','funding_coach')$$,
  '9.3 …and uninstalls it again');
SELECT is(
  (SELECT features->>'playbook' FROM public.tenants
    WHERE id='10000000-0000-4000-8000-000000000004'), 'funding',
  '9.4 the prior playbook slug is RESTORED');
SELECT is(
  (SELECT (features->'enabled_skills') ? 'funding'
     OR features->>'playbook' = 'funding'
     OR (features->>'paige_funding_skill') = 'true'
   FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000004'), true,
  '9.5 the funding_vertical gate (the production COALESCE) is still satisfied — entitlement preserved through the whole cycle');
SELECT is(
  (SELECT jsonb_array_length(features->'playbook_config'->'portal'->'modules')
   FROM public.tenants WHERE id='10000000-0000-4000-8000-000000000004'), NULL,
  '9.6 the preset''s applied config was reversed (no portal modules remain)');

SELECT * FROM finish();
