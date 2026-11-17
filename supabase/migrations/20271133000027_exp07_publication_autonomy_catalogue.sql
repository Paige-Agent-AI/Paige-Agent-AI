-- EXP07: expose the original saved-content publication brake; no provider activation.
-- Forward-only27 after applied26. Follow the original guarded catalogue-extension protocol.
BEGIN;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE; prior pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.list_tool_autonomy(uuid)');
 IF NOT FOUND OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.provolatile<>'s' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR NOT p.proretset
  OR p.prorettype<>'record'::regtype OR pg_catalog.pg_get_function_result(p.oid)<>'TABLE(tool_key text, label text, category text, mode text, is_default boolean, updated_at timestamp with time zone)'
  OR p.pronargdefaults<>1 OR pg_catalog.pg_get_expr(p.proargdefaults,0)<>'NULL::uuid'
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant_id','tool_key','label','category','mode','is_default','updated_at']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original publication autonomy catalogue drift; reconcile before applying' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._list_tool_autonomy_before_exp07_publication(uuid)');
 IF FOUND THEN
  IF pg_catalog.md5(prior.prosrc)<>'700e053c46a3be90d1e8ab254a4dcbd0'
   OR pg_catalog.pg_get_userbyid(prior.proowner)<>'postgres' OR NOT prior.prosecdef OR prior.provolatile<>'s'
   OR prior.proparallel<>'u' OR prior.proisstrict OR prior.proleakproof OR NOT prior.proretset
   OR prior.prorettype<>'record'::regtype OR pg_catalog.pg_get_function_result(prior.oid)<>'TABLE(tool_key text, label text, category text, mode text, is_default boolean, updated_at timestamp with time zone)'
   OR prior.pronargdefaults<>1 OR pg_catalog.pg_get_expr(prior.proargdefaults,0)<>'NULL::uuid'
   OR prior.proargnames IS DISTINCT FROM ARRAY['_tenant_id','tool_key','label','category','mode','is_default','updated_at']
   OR prior.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR prior.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
   OR pg_catalog.md5(p.prosrc)<>'d05ab718d77d4d310f1f2bf55e78d30f' THEN
   RAISE EXCEPTION 'Original publication autonomy predecessor drift; reconcile before replay' USING ERRCODE='23514';
  END IF;
 ELSIF pg_catalog.md5(p.prosrc)<>'700e053c46a3be90d1e8ab254a4dcbd0' THEN
  RAISE EXCEPTION 'Original publication autonomy source drift; reconcile before applying' USING ERRCODE='23514';
 ELSE
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_exp07_publication;
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_exp07_publication(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_exp07_publication(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $catalogue$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_exp07_publication(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('social_post_publish','Publish saved content to Social','Automations')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
   FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $catalogue$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
COMMIT;
