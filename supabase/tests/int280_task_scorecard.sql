-- Controlled canonical synthetic records from the AI-1/AI-2 runner proof only.
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
DO $$ DECLARE p jsonb; q jsonb; v jsonb; r uuid; resolved integer; total integer; BEGIN
  p:=public.operator_intelligence_task_scorecard();
  IF p->>'contract_version'<>'1' OR p->'set'->>'version'<>'1.1.0' OR jsonb_array_length(p->'set'->'evaluators')<>4
    OR jsonb_array_length(p->'versions')<>2 THEN RAISE EXCEPTION 'registry identity incomplete'; END IF;
  IF p::text LIKE '%PRIVATE%' OR p ? 'evidence_snapshot' OR p::text LIKE '%draft_content%' OR p::text LIKE '%input_excerpt%' THEN
    RAISE EXCEPTION 'raw content leaked'; END IF;
  IF jsonb_array_length(p->'items')=0 OR p->>'attribution_basis'<>'recorded_model_participants_not_task_ownership' THEN RAISE EXCEPTION 'scorecard evidence absent'; END IF;
  -- Raw platform results remain hidden even from an ordinary authenticated Operator role.
  IF EXISTS(SELECT 1 FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL) THEN RAISE EXCEPTION 'raw platform run readable'; END IF;
  p:=public.operator_intelligence_task_scorecard(p_set_version=>'1.0.0');
  IF jsonb_array_length(p->'set'->'evaluators')<>3 THEN RAISE EXCEPTION 'versions mixed'; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p->'criteria') LOOP
    SELECT count(*),count(*) FILTER(WHERE c->>'verdict' IN('pass','fail')) INTO total,resolved
      FROM jsonb_array_elements(p->'items') i CROSS JOIN LATERAL jsonb_array_elements(i->'results') c WHERE c->>'scorer'=v->>'scorer';
    IF total<>(v->>'total')::integer OR resolved<>(v->>'resolved')::integer THEN RAISE EXCEPTION 'denominator mismatch'; END IF;
    IF v->>'scorer'='approval_decision' AND (v->>'criterion_pass_rate' IS NOT NULL OR resolved<>0 OR total<>(v->>'indeterminate')::integer) THEN RAISE EXCEPTION 'unknown approvals passed'; END IF;
  END LOOP;
  p:=public.operator_intelligence_task_scorecard(p_set_version=>'1.0.0',p_limit=>1);
  IF jsonb_array_length(p->'items')<>1 OR p->'next_cursor'='null'::jsonb THEN RAISE EXCEPTION 'cursor absent'; END IF;
  q:=public.operator_intelligence_task_scorecard(p_set_version=>'1.0.0',p_limit=>1,p_before_at=>(p->'next_cursor'->>'at')::timestamptz,p_before_id=>(p->'next_cursor'->>'id')::uuid);
  IF p->'items'->0->>'run_ref'=q->'items'->0->>'run_ref' THEN RAISE EXCEPTION 'page repeats'; END IF;
  r:=(p->'items'->0->>'run_ref')::uuid;
  q:=public.operator_intelligence_task_scorecard(p_set_version=>'1.0.0',p_run_id=>r);
  IF jsonb_array_length(q->'items')<>1 OR q->'items'->0->>'input_hash' IS NULL OR q->'items'->0->'results'->0->>'result_ref' IS NULL THEN RAISE EXCEPTION 'protected provenance missing'; END IF;
  BEGIN PERFORM public.operator_intelligence_task_scorecard(p_set_version=>'latest');RAISE EXCEPTION 'latest alias allowed';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN PERFORM public.operator_intelligence_task_scorecard(p_before_id=>gen_random_uuid());RAISE EXCEPTION 'half cursor allowed';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN PERFORM public.operator_intelligence_task_scorecard(p_set_version=>'1.0.0',p_run_id=>r,p_subject_tenant=>'10000000-0000-4000-8000-000000000002');RAISE EXCEPTION 'wrong subject tenant allowed';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN PERFORM public.operator_intelligence_task_scorecard(p_subject_tenant=>'10000000-0000-4000-8000-000000000002');RAISE EXCEPTION 'unscoped tenant filter allowed';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  p:=public.operator_intelligence_task_scorecard(p_limit=>1000000);
  IF jsonb_array_length(p->'items')>25 THEN RAISE EXCEPTION 'limit unbounded'; END IF;
END $$;
RESET ROLE;
-- Removed canonical source leaves immutable history inspectable, without a live task link.
DO $$ DECLARE r uuid; p jsonb; BEGIN
  SELECT id INTO r FROM public.paige_eval_run WHERE evaluator_set_version='1.0.0' AND NOT EXISTS(SELECT 1 FROM public.paige_durable_work WHERE id=task_subject_ref) LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'missing-source fixture absent'; END IF;
  p:=public.operator_intelligence_task_scorecard(p_set_version=>'1.0.0',p_run_id=>r);
  IF p->'items'->0->'source_available'<>'false'::jsonb THEN RAISE EXCEPTION 'removed source claimed available'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_task_scorecard();RAISE EXCEPTION 'Solo scorecard allowed';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END; END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_task_scorecard();RAISE EXCEPTION 'anon scorecard allowed';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END; END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_task_scorecard();RAISE EXCEPTION 'service scorecard allowed';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_task_scorecard();RAISE EXCEPTION 'null actor allowed';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END; END $$;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
CREATE TRIGGER int280_fixture_audit_refusal BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.int280_fixture_audit_refusal();
DO $$ BEGIN
  BEGIN PERFORM public.operator_intelligence_task_scorecard();RAISE EXCEPTION 'unaudited scorecard allowed';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic audit failure' THEN RAISE;END IF;END;
END $$;
DROP TRIGGER int280_fixture_audit_refusal ON public.paige_audit_log;
SELECT 'PASS: protected bounded task scorecard, versions, denominators, provenance, privacy, source removal, actual roles and audit refusal';
