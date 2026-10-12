-- Synthetic rollback-only authority contract; no customer records.
begin;
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then if sqlstate=code then raise notice 'PASS: %',label; return; end if;
raise exception 'FAIL: % unexpected %',label,sqlstate; end; raise exception 'FAIL: % accepted',label; end $$;
insert into auth.users(id,aud,role,email) values
 ('ed010000-0000-4000-8000-000000000001','authenticated','authenticated','ops-project-member@tests.invalid'),
 ('ed010000-0000-4000-8000-000000000002','authenticated','authenticated','ops-project-admin@tests.invalid'),
 ('ed020000-0000-4000-8000-000000000001','authenticated','authenticated','ops-project-foreign@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ed010000-0000-4000-8000-000000001111','test-ops-project-a','Test Project A','active','standalone','OPA',9950001,'{}'),
 ('ed020000-0000-4000-8000-000000002222','test-ops-project-b','Test Project B','active','standalone','OPB',9960002,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000001','member','active',false,now()),
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000002','admin','active',false,now()),
 ('ed020000-0000-4000-8000-000000002222','ed020000-0000-4000-8000-000000000001','member','active',false,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111'),
 ('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111'),
 ('ed020000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000002222')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.user_roles(user_id,role) values ('ed010000-0000-4000-8000-000000000002','admin') on conflict do nothing;
select pg_temp.check_true(has_function_privilege('authenticated','public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text)','EXECUTE'),'project authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text)','EXECUTE'),'project anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_create_scoped(uuid,uuid,text,text,date,date,text,uuid,text)','EXECUTE'),'project service denied');
select pg_temp.check_true(has_function_privilege('authenticated','public.plan_add_milestone_scoped(uuid,uuid,uuid,text,text,timestamptz,uuid,text)','EXECUTE'),'milestone authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_add_milestone_scoped(uuid,uuid,uuid,text,text,timestamptz,uuid,text)','EXECUTE'),'milestone anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_add_milestone_scoped(uuid,uuid,uuid,text,text,timestamptz,uuid,text)','EXECUTE'),'milestone service denied');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111','Test','custom',current_date,current_date+10,'individual','ed010000-0000-4000-8000-000000000001')$s$,'42501','project actor mismatch denied');
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000002222','Test','custom',current_date,current_date+10,'individual','ed010000-0000-4000-8000-000000000001')$s$,'42501','project foreign scope denied');
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','Test','custom',current_date,current_date+10,'team','ed010000-0000-4000-8000-000000000001')$s$,'42501','member team creation denied');
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','Test','custom',current_date+10,current_date,'individual','ed010000-0000-4000-8000-000000000001')$s$,'22023','inverted window denied');
create temporary table ops_created_plan(id uuid);
insert into ops_created_plan select (public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','Test self project','custom',current_date,current_date+10,'individual','ed010000-0000-4000-8000-000000000001','Test outcome')->>'plan_id')::uuid;
select pg_temp.check_true((select count(*)=1 from public.plans where id=(select id from ops_created_plan) and status='active' and title='Test self project' and owner_user_id='ed010000-0000-4000-8000-000000000001'),'canonical project active readback');
select pg_temp.refused(format($s$select public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',%L,'Test milestone',null,null,'ed010000-0000-4000-8000-000000000001')$s$,(select id from ops_created_plan)),'42501','member milestone creation denied');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
select pg_temp.refused(format($s$select public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',%L,'Test milestone',null,null,'ed020000-0000-4000-8000-000000000001')$s$,(select id from ops_created_plan)),'42501','milestone foreign owner denied');
select pg_temp.refused($s$select public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111','ed020000-0000-4000-8000-000000009999','Test milestone',null,null,'ed010000-0000-4000-8000-000000000002')$s$,'42501','milestone unavailable project denied');
create temporary table ops_created_milestone(id uuid);
insert into ops_created_milestone select (public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select id from ops_created_plan),'Test review',null,null,'ed010000-0000-4000-8000-000000000001','high')->>'item_id')::uuid;
select pg_temp.check_true((select count(*)=1 from public.plan_items where id=(select id from ops_created_milestone) and plan_id=(select id from ops_created_plan) and item_type='milestone' and status='open' and priority='high' and assigned_to_user_id='ed010000-0000-4000-8000-000000000001'),'canonical milestone parent/person/readback');
select pg_temp.check_true((select count(*)=2 from public.audit_logs where entity_id in (select id from ops_created_plan union all select id from ops_created_milestone) and action in ('plan_create','plan_add_milestone')),'canonical project/milestone audit preserved');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
insert into public.user_roles(user_id,role) values ('ed010000-0000-4000-8000-000000000001','admin') on conflict do nothing;
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','Test forbidden team','custom',current_date,current_date+10,'team','ed010000-0000-4000-8000-000000000001')$s$,'42501','global role cannot grant target-tenant team creation');
select pg_temp.refused(format($s$select public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',%L,'Test forbidden milestone',null,null,'ed010000-0000-4000-8000-000000000001')$s$,(select id from ops_created_plan)),'42501','global role cannot grant target-tenant milestone administration');

-- Operations only serves the canonical top-level standalone shell.
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
update public.tenants set account_type='agency' where id='ed010000-0000-4000-8000-000000001111';
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','Test excluded project','custom',current_date,current_date+10,'individual','ed010000-0000-4000-8000-000000000001')$s$,'42501','agency Operations capability refused');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select id from ops_created_plan),'Test excluded milestone',null,null,'ed010000-0000-4000-8000-000000000001')$s$,'42501','agency secondary Operations capability refused');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set account_type='standalone',parent_tenant_id='ed020000-0000-4000-8000-000000002222' where id='ed010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
select pg_temp.refused($s$select public.plan_create_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','Test excluded project','custom',current_date,current_date+10,'individual','ed010000-0000-4000-8000-000000000001')$s$,'42501','parented standalone Operations capability refused');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.plan_add_milestone_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select id from ops_created_plan),'Test excluded milestone',null,null,'ed010000-0000-4000-8000-000000000001')$s$,'42501','parented standalone secondary Operations capability refused');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id=null where id='ed010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
rollback;
