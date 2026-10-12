-- Isolated rollback-only fixtures. Never execute against customer production records.
begin;
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then
  if sqlstate=code then raise notice 'PASS: %',label; return; end if;
  raise exception 'FAIL: % unexpected %',label,sqlstate; end;
  raise exception 'FAIL: % accepted',label; end $$;
insert into auth.users(id,aud,role,email) values
 ('ed010000-0000-4000-8000-000000000001','authenticated','authenticated','delivery-author@tests.invalid'),
 ('ed010000-0000-4000-8000-000000000002','authenticated','authenticated','delivery-reviewer@tests.invalid'),
 ('ed010000-0000-4000-8000-000000000003','authenticated','authenticated','delivery-unrelated@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ed010000-0000-4000-8000-000000001111','test-ops-delivery','Test Delivery','active','standalone','ODL',9950011,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000001','member','active',false,now()),
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000002','admin','active',false,now()),
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000003','member','active',false,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111'),
 ('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111'),
 ('ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number) values
 ('ed010000-0000-4000-8000-00000000c001','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000001','Test','Client','ODL-1');
insert into public.plans(id,tenant_id,title,horizon,starts_on,ends_on,scope,created_by,owner_user_id) values
 ('ed010000-0000-4000-8000-00000000a001','ed010000-0000-4000-8000-000000001111','Existing project','custom',current_date,current_date+30,'team','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001');
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) values
 ('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000a001','task','Existing client obligation','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-00000000c001');
insert into public.studio_sessions(id,tenant_id,owner_user_id,title) values
 ('ed010000-0000-4000-8000-00000000d001','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000001','Existing artifact session');
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) values
 ('ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000d001','content','ed010000-0000-4000-8000-00000000f001',1,'{"body":"Submitted version"}','ed010000-0000-4000-8000-000000000001');
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_submissions','INSERT'),'direct client insert denied');
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_submissions','UPDATE'),'direct client update denied');
select pg_temp.check_true(not has_function_privilege('anon','public.operations_delivery_submit_scoped(uuid,uuid,uuid,uuid,uuid,timestamptz,integer)','EXECUTE'),'anonymous submit denied');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),0)$s$,'42501','self reviewer denied');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),0)$s$,'42501','reviewer without source access denied');
select pg_temp.check_true((public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),0)->>'state')='in_review','eligible source submitted');
select pg_temp.check_true((select count(*)=1 from public.operations_delivery_submissions),'one canonical submission');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),0)$s$,'40001','duplicate retry stale revision denied');
select pg_temp.refused($s$update public.operations_delivery_submissions set artifact_digest=repeat('b',64)$s$,'42501','submitted digest immutable');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select id from public.operations_delivery_submissions),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111','2000-01-01','approved',null)$s$,'40001','stale reviewer edit denied');
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select id from public.operations_delivery_submissions),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select updated_at from public.operations_delivery_submissions),'accepted',null)$s$,'22023','internal reviewer cannot claim client acceptance');
select pg_temp.check_true((public.operations_delivery_review_scoped((select id from public.operations_delivery_submissions),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select updated_at from public.operations_delivery_submissions),'revision_requested','Correct the client brief')->>'state')='revision_requested','documented revision persisted');
select pg_temp.check_true((select count(*)=2 from public.audit_logs where entity='operations_delivery' and data->>'tenant_id'='ed010000-0000-4000-8000-000000001111'),'existing audit source records submission and review');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111')->'submissions')=1,'reviewer canonical readback');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111')->'submissions')=0,'unrelated member cannot read submission notes');
-- Exercise real database role privileges, not only owner impersonation by JWT.
do $$ begin execute format('grant usage on schema %I to authenticated',
  (select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
-- Database-owner setup only; the selected unrelated actor cannot provision a foreign tenant.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ed020000-0000-4000-8000-000000002222','test-ops-delivery-foreign','Test Foreign Delivery','active','standalone','ODF',9950022,'{}');
insert into public.plans(id,tenant_id,title,horizon,starts_on,ends_on,scope,created_by,owner_user_id) values
 ('ed020000-0000-4000-8000-00000000a002','ed020000-0000-4000-8000-000000002222','Foreign existing project','custom',current_date,current_date+30,'team','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001');
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by) values
 ('ed020000-0000-4000-8000-00000000b002','ed020000-0000-4000-8000-000000002222','ed020000-0000-4000-8000-00000000a002','task','Foreign work','ed010000-0000-4000-8000-000000000001');
insert into public.studio_sessions(id,tenant_id,owner_user_id,title) values
 ('ed020000-0000-4000-8000-00000000d002','ed020000-0000-4000-8000-000000002222','ed010000-0000-4000-8000-000000000001','Foreign session');
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) values
 ('ed020000-0000-4000-8000-00000000e002','ed020000-0000-4000-8000-000000002222','ed020000-0000-4000-8000-00000000d002','content','ed020000-0000-4000-8000-00000000f002',1,'{"body":"Foreign version"}','ed010000-0000-4000-8000-000000000001');
create temporary table delivery_fixture_context as select
  w.updated_at as work_updated_at,s.id as submission_id,s.updated_at as submission_updated_at
  from public.plan_items w join public.operations_delivery_submissions s on s.work_item_id=w.id;
grant select on delivery_fixture_context to authenticated;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused($s$select * from public.operations_delivery_submissions$s$,'42501','authenticated direct submission read denied');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed020000-0000-4000-8000-00000000b002','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select work_updated_at from delivery_fixture_context),1)$s$,'42501','actual foreign work refused');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed020000-0000-4000-8000-00000000e002','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select work_updated_at from delivery_fixture_context),1)$s$,'42501','actual foreign artifact refused');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000002222',(select work_updated_at from delivery_fixture_context),1)$s$,'42501','authenticated foreign tenant scope refused');
select pg_temp.check_true((public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select work_updated_at from delivery_fixture_context),1)->>'revision_no')='2','authenticated revision submission executes without table grants');
reset role;
truncate delivery_fixture_context;
insert into delivery_fixture_context select w.updated_at,s.id,s.updated_at from public.plan_items w
  join public.operations_delivery_submissions s on s.work_item_id=w.id where s.revision_no=2;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111')->'submissions')=2,'authenticated scoped revision readback');
reset role;
update public.tenant_members set role='member' where user_id='ed010000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select submission_id from delivery_fixture_context),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select submission_updated_at from delivery_fixture_context),'approved',null)$s$,'40001','revoked reviewer source access refuses approval');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111')->'submissions')=0,'revoked reviewer source access removes nomination read');
reset role;
update public.tenant_members set role='admin' where user_id='ed010000-0000-4000-8000-000000000002';
update public.tenants set account_type='agency' where id='ed010000-0000-4000-8000-000000001111';
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select submission_id from delivery_fixture_context),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select submission_updated_at from delivery_fixture_context),'approved',null)$s$,'42501','agency review capability refused');
reset role;
update public.tenants set account_type='standalone' where id='ed010000-0000-4000-8000-000000001111';
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.tenants set parent_tenant_id='ed020000-0000-4000-8000-000000002222' where id='ed010000-0000-4000-8000-000000001111';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select submission_id from delivery_fixture_context),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select submission_updated_at from delivery_fixture_context),'approved',null)$s$,'42501','parented standalone review refused');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.tenants set parent_tenant_id=null where id='ed010000-0000-4000-8000-000000001111';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_review_scoped((select submission_id from delivery_fixture_context),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select submission_updated_at from delivery_fixture_context),'approved','Ready for explicit client release')->>'state')='approved','authenticated reviewer approval persists');
reset role;
select pg_temp.check_true((select state='approved' from public.operations_delivery_submissions where revision_no=2),'approval remains internal approval');
-- ANT-152: a plan owner and historical submitter cannot read or submit hidden work.
-- Provision changes only as fixture owner; exercise the RPCs as authenticated.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
insert into auth.users(id,aud,role,email) values
 ('ed010000-0000-4000-8000-000000000004','authenticated','authenticated','delivery-assignee@tests.invalid');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000004','member','active',false,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
update public.plan_items set created_by='ed010000-0000-4000-8000-000000000003',
 assigned_to_user_id='ed010000-0000-4000-8000-000000000004'
 where id='ed010000-0000-4000-8000-00000000b001';
truncate delivery_fixture_context;
insert into delivery_fixture_context select updated_at,null::uuid,null::timestamptz
 from public.plan_items where id='ed010000-0000-4000-8000-00000000b001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),'canonical RLS hides unrelated plan owner item');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions')=0,'plan owner and historical submitter cannot list hidden item');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select work_updated_at from delivery_fixture_context),2)$s$,'42501','unrelated plan owner submission refused before revision checks');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.plans set owner_user_id='ed010000-0000-4000-8000-000000000003' where id='ed010000-0000-4000-8000-00000000a001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions')=0,'plan creator alone cannot list hidden item');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.plans set owner_user_id='ed010000-0000-4000-8000-000000000001',created_by='ed010000-0000-4000-8000-000000000003' where id='ed010000-0000-4000-8000-00000000a001';
insert into public.user_roles(user_id,role) values('ed010000-0000-4000-8000-000000000001','admin') on conflict do nothing;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions')=0,'global admin without target tenant admin authority cannot list hidden item');
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select work_updated_at from delivery_fixture_context),2)$s$,'42501','global admin without target authority cannot submit');
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from public.user_roles where user_id='ed010000-0000-4000-8000-000000000001' and role='admin';
set local role authenticated;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
select pg_temp.check_true((select count(*)=1 from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),'canonical RLS admits item creator');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111')->'submissions')=2,'item creator reads canonical delivery');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
select pg_temp.check_true((select count(*)=1 from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),'canonical RLS admits item assignee');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111')->'submissions')=2,'item assignee reads canonical delivery');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) values
 ('ed010000-0000-4000-8000-00000000b003','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000a001','task','Creator obligation','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-00000000c001'),
 ('ed010000-0000-4000-8000-00000000b004','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000a001','task','Assignee obligation','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-00000000c001');
update public.studio_sessions set owner_user_id='ed010000-0000-4000-8000-000000000003' where id='ed010000-0000-4000-8000-00000000d001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b003','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ed010000-0000-4000-8000-00000000b003'),0)->>'state')='in_review','item creator with source authority submits');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.studio_sessions set owner_user_id='ed010000-0000-4000-8000-000000000004' where id='ed010000-0000-4000-8000-00000000d001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b004','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ed010000-0000-4000-8000-00000000b004'),0)->>'state')='in_review','item assignee with source authority submits');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.studio_sessions set owner_user_id='ed010000-0000-4000-8000-000000000002' where id='ed010000-0000-4000-8000-00000000d001';
update public.tenant_members set role='member' where user_id='ed010000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),'nomination does not grant Planning item read');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111')->'submissions')=2,'nominated reviewer retains source-authorized submission read');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.tenant_members set status='inactive' where user_id='ed010000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b003','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111')$s$,'42501','revoked member item creator list refused');
reset role;
rollback;
