-- INT-280 local psql contract test. Run after the canonical eval schema + new RPC.
-- Fixtures are synthetic and rolled back. No provider invocation or deployed account.
BEGIN;
INSERT INTO public.user_roles(user_id, role) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform_admin'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','super_admin'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','admin');
INSERT INTO public.paige_eval_dataset(id,name,target_kind,description)
VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','LOCAL SYNTHETIC','trace_batch','PRIVATE_CONTENT_SENTINEL');
INSERT INTO public.paige_eval_run(dataset_id,target_kind,target_ref,target_version,scorer_set,created_at)
SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd','trace_batch','PRIVATE_CONTENT_SENTINEL','local-version',ARRAY['exact_match'],now() - (i * interval '1 second') FROM generate_series(1,105) i;
INSERT INTO public.paige_eval_result(run_id,scorer,scorer_kind,status,rationale)
SELECT (SELECT id FROM public.paige_eval_run ORDER BY created_at DESC LIMIT 1),'exact_match','deterministic','needs_config','PRIVATE_CONTENT_SENTINEL' FROM generate_series(1,105);

DO $$ BEGIN
 IF has_function_privilege('anon','public.operator_intelligence_eval_history(integer)','execute') THEN RAISE EXCEPTION 'anon execute leak'; END IF;
 IF NOT has_function_privilege('authenticated','public.operator_intelligence_eval_history(integer)','execute') THEN RAISE EXCEPTION 'authenticated execute missing'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $$ BEGIN
 BEGIN PERFORM public.operator_intelligence_eval_history(25); RAISE EXCEPTION 'tenant admin admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.operator_intelligence_eval_history(25); RAISE EXCEPTION 'null identity admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$ DECLARE rows jsonb; BEGIN
 rows := public.operator_intelligence_eval_history(999);
 IF jsonb_array_length(rows) <> 100 THEN RAISE EXCEPTION 'run bound failed'; END IF;
 IF jsonb_array_length(rows->0->'results') <> 100 OR (rows->0->>'result_count')::int <> 105 THEN RAISE EXCEPTION 'result sample bound/count failed'; END IF;
 IF rows::text LIKE '%PRIVATE_CONTENT_SENTINEL%' OR rows->0 ? 'tenant_id' OR rows->0 ? 'created_by' OR rows->0 ? 'target_ref' OR rows->0->'results'->0 ? 'rationale' THEN RAISE EXCEPTION 'private payload leaked'; END IF;
 IF rows->0->'aggregate_score' <> 'null'::jsonb OR rows->0->'results'->0->'passed' <> 'null'::jsonb THEN RAISE EXCEPTION 'null coerced'; END IF;
 IF jsonb_array_length(public.operator_intelligence_eval_history(-1)) <> 1 OR jsonb_array_length(public.operator_intelligence_eval_history(NULL)) <> 25 THEN RAISE EXCEPTION 'lower/default bound failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$ BEGIN IF jsonb_array_length(public.operator_intelligence_eval_history(1)) <> 1 THEN RAISE EXCEPTION 'owner refused'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.paige_audit_log WHERE actor_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND action='god_view.fleet_query' AND target_type='intelligence_eval_history') THEN RAISE EXCEPTION 'audit missing'; END IF; END $$;
CREATE FUNCTION public.int280_test_refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local audit unavailable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER int280_test_refuse_audit BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.int280_test_refuse_audit();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$ BEGIN
 BEGIN PERFORM public.operator_intelligence_eval_history(1); RAISE EXCEPTION 'unaudited evidence exposed'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: caller guards, ACL, null scores, metadata privacy, bounds, audit and fail-closed audit' AS local_contract_proof;
