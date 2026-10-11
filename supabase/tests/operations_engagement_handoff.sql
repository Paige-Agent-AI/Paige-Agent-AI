-- Synthetic rollback-only authority contract; no customer records.
begin;
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then if sqlstate=code then raise notice 'PASS: %',label; return; end if;
raise exception 'FAIL: % unexpected %',label,sqlstate; end; raise exception 'FAIL: % accepted',label; end $$;
insert into auth.users(id,aud,role,email) values
 ('eb810000-0000-4000-8000-000000000001','authenticated','authenticated','ops-project-member@tests.invalid'),
 ('eb810000-0000-4000-8000-000000000002','authenticated','authenticated','ops-project-admin@tests.invalid'),
 ('eb820000-0000-4000-8000-000000000001','authenticated','authenticated','ops-project-foreign@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('eb810000-0000-4000-8000-000000001111','test-ops-handoff-a','Test Project A','active','standalone','OPA',9950801,'{}'),
 ('eb820000-0000-4000-8000-000000002222','test-ops-handoff-b','Test Project B','active','standalone','OPB',9960802,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('eb810000-0000-4000-8000-000000001111','eb810000-0000-4000-8000-000000000001','member','active',false,now()),
 ('eb810000-0000-4000-8000-000000001111','eb810000-0000-4000-8000-000000000002','admin','active',false,now()),
 ('eb820000-0000-4000-8000-000000002222','eb820000-0000-4000-8000-000000000001','member','active',false,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('eb810000-0000-4000-8000-000000000001','eb810000-0000-4000-8000-000000001111'),
 ('eb810000-0000-4000-8000-000000000002','eb810000-0000-4000-8000-000000001111'),
 ('eb820000-0000-4000-8000-000000000001','eb820000-0000-4000-8000-000000002222')
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.user_roles(user_id,role) values ('eb810000-0000-4000-8000-000000000002','admin') on conflict do nothing;

insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number) values
 ('eb810000-0000-4000-8000-00000000c001','eb810000-0000-4000-8000-000000001111','eb810000-0000-4000-8000-000000000002','Test','Handoff','OSH-1');
insert into public.tenant_products(id,tenant_id,name,status,product_type,created_by) values
 ('eb810000-0000-4000-8000-00000000f001','eb810000-0000-4000-8000-000000001111','Test engagement','active','service','eb810000-0000-4000-8000-000000000002');
insert into public.tenant_client_agreements(id,tenant_id,contact_id,offer_id,term_kind,price_basis,agreed_amount_minor,agreed_currency,status,created_by) values
 ('eb810000-0000-4000-8000-00000000d001','eb810000-0000-4000-8000-000000001111','eb810000-0000-4000-8000-00000000c001','eb810000-0000-4000-8000-00000000f001','one_time','negotiated',100,'usd','active','eb810000-0000-4000-8000-000000000002');
insert into public.paige_agreements(id,tenant_id,contact_id,offer_id,commercial_terms_id,title,body_markdown,status,version,content_sha256,sealed_sha256,sealed_storage_key,completed_at,created_by) values
 ('eb810000-0000-4000-8000-00000000a001','eb810000-0000-4000-8000-000000001111','eb810000-0000-4000-8000-00000000c001','eb810000-0000-4000-8000-00000000f001','eb810000-0000-4000-8000-00000000d001','Test signed commitment','PRIVATE_SOURCE_BODY','completed',3,repeat('a',64),repeat('b',64),'PRIVATE_SOURCE_KEY',now(),'eb810000-0000-4000-8000-000000000002');
-- Test convenience wrapper is SECURITY INVOKER, not an authority shortcut.
create function pg_temp.handoff(request uuid default 'eb810000-0000-4000-8000-00000000e001', steps jsonb default '[{"title":"Test review","assigned_to_user_id":"eb810000-0000-4000-8000-000000000001","priority":"high"}]', version integer default 3, title text default 'Test fulfillment', agreement uuid default 'eb810000-0000-4000-8000-00000000a001') returns jsonb language sql as $$
 select public.operations_engagement_handoff(auth.uid(),'eb810000-0000-4000-8000-000000001111',agreement,'eb810000-0000-4000-8000-00000000c001',(select commercial_terms_id from public.paige_agreements where id=agreement),'eb810000-0000-4000-8000-00000000f001',version,repeat('a',64),repeat('b',64),(select t.updated_at from public.tenant_client_agreements t join public.paige_agreements a on a.commercial_terms_id=t.id where a.id=agreement),request,title,'eb810000-0000-4000-8000-000000000002',current_date,current_date+10,steps,'Reviewed operational scope');
$$;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text),pg_temp.handoff(uuid,jsonb,integer,text,uuid) to authenticated;
select pg_temp.check_true(has_function_privilege('authenticated','public.operations_engagement_handoff(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text,uuid,date,date,jsonb,text)','EXECUTE'),'handoff authenticated grant');
select pg_temp.check_true(not has_function_privilege('anon','public.operations_engagement_handoff(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text,uuid,date,date,jsonb,text)','EXECUTE'),'handoff anon denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.operations_engagement_handoff(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text,uuid,date,date,jsonb,text)','EXECUTE'),'handoff service denied');
select set_config('request.jwt.claim.sub','eb810000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff()','42501','member cannot authorize commercial handoff');
reset role;
select set_config('request.jwt.claim.sub','eb810000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff(version=>2)','40001','stale frozen signing version refused');
select pg_temp.refused($s$select pg_temp.handoff(steps=>'[{"title":"First valid milestone","assigned_to_user_id":"eb810000-0000-4000-8000-000000000001"},{"title":"Invalid foreign milestone","assigned_to_user_id":"eb820000-0000-4000-8000-000000000001"}]')$s$,'42501','invalid later milestone rolls entire handoff back');
select pg_temp.check_true((select count(*)=0 from public.plans where tenant_id='eb810000-0000-4000-8000-000000001111'),'failed handoff creates no project');
select pg_temp.check_true((select count(*)=0 from public.plan_items where tenant_id='eb810000-0000-4000-8000-000000001111'),'failed handoff creates no milestone');
create temporary table handoff_results(value jsonb);
insert into handoff_results values(pg_temp.handoff());
select pg_temp.check_true((select value->>'client_accepted'='false' from handoff_results),'handoff never asserts client accepted delivery');
select pg_temp.check_true((select count(*)=1 from public.plans where id=(select (value->>'plan_id')::uuid from handoff_results) and metadata->'operations_engagement'->>'commercial_terms_id'='eb810000-0000-4000-8000-00000000d001'),'original commercial reference on canonical project');
select pg_temp.check_true((select count(*)=1 from public.plan_items where plan_id=(select (value->>'plan_id')::uuid from handoff_results) and item_type='milestone' and contact_id='eb810000-0000-4000-8000-00000000c001' and metadata->'operations_engagement'->>'version'='3' and assigned_to_user_id='eb810000-0000-4000-8000-000000000001'),'reviewed milestone uses canonical Team and Planning');
select pg_temp.check_true(pg_temp.handoff()->>'replayed'='true','same request returns original handoff');
select pg_temp.refused($s$select pg_temp.handoff('eb810000-0000-4000-8000-00000000e002')$s$,'40001','alternate retry key requires inspection of original handoff');
select pg_temp.check_true(pg_temp.handoff()->'milestone_ids'=(select value->'milestone_ids' from handoff_results),'replay preserves original milestone IDs');
select pg_temp.check_true((select count(*)=1 from public.plans where tenant_id='eb810000-0000-4000-8000-000000001111'),'retries never duplicate canonical project');
select pg_temp.refused($s$select pg_temp.handoff(title=>'Changed scope')$s$,'40001','changed scope cannot silently overwrite linked project');
reset role;
-- Original signing remains source-owned. A later frozen version must not silently replace provenance.
insert into public.paige_agreements(id,tenant_id,contact_id,offer_id,commercial_terms_id,title,body_markdown,status,version,content_sha256,sealed_sha256,sealed_storage_key,completed_at,created_by) select 'eb810000-0000-4000-8000-00000000a002',tenant_id,contact_id,offer_id,commercial_terms_id,'Test later sealed document',body_markdown,status,4,content_sha256,sealed_sha256,sealed_storage_key,completed_at,created_by from public.paige_agreements where id='eb810000-0000-4000-8000-00000000a001';
set local role authenticated;
select pg_temp.refused($s$select pg_temp.handoff(version=>4,agreement=>'eb810000-0000-4000-8000-00000000a002')$s$,'40001','new signed version cannot overwrite original engagement handoff');
reset role;

update public.tenant_client_agreements set status='paused' where id='eb810000-0000-4000-8000-00000000d001';
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff()','42501','paused commercial terms do not authorize handoff');
reset role;
update public.tenant_client_agreements set status='active' where id='eb810000-0000-4000-8000-00000000d001';
insert into public.paige_agreements(id,tenant_id,contact_id,offer_id,commercial_terms_id,title,body_markdown,status,version,created_by) select 'eb810000-0000-4000-8000-00000000a003',tenant_id,contact_id,offer_id,commercial_terms_id,'Test unsealed draft',body_markdown,'draft',3,created_by from public.paige_agreements where id='eb810000-0000-4000-8000-00000000a001';
set local role authenticated;
select pg_temp.refused($s$select pg_temp.handoff(agreement=>'eb810000-0000-4000-8000-00000000a003')$s$,'42501','unsealed draft cannot authorize operational handoff');
reset role;

insert into public.tenant_client_agreements(id,tenant_id,contact_id,offer_id,term_kind,price_basis,agreed_amount_minor,agreed_currency,status,created_by) select 'eb810000-0000-4000-8000-00000000d002',tenant_id,contact_id,offer_id,term_kind,price_basis,agreed_amount_minor,agreed_currency,'active',created_by from public.tenant_client_agreements where id='eb810000-0000-4000-8000-00000000d001';
insert into public.paige_agreements(id,tenant_id,contact_id,offer_id,commercial_terms_id,title,body_markdown,status,version,content_sha256,sealed_sha256,sealed_storage_key,completed_at,created_by) select 'eb810000-0000-4000-8000-00000000a004',tenant_id,contact_id,offer_id,'eb810000-0000-4000-8000-00000000d002','Test separate engagement',body_markdown,status,version,content_sha256,sealed_sha256,sealed_storage_key,completed_at,created_by from public.paige_agreements where id='eb810000-0000-4000-8000-00000000a001';
set local role authenticated;
select pg_temp.refused($s$select pg_temp.handoff(agreement=>'eb810000-0000-4000-8000-00000000a004')$s$,'40001','original request cannot authorize a second engagement');
reset role;
do $fixture$ declare prior_sub text:=current_setting('request.jwt.claim.sub',true); prior_claims text:=current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id='eb820000-0000-4000-8000-000000002222' where id='eb810000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true); perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff()','42501','parented standalone cannot use Solo handoff');
reset role;
do $fixture$ declare prior_sub text:=current_setting('request.jwt.claim.sub',true); prior_claims text:=current_setting('request.jwt.claims',true); begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
 update public.tenants set parent_tenant_id=null where id='eb810000-0000-4000-8000-000000001111';
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true); perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
end $fixture$;
select set_config('request.jwt.claim.sub','eb820000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff()','42501','foreign workspace handoff refused');
reset role;
select set_config('request.jwt.claim.sub','eb810000-0000-4000-8000-000000000002',true);
update public.tenants set account_type='agency' where id='eb810000-0000-4000-8000-000000001111';
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff()','42501','agency shell cannot use Solo handoff');
reset role;
delete from public.tenant_members where tenant_id='eb810000-0000-4000-8000-000000001111' and user_id='eb810000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.refused('select pg_temp.handoff()','42501','revoked owner cannot replay prior handoff');
reset role;
rollback;
