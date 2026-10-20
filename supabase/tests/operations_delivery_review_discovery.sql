-- Disposable isolated fixture only; all synthetic records roll back.
begin;
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then
 if sqlstate=code then raise notice 'PASS: %',label;return;end if;
 raise exception 'FAIL: % unexpected %',label,sqlstate;end;
 raise exception 'FAIL: % accepted',label;end $$;
insert into auth.users(id,aud,role,email) select ('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','recovery-'||n||'@tests.invalid' from generate_series(1,5)n;
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ef240000-0000-4000-8000-000000001111','test-ops-review-recovery','Test Review Recovery','active','standalone','ORR',9952411,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
 select 'ef240000-0000-4000-8000-000000001111',('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(case when n=2 or n=4 then 'admin' else 'member' end)::public.tenant_role,'active',false,now() from generate_series(1,5)n;
insert into public.profiles(user_id,active_tenant_id) select ('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ef240000-0000-4000-8000-000000001111'::uuid from generate_series(1,5)n
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.user_roles(user_id,role) values('ef240000-0000-4000-8000-000000000004','admin') on conflict(user_id,role) do nothing;
-- Real Team membership synchronizes legacy administrator roles. Keep reviewer2
-- source-authorized but deliberately without the separate Planning item-admin grant.
delete from public.user_roles where user_id='ef240000-0000-4000-8000-000000000002' and role::text='admin';
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number) values
 ('ef240000-0000-4000-8000-00000000c001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-000000000001','Test','Client','ORR-1');
insert into public.plans(id,tenant_id,title,horizon,starts_on,ends_on,scope,created_by,owner_user_id) values
 ('ef240000-0000-4000-8000-00000000a001','ef240000-0000-4000-8000-000000001111','Review obligation','custom',current_date,current_date+30,'team','ef240000-0000-4000-8000-000000000003','ef240000-0000-4000-8000-000000000003');
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) values
 ('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-00000000a001','task','Client delivery work','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000000005','ef240000-0000-4000-8000-00000000c001');
insert into public.studio_sessions(id,tenant_id,owner_user_id,title) values
 ('ef240000-0000-4000-8000-00000000d001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-000000000001','Delivery source');
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) values
 ('ef240000-0000-4000-8000-00000000e001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-00000000d001','content','ef240000-0000-4000-8000-00000000f001',1,'{"kind":"text","title":"Reviewed work","body":"Immutable source","internal_brief":"Private source metadata"}','ef240000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000001',true);
select public.operations_delivery_submit_scoped('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-00000000e001','ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ef240000-0000-4000-8000-00000000b001'),0);

create temporary table artifact_context as select id from public.operations_delivery_submissions where tenant_id='ef240000-0000-4000-8000-000000001111';
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select on artifact_context to authenticated;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000002',true);
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)->'reviews')=1,'nominated reviewer discovers one exact authorized pending submission');
select pg_temp.check_true((public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)->'reviews'->0->>'title')='Reviewed work','queue title comes from exact authorized immutable artifact');
select pg_temp.check_true(not(public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)->'reviews'->0 ?| array['body','snapshot','internal_brief','client_name','work_title']),'queue has no body private metadata or general work/client title');
reset role;
savepoint bounded_reviews;
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) values
 ('ef240000-0000-4000-8000-00000000b002','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-00000000a001','task','Second delivery work','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000000005','ef240000-0000-4000-8000-00000000c001');
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000001',true);
select public.operations_delivery_submit_scoped('ef240000-0000-4000-8000-00000000b002','ef240000-0000-4000-8000-00000000e001','ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ef240000-0000-4000-8000-00000000b002'),0);
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',1)->>'has_more')::boolean,'bounded discovery reports additional nominations without pretending complete coverage');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',1)->'reviews')=1,'bounded discovery returns only the requested page');
reset role;
rollback to savepoint bounded_reviews;
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',40)$s$,'42501','different expected actor cannot borrow a nomination');
select pg_temp.refused($s$select public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000009999',40)$s$,'42501','foreign tenant discovery refuses');
select pg_temp.refused($s$select public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',0)$s$,'22023','invalid limit refuses rather than producing a misleading empty queue');
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000003',true);
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000003','ef240000-0000-4000-8000-000000001111',40)->'reviews')=0,'unrelated plan owner gets no other persons nominations');
reset role;
update public.tenant_members set role='member' where tenant_id='ef240000-0000-4000-8000-000000001111' and user_id='ef240000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)->>'unavailable_count')::integer=1,'inaccessible nomination remains a sourced partial count');
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)->'reviews')=0,'lost Studio authority conceals content references');
reset role;
update public.tenant_members set status='inactive' where tenant_id='ef240000-0000-4000-8000-000000001111' and user_id='ef240000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)$s$,'42501','revoked membership refuses instead of an empty ready result');
reset role;
update public.tenant_members set status='active',role='admin' where tenant_id='ef240000-0000-4000-8000-000000001111' and user_id='ef240000-0000-4000-8000-000000000002';
set local role authenticated;
select public.operations_delivery_review_scoped((select id from artifact_context),'ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',(public.operations_delivery_list_scoped('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111')->'submissions'->0->>'updated_at')::timestamptz,'approved',null);
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_reviews_scoped('ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',40)->'reviews')=0,'completed internal review leaves pending discovery');
select pg_temp.check_true(not has_function_privilege('anon','public.operations_delivery_reviews_scoped(uuid,uuid,integer)','execute'),'anonymous queue execution denied');
reset role;
rollback;
