-- INERT original Team permission effect-time repair; no managed version or activation.
DO $permission_patch$
DECLARE target regprocedure:=to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 p pg_proc; original text; changed text; definition text; metadata jsonb;
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
   OR md5(replace(original,guard,''))<>'aab67c9a70880f160de550e4361a6142' THEN
   RAISE EXCEPTION 'EXP08 permission original source drift';
  END IF;
 ELSE
  IF length(original)-length(replace(original,anchor,''))<>length(anchor) THEN
   RAISE EXCEPTION 'EXP08 permission original anchor drift';
  END IF;
  changed:=replace(original,anchor,guard||anchor);
  IF replace(changed,guard,'') IS DISTINCT FROM original THEN RAISE EXCEPTION 'EXP08 permission source conservation failed';END IF;
  definition:=pg_get_functiondef(target);
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'EXP08 permission definition drift';END IF;
  EXECUTE replace(definition,original,changed);
  IF (SELECT to_jsonb(q)-'prosrc' FROM pg_proc q WHERE q.oid=target) IS DISTINCT FROM metadata THEN
   RAISE EXCEPTION 'EXP08 permission metadata changed';
  END IF;
 END IF;
END
$permission_patch$;
