-- Rollback-owned neutral cases for the canonical required exact-ID overload.
begin;
create function pg_temp.task_check(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end $$;
create function pg_temp.task_refused(stmt text,label text) returns void language plpgsql as $$
begin begin execute stmt;exception when sqlstate '42501' then raise notice 'PASS: %',label;return;end;
raise exception 'FAIL: % (accepted)',label;end $$;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.task_check(boolean,text),pg_temp.task_refused(text,text) to authenticated;
insert into auth.users(id,email) select ('ed350000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'task-reader-'||g||'@tests.invalid' from generate_series(1,5) g;
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ed350000-0000-4000-8000-000000001111','test-exact-task-a','Neutral exact A','active','standalone','ETA',9930351,'{}'),
 ('ed350000-0000-4000-8000-000000002222','test-exact-task-b','Neutral exact B','active','standalone','ETB',9930352,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner) values
 ('ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000001','member','active',false),
 ('ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000002','member','active',false),
 ('ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000003','admin','active',false),
 ('ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000000004','owner','active',true),
 ('ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000005','owner','active',true);
insert into public.profiles(user_id,active_tenant_id) select ('ed350000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 case when g=4 then 'ed350000-0000-4000-8000-000000002222'::uuid else 'ed350000-0000-4000-8000-000000001111'::uuid end from generate_series(1,5) g
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number,linked_user_id,assigned_coach_user_id) values
 ('ed350000-0000-4000-8000-00000000c001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000003','Neutral','Assigned','ETC-1','ed350000-0000-4000-8000-000000000002','ed350000-0000-4000-8000-000000000001');
insert into public.tasks(id,tenant_id,user_id,title,status,due_date,metadata)
 select ('ed350000-0000-4000-8000-'||lpad((10000+g)::text,12,'0'))::uuid,'ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000001','Neutral bounded task '||g,'completed','2030-01-01'::timestamptz+g*interval '1 hour','{"priority":"P2","private_payload":"never projected"}' from generate_series(1,250) g;
insert into public.tasks(id,tenant_id,user_id,title,status,metadata) values
 ('ed350000-0000-4000-8000-000000020001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000002','Neutral assigned task','pending','{"estimated_minutes":25}'),
 ('ed350000-0000-4000-8000-000000020002','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000000003','Neutral unrelated task','pending',null),
 ('ed350000-0000-4000-8000-000000020003','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000000001','Neutral foreign task','pending',null),
 ('ed350000-0000-4000-8000-000000020004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000000004','Neutral future tenant task','pending',null);
select set_config('request.jwt.claims','{"sub":"ed350000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111')->'tasks')=200,'old list remains capped at200');
select pg_temp.task_check(not exists(select 1 from jsonb_array_elements(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111')->'tasks') r where r->>'id'='ed350000-0000-4000-8000-000000010250'),'old bounded list genuinely omits exact late task');
-- This exact call is intentionally undefined on the predecessor: actual red proof.
select pg_temp.task_check(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')->'tasks'->0->>'id'='ed350000-0000-4000-8000-000000010250','exact own completed task beyond200 source cap');
select pg_temp.task_check((public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')->>'has_more')='false','exact read never presents a partial list');
select pg_temp.task_check(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111',null::uuid)=public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111'),'old two-argument rows identical to required-null overload');
select pg_temp.task_check(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000020001')->'tasks'->0->>'title'='Neutral assigned task','assigned client task remains visible under actual RLS');
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000020002')->'tasks')=0,'unrelated same-tenant task not visible');
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000020003')->'tasks')=0,'foreign task with same owner not visible');
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000099999')->'tasks')=0,'absent ID has same empty authorized projection');
select pg_temp.task_check(not (public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')->'tasks'->0 ? 'metadata'),'raw metadata remains excluded');
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000002','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')$s$,'exact actor substitution refused');
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000020003')$s$,'exact foreign expected tenant refused');
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001',null::uuid,'ed350000-0000-4000-8000-000000010250')$s$,'missing expected tenant refused');
reset role;
update public.clients set assigned_coach_user_id=null where id='ed350000-0000-4000-8000-00000000c001';
set local role authenticated;
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000020001')->'tasks')=0,'assignment withdrawal applies on fresh exact read');
reset role;
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner) values('ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000000001','member','active',false);
update public.profiles set active_tenant_id='ed350000-0000-4000-8000-000000002222' where user_id='ed350000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')$s$,'actual workspace switch refuses prior expected tenant');
reset role;
update public.profiles set active_tenant_id='ed350000-0000-4000-8000-000000001111' where user_id='ed350000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('ed350000-0000-4000-8000-000000000001','admin'),('ed350000-0000-4000-8000-000000000003','admin');
set local role authenticated;
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000020002')->'tasks')=0,'global app admin cannot widen native current-tenant member row rule');
reset role;
select set_config('request.jwt.claims','{"sub":"ed350000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.task_check(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000003','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')->'tasks'->0->>'id'='ed350000-0000-4000-8000-000000010250','current tenant admin and RLS admin retain exact row');
reset role;
delete from public.user_roles where user_id='ed350000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000003','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')->'tasks')=0,'tenant admin alone never bypasses original task RLS');
reset role;
select set_config('request.jwt.claims','{"sub":"ed350000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.task_check(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000020004')->'tasks'->0->>'id'='ed350000-0000-4000-8000-000000020004','distinct newly provisioned SOLO uses same native contract');
select pg_temp.task_check(jsonb_array_length(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000010250')->'tasks')=0,'new tenant cannot read original tenant task');
reset role;
select pg_temp.task_check(has_function_privilege('authenticated','public.operations_crm_work_read(uuid,uuid,uuid)','execute'),'exact authenticated grant');
select pg_temp.task_check(not has_function_privilege('anon','public.operations_crm_work_read(uuid,uuid,uuid)','execute'),'exact anon denied');
select pg_temp.task_check(not has_function_privilege('service_role','public.operations_crm_work_read(uuid,uuid,uuid)','execute'),'exact service denied');
select pg_temp.task_check((select not prosecdef and pronargdefaults=0 and proconfig=array['search_path=""'] from pg_proc where oid='public.operations_crm_work_read(uuid,uuid,uuid)'::regprocedure),'required three-argument ABI stays invoker empty-search-path');
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000020004')$s$,'missing original JWT actor refused');
reset role;
update public.tenant_members set status='inactive' where user_id='ed350000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ed350000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000020004')$s$,'inactive membership refuses exact read');
reset role;
update public.tenant_members set status='suspended' where user_id='ed350000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000020004')$s$,'suspended membership refuses exact read');
reset role;
delete from public.tenant_members where user_id='ed350000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000004','ed350000-0000-4000-8000-000000002222','ed350000-0000-4000-8000-000000020004')$s$,'deleted membership refuses exact read');
reset role;
select set_config('request.jwt.claims','{"sub":"ed350000-0000-4000-8000-000000000005","role":"authenticated"}',true);
update public.tenants set account_type='agency' where id='ed350000-0000-4000-8000-000000001111';
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000005','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')$s$,'agency owner does not gain SOLO read');
reset role;
do $fixture$ declare prior_sub text:=current_setting('request.jwt.claim.sub',true);prior_claims text:=current_setting('request.jwt.claims',true);begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 update public.tenants set account_type='standalone',parent_tenant_id='ed350000-0000-4000-8000-000000002222' where id='ed350000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
set local role authenticated;
select pg_temp.task_refused($s$select public.operations_crm_work_read('ed350000-0000-4000-8000-000000000005','ed350000-0000-4000-8000-000000001111','ed350000-0000-4000-8000-000000010250')$s$,'parented standalone refuses SOLO read');
reset role;
rollback;
