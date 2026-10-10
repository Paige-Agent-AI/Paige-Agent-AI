-- INT-280: bounded Operator metadata over the EXISTING evaluation store.
-- No raw input, expected output, rubric, rationale, target_ref, actor or tenant ID.
-- No evaluator execution, training, provider spend or promotion.
CREATE OR REPLACE FUNCTION public.operator_intelligence_eval_history(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Canonical audited fleet read. Failure refuses the read: visibility must be attributable.
  INSERT INTO public.paige_audit_log (tenant_id, actor_user_id, actor_role, action, target_type, payload)
  VALUES (NULL, auth.uid(), 'operator', 'god_view.fleet_query', 'intelligence_eval_history',
          jsonb_build_object('limit', v_limit));

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT run.id, run.dataset_id, run.target_kind, run.target_version, run.status,
           run.scorer_set, run.case_count, run.scored_count, run.degraded_count,
           run.aggregate_score, run.pass_rate, run.prev_run_id, run.created_at, run.completed_at,
           dataset.status AS dataset_status,
           (SELECT count(*) FROM public.paige_eval_result result WHERE result.run_id = run.id) AS result_count,
           (SELECT COALESCE(jsonb_agg(to_jsonb(sample) ORDER BY sample.id), '[]'::jsonb)
            FROM (
              SELECT result.id, result.case_id, result.source_trace_id, result.scorer, result.scorer_kind,
                     result.score, result.passed, result.status, result.judge_model, result.cost_estimate_usd
              FROM public.paige_eval_result result WHERE result.run_id = run.id
              ORDER BY result.id LIMIT 100
            ) sample) AS results
    FROM public.paige_eval_run run
    LEFT JOIN public.paige_eval_dataset dataset ON dataset.id = run.dataset_id
    ORDER BY run.created_at DESC, run.id DESC LIMIT v_limit
  ) r;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.operator_intelligence_eval_history(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_intelligence_eval_history(integer) TO authenticated;
COMMENT ON FUNCTION public.operator_intelligence_eval_history(integer) IS
  'INT-280 Operator-only audited evaluation metadata; maximum 100 runs and 100 results per run; no customer content or evaluator execution.';
