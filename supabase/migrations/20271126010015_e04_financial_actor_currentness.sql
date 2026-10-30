-- EXP04 O11: one original financial authority, explicit accepted actor.
-- PRIVATE native factors only. Original Auth-bound APIs/defaults/ACL/OIDs remain.
-- No new API grant, token/GUC impersonation, financial query, ledger or effect.
-- Forward carrier15 after actual production14. Original unpublished13 is retained
-- in source history; Task12 has no semantic dependency and is NOT carried here.
BEGIN;

DO $e04_financial_actor$
DECLARE
 item record; original_metadata jsonb; final_metadata jsonb;
 relation_body text; lock_body text; billing_body text;
 actor_relation text; actor_lock text; actor_billing text; inverse text;
 relation_wrapper text:=E'\nBEGIN\n RETURN public._client_portal_relationship_for_actor(p_tenant_id,auth.uid(),true);\nEND;\n';
 lock_wrapper text:=E'\nBEGIN\n RETURN public._client_portal_lock_relationship_for_actor(p_tenant_id,p_lock,auth.uid(),true);\nEND;\n';
 billing_wrapper text:=E'\nBEGIN\n RETURN public._client_portal_billing_client_for_actor(p_tenant_id,auth.uid(),true);\nEND;\n';
 current_body text:=E'\nBEGIN\n IF p_actor_id IS NULL OR p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN RETURN false; END IF;\n RETURN public._client_portal_billing_client_for_actor(p_tenant_id,p_actor_id,false) IS NOT DISTINCT FROM p_expected_client_id;\nEND;\n';
BEGIN
 -- Exact original predicates, header timing and canonical platform-role source.
 FOR item IN SELECT * FROM (VALUES
  ('public.client_portal_relationship_id(uuid)','ff84ba24689e5043d7d15ed3d9150268'),
  ('public._client_portal_lock_relationship(uuid,text)','416002c40cb71ed54cc4c3387c37563f'),
  ('public._client_portal_billing_client(uuid)','7785ae6623f447c23b040d06d3c701a2'),
  ('public._client_portal_request_business()','72efd408dc26f9672088f10eea9ebea1'),
  ('public.is_platform_owner(uuid)','dc789c98cf26f96d52c5138754c0f131'),
  ('public.is_platform_owner()','08ff6983c07e71b7c4bec3b8b4fcae28'),
  ('public.is_super_admin(uuid)','d014606ddbd8a120e5f3afeda5f937fa'),
  ('public.is_super_admin()','363ccf1a73c5d68252e165ad909032f1')
 ) AS s(identity,body_md5) LOOP
  IF to_regprocedure(item.identity) IS NULL OR NOT EXISTS(
   SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(item.identity)
    AND md5(p.prosrc)=item.body_md5 AND pg_get_userbyid(p.proowner)='postgres') THEN
   RAISE EXCEPTION 'Original financial actor dependency changed: %',item.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF replace((SELECT prosrc FROM pg_proc WHERE oid='public.is_super_admin()'::regprocedure),
   'auth.uid()','_user_id') IS DISTINCT FROM
   (SELECT prosrc FROM pg_proc WHERE oid='public.is_super_admin(uuid)'::regprocedure)
 OR replace((SELECT prosrc FROM pg_proc WHERE oid='public.is_platform_owner()'::regprocedure),
   'public.is_super_admin()','public.is_super_admin(_user_id)') IS DISTINCT FROM
   (SELECT prosrc FROM pg_proc WHERE oid='public.is_platform_owner(uuid)'::regprocedure) THEN
  RAISE EXCEPTION 'Original explicit actor platform predicate is not equivalent' USING ERRCODE='23514';
 END IF;
 SELECT jsonb_agg(jsonb_build_object(
   'oid',p.oid::text,'identity',p.oid::regprocedure::text,'args',pg_get_function_arguments(p.oid),
   'names',p.proargnames,'defaults',p.pronargdefaults,'result',p.prorettype::text,
   'owner',p.proowner::text,'definer',p.prosecdef,'volatility',p.provolatile,
   'language',p.prolang::text,'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.oid)
 INTO original_metadata FROM pg_proc p WHERE p.oid IN(
  'public.client_portal_relationship_id(uuid)'::regprocedure,
  'public._client_portal_lock_relationship(uuid,text)'::regprocedure,
  'public._client_portal_billing_client(uuid)'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure
   AND prosecdef AND provolatile='s' AND pronargdefaults=1 AND proconfig=ARRAY['search_path=public, pg_temp']
   AND pg_get_function_arguments(oid)='p_tenant_id uuid DEFAULT NULL::uuid'
   AND proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._client_portal_lock_relationship(uuid,text)'::regprocedure
   AND prosecdef AND provolatile='v' AND pronargdefaults=1 AND proconfig=ARRAY['search_path=""']
   AND pg_get_function_arguments(oid)='p_tenant_id uuid, p_lock text DEFAULT ''share''::text'
   AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._client_portal_billing_client(uuid)'::regprocedure
   AND prosecdef AND provolatile='v' AND pronargdefaults=0 AND proconfig=ARRAY['search_path=public, pg_temp']
   AND pg_get_function_arguments(oid)='p_tenant_id uuid' AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original financial actor metadata requires reconciliation' USING ERRCODE='23514';
 END IF;

 SELECT prosrc INTO relation_body FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure;
 SELECT prosrc INTO lock_body FROM pg_proc WHERE oid='public._client_portal_lock_relationship(uuid,text)'::regprocedure;
 SELECT prosrc INTO billing_body FROM pg_proc WHERE oid='public._client_portal_billing_client(uuid)'::regprocedure;

 -- Factor the actual original bodies, never a second copy of their permission queries.
 actor_relation:=replace(relation_body,'_uid uuid := auth.uid();','_uid uuid := p_actor_id;');
 actor_relation:=replace(actor_relation,'_business := public._client_portal_request_business();',
  '_business := CASE WHEN p_use_request_business THEN public._client_portal_request_business() ELSE NULL::uuid END;');
 inverse:=replace(actor_relation,'_uid uuid := p_actor_id;','_uid uuid := auth.uid();');
 inverse:=replace(inverse,'_business := CASE WHEN p_use_request_business THEN public._client_portal_request_business() ELSE NULL::uuid END;',
  '_business := public._client_portal_request_business();');
 IF actor_relation=relation_body OR inverse<>relation_body THEN
  RAISE EXCEPTION 'Whole original relationship factor inverse differs' USING ERRCODE='23514';END IF;

 actor_lock:=replace(lock_body,'v_uid uuid := auth.uid();','v_uid uuid := p_actor_id;');
 actor_lock:=replace(actor_lock,'v_client := public.client_portal_relationship_id(p_tenant_id);',
  'v_client := public._client_portal_relationship_for_actor(p_tenant_id,p_actor_id,p_use_request_business);');
 inverse:=replace(actor_lock,'v_uid uuid := p_actor_id;','v_uid uuid := auth.uid();');
 inverse:=replace(inverse,'v_client := public._client_portal_relationship_for_actor(p_tenant_id,p_actor_id,p_use_request_business);',
  'v_client := public.client_portal_relationship_id(p_tenant_id);');
 IF actor_lock=lock_body OR inverse<>lock_body THEN
  RAISE EXCEPTION 'Whole original relationship-lock factor inverse differs' USING ERRCODE='23514';END IF;

 actor_billing:=replace(billing_body,'_uid uuid := auth.uid();','_uid uuid := p_actor_id;');
 actor_billing:=replace(actor_billing,'public.is_platform_owner()','public.is_platform_owner(p_actor_id)');
 actor_billing:=replace(actor_billing,'public._client_portal_lock_relationship(p_tenant_id, ''share'')',
  'public._client_portal_lock_relationship_for_actor(p_tenant_id,''share'',p_actor_id,p_use_request_business)');
 inverse:=replace(actor_billing,'_uid uuid := p_actor_id;','_uid uuid := auth.uid();');
 inverse:=replace(inverse,'public.is_platform_owner(p_actor_id)','public.is_platform_owner()');
 inverse:=replace(inverse,'public._client_portal_lock_relationship_for_actor(p_tenant_id,''share'',p_actor_id,p_use_request_business)',
  'public._client_portal_lock_relationship(p_tenant_id, ''share'')');
 IF actor_billing=billing_body OR inverse<>billing_body THEN
  RAISE EXCEPTION 'Whole original billing factor inverse differs' USING ERRCODE='23514';END IF;

 -- Both modes retain the SAME actor/relationship predicates. true means the existing
 -- Auth-bound request must parse its original narrowing header AT THE ORIGINAL POINT.
 -- false is PRIVATE native context: an already admitted original actor + explicit
 -- business/client, not a service JWT pretending to be that customer.
 EXECUTE format('CREATE FUNCTION public._client_portal_relationship_for_actor(p_tenant_id uuid,p_actor_id uuid,p_use_request_business boolean) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='''' AS %L',actor_relation);
 EXECUTE format('CREATE FUNCTION public._client_portal_lock_relationship_for_actor(p_tenant_id uuid,p_lock text,p_actor_id uuid,p_use_request_business boolean) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L',actor_lock);
 EXECUTE format('CREATE FUNCTION public._client_portal_billing_client_for_actor(p_tenant_id uuid,p_actor_id uuid,p_use_request_business boolean) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L',actor_billing);
 EXECUTE format('CREATE FUNCTION public._client_portal_financial_actor_current(p_actor_id uuid,p_tenant_id uuid,p_expected_client_id uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='''' AS %L',current_body);

 REVOKE ALL ON FUNCTION public._client_portal_relationship_for_actor(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public._client_portal_lock_relationship_for_actor(uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public._client_portal_billing_client_for_actor(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public._client_portal_financial_actor_current(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
 ALTER FUNCTION public._client_portal_relationship_for_actor(uuid,uuid,boolean) OWNER TO postgres;
 ALTER FUNCTION public._client_portal_lock_relationship_for_actor(uuid,text,uuid,boolean) OWNER TO postgres;
 ALTER FUNCTION public._client_portal_billing_client_for_actor(uuid,uuid,boolean) OWNER TO postgres;
 ALTER FUNCTION public._client_portal_financial_actor_current(uuid,uuid,uuid) OWNER TO postgres;

 -- Original defaults/signatures and grants stay authoritative. pg_get_function_arguments
 -- preserves default NULL and the existing lock DEFAULT 'share', not guessed declarations.
 EXECUTE format('CREATE OR REPLACE FUNCTION public.client_portal_relationship_id(%s) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS %L',
  pg_get_function_arguments('public.client_portal_relationship_id(uuid)'::regprocedure),relation_wrapper);
 EXECUTE format('CREATE OR REPLACE FUNCTION public._client_portal_lock_relationship(%s) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',
  pg_get_function_arguments('public._client_portal_lock_relationship(uuid,text)'::regprocedure),lock_wrapper);
 EXECUTE format('CREATE OR REPLACE FUNCTION public._client_portal_billing_client(%s) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS %L',
  pg_get_function_arguments('public._client_portal_billing_client(uuid)'::regprocedure),billing_wrapper);

 SELECT jsonb_agg(jsonb_build_object(
   'oid',p.oid::text,'identity',p.oid::regprocedure::text,'args',pg_get_function_arguments(p.oid),
   'names',p.proargnames,'defaults',p.pronargdefaults,'result',p.prorettype::text,
   'owner',p.proowner::text,'definer',p.prosecdef,'volatility',p.provolatile,
   'language',p.prolang::text,'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.oid)
 INTO final_metadata FROM pg_proc p WHERE p.oid IN(
  'public.client_portal_relationship_id(uuid)'::regprocedure,
  'public._client_portal_lock_relationship(uuid,text)'::regprocedure,
  'public._client_portal_billing_client(uuid)'::regprocedure);
 IF original_metadata IS DISTINCT FROM final_metadata THEN
  RAISE EXCEPTION 'Original financial wrapper ABI/default/OID/ACL/config changed' USING ERRCODE='23514';END IF;

 FOR item IN SELECT * FROM (VALUES
  ('public._client_portal_relationship_for_actor(uuid,uuid,boolean)',actor_relation,'s',ARRAY['p_tenant_id','p_actor_id','p_use_request_business']),
  ('public._client_portal_lock_relationship_for_actor(uuid,text,uuid,boolean)',actor_lock,'v',ARRAY['p_tenant_id','p_lock','p_actor_id','p_use_request_business']),
  ('public._client_portal_billing_client_for_actor(uuid,uuid,boolean)',actor_billing,'v',ARRAY['p_tenant_id','p_actor_id','p_use_request_business']),
  ('public._client_portal_financial_actor_current(uuid,uuid,uuid)',current_body,'v',ARRAY['p_actor_id','p_tenant_id','p_expected_client_id'])
 ) AS s(identity,body,volatility,names) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(item.identity)
    AND NOT p.prosecdef AND p.provolatile::text=item.volatility
    AND p.prosrc=item.body AND p.proargnames=item.names AND p.pronargdefaults=0
    AND p.proconfig=ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner)='postgres'
    AND p.proacl::text='{postgres=X/postgres}') THEN
   RAISE EXCEPTION 'Private financial actor factor readback differs: %',item.identity USING ERRCODE='23514';
  END IF;
 END LOOP;
END $e04_financial_actor$;

COMMENT ON FUNCTION public._client_portal_financial_actor_current(uuid,uuid,uuid) IS
 'PRIVATE actor/financial-relationship currentness only. Trusted original native accepted actor/tenant/client context must precede it; original financial observation/source identity and final publication recheck remain separately required. No API/service grant, token emulation, signature, charge, read receipt or business effect.';
COMMIT;
