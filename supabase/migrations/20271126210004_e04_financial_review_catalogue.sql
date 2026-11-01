-- EXP04 O5 governance metadata only; no financial/provider/signing/send activation.
-- Original ordered catalogue extension; preserve every inherited row and writer.
-- Unapplied21 follows original E03 19/20. Never reset or repair applied history.
BEGIN;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;prior pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.list_tool_autonomy(uuid)');
 IF NOT FOUND OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.provolatile<>'s' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR NOT p.proretset
  OR p.prorettype<>'record'::regtype OR pg_catalog.pg_get_function_result(p.oid)<>'TABLE(tool_key text, label text, category text, mode text, is_default boolean, updated_at timestamp with time zone)' OR p.pronargdefaults<>1 OR pg_catalog.pg_get_expr(p.proargdefaults,0)<>'NULL::uuid'
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant_id','tool_key','label','category','mode','is_default','updated_at']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original Sales autonomy catalogue authority changed; reconcile before applying' USING ERRCODE='23514';END IF;
 SELECT * INTO prior FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._list_tool_autonomy_before_e04_financial_review(uuid)');
 IF FOUND THEN
  IF pg_catalog.md5(prior.prosrc)<>'54b2e4384bdc39729d5a5e7873dc9939'
   OR pg_catalog.pg_get_userbyid(prior.proowner)<>'postgres' OR NOT prior.prosecdef OR prior.provolatile<>'s'
   OR prior.proparallel<>'u' OR prior.proisstrict OR prior.proleakproof OR NOT prior.proretset
   OR prior.prorettype<>'record'::regtype OR pg_catalog.pg_get_function_result(prior.oid)<>'TABLE(tool_key text, label text, category text, mode text, is_default boolean, updated_at timestamp with time zone)'
   OR prior.pronargdefaults<>1 OR pg_catalog.pg_get_expr(prior.proargdefaults,0)<>'NULL::uuid'
   OR prior.proargnames IS DISTINCT FROM ARRAY['_tenant_id','tool_key','label','category','mode','is_default','updated_at']
   OR prior.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR prior.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
   OR pg_catalog.md5(p.prosrc)<>'700e053c46a3be90d1e8ab254a4dcbd0' THEN
   RAISE EXCEPTION 'Original Sales autonomy predecessor changed; reconcile before replay' USING ERRCODE='23514';END IF;
 ELSIF pg_catalog.md5(p.prosrc)<>'54b2e4384bdc39729d5a5e7873dc9939' THEN
  RAISE EXCEPTION 'Original Sales autonomy catalogue source changed; reconcile before applying' USING ERRCODE='23514';
 ELSE
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_e04_financial_review;
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_financial_review(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_financial_review(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $catalogue$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e04_financial_review(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('sales_record_provider_disposition','Review a provider adjustment and record its invoice treatment','Sales')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
   FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $catalogue$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
COMMIT;
