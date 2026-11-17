-- Same isolated fixture, retaining all original Social publication/receipt checks.
\set ON_ERROR_STOP on
\ir exp07_account_scoped_publication.sql

-- Synthetic predecessor rows; only this upstream leaf is a stand-in. The actual
-- current wrapper below is byte-identical to the applied E04 carrier (MD5 asserted).
CREATE TABLE public.tenant_tool_autonomy(tenant_id uuid NOT NULL,tool_key text NOT NULL,mode text NOT NULL,updated_at timestamptz DEFAULT now(),PRIMARY KEY(tenant_id,tool_key));
CREATE FUNCTION public._list_tool_autonomy_before_e04_financial_review(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT 'existing_fixture_action','Existing fixture action','Automations','confirm',true,NULL::timestamptz;
$$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_financial_review(uuid) FROM PUBLIC,anon,authenticated,service_role;
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
CREATE TEMP TABLE catalogue_before AS SELECT oid,proowner,prosecdef,provolatile,proconfig,prosrc FROM pg_proc WHERE oid='public.list_tool_autonomy(uuid)'::regprocedure;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM catalogue_before)<>'700e053c46a3be90d1e8ab254a4dcbd0' THEN RAISE EXCEPTION 'Fixture did not load the actual predecessor wrapper'; END IF; END $$;
CREATE TEMP TABLE inherited_rows AS SELECT * FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0a1');
\ir ../migrations/20271133000027_exp07_publication_autonomy_catalogue.sql
CREATE TEMP TABLE catalogue_first AS SELECT oid,proowner,prosecdef,provolatile,proconfig,proacl,prosrc FROM pg_proc WHERE oid='public.list_tool_autonomy(uuid)'::regprocedure;
\ir ../migrations/20271133000027_exp07_publication_autonomy_catalogue.sql
INSERT INTO public.tenants(id,slug) VALUES ('00000000-0000-4000-8000-00000000d0c2','new-synthetic-solo');
INSERT INTO public.tenant_tool_autonomy(tenant_id,tool_key,mode) VALUES
 ('00000000-0000-4000-8000-00000000d0a1','social_post_publish','off'),
 ('00000000-0000-4000-8000-00000000d0b1','social_post_publish','auto');
DO $$
DECLARE a constant uuid:='00000000-0000-4000-8000-00000000d0a1'; b constant uuid:='00000000-0000-4000-8000-00000000d0b1';
BEGIN
 IF EXISTS (SELECT oid,proowner,prosecdef,provolatile,proconfig,prosrc FROM catalogue_before EXCEPT SELECT oid,proowner,prosecdef,provolatile,proconfig,prosrc FROM pg_proc WHERE oid='public._list_tool_autonomy_before_exp07_publication(uuid)'::regprocedure)
  THEN RAISE EXCEPTION 'Original catalogue OID/source/security changed'; END IF;
 IF EXISTS (SELECT * FROM catalogue_first EXCEPT SELECT oid,proowner,prosecdef,provolatile,proconfig,proacl,prosrc FROM pg_proc WHERE oid='public.list_tool_autonomy(uuid)'::regprocedure)
  THEN RAISE EXCEPTION 'Catalogue replay changed identity or authority'; END IF;
 IF EXISTS (SELECT * FROM inherited_rows EXCEPT SELECT * FROM public.list_tool_autonomy(a) WHERE tool_key<>'social_post_publish')
  OR EXISTS (SELECT * FROM public.list_tool_autonomy(a) WHERE tool_key<>'social_post_publish' EXCEPT SELECT * FROM inherited_rows)
  THEN RAISE EXCEPTION 'Inherited catalogue rows changed'; END IF;
 IF (SELECT count(*) FROM public.list_tool_autonomy(a) WHERE tool_key='social_post_publish')<>1
  OR (SELECT mode FROM public.list_tool_autonomy(a) WHERE tool_key='social_post_publish')<>'off'
  OR (SELECT mode FROM public.list_tool_autonomy(b) WHERE tool_key='social_post_publish')<>'auto'
  THEN RAISE EXCEPTION 'Canonical control is missing, duplicated or mixed across tenants'; END IF;
 IF NOT (SELECT mode='confirm' AND is_default FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0c2') WHERE tool_key='social_post_publish')
  THEN RAISE EXCEPTION 'New account lost default confirm'; END IF;
 IF pg_temp.run('00000000-0000-4000-8000-00000000e001','authenticated','authenticated',
  $q$SELECT to_jsonb(mode) FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000d0b1') WHERE tool_key='social_post_publish'$q$)<>'ok:"off"'
  THEN RAISE EXCEPTION 'Caller-selected foreign workspace bypassed current tenant control'; END IF;
 IF has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.list_tool_autonomy(uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.list_tool_autonomy(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public._list_tool_autonomy_before_exp07_publication(uuid)','EXECUTE')
  OR has_function_privilege('service_role','public._list_tool_autonomy_before_exp07_publication(uuid)','EXECUTE')
  OR has_function_privilege('anon','public._list_tool_autonomy_before_exp07_publication(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'Catalogue execution boundary changed'; END IF;
 RAISE NOTICE 'EXP07 catalogue replay, original identity/source, inherited rows, current tenant, distinct modes, new account and role controls passed';
END $$;
