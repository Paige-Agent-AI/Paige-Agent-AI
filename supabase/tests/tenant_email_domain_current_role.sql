-- Disposable schema/local CI only. Synthetic fixtures roll back; never a production drive.
-- Set -v domain_role_apply=false only for the retained predecessor reproduction.
\if :{?domain_role_apply}
\else
\set domain_role_apply true
\endif
CREATE TEMP TABLE _domain_role_before AS
SELECT c.oid, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname<>'Tenant admins manage own domains') AS other_policies,
 (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
 (SELECT jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl::text,p.proowner,p.proconfig) ORDER BY p.oid)
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
   ('is_tenant_admin_as','is_current_user_tenant_admin','current_user_tenant_id','is_company_workspace','is_platform_owner',
    'guard_tenant_email_domain_verified','guard_tenant_email_domain_sendgrid_facts','normalize_tenant_email_domain')) AS helpers
FROM pg_class c WHERE c.oid='public.tenant_email_domains'::regclass;
\if :domain_role_apply
\ir ../migrations/20271110014000_comms_domain_current_workspace_role.sql
\ir ../migrations/20271110014000_comms_domain_current_workspace_role.sql
\endif

BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE _domain_role_result(ok boolean,label text);
CREATE FUNCTION pg_temp.ok(_ok boolean,_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO _domain_role_result VALUES(coalesce(_ok,false),_label);
 IF coalesce(_ok,false) THEN RAISE NOTICE 'PASS: %',_label; ELSE RAISE WARNING 'FAIL: %',_label; END IF;
END $$;
CREATE FUNCTION pg_temp.actor(_uid uuid) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',_uid,'role','authenticated')::text,true);
$$;
-- Invoker rights: called after SET LOCAL ROLE authenticated, so these are actual RLS writes.
CREATE FUNCTION pg_temp.probe(_sql text,_rollback boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE _sql; GET DIAGNOSTICS n=ROW_COUNT;
 -- Negative probes cannot destroy their sentinel on a vulnerable predecessor.
 IF _rollback THEN RAISE EXCEPTION 'rollback negative probe' USING ERRCODE='PT001'; END IF;
 RETURN n::text;
EXCEPTION WHEN SQLSTATE 'PT001' THEN RETURN n::text;
 WHEN OTHERS THEN RETURN SQLSTATE;
END $$;

SELECT pg_temp.ok((SELECT p.polcmd='*' AND p.polroles=ARRAY['authenticated'::regrole]::oid[]
 AND pg_get_expr(p.polqual,p.polrelid) LIKE '%is_current_user_tenant_admin()%'
 AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%is_current_user_tenant_admin()%'
 AND pg_get_expr(p.polqual,p.polrelid) LIKE '%current_user_tenant_id()%'
 AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%current_user_tenant_id()%'
 FROM pg_policy p WHERE p.polrelid='public.tenant_email_domains'::regclass AND p.polname='Tenant admins manage own domains'),
 'both existing admin-policy clauses require the canonical current-workspace wrapper');
SELECT pg_temp.ok((SELECT b.oid=c.oid AND b.acl IS NOT DISTINCT FROM c.relacl::text
 AND b.relrowsecurity=c.relrowsecurity AND b.relforcerowsecurity=c.relforcerowsecurity
 AND b.other_policies IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname<>'Tenant admins manage own domains')
 AND b.triggers IS NOT DISTINCT FROM (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
 AND b.helpers IS NOT DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl::text,p.proowner,p.proconfig) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
   ('is_tenant_admin_as','is_current_user_tenant_admin','current_user_tenant_id','is_company_workspace','is_platform_owner',
    'guard_tenant_email_domain_verified','guard_tenant_email_domain_sendgrid_facts','normalize_tenant_email_domain'))
 FROM _domain_role_before b JOIN pg_class c ON c.oid=b.oid),
 'migration replay preserves table/ACL/RLS, other policies, native helpers and verification triggers');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.is_tenant_admin_as(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.is_tenant_admin_as(uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.is_tenant_admin_as(uuid,uuid)','EXECUTE')
 AND has_function_privilege('authenticated','public.is_current_user_tenant_admin()','EXECUTE'),
 'actor-explicit helper remains service-only; existing authenticated wrapper remains executable');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at,email_confirmed_at)
SELECT u::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'domain-role-'||right(u,4)||'@example.invalid','',now(),now(),now()
FROM unnest(ARRAY['ffffffff-3140-4000-8000-000000000001','ffffffff-3140-4000-8000-000000000002','ffffffff-3140-4000-8000-000000000003','ffffffff-3140-4000-8000-000000000004']) u;
INSERT INTO public.tenants(id,slug,name,account_number_prefix,account_number,account_type,owner_user_id,features) VALUES
 ('aaaaaaaa-3140-4000-8000-000000000001','domain-role-proof-one','Domain Role Proof One','TNA',993141,'standalone','ffffffff-3140-4000-8000-000000000001','{}'),
 ('aaaaaaaa-3140-4000-8000-000000000002','domain-role-proof-two','Domain Role Proof Two','TNB',993142,'standalone','ffffffff-3140-4000-8000-000000000002','{}'),
 ('aaaaaaaa-3140-4000-8000-000000000003','domain-role-proof-company','Domain Role Proof Company','TNC',993143,'standalone',NULL,'{"system_workspace":true}');
INSERT INTO public.tenant_members(tenant_id,user_id,status,role,is_owner) VALUES
 ('aaaaaaaa-3140-4000-8000-000000000001','ffffffff-3140-4000-8000-000000000001','active','owner',true),
 ('aaaaaaaa-3140-4000-8000-000000000002','ffffffff-3140-4000-8000-000000000001','active','member',false),
 ('aaaaaaaa-3140-4000-8000-000000000002','ffffffff-3140-4000-8000-000000000002','active','admin',false)
ON CONFLICT(tenant_id,user_id) DO UPDATE SET status=excluded.status,role=excluded.role,is_owner=excluded.is_owner;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('ffffffff-3140-4000-8000-000000000001','admin'),
 ('ffffffff-3140-4000-8000-000000000002','admin'),
 ('ffffffff-3140-4000-8000-000000000003','platform_admin'),
 ('ffffffff-3140-4000-8000-000000000004','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('ffffffff-3140-4000-8000-000000000001','aaaaaaaa-3140-4000-8000-000000000001'),
 ('ffffffff-3140-4000-8000-000000000002','aaaaaaaa-3140-4000-8000-000000000002'),
 ('ffffffff-3140-4000-8000-000000000003','aaaaaaaa-3140-4000-8000-000000000003'),
 ('ffffffff-3140-4000-8000-000000000004','aaaaaaaa-3140-4000-8000-000000000001')
ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
INSERT INTO public.tenant_email_domains(id,tenant_id,domain,from_name,status) VALUES
 ('eeeeeeee-3140-4000-8000-000000000001','aaaaaaaa-3140-4000-8000-000000000001','one.example.invalid','One','pending'),
 ('eeeeeeee-3140-4000-8000-000000000002','aaaaaaaa-3140-4000-8000-000000000002','two.example.invalid','Two','pending');

SELECT pg_temp.actor('ffffffff-3140-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.wrapper',public.is_current_user_tenant_admin()::text,true);
SELECT set_config('domain_role.direct',pg_temp.probe($q$SELECT public.is_tenant_admin_as(auth.uid(),public.current_user_tenant_id())$q$),true);
SELECT set_config('domain_role.insert',pg_temp.probe($q$INSERT INTO public.tenant_email_domains(id,tenant_id,domain,from_name) VALUES('eeeeeeee-3140-4000-8000-000000000010','aaaaaaaa-3140-4000-8000-000000000001','own.example.invalid','Owner')$q$),true);
SELECT set_config('domain_role.update',pg_temp.probe($q$UPDATE public.tenant_email_domains SET from_name='Owner changed' WHERE id='eeeeeeee-3140-4000-8000-000000000010'$q$),true);
SELECT set_config('domain_role.forge_resend',pg_temp.probe($q$UPDATE public.tenant_email_domains SET status='verified' WHERE id='eeeeeeee-3140-4000-8000-000000000010'$q$),true);
SELECT set_config('domain_role.forge_sendgrid',pg_temp.probe($q$UPDATE public.tenant_email_domains SET sendgrid_status='verified',sendgrid_domain_id='untrusted',sendgrid_verified_at=now() WHERE id='eeeeeeee-3140-4000-8000-000000000010'$q$),true);
SELECT set_config('domain_role.retenant',pg_temp.probe($q$UPDATE public.tenant_email_domains SET tenant_id='aaaaaaaa-3140-4000-8000-000000000002' WHERE id='eeeeeeee-3140-4000-8000-000000000010'$q$),true);
SELECT set_config('domain_role.delete',pg_temp.probe($q$DELETE FROM public.tenant_email_domains WHERE id='eeeeeeee-3140-4000-8000-000000000010'$q$),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.wrapper')='true','authenticated owner uses the existing wrapper successfully');
SELECT pg_temp.ok(current_setting('domain_role.direct')='42501','authenticated direct actor-helper invocation is refused by its unchanged ACL');
SELECT pg_temp.ok(current_setting('domain_role.insert')='1','owner INSERT succeeds under actual authenticated RLS');
SELECT pg_temp.ok(current_setting('domain_role.update')='1','owner UPDATE succeeds under actual authenticated RLS');
SELECT pg_temp.ok(current_setting('domain_role.delete')='1','owner DELETE succeeds under actual authenticated RLS');
SELECT pg_temp.ok(current_setting('domain_role.retenant')='42501','WITH CHECK refuses changing the row to a different workspace');
SELECT pg_temp.ok(current_setting('domain_role.forge_resend')='42501','the existing Resend verification provenance guard still refuses forged verification');
SELECT pg_temp.ok(current_setting('domain_role.forge_sendgrid')='42501','the existing SendGrid fact guard still refuses forged verification');

SELECT pg_temp.actor('ffffffff-3140-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.admin_insert',pg_temp.probe($q$INSERT INTO public.tenant_email_domains(id,tenant_id,domain,from_name) VALUES('eeeeeeee-3140-4000-8000-000000000011','aaaaaaaa-3140-4000-8000-000000000002','admin.example.invalid','Admin')$q$),true);
SELECT set_config('domain_role.admin',pg_temp.probe($q$UPDATE public.tenant_email_domains SET from_name='Admin changed' WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$),true);
SELECT set_config('domain_role.admin_delete',pg_temp.probe($q$DELETE FROM public.tenant_email_domains WHERE id='eeeeeeee-3140-4000-8000-000000000011'$q$),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.admin_insert')='1','active current-workspace admin retains INSERT authority');
SELECT pg_temp.ok(current_setting('domain_role.admin')='1','active current-workspace admin retains UPDATE authority');
SELECT pg_temp.ok(current_setting('domain_role.admin_delete')='1','active current-workspace admin retains DELETE authority');

-- Real mixed-seat cohort: owner in One, member in Two, retaining app_role=admin from One.
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET active_tenant_id='aaaaaaaa-3140-4000-8000-000000000002' WHERE user_id='ffffffff-3140-4000-8000-000000000001';
SELECT pg_temp.actor('ffffffff-3140-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.global',public.has_role(auth.uid(),'admin')::text,true);
SELECT set_config('domain_role.member_read',(SELECT count(*)::text FROM public.tenant_email_domains WHERE id='eeeeeeee-3140-4000-8000-000000000002'),true);
SELECT set_config('domain_role.member_insert',pg_temp.probe($q$INSERT INTO public.tenant_email_domains(tenant_id,domain,from_name) VALUES('aaaaaaaa-3140-4000-8000-000000000002','not-owned.example.invalid','Denied')$q$,true),true);
SELECT set_config('domain_role.member_update',pg_temp.probe($q$UPDATE public.tenant_email_domains SET from_name='Denied' WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$,true),true);
SELECT set_config('domain_role.member_delete',pg_temp.probe($q$DELETE FROM public.tenant_email_domains WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$,true),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.global')='true','mixed-seat actor retains the original global admin role from the other workspace');
SELECT pg_temp.ok(current_setting('domain_role.member_read')='1','separate existing current-workspace member SELECT is preserved');
SELECT pg_temp.ok(current_setting('domain_role.member_insert')='42501','mixed-seat member INSERT is refused despite global app admin');
SELECT pg_temp.ok(current_setting('domain_role.member_update')='0','mixed-seat member UPDATE affects no rows despite global app admin');
SELECT pg_temp.ok(current_setting('domain_role.member_delete')='0','mixed-seat member DELETE affects no rows despite global app admin');

-- Reuse the same real actor for changed-role/status and current-workspace negative cases.
DO $$DECLARE state text; n text; ins text; del text; BEGIN
 FOR state IN SELECT unnest(ARRAY['coach','inactive','revoked']) LOOP
  PERFORM set_config('request.jwt.claims','{}',true);
  UPDATE public.tenant_members SET role=CASE WHEN state='coach' THEN 'coach'::public.tenant_role ELSE 'member'::public.tenant_role END,
    status=CASE WHEN state='coach' THEN 'active' ELSE state END
   WHERE user_id='ffffffff-3140-4000-8000-000000000001' AND tenant_id='aaaaaaaa-3140-4000-8000-000000000002';
  PERFORM pg_temp.actor('ffffffff-3140-4000-8000-000000000001');
  EXECUTE 'SET LOCAL ROLE authenticated';
  ins:=pg_temp.probe($q$INSERT INTO public.tenant_email_domains(tenant_id,domain,from_name) VALUES('aaaaaaaa-3140-4000-8000-000000000002','bad-seat.example.invalid','Denied')$q$,true);
  n:=pg_temp.probe($q$UPDATE public.tenant_email_domains SET from_name='Denied' WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$,true);
  del:=pg_temp.probe($q$DELETE FROM public.tenant_email_domains WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$,true);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(ins='42501','current '||state||' seat cannot INSERT into the target workspace');
  PERFORM pg_temp.ok(n='0','current '||state||' seat cannot mutate the target workspace');
  PERFORM pg_temp.ok(del='0','current '||state||' seat cannot DELETE from the target workspace');
 END LOOP;
END $$;

SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET active_tenant_id='aaaaaaaa-3140-4000-8000-000000000001' WHERE user_id='ffffffff-3140-4000-8000-000000000001';
SELECT pg_temp.actor('ffffffff-3140-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.foreign',pg_temp.probe($q$UPDATE public.tenant_email_domains SET from_name='Foreign' WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.foreign')='0','current-workspace owner cannot mutate an exact foreign row');

SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.no_actor',pg_temp.probe($q$INSERT INTO public.tenant_email_domains(tenant_id,domain,from_name) VALUES('aaaaaaaa-3140-4000-8000-000000000001','missing-actor.example.invalid','Denied')$q$),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.no_actor')='42501','missing actor cannot INSERT through the existing authenticated door');

SELECT pg_temp.actor('ffffffff-3140-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.company',pg_temp.probe($q$INSERT INTO public.tenant_email_domains(tenant_id,domain,from_name) VALUES('aaaaaaaa-3140-4000-8000-000000000003','company.example.invalid','Company')$q$),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.company')='1','existing canonical company-workspace platform-admin exception is preserved');
SELECT pg_temp.actor('ffffffff-3140-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
SELECT set_config('domain_role.platform',pg_temp.probe($q$UPDATE public.tenant_email_domains SET from_name='Platform' WHERE id='eeeeeeee-3140-4000-8000-000000000002'$q$),true);
RESET ROLE;
SELECT pg_temp.ok(current_setting('domain_role.platform')='1','separate existing platform-owner policy remains effective without widening it');
SELECT pg_temp.ok((SELECT from_name='One' FROM public.tenant_email_domains WHERE id='eeeeeeee-3140-4000-8000-000000000001'),
 'negative attempts leave the other workspace sentinel unchanged');
DO $$DECLARE failures integer; successes integer; BEGIN
 SELECT count(*) FILTER(WHERE NOT ok),count(*) FILTER(WHERE ok) INTO failures,successes FROM _domain_role_result;
 RAISE NOTICE 'DOMAIN CURRENT ROLE: % PASS / % FAIL',successes,failures;
 IF failures<>0 THEN RAISE EXCEPTION 'DOMAIN CURRENT ROLE proof failed: %',failures; END IF;
END $$;
ROLLBACK;
