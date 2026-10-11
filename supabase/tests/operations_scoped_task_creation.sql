-- Isolated synthetic, rolled-back database contract. Never customer data.
begin;
create function pg_temp.check_true(v boolean, label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %', label; end if;
raise notice 'PASS: %', label; end $$;
create function pg_temp.refused(stmt text, code text, label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if sqlstate = code then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: % (unexpected SQLSTATE %)', label, sqlstate;
  end;
  raise exception 'FAIL: % (accepted)', label;
end $$;
insert into auth.users(id,aud,role,email) values
 ('ec010000-0000-4000-8000-000000000001','authenticated','authenticated','ops-create-member@tests.invalid'),
 ('ec010000-0000-4000-8000-000000000002','authenticated','authenticated','ops-create-teammate@tests.invalid'),
 ('ec010000-0000-4000-8000-000000000003','authenticated','authenticated','ops-create-admin@tests.invalid'),
 ('ec020000-0000-4000-8000-000000000001','authenticated','authenticated','ops-create-foreign@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ec010000-0000-4000-8000-000000001111','test-ops-creation-a','Test Creation A','active','standalone','OCA',9930001,'{}'),
 ('ec020000-0000-4000-8000-000000002222','test-ops-creation-b','Test Creation B','active','standalone','OCB',9940002,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ec010000-0000-4000-8000-000000001111','ec010000-0000-4000-8000-000000000001','member','active',false,now()),
 ('ec010000-0000-4000-8000-000000001111','ec010000-0000-4000-8000-000000000002','member','active',false,now()),
 ('ec010000-0000-4000-8000-000000001111','ec010000-0000-4000-8000-000000000003','admin','active',false,now()),
 ('ec020000-0000-4000-8000-000000002222','ec020000-0000-4000-8000-000000000001','member','active',false,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111'),
 ('ec010000-0000-4000-8000-000000000002','ec010000-0000-4000-8000-000000001111'),
 ('ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000001111'),
 ('ec020000-0000-4000-8000-000000000001','ec020000-0000-4000-8000-000000002222')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.user_roles(user_id,role) values ('ec010000-0000-4000-8000-000000000003','admin') on conflict do nothing;
insert into public.plans(id,tenant_id,title,horizon,starts_on,ends_on,scope,created_by,owner_user_id) values
 ('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000001111','Test project one','custom',current_date,current_date+30,'team','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000000003'),
 ('ec010000-0000-4000-8000-00000000a002','ec010000-0000-4000-8000-000000001111','Test project two','custom',current_date,current_date+30,'team','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000000003');
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id) values
 ('ec010000-0000-4000-8000-00000000b001','ec010000-0000-4000-8000-000000001111','ec010000-0000-4000-8000-00000000a001','milestone','Test first milestone','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000000003'),
 ('ec010000-0000-4000-8000-00000000b002','ec010000-0000-4000-8000-000000001111','ec010000-0000-4000-8000-00000000a002','milestone','Test other milestone','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000000003');
select pg_temp.check_true(has_function_privilege('authenticated','public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)','EXECUTE'),'creation authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)','EXECUTE'),'creation anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)','EXECUTE'),'creation service denied');
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000001111','Test task','ec010000-0000-4000-8000-000000000001')$s$,'42501','creation actor mismatch denied');
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec020000-0000-4000-8000-000000002222','Test task','ec010000-0000-4000-8000-000000000001')$s$,'42501','creation foreign scope denied');
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test task','ec010000-0000-4000-8000-000000000002')$s$,'42501','member assigning teammate denied');
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test task','ec020000-0000-4000-8000-000000000001')$s$,'42501','foreign assignee denied');
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test task','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-00000000b002')$s$,'42501','milestone from another project denied');
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111',' ','ec010000-0000-4000-8000-000000000001')$s$,'22023','blank task title denied');
select pg_temp.check_true((select count(*)=0 from public.plan_items where tenant_id='ec010000-0000-4000-8000-000000001111' and item_type='task'),'refusals create no tasks');
create temporary table ops_created_identity(id uuid);
insert into ops_created_identity select (public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test self task','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-00000000b001',null,'high','Test context')->>'item_id')::uuid;
select pg_temp.check_true((select count(*)=1 from public.plan_items where id=(select id from ops_created_identity) and title='Test self task' and priority='high' and parent_item_id='ec010000-0000-4000-8000-00000000b001' and created_by='ec010000-0000-4000-8000-000000000001'),'canonical creation fields readback');
select pg_temp.check_true((select count(*)=1 from public.audit_logs where entity_id=(select id from ops_created_identity) and action='plan_assign_task'),'canonical creation audit preserved');
-- All event/bus inserts, including any queued pg_net work, roll back here.
-- Preserve both canonical role-sync triggers: grant administration while in B,
-- establish ordinary membership in A, then switch to A for the API assertion.
select set_config('request.jwt.claim.sub','ec020000-0000-4000-8000-000000000001',true);
update public.tenant_members set role='admin' where user_id='ec020000-0000-4000-8000-000000000001';
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ec010000-0000-4000-8000-000000001111','ec020000-0000-4000-8000-000000000001','member','active',false,now());
insert into public.user_roles(user_id,role) values ('ec020000-0000-4000-8000-000000000001','admin') on conflict do nothing;
update public.profiles set active_tenant_id='ec010000-0000-4000-8000-000000001111' where user_id='ec020000-0000-4000-8000-000000000001';
select pg_temp.check_true(not public.is_tenant_admin('ec010000-0000-4000-8000-000000001111') and public.is_tenant_admin('ec020000-0000-4000-8000-000000002222'),'creation fixture actor is member A and admin B');
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec020000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test forbidden assignment','ec010000-0000-4000-8000-000000000002')$s$,'42501','global role cannot grant target-tenant task delegation');

-- Operations only serves the canonical top-level standalone shell.
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000001',true);
update public.tenants set account_type='agency' where id='ec010000-0000-4000-8000-000000001111';
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test excluded task','ec010000-0000-4000-8000-000000000001')$s$,'42501','agency Operations capability refused');
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set account_type='standalone',parent_tenant_id='ec020000-0000-4000-8000-000000002222' where id='ec010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
select pg_temp.refused($s$select public.plan_assign_task_scoped('ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111','Test excluded task','ec010000-0000-4000-8000-000000000001')$s$,'42501','parented standalone Operations capability refused');
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id=null where id='ec010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
rollback;
