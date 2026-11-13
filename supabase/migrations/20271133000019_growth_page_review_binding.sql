-- Bind a page-publish approval to the saved content and native destination the
-- original door reviewed. Keep the existing publishing writer and audit path.
CREATE OR REPLACE FUNCTION public.growth_page_publish_review(p_tenant_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'tenant_slug', t.slug,
    'page', jsonb_build_object(
      'id', p.id, 'tenant_id', p.tenant_id, 'title', p.title, 'slug', p.slug,
      'status', p.status, 'blocks_json', p.blocks_json,
      'draft_blocks_json', p.draft_blocks_json, 'draft_seo_json', p.draft_seo_json,
      -- Content covers changes made in the same transaction. xmin also retires
      -- cards on a later save or publication, even if the content is identical.
      'publish_revision', encode(sha256(convert_to(jsonb_build_array(
        p.xmin::text, p.title, p.slug, p.status, p.blocks_json, p.draft_blocks_json,
        p.theme_json, p.draft_theme_json, p.seo_json, p.draft_seo_json
      )::text, 'UTF8')), 'hex')
    )
  )
  FROM public.growth_pages p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = p_id AND p.tenant_id = p_tenant_id;
$$;

REVOKE ALL ON FUNCTION public.growth_page_publish_review(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_page_publish_review(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.growth_page_publish(
  p_tenant_id uuid, p_id uuid, p_actor_id uuid, p_reviewed_revision text, p_reviewed_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _tenant uuid;
  _actor uuid;
  _row public.growth_pages;
  _tenant_slug text;
  _page_slug text;
  _path text;
  _snapshot jsonb;
BEGIN
  _tenant := public._growth_admin_tenant(p_tenant_id);
  _actor := public._studio_publish_actor(_tenant, p_actor_id);

  -- Lock the destination and page in that order. The final compare and the
  -- original publish both run in this transaction while these locks are held.
  SELECT t.slug INTO _tenant_slug FROM public.tenants t WHERE t.id = _tenant FOR SHARE;
  SELECT p.slug INTO _page_slug FROM public.growth_pages p
    WHERE p.id = p_id AND p.tenant_id = _tenant FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002';
  END IF;
  -- A seat can change while this transaction waits on either lock.
  _actor := public._studio_publish_actor(_tenant, p_actor_id);
  _path := '/p/' || _tenant_slug || '/' || _page_slug;
  _snapshot := public.growth_page_publish_review(_tenant, p_id);
  IF _tenant_slug IS NULL OR btrim(_tenant_slug) = '' OR _page_slug IS NULL OR btrim(_page_slug) = ''
      OR p_reviewed_revision IS NULL OR p_reviewed_path IS NULL
      OR _snapshot #>> '{page,publish_revision}' IS DISTINCT FROM p_reviewed_revision
      OR _path IS DISTINCT FROM p_reviewed_path THEN
    RAISE EXCEPTION 'GROWTH_PAGE_REVIEW_STALE: review this page again before publishing' USING ERRCODE = '22023';
  END IF;

  _row := public._growth_page_go_live(_tenant, p_id);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'growth_pages', 'growth_page_publish', _row.id, jsonb_build_object('tenant_id', _tenant, 'slug', _row.slug));
  RETURN jsonb_build_object('id', _row.id, 'slug', _row.slug, 'tenant_slug', _tenant_slug,
    'status', _row.status, 'published_at', _row.published_at, 'url', _path);
END;
$$;

REVOKE ALL ON FUNCTION public.growth_page_publish(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_page_publish(uuid, uuid, uuid, text, text) TO service_role;

-- Old Edge bundles and approvals without a reviewed revision fail closed if
-- the migration lands first. Never leave a legacy service-role writer bypass.
CREATE OR REPLACE FUNCTION public.growth_page_publish(p_tenant_id uuid, p_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public._growth_admin_tenant(p_tenant_id);
  RAISE EXCEPTION 'GROWTH_PAGE_REVIEW_STALE: review this page again before publishing' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.growth_page_publish(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_page_publish(uuid, uuid, uuid) TO service_role;
