-- EXP05: classify work deadlines separately from reminder times.
-- Fresh observations use version 2; committed historical observations and receipts are never rewritten.
-- Source-only correction: no trigger, autonomy, scheduling, authority or activation change.

CREATE OR REPLACE FUNCTION public.execute_weekly_commitment_check(
  _automation_id uuid,_event_id uuid,_act_id uuid,_correlation text,_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _a public.paige_automations; _ev public.paige_native_events; _row public.paige_act_executions;
  _posture jsonb; _obs jsonb; _at timestamptz:=clock_timestamp(); _due timestamptz; _minimal jsonb; _error text;
  _started_before_control boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_SERVICE_ONLY' USING ERRCODE='42501'; END IF;
  -- Same order as human controls, publisher and recovery: process first, act second.
  SELECT * INTO _a FROM public.paige_automations WHERE id=_automation_id FOR UPDATE;
  SELECT * INTO _row FROM public.paige_act_executions WHERE event_id=_event_id AND act_id=_act_id FOR UPDATE;
  SELECT * INTO _ev FROM public.paige_native_events WHERE id=_event_id;
  IF _a.id IS NULL OR _row.id IS NULL OR _ev.id IS NULL OR _receipt_id IS NULL OR nullif(_correlation,'') IS NULL
    OR _row.automation_id<>_a.id OR _row.tenant_id<>_a.tenant_id OR _ev.tenant_id<>_a.tenant_id
    OR _a.trigger_key<>'schedule.weekly_commitment_check' OR _ev.event_key<>'schedule.weekly_commitment_check'
    OR _ev.subject_table<>'paige_automations' OR _ev.subject_id<>_a.id
    OR _row.capability_key IS DISTINCT FROM 'planning.weekly_commitment_check'
    OR _row.adapter_kind<>'native' OR _row.correlation_ref IS DISTINCT FROM _correlation
    OR NOT EXISTS(SELECT 1 FROM public.paige_automation_acts ac WHERE ac.id=_act_id AND ac.automation_id=_a.id
      AND ac.action_kind='planning.weekly_commitment_check' AND ac.tool_key IS NULL AND ac.position=1 AND ac.config='{}'::jsonb) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_binding_refused');
  END IF;
  _obs:=_row.detail->'weekly_commitment_observation';
  IF _obs IS NOT NULL THEN
    IF _obs->>'correlation_ref'=_correlation AND _obs->>'event_id'=_event_id::text AND _obs->>'act_id'=_act_id::text
       AND _obs->>'receipt_id' IS NOT NULL AND _row.outcome::text='executed' AND EXISTS(
         SELECT 1 FROM public.paige_workspace_events r WHERE r.tenant_id=_row.tenant_id
           AND r.source_kind='capability_run' AND r.source_id::text=_obs->>'receipt_id'
           AND r.capability_key='planning_weekly_commitment_check' AND r.outcome='capability_succeeded'
           AND r.detail->>'event_id'=_event_id::text AND r.detail->>'act_id'=_act_id::text) THEN
      RETURN jsonb_build_object('outcome','executed','receipt_id',_obs->'receipt_id','detail',jsonb_build_object(
        'confirmed_via','weekly_commitment_observation','receipt_id',_obs->'receipt_id','automation_id',_a.id,
        'event_id',_event_id,'act_id',_act_id),'error',NULL);
    END IF;
    RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',false),'error','weekly_check_observation_mismatch');
  END IF;
  IF _row.outcome::text='ambiguous' THEN
    RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',false),'error','weekly_check_requires_reconciliation');
  END IF;
  IF _row.outcome::text NOT IN ('accepted_for_execution','retrying') OR NOT public.weekly_commitment_claim_live(_row.detail) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_dispatch_claim_required');
  END IF;
  _due:=(_ev.payload->>'scheduled_for')::timestamptz;
  _started_before_control:=_ev.payload->>'future_control_at' IS NOT NULL
    AND (_row.detail->>'dispatch_claimed_at')::timestamptz<(_ev.payload->>'future_control_at')::timestamptz;
  IF _ev.payload->>'automation_id' IS DISTINCT FROM _a.id::text
    OR _ev.payload->>'schedule_revision' IS DISTINCT FROM _ev.payload->>'authorized_revision'
    OR _ev.payload->>'authorized_by' IS DISTINCT FROM _a.created_by::text
    OR _ev.payload->>'scope' IS DISTINCT FROM 'personal_planning_commitments'
    OR _due IS NULL OR _due>(_at+interval '1 minute')
    OR _ev.payload->>'authorized_at' IS NULL OR _due<(_ev.payload->>'authorized_at')::timestamptz
    OR (NOT _started_before_control AND (
      _ev.payload->>'schedule_revision' IS DISTINCT FROM _a.trigger_config->>'revision'
      OR _a.trigger_config->>'authorized_revision' IS DISTINCT FROM _a.trigger_config->>'revision'
      OR _a.trigger_config->>'authorized_by' IS DISTINCT FROM _a.created_by::text
      OR _due<(_a.trigger_config->>'authorized_at')::timestamptz
      OR _a.state<>'live' OR _a.granted_lane<>'auto' OR _a.trigger_config->>'cancelled_at' IS NOT NULL))
    OR NOT public.weekly_commitment_owner(_a.tenant_id,_a.created_by)
    OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_a.tenant_id AND t.archived_at IS NULL
      AND NOT coalesce(t.lifecycle_execution_paused,false)) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_authority_changed');
  END IF;
  _posture:=public.resolve_automation_autonomy(_a.id);
  IF NOT EXISTS(SELECT 1 FROM public.paige_automation_triggers tr WHERE tr.key=_a.trigger_key AND tr.is_live)
     OR _row.effective_lane IS DISTINCT FROM 'auto' OR _posture->>'ceiling' IS DISTINCT FROM 'auto'
     OR public.resolve_tool_autonomy(_a.tenant_id,'planning_weekly_commitment_check') IS DISTINCT FROM 'auto'
     OR (_posture->>'effective' IS DISTINCT FROM 'auto' AND NOT _started_before_control) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_effective_authority_refused');
  END IF;
  -- Work deadlines and reminder times have different meanings. Keep one native observation.
  WITH eligible AS MATERIALIZED (
    SELECT pi.id,pi.item_type,pi.title,pi.status,pi.priority,
      CASE WHEN pi.item_type<>'reminder' THEN pi.due_at END AS due_at,pi.remind_at,
      CASE WHEN pi.item_type='reminder' THEN pi.remind_at ELSE pi.due_at END AS source_time
      FROM public.plan_items pi WHERE pi.tenant_id=_a.tenant_id
        AND pi.status IN ('open','in_progress','blocked')
        AND (pi.assigned_to_user_id=_a.created_by OR pi.created_by=_a.created_by)
  ), bounded AS (
    SELECT * FROM eligible ORDER BY source_time NULLS LAST,id LIMIT 50
  )
  SELECT jsonb_build_object('version',2,'scope','personal_planning_commitments','tenant_id',_a.tenant_id,
    'authorized_by',_a.created_by,'automation_id',_a.id,'event_id',_event_id,'act_id',_act_id,
    'schedule_revision',(_ev.payload->>'schedule_revision')::integer,'scheduled_for',_due,'observed_at',_at,
    'correlation_ref',_correlation,'receipt_id',_receipt_id,'source','public.plan_items',
    'open_count',(SELECT count(*) FROM eligible),
    'blocked_count',(SELECT count(*) FROM eligible WHERE status='blocked'),
    'overdue_count',(SELECT count(*) FROM eligible WHERE item_type<>'reminder' AND due_at<_at),
    'due_next_week_count',(SELECT count(*) FROM eligible WHERE item_type<>'reminder' AND due_at>=_at AND due_at<_at+interval '7 days'),
    'undated_count',(SELECT count(*) FROM eligible WHERE item_type<>'reminder' AND due_at IS NULL),
    'truncated',(SELECT count(*)>50 FROM eligible),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'kind',item_type,'title',left(title,160),
      'status',status,'priority',priority,'due_at',due_at,'remind_at',remind_at)
      ORDER BY source_time NULLS LAST,id) FROM bounded),'[]'::jsonb)) INTO _obs;
  _row:=public.paige_record_act_execution(_row.event_id,_row.automation_id,_row.act_id,_row.act_position,_row.tenant_id,
    _row.adapter_kind,_row.capability_key,_row.effective_lane,'executed'::public.paige_act_outcome,NULL,
    _row.idempotency_key,_row.correlation_ref,NULL,jsonb_build_object('weekly_commitment_observation',_obs),NULL,_at,_at);
  IF _row.outcome::text<>'executed' OR _row.detail->'weekly_commitment_observation' IS DISTINCT FROM _obs THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_EVIDENCE_NOT_RECORDED' USING ERRCODE='40001'; END IF;
  -- Literal allowlist of references only; private titles, counts and source contents never enter shared Rail.
  _minimal:=jsonb_build_object('confirmed_via','weekly_commitment_observation','receipt_id',_receipt_id,
    'automation_id',_a.id,'event_id',_event_id,'act_id',_act_id,'observed_at',_at);
  PERFORM public.record_capability_run(_a.tenant_id,_a.created_by,'planning_weekly_commitment_check',
    'capability_succeeded',_receipt_id,NULL,NULL,NULL,NULL,_minimal);
  -- Observation + terminal outcome + receipt commit together. A lost HTTP response is reconciled by this same row.
  RETURN jsonb_build_object('outcome','executed','receipt_id',_receipt_id,'detail',_minimal,'error',NULL);
END $$;
REVOKE ALL ON FUNCTION public.execute_weekly_commitment_check(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_weekly_commitment_check(uuid,uuid,uuid,text,uuid) TO service_role;
