-- EXP09: reuse original profile and access projections for a verified saved portal link.
-- Slug/header/route are narrowing input, never membership. No Identity activation or record write.
BEGIN;
DO $lease$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_access_state()') AND pg_catalog.md5(p.prosrc)='3be0d887895d6ebefa34fbd6b29f431a' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.pronargs=0 AND p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=""'] AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']) THEN
  RAISE EXCEPTION 'Original customer access source/permissions changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_self_profile(uuid)') AND pg_catalog.md5(p.prosrc)='090fd2f8ef6f29ddf8091be7cbd6db7d' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND pg_catalog.pg_get_function_arguments(p.oid)='p_tenant_id uuid DEFAULT NULL::uuid' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']) OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_relationship_id(uuid)') AND pg_catalog.md5(p.prosrc)='ff84ba24689e5043d7d15ed3d9150268') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public._client_portal_request_business()') AND pg_catalog.md5(p.prosrc)='72efd408dc26f9672088f10eea9ebea1') THEN
  RAISE EXCEPTION 'Original customer identity/request contract changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF pg_catalog.to_regprocedure('public._client_portal_access_projection(uuid)') IS NOT NULL OR pg_catalog.to_regprocedure('public.client_portal_entry_for_slug(text)') IS NOT NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_linked_user_id_unique') AND indisunique) THEN
  RAISE EXCEPTION 'Customer entry source or original linkage contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE FUNCTION public._client_portal_access_projection(p_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_hit record;
  v_brand record;
  v_business uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  v_business := p_business;
  BEGIN
    v_id := public.client_portal_relationship_id(v_business);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('state', 'multiple');
  END;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('state', 'open'); END IF;
  SELECT c.tenant_id, c.portal_access_state AS state, c.portal_access_changed_at AS since INTO v_hit
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE ((c.linked_user_id = v_uid AND c.portal_access_state = 'paused' AND c.status = 'active'
          AND c.merged_into_contact_id IS NULL AND t.status = 'active')
     OR (c.portal_access_former_user_id = v_uid AND c.portal_access_state = 'ended' AND c.linked_user_id IS NULL))
    AND (v_business IS NULL OR c.tenant_id = v_business)
  ORDER BY c.portal_access_changed_at DESC NULLS LAST, c.id
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'none'); END IF;
  SELECT rb.tenant_name, COALESCE(rb.logo_url, p.brand_logo_url) AS logo_url, rb.logo_dark_url INTO v_brand
  FROM public.resolve_tenant_brand(v_hit.tenant_id) rb
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = v_hit.tenant_id;
  RETURN jsonb_build_object('state', v_hit.state, 'since', v_hit.since,
    'business', jsonb_build_object('name', v_brand.tenant_name, 'logo_url', v_brand.logo_url,
      'logo_dark_url', v_brand.logo_dark_url))
    -- A scoped browser must be able to reject a pre-migration/ignored hint:
    -- a public brand alone does not identify the requested business.
    || CASE WHEN v_business IS NOT NULL THEN jsonb_build_object('request_business_id',v_business) ELSE '{}'::jsonb END;
END $function$;

REVOKE ALL ON FUNCTION public._client_portal_access_projection(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.client_portal_entry_for_slug(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_actor uuid:=auth.uid();
 v_ids uuid[];
 v_tenant uuid;
 v_slug text;
 v_hint uuid;
 v_profile jsonb;
 v_access jsonb;
 v_state text;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
 v_hint:=public._client_portal_request_business();
 IF p_slug IS NULL OR pg_catalog.btrim(p_slug)='' THEN RETURN NULL; END IF;
 -- Match the original public brand's lower(t.slug)=lower(trim(input)) semantics.
 -- At most two candidates detect ambiguity; never select an arbitrary business.
 SELECT pg_catalog.array_agg(candidate.id ORDER BY candidate.id),pg_catalog.min(candidate.slug)
 INTO v_ids,v_slug FROM (
  SELECT t.id,t.slug FROM public.tenants t
  WHERE pg_catalog.lower(t.slug)=pg_catalog.lower(pg_catalog.btrim(p_slug))
  ORDER BY t.id LIMIT 2
 ) candidate;
 IF COALESCE(pg_catalog.cardinality(v_ids),0)=0 THEN RETURN NULL; END IF;
 IF pg_catalog.cardinality(v_ids)<>1 THEN
  RAISE EXCEPTION 'customer business could not be resolved' USING ERRCODE='42501';
 END IF;
 v_tenant:=v_ids[1];
 IF v_hint IS NOT NULL AND v_hint<>v_tenant THEN RETURN NULL; END IF;
 -- Existing native profile supplies active authority, not the public slug or a role/email.
 v_profile:=public.client_portal_self_profile(v_tenant);
 IF v_profile IS NOT NULL THEN
  IF pg_catalog.jsonb_typeof(v_profile)<>'object'
   OR v_profile->>'linked_user_id' IS DISTINCT FROM v_actor::text
   OR v_profile->>'tenant_id' IS DISTINCT FROM v_tenant::text
   OR pg_catalog.jsonb_typeof(v_profile->'id') IS DISTINCT FROM 'string'
   OR NOT (v_profile->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
   RAISE EXCEPTION 'customer relationship could not be verified' USING ERRCODE='42501';
  END IF;
  v_state:='open';
 ELSE
  -- Only the original S7 policy can permit an own paused/ended notice.
  v_access:=public._client_portal_access_projection(v_tenant);
  v_state:=v_access->>'state';
  IF v_state IS NULL OR v_state NOT IN ('paused','ended') THEN RETURN NULL; END IF;
 END IF;
 RETURN pg_catalog.jsonb_build_object('contract_version',1,'actor_id',v_actor,
  'tenant_id',v_tenant,'tenant_slug',v_slug,'state',v_state);
END;
$function$;
REVOKE ALL ON FUNCTION public.client_portal_entry_for_slug(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_entry_for_slug(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_access_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  RETURN public._client_portal_access_projection(public._client_portal_request_business());
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
