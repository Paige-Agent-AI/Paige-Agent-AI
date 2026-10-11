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
 ('ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000d001','content','ed010000-0000-4000-8000-00000000f001',1,'{"kind":"text","title":"Client brief","body":"Submitted version","brief":"PRIVATE_INTERNAL","provider":"PRIVATE_PROVIDER"}','ed010000-0000-4000-8000-000000000001');
insert into auth.users(id,aud,role,email) values
 ('ed010000-0000-4000-8000-000000000004','authenticated','authenticated','delivery-client@tests.invalid');
update public.clients set linked_user_id='ed010000-0000-4000-8000-000000000004'
 where id='ed010000-0000-4000-8000-00000000c001';
create temporary table delivery_test_values(key text primary key,value text);
grant select on delivery_test_values to authenticated;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
insert into delivery_test_values values('work_updated',(select updated_at::text from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'));
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_client_releases','SELECT'),'direct client grant table hidden');
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_client_releases','UPDATE'),'direct client acceptance denied');
select pg_temp.check_true(not has_function_privilege('anon','public.operations_delivery_client_read_scoped(uuid,uuid,uuid)','EXECUTE'),'anonymous artifact denied');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='work_updated'),0);
reset role;
insert into delivery_test_values values('submission',(select id::text from public.operations_delivery_submissions)),('submission_updated',(select updated_at::text from public.operations_delivery_submissions));
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.operations_delivery_review_scoped((select value::uuid from delivery_test_values where key='submission'),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='submission_updated'),'approved',null);
reset role;
update delivery_test_values set value=(select updated_at::text from public.operations_delivery_submissions) where key='submission_updated';
select pg_temp.check_true(not exists(select 1 from public.operations_delivery_client_releases),'internal approval creates no client acceptance');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.operations_delivery_release_scoped((select value::uuid from delivery_test_values where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='submission_updated'));
reset role;
insert into delivery_test_values values('release',(select id::text from public.operations_delivery_client_releases)),('release_updated',(select updated_at::text from public.operations_delivery_client_releases));
select pg_temp.check_true((select state='awaiting_client' and decision_by is null from public.operations_delivery_client_releases),'release awaits actual client decision');
-- Identity is revalidated per read; a saved release is not a perpetual tenant grant.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.clients set linked_user_id='ed010000-0000-4000-8000-000000000003'
 where id='ed010000-0000-4000-8000-00000000c001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111')$s$,'42501','relinked identity revokes previous client artifact access');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.clients set linked_user_id='ed010000-0000-4000-8000-000000000004'
 where id='ed010000-0000-4000-8000-00000000c001';
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000004','member','active',false,now());
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111')$s$,'42501','staff identity cannot act as external accepting client');
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from public.tenant_members where tenant_id='ed010000-0000-4000-8000-000000001111'
 and user_id='ed010000-0000-4000-8000-000000000004';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')$s$,'42501','staff cannot impersonate customer acceptance');
reset role;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true(public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111')->>'body'='Submitted version','client sees exact submitted artifact');
select pg_temp.check_true(not(public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111') ?| array['snapshot','brief','provider','review_note']),'client projection strips internal metadata');
select pg_temp.refused($s$select public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed020000-0000-4000-8000-000000002222')$s$,'42501','foreign tenant artifact denied');
select pg_temp.refused($s$select public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111','2000-01-01','accepted',null)$s$,'40001','stale client acceptance refused');
select pg_temp.refused($s$select public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='release_updated'),'client_revision_requested',' ')$s$,'22023','revision requires documented request');
select pg_temp.check_true(public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='release_updated'),'client_revision_requested','Correct the promised scope')->>'state'='client_revision_requested','explicit client revision authoritative readback');
reset role;
select pg_temp.check_true((select state='approved' and reviewed_by='ed010000-0000-4000-8000-000000000002' from public.operations_delivery_submissions),'client request preserves original staff approval');
select pg_temp.check_true((select decision_by='ed010000-0000-4000-8000-000000000004' and decision_at is not null from public.operations_delivery_client_releases),'client decision records actual actor and timestamp');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='work_updated'),1)$s$,'22023','unchanged artifact cannot satisfy client revision');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_client_status_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'client_releases')=1,'staff reads canonical client decision');
reset role;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_client_status_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111')->'client_releases')=0,'unrelated staff cannot read client decision');
reset role;
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) values
 ('ed010000-0000-4000-8000-00000000e002','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000d001','content','ed010000-0000-4000-8000-00000000f001',2,'{"kind":"text","title":"Corrected brief","body":"Revised promised scope"}','ed010000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.check_true(public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e002','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='work_updated'),1)->>'revision_no'='2','client revision uses canonical new submission');
reset role;
update delivery_test_values set value=(select id::text from public.operations_delivery_submissions where revision_no=2) where key='submission';
update delivery_test_values set value=(select updated_at::text from public.operations_delivery_submissions where revision_no=2) where key='submission_updated';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.operations_delivery_review_scoped((select value::uuid from delivery_test_values where key='submission'),'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='submission_updated'),'approved',null);
reset role;
update delivery_test_values set value=(select updated_at::text from public.operations_delivery_submissions where revision_no=2) where key='submission_updated';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.operations_delivery_release_scoped((select value::uuid from delivery_test_values where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='submission_updated'));
reset role;
update delivery_test_values set value=(select r.id::text from public.operations_delivery_client_releases r join public.operations_delivery_submissions s on s.id=r.submission_id where s.revision_no=2) where key='release';
update delivery_test_values set value=(select r.updated_at::text from public.operations_delivery_client_releases r join public.operations_delivery_submissions s on s.id=r.submission_id where s.revision_no=2) where key='release_updated';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true(public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='release_updated'),'accepted','Meets the promised scope')->>'state'='accepted','explicit client acceptance readback');
select pg_temp.refused($s$select public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='release_updated'),'client_revision_requested','Changed mind')$s$,'40001','accepted decision cannot be overwritten');
reset role;
select pg_temp.check_true((select count(*)=2 from public.operations_delivery_client_releases),'original revision and accepted outcome both retained');
rollback;
