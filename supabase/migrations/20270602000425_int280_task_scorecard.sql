-- INT-280 AI-2C: bounded audited metadata projection; canonical Evals remain authoritative.
CREATE OR REPLACE FUNCTION public.operator_intelligence_task_scorecard(
  p_set_version text DEFAULT '1.1.0',p_limit integer DEFAULT 25,
  p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,
  p_run_id uuid DEFAULT NULL,p_work_id uuid DEFAULT NULL,p_subject_tenant uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE definition public.paige_eval_evaluator_set%rowtype; lim integer;
  items jsonb; versions jsonb; criteria jsonb; totals jsonb; cursor jsonb;
  subject_ref uuid; source_tenant uuid; observed timestamptz:=clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL OR public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE='42501'; END IF;
  lim:=LEAST(25,GREATEST(1,COALESCE(p_limit,25)));
  IF (p_before_at IS NULL)<>(p_before_id IS NULL) OR (p_run_id IS NOT NULL AND p_work_id IS NOT NULL)
    OR ((p_run_id IS NOT NULL OR p_work_id IS NOT NULL) AND p_before_id IS NOT NULL)
    OR (p_subject_tenant IS NOT NULL AND p_run_id IS NULL AND p_work_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_scorecard_selection' USING ERRCODE='22023'; END IF;
  SELECT * INTO definition FROM public.paige_eval_evaluator_set WHERE id='durable-task-evidence' AND version=p_set_version;
  IF NOT FOUND OR definition.definition_hash IS DISTINCT FROM (CASE p_set_version
    WHEN '1.0.0' THEN '544cbea0003813658b179144833d1863c1150ad01694cccbefb6cee3ac61b05c'
    WHEN '1.1.0' THEN '2e2615068b05d5b664588257eb67da4e520b1a63c5cfa7f2f7cfc0a70dac7cae' END) THEN
    RAISE EXCEPTION 'unsupported_evaluator_set' USING ERRCODE='22023'; END IF;
  IF p_run_id IS NOT NULL THEN
    SELECT task_subject_ref INTO subject_ref FROM public.paige_eval_run
      WHERE id=p_run_id AND evaluator_set_id=definition.id AND evaluator_set_version=definition.version;
    IF NOT FOUND THEN RAISE EXCEPTION 'task_evidence_unavailable' USING ERRCODE='22023'; END IF;
  ELSE subject_ref:=p_work_id; END IF;
  IF subject_ref IS NOT NULL AND (p_subject_tenant IS NOT NULL OR p_work_id IS NOT NULL) THEN
    SELECT tenant_id INTO source_tenant FROM public.paige_durable_work WHERE id=subject_ref;
    IF NOT FOUND OR (p_subject_tenant IS NOT NULL AND source_tenant IS DISTINCT FROM p_subject_tenant) THEN
      RAISE EXCEPTION 'task_evidence_unavailable' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,payload)
    VALUES(NULL,auth.uid(),'operator','god_view.fleet_query','intelligence_task_scorecard',
      jsonb_build_object('set_version',p_set_version,'limit',lim,'run_ref',p_run_id,'work_ref',p_work_id,'filtered_scope',p_subject_tenant IS NOT NULL));
  WITH page AS MATERIALIZED (
    SELECT r.* FROM public.paige_eval_run r
    WHERE r.evaluator_set_id=definition.id AND r.evaluator_set_version=definition.version
      AND (p_run_id IS NULL OR r.id=p_run_id) AND (p_work_id IS NULL OR r.task_subject_ref=p_work_id)
      AND (p_before_id IS NULL OR (r.created_at,r.id)<(p_before_at,p_before_id))
    ORDER BY r.created_at DESC,r.id DESC LIMIT lim+1
  ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT lim), projected AS (
    SELECT r.created_at,r.id,jsonb_build_object('run_ref',r.id,'work_ref',r.task_subject_ref,
      'source_available',EXISTS(SELECT 1 FROM public.paige_durable_work w WHERE w.id=r.task_subject_ref),
      'mode',r.observation_kind,'created_at',r.created_at,'source_observed_at',r.source_observed_at,
      'input_hash',r.evidence_hash,'previous_run_ref',r.prev_run_id,
      'work_version',r.evidence_snapshot->'work_version','attempt',r.evidence_snapshot->'attempt',
      'category',r.evidence_snapshot->>'category','capability',r.evidence_snapshot->>'capability_key',
      'recorded_state',r.evidence_snapshot->>'work_state','terminal_condition',r.evidence_snapshot->>'terminal_condition',
      'terminal_verified_at_observation',r.evidence_snapshot->'terminal_verified',
      'participants',COALESCE(r.evidence_snapshot->'agent_attribution','[]'::jsonb),
      'unassigned_model_calls',r.evidence_snapshot->'unassigned_model_calls',
      'results',COALESCE((SELECT jsonb_agg(jsonb_build_object('result_ref',v.id,'scorer',v.scorer,
        'version',v.evaluator_version,'verdict',v.task_verdict,'evidence',v.evidence_state,'reason',v.rationale) ORDER BY v.scorer)
        FROM public.paige_eval_result v WHERE v.run_id=r.id AND v.task_verdict IS NOT NULL),'[]'::jsonb)) AS item FROM visible r
  ) SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC,id DESC),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>lim THEN (SELECT jsonb_build_object('at',created_at,'id',id)
      FROM visible ORDER BY created_at,id LIMIT 1) END INTO items,cursor FROM projected;
  -- Four-state denominators cover only this bounded returned evaluation sample.
  SELECT jsonb_build_object('evaluations',jsonb_array_length(items),'task_subjects',count(DISTINCT i->>'work_ref'),
    'observations',count(*) FILTER(WHERE i->>'mode'='observation'),'replays',count(*) FILTER(WHERE i->>'mode'='replay'))
    INTO totals FROM jsonb_array_elements(items) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('scorer',scorer,'version',version,'total',total,'pass',passed,
      'fail',failed,'indeterminate',unknown,'not_applicable',excluded,'resolved',passed+failed,
      'coverage_denominator',total-excluded,'coverage',(passed+failed)::numeric/NULLIF(total-excluded,0),
      'criterion_pass_rate',passed::numeric/NULLIF(passed+failed,0)) ORDER BY scorer),'[]'::jsonb) INTO criteria
  FROM (SELECT v->>'scorer' scorer,v->>'version' version,count(*) total,
    count(*) FILTER(WHERE v->>'verdict'='pass') passed,count(*) FILTER(WHERE v->>'verdict'='fail') failed,
    count(*) FILTER(WHERE v->>'verdict'='indeterminate') unknown,count(*) FILTER(WHERE v->>'verdict'='not_applicable') excluded
    FROM jsonb_array_elements(items) i CROSS JOIN LATERAL jsonb_array_elements(i->'results') v GROUP BY 1,2) grouped;
  SELECT jsonb_agg(jsonb_build_object('id',id,'version',version,'hash',definition_hash) ORDER BY version)
    INTO versions FROM public.paige_eval_evaluator_set WHERE id=definition.id AND version IN('1.0.0','1.1.0');
  RETURN jsonb_build_object('contract_version',1,'observed_at',observed,'set',jsonb_build_object('id',definition.id,
    'version',definition.version,'hash',definition.definition_hash,'evaluators',definition.manifest::jsonb->'evaluators'),
    'versions',versions,'items',items,'next_cursor',cursor,'sample',totals,'criteria',criteria,
    'coverage_basis','returned_evaluations_including_explicit_historical_replays',
    'attribution_basis','recorded_model_participants_not_task_ownership','source_consistency','bounded_double_read_not_atomic');
END $$;
REVOKE ALL ON FUNCTION public.operator_intelligence_task_scorecard(text,integer,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_intelligence_task_scorecard(text,integer,timestamptz,uuid,uuid,uuid,uuid) TO authenticated;
