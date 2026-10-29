-- EXP09: caller-JWT calendar-aware projection of ORIGINAL invoice facts.
-- CLI-created 20261029203418; LOCAL/UNAPPLIED forward after E04 reserved10.
-- Do not publish/apply in a durable Preview ahead of the legitimate10 chain.
-- No financial query/calendar/permission body, table, writer or provider change.
BEGIN;
SET LOCAL lock_timeout='2s';

DO $lease$
DECLARE spec record; p record;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('public._client_portal_billing_client(uuid)','7785ae6623f447c23b040d06d3c701a2',true,0,'search_path=public, pg_temp',false,
   'p_tenant_id uuid','uuid'),
  ('public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)','a13ec7e7ebd4985091aba7381e851a87',true,2,'search_path=public, pg_temp',true,
   'p_tenant_id uuid, p_expected_client_id uuid, p_limit integer DEFAULT 20, p_after jsonb DEFAULT NULL::jsonb','jsonb'),
  ('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)','a307bf9e57e5b2ad692c74a329e683cd',false,0,'search_path=""',false,
   '_tenant uuid, _client uuid, p_limit integer, p_after jsonb, p_as_of date','jsonb'),
  ('public._business_time_zone_for_tenant(uuid,timestamptz)','5c149760b8cd699b4621f755e1f2eab1',false,0,'search_path=""',false,
   '_expected_tenant_id uuid, _read_at timestamp with time zone','jsonb')
 ) x(identity,body_md5,definer,defaults,setting,customer_api,arguments,result) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(spec.identity);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM spec.body_md5
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM spec.definer
   OR p.provolatile<>'v' OR p.pronargdefaults<>spec.defaults OR p.proconfig IS DISTINCT FROM ARRAY[spec.setting]::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM spec.arguments
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM spec.result
   OR p.proretset OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.proacl IS DISTINCT FROM CASE WHEN spec.customer_api
    THEN ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[] ELSE ARRAY['postgres=X/postgres']::aclitem[] END THEN
   RAISE EXCEPTION 'Original invoice calendar source changed: %',spec.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public.client_portal_invoices_calendar_scoped(p_tenant_id uuid,p_expected_client_id uuid,p_limit integer DEFAULT 20,p_after jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE calendar jsonb; facts jsonb;
BEGIN
 IF p_tenant_id IS NULL OR p_expected_client_id IS NULL
  OR public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 -- The SAME original Auth/tenant/client financial resolver holds its locks.
 -- Original native calendar and query are the only source of dates and money.
 calendar:=public._business_time_zone_for_tenant(p_tenant_id,statement_timestamp());
 facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date);
 RETURN (facts-'_native_sources')||jsonb_build_object('schema_version',2,'calendar',
  jsonb_build_object('state',calendar->'state','zone',calendar->'zone','local_date',calendar->'local_date'));
END $$;
REVOKE ALL ON FUNCTION public.client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb) TO authenticated;
ALTER FUNCTION public.client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
