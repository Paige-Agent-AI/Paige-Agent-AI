-- Vibe Studio publish lifecycle (owner rulings 2026-09-30 and 2026-10-03).
--
-- One publish rule for everything Vibe Studio makes: unpublished work lives in Vibe Studio,
-- published work lives in the Catalog, new work starts unpublished, and only Publish and
-- Unpublish move it between the two. Publishing a page or funnel publishes the forms (and, for a
-- funnel, the pages) it needs; unpublishing a page or funnel leaves those forms live.
--
-- Authority: the workspace's own owner or admin (is_tenant_admin of the caller's active
-- workspace), never a global role (§59: a global admin role is tenant-agnostic). Server
-- callers with no signed-in user keep the existing explicit-tenant path.
--
-- Also closes two findings from the 2026-10-03 grounding pass:
--   * list_artifact_versions was executable by anon and trusted a caller-supplied tenant when
--     auth.uid() is NULL (§59 caller scope).
--   * studio_role_ok passed anyone who is owner/admin of ANY workspace, including a plain member
--     of the workspace they are acting in.
--
-- Reversibility: additive columns, a widened CHECK, a changed column default, replaced function
-- bodies, new functions and one trigger. No data is deleted. Existing rows keep their status;
-- the four forms already live stay live. Reverting means restoring the prior function bodies
-- (read from prod with pg_get_functiondef on 2026-10-03) and dropping the new objects.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────────────────────────────────────
-- Forms get a working copy, as pages already have: the live columns are what visitors see,
-- draft_* is what the owner is editing. Unpublished forms keep both equal.
ALTER TABLE public.growth_forms
  ADD COLUMN IF NOT EXISTS draft_schema_json jsonb,
  ADD COLUMN IF NOT EXISTS draft_success_action_json jsonb,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.growth_forms ALTER COLUMN status SET DEFAULT 'draft';
UPDATE public.growth_forms SET
  draft_schema_json = COALESCE(draft_schema_json, schema_json),
  draft_success_action_json = COALESCE(draft_success_action_json, success_action_json),
  published_at = CASE WHEN status = 'active' THEN COALESCE(published_at, updated_at, created_at) ELSE published_at END
WHERE draft_schema_json IS NULL OR draft_success_action_json IS NULL
   OR (status = 'active' AND published_at IS NULL);

ALTER TABLE public.growth_funnels ADD COLUMN IF NOT EXISTS published_at timestamptz;
UPDATE public.growth_funnels SET published_at = updated_at
  WHERE status = 'active' AND published_at IS NULL;

-- Images Vibe Studio makes can be published to the Catalog too.
ALTER TABLE public.marketing_content ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.marketing_content DROP CONSTRAINT IF EXISTS marketing_content_status_check;
ALTER TABLE public.marketing_content ADD CONSTRAINT marketing_content_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Who may write: the active workspace's owner or admin
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns the tenant a growth writer acts in. Signed in: the caller's active workspace, and only
-- if they are its owner or admin. No signed-in user (service role / server): the explicit tenant.
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

-- Studio sessions: owner or admin of the workspace the caller is acting in.
CREATE OR REPLACE FUNCTION public.studio_role_ok(_caller uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _caller IS NOT NULL
     AND _caller = auth.uid()
     AND (public.is_tenant_admin(public.current_user_tenant_id())
          OR public.agency_can_manage_child(public.current_user_tenant_id(), _caller));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Publish state changes only through the publish functions
-- ─────────────────────────────────────────────────────────────────────────────
-- The growth tables are writable by any active member through RLS, which would let a member
-- change what visitors see, rewrite a working copy that then goes live on the owner's next
-- publish, or delete a live page out from under a funnel. Nothing in the app writes these tables
-- directly (every write goes through the functions below, which run as their owner), so signed-in
-- and anonymous roles may no longer write them directly at all. Images keep their existing
-- writers; only their published state, and a published image's file, are held to Vibe Studio.
CREATE OR REPLACE FUNCTION public.growth_publish_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME <> 'marketing_content' THEN
    RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: pages, forms and funnels change through Vibe Studio' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: new work starts unpublished' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: unpublish this image before deleting it' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.published_at IS DISTINCT FROM OLD.published_at
     OR (NEW.status IS DISTINCT FROM OLD.status AND (NEW.status = 'published' OR OLD.status = 'published'))
     OR (OLD.status = 'published' AND (NEW.image_url IS DISTINCT FROM OLD.image_url OR NEW.body IS DISTINCT FROM OLD.body)) THEN
    RAISE EXCEPTION 'GROWTH_PUBLISH_STATE_GUARDED: publishing goes through Vibe Studio' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Internal go-live steps (no caller checks; only the functions below call them)
-- ─────────────────────────────────────────────────────────────────────────────
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

CREATE OR REPLACE FUNCTION public._growth_page_go_live(_tenant uuid, _id uuid)
RETURNS public.growth_pages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.growth_pages;
  _blocks jsonb;
  _form_id uuid;
  _form_slug text;
BEGIN
  SELECT * INTO _row FROM public.growth_pages WHERE id = _id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status = 'archived' THEN RAISE EXCEPTION 'GROWTH_ARCHIVED: this page is archived' USING ERRCODE = '22023'; END IF;
  _blocks := CASE WHEN jsonb_typeof(_row.draft_blocks_json) = 'array' THEN _row.draft_blocks_json
                  WHEN _row.status = 'published' AND jsonb_typeof(_row.blocks_json) = 'array' THEN _row.blocks_json END;
  IF _blocks IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NO_DRAFT: nothing to publish — save the page first' USING ERRCODE = '22023';
  END IF;
  IF _blocks::text ~ '\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]'
     OR _blocks::text ~* '\[[^\]]*\y(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\y[^\]]*\]'
     OR COALESCE(_row.draft_seo_json::text, '') ~ '\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]'
     OR COALESCE(_row.draft_seo_json::text, '') ~* '\[[^\]]*\y(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\y[^\]]*\]' THEN
    RAISE EXCEPTION 'GROWTH_UNRESOLVED_PLACEHOLDER: page has unresolved editable placeholders (e.g. [ADD_WEBINAR_DATE]) — fill them before publishing' USING ERRCODE = '22023';
  END IF;

  -- A signup section with no form behind it would publish as an empty box.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_blocks) b
              WHERE b->>'type' = 'embedded_form' AND NULLIF(btrim(COALESCE(b->>'form_slug', '')), '') IS NULL) THEN
    RAISE EXCEPTION 'GROWTH_FORM_MISSING: a signup section on this page has no form — ask Paige to add one before publishing' USING ERRCODE = '22023';
  END IF;

  -- Publishing a page publishes the forms on it (owner ruling 2026-09-30).
  FOR _form_slug IN
    SELECT DISTINCT btrim(b->>'form_slug') FROM jsonb_array_elements(_blocks) b
     WHERE b->>'type' = 'embedded_form' AND NULLIF(btrim(COALESCE(b->>'form_slug', '')), '') IS NOT NULL
  LOOP
    SELECT id INTO _form_id FROM public.growth_forms
     WHERE tenant_id = _tenant AND slug = _form_slug AND status <> 'archived';
    IF _form_id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_FORM_MISSING: a signup form on this page does not exist yet — re-save the page to author it before publishing' USING ERRCODE = '22023';
    END IF;
    PERFORM public._growth_form_go_live(_tenant, _form_id);
  END LOOP;

  UPDATE public.growth_pages SET
    blocks_json = _blocks,
    theme_json  = COALESCE(draft_theme_json, theme_json),
    seo_json    = COALESCE(draft_seo_json, seo_json),
    status = 'published', published_at = now()
  WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public._growth_page_go_live(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Forms
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.growth_form_upsert(p_tenant_id uuid, p_slug text, p_name text, p_schema_json jsonb, p_success_action_json jsonb DEFAULT NULL::jsonb, p_auto_create_contact boolean DEFAULT true, p_pipeline_id uuid DEFAULT NULL::uuid, p_stage_id uuid DEFAULT NULL::uuid, p_id uuid DEFAULT NULL::uuid)
 RETURNS growth_forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _slug   text := NULLIF(btrim(p_slug), '');
  _row    public.growth_forms;
  _existing public.growth_forms;
  _schema_ok boolean;
  _sections  jsonb;
  _section   jsonb;
  _field     jsonb;
  _vw        jsonb;
  _cond      jsonb;
  _seen      text[] := ARRAY[]::text[];
  _key       text;
  _ftype     text;
  _maps      text;
  _fieldcount int := 0;
  _success   jsonb;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  IF _slug IS NULL THEN
    RAISE EXCEPTION 'GROWTH_INVALID_SLUG: a non-empty slug is required' USING ERRCODE = '22023';
  END IF;

  -- Validate schema shape: an object with a `sections` array, or a bare array of sections.
  _schema_ok := p_schema_json IS NOT NULL AND (
       (jsonb_typeof(p_schema_json) = 'object' AND jsonb_typeof(p_schema_json->'sections') = 'array')
    OR (jsonb_typeof(p_schema_json) = 'array')
  );
  IF NOT _schema_ok THEN
    RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: schema_json must be {sections:[…]} or an array of sections'
      USING ERRCODE = '22023';
  END IF;

  _sections := CASE WHEN jsonb_typeof(p_schema_json) = 'array'
                    THEN p_schema_json ELSE p_schema_json->'sections' END;
  IF jsonb_array_length(_sections) > 40 THEN
    RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: too many sections (max 40)' USING ERRCODE = '22023';
  END IF;

  FOR _section IN SELECT value FROM jsonb_array_elements(_sections) LOOP
    _vw := _section->'visible_when';
    IF jsonb_typeof(_vw) = 'object' THEN
      FOR _cond IN SELECT value FROM jsonb_array_elements(
             (CASE WHEN jsonb_typeof(_vw->'all') = 'array' THEN _vw->'all' ELSE '[]'::jsonb END)
          || (CASE WHEN jsonb_typeof(_vw->'any') = 'array' THEN _vw->'any' ELSE '[]'::jsonb END)
      ) LOOP
        IF _cond->>'field' IS NULL OR NOT (_cond->>'field' = ANY(_seen)) THEN
          RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: a section branches on unknown or later field "%"',
            COALESCE(_cond->>'field', '(null)') USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    IF jsonb_typeof(_section->'fields') <> 'array' THEN
      RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: each section must have a fields array' USING ERRCODE = '22023';
    END IF;

    FOR _field IN SELECT value FROM jsonb_array_elements(_section->'fields') LOOP
      _fieldcount := _fieldcount + 1;
      IF _fieldcount > 200 THEN
        RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: too many fields (max 200)' USING ERRCODE = '22023';
      END IF;

      _key := NULLIF(btrim(COALESCE(_field->>'key', '')), '');
      IF _key IS NULL THEN
        RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: every field needs a non-empty key' USING ERRCODE = '22023';
      END IF;

      _vw := _field->'visible_when';
      IF jsonb_typeof(_vw) = 'object' THEN
        FOR _cond IN SELECT value FROM jsonb_array_elements(
               (CASE WHEN jsonb_typeof(_vw->'all') = 'array' THEN _vw->'all' ELSE '[]'::jsonb END)
            || (CASE WHEN jsonb_typeof(_vw->'any') = 'array' THEN _vw->'any' ELSE '[]'::jsonb END)
        ) LOOP
          IF _cond->>'field' IS NULL OR NOT (_cond->>'field' = ANY(_seen)) THEN
            RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: field "%" branches on unknown or later field "%"',
              _key, COALESCE(_cond->>'field', '(null)') USING ERRCODE = '22023';
          END IF;
        END LOOP;
      END IF;

      IF _key = ANY(_seen) THEN
        RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: duplicate field key "%"', _key USING ERRCODE = '22023';
      END IF;

      _ftype := _field->>'type';
      IF _ftype IN ('select','radio','checkbox') THEN
        IF jsonb_typeof(_field->'options') <> 'array'
           OR jsonb_array_length(_field->'options') = 0 THEN
          RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: field "%" (%) needs at least one option',
            _key, _ftype USING ERRCODE = '22023';
        END IF;
      END IF;

      _maps := NULLIF(btrim(COALESCE(_field->>'maps_to', '')), '');
      IF _maps IS NOT NULL
         AND _maps !~ '^(clients|businesses)\.[a-z0-9_]+$'
         AND _maps !~ '^custom\.[a-z][a-z0-9_]{1,49}$' THEN
        RAISE EXCEPTION 'GROWTH_INVALID_SCHEMA: field "%" maps_to must target clients.<column>, businesses.<column>, or custom.<key>',
          _key USING ERRCODE = '22023';
      END IF;

      _seen := array_append(_seen, _key);
    END LOOP;
  END LOOP;

  -- Resolve identity before any write: by id, else by slug in this tenant.
  IF p_id IS NOT NULL THEN
    SELECT * INTO _existing FROM public.growth_forms WHERE id = p_id AND tenant_id = _tenant;
    IF _existing.id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_NOT_FOUND: form not found in this tenant' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT * INTO _existing FROM public.growth_forms WHERE tenant_id = _tenant AND slug = _slug;
  END IF;

  IF _existing.id IS NULL THEN
    _success := COALESCE(p_success_action_json,
                         '{"type":"thank_you","message":"Thanks — we''ll be in touch."}'::jsonb);
    INSERT INTO public.growth_forms (
      tenant_id, slug, name, status, schema_json, success_action_json,
      draft_schema_json, draft_success_action_json,
      auto_create_contact, pipeline_id, stage_id, created_by
    ) VALUES (
      _tenant, _slug, COALESCE(NULLIF(btrim(p_name), ''), 'Lead form'), 'draft',
      p_schema_json, _success, p_schema_json, _success,
      COALESCE(p_auto_create_contact, true), p_pipeline_id, p_stage_id, _caller
    )
    ON CONFLICT (tenant_id, slug) DO NOTHING
    RETURNING * INTO _row;
    -- Lost a race with another save of the same slug: update that form instead.
    IF _row.id IS NULL THEN
      SELECT * INTO _existing FROM public.growth_forms WHERE tenant_id = _tenant AND slug = _slug;
    END IF;
  END IF;

  IF _existing.id IS NOT NULL THEN
    -- Pages embed a form by its slug, so a live form's slug cannot change underneath them.
    IF _existing.status = 'active' AND _existing.slug <> _slug THEN
      RAISE EXCEPTION 'GROWTH_FORM_LIVE_SLUG: this form is live — unpublish it to change its address' USING ERRCODE = '22023';
    END IF;
    _success := COALESCE(p_success_action_json, _existing.draft_success_action_json, _existing.success_action_json);
    -- A live form keeps what visitors see until it is published again; an unpublished form's
    -- live and working copies stay equal.
    UPDATE public.growth_forms SET
      slug                      = _slug,
      name                      = COALESCE(NULLIF(btrim(p_name), ''), name),
      draft_schema_json         = p_schema_json,
      draft_success_action_json = _success,
      schema_json               = CASE WHEN status = 'active' THEN schema_json ELSE p_schema_json END,
      success_action_json       = CASE WHEN status = 'active' THEN success_action_json ELSE _success END,
      auto_create_contact       = COALESCE(p_auto_create_contact, auto_create_contact),
      pipeline_id               = COALESCE(p_pipeline_id, pipeline_id),
      stage_id                  = COALESCE(p_stage_id, stage_id)
    WHERE id = _existing.id AND tenant_id = _tenant
    RETURNING * INTO _row;
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'growth_forms', 'growth_form_upsert', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug, 'status', _row.status));

  RETURN _row;
END;
$function$;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Pages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.growth_page_upsert(p_tenant_id uuid, p_slug text, p_title text, p_blocks_json jsonb, p_theme_json jsonb DEFAULT NULL::jsonb, p_seo_json jsonb DEFAULT NULL::jsonb, p_id uuid DEFAULT NULL::uuid, p_form_schema_json jsonb DEFAULT NULL::jsonb)
 RETURNS growth_pages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _slug   text := NULLIF(btrim(p_slug), '');
  _row    public.growth_pages;
  _schema jsonb;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  IF _slug IS NULL THEN RAISE EXCEPTION 'GROWTH_INVALID_SLUG: a non-empty slug is required' USING ERRCODE = '22023'; END IF;

  PERFORM public.growth_validate_blocks(p_blocks_json);
  IF p_form_schema_json IS NOT NULL THEN
    PERFORM public.growth_validate_form_schema(p_form_schema_json);
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.growth_pages SET
      slug = _slug, title = COALESCE(NULLIF(btrim(p_title), ''), title),
      draft_blocks_json = p_blocks_json,
      draft_theme_json  = COALESCE(p_theme_json, draft_theme_json),
      draft_seo_json    = COALESCE(p_seo_json, draft_seo_json)
    WHERE id = p_id AND tenant_id = _tenant RETURNING * INTO _row;
    IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  ELSE
    INSERT INTO public.growth_pages (tenant_id, slug, title, status, created_by, draft_blocks_json, draft_theme_json, draft_seo_json)
    VALUES (_tenant, _slug, COALESCE(NULLIF(btrim(p_title), ''), 'Untitled'), 'draft', _caller, p_blocks_json, p_theme_json, p_seo_json)
    ON CONFLICT (tenant_id, slug) DO UPDATE SET
      title = COALESCE(NULLIF(btrim(EXCLUDED.title), ''), public.growth_pages.title),
      draft_blocks_json = EXCLUDED.draft_blocks_json,
      draft_theme_json  = COALESCE(EXCLUDED.draft_theme_json, public.growth_pages.draft_theme_json),
      draft_seo_json    = COALESCE(EXCLUDED.draft_seo_json, public.growth_pages.draft_seo_json)
    RETURNING * INTO _row;
  END IF;

  -- Author a backing form for every embedded_form block with no form yet. It starts unpublished
  -- and goes live when the page is published. ON CONFLICT DO NOTHING never overwrites an edit.
  _schema := COALESCE(p_form_schema_json, jsonb_build_object(
    'submit_label', 'Count me in',
    'sections', jsonb_build_array(jsonb_build_object(
      'title', '',
      'fields', jsonb_build_array(
        jsonb_build_object('key', 'full_name', 'label', 'Your name', 'type', 'text', 'required', true),
        jsonb_build_object('key', 'email', 'label', 'Email', 'type', 'email', 'required', true, 'maps_to', 'clients.email'),
        jsonb_build_object('key', 'goal', 'label', 'What are you hoping to get out of this?', 'type', 'textarea', 'required', false)
      )
    ))
  ));
  INSERT INTO public.growth_forms (tenant_id, slug, name, status, schema_json, success_action_json,
                                   draft_schema_json, draft_success_action_json, auto_create_contact, created_by)
  SELECT _tenant, fs.form_slug,
         left(COALESCE(NULLIF(btrim(p_title), ''), 'Signup'), 80) || ' — signup',
         'draft', _schema,
         '{"type":"thank_you","message":"Thanks — we''ll be in touch."}'::jsonb,
         _schema,
         '{"type":"thank_you","message":"Thanks — we''ll be in touch."}'::jsonb,
         true, _caller
  FROM (
    SELECT DISTINCT btrim(b->>'form_slug') AS form_slug
    FROM jsonb_array_elements(p_blocks_json) b
    WHERE b->>'type' = 'embedded_form'
      AND NULLIF(btrim(COALESCE(b->>'form_slug', '')), '') IS NOT NULL
  ) fs
  ON CONFLICT (tenant_id, slug) DO NOTHING;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'growth_pages', 'growth_page_upsert', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug, 'blocks', jsonb_array_length(p_blocks_json)));
  RETURN _row;
END; $function$;

CREATE OR REPLACE FUNCTION public.growth_page_edit_blocks(p_tenant_id uuid, p_id uuid, p_ops jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _row    public.growth_pages;
  _arr    jsonb[];
  _op     jsonb;
  _kind   text;
  _idx    int;
  _from   int;
  _to     int;
  _n      int;
  _elem   jsonb;
  _new    jsonb;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RAISE EXCEPTION 'GROWTH_INVALID_OPS: p_ops must be a JSON array of edit operations' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _row FROM public.growth_pages WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002'; END IF;

  _new := COALESCE(
    CASE WHEN jsonb_typeof(_row.draft_blocks_json) = 'array' THEN _row.draft_blocks_json END,
    CASE WHEN jsonb_typeof(_row.blocks_json)       = 'array' THEN _row.blocks_json       END,
    '[]'::jsonb);
  SELECT array_agg(value ORDER BY ord) INTO _arr
    FROM jsonb_array_elements(_new) WITH ORDINALITY AS t(value, ord);
  IF _arr IS NULL THEN _arr := ARRAY[]::jsonb[]; END IF;

  FOR _op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    IF jsonb_typeof(_op) <> 'object' THEN
      RAISE EXCEPTION 'GROWTH_INVALID_OPS: each op must be an object' USING ERRCODE = '22023';
    END IF;
    _kind := _op->>'op';
    _n := COALESCE(array_length(_arr, 1), 0);

    IF _kind IN ('set', 'replace_all') THEN
      IF jsonb_typeof(_op->'blocks') <> 'array' THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: set requires a blocks array' USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(value ORDER BY ord) INTO _arr
        FROM jsonb_array_elements(_op->'blocks') WITH ORDINALITY AS t(value, ord);
      IF _arr IS NULL THEN _arr := ARRAY[]::jsonb[]; END IF;
    ELSIF _kind = 'append' THEN
      IF jsonb_typeof(_op->'block') <> 'object' THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: append requires a block object' USING ERRCODE = '22023';
      END IF;
      _arr := array_append(_arr, _op->'block');
    ELSIF _kind = 'insert' THEN
      IF jsonb_typeof(_op->'block') <> 'object' THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: insert requires a block object' USING ERRCODE = '22023';
      END IF;
      _idx := COALESCE(NULLIF(_op->>'index', '')::int, _n);
      IF _idx < 0 OR _idx > _n THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: insert index out of range' USING ERRCODE = '22023';
      END IF;
      _arr := _arr[1:_idx] || ARRAY[_op->'block'] || _arr[_idx+1:_n];
    ELSIF _kind = 'update' THEN
      IF jsonb_typeof(_op->'block') <> 'object' THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: update requires a block object' USING ERRCODE = '22023';
      END IF;
      _idx := NULLIF(_op->>'index', '')::int;
      IF _idx IS NULL OR _idx < 0 OR _idx >= _n THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: update index out of range' USING ERRCODE = '22023';
      END IF;
      _arr[_idx+1] := _op->'block';
    ELSIF _kind = 'remove' THEN
      _idx := NULLIF(_op->>'index', '')::int;
      IF _idx IS NULL OR _idx < 0 OR _idx >= _n THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: remove index out of range' USING ERRCODE = '22023';
      END IF;
      _arr := _arr[1:_idx] || _arr[_idx+2:_n];
    ELSIF _kind = 'move' THEN
      _from := NULLIF(_op->>'from', '')::int;
      _to   := NULLIF(_op->>'to', '')::int;
      IF _from IS NULL OR _to IS NULL OR _from < 0 OR _from >= _n OR _to < 0 OR _to >= _n THEN
        RAISE EXCEPTION 'GROWTH_INVALID_OPS: move index out of range' USING ERRCODE = '22023';
      END IF;
      _elem := _arr[_from+1];
      _arr  := _arr[1:_from] || _arr[_from+2:_n];
      _arr  := _arr[1:_to] || ARRAY[_elem] || _arr[_to+1:COALESCE(array_length(_arr, 1), 0)];
    ELSE
      RAISE EXCEPTION 'GROWTH_INVALID_OPS: unknown op %', COALESCE(_kind, '(null)') USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO _new
    FROM unnest(_arr) WITH ORDINALITY AS u(e, ord);

  PERFORM public.growth_validate_blocks(_new);

  UPDATE public.growth_pages SET draft_blocks_json = _new
  WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'growth_pages', 'growth_page_edit_blocks', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug,
                             'ops', jsonb_array_length(p_ops), 'blocks', jsonb_array_length(_new)));

  RETURN _new;
END; $function$;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Funnels
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.growth_funnel_upsert(p_tenant_id uuid, p_slug text, p_name text, p_goal text DEFAULT NULL::text, p_steps jsonb DEFAULT NULL::jsonb, p_entry_page_id uuid DEFAULT NULL::uuid, p_success_page_id uuid DEFAULT NULL::uuid, p_id uuid DEFAULT NULL::uuid)
 RETURNS growth_funnels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _slug   text := NULLIF(btrim(p_slug), '');
  _row    public.growth_funnels;
  _existing_id uuid;
  _existing_status text;
  _resolved_steps jsonb := '[]'::jsonb;
  _current_steps jsonb;
  _step   jsonb;
  _stype  text;
  _oidx   int;
  _pid    uuid;
  _fid    uuid;
  _i      int := 0;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  IF _slug IS NULL THEN RAISE EXCEPTION 'GROWTH_INVALID_SLUG: a non-empty slug is required' USING ERRCODE = '22023'; END IF;

  IF p_entry_page_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.growth_pages WHERE id = p_entry_page_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'GROWTH_ENTRY_PAGE_NOT_FOUND: entry page is not in this tenant' USING ERRCODE = '22023';
  END IF;
  IF p_success_page_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.growth_pages WHERE id = p_success_page_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'GROWTH_SUCCESS_PAGE_NOT_FOUND: success page is not in this tenant' USING ERRCODE = '22023';
  END IF;

  IF p_steps IS NOT NULL THEN
    IF jsonb_typeof(p_steps) <> 'array' THEN
      RAISE EXCEPTION 'GROWTH_INVALID_STEPS: p_steps must be a JSON array' USING ERRCODE = '22023';
    END IF;
    FOR _step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
      IF jsonb_typeof(_step) <> 'object' THEN
        RAISE EXCEPTION 'GROWTH_INVALID_STEPS: each step must be an object' USING ERRCODE = '22023';
      END IF;
      _stype := _step->>'step_type';
      IF _stype IS NULL OR _stype NOT IN ('page','form','payment','booking','thankyou') THEN
        RAISE EXCEPTION 'GROWTH_INVALID_STEPS: unknown step_type %', COALESCE(_stype, '(null)') USING ERRCODE = '22023';
      END IF;
      _oidx := COALESCE(NULLIF(_step->>'order_index', '')::int, _i);
      _pid := NULL;
      _fid := NULL;

      IF NULLIF(btrim(COALESCE(_step->>'page_id', '')), '') IS NOT NULL THEN
        _pid := (_step->>'page_id')::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.growth_pages WHERE id = _pid AND tenant_id = _tenant) THEN
          RAISE EXCEPTION 'GROWTH_STEP_PAGE_NOT_FOUND: a step page is not in this tenant' USING ERRCODE = '22023';
        END IF;
      ELSIF NULLIF(btrim(COALESCE(_step->>'page_slug', '')), '') IS NOT NULL THEN
        SELECT id INTO _pid FROM public.growth_pages WHERE tenant_id = _tenant AND slug = btrim(_step->>'page_slug');
        IF _pid IS NULL THEN
          RAISE EXCEPTION 'GROWTH_STEP_PAGE_NOT_FOUND: no page with slug % in this tenant', _step->>'page_slug' USING ERRCODE = '22023';
        END IF;
      END IF;

      IF NULLIF(btrim(COALESCE(_step->>'form_id', '')), '') IS NOT NULL THEN
        _fid := (_step->>'form_id')::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.growth_forms WHERE id = _fid AND tenant_id = _tenant) THEN
          RAISE EXCEPTION 'GROWTH_STEP_FORM_NOT_FOUND: a step form is not in this tenant' USING ERRCODE = '22023';
        END IF;
      ELSIF NULLIF(btrim(COALESCE(_step->>'form_slug', '')), '') IS NOT NULL THEN
        SELECT id INTO _fid FROM public.growth_forms WHERE tenant_id = _tenant AND slug = btrim(_step->>'form_slug');
        IF _fid IS NULL THEN
          RAISE EXCEPTION 'GROWTH_STEP_FORM_NOT_FOUND: no form with slug % in this tenant', _step->>'form_slug' USING ERRCODE = '22023';
        END IF;
      END IF;

      _resolved_steps := _resolved_steps || jsonb_build_object(
        'order_index', _oidx,
        'step_type', _stype,
        'page_id', _pid,
        'form_id', _fid,
        'config_json', COALESCE(_step->'config_json', '{}'::jsonb));
      _i := _i + 1;
    END LOOP;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT id, status INTO _existing_id, _existing_status FROM public.growth_funnels WHERE id = p_id AND tenant_id = _tenant;
    IF _existing_id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel not found in this tenant' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT id, status INTO _existing_id, _existing_status FROM public.growth_funnels WHERE tenant_id = _tenant AND slug = _slug;
  END IF;

  -- A live funnel's step list is what visitors walk through; changing it takes the funnel down
  -- first. Re-sending the same steps (a content-only rebuild) is fine.
  IF _existing_id IS NOT NULL AND _existing_status = 'active' AND p_steps IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('order_index', s.order_index, 'step_type', s.step_type,
             'page_id', s.page_id, 'form_id', s.form_id, 'config_json', s.config_json)
             ORDER BY s.order_index, s.step_type, COALESCE(s.page_id::text, ''), COALESCE(s.form_id::text, '')), '[]'::jsonb)
      INTO _current_steps FROM public.growth_funnel_steps s WHERE s.funnel_id = _existing_id;
    IF _current_steps IS DISTINCT FROM (
         SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'order_index')::int, x->>'step_type',
                  COALESCE(x->>'page_id', ''), COALESCE(x->>'form_id', '')), '[]'::jsonb)
           FROM jsonb_array_elements(_resolved_steps) x) THEN
      RAISE EXCEPTION 'GROWTH_FUNNEL_LIVE_STRUCTURE: this funnel is live — unpublish it to add, remove or reorder steps' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _existing_id IS NOT NULL AND _existing_status = 'active' AND (
       (p_entry_page_id IS NOT NULL AND p_entry_page_id IS DISTINCT FROM (SELECT entry_page_id FROM public.growth_funnels WHERE id = _existing_id))
    OR (p_success_page_id IS NOT NULL AND p_success_page_id IS DISTINCT FROM (SELECT success_page_id FROM public.growth_funnels WHERE id = _existing_id))
    OR _slug IS DISTINCT FROM (SELECT slug FROM public.growth_funnels WHERE id = _existing_id)) THEN
    RAISE EXCEPTION 'GROWTH_FUNNEL_LIVE_STRUCTURE: this funnel is live — unpublish it to change its pages or address' USING ERRCODE = '22023';
  END IF;

  IF _existing_id IS NOT NULL THEN
    UPDATE public.growth_funnels SET
      slug = _slug,
      name = COALESCE(NULLIF(btrim(p_name), ''), name),
      goal = COALESCE(p_goal, goal),
      entry_page_id = COALESCE(p_entry_page_id, entry_page_id),
      success_page_id = COALESCE(p_success_page_id, success_page_id),
      updated_at = now()
    WHERE id = _existing_id AND tenant_id = _tenant RETURNING * INTO _row;
  ELSE
    INSERT INTO public.growth_funnels (tenant_id, slug, name, goal, status, entry_page_id, success_page_id, created_by)
    VALUES (_tenant, _slug, COALESCE(NULLIF(btrim(p_name), ''), 'Untitled funnel'), p_goal, 'draft', p_entry_page_id, p_success_page_id, _caller)
    RETURNING * INTO _row;
  END IF;

  IF p_steps IS NOT NULL AND _row.status <> 'active' THEN
    DELETE FROM public.growth_funnel_steps WHERE funnel_id = _row.id;
    INSERT INTO public.growth_funnel_steps (funnel_id, tenant_id, order_index, step_type, page_id, form_id, config_json)
    SELECT _row.id, _tenant,
           (s->>'order_index')::int,
           s->>'step_type',
           NULLIF(s->>'page_id', '')::uuid,
           NULLIF(s->>'form_id', '')::uuid,
           COALESCE(s->'config_json', '{}'::jsonb)
    FROM jsonb_array_elements(_resolved_steps) s;
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'growth_funnels', 'growth_funnel_upsert', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug, 'steps', jsonb_array_length(_resolved_steps)));
  RETURN _row;
END; $function$;

-- Publishing a funnel publishes every page and form it uses, then the funnel (all go live together).
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Images
-- ─────────────────────────────────────────────────────────────────────────────
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
  UPDATE public.marketing_content SET status = 'published', published_at = now()
   WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
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
  UPDATE public.marketing_content SET status = 'draft' WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'marketing_content', 'studio_image_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. The timeline: snapshots and going back
-- ─────────────────────────────────────────────────────────────────────────────
-- Funnel snapshots now carry their steps, so a funnel can be restored.
CREATE OR REPLACE FUNCTION public.save_artifact_version(p_session_id uuid, p_kind text, p_artifact_id uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS studio_artifact_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _kind text := lower(btrim(p_kind));
  _snap jsonb; _title text; _thumb text; _next int; _row public.studio_artifact_versions;
BEGIN
  IF _caller IS NOT NULL THEN
    IF NOT public.studio_role_ok(_caller) THEN
      RAISE EXCEPTION 'STUDIO_FORBIDDEN: the workspace owner or an admin is required' USING ERRCODE = '42501'; END IF;
    _tenant := public.current_user_tenant_id();
  ELSE _tenant := p_tenant_id; END IF;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'STUDIO_NO_TENANT: a tenant context is required' USING ERRCODE = '22023'; END IF;
  IF _kind NOT IN ('page','form','funnel','content') THEN
    RAISE EXCEPTION 'STUDIO_INVALID_KIND' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.studio_sessions s WHERE s.id = p_session_id AND s.tenant_id = _tenant
      AND (auth.uid() IS NULL OR s.owner_user_id = auth.uid() OR public.is_tenant_admin(_tenant))) THEN
    RAISE EXCEPTION 'STUDIO_NOT_FOUND: session not found in this tenant' USING ERRCODE = 'P0002'; END IF;

  IF _kind = 'page' THEN
    SELECT to_jsonb(t.*), t.title, NULL FROM public.growth_pages t
      WHERE t.id = p_artifact_id AND t.tenant_id = _tenant INTO _snap, _title, _thumb;
  ELSIF _kind = 'content' THEN
    SELECT to_jsonb(t.*), t.title, t.image_url FROM public.marketing_content t
      WHERE t.id = p_artifact_id AND t.tenant_id = _tenant INTO _snap, _title, _thumb;
  ELSIF _kind = 'funnel' THEN
    SELECT to_jsonb(t.*) || jsonb_build_object('steps', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('order_index', s.order_index, 'step_type', s.step_type,
                      'page_id', s.page_id, 'form_id', s.form_id, 'config_json', s.config_json) ORDER BY s.order_index, s.id)
             FROM public.growth_funnel_steps s WHERE s.funnel_id = t.id), '[]'::jsonb)),
           t.name, NULL FROM public.growth_funnels t
      WHERE t.id = p_artifact_id AND t.tenant_id = _tenant INTO _snap, _title, _thumb;
  ELSE
    SELECT to_jsonb(t.*), t.name, NULL FROM public.growth_forms t
      WHERE t.id = p_artifact_id AND t.tenant_id = _tenant INTO _snap, _title, _thumb;
  END IF;
  IF _snap IS NULL THEN RAISE EXCEPTION 'STUDIO_ARTIFACT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO _row FROM public.studio_artifact_versions
    WHERE session_id = p_session_id AND kind = _kind AND lineage_id = p_artifact_id AND is_current
      AND snapshot = _snap;
  IF _row.id IS NOT NULL THEN RETURN _row; END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO _next
    FROM public.studio_artifact_versions
    WHERE session_id = p_session_id AND kind = _kind AND lineage_id = p_artifact_id;

  UPDATE public.studio_artifact_versions SET is_current = false
    WHERE session_id = p_session_id AND kind = _kind AND lineage_id = p_artifact_id AND is_current;

  INSERT INTO public.studio_artifact_versions
    (tenant_id, session_id, kind, lineage_id, version_no, is_current, snapshot, title, thumbnail_url, created_by)
  VALUES (_tenant, p_session_id, _kind, p_artifact_id, _next, true, _snap, _title, _thumb, _caller)
  RETURNING * INTO _row;
  RETURN _row;
END; $function$;

-- Going back restores the working copy (never what visitors see): a page's draft, a form's
-- questions and thank-you, a funnel's name, goal and — while it is not live — its steps.
-- Where requests go (pipeline, stage, alert) is live routing and stays as it is now.
CREATE OR REPLACE FUNCTION public.restore_artifact_version(p_version_id uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS studio_artifact_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid(); _tenant uuid; _v public.studio_artifact_versions;
  _schema jsonb; _success jsonb; _status text;
BEGIN
  IF _caller IS NOT NULL THEN
    IF NOT public.studio_role_ok(_caller) THEN
      RAISE EXCEPTION 'STUDIO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
    _tenant := public.current_user_tenant_id();
  ELSE _tenant := p_tenant_id; END IF;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'STUDIO_NO_TENANT' USING ERRCODE = '22023'; END IF;

  SELECT * INTO _v FROM public.studio_artifact_versions
    WHERE id = p_version_id AND tenant_id = _tenant;
  IF _v.id IS NULL THEN RAISE EXCEPTION 'STUDIO_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.studio_sessions s WHERE s.id = _v.session_id AND s.tenant_id = _tenant
      AND (auth.uid() IS NULL OR s.owner_user_id = auth.uid() OR public.is_tenant_admin(_tenant))) THEN
    RAISE EXCEPTION 'STUDIO_FORBIDDEN' USING ERRCODE = '42501'; END IF;

  IF _v.kind = 'page' THEN
    UPDATE public.growth_pages SET
      draft_blocks_json = _v.snapshot->'draft_blocks_json',
      draft_theme_json  = _v.snapshot->'draft_theme_json',
      draft_seo_json    = _v.snapshot->'draft_seo_json',
      title             = COALESCE(_v.snapshot->>'title', title)
    WHERE id = _v.lineage_id AND tenant_id = _tenant;
  ELSIF _v.kind = 'content' THEN
    IF EXISTS (SELECT 1 FROM public.marketing_content WHERE id = _v.lineage_id AND tenant_id = _tenant AND status = 'published') THEN
      RAISE EXCEPTION 'GROWTH_PUBLISHED: this image is in your Catalog — unpublish it to go back to an earlier version' USING ERRCODE = '22023';
    END IF;
    UPDATE public.marketing_content SET
      body      = _v.snapshot->>'body',
      image_url = _v.snapshot->>'image_url',
      title     = COALESCE(_v.snapshot->>'title', title)
    WHERE id = _v.lineage_id AND tenant_id = _tenant;
  ELSIF _v.kind = 'form' THEN
    _schema  := COALESCE(_v.snapshot->'draft_schema_json', _v.snapshot->'schema_json');
    _success := COALESCE(_v.snapshot->'draft_success_action_json', _v.snapshot->'success_action_json');
    IF _schema IS NULL OR jsonb_typeof(_schema) NOT IN ('object','array') THEN
      RAISE EXCEPTION 'STUDIO_RESTORE_UNSUPPORTED: this version has no questions to restore' USING ERRCODE = '22023';
    END IF;
    PERFORM public.growth_validate_form_schema(_schema);
    UPDATE public.growth_forms SET
      name                      = COALESCE(_v.snapshot->>'name', name),
      draft_schema_json         = _schema,
      draft_success_action_json = COALESCE(_success, draft_success_action_json),
      schema_json               = CASE WHEN status = 'active' THEN schema_json ELSE _schema END,
      success_action_json       = CASE WHEN status = 'active' THEN success_action_json ELSE COALESCE(_success, success_action_json) END
    WHERE id = _v.lineage_id AND tenant_id = _tenant;
  ELSIF _v.kind = 'funnel' THEN
    SELECT status INTO _status FROM public.growth_funnels WHERE id = _v.lineage_id AND tenant_id = _tenant;
    IF _status IS NULL THEN RAISE EXCEPTION 'STUDIO_ARTIFACT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    UPDATE public.growth_funnels SET
      name = COALESCE(_v.snapshot->>'name', name),
      goal = COALESCE(_v.snapshot->>'goal', goal),
      updated_at = now()
    WHERE id = _v.lineage_id AND tenant_id = _tenant;
    IF jsonb_typeof(_v.snapshot->'steps') = 'array' THEN
      IF _status = 'active' THEN
        RAISE EXCEPTION 'GROWTH_FUNNEL_LIVE_STRUCTURE: this funnel is live — unpublish it to go back to an earlier set of steps' USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.growth_funnel_steps WHERE funnel_id = _v.lineage_id;
      INSERT INTO public.growth_funnel_steps (funnel_id, tenant_id, order_index, step_type, page_id, form_id, config_json)
      SELECT _v.lineage_id, _tenant, (s->>'order_index')::int, s->>'step_type',
             (SELECT p.id FROM public.growth_pages p WHERE p.id = NULLIF(s->>'page_id', '')::uuid AND p.tenant_id = _tenant),
             (SELECT f.id FROM public.growth_forms f WHERE f.id = NULLIF(s->>'form_id', '')::uuid AND f.tenant_id = _tenant),
             COALESCE(s->'config_json', '{}'::jsonb)
      FROM jsonb_array_elements(_v.snapshot->'steps') s;
    END IF;
  ELSE
    RAISE EXCEPTION 'STUDIO_RESTORE_UNSUPPORTED: % cannot be restored', _v.kind USING ERRCODE = '0A000';
  END IF;

  UPDATE public.studio_artifact_versions SET is_current = false
    WHERE session_id = _v.session_id AND kind = _v.kind AND lineage_id = _v.lineage_id AND is_current;
  UPDATE public.studio_artifact_versions SET is_current = true WHERE id = _v.id RETURNING * INTO _v;
  RETURN _v;
END; $function$;

-- Anon may not read version history, and a missing user is trusted only from a server context.
CREATE OR REPLACE FUNCTION public.list_artifact_versions(p_session_id uuid, p_kind text, p_artifact_id uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF studio_artifact_versions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT v.* FROM public.studio_artifact_versions v
  WHERE v.session_id = p_session_id AND v.kind = lower(btrim(p_kind)) AND v.lineage_id = p_artifact_id
    AND v.tenant_id = (CASE
          WHEN auth.uid() IS NOT NULL THEN public.current_user_tenant_id()
          WHEN COALESCE(auth.role(), '') = 'service_role' OR public.is_direct_server_context() THEN p_tenant_id
        END)
    AND EXISTS (SELECT 1 FROM public.studio_sessions s
      WHERE s.id = v.session_id AND s.tenant_id = v.tenant_id
        AND (auth.uid() IS NULL OR s.owner_user_id = auth.uid() OR public.is_tenant_admin(v.tenant_id)))
  ORDER BY v.version_no DESC;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Grants
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.list_artifact_versions(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_artifact_versions(uuid, text, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.growth_form_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_form_unpublish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_page_unpublish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_funnel_unpublish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.studio_image_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.studio_image_unpublish(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.growth_form_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_unpublish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_page_unpublish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_unpublish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_image_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_image_unpublish(uuid, uuid) TO authenticated, service_role;

-- Replaced bodies keep their existing grants (CREATE OR REPLACE preserves them); restate the
-- ones the Studio depends on so a fresh database matches production.
REVOKE ALL ON FUNCTION public.growth_form_upsert(uuid, text, text, jsonb, jsonb, boolean, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_page_upsert(uuid, text, text, jsonb, jsonb, jsonb, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_page_edit_blocks(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_page_publish(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_funnel_upsert(uuid, text, text, text, jsonb, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.growth_funnel_publish(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.growth_form_upsert(uuid, text, text, jsonb, jsonb, boolean, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_page_upsert(uuid, text, text, jsonb, jsonb, jsonb, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_page_edit_blocks(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_page_publish(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_upsert(uuid, text, text, text, jsonb, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_publish(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. The autonomy catalogue carries the Studio's two form tools
-- ─────────────────────────────────────────────────────────────────────────────
-- Paige can now draft and publish a standalone form from the Studio chat (growth_form_save,
-- growth_form_publish), so the operator's catalogue lists their toggles. This body is
-- 20270532120000's, unchanged except for those two rows; no autonomy is granted and no row moves.
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  tool_key    text,
  label       text,
  category    text,
  mode        text,
  is_default  boolean,
  updated_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant_id IS NOT NULL AND _tenant_id <> _tenant AND NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'AUTONOMY_FORBIDDEN: tenant mismatch' USING ERRCODE = '42501';
    END IF;
    IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant := _tenant_id; END IF;
  ELSE
    _tenant := _tenant_id;
  END IF;

  RETURN QUERY
  WITH catalog(tool_key, label, category) AS (
    VALUES
      ('agreement_draft',                    'Draft an agreement', 'Approvals'),
      ('agreement_send',                     'Send an agreement for signature', 'Approvals'),
      -- ── previously listed (23) ──
      ('crm_update_contact',            'Update a contact', 'CRM'),
      ('crm_create_contact',            'Add a contact', 'CRM'),
      ('crm_delete_contact',            'Delete a contact', 'CRM'),
      ('crm_update_pipeline_stage',     'Move a client''s stage', 'Pipeline'),
      ('crm_assign_coach',              'Assign a coach', 'CRM'),
      ('crm_assign_contact',            'Assign a contact', 'CRM'),
      ('crm_create_task',               'Create a task', 'Tasks'),
      ('crm_log_activity',              'Log an activity', 'CRM'),
      ('crm_add_note',                  'Add a note to a client', 'CRM'),
      ('crm_file_document',             'File a document on a client', 'CRM'),
      ('member_grant_role',             'Grant a staff role', 'Team'),
      ('member_revoke_role',            'Revoke a staff role', 'Team'),
      ('calendar_book_meeting',         'Book a meeting', 'Calendar'),
      -- ── added 2026-09-13 (E5): the governed booking-preset lifecycle. These edit a bookable
      -- /book PAGE, not a booked meeting. publish/revise/archive are HIGH in action-risk.ts, so
      -- no stored mode can bypass explicit confirmation; create/pause/duplicate/restore are ordinary.
      ('booking_preset_create',         'Create a booking calendar', 'Calendar'),
      ('booking_preset_revise',         'Change a booking calendar', 'Calendar'),
      ('booking_preset_publish',        'Publish a booking calendar''s public page', 'Calendar'),
      ('booking_preset_pause',          'Pause a booking calendar', 'Calendar'),
      ('booking_preset_duplicate',      'Duplicate a booking calendar', 'Calendar'),
      ('booking_preset_archive',        'Archive a booking calendar', 'Calendar'),
      ('booking_preset_restore',        'Restore a booking calendar', 'Calendar'),
      -- ── added 2026-09-13 (E7): the governed calendar-link SHARE. Sends a published calendar's
      -- public /book link to a contact by email/SMS; HIGH in action-risk.ts (never bypassable by a
      -- stored mode). The prepare/social-copy reads are not catalogued.
      ('calendar_link_send',            'Send a booking link to a contact', 'Calendar'),
      ('draft_marketing_content',       'Draft marketing content', 'Content'),
      ('generate_image',                'Generate an image', 'Content'),
      ('content_save',                  'Save marketing content', 'Content'),
      ('growth_page_save',              'Save a landing page draft', 'Studio'),
      ('growth_page_publish',           'Publish a landing page', 'Studio'),
      ('growth_funnel_build',           'Build a funnel', 'Studio'),
      ('growth_funnel_publish',         'Publish a funnel', 'Studio'),
      ('growth_form_save',              'Save a form draft', 'Studio'),
      ('growth_form_publish',           'Publish a form', 'Studio'),
      ('action_file',                   'File an action', 'Action bus'),
      ('action_advance',                'Advance an action', 'Action bus'),
      ('update_client_data',            'Save details to a client''s file', 'Client file'),
      ('delegate_to_subagent',          'Hand work to a specialist', 'Paige''s team'),
      ('forge_subagent',                'Create a new specialist', 'Paige''s team'),
      ('save_to_knowledge_base',        'Save something to your knowledge base', 'Knowledge'),
      ('update_business_profile',       'Update your business profile', 'Business'),
      ('deal_create',                   'Add a deal', 'Pipeline'),
      ('deal_move_stage',               'Move a deal''s stage', 'Pipeline'),
      ('document_generate',             'Generate a document', 'Content'),
      ('author_event_kind',             'Add an activity kind', 'Action bus'),
      ('n8n_run_workflow',              'Run an automation', 'Automations'),
      ('n8n_activate_workflow',         'Turn an automation on', 'Automations'),
      ('n8n_deactivate_workflow',       'Turn an automation off', 'Automations'),
      ('n8n_create_workflow',           'Create an automation', 'Automations'),
      ('n8n_update_workflow',           'Change an automation', 'Automations'),
      ('n8n_archive_workflow',          'Archive an automation', 'Automations'),
      ('n8n_delete_workflow',           'Delete an automation permanently', 'Automations'),
      ('zapier_run_action',             'Run a connected app action', 'Automations'),
      ('plan_set_reminder',             'Set a reminder', 'Planning'),
      ('plan_create',                   'Create a plan', 'Planning'),
      ('plan_add_milestone',            'Add a milestone', 'Planning'),
      ('plan_assign_task',              'Assign a task from a plan', 'Planning'),
      ('plan_update_item',              'Change a plan item', 'Planning'),
      ('plan_remove_item',              'Remove a plan item', 'Planning'),
      -- added by Phase 2: visible controls for governed Business Mission record changes
      ('mission_create',                 'Create a Business Mission', 'Planning'),
      ('mission_revise',                 'Revise a Business Mission brief', 'Planning'),
      ('mission_transition',             'Change a Business Mission state', 'Planning'),
      ('automation_draft',              'Set up a repeatable process', 'Automations'),
      ('automation_set_grant',          'Change how much Paige runs alone', 'Automations'),
      ('automation_set_state',          'Turn a process on or off', 'Automations'),
      ('marketplace_install',           'Install from the marketplace', 'Marketplace'),
      ('marketplace_uninstall',         'Remove a marketplace install', 'Marketplace'),
      ('propose_business_brief_update', 'Propose a business brief update', 'CRM'),
      ('pipeline_configure',            'Configure pipelines and stages', 'Pipeline'),
      -- added 2026-09-06: the two governed campaign-brief PLANNING writes (Slice 2)
      ('campaign_brief_create',         'Save a campaign brief', 'Campaigns'),
      ('campaign_brief_revise',         'Revise a campaign brief', 'Campaigns'),
      ('comms_buy_number',              'Buy a phone number (monthly charge)', 'Comms'),
      ('comms_set_primary_number',      'Change which number you send from', 'Comms'),
      ('comms_name_number',             'Rename a phone number', 'Comms'),
      ('comms_draft_registration',      'Draft your carrier registration', 'Comms'),
      -- ── added 2026-09-02: the Solo Team seam ──
      ('team_set_work_profile',         'Update a teammate''s work details', 'Team'),
      ('team_set_permission',           'Change what a teammate can access', 'Team'),
      ('team_invite_member',            'Invite someone to the team', 'Team'),
      ('team_invite_resend',            'Send a team invitation again', 'Team'),
      ('team_invite_revoke',            'Withdraw a team invitation', 'Team'),
      -- ── added 2026-09-05: the acts the inbound MCP door names (task #45) ──
      ('tenant_create',                     'Create a new workspace', 'Platform'),
      ('crm_append_contact_notes',          'Add notes to a client''s record', 'CRM'),
      ('crm_delete_task',                   'Delete a task', 'Tasks'),
      ('workflow_run',                      'Run a registered automation', 'Automations'),
      ('workflow_cancel_run',               'Stop an automation that is running', 'Automations'),
      ('workflow_register',                 'Register a new automation', 'Automations'),
      ('automation_rule_create',            'Create a stage automation rule', 'Automations'),
      ('automation_rule_update',            'Change a stage automation rule', 'Automations'),
      ('automation_rule_delete',            'Delete a stage automation rule permanently', 'Automations'),
      ('approval_decide',                   'Approve or reject something waiting for review', 'Approvals'),
      ('approval_create',                   'File something for review', 'Approvals'),
      ('readiness_approve_proposal',        'Approve a readiness item for a client', 'Approvals'),
      ('coach_update_profile',              'Change a coach''s details and availability', 'Team'),
      ('team_invite_mint',                  'Create a workspace invitation link', 'Team'),
      ('comms_upsert_email_template',       'Save a shared email template', 'Comms'),
      ('comms_send_email',                  'Send an email to a real person', 'Comms'),
      ('comms_send_bulk_email',             'Send an email to many people at once', 'Comms'),
      ('comms_add_email_domain',            'Add a sending domain', 'Comms'),
      ('comms_set_primary_email_domain',    'Change which domain you send email from', 'Comms'),
      ('billing_send_invoice',              'Send an invoice to a client', 'Billing'),
      ('skill_run',                         'Run a skill', 'Paige''s team'),
      ('subagent_create',                   'Propose a new specialist', 'Paige''s team'),
      ('subagent_approve_proposal',         'Put a proposed specialist live', 'Paige''s team'),
      ('business_verify',                   'Check a company against outside registries', 'Business'),
      ('agency_create_subaccount',          'Create a sub-account', 'Agency'),
      ('agency_enter_subaccount',           'Work inside a sub-account', 'Agency'),
      ('privacy_handle_request',            'Act on a data request from a person', 'Privacy'),
      ('tenant_set_status',                 'Suspend or restore a workspace', 'Platform'),
      ('tenant_set_features',               'Turn capabilities on or off for a workspace', 'Platform'),
      ('crm_update_lifecycle_stage',        'Move a client to another lifecycle stage', 'CRM'),
      ('crm_advance_journey_stage',         'Move a client along their journey', 'CRM'),
      ('crm_propose_contact_update',        'Propose a change to a client''s record', 'CRM'),
      ('crm_update_task',                   'Change a task', 'Tasks'),
      ('approval_claim',                    'Take ownership of something waiting for review', 'Approvals'),
      ('approval_comment',                  'Comment on something waiting for review', 'Approvals'),
      ('readiness_reject_proposal',         'Close a readiness item without approving it', 'Approvals'),
      ('billing_create_invoice',            'Draft an invoice', 'Billing'),
      ('comms_draft_email',                 'Draft an email', 'Comms'),
      ('platform_post_notification',        'Post an operator notice', 'Platform'),
      ('agency_exit_subaccount',            'Return to your own workspace', 'Agency'),
      ('business_create',                   'Add a business you own', 'Business'),
      ('business_update',                   'Update a business you own', 'Business'),
      ('update_social_accounts',            'Record the accounts you post from', 'Business'),
      ('ingest_client_memory',              'Remember something about a client', 'Client file'),
      ('ingest_credit_scores',              'Record reported score figures on a client''s file', 'Client file'),
      ('nav_pull_business_credit',          'Pull a paid NAV business credit report', 'Client file'),
      ('smartcredit_pull_snapshot',         'Pull a paid SmartCredit snapshot', 'Client file'),
      ('ingest_banking_snapshot',           'Record reported account figures on a client''s file', 'Client file'),
      ('ingest_confirm_proposal',           'Confirm a staged change to a client''s file', 'Client file'),
      ('ingest_reject_proposal',            'Discard a staged change to a client''s file', 'Client file'),
      ('client_log_progress',               'Add a progress note to your own record', 'Client file'),
      -- Added in the same branch, after the peer gate refused three reuses that merged different
      -- acts under one key: the one send tool that also chooses which address the email appears
      -- to come from.
      ('comms_send_email_choosing_the_sender', 'Send an email and choose the sending address', 'Comms'),
      -- ── added 2026-09-12: the action-risk classification repair (improvement loop + social) ──
      ('improvement_propose',               'Propose an improvement to Paige', 'Paige''s team'),
      ('improvement_decide',                'Approve or reject an improvement proposal', 'Paige''s team'),
      ('social_post',                       'Post to social media', 'Content'),
      -- Added with the tenant-owned Social connection lifecycle. These mutations remain high-risk
      -- in action-risk.ts, so no stored autonomy mode can bypass explicit confirmation.
      ('social_connection_start',           'Connect a Social identity', 'Automations'),
      ('social_account_select',             'Select a Social account', 'Automations'),
      ('social_connection_disconnect',      'Disconnect a Social identity', 'Automations'),
      -- Governed CRM/Pipeline operational surface. These are the same keys classified by
      -- action-risk.ts and emitted from the one shared CRM command catalogue.
      ('crm_archive_contact',                'Archive a contact', 'CRM'),
      ('crm_restore_contact',                'Restore a contact', 'CRM'),
      ('crm_link_contact_company',           'Link a contact to a company', 'CRM'),
      ('crm_unlink_contact_company',         'Unlink a contact from a company', 'CRM'),
      ('crm_assign_contact_owner',           'Change a contact owner', 'CRM'),
      ('crm_merge_contacts',                 'Merge contacts', 'CRM'),
      ('crm_hard_delete_contact',            'Delete a contact permanently', 'CRM'),
      ('crm_bulk_update_contacts',           'Update an exact set of contacts', 'CRM'),
      ('crm_create_company',                 'Add a company', 'CRM'),
      ('crm_update_company',                 'Update a company', 'CRM'),
      ('crm_archive_company',                'Archive a company', 'CRM'),
      ('crm_restore_company',                'Restore a company', 'CRM'),
      ('crm_update_deal',                    'Update a deal', 'Pipeline'),
      ('crm_assign_deal_owner',              'Change a deal owner', 'Pipeline'),
      ('crm_assign_deal_contact',            'Change a deal contact', 'Pipeline'),
      ('crm_close_deal',                     'Close a deal', 'Pipeline'),
      ('crm_reopen_deal',                    'Reopen a deal', 'Pipeline'),
      ('crm_delete_deal',                    'Delete a deal permanently', 'Pipeline'),
      ('crm_assign_task',                    'Assign a task', 'Tasks'),
      ('crm_reschedule_task',                'Reschedule a task', 'Tasks'),
      ('crm_complete_task',                  'Complete a task', 'Tasks'),
      ('crm_reopen_task',                    'Reopen a task', 'Tasks'),
      ('crm_cancel_task',                    'Cancel a task', 'Tasks')
  )
  SELECT
    c.tool_key,
    c.label,
    c.category,
    COALESCE(t.mode, 'confirm')       AS mode,
    (t.mode IS NULL)                  AS is_default,
    t.updated_at
  FROM catalog c
  LEFT JOIN public.tenant_tool_autonomy t
    ON t.tool_key = c.tool_key AND t.tenant_id = _tenant
  ORDER BY c.category, c.label;
END;
$$;

-- Re-asserted, as every predecessor in this chain does. `CREATE OR REPLACE` preserves an existing
-- function's ACL, so this changes nothing on a database that already ran an earlier grant.
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated, service_role;

COMMIT;
