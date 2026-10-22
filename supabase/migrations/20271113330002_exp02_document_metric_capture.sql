-- EXP02 report foundation only: no public entry point, storage or worker activation.
-- A future original document writer may capture verified historical evidence in
-- its immutable work request. This is never a source of current metric values.
CREATE OR REPLACE FUNCTION public._paige_document_capture_metric_evidence(_references jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _token text;
  _metric jsonb;
  _measurements jsonb := '[]'::jsonb;
  _capture jsonb;
  _expires timestamptz;
BEGIN
  IF _actor IS NULL OR public._analytics_metric_authorized(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE';
  END IF;
  IF jsonb_typeof(_references) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='DOCUMENT_METRIC_REFERENCES_INVALID';
  END IF;
  IF jsonb_array_length(_references) NOT BETWEEN 1 AND 12 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(_references) AS item(value)
    WHERE jsonb_typeof(value) <> 'string' OR (value #>> '{}') !~ '^aneb_v1_[0-9a-f]{64}$'
  ) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(_references) AS item(value)) <> jsonb_array_length(_references) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='DOCUMENT_METRIC_REFERENCES_INVALID';
  END IF;
  FOR _token IN SELECT value FROM jsonb_array_elements_text(_references) AS item(value) LOOP
    -- The original resolver owns actor/tenant/seat, expiry/revocation, version,
    -- source revision and all calculations. Caller-supplied values are never read.
    _metric := public.resolve_analytics_evidence_reference(_token);
    IF jsonb_typeof(_metric) IS DISTINCT FROM 'object'
      OR _metric->>'metric_version' IS NULL
      OR _metric->>'account_epoch' IS DISTINCT FROM _tenant::text
      OR _metric->>'evidence_ref' IS DISTINCT FROM _token
      OR _metric->>'reference_expires_at' IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE';
    END IF;
    _expires := least(_expires, (_metric->>'reference_expires_at')::timestamptz);
    -- Keep original values, definition, period, semantics, coverage, caveats,
    -- as-of and provenance intact. The document does not need workspace IDs.
    _measurements := _measurements || jsonb_build_array(_metric - 'account_epoch' - 'account_epoch_ref');
  END LOOP;
  IF auth.uid() IS DISTINCT FROM _actor OR public.current_user_tenant_id() IS DISTINCT FROM _tenant
    OR public._analytics_metric_authorized(_tenant) IS DISTINCT FROM true OR _expires <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE';
  END IF;
  _capture := jsonb_build_object('version', 1, 'captured_at', clock_timestamp(), 'measurements', _measurements);
  IF octet_length(_capture::text) > 24576 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='DOCUMENT_METRIC_EVIDENCE_TOO_LARGE';
  END IF;
  RETURN _capture;
END $$;

REVOKE ALL ON FUNCTION public._paige_document_capture_metric_evidence(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._paige_document_capture_metric_evidence(jsonb) IS
  'Private original-document consumer of canonical Metric reference resolution. Writes nothing; no caller grant, worker, provider or report capability activation.';
