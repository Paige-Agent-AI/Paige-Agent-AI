-- EXP04 full-schema manual receipt/allocation proof. Disposable Preview/CI only.
-- Reuses original neutral commercial metadata fixture; all rows roll back.
-- Signing/document/issued metadata are synthetic. Receipt/correction/Rail and
-- authenticated-role receipt reads below use actual current native contracts.
-- This is not hosted authentication, actual payment or customer acceptance.
begin;
create temp table e04_commercial_fixture(data jsonb not null);
\ir fixtures/exp04_reviewed_commercial_native.sql
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then
 if sqlstate=code then raise notice 'PASS: %',label; return; end if;
 raise exception 'FAIL: % unexpected %: %',label,sqlstate,sqlerrm; end;
 raise exception 'FAIL: % accepted',label; end $$;

insert into auth.users(id,aud,role,email)
select (data->>'actor_id')::uuid,'authenticated','authenticated','e04-delivery-owner@tests.invalid' from e04_commercial_fixture
union all select 'e4960000-0000-4000-8000-000000000002','authenticated','authenticated','e04-delivery-client@tests.invalid'
union all select 'e4960000-0000-4000-8000-000000000003','authenticated','authenticated','e04-unrelated-member@tests.invalid';
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)
select (data->>'tenant_id')::uuid,'test-e04-reviewed-delivery','Test reviewed delivery','active','standalone','ERD',9949601,'{}' from e04_commercial_fixture;
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
select (data->>'tenant_id')::uuid,(data->>'actor_id')::uuid,'owner'::public.tenant_role,'active',true,now() from e04_commercial_fixture
union all select (data->>'tenant_id')::uuid,'e4960000-0000-4000-8000-000000000003','member','active',false,now() from e04_commercial_fixture;
insert into public.profiles(user_id,active_tenant_id)
select (data->>'actor_id')::uuid,(data->>'tenant_id')::uuid from e04_commercial_fixture
union all select 'e4960000-0000-4000-8000-000000000003',(data->>'tenant_id')::uuid from e04_commercial_fixture
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number,linked_user_id)
select (data->>'client_id')::uuid,(data->>'tenant_id')::uuid,(data->>'actor_id')::uuid,'Test','Reviewed client','ERD-C1','e4960000-0000-4000-8000-000000000002' from e04_commercial_fixture;
insert into public.tenant_products(id,tenant_id,name,status,product_type,created_by)
select (data#>>'{effective,offer_id}')::uuid,(data->>'tenant_id')::uuid,'Test exact engagement','active','service',(data->>'actor_id')::uuid from e04_commercial_fixture;

-- Seed captured synthetic commercial history only. No Work/review/client decision
-- is seeded or guard-bypassed. Full commercial writers retain their native proof.
set local session_replication_role=replica;
do $seed$ declare f jsonb; table_name text; rows jsonb; row_data jsonb; columns_sql text; begin
 select data into strict f from e04_commercial_fixture;
 foreach table_name in array array['tenant_client_agreements','paige_agreements','paige_agreement_signers','paige_agreement_events','paige_sales_collection_operations','paige_workspace_events','paige_invoices'] loop
  rows:=f#>array['records',table_name];
  for row_data in select value from jsonb_array_elements(rows) loop
   if table_name='tenant_client_agreements' then row_data:=row_data||jsonb_build_object('created_by',f->'actor_id'); end if;
   -- Full-schema event sequence is GENERATED ALWAYS; its real allocator owns
   -- this local row order. Accepted evidence references immutable event IDs.
   if table_name='paige_agreement_events' then row_data:=row_data-'seq'; end if;
   -- Retain original economics and seed a structural issued-metadata fixture.
   -- This does not exercise invoice publication, document bytes or signing.
   -- Original shape constraints stay intact; no payment receipt is seeded.
   if table_name='paige_invoices' then row_data:=row_data||jsonb_build_object(
    'status','issued','billing_lifecycle_version',2,'billing_issued_snapshot_version',1,'billing_issued_at',now(),
    'billing_issued_by',f->'actor_id','billing_document','{"fixture":"issued metadata only"}'::jsonb,
    'billing_document_digest',encode(extensions.digest(convert_to('{"fixture": "issued metadata only"}','UTF8'),'sha256'),'hex'),
    'billing_last_operation_id','e4960000-0000-4000-8000-000000000008','billing_last_request','{}'::jsonb); end if;
   select string_agg(format('%I',key),',' order by key) into columns_sql from jsonb_object_keys(row_data) key;
   execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1)',table_name,columns_sql,columns_sql,table_name) using row_data;
  end loop;
 end loop;
end $seed$;
set local session_replication_role=origin;

-- Isolated full-schema native/Rail proof, not real signing, hosted Auth or Owner QA.
-- Only original captured synthetic commercial/issued metadata is seeded.
-- Every receipt/correction below uses original real writers with triggers restored.
create temp table e04_manual_full_result(key text primary key,value jsonb);
grant select on e04_commercial_fixture to authenticated,service_role;
grant select,insert on e04_manual_full_result to authenticated,service_role;
do $$begin execute format('grant usage on schema %I to authenticated,service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated,service_role;
select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role authenticated;
select public.set_client_agreement_status((data->>'tenant_id')::uuid,(data#>>'{effective,commercial_terms_id}')::uuid,'active',null) from e04_commercial_fixture;
reset role;
do $proof$ declare f jsonb;i public.paige_invoices%rowtype;plan jsonb;command jsonb;governance jsonb;preview jsonb;result jsonb;reverse_command jsonb;
begin
 select data into strict f from e04_commercial_fixture;
 select * into strict i from public.paige_invoices where id=(f#>>'{effective,invoice_id}')::uuid;
 plan:=public._sales_invoice_accepted_obligations(i,(f#>>'{effective,signing_id}')::uuid);
 perform pg_temp.check_true(plan->>'state'='available' and jsonb_array_length(plan->'obligations')=11,'full-schema original accepted schedule is available');
 command:=jsonb_build_object('action','invoice.record_manual_payment','invoice_id',i.id,'expected_version',i.billing_lifecycle_version,'amount_cents',80000,'currency','usd','method','cash','received_at',now(),'reference',null,'notes',null,
 'allocations',jsonb_build_array(jsonb_build_object('obligation',plan#>'{obligations,0}','amount_cents',50000),jsonb_build_object('obligation',plan#>'{obligations,1}','amount_cents',30000)));
 governance:=jsonb_build_object('actor_user_id',f->'actor_id','tenant_id',f->'tenant_id','tool','sales_record_manual_payment','action','invoice.record_manual_payment','approval_channel','operator_card','decision_receipt_recorded',true,'approved_fingerprint','aaaaaaaaaaaaaaaa');
 preview:=public.preview_sales_invoice_command((f->>'actor_id')::uuid,i.tenant_id,command);
 perform pg_temp.check_true(preview->'eligible'='true'::jsonb and preview->'manual_allocations'=command->'allocations','full-schema native preview echoes the exact split');
 result:=public.execute_sales_invoice_command((f->>'actor_id')::uuid,i.tenant_id,'e4950000-0000-4000-8000-000000000001',command,governance);
 perform pg_temp.check_true(result->'ok'='true'::jsonb,'original full-schema manual receipt writer succeeds');
 perform pg_temp.check_true(public.execute_sales_invoice_command((f->>'actor_id')::uuid,i.tenant_id,'e4950000-0000-4000-8000-000000000001',command,governance)=result,'full-schema replay returns the original receipt');
 select * into strict i from public.paige_invoices where id=i.id;
 plan:=public._sales_invoice_accepted_obligations(i,(f#>>'{effective,signing_id}')::uuid);
 perform pg_temp.check_true(plan->>'state'='available' and plan#>'{obligations,0,remaining_minor}'='0'::jsonb and plan#>'{obligations,1,remaining_minor}'='0'::jsonb and plan#>'{obligations,2,remaining_minor}'='30000'::jsonb,'full-schema original remaining amounts reflect only exact assignments');
 perform pg_temp.check_true((select count(*)=1 from public.paige_workspace_events where tenant_id=i.tenant_id and source_id='e4950000-0000-4000-8000-000000000001' and capability_key='sales_record_manual_payment' and outcome='capability_succeeded'),'real Rail contains one original receipt event');
 insert into e04_manual_full_result values('receipt',result);
 insert into e04_manual_full_result values('command',command);
 reverse_command:=jsonb_build_object('action','invoice.reverse_manual_payment','invoice_id',i.id,'expected_version',i.billing_lifecycle_version,'payment_id','e4950000-0000-4000-8000-000000000001','reason','Synthetic full-schema original correction; no refund');
 governance:=governance||jsonb_build_object('tool','sales_reverse_manual_payment','action','invoice.reverse_manual_payment');
 result:=public.execute_sales_invoice_command((f->>'actor_id')::uuid,i.tenant_id,'e4950000-0000-4000-8000-000000000002',reverse_command,governance);
 perform pg_temp.check_true(result->'ok'='true'::jsonb,'original full-schema correction writer succeeds');
 select * into strict i from public.paige_invoices where id=i.id;
 plan:=public._sales_invoice_accepted_obligations(i,(f#>>'{effective,signing_id}')::uuid);
 perform pg_temp.check_true(plan->>'state'='available' and plan#>'{obligations,0,remaining_minor}'='50000'::jsonb and plan#>'{obligations,1,remaining_minor}'='30000'::jsonb,'full-schema correction restores only original assigned amounts');
 perform pg_temp.check_true((select count(*)=2 from public.paige_invoice_payments where tenant_id=i.tenant_id and invoice_id=i.id),'full-schema original receipt and full reversal are retained once');
 insert into e04_manual_full_result values('correction',result);
end $proof$;
set local role authenticated;
insert into e04_manual_full_result
select 'owner_read',public.read_sales_invoice_manual_allocations((data->>'tenant_id')::uuid,(data#>>'{effective,invoice_id}')::uuid,4,'e4950000-0000-4000-8000-000000000001') from e04_commercial_fixture;
select pg_temp.check_true((select value->>'state'='assigned' and value->>'reversal_payment_id'='e4950000-0000-4000-8000-000000000002' and value->'allocations'=(select value->'allocations' from e04_manual_full_result where key='command') from e04_manual_full_result where key='owner_read'),'authenticated-role original history retains exact assignments and correction');
reset role;
set local role authenticated;
select pg_temp.refused(format('select public.read_sales_invoice_manual_allocations(%L,%L,3,%L)',data->>'tenant_id',data#>>'{effective,invoice_id}','e4950000-0000-4000-8000-000000000001'),'40001','full-schema stale receipt version is refused') from e04_commercial_fixture;
select pg_temp.refused(format('select public.read_sales_invoice_manual_allocations(%L,%L,4,%L)','aaaaaaaa-0000-4000-8000-000000000002',data#>>'{effective,invoice_id}','e4950000-0000-4000-8000-000000000001'),'42501','full-schema foreign workspace is refused') from e04_commercial_fixture;
select set_config('request.jwt.claim.sub','e4960000-0000-4000-8000-000000000003',true);
select pg_temp.refused(format('select public.read_sales_invoice_manual_allocations(%L,%L,4,%L)',data->>'tenant_id',data#>>'{effective,invoice_id}','e4950000-0000-4000-8000-000000000001'),'42501','full-schema unrelated member cannot inspect owner financial evidence') from e04_commercial_fixture;
select set_config('request.jwt.claim.sub','e4960000-0000-4000-8000-000000000002',true);
select pg_temp.refused(format('select public.read_sales_invoice_manual_allocations(%L,%L,4,%L)',data->>'tenant_id',data#>>'{effective,invoice_id}','e4950000-0000-4000-8000-000000000001'),'42501','full-schema client cannot inspect owner financial evidence') from e04_commercial_fixture;
reset role;
savepoint owner_ban_negative;
update auth.users set banned_until=now()+interval '1 day' where id=(select (data->>'actor_id')::uuid from e04_commercial_fixture);
select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role authenticated;
select pg_temp.refused(format('select public.read_sales_invoice_manual_allocations(%L,%L,4,%L)',data->>'tenant_id',data#>>'{effective,invoice_id}','e4950000-0000-4000-8000-000000000001'),'42501','full-schema banned owner is refused by original admission') from e04_commercial_fixture;
reset role;
rollback to savepoint owner_ban_negative;
select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role authenticated;
select pg_temp.check_true((select public.read_sales_invoice_manual_allocations((data->>'tenant_id')::uuid,(data#>>'{effective,invoice_id}')::uuid,4,'e4950000-0000-4000-8000-000000000001')=(select value from e04_manual_full_result where key='owner_read') from e04_commercial_fixture),'negative rollback retains the same original receipt history');
reset role;
select jsonb_build_object('proof','E04_FULL_SCHEMA_MANUAL_RECEIPT','status','PASS','checks',16,'scope','Synthetic original commercial and issued metadata, actual native receipt/correction/Rail, DB authenticated-role read; no hosted Auth, actual signing, provider effect or customer acceptance') as evidence;
rollback;
