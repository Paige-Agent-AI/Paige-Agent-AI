-- EXP09: preserve original client identity floor without selecting an ambiguous business.
-- Original private resolver/wrappers only; no grants, role/identity writer or activation.
BEGIN;
DO $lease$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.get_actor_access(uuid)')
    AND pg_catalog.md5(p.prosrc)='574bad191b12f518da0a720fbb210369'
    AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_actor uuid'
    AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND p.proconfig=ARRAY['search_path=public']
    AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['postgres:EXECUTE:false','service_role:EXECUTE:false']
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.get_my_access()') AND pg_catalog.md5(prosrc)='4fdea684b3d4dfdf08753fe18820c4ed'
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.resolve_actor_tier(uuid,uuid)') AND pg_catalog.md5(prosrc)='a577a7bfb44322bebb0e407cfd440c1e'
 ) THEN
  RAISE EXCEPTION 'Original delegated identity/tier contract changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_linked_user_id_unique') AND indisunique AND indisvalid
    AND pg_catalog.pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL)'
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_tenant_linked_user_key') AND indisunique AND indisvalid
    AND pg_catalog.pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_tenant_linked_user_key ON public.clients USING btree (tenant_id, linked_user_id)'
 ) THEN
  RAISE EXCEPTION 'Original delegated identity linkage contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE OR REPLACE FUNCTION public.get_actor_access(_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _roles  text[] := COALESCE((SELECT array_agg(role::text) FROM public.user_roles WHERE user_id = _actor), '{}');
  _ag     uuid;
  _active uuid;
  _valid  uuid;
  _acct   text;
  _parent uuid;
BEGIN
  IF _actor IS NULL THEN
    RETURN jsonb_build_object('tier','none','account_id',NULL,'agency_id',NULL,'is_manager',false,'roles','[]'::jsonb,'via','null_actor');
  END IF;

  IF public.is_platform_admin(_actor) THEN
    RETURN jsonb_build_object('tier','god','account_id',NULL,'agency_id',NULL,'is_manager',true,'roles',to_jsonb(_roles),'via','platform_role');
  END IF;

  SELECT active_tenant_id INTO _active FROM public.profiles WHERE user_id = _actor;

  _ag := public.agency_current_id(_actor);
  IF _ag IS NOT NULL THEN
    _valid := CASE
      WHEN _active IS NOT NULL AND (
             _active = _ag
             OR public.agency_can_manage_child(_active, _actor)
             OR EXISTS (SELECT 1 FROM public.tenant_members m
                          WHERE m.user_id = _actor AND m.tenant_id = _active AND m.status = 'active')
           ) THEN _active
      ELSE _ag
    END;
    RETURN jsonb_build_object(
      'tier','agency',
      'account_id',_valid,
      'agency_id',_ag,
      'is_manager', public.agency_team_role(_ag, _actor) IN ('agency_owner','agency_admin','agency_manager'),
      'roles',to_jsonb(_roles),
      'via','agency_team_rail'
    );
  END IF;

  _valid := CASE
    WHEN _active IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.tenant_members m
            WHERE m.user_id = _actor AND m.tenant_id = _active AND m.status = 'active')
      THEN _active
    ELSE (SELECT tenant_id FROM public.tenant_members
            WHERE user_id = _actor AND status = 'active'
            ORDER BY joined_at ASC NULLS LAST LIMIT 1)
  END;
  IF _valid IS NOT NULL THEN
    SELECT account_type, parent_tenant_id INTO _acct, _parent FROM public.tenants WHERE id = _valid;
    RETURN jsonb_build_object(
      'tier', CASE WHEN _acct = 'standalone' AND _parent IS NOT NULL THEN 'subaccount' ELSE 'tenant' END,
      'account_id',_valid,
      'agency_id',_parent,
      'is_manager', EXISTS (SELECT 1 FROM public.tenant_members m
                              WHERE m.user_id = _actor AND m.tenant_id = _valid
                                AND m.status = 'active' AND m.role IN ('owner','admin')),
      'roles',to_jsonb(_roles),
      'via','tenant_members'
    );
  END IF;

  SELECT c.tenant_id INTO _valid FROM public.clients c WHERE c.linked_user_id = _actor
    AND NOT EXISTS (SELECT 1 FROM public.clients other_client
      WHERE other_client.linked_user_id = _actor AND other_client.id <> c.id)
    ORDER BY c.created_at ASC LIMIT 1;
  IF _valid IS NOT NULL THEN
    RETURN jsonb_build_object('tier','client','account_id',_valid,'agency_id',NULL,'is_manager',false,'roles',to_jsonb(_roles),'via','clients_linked_user');
  END IF;

  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.linked_user_id = _actor) THEN
    RETURN jsonb_build_object('tier','client','account_id',NULL,'agency_id',NULL,'is_manager',false,'roles',to_jsonb(_roles),'via','client_relationship_required');
  END IF;

  RETURN jsonb_build_object('tier','none','account_id',NULL,'agency_id',NULL,'is_manager',false,'roles',to_jsonb(_roles),'via','unplaced');
END;
$function$;
COMMIT;
