-- Disposable synthetic caller-RLS proof; no production business data.
begin;
create function pg_temp.ops_check(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end $$;
create function pg_temp.ops_refused(stmt text,label text) returns void language plpgsql as $$
begin begin execute stmt;exception when sqlstate '42501' then raise notice 'PASS: %',label;return;end;
raise exception 'FAIL: % (accepted)',label;end $$;
-- Grant only access to these temporary assertion helpers, not API table privileges.
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.ops_check(boolean,text),pg_temp.ops_refused(text,text) to authenticated;
insert into auth.users(id,email) values
 ('ef010000-0000-4000-8000-000000000001','ops-native-a@tests.invalid'),
 ('ef010000-0000-4000-8000-000000000002','ops-native-client@tests.invalid'),
 ('ef010000-0000-4000-8000-000000000003','ops-native-private@tests.invalid'),
 ('ef010000-0000-4000-8000-000000000004','ops-native-admin@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ef010000-0000-4000-8000-000000001111','test-native-work-a','Test native work A','active','standalone','ONA',9930101,'{}'),
 ('ef020000-0000-4000-8000-000000002222','test-native-work-b','Test native work B','active','standalone','ONB',9930102,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner) values
 ('ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000001','member','active',false),
 ('ef020000-0000-4000-8000-000000002222','ef010000-0000-4000-8000-000000000001','admin','active',false),
 ('ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000002','member','active',false),
 ('ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000003','member','active',false),
 ('ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000004','admin','active',false);
insert into public.profiles(user_id,active_tenant_id) values
 ('ef010000-0000-4000-8000-000000000001','ef010000-0000-4000-8000-000000001111'),
 ('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number,linked_user_id,assigned_coach_user_id) values
 ('ef010000-0000-4000-8000-00000000c001','ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000004','Test','Client','ONC-1','ef010000-0000-4000-8000-000000000002','ef010000-0000-4000-8000-000000000001');
insert into public.tasks(id,tenant_id,user_id,title,status,metadata) values
 ('ef010000-0000-4000-8000-00000000a001','ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000001','Test own task','pending','{"estimated_minutes":30,"priority":"P1","private_payload":"not projected"}'),
 ('ef010000-0000-4000-8000-00000000a002','ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000002','Test assigned client task','pending','{"estimated_minutes":"invalid"}'),
 ('ef010000-0000-4000-8000-00000000a003','ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000003','Test private work','pending',null),
 ('ef020000-0000-4000-8000-00000000b001','ef020000-0000-4000-8000-000000002222','ef010000-0000-4000-8000-000000000001','Test foreign work','pending',null);
insert into public.user_roles(user_id,role) values ('ef010000-0000-4000-8000-000000000001','admin'),('ef010000-0000-4000-8000-000000000004','admin') on conflict do nothing;
select pg_temp.ops_check(has_function_privilege('authenticated','public.operations_crm_work_read(uuid,uuid)','EXECUTE'),'native authenticated grant');
select pg_temp.ops_check(not has_function_privilege('anon','public.operations_crm_work_read(uuid,uuid)','EXECUTE'),'native anon denied');
select pg_temp.ops_check(not has_function_privilege('service_role','public.operations_crm_work_read(uuid,uuid)','EXECUTE'),'native service denied');
select set_config('request.jwt.claims','{"sub":"ef010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.ops_check(jsonb_array_length(public.operations_crm_work_read('ef010000-0000-4000-8000-000000000001','ef010000-0000-4000-8000-000000001111')->'tasks')=2,'global admin elsewhere cannot read unrelated or foreign work');
select pg_temp.ops_check(not (public.operations_crm_work_read('ef010000-0000-4000-8000-000000000001','ef010000-0000-4000-8000-000000001111')->'tasks'->0 ? 'metadata'),'raw metadata not projected');
select pg_temp.ops_refused($s$select public.operations_crm_work_read('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')$s$,'native actor mismatch refused');
select pg_temp.ops_refused($s$select public.operations_crm_work_read('ef010000-0000-4000-8000-000000000001','ef020000-0000-4000-8000-000000002222')$s$,'native expected scope mismatch refused');
reset role;
delete from public.user_roles where user_id='ef010000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.ops_check(jsonb_array_length(public.operations_crm_work_read('ef010000-0000-4000-8000-000000000001','ef010000-0000-4000-8000-000000001111')->'tasks')=2,'member reads self and assigned client under actual caller RLS');
select pg_temp.ops_check((public.operations_crm_work_read('ef010000-0000-4000-8000-000000000001','ef010000-0000-4000-8000-000000001111')->'tasks'->0->>'estimated_minutes')='30','recorded effort preserved');
select pg_temp.ops_check((public.operations_crm_work_read('ef010000-0000-4000-8000-000000000001','ef010000-0000-4000-8000-000000001111')->'tasks'->1->'estimated_minutes')='null'::jsonb,'invalid effort stays unknown without cast failure');
reset role;
select set_config('request.jwt.claims','{"sub":"ef010000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.ops_check(jsonb_array_length(public.operations_crm_work_read('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')->'tasks')=3,'target admin retains authorized native work');
reset role;
update public.tenants set account_type='agency' where id='ef010000-0000-4000-8000-000000001111';
set local role authenticated;
select pg_temp.ops_refused($s$select public.operations_crm_work_read('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')$s$,'native agency refused');
reset role;
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set account_type='standalone',parent_tenant_id='ef020000-0000-4000-8000-000000002222' where id='ef010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
set local role authenticated;
select pg_temp.ops_refused($s$select public.operations_crm_work_read('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')$s$,'native parented standalone refused');
reset role;
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id=null where id='ef010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
insert into public.tasks(tenant_id,user_id,title,status) select 'ef010000-0000-4000-8000-000000001111','ef010000-0000-4000-8000-000000000004','Test bounded work '||g,'pending' from generate_series(1,200) g;
set local role authenticated;
select pg_temp.ops_check(jsonb_array_length(public.operations_crm_work_read('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')->'tasks')=200,'native read caps source records');
select pg_temp.ops_check((public.operations_crm_work_read('ef010000-0000-4000-8000-000000000004','ef010000-0000-4000-8000-000000001111')->>'has_more')='true','native incomplete read remains explicit');
reset role;
-- Entire synthetic fixture and any queued transaction-owned events roll back.
rollback;
