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

select pg_temp.check_true(has_function_privilege('authenticated','public.plan_update_item_versioned(uuid,uuid,uuid,timestamptz,text,timestamptz,uuid)','EXECUTE'),'versioned authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_update_item_versioned(uuid,uuid,uuid,timestamptz,text,timestamptz,uuid)','EXECUTE'),'versioned anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_update_item_versioned(uuid,uuid,uuid,timestamptz,text,timestamptz,uuid)','EXECUTE'),'versioned service denied');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_update_item_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','2000-01-01','done')$s$,'40001','stale version refused');
select pg_temp.refused($s$select public.plan_update_item_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',null,'done')$s$,'40001','missing version refused');
select pg_temp.check_true((select status='open' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'version refusal leaves work unchanged');
select pg_temp.check_true((select count(*)=0 from public.audit_logs where entity_id='ee010000-0000-4000-8000-00000000a001'),'version refusal creates no audit');
select pg_temp.refused($s$select public.plan_update_item_versioned('ee020000-0000-4000-8000-00000000b001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','2000-01-01','done')$s$,'42501','foreign item fails closed before version comparison');
select pg_temp.check_true((public.plan_update_item_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'in_progress')->>'ok')='true','matching version delegates canonical update');
select pg_temp.check_true((select status='in_progress' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'versioned update source readback');
delete from public.user_roles where user_id='ee010000-0000-4000-8000-000000000003';
insert into public.user_roles(user_id,role) values ('ee010000-0000-4000-8000-000000000003','coach');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000003',true);
select pg_temp.check_true((public.plan_update_item_versioned('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000003','ee010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'blocked')->>'ok')='true','coach delegates existing canonical staff writer');
select pg_temp.check_true((select status='blocked' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'coach canonical stage readback');
rollback;
