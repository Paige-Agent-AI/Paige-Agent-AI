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
 THEN 'aab67c9a70880f160de550e4361a6142' ELSE '22955528946ff6e78d915bffd1ebd43a' END,
 'actual original permission source matches guarded prerequisite or exact current candidate');
\ir ../../scripts/proof/exp08-team-permission-patch.sql
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
\ir ../../scripts/proof/exp08-team-permission-patch.sql
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN('public.set_solo_team_member_permission(uuid,text)'::regprocedure,'public.set_solo_team_member_permission(uuid,text,uuid,uuid)'::regprocedure)),
 (SELECT metadata FROM exp08_permission_before_replay),'replay preserves complete original and scoped permission objects');
SELECT is((SELECT role::text FROM public.tenant_members WHERE id='e8e00000-0000-4000-8000-000000000104'),'member',
 'final native readback remains actual stored Member');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='permission_changed' AND entity_id='e8e00000-0000-4000-8000-000000000104'),2::bigint,
 'all refused or reconciled calls preserve the original two actual audit records');
SELECT * FROM finish();
ROLLBACK;
