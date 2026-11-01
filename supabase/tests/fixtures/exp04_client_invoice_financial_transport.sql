-- EXP04 O5 test-only original scoped transport extension; NOT a deployed forward.
-- SAME function identity/defaults/owner/ACL/resolver/calendar and exact client scope.
-- Header selects only a closed financial representation. No new grant or API.
CREATE OR REPLACE FUNCTION public.client_portal_invoices_calendar_scoped(p_tenant_id uuid, p_expected_client_id uuid, p_limit integer DEFAULT 20, p_after jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE calendar jsonb; facts jsonb; headers jsonb; evidence_version text;
BEGIN
 IF p_tenant_id IS NULL OR p_expected_client_id IS NULL
  OR public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 -- The SAME original Auth/tenant/client financial resolver holds its locks.
 -- Original native calendar and query are the only source of dates and money.
 calendar:=public._business_time_zone_for_tenant(p_tenant_id,statement_timestamp());
 -- Representation choice never grants authority: the SAME original resolver above
 -- already bound this caller to the exact business/customer under its locks.
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 IF headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
   OR headers->>'x-paige-invoice-evidence-version'<>'2') THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 IF evidence_version='2' THEN
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date,2);
 ELSE
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date);
 END IF;
 RETURN (facts-'_native_sources')||jsonb_build_object('schema_version',CASE WHEN evidence_version='2' THEN 3 ELSE 2 END,'calendar',
  jsonb_build_object('state',calendar->'state','zone',calendar->'zone','local_date',calendar->'local_date'));
END $function$;

