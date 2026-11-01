-- INERT original Team permission effect-time repair; no managed version or activation.
DO $permission_patch$
DECLARE target regprocedure:=to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 p pg_proc; original text; changed text; definition text; metadata jsonb; scoped pg_proc; scoped_target regprocedure;
 scope_body constant text:=$scope$
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
$scope$;
 noop_anchor constant text:=$noop_anchor$  UPDATE public.tenant_members
  SET role = lower(trim(_new_permission))::public.tenant_role,$noop_anchor$;
 noop_guard constant text:=$noop$  -- Same permitted state after a lost reply is not a second original effect/audit.
  -- This follows ALL original target/owner and fresh actor/scope authority checks.
  IF _target.role = lower(trim(_new_permission))::public.tenant_role THEN
    RETURN;
  END IF;

$noop$;
 anchor constant text:=$anchor$  SELECT * INTO _target
  FROM public.tenant_members tm$anchor$;
 guard constant text:=$guard$  -- exp08_permission_currentness_v1: same original actor/scope authority under ordered locks.
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

$guard$;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=target;
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>'void'::regtype
  OR pg_get_function_arguments(target) IS DISTINCT FROM '_member_user_id uuid, _new_permission text' THEN
  RAISE EXCEPTION 'EXP08 permission original metadata drift';
 END IF;
 original:=p.prosrc;metadata:=to_jsonb(p)-'prosrc';
 IF md5(original)<>'aab67c9a70880f160de550e4361a6142' THEN
  IF length(original)-length(replace(original,guard,''))<>length(guard)
   OR length(original)-length(replace(original,noop_guard,''))<>length(noop_guard)
   OR md5(replace(replace(original,guard,''),noop_guard,''))<>'aab67c9a70880f160de550e4361a6142' THEN
   RAISE EXCEPTION 'EXP08 permission original source drift';
  END IF;
 ELSE
  IF length(original)-length(replace(original,anchor,''))<>length(anchor) THEN
   RAISE EXCEPTION 'EXP08 permission original anchor drift';
  END IF;
  IF length(original)-length(replace(original,noop_anchor,''))<>length(noop_anchor) THEN RAISE EXCEPTION 'EXP08 permission original effect anchor drift';END IF;
  changed:=replace(replace(original,anchor,guard||anchor),noop_anchor,noop_guard||noop_anchor);
  IF replace(replace(changed,guard,''),noop_guard,'') IS DISTINCT FROM original THEN RAISE EXCEPTION 'EXP08 permission source conservation failed';END IF;
  definition:=pg_get_functiondef(target);
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'EXP08 permission definition drift';END IF;
  EXECUTE replace(definition,original,changed);
  IF (SELECT to_jsonb(q)-'prosrc' FROM pg_proc q WHERE q.oid=target) IS DISTINCT FROM metadata THEN
   RAISE EXCEPTION 'EXP08 permission metadata changed';
  END IF;
 END IF;
 IF to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'EXP08 scoped permission unexpected intermediate overload';
 END IF;
 scoped_target:=to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 SELECT * INTO scoped FROM pg_proc WHERE oid=scoped_target;
 IF FOUND THEN
  IF scoped.prosrc IS DISTINCT FROM scope_body OR scoped.proowner<>'postgres'::regrole OR NOT scoped.prosecdef
   OR scoped.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR scoped.provolatile<>'v'
   OR scoped.prokind<>'f' OR scoped.proisstrict OR scoped.proleakproof OR scoped.proparallel<>'u'
   OR scoped.proretset OR scoped.prorettype<>'jsonb'::regtype OR scoped.pronargdefaults<>0
   OR scoped.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_get_function_arguments(scoped.oid) IS DISTINCT FROM '_member_user_id uuid, _new_permission text, _expected_tenant_id uuid, _expected_membership_id uuid'
   OR ARRAY(SELECT a::text FROM unnest(scoped.proacl) a ORDER BY 1) IS DISTINCT FROM
    ARRAY(SELECT a::text FROM unnest('{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]) a ORDER BY 1) THEN
   RAISE EXCEPTION 'EXP08 scoped permission original door drift';
  END IF;
 ELSE
  EXECUTE format($create$CREATE FUNCTION public.set_solo_team_member_permission(_member_user_id uuid,_new_permission text,_expected_tenant_id uuid,_expected_membership_id uuid)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create$,scope_body);
  REVOKE ALL ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) TO authenticated;
 END IF;
END
$permission_patch$;
