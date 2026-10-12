-- Local/CI synthetic proof only, run after the canonical AI-1/AI-2 fixture.
DO $$ DECLARE p jsonb; c uuid; d uuid; r uuid; n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  p:=public.operator_intelligence_regression_corpus();
  IF p->>'contract_version' IS DISTINCT FROM '1' OR jsonb_array_length(p->'items')<>1 THEN
    RAISE EXCEPTION 'protected reviewed corpus missing'; END IF;
  c:=(p->'items'->0->>'case_ref')::uuid;
  SELECT dataset_id INTO d FROM public.paige_eval_case WHERE id=c;
  IF p->'items'->0->'definition'->>'case_key' IS DISTINCT FROM 'credit-sync-audit-reference'
    OR p->'items'->0->>'case_hash' IS DISTINCT FROM 'b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606'
    OR p->'items'->0->'definition'->'trajectory'->>'state' IS DISTINCT FROM 'unlinked'
    OR jsonb_array_length(p->'items'->0->'history')<>3 THEN RAISE EXCEPTION 'immutable identity or lifecycle lost'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p->'items'->0->'history') h WHERE h->>'verdict'='fail')<>2
    OR (SELECT count(*) FROM jsonb_array_elements(p->'items'->0->'history') h WHERE h->>'verdict'='pass')<>1
    OR p->'items'->0->'latest_corrected_result'->>'verdict' IS DISTINCT FROM 'pass' THEN
    RAISE EXCEPTION 'faulty/corrected/reintroduced states dishonest'; END IF;
  IF p::text ~ '(synthetic-user-jwt|scores|equifax|PRIVATE|tenant_id|actor_user_id|input_excerpt|output_excerpt|raw_conversation)'
    OR p->'items'->0->>'authenticated_acceptance' IS DISTINCT FROM 'UNVERIFIED' THEN RAISE EXCEPTION 'privacy or acceptance claim'; END IF;
  IF (SELECT count(*) FROM public.paige_audit_log WHERE target_type='intelligence_regression_corpus')<>1 THEN
    RAISE EXCEPTION 'audited read missing'; END IF;
  p:=public.operator_intelligence_regression_corpus(p_case_id=>c);
  IF jsonb_array_length(p->'items')<>1 THEN RAISE EXCEPTION 'case inspection missing'; END IF;
  p:=public.operator_intelligence_regression_corpus(p_limit=>10000);
  IF p->>'limit' IS DISTINCT FROM '25' THEN RAISE EXCEPTION 'unbounded projection'; END IF;
  BEGIN PERFORM public.operator_intelligence_regression_corpus(p_before_id=>c); RAISE EXCEPTION 'unpaired cursor allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.operator_intelligence_regression_corpus(p_before_id=>c,p_before_at=>now(),p_case_id=>c); RAISE EXCEPTION 'ambiguous selection allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.operator_intelligence_regression_corpus(p_case_id=>gen_random_uuid()); RAISE EXCEPTION 'unknown/foreign case accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- Ordinary tenant-owned Eval records are never joined into this platform corpus.
  INSERT INTO public.paige_eval_case(id,tenant_id,input,metadata) VALUES(gen_random_uuid(),'10000000-0000-4000-8000-000000000002','{}','{"private":"PRIVATE"}');
  p:=public.operator_intelligence_regression_corpus();
  IF jsonb_array_length(p->'items')<>1 OR p::text LIKE '%PRIVATE%' THEN RAISE EXCEPTION 'foreign legacy record correlated'; END IF;
  BEGIN UPDATE public.paige_eval_case SET regression_manifest=NULL,regression_case_hash=NULL,regression_key=NULL,regression_version=NULL WHERE id=c;
    RAISE EXCEPTION 'case clearing escaped protection'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM public.paige_eval_case WHERE id=c; RAISE EXCEPTION 'permanent case deleted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE public.paige_eval_dataset SET regression_corpus_version=NULL WHERE id=d; RAISE EXCEPTION 'dataset clearing escaped protection'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM public.paige_eval_dataset WHERE id=d; RAISE EXCEPTION 'dataset cascade erased corpus'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  SELECT id INTO r FROM public.paige_eval_run WHERE regression_case_id=c LIMIT 1;
  BEGIN UPDATE public.paige_eval_run SET regression_case_id=NULL,dataset_id=NULL WHERE id=r; RAISE EXCEPTION 'run clearing escaped protection'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE public.paige_eval_result SET task_verdict=NULL,evaluator_version=NULL,evidence_state=NULL,case_id=NULL WHERE run_id=r; RAISE EXCEPTION 'result clearing escaped protection'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM public.paige_eval_run WHERE id=r; RAISE EXCEPTION 'result cascade erased history'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN TRUNCATE public.paige_eval_case CASCADE; RAISE EXCEPTION 'bulk corpus erasure allowed'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE public.paige_eval_evaluator_set SET manifest=manifest WHERE id='offline-write-integrity'; RAISE EXCEPTION 'definition changed'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  -- The actual task reader must continue to exclude offline regressions and preserve four verdicts.
  p:=public.operator_intelligence_task_scorecard();
  IF p::text LIKE '%credit-sync-audit-reference%' THEN RAISE EXCEPTION 'offline cases contaminated task scorecard'; END IF;
END $$;

-- Negative publication and truthful degraded/missing results: controlled local records only.
DO $$ DECLARE c uuid; base public.paige_eval_run; x public.paige_eval_run; z public.paige_eval_result;
  p jsonb; state text; bad jsonb; history jsonb; seen boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  SELECT id INTO c FROM public.paige_eval_case WHERE regression_key='credit-sync-audit-reference';
  SELECT * INTO base FROM public.paige_eval_run WHERE regression_case_id=c AND evidence_snapshot->>'mode'='current';
  FOREACH state IN ARRAY ARRAY['missing','stale','partial','conflicting','unrelated','unavailable'] LOOP
    x:=base; x.id:=gen_random_uuid();
    x.evidence_snapshot:=jsonb_set(base.evidence_snapshot,'{evidence_state}',to_jsonb(state));
    x.evidence_hash:=encode(pg_catalog.sha256(convert_to(x.evidence_snapshot::text,'UTF8')),'hex');
    BEGIN INSERT INTO public.paige_eval_run SELECT (x).*; RAISE EXCEPTION 'incomplete evidence passed: %',state;
      EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  -- Null/unknown facts, unreviewed scope, private payloads and provider effects fail closed.
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_set(base.evidence_snapshot,'{output,audit_recorded}','null'),
    base.evidence_snapshot-'fixture_hash',
    base.evidence_snapshot||'{"raw_prompt":"PRIVATE"}'::jsonb,
    jsonb_set(base.evidence_snapshot,'{provider_calls}','1'),
    jsonb_set(base.evidence_snapshot,'{source_hash}',to_jsonb(repeat('0',64))),
    jsonb_set(base.evidence_snapshot,'{production_task_identity}',to_jsonb(gen_random_uuid()::text)),
    jsonb_set(base.evidence_snapshot,'{applicability}','"unknown"'),
    jsonb_set(base.evidence_snapshot,'{representative_score_write_observed}','false'))) LOOP
    x:=base;x.id:=gen_random_uuid();x.evidence_snapshot:=bad;
    x.evidence_hash:=encode(pg_catalog.sha256(convert_to(bad::text,'UTF8')),'hex');
    BEGIN INSERT INTO public.paige_eval_run SELECT (x).*; RAISE EXCEPTION 'invalid publication accepted';
      EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  -- A valid run alone never creates a passed result in the projection.
  x:=base;x.id:=gen_random_uuid();INSERT INTO public.paige_eval_run SELECT (x).*;
  p:=public.operator_intelligence_regression_corpus(p_case_id=>c);
  SELECT h INTO history FROM jsonb_array_elements(p->'items'->0->'history') h WHERE h->>'run_ref'=x.id::text;
  IF history->>'verdict' IS DISTINCT FROM 'indeterminate' OR history->>'evidence_state' IS DISTINCT FROM 'missing'
    OR history->'result_ref' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'missing result manufactured pass'; END IF;
  -- Store an explicitly degraded existing scorer result, never a numeric pass.
  x:=base;x.id:=gen_random_uuid();x.scored_count:=0;x.degraded_count:=1;x.aggregate_score:=NULL;x.pass_rate:=NULL;
  x.evidence_snapshot:=base.evidence_snapshot||'{"verdict":"indeterminate","evidence_state":"partial","score":null,"passed":null,"status":"needs_config"}'::jsonb;
  x.evidence_hash:=encode(pg_catalog.sha256(convert_to(x.evidence_snapshot::text,'UTF8')),'hex');
  INSERT INTO public.paige_eval_run SELECT (x).*;
  SELECT * INTO z FROM public.paige_eval_result WHERE run_id=base.id;
  z.id:=gen_random_uuid();z.run_id:=x.id;z.task_verdict:='indeterminate';z.evidence_state:='partial';z.score:=NULL;z.passed:=NULL;z.status:='needs_config';
  INSERT INTO public.paige_eval_result SELECT (z).*;
  p:=public.operator_intelligence_regression_corpus(p_case_id=>c);
  SELECT h INTO history FROM jsonb_array_elements(p->'items'->0->'history') h WHERE h->>'run_ref'=x.id::text;
  IF history->>'verdict' IS DISTINCT FROM 'indeterminate' OR history->>'evidence_state' IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'degraded evidence lost'; END IF;
  -- Safe history limit is explicit. More incomplete runs never manufacture additional passes.
  FOR n IN 1..26 LOOP x.id:=gen_random_uuid();INSERT INTO public.paige_eval_run SELECT (x).*; END LOOP;
  p:=public.operator_intelligence_regression_corpus(p_case_id=>c);
  IF p->'items'->0->'history_limit_reached' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_array_length(p->'items'->0->'history')<>25 THEN RAISE EXCEPTION 'history limit hidden'; END IF;
END $$;

SET ROLE authenticated;
DO $$ DECLARE p jsonb; n integer; BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claim.tenant_id','10000000-0000-4000-8000-000000000001',true);
  BEGIN p:=public.operator_intelligence_regression_corpus(); RAISE EXCEPTION 'Solo read allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  SELECT count(*) INTO n FROM public.paige_eval_case WHERE regression_manifest IS NOT NULL;
  IF n<>0 THEN RAISE EXCEPTION 'platform case directly tenant-visible'; END IF;
  SELECT count(*) INTO n FROM public.paige_eval_run WHERE regression_case_id IS NOT NULL;
  IF n<>0 THEN RAISE EXCEPTION 'platform run directly tenant-visible'; END IF;
  PERFORM set_config('request.jwt.claim.tenant_id','10000000-0000-4000-8000-000000000002',true);
  BEGIN p:=public.operator_intelligence_regression_corpus(); RAISE EXCEPTION 'wrong-tenant claims allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN p:=public.operator_intelligence_regression_corpus(); RAISE EXCEPTION 'missing actor allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  -- Real database role, not only an auth helper returning a simulated refusal.
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  p:=public.operator_intelligence_regression_corpus();
  IF jsonb_array_length(p->'items')<>1 THEN RAISE EXCEPTION 'authorized real-role read failed'; END IF;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.operator_intelligence_regression_corpus(); RAISE EXCEPTION 'anonymous RPC allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ DECLARE d uuid; BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT id INTO d FROM public.paige_eval_dataset WHERE regression_corpus_version IS NOT NULL;
  BEGIN PERFORM public.operator_intelligence_regression_corpus(); RAISE EXCEPTION 'service RPC allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  -- This is the same run INSERT attempted before paige-eval calls runEval/provider scoring.
  BEGIN INSERT INTO public.paige_eval_run(dataset_id,target_kind,scorer_set,status) VALUES(d,'job_kind',ARRAY['llm_judge'],'running');
    RAISE EXCEPTION 'generic dispatch could open a protected corpus run'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN INSERT INTO public.paige_eval_case(dataset_id,input) VALUES(d,'{"raw_prompt":"PRIVATE"}');
    RAISE EXCEPTION 'unreviewed case could be published'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  -- Existing ordinary Eval row DML stays available; only protected publication/bulk erasure is denied.
  INSERT INTO public.paige_eval_dataset(name,target_kind) VALUES('test-legacy-eval','job_kind') RETURNING id INTO d;
  INSERT INTO public.paige_eval_case(dataset_id,input) VALUES(d,'{"synthetic":"legacy"}');
  UPDATE public.paige_eval_dataset SET description='controlled legacy update' WHERE id=d;
  UPDATE public.paige_eval_case SET expected='{"synthetic":"expected"}' WHERE dataset_id=d;
  DELETE FROM public.paige_eval_dataset WHERE id=d;
END $$;
RESET ROLE;

CREATE FUNCTION public.int280_corpus_audit_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.target_type='intelligence_regression_corpus' THEN RAISE EXCEPTION 'controlled_audit_refusal'; END IF; RETURN NEW; END $$;
CREATE TRIGGER int280_corpus_audit_refusal BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.int280_corpus_audit_refusal();
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  BEGIN PERFORM public.operator_intelligence_regression_corpus(); RAISE EXCEPTION 'unaudited evidence returned';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'controlled_audit_refusal' THEN RAISE; END IF; END;
END $$;
DROP TRIGGER int280_corpus_audit_refusal ON public.paige_audit_log;
DROP FUNCTION public.int280_corpus_audit_refusal();
SELECT 'PASS: protected immutable corpus, canonical Eval reuse, actual-role/tenant isolation, bounded metadata, generic dispatch refusal and fail-closed audit';
