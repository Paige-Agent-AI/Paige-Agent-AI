-- Isolated rollback-owned source/authority fixtures; never production business data.
begin;
create function pg_temp.ops_check(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end $$;
create function pg_temp.ops_refused(stmt text,label text) returns void language plpgsql as $$
begin begin execute stmt;exception when sqlstate '42501' then raise notice 'PASS: %',label;return;end;
raise exception 'FAIL: % (accepted)',label;end $$;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.ops_check(boolean,text),pg_temp.ops_refused(text,text) to authenticated;
insert into auth.users(id,email) values
 ('ea710000-0000-4000-8000-000000000001','ops-source-reader@tests.invalid'),
 ('ea710000-0000-4000-8000-000000000002','ops-source-other@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ea710000-0000-4000-8000-000000001111','test-ops-signing-a','Test signing A','active','standalone','OSA',9950101,'{}'),
 ('ea720000-0000-4000-8000-000000002222','test-ops-signing-b','Test signing B','active','standalone','OSB',9950102,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner) values
 ('ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-000000000001','member','active',false),
 ('ea720000-0000-4000-8000-000000002222','ea710000-0000-4000-8000-000000000001','admin','active',false);
insert into public.profiles(user_id,active_tenant_id) values
 ('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number) values
 ('ea710000-0000-4000-8000-00000000c001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-000000000001','Test','Counterparty','OSC-1');
insert into public.paige_agreements(id,tenant_id,contact_id,title,body_markdown,status,version,content_sha256,sealed_sha256,sealed_storage_key,completed_at,created_by) values
 ('ea710000-0000-4000-8000-00000000a001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000c001','Test executed document','PRIVATE_BODY_NEVER_PROJECTED','completed',3,repeat('a',64),repeat('b',64),'PRIVATE_KEY_NEVER_PROJECTED',now(),'ea710000-0000-4000-8000-000000000001');
select pg_temp.ops_check(has_function_privilege('authenticated','public.operations_engagement_evidence_read(uuid,uuid,uuid)','EXECUTE'),'evidence authenticated grant');
select pg_temp.ops_check(not has_function_privilege('anon','public.operations_engagement_evidence_read(uuid,uuid,uuid)','EXECUTE'),'evidence anon denied');
select pg_temp.ops_check(not has_function_privilege('service_role','public.operations_engagement_evidence_read(uuid,uuid,uuid)','EXECUTE'),'evidence service denied');
select set_config('request.jwt.claims','{"sub":"ea710000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.ops_check((public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')->'evidence'->>'version')='3','frozen signing version preserved under caller RLS');
select pg_temp.ops_check((public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')->'evidence'->>'sealed_sha256')=repeat('b',64),'sealed source digest preserved');
select pg_temp.ops_check(public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')::text not like '%NEVER_PROJECTED%','private body and storage key withheld');
select pg_temp.ops_check((public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')->'evidence'->>'handoff_authorized')='false','signature never grants handoff authority');
select pg_temp.ops_check((public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')->'evidence'->>'client_accepted')='false','signature never claims accepted delivery');
select pg_temp.ops_refused($s$select public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000002','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')$s$,'evidence actor mismatch refused');
select pg_temp.ops_refused($s$select public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea720000-0000-4000-8000-000000002222','ea710000-0000-4000-8000-00000000a001')$s$,'evidence changed workspace refused');
select pg_temp.ops_refused($s$select public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea720000-0000-4000-8000-00000000a001')$s$,'missing or foreign evidence refused');
reset role;
update public.tenants set account_type='agency' where id='ea710000-0000-4000-8000-000000001111';
set local role authenticated;
select pg_temp.ops_refused($s$select public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')$s$,'agency evidence capability refused');
reset role;
do $fixture$ declare prior_sub text:=current_setting('request.jwt.claim.sub',true);
 prior_claims text:=current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set account_type='standalone',parent_tenant_id='ea720000-0000-4000-8000-000000002222' where id='ea710000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
set local role authenticated;
select pg_temp.ops_refused($s$select public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')$s$,'parented standalone evidence capability refused');
reset role;
do $fixture$ declare prior_sub text:=current_setting('request.jwt.claim.sub',true);
 prior_claims text:=current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id=null where id='ea710000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
delete from public.tenant_members where tenant_id='ea710000-0000-4000-8000-000000001111' and user_id='ea710000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.ops_refused($s$select public.operations_engagement_evidence_read('ea710000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000001111','ea710000-0000-4000-8000-00000000a001')$s$,'revoked member evidence capability refused');
reset role;
rollback;
