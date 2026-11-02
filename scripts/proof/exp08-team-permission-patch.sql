-- Original standalone proof component remains atomic.
DO $exp08_literal_permission_component$
BEGIN
 EXECUTE $exp08_literal_permission_sql$-- Literal original Team native source; no provider or business-data operation.
DO $exp08_literal_guard$
DECLARE p pg_catalog.pg_proc; before_state boolean:=true; after_state boolean:=true;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 native installer requires postgres'; END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_member_user_id uuid, _new_permission text'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'void' THEN RAISE EXCEPTION 'EXP08 permission original metadata drift'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'22955528946ff6e78d915bffd1ebd43a' THEN after_state:=false; END IF;
  IF pg_catalog.md5(p.prosrc)<>'aab67c9a70880f160de550e4361a6142' THEN before_state:=false; END IF;
  IF pg_catalog.md5(p.prosrc) NOT IN ('22955528946ff6e78d915bffd1ebd43a','aab67c9a70880f160de550e4361a6142') THEN RAISE EXCEPTION 'EXP08 permission original source drift'; END IF;
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 IF NOT FOUND THEN
  after_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_member_user_id uuid, _new_permission text, _expected_tenant_id uuid, _expected_membership_id uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb' THEN RAISE EXCEPTION 'EXP08 scoped permission original door drift'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'8031e2f869f82de92262023e691f73da' THEN after_state:=false; END IF;
  before_state:=false;
  IF pg_catalog.md5(p.prosrc) NOT IN ('8031e2f869f82de92262023e691f73da') THEN RAISE EXCEPTION 'EXP08 scoped permission original door drift'; END IF;
 END IF;
 IF pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'EXP08 unexpected intermediate scoped overload'; END IF;
 IF NOT before_state AND NOT after_state THEN RAISE EXCEPTION 'EXP08 Team details partial installation'; END IF;
END $exp08_literal_guard$;
CREATE OR REPLACE FUNCTION public.set_solo_team_member_permission(_member_user_id uuid, _new_permission text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _target public.tenant_members;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_owner(_actor, _tenant) THEN
    RAISE EXCEPTION 'only the tenant owner may change permission levels' USING ERRCODE = '42501';
  END IF;
  IF lower(trim(_new_permission)) NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'permission must be Admin or Member';
  END IF;

  -- exp08_permission_currentness_v1: same original actor/scope authority under ordered locks.
  -- Original retirement exclusion precedes Auth/member row locks.
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
  PERFORM 1 FROM auth.users u WHERE u.id=_actor FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) THEN
    RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed'
      USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant
    AND m.user_id IN (_actor,_member_user_id) ORDER BY m.user_id FOR UPDATE;
  PERFORM 1 FROM public.profiles p WHERE p.user_id=_actor FOR SHARE;
  PERFORM 1 FROM public.tenants t WHERE t.id=_tenant FOR SHARE;
  IF public.current_user_tenant_id() IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_tenant_owner(_actor,_tenant) THEN
    RAISE EXCEPTION 'only the tenant owner may change permission levels' USING ERRCODE='42501';
  END IF;

  SELECT * INTO _target
  FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant AND tm.user_id = _member_user_id
  FOR UPDATE;

  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'team member not found in this workspace';
  END IF;
  IF _target.is_owner OR _target.role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'the owner permission cannot be changed here' USING ERRCODE = '42501';
  END IF;

  -- Same permitted state after a lost reply is not a second original effect/audit.
  -- This follows ALL original target/owner and fresh actor/scope authority checks.
  IF _target.role = lower(trim(_new_permission))::public.tenant_role THEN
    RETURN;
  END IF;

  UPDATE public.tenant_members
  SET role = lower(trim(_new_permission))::public.tenant_role,
      updated_at = now()
  WHERE id = _target.id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_member', 'permission_changed', _target.id,
          jsonb_build_object('tenant_id', _tenant, 'target_user_id', _member_user_id,
                             'from', _target.role::text, 'to', lower(trim(_new_permission))));
END;
$function$;
REVOKE ALL ON FUNCTION public.set_solo_team_member_permission(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_solo_team_member_permission(_member_user_id uuid, _new_permission text, _expected_tenant_id uuid, _expected_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 _actor uuid:=auth.uid(); _tenant uuid:=public.current_user_tenant_id(); _row public.tenant_members;
BEGIN
 IF _actor IS NULL OR _tenant IS NULL THEN
  RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE='42501';
 END IF;
 IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
  RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed' USING ERRCODE='42501';
 END IF;
 IF NOT public.is_tenant_owner(_actor,_tenant) THEN
  RAISE EXCEPTION 'only the tenant owner may change permission levels' USING ERRCODE='42501';
 END IF;
 -- Original retirement exclusion precedes Auth/member row locks.
 LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users u WHERE u.id=_actor FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor
   AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) THEN
  RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant
  AND m.user_id IN (_actor,_member_user_id) ORDER BY m.user_id FOR UPDATE;
 PERFORM 1 FROM public.profiles p WHERE p.user_id=_actor FOR SHARE;
 PERFORM 1 FROM public.tenants t WHERE t.id=_tenant FOR SHARE;
 IF public.current_user_tenant_id() IS DISTINCT FROM _tenant OR _expected_tenant_id IS DISTINCT FROM _tenant THEN
  RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed' USING ERRCODE='42501';
 END IF;
 IF NOT public.is_tenant_owner(_actor,_tenant) THEN
  RAISE EXCEPTION 'only the tenant owner may change permission levels' USING ERRCODE='42501';
 END IF;
 -- Both expected values refuse stale intent; neither selects actor, tenant or target.
 IF _expected_membership_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.tenant_members m
   WHERE m.tenant_id=_tenant AND m.user_id=_member_user_id AND m.id=_expected_membership_id) THEN
  RAISE EXCEPTION 'this team membership changed before this could run; nothing was changed' USING ERRCODE='42501';
 END IF;
 -- The ORIGINAL writer alone owns validation/effect/audit. No alternate effect path.
 PERFORM public.set_solo_team_member_permission(_member_user_id,_new_permission);
 SELECT m.* INTO _row FROM public.tenant_members m WHERE m.tenant_id=_tenant AND m.user_id=_member_user_id;
 IF _row.id IS DISTINCT FROM _expected_membership_id OR _row.role::text IS DISTINCT FROM lower(trim(_new_permission))
   OR _row.role::text NOT IN ('admin','member') THEN
  RAISE EXCEPTION 'TEAM_PERMISSION_UNCONFIRMED' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('membership_id',_row.id,'permission',_row.role::text);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) TO authenticated;
DO $exp08_literal_guard$
DECLARE p pg_catalog.pg_proc; before_state boolean:=true; after_state boolean:=true;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 native installer requires postgres'; END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_member_user_id uuid, _new_permission text'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'void' THEN RAISE EXCEPTION 'EXP08 permission original metadata drift'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'22955528946ff6e78d915bffd1ebd43a' THEN after_state:=false; END IF;
  before_state:=false;
  IF pg_catalog.md5(p.prosrc) NOT IN ('22955528946ff6e78d915bffd1ebd43a') THEN RAISE EXCEPTION 'EXP08 permission original source drift'; END IF;
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_member_user_id uuid, _new_permission text, _expected_tenant_id uuid, _expected_membership_id uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb' THEN RAISE EXCEPTION 'EXP08 scoped permission original door drift'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'8031e2f869f82de92262023e691f73da' THEN after_state:=false; END IF;
  before_state:=false;
  IF pg_catalog.md5(p.prosrc) NOT IN ('8031e2f869f82de92262023e691f73da') THEN RAISE EXCEPTION 'EXP08 scoped permission original door drift'; END IF;
 END IF;
 IF NOT after_state THEN RAISE EXCEPTION 'EXP08 literal native result could not be verified'; END IF;
END $exp08_literal_guard$;
$exp08_literal_permission_sql$;
END $exp08_literal_permission_component$;
