-- Migration G (Vibe Studio V2b.1) — the publish door is the only way anything goes live or comes down.
-- Owner authorized 2026-10-04 (Antonio Cook): "Authorize G as an immediate follow-up."
--
-- GAP (found by the independent review of #1699). growth_{page,form,funnel}_{publish,unpublish} and
-- studio_image_{publish,unpublish} (20270537000000) were EXECUTE-granted to `authenticated`. A
-- workspace owner or admin could call supabase.rpc('growth_page_publish', …) from a browser console
-- and skip everything growth-publish-command does around the act: the autonomy lane (a switched-off
-- Trust Compass), the server-issued approval proposal and its single-use claim, the readback and the
-- one capability receipt. Not cross-tenant — _growth_admin_tenant still scoped the caller to their
-- own active workspace — but an ungoverned path around the one door.
--
-- CHANGE.
--   1. EXECUTE on the eight is revoked from PUBLIC, anon and authenticated; service_role keeps it.
--      The door (supabase/functions/_shared/growth-publish-command/door.ts) now runs the stored call
--      on its service-role client, after the claim, with the workspace it resolved from the caller's
--      session (resolveStudioCaller) and the caller's verified user id.
--   2. Each of the eight gains one parameter, p_actor_id uuid DEFAULT NULL, so a server call can say
--      WHO is publishing. The old (uuid, uuid) signatures are dropped (a defaulted third argument next
--      to them would make every two-argument call ambiguous).
--   3. _studio_publish_actor (new, internal, owner-only) decides that person:
--        * signed in (auth.uid() present): the signed-in person; a p_actor_id naming anyone else is
--          refused (GROWTH_FORBIDDEN, 42501) — a caller-supplied identity is never trusted on a JWT
--          path;
--        * no signed-in user: p_actor_id is required (GROWTH_NO_ACTOR, 22023) and must hold, in the
--          named workspace, exactly the authority _growth_admin_tenant demands of a signed-in caller
--          — the workspace's owner or admin (is_tenant_admin's two arms, asked of that person), or
--          the agency that manages it (agency_can_manage_child(_tenant, actor)) — else GROWTH_FORBIDDEN.
--      The tenant is still decided by _growth_admin_tenant, unchanged: signed in, the active
--      workspace; otherwise only service_role or a direct server session, and only with an explicit
--      p_tenant_id (GROWTH_NO_TENANT, 22023).
--   4. The audit row records that person (audit_logs.user_id) instead of auth.uid(), which is NULL on
--      a service-role call. It is never NULL and never the service role.
--   Everything else in the eight bodies — every guard (not found, archived, no slug, empty funnel,
--   incomplete step, form or page in use, not an image), the go-live steps and their placeholder
--   check, the image publish marker, the return contract — is byte-for-byte the live body
--   (20270537000000; prod pg_get_functiondef md5 read 2026-10-04, recorded in the proof).
--   _growth_admin_tenant and every other function are not touched.
--
-- No tier gains or loses a capability: publishing still needs the workspace's owner, an admin or
-- its managing agency. What is removed is the direct RPC path, for every tier.
--
-- Producer inventory (§37, 2026-10-04): the only caller of the eight, across frontend, sibling edge
-- functions, triggers, pg_cron/pg_net, GitHub Actions, webhooks, n8n/MCP and scripts, is
-- growth-publish-command. The chat's publish tools reach them only through that door.
--
-- Reversibility: function signatures, bodies and ACLs change; no table, column or row changes.
-- Reverting means dropping the three-argument signatures and _studio_publish_actor, then restoring
-- the two-argument bodies and grants from 20270537000000.
--
-- Proof: supabase/tests/migration_g_studio_publish_door_only.sql
--        (.github/workflows/migration-g-studio-publish-door-only.yml).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Who is publishing (internal; called only from the eight below, which run as their owner)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._studio_publish_actor(_tenant uuid, p_actor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    -- Signed in: the person is the one signed in. Naming someone else is refused, never honoured.
    IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
      RAISE EXCEPTION 'GROWTH_FORBIDDEN: a signed-in caller can only act as themselves' USING ERRCODE = '42501';
    END IF;
    RETURN auth.uid();
  END IF;
  -- A server call (the publish door) names the person it verified, and that person must hold the
  -- same authority here that _growth_admin_tenant asks of a signed-in caller: the workspace's own
  -- owner or admin (is_tenant_admin, asked of this person), or the agency that manages it.
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NO_ACTOR: the person publishing is required' USING ERRCODE = '22023';
  END IF;
  IF NOT (
       EXISTS (SELECT 1 FROM public.tenant_members
                WHERE tenant_id = _tenant AND user_id = p_actor_id
                  AND status = 'active' AND role IN ('owner','admin'))
    OR (public.is_company_workspace(_tenant) AND (public.is_super_admin(p_actor_id) OR public.is_platform_admin(p_actor_id)))
    OR public.agency_can_manage_child(_tenant, p_actor_id)) THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: the workspace owner or an admin is required' USING ERRCODE = '42501';
  END IF;
  RETURN p_actor_id;
END;
$$;
REVOKE ALL ON FUNCTION public._studio_publish_actor(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The eight, carried forward from the live bodies with the actor added
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.growth_page_publish(uuid, uuid);
DROP FUNCTION IF EXISTS public.growth_page_unpublish(uuid, uuid);
DROP FUNCTION IF EXISTS public.growth_form_publish(uuid, uuid);
DROP FUNCTION IF EXISTS public.growth_form_unpublish(uuid, uuid);
DROP FUNCTION IF EXISTS public.growth_funnel_publish(uuid, uuid);
DROP FUNCTION IF EXISTS public.growth_funnel_unpublish(uuid, uuid);
DROP FUNCTION IF EXISTS public.studio_image_publish(uuid, uuid);
DROP FUNCTION IF EXISTS public.studio_image_unpublish(uuid, uuid);

CREATE OR REPLACE FUNCTION public.growth_page_publish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid;
  _actor  uuid;
  _row    public.growth_pages;
  _tenant_slug text;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM public.growth_pages WHERE id = p_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002';
  END IF;
  _tenant_slug := public._growth_tenant_slug(_tenant);
  _row := public._growth_page_go_live(_tenant, p_id);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'growth_pages', 'growth_page_publish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', '/p/' || _tenant_slug || '/' || _row.slug);
END; $function$;

CREATE OR REPLACE FUNCTION public.growth_page_unpublish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_pages; _used_by text; _actor uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
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
  VALUES (_actor, 'growth_pages', 'growth_page_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_form_publish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_forms; _tenant_slug text; _actor uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM public.growth_forms WHERE id = p_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: form not found in this tenant' USING ERRCODE = 'P0002';
  END IF;
  _tenant_slug := public._growth_tenant_slug(_tenant);
  _row := public._growth_form_go_live(_tenant, p_id);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'growth_forms', 'growth_form_publish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', '/form/' || _row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_form_unpublish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_forms; _used_by text; _actor uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
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
  VALUES (_actor, 'growth_forms', 'growth_form_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_funnel_publish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid;
  _actor  uuid;
  _row    public.growth_funnels;
  _tenant_slug text;
  _pid uuid;
  _fid uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
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
  VALUES (_actor, 'growth_funnels', 'growth_funnel_publish', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));

  RETURN jsonb_build_object(
    'id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', '/f/' || _tenant_slug || '/' || _row.slug);
END; $function$;

CREATE OR REPLACE FUNCTION public.growth_funnel_unpublish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.growth_funnels; _actor uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
  SELECT * INTO _row FROM public.growth_funnels WHERE id = p_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status <> 'active' THEN
    RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
  END IF;
  -- Its pages and forms stay live (owner ruling 2026-09-30: unpublish separately).
  UPDATE public.growth_funnels SET status = 'draft', updated_at = now() WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'growth_funnels', 'growth_funnel_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_image_publish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.marketing_content; _actor uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
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
  VALUES (_actor, 'marketing_content', 'studio_image_publish', _row.id, jsonb_build_object('tenant_id', _tenant));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status, 'published_at', _row.published_at, 'url', _row.image_url);
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_image_unpublish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _row public.marketing_content; _actor uuid;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  -- Migration G: who is publishing. Signed in, the signed-in person; a server call names the person,
  -- who must hold the same authority in this workspace.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
  SELECT * INTO _row FROM public.marketing_content WHERE id = p_id AND tenant_id = _tenant AND kind = 'image';
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: image not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status <> 'published' THEN
    RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
  END IF;
  PERFORM set_config('app.studio_publish_op', 'on', true);
  UPDATE public.marketing_content SET status = 'draft' WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  PERFORM set_config('app.studio_publish_op', 'off', true);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'marketing_content', 'studio_image_unpublish', _row.id, jsonb_build_object('tenant_id', _tenant));
  RETURN jsonb_build_object('id', _row.id, 'status', _row.status);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Only the server runs them: the publish door, on its service-role client
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.growth_page_publish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_page_unpublish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_form_publish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_form_unpublish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_funnel_publish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_funnel_unpublish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_image_publish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_image_unpublish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_page_publish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_page_unpublish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_publish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_unpublish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_publish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_funnel_unpublish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_image_publish(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_image_unpublish(uuid, uuid, uuid) TO service_role;

COMMIT;
