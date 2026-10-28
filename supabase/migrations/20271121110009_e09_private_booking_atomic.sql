-- EXP09 private booking component. Not an exposed booking writer or release.
-- The eventual existing server domain adapter must independently verify original
-- Auth before supplying an actor. No API role can call this internal helper.
BEGIN;

DO $lease$
DECLARE actual jsonb;
BEGIN
 SELECT pg_catalog.jsonb_build_object(
  'body',pg_catalog.md5(p.prosrc),'owner',pg_catalog.pg_get_userbyid(p.proowner),
  'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,
  'args',pg_catalog.pg_get_function_identity_arguments(p.oid),
  'result',pg_catalog.pg_get_function_result(p.oid),
  'acl',(SELECT pg_catalog.jsonb_agg(
   CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END
   ||':'||a.privilege_type||':'||a.is_grantable::text
   ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END)
   FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a))
 INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE p.oid=pg_catalog.to_regprocedure('public._client_portal_customer_open(uuid,uuid)');
 IF actual IS DISTINCT FROM $contract${
  "body":"888c27cfa1a9120478db7b7baee7c4f8","owner":"postgres","language":"sql",
  "definer":true,"volatility":"s","config":["search_path=\"\""],
  "args":"p_tenant uuid, p_client uuid","result":"boolean","acl":["postgres:EXECUTE:false"]
 }$contract$::jsonb THEN
  RAISE EXCEPTION 'Original Portal open-access contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE FUNCTION public._client_portal_lock_verified_customer(
 p_verified_actor_id uuid,p_tenant_id uuid,p_expected_client_id uuid
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $binding$
DECLARE customer uuid;
BEGIN
 IF p_verified_actor_id IS NULL OR p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;

 -- Same original CRM/business rows and lock order as the existing Portal
 -- writers. An access change must serialize with the entire native write.
 -- The binding is re-evaluated by PostgreSQL after a conflicting row update.
 SELECT c.id INTO customer FROM public.clients c
 JOIN public.tenants t ON t.id=c.tenant_id
 WHERE c.id=p_expected_client_id AND c.tenant_id=p_tenant_id
  AND c.linked_user_id=p_verified_actor_id
 FOR SHARE OF c,t;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;

 -- Reuse the canonical active/unmerged/open customer and active business
 -- predicate AFTER both locks. This VOLATILE caller issues a fresh statement
 -- after any wait; a pre-wait observation must not authorize a later write.
 IF public._client_portal_customer_open(p_tenant_id,customer) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;
 RETURN customer;
END $binding$;
REVOKE ALL ON FUNCTION public._client_portal_lock_verified_customer(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._client_portal_lock_verified_customer(uuid,uuid,uuid) IS
 'Internal original CRM/business lock for a server-verified customer actor. No API-role execution, authentication, booking or provider authority is granted.';

COMMIT;
