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

select pg_temp.check_true(has_function_privilege('authenticated','public.plan_update_item_scoped(uuid,uuid,uuid,text,timestamptz,uuid)','EXECUTE'),'authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_update_item_scoped(uuid,uuid,uuid,text,timestamptz,uuid)','EXECUTE'),'anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_update_item_scoped(uuid,uuid,uuid,text,timestamptz,uuid)','EXECUTE'),'service denied');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','done')$s$,'42501','missing actor');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111','done')$s$,'42501','wrong expected actor');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001',null,'ee010000-0000-4000-8000-000000001111','done')$s$,'42501','missing expected actor');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001',null,'done')$s$,'42501','missing expected tenant');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee020000-0000-4000-8000-000000002222','done')$s$,'42501','wrong expected tenant');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee020000-0000-4000-8000-00000000b001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','done')$s$,'42501','foreign item');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000ffff','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','done')$s$,'42501','missing item');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','made_up')$s$,'22023','invalid status');
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',null,null,'ee010000-0000-4000-8000-000000000001')$s$,'42501','creator cannot reassign');
select pg_temp.check_true((select status='open' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'refusals leave work unchanged');
select pg_temp.check_true((select count(*)=0 from public.audit_logs where entity_id='ee010000-0000-4000-8000-00000000a001'),'refusals leave audit unchanged');
select pg_temp.check_true(public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111',null,'2030-01-01T09:00:00Z') = '{"ok":true,"item_id":"ee010000-0000-4000-8000-00000000a001","tenant_id":"ee010000-0000-4000-8000-000000001111","actor_id":"ee010000-0000-4000-8000-000000000001"}'::jsonb,'creator due date and exact acknowledgement');
select pg_temp.check_true((select due_at='2030-01-01T09:00:00Z' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'canonical due date readback');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111',null,'2030-02-01T09:00:00Z')$s$,'42501','assignee cannot edit due date');
select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111','done');
select pg_temp.check_true((select status='done' and completed_at is not null from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'assignee completes canonical item');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000003',true);
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000003','ee010000-0000-4000-8000-000000001111',null,null,'ee020000-0000-4000-8000-000000000001')$s$,'42501','staff cannot assign foreign member');
select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000003','ee010000-0000-4000-8000-000000001111','in_progress',null,'ee010000-0000-4000-8000-000000000001');
select pg_temp.check_true((select status='in_progress' and assigned_to_user_id='ee010000-0000-4000-8000-000000000001' from public.plan_items where id='ee010000-0000-4000-8000-00000000a001'),'staff reassigns within tenant');
update public.tenant_members set status='inactive' where user_id='ee010000-0000-4000-8000-000000000002';
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000003','ee010000-0000-4000-8000-000000001111',null,null,'ee010000-0000-4000-8000-000000000002')$s$,'42501','staff cannot assign inactive member');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a001','ee010000-0000-4000-8000-000000000002','ee010000-0000-4000-8000-000000001111','done')$s$,'42501','revoked member refused');
select set_config('request.jwt.claim.sub','ee010000-0000-4000-8000-000000000001',true);
select pg_temp.check_true((public.plan_update_item('ee010000-0000-4000-8000-00000000a001','open')->>'ok')='true','existing unscoped writer compatibility');
insert into public.plan_items(id,tenant_id,item_type,title,created_by,assigned_to_user_id,remind_at,reminded_at) values
 ('ee010000-0000-4000-8000-00000000a002','ee010000-0000-4000-8000-000000001111','reminder','Test reminder','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000000001',now()-interval '1 day',now());
select public.plan_update_item_scoped('ee010000-0000-4000-8000-00000000a002','ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000001111','done');
select pg_temp.check_true((select completed_at is not null and reminded_at is not null from public.plan_items where id='ee010000-0000-4000-8000-00000000a002'),'wrapper preserves reminder completion behavior');
select public.plan_update_item('ee010000-0000-4000-8000-00000000a002',p_remind_at:=now()+interval '1 day');
select pg_temp.check_true((select reminded_at is null from public.plan_items where id='ee010000-0000-4000-8000-00000000a002'),'canonical reminder reschedule still re-arms dispatch');
rollback;
