-- Controlled task: canonical acceptance -> interruption -> resume -> two model calls ->
-- governed synthetic approval/act -> actual canonical document completion + receipt/readback.
CREATE TABLE int280_fixture_snapshot(payload jsonb); -- Disposable loopback proof only, never a production migration.
DO $$ DECLARE legacy public.paige_durable_work%rowtype; w public.paige_durable_work%rowtype; r record; trace uuid; eval_run uuid; bad_run uuid; p jsonb; item jsonb; first_page jsonb; next_page jsonb; n integer;
  operator_id uuid := '20000000-0000-4000-8000-000000000002';
  foreign_tenant uuid := '10000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users VALUES(operator_id);
  INSERT INTO public.user_roles VALUES(operator_id,'platform_admin');
  SELECT * INTO legacy FROM public.paige_durable_work WHERE intent_id='40000000-0000-4000-8000-000000000001';
  SELECT * INTO r FROM public.create_paige_durable_work(legacy.tenant_id,legacy.initiating_user_id,'40000000-0000-4000-8000-000000000002',legacy.thread_id,legacy.capability_key,legacy.work_kind,legacy.authority_context,legacy.scope_epoch);
  SELECT * INTO w FROM public.paige_durable_work WHERE id=r.work_id;
  INSERT INTO public.paige_chat_turns(thread_id,role,content,interactive_intent_id,interactive_actor_id,interactive_tenant_id)
  VALUES(w.thread_id,'user','private customer objective',w.intent_id,w.initiating_user_id,w.tenant_id),
    (w.thread_id,'user','private concurrent objective',legacy.intent_id,w.initiating_user_id,w.tenant_id);
  INSERT INTO public.paige_chat_turns(thread_id,role,content,bundle_ref,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state)
  VALUES(w.thread_id,'assistant','Private narration: I finished the business objective',jsonb_build_object('interactive',jsonb_build_object('effects',jsonb_build_array(jsonb_build_object('work_id',w.id,'outcome','durable_accepted','tool',w.capability_key)))),w.intent_id,w.initiating_user_id,w.tenant_id,'completed');
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',NULL,NULL,'approval_expired');
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'claimed');
  UPDATE public.paige_durable_work SET dispatch_started_attempt=2,version=version+1 WHERE id=w.id;
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,provider,model,tier,status,tokens_in,tokens_out,latency_ms,cost_estimate_usd,router_version,input_excerpt,output_excerpt,metadata)
  VALUES(w.tenant_id,w.id::text,'test-provider','test-model','frontier','success',10,20,40,0.001,'trace-2','private customer prompt','private generated response','{"caller_function":"paige-document-worker","route_requested_class":"astra"}') RETURNING id INTO trace;
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,provider,model,status,metadata) VALUES(w.tenant_id,w.id::text,'test-provider','test-model','error','{"caller_function":"paige-document-worker"}');
  -- Wrong-scope and untyped legacy task_id rows MUST NOT join, despite matching work text.
  INSERT INTO public.paige_llm_trace(tenant_id,working_context_tenant_id,task_id,provider,status,metadata) VALUES(w.tenant_id,foreign_tenant,w.id::text,'private-foreign-provider','success','{"caller_function":"paige-document-worker"}');
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,provider,status,metadata) VALUES(w.tenant_id,w.id::text,'untrusted-producer','success','{}');
  INSERT INTO public.paige_act_executions(id,work_id,tenant_id,event_id,act_id,capability_key,outcome,effective_lane,decided_at,dispatched_at,settled_at,provider_ref)
  VALUES('50000000-0000-4000-8000-000000000001',w.id,w.tenant_id,'60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','test_capability','executed','confirm',now(),now(),now(),'private provider response identity');
  INSERT INTO public.paige_pending_approvals VALUES('80000000-0000-4000-8000-000000000001',w.tenant_id,'approved','{"source":"paige_orchestration","event_id":"60000000-0000-4000-8000-000000000001","act_id":"70000000-0000-4000-8000-000000000001","act_execution_id":"50000000-0000-4000-8000-000000000001"}','{"private":"approval draft"}',now(),now(),'paige_orchestration');
  SELECT * INTO r FROM public.complete_paige_document_work(w.id,w.idempotency_key,'guide','Synthetic fixture draft','[{"type":"paragraph","text":"controlled synthetic content"}]','test-provider','test-model',30,40);
  IF NOT r.receipt_recorded OR r.work_status<>'succeeded' THEN RAISE EXCEPTION 'canonical completion missing'; END IF;
  SELECT * INTO w FROM public.paige_durable_work WHERE id=w.id;
  PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
  p:=public.operator_intelligence_trajectories(p_work_id=>w.id);item:=p->'items'->0;
  IF item->'terminal_verified'<>'true'::jsonb OR item->>'artifact_ref'<>w.id::text OR item->>'attempt'<>'2' OR jsonb_array_length(item->'models')<>2 OR jsonb_array_length(item->'approvals')<>1 OR jsonb_array_length(item->'turns')<>3 THEN RAISE EXCEPTION 'full chain reconstruction incorrect'; END IF;
  IF item->'history'->'complete'<>'true'::jsonb OR jsonb_array_length(item->'history'->'events')<>5 THEN RAISE EXCEPTION 'interruption/resume history missing'; END IF;
  IF p::text ~* '(private customer|private concurrent|private generated|private narration|private-foreign|private provider|approval draft|controlled synthetic content|scope_epoch|actor_user_id|tenant_id|idempotency|input_excerpt|output_excerpt|draft_content|request_payload)' THEN RAISE EXCEPTION 'sensitive source projection'; END IF;
  INSERT INTO int280_fixture_snapshot VALUES(p); -- Preserve the proven chain before negative-case mutations.
  IF jsonb_array_length(public.operator_intelligence_trajectories(p_trace_id=>trace)->'items')<>1 THEN RAISE EXCEPTION 'legitimate trace link missing'; END IF;
  INSERT INTO public.paige_eval_run(tenant_id,status) VALUES(w.tenant_id,'complete') RETURNING id INTO eval_run;
  INSERT INTO public.paige_eval_run(tenant_id,status) VALUES(foreign_tenant,'complete') RETURNING id INTO bad_run;
  INSERT INTO public.paige_eval_result(run_id,tenant_id,source_trace_id,scorer,scorer_kind,status,rationale)
    VALUES(eval_run,w.tenant_id,trace,'exact_match','deterministic','needs_config','private customer evaluation rationale'),
      (eval_run,foreign_tenant,trace,'exact_match','deterministic','scored','private customer foreign result'),
      (bad_run,w.tenant_id,trace,'exact_match','deterministic','scored','private customer foreign run');
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF jsonb_array_length(item->'evaluations')<>1 OR item->'evaluations'->0->>'status'<>'needs_config' OR item::text LIKE '%private customer%' THEN RAISE EXCEPTION 'evaluation scope or rationale exclusion failed'; END IF;
  IF jsonb_array_length(public.operator_intelligence_trajectories(p_work_id=>w.id,p_subject_tenant=>foreign_tenant)->'items')<>0 THEN RAISE EXCEPTION 'wrong subject scope returned'; END IF;
  SELECT id INTO trace FROM public.paige_llm_trace WHERE provider='private-foreign-provider';
  IF jsonb_array_length(public.operator_intelligence_trajectories(p_trace_id=>trace)->'items')<>0 THEN RAISE EXCEPTION 'foreign context trace linked'; END IF;
  -- Exact retirement302 marker movement must not erase the former scope refusal.
  UPDATE public.paige_llm_trace SET retired_working_context_tenant_id=working_context_tenant_id,working_context_tenant_id=NULL WHERE id=trace;
  IF jsonb_array_length(public.operator_intelligence_trajectories(p_trace_id=>trace)->'items')<>0 THEN RAISE EXCEPTION 'retired foreign context trace linked'; END IF;
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF jsonb_array_length(item->'models')<>2 OR item::text LIKE '%private-foreign-provider%' THEN RAISE EXCEPTION 'retired foreign context entered task models or genuine null context lost'; END IF;
  -- Cursor ties, concurrent same-conversation work and missing historical evidence.
  first_page:=public.operator_intelligence_trajectories(1);next_page:=public.operator_intelligence_trajectories(1,(first_page->'next_cursor'->>'at')::timestamptz,(first_page->'next_cursor'->>'id')::uuid);
  IF first_page->'items'->0->>'id'=next_page->'items'->0->>'id' THEN RAISE EXCEPTION 'cursor repeated task'; END IF;
  item:=public.operator_intelligence_trajectories(p_work_id=>legacy.id)->'items'->0;
  IF jsonb_array_length(item->'models')<>0 OR item->'terminal_verified'<>'false'::jsonb OR item->'history'->'complete'<>'false'::jsonb THEN RAISE EXCEPTION 'unrelated historical task joined'; END IF;
  BEGIN PERFORM public.operator_intelligence_trajectories(p_before_at=>now());RAISE EXCEPTION 'half cursor accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
  -- Receipt and destination proofs are independently necessary, current and scoped.
  UPDATE public.paige_workspace_events SET detail='{}' WHERE source_id=w.id;
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'missing readback receipt verified'; END IF;
  UPDATE public.paige_workspace_events SET detail=w.terminal_outcome||jsonb_build_object('work_id',w.id) WHERE source_id=w.id;
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'true'::jsonb THEN RAISE EXCEPTION 'restored receipt does not verify'; END IF;
  UPDATE public.paige_workspace_events SET job_attempt_id=w.id::text||':1' WHERE source_id=w.id;
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'stale receipt verified'; END IF;
  UPDATE public.paige_workspace_events SET job_attempt_id=w.id::text||':2' WHERE source_id=w.id;
  UPDATE public.marketing_content SET document_revision=2 WHERE work_id=w.id;
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'changed destination verified'; END IF;
  UPDATE public.marketing_content SET document_revision=1 WHERE work_id=w.id;
  UPDATE public.paige_pending_approvals SET source='manual',status='pending';
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF jsonb_array_length(item->'approvals')<>0 OR item->'terminal_verified'<>'true'::jsonb THEN RAISE EXCEPTION 'editable producer spoof attributed'; END IF;
  UPDATE public.paige_pending_approvals SET source='paige_orchestration',metadata=metadata-'act_execution_id';
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF jsonb_array_length(item->'approvals')<>0 OR item->'terminal_verified'<>'true'::jsonb THEN RAISE EXCEPTION 'missing execution reference attributed'; END IF;
  UPDATE public.paige_pending_approvals SET metadata=metadata||jsonb_build_object('act_execution_id',gen_random_uuid());
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF jsonb_array_length(item->'approvals')<>0 OR item->'terminal_verified'<>'true'::jsonb THEN RAISE EXCEPTION 'wrong execution reference attributed'; END IF;
  UPDATE public.paige_pending_approvals SET metadata=metadata||'{"act_execution_id":"50000000-0000-4000-8000-000000000001"}'::jsonb;
  UPDATE public.paige_pending_approvals SET status='rejected';
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'denied approval verified'; END IF;
  UPDATE public.paige_pending_approvals SET status='expired';
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'expired approval verified'; END IF;
  UPDATE public.paige_pending_approvals SET status='approved';
  UPDATE public.paige_act_executions SET outcome='ambiguous';
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'ambiguous tool verified'; END IF;
  UPDATE public.paige_act_executions SET outcome='executed',tenant_id=foreign_tenant;
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF item->'terminal_verified'<>'false'::jsonb OR jsonb_array_length(item->'executions')<>0 THEN RAISE EXCEPTION 'foreign execution leak'; END IF;
  UPDATE public.paige_act_executions SET tenant_id=w.tenant_id;
  PERFORM public.record_capability_run(w.tenant_id,w.initiating_user_id,w.capability_key,'capability_unreachable',w.id,NULL,w.id::text||':2');
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF item->'terminal_verified'<>'false'::jsonb OR item->'receipt_conflict'<>'true'::jsonb THEN RAISE EXCEPTION 'conflicting receipt verified'; END IF;
  INSERT INTO public.paige_llm_trace(tenant_id,task_id,provider,status,metadata)
    SELECT w.tenant_id,w.id::text,'synthetic','success','{"caller_function":"paige-document-worker"}' FROM generate_series(1,101);
  item:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF jsonb_array_length(item->'models')<>100 OR item->>'model_count'<>'103' OR item->'limit_reached'->'models'<>'true'::jsonb THEN RAISE EXCEPTION 'bounded source metadata missing'; END IF;
  IF jsonb_array_length(public.operator_intelligence_trajectories(1000000)->'items')>50 THEN RAISE EXCEPTION 'unbounded fleet page'; END IF;
  SELECT count(*) INTO n FROM public.paige_audit_log WHERE target_type='intelligence_trajectories';
  IF n<12 THEN RAISE EXCEPTION 'fleet read audit absent'; END IF;
  PERFORM set_config('request.jwt.claim.sub',w.initiating_user_id::text,true);
  BEGIN PERFORM public.operator_intelligence_trajectories();RAISE EXCEPTION 'ordinary tenant role accepted';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN PERFORM public.operator_intelligence_trajectories();RAISE EXCEPTION 'null caller accepted';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
END $$;
-- Controlled read-only outcome: reuse the existing research destination predicate, without
-- activating research execution or a provider. Missing citation evidence cannot verify it.
DO $$ DECLARE base public.paige_durable_work%rowtype; w public.paige_durable_work%rowtype; r record; run uuid:=gen_random_uuid(); p jsonb; state text;
BEGIN
  SELECT * INTO base FROM public.paige_durable_work WHERE intent_id='40000000-0000-4000-8000-000000000001';
  SELECT * INTO r FROM public.create_paige_durable_work(base.tenant_id,base.initiating_user_id,gen_random_uuid(),base.thread_id,'deep_research','research',base.authority_context,base.scope_epoch);
  SELECT * INTO w FROM public.paige_durable_work WHERE id=r.work_id;
  UPDATE public.paige_durable_work SET request_payload='{"question":"private customer research question"}',version=version+1 WHERE id=w.id;
  INSERT INTO public.research_runs(id,work_id,tenant_id,user_id,question,configured,stop_reason,coverage,findings)
    VALUES(run,w.id,w.tenant_id,w.initiating_user_id,'private customer research question',true,'answered','{"stop_reason":"answered","configured":true}','[{"text":"private customer finding","citations":[1]}]');
  INSERT INTO public.research_sources(run_id,tenant_id,user_id,source_index,url) VALUES(run,w.tenant_id,w.initiating_user_id,1,'https://example.invalid/controlled-fixture');
  PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',jsonb_build_object('verified_readback',true,'run_id',run));
  PERFORM public.record_capability_run(w.tenant_id,w.initiating_user_id,w.capability_key,'capability_succeeded',w.id,NULL,w.id::text||':1',_detail=>jsonb_build_object('verified_readback',true,'work_id',w.id,'run_id',run));
  PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
  p:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
  IF p->'terminal_verified'<>'true'::jsonb OR p->>'terminal_condition'<>'read_only' OR p::text LIKE '%private customer%' OR p::text LIKE '%example.invalid%' THEN RAISE EXCEPTION 'read-only outcome or privacy failed'; END IF;
  UPDATE public.research_sources SET excluded=true WHERE run_id=run;
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'unusable citation verified'; END IF;
  UPDATE public.research_sources SET excluded=false,tenant_id=gen_random_uuid() WHERE run_id=run;
  IF (public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0->'terminal_verified')<>'false'::jsonb THEN RAISE EXCEPTION 'foreign research evidence verified'; END IF;
  -- Failed and unresolved work retain their canonical states despite successful model prose.
  FOREACH state IN ARRAY ARRAY['failed','outcome_unknown','cancelled','blocked'] LOOP
    SELECT * INTO r FROM public.create_paige_durable_work(base.tenant_id,base.initiating_user_id,gen_random_uuid(),base.thread_id,'document_generate','document_authoring',base.authority_context,base.scope_epoch);
    SELECT * INTO w FROM public.paige_durable_work WHERE id=r.work_id;
    INSERT INTO public.paige_llm_trace(tenant_id,task_id,provider,status,output_excerpt,metadata) VALUES(w.tenant_id,w.id::text,'synthetic','success','private customer objective completed','{"caller_function":"paige-document-worker"}');
    PERFORM public.transition_paige_durable_work(w.id,w.idempotency_key,state,'{}',NULL,CASE WHEN state='blocked' THEN 'approval_denied' ELSE NULL END);
    p:=public.operator_intelligence_trajectories(p_work_id=>w.id)->'items'->0;
    IF p->>'work_state'<>state OR p->'terminal_verified'<>'false'::jsonb THEN RAISE EXCEPTION 'model prose overrode canonical state %',state; END IF;
  END LOOP;
END $$;
-- Actual database roles exercise ACL and predicate, rather than a mocked boolean.
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_trajectories();RAISE EXCEPTION 'anon allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_trajectories();RAISE EXCEPTION 'service role allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false),set_config('request.jwt.claim.role','authenticated',false);
SET ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_trajectories();RAISE EXCEPTION 'Solo allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
SELECT public.operator_intelligence_trajectories(1)->>'contract_version';
RESET ROLE;
CREATE FUNCTION public.int280_fixture_audit_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure';END $$;
CREATE TRIGGER int280_fixture_audit_refusal BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.int280_fixture_audit_refusal();
DO $$ BEGIN BEGIN PERFORM public.operator_intelligence_trajectories();RAISE EXCEPTION 'unaudited read accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic audit failure' THEN RAISE;END IF;END;END $$;
SELECT 'PASS: trajectory reconstruction, canonical readback, missing/stale/conflicting evidence, scope, roles, cursor, privacy and audit refusal';
