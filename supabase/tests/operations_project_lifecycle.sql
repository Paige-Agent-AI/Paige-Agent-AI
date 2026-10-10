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

select pg_temp.check_true(has_function_privilege('authenticated','public.plan_update_project_scoped(uuid,uuid,uuid,timestamptz,text,uuid,date,date)','EXECUTE'),'lifecycle authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.plan_update_project_scoped(uuid,uuid,uuid,timestamptz,text,uuid,date,date)','EXECUTE'),'lifecycle anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.plan_update_project_scoped(uuid,uuid,uuid,timestamptz,text,uuid,date,date)','EXECUTE'),'lifecycle service denied');
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111',now(),'active','ec010000-0000-4000-8000-000000000003',current_date,current_date+30)$s$,'42501','unrelated member cannot update project');
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000003',true);
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000003','ec020000-0000-4000-8000-000000002222',now(),'active','ec010000-0000-4000-8000-000000000003',current_date,current_date+30)$s$,'42501','foreign project scope refused');
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000001111','2000-01-01','active','ec010000-0000-4000-8000-000000000003',current_date,current_date+30)$s$,'40001','stale project edit refused');
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000001111',(select updated_at from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'completed','ec010000-0000-4000-8000-000000000003',current_date,current_date+30)$s$,'23514','unfinished milestone prevents completion');
select pg_temp.check_true((select status='draft' from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'refusals preserve project status');
select pg_temp.check_true((public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000003','ec010000-0000-4000-8000-000000001111',(select updated_at from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'active','ec010000-0000-4000-8000-000000000001',current_date,current_date+30)->>'ok')='true','staff activates and assigns existing source project');
select pg_temp.check_true((select status='active' and owner_user_id='ec010000-0000-4000-8000-000000000001' from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'status and owner source readback');
select pg_temp.check_true((select count(*)=1 from public.audit_logs where entity='plan' and entity_id='ec010000-0000-4000-8000-00000000a001' and action='plan_update'),'existing source audit appended');
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111',(select updated_at from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'active','ec010000-0000-4000-8000-000000000002',current_date,current_date+30)$s$,'42501','nonstaff owner cannot delegate project ownership');
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111',(select updated_at from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'active','ec010000-0000-4000-8000-000000000001',current_date+30,current_date)$s$,'22023','invalid recorded window refused');
update public.plan_items set status='done' where id='ec010000-0000-4000-8000-00000000b001';
select pg_temp.check_true((public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111',(select updated_at from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'completed','ec010000-0000-4000-8000-000000000001',current_date,current_date+30)->>'ok')='true','resolved work permits internal project completion');
select pg_temp.check_true((select status='done' from public.plan_items where id='ec010000-0000-4000-8000-00000000b001'),'project completion never rewrites child work');
delete from public.tenant_members where user_id='ec010000-0000-4000-8000-000000000001';
select pg_temp.refused($s$select public.plan_update_project_scoped('ec010000-0000-4000-8000-00000000a001','ec010000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000001111',(select updated_at from public.plans where id='ec010000-0000-4000-8000-00000000a001'),'active','ec010000-0000-4000-8000-000000000001',current_date,current_date+30)$s$,'42501','revoked owner membership refused');
rollback;

