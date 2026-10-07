BEGIN;

-- Extend the existing ephemeral reference registry; never persist metric values.
ALTER TABLE public.analytics_evidence_reference
  DROP CONSTRAINT analytics_evidence_reference_metric_id_check,
  DROP CONSTRAINT analytics_evidence_reference_range_key_check,
  ADD CONSTRAINT analytics_evidence_reference_range_key_check CHECK (range_key IN ('last_30_days','current_quarter','year_to_date','week','month','quarter','year')),
  ADD CONSTRAINT analytics_evidence_reference_metric_id_check CHECK (metric_id ~ '^[a-z][a-z0-9_.]{1,120}$'),
  ADD COLUMN metric_version text,
  ADD COLUMN dimensions jsonb,
  ADD COLUMN account_epoch uuid;
ALTER TABLE public.analytics_evidence_reference ADD CONSTRAINT analytics_metric_identity_check
  CHECK ((metric_version IS NULL AND dimensions IS NULL AND account_epoch IS NULL)
    OR (metric_version IS NOT NULL AND dimensions IS NOT NULL AND account_epoch IS NOT NULL AND metric_version = '1.0.0' AND jsonb_typeof(dimensions) = 'object'
      AND octet_length(dimensions::text) <= 500 AND account_epoch = tenant_id));

-- Preserve the original resolver and three-argument issuer's response contract.
ALTER FUNCTION public.resolve_analytics_evidence_reference(text) RENAME TO _resolve_legacy_analytics_evidence_reference;
REVOKE ALL ON FUNCTION public._resolve_legacy_analytics_evidence_reference(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._analytics_metric_authorized(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND p_tenant IS NOT NULL
 AND public.current_user_tenant_id() = p_tenant
 AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until <= now()))
 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.active_tenant_id=p_tenant)
 AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=auth.uid() AND m.tenant_id=p_tenant
   AND m.status='active' AND m.role::text IN ('owner','admin'))
 AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant AND t.status::text IN ('active','trial','past_due'))
$$;
REVOKE ALL ON FUNCTION public._analytics_metric_authorized(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._analytics_metric_produce(p_tenant uuid,p_metric text,p_version text,p_start timestamptz,p_end timestamptz,p_asof timestamptz,p_dimensions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone='UTC' AS $$
DECLARE result jsonb;
BEGIN
 IF public._analytics_metric_authorized(p_tenant) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 IF p_metric IS NULL OR p_metric NOT IN (
  'sales.opportunities.created','sales.opportunities.open_current','sales.opportunities.won_current_close_date','sales.opportunities.lost_current_close_date',
  'sales.pipeline.open_value','sales.invoices.issued_count','sales.invoices.issued_amount','sales.receivables.outstanding_current','sales.receivables.overdue_current',
  'sales.cash.recorded_received','sales.payments.posted_net_allocations',
  'business.active_clients_current','business.onboarding_current','business.lifecycle_current','business.retention','business.profitability','business.nps',
  'operations.systems_check_latest','operations.unresolved_findings_current','operations.workflows_active_current','operations.recorded_workflow_runs',
  'operations.recorded_workflow_activity','operations.current_system_exceptions',
  'team.active_members_current','team.role_distribution_current','team.performance_scorecards',
  'ai.recorded_model_requests','ai.recorded_model_requests_daily','ai.recorded_tokens','ai.estimated_model_cost','ai.recorded_latency','ai.recorded_browser_calls','ai.voice_consumption') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ANALYTICS_METRIC_ARGUMENTS_INVALID';
 END IF;
 -- Private producers independently validate their complete metric allowlists.
 IF p_metric LIKE 'sales.%' THEN
  result:=public._sales_performance_metric_bundle(p_tenant,p_metric,p_version,p_start,p_end,p_asof,p_dimensions);
 ELSIF p_metric LIKE 'business.%' OR p_metric LIKE 'operations.%' OR p_metric LIKE 'team.%' OR p_metric LIKE 'ai.%' THEN
  result:=public._settings_analytics_metric_bundle(p_tenant,p_metric,p_version,p_start,p_end,p_asof,p_dimensions);
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ANALYTICS_METRIC_ARGUMENTS_INVALID';
 END IF;
 IF result->>'truth_state'='UNAVAILABLE' THEN
  result:=jsonb_set(result,'{values}','null'::jsonb);
  result:=jsonb_set(result,'{coverage,contributing_count}','0'::jsonb);
  result:=jsonb_set(result,'{coverage,excluded_count}',result#>'{coverage,candidate_count}');
  result:=jsonb_set(result,'{exclusions}',jsonb_build_array(jsonb_build_object('reason','Required source or eligible measurement unavailable','count',result#>'{coverage,candidate_count}')));
 END IF;
 RETURN result - 'sharedissuance_required' - 'evidence_state';
END $$;
REVOKE ALL ON FUNCTION public._analytics_metric_produce(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.resolve_analytics_evidence_reference(p_evidence_ref text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE ref public.analytics_evidence_reference%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_evidence_ref IS NULL OR p_evidence_ref !~ '^aneb_v1_[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 SELECT r.* INTO ref FROM public.analytics_evidence_reference r
 WHERE r.token_digest=encode(extensions.digest(convert_to(p_evidence_ref,'UTF8'),'sha256'),'hex')
   AND r.issued_to=auth.uid() AND r.tenant_id=public.current_user_tenant_id()
   AND r.revoked_at IS NULL AND r.expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE'; END IF;
 IF ref.metric_version IS NULL THEN RETURN public._resolve_legacy_analytics_evidence_reference(p_evidence_ref); END IF;
 IF ref.account_epoch IS DISTINCT FROM public.current_user_tenant_id()
   OR public._analytics_metric_authorized(ref.tenant_id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 result:=public._analytics_metric_produce(ref.tenant_id,ref.metric_id,ref.metric_version,ref.range_start,ref.range_end,ref.issued_at,ref.dimensions);
 IF result->>'source_revision_ref' IS DISTINCT FROM ref.source_revision_ref THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 RETURN result || jsonb_build_object('range',(result->'range')||jsonb_build_object('key',ref.range_key),
  'account_epoch',ref.account_epoch,'account_epoch_ref','ae_v1_'||encode(extensions.digest(convert_to(ref.tenant_id::text,'UTF8'),'sha256'),'hex'),
  'evidence_ref',p_evidence_ref,'reference_expires_at',ref.expires_at);
END $$;

CREATE FUNCTION public.issue_analytics_evidence_bundle(p_metric_key text,p_metric_version text,p_dimensions jsonb,p_range_key text,p_range_start timestamptz,p_range_end timestamptz,p_account_epoch uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE tenant uuid:=public.current_user_tenant_id(); asof timestamptz:=clock_timestamp(); result jsonb; token text;
BEGIN
 IF p_account_epoch IS NULL OR p_account_epoch IS DISTINCT FROM tenant
  OR public._analytics_metric_authorized(tenant) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 IF p_metric_key IS NULL OR p_metric_version IS DISTINCT FROM '1.0.0'
  OR p_range_key IS NULL OR p_range_key NOT IN ('week','month','quarter','year')
  OR p_range_start IS NULL OR p_range_end IS NULL OR NOT isfinite(p_range_start) OR NOT isfinite(p_range_end)
  OR p_range_start>=p_range_end OR p_range_end>asof OR p_range_start<asof-interval '10 years'
  OR p_dimensions IS NULL OR jsonb_typeof(p_dimensions)<>'object' OR octet_length(p_dimensions::text)>500 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ANALYTICS_METRIC_ARGUMENTS_INVALID';
 END IF;
 result:=public._analytics_metric_produce(tenant,p_metric_key,p_metric_version,p_range_start,p_range_end,asof,p_dimensions);
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||tenant::text||':'||p_metric_key||':'||p_range_key,0));
 DELETE FROM public.analytics_evidence_reference r WHERE r.issued_to=auth.uid() AND r.tenant_id=tenant AND r.expires_at<asof-interval '24 hours';
 UPDATE public.analytics_evidence_reference r SET revoked_at=asof WHERE r.issued_to=auth.uid() AND r.tenant_id=tenant
  AND r.metric_id=p_metric_key AND r.metric_version=p_metric_version AND r.range_key=p_range_key
  AND r.dimensions=p_dimensions AND r.revoked_at IS NULL;
 token:='aneb_v1_'||encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO public.analytics_evidence_reference(token_digest,issued_to,tenant_id,metric_id,metric_version,dimensions,account_epoch,
  range_key,range_start,range_end,source_revision_ref,issued_at,expires_at)
 VALUES(encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),auth.uid(),tenant,p_metric_key,p_metric_version,p_dimensions,tenant,
  p_range_key,p_range_start,p_range_end,result->>'source_revision_ref',asof,asof+interval '15 minutes');
 RETURN public.resolve_analytics_evidence_reference(token);
END $$;
REVOKE ALL ON FUNCTION public.resolve_analytics_evidence_reference(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_analytics_evidence_reference(text) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_analytics_evidence_bundle(text,text,jsonb,text,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.issue_analytics_evidence_bundle(text,text,jsonb,text,timestamptz,timestamptz,uuid) TO authenticated;
COMMIT;
