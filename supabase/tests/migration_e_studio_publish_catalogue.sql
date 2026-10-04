-- ============================================================================
-- Migration E (Vibe Studio V2b) — repeatable proof for
--   20270547000000_studio_publish_autonomy_catalogue.sql
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The previous canonical bodies are Migration D's
-- (20270546000000), applied first and snapshotted, so "unchanged" is measured, not asserted. The
-- platform helpers the catalogue reader calls are the production copies Migration D's suite uses.
--
-- What it proves:
--   0. The previous bodies applied here are byte-identical to production's live ones
--      (pg_get_functiondef md5, read 2026-10-04), so "previous" means what prod runs.
--   1. _workspace_event_display: each of the five new keys x every capability outcome reads its own
--      line; every other (source, outcome, capability) answer is identical to the previous body; an
--      unknown key keeps the generic line; no internal names or banned words in a new line.
--   2. list_tool_autonomy: the previous catalogue plus exactly five Studio rows, labels exact; every
--      other row (modes included) identical; a stored mode on a new key is read back; the tenant
--      mismatch guard is unchanged.
--   3. Grants and function attributes unchanged.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'migration_e_studio_publish_catalogue_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated migration_e_studio_publish_catalogue_contract database (got %)', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth stubs ───────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.role', true), '') $$;

-- ── minimal faithful schema ──────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','super_admin','platform_admin','coach','client');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY, parent_tenant_id uuid, account_type text NOT NULL DEFAULT 'standalone',
  features jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS public.agency_team_members (
  agency_tenant_id uuid NOT NULL, user_id uuid NOT NULL, agency_role text NOT NULL,
  status text NOT NULL DEFAULT 'active', scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.profiles (user_id uuid PRIMARY KEY, active_tenant_id uuid);
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigserial PRIMARY KEY, user_id uuid, entity text, action text, entity_id uuid, data jsonb);
CREATE TABLE IF NOT EXISTS public.tenant_tool_autonomy (
  tenant_id uuid NOT NULL, tool_key text NOT NULL, mode text NOT NULL,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (tenant_id, tool_key));
CREATE TABLE IF NOT EXISTS public.marketing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid, kind text NOT NULL DEFAULT 'text', channel text,
  title text NOT NULL DEFAULT 'Untitled', body text, image_url text, image_path text, size text, brief text,
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','published','archived'])),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  work_id uuid, document_revision integer, published_at timestamptz);
ALTER TABLE public.marketing_content ENABLE ROW LEVEL SECURITY;
-- Production table privileges (2026-10-04): authenticated SELECT only; anon nothing.
REVOKE ALL ON public.marketing_content FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.marketing_content TO authenticated;

-- ── platform helpers: production bodies ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'::public.app_role); $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT public.is_super_admin() $$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND (role::text = 'platform_admin' OR role::text = 'super_admin')); $$;
CREATE OR REPLACE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT public.is_super_admin() OR public.is_platform_admin(auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = ANY (_roles)); $$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.parent_tenant_id IS NULL
     AND t.account_type = 'standalone' AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)); $$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin'))
   OR (public.is_company_workspace(_tenant) AND public.is_platform_operator()); $$;
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid() AND status = 'active')
   OR (public.is_company_workspace(_tenant) AND public.is_platform_operator()); $$;
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid, _actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
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
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT public.agency_can_manage_child(_child, auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.agency_team_role(_agency uuid, _actor uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _agency AND m.user_id = _actor AND m.status = 'active' AND m.role = 'owner')
      THEN 'agency_owner'
    ELSE (SELECT atm.agency_role FROM public.agency_team_members atm
            WHERE atm.agency_tenant_id = _agency AND atm.user_id = _actor AND atm.status = 'active' LIMIT 1)
  END; $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT COALESCE(
    (SELECT p.active_tenant_id FROM public.profiles p
       WHERE p.user_id = auth.uid() AND p.active_tenant_id IS NOT NULL
         AND (EXISTS (SELECT 1 FROM public.tenant_members m
                       WHERE m.user_id = auth.uid() AND m.tenant_id = p.active_tenant_id AND m.status = 'active')
              OR public.agency_can_manage_child(p.active_tenant_id, auth.uid())
              OR public.agency_team_role(p.active_tenant_id, auth.uid()) IS NOT NULL
              OR public.is_platform_admin(auth.uid()))),
    (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active'
       ORDER BY joined_at ASC LIMIT 1)); $$;
CREATE OR REPLACE FUNCTION public.is_direct_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS
$$ SELECT COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated', 'service_role'); $$;
-- Production ACLs for the helpers the policy and function call.
REVOKE ALL ON FUNCTION public.agency_can_manage_child(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agency_can_manage_child(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.agency_can_manage_child(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_can_manage_child(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated, service_role;

-- Rail display dependencies retained by the full projection body.
CREATE OR REPLACE FUNCTION public._zapier_workspace_event_display(text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('title','zapier') $$;
CREATE OR REPLACE FUNCTION public._n8n_workspace_event_display(text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('title','n8n') $$;

-- The policies as production holds them BEFORE this migration (20270542000000).
DROP POLICY IF EXISTS marketing_content_service ON public.marketing_content;
CREATE POLICY marketing_content_service ON public.marketing_content
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS marketing_content_tenant_manage ON public.marketing_content;
CREATE POLICY marketing_content_tenant_manage ON public.marketing_content
  FOR ALL USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner())
  WITH CHECK (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());


-- ── The PREVIOUS canonical bodies (Migration D), applied first ───────────────────────────────────
\ir ../migrations/20270546000000_studio_content_workspace_authority.sql

-- ── Synthetic fixtures ───────────────────────────────────────────────────────────────────────────
-- TA, TB: standalone workspaces. e001 owner of TA (active TA) · e003 plain member of TA (active TA).
INSERT INTO public.tenants (id, parent_tenant_id, account_type) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', NULL, 'standalone'),
  ('00000000-0000-4000-8000-00000000d0b1', NULL, 'standalone')
ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e003', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0a1')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
-- Stored modes: two on existing keys and one on a new key, so the reader's LEFT JOIN is graded for
-- the new rows as well as the old.
INSERT INTO public.tenant_tool_autonomy (tenant_id, tool_key, mode) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'content_save', 'auto'),
  ('00000000-0000-4000-8000-00000000d0a1', 'growth_page_publish', 'off'),
  ('00000000-0000-4000-8000-00000000d0a1', 'studio_image_publish', 'off')
ON CONFLICT DO NOTHING;

-- ── Harness ──────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial, ok boolean, what text);
GRANT ALL ON _checks TO PUBLIC;
GRANT ALL ON SEQUENCE _checks_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;
-- Run _sql as a caller: _uid ('' = none), _jwt_role (auth.role()), _db_role ('' = stay postgres).
-- Returns 'ok:<first column>' or 'err:<SQLSTATE>:<message>'.
CREATE FUNCTION pg_temp.run(_uid text, _jwt_role text, _db_role text, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE _r text;
BEGIN
  PERFORM set_config('test.uid', _uid, true);
  PERFORM set_config('test.role', _jwt_role, true);
  BEGIN
    IF _db_role <> '' THEN EXECUTE format('SET LOCAL ROLE %I', _db_role); END IF;
    EXECUTE _sql INTO _r;
    RESET ROLE;
    RETURN 'ok:' || coalesce(_r, '<null>');
  EXCEPTION WHEN OTHERS THEN
    RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 0. The previous bodies are production's
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  PERFORM pg_temp.chk(md5(pg_get_functiondef('public._workspace_event_display(text,text,text)'::regprocedure)) = '3a9888e9db334b177ab9d71acc2f60dc',
    'previous Rail body = production (md5 3a9888e9..., 2026-10-04)');
  PERFORM pg_temp.chk(md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)) = '94ee6854d6a6db89536e19e74ad8970d',
    'previous catalogue body = production (md5 94ee6854..., 2026-10-04)');
END $$;

-- ── Snapshots of the previous bodies ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _new_keys (cap text PRIMARY KEY, done text, try text, live_summary text);
INSERT INTO _new_keys VALUES
  ('growth_page_unpublish',   'Took your landing page offline', 'take your landing page offline',
     'Your landing page is no longer published. Any form it used is still live.'),
  ('growth_funnel_unpublish', 'Took your funnel offline',       'take your funnel offline',
     'Your funnel is no longer published. The pages and forms it used are still live.'),
  ('growth_form_unpublish',   'Took your form offline',         'take your form offline',        NULL),
  ('studio_image_publish',    'Published your image',           'publish your image',
     'Your image is live. Anyone with the link can see it now.'),
  ('studio_image_unpublish',  'Took your image offline',        'take your image offline',       NULL);

CREATE TEMP TABLE _new_rows (tool_key text PRIMARY KEY, label text, category text);
INSERT INTO _new_rows VALUES
  ('growth_page_unpublish',   'Unpublish a landing page', 'Studio'),
  ('growth_funnel_unpublish', 'Unpublish a funnel',       'Studio'),
  ('growth_form_unpublish',   'Unpublish a form',         'Studio'),
  ('studio_image_publish',    'Publish an image',         'Studio'),
  ('studio_image_unpublish',  'Unpublish an image',       'Studio');

CREATE TEMP TABLE _rail_before AS
SELECT s.src, o.outcome, c.cap, public._workspace_event_display(s.src, o.outcome, c.cap) AS out
FROM unnest(ARRAY['capability_run','workspace','check','zapier_api_oauth','oauth_attempt',NULL]) AS s(src)
CROSS JOIN unnest(ARRAY['capability_succeeded','capability_failed','capability_refused','capability_unreachable',
  'capability_outcome_unknown','capability_completed_unrecorded','plan_drafted','check_failed','run_refused',
  'bogus_outcome',NULL]) AS o(outcome)
CROSS JOIN unnest(ARRAY['n8n_run_workflow','n8n_create_workflow','n8n_update_workflow','n8n_activate_workflow',
  'n8n_deactivate_workflow','n8n_archive_workflow','zapier_run_action','comms_buy_number','comms_name_number',
  'comms_set_primary_number','comms_draft_registration','campaign_brief_create','campaign_brief_revise',
  'growth_page_save','growth_page_publish','growth_funnel_build','growth_funnel_publish','growth_form_save',
  'growth_form_publish','content_save','vibe_media_image','vibe_media_video',
  'growth_page_unpublish','growth_funnel_unpublish','growth_form_unpublish','studio_image_publish','studio_image_unpublish',
  'some_unknown_key',NULL]) AS c(cap);

DO $$ BEGIN PERFORM set_config('test.uid', '', false); PERFORM set_config('test.role', '', false); END $$;
CREATE TEMP TABLE _lta_before AS
SELECT tool_key, label, category, mode, is_default FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0a1');
CREATE TEMP TABLE _acl_before AS
SELECT p.oid::regprocedure::text AS fn, p.proacl::text AS acl, p.prosecdef, p.provolatile, p.proconfig::text AS cfg, p.proowner
FROM pg_proc p WHERE p.oid IN ('public._workspace_event_display(text,text,text)'::regprocedure, 'public.list_tool_autonomy(uuid)'::regprocedure);

-- ── The REAL migration, twice (clean application + replay) ───────────────────────────────────────
\ir ../migrations/20270547000000_studio_publish_autonomy_catalogue.sql
\ir ../migrations/20270547000000_studio_publish_autonomy_catalogue.sql

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Rail copy
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE rec record; _now jsonb; _exp_title text; _exp_summary text; _total int := 0; _named int := 0;
BEGIN
  FOR rec IN SELECT b.*, k.done, k.try, k.live_summary FROM _rail_before b LEFT JOIN _new_keys k ON k.cap = b.cap LOOP
    _total := _total + 1;
    _now := public._workspace_event_display(rec.src, rec.outcome, rec.cap);
    IF rec.src IS DISTINCT FROM 'capability_run' OR rec.done IS NULL
       OR rec.outcome IS NULL OR rec.outcome NOT LIKE 'capability_%' THEN
      PERFORM pg_temp.chk(_now = rec.out, format('rail unchanged src=%s outcome=%s cap=%s', rec.src, rec.outcome, rec.cap));
      CONTINUE;
    END IF;
    _named := _named + 1;
    _exp_title := CASE rec.outcome
      WHEN 'capability_succeeded'            THEN rec.done
      WHEN 'capability_failed'               THEN 'Did not ' || rec.try
      WHEN 'capability_refused'              THEN 'Not allowed to ' || rec.try
      WHEN 'capability_unreachable'          THEN 'Could not reach the service to ' || rec.try
      WHEN 'capability_outcome_unknown'      THEN 'Result unknown — ' || rec.try
      WHEN 'capability_completed_unrecorded' THEN rec.done || ' — but the record did not finish' END;
    _exp_summary := CASE WHEN rec.outcome = 'capability_succeeded' THEN coalesce(rec.live_summary, 'Paige did this for you.')
                         ELSE rec.out->>'summary' END;
    PERFORM pg_temp.chk(_now->>'title' = _exp_title AND _now->>'summary' = _exp_summary
        AND (_now - 'title' - 'summary') = (rec.out - 'title' - 'summary')
        AND _now->>'title' <> rec.out->>'title',
      format('rail named line src=%s outcome=%s cap=%s got=%s', rec.src, rec.outcome, rec.cap, _now->>'title'));
  END LOOP;
  PERFORM pg_temp.chk(_total = 6 * 11 * 29, format('rail matrix ran %s cells', _total));
  PERFORM pg_temp.chk(_named = 5 * 6, format('every new key x capability outcome was graded as a named line (%s)', _named));
  PERFORM pg_temp.chk(public._workspace_event_display('capability_run','capability_succeeded','some_unknown_key')->>'title' = 'Completed a step for you',
    'an unknown capability keeps the generic line');
  PERFORM pg_temp.chk(public._workspace_event_display('capability_run','capability_succeeded','growth_page_publish')->>'summary'
      = 'Your landing page is live, along with any form it uses. Visitors can see it now.',
    'the existing publish summary is untouched');
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT 1 FROM _new_keys k, unnest(ARRAY['capability_succeeded','capability_failed','capability_refused',
        'capability_unreachable','capability_outcome_unknown','capability_completed_unrecorded']) o
      WHERE (public._workspace_event_display('capability_run', o, k.cap)->>'title') || ' ' ||
            (public._workspace_event_display('capability_run', o, k.cap)->>'summary')
            ~* '(ai-powered|seamless|streamline|growth_|vibe_|studio_|marketing_content|unpublish|rpc|edge function)'),
    'new Rail lines carry no internal names or banned words');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. list_tool_autonomy: the previous catalogue plus exactly five Studio rows
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE _before int; _after int; _gone int; _extra int;
BEGIN
  PERFORM set_config('test.uid', '', true); PERFORM set_config('test.role', '', true);
  CREATE TEMP TABLE _lta_after AS
    SELECT tool_key, label, category, mode, is_default FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0a1');
  SELECT count(*) INTO _before FROM _lta_before;
  SELECT count(*) INTO _after FROM _lta_after;
  SELECT count(*) INTO _gone FROM (SELECT * FROM _lta_before EXCEPT SELECT * FROM _lta_after) x;
  SELECT count(*) INTO _extra FROM (SELECT * FROM _lta_after EXCEPT SELECT * FROM _lta_before) x;
  PERFORM pg_temp.chk(_before >= 150, format('the previous catalogue was read (%s rows)', _before));
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM _lta_before b JOIN _new_rows n USING (tool_key)), 'previous catalogue listed none of the five');
  PERFORM pg_temp.chk(_after = _before + 5, format('exactly five rows added (before %s, after %s)', _before, _after));
  PERFORM pg_temp.chk(_gone = 0 AND _extra = 5, format('every previous row identical, modes included (gone %s, extra %s)', _gone, _extra));
  PERFORM pg_temp.chk((SELECT count(*) FROM _lta_after a JOIN _new_rows n
      ON n.tool_key = a.tool_key AND n.label = a.label AND n.category = a.category) = 5,
    'the five new rows carry their exact labels in the Studio category');
  PERFORM pg_temp.chk((SELECT count(*) FROM (SELECT tool_key FROM _lta_after GROUP BY tool_key HAVING count(*) > 1) d) = 0,
    'no key is listed twice');
  PERFORM pg_temp.chk((SELECT mode = 'off' AND NOT is_default FROM _lta_after WHERE tool_key = 'studio_image_publish'),
    'a stored mode on a new key is read back');
  PERFORM pg_temp.chk((SELECT count(*) FROM _lta_after a JOIN _new_rows n USING (tool_key)
      WHERE a.tool_key <> 'studio_image_publish' AND a.mode = 'confirm' AND a.is_default) = 4,
    'the other new keys default to confirm');
  PERFORM pg_temp.chk((SELECT mode FROM _lta_after WHERE tool_key = 'content_save') = 'auto'
    AND (SELECT mode FROM _lta_after WHERE tool_key = 'growth_page_publish') = 'off', 'existing stored modes unchanged');
  PERFORM pg_temp.chk(pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', 'authenticated',
      $q$SELECT count(*)::text FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0b1')$q$) LIKE 'err:42501:AUTONOMY_FORBIDDEN%',
    'list_tool_autonomy tenant-mismatch guard unchanged');
  PERFORM pg_temp.chk(pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', 'authenticated',
      $q$SELECT count(*)::text FROM public.list_tool_autonomy(NULL) WHERE tool_key = 'growth_form_unpublish'$q$) = 'ok:1',
    'a signed-in owner reads the new rows for their own workspace');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Grants and attributes unchanged
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT fn, acl, prosecdef, provolatile, cfg, proowner FROM _acl_before
      EXCEPT
      SELECT p.oid::regprocedure::text, p.proacl::text, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner
      FROM pg_proc p WHERE p.oid IN ('public._workspace_event_display(text,text,text)'::regprocedure, 'public.list_tool_autonomy(uuid)'::regprocedure)),
    'ACLs, security, volatility, search_path and owner of both functions are unchanged');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon',          'public._workspace_event_display(text,text,text)', 'EXECUTE'), 'rail display: anon may not execute');
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public._workspace_event_display(text,text,text)', 'EXECUTE'), 'rail display: authenticated may not execute');
  PERFORM pg_temp.chk((SELECT NOT prosecdef AND provolatile = 'i' FROM pg_proc WHERE oid = 'public._workspace_event_display(text,text,text)'::regprocedure), 'rail display: still IMMUTABLE invoker');
  PERFORM pg_temp.chk(    has_function_privilege('authenticated', 'public.list_tool_autonomy(uuid)', 'EXECUTE'), 'catalogue: authenticated may execute');
  PERFORM pg_temp.chk(    has_function_privilege('service_role',  'public.list_tool_autonomy(uuid)', 'EXECUTE'), 'catalogue: service_role may execute');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon',          'public.list_tool_autonomy(uuid)', 'EXECUTE'), 'catalogue: anon may not execute');
  PERFORM pg_temp.chk((SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public'] FROM pg_proc
     WHERE oid = 'public.list_tool_autonomy(uuid)'::regprocedure), 'catalogue: STABLE SECURITY DEFINER, search_path=public');
  PERFORM pg_temp.chk((SELECT count(*) FROM pg_proc WHERE proname IN ('list_tool_autonomy','_workspace_event_display')) = 2, 'no new overload');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 160), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 30) f;
  IF _total < 1900 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'migration_e_studio_publish_catalogue: % checks passed', _total;
END $$;
