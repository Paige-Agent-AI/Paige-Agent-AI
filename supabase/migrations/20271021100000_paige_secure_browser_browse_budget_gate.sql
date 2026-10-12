-- PC-1 — the read-only browse budget gate + settle pair (coordinator review fixes P1+P2 on #2003).
--
-- WHY THIS EXISTS: the interpreter previously read secure_browser_tenant_limits directly through
-- service_role — but 20270419000000 REVOKEs ALL on that table from service_role (gated RPCs are the
-- only door), so that read ALWAYS failed and the consult degraded every tenant to
-- control_plane:unreadable. And its completed-usage scan was not atomic: concurrent browses could
-- pass the same daily budget together, and a MISSING limits row passed as "no budget configured"
-- (fail-open). This migration adds the minimal governed reservation contract for the read-only
-- browse path, reusing the control plane's exact transactional semantics (limits-row FOR UPDATE
-- serialization + day usage window), with the same service-role-only admission shape as
-- secure_browser_reserve_session.
--
-- Deliberate differences from reserve_session (documented for reviewers):
--   • No paige_chat_threads requirement — the browse skill path (run_skill → interpreter) has no
--     coach thread; actor provenance stays in the interpreter's rail write.
--   • No worker_available check — that flag gates the FUTURE external credentialed worker; the
--     read-only self-hosted Fly browser is a different runtime.
--   • No session row — a browse call reserves worst-case seconds in the DAY window and the caller
--     settles actual seconds on EVERY exit (success, block, throw, cancel). A crashed caller leaks
--     at most its reservation until the UTC day window rolls over (conservative, self-healing).
--   • Seconds only — the self-hosted browse path has no per-call provider cost (microusd stays 0).
--
-- Nothing here activates anything: zero tenants carry the flag; the Fly wildcard flag stays off.

CREATE FUNCTION public.secure_browser_browse_budget_gate(p_tenant uuid, p_reserved_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_limits public.secure_browser_tenant_limits; v_day public.secure_browser_usage_windows;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SECURE_BROWSER_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_tenant IS NULL OR p_reserved_seconds IS NULL OR p_reserved_seconds < 1 THEN
    RAISE EXCEPTION 'SECURE_BROWSER_REQUEST_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant AND COALESCE((t.features->>'secure_browser')::boolean,false)) THEN
    RETURN jsonb_build_object('allowed',false,'reason','control_plane:feature_disabled');
  END IF;
  -- Serialization point: every concurrent gate for this tenant lines up on the limits row.
  SELECT * INTO v_limits FROM public.secure_browser_tenant_limits l WHERE l.tenant_id=p_tenant FOR UPDATE;
  IF v_limits.tenant_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','control_plane:not_configured'); -- missing limits row = NOT enabled (fail closed, P2)
  END IF;
  IF NOT v_limits.enabled OR v_limits.paused_at IS NOT NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','control_plane:disabled');
  END IF;
  IF p_reserved_seconds > v_limits.max_session_seconds THEN
    RAISE EXCEPTION 'SECURE_BROWSER_RESERVATION_INVALID' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.secure_browser_usage_windows(tenant_id,window_kind,window_start) VALUES(p_tenant,'day',current_date) ON CONFLICT DO NOTHING;
  SELECT * INTO v_day FROM public.secure_browser_usage_windows w
   WHERE w.tenant_id=p_tenant AND w.window_kind='day' AND w.window_start=current_date FOR UPDATE;
  IF v_day.reserved_seconds + v_day.consumed_seconds + p_reserved_seconds > v_limits.max_daily_session_seconds THEN
    RETURN jsonb_build_object('allowed',false,'reason','control_plane:daily_budget');
  END IF;
  UPDATE public.secure_browser_usage_windows SET reserved_seconds=reserved_seconds+p_reserved_seconds,updated_at=now()
   WHERE tenant_id=p_tenant AND window_kind='day' AND window_start=current_date;
  RETURN jsonb_build_object('allowed',true,'reservedSeconds',p_reserved_seconds);
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_browse_budget_gate(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_browser_browse_budget_gate(uuid,integer) TO service_role;

CREATE FUNCTION public.secure_browser_browse_budget_settle(p_tenant uuid, p_reserved_seconds integer, p_consumed_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SECURE_BROWSER_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_tenant IS NULL OR p_reserved_seconds IS NULL OR p_reserved_seconds < 1
     OR p_consumed_seconds IS NULL OR p_consumed_seconds < 0 OR p_consumed_seconds > p_reserved_seconds THEN
    RAISE EXCEPTION 'SECURE_BROWSER_REQUEST_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.secure_browser_usage_windows w WHERE w.tenant_id=p_tenant AND w.window_kind='day' AND w.window_start=current_date) THEN
    RETURN jsonb_build_object('settled',false,'reason','no_window'); -- nothing reserved today (e.g. day rolled over) — honest no-op
  END IF;
  UPDATE public.secure_browser_usage_windows SET
    reserved_seconds=GREATEST(0,reserved_seconds-p_reserved_seconds),
    consumed_seconds=consumed_seconds+p_consumed_seconds,
    updated_at=now()
   WHERE tenant_id=p_tenant AND window_kind='day' AND window_start=current_date;
  RETURN jsonb_build_object('settled',true,'consumedSeconds',p_consumed_seconds);
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_browse_budget_settle(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_browser_browse_budget_settle(uuid,integer,integer) TO service_role;

COMMENT ON FUNCTION public.secure_browser_browse_budget_gate(uuid,integer) IS 'Atomic read-only browse reservation against the tenant day budget; service-role only; missing limits row fails closed.';
COMMENT ON FUNCTION public.secure_browser_browse_budget_settle(uuid,integer,integer) IS 'Releases the worst-case reservation and records actual consumed seconds; call on every browse exit.';
