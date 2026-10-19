-- E09 Slice 7: a paused client loses the released-work (operations delivery) customer path, which
-- keys on the link rather than the resolver, and gets it back on restore. A refused decision writes
-- nothing. Reuses the canonical released-artifact fixture of operations_delivery_client_discovery.sql
-- (copied, unchanged, through the client's first discovery); rollback-only synthetic data.
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
-- A plan owner with independent Studio access still lacks the current item's
-- authority. This isolates the client-release gate from the artifact gate.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.plans set owner_user_id='ed010000-0000-4000-8000-000000000003'
 where id='ed010000-0000-4000-8000-00000000a001';
update public.studio_sessions set owner_user_id='ed010000-0000-4000-8000-000000000003'
 where id='ed010000-0000-4000-8000-00000000d001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.check_true(not exists(select 1 from public.plan_items where id='ed010000-0000-4000-8000-00000000b001'),'unrelated plan owner lacks canonical item visibility');
select pg_temp.refused($s$select public.operations_delivery_release_scoped((select value::uuid from delivery_test_values where key='submission'),'ed010000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='submission_updated'))$s$,'42501','plan owner with Studio authority cannot release unrelated work');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.studio_sessions set owner_user_id='ed010000-0000-4000-8000-000000000001'
 where id='ed010000-0000-4000-8000-00000000d001';
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;
reset role;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true(public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40) @> '{"releases":[],"unavailable_count":0,"has_more":false}'::jsonb,'legitimately linked client has no invented released work before release');
reset role;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000001',true);
set local role authenticated;

select public.operations_delivery_release_scoped((select value::uuid from delivery_test_values where key='submission'),'ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='submission_updated'));
reset role;
insert into delivery_test_values values('release',(select id::text from public.operations_delivery_client_releases)),('release_updated',(select updated_at::text from public.operations_delivery_client_releases));
select pg_temp.check_true((select state='awaiting_client' and decision_by is null from public.operations_delivery_client_releases),'release awaits actual client decision');

select pg_temp.check_true(not has_function_privilege('anon','public.operations_delivery_client_reviews_scoped(uuid,uuid,integer)','EXECUTE'),'anonymous client discovery denied');
select pg_temp.check_true(not has_table_privilege('authenticated','public.operations_delivery_client_releases','SELECT'),'client discovery does not grant direct release reads');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40)->'releases')=1,'actual linked client discovers their released artifact');
select pg_temp.check_true(public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40)->'releases'->0->>'title'='Client brief','discovery title is the exact released client-safe artifact');
select pg_temp.check_true(not(public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40)->'releases'->0 ?| array['body','client_note','work_item_id','plan_id','client_id','reviewer_user_id','snapshot','brief','provider']),'discovery omits body notes private project and staff metadata');
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000001111',40)$s$,'42501','expected actor cannot impersonate actual client');
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed020000-0000-4000-8000-000000002222',40)$s$,'42501','foreign tenant discovery refused');
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',null)$s$,'22023','absent discovery bound refused');
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',41)$s$,'22023','excessive discovery bound refused');
reset role;
-- The business admin pauses the client through the one writer (read first for the version).
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true(public.set_client_portal_access('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',
  'ed010000-0000-4000-8000-00000000c001','pause','engagement_paused',null,
  (public.read_client_portal_access('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000c001')->>'since')::timestamptz)->>'state'='paused','the business admin pauses the client');
reset role;
insert into delivery_test_values values('audit_before',(select count(*)::text from public.audit_logs where entity='operations_delivery'));
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40)$s$,'42501','paused: released-work discovery refused');
-- Round 2 (verifier finding 2): the OPENING gate refuses a paused client before it looks at any argument,
-- so an out-of-range page size is still "unavailable", never a limit error that admits they reached it.
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',41)$s$,'42501','paused: the opening gate refuses before the page size is examined');
select pg_temp.refused($s$select public.operations_delivery_client_read_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111')$s$,'42501','paused: the released artifact is not readable');
select pg_temp.refused($s$select public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='release_updated'),'accepted','Looks good')$s$,'42501','paused: a decision is refused');
reset role;
select pg_temp.check_true((select state='awaiting_client' and decision_by is null and client_note is null from public.operations_delivery_client_releases),'paused: the refused decision wrote nothing to the release');
select pg_temp.check_true((select count(*)::text from public.audit_logs where entity='operations_delivery')=(select value from delivery_test_values where key='audit_before'),'paused: and no decision audit row');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true(public.set_client_portal_access('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',
  'ed010000-0000-4000-8000-00000000c001','restore',null,null,
  (public.read_client_portal_access('ed010000-0000-4000-8000-000000001111','ed010000-0000-4000-8000-00000000c001')->>'since')::timestamptz)->>'state'='open','the business admin restores');
reset role;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40)->'releases')=1,'restored: discovery is back');
reset role;
-- Round 2 (verifier finding 2): a pause that lands DURING the list — after the opening gate and after a
-- row was read — is caught by the CLOSING gate, which refuses the whole answer. A stand-in for the per-row
-- reader returns the real row and then pauses the client, as a staff pause committing mid-loop would.
alter function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) rename to operations_delivery_client_read_scoped_real;
create function public.operations_delivery_client_read_scoped(p_release_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v jsonb;
begin
  v:=public.operations_delivery_client_read_scoped_real(p_release_id,p_expected_actor_id,p_expected_tenant_id);
  perform pg_catalog.set_config('paige.portal_access_write','1',true);
  update public.clients set portal_access_state='paused',portal_access_reason='other',portal_access_changed_at=pg_catalog.clock_timestamp()
   where id='ed010000-0000-4000-8000-00000000c001';
  perform pg_catalog.set_config('paige.portal_access_write','',true);
  return v;
end $f$;
grant execute on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) to authenticated;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_client_reviews_scoped('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',40)$s$,'42501','a pause landing mid-list is refused by the closing gate');
reset role;
drop function public.operations_delivery_client_read_scoped(uuid,uuid,uuid);
alter function public.operations_delivery_client_read_scoped_real(uuid,uuid,uuid) rename to operations_delivery_client_read_scoped;
select pg_temp.check_true((select portal_access_state='open' from public.clients where id='ed010000-0000-4000-8000-00000000c001'),'(the refused list rolled the stand-in pause back)');
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true(public.operations_delivery_client_decide_scoped((select value::uuid from delivery_test_values where key='release'),'ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000001111',(select value::timestamptz from delivery_test_values where key='release_updated'),'accepted','Looks good')->>'state'='accepted','restored: the client decides');
reset role;
select set_config('request.jwt.claim.sub','',true);
rollback;
