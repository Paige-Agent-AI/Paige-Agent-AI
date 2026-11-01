-- INERT local recovery writer preparation. NOT a migration or a public recovery endpoint.
-- The original holder-state and eligibility helpers are reused, never reimplemented here.
-- The first private lock step alone produces no effect, audit, notification or receipt.
-- The later private R12 effect is incomplete until composed into the original recovery transaction.
CREATE OR REPLACE FUNCTION public._exp08_lock_owner_recovery(_tenant uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  previous_holder uuid;
BEGIN
  IF actor IS NULL OR _tenant IS NULL OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Hold the actual live identity and role records, rather than trusting JWT role claims.
  -- SHARE also conflicts with a ban/soft-delete update of this existing identity.
  PERFORM 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.user_roles
    WHERE user_id=actor AND role='super_admin' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Preserve the original owner writer's members -> tenant lock order.
  PERFORM 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND is_owner AND status='active'
    ORDER BY id FOR UPDATE;
  SELECT owner_user_id INTO previous_holder FROM public.tenants
    WHERE id=_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Every earlier wait may have changed the tenant or its authority. Re-read now.
  IF auth.uid() IS DISTINCT FROM actor
    OR NOT public.is_super_admin(actor)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
      AND (banned_until IS NULL OR banned_until<=statement_timestamp()))
    OR public._solo_shell_tenant(_tenant) IS DISTINCT FROM true
    OR public._tenant_account_holder_state(_tenant) IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN previous_holder;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_lock_owner_recovery(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Private R12 effect for the future original recovery transaction. No client EXECUTE.
-- The outer transaction still owes recovery audit, private notices and durable replay.
CREATE OR REPLACE FUNCTION public._exp08_set_recovery_holder(_tenant uuid,_user uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  previous_holder uuid;
  previous_flag text := current_setting('paige.owner_recovery',true);
BEGIN
  previous_holder := public._exp08_lock_owner_recovery(_tenant);
  IF _user IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM auth.users WHERE id=_user AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_user
    AND is_owner AND status='active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER' USING ERRCODE='42501';
  END IF;
  -- The target wait can also change the precondition; no cached holder-none authority.
  PERFORM public._exp08_lock_owner_recovery(_tenant);
  BEGIN
    PERFORM set_config('paige.owner_recovery','on',true);
    UPDATE public.tenants SET owner_user_id=_user WHERE id=_tenant;
    PERFORM set_config('paige.owner_recovery',coalesce(previous_flag,''),true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('paige.owner_recovery',coalesce(previous_flag,''),true);
    RAISE;
  END;
  IF public._tenant_account_holder_state(_tenant) IS DISTINCT FROM 'working' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
  END IF;
  RETURN previous_holder;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_set_recovery_holder(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Move the ORIGINAL grant body into one private kernel; the public ABI delegates.
-- This is local preparation only. The public recovery transaction is still absent.
DO $grant_kernel$
DECLARE
  p pg_proc;
  original_definition text;
  original_body text;
  kernel_body text;
  before_metadata jsonb;
  wrapper constant text := E'\nBEGIN\n  PERFORM public._exp08_grant_co_owner(_tenant,_user,false);\nEND;\n';
  old_platform constant text := '_is_platform boolean := public.is_platform_owner();';
  new_platform constant text := '_is_platform boolean := public.is_platform_owner() AND NOT public._solo_shell_tenant(_tenant);';
  old_begin constant text := E'BEGIN\n  IF _caller IS NULL THEN';
  new_begin constant text := E'BEGIN\n  -- exp08_recovery_grant_kernel_v1: private mode, never a caller flag.\n  IF _recovery IS NULL THEN\n    RAISE EXCEPTION ''OWNER_RECOVERY_FORBIDDEN'' USING ERRCODE=''42501'';\n  ELSIF _recovery THEN\n    PERFORM public._exp08_lock_owner_recovery(_tenant);\n    _is_platform := true;\n  END IF;\n  IF _caller IS NULL THEN';
  old_target constant text := '  -- Elevate ONLY an existing, active member of THIS tenant.';
  new_target constant text := E'  IF _recovery THEN\n    PERFORM 1 FROM auth.users WHERE id=_user AND deleted_at IS NULL\n      AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;\n    IF NOT FOUND THEN\n      RAISE EXCEPTION ''CO_OWNER_NOT_ACTIVE_MEMBER'' USING ERRCODE=''42501'';\n    END IF;\n    PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_user FOR UPDATE;\n    PERFORM public._exp08_lock_owner_recovery(_tenant);\n  END IF;\n  -- Elevate ONLY an existing, active member of THIS tenant.';
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.grant_co_owner(uuid,uuid)');
  IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
    OR p.provolatile<>'v' OR p.proretset OR p.prorettype<>'void'::regtype
    OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user']::text[]
    OR p.pronargdefaults<>0 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
        OR a.privilege_type<>'EXECUTE' OR (a.is_grantable AND a.grantee<>p.proowner))
    OR NOT has_function_privilege('postgres',p.oid,'EXECUTE')
    OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'EXP08 recovery original grant metadata drift';
  END IF;
  IF p.prosrc=wrapper THEN
    SELECT prosrc INTO kernel_body FROM pg_proc
      WHERE oid=to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)');
    original_body:=replace(replace(replace(kernel_body,new_platform,old_platform),new_begin,old_begin),new_target,old_target);
    IF md5(original_body) IS DISTINCT FROM '2a75180de63325dd7e328a73e494e6dc' THEN
      RAISE EXCEPTION 'EXP08 recovery grant kernel replay drift';
    END IF;
  ELSE
    IF md5(p.prosrc)<>'2a75180de63325dd7e328a73e494e6dc'
      OR to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)') IS NOT NULL THEN
      RAISE EXCEPTION 'EXP08 recovery grant original source or partial kernel drift';
    END IF;
    original_body:=p.prosrc;
    kernel_body:=replace(replace(replace(original_body,old_platform,new_platform),old_begin,new_begin),old_target,new_target);
    IF kernel_body=original_body OR
      replace(replace(replace(kernel_body,new_platform,old_platform),new_begin,old_begin),new_target,old_target)<>original_body THEN
      RAISE EXCEPTION 'EXP08 recovery grant exact original-body conservation failed';
    END IF;
    original_definition:=pg_get_functiondef(p.oid);
    before_metadata:=to_jsonb(p)-'prosrc';
    EXECUTE replace(replace(original_definition,
      'public.grant_co_owner(_tenant uuid, _user uuid)',
      'public._exp08_grant_co_owner(_tenant uuid, _user uuid, _recovery boolean)'),original_body,kernel_body);
    REVOKE ALL ON FUNCTION public._exp08_grant_co_owner(uuid,uuid,boolean)
      FROM PUBLIC,anon,authenticated,service_role;
    EXECUTE replace(original_definition,original_body,wrapper);
    IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=p.oid) IS DISTINCT FROM before_metadata THEN
      RAISE EXCEPTION 'EXP08 recovery original public grant metadata changed';
    END IF;
  END IF;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)');
  IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
    OR p.proretset OR p.prorettype<>'void'::regtype OR p.pronargdefaults<>0
    OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user','_recovery']::text[]
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
    OR NOT has_function_privilege('postgres',p.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'EXP08 recovery private grant metadata or ACL drift';
  END IF;
END;
$grant_kernel$;
