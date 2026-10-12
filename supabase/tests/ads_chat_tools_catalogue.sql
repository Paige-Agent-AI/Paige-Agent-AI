-- ============================================================================
-- Ads from chat — repeatable proof for 20271021210000_ads_paige_chat_tools_catalogue.sql.
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database with
-- synthetic fixtures only (§63). The whole run is one transaction that ROLLS BACK.
--
-- HONEST SCOPE (§13). The predecessor catalogue here is a STAND-IN: a list_tool_autonomy(uuid) with the
-- production signature, return shape, attributes and tenant rule (the caller's active business; a
-- platform owner may name one; anyone else naming another is refused) and a few synthetic rows. It is not
-- production's body. What this proves is the wrapper's own behaviour against any predecessor:
--   1. every predecessor row is forwarded unchanged (modes included), in order, before the new row;
--   2. exactly one new row, set_ad_creative_featured, asks first by default and reads a stored mode back;
--   3. a predecessor refusal still refuses (the wrapper adds no path around it);
--   4. replay is a no-op: the incumbent is renamed once, never twice, and the result is identical;
--   5. grants: the predecessor is private (no anon/authenticated/service_role EXECUTE); the wrapper keeps
--      authenticated + service_role and gives anon nothing; SECURITY DEFINER, STABLE, pinned search_path.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'ads_chat_tools_catalogue_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated ads_chat_tools_catalogue_contract database (got %)', current_database();
  END IF;
END $$;

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- ── Count-enforcing pgTAP-compatible shim (a skipped assertion cannot pass silently). ──────────────
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
CREATE FUNCTION finish() RETURNS text LANGUAGE plpgsql AS $$
DECLARE s _pgtap_state; BEGIN SELECT * INTO s FROM _pgtap_state;
  IF s.executed <> s.planned THEN RAISE EXCEPTION 'FAIL: planned % assertions, ran %', s.planned, s.executed; END IF;
  RETURN 'all '||s.executed||' assertions ran'; END $$;

-- ── auth + helpers driven by settings, so every answer below is the function bodies' own. ────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.platform_owner', true), '')::boolean, false) $$;

CREATE TABLE public.tenant_tool_autonomy (
  tenant_id uuid NOT NULL, tool_key text NOT NULL, mode text NOT NULL,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (tenant_id, tool_key));

-- ── The stand-in predecessor (see HONEST SCOPE). ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF _tenant_id IS NOT NULL AND _tenant_id IS DISTINCT FROM tenant AND NOT public.is_platform_owner() THEN
   RAISE EXCEPTION 'AUTONOMY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('content_save','Save marketing content','Content'),
  ('email_series_draft','Write or change an email series','Campaigns'),
  ('gmail_organize','Organize a connected Gmail mailbox','Communications')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

INSERT INTO public.tenant_tool_autonomy(tenant_id,tool_key,mode,updated_at) VALUES
  ('00000000-0000-4000-8000-00000000a001','content_save','auto','2026-10-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000a001','gmail_organize','off','2026-10-02T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b001','content_save','off','2026-10-03T00:00:00Z');

-- Snapshot what the predecessor answers BEFORE the migration, per caller, so "unchanged" is measured.
SELECT set_config('test.uid','00000000-0000-4000-8000-000000000101',true);
SELECT set_config('test.tenant','00000000-0000-4000-8000-00000000a001',true);
CREATE TEMP TABLE before_a AS SELECT row_number() OVER () AS n, * FROM public.list_tool_autonomy(NULL);
SELECT set_config('test.tenant','00000000-0000-4000-8000-00000000b001',true);
CREATE TEMP TABLE before_b AS SELECT row_number() OVER () AS n, * FROM public.list_tool_autonomy(NULL);

-- ── Apply the REAL migration: clean, then replay. ─────────────────────────────────────────────────
\ir ../migrations/20271021210000_ads_paige_chat_tools_catalogue.sql
CREATE TEMP TABLE first_def AS SELECT md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)) AS wrapper,
  md5(pg_get_functiondef('public._list_tool_autonomy_before_ads_chat(uuid)'::regprocedure)) AS predecessor;
\ir ../migrations/20271021210000_ads_paige_chat_tools_catalogue.sql

SELECT plan(18);

-- 4. Replay is a no-op.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname LIKE '_list_tool_autonomy_before_ads_chat%'), 1, 'replay renames the incumbent once, never twice');
SELECT is(md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)), (SELECT wrapper FROM first_def), 'replay leaves the wrapper identical');
SELECT is(md5(pg_get_functiondef('public._list_tool_autonomy_before_ads_chat(uuid)'::regprocedure)), (SELECT predecessor FROM first_def), 'replay leaves the predecessor identical (it is not wrapped around itself)');

-- 1 + 2. Tenant A: every predecessor row forwarded first, unchanged, then exactly one new row.
SELECT set_config('test.tenant','00000000-0000-4000-8000-00000000a001',true);
CREATE TEMP TABLE after_a AS SELECT row_number() OVER () AS n, * FROM public.list_tool_autonomy(NULL);
SELECT is((SELECT count(*)::int FROM after_a), (SELECT count(*)::int FROM before_a) + 1, 'tenant A: the predecessor rows plus exactly one');
SELECT ok(NOT EXISTS (SELECT n,tool_key,label,category,mode,is_default,updated_at FROM before_a
                      EXCEPT SELECT n,tool_key,label,category,mode,is_default,updated_at FROM after_a), 'tenant A: every predecessor row is forwarded unchanged, in its place');
SELECT is((SELECT tool_key FROM after_a WHERE n = (SELECT max(n) FROM after_a)), 'set_ad_creative_featured', 'the new row comes last');
SELECT is((SELECT label FROM after_a WHERE tool_key='set_ad_creative_featured'), 'Feature a picture in your Ads showroom', 'the new row''s owner-facing label');
SELECT is((SELECT category FROM after_a WHERE tool_key='set_ad_creative_featured'), 'Content', 'the new row''s category');
SELECT is((SELECT mode FROM after_a WHERE tool_key='set_ad_creative_featured'), 'confirm', 'by default PAIGE asks first');
SELECT is((SELECT is_default FROM after_a WHERE tool_key='set_ad_creative_featured'), true, 'and it says that is the default');
SELECT is((SELECT count(*)::int FROM after_a WHERE tool_key='get_pipeline_lead_funnel'), 0, 'the read is not catalogued (it writes nothing)');

-- A stored mode on the new key is read back, for that tenant only.
INSERT INTO public.tenant_tool_autonomy(tenant_id,tool_key,mode,updated_at) VALUES
  ('00000000-0000-4000-8000-00000000a001','set_ad_creative_featured','auto','2026-10-12T00:00:00Z');
SELECT is((SELECT mode||'/'||is_default::text FROM public.list_tool_autonomy(NULL) WHERE tool_key='set_ad_creative_featured'), 'auto/false', 'tenant A''s stored mode is read back');
SELECT set_config('test.tenant','00000000-0000-4000-8000-00000000b001',true);
CREATE TEMP TABLE after_b AS SELECT row_number() OVER () AS n, * FROM public.list_tool_autonomy(NULL);
SELECT ok(NOT EXISTS (SELECT n,tool_key,label,category,mode,is_default,updated_at FROM before_b
                      EXCEPT SELECT n,tool_key,label,category,mode,is_default,updated_at FROM after_b), 'tenant B: its predecessor rows are unchanged');
SELECT is((SELECT mode FROM after_b WHERE tool_key='set_ad_creative_featured'), 'confirm', 'tenant B never sees tenant A''s setting');

-- 3. The predecessor's refusal still refuses through the wrapper.
DO $$ BEGIN
  PERFORM * FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000a001');
  RAISE EXCEPTION 'FAIL: a business named that is not the caller''s was answered';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT ok(true, 'naming another business is refused by the forwarded predecessor');

-- 5. Grants and attributes.
SELECT ok(NOT has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE')
      AND has_function_privilege('authenticated','public.list_tool_autonomy(uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.list_tool_autonomy(uuid)','EXECUTE'), 'wrapper: authenticated + service_role, never anon');
SELECT ok(NOT has_function_privilege('anon','public._list_tool_autonomy_before_ads_chat(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public._list_tool_autonomy_before_ads_chat(uuid)','EXECUTE')
      AND NOT has_function_privilege('service_role','public._list_tool_autonomy_before_ads_chat(uuid)','EXECUTE'), 'the predecessor is private');
SELECT ok((SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE oid='public.list_tool_autonomy(uuid)'::regprocedure),
  'wrapper is SECURITY DEFINER, STABLE, search_path pinned');

SELECT finish();
ROLLBACK;
