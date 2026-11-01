-- INERT EXP08 original I2 owner work-profile authority candidate.
-- No managed version, new writer, permission grant, approval or activation.
DO $profile_patch$
DECLARE target regprocedure:=to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 p pg_proc; original text; changed text; definition text; metadata jsonb;
 anchor constant text:=$anchor$  UPDATE public.tenant_members tm
  SET job_title = NULLIF(trim(_job_title), ''),$anchor$;
 guard constant text:=$guard$  -- exp08_owner_work_profile_v1: preserve identity, scope and sorted seats before an owner edit.
  PERFORM 1 FROM auth.users u WHERE u.id=_actor FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) THEN
    RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed'
      USING ERRCODE='42501';
  END IF;
  -- Match the original departure/revoke membership-before-profile/tenant lock order.
  PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant
    AND m.user_id IN (_actor,_member_user_id) ORDER BY m.user_id FOR UPDATE;
  PERFORM 1 FROM public.profiles p WHERE p.user_id=_actor FOR SHARE;
  PERFORM 1 FROM public.tenants t WHERE t.id=_tenant FOR SHARE;
  IF public.current_user_tenant_id() IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may update work details' USING ERRCODE='42501';
  END IF;
  SELECT m.* INTO _row FROM public.tenant_members m WHERE m.tenant_id=_tenant
    AND m.user_id=_member_user_id AND m.status IN ('active','suspended');
  IF (_row.is_owner OR _row.role='owner'::public.tenant_role) AND _member_user_id<>_actor
    AND NOT public.is_tenant_account_holder(_actor,_tenant) THEN
    RAISE EXCEPTION 'TEAM_OWNER_PROFILE_FORBIDDEN: only the account holder or this owner may edit these work details'
      USING ERRCODE='42501';
  END IF;

$guard$;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=target;
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>'jsonb'::regtype
  OR pg_get_function_arguments(target) IS DISTINCT FROM '_member_user_id uuid, _job_title text, _responsibilities text' THEN
  RAISE EXCEPTION 'EXP08 owner work profile original metadata drift';
 END IF;
 original:=p.prosrc; metadata:=to_jsonb(p)-'prosrc';
 IF md5(original)<>'1d99e171c55d259c18961068a7829fea' THEN
  IF length(original)-length(replace(original,guard,''))<>length(guard)
   OR md5(replace(original,guard,''))<>'1d99e171c55d259c18961068a7829fea' THEN
   RAISE EXCEPTION 'EXP08 owner work profile original source drift';
  END IF;
  RETURN;
 END IF;
 IF length(original)-length(replace(original,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'EXP08 owner work profile original anchor drift';
 END IF;
 changed:=replace(original,anchor,guard||anchor);
 IF replace(changed,guard,'') IS DISTINCT FROM original THEN RAISE EXCEPTION 'EXP08 owner work profile conservation failed'; END IF;
 definition:=pg_get_functiondef(target);
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'EXP08 owner work profile definition drift'; END IF;
 EXECUTE replace(definition,original,changed);
 IF (SELECT to_jsonb(q)-'prosrc' FROM pg_proc q WHERE q.oid=target) IS DISTINCT FROM metadata THEN
  RAISE EXCEPTION 'EXP08 owner work profile metadata changed';
 END IF;
END
$profile_patch$;
