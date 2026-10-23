-- EXP09: narrow three original legacy read-only contracts through the existing verified relationship.
-- Original ABI, owner, ACL, search paths, INVOKER/RLS and global identity constraint are preserved.
BEGIN;
DO $lease$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.customer_paige_activity_summary(integer)') AND pg_catalog.md5(p.prosrc)='7332e6e6e8d21e808b28bc50314f13a4' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public'] AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']) THEN
  RAISE EXCEPTION 'Original customer read source/permissions changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_client_service_agreement()') AND pg_catalog.md5(p.prosrc)='51c9aa687ef0fa236ef79c4c3255e1c2' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public'] AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false']) THEN
  RAISE EXCEPTION 'Original customer read source/permissions changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_workspace_brand()') AND pg_catalog.md5(p.prosrc)='720d537748518bc3424325ec9acd331d' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public'] AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']) THEN
  RAISE EXCEPTION 'Original customer read source/permissions changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_relationship_id(uuid)') AND pg_catalog.md5(p.prosrc)='ff84ba24689e5043d7d15ed3d9150268') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_linked_user_id_unique') AND indisunique) THEN
  RAISE EXCEPTION 'Original customer relationship contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE OR REPLACE FUNCTION public.customer_paige_activity_summary(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
  v_count int;
  v_last timestamptz;
BEGIN
  SELECT id INTO v_contact_id FROM public.clients WHERE linked_user_id = auth.uid() AND portal_access_state = 'open' AND id = public.client_portal_relationship_id(NULL::uuid) LIMIT 1;
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINKED_CONTACT');
  END IF;
  SELECT count(*), max(created_at) INTO v_count, v_last
  FROM public.paige_context_loads
  WHERE contact_id = v_contact_id
    AND consent_state = 'granted'
    AND created_at > now() - make_interval(days => p_days);
  RETURN jsonb_build_object('ok', true, 'window_days', p_days, 'count', v_count, 'last_at', v_last);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_service_agreement()
 RETURNS TABLE(tenant_name text, agreement_title text, agreement_body text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.name, p.service_agreement_title, p.service_agreement_body
  FROM public.clients c
  JOIN public.tenants t ON t.id = c.tenant_id
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = t.id
  WHERE c.linked_user_id = auth.uid()
    AND public.client_portal_access_open(c.id)
    AND c.id = public.client_portal_relationship_id(NULL::uuid)
  ORDER BY c.created_at ASC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_workspace_brand()
 RETURNS TABLE(tenant_id uuid, tenant_name text, white_label_ai_connect boolean, brand_display_name text, brand_logo_url text, legal_business_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    COALESCE(p.white_label_ai_connect, true) AS white_label_ai_connect,
    p.brand_display_name,
    p.brand_logo_url,
    p.legal_business_name
  FROM public.clients c
  JOIN public.tenants t ON t.id = c.tenant_id
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = t.id
  WHERE c.linked_user_id = auth.uid()
    AND public.client_portal_access_open(c.id)
    AND c.id = public.client_portal_relationship_id(NULL::uuid)
  LIMIT 1;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
