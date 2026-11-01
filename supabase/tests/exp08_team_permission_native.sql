-- GENERATED: edit original template/patch then run exp08-team-permission-native-proof.mjs --write.
-- Original Team permission actual-schema integration. ONE rollback; synthetic rows only.
-- Does not prove Auth SDK, customer cohorts or provider availability.
BEGIN;
SELECT plan(32);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('e8e00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-permission-holder@tests.invalid',now()),
 ('e8e00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-permission-admin@tests.invalid',now()),
 ('e8e00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-permission-owner@tests.invalid',now()),
 ('e8e00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-permission-member@tests.invalid',now());
INSERT INTO public.tenants(id,slug,name,account_type,owner_user_id) VALUES
 ('e8e00000-0000-4000-8000-000000000010','test-e8-permission-a','Permission native A','standalone','e8e00000-0000-4000-8000-000000000001'),
 ('e8e00000-0000-4000-8000-000000000011','test-e8-permission-b','Permission native B','standalone','e8e00000-0000-4000-8000-000000000003');
INSERT INTO public.tenant_members(id,tenant_id,user_id,role,status,is_owner) VALUES
 ('e8e00000-0000-4000-8000-000000000101','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000001','owner','active',true),
 ('e8e00000-0000-4000-8000-000000000102','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000002','admin','active',false),
 ('e8e00000-0000-4000-8000-000000000103','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000003','owner','active',true),
 ('e8e00000-0000-4000-8000-000000000104','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000004','member','active',false),
 ('e8e00000-0000-4000-8000-000000000112','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000002','admin','active',false),
 ('e8e00000-0000-4000-8000-000000000113','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000003','owner','active',true),
 ('e8e00000-0000-4000-8000-000000000114','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000004','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id)
 SELECT id,'e8e00000-0000-4000-8000-000000000010'::uuid FROM auth.users
 WHERE id IN('e8e00000-0000-4000-8000-000000000001','e8e00000-0000-4000-8000-000000000002','e8e00000-0000-4000-8000-000000000003','e8e00000-0000-4000-8000-000000000004')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
CREATE TEMP TABLE exp08_permission_metadata AS SELECT oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
 WHERE oid='public.set_solo_team_member_permission(uuid,text)'::regprocedure;
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.set_solo_team_member_permission(uuid,text)'::regprocedure),
 CASE WHEN to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)') IS NULL
 THEN 'aab67c9a70880f160de550e4361a6142' ELSE '6ee3f516ba9bd0531230cd5167de4fe7' END,
 'actual original permission source matches guarded prerequisite or exact released repair');
-- CANONICAL original scoped permission SHA256 d9b3aa28a96602086059fb0a3344c977b1c76c272b086cbf5ae42b702e766572
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

SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_permission_metadata m JOIN pg_proc p ON p.oid=m.oid WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM m.metadata),
 'original permission writer complete nonbody metadata conserved');
SELECT ok(has_function_privilege('authenticated','public.set_solo_team_member_permission(uuid,text,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.set_solo_team_member_permission(uuid,text,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.set_solo_team_member_permission(uuid,text,uuid,uuid)','EXECUTE'),
 'scoped permission door is authenticated-only');
SELECT set_config('request.jwt.claim.sub','e8e00000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"e8e00000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin')$$,
 '42501','only the tenant owner may change permission levels','Admin cannot change permission through original ABI');
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000104')$$,
 '42501','only the tenant owner may change permission levels','scoped ABI preserves owner-only authority');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8e00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8e00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000002','member','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000102')$$,
 '42501','only the tenant owner may change permission levels','ordinary Member cannot change another seat');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8e00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8e00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000003','admin')$$,
 '42501','the owner permission cannot be changed here','original ABI cannot change owner permission');
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000003','admin','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000103')$$,
 '42501','the owner permission cannot be changed here','scoped ABI cannot change owner permission');
SELECT lives_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004',' AdMiN ')$$,
 'original holder-to-Member permission act remains permitted');
RESET ROLE;
SELECT is((SELECT role::text FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000104'),'admin',
 'native readback is the actual original Admin role');
SELECT set_config('request.jwt.claim.sub','e8e00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8e00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','member','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000104'),
 '{"membership_id":"e8e00000-0000-4000-8000-000000000104","permission":"member"}'::jsonb,
 'scoped original writer returns the exact committed current permission receipt');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='permission_changed' AND entity_id='e8e00000-0000-4000-8000-000000000104'),2::bigint,
 'two real permission changes use original audit path once each');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004',' MEMBER ')$$,
 'original ABI same permitted state is reconciled');
SELECT is(public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004',' member ','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000104'),
 '{"membership_id":"e8e00000-0000-4000-8000-000000000104","permission":"member"}'::jsonb,
 'scoped same-state retry returns only actual current state');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='permission_changed' AND entity_id='e8e00000-0000-4000-8000-000000000104'),2::bigint,
 'identical permitted-state retries add no duplicate native audit');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin',NULL,'e8e00000-0000-4000-8000-000000000104')$$,
 '42501','your active workspace changed before this could run; nothing was changed','missing captured workspace refuses');
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000104')$$,
 '42501','your active workspace changed before this could run; nothing was changed','foreign captured workspace refuses');
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000010',NULL)$$,
 '42501','this team membership changed before this could run; nothing was changed','missing captured membership refuses');
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000114')$$,
 '42501','this team membership changed before this could run; nothing was changed','foreign captured membership cannot select a target');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='e8e00000-0000-4000-8000-000000000011' WHERE user_id='e8e00000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000010','e8e00000-0000-4000-8000-000000000104')$$,
 '42501','your active workspace changed before this could run; nothing was changed','same actor and target in two workspaces cannot redirect a captured act');
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000104')$$,
 '42501','this team membership changed before this could run; nothing was changed','current workspace does not authorize old captured membership');
RESET ROLE;
SELECT ok((SELECT role='member' FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000104')
 AND (SELECT role='member' FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000114'),
 'scope refusals change neither workspace');
DELETE FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000114';
INSERT INTO public.tenant_members(id,tenant_id,user_id,role,status,is_owner) VALUES
 ('e8e00000-0000-4000-8000-000000000124','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000004','member','active',false);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000114')$$,
 '42501','this team membership changed before this could run; nothing was changed','actual removal and reentry invalidates captured membership');
RESET ROLE;
SELECT ok((SELECT role='member' FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000124')
 AND NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='permission_changed' AND entity_id='e8e00000-0000-4000-8000-000000000124'),
 'reentered seat and original audit untouched by refusal');
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='e8e00000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000124')$$,
 '42501','TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed','banned actor cannot write despite original owner seat');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id='e8e00000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission('e8e00000-0000-4000-8000-000000000004','admin','e8e00000-0000-4000-8000-000000000011','e8e00000-0000-4000-8000-000000000124')$$,
 '42501','TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed','deleted identity cannot write despite residual owner seat');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission(NULL,NULL,NULL,NULL)$$,
 '42501','permission denied for function set_solo_team_member_permission','anonymous cannot invoke scoped permission writer');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.set_solo_team_member_permission(NULL,NULL,NULL,NULL)$$,
 '42501','permission denied for function set_solo_team_member_permission','service cannot impersonate scoped permission caller');
RESET ROLE;
SELECT ok((SELECT bool_and(is_owner AND role='owner') FROM public.tenant_members WHERE id IN('e8e00000-0000-4000-8000-000000000101','e8e00000-0000-4000-8000-000000000103','e8e00000-0000-4000-8000-000000000113')),
 'permission calls never change original owner flags or roles');
CREATE TEMP TABLE exp08_permission_before_replay AS SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS metadata FROM pg_proc p
 WHERE p.oid IN('public.set_solo_team_member_permission(uuid,text)'::regprocedure,'public.set_solo_team_member_permission(uuid,text,uuid,uuid)'::regprocedure);
-- CANONICAL original scoped permission SHA256 d9b3aa28a96602086059fb0a3344c977b1c76c272b086cbf5ae42b702e766572
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

SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN('public.set_solo_team_member_permission(uuid,text)'::regprocedure,'public.set_solo_team_member_permission(uuid,text,uuid,uuid)'::regprocedure)),
 (SELECT metadata FROM exp08_permission_before_replay),'replay preserves complete original and scoped permission objects');
SELECT is((SELECT role::text FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000104'),'member',
 'final native readback remains actual stored Member');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='permission_changed' AND entity_id='e8e00000-0000-4000-8000-000000000104'),2::bigint,
 'all refused or reconciled calls preserve the original two actual audit records');
SELECT * FROM finish();
ROLLBACK;
