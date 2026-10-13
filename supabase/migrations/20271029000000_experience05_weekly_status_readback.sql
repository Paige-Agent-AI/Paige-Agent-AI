-- Experience 05: additive owner-only status for the same Chat/Calendar process.
-- No schedule, booking, event, execution, permission or receipt is written by this read.
-- Keep latest uncertainty visible independently from an older fully correlated verified result.
-- Reuse the owner-controlled business zone; approved schedule zones never change implicitly.
-- CLI-created unapplied migration renumbered after current future-dated main migration20271028000000.

CREATE OR REPLACE FUNCTION public.get_weekly_commitment_checks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE _tid uuid:=public.current_user_tenant_id(); _uid uuid:=auth.uid(); _result jsonb; _read_at timestamptz:=clock_timestamp(); _zone text; _zone_state text; _more boolean;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT z.time_zone INTO _zone FROM public.tenant_business_time_zones z WHERE z.tenant_id=_tid;
  _zone_state:=CASE WHEN _zone IS NULL THEN 'missing'
    WHEN _zone ~ '^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)?)$'
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=_zone) THEN 'configured' ELSE 'invalid' END;
  SELECT EXISTS(SELECT 1 FROM public.paige_automations a WHERE a.tenant_id=_tid AND a.created_by=_uid
    AND a.trigger_key='schedule.weekly_commitment_check' ORDER BY a.updated_at DESC,a.id DESC OFFSET 50 LIMIT 1) INTO _more;
  SELECT coalesce(jsonb_agg(jsonb_build_object('automation_id',a.id,'name',a.name,
    'state',CASE WHEN a.trigger_config->>'cancelled_at' IS NOT NULL THEN 'cancelled' ELSE a.state END,
    'schedule_status',CASE WHEN a.trigger_config->>'cancelled_at' IS NOT NULL THEN 'cancelled'
      WHEN a.state='draft' THEN 'requested' WHEN a.state='paused' THEN 'paused' ELSE 'scheduled' END,
    'revision',(a.trigger_config->>'revision')::integer,'schedule',a.trigger_config,
    'posture',posture.value,'tool_lane',posture.tool_lane,'intended_next_run_at',a.trigger_config->'next_run_at',
    'execution_availability',CASE WHEN posture.value->>'would_run'='true' AND posture.value->>'effective'='auto'
      AND posture.tool_lane='auto' AND a.state='live' AND a.trigger_config->>'cancelled_at' IS NULL THEN 'ready' ELSE 'held' END,
    'execution_hold_reason',CASE WHEN jsonb_array_length(coalesce(posture.value->'dark','[]'::jsonb))>0
      THEN posture.value#>>'{dark,0,reason}' WHEN a.trigger_config->>'cancelled_at' IS NOT NULL THEN 'cancelled'
      WHEN a.state<>'live' THEN a.state WHEN posture.tool_lane<>'auto' THEN 'tool_lane_'||coalesce(posture.tool_lane,'unavailable')
      WHEN posture.value->>'effective'<>'auto' THEN coalesce(posture.value->>'capped_by','effective_lane') ELSE NULL END,
    'next_run_at',CASE WHEN a.state='live' AND a.trigger_config->>'cancelled_at' IS NULL
      AND posture.value->>'would_run'='true' AND posture.value->>'effective'='auto' AND posture.tool_lane='auto'
      THEN a.trigger_config->'next_run_at' ELSE NULL END,
    'last_verified_run',CASE WHEN verified.event_id IS NULL THEN NULL ELSE jsonb_build_object(
      'event_id',verified.event_id,'act_id',verified.act_id,'correlation_ref',verified.correlation_ref,
      'scheduled_for',verified.scheduled_for,'status','completed','observation',verified.observation,'settled_at',verified.settled_at) END,
    'last_run',CASE WHEN ev.id IS NULL THEN NULL ELSE jsonb_build_object('event_id',ev.id,'scheduled_for',ev.occurred_at,
      'event_state',ev.processing_state,'act_id',ae.act_id,'correlation_ref',ae.correlation_ref,'outcome',ae.outcome,
      'status',CASE WHEN ae.outcome::text='executed'
        AND ae.detail#>>'{weekly_commitment_observation,correlation_ref}'=ae.correlation_ref
        AND ae.detail#>>'{weekly_commitment_observation,event_id}'=ev.id::text
        AND ae.detail#>>'{weekly_commitment_observation,act_id}'=ae.act_id::text
        AND EXISTS(SELECT 1 FROM public.paige_workspace_events receipt WHERE receipt.tenant_id=_tid
          AND receipt.source_kind='capability_run' AND receipt.source_id::text=ae.detail#>>'{weekly_commitment_observation,receipt_id}'
          AND receipt.capability_key='planning_weekly_commitment_check' AND receipt.outcome='capability_succeeded'
          AND receipt.detail->>'event_id'=ev.id::text AND receipt.detail->>'act_id'=ae.act_id::text) THEN 'completed'
        WHEN ae.outcome::text='executed' THEN 'unknown' WHEN ae.outcome::text='failed' THEN 'failed'
        WHEN ae.outcome::text='cancelled' THEN 'cancelled' WHEN ae.outcome::text='ambiguous' THEN 'unknown'
        WHEN ae.outcome::text='approval_pending' THEN 'needs_approval' WHEN ae.outcome::text='held_by_lane' THEN 'held'
        WHEN ae.outcome::text LIKE 'refused_%' THEN 'refused' WHEN ae.outcome::text='condition_not_matched' THEN 'skipped'
        WHEN ae.outcome::text IN ('accepted_for_execution','retrying') AND public.weekly_commitment_claim_live(ae.detail) THEN 'running'
        WHEN ae.detail ? 'dispatch_claim' THEN 'unknown' ELSE 'scheduled' END,
      'observation',ae.detail->'weekly_commitment_observation','error',ae.error,'refusal_code',ae.refusal_code,'settled_at',ae.settled_at) END
    ) ORDER BY a.updated_at DESC,a.id DESC),'[]'::jsonb) INTO _result
  FROM (SELECT * FROM public.paige_automations WHERE tenant_id=_tid AND created_by=_uid
    AND trigger_key='schedule.weekly_commitment_check' ORDER BY updated_at DESC,id DESC LIMIT 50) a
  CROSS JOIN LATERAL(SELECT public.resolve_automation_autonomy(a.id) AS value,
    public.resolve_tool_autonomy(a.tenant_id,'planning_weekly_commitment_check') AS tool_lane) posture
  LEFT JOIN LATERAL(SELECT * FROM public.paige_native_events e WHERE e.subject_table='paige_automations'
    AND e.subject_id=a.id AND e.tenant_id=_tid AND e.event_key='schedule.weekly_commitment_check'
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) ev ON true
  LEFT JOIN LATERAL(SELECT * FROM public.paige_act_executions x WHERE x.event_id=ev.id AND x.automation_id=a.id
    AND x.tenant_id=_tid AND x.capability_key='planning.weekly_commitment_check' ORDER BY x.act_position LIMIT 1) ae ON true
  LEFT JOIN LATERAL(SELECT e.id AS event_id,x.act_id,x.correlation_ref,e.occurred_at AS scheduled_for,
    x.detail->'weekly_commitment_observation' AS observation,x.settled_at
    FROM public.paige_native_events e JOIN public.paige_act_executions x ON x.event_id=e.id
    WHERE e.subject_table='paige_automations' AND e.subject_id=a.id AND e.tenant_id=_tid
      AND e.event_key='schedule.weekly_commitment_check' AND x.automation_id=a.id AND x.tenant_id=_tid
      AND x.capability_key='planning.weekly_commitment_check' AND x.adapter_kind='native' AND x.outcome::text='executed'
      AND x.detail#>>'{weekly_commitment_observation,correlation_ref}'=x.correlation_ref
      AND x.detail#>>'{weekly_commitment_observation,tenant_id}'=_tid::text
      AND x.detail#>>'{weekly_commitment_observation,authorized_by}'=_uid::text
      AND x.detail#>>'{weekly_commitment_observation,automation_id}'=a.id::text
      AND x.detail#>>'{weekly_commitment_observation,event_id}'=e.id::text
      AND x.detail#>>'{weekly_commitment_observation,act_id}'=x.act_id::text
      AND EXISTS(SELECT 1 FROM public.paige_workspace_events r WHERE r.tenant_id=_tid
        AND r.source_kind='capability_run' AND r.source_id::text=x.detail#>>'{weekly_commitment_observation,receipt_id}'
        AND r.capability_key='planning_weekly_commitment_check' AND r.outcome='capability_succeeded'
        AND r.detail->>'event_id'=e.id::text AND r.detail->>'act_id'=x.act_id::text)
    ORDER BY e.occurred_at DESC,e.id DESC,x.act_position LIMIT 1) verified ON true;
  RETURN jsonb_build_object('ok',true,'tenant_id',_tid,'actor_id',_uid,'read_at',_read_at,'limit',50,'has_more',_more,
    'business_time_zone',jsonb_build_object('state',_zone_state,'zone',CASE WHEN _zone_state='configured' THEN _zone ELSE NULL END),
    'checks',_result,'scope','personal_planning_commitments');
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_commitment_checks() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_commitment_checks() TO authenticated;
COMMENT ON FUNCTION public.get_weekly_commitment_checks() IS
 'Owner-only canonical process status, latest attempt and separately receipt-verified historical result, observed read time and bounded-list coverage; read-only Chat/Calendar preparation, not admission or execution authority.';
