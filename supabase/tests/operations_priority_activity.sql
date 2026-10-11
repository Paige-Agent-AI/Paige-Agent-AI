-- Disposable synthetic authorization proof; never run against business data.
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
 ('ee010000-0000-4000-8000-000000000001','authenticated','authenticated','ops-creator@tests.invalid'),
 ('ee010000-0000-4000-8000-000000000002','authenticated','authenticated','ops-assignee@tests.invalid'),
 ('ee010000-0000-4000-8000-000000000003','authenticated','authenticated','ops-staff@tests.invalid'),
 ('ee020000-0000-4000-8000-000000000001','authenticated','authenticated','ops-foreign@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ee010000-0000-4000-8000-000000001111','test-operations-a','Test Operations A','active','standalone','OPA',9910001,'{}'),
 ('ee020000-0000-4000-8000-000000002222','test-operations-b','Test Operations B','active','standalone','OPB',9920002,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ee010000-0000-4000-8000-000000001111','ee010000-0000-4000-8000-000000000001','member','active',false,now()),
 ('ee010000-0000-4000-8000-000000001111','ee010000-0000-4000-8000-000000000002','member','active',false,now()),
 ('ee010000-0000-4000-8000-000000001111','ee010000-0000-4000-8000-000000000003','admin','active',false,now()),
 ('ee020000-0000-4000-8000-000000002222','ee020000-0000-4000-8000-000000000001','member','active',false,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111'),
 ('ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111'),
 ('ee010000-0000-4000-8000-000000000003','ee010000-0000-4000-8000-000000001111'),
 ('ee020000-0000-4000-8000-000000000001','ee020000-0000-4000-8000-000000002222')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.user_roles(user_id,role) values ('ee010000-0000-4000-8000-000000000003','admin') on conflict do nothing;
insert into public.plan_items(id,tenant_id,item_type,title,created_by,assigned_to_user_id) values
 ('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000001111','task','Test scoped work','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000000002'),
 ('ee020000-0000-4000-8000-00000000b001','ee020000-0000-4000-8000-000000002222','task','Test foreign work','ee020000-0000-4000-8000-000000000001','ee020000-0000-4000-8000-000000000001');

select pg_temp.check_true(has_function_privilege('authenticated','public.plan_item_activity_scoped(uuid,uuid,uuid)','EXECUTE'),'activity authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_item_activity_scoped(uuid,uuid,uuid)','EXECUTE'),'activity anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_item_activity_scoped(uuid,uuid,uuid)','EXECUTE'),'activity service denied');
select pg_temp.check_true(has_function_privilege('authenticated','public.plan_update_item_priority_versioned(uuid,uuid,uuid,timestamptz,text,text,timestamptz,uuid)','EXECUTE'),'priority authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_update_item_priority_versioned(uuid,uuid,uuid,timestamptz,text,text,timestamptz,uuid)','EXECUTE'),'priority anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_update_item_priority_versioned(uuid,uuid,uuid,timestamptz,text,text,timestamptz,uuid)','EXECUTE'),'priority service denied');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_update_item_priority_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','2000-01-01','high')$s$,'40001','stale priority refused');
select pg_temp.check_true((public.plan_update_item_priority_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'high')->>'ok')='true','priority delegates canonical writer');
select pg_temp.check_true((select priority='high' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'canonical priority readback');
select pg_temp.check_true((select count(*)=1 from public.audit_logs where entity_id='ee010000-0000-4000-8000-00000000a001' and action='plan_update_item'),'existing audit retained');
insert into public.audit_logs(user_id,entity,entity_id,action,data)
select 'ee010000-0000-4000-8000-000000000001','plan_item','ee010000-0000-4000-8000-00000000a001','plan_update_item',jsonb_build_object('status','done','private_note','NEVER_EXPOSE') from generate_series(1,30);
select pg_temp.check_true(jsonb_array_length(public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111')->'events')=25,'activity bounded to 25');
select pg_temp.check_true(public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111')::text not like '%NEVER_EXPOSE%','raw audit payload withheld');
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111')$s$,'42501','actor mismatch denied');
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee020000-0000-4000-8000-00000000b001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111')$s$,'42501','foreign activity denied');
update public.plan_items set assigned_to_user_id=null where id='ee010000-0000-4000-8000-00000000a001';
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111')$s$,'42501','null assignee cannot admit unrelated member');
insert into public.user_roles(user_id,role) values ('ee010000-0000-4000-8000-000000000002','admin') on conflict do nothing;
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111')$s$,'42501','global role cannot grant target-tenant activity visibility');
select pg_temp.refused($s$select public.plan_update_item_priority_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'urgent')$s$,'42501','global role cannot grant target-tenant priority management');
delete from public.user_roles where user_id='ee010000-0000-4000-8000-000000000003';
insert into public.user_roles(user_id,role) values ('ee010000-0000-4000-8000-000000000003','admin');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000003',true);
select pg_temp.check_true((public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000003','ee010000-0000-4000-8000-000000001111')->>'ok')='true','admin retains canonical Planning read visibility without new write authority');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000001',true);

-- Operations only serves the canonical top-level standalone shell.
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000001',true);
update public.tenants set account_type='agency' where id='ee010000-0000-4000-8000-000000001111';
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111')$s$,'42501','agency Operations capability refused');
select pg_temp.refused($s$select public.plan_update_item_priority_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'urgent')$s$,'42501','agency secondary Operations capability refused');
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set account_type='standalone',parent_tenant_id='ee020000-0000-4000-8000-000000002222' where id='ee010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111')$s$,'42501','parented standalone Operations capability refused');
select pg_temp.refused($s$select public.plan_update_item_priority_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'urgent')$s$,'42501','parented standalone secondary Operations capability refused');
-- Database-owner setup of rollback-owned hierarchy only; restore caller before API checks.
do $fixture$ declare prior_sub text := current_setting('request.jwt.claim.sub',true);
 prior_claims text := current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id=null where id='ee010000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
delete from public.tenant_members where user_id='ee010000-0000-4000-8000-000000000001';
select pg_temp.refused($s$select public.plan_item_activity_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111')$s$,'42501','revoked membership denied');
rollback;


