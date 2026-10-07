BEGIN;

-- Private read producer. The shared evidence issuer/resolver owns reference issuance.
-- Facts below deliberately project no names, addresses, prompts, URLs, errors or payloads.
CREATE OR REPLACE FUNCTION public._settings_analytics_metric_bundle(
  p_tenant_id uuid, p_metric_id text, p_metric_version text,
  p_range_start timestamptz, p_range_end timestamptz, p_as_of timestamptz,
  p_dimensions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $function$
DECLARE
  actor uuid := auth.uid();
  source_name text;
  definition text;
  formula text;
  unit_name text := 'count';
  facts jsonb := '[]'::jsonb;
  snapshot jsonb;
  safe_run jsonb;
  values_json jsonb;
  items jsonb;
  candidate_count bigint := 0;
  contributing_count bigint := 0;
  excluded_count bigint := 0;
  quantity numeric;
  through_at timestamptz;
  truth text := 'LIVE';
  caveats jsonb := '[]'::jsonb;
  unavailable_reason text;
  source_present boolean := false;
  current_snapshot boolean := false;
  revision text;
BEGIN
  -- Explicit seat checks intentionally do not use is_tenant_admin's operator fallback.
  IF actor IS NULL OR p_tenant_id IS NULL
     OR public.current_user_tenant_id() IS DISTINCT FROM p_tenant_id
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = actor AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now()))
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = actor AND p.active_tenant_id = p_tenant_id)
     OR NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id = actor
          AND m.tenant_id = p_tenant_id AND m.status = 'active' AND m.role::text IN ('owner','admin'))
     OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id
          AND t.status::text IN ('active','trial','past_due')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ANALYTICS_EVIDENCE_UNAVAILABLE';
  END IF;
  IF p_metric_id IS NULL OR p_metric_version IS NULL OR p_metric_version IS DISTINCT FROM '1.0.0'
     OR p_range_start IS NULL OR p_range_end IS NULL OR p_as_of IS NULL
     OR NOT pg_catalog.isfinite(p_range_start) OR NOT pg_catalog.isfinite(p_range_end)
     OR NOT pg_catalog.isfinite(p_as_of) OR p_range_start >= p_range_end
     OR p_range_end > p_as_of OR p_as_of > pg_catalog.clock_timestamp()
     OR p_range_start < p_as_of - interval '10 years'
     OR p_dimensions IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ANALYTICS_METRIC_ARGUMENTS_INVALID';
  END IF;

  CASE p_metric_id
  WHEN 'business.active_clients_current','business.onboarding_current','business.lifecycle_current' THEN
    source_name := 'public.clients'; current_snapshot := true;
    definition := CASE p_metric_id
      WHEN 'business.active_clients_current' THEN 'Current unmerged canonical clients with lifecycle client_active and recorded status active.'
      WHEN 'business.onboarding_current' THEN 'Current recorded onboarding stages of canonical clients with recorded onboarding instrumentation.'
      ELSE 'Current canonical client lifecycle: active, paused, churned, funded and alumni clients; excludes lead and sales stages.' END;
    formula := CASE p_metric_id WHEN 'business.active_clients_current'
      THEN 'Count tenant-owned unmerged client_active records with status active and updated_at <= as_of.'
      WHEN 'business.onboarding_current'
      THEN 'Distribute unmerged canonical clients with a recorded onboarding stage and started, completed or agreement-signed timestamp <= as_of; unknown instrumentation excluded.'
      ELSE 'Distribute unmerged tenant-owned client_active/client_paused/client_churned/client_funded/client_alumni records updated_at <= as_of.' END;
    IF p_metric_id='business.onboarding_current' THEN
      caveats := jsonb_build_array('Default pre_invite alone does not establish onboarding activity; clients without recorded instrumentation have unknown onboarding coverage.');
    END IF;
    IF pg_catalog.to_regclass(source_name) IS NOT NULL THEN
      source_present := true;
      EXECUTE $sql$SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'version',updated_at,'created_at',created_at,'status',status,
        'onboarding',onboarding_stage,'lifecycle',lifecycle_stage,
        'onboarding_started_at',onboarding_started_at,'onboarding_completed_at',onboarding_completed_at,
        'agreement_signed_at',agreement_signed_at,
        'merged',merged_into_contact_id IS NOT NULL,
        'eligible',merged_into_contact_id IS NULL AND updated_at <= $2
          AND CASE $3 WHEN 'business.active_clients_current' THEN status='active' AND lifecycle_stage='client_active'
            WHEN 'business.onboarding_current' THEN onboarding_stage IS NOT NULL
              AND (onboarding_started_at <= $2 OR onboarding_completed_at <= $2 OR agreement_signed_at <= $2)
            ELSE lifecycle_stage IS NOT NULL END) ORDER BY id),'[]'::jsonb)
        FROM public.clients WHERE tenant_id=$1
          AND lifecycle_stage IN ('client_active','client_paused','client_churned','client_funded','client_alumni')$sql$
        INTO facts USING p_tenant_id,p_as_of,p_metric_id;
    END IF;
  WHEN 'team.active_members_current','team.role_distribution_current' THEN
    source_name := 'public.tenant_members'; current_snapshot := true;
    definition := 'Current active tenant seats whose auth user has not been deleted.';
    formula := 'Count explicit active membership records; roles come from tenant_members, not global roles.';
    source_present := true;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'version',m.updated_at,
      'status',m.status,'role',m.role::text,'user_present',u.id IS NOT NULL AND u.deleted_at IS NULL,
      'eligible',m.status='active' AND u.id IS NOT NULL AND u.deleted_at IS NULL
          AND m.updated_at <= p_as_of) ORDER BY m.id),'[]'::jsonb)
      INTO facts FROM public.tenant_members m LEFT JOIN auth.users u ON u.id=m.user_id
      WHERE m.tenant_id=p_tenant_id;
  WHEN 'operations.workflows_active_current' THEN
    source_name := 'public.tenant_workflows'; current_snapshot := true;
    definition := 'Recorded active workflows still present in the tenant n8n registry.';
    formula := 'Count active AND present_in_n8n registry records, not executions or successful outcomes.';
    caveats := jsonb_build_array('Registry state reflects the last sync; configuration is not execution evidence.');
    IF pg_catalog.to_regclass(source_name) IS NOT NULL THEN
      source_present := true;
      EXECUTE $sql$SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n8n_workflow_id,
        'version',updated_at,'last_synced_at',last_synced_at,'active',active,
        'present',present_in_n8n,'eligible',active AND present_in_n8n AND updated_at <= $2)
        ORDER BY n8n_workflow_id),'[]'::jsonb) FROM public.tenant_workflows WHERE tenant_id=$1$sql$
        INTO facts USING p_tenant_id,p_as_of;
    END IF;
  WHEN 'operations.recorded_workflow_runs' THEN
    source_name := 'public.paige_workflow_runs';
    definition := 'Recorded workflow runs by their recorded execution status in the requested UTC interval.';
    formula := 'Count tenant-owned runs with triggered_at >= start AND triggered_at < end, bounded by as_of.';
    caveats := jsonb_build_array('Recorded workflow runs are not all provider executions or proof of business outcomes.');
    IF pg_catalog.to_regclass(source_name) IS NOT NULL THEN
      source_present := true;
      EXECUTE $sql$SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'version',updated_at,
        'at',triggered_at,'status',status,'eligible',updated_at <= $4) ORDER BY id),'[]'::jsonb)
        FROM public.paige_workflow_runs WHERE tenant_id=$1 AND triggered_at >= $2 AND triggered_at < $3$sql$
        INTO facts USING p_tenant_id,p_range_start,p_range_end,p_as_of;
    END IF;
  WHEN 'ai.recorded_model_requests','ai.recorded_model_requests_daily','ai.recorded_tokens','ai.estimated_model_cost','ai.recorded_latency' THEN
    source_name := 'public.paige_llm_trace'; truth := 'PARTIAL';
    definition := CASE p_metric_id WHEN 'ai.recorded_model_requests' THEN 'Recorded model request trace rows.'
      WHEN 'ai.recorded_model_requests_daily' THEN 'Recorded model request trace rows by UTC day in the requested interval.'
      WHEN 'ai.recorded_tokens' THEN 'Sum of known recorded input and output tokens.'
      WHEN 'ai.estimated_model_cost' THEN 'Sum of known model cost estimates using the recorded supported price basis; not actual spend.'
      ELSE 'Mean of known recorded model request latency in milliseconds.' END;
    formula := 'Tenant trace rows in the UTC interval with working context absent or matching the active tenant; unknown quantities excluded.';
    caveats := jsonb_build_array('Trace writes are best-effort and may be missing; these quantities are not complete provider usage.',
      'Cost estimates use list price, in+out tokens, excluding caching/thinking/tool round-trips, 2026-07; not an invoice.');
    IF p_metric_id='ai.recorded_model_requests_daily' THEN
      caveats := caveats || jsonb_build_array('A zero bucket means no eligible recorded requests, not verified absence of model usage.',
        'First and last UTC-day buckets may be partial days; records are restricted to the requested interval.');
      IF extract(epoch FROM (date_trunc('day',p_range_end-interval '1 microsecond')-date_trunc('day',p_range_start)))/86400 > 365 THEN
        unavailable_reason := 'Daily recorded-request series is limited to 366 UTC-day buckets.';
      END IF;
    END IF;
    unit_name := CASE p_metric_id WHEN 'ai.recorded_tokens' THEN 'tokens'
      WHEN 'ai.estimated_model_cost' THEN 'estimated_usd' WHEN 'ai.recorded_latency' THEN 'milliseconds' ELSE 'count' END;
    IF pg_catalog.to_regclass(source_name) IS NOT NULL THEN
      source_present := true;
      EXECUTE $sql$SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'version',created_at,
        'status',status,'context_matches',working_context_tenant_id IS NULL OR working_context_tenant_id=$1,
        'tokens_in',tokens_in,'tokens_out',tokens_out,'cost',cost_estimate_usd,
        'supported_cost_basis',cost_basis='list price, in+out tokens, excl caching/thinking/tool round-trips, 2026-07',
        'latency',latency_ms,'eligible',(working_context_tenant_id IS NULL OR working_context_tenant_id=$1)
          AND CASE $4 WHEN 'ai.recorded_tokens' THEN tokens_in >= 0 AND tokens_out >= 0
            WHEN 'ai.estimated_model_cost' THEN cost_estimate_usd >= 0
              AND cost_estimate_usd::text NOT IN ('NaN','Infinity','-Infinity')
              AND cost_basis='list price, in+out tokens, excl caching/thinking/tool round-trips, 2026-07'
            WHEN 'ai.recorded_latency' THEN latency_ms >= 0 ELSE true END) ORDER BY id),'[]'::jsonb)
        FROM public.paige_llm_trace WHERE tenant_id=$1 AND created_at >= $2 AND created_at < $3$sql$
        INTO facts USING p_tenant_id,p_range_start,p_range_end,p_metric_id;
    END IF;
  WHEN 'ai.recorded_browser_calls' THEN
    source_name := 'public.paige_browser_usage'; truth := 'PARTIAL';
    definition := 'Recorded browser calls, including blocked calls, in the tenant browser audit rail.';
    formula := 'Count tenant-owned audit rows with called_at >= start AND called_at < end.';
    caveats := jsonb_build_array('Includes allowed and blocked calls; not successful browsing, model tokens or actual spend.');
    IF pg_catalog.to_regclass(source_name) IS NOT NULL THEN
      source_present := true;
      EXECUTE $sql$SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'version',created_at,
        'at',called_at,'blocked',blocked_reason IS NOT NULL,'eligible',created_at <= $4)
        ORDER BY id),'[]'::jsonb) FROM public.paige_browser_usage
        WHERE tenant_id=$1 AND called_at >= $2 AND called_at < $3$sql$
        INTO facts USING p_tenant_id,p_range_start,p_range_end,p_as_of;
    END IF;
  WHEN 'operations.systems_check_latest','operations.unresolved_findings_current' THEN
    source_name := 'public.systems_check_snapshot'; current_snapshot := true;
    definition := 'Safe status counts from the canonical latest completed full tenant Systems Check sweep.';
    formula := 'Reuse systems_check_snapshot(tenant); unresolved counts only fail findings with resolved_at absent.';
    IF pg_catalog.to_regprocedure('public.systems_check_snapshot(text)') IS NOT NULL THEN
      source_present := true;
      snapshot := public.systems_check_snapshot('tenant');
      safe_run := jsonb_build_object('started_at',snapshot#>'{run,started_at}',
        'completed_at',snapshot#>'{run,completed_at}','check_count',snapshot#>'{run,check_count}',
        'pass_count',snapshot#>'{run,pass_count}','fail_count',snapshot#>'{run,fail_count}');
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f->>'id','version',f->>'created_at',
        'status',f->>'status','severity',f->>'severity_at_finding','resolved_at',f->>'resolved_at',
        'eligible',(f->>'created_at')::timestamptz <= p_as_of AND
          CASE WHEN p_metric_id='operations.unresolved_findings_current'
            THEN f->>'status'='fail' AND f->>'resolved_at' IS NULL ELSE true END)
        ORDER BY f->>'id'),'[]'::jsonb) INTO facts
        FROM jsonb_array_elements(COALESCE(snapshot->'findings','[]'::jsonb)) f;
      IF snapshot->'run' IS NULL OR snapshot->'run'='null'::jsonb THEN
        unavailable_reason := 'No completed full tenant sweep is recorded.';
      ELSIF (snapshot#>>'{run,completed_at}')::timestamptz > p_as_of THEN
        unavailable_reason := 'The canonical latest sweep completed after as_of; historical sweep reconstruction is unavailable.';
      END IF;
      caveats := jsonb_build_array('A completed sweep is a recorded reading, not a claim that every check passed.',
        'Deferred skips and failed-to-run errors remain distinct; findings from targeted or unfinished scans are not substituted.');
    END IF;
  WHEN 'business.retention','business.profitability','business.nps','team.performance_scorecards','ai.voice_consumption' THEN
    definition := 'No supported canonical measurement producer.'; formula := 'Unavailable; no derived or inferred value.';
    unavailable_reason := CASE WHEN p_metric_id='ai.voice_consumption'
      THEN 'Voice monthly reserved_usd measures a budget reservation, not actual voice consumption or spend.'
      ELSE 'No supported canonical source and formula for this measurement.' END;
  ELSE
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='ANALYTICS_METRIC_UNKNOWN';
  END CASE;

  SELECT count(*),count(*) FILTER (WHERE (f->>'eligible')::boolean),
    max((f->>'version')::timestamptz)
    INTO candidate_count,contributing_count,through_at FROM jsonb_array_elements(facts) f;
  excluded_count := candidate_count-contributing_count;
  IF safe_run IS NOT NULL THEN
    through_at := greatest(through_at,(safe_run->>'completed_at')::timestamptz);
  END IF;
  IF NOT source_present AND unavailable_reason IS NULL THEN unavailable_reason := 'Canonical source is unavailable.'; END IF;
  IF p_metric_id IN ('ai.recorded_tokens','ai.estimated_model_cost','ai.recorded_latency') AND contributing_count=0 THEN
    unavailable_reason := 'No eligible known recorded quantity is available; unknown is not zero.';
  END IF;
  IF p_metric_id='business.onboarding_current' AND candidate_count>0 AND contributing_count=0 THEN
    unavailable_reason := 'Canonical clients exist but no eligible recorded onboarding instrumentation is available; default stage is not progress.';
  END IF;
  IF unavailable_reason IS NOT NULL THEN truth := 'UNAVAILABLE'; values_json := NULL;
    contributing_count := 0; excluded_count := candidate_count;
    caveats := caveats || jsonb_build_array(unavailable_reason);
  ELSE
    IF excluded_count > 0 THEN truth := 'PARTIAL'; END IF;
    IF p_metric_id='ai.recorded_model_requests_daily' THEN
      SELECT jsonb_build_object('kind','series','points',COALESCE(jsonb_agg(
        jsonb_build_object('at',greatest(bucket_at,p_range_start),'value',n) ORDER BY bucket_at),'[]'::jsonb))
        INTO values_json FROM (
          SELECT b.bucket_at,count(f) n
          FROM generate_series(date_trunc('day',p_range_start),date_trunc('day',p_range_end-interval '1 microsecond'),interval '1 day') b(bucket_at)
          LEFT JOIN LATERAL jsonb_array_elements(facts) f ON (f->>'eligible')::boolean
            AND (f->>'version')::timestamptz >= b.bucket_at AND (f->>'version')::timestamptz < b.bucket_at+interval '1 day'
          GROUP BY b.bucket_at) buckets;
    ELSIF p_metric_id IN ('business.onboarding_current','business.lifecycle_current','team.role_distribution_current',
                      'operations.recorded_workflow_runs','operations.systems_check_latest') THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('key',k,'label',k,'count',n) ORDER BY k),'[]'::jsonb)
        INTO items FROM (SELECT CASE p_metric_id WHEN 'business.onboarding_current' THEN f->>'onboarding'
          WHEN 'business.lifecycle_current' THEN f->>'lifecycle' WHEN 'team.role_distribution_current' THEN f->>'role'
          ELSE f->>'status' END k,count(*) n FROM jsonb_array_elements(facts) f
          WHERE (f->>'eligible')::boolean GROUP BY 1) grouped;
      values_json := jsonb_build_object('kind','distribution','items',items);
    ELSIF p_metric_id IN ('ai.estimated_model_cost','ai.recorded_latency') THEN
      SELECT CASE WHEN p_metric_id='ai.estimated_model_cost' THEN sum((f->>'cost')::numeric)
          ELSE avg((f->>'latency')::numeric) END INTO quantity
        FROM jsonb_array_elements(facts) f WHERE (f->>'eligible')::boolean;
      values_json := jsonb_build_object('kind','decimal','value',quantity::text);
    ELSE
      IF p_metric_id='ai.recorded_tokens' THEN
        SELECT sum((f->>'tokens_in')::bigint+(f->>'tokens_out')::bigint) INTO quantity
          FROM jsonb_array_elements(facts) f WHERE (f->>'eligible')::boolean;
      ELSE quantity := contributing_count; END IF;
      values_json := jsonb_build_object('kind','count','count',quantity);
    END IF;
  END IF;
  IF current_snapshot THEN
    caveats := caveats || jsonb_build_array('Current snapshot at query time; the selected range does not reconstruct historical states or trends.');
  END IF;
  -- JSONB canonical key ordering, UTC timestamp text and explicit id ordering make this stable.
  -- Digest incorporates every safe versioned candidate fact, including excluded facts.
  revision := 'sr_v1_' || encode(extensions.digest(convert_to(jsonb_build_object(
    'producer_version',p_metric_version,'tenant',p_tenant_id,'metric',p_metric_id,
    'start',to_char(p_range_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'end',to_char(p_range_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'as_of',to_char(p_as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'dimensions',p_dimensions,'source',source_name,'source_present',source_present,
    'facts',facts,'canonical_run',safe_run,'unavailable_reason',unavailable_reason)::text,'UTF8'),'sha256'),'hex');
  RETURN jsonb_build_object(
    'metric_key',p_metric_id,'metric_version',p_metric_version,
    'owner_department',CASE WHEN p_metric_id LIKE 'business.%' THEN 'client_experience'
      WHEN p_metric_id LIKE 'team.%' THEN 'people_talent' WHEN p_metric_id LIKE 'ai.%' THEN 'technology_automation'
      ELSE 'operations_pmo' END,
    'label',CASE p_metric_id WHEN 'business.active_clients_current' THEN 'Active clients'
      WHEN 'business.onboarding_current' THEN 'Recorded onboarding stages'
      WHEN 'business.lifecycle_current' THEN 'Recorded lifecycle stages'
      WHEN 'operations.systems_check_latest' THEN 'Latest completed Systems Check'
      WHEN 'operations.unresolved_findings_current' THEN 'Unresolved findings in latest sweep'
      WHEN 'operations.workflows_active_current' THEN 'Recorded active workflows'
      WHEN 'operations.recorded_workflow_runs' THEN 'Recorded workflow runs'
      WHEN 'team.active_members_current' THEN 'Active team seats'
      WHEN 'team.role_distribution_current' THEN 'Active team roles'
      WHEN 'ai.recorded_model_requests' THEN 'Recorded model requests'
      WHEN 'ai.recorded_model_requests_daily' THEN 'Daily recorded model requests'
      WHEN 'ai.recorded_tokens' THEN 'Known recorded tokens'
      WHEN 'ai.estimated_model_cost' THEN 'Estimated model cost'
      WHEN 'ai.recorded_latency' THEN 'Mean recorded model latency'
      WHEN 'ai.recorded_browser_calls' THEN 'Recorded browser calls'
      WHEN 'business.retention' THEN 'Retention' WHEN 'business.profitability' THEN 'Profitability'
      WHEN 'business.nps' THEN 'Net promoter score' WHEN 'team.performance_scorecards' THEN 'Team performance scorecards'
      ELSE 'Voice consumption' END,
    'definition',definition,'formula',formula,'unit',unit_name,
    'range',jsonb_build_object('start',p_range_start,'end',p_range_end,'bounds','[start,end)','timezone','UTC',
      'semantics',CASE WHEN current_snapshot THEN 'current_snapshot' WHEN source_name IS NULL THEN 'source_readiness'
        ELSE 'event_timestamp_cohort' END),
    'dimensions',p_dimensions,'source_refs',CASE WHEN source_name IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(source_name) END,
    'as_of',p_as_of,
    'coverage',jsonb_build_object('state',CASE truth WHEN 'LIVE' THEN 'complete' WHEN 'PARTIAL' THEN 'partial' ELSE 'unavailable' END,
      'candidate_count',candidate_count,'contributing_count',contributing_count,'excluded_count',excluded_count),
    'exclusions',jsonb_build_array(jsonb_build_object('reason','Out-of-scope context, ineligible current state, version after as_of, or unknown supported quantity.','count',excluded_count)),
    'freshness',jsonb_build_object('queried_at',p_as_of,'source_updated_through',through_at),
    'account_epoch',p_tenant_id,
    'truth_state',truth,'account_epoch_ref','ae_v1_'||encode(extensions.digest(convert_to(p_tenant_id::text,'UTF8'),'sha256'),'hex'),
    'source_revision_ref',revision,'values',values_json,'caveats',caveats,
    'evidence_ref',NULL,'sharedissuance_required',true);
END;
$function$;
REVOKE ALL ON FUNCTION public._settings_analytics_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._settings_analytics_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb)
  IS 'Private INT340 safe metric producer; explicit active owner/admin seat, canonical tenant sources, honest unavailable values. Reference issuance belongs to the shared Analytics seam.';
COMMIT;
