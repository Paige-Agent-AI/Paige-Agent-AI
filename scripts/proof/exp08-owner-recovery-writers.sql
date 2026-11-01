-- INERT local recovery writer preparation. NOT a migration or a public recovery endpoint.
-- The original holder-state and eligibility helpers are reused, never reimplemented here.
-- The first private lock step alone produces no effect, audit, notification or receipt.
-- The later private R12 effect is incomplete until composed into the original recovery transaction.
CREATE OR REPLACE FUNCTION public._exp08_lock_recovery_actor()
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin' FOR SHARE;
  IF NOT FOUND OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_lock_recovery_actor()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_lock_owner_recovery(_tenant uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := public._exp08_lock_recovery_actor();
  previous_holder uuid;
BEGIN
  IF _tenant IS NULL THEN
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
  IF public._exp08_lock_recovery_actor() IS DISTINCT FROM actor
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
    IF md5(original_body) IS DISTINCT FROM '2a75180de63325dd7e328a73e494e6dc'
      OR (length(kernel_body)-length(replace(kernel_body,new_platform,'')))/length(new_platform)<>1
      OR (length(kernel_body)-length(replace(kernel_body,new_begin,'')))/length(new_begin)<>1
      OR (length(kernel_body)-length(replace(kernel_body,new_target,'')))/length(new_target)<>1
      OR kernel_body IS DISTINCT FROM replace(replace(replace(original_body,
        old_platform,new_platform),old_begin,new_begin),old_target,new_target) THEN
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

-- Original audit is the durable receipt; no second operation/result table.
-- Private operator receipt only. Current recipient/private-notice readers remain separate work.
CREATE OR REPLACE FUNCTION public._exp08_require_recovery_audit()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.paige_audit_log'::regclass
    AND c.relowner='postgres'::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid='public.paige_audit_log'::regclass
      AND p.polname='exp08_owner_recovery_native_rows' AND NOT p.polpermissive AND p.polcmd='*'
      AND ARRAY(SELECT x FROM unnest(p.polroles) r(x) ORDER BY x)=
        ARRAY(SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY oid)
      AND pg_catalog.pg_get_expr(p.polqual,p.polrelid)='(NOT starts_with(action, ''tenant:owner_recovery.''::text))'
      AND pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)='(NOT starts_with(action, ''tenant:owner_recovery.''::text))')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
      WHERE t.tgrelid='public.paige_audit_log'::regclass AND t.tgname='trg_owner_recovery_audit_truncate'
      AND t.tgenabled='O' AND t.tgtype=34 AND NOT t.tgisinternal
      AND f.oid=to_regprocedure('public.guard_owner_recovery_audit_truncate()')
      AND f.proowner='postgres'::regrole AND f.prosecdef
      AND md5(f.prosrc)='10797adfc24d314cdd592312eed9c3ab'
      AND f.proconfig=ARRAY['search_path=""']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        WHERE a.grantee<>f.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_AUDIT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_require_recovery_audit()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_read_owner_recovery(_tenant uuid,_request uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := public._exp08_lock_recovery_actor(); a public.paige_audit_log%ROWTYPE;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF _tenant IS NULL OR _request IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_BAD_REQUEST' USING ERRCODE='22023';
  END IF;
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','request_id',_request);END IF;
  IF a.tenant_id IS DISTINCT FROM _tenant OR a.actor_user_id IS DISTINCT FROM actor
    OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.action NOT IN ('tenant:owner_recovery.grant_owner','tenant:owner_recovery.set_account_holder','tenant:owner_recovery.revoke_owner')
    OR a.payload->>'request_id' IS DISTINCT FROM _request::text
    OR a.payload->>'outcome' IS DISTINCT FROM 'effect_verified' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_RECEIPT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('status','found','audit_id',a.id,'tenant_id',a.tenant_id,
    'action',a.action,'target_user_id',a.target_id,
    'receipt',a.payload-ARRAY['transaction_id','backend_pid']::text[],'recorded_at',a.created_at);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_read_owner_recovery(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Effect-time domain integration only, never a post-commit receipt/delivery predicate.
CREATE OR REPLACE FUNCTION public._exp08_lock_recovery_effect(
  _tenant uuid,_user uuid,_request uuid,_act text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := public._exp08_lock_recovery_actor(); a public.paige_audit_log%ROWTYPE;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  PERFORM public._exp08_lock_owner_recovery(_tenant);
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request FOR UPDATE;
  IF NOT FOUND OR _user IS NULL OR _request IS NULL OR _act IS NULL
    OR _act NOT IN ('grant_owner','revoke_owner','set_account_holder')
    OR a.actor_user_id IS DISTINCT FROM actor OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.tenant_id IS DISTINCT FROM _tenant OR a.target_id IS DISTINCT FROM _user
    OR a.action IS DISTINCT FROM 'tenant:owner_recovery.'||_act
    OR a.payload->>'request_id' IS DISTINCT FROM _request::text
    OR a.payload->>'target' IS DISTINCT FROM _user::text
    OR a.payload->>'outcome' IS DISTINCT FROM 'preparing'
    OR a.payload->>'transaction_id' IS DISTINCT FROM pg_current_xact_id()::text
    OR a.payload->>'backend_pid' IS DISTINCT FROM pg_backend_pid()::text THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_EFFECT_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_lock_recovery_effect(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_apply_owner_recovery(
  _tenant uuid,_act text,_user uuid,_reason text,_request uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := public._exp08_lock_recovery_actor();
  reason text := btrim(_reason);
  previous_holder uuid;
  a public.paige_audit_log%ROWTYPE;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF _tenant IS NULL OR _user IS NULL OR _request IS NULL OR _act IS NULL
    OR _act NOT IN ('grant_owner','revoke_owner','set_account_holder')
    OR reason IS NULL OR char_length(reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_BAD_REQUEST' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('exp08_owner_recovery_request:'||_request::text,0));
  IF public._exp08_lock_recovery_actor() IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request;
  IF FOUND THEN
    IF a.actor_user_id IS DISTINCT FROM actor OR a.tenant_id IS DISTINCT FROM _tenant
      OR a.action IS DISTINCT FROM 'tenant:owner_recovery.'||_act OR a.target_id IS DISTINCT FROM _user
      OR a.payload->>'reason' IS DISTINCT FROM reason THEN
      RAISE EXCEPTION 'OWNER_RECOVERY_REQUEST_MISMATCH' USING ERRCODE='42501';
    END IF;
    -- Post-act working state is valid receipt/replay, not a new recovery admission.
    RETURN public._exp08_read_owner_recovery(_tenant,_request);
  END IF;
  previous_holder := public._exp08_lock_owner_recovery(_tenant);
  -- Reserve the native identity BEFORE effects, in this same transaction/backend.
  -- A dependent private domain writer can bind to this actual row, never caller JSON/GUC.
  INSERT INTO public.paige_audit_log(id,actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
  VALUES(_request,actor,'super_admin','tenant:owner_recovery.'||_act,'user',_user,_tenant,
    jsonb_build_object('request_id',_request,'reason',reason,'target',_user,
      'previous_owner_user_id',previous_holder,'outcome','preparing',
      'transaction_id',pg_current_xact_id()::text,'backend_pid',pg_backend_pid(),
      'notice_status','not_prepared','notified','[]'::jsonb));
  IF _act='grant_owner' THEN
    PERFORM public._exp08_grant_co_owner(_tenant,_user,true);
    IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant
      AND user_id=_user AND is_owner AND status='active' AND role='owner') THEN
      RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
    END IF;
  ELSIF _act='set_account_holder' THEN
    PERFORM public._exp08_set_recovery_holder(_tenant,_user);
  ELSE
    -- Original E02 cleanup contract is required; no fallback financial writer.
    RAISE EXCEPTION 'OWNER_RECOVERY_REVOKE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  UPDATE public.paige_audit_log SET payload=jsonb_set(payload,'{outcome}','"effect_verified"'::jsonb)
    WHERE id=_request AND tenant_id=_tenant AND actor_user_id=actor AND target_id=_user
      AND action='tenant:owner_recovery.'||_act AND payload->>'outcome'='preparing'
      AND payload->>'transaction_id'=pg_current_xact_id()::text
      AND payload->>'backend_pid'=pg_backend_pid()::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
  END IF;
  RETURN public._exp08_read_owner_recovery(_tenant,_request);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
