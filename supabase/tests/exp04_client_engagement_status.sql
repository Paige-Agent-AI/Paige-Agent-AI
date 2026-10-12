-- Experience 04 · E4-S1 "Where this client stands" — full-schema rollback proof.
-- Synthetic tenants, people and money only; everything rolls back. Run against a disposable
-- database that has every migration applied (CI: paige-spine-contract › database-contract).
--
-- Fixture rows that only the governed Sales writers can normally create (issued invoices,
-- provider-verified receipts, provider operations) are inserted with session_replication_role
-- = replica so the writer guards do not refuse a fixture. The READ under test runs afterwards
-- with every trigger and policy restored, as a real authenticated caller. No writer is proven
-- here; the writers keep their own proofs. The ledger's SHAPE is still writer-legal: the invoice
-- bound to the terms is checked against the Sales writer's own terms validator below.
begin;
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then if sqlstate=code then raise notice 'PASS: %',label; return; end if;
raise exception 'FAIL: % unexpected %: %',label,sqlstate,sqlerrm; end; raise exception 'FAIL: % accepted',label; end $$;

-- Tenants: A (the business), B (a foreign business).
insert into auth.users(id,aud,role,email) values
 ('e4000000-0000-4000-8000-000000000001','authenticated','authenticated','e4-owner@tests.invalid'),
 ('e4000000-0000-4000-8000-000000000002','authenticated','authenticated','e4-admin@tests.invalid'),
 ('e4000000-0000-4000-8000-000000000003','authenticated','authenticated','e4-member@tests.invalid'),
 ('e4000000-0000-4000-8000-000000000004','authenticated','authenticated','e4-foreign-owner@tests.invalid'),
 ('e4000000-0000-4000-8000-000000000005','authenticated','authenticated','e4-portal-client@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('e4000000-0000-4000-8000-00000000aaaa','test-exp04-status-a','Test Status A','active','standalone','ESA',9940401,'{}'),
 ('e4000000-0000-4000-8000-00000000bbbb','test-exp04-status-b','Test Status B','active','standalone','ESB',9940402,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000002','admin','active',false,now()),
 ('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000003','member','active',false,now()),
 ('e4000000-0000-4000-8000-00000000bbbb','e4000000-0000-4000-8000-000000000004','owner','active',true,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-00000000aaaa'),
 ('e4000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-00000000aaaa'),
 ('e4000000-0000-4000-8000-000000000003','e4000000-0000-4000-8000-00000000aaaa'),
 ('e4000000-0000-4000-8000-000000000004','e4000000-0000-4000-8000-00000000bbbb'),
 -- A client portal user is never a member, so no active workspace can be pointed at A.
 ('e4000000-0000-4000-8000-000000000005',null)
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
-- The admin's personal profile says Tokyo. It must never become the business's zone: only the owner's
-- configured business time zone counts (owner ruling 2026-10-12; independent review of #2085).
update public.profiles set coach_timezone='Asia/Tokyo' where user_id='e4000000-0000-4000-8000-000000000002';

insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number) values
 ('e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','Test','Consulting Client','ESA-C1'),
 ('e4000000-0000-4000-8000-0000000c0002','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','Test','Empty Client','ESA-C2'),
 ('e4000000-0000-4000-8000-0000000c00b1','e4000000-0000-4000-8000-00000000bbbb','e4000000-0000-4000-8000-000000000004','Test','Foreign Client','ESB-C1');
insert into public.tenant_products(id,tenant_id,name,status,product_type,created_by) values
 ('e4000000-0000-4000-8000-0000000f0001','e4000000-0000-4000-8000-00000000aaaa','Test consulting engagement','active','service','e4000000-0000-4000-8000-000000000001');

-- The owner's sentence, as recorded terms: $3,500 total, $500 at signing, 10 x $300 monthly.
-- Dates are relative to today so the proof is stable on any run date:
--   deposit due today-40 (due), month 1 due today-10 (due), months 2..10 in the future.
-- Due to date = 50000 + 30000 = 80000.
create temp table fx(d0 date, m1 date, m2 date);
insert into fx select current_date-40, current_date-10, current_date+20;
insert into public.tenant_client_agreements(id,tenant_id,contact_id,offer_id,title,term_kind,price_basis,agreed_amount_minor,agreed_currency,starts_on,status,created_by,collection_terms,collection_terms_version)
select 'e4000000-0000-4000-8000-0000000d0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-0000000f0001',
 'Test consulting engagement','deposit','negotiated',350000,'usd',fx.d0,'active','e4000000-0000-4000-8000-000000000001',
 jsonb_build_object('schema_version',1,'kind','custom','currency','usd','total_cents',350000,'anchor_date',fx.d0,'cadence','custom','count',11,'end_date',null,
  'dates',jsonb_build_array(jsonb_build_object('due_date',fx.d0,'amount_cents',50000,'label','Deposit'))
   ||(select jsonb_agg(jsonb_build_object('due_date',(fx.m1+make_interval(months=>n))::date,'amount_cents',30000,'label',null) order by n) from generate_series(0,9) n),
  'deposit_cents',null,'late_fee',jsonb_build_object('fixed_cents',0,'rate_bps',0,'grace_days',0,'agreement_basis',null),
  'interest',jsonb_build_object('annual_bps',0,'agreement_basis',null)),1
from fx;
insert into public.paige_agreements(id,tenant_id,contact_id,offer_id,commercial_terms_id,title,body_markdown,status,version,content_sha256,sealed_sha256,sealed_storage_key,sent_at,completed_at,created_by) values
 ('e4000000-0000-4000-8000-0000000a0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-0000000f0001','e4000000-0000-4000-8000-0000000d0001',
  'Test consulting agreement','PRIVATE_SOURCE_BODY','completed',1,repeat('a',64),repeat('b',64),'PRIVATE_SOURCE_KEY',now()-interval '45 days',now()-interval '41 days','e4000000-0000-4000-8000-000000000001');

-- Fixture ledger. The shapes are the ones the governed Sales writer produces: an invoice bound to the
-- terms carries the WHOLE agreed amount ($3,500) with the deposit as its amount due now — the writer
-- refuses an installment-sized invoice that names the terms (asserted below through its own
-- validator). Insertion still bypasses writer triggers (session_replication_role) because the
-- provider-verified receipts need settled provider operations the proof cannot dispatch.
set local session_replication_role=replica;
insert into public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,
 billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request,billing_lifecycle_version,billing_issued_snapshot_version,
 billing_issued_at,billing_issued_by,billing_document,billing_document_digest,created_at)
select 'e4000000-0000-4000-8000-0000000e0001'::uuid,'e4000000-0000-4000-8000-00000000aaaa'::uuid,'e4000000-0000-4000-8000-0000000c0001'::uuid,'E4-0001','issued',350000,'usd',fx.d0,
 1,jsonb_build_object('commercial_terms_reference',jsonb_build_object('id','e4000000-0000-4000-8000-0000000d0001','version',1),
   'kind','deposit','total_minor',350000,'currency','usd','due_now_minor',50000,'due_date',fx.d0,
   'price_snapshot',jsonb_build_object('product_id','e4000000-0000-4000-8000-0000000f0001')),
 gen_random_uuid(),'{}'::jsonb,2,1,now()-interval '41 days','e4000000-0000-4000-8000-000000000001'::uuid,'{}'::jsonb,repeat('c',64),now()-interval '41 days'
from fx
union all
-- An add-on invoice outside the terms (a workshop billed separately), past due.
select 'e4000000-0000-4000-8000-0000000e0002','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001','E4-0002','issued',12000,'usd',fx.m1,
 1,'{}'::jsonb,gen_random_uuid(),'{}'::jsonb,2,1,now()-interval '15 days','e4000000-0000-4000-8000-000000000001','{}'::jsonb,repeat('e',64),now()-interval '15 days'
from fx;
-- A draft and a void invoice must never count as billed.
insert into public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,created_at) values
 ('e4000000-0000-4000-8000-0000000e0003','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001','E4-0003','draft',99900,'usd',now()-interval '1 day');
insert into public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,
 billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request,billing_lifecycle_version,billing_issued_snapshot_version,
 billing_issued_at,billing_issued_by,billing_document,billing_document_digest,created_at) values
 ('e4000000-0000-4000-8000-0000000e0004','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001','E4-0004','void',77700,'usd',
  1,'{}'::jsonb,gen_random_uuid(),'{}'::jsonb,2,1,now()-interval '20 days','e4000000-0000-4000-8000-000000000001','{}'::jsonb,repeat('d',64),now()-interval '20 days');
-- A foreign tenant's invoice for its own client: must never appear for tenant A.
insert into public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,created_at) values
 ('e4000000-0000-4000-8000-0000000e00b1','e4000000-0000-4000-8000-00000000bbbb','e4000000-0000-4000-8000-0000000c00b1','E4-B001','draft',55500,'usd',now());

-- Provider operations on the contract invoice: one settled LIVE (verified), one settled TEST, one LIVE
-- awaiting the client (the one in-flight request an invoice may have), one failed. On the add-on:
-- one LIVE with an unknown outcome.
insert into public.paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key,state,dispatch_claim_token,dispatch_started_at,provider_object_id,provider_status,verified_readback,settled_at,allocation_payment_id) values
 ('e4000000-0000-4000-8000-000000060001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-000000000001',2,1,'stripe','acct_test_fixture',1,'live',10000,'usd','installment','{}','0123456789abcdef','e4-fixture-k1','settled',gen_random_uuid(),now(),'cs_fixture_1','complete','{}',now(),'e4000000-0000-4000-8000-000000070002'),
 ('e4000000-0000-4000-8000-000000060002','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-000000000001',2,1,'stripe','acct_test_fixture',1,'test',30000,'usd','installment','{}','0123456789abcdef','e4-fixture-k2','settled',gen_random_uuid(),now(),'cs_fixture_2','complete','{}',now(),'e4000000-0000-4000-8000-000000070003'),
 ('e4000000-0000-4000-8000-000000060003','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000e0002','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-000000000001',2,1,'stripe','acct_test_fixture',1,'live',12000,'usd','full','{}','0123456789abcdef','e4-fixture-k3','outcome_unknown',gen_random_uuid(),now(),null,'unknown',null,null,null),
 ('e4000000-0000-4000-8000-000000060004','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-000000000001',2,1,'stripe','acct_test_fixture',1,'live',20000,'usd','installment','{}','0123456789abcdef','e4-fixture-k4','customer_action_required',gen_random_uuid(),now(),'cs_fixture_4','open',null,null,null),
 ('e4000000-0000-4000-8000-000000060005','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-0000000c0001','e4000000-0000-4000-8000-000000000001',2,1,'stripe','acct_test_fixture',1,'live',30000,'usd','installment','{}','0123456789abcdef','e4-fixture-k5','failed',gen_random_uuid(),now(),null,'failed',null,null,null);
-- Receipts on the contract invoice: the $500 deposit recorded by the owner by hand; $100 LIVE verified;
-- $300 TEST; a $50 hand-recorded receipt that the owner later reversed (net zero).
insert into public.paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at,evidence_kind,provider_operation_id,provider,merchant_account_id,provider_environment,provider_transaction_id,provider_settlement_id,provider_verified_at,reverses_payment_id,reason) values
 ('e4000000-0000-4000-8000-000000070001','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','receipt',50000,'usd','zelle',now()-interval '39 days','manual_recorded',null,null,null,null,null,null,null,null,null),
 ('e4000000-0000-4000-8000-000000070002','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','receipt',10000,'usd','stripe',now()-interval '5 days','provider_verified','e4000000-0000-4000-8000-000000060001','stripe','acct_test_fixture','live','pi_fixture_1','ch_fixture_1',now()-interval '5 days',null,null),
 ('e4000000-0000-4000-8000-000000070003','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','receipt',30000,'usd','stripe',now()-interval '2 days','provider_verified','e4000000-0000-4000-8000-000000060002','stripe','acct_test_fixture','test','pi_fixture_2','ch_fixture_2',now()-interval '2 days',null,null),
 ('e4000000-0000-4000-8000-000000070004','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','receipt',5000,'usd','cash',now()-interval '4 days','manual_recorded',null,null,null,null,null,null,null,null,null),
 ('e4000000-0000-4000-8000-000000070005','e4000000-0000-4000-8000-0000000e0001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','reversal',5000,'usd','cash',now()-interval '3 days','manual_recorded',null,null,null,null,null,null,null,'e4000000-0000-4000-8000-000000070004','Entered in error');
set local session_replication_role=origin;

-- Writer legality: the bound fixture invoice passes the governed writer's own terms validator, and the
-- installment-sized shape an earlier fixture used is refused by it.
select pg_temp.check_true((select public._sales_validate_invoice_terms_reference(i.tenant_id,i.contact_id,i.billing_draft->'commercial_terms_reference',i.billing_draft)->>'id'='e4000000-0000-4000-8000-0000000d0001'
 from public.paige_invoices i where i.id='e4000000-0000-4000-8000-0000000e0001'),'bound fixture invoice is one the Sales writer accepts');
select pg_temp.refused($s$select public._sales_validate_invoice_terms_reference('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',
 '{"id":"e4000000-0000-4000-8000-0000000d0001","version":1}'::jsonb,'{"total_minor":30000,"currency":"usd","price_snapshot":{"product_id":"e4000000-0000-4000-8000-0000000f0001"}}'::jsonb)$s$,'22023','an installment-sized invoice cannot name the terms');

-- Delivery work: one done milestone, one overdue task, one future milestone, one personal reminder.
insert into public.plans(id,tenant_id,created_by,owner_user_id,scope,horizon,title,status,starts_on,ends_on) values
 ('e4000000-0000-4000-8000-000000080001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','team','custom','Test consulting delivery','active',current_date-40,current_date+300);
insert into public.plan_items(id,tenant_id,plan_id,item_type,created_by,assigned_to_user_id,contact_id,title,status,due_at,completed_at,remind_at) values
 ('e4000000-0000-4000-8000-000000090001','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000080001','milestone','e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-0000000c0001','Kickoff workshop','done',now()-interval '30 days',now()-interval '29 days',null),
 ('e4000000-0000-4000-8000-000000090002','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000080001','task','e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-0000000c0001','Draft discovery report','in_progress',now()-interval '2 days',null,null),
 ('e4000000-0000-4000-8000-000000090003','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000080001','milestone','e4000000-0000-4000-8000-000000000001',null,'e4000000-0000-4000-8000-0000000c0001','Strategy review','open',now()+interval '14 days',null,null),
 ('e4000000-0000-4000-8000-000000090004','e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-000000080001','reminder','e4000000-0000-4000-8000-000000000001',null,'e4000000-0000-4000-8000-0000000c0001','Personal nudge','open',now()-interval '1 day',null,now()-interval '1 day');

-- Grants: authenticated callers only; never anon, never the service role.
select pg_temp.check_true(has_function_privilege('authenticated','public.read_client_engagement_status(uuid,uuid)','EXECUTE'),'authenticated may call the read');
select pg_temp.check_true(not has_function_privilege('anon','public.read_client_engagement_status(uuid,uuid)','EXECUTE'),'anon may not call the read');
select pg_temp.check_true(not has_function_privilege('service_role','public.read_client_engagement_status(uuid,uuid)','EXECUTE'),'service role may not call the read');
select pg_temp.check_true((select prosecdef and proconfig::text like '%search_path=pg_catalog, public%' from pg_proc where oid='public.read_client_engagement_status(uuid,uuid)'::regprocedure),'definer with pinned search_path');

do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
grant select on fx to authenticated;
create temp table status_result(value jsonb);
grant insert,select on status_result to authenticated;

-- ── Negative scope: every one refused with 42501 (or 22023 for a missing argument). ──
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001')$s$,'42501','staff member (not owner/admin) refused');
reset role;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001')$s$,'42501','non-member (client portal user) refused');
reset role;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001')$s$,'42501','foreign owner naming tenant A refused');
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000bbbb','e4000000-0000-4000-8000-0000000c0001')$s$,'42501','foreign owner reading tenant A client through own workspace refused');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001')$s$,'42501','anonymous refused');
reset role;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c00b1')$s$,'42501','owner naming a foreign tenant''s client refused');
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000bbbb','e4000000-0000-4000-8000-0000000c00b1')$s$,'42501','owner naming another workspace refused');
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa',null)$s$,'22023','missing client refused');

-- ── The business time zone: only the active owner may set it, and only to a regional IANA zone. ──
select pg_temp.check_true(not has_table_privilege('authenticated','public.tenant_business_time_zones','SELECT') and not has_table_privilege('authenticated','public.tenant_business_time_zones','INSERT') and not has_table_privilege('authenticated','public.tenant_business_time_zones','UPDATE'),'no direct access to the business time zone table');
select pg_temp.check_true(has_function_privilege('authenticated','public.set_business_time_zone(uuid,text)','EXECUTE') and not has_function_privilege('anon','public.set_business_time_zone(uuid,text)','EXECUTE') and not has_function_privilege('service_role','public.set_business_time_zone(uuid,text)','EXECUTE'),'only signed-in callers may call the time zone writer');
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Mars/Olympus_Mons')$s$,'22023','unknown zone refused');
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','EST')$s$,'22023','abbreviation refused');
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','EST5EDT')$s$,'22023','legacy rule zone refused');
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Etc/GMT+5')$s$,'22023','fixed-offset zone refused');
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000bbbb','America/Chicago')$s$,'42501','owner naming another workspace refused');
-- The foreign business keeps its own zone; tenant A's read must never pick it up.
reset role;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select public.set_business_time_zone('e4000000-0000-4000-8000-00000000bbbb','Asia/Tokyo');
reset role;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','America/New_York');
-- ── Positive read as the owner. ──
insert into status_result select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001');
reset role;

-- Source parity: every figure equals an independent aggregate over the canonical tables.
select pg_temp.check_true((select value->>'tenant_id'='e4000000-0000-4000-8000-00000000aaaa' and value->>'contact_id'='e4000000-0000-4000-8000-0000000c0001' from status_result),'scoped to the requested client');
select pg_temp.check_true((select jsonb_array_length(value->'terms')=1 and value#>>'{terms,0,status}'='active' and (value#>>'{terms,0,agreed_amount_minor}')::bigint=350000 from status_result),'terms: the one agreed $3,500 record');
select pg_temp.check_true((select jsonb_array_length(value#>'{terms,0,collection_terms,dates}')=11 from status_result),'terms: 11 dated obligations carried unchanged');
select pg_temp.check_true((select jsonb_array_length(value->'signings')=1 and value#>>'{signings,0,status}'='completed' and (value#>>'{signings,0,sealed}')::boolean and value#>>'{signings,0,commercial_terms_id}'='e4000000-0000-4000-8000-0000000d0001' from status_result),'signing: sealed and bound to the terms');
select pg_temp.check_true((select value::text !~ 'PRIVATE_SOURCE_BODY|PRIVATE_SOURCE_KEY' from status_result),'signing body and storage key never leave the database');
select pg_temp.check_true((select jsonb_array_length(value->'invoices')=4 from status_result),'all four of the client''s invoices, none of the foreign tenant''s');
select pg_temp.check_true((select value::text !~ 'E4-B001' from status_result),'foreign invoice absent');
-- Balance parity per invoice against the ledger itself (independent of _sales_invoice_balance_rows).
select pg_temp.check_true((
 select bool_and(
   (r->>'manual_recorded_minor')::bigint = coalesce((select sum(case when kind='receipt' then amount_cents else -amount_cents end) from public.paige_invoice_payments p where p.invoice_id=(r->>'id')::uuid and p.evidence_kind='manual_recorded'),0)
   and (r->>'provider_verified_live_minor')::bigint = coalesce((select sum(amount_cents) from public.paige_invoice_payments p where p.invoice_id=(r->>'id')::uuid and p.evidence_kind='provider_verified' and p.provider_environment='live'),0)
   and (r->>'provider_verified_test_minor')::bigint = coalesce((select sum(amount_cents) from public.paige_invoice_payments p where p.invoice_id=(r->>'id')::uuid and p.evidence_kind='provider_verified' and p.provider_environment='test'),0)
   and (r->>'amount_minor')::bigint = (select amount_total_cents from public.paige_invoices i where i.id=(r->>'id')::uuid))
 from status_result, jsonb_array_elements(value->'invoices') r),'every invoice balance matches the ledger by evidence class');
select pg_temp.check_true((select (r->>'manual_recorded_minor')::bigint=50000 and (r->>'reversal_count')::int=1 from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0001'),'reversed hand receipt nets to zero and is counted');
select pg_temp.check_true((select (r->>'provider_verified_test_minor')::bigint=30000 and (r->>'provider_verified_live_minor')::bigint=10000 from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0001'),'test-environment money is reported apart from live');
select pg_temp.check_true((select jsonb_array_length(r->'open_payment_requests')=1 and r#>>'{open_payment_requests,0,state}'='outcome_unknown' from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0002'),'unknown provider outcome surfaced, never as a receipt');
select pg_temp.check_true((select jsonb_array_length(r->'open_payment_requests')=1 and r#>>'{open_payment_requests,0,state}'='customer_action_required' from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0001'),'payment awaiting the client surfaced as in flight');
select pg_temp.check_true((select (r->>'failed_payment_requests')::int=1 from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0001'),'failed payment request counted');
select pg_temp.check_true((select r->'commercial_terms_reference'->>'id'='e4000000-0000-4000-8000-0000000d0001' from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0001'),'invoice keeps its reference to the agreed terms');
select pg_temp.check_true((select r->'commercial_terms_reference' = 'null'::jsonb from status_result, jsonb_array_elements(value->'invoices') r where r->>'invoice_number'='E4-0002'),'invoice outside the terms is not bound to them');
-- Work parity.
select pg_temp.check_true((select (value#>>'{work,total}')::int=3 and (value#>>'{work,done}')::int=1 and (value#>>'{work,open}')::int=2 and (value#>>'{work,overdue}')::int=1 from status_result),'work: 3 items (reminder excluded), 1 done, 2 open, 1 overdue');
select pg_temp.check_true((select (value#>>'{work,total}')::int=(select count(*) from public.plan_items where contact_id='e4000000-0000-4000-8000-0000000c0001' and item_type in ('milestone','task')) from status_result),'work total equals the canonical item count');
select pg_temp.check_true((select value->'not_recorded' ? 'payment_disputes' and value->'not_recorded' ? 'terms_effective_transition' from status_result),'unrecorded facts are declared, not zeroed');
-- Time zone: the owner's configured zone, and the owner-local calendar date of the read.
select pg_temp.check_true((select value->'business_time_zone'='{"state":"configured","zone":"America/New_York"}'::jsonb from status_result),'business time zone is the owner''s configured zone');
select pg_temp.check_true((select (value->>'as_of_date')::date=((value->>'read_at')::timestamptz at time zone 'America/New_York')::date from status_result),'as-of date is the owner-local date of the read, not the UTC date');
-- The read writes exactly one capability receipt and nothing else.
select pg_temp.check_true((select count(*)=1 from public.paige_workspace_events where tenant_id='e4000000-0000-4000-8000-00000000aaaa' and source_kind='capability_run' and source_id=(select (value->>'receipt_id')::uuid from status_result)),'one capability receipt recorded');
select pg_temp.check_true((select count(*)=0 from public.paige_workspace_events e,status_result s where e.source_id=(s.value->>'receipt_id')::uuid and e::text ~ 'Consulting Client|350000'),'receipt carries no client name or amount');

-- An admin of the same workspace may read; a client with no records reads as empty, never as an error.
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((select jsonb_array_length(public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0002')->'invoices')=0),'admin reads an empty client as empty');
-- The admin in Tokyo sees the business's New York zone, not their own.
select pg_temp.check_true((select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0002')->'business_time_zone'->>'zone'='America/New_York'),'a viewer in another zone gets the owner''s zone');
-- An admin cannot set or clear the business's zone.
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Asia/Tokyo')$s$,'42501','admin cannot set the business time zone');
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa',null)$s$,'42501','admin cannot clear the business time zone');
reset role;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Asia/Tokyo')$s$,'42501','staff member cannot set the business time zone');
reset role;
-- An owner who is no longer active cannot set it either.
update public.tenant_members set status='suspended' where tenant_id='e4000000-0000-4000-8000-00000000aaaa' and user_id='e4000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused($s$select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Asia/Tokyo')$s$,'42501','an owner who is not active cannot set the business time zone');
reset role;
update public.tenant_members set status='active' where tenant_id='e4000000-0000-4000-8000-00000000aaaa' and user_id='e4000000-0000-4000-8000-000000000001';
select pg_temp.check_true((select time_zone='America/New_York' from public.tenant_business_time_zones where tenant_id='e4000000-0000-4000-8000-00000000aaaa'),'refused writers changed nothing');

-- A missing zone is reported and no owner-local date is given; the owner can clear and re-set it.
create temp table zone_probe(label text,value jsonb);
grant insert,select on zone_probe to authenticated;
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa',null);
insert into zone_probe select 'missing',public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0002');
-- Two configured zones whose dates straddle UTC's (UTC+14 and UTC-11): at any hour of any day at
-- least one of them is on a different calendar date from UTC, so a UTC fallback cannot pass both.
select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Pacific/Kiritimati');
insert into zone_probe select 'far_east',public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0002');
select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','Pacific/Pago_Pago');
insert into zone_probe select 'far_west',public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0002');
select public.set_business_time_zone('e4000000-0000-4000-8000-00000000aaaa','America/New_York');
reset role;
select pg_temp.check_true((select value->'business_time_zone'='{"state":"missing","zone":null}'::jsonb and value->'as_of_date'='null'::jsonb from zone_probe where label='missing'),'a missing business zone withholds the owner-local date');
select pg_temp.check_true((select bool_and((value->>'as_of_date')::date=((value->>'read_at')::timestamptz at time zone (value->'business_time_zone'->>'zone'))::date) from zone_probe where label in ('far_east','far_west')),'as-of date follows the owner zone at both ends of the clock');
select pg_temp.check_true((select bool_or((value->>'as_of_date')::date<>((value->>'read_at')::timestamptz at time zone 'UTC')::date) from zone_probe where label in ('far_east','far_west')),'the zone probes really differ from UTC (the check above can fail)');
select pg_temp.check_true((select count(*)>=4 from public.paige_workspace_events where tenant_id='e4000000-0000-4000-8000-00000000aaaa' and source_kind='capability_run' and capability_key='set_business_time_zone'),'every time zone change leaves a receipt');

-- A workspace switch is honoured at read time: the owner, also a member of B, switches to B and
-- can no longer read A's client. (Fixture: the invite trigger would park a direct insert as
-- 'pending', so the active second membership is written with writer guards bypassed.)
set local session_replication_role=replica;
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('e4000000-0000-4000-8000-00000000bbbb','e4000000-0000-4000-8000-000000000001','member','active',false,now());
set local session_replication_role=origin;
update public.profiles set active_tenant_id='e4000000-0000-4000-8000-00000000bbbb' where user_id='e4000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.refused($s$select public.read_client_engagement_status('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001')$s$,'42501','stale workspace after switch refused');
reset role;

-- Emit the owner's read for the composer parity check (scripts/proof/exp04-client-status-parity.mjs).
select 'E4_STATUS_JSON:'||value::text from status_result;
rollback;
