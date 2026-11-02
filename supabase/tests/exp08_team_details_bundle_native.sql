-- GENERATED from original Team details bundle/template; no execution attestation.
-- Original Team details atomic catalog composition. Schema-only, rollback-only;
-- no customer identity, effect execution, provider, role grant or account creation.
BEGIN;
SELECT plan(16);
CREATE TEMP TABLE exp08_details_original_catalog AS
SELECT p.oid,(to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0)) AS metadata FROM pg_catalog.pg_proc p
WHERE p.oid IN (to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)'),to_regprocedure('public.set_solo_team_member_permission(uuid,text)'),to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)'),to_regprocedure('public.get_paige_team_context()'));
SELECT is((SELECT count(*)::integer FROM exp08_details_original_catalog),4,'all ORIGINAL Team details write/read doors are present');
SELECT lives_ok($install$
-- Canonical original atomic bundle SHA256 0709a1aac2f0cfc91a2b4c34d467003da762b4c8b8fc292c0a29235cba3ddbb8
-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$-- INERT EXP08 original I2 owner work-profile authority candidate.
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
  -- A lost reply may be retried. Reconcile the already-locked permitted state before
  -- the original effect: identical normalized fields produce no second update/audit.
  -- Identity, current scope, live seat and owner authority were proved above.
  IF _row.id IS NOT NULL
    AND _row.job_title IS NOT DISTINCT FROM NULLIF(trim(_job_title),'')
    AND _row.responsibilities IS NOT DISTINCT FROM NULLIF(trim(_responsibilities),'') THEN
    RETURN jsonb_build_object('membership_id',_row.id,'job_title',_row.job_title,
      'responsibilities',_row.responsibilities);
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
$exp08_details_profile$;
 EXECUTE $exp08_details_permission$-- INERT original Team permission effect-time repair; no managed version or activation.
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
$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;$exp08_details_projection$;
END $exp08_details_bundle$;

$install$,'the single original atomic composition installs or validates a complete existing package');
SELECT ok(to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)') IS NOT NULL AND to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)') IS NOT NULL,'both original scoped overloads exist together');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_details_original_catalog o JOIN pg_catalog.pg_proc p ON p.oid=o.oid WHERE o.metadata IS DISTINCT FROM ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0)))),'both original ABIs/nonbody metadata remain exact');
SELECT ok(NOT EXISTS(SELECT 1 FROM (VALUES ('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'),('public.set_solo_team_member_permission(uuid,text,uuid,uuid)')) f(signature) WHERE NOT has_function_privilege('authenticated',signature,'EXECUTE') OR has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('service_role',signature,'EXECUTE')),'both scoped overloads remain authenticated-only');
CREATE TEMP TABLE exp08_details_installed_catalog AS
SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS snapshot FROM pg_catalog.pg_proc p
WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission','get_solo_team_workspace','get_paige_team_context');
SELECT lives_ok($replay$
-- Canonical original atomic bundle SHA256 0709a1aac2f0cfc91a2b4c34d467003da762b4c8b8fc292c0a29235cba3ddbb8
-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$-- INERT EXP08 original I2 owner work-profile authority candidate.
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
  -- A lost reply may be retried. Reconcile the already-locked permitted state before
  -- the original effect: identical normalized fields produce no second update/audit.
  -- Identity, current scope, live seat and owner authority were proved above.
  IF _row.id IS NOT NULL
    AND _row.job_title IS NOT DISTINCT FROM NULLIF(trim(_job_title),'')
    AND _row.responsibilities IS NOT DISTINCT FROM NULLIF(trim(_responsibilities),'') THEN
    RETURN jsonb_build_object('membership_id',_row.id,'job_title',_row.job_title,
      'responsibilities',_row.responsibilities);
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
$exp08_details_profile$;
 EXECUTE $exp08_details_permission$-- INERT original Team permission effect-time repair; no managed version or activation.
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
$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;$exp08_details_projection$;
END $exp08_details_bundle$;

$replay$,'the whole original atomic composition replays');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission','get_solo_team_workspace','get_paige_team_context')),(SELECT snapshot FROM exp08_details_installed_catalog),'whole package replay is exact in the actual function catalog');
ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) STRICT;
CREATE TEMP TABLE exp08_details_drift_catalog AS
SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS snapshot FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission','get_solo_team_workspace','get_paige_team_context');
SELECT throws_ok($metadata_drift$
-- Canonical original atomic bundle SHA256 0709a1aac2f0cfc91a2b4c34d467003da762b4c8b8fc292c0a29235cba3ddbb8
-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$-- INERT EXP08 original I2 owner work-profile authority candidate.
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
  -- A lost reply may be retried. Reconcile the already-locked permitted state before
  -- the original effect: identical normalized fields produce no second update/audit.
  -- Identity, current scope, live seat and owner authority were proved above.
  IF _row.id IS NOT NULL
    AND _row.job_title IS NOT DISTINCT FROM NULLIF(trim(_job_title),'')
    AND _row.responsibilities IS NOT DISTINCT FROM NULLIF(trim(_responsibilities),'') THEN
    RETURN jsonb_build_object('membership_id',_row.id,'job_title',_row.job_title,
      'responsibilities',_row.responsibilities);
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
$exp08_details_profile$;
 EXECUTE $exp08_details_permission$-- INERT original Team permission effect-time repair; no managed version or activation.
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
$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;$exp08_details_projection$;
END $exp08_details_bundle$;

$metadata_drift$,'P0001','EXP08 permission original metadata drift','a late original permission metadata refusal aborts the whole package');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission','get_solo_team_workspace','get_paige_team_context')),(SELECT snapshot FROM exp08_details_drift_catalog),'late refusal preserves every original catalog object');
ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) CALLED ON NULL INPUT;
GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) TO anon;
SELECT throws_ok($acl_drift$
-- Canonical original atomic bundle SHA256 0709a1aac2f0cfc91a2b4c34d467003da762b4c8b8fc292c0a29235cba3ddbb8
-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$-- INERT EXP08 original I2 owner work-profile authority candidate.
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
  -- A lost reply may be retried. Reconcile the already-locked permitted state before
  -- the original effect: identical normalized fields produce no second update/audit.
  -- Identity, current scope, live seat and owner authority were proved above.
  IF _row.id IS NOT NULL
    AND _row.job_title IS NOT DISTINCT FROM NULLIF(trim(_job_title),'')
    AND _row.responsibilities IS NOT DISTINCT FROM NULLIF(trim(_responsibilities),'') THEN
    RETURN jsonb_build_object('membership_id',_row.id,'job_title',_row.job_title,
      'responsibilities',_row.responsibilities);
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
$exp08_details_profile$;
 EXECUTE $exp08_details_permission$-- INERT original Team permission effect-time repair; no managed version or activation.
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
$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;$exp08_details_projection$;
END $exp08_details_bundle$;

$acl_drift$,'P0001','EXP08 scoped permission original door drift','an unexpected scoped ACL is refused rather than normalized');
SELECT ok(has_function_privilege('anon','public.set_solo_team_member_permission(uuid,text,uuid,uuid)','EXECUTE'),'refused replay does not silently erase the pre-existing drift');
REVOKE EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) FROM anon;
ALTER FUNCTION public.get_paige_team_context() STABLE;
CREATE TEMP TABLE exp08_details_reader_drift AS
SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS snapshot FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission','get_solo_team_workspace','get_paige_team_context');
SELECT throws_ok($reader_drift$
-- Canonical original atomic bundle SHA256 0709a1aac2f0cfc91a2b4c34d467003da762b4c8b8fc292c0a29235cba3ddbb8
-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$-- INERT EXP08 original I2 owner work-profile authority candidate.
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
  -- A lost reply may be retried. Reconcile the already-locked permitted state before
  -- the original effect: identical normalized fields produce no second update/audit.
  -- Identity, current scope, live seat and owner authority were proved above.
  IF _row.id IS NOT NULL
    AND _row.job_title IS NOT DISTINCT FROM NULLIF(trim(_job_title),'')
    AND _row.responsibilities IS NOT DISTINCT FROM NULLIF(trim(_responsibilities),'') THEN
    RETURN jsonb_build_object('membership_id',_row.id,'job_title',_row.job_title,
      'responsibilities',_row.responsibilities);
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
$exp08_details_profile$;
 EXECUTE $exp08_details_permission$-- INERT original Team permission effect-time repair; no managed version or activation.
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
$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;$exp08_details_projection$;
END $exp08_details_bundle$;

$reader_drift$,'P0001','EXP08 owner read original reader metadata drift: public.get_paige_team_context()','a third-component reader metadata refusal aborts the entire package');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission','get_solo_team_workspace','get_paige_team_context')),(SELECT snapshot FROM exp08_details_reader_drift),'reader refusal preserves the complete actual write/read catalog');
ALTER FUNCTION public.get_paige_team_context() VOLATILE;
DROP FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid);
SELECT throws_ok($partial$
-- Canonical original atomic bundle SHA256 0709a1aac2f0cfc91a2b4c34d467003da762b4c8b8fc292c0a29235cba3ddbb8
-- INERT original Team details bundle; no versioned carrier, apply or activation.
-- Original write components and projection DO remain byte-exact inside ONE atomic statement.
DO $exp08_details_bundle$
DECLARE
 profile_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)');
 permission_base regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text)');
 profile_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)');
 permission_scoped regprocedure:=pg_catalog.to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)');
 workspace_reader regprocedure:=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 context_reader regprocedure:=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 profile_original boolean; permission_original boolean; workspace_original boolean; context_original boolean;
BEGIN
 IF profile_base IS NULL OR permission_base IS NULL OR workspace_reader IS NULL OR context_reader IS NULL THEN RAISE EXCEPTION 'EXP08 Team details missing original door'; END IF;
 SELECT pg_catalog.md5(prosrc)='1d99e171c55d259c18961068a7829fea' INTO profile_original FROM pg_catalog.pg_proc WHERE oid=profile_base;
 SELECT pg_catalog.md5(prosrc)='aab67c9a70880f160de550e4361a6142' INTO permission_original FROM pg_catalog.pg_proc WHERE oid=permission_base;
 SELECT pg_catalog.md5(prosrc)='ded4ae3cb9d57f2c1ed0cef52493590b' INTO workspace_original FROM pg_catalog.pg_proc WHERE oid=workspace_reader;
 SELECT pg_catalog.md5(prosrc)='623d712d745867ed8f7d29374e3a6078' INTO context_original FROM pg_catalog.pg_proc WHERE oid=context_reader;
 IF (profile_scoped IS NULL) IS DISTINCT FROM (permission_scoped IS NULL)
  OR (profile_scoped IS NULL AND (NOT profile_original OR NOT permission_original OR NOT workspace_original OR NOT context_original))
  OR (profile_scoped IS NOT NULL AND (profile_original OR permission_original OR workspace_original OR context_original)) THEN
  RAISE EXCEPTION 'EXP08 Team details partial installation';
 END IF;
 -- Original component guards verify complete bodies, ABIs, owner/config/ACL and overloads.
 -- A later guard failure rolls back every prior component change in this statement.
 EXECUTE $exp08_details_profile$-- INERT EXP08 original I2 owner work-profile authority candidate.
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
  -- A lost reply may be retried. Reconcile the already-locked permitted state before
  -- the original effect: identical normalized fields produce no second update/audit.
  -- Identity, current scope, live seat and owner authority were proved above.
  IF _row.id IS NOT NULL
    AND _row.job_title IS NOT DISTINCT FROM NULLIF(trim(_job_title),'')
    AND _row.responsibilities IS NOT DISTINCT FROM NULLIF(trim(_responsibilities),'') THEN
    RETURN jsonb_build_object('membership_id',_row.id,'job_title',_row.job_title,
      'responsibilities',_row.responsibilities);
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
$exp08_details_profile$;
 EXECUTE $exp08_details_permission$-- INERT original Team permission effect-time repair; no managed version or activation.
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
$exp08_details_permission$;
 PERFORM pg_catalog.set_config('lock_timeout','2s',true);
 EXECUTE $exp08_details_projection$DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;$exp08_details_projection$;
END $exp08_details_bundle$;

$partial$,'P0001','EXP08 Team details partial installation','partial original scoped installation is refused');
SELECT is((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid='public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'::regprocedure),(SELECT entry->>'prosrc' FROM exp08_details_installed_catalog, jsonb_array_elements(snapshot) entry WHERE entry->>'oid'=('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'::regprocedure::oid)::text),'partial refusal preserves the surviving scoped profile body');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_details_original_catalog o JOIN pg_catalog.pg_proc p ON p.oid=o.oid WHERE o.metadata IS DISTINCT FROM ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0)))),'all original metadata is retained after refusal controls');
SELECT * FROM finish();
ROLLBACK;
