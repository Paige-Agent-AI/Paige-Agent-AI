-- Included ONLY inside operations_scoped_project_creation.sql's rollback.
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
delete from public.user_roles where user_id='ed010000-0000-4000-8000-000000000002' and role='admin';
insert into public.tenant_business_time_zones(tenant_id,time_zone,set_by)
 values('ed010000-0000-4000-8000-000000001111','America/New_York','ed010000-0000-4000-8000-000000000002');
update public.plan_items set created_by='ed010000-0000-4000-8000-000000000001',assigned_to_user_id='ed010000-0000-4000-8000-000000000001'
 where id=(select id from ops_created_milestone);
create temporary table weekly_native_input as select gen_random_uuid() request_id,
 jsonb_build_object('v',1,'starts_on','2026-11-02','zone','America/New_York','goal','Review original fixture commitment',
 'sources',jsonb_build_array(jsonb_build_object('key','planning:'||i.id,'updated_at',i.updated_at,'minutes',15,'dependencies','[]'::jsonb)),
 'capacity_minutes',jsonb_build_object('ed010000-0000-4000-8000-000000000001',60,'ed010000-0000-4000-8000-000000000002',60),
 'included',jsonb_build_array('planning:'||i.id)) review from public.plan_items i where id=(select id from ops_created_milestone);
create temporary table weekly_native_result(result jsonb);
grant select on weekly_native_input to authenticated;
grant select,insert on weekly_native_result to authenticated;
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.refused($s$select public.save_weekly_plan_review_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select request_id from weekly_native_input),(select review from weekly_native_input))$s$,
 '40001','O02 actual tenant administrator cannot save another actor private Planning item');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.plan_items set created_by='ed010000-0000-4000-8000-000000000002',assigned_to_user_id='ed010000-0000-4000-8000-000000000002'
 where id=(select id from ops_created_milestone);
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.refused($s$select public.save_weekly_plan_review_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select request_id from weekly_native_input),(select review from weekly_native_input))$s$,
 '40001','O02 actual assigned item cannot bypass private parent Plan');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.plans set created_by='ed010000-0000-4000-8000-000000000002',owner_user_id='ed010000-0000-4000-8000-000000000002' where id=(select id from ops_created_plan);
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
insert into weekly_native_result select public.save_weekly_plan_review_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',(select request_id from weekly_native_input),(select review from weekly_native_input));
select pg_temp.check_true((select result->>'status'='succeeded' and result#>>'{current_work,0,state}'='available' from weekly_native_result),'O02 actual native producer saves permitted original Planning work');
select pg_temp.check_true((select public.save_weekly_plan_review_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',request_id,review)->>'plan_id'=(select result->>'plan_id' from weekly_native_result) from weekly_native_input),'O02 same original attempt never inserts a duplicate Plan');
reset role;
select pg_temp.check_true((select count(*)=1 from public.paige_workspace_events e where e.source_id=(select (result->>'receipt_run_id')::uuid from weekly_native_result)
 and e.detail->>'record_id'=(select result->>'plan_id' from weekly_native_result) and e.capability_key='plan_create'),'O02 full schema has one original correlated Planning Rail');
select set_config('request.jwt.claim.sub','',true);
update public.plan_items set created_by='ed010000-0000-4000-8000-000000000001',assigned_to_user_id='ed010000-0000-4000-8000-000000000001' where id=(select id from ops_created_milestone);
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((select public.get_weekly_plan_review_result_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',request_id)#>>'{current_work,0,state}'='unavailable' from weekly_native_input),'O02 source permission loss withholds original facts on actual native recovery');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.plan_items set created_by='ed010000-0000-4000-8000-000000000002',assigned_to_user_id='ed010000-0000-4000-8000-000000000002' where id=(select id from ops_created_milestone);
update public.plans set created_by='ed010000-0000-4000-8000-000000000001',owner_user_id='ed010000-0000-4000-8000-000000000001' where id=(select id from ops_created_plan);
select set_config('request.jwt.claim.sub','ed010000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((select public.get_weekly_plan_review_result_scoped('ed010000-0000-4000-8000-000000000002','ed010000-0000-4000-8000-000000001111',request_id)#>>'{current_work,0,state}'='unavailable' from weekly_native_input),'O02 private parent permission loss withholds actual recovery facts');
reset role;
