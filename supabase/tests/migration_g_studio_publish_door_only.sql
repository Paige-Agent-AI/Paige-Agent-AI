-- ============================================================================
-- Migration G (Vibe Studio V2b.1) — repeatable proof for
--   20270554000000_studio_publish_door_only.sql
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The previous bodies of the eight publish/unpublish functions and
-- the growth helpers they call are carried here verbatim from 20270537000000 (the live go-live step is
-- installed from 20270548000001 itself), with production's grants, and section 0 proves each is
-- byte-identical to production's (pg_get_functiondef md5, read 2026-10-04), so "before" means what
-- prod runs. The platform helpers (is_tenant_admin, agency_can_manage_child, current_user_tenant_id …)
-- are production's bodies as Migration D's proof carries them. auth.uid()/auth.role() read session
-- settings (test.uid / test.role), as Supabase's own helpers read the JWT claims.
--
-- What it proves:
--   0. The previous bodies are production's.
--   1. Direct access is gone: `authenticated`, `anon` and PUBLIC can no longer execute any of the
--      eight (by privilege and by a real call); `service_role` can; the two-argument signatures no
--      longer exist.
--   2. The server path: a service-role call naming the workspace and the person publishes and records
--      that person on the audit row; without a person, without a workspace, with a person who lacks
--      the authority (plain member, another workspace's owner, an unassigned agency specialist, a
--      platform operator outside a company workspace, nobody), or naming another workspace's artifact,
--      it is refused and nothing changes. A signed-in caller can never name someone else.
--   3. Every guard answers exactly as before: each case's verdict under the new service-role path
--      equals its verdict under the previous signed-in path (status, errcode and message), and the
--      expected refusals are the expected ones.
--   4. Nothing else changed: every other function is byte-identical with the same ACL and attributes;
--      the eight keep SECURITY DEFINER, search_path, return type and owner; outside the actor lines
--      their bodies are the previous bodies.
--   5. Mutation proofs: each protection, broken on purpose inside a rolled-back subtransaction, makes
--      the matching probe answer differently — so the checks above can fail.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'migration_g_studio_publish_door_only_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated migration_g_studio_publish_door_only_contract database (got %)', current_database();
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

-- ── Production column shapes (information_schema, 2026-10-04) ────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','super_admin','platform_admin','coach','client');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY, parent_tenant_id uuid, account_type text NOT NULL DEFAULT 'standalone',
  features jsonb NOT NULL DEFAULT '{}'::jsonb, slug text);
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS public.agency_team_members (
  agency_tenant_id uuid NOT NULL, user_id uuid NOT NULL, agency_role text NOT NULL,
  status text NOT NULL DEFAULT 'active', scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.profiles (user_id uuid PRIMARY KEY, active_tenant_id uuid);
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action text NOT NULL, entity text NOT NULL,
  entity_id uuid, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.growth_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, slug text NOT NULL,
  title text NOT NULL, status text NOT NULL DEFAULT 'draft', template_key text,
  theme_json jsonb NOT NULL DEFAULT '{}'::jsonb, blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_json jsonb NOT NULL DEFAULT '{}'::jsonb, og_image_url text, published_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  draft_blocks_json jsonb, draft_theme_json jsonb, draft_seo_json jsonb);
CREATE TABLE IF NOT EXISTS public.growth_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, slug text NOT NULL,
  name text NOT NULL, status text NOT NULL DEFAULT 'draft', template_key text,
  schema_json jsonb NOT NULL DEFAULT '{"sections": []}'::jsonb,
  success_action_json jsonb NOT NULL DEFAULT '{"type": "thank_you"}'::jsonb,
  notify_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], auto_create_contact boolean NOT NULL DEFAULT true,
  auto_create_deal boolean NOT NULL DEFAULT false, pipeline_id uuid, stage_id uuid, workflow_slug text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  notify_email text, draft_schema_json jsonb, draft_success_action_json jsonb, published_at timestamptz);
CREATE TABLE IF NOT EXISTS public.growth_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, slug text NOT NULL, name text NOT NULL,
  status text NOT NULL DEFAULT 'draft', goal text, entry_page_id uuid, success_page_id uuid, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz);
CREATE TABLE IF NOT EXISTS public.growth_funnel_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), funnel_id uuid NOT NULL, tenant_id uuid NOT NULL,
  order_index integer NOT NULL DEFAULT 0, step_type text NOT NULL, page_id uuid, form_id uuid,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.marketing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid, kind text NOT NULL DEFAULT 'text', channel text,
  title text NOT NULL DEFAULT 'Untitled', body text, image_url text, image_path text, size text, brief text,
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','published','archived'])),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  work_id uuid, document_revision integer, published_at timestamptz);
-- Production table privileges for the signed-in and anonymous roles do not matter here: every write
-- below goes through a SECURITY DEFINER function, and the guard trigger refuses direct writes.

-- ── Platform helpers: production bodies (as migration_d_studio_authority.sql carries them) ────────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'::public.app_role); $$;
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::public.app_role); $$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND (role::text = 'platform_admin' OR role::text = 'super_admin')); $$;
CREATE OR REPLACE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT public.is_super_admin() OR public.is_platform_admin(auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.parent_tenant_id IS NULL
     AND t.account_type = 'standalone' AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)); $$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin'))
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
-- Production ACLs for the helpers (pg_proc.proacl, 2026-10-04).
REVOKE ALL ON FUNCTION public.agency_can_manage_child(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agency_can_manage_child(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.agency_can_manage_child(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_can_manage_child(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated, service_role;

-- ── The PREVIOUS bodies, verbatim from 20270537000000 (the live definitions) ─────────────────────
CREATE OR REPLACE FUNCTION public._growth_admin_tenant(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    -- The workspace's own owner or admin; or the agency that manages this sub-account, exactly as
    -- agency_can_manage_child scopes it (agency owner/admin/manager, a specialist only where
    -- assigned). Never a global role.
    IF _tenant IS NULL OR NOT (public.is_tenant_admin(_tenant) OR public.agency_can_manage_child(_tenant, auth.uid())) THEN
      RAISE EXCEPTION 'GROWTH_FORBIDDEN: the workspace owner or an admin is required' USING ERRCODE = '42501';
    END IF;
    RETURN _tenant;
  END IF;
  -- No signed-in user: only a server session may name the workspace.
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_direct_server_context()) THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: sign in to change this workspace' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  RETURN p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public._growth_admin_tenant(uuid) FROM PUBLIC, anon, authenticated, service_role;

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

CREATE OR REPLACE FUNCTION public._growth_form_go_live(_tenant uuid, _form_id uuid)
RETURNS public.growth_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.growth_forms;
BEGIN
  UPDATE public.growth_forms SET
    status = 'active',
    schema_json = COALESCE(draft_schema_json, schema_json),
    success_action_json = COALESCE(draft_success_action_json, success_action_json),
    published_at = now()
  WHERE id = _form_id AND tenant_id = _tenant AND status <> 'archived'
  RETURNING * INTO _row;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_FORM_MISSING: a form this needs is missing or archived' USING ERRCODE = '22023';
  END IF;
  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public._growth_form_go_live(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._growth_tenant_slug(_tenant uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE _slug text;
BEGIN
  SELECT slug INTO _slug FROM public.tenants WHERE id = _tenant;
  IF _slug IS NULL OR btrim(_slug) = '' THEN
    RAISE EXCEPTION 'GROWTH_NO_TENANT_SLUG: this workspace has no public slug — set one before publishing' USING ERRCODE = '22023';
  END IF;
  RETURN _slug;
END;
$$;
REVOKE ALL ON FUNCTION public._growth_tenant_slug(uuid) FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_growth_pages_publish_guard ON public.growth_pages;
CREATE TRIGGER trg_growth_pages_publish_guard BEFORE INSERT OR UPDATE OR DELETE ON public.growth_pages
  FOR EACH ROW EXECUTE FUNCTION public.growth_publish_state_guard();
DROP TRIGGER IF EXISTS trg_growth_forms_publish_guard ON public.growth_forms;
CREATE TRIGGER trg_growth_forms_publish_guard BEFORE INSERT OR UPDATE OR DELETE ON public.growth_forms
  FOR EACH ROW EXECUTE FUNCTION public.growth_publish_state_guard();
DROP TRIGGER IF EXISTS trg_growth_funnels_publish_guard ON public.growth_funnels;
CREATE TRIGGER trg_growth_funnels_publish_guard BEFORE INSERT OR UPDATE OR DELETE ON public.growth_funnels
  FOR EACH ROW EXECUTE FUNCTION public.growth_publish_state_guard();
DROP TRIGGER IF EXISTS trg_growth_funnel_steps_publish_guard ON public.growth_funnel_steps;
CREATE TRIGGER trg_growth_funnel_steps_publish_guard BEFORE INSERT OR UPDATE OR DELETE ON public.growth_funnel_steps
  FOR EACH ROW EXECUTE FUNCTION public.growth_publish_state_guard();
DROP TRIGGER IF EXISTS trg_marketing_content_publish_guard ON public.marketing_content;
CREATE TRIGGER trg_marketing_content_publish_guard BEFORE INSERT OR UPDATE OR DELETE ON public.marketing_content
  FOR EACH ROW EXECUTE FUNCTION public.growth_publish_state_guard();

-- The live go-live step for pages (Migration F replaced the 20270537000000 body).
\ir ../migrations/20270548000001_growth_placeholder_check_per_string.sql

CREATE OR REPLACE FUNCTION public.growth_page_publish(p_tenant_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid;
  _row    public.growth_pages;
  _tenant_slug text;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  IF NOT EXISTS (SELECT 1 FROM public.growth_pages WHERE id = p_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002';
  END IF;
  _tenant_slug := public._growth_tenant_slug(_tenant);
  _row := public._growth_page_go_live(_tenant, p_id);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'growth_pages', 'growth_page_publish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', '/p/' || _tenant_slug || '/' || _row.slug);
END; $function$;

CREATE OR REPLACE FUNCTION public.growth_page_unpublish(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_pages; _used_by text;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  SELECT * INTO _row FROM public.growth_pages WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status <> 'published' THEN
    RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
  END IF;
  SELECT f.name INTO _used_by FROM public.growth_funnels f
   WHERE f.tenant_id = _tenant AND f.status = 'active'
     AND (f.entry_page_id = _row.id OR f.success_page_id = _row.id
          OR EXISTS (SELECT 1 FROM public.growth_funnel_steps s WHERE s.funnel_id = f.id AND s.page_id = _row.id))
   LIMIT 1;
  IF _used_by IS NOT NULL THEN
    RAISE EXCEPTION 'GROWTH_PAGE_IN_USE: the live funnel "%" uses this page — unpublish the funnel first', _used_by USING ERRCODE = '22023';
  END IF;
  -- Its forms stay live (owner ruling 2026-09-30).
  UPDATE public.growth_pages SET status = 'draft' WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'growth_pages', 'growth_page_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_form_publish(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_forms; _tenant_slug text;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  IF NOT EXISTS (SELECT 1 FROM public.growth_forms WHERE id = p_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: form not found in this tenant' USING ERRCODE = 'P0002';
  END IF;
  _tenant_slug := public._growth_tenant_slug(_tenant);
  _row := public._growth_form_go_live(_tenant, p_id);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'growth_forms', 'growth_form_publish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', '/form/' || _row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_form_unpublish(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_forms; _used_by text;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  SELECT * INTO _row FROM public.growth_forms WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: form not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status <> 'active' THEN
    RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
  END IF;
  -- A live page or funnel that collects through this form would break.
  SELECT p.title INTO _used_by FROM public.growth_pages p, jsonb_array_elements(COALESCE(p.blocks_json, '[]'::jsonb)) b
   WHERE p.tenant_id = _tenant AND p.status = 'published'
     AND b->>'type' = 'embedded_form' AND btrim(b->>'form_slug') = _row.slug LIMIT 1;
  IF _used_by IS NULL THEN
    SELECT f.name INTO _used_by FROM public.growth_funnel_steps s JOIN public.growth_funnels f ON f.id = s.funnel_id
     WHERE s.tenant_id = _tenant AND s.form_id = _row.id AND f.status = 'active' LIMIT 1;
  END IF;
  IF _used_by IS NOT NULL THEN
    RAISE EXCEPTION 'GROWTH_FORM_IN_USE: "%" is live and collects through this form — unpublish it first', _used_by USING ERRCODE = '22023';
  END IF;
  UPDATE public.growth_forms SET status = 'draft' WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'growth_forms', 'growth_form_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_funnel_publish(p_tenant_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid;
  _row    public.growth_funnels;
  _tenant_slug text;
  _pid uuid;
  _fid uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  SELECT * INTO _row FROM public.growth_funnels WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status = 'archived' THEN RAISE EXCEPTION 'GROWTH_ARCHIVED: this funnel is archived' USING ERRCODE = '22023'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.growth_funnel_steps WHERE funnel_id = _row.id) THEN
    RAISE EXCEPTION 'GROWTH_FUNNEL_EMPTY: this funnel has no steps yet — add at least one before publishing' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.growth_funnel_steps WHERE funnel_id = _row.id AND step_type = 'page' AND page_id IS NULL) THEN
    RAISE EXCEPTION 'GROWTH_FUNNEL_STEP_INCOMPLETE: a page step has no page attached' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.growth_funnel_steps WHERE funnel_id = _row.id AND step_type = 'form' AND form_id IS NULL) THEN
    RAISE EXCEPTION 'GROWTH_FUNNEL_STEP_INCOMPLETE: a form step has no form attached' USING ERRCODE = '22023';
  END IF;

  _tenant_slug := public._growth_tenant_slug(_tenant);

  FOR _pid IN
    SELECT DISTINCT x FROM (
      SELECT page_id AS x FROM public.growth_funnel_steps WHERE funnel_id = _row.id AND page_id IS NOT NULL
      UNION SELECT _row.entry_page_id UNION SELECT _row.success_page_id) u
    WHERE x IS NOT NULL
  LOOP
    PERFORM public._growth_page_go_live(_tenant, _pid);
  END LOOP;
  FOR _fid IN SELECT DISTINCT form_id FROM public.growth_funnel_steps WHERE funnel_id = _row.id AND form_id IS NOT NULL LOOP
    PERFORM public._growth_form_go_live(_tenant, _fid);
  END LOOP;

  UPDATE public.growth_funnels SET status = 'active', published_at = now(), updated_at = now()
  WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'growth_funnels', 'growth_funnel_publish', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));

  RETURN jsonb_build_object(
    'id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', '/f/' || _tenant_slug || '/' || _row.slug);
END; $function$;

CREATE OR REPLACE FUNCTION public.growth_funnel_unpublish(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_funnels;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  SELECT * INTO _row FROM public.growth_funnels WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status <> 'active' THEN
    RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
  END IF;
  -- Its pages and forms stay live (owner ruling 2026-09-30: unpublish separately).
  UPDATE public.growth_funnels SET status = 'draft', updated_at = now() WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'growth_funnels', 'growth_funnel_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_image_publish(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.marketing_content;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  SELECT * INTO _row FROM public.marketing_content WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: image not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.kind <> 'image' OR NULLIF(btrim(COALESCE(_row.image_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NOT_AN_IMAGE: only a finished image can be published' USING ERRCODE = '22023';
  END IF;
  IF _row.status = 'archived' THEN RAISE EXCEPTION 'GROWTH_ARCHIVED: this image is archived' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.studio_publish_op', 'on', true);
  UPDATE public.marketing_content SET status = 'published', published_at = now()
   WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  PERFORM set_config('app.studio_publish_op', 'off', true);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'marketing_content', 'studio_image_publish', _row.id, jsonb_build_object('tenant_id', _tenant));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status, 'published_at', _row.published_at, 'url', _row.image_url);
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_image_unpublish(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.marketing_content;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  SELECT * INTO _row FROM public.marketing_content WHERE id = p_id AND tenant_id = _tenant AND kind = 'image';
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: image not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status <> 'published' THEN
    RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
  END IF;
  PERFORM set_config('app.studio_publish_op', 'on', true);
  UPDATE public.marketing_content SET status = 'draft' WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  PERFORM set_config('app.studio_publish_op', 'off', true);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'marketing_content', 'studio_image_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

-- Production grants on the eight before this migration (pg_proc.proacl, 2026-10-04):
-- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}.
REVOKE ALL ON FUNCTION public.growth_page_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_page_unpublish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_form_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_form_unpublish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_funnel_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_funnel_unpublish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.studio_image_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.studio_image_unpublish(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.growth_page_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_page_unpublish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_unpublish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_unpublish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_image_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_image_unpublish(uuid, uuid) TO authenticated, service_role;

-- ── Harness ──────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial, ok boolean, what text);
GRANT ALL ON _checks TO PUBLIC;
GRANT ALL ON SEQUENCE _checks_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

-- Run _sql as a caller and KEEP its effects: _uid ('' = none), _jwt_role (auth.role()), _db_role
-- ('' = stay postgres, a direct server session). Returns 'ok:<first column>' or 'err:<SQLSTATE>:<message>'.
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

-- The same, but every effect is rolled back (the probe raises its own answer out of a subtransaction),
-- so the same fixture answers every case before and after the migration. A jsonb answer is reported
-- without its id and published_at (they differ by row and by clock, never by behaviour).
CREATE FUNCTION pg_temp.try(_uid text, _jwt_role text, _db_role text, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM set_config('test.uid', _uid, true);
  PERFORM set_config('test.role', _jwt_role, true);
  BEGIN
    IF _db_role <> '' THEN EXECUTE format('SET LOCAL ROLE %I', _db_role); END IF;
    EXECUTE _sql INTO _r;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || coalesce((_r - 'id' - 'published_at')::text, '<null>');
  EXCEPTION
    WHEN SQLSTATE 'ZZ999' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- ── Synthetic fixtures ───────────────────────────────────────────────────────────────────────────
-- TA, TB: standalone workspaces. AG: an agency; CH its sub-account. TC: a company (system) workspace.
-- TN: a workspace with no public slug.
INSERT INTO public.tenants (id, parent_tenant_id, account_type, features, slug) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', NULL, 'standalone', '{}', 'ta'),
  ('00000000-0000-4000-8000-00000000d0b1', NULL, 'standalone', '{}', 'tb'),
  ('00000000-0000-4000-8000-00000000d0c1', NULL, 'agency', '{}', 'ag'),
  ('00000000-0000-4000-8000-00000000d0c2', '00000000-0000-4000-8000-00000000d0c1', 'sub_account', '{}', 'ch'),
  ('00000000-0000-4000-8000-00000000d0d1', NULL, 'standalone', '{"system_workspace": true}', 'tc'),
  ('00000000-0000-4000-8000-00000000d0e1', NULL, 'standalone', '{}', NULL)
ON CONFLICT DO NOTHING;
-- e001 OWN owner of TA · e002 ADM admin of TA · e003 MEM plain member of TA holding the GLOBAL admin
-- role · e004 TBO owner of TB · e006 AGM agency_manager of AG (active CH) · e007 SPEC agency_specialist
-- of AG assigned nowhere (active CH) · e008 PO platform owner (super_admin), member of nothing (active
-- TC) · e009 NOBODY · e00b NSO owner of TN.
INSERT INTO public.tenant_members (tenant_id, user_id, role, joined_at) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e002', 'admin',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e003', 'member', now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e004', 'owner',  now() - interval '9 days'),
  ('00000000-0000-4000-8000-00000000d0e1', '00000000-0000-4000-8000-00000000e00b', 'owner',  now() - interval '9 days')
ON CONFLICT DO NOTHING;
INSERT INTO public.agency_team_members (agency_tenant_id, user_id, agency_role, scoped_subaccounts)
SELECT * FROM (VALUES
  ('00000000-0000-4000-8000-00000000d0c1'::uuid, '00000000-0000-4000-8000-00000000e006'::uuid, 'agency_manager', '{}'::uuid[]),
  ('00000000-0000-4000-8000-00000000d0c1'::uuid, '00000000-0000-4000-8000-00000000e007'::uuid, 'agency_specialist', '{}'::uuid[])) v
WHERE NOT EXISTS (SELECT 1 FROM public.agency_team_members);
INSERT INTO public.user_roles (user_id, role)
SELECT * FROM (VALUES
  ('00000000-0000-4000-8000-00000000e003'::uuid, 'admin'::public.app_role),
  ('00000000-0000-4000-8000-00000000e008'::uuid, 'super_admin'::public.app_role)) v
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles);
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000d0b1'),
  ('00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-00000000d0c2'),
  ('00000000-0000-4000-8000-00000000e007', '00000000-0000-4000-8000-00000000d0c2'),
  ('00000000-0000-4000-8000-00000000e008', '00000000-0000-4000-8000-00000000d0d1'),
  ('00000000-0000-4000-8000-00000000e00b', '00000000-0000-4000-8000-00000000d0e1')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- Artifacts. Ids: a1xx in TA, b1xx in TB, c2xx in CH, d1xx in TC, e1xx in TN.
INSERT INTO public.growth_forms (id, tenant_id, slug, name, status, draft_schema_json) VALUES
  ('00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-00000000d0a1', 'intake',  'Intake',   'draft',    '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000a102', '00000000-0000-4000-8000-00000000d0a1', 'old',     'Old',      'archived', '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000a103', '00000000-0000-4000-8000-00000000d0a1', 'onpage',  'On page',  'active',   '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000a104', '00000000-0000-4000-8000-00000000d0a1', 'infunnel','In funnel','active',   '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000a105', '00000000-0000-4000-8000-00000000d0a1', 'free',    'Free',     'active',   '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000d0b1', 'tbform',  'TB form',  'draft',    '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000c201', '00000000-0000-4000-8000-00000000d0c2', 'chform',  'CH form',  'draft',    '{"sections":[]}'),
  ('00000000-0000-4000-8000-00000000e101', '00000000-0000-4000-8000-00000000d0e1', 'tnform',  'TN form',  'draft',    '{"sections":[]}')
ON CONFLICT DO NOTHING;
INSERT INTO public.growth_pages (id, tenant_id, slug, title, status, blocks_json, draft_blocks_json) VALUES
  ('00000000-0000-4000-8000-00000000a201', '00000000-0000-4000-8000-00000000d0a1', 'ok',       'OK',        'draft',     '[]', '[{"type":"hero","headline":"Get your weekends back"}]'),
  ('00000000-0000-4000-8000-00000000a202', '00000000-0000-4000-8000-00000000d0a1', 'withform', 'With form', 'draft',     '[]', '[{"type":"hero","headline":"Join"},{"type":"embedded_form","form_slug":"intake"}]'),
  ('00000000-0000-4000-8000-00000000a203', '00000000-0000-4000-8000-00000000d0a1', 'ghost',    'Ghost',     'draft',     '[]', '[{"type":"embedded_form","form_slug":"ghost"}]'),
  ('00000000-0000-4000-8000-00000000a204', '00000000-0000-4000-8000-00000000d0a1', 'ph',       'Placeholder','draft',    '[]', '[{"type":"hero","headline":"Join us on [ADD_WEBINAR_DATE]"}]'),
  ('00000000-0000-4000-8000-00000000a205', '00000000-0000-4000-8000-00000000d0a1', 'nodraft',  'No draft',  'draft',     '[]', NULL),
  ('00000000-0000-4000-8000-00000000a206', '00000000-0000-4000-8000-00000000d0a1', 'arch',     'Archived',  'archived',  '[]', '[{"type":"hero","headline":"x"}]'),
  ('00000000-0000-4000-8000-00000000a207', '00000000-0000-4000-8000-00000000d0a1', 'livefun',  'Live in funnel','published','[{"type":"hero","headline":"x"}]', NULL),
  ('00000000-0000-4000-8000-00000000a208', '00000000-0000-4000-8000-00000000d0a1', 'livefree', 'Live free', 'published', '[{"type":"hero","headline":"x"}]', NULL),
  ('00000000-0000-4000-8000-00000000a209', '00000000-0000-4000-8000-00000000d0a1', 'liveform', 'Live with form','published','[{"type":"embedded_form","form_slug":"onpage"}]', NULL),
  ('00000000-0000-4000-8000-00000000a20a', '00000000-0000-4000-8000-00000000d0a1', 'step',     'Funnel step','draft',    '[]', '[{"type":"hero","headline":"Step"}]'),
  ('00000000-0000-4000-8000-00000000a20b', '00000000-0000-4000-8000-00000000d0a1', 'stepph',   'Funnel step ph','draft', '[]', '[{"type":"hero","headline":"[Your name]"}]'),
  ('00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000d0b1', 'tbpage',   'TB page',   'draft',     '[]', '[{"type":"hero","headline":"x"}]'),
  ('00000000-0000-4000-8000-00000000c202', '00000000-0000-4000-8000-00000000d0c2', 'chpage',   'CH page',   'draft',     '[]', '[{"type":"hero","headline":"x"}]'),
  ('00000000-0000-4000-8000-00000000d201', '00000000-0000-4000-8000-00000000d0d1', 'tcpage',   'TC page',   'draft',     '[]', '[{"type":"hero","headline":"x"}]'),
  ('00000000-0000-4000-8000-00000000e201', '00000000-0000-4000-8000-00000000d0e1', 'tnpage',   'TN page',   'draft',     '[]', '[{"type":"hero","headline":"x"}]')
ON CONFLICT DO NOTHING;
INSERT INTO public.growth_funnels (id, tenant_id, slug, name, status, entry_page_id) VALUES
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-4000-8000-00000000d0a1', 'ok',       'OK funnel',        'draft',    NULL),
  ('00000000-0000-4000-8000-00000000a302', '00000000-0000-4000-8000-00000000d0a1', 'empty',    'Empty funnel',     'draft',    NULL),
  ('00000000-0000-4000-8000-00000000a303', '00000000-0000-4000-8000-00000000d0a1', 'nopage',   'Missing page',     'draft',    NULL),
  ('00000000-0000-4000-8000-00000000a304', '00000000-0000-4000-8000-00000000d0a1', 'noform',   'Missing form',     'draft',    NULL),
  ('00000000-0000-4000-8000-00000000a305', '00000000-0000-4000-8000-00000000d0a1', 'arch',     'Archived funnel',  'archived', NULL),
  ('00000000-0000-4000-8000-00000000a306', '00000000-0000-4000-8000-00000000d0a1', 'live',     'Live funnel',      'active',   '00000000-0000-4000-8000-00000000a207'),
  ('00000000-0000-4000-8000-00000000a307', '00000000-0000-4000-8000-00000000d0a1', 'stepph',   'Placeholder step', 'draft',    NULL),
  ('00000000-0000-4000-8000-00000000b301', '00000000-0000-4000-8000-00000000d0b1', 'tbfunnel', 'TB funnel',        'draft',    NULL)
ON CONFLICT DO NOTHING;
INSERT INTO public.growth_funnel_steps (funnel_id, tenant_id, order_index, step_type, page_id, form_id)
SELECT * FROM (VALUES
  ('00000000-0000-4000-8000-00000000a301'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 0, 'page', '00000000-0000-4000-8000-00000000a20a'::uuid, NULL::uuid),
  ('00000000-0000-4000-8000-00000000a301'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 1, 'form', NULL::uuid, '00000000-0000-4000-8000-00000000a101'::uuid),
  ('00000000-0000-4000-8000-00000000a303'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 0, 'page', NULL::uuid, NULL::uuid),
  ('00000000-0000-4000-8000-00000000a304'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 0, 'form', NULL::uuid, NULL::uuid),
  ('00000000-0000-4000-8000-00000000a305'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 0, 'page', '00000000-0000-4000-8000-00000000a20a'::uuid, NULL::uuid),
  ('00000000-0000-4000-8000-00000000a306'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 0, 'form', NULL::uuid, '00000000-0000-4000-8000-00000000a104'::uuid),
  ('00000000-0000-4000-8000-00000000a307'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 0, 'page', '00000000-0000-4000-8000-00000000a20b'::uuid, NULL::uuid),
  ('00000000-0000-4000-8000-00000000b301'::uuid, '00000000-0000-4000-8000-00000000d0b1'::uuid, 0, 'page', '00000000-0000-4000-8000-00000000b201'::uuid, NULL::uuid)) v
WHERE NOT EXISTS (SELECT 1 FROM public.growth_funnel_steps);
-- Images. A published row can only be written under the publish marker, as production's guard demands.
SELECT set_config('app.studio_publish_op', 'on', false);
INSERT INTO public.marketing_content (id, tenant_id, kind, title, image_url, status, published_at) VALUES
  ('00000000-0000-4000-8000-00000000a401', '00000000-0000-4000-8000-00000000d0a1', 'image', 'Banner',    'https://img.tests.invalid/a.png', 'draft',     NULL),
  ('00000000-0000-4000-8000-00000000a402', '00000000-0000-4000-8000-00000000d0a1', 'text',  'Caption',   NULL,                              'draft',     NULL),
  ('00000000-0000-4000-8000-00000000a403', '00000000-0000-4000-8000-00000000d0a1', 'image', 'No file',   NULL,                              'draft',     NULL),
  ('00000000-0000-4000-8000-00000000a404', '00000000-0000-4000-8000-00000000d0a1', 'image', 'Archived',  'https://img.tests.invalid/b.png', 'archived',  NULL),
  ('00000000-0000-4000-8000-00000000a405', '00000000-0000-4000-8000-00000000d0a1', 'image', 'Live',      'https://img.tests.invalid/c.png', 'published', now()),
  ('00000000-0000-4000-8000-00000000b401', '00000000-0000-4000-8000-00000000d0b1', 'image', 'TB banner', 'https://img.tests.invalid/d.png', 'draft',     NULL)
ON CONFLICT DO NOTHING;
SELECT set_config('app.studio_publish_op', 'off', false);

-- ── Cases: every guard in the eight, each answered by the workspace's owner ───────────────────────
-- Short ids expand to the synthetic uuids: pg_temp.u('d0a1') = 00000000-0000-4000-8000-00000000d0a1.
CREATE FUNCTION pg_temp.u(_short text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '00000000-0000-4000-8000-00000000' || _short $$;
CREATE TEMP TABLE _cases (label text PRIMARY KEY, fn text, tenant text, owner text, id text);
INSERT INTO _cases VALUES
  ('page publish: ok',                         'growth_page_publish',    'd0a1', 'e001', 'a201'),
  ('page publish: publishes its form',         'growth_page_publish',    'd0a1', 'e001', 'a202'),
  ('page publish: signup form missing',        'growth_page_publish',    'd0a1', 'e001', 'a203'),
  ('page publish: placeholder',                'growth_page_publish',    'd0a1', 'e001', 'a204'),
  ('page publish: nothing saved',              'growth_page_publish',    'd0a1', 'e001', 'a205'),
  ('page publish: archived',                   'growth_page_publish',    'd0a1', 'e001', 'a206'),
  ('page publish: not found',                  'growth_page_publish',    'd0a1', 'e001', 'a2ff'),
  ('page publish: another workspace''s page',  'growth_page_publish',    'd0a1', 'e001', 'b201'),
  ('page publish: workspace has no slug',      'growth_page_publish',    'd0e1', 'e00b', 'e201'),
  ('page unpublish: used by a live funnel',    'growth_page_unpublish',  'd0a1', 'e001', 'a207'),
  ('page unpublish: ok',                       'growth_page_unpublish',  'd0a1', 'e001', 'a208'),
  ('page unpublish: not live (no-op)',         'growth_page_unpublish',  'd0a1', 'e001', 'a201'),
  ('page unpublish: not found',                'growth_page_unpublish',  'd0a1', 'e001', 'a2ff'),
  ('form publish: ok',                         'growth_form_publish',    'd0a1', 'e001', 'a101'),
  ('form publish: archived',                   'growth_form_publish',    'd0a1', 'e001', 'a102'),
  ('form publish: not found',                  'growth_form_publish',    'd0a1', 'e001', 'a1ff'),
  ('form publish: another workspace''s form',  'growth_form_publish',    'd0a1', 'e001', 'b101'),
  ('form publish: workspace has no slug',      'growth_form_publish',    'd0e1', 'e00b', 'e101'),
  ('form unpublish: on a live page',           'growth_form_unpublish',  'd0a1', 'e001', 'a103'),
  ('form unpublish: in a live funnel',         'growth_form_unpublish',  'd0a1', 'e001', 'a104'),
  ('form unpublish: ok',                       'growth_form_unpublish',  'd0a1', 'e001', 'a105'),
  ('form unpublish: not live (no-op)',         'growth_form_unpublish',  'd0a1', 'e001', 'a101'),
  ('form unpublish: not found',                'growth_form_unpublish',  'd0a1', 'e001', 'a1ff'),
  ('funnel publish: ok (pages and forms too)', 'growth_funnel_publish',  'd0a1', 'e001', 'a301'),
  ('funnel publish: no steps',                 'growth_funnel_publish',  'd0a1', 'e001', 'a302'),
  ('funnel publish: page step incomplete',     'growth_funnel_publish',  'd0a1', 'e001', 'a303'),
  ('funnel publish: form step incomplete',     'growth_funnel_publish',  'd0a1', 'e001', 'a304'),
  ('funnel publish: archived',                 'growth_funnel_publish',  'd0a1', 'e001', 'a305'),
  ('funnel publish: a step page has a placeholder','growth_funnel_publish','d0a1', 'e001', 'a307'),
  ('funnel publish: not found',                'growth_funnel_publish',  'd0a1', 'e001', 'a3ff'),
  ('funnel publish: another workspace''s funnel','growth_funnel_publish', 'd0a1', 'e001', 'b301'),
  ('funnel unpublish: ok',                     'growth_funnel_unpublish','d0a1', 'e001', 'a306'),
  ('funnel unpublish: not live (no-op)',       'growth_funnel_unpublish','d0a1', 'e001', 'a301'),
  ('funnel unpublish: not found',              'growth_funnel_unpublish','d0a1', 'e001', 'a3ff'),
  ('image publish: ok',                        'studio_image_publish',   'd0a1', 'e001', 'a401'),
  ('image publish: not an image',              'studio_image_publish',   'd0a1', 'e001', 'a402'),
  ('image publish: no file',                   'studio_image_publish',   'd0a1', 'e001', 'a403'),
  ('image publish: archived',                  'studio_image_publish',   'd0a1', 'e001', 'a404'),
  ('image publish: not found',                 'studio_image_publish',   'd0a1', 'e001', 'a4ff'),
  ('image publish: another workspace''s image','studio_image_publish',   'd0a1', 'e001', 'b401'),
  ('image unpublish: ok',                      'studio_image_unpublish', 'd0a1', 'e001', 'a405'),
  ('image unpublish: not live (no-op)',        'studio_image_unpublish', 'd0a1', 'e001', 'a401'),
  ('image unpublish: not an image row',        'studio_image_unpublish', 'd0a1', 'e001', 'a402');
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 0. The previous bodies are production's (pg_get_functiondef md5, read 2026-10-04)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE _prod_md5 (fn text PRIMARY KEY, md5 text);
INSERT INTO _prod_md5 VALUES
  ('growth_page_publish(uuid,uuid)',     'df17613b02c912c0b7da2fc3f18d0a84'),
  ('growth_page_unpublish(uuid,uuid)',   '5ae0a59825de70b8ce963012f317f47b'),
  ('growth_form_publish(uuid,uuid)',     '1a39cd4955bdef6701c61182a1212dc2'),
  ('growth_form_unpublish(uuid,uuid)',   'a72f3bf432adc04b0a02b1e54c112617'),
  ('growth_funnel_publish(uuid,uuid)',   'a083350ce67d0bcd125e632762d7743b'),
  ('growth_funnel_unpublish(uuid,uuid)', '0d7b9939886c210a6c4fec29abc34615'),
  ('studio_image_publish(uuid,uuid)',    'd843cf3679c198c28b8357673da78085'),
  ('studio_image_unpublish(uuid,uuid)',  'c96182f7c54ede2617e35687fd060c79'),
  ('_growth_admin_tenant(uuid)',         '6afa5f1c7fb298dc77d748abe6c70ce2'),
  ('_growth_page_go_live(uuid,uuid)',    'd83ae6e305890c40ee72a6910dac2cea'),
  ('_growth_form_go_live(uuid,uuid)',    '4183c4f3fc90f0ed58d751482f896620'),
  ('_growth_tenant_slug(uuid)',          '38d9d7d81b663f9ec4e301d7998577af'),
  ('growth_publish_state_guard()',       'bedfb266401e59224813f45ea5a6dfa7');
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN SELECT fn, md5 FROM _prod_md5 LOOP
    PERFORM pg_temp.chk(md5(pg_get_functiondef(('public.' || rec.fn)::regprocedure)) = rec.md5,
      format('previous %s = production (md5 %s…)', rec.fn, left(rec.md5, 8)));
  END LOOP;
  -- Production's ACL on the eight: owner, authenticated, service_role (no PUBLIC, no anon).
  FOR rec IN SELECT fn FROM _prod_md5 WHERE fn ~ '_(un)?publish\(' LOOP
    PERFORM pg_temp.chk((SELECT proacl::text FROM pg_proc WHERE oid = ('public.' || rec.fn)::regprocedure)
        = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
      format('previous %s carries production''s grants', rec.fn));
  END LOOP;
END $$;

-- ── Snapshots before the migration ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE _fn_before AS
SELECT p.oid::regprocedure::text AS fn, md5(pg_get_functiondef(p.oid)) AS def, p.proacl::text AS acl,
       p.prosecdef, p.provolatile, p.proconfig::text AS cfg, p.proowner, p.prorettype, p.prosrc,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;

-- The previous answer for every case: the workspace's owner, signed in, through the old signature.
CREATE TEMP TABLE _before AS
SELECT c.label, pg_temp.try(pg_temp.u(c.owner), 'authenticated', 'authenticated',
         format('SELECT public.%I(NULL::uuid, %L::uuid)', c.fn, pg_temp.u(c.id))) AS verdict
FROM _cases c;

-- The gap, measured on the previous grants: a signed-in owner calls the publish function directly
-- (as a browser console could), and it goes live with no lane, no approval and no receipt.
DO $$ BEGIN
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.growth_page_publish(uuid,uuid)', 'EXECUTE'),
    'the gap, before: authenticated may execute growth_page_publish');
  PERFORM pg_temp.chk((SELECT verdict FROM _before WHERE label = 'page publish: ok') LIKE 'ok:%"status": "published"%',
    'the gap, before: a signed-in owner publishes directly: ' || (SELECT verdict FROM _before WHERE label = 'page publish: ok'));
END $$;

-- ── The REAL migration, twice (clean application + replay) ───────────────────────────────────────
\ir ../migrations/20270554000000_studio_publish_door_only.sql
\ir ../migrations/20270554000000_studio_publish_door_only.sql

-- The new answer for every case: the publish door's call — service role, the workspace it resolved,
-- and the person it verified.
CREATE TEMP TABLE _after AS
SELECT c.label, pg_temp.try('', 'service_role', 'service_role',
         format('SELECT public.%I(p_tenant_id => %L::uuid, p_id => %L::uuid, p_actor_id => %L::uuid)',
                c.fn, pg_temp.u(c.tenant), pg_temp.u(c.id), pg_temp.u(c.owner))) AS verdict
FROM _cases c;

CREATE TEMP TABLE _eight (fn text PRIMARY KEY);
INSERT INTO _eight VALUES ('growth_page_publish'), ('growth_page_unpublish'), ('growth_form_publish'), ('growth_form_unpublish'),
  ('growth_funnel_publish'), ('growth_funnel_unpublish'), ('studio_image_publish'), ('studio_image_unpublish');

-- A service-role call as SQL text. NULL means pass NULL.
CREATE FUNCTION pg_temp.svc(_fn text, _tenant text, _id text, _actor text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.%I(p_tenant_id => %s, p_id => %L::uuid, p_actor_id => %s)', _fn,
    CASE WHEN _tenant IS NULL THEN 'NULL::uuid' ELSE quote_literal(pg_temp.u(_tenant)) || '::uuid' END,
    pg_temp.u(_id),
    CASE WHEN _actor IS NULL THEN 'NULL::uuid' ELSE quote_literal(pg_temp.u(_actor)) || '::uuid' END) $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Direct access is gone
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE rec record; r text; sig text;
BEGIN
  FOR rec IN SELECT fn FROM _eight LOOP
    sig := format('public.%s(uuid,uuid,uuid)', rec.fn);
    PERFORM pg_temp.chk(to_regprocedure(format('public.%s(uuid,uuid)', rec.fn)) IS NULL,
      rec.fn || ': the two-argument signature no longer exists');
    PERFORM pg_temp.chk(to_regprocedure(sig) IS NOT NULL, rec.fn || ': the three-argument signature exists');
    PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', sig, 'EXECUTE'), rec.fn || ': authenticated cannot execute it');
    PERFORM pg_temp.chk(NOT has_function_privilege('anon', sig, 'EXECUTE'), rec.fn || ': anon cannot execute it');
    PERFORM pg_temp.chk(has_function_privilege('service_role', sig, 'EXECUTE'), rec.fn || ': service_role can execute it');
    PERFORM pg_temp.chk((SELECT proacl::text FROM pg_proc WHERE oid = sig::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}',
      rec.fn || ': its ACL is exactly owner + service_role (no PUBLIC): ' || (SELECT proacl::text FROM pg_proc WHERE oid = sig::regprocedure));
    -- A real call as a signed-in owner (the browser console) and as anon: refused by privilege.
    r := pg_temp.try(pg_temp.u('e001'), 'authenticated', 'authenticated',
      format('SELECT public.%I(p_tenant_id => NULL::uuid, p_id => %L::uuid)', rec.fn, pg_temp.u('a201')));
    PERFORM pg_temp.chk(r LIKE 'err:42501:permission denied for function ' || rec.fn || '%', rec.fn || ': a signed-in owner''s direct call is refused: ' || r);
    r := pg_temp.try(pg_temp.u('e001'), 'authenticated', 'authenticated', pg_temp.svc(rec.fn, NULL, 'a201', 'e001'));
    PERFORM pg_temp.chk(r LIKE 'err:42501:permission denied for function ' || rec.fn || '%', rec.fn || ': naming themselves as the person does not help: ' || r);
    r := pg_temp.try('', 'anon', 'anon', pg_temp.svc(rec.fn, 'd0a1', 'a201', 'e001'));
    PERFORM pg_temp.chk(r LIKE 'err:42501:permission denied for function ' || rec.fn || '%', rec.fn || ': anon is refused: ' || r);
  END LOOP;
  PERFORM pg_temp.chk(to_regprocedure('public._studio_publish_actor(uuid,uuid)') IS NOT NULL
     AND NOT has_function_privilege('authenticated', 'public._studio_publish_actor(uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public._studio_publish_actor(uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public._studio_publish_actor(uuid,uuid)', 'EXECUTE'),
    'the actor helper is callable by its owner only');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. The server path: an explicit workspace and a real person, or nothing
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r text; f text; _audits int;
BEGIN
  -- Each of the eight refuses a server call with no person, with no workspace, and with a person who
  -- lacks the authority in the named workspace.
  FOR f IN SELECT fn FROM _eight LOOP
    r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc(f, 'd0a1', 'a201', NULL));
    PERFORM pg_temp.chk(r LIKE 'err:22023:GROWTH_NO_ACTOR:%', f || ': a service-role call without the person is refused: ' || r);
    r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc(f, NULL, 'a201', 'e001'));
    PERFORM pg_temp.chk(r LIKE 'err:22023:GROWTH_NO_TENANT:%', f || ': a service-role call without the workspace is refused: ' || r);
    r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc(f, 'd0a1', 'a201', 'e003'));
    PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN:%', f || ': a plain member (holding the GLOBAL admin role) as the person is refused: ' || r);
    r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc(f, 'd0a1', 'a201', 'e004'));
    PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN:%', f || ': another workspace''s owner as the person is refused: ' || r);
    r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc(f, 'd0a1', 'a201', 'e009'));
    PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN:%', f || ': a person with no membership is refused: ' || r);
    -- No signed-in user and no server session (anon JWT role, run as the owner so privilege is not what stops it).
    r := pg_temp.try('', 'anon', '', pg_temp.svc(f, 'd0a1', 'a201', 'e001'));
    PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN: sign in%', f || ': with no signed-in user and no server session, nothing runs: ' || r);
  END LOOP;

  -- Publish as the owner: it goes live and the audit row names the owner, never NULL.
  SELECT count(*) INTO _audits FROM public.audit_logs;
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_page_publish', 'd0a1', 'a201', 'e001') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "published"%', 'service role + workspace + owner publishes a page: ' || r);
  PERFORM pg_temp.chk((SELECT status FROM public.growth_pages WHERE id = pg_temp.u('a201')::uuid) = 'published', 'the page is live');
  PERFORM pg_temp.chk((SELECT count(*) FROM public.audit_logs) = _audits + 1, 'exactly one audit row');
  PERFORM pg_temp.chk((SELECT user_id::text FROM public.audit_logs WHERE action = 'growth_page_publish' AND entity_id = pg_temp.u('a201')::uuid) = pg_temp.u('e001')
     AND (SELECT data->>'tenant_id' FROM public.audit_logs WHERE action = 'growth_page_publish' AND entity_id = pg_temp.u('a201')::uuid) = pg_temp.u('d0a1'),
    'the audit row records the real person and the workspace');

  -- An admin; the managing agency's manager in its sub-account; the platform owner in a company workspace.
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_page_unpublish', 'd0a1', 'a201', 'e002') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "draft"%'
     AND (SELECT user_id::text FROM public.audit_logs WHERE action = 'growth_page_unpublish' AND entity_id = pg_temp.u('a201')::uuid) = pg_temp.u('e002'),
    'an admin unpublishes and is recorded: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_page_publish', 'd0c2', 'c202', 'e006') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "published"%'
     AND (SELECT user_id::text FROM public.audit_logs WHERE action = 'growth_page_publish' AND entity_id = pg_temp.u('c202')::uuid) = pg_temp.u('e006'),
    'the managing agency''s manager publishes in the sub-account and is recorded: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_page_publish', 'd0d1', 'd201', 'e008') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "published"%'
     AND (SELECT user_id::text FROM public.audit_logs WHERE action = 'growth_page_publish' AND entity_id = pg_temp.u('d201')::uuid) = pg_temp.u('e008'),
    'the platform owner publishes in the company workspace and is recorded: ' || r);
  -- …but not outside it, and an unassigned agency specialist is not the managing agency.
  r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc('growth_page_unpublish', 'd0a1', 'a208', 'e008'));
  PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN:%', 'the platform owner is refused in an ordinary workspace: ' || r);
  r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc('growth_page_publish', 'd0c2', 'c202', 'e007'));
  PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN:%', 'an agency specialist not assigned to the sub-account is refused: ' || r);
  -- The workspace bounds the artifact: TB's owner naming TB cannot reach TA's page.
  r := pg_temp.try('', 'service_role', 'service_role', pg_temp.svc('growth_page_publish', 'd0b1', 'a204', 'e004'));
  PERFORM pg_temp.chk(r LIKE 'err:P0002:GROWTH_NOT_FOUND:%', 'another workspace''s artifact is not found from the named workspace: ' || r);

  -- A direct server session (no JWT role) follows the same rule: the person is required.
  r := pg_temp.try('', '', '', pg_temp.svc('studio_image_publish', 'd0a1', 'a401', NULL));
  PERFORM pg_temp.chk(r LIKE 'err:22023:GROWTH_NO_ACTOR:%', 'a direct server session without the person is refused: ' || r);
  r := pg_temp.try('', '', '', pg_temp.svc('studio_image_publish', 'd0a1', 'a401', 'e001'));
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "published"%', 'a direct server session naming the owner publishes: ' || r);

  -- A signed-in caller (reaching the body some other way, e.g. a future grant) can never name someone else.
  r := pg_temp.try(pg_temp.u('e001'), 'authenticated', '', pg_temp.svc('growth_form_publish', NULL, 'a101', 'e002'));
  PERFORM pg_temp.chk(r LIKE 'err:42501:GROWTH_FORBIDDEN: a signed-in caller can only act as themselves%', 'a signed-in caller naming another person is refused: ' || r);
  r := pg_temp.run(pg_temp.u('e001'), 'authenticated', '', pg_temp.svc('growth_form_publish', NULL, 'a105', NULL) || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "active"%'
     AND (SELECT user_id::text FROM public.audit_logs WHERE action = 'growth_form_publish' AND entity_id = pg_temp.u('a105')::uuid) = pg_temp.u('e001'),
    'a signed-in caller is recorded as themselves: ' || r);
  -- Every audit row any of the eight wrote names a person.
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action ~ '_(un)?publish$' AND user_id IS NULL),
    'no publish audit row has a NULL person');
END $$;

-- Refusals changed nothing: rows the refusals above aimed at are where they started.
DO $$ BEGIN
  PERFORM pg_temp.chk((SELECT status FROM public.growth_pages WHERE id = pg_temp.u('a208')::uuid) = 'published'
     AND (SELECT status FROM public.growth_pages WHERE id = pg_temp.u('a204')::uuid) = 'draft'
     AND (SELECT status FROM public.growth_funnels WHERE id = pg_temp.u('a301')::uuid) = 'draft'
     AND (SELECT status FROM public.marketing_content WHERE id = pg_temp.u('a405')::uuid) = 'published'
     AND (SELECT status FROM public.growth_pages WHERE id = pg_temp.u('c202')::uuid) = 'published',
    'refused calls changed nothing');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Every guard answers exactly as before
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE rec record;
BEGIN
  PERFORM pg_temp.chk((SELECT count(*) FROM _cases) = 43 AND (SELECT count(*) FROM _before) = 43 AND (SELECT count(*) FROM _after) = 43, 'every case ran');
  FOR rec IN SELECT c.label, b.verdict AS before, a.verdict AS after FROM _cases c JOIN _before b USING (label) JOIN _after a USING (label) LOOP
    PERFORM pg_temp.chk(rec.before = rec.after, format('same answer before and after: %s (%s / %s)', rec.label, left(rec.before, 120), left(rec.after, 120)));
  END LOOP;
END $$;
-- The answers are the expected ones, not merely equal.
CREATE TEMP TABLE _expect (label text PRIMARY KEY, pattern text);
INSERT INTO _expect VALUES
  ('page publish: ok',                         'ok:%"status": "published"%'),
  ('page publish: publishes its form',         'ok:%"status": "published"%'),
  ('page publish: signup form missing',        'err:22023:GROWTH_FORM_MISSING: a signup form on this page does not exist yet%'),
  ('page publish: placeholder',                'err:22023:GROWTH_UNRESOLVED_PLACEHOLDER:%'),
  ('page publish: nothing saved',              'err:22023:GROWTH_NO_DRAFT:%'),
  ('page publish: archived',                   'err:22023:GROWTH_ARCHIVED:%'),
  ('page publish: not found',                  'err:P0002:GROWTH_NOT_FOUND:%'),
  ('page publish: another workspace''s page',  'err:P0002:GROWTH_NOT_FOUND:%'),
  ('page publish: workspace has no slug',      'err:22023:GROWTH_NO_TENANT_SLUG:%'),
  ('page unpublish: used by a live funnel',    'err:22023:GROWTH_PAGE_IN_USE: the live funnel "Live funnel" uses this page%'),
  ('page unpublish: ok',                       'ok:{"status": "draft"}'),
  ('page unpublish: not live (no-op)',         'ok:{"status": "draft"}'),
  ('page unpublish: not found',                'err:P0002:GROWTH_NOT_FOUND:%'),
  ('form publish: ok',                         'ok:%"status": "active"%'),
  ('form publish: archived',                   'err:22023:GROWTH_FORM_MISSING:%'),
  ('form publish: not found',                  'err:P0002:GROWTH_NOT_FOUND:%'),
  ('form publish: another workspace''s form',  'err:P0002:GROWTH_NOT_FOUND:%'),
  ('form publish: workspace has no slug',      'err:22023:GROWTH_NO_TENANT_SLUG:%'),
  ('form unpublish: on a live page',           'err:22023:GROWTH_FORM_IN_USE: "Live with form" is live%'),
  ('form unpublish: in a live funnel',         'err:22023:GROWTH_FORM_IN_USE: "Live funnel" is live%'),
  ('form unpublish: ok',                       'ok:{"status": "draft"}'),
  ('form unpublish: not live (no-op)',         'ok:{"status": "draft"}'),
  ('form unpublish: not found',                'err:P0002:GROWTH_NOT_FOUND:%'),
  ('funnel publish: ok (pages and forms too)', 'ok:%"status": "active"%'),
  ('funnel publish: no steps',                 'err:22023:GROWTH_FUNNEL_EMPTY:%'),
  ('funnel publish: page step incomplete',     'err:22023:GROWTH_FUNNEL_STEP_INCOMPLETE: a page step%'),
  ('funnel publish: form step incomplete',     'err:22023:GROWTH_FUNNEL_STEP_INCOMPLETE: a form step%'),
  ('funnel publish: archived',                 'err:22023:GROWTH_ARCHIVED:%'),
  ('funnel publish: a step page has a placeholder','err:22023:GROWTH_UNRESOLVED_PLACEHOLDER:%'),
  ('funnel publish: not found',                'err:P0002:GROWTH_NOT_FOUND:%'),
  ('funnel publish: another workspace''s funnel','err:P0002:GROWTH_NOT_FOUND:%'),
  ('funnel unpublish: ok',                     'ok:{"status": "draft"}'),
  ('funnel unpublish: not live (no-op)',       'ok:{"status": "draft"}'),
  ('funnel unpublish: not found',              'err:P0002:GROWTH_NOT_FOUND:%'),
  ('image publish: ok',                        'ok:%"status": "published"%'),
  ('image publish: not an image',              'err:22023:GROWTH_NOT_AN_IMAGE:%'),
  ('image publish: no file',                   'err:22023:GROWTH_NOT_AN_IMAGE:%'),
  ('image publish: archived',                  'err:22023:GROWTH_ARCHIVED:%'),
  ('image publish: not found',                 'err:P0002:GROWTH_NOT_FOUND:%'),
  ('image publish: another workspace''s image','err:P0002:GROWTH_NOT_FOUND:%'),
  ('image unpublish: ok',                      'ok:{"status": "draft"}'),
  ('image unpublish: not live (no-op)',        'ok:{"status": "draft"}'),
  ('image unpublish: not an image row',        'err:P0002:GROWTH_NOT_FOUND:%');
DO $$
DECLARE rec record;
BEGIN
  PERFORM pg_temp.chk((SELECT count(*) FROM _expect) = (SELECT count(*) FROM _cases), 'every case has an expected answer');
  FOR rec IN SELECT a.label, a.verdict, e.pattern FROM _after a JOIN _expect e USING (label) LOOP
    PERFORM pg_temp.chk(rec.verdict LIKE rec.pattern, format('expected answer: %s (%s)', rec.label, left(rec.verdict, 160)));
  END LOOP;
END $$;
-- The go-live side effects are unchanged on the new path (kept effects).
DO $$
DECLARE r text;
BEGIN
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_page_publish', 'd0a1', 'a202', 'e001') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%' AND (SELECT status FROM public.growth_forms WHERE id = pg_temp.u('a101')::uuid) = 'active',
    'publishing a page still publishes the form on it: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_funnel_publish', 'd0a1', 'a301', 'e001') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%' AND (SELECT status FROM public.growth_pages WHERE id = pg_temp.u('a20a')::uuid) = 'published',
    'publishing a funnel still publishes its pages: ' || r);
  r := pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('studio_image_unpublish', 'd0a1', 'a405', 'e001') || '::text');
  PERFORM pg_temp.chk(r LIKE 'ok:%"status": "draft"%' AND (SELECT status FROM public.marketing_content WHERE id = pg_temp.u('a405')::uuid) = 'draft',
    'an image still comes down under the publish marker: ' || r);
  PERFORM pg_temp.chk(coalesce(current_setting('app.studio_publish_op', true), 'off') <> 'on', 'the publish marker is not left on');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. Nothing else changed
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE rec record; _old text; _new text;
BEGIN
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT fn, def FROM _fn_before WHERE fn !~ '^(growth_(page|form|funnel)|studio_image)_(un)?publish\(uuid,uuid\)$'
      EXCEPT
      SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'every other function is byte-identical');
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT fn, acl, prosecdef, provolatile, cfg, proowner, prorettype, args FROM _fn_before
       WHERE fn !~ '^(growth_(page|form|funnel)|studio_image)_(un)?publish\(uuid,uuid\)$'
      EXCEPT
      SELECT p.oid::regprocedure::text, p.proacl::text, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.prorettype,
             pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'every other function keeps its signature, attributes, owner and ACL');
  PERFORM pg_temp.chk((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) = (SELECT count(*) FROM _fn_before) + 1,
    'exactly one function added (the actor helper); the eight are replaced, not duplicated');
  FOR rec IN SELECT fn FROM _eight LOOP
    PERFORM pg_temp.chk((SELECT p.prosecdef AND p.proconfig::text = '{search_path=public}' AND p.prorettype = 'jsonb'::regtype
                                AND p.proowner = (SELECT proowner FROM _fn_before WHERE fn = rec.fn || '(uuid,uuid)')
                           FROM pg_proc p WHERE p.oid = format('public.%s(uuid,uuid,uuid)', rec.fn)::regprocedure),
      rec.fn || ': SECURITY DEFINER, search_path, return type and owner unchanged');
    -- Outside the actor lines, the body is the previous body.
    SELECT prosrc INTO _old FROM _fn_before WHERE fn = rec.fn || '(uuid,uuid)';
    SELECT prosrc INTO _new FROM pg_proc WHERE oid = format('public.%s(uuid,uuid,uuid)', rec.fn)::regprocedure;
    _new := replace(_new, E'\n  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,\n  -- who must hold the same authority in this workspace.\n  _actor := public._studio_publish_actor(_tenant, p_actor_id);', '');
    _new := replace(replace(_new, ' _actor uuid;', ''), E'\n  _actor  uuid;', '');
    _new := replace(_new, 'VALUES (_actor,', 'VALUES (auth.uid(),');
    PERFORM pg_temp.chk(_new = _old, rec.fn || ': outside the actor lines the body is the previous body');
    PERFORM pg_temp.chk((SELECT prosrc FROM pg_proc WHERE oid = format('public.%s(uuid,uuid,uuid)', rec.fn)::regprocedure) !~ 'auth\.uid\(\)',
      rec.fn || ': the body no longer reads auth.uid() for the audit row');
  END LOOP;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Mutation proofs — each protection broken on purpose, inside a rolled-back subtransaction
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Each probe must answer differently once its protection is removed.
CREATE FUNCTION pg_temp.probe(_name text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN CASE _name
    WHEN 'console' THEN pg_temp.try(pg_temp.u('e001'), 'authenticated', 'authenticated', pg_temp.svc('growth_page_unpublish', NULL, 'a208', NULL))
    WHEN 'anon' THEN pg_temp.try('', 'anon', 'anon', pg_temp.svc('growth_page_unpublish', 'd0a1', 'a208', 'e001'))
    WHEN 'no_actor' THEN pg_temp.try('', 'service_role', 'service_role', pg_temp.svc('growth_page_unpublish', 'd0a1', 'a208', NULL))
    WHEN 'no_tenant' THEN pg_temp.try('', 'service_role', 'service_role', pg_temp.svc('growth_page_unpublish', NULL, 'a208', 'e001'))
    WHEN 'member' THEN pg_temp.try('', 'service_role', 'service_role', pg_temp.svc('growth_page_unpublish', 'd0a1', 'a208', 'e003'))
    WHEN 'impersonate' THEN pg_temp.try(pg_temp.u('e001'), 'authenticated', '', pg_temp.svc('growth_page_unpublish', NULL, 'a208', 'e002'))
    WHEN 'audit_actor' THEN (
      SELECT coalesce(string_agg(coalesce(user_id::text, '<null>'), ','), '<none>') FROM public.audit_logs
       WHERE action = 'growth_page_unpublish' AND entity_id = pg_temp.u('a208')::uuid)
  END;
END $$;
DO $$
DECLARE
  _base jsonb := '{}'; _mut jsonb := '{}'; m text; p text; _def text;
  _muts text[] := ARRAY[
    'grant back to authenticated',             'console',
    'grant back to anon',                      'anon',
    'drop the person requirement',             'no_actor',
    'drop the explicit-workspace requirement', 'no_tenant',
    'drop the person''s authority check',      'member',
    'trust a named person on a signed-in call','impersonate',
    'record auth.uid() on the audit row',      'audit_actor'];
  i int;
BEGIN
  FOR i IN 1 .. array_length(_muts, 1) / 2 LOOP
    p := _muts[2 * i];
    _base := _base || jsonb_build_object(p, pg_temp.probe(p));
  END LOOP;
  FOR i IN 1 .. array_length(_muts, 1) / 2 LOOP
    m := _muts[2 * i - 1]; p := _muts[2 * i];
    BEGIN
      CASE m
        WHEN 'grant back to authenticated' THEN
          GRANT EXECUTE ON FUNCTION public.growth_page_unpublish(uuid, uuid, uuid) TO authenticated;
        WHEN 'grant back to anon' THEN
          GRANT EXECUTE ON FUNCTION public.growth_page_unpublish(uuid, uuid, uuid) TO anon;
        WHEN 'drop the person requirement' THEN
          _def := pg_get_functiondef('public._studio_publish_actor(uuid,uuid)'::regprocedure);
          EXECUTE replace(replace(_def, 'IF p_actor_id IS NULL THEN', 'IF false THEN'), 'IF NOT (', 'IF p_actor_id IS NOT NULL AND NOT (');
        WHEN 'drop the explicit-workspace requirement' THEN
          _def := pg_get_functiondef('public._growth_admin_tenant(uuid)'::regprocedure);
          EXECUTE replace(_def, 'IF p_tenant_id IS NULL THEN', 'IF false THEN');
        WHEN 'drop the person''s authority check' THEN
          _def := pg_get_functiondef('public._studio_publish_actor(uuid,uuid)'::regprocedure);
          EXECUTE replace(_def, 'IF NOT (', 'IF false AND NOT (');
        WHEN 'trust a named person on a signed-in call' THEN
          _def := pg_get_functiondef('public._studio_publish_actor(uuid,uuid)'::regprocedure);
          EXECUTE replace(replace(_def, 'IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN', 'IF false THEN'),
                          'RETURN auth.uid();', 'RETURN COALESCE(p_actor_id, auth.uid());');
        WHEN 'record auth.uid() on the audit row' THEN
          _def := pg_get_functiondef('public.growth_page_unpublish(uuid,uuid,uuid)'::regprocedure);
          EXECUTE replace(_def, 'VALUES (_actor,', 'VALUES (auth.uid(),');
      END CASE;
      IF p = 'audit_actor' THEN
        PERFORM pg_temp.run('', 'service_role', 'service_role', pg_temp.svc('growth_page_unpublish', 'd0a1', 'a208', 'e001') || '::text');
      END IF;
      _mut := _mut || jsonb_build_object(p, pg_temp.probe(p));
      RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
    EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
    END;
    PERFORM pg_temp.chk(_mut->>p IS DISTINCT FROM _base->>p,
      format('mutation "%s" is caught: probe %s answered %s (protected: %s)', m, p, left(_mut->>p, 90), left(_base->>p, 90)));
  END LOOP;
  -- The protected answers themselves, so a probe that never ran cannot pass.
  PERFORM pg_temp.chk(_base->>'console' LIKE 'err:42501:permission denied%', 'protected: the console call is refused by privilege: ' || (_base->>'console'));
  PERFORM pg_temp.chk(_base->>'anon' LIKE 'err:42501:permission denied%', 'protected: anon is refused by privilege: ' || (_base->>'anon'));
  PERFORM pg_temp.chk(_base->>'no_actor' LIKE 'err:22023:GROWTH_NO_ACTOR:%', 'protected: no person is refused: ' || (_base->>'no_actor'));
  PERFORM pg_temp.chk(_base->>'no_tenant' LIKE 'err:22023:GROWTH_NO_TENANT:%', 'protected: no workspace is refused: ' || (_base->>'no_tenant'));
  PERFORM pg_temp.chk(_base->>'member' LIKE 'err:42501:GROWTH_FORBIDDEN:%', 'protected: a plain member is refused: ' || (_base->>'member'));
  PERFORM pg_temp.chk(_base->>'impersonate' LIKE 'err:42501:GROWTH_FORBIDDEN:%', 'protected: impersonation is refused: ' || (_base->>'impersonate'));
  PERFORM pg_temp.chk(_base->>'audit_actor' = '<none>', 'protected: no unpublish of that page was recorded before the probe');
  PERFORM pg_temp.chk(_mut->>'audit_actor' = '<null>', 'mutated: reverting the audit row to auth.uid() records no person: ' || (_mut->>'audit_actor'));
  -- Every mutation was rolled back.
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public.growth_page_unpublish(uuid,uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.growth_page_unpublish(uuid,uuid,uuid)', 'EXECUTE')
     AND md5(pg_get_functiondef('public._growth_admin_tenant(uuid)'::regprocedure)) = '6afa5f1c7fb298dc77d748abe6c70ce2'
     AND (SELECT status FROM public.growth_pages WHERE id = pg_temp.u('a208')::uuid) = 'published'
     AND NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'growth_page_unpublish' AND entity_id = pg_temp.u('a208')::uuid),
    'every mutation was rolled back');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 200 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'migration_g_studio_publish_door_only: % checks passed', _total;
END $$;
