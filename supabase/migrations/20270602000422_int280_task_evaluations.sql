-- INT-280 AI-2B. Observe canonical task evidence; never execute a task or provider.
-- Platform-owned verdicts reuse Eval storage (tenant_id NULL, invisible to Solo).
CREATE TABLE IF NOT EXISTS public.paige_eval_evaluator_set (
  id text NOT NULL, version text NOT NULL, definition_hash text NOT NULL,
  manifest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id,version), UNIQUE(id,version,definition_hash),
  CHECK (definition_hash=encode(pg_catalog.sha256(convert_to(manifest,'UTF8')),'hex')),
  CHECK ((manifest::jsonb->>'id'=id AND manifest::jsonb->>'version'=version) IS TRUE)
);
ALTER TABLE public.paige_eval_evaluator_set ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_eval_evaluator_set FROM PUBLIC,anon,authenticated,service_role;
-- Definition bytes are generated from the reviewed immutable source manifest.
INSERT INTO public.paige_eval_evaluator_set(id,version,definition_hash,manifest) VALUES('durable-task-evidence','1.0.0','544cbea0003813658b179144833d1863c1150ad01694cccbefb6cee3ac61b05c',$manifest${"id":"durable-task-evidence","version":"1.0.0","trajectory_contract_version":1,"authority":"observe_only","evaluators":[{"id":"terminal_evidence","version":"1.0.0","kind":"deterministic","applicability":["document_generate:document_authoring","deep_research:research"],"required_evidence":["scoped_work","current_work_version","current_attempt_receipt","canonical_destination_readback"],"criterion":"The recorded terminal condition is independently verified for the current attempt. Artifact creation and read-only research do not establish downstream business impact.","failure":"Canonical supported work is failed or cancelled, or its complete current-attempt evidence proves the terminal condition was not met.","indeterminate":"Nonterminal, missing, stale, partial, disputed or unsupported evidence never establishes successful completion.","not_applicable":"The server proves the capability and category are outside this definition. Missing identity is indeterminate."},{"id":"trajectory_capture","version":"1.0.0","kind":"deterministic","applicability":["scoped_durable_work:trajectory_contract_v1"],"required_evidence":["scoped_work","current_work_version","canonical_history","source_limits"],"criterion":"The canonical history records initiation through the observed current work version, is complete and untruncated, and source reference limits were not reached.","failure":"Complete canonical evidence proves an internally inconsistent history or source scope.","indeterminate":"Missing or truncated history, partial source pages, unrecognized versions and unresolved source relationships remain indeterminate.","not_applicable":"No exclusion for a scoped version-1 durable task. Unknown task identity is indeterminate."},{"id":"approval_decision","version":"1.0.0","kind":"deterministic","applicability":["server_proven_approval_requirement"],"required_evidence":["scoped_work","current_work_version","approval_requirement","canonical_approval_decision","execution_approval_link"],"criterion":"The actual linked approval decision and subsequent execution comply with the existing canonical requirement. Requested approval or provider acceptance is insufficient.","failure":"Complete canonical evidence proves execution despite a denied, expired or missing required approval.","indeterminate":"Absent universal requirement/attempt linkage, pending decisions or incomplete approval evidence remain indeterminate; absence does not imply no approval was required.","not_applicable":"Only an explicit server-proven existing policy result that approval was not required permits exclusion."}]}$manifest$) ON CONFLICT(id,version) DO NOTHING;
INSERT INTO public.paige_eval_evaluator_set(id,version,definition_hash,manifest) VALUES('durable-task-evidence','1.1.0','2e2615068b05d5b664588257eb67da4e520b1a63c5cfa7f2f7cfc0a70dac7cae',$manifest${"id":"durable-task-evidence","version":"1.1.0","trajectory_contract_version":1,"authority":"observe_only","evaluators":[{"id":"terminal_evidence","version":"1.0.0","kind":"deterministic","applicability":["document_generate:document_authoring","deep_research:research"],"required_evidence":["scoped_work","current_work_version","current_attempt_receipt","canonical_destination_readback"],"criterion":"The recorded terminal condition is independently verified for the current attempt. Artifact creation and read-only research do not establish downstream business impact.","failure":"Canonical supported work is failed or cancelled, or its complete current-attempt evidence proves the terminal condition was not met.","indeterminate":"Nonterminal, missing, stale, partial, disputed or unsupported evidence never establishes successful completion.","not_applicable":"The server proves the capability and category are outside this definition. Missing identity is indeterminate."},{"id":"trajectory_capture","version":"1.0.0","kind":"deterministic","applicability":["scoped_durable_work:trajectory_contract_v1"],"required_evidence":["scoped_work","current_work_version","canonical_history","source_limits"],"criterion":"The canonical history records initiation through the observed current work version, is complete and untruncated, and source reference limits were not reached.","failure":"Complete canonical evidence proves an internally inconsistent history or source scope.","indeterminate":"Missing or truncated history, partial source pages, unrecognized versions and unresolved source relationships remain indeterminate.","not_applicable":"No exclusion for a scoped version-1 durable task. Unknown task identity is indeterminate."},{"id":"approval_decision","version":"1.0.0","kind":"deterministic","applicability":["server_proven_approval_requirement"],"required_evidence":["scoped_work","current_work_version","approval_requirement","canonical_approval_decision","execution_approval_link"],"criterion":"The actual linked approval decision and subsequent execution comply with the existing canonical requirement. Requested approval or provider acceptance is insufficient.","failure":"Complete canonical evidence proves execution despite a denied, expired or missing required approval.","indeterminate":"Absent universal requirement/attempt linkage, pending decisions or incomplete approval evidence remain indeterminate; absence does not imply no approval was required.","not_applicable":"Only an explicit server-proven existing policy result that approval was not required permits exclusion."},{"id":"model_call_status","version":"1.0.0","kind":"deterministic","applicability":["server_linked_model_calls"],"required_evidence":["scoped_work","server_proven_trace_links","recorded_call_status","source_limits"],"criterion":"Every server-linked recorded model call has a successful status. This evaluates only recorded calls; missing telemetry cannot establish complete runtime coverage or task success.","failure":"An untruncated set of linked recorded calls includes an error or timeout.","indeterminate":"No linked calls, unknown status, disputed scope or a truncated call page remain indeterminate. Absence is not proof that no model was used.","not_applicable":"No exclusion without a server-proven existing no-model execution contract."}]}$manifest$) ON CONFLICT(id,version) DO NOTHING;

ALTER TABLE public.paige_eval_run
  -- Existing work_id belongs to the evaluator's own durable execution, not its subject.
  -- A soft canonical subject reference avoids obstructing governed tenant erasure.
  ADD COLUMN IF NOT EXISTS task_subject_ref uuid,
  ADD COLUMN IF NOT EXISTS evaluator_set_id text,
  ADD COLUMN IF NOT EXISTS evaluator_set_version text,
  ADD COLUMN IF NOT EXISTS evaluator_set_hash text,
  ADD COLUMN IF NOT EXISTS evidence_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS source_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS observation_kind text;
ALTER TABLE public.paige_eval_run DROP CONSTRAINT IF EXISTS paige_eval_run_task_evidence_ck;
ALTER TABLE public.paige_eval_run ADD CONSTRAINT paige_eval_run_task_evidence_ck CHECK (
  (task_subject_ref IS NULL AND evaluator_set_id IS NULL AND evaluator_set_version IS NULL AND evaluator_set_hash IS NULL
    AND evidence_snapshot IS NULL AND evidence_hash IS NULL AND source_observed_at IS NULL AND observation_kind IS NULL)
  OR (evaluator_set_id IS NOT NULL AND evaluator_set_version IS NOT NULL AND evaluator_set_hash IS NOT NULL
    AND tenant_id IS NULL AND work_id IS NULL AND task_subject_ref IS NOT NULL AND evidence_snapshot IS NOT NULL AND source_observed_at IS NOT NULL
    AND (evidence_snapshot->>'id'=task_subject_ref::text) IS TRUE
    AND observation_kind IS NOT NULL AND observation_kind IN('observation','replay') AND evidence_hash IS NOT NULL
    AND evidence_hash=encode(pg_catalog.sha256(convert_to(evidence_snapshot::text,'UTF8')),'hex'))
);
ALTER TABLE public.paige_eval_run DROP CONSTRAINT IF EXISTS paige_eval_run_evaluator_set_fk;
ALTER TABLE public.paige_eval_run ADD CONSTRAINT paige_eval_run_evaluator_set_fk
  FOREIGN KEY(evaluator_set_id,evaluator_set_version,evaluator_set_hash)
  REFERENCES public.paige_eval_evaluator_set(id,version,definition_hash) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS paige_eval_run_task_set_time_idx
  ON public.paige_eval_run(evaluator_set_id,evaluator_set_version,created_at DESC,id DESC)
  WHERE evaluator_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS paige_eval_run_task_subject_time_idx
  ON public.paige_eval_run(task_subject_ref,created_at DESC,id DESC) WHERE evaluator_set_id IS NOT NULL;
ALTER TABLE public.paige_eval_result
  ADD COLUMN IF NOT EXISTS task_verdict text,
  ADD COLUMN IF NOT EXISTS evaluator_version text,
  ADD COLUMN IF NOT EXISTS evidence_state text;
ALTER TABLE public.paige_eval_result DROP CONSTRAINT IF EXISTS paige_eval_result_task_verdict_ck;
ALTER TABLE public.paige_eval_result ADD CONSTRAINT paige_eval_result_task_verdict_ck CHECK (
  (task_verdict IS NULL AND evaluator_version IS NULL AND evidence_state IS NULL)
  OR (task_verdict IS NOT NULL AND task_verdict IN('pass','fail','indeterminate','not_applicable') AND evaluator_version IS NOT NULL
    AND tenant_id IS NULL AND scorer_kind='deterministic' AND judge_model IS NULL
    AND evidence_state IS NOT NULL AND evidence_state IN('complete','missing','stale','partial','conflicting','unrelated','unavailable')
    AND ((task_verdict='pass' AND score IS NOT NULL AND score=1 AND passed IS TRUE AND status='scored')
      OR (task_verdict='fail' AND score IS NOT NULL AND score=0 AND passed IS FALSE AND status='scored')
      OR (task_verdict IN('indeterminate','not_applicable') AND score IS NULL AND passed IS NULL AND status='needs_config')))
);

CREATE OR REPLACE FUNCTION public._guard_paige_task_evaluation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE protected boolean; owner_name name;
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'task_evaluation_bulk_erasure_refused' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='paige_eval_evaluator_set' THEN
    IF TG_OP IN('UPDATE','DELETE') THEN RAISE EXCEPTION 'evaluator_definition_immutable' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='paige_eval_run' THEN
    protected:=CASE WHEN TG_OP='DELETE' THEN OLD.evaluator_set_id IS NOT NULL
      WHEN TG_OP='INSERT' THEN NEW.evaluator_set_id IS NOT NULL
      ELSE OLD.evaluator_set_id IS NOT NULL OR NEW.evaluator_set_id IS NOT NULL END;
  ELSE
    -- A result cannot escape protection by clearing its verdict or changing its run.
    protected:=CASE WHEN TG_OP='DELETE' THEN OLD.task_verdict IS NOT NULL
      WHEN TG_OP='INSERT' THEN NEW.task_verdict IS NOT NULL
      ELSE OLD.task_verdict IS NOT NULL OR NEW.task_verdict IS NOT NULL END;
    IF TG_OP<>'INSERT' THEN
      protected:=protected OR EXISTS(SELECT 1 FROM public.paige_eval_run WHERE id=OLD.run_id AND evaluator_set_id IS NOT NULL);
    END IF;
    IF TG_OP<>'DELETE' THEN
      protected:=protected OR EXISTS(SELECT 1 FROM public.paige_eval_run WHERE id=NEW.run_id AND evaluator_set_id IS NOT NULL);
    END IF;
  END IF;
  IF protected THEN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'task_evaluation_immutable' USING ERRCODE='55000'; END IF;
    SELECT pg_catalog.pg_get_userbyid(proowner) INTO owner_name FROM pg_catalog.pg_proc
      WHERE oid='public.operator_intelligence_evaluate_task(uuid,text,uuid,uuid)'::regprocedure;
    IF current_user IS DISTINCT FROM owner_name THEN RAISE EXCEPTION 'task_evaluation_server_only' USING ERRCODE='42501'; END IF;
    IF TG_TABLE_NAME='paige_eval_result' THEN
      IF NEW.task_verdict IS NULL OR NOT EXISTS(
        SELECT 1 FROM public.paige_eval_run WHERE id=NEW.run_id AND evaluator_set_id IS NOT NULL) THEN
        RAISE EXCEPTION 'task_result_run_required' USING ERRCODE='22023';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._guard_paige_task_evaluation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_eval_definition_immutable ON public.paige_eval_evaluator_set;
CREATE TRIGGER trg_paige_eval_definition_immutable BEFORE UPDATE OR DELETE ON public.paige_eval_evaluator_set
  FOR EACH ROW EXECUTE FUNCTION public._guard_paige_task_evaluation();
DROP TRIGGER IF EXISTS trg_paige_eval_task_run_immutable ON public.paige_eval_run;
CREATE TRIGGER trg_paige_eval_task_run_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.paige_eval_run
  FOR EACH ROW EXECUTE FUNCTION public._guard_paige_task_evaluation();
DROP TRIGGER IF EXISTS trg_paige_eval_task_result_immutable ON public.paige_eval_result;
CREATE TRIGGER trg_paige_eval_task_result_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.paige_eval_result
  FOR EACH ROW EXECUTE FUNCTION public._guard_paige_task_evaluation();
-- TRUNCATE bypasses row triggers and RLS. Ordinary legacy Eval DML remains available.
REVOKE TRUNCATE ON public.paige_eval_run,public.paige_eval_result FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_paige_eval_task_run_bulk_erasure ON public.paige_eval_run;
CREATE TRIGGER trg_paige_eval_task_run_bulk_erasure BEFORE TRUNCATE ON public.paige_eval_run
  FOR EACH STATEMENT EXECUTE FUNCTION public._guard_paige_task_evaluation();
DROP TRIGGER IF EXISTS trg_paige_eval_task_result_bulk_erasure ON public.paige_eval_result;
CREATE TRIGGER trg_paige_eval_task_result_bulk_erasure BEFORE TRUNCATE ON public.paige_eval_result
  FOR EACH STATEMENT EXECUTE FUNCTION public._guard_paige_task_evaluation();

-- Private deterministic implementation. Input is only a protected server snapshot.
CREATE OR REPLACE FUNCTION public._paige_task_evaluator_verdicts(p jsonb,set_version text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE results jsonb:='[]'; verdict text:='indeterminate'; evidence text:='missing'; reason text:='source_incomplete';
  supported boolean; limited boolean; events jsonb; last_event jsonb; valid_history boolean;
BEGIN
  IF set_version NOT IN('1.0.0','1.1.0') OR set_version IS NULL THEN RAISE EXCEPTION 'unsupported_evaluator_set' USING ERRCODE='22023'; END IF;
  supported:=((p->>'capability_key')||':'||(p->>'category')) IN('document_generate:document_authoring','deep_research:research');
  limited:=EXISTS(SELECT 1 FROM jsonb_each(COALESCE(p->'limit_reached','{}')) WHERE value='true'::jsonb);
  IF p->'scope_consistent' IS DISTINCT FROM 'true'::jsonb OR p->>'contract_version' IS DISTINCT FROM '1' THEN
    evidence:='unrelated'; reason:='scope_or_contract_unproven';
  ELSIF supported IS NULL THEN reason:='task_category_unknown';
  ELSIF NOT supported THEN verdict:='not_applicable';evidence:='complete';reason:='outside_terminal_definition';
  ELSIF p->'receipt_conflict'='true'::jsonb THEN evidence:='conflicting';reason:='current_receipts_conflict';
  ELSIF p->>'work_state' IN('failed','cancelled') THEN verdict:='fail';evidence:='complete';reason:='canonical_task_failed_or_cancelled';
  ELSIF p->'limit_reached'->'receipts'='true'::jsonb OR p->'limit_reached'->'executions'='true'::jsonb OR p->'limit_reached'->'approvals'='true'::jsonb THEN
    evidence:='partial';reason:='terminal_source_limit';
  ELSIF p->>'work_state'='succeeded' AND p->'terminal_verified'='true'::jsonb THEN
    verdict:='pass';evidence:='complete';reason:='canonical_receipt_and_destination_verified';
  ELSE reason:='terminal_condition_unverified'; END IF;
  results:=results||jsonb_build_array(jsonb_build_object('scorer','terminal_evidence','version','1.0.0','verdict',verdict,'evidence',evidence,'reason',reason));

  verdict:='indeterminate';evidence:='missing';reason:='history_incomplete';
  events:=CASE WHEN jsonb_typeof(p->'history'->'events')='array' THEN p->'history'->'events' ELSE '[]'::jsonb END;
  last_event:=events->-1;
  IF p->'scope_consistent' IS DISTINCT FROM 'true'::jsonb OR p->>'contract_version' IS DISTINCT FROM '1' THEN
    evidence:='unrelated';reason:='scope_or_contract_unproven';
  ELSIF limited OR p->'history'->'truncated'='true'::jsonb THEN evidence:='partial';reason:='source_or_history_truncated';
  ELSIF p->'history'->'complete'='true'::jsonb AND p->'history'->>'version'='1' AND jsonb_array_length(events)>0 THEN
    -- The canonical envelope is accepted by inserting its initial claimed lease.
    valid_history:=(events->0->>'state'='claimed' AND events->0->>'version'='1'
      AND last_event->>'state'=p->>'work_state' AND last_event->'attempt'=p->'attempt'
      AND last_event->'dispatch_attempt' IS NOT DISTINCT FROM p->'dispatch_attempt'
      AND NOT EXISTS(SELECT 1 FROM (
        SELECT e,lag((e->>'version')::bigint) OVER(ORDER BY ord) AS prior FROM jsonb_array_elements(events) WITH ORDINALITY a(e,ord)
      ) h WHERE (e->>'version')::bigint<1 OR (e->>'version')::bigint>(p->>'work_version')::bigint
        OR (prior IS NOT NULL AND (e->>'version')::bigint<=prior)));
    evidence:='complete';verdict:=CASE WHEN valid_history IS TRUE THEN 'pass' ELSE 'fail' END;reason:='bounded_history_consistency';
  END IF;
  results:=results||jsonb_build_array(jsonb_build_object('scorer','trajectory_capture','version','1.0.0','verdict',verdict,'evidence',evidence,'reason',reason));
  -- No universal canonical requirement/current-attempt link yet. Never infer exemption.
  results:=results||jsonb_build_array(jsonb_build_object('scorer','approval_decision','version','1.0.0','verdict','indeterminate','evidence','unavailable','reason','approval_requirement_link_unavailable'));
  IF set_version='1.1.0' THEN
    verdict:='indeterminate';evidence:='missing';reason:='no_proven_model_calls';
    IF p->'scope_consistent' IS DISTINCT FROM 'true'::jsonb THEN evidence:='unrelated';reason:='scope_unproven';
    ELSIF p->'limit_reached'->'models'='true'::jsonb THEN evidence:='partial';reason:='model_source_truncated';
    ELSIF jsonb_array_length(p->'models')>0 THEN
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'models') m WHERE m->>'status' IS NULL OR m->>'status' NOT IN('success','error')) THEN
        evidence:='partial';reason:='model_status_unresolved';
      ELSE evidence:='complete';verdict:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p->'models') m WHERE m->>'status'='error') THEN 'fail' ELSE 'pass' END;reason:='recorded_model_call_status'; END IF;
    END IF;
    results:=results||jsonb_build_array(jsonb_build_object('scorer','model_call_status','version','1.0.0','verdict',verdict,'evidence',evidence,'reason',reason));
  END IF;
  RETURN results;
END $$;
REVOKE ALL ON FUNCTION public._paige_task_evaluator_verdicts(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve only source-proven model participants. A roster version observed now
-- is NOT proof of the agent configuration used at execution. No names/prompts/config.
CREATE OR REPLACE FUNCTION public._paige_task_evaluation_source(work_ref uuid,subject_tenant uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
  WITH source AS MATERIALIZED(
    SELECT public.operator_intelligence_trajectories(p_work_id=>work_ref,p_subject_tenant=>subject_tenant)->'items'->0 AS p
  ), attribution AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('trace_ref',t.id,'agent_ref',a.slug,
      'roster_version_at_observation',a.version,'execution_agent_version','unavailable') ORDER BY t.id),'[]'::jsonb) AS refs
    FROM source CROSS JOIN LATERAL jsonb_array_elements(p->'models') m
    JOIN public.paige_llm_trace t ON t.id::text=m->>'id' AND t.tenant_id=subject_tenant
      AND t.retired_working_context_tenant_id IS NULL AND (t.working_context_tenant_id IS NULL OR t.working_context_tenant_id=subject_tenant)
    JOIN public.paige_subagents a ON a.slug=t.agent_id AND (a.tenant_id IS NULL OR a.tenant_id=subject_tenant)
  ) SELECT (p-'evaluations')||jsonb_build_object('limits',(p->'limits')-'evaluations','limit_reached',(p->'limit_reached')-'evaluations',
    'agent_attribution',refs,'unassigned_model_calls',(p->>'model_count')::integer-jsonb_array_length(refs),
    'agent_attribution_basis','recorded_model_participants_not_task_ownership') FROM source,attribution
$$;
REVOKE ALL ON FUNCTION public._paige_task_evaluation_source(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_intelligence_evaluate_task(
  p_work_id uuid DEFAULT NULL,p_set_version text DEFAULT '1.0.0',p_replay_run_id uuid DEFAULT NULL,p_subject_tenant uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work%rowtype; prior public.paige_eval_run%rowtype; definition public.paige_eval_evaluator_set%rowtype;
  snapshot jsonb; recheck jsonb; observed timestamptz; verdicts jsonb; r jsonb; run_ref uuid:=gen_random_uuid(); hash text;
  resolved integer; exclusions integer; passed_count integer; result_refs jsonb:='[]'; result_ref uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL OR public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE='42501'; END IF;
  IF (p_work_id IS NULL)=(p_replay_run_id IS NULL) THEN RAISE EXCEPTION 'one_task_or_replay_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO definition FROM public.paige_eval_evaluator_set WHERE id='durable-task-evidence' AND version=p_set_version;
  IF NOT FOUND OR definition.definition_hash IS DISTINCT FROM (CASE p_set_version
    WHEN '1.0.0' THEN '544cbea0003813658b179144833d1863c1150ad01694cccbefb6cee3ac61b05c'
    WHEN '1.1.0' THEN '2e2615068b05d5b664588257eb67da4e520b1a63c5cfa7f2f7cfc0a70dac7cae' END) THEN
    RAISE EXCEPTION 'unsupported_evaluator_set' USING ERRCODE='22023'; END IF;
  IF p_replay_run_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.paige_eval_run WHERE id=p_replay_run_id AND evaluator_set_id='durable-task-evidence';
    IF NOT FOUND THEN RAISE EXCEPTION 'task_evidence_unavailable' USING ERRCODE='22023'; END IF;
    p_work_id:=prior.task_subject_ref;
  END IF;
  SELECT * INTO w FROM public.paige_durable_work WHERE id=p_work_id AND (p_subject_tenant IS NULL OR tenant_id=p_subject_tenant) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_evidence_unavailable' USING ERRCODE='22023'; END IF;
  -- This is internal evidence storage, not authority to execute the subject's task.
  INSERT INTO public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,payload)
    VALUES(NULL,auth.uid(),'operator','god_view.fleet_query','intelligence_task_evaluation',
      jsonb_build_object('work_ref',w.id,'set_version',p_set_version,'replay_ref',p_replay_run_id,'run_ref',run_ref));
  IF p_replay_run_id IS NOT NULL THEN snapshot:=prior.evidence_snapshot;observed:=prior.source_observed_at;
  ELSE
    snapshot:=public._paige_task_evaluation_source(w.id,w.tenant_id);
    observed:=clock_timestamp();
    recheck:=public._paige_task_evaluation_source(w.id,w.tenant_id);
    IF snapshot IS DISTINCT FROM recheck THEN RAISE EXCEPTION 'task_evidence_changed_retry' USING ERRCODE='40001'; END IF;
  END IF;
  IF snapshot->>'id' IS DISTINCT FROM w.id::text OR snapshot->>'contract_version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'task_evidence_unavailable' USING ERRCODE='22023'; END IF;
  hash:=encode(pg_catalog.sha256(convert_to(snapshot::text,'UTF8')),'hex');
  IF p_replay_run_id IS NOT NULL AND hash IS DISTINCT FROM prior.evidence_hash THEN RAISE EXCEPTION 'task_evidence_hash_mismatch' USING ERRCODE='55000'; END IF;
  verdicts:=public._paige_task_evaluator_verdicts(snapshot,p_set_version);
  SELECT count(*) FILTER(WHERE v->>'verdict' IN('pass','fail')),count(*) FILTER(WHERE v->>'verdict'='not_applicable'),count(*) FILTER(WHERE v->>'verdict'='pass')
    INTO resolved,exclusions,passed_count FROM jsonb_array_elements(verdicts) v;
  INSERT INTO public.paige_eval_run(id,tenant_id,task_subject_ref,target_kind,target_ref,target_version,status,scorer_set,
    case_count,scored_count,degraded_count,aggregate_score,pass_rate,cost_estimate_usd,prev_run_id,created_by,completed_at,
    evaluator_set_id,evaluator_set_version,evaluator_set_hash,evidence_snapshot,evidence_hash,source_observed_at,observation_kind)
  VALUES(run_ref,NULL,w.id,'job_kind',w.capability_key,snapshot->>'work_version','complete',ARRAY(SELECT v->>'scorer' FROM jsonb_array_elements(verdicts) v),
    jsonb_array_length(verdicts),resolved,jsonb_array_length(verdicts)-resolved,NULL,NULL,0,p_replay_run_id,auth.uid(),clock_timestamp(),
    definition.id,definition.version,definition.definition_hash,snapshot,hash,observed,CASE WHEN p_replay_run_id IS NULL THEN 'observation' ELSE 'replay' END);
  FOR r IN SELECT value FROM jsonb_array_elements(verdicts) LOOP
    INSERT INTO public.paige_eval_result(run_id,tenant_id,scorer,scorer_kind,score,passed,status,rationale,cost_estimate_usd,task_verdict,evaluator_version,evidence_state)
    VALUES(run_ref,NULL,r->>'scorer','deterministic',CASE r->>'verdict' WHEN 'pass' THEN 1 WHEN 'fail' THEN 0 END,
      CASE r->>'verdict' WHEN 'pass' THEN true WHEN 'fail' THEN false END,CASE WHEN r->>'verdict' IN('pass','fail') THEN 'scored' ELSE 'needs_config' END,
      r->>'reason',0,r->>'verdict',r->>'version',r->>'evidence') RETURNING id INTO result_ref;
    result_refs:=result_refs||jsonb_build_array(r||jsonb_build_object('result_ref',result_ref));
  END LOOP;
  RETURN jsonb_build_object('run_ref',run_ref,'work_ref',w.id,'mode',CASE WHEN p_replay_run_id IS NULL THEN 'observation' ELSE 'replay' END,
    'source_observed_at',observed,'source_consistency','bounded_double_read_not_atomic','set',jsonb_build_object('id',definition.id,'version',definition.version,'hash',definition.definition_hash),
    'input_hash',hash,'results',result_refs,'summary',jsonb_build_object('total',jsonb_array_length(verdicts),'pass',passed_count,'fail',resolved-passed_count,
      'indeterminate',jsonb_array_length(verdicts)-resolved-exclusions,'not_applicable',exclusions,'resolved',resolved,
      'coverage_denominator',jsonb_array_length(verdicts)-exclusions,'coverage',resolved::numeric/NULLIF(jsonb_array_length(verdicts)-exclusions,0),
      'criterion_pass_rate',passed_count::numeric/NULLIF(resolved,0)));
END $$;
REVOKE ALL ON FUNCTION public.operator_intelligence_evaluate_task(uuid,text,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_intelligence_evaluate_task(uuid,text,uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.operator_intelligence_evaluate_task(uuid,text,uuid,uuid) IS
 'INT-280 Operator-only audited deterministic observation/replay. Three/four immutable criteria, existing platform Eval rows, no raw tenant content, model/provider call or task execution. Historical replay is not current destination verification. Bounded double-read detects observed drift; no atomic cross-source snapshot claim.';
