-- ============================================================================
-- Migration D (Vibe Studio V2a) — repeatable proof for
--   20270546000000_studio_content_workspace_authority.sql
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The platform helpers the migration reads (is_tenant_admin,
-- agency_can_manage_child, current_user_tenant_id, is_platform_owner, is_direct_server_context …) are
-- copied from their production definitions (pg_get_functiondef, 2026-10-04) with production ACLs, so
-- the authority answers here are the ones production would give. auth.uid()/auth.role() read session
-- settings (test.uid / test.role), as Supabase's own helpers read the JWT claims.
--
-- What it proves:
--   1. save_marketing_content: the active workspace's owner/admin (and the managing agency) can
--      insert/update; a plain member is refused even with a GLOBAL admin role; a global admin outside
--      the workspace is refused; a foreign p_tenant_id is refused (never swapped); a foreign p_id is
--      not updated; the service-role / direct-server path works with an explicit tenant and refuses
--      without one; a signed-out caller cannot execute it; the version-history body still works.
--   2. RLS on marketing_content: who can SELECT, and who the policy would admit for
--      INSERT/UPDATE/DELETE (authenticated holds SELECT only, so writes are refused by privilege).
--   3. _workspace_event_display: every new key × outcome reads its own line; an unknown key keeps the
--      generic line; every pre-existing (source, outcome, capability) answer is unchanged against the
--      previous body (20270105000000 applied first and snapshotted).
--   4. list_tool_autonomy: exactly the previous catalogue (20270543000003 applied first and
--      snapshotted) minus draft_marketing_content; every other row unchanged.
--   5. Grants and function attributes unchanged.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'migration_d_studio_authority_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated migration_d_studio_authority_contract database (got %)', current_database();
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

-- The image publish guard (20270537000000), production body.
CREATE OR REPLACE FUNCTION public.growth_publish_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Pages, forms and funnels: a signed-in or anonymous caller writes nothing directly. The Studio
  -- functions (owner-run) and server callers are let through, and enforce the rules themselves.
  IF TG_TABLE_NAME <> 'marketing_content' THEN
    IF current_user NOT IN ('authenticated', 'anon') THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: pages, forms and funnels change through Vibe Studio' USING ERRCODE = '42501';
  END IF;

  -- Images: publish state, and a published image's file and text, belong to studio_image_publish /
  -- studio_image_unpublish for EVERY caller — including the owner-run save functions — so nothing
  -- swaps out a picture people are already looking at. Those two functions mark their own write.
  IF current_setting('app.studio_publish_op', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: new work starts unpublished' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- Only a signed-in or anonymous caller is held here: a server clean-up or a cascade from a
    -- deleted workspace (which runs as the table owner) still removes its images.
    IF OLD.status = 'published' AND current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: unpublish this image before deleting it' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.published_at IS DISTINCT FROM OLD.published_at
     OR (NEW.status IS DISTINCT FROM OLD.status AND (NEW.status = 'published' OR OLD.status = 'published'))
     OR (OLD.status = 'published' AND (NEW.image_url IS DISTINCT FROM OLD.image_url OR NEW.body IS DISTINCT FROM OLD.body)) THEN
    RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: this image is published — unpublish it in Vibe Studio before changing it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_content_publish_guard ON public.marketing_content;
CREATE TRIGGER trg_marketing_content_publish_guard BEFORE INSERT OR UPDATE OR DELETE ON public.marketing_content
  FOR EACH ROW EXECUTE FUNCTION public.growth_publish_state_guard();

-- ── The PREVIOUS canonical bodies, applied first so "unchanged" is measured, not asserted ─────────
\ir ../migrations/20270105000000_campaign_brief_verified_rail_copy.sql
\ir ../migrations/20270543000003_sales_invoice_autonomy_catalogue.sql

-- ── Synthetic fixtures ───────────────────────────────────────────────────────────────────────────
-- TA, TB: standalone workspaces. AG: an agency. CH: AG's sub-account.
INSERT INTO public.tenants (id, parent_tenant_id, account_type) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', NULL, 'standalone'),
  ('00000000-0000-4000-8000-00000000d0b1', NULL, 'standalone'),
  ('00000000-0000-4000-8000-00000000d0c1', NULL, 'agency'),
  ('00000000-0000-4000-8000-00000000d0c2', '00000000-0000-4000-8000-00000000d0c1', 'sub_account')
ON CONFLICT DO NOTHING;
-- e001 OWN owner of TA · e002 ADM admin of TA · e003 MEM plain member of TA holding the GLOBAL admin
-- role · e004 GAD global admin, owner of TB only · e005 TWO owner of TA and TB (active TA) ·
-- e006 AGM agency_manager of AG (active CH) · e007 SPEC agency_specialist of AG assigned nowhere
-- (active AG) · e008 PO platform owner (super_admin), member of nothing (active TB) · e009 NOBODY ·
-- e00a AGO owner of AG (active CH).
INSERT INTO public.tenant_members (tenant_id, user_id, role, joined_at) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e002', 'admin',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e003', 'member', now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e004', 'owner',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e005', 'owner',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e005', 'owner',  now() - interval '8 days'),
  ('00000000-0000-4000-8000-00000000d0c1', '00000000-0000-4000-8000-00000000e00a', 'owner',  now() - interval '9 days')
ON CONFLICT DO NOTHING;
INSERT INTO public.agency_team_members (agency_tenant_id, user_id, agency_role, scoped_subaccounts)
SELECT * FROM (VALUES
  ('00000000-0000-4000-8000-00000000d0c1'::uuid, '00000000-0000-4000-8000-00000000e006'::uuid, 'agency_manager', '{}'::uuid[]),
  ('00000000-0000-4000-8000-00000000d0c1'::uuid, '00000000-0000-4000-8000-00000000e007'::uuid, 'agency_specialist', '{}'::uuid[])) v
WHERE NOT EXISTS (SELECT 1 FROM public.agency_team_members);
INSERT INTO public.user_roles (user_id, role)
SELECT * FROM (VALUES
  ('00000000-0000-4000-8000-00000000e003'::uuid, 'admin'::public.app_role),
  ('00000000-0000-4000-8000-00000000e004'::uuid, 'admin'::public.app_role),
  ('00000000-0000-4000-8000-00000000e008'::uuid, 'super_admin'::public.app_role)) v
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles);
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000d0b1'),
  ('00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-00000000d0c2'),
  ('00000000-0000-4000-8000-00000000e007', '00000000-0000-4000-8000-00000000d0c1'),
  ('00000000-0000-4000-8000-00000000e008', '00000000-0000-4000-8000-00000000d0b1'),
  ('00000000-0000-4000-8000-00000000e00a', '00000000-0000-4000-8000-00000000d0c2')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.marketing_content (id, tenant_id, kind, title, image_url) VALUES
  ('00000000-0000-4000-8000-00000000f0a1', '00000000-0000-4000-8000-00000000d0a1', 'image', 'TA banner', 'https://img.tests.invalid/a.png'),
  ('00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-00000000d0b1', 'image', 'TB banner', 'https://img.tests.invalid/tb.png'),
  ('00000000-0000-4000-8000-00000000f0c2', '00000000-0000-4000-8000-00000000d0c2', 'text',  'CH caption', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_tool_autonomy (tenant_id, tool_key, mode) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'content_save', 'auto'),
  ('00000000-0000-4000-8000-00000000d0a1', 'draft_marketing_content', 'auto'),
  ('00000000-0000-4000-8000-00000000d0a1', 'growth_page_save', 'off')
ON CONFLICT DO NOTHING;

-- ── Snapshots of the previous bodies ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _new_keys (cap text PRIMARY KEY, done text, try text, live_summary text);
INSERT INTO _new_keys VALUES
  ('growth_page_save',      'Saved your landing page',     'save your landing page',     NULL),
  ('growth_page_publish',   'Published your landing page', 'publish your landing page',
     'Your landing page is live, along with any form it uses. Visitors can see it now.'),
  ('growth_funnel_build',   'Built your funnel',           'build your funnel',          NULL),
  ('growth_funnel_publish', 'Published your funnel',       'publish your funnel',
     'Your funnel is live, along with the pages and forms it uses. Visitors can see it now.'),
  ('growth_form_save',      'Saved your form',             'save your form',             NULL),
  ('growth_form_publish',   'Published your form',         'publish your form',
     'Your form is live. Visitors can fill it in now.'),
  ('content_save',          'Saved your marketing copy',   'save your marketing copy',   NULL),
  ('vibe_media_image',      'Created an image',            'create an image',            NULL),
  ('vibe_media_video',      'Created a video',             'create a video',             NULL);

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
  'growth_form_publish','content_save','vibe_media_image','vibe_media_video','some_unknown_key',NULL]) AS c(cap);

DO $$ BEGIN PERFORM set_config('test.uid', '', false); PERFORM set_config('test.role', '', false); END $$;
CREATE TEMP TABLE _lta_before AS
SELECT tool_key, label, category, mode, is_default FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0a1');

-- ── The REAL migration, twice (clean application + replay) ───────────────────────────────────────
\ir ../migrations/20270546000000_studio_content_workspace_authority.sql
\ir ../migrations/20270546000000_studio_content_workspace_authority.sql

-- ── Harness ──────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial, ok boolean, what text);
GRANT ALL ON _checks TO PUBLIC;
GRANT ALL ON SEQUENCE _checks_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

-- Run _sql as a caller: _uid ('' = none), _jwt_role (auth.role()), _db_role ('' = stay postgres, the
-- direct server session). Returns 'ok:<first column>' or 'err:<SQLSTATE>:<message>'.
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
-- 1. save_marketing_content authority
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  TA constant text := '00000000-0000-4000-8000-00000000d0a1';
  TB constant text := '00000000-0000-4000-8000-00000000d0b1';
  AG constant text := '00000000-0000-4000-8000-00000000d0c1';
  CH constant text := '00000000-0000-4000-8000-00000000d0c2';
  RA1 constant text := '00000000-0000-4000-8000-00000000f0a1';
  RB1 constant text := '00000000-0000-4000-8000-00000000f0b1';
  RC2 constant text := '00000000-0000-4000-8000-00000000f0c2';
  OWN constant text := '00000000-0000-4000-8000-00000000e001';
  ADM constant text := '00000000-0000-4000-8000-00000000e002';
  MEM constant text := '00000000-0000-4000-8000-00000000e003';
  GAD constant text := '00000000-0000-4000-8000-00000000e004';
  TWO constant text := '00000000-0000-4000-8000-00000000e005';
  AGM constant text := '00000000-0000-4000-8000-00000000e006';
  SPEC constant text := '00000000-0000-4000-8000-00000000e007';
  PO constant text := '00000000-0000-4000-8000-00000000e008';
  NOBODY constant text := '00000000-0000-4000-8000-00000000e009';
  AGO constant text := '00000000-0000-4000-8000-00000000e00a';
  r text; _id uuid; _n_ta int; _n_tb int;
  ins_null text := $q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'Caption', p_body => 'Body')::text$q$;
BEGIN
  -- Owner, active workspace, no tenant named → lands in the active workspace, stamped and audited.
  r := pg_temp.run(OWN, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'ok:%', 'owner inserts into the active workspace: ' || r);
  IF r LIKE 'ok:%' THEN
    _id := substr(r, 4)::uuid;
    PERFORM pg_temp.chk((SELECT tenant_id::text = TA AND created_by::text = OWN FROM public.marketing_content WHERE id = _id),
      'owner insert: tenant is the active workspace and created_by is the caller');
    PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = _id AND data->>'tenant_id' = TA),
      'owner insert: audit row written with the workspace');
  END IF;
  r := pg_temp.run(OWN, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'Named', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'ok:%', 'owner naming their own active workspace is allowed: ' || r);

  -- Admin inserts and updates in place.
  r := pg_temp.run(ADM, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'ok:%', 'admin inserts: ' || r);
  r := pg_temp.run(ADM, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'Admin retitle', p_id => %L)::text$q$, RA1));
  PERFORM pg_temp.chk(r = 'ok:' || RA1, 'admin updates a row of the active workspace: ' || r);
  PERFORM pg_temp.chk((SELECT title FROM public.marketing_content WHERE id = RA1::uuid) = 'Admin retitle', 'admin update persisted');

  -- The carried-forward body: replacing the image keeps the prior one in meta.versions.
  r := pg_temp.run(OWN, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'v2', p_image_url => 'https://img.tests.invalid/b.png', p_id => %L)::text$q$, RA1));
  PERFORM pg_temp.chk(r = 'ok:' || RA1, 'owner refines the image in place: ' || r);
  PERFORM pg_temp.chk((SELECT meta->'versions'->0->>'image_url' FROM public.marketing_content WHERE id = RA1::uuid) = 'https://img.tests.invalid/a.png'
    AND (SELECT image_url FROM public.marketing_content WHERE id = RA1::uuid) = 'https://img.tests.invalid/b.png',
    'version history body unchanged: the prior image is kept in meta.versions');

  -- A plain member, even holding the GLOBAL admin role, is refused for insert and update.
  r := pg_temp.run(MEM, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'member with global admin role cannot insert: ' || r);
  r := pg_temp.run(MEM, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'member edit', p_id => %L)::text$q$, RA1));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'member with global admin role cannot update: ' || r);
  PERFORM pg_temp.chk((SELECT title FROM public.marketing_content WHERE id = RA1::uuid) = 'v2', 'member update left the row unchanged');

  -- A global admin who is not this workspace's owner/admin is refused when naming it…
  SELECT count(*) INTO _n_ta FROM public.marketing_content WHERE tenant_id = TA::uuid;
  r := pg_temp.run(GAD, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'x', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'global admin outside the workspace is refused: ' || r);
  -- …and writes only to a workspace they own, because they own it (not because of the global role).
  r := pg_temp.run(GAD, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'ok:%' AND (SELECT tenant_id::text FROM public.marketing_content WHERE id = substr(r,4)::uuid) = TB,
    'global admin writes their own workspace as its owner: ' || r);

  -- A foreign p_tenant_id is refused, never swapped (owner of BOTH workspaces, active TA, names TB).
  SELECT count(*) INTO _n_ta FROM public.marketing_content WHERE tenant_id = TA::uuid;
  SELECT count(*) INTO _n_tb FROM public.marketing_content WHERE tenant_id = TB::uuid;
  r := pg_temp.run(TWO, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'x', p_tenant_id => %L)::text$q$, TB));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'a foreign p_tenant_id is refused even for an owner of it: ' || r);
  PERFORM pg_temp.chk((SELECT count(*) FROM public.marketing_content WHERE tenant_id = TA::uuid) = _n_ta
    AND (SELECT count(*) FROM public.marketing_content WHERE tenant_id = TB::uuid) = _n_tb,
    'the refused foreign-tenant call wrote nothing to either workspace');

  -- A foreign p_id cannot be updated.
  r := pg_temp.run(OWN, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'hijack', p_image_url => 'https://img.tests.invalid/evil.png', p_id => %L)::text$q$, RB1));
  PERFORM pg_temp.chk(r LIKE 'err:P0002:CONTENT_NOT_FOUND%', 'a foreign p_id is not found: ' || r);
  r := pg_temp.run(OWN, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'hijack', p_id => %L, p_tenant_id => %L)::text$q$, RB1, TB));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'a foreign p_id with its own tenant named is refused: ' || r);
  PERFORM pg_temp.chk((SELECT title = 'TB banner' AND image_url = 'https://img.tests.invalid/tb.png' FROM public.marketing_content WHERE id = RB1::uuid),
    'the foreign row is unchanged');

  -- The managing agency, working inside its sub-account.
  r := pg_temp.run(AGM, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'ok:%' AND (SELECT tenant_id::text FROM public.marketing_content WHERE id = substr(r,4)::uuid) = CH,
    'agency manager inside the sub-account inserts there: ' || r);
  r := pg_temp.run(AGM, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'agency edit', p_id => %L)::text$q$, RC2));
  PERFORM pg_temp.chk(r = 'ok:' || RC2, 'agency manager updates a sub-account row: ' || r);
  r := pg_temp.run(AGO, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'ok:%', 'agency owner inside the sub-account inserts: ' || r);
  r := pg_temp.run(SPEC, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'an unassigned agency specialist is refused: ' || r);
  r := pg_temp.run(AGM, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'x', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'agency manager cannot name an unrelated workspace: ' || r);

  -- The platform owner holds no write by role: not into another workspace, not into a workspace
  -- they are not owner/admin of.
  r := pg_temp.run(PO, 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'x', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'platform owner naming another workspace is refused: ' || r);
  r := pg_temp.run(PO, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'platform owner who is not owner/admin of the active workspace is refused: ' || r);

  -- No workspace at all.
  r := pg_temp.run(NOBODY, 'authenticated', 'authenticated', ins_null);
  PERFORM pg_temp.chk(r LIKE 'err:22023:CONTENT_NO_TENANT%', 'a signed-in caller with no workspace: ' || r);

  -- Service role: explicit tenant required, then it writes there (insert and tenant-scoped update).
  r := pg_temp.run('', 'service_role', 'service_role',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'svc', p_image_url => 'https://img.tests.invalid/s.png', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'ok:%' AND (SELECT tenant_id::text = TA AND created_by IS NULL FROM public.marketing_content WHERE id = substr(r,4)::uuid),
    'service role inserts with an explicit tenant: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role', ins_null);
  PERFORM pg_temp.chk(r LIKE 'err:22023:CONTENT_NO_TENANT%', 'service role without a tenant is refused: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'svc refine', p_image_url => 'https://img.tests.invalid/c.png', p_id => %L, p_tenant_id => %L)::text$q$, RA1, TA));
  PERFORM pg_temp.chk(r = 'ok:' || RA1, 'service role refines in place with the matching tenant: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role',
    format($q$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'x', p_id => %L, p_tenant_id => %L)::text$q$, RB1, TA));
  PERFORM pg_temp.chk(r LIKE 'err:P0002:CONTENT_NOT_FOUND%', 'service role cannot reach another tenant''s row by p_id: ' || r);
  -- Direct server session (no JWT role at all).
  r := pg_temp.run('', '', '',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'server', p_tenant_id => %L)::text$q$, TB));
  PERFORM pg_temp.chk(r LIKE 'ok:%', 'direct server session writes with an explicit tenant: ' || r);
  -- A JWT that says authenticated with no user, and a signed-out caller.
  r := pg_temp.run('', 'authenticated', 'authenticated',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'x', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'err:42501:CONTENT_FORBIDDEN%', 'authenticated role with no user cannot name a workspace: ' || r);
  r := pg_temp.run('', 'anon', 'anon',
    format($q$SELECT public.save_marketing_content(p_kind => 'text', p_title => 'x', p_tenant_id => %L)::text$q$, TA));
  PERFORM pg_temp.chk(r LIKE 'err:42501:%permission denied%', 'anon cannot execute save_marketing_content: ' || r);
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. RLS on marketing_content
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  TA constant uuid := '00000000-0000-4000-8000-00000000d0a1';
  TB constant uuid := '00000000-0000-4000-8000-00000000d0b1';
  CH constant uuid := '00000000-0000-4000-8000-00000000d0c2';
  n_ta int; n_tb int; n_ch int;
  cnt constant text := $q$SELECT concat_ws(',',
      count(*) FILTER (WHERE tenant_id = '00000000-0000-4000-8000-00000000d0a1'),
      count(*) FILTER (WHERE tenant_id = '00000000-0000-4000-8000-00000000d0b1'),
      count(*) FILTER (WHERE tenant_id = '00000000-0000-4000-8000-00000000d0c2')) FROM public.marketing_content$q$;
  rec record; r text; expect text;
BEGIN
  SELECT count(*) FILTER (WHERE tenant_id = TA), count(*) FILTER (WHERE tenant_id = TB), count(*) FILTER (WHERE tenant_id = CH)
    INTO n_ta, n_tb, n_ch FROM public.marketing_content;
  PERFORM pg_temp.chk(n_ta > 0 AND n_tb > 0 AND n_ch > 0, format('RLS fixtures present ta=%s tb=%s ch=%s', n_ta, n_tb, n_ch));
  FOR rec IN SELECT * FROM (VALUES
      ('owner',                       '00000000-0000-4000-8000-00000000e001', 'ta'),
      ('admin',                       '00000000-0000-4000-8000-00000000e002', 'ta'),
      ('member + global admin',       '00000000-0000-4000-8000-00000000e003', 'none'),
      ('global admin owning TB only', '00000000-0000-4000-8000-00000000e004', 'tb'),
      ('owner of TA and TB',          '00000000-0000-4000-8000-00000000e005', 'ta+tb'),
      ('agency manager in CH',        '00000000-0000-4000-8000-00000000e006', 'ch'),
      ('agency owner in CH',          '00000000-0000-4000-8000-00000000e00a', 'ch'),
      ('unassigned specialist',       '00000000-0000-4000-8000-00000000e007', 'none'),
      ('platform owner',              '00000000-0000-4000-8000-00000000e008', 'all'),
      ('no workspace',                '00000000-0000-4000-8000-00000000e009', 'none')) v(who, uid, sees)
  LOOP
    expect := CASE rec.sees
      WHEN 'ta' THEN concat_ws(',', n_ta, 0, 0) WHEN 'tb' THEN concat_ws(',', 0, n_tb, 0)
      WHEN 'ta+tb' THEN concat_ws(',', n_ta, n_tb, 0) WHEN 'ch' THEN concat_ws(',', 0, 0, n_ch)
      WHEN 'all' THEN concat_ws(',', n_ta, n_tb, n_ch) ELSE '0,0,0' END;
    r := pg_temp.run(rec.uid, 'authenticated', 'authenticated', cnt);
    PERFORM pg_temp.chk(r = 'ok:' || expect, format('SELECT %s sees %s (expected %s, got %s)', rec.who, rec.sees, expect, r));
  END LOOP;
  -- The agency arm is scoped to the workspace the agency user is working in.
  UPDATE public.profiles SET active_tenant_id = '00000000-0000-4000-8000-00000000d0c1' WHERE user_id = '00000000-0000-4000-8000-00000000e006';
  r := pg_temp.run('00000000-0000-4000-8000-00000000e006', 'authenticated', 'authenticated', cnt);
  PERFORM pg_temp.chk(r = 'ok:0,0,0', 'agency manager working in the agency (not the sub-account) sees no sub-account rows: ' || r);
  UPDATE public.profiles SET active_tenant_id = '00000000-0000-4000-8000-00000000d0c2' WHERE user_id = '00000000-0000-4000-8000-00000000e006';
  r := pg_temp.run('', 'anon', 'anon', cnt);
  PERFORM pg_temp.chk(r LIKE 'err:42501:%', 'anon cannot SELECT: ' || r);

  -- Writes: authenticated holds no INSERT/UPDATE/DELETE privilege (unchanged), so every signed-in
  -- write to the table is refused, owner included.
  r := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', 'authenticated',
    $q$WITH i AS (INSERT INTO public.marketing_content (tenant_id, title) VALUES ('00000000-0000-4000-8000-00000000d0a1','direct') RETURNING id) SELECT id::text FROM i$q$);
  PERFORM pg_temp.chk(r LIKE 'err:42501:%permission denied%', 'owner direct INSERT refused by privilege: ' || r);
  r := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', 'authenticated',
    $q$WITH u AS (UPDATE public.marketing_content SET title = 'direct' WHERE tenant_id = '00000000-0000-4000-8000-00000000d0a1' RETURNING 1) SELECT count(*)::text FROM u$q$);
  PERFORM pg_temp.chk(r LIKE 'err:42501:%permission denied%', 'owner direct UPDATE refused by privilege: ' || r);
  r := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', 'authenticated',
    $q$WITH d AS (DELETE FROM public.marketing_content WHERE tenant_id = '00000000-0000-4000-8000-00000000d0a1' RETURNING 1) SELECT count(*)::text FROM d$q$);
  PERFORM pg_temp.chk(r LIKE 'err:42501:%permission denied%', 'owner direct DELETE refused by privilege: ' || r);
END $$;

-- What the POLICY itself admits for writes, measured under a temporary write grant (revoked below), so
-- the predicate is proven for INSERT/UPDATE/DELETE rather than only hidden behind the missing grant.
GRANT INSERT, UPDATE, DELETE ON public.marketing_content TO authenticated;
DO $$
DECLARE r text;
  ins constant text := $q$WITH i AS (INSERT INTO public.marketing_content (tenant_id, title) VALUES (%L,'policy probe') RETURNING id) SELECT id::text FROM i$q$;
  upd constant text := $q$WITH u AS (UPDATE public.marketing_content SET brief = 'policy probe' WHERE tenant_id = %L RETURNING 1) SELECT count(*)::text FROM u$q$;
  del constant text := $q$WITH d AS (DELETE FROM public.marketing_content WHERE tenant_id = %L AND title = 'policy probe' RETURNING 1) SELECT count(*)::text FROM d$q$;
  rec record;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
      ('owner',                 '00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1', true),
      ('admin',                 '00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1', true),
      ('member + global admin', '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0a1', false),
      ('global admin, TB owner','00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000d0a1', false),
      ('agency manager in CH',  '00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-00000000d0c2', true),
      ('agency manager → TA',   '00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-00000000d0a1', false),
      ('unassigned specialist', '00000000-0000-4000-8000-00000000e007', '00000000-0000-4000-8000-00000000d0c2', false),
      ('platform owner',        '00000000-0000-4000-8000-00000000e008', '00000000-0000-4000-8000-00000000d0a1', true)) v(who, uid, tenant, allowed)
  LOOP
    r := pg_temp.run(rec.uid, 'authenticated', 'authenticated', format(ins, rec.tenant));
    PERFORM pg_temp.chk(CASE WHEN rec.allowed THEN r LIKE 'ok:%' ELSE r LIKE 'err:42501:%row-level security%' END,
      format('policy INSERT %s into %s allowed=%s: %s', rec.who, rec.tenant, rec.allowed, r));
    r := pg_temp.run(rec.uid, 'authenticated', 'authenticated', format(upd, rec.tenant));
    PERFORM pg_temp.chk(CASE WHEN rec.allowed THEN r <> 'ok:0' AND r LIKE 'ok:%' ELSE r = 'ok:0' END,
      format('policy UPDATE %s on %s allowed=%s: %s', rec.who, rec.tenant, rec.allowed, r));
    IF rec.allowed THEN
      r := pg_temp.run(rec.uid, 'authenticated', 'authenticated', format(del, rec.tenant));
      PERFORM pg_temp.chk(r <> 'ok:0' AND r LIKE 'ok:%', format('policy DELETE %s on %s: %s', rec.who, rec.tenant, r));
    ELSE
      INSERT INTO public.marketing_content (tenant_id, title) VALUES (rec.tenant::uuid, 'policy probe');
      r := pg_temp.run(rec.uid, 'authenticated', 'authenticated', format(del, rec.tenant));
      PERFORM pg_temp.chk(r = 'ok:0', format('policy DELETE %s on %s refused (0 rows): %s', rec.who, rec.tenant, r));
      DELETE FROM public.marketing_content WHERE tenant_id = rec.tenant::uuid AND title = 'policy probe';
    END IF;
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.marketing_content FROM authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Rail copy
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE rec record; _now jsonb; _exp_title text; _exp_summary text; _total int := 0;
BEGIN
  FOR rec IN SELECT b.*, k.done, k.try, k.live_summary FROM _rail_before b LEFT JOIN _new_keys k ON k.cap = b.cap LOOP
    _total := _total + 1;
    _now := public._workspace_event_display(rec.src, rec.outcome, rec.cap);
    IF rec.src IS DISTINCT FROM 'capability_run' OR rec.done IS NULL
       OR rec.outcome IS NULL OR rec.outcome NOT LIKE 'capability_%' THEN
      PERFORM pg_temp.chk(_now = rec.out, format('rail unchanged src=%s outcome=%s cap=%s', rec.src, rec.outcome, rec.cap));
      CONTINUE;
    END IF;
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
  PERFORM pg_temp.chk(public._workspace_event_display('capability_run','capability_succeeded','some_unknown_key')->>'title' = 'Completed a step for you',
    'an unknown capability keeps the generic line');
  PERFORM pg_temp.chk(public._workspace_event_display('capability_run','capability_succeeded','content_save')->>'title' = 'Saved your marketing copy',
    'content_save reads "Saved your marketing copy"');
  PERFORM pg_temp.chk(_total = 6 * 11 * 24, format('rail matrix ran %s cells', _total));
  -- Voice (§3): no internal names or banned words in any new line.
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT 1 FROM _new_keys k, unnest(ARRAY['capability_succeeded','capability_failed','capability_refused',
        'capability_unreachable','capability_outcome_unknown','capability_completed_unrecorded']) o
      WHERE (public._workspace_event_display('capability_run', o, k.cap)->>'title') || ' ' ||
            (public._workspace_event_display('capability_run', o, k.cap)->>'summary')
            ~* '(ai-powered|seamless|streamline|growth_|vibe_|marketing_content|rpc|edge function)'),
    'new Rail lines carry no internal names or banned words');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. list_tool_autonomy: the previous catalogue minus draft_marketing_content
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
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM _lta_before WHERE tool_key = 'draft_marketing_content'), 'previous catalogue listed draft_marketing_content');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM _lta_after WHERE tool_key = 'draft_marketing_content'), 'draft_marketing_content row is gone');
  PERFORM pg_temp.chk(_after = _before - 1, format('exactly one row removed (before %s, after %s)', _before, _after));
  PERFORM pg_temp.chk(_gone = 1 AND _extra = 0, format('every other row identical, modes included (gone %s, extra %s)', _gone, _extra));
  PERFORM pg_temp.chk((SELECT mode FROM _lta_after WHERE tool_key = 'content_save') = 'auto'
    AND (SELECT mode FROM _lta_after WHERE tool_key = 'growth_page_save') = 'off', 'saving stays governed and listed with its stored mode');
  -- Tenant scope of the catalogue reader is unchanged: a signed-in member naming another tenant is refused.
  PERFORM pg_temp.chk(pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', 'authenticated',
      $q$SELECT count(*)::text FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0b1')$q$) LIKE 'err:42501:AUTONOMY_FORBIDDEN%',
    'list_tool_autonomy tenant-mismatch guard unchanged');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Grants and attributes unchanged
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
PERFORM pg_temp.chk(    has_function_privilege('authenticated', 'public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)', 'EXECUTE'), 'save: authenticated may execute');
PERFORM pg_temp.chk(    has_function_privilege('service_role',  'public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)', 'EXECUTE'), 'save: service_role may execute');
PERFORM pg_temp.chk(NOT has_function_privilege('anon',          'public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)', 'EXECUTE'), 'save: anon may not execute');
PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = 'public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)'::regprocedure AND a.grantee = 0), 'save: PUBLIC holds nothing');
PERFORM pg_temp.chk((SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
   WHERE oid = 'public.save_marketing_content(text,text,text,text,text,text,text,text,jsonb,uuid,uuid)'::regprocedure), 'save: SECURITY DEFINER, search_path=public');
PERFORM pg_temp.chk((SELECT count(*) FROM pg_proc WHERE proname = 'save_marketing_content') = 1, 'save: no new overload');
PERFORM pg_temp.chk(NOT has_function_privilege('anon',          'public._workspace_event_display(text,text,text)', 'EXECUTE'), 'rail display: anon may not execute');
PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public._workspace_event_display(text,text,text)', 'EXECUTE'), 'rail display: authenticated may not execute');
PERFORM pg_temp.chk((SELECT NOT prosecdef AND provolatile = 'i' FROM pg_proc WHERE oid = 'public._workspace_event_display(text,text,text)'::regprocedure), 'rail display: still IMMUTABLE invoker');
PERFORM pg_temp.chk(    has_function_privilege('authenticated', 'public.list_tool_autonomy(uuid)', 'EXECUTE'), 'catalogue: authenticated may execute');
PERFORM pg_temp.chk(    has_function_privilege('service_role',  'public.list_tool_autonomy(uuid)', 'EXECUTE'), 'catalogue: service_role may execute');
PERFORM pg_temp.chk(NOT has_function_privilege('anon',          'public.list_tool_autonomy(uuid)', 'EXECUTE'), 'catalogue: anon may not execute');
PERFORM pg_temp.chk(    has_table_privilege('authenticated', 'public.marketing_content', 'SELECT')
   AND NOT has_table_privilege('authenticated', 'public.marketing_content', 'INSERT')
   AND NOT has_table_privilege('authenticated', 'public.marketing_content', 'UPDATE')
   AND NOT has_table_privilege('authenticated', 'public.marketing_content', 'DELETE')
   AND NOT has_table_privilege('anon', 'public.marketing_content', 'SELECT'), 'table: authenticated SELECT only, anon nothing');
PERFORM pg_temp.chk((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketing_content') = 2
   AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'marketing_content' AND policyname = 'marketing_content_service'
               AND qual = '(auth.role() = ''service_role''::text)'), 'policies: still exactly two; the service policy is untouched');
PERFORM pg_temp.chk((SELECT qual = with_check AND qual NOT LIKE '%has_any_role%' AND qual NOT LIKE '%has_role%'
     AND qual LIKE '%is_tenant_admin(tenant_id)%' AND qual LIKE '%agency_can_manage_child(tenant_id)%' AND qual LIKE '%is_platform_owner()%'
   FROM pg_policies WHERE tablename = 'marketing_content' AND policyname = 'marketing_content_tenant_manage'), 'tenant_manage: tenant-scoped, no global role');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 160), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 30) f;
  IF _total < 1600 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'migration_d_studio_authority: % checks passed', _total;
END $$;
