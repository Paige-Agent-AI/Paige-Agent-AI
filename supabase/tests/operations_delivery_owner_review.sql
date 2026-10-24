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

-- Owner Oct24 D2 policy: keep the original native version/review/release/client
-- records and actual authenticated database role. This rollback-only fixture is
-- for a disposable full-schema test stack, never customer production records.
update public.tenant_members set is_owner=true,role='owner'
 where tenant_id='ed010000-0000-4000-8000-000000001111'
   and user_id='ed010000-0000-4000-8000-000000000001';
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) values
 ('ed010000-0000-4000-8000-00000000b002','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000a001','task','Admin-owned item','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-00000000c001'),
 ('ed010000-0000-4000-8000-00000000b003','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000a001','task','Staff-owned item','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-00000000c001'),
 ('ed010000-0000-4000-8000-00000000b004','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000a001','task','Owner review after demotion','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-00000000c001');
insert into public.studio_sessions(id,tenant_id,owner_user_id,title) values
 ('ed010000-0000-4000-8000-00000000d002','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000002','Admin exact source'),
 ('ed010000-0000-4000-8000-00000000d003','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-000000000003','Staff exact source');
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) values
 ('ed010000-0000-4000-8000-00000000e002','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000d002','content','ed010000-0000-4000-8000-00000000f002',1,'{"kind":"text","title":"Admin source","body":"Exact admin-owned body"}','ed010000-0000-4000-8000-000000000002'),
 ('ed010000-0000-4000-8000-00000000e003','ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000d003','content','ed010000-0000-4000-8000-00000000f003',1,'{"kind":"text","title":"Staff source","body":"Exact staff-owned body"}','ed010000-0000-4000-8000-000000000003');
create temporary table owner_delivery_context(key text primary key,value jsonb not null);
insert into owner_delivery_context select id::text,to_jsonb(w) from public.plan_items w
 where tenant_id='ed010000-0000-4000-8000-000000001111';
grant select,insert,update on owner_delivery_context to authenticated;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
select pg_temp.check_true(public.is_tenant_owner('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111'),'owner is authoritative active business membership');
select pg_temp.check_true(not public.is_tenant_owner('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111'),'admin membership is not the owner exception');
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_submissions','INSERT'),'owner exception adds no direct submission insert grant');
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_submissions','UPDATE'),'owner exception adds no direct submission update grant');
select pg_temp.check_true(not has_function_privilege('anon','public.operations_delivery_submit_scoped(uuid,uuid,uuid,uuid,uuid,timestamptz,integer)','EXECUTE'),'anonymous native submit remains denied');

set local role authenticated;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
select pg_temp.refused($s$select public.operations_delivery_submit_scoped(
 'ed010000-0000-4000-8000-00000000b003','ed010000-0000-4000-8000-00000000e003',
 'ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000000003',
 'ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='ed010000-0000-4000-8000-00000000b003'),0)$s$,'42501','staff with actual item and Studio authority cannot nominate self');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
select pg_temp.refused($s$select public.operations_delivery_submit_scoped(
 'ed010000-0000-4000-8000-00000000b002','ed010000-0000-4000-8000-00000000e002',
 'ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000000002',
 'ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='ed010000-0000-4000-8000-00000000b002'),0)$s$,'42501','non-owner admin with actual item and Studio authority cannot nominate self');

select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
insert into owner_delivery_context values('submission_ack',public.operations_delivery_submit_scoped(
 'ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-00000000e001',
 'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001',
 'ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='ed010000-0000-4000-8000-00000000b001'),0));
select pg_temp.check_true((select value->>'state'='in_review' and value->>'review_mode'='owner_self_review' from owner_delivery_context where key='submission_ack'),'owner saves exact version for a separate internal decision');
insert into owner_delivery_context values('submission',(public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions'->0));
select pg_temp.check_true((select value->>'submitted_by'=value->>'reviewer_user_id' and value->>'reviewed_by' is null and value->>'review_mode'='owner_self_review' from owner_delivery_context where key='submission'),'nomination truthfully retains self identity and no completed review');
select pg_temp.check_true((public.operations_delivery_reviews_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'reviews'->0->>'review_mode')='owner_self_review','original nominated-review queue includes the exact owner review');
select pg_temp.check_true((public.operations_delivery_artifact_scoped((select (value->>'id')::uuid from owner_delivery_context where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->>'body')='Submitted version','owner inspects the original exact body, not another version');
select pg_temp.refused($s$select public.operations_delivery_release_scoped((select (value->>'id')::uuid from owner_delivery_context where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='submission'))$s$,'42501','owner submission is not internal approval or client release');
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select (value->>'id')::uuid from owner_delivery_context where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111','2000-01-01','approved',null)$s$,'40001','owner review cannot use a stale revision');
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select (value->>'id')::uuid from owner_delivery_context where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='submission'),'accepted',null)$s$,'22023','owner internal decision cannot claim client acceptance');
insert into owner_delivery_context values('review_ack',public.operations_delivery_review_scoped((select (value->>'id')::uuid from owner_delivery_context where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='submission'),'approved','Owner checked this exact version'));
select pg_temp.check_true((select value->>'state'='approved' and value->>'review_mode'='owner_self_review' from owner_delivery_context where key='review_ack'),'explicit owner internal review is recorded');
update owner_delivery_context set value=public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions'->0 where key='submission';
select pg_temp.check_true((public.operations_delivery_client_status_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'client_releases')='[]'::jsonb,'internal owner approval creates no client release');
insert into owner_delivery_context values('release_ack',public.operations_delivery_release_scoped((select (value->>'id')::uuid from owner_delivery_context where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='submission')));
select pg_temp.check_true((select value->>'state'='awaiting_client' from owner_delivery_context where key='release_ack'),'separate release awaits the real linked client decision');
select pg_temp.refused($s$select public.operations_delivery_client_decide_scoped((select (value->>'release_id')::uuid from owner_delivery_context where key='release_ack'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',now(),'accepted',null)$s$,'42501','owner cannot act as the separately linked external client');

select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
insert into owner_delivery_context values('client_read',public.operations_delivery_client_read_scoped((select (value->>'release_id')::uuid from owner_delivery_context where key='release_ack'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111'));
select pg_temp.check_true((select value->>'state'='awaiting_client' and value->>'body'='Submitted version' from owner_delivery_context where key='client_read'),'external client receives only the released exact version');
select pg_temp.check_true((public.operations_delivery_client_decide_scoped((select (value->>'release_id')::uuid from owner_delivery_context where key='release_ack'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='client_read'),'accepted',null)->>'state')='accepted','only separate external client records actual native acceptance');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
select pg_temp.check_true((public.operations_delivery_client_status_scoped('ed010000-0000-4000-8000-00000000b001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'client_releases'->0->>'decision_by')='ed010000-0000-4000-8000-000000000004','owner readback attributes acceptance to the original linked client');
insert into owner_delivery_context values('demotion_ack',public.operations_delivery_submit_scoped('ed010000-0000-4000-8000-00000000b004','ed010000-0000-4000-8000-00000000e001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='ed010000-0000-4000-8000-00000000b004'),0));
insert into owner_delivery_context values('demotion_submission',public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b004','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions'->0);
reset role;
select pg_temp.check_true((select data->>'review_mode'='owner_self_review' from public.audit_logs where entity='operations_delivery' and action='delivery_reviewed' and entity_id=(select (value->>'id')::uuid from owner_delivery_context where key='submission')),'original review audit records the honest owner method');
select pg_temp.refused($s$update public.operations_delivery_submissions set artifact_digest=repeat('b',64) where id=(select (value->>'id')::uuid from owner_delivery_context where key='submission')$s$,'42501','approved exact-version digest remains immutable');
select pg_temp.refused($s$update public.operations_delivery_submissions set review_mode='second_person' where id=(select (value->>'id')::uuid from owner_delivery_context where key='submission')$s$,'42501','completed owner review method remains immutable');
select pg_temp.refused($s$update public.operations_delivery_submissions set review_mode='second_person' where id=(select (value->>'id')::uuid from owner_delivery_context where key='demotion_submission')$s$,'23514','self identity cannot be relabeled as second-person review');
-- Trusted disposable-fixture role change; never a production membership mutation.
update public.tenant_members set is_owner=true,role='owner' where tenant_id='ed010000-0000-4000-8000-000000001111' and user_id='ed010000-0000-4000-8000-000000000002';
update public.tenant_members set is_owner=false,role='member' where tenant_id='ed010000-0000-4000-8000-000000001111' and user_id='ed010000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select (value->>'id')::uuid from owner_delivery_context where key='demotion_submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select (value->>'updated_at')::timestamptz from owner_delivery_context where key='demotion_submission'),'approved',null)$s$,'42501','owner status is rechecked at the actual review decision');
select pg_temp.check_true((public.operations_delivery_reviews_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->>'unavailable_count')::integer=1,'demoted owner nomination is unavailable rather than executable');
select pg_temp.check_true((public.operations_delivery_list_scoped('ed010000-0000-4000-8000-00000000b004','ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111')->'submissions'->0->>'state')='in_review','refused owner review does not manufacture approval');
reset role;
rollback;
