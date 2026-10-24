-- Original document_generate foundation. Canonical issuers remain the only
-- metric producers; the existing immutable work request remains the only capture.
BEGIN;
CREATE OR REPLACE FUNCTION public._paige_document_capture_metric_requests(
  _requests jsonb, _range_key text, _start timestamptz, _end timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  _actor uuid := auth.uid(); _tenant uuid := public.current_user_tenant_id();
  _request jsonb; _bundle jsonb; _capture jsonb; _captured_requests jsonb;
  _issued jsonb := '{}'::jsonb; _references jsonb;
BEGIN
  IF _actor IS NULL OR public._analytics_metric_authorized(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(_requests) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'DOCUMENT_METRIC_REQUESTS_INVALID' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(_requests) NOT BETWEEN 1 AND 12
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(_requests) r(value)
      WHERE jsonb_typeof(value) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'DOCUMENT_METRIC_REQUESTS_INVALID' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_requests) r(value)
      WHERE jsonb_typeof(value->'metric_key') IS DISTINCT FROM 'string'
        OR jsonb_typeof(value->'metric_version') IS DISTINCT FROM 'string'
        OR length(value->>'metric_key') NOT BETWEEN 1 AND 120
        OR length(value->>'metric_version') NOT BETWEEN 1 AND 32
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) k(key)
          WHERE key NOT IN ('metric_key','metric_version')))
    OR (SELECT count(DISTINCT value->>'metric_key') FROM jsonb_array_elements(_requests) r(value))
      <> jsonb_array_length(_requests) THEN
    RAISE EXCEPTION 'DOCUMENT_METRIC_REQUESTS_INVALID' USING ERRCODE='22023';
  END IF;
  -- All multi-source requests acquire the ORIGINAL issuer's locks in the same
  -- key order. The local reference map is transient; display order stays intact.
  FOR _request IN SELECT value FROM jsonb_array_elements(_requests) r(value) ORDER BY value->>'metric_key' LOOP
    _bundle := public.issue_analytics_evidence_bundle(_request->>'metric_key',_request->>'metric_version',
      '{}'::jsonb,_range_key,_start,_end,_tenant);
    IF jsonb_typeof(_bundle) IS DISTINCT FROM 'object'
      OR _bundle->>'metric_key' IS DISTINCT FROM _request->>'metric_key'
      OR _bundle->>'metric_version' IS DISTINCT FROM _request->>'metric_version'
      OR _bundle->>'account_epoch' IS DISTINCT FROM _tenant::text
      OR coalesce(_bundle->>'evidence_ref','') !~ '^aneb_v1_[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501';
    END IF;
    _issued := _issued || jsonb_build_object(_request->>'metric_key',_bundle->>'evidence_ref');
  END LOOP;
  SELECT jsonb_agg(_issued->(value->>'metric_key') ORDER BY ordinal) INTO _references
    FROM jsonb_array_elements(_requests) WITH ORDINALITY r(value,ordinal);
  _capture := public._paige_document_capture_metric_evidence(_references);
  SELECT jsonb_agg(jsonb_build_object('metric_key',value->'metric_key','metric_version',value->'metric_version') ORDER BY ordinal)
    INTO _captured_requests FROM jsonb_array_elements(_capture->'measurements') WITH ORDINALITY r(value,ordinal);
  IF _captured_requests IS DISTINCT FROM _requests THEN
    RAISE EXCEPTION 'DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF auth.uid() IS DISTINCT FROM _actor OR public.current_user_tenant_id() IS DISTINCT FROM _tenant
    OR public._analytics_metric_authorized(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN _capture;
END $$;
REVOKE ALL ON FUNCTION public._paige_document_capture_metric_requests(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._paige_document_capture_metric_requests(jsonb,text,timestamptz,timestamptz) IS
  'Private original-document source selector; original Metric issuer/resolver and immutable capture only. No new store, provider, caller grant or Chat activation.';

DO $source_requests$
DECLARE
  fn regprocedure := 'public.submit_paige_document_work(uuid,uuid,jsonb)'::regprocedure;
  source text; definition text; changed text; prior_acl aclitem[]; i integer;
  before_fragments text[] := ARRAY[
    $a$where key not in ('version','doc_type','title','brief','report_period','evidence_refs')$a$,
    $a$or jsonb_typeof(_request_payload->'evidence_refs') is distinct from 'array'$a$,
    $a$or jsonb_array_length(_request_payload->'evidence_refs') not between 1 and 12$a$,
    $a$<> jsonb_array_length(_request_payload->'evidence_refs') then$a$,
    $a$_capture := public._paige_document_capture_metric_evidence(_request_payload->'evidence_refs');$a$,
    $a$if _references is distinct from _request_payload->'evidence_refs' then$a$
  ];
  after_fragments text[] := ARRAY[
    $a$where key not in ('version','doc_type','title','brief','report_period','evidence_refs','metric_requests')$a$,
    $a$or ((_request_payload ? 'evidence_refs') = (_request_payload ? 'metric_requests'))
      or jsonb_typeof(case when _request_payload ? 'metric_requests' then _request_payload->'metric_requests'
        else _request_payload->'evidence_refs' end) is distinct from 'array'$a$,
    $a$or (_request_payload ? 'evidence_refs' and (jsonb_array_length(_request_payload->'evidence_refs') not between 1 and 12$a$,
    $a$<> jsonb_array_length(_request_payload->'evidence_refs'))) then$a$,
    $a$if _request_payload ? 'metric_requests' then
        _capture := public._paige_document_capture_metric_requests(_request_payload->'metric_requests',
          _request_payload->'report_period'->>'key',_period_start,_period_end);
      else
        _capture := public._paige_document_capture_metric_evidence(_request_payload->'evidence_refs');
      end if;$a$,
    $a$if not (_request_payload ? 'metric_requests') and _references is distinct from _request_payload->'evidence_refs' then$a$
  ];
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid),p.proacl INTO source,definition,prior_acl FROM pg_proc p WHERE p.oid=fn;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) THEN
    RAISE EXCEPTION 'DOCUMENT_REPORT_REQUEST_METADATA_CHANGED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public._paige_document_capture_metric_evidence(jsonb)'::regprocedure
    AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
    AND md5(p.prosrc)='151a73a04e1e0d97ce2f641a5ee34c26'
    AND p.proconfig=ARRAY['search_path=""','TimeZone=UTC']
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) THEN
    RAISE EXCEPTION 'DOCUMENT_REPORT_CAPTURE_METADATA_CHANGED';
  END IF;
  IF md5(source) <> '5640127bb3838b8aee4f5bc38eec1fd5' THEN
    changed := source;
    FOR i IN REVERSE array_length(after_fragments,1)..1 LOOP
      changed := replace(changed,after_fragments[i],before_fragments[i]);
    END LOOP;
    IF md5(changed)='5640127bb3838b8aee4f5bc38eec1fd5' THEN RETURN; END IF;
    RAISE EXCEPTION 'DOCUMENT_REPORT_REQUEST_SOURCE_CHANGED';
  END IF;
  changed := source;
  FOR i IN 1..array_length(before_fragments,1) LOOP
    IF (length(changed)-length(replace(changed,before_fragments[i],'')))/length(before_fragments[i]) <> 1 THEN
      RAISE EXCEPTION 'DOCUMENT_REPORT_REQUEST_ANCHOR_CHANGED: %',i;
    END IF;
    changed := replace(changed,before_fragments[i],after_fragments[i]);
  END LOOP;
  EXECUTE replace(definition,source,changed);
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND md5(p.prosrc)=md5(changed)
    AND p.proacl IS NOT DISTINCT FROM prior_acl AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'DOCUMENT_REPORT_REQUEST_METADATA_CHANGED';
  END IF;
END $source_requests$;
COMMIT;
