-- INT-280 AI-1C. Read-only observation over canonical records; no customer content projection.
CREATE OR REPLACE FUNCTION public.operator_intelligence_trajectories(
  p_limit integer DEFAULT 25, p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL, p_work_id uuid DEFAULT NULL,
  p_trace_id uuid DEFAULT NULL, p_subject_tenant uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE lim integer := LEAST(GREATEST(COALESCE(p_limit,25),1),50); items jsonb := '[]';
  w public.paige_durable_work%rowtype; models jsonb; receipts jsonb; acts jsonb; approvals jsonb;
  turns jsonb; evals jsonb; readback boolean; artifact uuid; history jsonb; total_models bigint;
  receipt_conflict boolean; scope_ok boolean; next_at timestamptz; next_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL OR public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE='42501';
  END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'trajectory_cursor_pair_required' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,payload)
  VALUES(NULL,auth.uid(),'operator','god_view.fleet_query','intelligence_trajectories',
    jsonb_build_object('limit',lim,'work_ref',p_work_id,'trace_ref',p_trace_id,'filtered_scope',p_subject_tenant IS NOT NULL));
  FOR w IN SELECT work.* FROM public.paige_durable_work work
    WHERE (p_work_id IS NULL OR work.id=p_work_id)
      AND (p_subject_tenant IS NULL OR work.tenant_id=p_subject_tenant)
      AND (p_before_at IS NULL OR (work.created_at,work.id)<(p_before_at,p_before_id))
      AND (p_trace_id IS NULL OR EXISTS (
        SELECT 1 FROM public.paige_llm_trace t WHERE t.id=p_trace_id AND t.tenant_id=work.tenant_id
          AND t.retired_working_context_tenant_id IS NULL
          AND (t.working_context_tenant_id IS NULL OR t.working_context_tenant_id=work.tenant_id)
          AND ((t.task_id=work.id::text AND t.metadata->>'caller_function'='paige-document-worker' AND work.capability_key='document_generate')
            OR (t.metadata->>'caller_function'='paige-deep-research' AND EXISTS (
              SELECT 1 FROM public.research_runs r WHERE r.id::text=t.task_id AND r.work_id=work.id AND r.tenant_id=work.tenant_id AND r.user_id=work.initiating_user_id)))))
    ORDER BY work.created_at DESC,work.id DESC LIMIT lim
  LOOP
    scope_ok := w.thread_id IS NULL OR EXISTS(SELECT 1 FROM public.paige_chat_threads th WHERE th.id=w.thread_id AND th.tenant_id=w.tenant_id AND th.caller_user_id=w.initiating_user_id);
    -- A text task_id alone is not a trusted relation: require known server producer and subject.
    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id),'[]'),max(m.full_count)
    INTO models,total_models FROM (
      SELECT t.id,t.created_at,t.provider,t.model,t.tier,t.status,t.router_version,
        t.tokens_in,t.tokens_out,t.latency_ms,t.cost_estimate_usd,t.cost_basis,
        t.cache_read_input_tokens,t.cache_creation_input_tokens,
        CASE WHEN t.metadata->>'route_requested_class' IN('luna','sol','astra') THEN t.metadata->>'route_requested_class' ELSE NULL END AS route_class,
        t.metadata->>'route_served_provider' AS route_provider,
        t.metadata->>'route_served_model' AS route_model,
        CASE WHEN t.metadata->'route_fallback' IN ('true'::jsonb,'false'::jsonb) THEN t.metadata->'route_fallback' ELSE NULL END AS route_fallback,
        count(*) OVER() AS full_count
      FROM public.paige_llm_trace t WHERE t.tenant_id=w.tenant_id
        AND t.retired_working_context_tenant_id IS NULL
        AND (t.working_context_tenant_id IS NULL OR t.working_context_tenant_id=w.tenant_id)
        AND ((t.task_id=w.id::text AND t.metadata->>'caller_function'='paige-document-worker' AND w.capability_key='document_generate')
          OR (t.metadata->>'caller_function'='paige-deep-research' AND EXISTS(
            SELECT 1 FROM public.research_runs r WHERE r.id::text=t.task_id AND r.work_id=w.id AND r.tenant_id=w.tenant_id AND r.user_id=w.initiating_user_id)))
      ORDER BY t.created_at,t.id LIMIT 100
    ) m;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.occurred_at,r.id),'[]') INTO receipts FROM (
      SELECT e.id,e.occurred_at,e.outcome,e.capability_key,
        CASE WHEN e.job_attempt_id=w.id::text||':'||w.attempt_count::text THEN w.attempt_count ELSE NULL END AS attempt,
        e.llm_trace_id,e.release_id
      FROM public.paige_workspace_events e WHERE e.source_kind='capability_run' AND e.source_id=w.id
        AND e.tenant_id=w.tenant_id AND e.actor_id=w.initiating_user_id AND e.capability_key=w.capability_key
      ORDER BY e.occurred_at,e.id LIMIT 100
    ) r;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.decided_at,a.id),'[]') INTO acts FROM (
      SELECT x.id,x.capability_key,x.outcome,x.effective_lane,x.decided_at,x.dispatched_at,x.settled_at,
        x.provider_ref IS NOT NULL AS provider_reference_recorded
      FROM public.paige_act_executions x WHERE x.work_id=w.id AND x.tenant_id=w.tenant_id ORDER BY x.decided_at,x.id LIMIT 100
    ) a;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id),'[]') INTO approvals FROM (
      SELECT q.id,CASE WHEN q.status IN('pending','approved','rejected','expired','failed','sent') THEN q.status ELSE 'unknown' END AS status,q.created_at,q.reviewed_at
      FROM public.paige_pending_approvals q WHERE q.tenant_id=w.tenant_id AND q.source='paige_orchestration' AND q.metadata->>'source'='paige_orchestration'
        AND EXISTS(SELECT 1 FROM public.paige_act_executions x WHERE x.work_id=w.id AND x.tenant_id=w.tenant_id
          AND q.metadata->>'event_id'=x.event_id::text AND q.metadata->>'act_id'=x.act_id::text AND q.metadata->>'act_execution_id'=x.id::text)
      ORDER BY q.created_at,q.id LIMIT 100
    ) a;
    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at,c.id),'[]') INTO turns FROM (
      SELECT c.id,c.role,c.created_at,c.interactive_intent_id AS intent_ref,c.interactive_terminal_state AS processing_state
      FROM public.paige_chat_turns c WHERE c.thread_id=w.thread_id AND scope_ok
        AND (c.work_id=w.id OR (c.role='user' AND c.interactive_actor_id=w.initiating_user_id AND c.interactive_tenant_id=w.tenant_id AND EXISTS(
          SELECT 1 FROM public.paige_chat_turns accepted WHERE accepted.thread_id=w.thread_id AND accepted.role='assistant'
            AND accepted.interactive_actor_id=w.initiating_user_id AND accepted.interactive_tenant_id=w.tenant_id
            AND accepted.interactive_intent_id=c.interactive_intent_id AND accepted.interactive_terminal_state IS NOT NULL
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(accepted.bundle_ref->'interactive'->'effects')='array' THEN accepted.bundle_ref->'interactive'->'effects' ELSE '[]'::jsonb END) e
              WHERE e->>'work_id'=w.id::text AND e->>'outcome'='durable_accepted' AND e->>'tool'=w.capability_key)))
          OR (c.interactive_actor_id=w.initiating_user_id AND c.interactive_tenant_id=w.tenant_id AND c.role='assistant' AND c.interactive_terminal_state IS NOT NULL
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.bundle_ref->'interactive'->'effects')='array' THEN c.bundle_ref->'interactive'->'effects' ELSE '[]'::jsonb END) e
            WHERE e->>'work_id'=w.id::text AND e->>'outcome'='durable_accepted' AND e->>'tool'=w.capability_key)))
      ORDER BY c.created_at,c.id LIMIT 100
    ) c;
    SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]') INTO evals FROM (
      SELECT r.id,r.run_id,r.source_trace_id,r.scorer,r.status,r.score,r.passed,r.created_at
      FROM public.paige_eval_result r JOIN public.paige_eval_run run ON run.id=r.run_id AND run.tenant_id=w.tenant_id
      WHERE r.tenant_id=w.tenant_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(models) m WHERE m->>'id'=r.source_trace_id::text)
      ORDER BY r.created_at,r.id LIMIT 100
    ) e;
    -- Source flags and assistant content are never sufficient. Check the actual current destination.
    readback := false; artifact := NULL;
    IF scope_ok AND w.status='succeeded' AND w.terminal_outcome->'verified_readback'='true'::jsonb
       AND w.settled_at BETWEEN w.created_at AND now() AND w.capability_key='document_generate' THEN
      SELECT count(*)=1 INTO readback FROM public.marketing_content m WHERE m.work_id=w.id;
      readback := readback AND EXISTS(SELECT 1 FROM public.marketing_content m WHERE m.work_id=w.id AND m.tenant_id=w.tenant_id
        AND m.id::text=w.terminal_outcome->>'content_id' AND m.document_revision::text=w.terminal_outcome->>'document_revision' AND m.kind='document');
      IF readback THEN
        BEGIN
          readback := EXISTS(SELECT 1 FROM public.marketing_content m WHERE m.work_id=w.id AND nullif(btrim(m.title),'') IS NOT NULL
            AND char_length(m.title)<=200 AND m.body::jsonb->>'title'=m.title
            AND m.body::jsonb->>'docType' IN('guide','one_pager','ebook','checklist','worksheet','proposal','offer_letter','sales_offer','agreement_draft')
            AND jsonb_typeof(m.body::jsonb->'blocks')='array' AND jsonb_array_length(m.body::jsonb->'blocks') BETWEEN 1 AND 80
            AND pg_column_size(m.body::jsonb->'blocks')<=2097152)
            AND (SELECT count(*) FROM public.paige_chat_turns c WHERE c.work_id=w.id)=1
            AND EXISTS(SELECT 1 FROM public.paige_chat_turns c WHERE c.work_id=w.id AND c.thread_id=w.thread_id AND c.role='assistant'
              AND c.id::text=w.terminal_outcome->>'completion_turn_id' AND EXISTS(
                SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.bundle_ref->'paige_artifact')='array' THEN c.bundle_ref->'paige_artifact' ELSE '[]'::jsonb END) a
                WHERE a->>'id'=w.terminal_outcome->>'content_id' AND a->>'tenant_id'=w.tenant_id::text AND a->>'artifactType'='document'));
        EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN readback:=false;
        END;
      END IF;
      IF readback THEN artifact:=(w.terminal_outcome->>'content_id')::uuid; END IF;
    END IF;
    -- Existing durable-observation research predicate. This does not enable its executor.
    IF scope_ok AND w.status='succeeded' AND w.terminal_outcome->'verified_readback'='true'::jsonb
       AND w.settled_at BETWEEN w.created_at AND now() AND w.capability_key='deep_research' AND w.work_kind='research' THEN
      SELECT count(*)=1 INTO readback FROM public.research_runs r WHERE r.work_id=w.id;
      readback := readback AND EXISTS(SELECT 1 FROM public.research_runs r WHERE r.work_id=w.id AND r.tenant_id=w.tenant_id
        AND r.user_id=w.initiating_user_id AND r.id::text=w.terminal_outcome->>'run_id' AND r.question=w.request_payload->>'question'
        AND r.configured AND r.stop_reason='answered' AND r.coverage->>'stop_reason'='answered' AND r.coverage->'configured'='true'::jsonb
        AND CASE WHEN jsonb_typeof(r.findings)='array' THEN jsonb_array_length(r.findings)>0 ELSE false END);
      IF readback THEN
        artifact := (w.terminal_outcome->>'run_id')::uuid;
        readback := NOT EXISTS(SELECT 1 FROM public.research_sources s WHERE s.run_id=artifact
          AND (s.tenant_id IS DISTINCT FROM w.tenant_id OR s.user_id IS DISTINCT FROM w.initiating_user_id OR s.source_index IS NULL OR s.source_index<1))
          AND NOT EXISTS(SELECT 1 FROM public.research_sources s WHERE s.run_id=artifact GROUP BY s.source_index HAVING count(*)>1)
          AND NOT EXISTS(SELECT 1 FROM public.research_runs r CROSS JOIN LATERAL jsonb_array_elements(r.findings) f WHERE r.id=artifact
            AND (jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(f->'text') IS DISTINCT FROM 'string'
              OR nullif(btrim(f->>'text'),'') IS NULL OR jsonb_typeof(f->'citations') IS DISTINCT FROM 'array'
              OR CASE WHEN jsonb_typeof(f->'citations')='array' THEN jsonb_array_length(f->'citations')=0 ELSE true END))
          AND NOT EXISTS(SELECT 1 FROM public.research_runs r CROSS JOIN LATERAL jsonb_array_elements(r.findings) f
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f->'citations')='array' THEN f->'citations' ELSE '[]'::jsonb END) c WHERE r.id=artifact
            AND NOT EXISTS(SELECT 1 FROM public.research_sources s WHERE s.run_id=artifact AND s.tenant_id=w.tenant_id
              AND s.user_id=w.initiating_user_id AND NOT s.excluded AND s.url~'^https?://' AND to_jsonb(s.source_index)=c));
      END IF;
    END IF;
    receipt_conflict := EXISTS(SELECT 1 FROM public.paige_workspace_events e WHERE e.source_kind='capability_run' AND e.source_id=w.id
      AND e.tenant_id=w.tenant_id AND e.actor_id=w.initiating_user_id AND e.capability_key=w.capability_key
      AND e.job_attempt_id=w.id::text||':'||w.attempt_count::text AND e.outcome<>'capability_succeeded');
    -- Verification remains separate from execution state. Receipt must name this exact readback.
    readback := readback AND NOT receipt_conflict AND EXISTS(
      SELECT 1 FROM public.paige_workspace_events e WHERE e.source_kind='capability_run' AND e.source_id=w.id
        AND e.tenant_id=w.tenant_id AND e.actor_id=w.initiating_user_id AND e.capability_key=w.capability_key
        AND e.job_attempt_id=w.id::text||':'||w.attempt_count::text AND e.outcome='capability_succeeded'
        AND e.detail->'verified_readback'='true'::jsonb AND e.detail->>'work_id'=w.id::text
        AND ((w.capability_key='document_generate' AND e.detail->>'content_id'=w.terminal_outcome->>'content_id'
          AND e.detail->>'document_revision'=w.terminal_outcome->>'document_revision')
          OR (w.capability_key='deep_research' AND e.detail->>'run_id'=w.terminal_outcome->>'run_id')))
      AND NOT EXISTS(SELECT 1 FROM public.paige_act_executions x WHERE x.work_id=w.id AND (x.tenant_id IS DISTINCT FROM w.tenant_id OR x.outcome NOT IN('executed','condition_not_matched')))
      AND NOT EXISTS(SELECT 1 FROM public.paige_pending_approvals q WHERE q.tenant_id=w.tenant_id AND q.status NOT IN('approved','sent') AND q.source='paige_orchestration' AND q.metadata->>'source'='paige_orchestration'
        AND EXISTS(SELECT 1 FROM public.paige_act_executions x WHERE x.work_id=w.id AND x.tenant_id=w.tenant_id AND q.metadata->>'event_id'=x.event_id::text AND q.metadata->>'act_id'=x.act_id::text AND q.metadata->>'act_execution_id'=x.id::text));
    history:=COALESCE(w.trajectory_history,jsonb_build_object('version',1,'complete',false,'truncated',false,'events','[]'::jsonb));
    items:=items||jsonb_build_array(jsonb_build_object('id',w.id,'contract_version',1,'work_version',w.version,
      'category',CASE WHEN w.work_kind IN('document_authoring','research','knowledge_extraction','knowledge_publication','evaluation','reconciliation','campaign_delivery') THEN w.work_kind ELSE 'other_recorded_work' END,
      'capability_key',w.capability_key,'thread_ref',CASE WHEN scope_ok THEN w.thread_id ELSE NULL END,'intent_ref',w.intent_id,
      'work_state',w.status,'attempt',w.attempt_count,'dispatch_attempt',w.dispatch_started_attempt,
      'created_at',w.created_at,'updated_at',w.updated_at,'settled_at',w.settled_at,
      'scope_consistent',scope_ok,'terminal_condition',CASE WHEN w.capability_key='document_generate' THEN 'artifact' WHEN w.capability_key='deep_research' AND w.work_kind='research' THEN 'read_only' ELSE 'unavailable' END,
      'terminal_verified',COALESCE(readback,false),'artifact_ref',CASE WHEN readback THEN artifact ELSE NULL END,'receipt_conflict',receipt_conflict,
      'history',history,'models',models,'model_count',COALESCE(total_models,0),'receipts',receipts,'executions',acts,'approvals',approvals,'turns',turns,'evaluations',evals,
      'limits',jsonb_build_object('models',100,'receipts',100,'executions',100,'approvals',100,'turns',100,'evaluations',100),
      'limit_reached',jsonb_build_object('models',COALESCE(total_models,0)>100,'receipts',jsonb_array_length(receipts)=100,'executions',jsonb_array_length(acts)=100,'approvals',jsonb_array_length(approvals)=100,'turns',jsonb_array_length(turns)=100,'evaluations',jsonb_array_length(evals)=100),
      'coverage',jsonb_build_object('objective_content','private','cross_work_parent','unavailable','business_outcome','unavailable','full_runtime_fingerprint','partial',
        'research_execution','unavailable','historical_unlinked_records','excluded')));
    next_at:=w.created_at; next_id:=w.id;
  END LOOP;
  RETURN jsonb_build_object('contract_version',1,'observed_at',now(),'items',items,
    'next_cursor',CASE WHEN jsonb_array_length(items)=lim AND p_work_id IS NULL AND p_trace_id IS NULL THEN jsonb_build_object('at',next_at,'id',next_id) ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.operator_intelligence_trajectories(integer,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_intelligence_trajectories(integer,timestamptz,uuid,uuid,uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.operator_intelligence_trajectories(integer,timestamptz,uuid,uuid,uuid,uuid) IS
 'INT-280 audited Operator metadata-only task projection; 50 work rows and100source references each; server-proven trace links, exact scoped readbacks, no transcript, document, authority, approval payload or executor.';
