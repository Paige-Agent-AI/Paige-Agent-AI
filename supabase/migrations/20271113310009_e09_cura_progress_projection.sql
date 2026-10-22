-- EXP09: one original customer-safe Progress projection for the public reader and future trusted native context.
-- No new caller authority, AI context activation, table, writer, fixture or customer side effect.
BEGIN;
DO $incumbent$
DECLARE incumbent text;
BEGIN
  SELECT prosrc INTO incumbent FROM pg_catalog.pg_proc
   WHERE oid=pg_catalog.to_regprocedure('public.client_portal_progress(uuid,integer)');
  IF incumbent IS NULL OR pg_catalog.md5(incumbent)<>'9f092578c9401c6fd2f771988edba7e7' THEN
    RAISE EXCEPTION 'Original customer Progress reader changed; reconcile before composition' USING ERRCODE='42501';
  END IF;
END $incumbent$;

-- ALREADY AUTHORIZED scope only. This is a projection, not an authorization function.
-- Keep it postgres-only; a future native caller must prove the original actor/thread/relationship first.
CREATE FUNCTION public._client_portal_progress_projection(p_tenant_id uuid,p_client_id uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $projection$
DECLARE
  _client_id uuid := p_client_id;
  _tenant uuid := p_tenant_id;
  _limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  _summary jsonb;
  _items jsonb;
  _has_more boolean;
  _now timestamptz := now();
BEGIN
  IF p_tenant_id IS NULL OR p_client_id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.tenant_id=p_tenant_id) THEN
    RETURN NULL;
  END IF;

  -- Explicit allowlist. Summary text, priority, assignee, creator, sharer, plan, metadata, links and
  -- reminders are never projected. blocked reads as in_progress (owner decision D3).
  WITH visible AS (
    SELECT i.* FROM public.plan_items i
    WHERE i.tenant_id = _tenant AND i.contact_id = _client_id AND i.client_shared_at IS NOT NULL
      AND i.item_type IN ('milestone','task') AND i.status <> 'cancelled'
  ), ranked AS (
    SELECT v.*, row_number() OVER (ORDER BY (v.status = 'done'),
        CASE WHEN v.status <> 'done' THEN v.due_at END ASC NULLS LAST,
        CASE WHEN v.status = 'done' THEN v.completed_at END DESC NULLS LAST, v.id) AS rn
    FROM visible v
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'kind', r.item_type,
      'title', left(r.title, 200),
      'state', CASE r.status WHEN 'done' THEN 'done' WHEN 'open' THEN 'not_started' ELSE 'in_progress' END,
      'due_at', r.due_at,
      'completed_at', r.completed_at,
      'shared_at', r.client_shared_at,
      -- Only a parent the customer can see themselves; never a pointer at private work.
      'parent_id', (SELECT p.id FROM visible p WHERE p.id = r.parent_item_id AND p.item_type = 'milestone'))
      ORDER BY r.rn) FILTER (WHERE r.rn <= _limit), '[]'::jsonb),
    count(*) > _limit,
    jsonb_build_object(
      'shared', count(*),
      'done', count(*) FILTER (WHERE r.status = 'done'),
      'open', count(*) FILTER (WHERE r.status <> 'done'),
      'overdue', count(*) FILTER (WHERE r.status <> 'done' AND r.due_at IS NOT NULL AND r.due_at < _now))
  INTO _items, _has_more, _summary
  FROM ranked r;
  RETURN jsonb_build_object('tenant_id', _tenant, 'server_now', _now, 'summary', _summary,
    'items', _items, 'has_more', _has_more);
END;
$projection$;
REVOKE ALL ON FUNCTION public._client_portal_progress_projection(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._client_portal_progress_projection(uuid,uuid,integer) IS
 'Internal byte-preserved original customer-safe Progress projection. PostgreSQL owner only; scope must already be authorized by the original caller. No AI context or execution is activated.';

-- The actual Auth/resolver/scope prelude, signature, defaults and attributes are retained.
-- CREATE OR REPLACE preserves the original owner, grants and comment.
DO $delegate$
DECLARE
  target oid:=pg_catalog.to_regprocedure('public.client_portal_progress(uuid,integer)');
  prior text;
  definition text;
  replacement text:=$reader$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  _summary jsonb;
  _items jsonb;
  _has_more boolean;
  _now timestamptz := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- 42501 "select an authorized customer relationship" (more than one business) propagates as is.
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Re-prove the relationship; the business is the client's own, never the argument's.
  SELECT c.tenant_id INTO _tenant FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active';
  IF _tenant IS NULL THEN RETURN NULL; END IF;

  RETURN public._client_portal_progress_projection(_tenant, _client_id, p_limit);
END;
$reader$;
BEGIN
  SELECT prosrc INTO prior FROM pg_catalog.pg_proc WHERE oid=target;
  IF prior IS NULL OR pg_catalog.md5(prior)<>'9f092578c9401c6fd2f771988edba7e7' THEN
    RAISE EXCEPTION 'Original customer Progress reader changed during composition' USING ERRCODE='42501';
  END IF;
  definition:=pg_catalog.pg_get_functiondef(target);
  IF pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,prior,''))<>pg_catalog.length(prior) THEN
    RAISE EXCEPTION 'Original customer Progress body is not a unique definition segment' USING ERRCODE='42501';
  END IF;
  EXECUTE pg_catalog.replace(definition,prior,replacement);
END $delegate$;
COMMIT;
