-- Controlled local synthetic fixture only. No provider, customer or production writes.
CREATE OR REPLACE FUNCTION public.int280_fixture_verdict(p jsonb,criterion text) RETURNS text LANGUAGE sql AS $$
  SELECT r->>'verdict' FROM jsonb_array_elements(p->'results') r WHERE r->>'scorer'=criterion
$$;
CREATE TABLE IF NOT EXISTS int280_eval_fixture(work_id uuid,run_id uuid,input_hash text);
DO $$ DECLARE base public.paige_durable_work%rowtype; w public.paige_durable_work%rowtype; r record;
  a jsonb; b jsonb; c jsonb; run uuid; original_detail jsonb; n integer;
  foreign_tenant uuid:='10000000-0000-4000-8000-000000000002';
BEGIN
  SELECT * INTO base FROM public.paige_durable_work WHERE intent_id='40000000-0000-4000-8000-000000000001';
  SELECT * INTO r FROM public.create_paige_durable_work(base.tenant_id,base.initiating_user_id,gen_random_uuid(),base.thread_id,base.capability_key,base.work_kind,base.authority_context,base.scope_epoch);
  SELECT * INTO w FROM public.paige_durable_work WHERE id=r.work_id;
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,NULL,'approval_expired');
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'claimed');
  UPDATE public.paige_durable_work SET dispatch_started_attempt=2,version=version+1 WHERE id=w.id;
  INSERT INTO public.paige_subagents(slug,tenant_id,version) VALUES('test-agent-evaluator',w.tenant_id,3),('test-agent-other',foreign_tenant,4);
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,agent_id,provider,model,status,input_excerpt,output_excerpt,metadata)
  VALUES(w.tenant_id,w.id::text,'test-agent-evaluator','test-provider','test-model','success','PRIVATE INPUT MUST NOT LEAK','I completed the business goal','{"caller_function":"paige-document-worker"}'),
    (w.tenant_id,w.id::text,'test-agent-evaluator','test-provider','test-model','error','PRIVATE INPUT MUST NOT LEAK','Assistant success prose','{"caller_function":"paige-document-worker"}');
  INSERT INTO public.paige_act_executions(id,work_id,tenant_id,event_id,act_id,capability_key,outcome,effective_lane)
    VALUES('51000000-0000-4000-8000-000000000001',w.id,w.tenant_id,'61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',w.capability_key,'executed','confirm');
  INSERT INTO public.paige_pending_approvals(id,tenant_id,status,metadata,draft_content,created_at,reviewed_at,source)
    VALUES('81000000-0000-4000-8000-000000000001',w.tenant_id,'approved','{"source":"paige_orchestration","event_id":"61000000-0000-4000-8000-000000000001","act_id":"71000000-0000-4000-8000-000000000001","act_execution_id":"51000000-0000-4000-8000-000000000001"}','{"secret":"PRIVATE APPROVAL"}',now(),now(),'paige_orchestration');
  SELECT * INTO r FROM public.complete_paige_document_work(w.id,w.idempotency_key,'guide','Synthetic AI2 task','[{"type":"paragraph","text":"PRIVATE DOCUMENT"}]','test-provider','test-model',30,40);
  IF NOT r.receipt_recorded THEN RAISE EXCEPTION 'canonical fixture receipt missing'; END IF;
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  a:=public.operator_intelligence_evaluate_task(w.id,'1.0.0');run:=(a->>'run_ref')::uuid;
  IF public.int280_fixture_verdict(a,'terminal_evidence') IS DISTINCT FROM 'pass' OR public.int280_fixture_verdict(a,'trajectory_capture') IS DISTINCT FROM 'pass'
    OR public.int280_fixture_verdict(a,'approval_decision') IS DISTINCT FROM 'indeterminate' OR a->'summary'->>'total' IS DISTINCT FROM '3'
    OR a->'summary'->>'coverage_denominator' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'canonical criteria or unknown approval dishonest: %',a; END IF;
  b:=public.operator_intelligence_evaluate_task(p_replay_run_id=>run,p_set_version=>'1.0.0');
  c:=public.operator_intelligence_evaluate_task(w.id,'1.0.0');
  IF b->>'input_hash' IS DISTINCT FROM a->>'input_hash' OR c->>'input_hash' IS DISTINCT FROM a->>'input_hash' OR b->'summary' IS DISTINCT FROM a->'summary'
    OR (SELECT jsonb_agg(v-'result_ref') FROM jsonb_array_elements(b->'results') v) IS DISTINCT FROM
      (SELECT jsonb_agg(v-'result_ref') FROM jsonb_array_elements(a->'results') v)
    OR b->>'mode' IS DISTINCT FROM 'replay' OR b->>'source_observed_at' IS DISTINCT FROM a->>'source_observed_at' THEN RAISE EXCEPTION 'same version replay not reproducible'; END IF;
  b:=public.operator_intelligence_evaluate_task(p_replay_run_id=>run,p_set_version=>'1.1.0');
  IF b->'set'->>'hash'=a->'set'->>'hash' OR b->>'input_hash' IS DISTINCT FROM a->>'input_hash' OR b->'summary'->>'total' IS DISTINCT FROM '4'
    OR public.int280_fixture_verdict(b,'model_call_status') IS DISTINCT FROM 'fail' OR public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'pass' THEN
    RAISE EXCEPTION 'version distinction or model/task separation lost'; END IF;
  IF EXISTS(SELECT 1 FROM public.paige_eval_run WHERE id=run AND (tenant_id IS NOT NULL OR work_id IS NOT NULL OR task_subject_ref IS DISTINCT FROM w.id OR aggregate_score IS NOT NULL OR pass_rate IS NOT NULL
    OR cost_estimate_usd<>0 OR created_by<>'20000000-0000-4000-8000-000000000002')) THEN RAISE EXCEPTION 'ownership, attribution or legacy metric contamination'; END IF;
  IF EXISTS(SELECT 1 FROM public.paige_eval_result WHERE run_id=run AND task_verdict='indeterminate' AND (score IS NOT NULL OR passed IS NOT NULL)) THEN
    RAISE EXCEPTION 'unknown scored as pass'; END IF;
  IF (SELECT evidence_snapshot::text FROM public.paige_eval_run WHERE id=run) ~* '(PRIVATE INPUT|PRIVATE DOCUMENT|PRIVATE APPROVAL|Assistant success|I completed|tenant_id|actor_user_id|input_excerpt|output_excerpt|draft_content|request_payload|evaluations)' THEN
    RAISE EXCEPTION 'private or recursive evidence stored'; END IF;
  INSERT INTO int280_eval_fixture VALUES(w.id,run,a->>'input_hash');
  IF (SELECT jsonb_array_length(evidence_snapshot->'agent_attribution') FROM public.paige_eval_run WHERE id=run)<>2
    OR (SELECT evidence_snapshot->'agent_attribution'->0->>'roster_version_at_observation' FROM public.paige_eval_run WHERE id=run) IS DISTINCT FROM '3'
    OR (SELECT evidence_snapshot->'agent_attribution'->0->>'execution_agent_version' FROM public.paige_eval_run WHERE id=run) IS DISTINCT FROM 'unavailable' THEN
    RAISE EXCEPTION 'recorded agent provenance or execution-version honesty lost'; END IF;
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,agent_id,provider,status,metadata)
    VALUES(w.tenant_id,w.id::text,'test-agent-other','synthetic','success','{"caller_function":"paige-document-worker"}');
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF (SELECT evidence_snapshot->>'unassigned_model_calls' FROM public.paige_eval_run WHERE id=(b->>'run_ref')::uuid) IS DISTINCT FROM '1'
    OR (SELECT evidence_snapshot->'agent_attribution' FROM public.paige_eval_run WHERE id=(b->>'run_ref')::uuid)::text LIKE '%test-agent-other%' THEN
    RAISE EXCEPTION 'foreign roster relationship attributed'; END IF;
  BEGIN PERFORM public.operator_intelligence_evaluate_task(w.id,'latest');RAISE EXCEPTION 'mutable alias accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN PERFORM public.operator_intelligence_evaluate_task(w.id,'1.0.0',run);RAISE EXCEPTION 'two identities accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN PERFORM public.operator_intelligence_evaluate_task(w.id,'1.0.0',NULL,foreign_tenant);RAISE EXCEPTION 'wrong tenant accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN PERFORM public.operator_intelligence_evaluate_task(p_replay_run_id=>run,p_subject_tenant=>foreign_tenant);RAISE EXCEPTION 'wrong tenant replay accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  BEGIN UPDATE public.paige_eval_run SET evidence_snapshot='{}' WHERE id=run;RAISE EXCEPTION 'snapshot mutable';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
  BEGIN DELETE FROM public.paige_eval_run WHERE id=run;RAISE EXCEPTION 'run deletable';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
  BEGIN UPDATE public.paige_eval_result SET task_verdict=NULL,evaluator_version=NULL,evidence_state=NULL WHERE run_id=run;RAISE EXCEPTION 'verdict protection removable';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
  BEGIN DELETE FROM public.paige_eval_result WHERE run_id=run;RAISE EXCEPTION 'result deletable';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
  BEGIN UPDATE public.paige_eval_evaluator_set SET manifest=manifest WHERE version='1.0.0';RAISE EXCEPTION 'definition mutable';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
  -- Current evidence changes produce a new observation; historical replay remains labeled.
  SELECT detail INTO original_detail FROM public.paige_workspace_events WHERE source_id=w.id LIMIT 1;
  UPDATE public.paige_workspace_events SET detail='{}' WHERE source_id=w.id;
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' OR b->>'input_hash'=a->>'input_hash' THEN RAISE EXCEPTION 'missing receipt passed or evidence overwritten'; END IF;
  b:=public.operator_intelligence_evaluate_task(p_replay_run_id=>run);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'pass' OR b->>'mode' IS DISTINCT FROM 'replay' THEN RAISE EXCEPTION 'historical replay mislabeled'; END IF;
  UPDATE public.paige_workspace_events SET detail=original_detail,job_attempt_id=w.id::text||':1' WHERE source_id=w.id;
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'stale receipt passed'; END IF;
  UPDATE public.paige_workspace_events SET job_attempt_id=w.id::text||':2' WHERE source_id=w.id;
  UPDATE public.marketing_content SET document_revision=2 WHERE work_id=w.id;
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'changed destination passed'; END IF;
  UPDATE public.marketing_content SET document_revision=1 WHERE work_id=w.id;
  UPDATE public.paige_pending_approvals SET status='rejected' WHERE id='81000000-0000-4000-8000-000000000001';
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' OR public.int280_fixture_verdict(b,'approval_decision') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'denied approval became success or invented requirement'; END IF;
  UPDATE public.paige_pending_approvals SET status='expired' WHERE id='81000000-0000-4000-8000-000000000001';
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'expired approval passed'; END IF;
  UPDATE public.paige_pending_approvals SET status='approved' WHERE id='81000000-0000-4000-8000-000000000001';
  UPDATE public.paige_act_executions SET tenant_id=foreign_tenant WHERE id='51000000-0000-4000-8000-000000000001';
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'foreign act passed'; END IF;
  UPDATE public.paige_act_executions SET tenant_id=w.tenant_id WHERE id='51000000-0000-4000-8000-000000000001';
  PERFORM public.record_capability_run(w.tenant_id,w.initiating_user_id,w.capability_key,'capability_unreachable',w.id,NULL,w.id::text||':2');
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'conflicting receipt passed'; END IF;
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,provider,status,metadata)
    SELECT w.tenant_id,w.id::text,'synthetic','success','{"caller_function":"paige-document-worker"}' FROM generate_series(1,101);
  b:=public.operator_intelligence_evaluate_task(w.id,'1.1.0');
  IF public.int280_fixture_verdict(b,'model_call_status') IS DISTINCT FROM 'indeterminate' OR public.int280_fixture_verdict(b,'trajectory_capture') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'truncated source passed'; END IF;
  b:=public.operator_intelligence_evaluate_task(base.id);
  IF public.int280_fixture_verdict(b,'trajectory_capture') IS DISTINCT FROM 'indeterminate' OR public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'missing legacy history passed'; END IF;
  -- Concurrent same-thread task stays separate. Prose cannot finish it.
  SELECT * INTO r FROM public.create_paige_durable_work(base.tenant_id,base.initiating_user_id,gen_random_uuid(),base.thread_id,base.capability_key,base.work_kind,base.authority_context,base.scope_epoch);
  SELECT * INTO w FROM public.paige_durable_work WHERE id=r.work_id;
  INSERT INTO public.paige_chat_turns(thread_id,role,content) VALUES(w.thread_id,'assistant','I completed the business goal');
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'indeterminate' OR b->>'input_hash'=a->>'input_hash' THEN RAISE EXCEPTION 'concurrent task or narration merged'; END IF;
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'failed','{"outcome":"failed"}','synthetic_tool_failure');
  b:=public.operator_intelligence_evaluate_task(w.id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'fail' THEN RAISE EXCEPTION 'canonical failure lost'; END IF;
  SELECT * INTO r FROM public.create_paige_durable_work(base.tenant_id,base.initiating_user_id,gen_random_uuid(),base.thread_id,'fixture_knowledge','knowledge_extraction',base.authority_context,base.scope_epoch);
  b:=public.operator_intelligence_evaluate_task(r.work_id);
  IF public.int280_fixture_verdict(b,'terminal_evidence') IS DISTINCT FROM 'not_applicable' OR b->'summary'->>'not_applicable' IS DISTINCT FROM '1' OR b->'summary'->>'coverage_denominator' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'proven exclusion or coverage denominator lost'; END IF;
  SELECT count(*) INTO n FROM public.paige_audit_log WHERE target_type='intelligence_task_evaluation';
  IF n<15 THEN RAISE EXCEPTION 'attributable evaluation audit missing'; END IF;
  -- A subject reference is not the evaluator's own execution FK. Removing a
  -- disposable canonical subject must not require modifying immutable verdicts.
  SELECT * INTO r FROM public.create_paige_durable_work(base.tenant_id,base.initiating_user_id,gen_random_uuid(),base.thread_id,base.capability_key,base.work_kind,base.authority_context,base.scope_epoch);
  SELECT * INTO w FROM public.paige_durable_work WHERE id=r.work_id;
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'failed','{"outcome":"failed"}','synthetic_tool_failure');
  b:=public.operator_intelligence_evaluate_task(w.id);
  DELETE FROM public.paige_durable_work WHERE id=w.id;
  BEGIN PERFORM public.operator_intelligence_evaluate_task(p_replay_run_id=>(b->>'run_ref')::uuid);RAISE EXCEPTION 'removed canonical subject replayed';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
END $$;
-- Actual API database roles and the canonical authority predicate.
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false),set_config('request.jwt.claim.tenant_id','10000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.paige_eval_result WHERE task_verdict IS NOT NULL) THEN RAISE EXCEPTION 'platform verdict leaked to tenant'; END IF;
  BEGIN PERFORM public.operator_intelligence_evaluate_task(gen_random_uuid());RAISE EXCEPTION 'Solo admitted';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
  BEGIN PERFORM public._paige_task_evaluator_verdicts('{}','1.0.0');RAISE EXCEPTION 'private scorer callable';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
  BEGIN PERFORM 1 FROM public.paige_eval_evaluator_set;RAISE EXCEPTION 'raw registry accessible';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
DO $$ DECLARE w uuid; BEGIN
  SELECT (public.operator_intelligence_trajectories(p_limit=>1)->'items'->0->>'id')::uuid INTO w;
  IF public.operator_intelligence_evaluate_task(w)->>'run_ref' IS NULL THEN RAISE EXCEPTION 'actual Operator database role failed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',false);
SET ROLE service_role;
DO $$ DECLARE r uuid; BEGIN
  BEGIN PERFORM public.operator_intelligence_evaluate_task(gen_random_uuid());RAISE EXCEPTION 'service RPC admitted';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
  SELECT id INTO r FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL LIMIT 1;
  BEGIN INSERT INTO public.paige_eval_result(run_id,scorer,scorer_kind,status,task_verdict,evaluator_version,evidence_state) VALUES(r,'forged','deterministic','needs_config','indeterminate','1.0.0','missing');RAISE EXCEPTION 'service forged task result';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
  -- Original model-output evaluation writes remain functional.
  INSERT INTO public.paige_eval_run(tenant_id,status) VALUES('10000000-0000-4000-8000-000000000001','running') RETURNING id INTO r;
  UPDATE public.paige_eval_run SET status='complete' WHERE id=r;
  INSERT INTO public.paige_eval_result(run_id,tenant_id,scorer,scorer_kind,status) VALUES(r,'10000000-0000-4000-8000-000000000001','existing_output_scorer','deterministic','needs_config');
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_evaluate_task(gen_random_uuid());RAISE EXCEPTION 'anon admitted';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_evaluate_task(gen_random_uuid());RAISE EXCEPTION 'null caller admitted';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END; END $$;
-- Audit refusal aborts the entire evaluation transaction.
CREATE TRIGGER int280_fixture_audit_refusal BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.int280_fixture_audit_refusal();
DO $$ DECLARE n integer; w uuid; BEGIN
  SELECT count(*) INTO n FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL;
  SELECT work_id INTO w FROM int280_eval_fixture;
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  BEGIN PERFORM public.operator_intelligence_evaluate_task(w);RAISE EXCEPTION 'audit failure admitted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic audit failure' THEN RAISE;END IF;END;
  IF n<>(SELECT count(*) FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL) THEN RAISE EXCEPTION 'partial audit-failed run persisted'; END IF;
END $$;
DROP TRIGGER int280_fixture_audit_refusal ON public.paige_audit_log;
-- Inject a controlled source change BETWEEN the two reads, through a LOCAL-only
-- audit trigger. The runner must refuse observed drift, without persisting a run.
CREATE TABLE int280_fixture_read_counter(n integer);INSERT INTO int280_fixture_read_counter VALUES(0);
CREATE FUNCTION public.int280_fixture_source_drift() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reads integer;
BEGIN
  IF NEW.target_type='intelligence_trajectories' THEN
    UPDATE public.int280_fixture_read_counter SET n=n+1 RETURNING n INTO reads;
    IF reads=2 THEN UPDATE public.paige_llm_trace SET tokens_in=COALESCE(tokens_in,0)+1
      WHERE id=(SELECT id FROM public.paige_llm_trace WHERE task_id=NEW.payload->>'work_ref' ORDER BY created_at,id LIMIT 1); END IF;
  END IF;RETURN NEW;
END $$;
CREATE TRIGGER int280_fixture_source_drift BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.int280_fixture_source_drift();
DO $$ DECLARE n integer; w uuid; BEGIN
  SELECT count(*) INTO n FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL;SELECT work_id INTO w FROM int280_eval_fixture;
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
  BEGIN PERFORM public.operator_intelligence_evaluate_task(w);RAISE EXCEPTION 'observed source drift accepted';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  IF n<>(SELECT count(*) FROM public.paige_eval_run WHERE evaluator_set_id IS NOT NULL) THEN RAISE EXCEPTION 'drifted evidence persisted'; END IF;
END $$;
DROP TRIGGER int280_fixture_source_drift ON public.paige_audit_log;
SELECT 'PASS: deterministic canonical task evaluation';
