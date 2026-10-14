BEGIN;
-- #2086 shared compatibility. Compose with Sales producer 20271101110000; never deploy producer alone.
-- Keep stored 1.0.0 identities as history. Only this registered key may issue 1.1.0.
ALTER TABLE public.analytics_evidence_reference DROP CONSTRAINT analytics_metric_identity_check;
ALTER TABLE public.analytics_evidence_reference ADD CONSTRAINT analytics_metric_identity_check
 CHECK ((metric_version IS NULL AND dimensions IS NULL AND account_epoch IS NULL)
 OR (metric_version IS NOT NULL AND dimensions IS NOT NULL AND account_epoch IS NOT NULL
 AND (metric_version='1.0.0' OR (metric_id='sales.receivables.overdue_current' AND metric_version='1.1.0'))
 AND jsonb_typeof(dimensions)='object' AND octet_length(dimensions::text)<=500 AND account_epoch=tenant_id));
-- Old overdue references cannot silently acquire new calendar semantics.
UPDATE public.analytics_evidence_reference SET revoked_at=clock_timestamp()
 WHERE metric_id='sales.receivables.overdue_current' AND metric_version='1.0.0' AND revoked_at IS NULL;
CREATE OR REPLACE FUNCTION public.resolve_analytics_evidence_reference(p_evidence_ref text)
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
 IF ref.metric_id='sales.receivables.overdue_current' AND ref.metric_version IS DISTINCT FROM '1.1.0' THEN
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
CREATE OR REPLACE FUNCTION public.issue_analytics_evidence_bundle(p_metric_key text,p_metric_version text,p_dimensions jsonb,p_range_key text,p_range_start timestamptz,p_range_end timestamptz,p_account_epoch uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE tenant uuid:=public.current_user_tenant_id(); asof timestamptz:=clock_timestamp(); result jsonb; token text;
BEGIN
 IF p_account_epoch IS NULL OR p_account_epoch IS DISTINCT FROM tenant
  OR public._analytics_metric_authorized(tenant) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 IF p_metric_key IS NULL OR p_metric_version IS DISTINCT FROM (CASE WHEN p_metric_key='sales.receivables.overdue_current' THEN '1.1.0' ELSE '1.0.0' END)
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

