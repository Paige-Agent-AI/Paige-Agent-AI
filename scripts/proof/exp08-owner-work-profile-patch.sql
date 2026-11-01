-- INERT EXP08 original I2 owner work-profile authority candidate.
-- No managed version, independent effect writer, approval or activation. Scoped execution stays authenticated-only.
DO $profile_patch$
DECLARE target regprocedure:=to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 p pg_proc; original text; changed text; definition text; metadata jsonb;
 scoped pg_proc; scoped_target regprocedure;
 scope_body constant text:=$scope_body$
DECLARE
 _actor uuid:=auth.uid();
 _tenant uuid:=public.current_user_tenant_id();
BEGIN
 IF _actor IS NULL OR _tenant IS NULL THEN
  RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE='42501';
 END IF;
 -- Refusal only: this argument never selects the workspace the writer acts on.
 IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
  RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed' USING ERRCODE='42501';
 END IF;
 IF NOT public.is_tenant_admin(_tenant) THEN
  RAISE EXCEPTION 'only an owner or admin may update work details' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM auth.users u WHERE u.id=_actor FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor AND
   (u.deleted_at IS NOT NULL OR (u.banned_until IS NOT NULL AND u.banned_until>clock_timestamp()))) THEN
  RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed' USING ERRCODE='42501';
 END IF;
 -- Same lock order as original Team departure/profile/revoke: Auth, sorted seats, profile, tenant.
 PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant
  AND m.user_id IN (_actor,_member_user_id) ORDER BY m.user_id FOR UPDATE;
 PERFORM 1 FROM public.profiles p WHERE p.user_id=_actor FOR SHARE;
 PERFORM 1 FROM public.tenants t WHERE t.id=_tenant FOR SHARE;
 IF public.current_user_tenant_id() IS DISTINCT FROM _tenant OR _expected_tenant_id IS DISTINCT FROM _tenant THEN
  RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed' USING ERRCODE='42501';
 END IF;
 IF NOT public.is_tenant_admin(_tenant) THEN
  RAISE EXCEPTION 'only an owner or admin may update work details' USING ERRCODE='42501';
 END IF;
 -- Captured membership is refusal-only too: identify the target by actual tenant/user first.
 IF _expected_membership_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.tenant_members m
   WHERE m.tenant_id=_tenant AND m.user_id=_member_user_id AND m.id=_expected_membership_id) THEN
  RAISE EXCEPTION 'this team membership changed before this could run; nothing was changed' USING ERRCODE='42501';
 END IF;
 -- One original writer, audit and receipt. This overload performs no independent effects.
 RETURN public.set_solo_team_member_work_profile(_member_user_id,_job_title,_responsibilities);
END;
$scope_body$;

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
 ELSE
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
 END IF;
 IF pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'EXP08 scoped work profile unexpected intermediate overload';
 END IF;
 scoped_target:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 SELECT * INTO scoped FROM pg_catalog.pg_proc WHERE oid=scoped_target;
 IF FOUND THEN
  IF scoped.prosrc IS DISTINCT FROM scope_body OR scoped.proowner<>'postgres'::regrole OR NOT scoped.prosecdef
   OR scoped.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR scoped.provolatile<>'v' OR scoped.prokind<>'f' OR scoped.proisstrict OR scoped.proleakproof
   OR scoped.proparallel<>'u' OR scoped.proretset OR scoped.prorettype<>'jsonb'::regtype
   OR scoped.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR scoped.pronargdefaults<>0
   OR pg_catalog.pg_get_function_arguments(scoped.oid) IS DISTINCT FROM '_member_user_id uuid, _job_title text, _responsibilities text, _expected_tenant_id uuid, _expected_membership_id uuid'
   OR ARRAY(SELECT a::text FROM pg_catalog.unnest(scoped.proacl) a ORDER BY 1) IS DISTINCT FROM
      ARRAY(SELECT a::text FROM pg_catalog.unnest('{postgres=X/postgres,authenticated=X/postgres}'::pg_catalog.aclitem[]) a ORDER BY 1) THEN
   RAISE EXCEPTION 'EXP08 scoped work profile original door drift';
  END IF;
 ELSE
  EXECUTE pg_catalog.format($create_scoped$CREATE FUNCTION public.set_solo_team_member_work_profile(_member_user_id uuid,_job_title text,_responsibilities text,_expected_tenant_id uuid,_expected_membership_id uuid)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create_scoped$,scope_body);
  REVOKE ALL ON FUNCTION public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid) TO authenticated;
 END IF;
END
$profile_patch$;
