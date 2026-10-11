-- ============================================================================
-- Ads intake: every lead lands in a pipeline, and one read counts it (owner ruling 2026-10-11).
--
-- Proves the four functions added by
--   20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql
-- against the REAL growth_attach_submission_deal (20270588326001, applied here, never re-implemented)
-- so "a routed form is unchanged" is measured, not assumed.
--
-- IDIOM: supabase/tests/calendar_link_shareable.sql — isolated DB, roles created, a faithful minimal
-- schema, the REAL migrations applied with \ir (the new one twice: clean + replay), then the matrix.
-- The count-enforcing pgTAP shim makes a skipped assertion impossible to pass silently (§39). The
-- whole run is one transaction that ROLLS BACK. Synthetic fixtures only (§2/§63).
--
-- AUTH MODEL (§59): behaviour runs as the suite owner with identity driven only through
-- request.jwt.claims (auth.uid()/auth.jwt()), so every refusal here is the FUNCTION BODY's check.
-- The EXECUTE-grant boundary is proven separately with has_function_privilege.
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
  SELECT set_config('request.jwt.claims', $1::text, true); $$;
CREATE FUNCTION as_user(uuid, uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',$1,'role','authenticated')::text, true),
         set_config('app.current_tenant', coalesce($2::text,''), true); $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth shim. ───────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;

-- ── Faithful minimal schema (only the columns the functions under test read/write). ─────────
CREATE TABLE public.tenants (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.tenant_members (
  tenant_id uuid, user_id uuid, role text, status text DEFAULT 'active', joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id));
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
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text, auto_create_deal boolean NOT NULL DEFAULT false,
  pipeline_id uuid, stage_id uuid, created_by uuid);
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
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.marketing_content (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, kind text NOT NULL DEFAULT 'text', status text NOT NULL DEFAULT 'draft',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb);

-- Authority helpers: is_tenant_admin as shipped (20270521000000, minus the company-workspace operator
-- branch these synthetic tenants never take); the active business and platform owner as settings.
CREATE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin')) $$;
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.platform_owner', true), '')::boolean, false) $$;

-- ── APPLY THE REAL MIGRATIONS (the new one twice: clean + replay). ───────────
\ir ../migrations/20270588326001_solo_form_deal_identity.sql
\ir ../migrations/20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql
\ir ../migrations/20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql

-- ── Fixtures. A = business with a default pipeline; B = business with none. ──
INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333');
INSERT INTO public.tenants(id) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a'),('bbbbbbbb-0000-0000-0000-00000000000b');
INSERT INTO public.tenant_members(tenant_id,user_id,role,joined_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','2026-01-01'),
  ('aaaaaaaa-0000-0000-0000-00000000000a','22222222-2222-2222-2222-222222222222','member','2026-01-02'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','33333333-3333-3333-3333-333333333333','owner','2026-01-01');
INSERT INTO public.clients(id,tenant_id,first_name,last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','Ana','One'),
  ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','Ben','Two'),
  ('c0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','Cy','Three'),
  ('c0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a','Di','Four'),
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
-- Ben already has an open deal in Sales at "Call booked" — it must never be moved back.
INSERT INTO public.deals(id,title,pipeline_id,stage_id,contact_client_id,status,source,tenant_id,created_by) VALUES
  ('d0000000-0000-0000-0000-000000000002','Ben deal','a0000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000002','open','manual','aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111');
INSERT INTO public.growth_automation_targets(slug,executor) VALUES ('pipeline_attach','pipeline_attach'),('notify_team','notify_team');
INSERT INTO public.growth_forms(id,tenant_id,name,auto_create_deal,pipeline_id,stage_id,created_by) VALUES
  ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','Contact us',false,NULL,NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','Partner form',true,'a0000000-0000-0000-0000-0000000000a2',NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','Routed by automation',false,NULL,NULL,'11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','B form',false,NULL,NULL,'33333333-3333-3333-3333-333333333333'),
  ('f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','Alerts only',false,NULL,NULL,'11111111-1111-1111-1111-111111111111');
INSERT INTO public.growth_form_automations(id,form_id,tenant_id,target_slug,config_json) VALUES
  ('aa000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','pipeline_attach','{"pipeline_id":"a0000000-0000-0000-0000-0000000000a2"}'),
  ('aa000000-0000-0000-0000-000000000005','f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','notify_team','{}');
INSERT INTO public.growth_form_submissions(id,form_id,tenant_id,contact_id,payload_json,utm_json,created_at) VALUES
  ('e0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','{"name":"Ana One"}','{"utm_campaign":"spring","utm_content":"adA"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','{"name":"Ben Two"}','{"utm_campaign":"spring","utm_content":"adB"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000004','{"name":"Di Four"}','{"utm_campaign":"spring"}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000004','{}','{}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000005','f0000000-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-0000000000b1','{}','{}','2026-10-01'),
  ('e0000000-0000-0000-0000-000000000006','f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','{"name":"Ana again"}','{"utm_campaign":"spring","utm_content":"adA"}','2026-10-02'),
  ('e0000000-0000-0000-0000-000000000007','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','{}','{"utm_campaign":"old"}','2020-01-01');
INSERT INTO public.marketing_content(id,tenant_id,kind,meta)
  SELECT ('ac000000-0000-0000-0000-00000000000'||n)::uuid,'aaaaaaaa-0000-0000-0000-00000000000a','image',
         CASE WHEN n=1 THEN '{"keep":1}'::jsonb ELSE '{}'::jsonb END FROM generate_series(1,7) n;
INSERT INTO public.marketing_content(id,tenant_id,kind) VALUES
  ('ac000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-00000000000a','text'),
  ('ac000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','video');

SELECT plan(57);

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
-- Routed forms refuse the default, and keep their own route.
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000003',1)$$,
  '42501','FORM_DEAL_ROUTE_INVALID','A: a form routed by its own columns is refused');
SELECT throws_ok($$SELECT public.growth_attach_submission_default_deal('e0000000-0000-0000-0000-000000000004',1)$$,
  '42501','FORM_DEAL_ROUTE_INVALID','A: a form routed by a pipeline_attach automation is refused');
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
-- Bind the remaining fixtures to deals so the funnel has a won lead and a repeat lead.
UPDATE public.deals SET status='won', stage_id='a1000000-0000-0000-0000-000000000003'
 WHERE id=(SELECT (r->>'deal_id')::uuid FROM b1);
INSERT INTO public.growth_form_submissions(id,form_id,tenant_id,contact_id,deal_id,utm_json,processing_state,created_at) VALUES
  ('e0000000-0000-0000-0000-000000000008','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003',(SELECT (r->>'deal_id')::uuid FROM b1),'{"utm_campaign":" fall ","utm_content":"adC"}','done','2026-10-03'),
  ('e0000000-0000-0000-0000-000000000009','f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003',(SELECT (r->>'deal_id')::uuid FROM b1),'{"utm_campaign":"  "}','done','2026-10-03');
UPDATE public.growth_form_submissions SET deal_id=(SELECT (r->>'deal_id')::uuid FROM r1) WHERE id='e0000000-0000-0000-0000-000000000007';

-- ── C: the lead funnel. ──
-- Sales pipeline holds: Ana's deal (New lead), Ben's (Call booked), Cy's (Won). Partner deal is elsewhere.
-- Form leads bound to Sales: e1 spring/adA, e6 spring/adA (same deal), e2 spring/adB, e8 fall/adC (won),
-- e9 blank campaign (untagged), e7 'old' from 2020. e3 is in Partners and must not count.
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
CREATE TEMP TABLE f1 AS SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1') AS r;
SELECT is((SELECT r->'pipeline' FROM f1),'{"id":"a0000000-0000-0000-0000-0000000000a1","name":"Sales","is_default":true}'::jsonb,'C: pipeline header');
SELECT is((SELECT jsonb_agg(jsonb_build_array(s->>'name',(s->>'deals')::int,s->>'stage_type') ORDER BY i) FROM f1, jsonb_array_elements(r->'stages') WITH ORDINALITY e(s,i)),
  '[["New lead",1,"open"],["Call booked",1,"open"],["Won",1,"won"],["Lost",0,"lost"]]'::jsonb,'C: deals counted per current stage, archived stage omitted, in order');
SELECT is((SELECT r->'leads' FROM f1),'{"total":6,"tagged":5,"untagged":1}'::jsonb,'C: leads total/tagged/untagged (blank campaign is untagged; Partners lead excluded)');
SELECT is((SELECT jsonb_agg(c->>'campaign' ORDER BY i) FROM f1, jsonb_array_elements(r->'campaigns') WITH ORDINALITY e(c,i)),'["fall","spring","old"]'::jsonb,'C: campaigns ordered won desc, leads desc; whitespace trimmed');
SELECT is((SELECT c - 'campaign' FROM f1, jsonb_array_elements(r->'campaigns') c WHERE c->>'campaign'='spring'),
  '{"leads":3,"open":2,"won":0,"lost":0,"by_stage":{"a1000000-0000-0000-0000-000000000001":1,"a1000000-0000-0000-0000-000000000002":1}}'::jsonb,
  'C: spring = 3 leads, 2 distinct open deals, by stage');
SELECT is((SELECT (c->>'won')::int FROM f1, jsonb_array_elements(r->'campaigns') c WHERE c->>'campaign'='fall'),1,'C: fall carries the won deal');
SELECT is((SELECT jsonb_agg(jsonb_build_array(a->>'ad',a->>'campaign',(a->>'leads')::int,(a->>'won')::int) ORDER BY i) FROM f1, jsonb_array_elements(r->'ads') WITH ORDINALITY e(a,i)),
  '[["adC","fall",1,1],["adA","spring",2,0],["adB","spring",1,0]]'::jsonb,'C: ads per utm_content with their campaign, ordered');
CREATE TEMP TABLE f2 AS SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1','2026-01-01') AS r;
SELECT is((SELECT (r->'leads'->>'total')::int FROM f2),5,'C: p_since filters submissions by created_at');
SELECT ok((SELECT NOT (r->'campaigns') @> '[{"campaign":"old"}]' FROM f2),'C: the 2020 lead is outside the window');
SELECT is((SELECT r->>'since' FROM f2),(SELECT to_jsonb('2026-01-01'::timestamptz)#>>'{}'),'C: since is echoed');
SELECT as_user('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT is((SELECT (public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')->'leads'->>'total')::int),6,'C: a member of the active business reads it (same rule as get_pipeline_workspace)');
SELECT as_user('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: another business''s caller is refused');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000ff')$$,'42501','PIPELINE_FORBIDDEN','C: a missing pipeline refuses the same way');
SELECT as_claims('{}');
SELECT throws_ok($$SELECT public.get_pipeline_lead_funnel('a0000000-0000-0000-0000-0000000000a1')$$,'42501','PIPELINE_FORBIDDEN','C: no signed-in caller is refused');

-- ── D: featured creatives. ──
SELECT as_user('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT is((SELECT count(*)::int FROM generate_series(1,6) n
            WHERE (public.set_ad_creative_featured(('ac000000-0000-0000-0000-00000000000'||n)::uuid,true)->>'featured')::boolean),6,'D: an owner features six creatives');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000007',true)$$,'22023','AD_FEATURED_LIMIT','D: the seventh is refused');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',true)->>'featured','true','D: re-featuring one already featured is not counted against itself');
SELECT is((SELECT meta->>'keep' FROM public.marketing_content WHERE id='ac000000-0000-0000-0000-000000000001'),'1','D: other meta keys survive');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000001',false),'{"id":"ac000000-0000-0000-0000-000000000001","featured":false}'::jsonb,'D: unfeature returns the contract shape');
SELECT is(public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000007',true)->>'featured','true','D: a freed slot can be used');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000008',true)$$,'22023','AD_CREATIVE_KIND_INVALID','D: a text item is refused');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-0000000000b1',true)$$,'42501','AD_CREATIVE_FORBIDDEN','D: another business''s creative is refused');
SELECT as_user('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
SELECT throws_ok($$SELECT public.set_ad_creative_featured('ac000000-0000-0000-0000-000000000002',false)$$,'42501','AD_CREATIVE_FORBIDDEN','D: a non-admin member is refused');

SELECT * FROM finish();
ROLLBACK;
