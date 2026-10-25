-- EXP07 row 10 — the governed social-publication door's OWN record (registration → approval →
-- execution → truthful receipt). This is deliberately NOT the dormant paige_social_posts table:
-- that table is operator-scoped on live production (no tenant_id; the §9 decision recorded in
-- 20270117000000's compatibility bridge and #1155/#1161), and writing tenant rows into it would
-- fabricate ownership or break the legacy writer. The door needs a tenant-scoped record with the
-- CONTENT family's authority — the same posture as content_plan_entries (20271113850000).
--
-- One row per publish attempt (never mutated into another attempt): status walks
-- registered → approved → publishing → published | partial | failed | outcome_unknown | refused,
-- and the row is the receipt — it carries what the provider proved (post id/url), what failed
-- (code), or that the outcome is UNKNOWN (with the provider's request_id for reconciliation).
-- Retry safety: a retry is a NEW row through a NEW approval; the door refuses a new attempt for
-- the same piece+platform while an outcome_unknown row exists (reconcile-before-retry), so a
-- duplicate publish is structurally impossible from this door.

CREATE TABLE IF NOT EXISTS public.content_publications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The saved piece being published. Nullable-proof: deleting the piece leaves the receipt.
  content_id        uuid REFERENCES public.marketing_content(id) ON DELETE SET NULL,
  -- The network the piece ships to (the lifecycle's requested_platform vocabulary).
  platform          text NOT NULL CHECK (platform IN ('tiktok','instagram','facebook','linkedin','youtube','x','threads','pinterest','google_business','snapchat')),
  -- The governed connection this attempt ran through (NULL when refused before one was needed).
  connection_id     uuid,
  -- The single-use proposal claim this attempt executed under (the original actor's approval).
  confirmation_id   uuid,
  status            text NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered','approved','publishing','published','partial','failed','outcome_unknown','refused')),
  -- The provider's own identifiers, verbatim from its readback. What the receipt proves.
  provider_post_id  text,
  provider_post_url text,
  provider_request_id text,
  error_code        text,
  -- Exactly what was approved (the proposal's args) and exactly what the provider answered.
  -- The receipt is self-validating: anyone can re-derive the outcome from these two.
  request_args      jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_publications_tenant ON public.content_publications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_publications_content ON public.content_publications (content_id, platform) WHERE content_id IS NOT NULL;

ALTER TABLE public.content_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_publications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.content_publications TO service_role;

-- ── content_publication_record ────────────────────────────────────────────────────────────────
-- The door's write path (service-role, naming the workspace it resolved server-side): inserts the
-- attempt (registered) or advances its status. Status may only move FORWARD along the walk — a
-- published row can never go back to publishing, and only the door's own outcomes
-- (publishing/published/partial/failed/outcome_unknown/refused) are recordable here. The door is
-- the only caller; a signed-in caller naming p_tenant_id is refused (writes never trust a named
-- tenant from the browser).
CREATE OR REPLACE FUNCTION public.content_publication_record(
  p_id uuid, p_tenant_id uuid, p_status text,
  p_provider_post_id text DEFAULT NULL, p_provider_post_url text DEFAULT NULL,
  p_provider_request_id text DEFAULT NULL, p_error_code text DEFAULT NULL,
  p_provider_response jsonb DEFAULT NULL
) RETURNS public.content_publications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _row public.content_publications;
DECLARE _caller uuid := auth.uid();
DECLARE _walk text := CASE p_status
  WHEN 'publishing' THEN 'publishing' WHEN 'published' THEN 'published' WHEN 'partial' THEN 'partial'
  WHEN 'failed' THEN 'failed' WHEN 'outcome_unknown' THEN 'outcome_unknown' WHEN 'refused' THEN 'refused'
  ELSE NULL END;
BEGIN
  IF _caller IS NOT NULL THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN: publication records are written only by the publish door' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR _walk IS NULL THEN
    RAISE EXCEPTION 'CONTENT_INVALID: a tenant and a door status are required' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.content_publications (tenant_id, status)
      VALUES (p_tenant_id, 'registered') RETURNING * INTO _row;
  ELSE
    UPDATE public.content_publications
      SET status = _walk,
          provider_post_id = COALESCE(p_provider_post_id, provider_post_id),
          provider_post_url = COALESCE(p_provider_post_url, provider_post_url),
          provider_request_id = COALESCE(p_provider_request_id, provider_request_id),
          error_code = p_error_code,
          provider_response = COALESCE(p_provider_response, provider_response),
          updated_at = now()
      WHERE id = p_id AND tenant_id = p_tenant_id
        -- Forward-only: the walk order, and only from a live-earlier status.
        AND CASE status
          WHEN 'registered' THEN _walk IN ('publishing','refused')
          WHEN 'approved' THEN _walk IN ('publishing','refused')
          WHEN 'publishing' THEN _walk IN ('published','partial','failed','outcome_unknown','refused')
          ELSE false END
      RETURNING * INTO _row;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND: no such publication attempt, or that status change is not a step forward' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN _row;
END $fn$;
REVOKE ALL ON FUNCTION public.content_publication_record(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_publication_record(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;

-- ── content_publication_bind ───────────────────────────────────────────────────────────────────
-- The door stamps the attempt with WHAT was approved (piece, platform, connection, confirmation,
-- args) at claim time — once. A bound attempt cannot be re-bound (a second bind is CONTENT_INVALID),
-- so what ran is always exactly what one approval claimed.
CREATE OR REPLACE FUNCTION public.content_publication_bind(
  p_id uuid, p_tenant_id uuid, p_content_id uuid, p_platform text,
  p_connection_id uuid, p_confirmation_id uuid, p_request_args jsonb
) RETURNS public.content_publications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _row public.content_publications;
DECLARE _caller uuid := auth.uid();
BEGIN
  IF _caller IS NOT NULL THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN: publication records are written only by the publish door' USING ERRCODE = '42501';
  END IF;
  UPDATE public.content_publications
    SET content_id = p_content_id, platform = p_platform, connection_id = p_connection_id,
        confirmation_id = p_confirmation_id, request_args = COALESCE(p_request_args, '{}'::jsonb),
        status = 'approved', updated_at = now()
    WHERE id = p_id AND tenant_id = p_tenant_id AND status = 'registered'
      AND content_id IS NULL AND confirmation_id IS NULL
    RETURNING * INTO _row;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: no unbound attempt to bind' USING ERRCODE = 'P0002';
  END IF;
  RETURN _row;
END $fn$;
REVOKE ALL ON FUNCTION public.content_publication_bind(uuid, uuid, uuid, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_publication_bind(uuid, uuid, uuid, text, uuid, uuid, jsonb) TO service_role;

-- ── content_publication_list ───────────────────────────────────────────────────────────────────
-- The customer-facing read (the receipt history), newest first. CONTENT-family authority:
-- the caller's ACTIVE workspace, any member may read the workspace's publication receipts.
CREATE OR REPLACE FUNCTION public.content_publication_list(
  p_content_id uuid DEFAULT NULL, p_tenant_id uuid DEFAULT NULL
) RETURNS SETOF public.content_publications
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _caller uuid := auth.uid(); _tenant uuid;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_tenant_member(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: a workspace member is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT e.* FROM public.content_publications e
  WHERE e.tenant_id = _tenant AND (p_content_id IS NULL OR e.content_id = p_content_id)
  ORDER BY e.created_at DESC;
END $fn$;
REVOKE ALL ON FUNCTION public.content_publication_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_publication_list(uuid, uuid) TO authenticated, service_role;

-- ── content_publication_pending_reconcile ─────────────────────────────────────────────────────
-- The reconcile-before-retry gate: TRUE when an outcome_unknown attempt exists for this
-- piece+platform (a new attempt must be refused until that one is reconciled by hand).
CREATE OR REPLACE FUNCTION public.content_publication_pending_reconcile(
  p_content_id uuid, p_platform text, p_tenant_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _pending boolean;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.content_publications
    WHERE tenant_id = _tenant AND content_id = p_content_id AND platform = p_platform
      AND status = 'outcome_unknown'
  ) INTO _pending;
  RETURN _pending;
END $fn$;
REVOKE ALL ON FUNCTION public.content_publication_pending_reconcile(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_publication_pending_reconcile(uuid, text, uuid) TO authenticated, service_role;
