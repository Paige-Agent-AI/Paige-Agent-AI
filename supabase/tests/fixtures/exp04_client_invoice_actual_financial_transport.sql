-- INERT original client financial transport extension, not a native release.
-- SAME original resolver, actor/client/invoice permissions, calendar and API.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('d283924a7763abeeb27a85960dcfa5ec','a79ff5475d861a26f92c578effb73060')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>2 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '20, NULL::jsonb'
  OR p.proargnames IS DISTINCT FROM ARRAY['p_tenant_id','p_expected_client_id','p_limit','p_after']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original client financial transport source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)')
  AND pg_catalog.md5(prosrc)='1a622edb93cf9041638be41b615020c4' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0
  AND proargnames=ARRAY['_tenant','_client','p_limit','p_after','p_as_of','p_payment_evidence_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current client financial query requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

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
   OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3')) THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 IF evidence_version IN('2','3') THEN
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date,evidence_version::integer);
 ELSE
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date);
 END IF;
 RETURN (facts-'_native_sources')||jsonb_build_object('schema_version',CASE WHEN evidence_version='3' THEN 4 WHEN evidence_version='2' THEN 3 ELSE 2 END,'calendar',
  jsonb_build_object('state',calendar->'state','zone',calendar->'zone','local_date',calendar->'local_date'))
  ||CASE WHEN evidence_version='3' THEN jsonb_build_object('financial_revision',facts#>'{_native_sources,all_facts_identity}') ELSE '{}'::jsonb END;
END $function$;
