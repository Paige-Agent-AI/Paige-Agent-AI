-- Bind the existing human authorization to the original reviewed control state.
-- Keep incumbent three-argument callers and the canonical writer unchanged.
CREATE OR REPLACE FUNCTION public.control_weekly_commitment_check(
  _automation_id uuid, _action text, _expected_revision integer, _expected_control jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _tid uuid:=public.current_user_tenant_id(); _uid uuid:=auth.uid(); _a public.paige_automations;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _action IS DISTINCT FROM 'authorize' OR jsonb_typeof(_expected_control) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_INVALID_CONTROL' USING ERRCODE='22023'; END IF;
  IF NOT (_expected_control ?& ARRAY['state','future_control_at'])
    OR (SELECT count(*) FROM jsonb_object_keys(_expected_control))<>2
    OR _expected_control->>'state' IS NULL OR _expected_control->>'state' NOT IN ('requested','paused')
    OR jsonb_typeof(_expected_control->'future_control_at') NOT IN ('null','string') THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_INVALID_CONTROL' USING ERRCODE='22023'; END IF;
  SELECT * INTO _a FROM public.paige_automations WHERE id=_automation_id AND tenant_id=_tid AND created_by=_uid
    AND trigger_key='schedule.weekly_commitment_check' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  -- Compare AFTER acquiring the canonical process lock. The original cutoff also
  -- distinguishes paused -> live -> paused, without another version/approval store.
  IF _expected_control->>'state' IS DISTINCT FROM (CASE WHEN _a.state='draft' THEN 'requested' ELSE _a.state END)
    OR _expected_control->>'future_control_at' IS DISTINCT FROM _a.trigger_config->>'future_control_at'
    OR _a.trigger_config->>'cancelled_at' IS NOT NULL THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_CONTROL_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN public.control_weekly_commitment_check(_automation_id,_action,_expected_revision);
END $$;
REVOKE ALL ON FUNCTION public.control_weekly_commitment_check(uuid,text,integer,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.control_weekly_commitment_check(uuid,text,integer,jsonb) TO authenticated;
COMMENT ON FUNCTION public.control_weekly_commitment_check(uuid,text,integer,jsonb) IS
 'Owner-only compare-and-authorize through the incumbent weekly writer; exact original state/cutoff and revision, no dispatch or global activation.';
