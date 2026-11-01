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
