-- EXP07 row 6 (templates/reuse): the missing SET path for studio_sessions.is_template.
-- The column, the 'templates' list filter and create-time p_is_template have existed since
-- 20260716182213 / 20260716222837, but nothing could turn an existing project into a template —
-- the flag was write-once-at-create and the UI never passed it. This adds the same governed
-- setter set_studio_session_starred already has (same migration family, same shape): the active
-- workspace's owner/admin/coach/super_admin gate (studio_role_ok), the tenant wall (a session in
-- another workspace is NOT_FOUND, never swapped), and the creator-or-admin update predicate —
-- a plain member cannot template someone else's project. Flipping the flag is the ONLY effect:
-- 'recent'/'mine' lists exclude templates (existing filter), p_filter='templates' includes them.

-- ── set_studio_session_template ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_studio_session_template(
  p_id uuid, p_is_template boolean, p_tenant_id uuid DEFAULT NULL
) RETURNS public.studio_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _row public.studio_sessions;
BEGIN
  IF _caller IS NOT NULL THEN
    IF NOT public.studio_role_ok(_caller) THEN
      RAISE EXCEPTION 'STUDIO_FORBIDDEN: owner, admin, coach or super_admin required' USING ERRCODE = '42501'; END IF;
    _tenant := public.current_user_tenant_id();
  ELSE _tenant := p_tenant_id; END IF;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'STUDIO_NO_TENANT: a tenant context is required' USING ERRCODE = '22023'; END IF;
  UPDATE public.studio_sessions SET is_template = coalesce(p_is_template, false)
    WHERE id = p_id AND tenant_id = _tenant
      AND (auth.uid() IS NULL OR owner_user_id = auth.uid() OR public.is_tenant_admin(_tenant))
    RETURNING * INTO _row;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'STUDIO_NOT_FOUND: session not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.set_studio_session_template(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_studio_session_template(uuid, boolean, uuid) TO authenticated, service_role;
