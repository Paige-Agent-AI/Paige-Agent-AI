-- ============================================================================
-- Ads intake: every lead lands in a pipeline, and one read counts it (owner ruling 2026-10-11).
--
-- Proves what 20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql adds and changes:
--   A  growth_attach_submission_default_deal — the processor's canonical "routed" rule, incl. a form
--      with stale auto_create_deal columns under an enabled non-pipeline automation (UNROUTED).
--   B  growth_attach_inbound_default_deal.
--   C  get_pipeline_lead_funnel — contract v2 (case-folded keys, one row per ad, last-touch outcomes,
--      current stages, unfiled) and its authority (owner/admin, agency acting in, platform owner).
--   D  set_ad_creative_featured — authority, kind, cap of 6 non-archived, archived refused.
--   E  save_marketing_content — ads_featured / ads_featured_at are server-owned (carried, never set).
--   F  _marketing_metric_bundle marketing.forms.unrouted_current — the default pipeline routes a form.
-- against the REAL growth_attach_submission_deal (20270588326001, applied here, never re-implemented)
-- so "a routed form is unchanged" is measured, not assumed.
--
-- IDIOM: supabase/tests/calendar_link_shareable.sql — isolated DB, roles created, a faithful minimal
-- schema, the REAL migrations applied with \ir (the new one twice: clean + replay), then the matrix.
-- The count-enforcing pgTAP shim makes a skipped assertion impossible to pass silently (§39). The
-- whole run is one transaction that ROLLS BACK. Synthetic fixtures only (§2/§63).
--
-- AUTH MODEL (§59): behaviour runs as the suite owner with identity driven only through
-- request.jwt.claims (auth.uid()/auth.jwt()/auth.role()), the active workspace (app.current_tenant) and
-- the platform-owner flag (app.platform_owner), so every refusal here is the FUNCTION BODY's check.
-- agency_can_manage_child is the production body (as supabase/tests/migration_d_studio_authority.sql
-- copies it). The EXECUTE-grant boundary is proven separately with has_function_privilege.
--
-- The main funnel answer is printed on one line prefixed FUNNEL_CONTRACT so the frontend fixture
-- (src/solo/__fixtures__/lead-funnel.contract.json) is a captured real output, not a hand-written one.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'ads_intake_default_pipeline_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated ads_intake_default_pipeline_contract database (got %)', current_database();
  END IF;
END $$;

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET LOCAL timezone='UTC';

-- ── Count-enforcing pgTAP-compatible shim. ───────────────────────────────────
CREATE TABLE _pgtap_state(planned integer NOT NULL, executed integer NOT NULL);
CREATE FUNCTION plan(integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN DELETE FROM _pgtap_state; INSERT INTO _pgtap_state VALUES($1,0); RETURN '1..'||$1; END $$;
CREATE FUNCTION _pgtap_tick() RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE _pgtap_state SET executed=executed+1; IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: no plan set'; END IF; END $$;
CREATE FUNCTION ok(boolean, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', $2; END IF; RETURN 'ok - '||$2; END $$;
CREATE FUNCTION is(anyelement, anyelement, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM $2 THEN RAISE EXCEPTION 'FAIL: %  (got %, expected %)', $3, $1, $2; END IF;
  RETURN 'ok - '||$3; END $$;
CREATE FUNCTION throws_ok(text, text, text, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  BEGIN EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = $2 AND SQLERRM = $3 THEN RETURN 'ok - '||$4; END IF;
    RAISE EXCEPTION 'FAIL: % — got [%] %, wanted [%] %', $4, SQLSTATE, SQLERRM, $2, $3;
  END;
  RAISE EXCEPTION 'FAIL: % — call succeeded, expected [%] %', $4, $2, $3;
END $$;
CREATE FUNCTION finish() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE p integer; e integer;
BEGIN SELECT planned, executed INTO p, e FROM _pgtap_state;
  IF p IS DISTINCT FROM e THEN RAISE EXCEPTION 'FAIL: planned % assertions, executed %', p, e; END IF;
  RETURN NEXT format('ok - all %s assertions executed', e);
END $$;
-- Identity for the next call: a JSON claims object (sub => auth.uid(), role => auth.jwt()->>'role').
CREATE FUNCTION as_claims(jsonb) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', $1::text, true), set_config('app.platform_owner', '', true); $$;
-- A signed-in user working in a workspace ($2); $3 marks the platform owner.
CREATE FUNCTION as_user(uuid, uuid, boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',$1,'role','authenticated')::text, true),
         set_config('app.current_tenant', coalesce($2::text,''), true),
         set_config('app.platform_owner', CASE WHEN $3 THEN 'true' ELSE '' END, true); $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth shim. ───────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role', '') $$;
-- _marketing_metric_bundle digests with extensions.digest (pgcrypto lives in extensions on Supabase).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE FUNCTION extensions.digest(bytea, text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest($1, $2) $$;

-- ── Faithful minimal schema (only the columns the functions under test read/write). ─────────
CREATE TABLE public.tenants (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active',
  parent_tenant_id uuid, account_type text NOT NULL DEFAULT 'standalone');
CREATE TABLE public.tenant_members (
  tenant_id uuid, user_id uuid, role text, status text DEFAULT 'active', joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id));
CREATE TABLE public.agency_team_members (
  agency_tenant_id uuid NOT NULL, user_id uuid NOT NULL, agency_role text NOT NULL,
  status text NOT NULL DEFAULT 'active', scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, active_tenant_id uuid);
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, user_id uuid, entity text, action text, entity_id uuid, data jsonb);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, first_name text, last_name text, entity_name text);
CREATE TABLE public.pipelines (
  id uuid PRIMARY KEY, tenant_id uuid, name text NOT NULL, is_default boolean NOT NULL DEFAULT false,
  lifecycle_status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY, pipeline_id uuid NOT NULL REFERENCES public.pipelines(id), tenant_id uuid,
  label text NOT NULL, order_index integer NOT NULL, stage_type text NOT NULL DEFAULT 'open'
    CHECK (stage_type IN ('open','won','lost')),
  archived_at timestamptz);
CREATE TABLE public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, pipeline_id uuid NOT NULL,
  stage_id uuid, contact_client_id uuid, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  source text, tenant_id uuid, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.growth_forms (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text, status text NOT NULL DEFAULT 'active',
  auto_create_deal boolean NOT NULL DEFAULT false, pipeline_id uuid, stage_id uuid, created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.growth_automation_targets (slug text PRIMARY KEY, executor text NOT NULL, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.growth_form_automations (
  id uuid PRIMARY KEY, form_id uuid NOT NULL, tenant_id uuid NOT NULL, target_slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, config_json jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE public.growth_submission_dispatches (
  submission_id uuid, automation_id uuid, tenant_id uuid, target_slug text, status text, result jsonb, error text,
  UNIQUE (submission_id, automation_id));
CREATE TABLE public.growth_form_submissions (
  id uuid PRIMARY KEY, form_id uuid NOT NULL, tenant_id uuid NOT NULL, contact_id uuid, deal_id uuid,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb, utm_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_state text NOT NULL DEFAULT 'claimed', attempts int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, claimed_at timestamptz);
CREATE TABLE public.marketing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, created_by uuid,
  kind text NOT NULL DEFAULT 'text', channel text, title text NOT NULL DEFAULT 'Untitled', body text,
  image_url text, image_path text, size text, brief text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb);

-- Authority helpers: is_tenant_admin as shipped (20270521000000, minus the company-workspace operator
-- branch these synthetic tenants never take); agency_can_manage_child as production holds it; the active
-- business and platform owner as settings.
CREATE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin')) $$;
CREATE FUNCTION public.agency_can_manage_child(_child uuid, _actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT
    EXISTS (SELECT 1 FROM public.tenants child
      JOIN public.tenants parent    ON parent.id = child.parent_tenant_id
      JOIN public.tenant_members pm ON pm.tenant_id = parent.id AND pm.user_id = _actor
      WHERE child.id = _child AND parent.account_type IN ('agency', 'enterprise')
        AND pm.status = 'active' AND pm.role = 'owner')
    OR EXISTS (SELECT 1 FROM public.tenants child
      JOIN public.tenants parent            ON parent.id = child.parent_tenant_id
      JOIN public.agency_team_members atm   ON atm.agency_tenant_id = parent.id
      WHERE child.id = _child AND parent.account_type IN ('agency', 'enterprise')
        AND atm.user_id = _actor AND atm.status = 'active'
        AND (atm.agency_role IN ('agency_owner','agency_admin','agency_manager')
             OR (atm.agency_role = 'agency_specialist' AND _child = ANY (atm.scoped_subaccounts)))); $$;
CREATE FUNCTION public.agency_can_manage_child(_child uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT public.agency_can_manage_child(_child, auth.uid()); $$;
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.platform_owner', true), '')::boolean, false) $$;
CREATE FUNCTION public.is_direct_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS
$$ SELECT COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated', 'service_role'); $$;

-- ── APPLY THE REAL MIGRATIONS (the new one twice: clean + replay). ───────────
\ir ../migrations/20270588326001_solo_form_deal_identity.sql
\ir ../migrations/20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql
\ir ../migrations/20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql

-- ── Fixtures. A = business with a default pipeline, under agency AG; B = business with none. ──
-- U1 owner of A · U2 plain member of A · U3 owner of B · U4 owner of agency AG (A's parent) · U5 platform owner.
INSERT INTO auth.users(id) VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),('44444444-4444-4444-4444-444444444444'),('55555555-5555-5555-5555-555555555555');
INSERT INTO public.tenants(id,parent_tenant_id,account_type) VALUES
  ('a9000000-0000-0000-0000-0000000000a9',NULL,'agency'),
  ('aaaaaaaa-0000-0000-0000-00000000000a','a9000000-0000-0000-0000-0000000000a9','sub_account'),
  ('bbbbbbbb-0000-0000-0000-00000000000b',NULL,'standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,joined_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','2026-01-01'),
  ('aaaaaaaa-0000-0000-0000-00000000000a','22222222-2222-2222-2222-222222222222','member','2026-01-02'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','33333333-3333-3333-3333-333333333333','owner','2026-01-01'),
  ('a9000000-0000-0000-0000-0000000000a9','44444444-4444-4444-4444-444444444444','owner','2026-01-01');
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a'),
  ('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-00000000000b');
INSERT INTO public.clients(id,tenant_id,first_name,last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','Ana','One'),
  ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','Ben','Two'),
  ('c0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','Cy','Three'),
  ('c0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a','Di','Four'),
  ('c0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','Eve','Five'),
  ('c0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-00000000000a','Fay','Six'),
  ('c0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Bo','Bee');
INSERT INTO public.pipelines(id,tenant_id,name,is_default,created_at) VALUES
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Sales',true,'2026-01-01'),
  ('a0000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Partners',false,'2026-01-02'),
  ('b0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','B pipeline',false,'2026-01-01');
INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,order_index,stage_type,archived_at) VALUES
  ('a1000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Retired',0,'open','2026-02-01'),
  ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','New lead',1,'open',NULL),
  ('a1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Call booked',2,'open',NULL),
  ('a1000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Won',3,'won',NULL),
  ('a1000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Lost',4,'lost',NULL),
  ('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Intro',1,'open',NULL),
  ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','B new',1,'open',NULL);
-- Ben already has an open deal in Sales at "Call booked" — it must never be moved back. Eve's deal is lost.
INSERT INTO public.deals(id,title,pipeline_id,stage_id,contact_client_id,status,source,tenant_id,created_by) VALUES
  ('d0000000-0000-0000-0000-000000000002','Ben deal','a0000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000002','open','manual','aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000005','Eve deal','a0000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000005','lost','manual','aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111');
-- crm_deal is a second target slug whose executor is pipeline_attach: routing is decided by the executor.
INSERT INTO public.growth_automation_targets(slug,executor) VALUES
  ('pipeline_attach','pipeline_attach'),('crm_deal','pipeline_attach'),('notify_team','notify_team');
INSERT INTO public.growth_forms(id,tenant_id,name,auto_create_deal,pipeline_id,stage_id,created_by) VALUES
  ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','Contact us',false,NULL,NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','Partner form',true,'a0000000-0000-0000-0000-0000000000a2',NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','Routed by automation',false,NULL,NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','B form',false,NULL,NULL,'33333333-3333-3333-3333-333333333333'),
  ('f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','Alerts only',false,NULL,NULL,'11111111-1111-1111-1111-111111111111'),
  -- Stale intake columns under an ENABLED non-pipeline automation: the processor ignores the columns.
  ('f0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-00000000000a','Stale columns',true,'a0000000-0000-0000-0000-0000000000a2',NULL,'11111111-1111-1111-1111-111111111111'),
  -- Intake columns with only a DISABLED automation: the columns still route it.
  ('f0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-00000000000a','Columns, automation off',true,'a0000000-0000-0000-0000-0000000000a2',NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-00000000000a','Routed by crm_deal',false,NULL,NULL,'11111111-1111-1111-1111-111111111111');
INSERT INTO public.growth_form_automations(id,form_id,tenant_id,target_slug,enabled,config_json) VALUES
  ('aa000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','pipeline_attach',true,'{"pipeline_id":"a0000000-0000-0000-0000-0000000000a2"}'),
  ('aa000000-0000-0000-0000-000000000005','f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','notify_team',true,'{}'),
  ('aa000000-0000-0000-0000-000000000006','f0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-00000000000a','notify_team',true,'{}'),
  ('aa000000-0000-0000-0000-000000000008','f0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-00000000000a','notify_team',false,'{}'),
  ('aa000000-0000-0000-0000-000000000009','f0000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-00000000000a','crm_deal',true,'{}');
INSERT INTO public.growth_form_submissions(id,form_id,tenant_id,contact_id,payload_json,utm_json,created_at) VALUES
  ('e0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','{"name":"Ana One"}','{"utm_campaign":"spring","utm_content":"adA"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','{"name":"Ben Two"}','{"utm_campaign":"spring","utm_content":"adB"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000004','{"name":"Di Four"}','{"utm_campaign":"spring"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000004','{}','{}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000005','f0000000-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-0000000000b1','{}','{}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000006','f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','{"name":"Ana again"}','{"utm_campaign":" Spring ","utm_content":"ADA"}','2026-10-02'),
  ('e0000000-0000-0000-0000-000000000007','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','{}','{"utm_campaign":"old","utm_content":"adC"}','2020-01-01'),
  ('e0000000-0000-0000-0000-000000000010','f0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000006','{"name":"Fay Six"}','{}','2026-10-06'),
  ('e0000000-0000-0000-0000-000000000012','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',NULL,'{}','{"utm_campaign":"spring"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000017','f0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000004','{}','{}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000018','f0000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000004','{}','{}','2026-10-01');
-- Library: seven A images (ac…01–07), an A text item (ac…08), an archived A image (ac…09), B's video.
INSERT INTO public.marketing_content(id,tenant_id,kind,image_url,meta)
  SELECT ('ac000000-0000-0000-0000-00000000000'||n)::uuid,'aaaaaaaa-0000-0000-0000-00000000000a','image',
         'https://cdn.example.invalid/creative-'||n||'.png',
         CASE WHEN n=1 THEN '{"keep":1}'::jsonb ELSE '{}'::jsonb END FROM generate_series(1,7) n;
INSERT INTO public.marketing_content(id,tenant_id,kind,status,image_url) VALUES
  ('ac000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-00000000000a','text','draft',NULL),
  ('ac000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-00000000000a','image','archived','https://cdn.example.invalid/creative-9.png'),
  ('ac000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','video','draft',NULL);

SELECT plan(100);

-- ── EXECUTE grants (the grant is not the guard, but it must not widen either). ──
SELECT ok(NOT has_function_privilege('anon','public.growth_attach_submission_default_deal(uuid,integer)','EXECUTE'), 'A: anon cannot execute');
SELECT ok(NOT has_function_privilege('authenticated','public.growth_attach_submission_default_deal(uuid,integer)','EXECUTE'), 'A: authenticated cannot execute');
SELECT ok(has_function_privilege('service_role','public.growth_attach_submission_default_deal(uuid,integer)','EXECUTE'), 'A: service_role executes');
SELECT ok(NOT has_function_privilege('authenticated','public.growth_attach_inbound_default_deal(uuid,uuid,text)','EXECUTE'), 'B: authenticated cannot execute');
SELECT ok(has_function_privilege('service_role','public.growth_attach_inbound_default_deal(uuid,uuid,text)','EXECUTE'), 'B: service_role executes');
SELECT ok(NOT has_function_privilege('anon','public.get_pipeline_lead_funnel(uuid,timestamptz)','EXECUTE'), 'C: anon cannot execute');
SELECT ok(has_function_privilege('authenticated','public.get_pipeline_lead_funnel(uuid,timestamptz)','EXECUTE'), 'C: authenticated executes');
SELECT ok(NOT has_function_privilege('anon','public.set_ad_creative_featured(uuid,boolean)','EXECUTE'), 'D: anon cannot execute');
SELECT ok(has_function_privilege('authenticated','public.set_ad_creative_featured(uuid,boolean)','EXECUTE'), 'D: authenticated executes');
SELECT ok(NOT has_function_privilege('anon','public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)','EXECUTE'), 'E: save_marketing_content: anon still cannot execute');
SELECT ok(has_function_privilege('authenticated','public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)','EXECUTE'), 'E: save_marketing_content: authenticated + service_role still execute');
SELECT is((SELECT prosecdef::text||'|'||pg_get_function_result(oid) FROM pg_proc WHERE oid='public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)'::regprocedure),
  'true|uuid','E: save_marketing_content: same signature, SECURITY DEFINER, returns uuid');
SELECT ok(NOT has_function_privilege('authenticated','public._marketing_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb)','EXECUTE')
      AND NOT has_function_privilege('anon','public._marketing_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb)','EXECUTE'), 'F: _marketing_metric_bundle still has no caller grant');

-- ── A: unrouted form → default pipeline, first open (non-archived) stage. ──
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000001',1)$$,
  '42501','FORM_DEAL_INTERNAL_ONLY','A: a signed-in user is refused in the body');
SELECT as_claims('{"role":"service_role"}');
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000001',2)$$,
  '40001','FORM_DEAL_STALE_CLAIM','A: a stale claim attempt is refused');
CREATE TEMP TABLE r1 AS SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000001',1) AS r;
SELECT is((SELECT r->>'stage_id' FROM r1),'a1000000-0000-0000-0000-000000000001','A: unrouted lead lands on the first open stage, skipping the archived one');
SELECT is((SELECT (r->>'default_pipeline')::boolean FROM r1),true,'A: result says default_pipeline');
SELECT is((SELECT pipeline_id::text||'|'||source||'|'||title||'|'||created_by FROM public.deals WHERE id=(SELECT (r->>'deal_id')::uuid FROM r1)),
  'a0000000-0000-0000-0000-0000000000a1|paige_form|Ana One|11111111-1111-1111-1111-111111111111','A: deal is in the default pipeline, source paige_form, title + creator rule');
SELECT is((SELECT deal_id FROM public.growth_form_submissions WHERE id='e0000000-0000-0000-0000-000000000001'),(SELECT (r->>'deal_id')::uuid FROM r1),'A: submission is bound to its deal');
CREATE TEMP TABLE r1b AS SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000001',1) AS r;
SELECT is((SELECT r->>'deal_id' FROM r1b),(SELECT r->>'deal_id' FROM r1),'A: replay returns the same deal');
SELECT is((SELECT (r->>'replayed')::boolean FROM r1b),true,'A: replay says replayed');
SELECT is((SELECT count(*)::int FROM public.deals WHERE contact_client_id='c0000000-0000-0000-0000-000000000001'),1,'A: replay never makes a second deal');
-- A second form lead for Ana (alerts-only form: its automation is not a deal route) reuses her open deal.
CREATE TEMP TABLE r6 AS SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000006',1) AS r;
SELECT is((SELECT r->>'deal_id' FROM r6),(SELECT r->>'deal_id' FROM r1),'A: a non-deal automation does not make a form routed; the open deal is reused');
-- Ben's open deal at "Call booked" is reused and not moved.
CREATE TEMP TABLE r2 AS SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000002',1) AS r;
SELECT is((SELECT r->>'deal_id' FROM r2),'d0000000-0000-0000-0000-000000000002','A: the contact''s existing open deal is reused');
SELECT is((SELECT stage_id::text FROM public.deals WHERE id='d0000000-0000-0000-0000-000000000002'),'a1000000-0000-0000-0000-000000000002','A: the existing open deal is NOT moved');
-- The canonical routed rule (the processor's): routed forms refuse the default, and keep their own route.
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000003',1)$$,
  '42501','FORM_DEAL_ROUTE_INVALID','A: a form routed by its own columns (no automation) is refused');
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000004',1)$$,
  '42501','FORM_DEAL_ROUTE_INVALID','A: a form routed by a pipeline_attach automation is refused');
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000018',1)$$,
  '42501','FORM_DEAL_ROUTE_INVALID','A: a form routed by another slug whose executor is pipeline_attach is refused');
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000017',1)$$,
  '42501','FORM_DEAL_ROUTE_INVALID','A: intake columns with only a DISABLED automation still route the form (refused)');
-- Stale columns under an enabled non-pipeline automation route nothing: the lead takes the default pipeline.
CREATE TEMP TABLE r10 AS SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000010',1) AS r;
SELECT is((SELECT d.pipeline_id::text||'|'||d.stage_id||'|'||d.title FROM public.deals d WHERE d.id=(SELECT (r->>'deal_id')::uuid FROM r10)),
  'a0000000-0000-0000-0000-0000000000a1|a1000000-0000-0000-0000-000000000001|Fay Six','A: stale auto_create_deal columns under an enabled non-pipeline automation are UNROUTED -> default pipeline');
CREATE TEMP TABLE r3 AS SELECT public.growth_attach_submission_deal('e0000000-0000-0000-0000-000000000003',1,NULL) AS r;
SELECT is((SELECT d.pipeline_id::text||'|'||d.stage_id FROM public.deals d WHERE d.id=(SELECT (r->>'deal_id')::uuid FROM r3)),
  'a0000000-0000-0000-0000-0000000000a2|a2000000-0000-0000-0000-000000000001','A: routed form unchanged — growth_attach_submission_deal still files to its own pipeline');
-- No default pipeline: skipped, nothing written.
CREATE TEMP TABLE r5 AS SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000005',1) AS r;
SELECT is((SELECT r FROM r5),'{"skipped":"no_default_pipeline"}'::jsonb,'A: no default pipeline -> skipped, not an error');
SELECT ok((SELECT deal_id IS NULL FROM public.growth_form_submissions WHERE id='e0000000-0000-0000-0000-000000000005'),'A: skipped writes no deal binding');
SELECT is((SELECT count(*)::int FROM public.deals WHERE tenant_id='bbbbbbbb-0000-0000-0000-00000000000b'),0,'A: skipped makes no deal');

-- ── B: external source with no target form. ──
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT throws_ok($$SELECT public.growth_attach_inbound_default_deal('aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003','external:webflow')$$,
  '42501','INBOUND_DEAL_INTERNAL_ONLY','B: a signed-in user is refused in the body');
SELECT as_claims('{"role":"service_role"}');
CREATE TEMP TABLE b1 AS SELECT public.growth_attach_inbound_default_deal('aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003','external:webflow') AS r;
SELECT is((SELECT (r->>'created')::boolean FROM b1),true,'B: a new deal is created');
SELECT is((SELECT d.stage_id::text||'|'||d.source||'|'||d.title FROM public.deals d WHERE d.id=(SELECT (r->>'deal_id')::uuid FROM b1)),
  'a1000000-0000-0000-0000-000000000001|external:webflow|Cy Three','B: default pipeline first open stage, source kept, client name as title');
CREATE TEMP TABLE b2 AS SELECT public.growth_attach_inbound_default_deal('aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003','external:webflow') AS r;
SELECT is((SELECT r->>'deal_id' FROM b2)||(SELECT r->>'created' FROM b2),(SELECT r->>'deal_id' FROM b1)||'false','B: repeat reuses the open deal (created=false)');
CREATE TEMP TABLE b3 AS SELECT public.growth_attach_inbound_default_deal('aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002',NULL) AS r;
SELECT is((SELECT (r->>'deal_id')||(r->>'stage_id') FROM b3),'d0000000-0000-0000-0000-000000000002a1000000-0000-0000-0000-000000000002','B: an existing open deal is reused and not moved');
SELECT throws_ok($$SELECT public.growth_attach_inbound_default_deal('aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000b1','external:x')$$,
  '42501','INBOUND_DEAL_CLIENT_INVALID','B: another business''s contact is refused');
SELECT is(public.growth_attach_inbound_default_deal('bbbbbbbb-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-0000000000b1','external:x'),
  '{"skipped":"no_default_pipeline"}'::jsonb,'B: no default pipeline -> skipped');

-- Cy's inbound deal is won. Cy came in twice more by form: first under "fall" (adC), then under "Spring"
-- tagged with a library image's id in capitals — the LAST touch. Ben's later lead is tagged with a text
-- item's id; Eve's lost deal came from "Fall"/adC; an archived image's id tags one of Ana's earlier leads.
UPDATE public.deals SET status='won', stage_id='a1000000-0000-0000-0000-000000000003'
 WHERE id=(SELECT (r->>'deal_id')::uuid FROM b1);
INSERT INTO public.growth_form_submissions(id,form_id,tenant_id,contact_id,deal_id,utm_json,processing_state,created_at) VALUES
  ('e0000000-0000-0000-0000-000000000008','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003',(SELECT (r->>'deal_id')::uuid FROM b1),'{"utm_campaign":" fall ","utm_content":"adC"}','done','2026-10-03'),
  ('e0000000-0000-0000-0000-000000000009','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003',(SELECT (r->>'deal_id')::uuid FROM b1),'{"utm_campaign":"  "}','done','2026-10-03'),
  ('e0000000-0000-0000-0000-000000000011','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003',(SELECT (r->>'deal_id')::uuid FROM b1),'{"utm_campaign":"Spring","utm_content":"AC000000-0000-0000-0000-000000000002"}','done','2026-10-04'),
  ('e0000000-0000-0000-0000-000000000013','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000005','{"utm_campaign":"Fall","utm_content":"adC"}','done','2026-10-05'),
  ('e0000000-0000-0000-0000-000000000015','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','{"utm_campaign":"spring","utm_content":"ac000000-0000-0000-0000-000000000008"}','done','2026-10-02'),
  ('e0000000-0000-0000-0000-000000000016','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001',(SELECT (r->>'deal_id')::uuid FROM r1),'{"utm_content":"ac000000-0000-0000-0000-000000000009"}','done','2026-10-01 12:00');
UPDATE public.growth_form_submissions SET deal_id=(SELECT (r->>'deal_id')::uuid FROM r1) WHERE id='e0000000-0000-0000-0000-000000000007';

-- ── C: the lead funnel (contract v2). ──
-- Sales now holds Ana (New lead), Fay (New lead), Ben (Call booked), Cy (Won), Eve (Lost).
-- Form leads bound to Sales: e1 e6 e7 e16 (Ana), e2 e15 (Ben), e8 e9 e11 (Cy), e13 (Eve), e10 (Fay).
-- Unfiled (no deal): e4, e12, e17, e18. e3 is in Partners; e5 is B's.
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
CREATE TEMP TABLE f1 AS SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1') AS r;
SELECT 'FUNNEL_CONTRACT '||(SELECT r::text FROM f1);
SELECT is((SELECT r->'pipeline' FROM f1),'{"id":"a0000000-0000-0000-0000-0000000000a1","name":"Sales","is_default":true}'::jsonb,'C: pipeline header');
SELECT is((SELECT r->>'stages_window' FROM f1),'current','C: stages_window says the stage counts are current');
SELECT is((SELECT jsonb_agg(jsonb_build_array(s->>'name',(s->>'deals')::int,s->>'stage_type') ORDER BY i) FROM f1, jsonb_array_elements(r->'stages') WITH ORDINALITY e(s,i)),
  '[["New lead",2,"open"],["Call booked",1,"open"],["Won",1,"won"],["Lost",1,"lost"]]'::jsonb,'C: deals counted per current stage, archived stage omitted, in order');
SELECT is((SELECT r->'leads' FROM f1),'{"total":11,"tagged":9,"untagged":2,"unfiled":4}'::jsonb,
  'C: leads total/tagged/untagged; blank tag is untagged; Partners and B leads excluded; unfiled = this business''s submissions with no deal');
SELECT is((SELECT jsonb_agg(c->>'campaign' ORDER BY i) FROM f1, jsonb_array_elements(r->'campaigns') WITH ORDINALITY e(c,i)),'["Spring","Fall","old"]'::jsonb,
  'C: campaign keys fold case and whitespace; each shows its most recent spelling; ordered won desc, leads desc');
SELECT is((SELECT c - 'campaign' FROM f1, jsonb_array_elements(r->'campaigns') c WHERE c->>'campaign'='Spring'),
  '{"leads":5,"open":2,"won":1,"lost":0,"by_stage":{"a1000000-0000-0000-0000-000000000001":1,"a1000000-0000-0000-0000-000000000002":1,"a1000000-0000-0000-0000-000000000003":1}}'::jsonb,
  'C: Spring = 5 leads; last-touch deals: Ana + Ben open, Cy won');
SELECT is((SELECT c - 'campaign' FROM f1, jsonb_array_elements(r->'campaigns') c WHERE c->>'campaign'='Fall'),
  '{"leads":2,"open":0,"won":0,"lost":1,"by_stage":{"a1000000-0000-0000-0000-000000000004":1}}'::jsonb,
  'C: LAST TOUCH — Cy''s won deal is not counted under Fall, where he touched first; Eve''s lost deal is');
SELECT is((SELECT sum((c->>'won')::int)::int FROM f1, jsonb_array_elements(r->'campaigns') c),1,'C: won across campaigns sums to the one won deal');
SELECT is((SELECT jsonb_agg(jsonb_build_array(a->>'ad',a->>'campaign',(a->>'leads')::int,(a->>'open')::int,(a->>'won')::int,(a->>'lost')::int) ORDER BY i) FROM f1, jsonb_array_elements(r->'ads') WITH ORDINALITY e(a,i)),
  '[["AC000000-0000-0000-0000-000000000002","Spring",1,0,1,0],["adC","Fall",3,0,0,1],["ADA","Spring",2,1,0,0],["ac000000-0000-0000-0000-000000000008","Spring",1,1,0,0],["ac000000-0000-0000-0000-000000000009",null,1,0,0,0],["adB","Spring",1,0,0,0]]'::jsonb,
  'C: one row per ad across campaigns (adC under Fall and old); campaign = most leads; last-touch outcomes; ordered');
SELECT is((SELECT sum((a->>'open')::int)::int||'|'||sum((a->>'won')::int)||'|'||sum((a->>'lost')::int) FROM f1, jsonb_array_elements(r->'ads') a),'2|1|1',
  'C: ad outcomes sum to the tagged deals (2 open, 1 won, 1 lost)');
SELECT is((SELECT jsonb_build_object('content_id',a->'content_id','kind',a->'kind','image_url',a->'image_url') FROM f1, jsonb_array_elements(r->'ads') a WHERE a->>'ad'='AC000000-0000-0000-0000-000000000002'),
  '{"content_id":"ac000000-0000-0000-0000-000000000002","kind":"image","image_url":"https://cdn.example.invalid/creative-2.png"}'::jsonb,
  'C: an ad tagged with a library image id (any case) carries content_id, kind and image_url');
SELECT is((SELECT jsonb_agg(a->'content_id' ORDER BY a->>'ad') FROM f1, jsonb_array_elements(r->'ads') a WHERE a->>'ad' IN ('ac000000-0000-0000-0000-000000000008','ac000000-0000-0000-0000-000000000009','adB')),
  '[null,null,null]'::jsonb,'C: a text item, an archived image and a plain tag carry no content_id');
CREATE TEMP TABLE f2 AS SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1','2026-01-01') AS r;
SELECT is((SELECT (r->'leads'->>'total')::int FROM f2),10,'C: p_since filters submissions by created_at');
SELECT ok((SELECT NOT (r->'campaigns') @> '[{"campaign":"old"}]' FROM f2),'C: the 2020 lead is outside the window');
SELECT is((SELECT (a->>'leads')::int FROM f2, jsonb_array_elements(r->'ads') a WHERE a->>'ad'='adC'),2,'C: the windowed ad loses its 2020 lead');
SELECT is((SELECT r->'stages' FROM f2),(SELECT r->'stages' FROM f1),'C: stages are current, never windowed');
SELECT is((SELECT r->>'since' FROM f2),(SELECT to_jsonb('2026-01-01'::timestamptz)#>>'{}'),'C: since is echoed');
-- Authority: owner/admin, the agency working in the business, the platform owner. Nobody else.
SELECT as_user('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: a plain member of the business is refused');
SELECT as_user('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT is((SELECT (public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')->'leads'->>'total')::int),11,'C: the agency owner working in the business reads it');
SELECT as_user('44444444-4444-4444-4444-444444444444','a9000000-0000-0000-0000-0000000000a9');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: the agency owner NOT working in the business is refused');
SELECT as_user('55555555-5555-5555-5555-555555555555',NULL,true);
SELECT is((SELECT (public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')->'leads'->>'total')::int),11,'C: the platform owner reads it');
SELECT as_user('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: another business''s owner is refused');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000ff')$$,'42501','PIPELINE_FORBIDDEN','C: a missing pipeline refuses the same way');
-- The business's own owner, while working in ANOTHER workspace, is refused: a retained pipeline id never
-- reads a business that is not the caller's active one (the Marketing metric bundle's binding).
SELECT as_user('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: the owner working in another workspace is refused');
SELECT as_claims('{}');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: no signed-in caller is refused');

-- ── D: featured creatives. ──
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT is((SELECT count(*)::int FROM generate_series(1,6) n
            WHERE (public.set_ad_creative_featured(('ac000000-0000-0000-0000-00000000000'||n)::uuid,true)->>'featured')::boolean),6,'D: an owner features six creatives');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000007',true)$$,'22023','AD_FEATURED_LIMIT','D: the seventh is refused');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',true)->>'featured','true','D: re-featuring one already featured is not counted against itself');
SELECT is((SELECT meta->>'keep' FROM public.marketing_content WHERE id='ac000000-0000-0000-0000-000000000001'),'1','D: other meta keys survive');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000008',true)$$,'22023','AD_CREATIVE_KIND_INVALID','D: a text item is refused');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000009',true)$$,'22023','AD_CREATIVE_ARCHIVED','D: an archived image cannot be featured');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-0000000000b1',true)$$,'42501','AD_CREATIVE_FORBIDDEN','D: another business''s creative is refused');
-- An archived featured item no longer holds a slot.
UPDATE public.marketing_content SET status='archived' WHERE id='ac000000-0000-0000-0000-000000000006';
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000007',true)->>'featured','true','D: archiving a featured item frees its slot (the cap counts non-archived only)');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000006',false),'{"id":"ac000000-0000-0000-0000-000000000006","featured":false}'::jsonb,'D: an archived item can still be unfeatured');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',false),'{"id":"ac000000-0000-0000-0000-000000000001","featured":false}'::jsonb,'D: unfeature returns the contract shape');
SELECT as_user('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000002',false)$$,'42501','AD_CREATIVE_FORBIDDEN','D: a plain member is refused');
SELECT as_user('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000002',true)$$,'42501','AD_CREATIVE_FORBIDDEN','D: the owner working in another workspace is refused');
SELECT as_user('44444444-4444-4444-4444-444444444444','a9000000-0000-0000-0000-0000000000a9');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',true)$$,'42501','AD_CREATIVE_FORBIDDEN','D: the agency owner NOT working in the business is refused');
SELECT as_user('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',true)->>'featured','true','D: the agency owner working in the business features (save_marketing_content''s agency arm)');
SELECT as_user('55555555-5555-5555-5555-555555555555',NULL,true);
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',false)->>'featured','false','D: the platform owner unfeatures');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',true)->>'featured','true','D: the platform owner features');
SELECT as_claims('{}');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',true)$$,'42501','AD_CREATIVE_FORBIDDEN','D: no signed-in caller is refused');

-- ── E: save_marketing_content cannot set or drop the featured flag. ──
-- ac…01 is featured (by the platform owner above); ac…02 is featured; ac…03 will be unfeatured first.
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
CREATE TEMP TABLE before_save AS SELECT meta FROM public.marketing_content WHERE id='ac000000-0000-0000-0000-000000000001';
SELECT is(public.save_marketing_content('image','Renamed',p_meta=>'{"keep":2,"ads_featured":false,"ads_featured_at":"1999-01-01"}'::jsonb,p_id=>'ac000000-0000-0000-0000-000000000001'),
  'ac000000-0000-0000-0000-000000000001'::uuid,'E: an owner re-saves a featured image with a caller meta that tries to unfeature it');
SELECT is((SELECT (meta->'ads_featured')::text||'|'||(meta->>'ads_featured_at')||'|'||(meta->>'keep') FROM public.marketing_content WHERE id='ac000000-0000-0000-0000-000000000001'),
  'true|'||(SELECT meta->>'ads_featured_at' FROM before_save)||'|2','E: re-save keeps ads_featured and ads_featured_at from the row; other caller keys apply');
SELECT is(public.save_marketing_content('image','Again',p_meta=>'{}'::jsonb,p_id=>'ac000000-0000-0000-0000-000000000001'),'ac000000-0000-0000-0000-000000000001'::uuid,'E: a re-save with an empty meta');
SELECT is((SELECT meta->>'ads_featured' FROM public.marketing_content WHERE id='ac000000-0000-0000-0000-000000000001'),'true','E: an empty-meta re-save cannot drop the feature');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000003',false)->>'featured','false','E: setup — ac…03 unfeatured');
SELECT is(public.save_marketing_content('image','Sneak',p_meta=>'{"ads_featured":true}'::jsonb,p_id=>'ac000000-0000-0000-0000-000000000003'),'ac000000-0000-0000-0000-000000000003'::uuid,'E: a re-save that tries to feature');
SELECT is((SELECT meta->>'ads_featured' FROM public.marketing_content WHERE id='ac000000-0000-0000-0000-000000000003'),'false','E: save cannot feature an existing item');
CREATE TEMP TABLE new_item AS SELECT public.save_marketing_content('image','New',p_image_url=>'https://cdn.example.invalid/new.png',
  p_meta=>'{"note":"x","ads_featured":true,"ads_featured_at":"2026-10-01"}'::jsonb) AS id;
SELECT is((SELECT meta FROM public.marketing_content WHERE id=(SELECT id FROM new_item)),'{"note":"x"}'::jsonb,'E: save cannot create an item already featured (keys stripped on insert)');
SELECT is((SELECT count(*)::int FROM public.marketing_content WHERE tenant_id='aaaaaaaa-0000-0000-0000-00000000000a' AND status<>'archived' AND meta->>'ads_featured'='true'),5,
  'E: the featured set is exactly what set_ad_creative_featured made it');
SELECT as_user('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT throws_ok($$SELECT public.save_marketing_content('image','x',p_id=>'ac000000-0000-0000-0000-000000000002')$$,'42501',
  'CONTENT_FORBIDDEN: the workspace owner or an admin is required','E: save_marketing_content authority unchanged (a plain member is refused)');

-- ── F: marketing.forms.unrouted_current — a form is unrouted only when its lead reaches no pipeline. ──
-- A has a default pipeline with an open stage, so every live A form's lead lands somewhere.
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT is((SELECT (b#>>'{values,count}')||'|'||(b#>>'{coverage,contributing_count}') FROM (SELECT public._marketing_metric_bundle('aaaaaaaa-0000-0000-0000-00000000000a','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x),
  '0|7','F: A with a usable default pipeline: 0 of 7 live forms unrouted');
-- Without a usable default (archived), only forms with no own route are unrouted: Contact us, Alerts only, Stale columns.
UPDATE public.pipelines SET lifecycle_status='archived' WHERE id='a0000000-0000-0000-0000-0000000000a1';
SELECT is((SELECT (b#>>'{values,count}') FROM (SELECT public._marketing_metric_bundle('aaaaaaaa-0000-0000-0000-00000000000a','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x),
  '3','F: default pipeline archived: the 3 forms with no own route (incl. stale columns under an automation) are unrouted; crm_deal (executor) and columns-with-disabled-automation are routed');
UPDATE public.pipelines SET lifecycle_status='active' WHERE id='a0000000-0000-0000-0000-0000000000a1';
SELECT as_user('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT is((SELECT (b#>>'{values,count}') FROM (SELECT public._marketing_metric_bundle('bbbbbbbb-0000-0000-0000-00000000000b','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x),
  '1','F: B with no default pipeline: its form is unrouted');
UPDATE public.pipelines SET is_default=true WHERE id='b0000000-0000-0000-0000-0000000000b1';
UPDATE public.pipeline_stages SET archived_at=now() WHERE id='b1000000-0000-0000-0000-000000000001';
SELECT is((SELECT (b#>>'{values,count}') FROM (SELECT public._marketing_metric_bundle('bbbbbbbb-0000-0000-0000-00000000000b','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x),
  '1','F: a default pipeline whose only open stage is archived routes nothing');
UPDATE public.pipeline_stages SET archived_at=NULL WHERE id='b1000000-0000-0000-0000-000000000001';
SELECT is((SELECT (b#>>'{values,count}')||'|'||(b->>'truth_state') FROM (SELECT public._marketing_metric_bundle('bbbbbbbb-0000-0000-0000-00000000000b','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x),
  '0|LIVE','F: a default pipeline with an open stage routes the form');
SELECT is((SELECT (b#>>'{values,count}') FROM (SELECT public._marketing_metric_bundle('bbbbbbbb-0000-0000-0000-00000000000b','marketing.capture_points.published_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x),
  '1','F: live forms (capture points) unchanged');
SELECT throws_ok($$SELECT public._marketing_metric_bundle('aaaaaaaa-0000-0000-0000-00000000000a','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}')$$,
  '42501','MARKETING_METRIC_UNAVAILABLE','F: the bundle''s own authority gate is unchanged (B''s owner cannot read A)');

SELECT * FROM finish();
ROLLBACK;
