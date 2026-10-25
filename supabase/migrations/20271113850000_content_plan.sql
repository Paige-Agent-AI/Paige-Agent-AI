-- EXP07 row 8 — the content-calendar PLAN. A dated, channel-specific plan for the workspace's
-- content: what ships where, when, from which saved piece. It is a PLAN and nothing more:
-- no execution, no queue, no scheduler, no provider hooks, no published state — authorized
-- scheduling (when it exists) is EXP05's consequential-execution world and would consume this
-- plan under its own approvals. The upsert/list RPCs below mirror the CONTENT family's
-- authority posture (migration D §9/§59): the caller's ACTIVE workspace only (a named foreign
-- tenant is refused, never swapped), the workspace's owner/admin or its managing agency, and a
-- linked content row must belong to the same tenant (a foreign content_id is refused, the row
-- is never adopted). Cancel is a status, not a delete: the plan keeps its history, and no
-- operation here can create a duplicate of anything — there is nothing to duplicate.

CREATE TABLE IF NOT EXISTS public.content_plan_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The saved piece this entry plans to ship. Nullable: an entry may plan a slot before the
  -- piece exists. If the piece is later deleted, the plan keeps its date and turns honest
  -- (content_id SET NULL; the UI says the linked piece is gone, never invents a link).
  content_id  uuid REFERENCES public.marketing_content(id) ON DELETE SET NULL,
  channel     text NOT NULL CHECK (channel IN ('social_post','ad_copy','email_campaign','caption','blog_outline','sms_broadcast','site')),
  -- A timezone-aware instant: the browser sends it with its offset, so the plan can never be
  -- DST-ambiguous, and every reader renders it in their own zone. It is a PLAN time — nothing
  -- fires at it.
  planned_for timestamptz NOT NULL,
  note        text,
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ready','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_plan_tenant_time ON public.content_plan_entries (tenant_id, planned_for);
CREATE INDEX IF NOT EXISTS idx_content_plan_content ON public.content_plan_entries (content_id) WHERE content_id IS NOT NULL;

-- Direct table access is impossible: RLS on, zero policies. Every read and write goes through
-- the two RPCs below, which carry the authority checks.
ALTER TABLE public.content_plan_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_plan_entries FROM PUBLIC, anon;
GRANT SELECT ON public.content_plan_entries TO service_role;

-- ── content_plan_upsert ─────────────────────────────────────────────────────────────────────────
-- Creates or edits one plan entry. p_id NULL = create; p_id set = edit that entry (this tenant's
-- only). Status may move planned↔ready↔cancelled freely — every state is a plan state, and no
-- state does anything.
CREATE OR REPLACE FUNCTION public.content_plan_upsert(
  p_id uuid DEFAULT NULL, p_content_id uuid DEFAULT NULL, p_channel text DEFAULT NULL, p_planned_for timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL, p_status text DEFAULT 'planned', p_tenant_id uuid DEFAULT NULL
) RETURNS public.content_plan_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _row public.content_plan_entries;
  _status text := COALESCE(NULLIF(btrim(p_status), ''), 'planned');
  _note text := NULLIF(btrim(coalesce(p_note, '')), '');
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_tenant_admin(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: the workspace owner or an admin is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;  -- service_role (Paige) names the tenant
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  -- A linked piece must be this workspace's own — a foreign content_id is refused, never adopted.
  IF p_content_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.marketing_content mc WHERE mc.id = p_content_id AND mc.tenant_id = _tenant
  ) THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: that piece is not in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF p_channel IS NULL OR NULLIF(btrim(p_channel), '') IS NULL THEN
    RAISE EXCEPTION 'CONTENT_INVALID: a channel is required' USING ERRCODE = '22023';
  END IF;
  IF p_planned_for IS NULL THEN
    RAISE EXCEPTION 'CONTENT_INVALID: a planned time is required' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.content_plan_entries (tenant_id, created_by, content_id, channel, planned_for, note, status)
      VALUES (_tenant, _caller, p_content_id, p_channel, p_planned_for, _note, _status)
      RETURNING * INTO _row;
  ELSE
    UPDATE public.content_plan_entries
      SET content_id = p_content_id, channel = p_channel, planned_for = p_planned_for,
          note = _note, status = _status, updated_at = now()
      WHERE id = p_id AND tenant_id = _tenant
      RETURNING * INTO _row;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND: that plan entry is not in this workspace' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN _row;
END $fn$;
REVOKE ALL ON FUNCTION public.content_plan_upsert(uuid, uuid, text, timestamptz, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_plan_upsert(uuid, uuid, text, timestamptz, text, text, uuid) TO authenticated, service_role;

-- ── content_plan_list ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.content_plan_list(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_tenant_id uuid DEFAULT NULL
) RETURNS SETOF public.content_plan_entries
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
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
  SELECT e.* FROM public.content_plan_entries e
  WHERE e.tenant_id = _tenant
    AND (p_from IS NULL OR e.planned_for >= p_from)
    AND (p_to IS NULL OR e.planned_for <= p_to)
  ORDER BY e.planned_for ASC;
END $fn$;
REVOKE ALL ON FUNCTION public.content_plan_list(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_plan_list(timestamptz, timestamptz, uuid) TO authenticated, service_role;
