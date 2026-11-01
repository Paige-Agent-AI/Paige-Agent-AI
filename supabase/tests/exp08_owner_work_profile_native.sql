-- GENERATED: edit original template/patch then run exp08-owner-work-profile-native-proof.mjs --write.
-- Original owner work-profile actual-schema integration. ONE rollback; synthetic rows only.
-- Does not prove Auth SDK, customer cohorts or provider availability.
BEGIN;
SELECT plan(28);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('e8d00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-profile-holder@tests.invalid',now()),
 ('e8d00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-profile-admin@tests.invalid',now()),
 ('e8d00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-profile-owner@tests.invalid',now()),
 ('e8d00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-profile-member@tests.invalid',now());
INSERT INTO public.tenants(id,slug,name,account_type,owner_user_id) VALUES
 ('e8d00000-0000-4000-8000-000000000010','test-e8-profile-a','Work profile native A','standalone','e8d00000-0000-4000-8000-000000000001'),
 ('e8d00000-0000-4000-8000-000000000011','test-e8-profile-b','Work profile native B','standalone','e8d00000-0000-4000-8000-000000000003');
INSERT INTO public.tenant_members(id,tenant_id,user_id,role,status,is_owner) VALUES
 ('e8d00000-0000-4000-8000-000000000101','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000001','owner','active',true),
 ('e8d00000-0000-4000-8000-000000000102','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000002','admin','active',false),
 ('e8d00000-0000-4000-8000-000000000103','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000003','owner','active',true),
 ('e8d00000-0000-4000-8000-000000000104','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000004','member','active',false),
 ('e8d00000-0000-4000-8000-000000000112','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000002','admin','active',false),
 ('e8d00000-0000-4000-8000-000000000113','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000003','owner','active',true),
 ('e8d00000-0000-4000-8000-000000000114','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000004','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id)
 SELECT id,'e8d00000-0000-4000-8000-000000000010'::uuid FROM auth.users
 WHERE id IN('e8d00000-0000-4000-8000-000000000001','e8d00000-0000-4000-8000-000000000002','e8d00000-0000-4000-8000-000000000003','e8d00000-0000-4000-8000-000000000004')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
CREATE TEMP TABLE exp08_profile_metadata AS SELECT oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
 WHERE oid='public.set_solo_team_member_work_profile(uuid,text,text)'::regprocedure;
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.set_solo_team_member_work_profile(uuid,text,text)'::regprocedure),
 '1d99e171c55d259c18961068a7829fea','actual original writer source matches guarded prerequisite');
-- CANONICAL original scoped profile SHA256 f5ca4cd8ba6d25f8c6f9873cb9174ad08923540cdb40b717a41251b2cfa0af6f
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

SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_profile_metadata m JOIN pg_proc p ON p.oid=m.oid WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM m.metadata),
 'original writer OID and complete nonbody metadata conserved');
SELECT ok(has_function_privilege('authenticated','public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)','EXECUTE'),
 'scoped original door is authenticated-only');
SELECT set_config('request.jwt.claim.sub','e8d00000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"e8d00000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000003','No','No')$$,
 '42501','TEAM_OWNER_PROFILE_FORBIDDEN: only the account holder or this owner may edit these work details','Admin cannot edit another owner through original ABI');
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000003','No','No','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000103')$$,
 '42501','TEAM_OWNER_PROFILE_FORBIDDEN: only the account holder or this owner may edit these work details','scoped door does not bypass original owner restriction');
SELECT is(public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','  Member lead  ','   '),
 '{"membership_id":"e8d00000-0000-4000-8000-000000000104","job_title":"Member lead","responsibilities":null}'::jsonb,
 'original Admin-to-Member ABI retains exact trimmed receipt');
SELECT is(public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','  Scoped lead  ','  Delivery  ','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000104'),
 '{"membership_id":"e8d00000-0000-4000-8000-000000000104","job_title":"Scoped lead","responsibilities":"Delivery"}'::jsonb,
 'scoped door returns only the original committed receipt');
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No',NULL,'e8d00000-0000-4000-8000-000000000104')$$,
 '42501','your active workspace changed before this could run; nothing was changed','missing captured workspace refuses');
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No','e8d00000-0000-4000-8000-000000000010',NULL)$$,
 '42501','this team membership changed before this could run; nothing was changed','missing captured membership refuses');
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000114')$$,
 '42501','this team membership changed before this could run; nothing was changed','foreign seat cannot select another target');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='work_profile_updated' AND entity_id='e8d00000-0000-4000-8000-000000000104'),2::bigint,
 'two actual permitted original calls produce exactly two original audits');
SELECT ok((SELECT role='member' AND NOT is_owner AND status='active' FROM public.tenant_members WHERE id='e8d00000-0000-4000-8000-000000000104'),
 'work details never grant a role or change status');
UPDATE public.profiles SET active_tenant_id='e8d00000-0000-4000-8000-000000000011' WHERE user_id='e8d00000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000104')$$,
 '42501','your active workspace changed before this could run; nothing was changed','same actor and target in two workspaces cannot redirect a captured save');
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000104')$$,
 '42501','this team membership changed before this could run; nothing was changed','matching current tenant cannot authorize an old captured seat');
RESET ROLE;
SELECT ok((SELECT job_title='Scoped lead' AND responsibilities='Delivery' FROM public.tenant_members WHERE id='e8d00000-0000-4000-8000-000000000104')
 AND (SELECT job_title IS NULL AND responsibilities IS NULL FROM public.tenant_members WHERE id='e8d00000-0000-4000-8000-000000000114'),
 'refused scope calls change neither workspace');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='work_profile_updated' AND entity_id IN('e8d00000-0000-4000-8000-000000000104','e8d00000-0000-4000-8000-000000000114')),2::bigint,
 'refused scope calls add no original audit');
-- Real native row removal and reentry under the same user cannot revive the captured seat.
DELETE FROM public.tenant_members WHERE id='e8d00000-0000-4000-8000-000000000114';
INSERT INTO public.tenant_members(id,tenant_id,user_id,role,status,is_owner) VALUES
 ('e8d00000-0000-4000-8000-000000000124','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000004','member','active',false);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000114')$$,
 '42501','this team membership changed before this could run; nothing was changed','actual native removal and reentry invalidates old captured membership');
RESET ROLE;
SELECT ok((SELECT job_title IS NULL AND responsibilities IS NULL FROM public.tenant_members WHERE id='e8d00000-0000-4000-8000-000000000124')
 AND NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='work_profile_updated' AND entity_id='e8d00000-0000-4000-8000-000000000124'),
 'refused stale membership leaves reentered seat and original audit untouched');
SELECT set_config('request.jwt.claim.sub','e8d00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8d00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000003','Owner lead','Coordinate','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000103')$$,
 'actual account holder may edit another owner');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8d00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8d00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000003','Self lead','Coordinate','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000103')$$,
 'actual owner may edit own original work details');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='e8d00000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claim.sub','e8d00000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"e8d00000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000004','No','No','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000124')$$,
 '42501','TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was changed','banned actor cannot write despite original active Admin seat');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile(NULL,NULL,NULL,NULL,NULL)$$,
 '42501','permission denied for function set_solo_team_member_work_profile','anonymous cannot invoke scoped writer');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.set_solo_team_member_work_profile(NULL,NULL,NULL,NULL,NULL)$$,
 '42501','permission denied for function set_solo_team_member_work_profile','service cannot impersonate scoped caller');
RESET ROLE;
CREATE TEMP TABLE exp08_profile_before_replay AS SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) AS metadata FROM pg_proc p
 WHERE oid IN('public.set_solo_team_member_work_profile(uuid,text,text)'::regprocedure,'public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'::regprocedure);
-- CANONICAL original scoped profile SHA256 f5ca4cd8ba6d25f8c6f9873cb9174ad08923540cdb40b717a41251b2cfa0af6f
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

SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE oid IN('public.set_solo_team_member_work_profile(uuid,text,text)'::regprocedure,'public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'::regprocedure)),
 (SELECT metadata FROM exp08_profile_before_replay),'replay preserves both complete original/scoped function objects');
SELECT is((SELECT job_title FROM public.tenant_members WHERE id='e8d00000-0000-4000-8000-000000000103'),'Self lead','native readback returns the actual final owner value');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='work_profile_updated' AND entity_id='e8d00000-0000-4000-8000-000000000103'),2::bigint,
 'holder and self calls use original audit path exactly once each');
SELECT set_config('request.jwt.claim.sub','e8d00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8d00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000003',' Self lead ',' Coordinate ','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000103'),
 public.set_solo_team_member_work_profile('e8d00000-0000-4000-8000-000000000003','Self lead','Coordinate'),
 'original and scoped retries reconcile the same normalized native receipt');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='work_profile_updated' AND entity_id='e8d00000-0000-4000-8000-000000000103'),2::bigint,
 'reconciled identical state adds no duplicate native update audit');
SELECT * FROM finish();
ROLLBACK;
