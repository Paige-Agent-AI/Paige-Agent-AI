-- EXP09: narrow original legacy self-context and service-only recovery to the selected relationship.
-- Preserve all original source, consent, role/audit behavior, ABI, owner, RLS and permissions.
-- This does not grant authenticated recovery execution or activate multiple-business linkage.
BEGIN;
DO $lease$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.load_self_context()') AND pg_catalog.md5(p.prosrc)='ab8f20546c8231cbac0efc5bcc4b3381' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.pronargs=0 AND p.prosecdef=false AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public'] AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']) THEN
  RAISE EXCEPTION 'Original customer context/recovery contract changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.ensure_client_role_self_heal()') AND pg_catalog.md5(p.prosrc)='2c3c45b1007a7658666b4863a8b9dbd0' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.pronargs=0 AND p.prosecdef=true AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public'] AND pg_catalog.pg_get_function_result(p.oid)='TABLE(healed boolean, onboarding_stage text, client_id uuid)' AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['postgres:EXECUTE:false','service_role:EXECUTE:false']) THEN
  RAISE EXCEPTION 'Original customer context/recovery contract changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_relationship_id(uuid)') AND pg_catalog.md5(p.prosrc)='ff84ba24689e5043d7d15ed3d9150268') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.load_contact_context(uuid,text[])') AND pg_catalog.md5(p.prosrc)='66685db32ea456a064dc0f373fe92410') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_linked_user_id_unique') AND indisunique) THEN
  RAISE EXCEPTION 'Original customer resolver/consent/identity contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE OR REPLACE FUNCTION public.load_self_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
BEGIN
  SELECT id INTO v_contact_id FROM public.clients WHERE linked_user_id = auth.uid() AND portal_access_state = 'open' AND id = public.client_portal_relationship_id(NULL::uuid) LIMIT 1;
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINKED_CONTACT');
  END IF;
  RETURN public.load_contact_context(v_contact_id, ARRAY['contact','self']::text[]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_client_role_self_heal()
 RETURNS TABLE(healed boolean, onboarding_stage text, client_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_client_id uuid;
  v_stage text;
  v_had_role boolean;
  v_healed boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT id, clients.onboarding_stage INTO v_client_id, v_stage
  FROM public.clients
  WHERE linked_user_id = v_user
    AND portal_access_state = 'open'
    AND id = public.client_portal_relationship_id(NULL::uuid)
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role = 'client'
  ) INTO v_had_role;

  IF NOT v_had_role THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user, 'client')
    ON CONFLICT (user_id, role) DO NOTHING;
    v_healed := true;
  END IF;

  IF v_stage IS NULL THEN
    UPDATE public.clients
       SET onboarding_stage = 'invited'
     WHERE id = v_client_id;
    v_stage := 'invited';
    v_healed := true;
  END IF;

  IF v_healed THEN
    BEGIN
      INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, payload)
      VALUES (v_user, 'client_role_self_heal', 'client', v_client_id,
              jsonb_build_object('granted_role', NOT v_had_role, 'seeded_stage', v_stage));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN QUERY SELECT v_healed, v_stage, v_client_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
