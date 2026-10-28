-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- tenant_media_assets — the tenant-scoped Stream catalogue (EXP07 media-library slice).
--
-- Grounded on what exists: marketing_content (the saved library), paige_media_jobs (the durable
-- job machinery) and the growth-assets storage. This table is ONLY the tenant→Cloudflare-Stream
-- binding + lifecycle — metadata rows, not a second asset registry, not a second meter (usage
-- stays in platform_usage_events), not provider custody (the Stream token stays edge-only).
--
-- House shape (content_publications precedent): RLS ENABLED with ZERO policies — browser roles
-- hold no table grants; every read/write runs through SECURITY DEFINER RPCs that re-derive the
-- caller and re-check authority in the body. Service-role RPC-only for writes; members read.
--
-- Lifecycle is forward-only like the publications walk: uploading → processing → ready | failed
-- | outcome_unknown (an uncertain processing result BLOCKS re-registration until reconciled by
-- hand — the same reconcile-before-retry doctrine as the publish door); revoked is the
-- retention/deletion terminal. A stream_uid binds once per tenant (UNIQUE) — a duplicate
-- registration of the same provider video under two rows is impossible, not discouraged.
--
-- This migration also carries the three owed SQL P3s:
--   P3-1 content_publication_pending_reconcile raised CONTENT_NO_TENANT consistently (a caller
--       with no workspace silently got FALSE before — a gate must fail the way its sibling does);
--   P3-2 content_publication_list gains a deterministic tiebreaker (id DESC) so same-timestamp
--       receipts cannot reorder between reads;
--   P3-3 platform_usage_events gains the unique functional index that makes the sweeper's
--       per-job meter row exactly-once at the database level (the best-effort check retires).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_media_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title               text NOT NULL DEFAULT 'Untitled video',
  kind                text NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio')),
  stream_uid          text NOT NULL CHECK (stream_uid ~ '^[0-9a-f]{32}$'),
  status              text NOT NULL DEFAULT 'uploading'
                      CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'outcome_unknown', 'revoked')),
  bytes               bigint,
  duration_seconds    numeric,
  error_code          text,
  marketing_content_id uuid REFERENCES public.marketing_content(id) ON DELETE SET NULL,
  provider_meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_media_assets IS
  'EXP07 media library: the tenant→Cloudflare Stream binding and its forward-only lifecycle. '
  'Metadata only — media bytes live at the provider; usage meters to platform_usage_events; '
  'the provider token never leaves the edge environment.';

-- One provider video binds once per tenant; the UNIQUE index enforces it at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_media_assets_tenant_stream_uid_idx
  ON public.tenant_media_assets (tenant_id, stream_uid);

CREATE INDEX IF NOT EXISTS tenant_media_assets_tenant_created_idx
  ON public.tenant_media_assets (tenant_id, created_at DESC);

ALTER TABLE public.tenant_media_assets ENABLE ROW LEVEL SECURITY;
-- Zero policies by design: browser roles hold no grants; the RPCs below are the only doors.
REVOKE ALL ON public.tenant_media_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_media_assets TO service_role;

CREATE OR REPLACE FUNCTION public.touch_tenant_media_asset() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_tenant_media_asset_touch ON public.tenant_media_assets;
CREATE TRIGGER trg_tenant_media_asset_touch BEFORE UPDATE ON public.tenant_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_tenant_media_asset();

-- ── tenant_media_asset_register ──────────────────────────────────────────────────────────────
-- Service-role only: create the row at 'uploading' and bind the stream uid. The bind is
-- ONCE per (tenant, stream_uid) — a second registration of the same provider video under a
-- second row is refused (unique index), and an outcome_unknown row for the same uid refuses
-- re-registration until reconciled (the retry gate).
CREATE OR REPLACE FUNCTION public.tenant_media_asset_register(
  p_tenant_id uuid, p_stream_uid text, p_title text DEFAULT NULL,
  p_kind text DEFAULT 'video', p_marketing_content_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS public.tenant_media_assets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _caller uuid := auth.uid(); _row public.tenant_media_assets;
BEGIN
  IF _caller IS NOT NULL THEN
    RAISE EXCEPTION 'MEDIA_FORBIDDEN: registration is service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR p_stream_uid IS NULL OR p_stream_uid !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'MEDIA_INVALID: a tenant and a 32-hex stream uid are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenant_media_assets
    WHERE tenant_id = p_tenant_id AND stream_uid = p_stream_uid AND status = 'outcome_unknown'
  ) THEN
    RAISE EXCEPTION 'MEDIA_RETRY_PENDING_RECONCILIATION: a previous registration of that video never reported an outcome' USING ERRCODE = '40P01';
  END IF;
  INSERT INTO public.tenant_media_assets (tenant_id, stream_uid, title, kind, marketing_content_id, created_by, status)
  VALUES (p_tenant_id, p_stream_uid,
          COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), 'Untitled video'),
          COALESCE(p_kind, 'video'), p_marketing_content_id, p_created_by, 'uploading')
  RETURNING * INTO _row;
  RETURN _row;
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_media_asset_register(uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_media_asset_register(uuid, text, text, text, uuid, uuid) TO service_role;

-- ── tenant_media_asset_set_status ────────────────────────────────────────────────────────────
-- Service-role only: the forward-only walk. uploading→processing→ready|failed|outcome_unknown;
-- any live status→revoked (retention). Repeated/terminal writes are refused — the row is the
-- receipt and cannot be walked backwards or rewritten after a terminal state.
CREATE OR REPLACE FUNCTION public.tenant_media_asset_set_status(
  p_id uuid, p_tenant_id uuid, p_status text,
  p_error_code text DEFAULT NULL, p_bytes bigint DEFAULT NULL,
  p_duration_seconds numeric DEFAULT NULL, p_provider_meta jsonb DEFAULT NULL
) RETURNS public.tenant_media_assets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _caller uuid := auth.uid(); _row public.tenant_media_assets; _next public.tenant_media_assets;
BEGIN
  IF _caller IS NOT NULL THEN
    RAISE EXCEPTION 'MEDIA_FORBIDDEN: status transitions are service-role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _row FROM public.tenant_media_assets
  WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_NOT_FOUND: that video is not in this workspace''s library' USING ERRCODE = '22023';
  END IF;
  IF _row.status = 'revoked' OR _row.status = p_status THEN
    RAISE EXCEPTION 'MEDIA_WALK_INVALID: the lifecycle is forward-only and terminal states freeze' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (_row.status = 'uploading' AND p_status IN ('processing', 'failed')) OR
    (_row.status = 'processing' AND p_status IN ('ready', 'failed', 'outcome_unknown')) OR
    (p_status = 'revoked')
  ) THEN
    RAISE EXCEPTION 'MEDIA_WALK_INVALID: % → % is not a lifecycle edge' USING ERRCODE = '22023', _row.status, p_status;
  END IF;
  UPDATE public.tenant_media_assets SET
    status = p_status,
    error_code = p_error_code,
    bytes = COALESCE(p_bytes, bytes),
    duration_seconds = COALESCE(p_duration_seconds, duration_seconds),
    provider_meta = CASE WHEN p_provider_meta IS NULL THEN provider_meta
                          ELSE provider_meta || p_provider_meta END
  WHERE id = p_id AND tenant_id = p_tenant_id
  RETURNING * INTO _next;
  RETURN _next;
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_media_asset_set_status(uuid, uuid, text, text, bigint, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_media_asset_set_status(uuid, uuid, text, text, bigint, numeric, jsonb) TO service_role;

-- ── tenant_media_asset_list ─────────────────────────────────────────────────────────────────
-- The customer read (the library). CONTENT-family authority: the caller's ACTIVE workspace,
-- any member may read; a mismatched p_tenant_id is refused; newest first with a deterministic
-- tiebreaker (P3-2's doctrine applied here from day one).
CREATE OR REPLACE FUNCTION public.tenant_media_asset_list(
  p_tenant_id uuid DEFAULT NULL
) RETURNS SETOF public.tenant_media_assets
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _caller uuid := auth.uid(); _tenant uuid;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'MEDIA_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'MEDIA_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_tenant_member(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'MEDIA_FORBIDDEN: a workspace member is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'MEDIA_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT e.* FROM public.tenant_media_assets e
  WHERE e.tenant_id = _tenant
  ORDER BY e.created_at DESC, e.id DESC;
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_media_asset_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_media_asset_list(uuid) TO authenticated, service_role;

-- ── P3-1: the publications reconcile gate fails the way its sibling does ────────────────────
CREATE OR REPLACE FUNCTION public.content_publication_pending_reconcile(
  p_content_id uuid, p_platform text, p_tenant_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _pending boolean;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;
  END IF;
  IF _tenant IS NULL THEN
    -- P3-1: an unresolvable tenant is an ERROR, never a silent FALSE that would quietly
    -- open the retry gate the function exists to hold.
    RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  IF p_content_id IS NULL OR COALESCE(btrim(p_platform), '') = '' THEN
    RAISE EXCEPTION 'CONTENT_INVALID: the piece and the platform are required' USING ERRCODE = '22023';
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

-- ── P3-2: the publications read gains a deterministic tiebreaker ────────────────────────────
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
  ORDER BY e.created_at DESC, e.id DESC;
END $fn$;
REVOKE ALL ON FUNCTION public.content_publication_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_publication_list(uuid, uuid) TO authenticated, service_role;

-- ── P3-3: the media meter becomes exactly-once at the database level ────────────────────────
-- One usage row per (tenant, job) for the media_usd event; the sweeper's best-effort
-- pre-check retires to defense-in-depth. Existing duplicates (if any) collapse first.
DELETE FROM public.platform_usage_events a
USING public.platform_usage_events b
WHERE a.event_type = 'media_usd' AND b.event_type = 'media_usd'
  AND a.tenant_id = b.tenant_id AND a.metadata->>'job_id' = b.metadata->>'job_id'
  AND a.metadata->>'job_id' IS NOT NULL
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS platform_usage_events_media_job_uniq
  ON public.platform_usage_events (tenant_id, (metadata->>'job_id'))
  WHERE event_type = 'media_usd' AND metadata->>'job_id' IS NOT NULL;
