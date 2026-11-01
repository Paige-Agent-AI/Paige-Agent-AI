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
 ('e8d00000-0000-4000-8000-000000000011','test-e8-profile-b','Work profile native B','standalone','e8d00000-0000-4000-8000-000000000001');
INSERT INTO public.tenant_members(id,tenant_id,user_id,role,status,is_owner) VALUES
 ('e8d00000-0000-4000-8000-000000000101','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000001','owner','active',true),
 ('e8d00000-0000-4000-8000-000000000102','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000002','admin','active',false),
 ('e8d00000-0000-4000-8000-000000000103','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000003','owner','active',true),
 ('e8d00000-0000-4000-8000-000000000104','e8d00000-0000-4000-8000-000000000010','e8d00000-0000-4000-8000-000000000004','member','active',false),
 ('e8d00000-0000-4000-8000-000000000112','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000002','admin','active',false),
 ('e8d00000-0000-4000-8000-000000000114','e8d00000-0000-4000-8000-000000000011','e8d00000-0000-4000-8000-000000000004','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id)
 SELECT id,'e8d00000-0000-4000-8000-000000000010'::uuid FROM auth.users
 WHERE id IN('e8d00000-0000-4000-8000-000000000001','e8d00000-0000-4000-8000-000000000002','e8d00000-0000-4000-8000-000000000003','e8d00000-0000-4000-8000-000000000004')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
CREATE TEMP TABLE exp08_profile_metadata AS SELECT oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
 WHERE oid='public.set_solo_team_member_work_profile(uuid,text,text)'::regprocedure;
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.set_solo_team_member_work_profile(uuid,text,text)'::regprocedure),
 '1d99e171c55d259c18961068a7829fea','actual original writer source matches guarded prerequisite');
\ir ../../scripts/proof/exp08-owner-work-profile-patch.sql
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
\ir ../../scripts/proof/exp08-owner-work-profile-patch.sql
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
