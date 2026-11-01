-- EXP04 original provider observation: rollback-only full-schema native proof.
-- Synthetic commercial/signing/issued metadata; actual allocation/context/CAS/Rail.
-- No hosted authentication, Stripe request, financial adjustment or customer acceptance.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
set local idle_in_transaction_session_timeout='10s';
\ir fixtures/exp04_provider_observation.sql
\if :{?e04_observation_work}
\ir fixtures/exp04_provider_observation_work.sql
\endif


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
   -- Native proof's reduced draft table has no lifecycle shape constraint.
   -- Retain the original economics with explicit SYNTHETIC issued metadata.
   -- This is neither a real issue action nor a payment; preserve native constraints.
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



-- Synthetic original signed/commercial/issued and dispatched metadata only.
-- Actual current native provider allocation/context/CAS/journal and DB roles.
-- No Stripe call, hosted Auth, real signing/payment, durable apply or acceptance.
create temp table e04_observation_checks(label text primary key);
create temp table e04_observation_state(key text primary key,value jsonb);
grant select on e04_commercial_fixture to authenticated,service_role;
grant select,insert on e04_observation_checks,e04_observation_state to authenticated,service_role;
do $$begin execute format('grant usage on schema %I to authenticated,service_role,anon',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
create function pg_temp.observation_check(_ok boolean,_label text) returns void language plpgsql as $$
begin perform pg_temp.check_true(_ok,_label);insert into e04_observation_checks values(_label);end $$;
create function pg_temp.observation_refused(_sql text,_code text,_label text) returns void language plpgsql as $$
begin perform pg_temp.refused(_sql,_code,_label);insert into e04_observation_checks values(_label);end $$;
grant execute on function pg_temp.observation_check(boolean,text),pg_temp.observation_refused(text,text,text),pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated,service_role,anon;
grant select,insert on e04_observation_checks to anon;
do $seed$declare f jsonb;i public.paige_invoices%rowtype;command jsonb;
begin
 select data into strict f from e04_commercial_fixture;
 select * into strict i from public.paige_invoices where id=(f#>>'{effective,invoice_id}')::uuid;
 insert into public.tenant_stripe_accounts(tenant_id,stripe_account_id,binding_version,provider_environment)
 values(i.tenant_id,'acct_e4observation',1,'test');
 command:=jsonb_build_object('action','invoice.payment_request','invoice_id',i.id,'client_id',i.contact_id,
  'expected_version',i.billing_lifecycle_version,'issued_snapshot_version',i.billing_issued_snapshot_version,
  'provider','stripe','merchant_account_id','acct_e4observation','merchant_binding_version',1,'environment','test',
  'amount_minor',80000,'currency','usd','purpose','partial');
 insert into public.paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,
  provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key,
  state,dispatch_claim_token,dispatch_started_at,provider_object_id)
 values('e4a10000-0000-4000-8000-000000000001',i.tenant_id,i.id,i.contact_id,(f->>'actor_id')::uuid,i.billing_lifecycle_version,i.billing_issued_snapshot_version,
  'stripe','acct_e4observation',1,'test',80000,'usd','partial',command,'aaaaaaaaaaaaaaaa',
  'sales-payment-e4a10000-0000-4000-8000-000000000001','dispatching','e4a10000-0000-4000-8000-000000000002',now()-interval '1 minute','cs_test_e4source');
 insert into e04_observation_state values('allocation_readback',jsonb_build_object('status','verified','provider','stripe','merchant_account_id','acct_e4observation',
  'environment','test','invoice_id',i.id,'client_id',i.contact_id,'invoice_version',i.billing_lifecycle_version,'issued_snapshot_version',i.billing_issued_snapshot_version,
  'amount_minor',80000,'currency','usd','provider_object_id','cs_test_e4source','provider_transaction_id','ch_e4source',
  'provider_settlement_id','txn_e4capture','provider_received_at',to_char((now()-interval '30 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'readback_reference','fixture-provider-capture'));
end $seed$;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select public.allocate_verified_sales_invoice_payment((data->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001',
 'e4a10000-0000-4000-8000-000000000002',(select value from e04_observation_state where key='allocation_readback')) from e04_commercial_fixture;
reset role;
insert into e04_observation_state select 'original_receipt',to_jsonb(p) from public.paige_invoice_payments p where provider_operation_id='e4a10000-0000-4000-8000-000000000001';
set local role service_role;
do $proof$declare f jsonb;i public.paige_invoices%rowtype;context jsonb;capture jsonb;snapshot jsonb;failed jsonb;one jsonb;two jsonb;three jsonb;replayed jsonb;before_count bigint;
begin
 select data into strict f from e04_commercial_fixture;
 context:=public.read_sales_invoice_provider_observation_context((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001');
 perform pg_temp.observation_check(context->>'observation_version'='0' and context#>>'{settlement,provider_transaction_id}'='ch_e4source'
  and context#>>'{settlement,provider_settlement_id}'='txn_e4capture' and context#>>'{settlement,amount_minor}'='80000','original full-schema allocation supplies exact initial context');
 insert into e04_observation_state values('original_capture',context->'dispatch'->'verified_readback');
 snapshot:=jsonb_build_object('state','observed','provider_transaction_id','ch_e4source','provider_settlement_id','txn_e4capture',
  'refunds',jsonb_build_array(jsonb_build_object('id','re_e4refund','amount_minor',10000,'currency','usd',
   'created_at',to_char((now()-interval '20 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'status','pending','balance_transaction',null,'failure_balance_transaction',null)),'disputes','[]'::jsonb);
 insert into e04_observation_state values('snapshot_a',snapshot);
 one:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',0,snapshot,'evt_first');
 perform pg_temp.observation_check(one->>'state'='observed' and one->>'effect'='provider_observation_only' and one->>'observation_version'='1'
  and one->'replayed'='false'::jsonb,'new original-operation observation advances CAS once without claiming payment');
 insert into e04_observation_state values('first',one);
 replayed:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',0,snapshot,'evt_retry');
 perform pg_temp.observation_check(replayed->>'observation_id'=one->>'observation_id' and replayed->'replayed'='true'::jsonb,'same original version and facts replay first receipt despite changed read reference');
 replayed:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',1,snapshot,'evt_same');
 perform pg_temp.observation_check(replayed->>'observation_id'=one->>'observation_id' and replayed->>'current_observation_version'='1','unchanged fresh provider facts create no second journal row or source version');
 failed:=jsonb_set(snapshot,'{refunds,0,status}','"failed"'::jsonb);
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,0,%L::jsonb,%L)',
  f->>'tenant_id','e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',failed,'evt_stale'),'40001','a changed provider result cannot commit through an older source version');
 two:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',1,failed,'evt_failed');
 perform pg_temp.observation_check(two->>'observation_version'='2' and two->>'observation_id'<>one->>'observation_id','a fresh changed source retains a distinct immutable observation');
 three:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',2,snapshot,'evt_aba');
 perform pg_temp.observation_check(three->>'observation_version'='3' and three->>'observation_id'<>one->>'observation_id','A-to-B-to-A evidence keeps its current source incarnation');
 replayed:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',0,snapshot,'evt_late_retry');
 perform pg_temp.observation_check(replayed->>'observation_id'=one->>'observation_id' and replayed->>'current_observation_version'='3'
  and replayed->'is_current'='false'::jsonb,'late receipt replay never replaces newer source history');
 perform pg_temp.observation_refused(format('select public.read_sales_invoice_provider_observation_context(%L,%L)',
  'aaaaaaaa-0000-4000-8000-000000000002','e4a10000-0000-4000-8000-000000000001'),'42501','service read cannot cross the original tenant');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,3,%L::jsonb,%L)',
  f->>'tenant_id','e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000099',snapshot,'evt_wrong_claim'),'42501','writer refuses a different original dispatch claim');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,3,%L::jsonb,%L)',
  f->>'tenant_id','e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',snapshot||'{"amount_due_minor":0}'::jsonb,'evt_invented_debt'),'22023','closed observation refuses caller-supplied debt');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,3,%L::jsonb,%L)',
  f->>'tenant_id','e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',jsonb_set(snapshot,'{provider_transaction_id}','"ch_other"'),'evt_other_charge'),'22023','original charge identity cannot be substituted');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,3,%L::jsonb,%L)',
  f->>'tenant_id','e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',jsonb_set(snapshot,'{refunds,0,metadata}','{"private":"excluded"}'),'evt_private'),'22023','native closed refund refuses raw provider metadata');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,3,%L::jsonb,%L)',
  f->>'tenant_id','e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',jsonb_set(snapshot,'{refunds,0,created_at}','"2099-01-01T00:00:00.000Z"'),'evt_future'),'22023','future provider chronology is refused');
end $proof$;
reset role;
select pg_temp.observation_check((select count(*)=1 and min(amount_cents)=80000 from public.paige_invoice_payments where tenant_id=(data->>'tenant_id')::uuid),
 'observations do not create another payment or financial allocation') from e04_commercial_fixture;
select pg_temp.observation_check((select to_jsonb(p)=(select value from e04_observation_state where key='original_receipt') from public.paige_invoice_payments p where provider_operation_id='e4a10000-0000-4000-8000-000000000001'),
 'the exact original provider receipt remains immutable');
select pg_temp.observation_check((select verified_readback=(select value from e04_observation_state where key='original_capture') from public.paige_invoice_provider_operations where id='e4a10000-0000-4000-8000-000000000001'),
 'the exact original captured settlement remains immutable');
select pg_temp.observation_check((select count(*)=3 from public.paige_invoice_operations where invoice_id=(data#>>'{effective,invoice_id}')::uuid and command->>'action'='invoice.provider_observation'),
 'only three distinct original source incarnations are retained') from e04_commercial_fixture;
select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role service_role;
select pg_temp.observation_refused(format('select public.read_sales_invoice_provider_observation_context(%L,%L)',data->>'tenant_id','e4a10000-0000-4000-8000-000000000001'),'42501','service role cannot impersonate an authenticated actor') from e04_commercial_fixture;
reset role;
set local role authenticated;
select pg_temp.observation_refused(format('select public.read_sales_invoice_provider_observation_context(%L,%L)',data->>'tenant_id','e4a10000-0000-4000-8000-000000000001'),'42501','ordinary authenticated actor cannot call private provider context') from e04_commercial_fixture;
reset role;
set local role anon;
select pg_temp.observation_refused('select public.read_sales_invoice_provider_observation_context(null,null)','42501','anonymous role cannot read private provider context');
reset role;

-- Deterministic interleaving port on the ORIGINAL private reader, isolated in
-- this transaction, restored before proof completion. Not a real-session race.
-- The actual original journal writer advances once before the reader selects.
select set_config('request.jwt.claim.sub','',true);
do $port$ declare original_definition text; instrumented text;
begin
 select pg_get_functiondef('public.read_sales_invoice_payment_dispatch(uuid,uuid)'::regprocedure) into strict original_definition;
 insert into e04_observation_state values('original_dispatch_definition',to_jsonb(original_definition));
 instrumented:=replace(original_definition,
  ' PERFORM public._sales_payment_operation_service();',
  $injection$ PERFORM public._sales_payment_operation_service();
 IF current_setting('test.e04_observation_advance',true)='once' THEN
  PERFORM set_config('test.e04_observation_advance','done',true);
  PERFORM public.record_sales_invoice_provider_observation(_expected_tenant_id,_operation_id,
   'e4a10000-0000-4000-8000-000000000002',3,
   jsonb_set((select value from e04_observation_state where key='snapshot_a'),'{refunds,0,status}','"failed"'::jsonb),
   'evt_context_interleaving');
 END IF;$injection$);
 if instrumented=original_definition then raise exception 'Interleaving port boundary changed';end if;
 execute instrumented;
end $port$;
set local role service_role;
select set_config('test.e04_observation_advance','once',true);
do $context$ declare f jsonb; context jsonb;
begin
 select data into strict f from e04_commercial_fixture;
 context:=public.read_sales_invoice_provider_observation_context((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001');
 perform pg_temp.observation_check(context->>'observation_version'='4'
  and context->'observation_version'=context#>'{dispatch,provider_observation_version}'
  and context->'observation_id'=context#>'{dispatch,provider_observation_operation_id}',
  'provider context retains a single original source incarnation');
end $context$;
reset role;
do $restore$ begin
 execute (select value#>>'{}' from e04_observation_state where key='original_dispatch_definition');
end $restore$;
select pg_temp.observation_check(
 pg_get_functiondef('public.read_sales_invoice_payment_dispatch(uuid,uuid)'::regprocedure)=
  (select value#>>'{}' from e04_observation_state where key='original_dispatch_definition')
 and (select md5(prosrc)='78ec4e48b972552bd505c5ea075bd574'
  and prosecdef and proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  from pg_proc where oid='public.read_sales_invoice_payment_dispatch(uuid,uuid)'::regprocedure),
 'controlled source port restores the exact original reader and authority');

-- Original 23 assertions remain unchanged above. New actual link/history/Rail controls.
select pg_temp.observation_refused(
 $$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version+1
 where id='e4a10000-0000-4000-8000-000000000001'$$,
 '42501','source counter cannot advance without its matching immutable observation');
select pg_temp.observation_refused(
 $$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version-1
 where id='e4a10000-0000-4000-8000-000000000001'$$,
 '42501','source counter cannot move backwards');
select pg_temp.observation_refused(
 $$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version+2
 where id='e4a10000-0000-4000-8000-000000000001'$$,
 '42501','source counter cannot skip a version');
select pg_temp.observation_refused(
 $$update public.paige_invoice_provider_operations set provider_observation_operation_id=null
 where id='e4a10000-0000-4000-8000-000000000001'$$,
 '42501','a retained observation pointer cannot be cleared');
select pg_temp.observation_refused(
 $$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version+1,
 provider_observation_operation_id=allocation_payment_id where id='e4a10000-0000-4000-8000-000000000001'$$,
 '55000','original payment receipt cannot masquerade as a new observation');

do $history$ declare op public.paige_invoice_provider_operations%rowtype; original public.paige_invoice_operations%rowtype;
 invalid jsonb; patch jsonb; check_label text;
begin
 select * into strict op from public.paige_invoice_provider_operations where id='e4a10000-0000-4000-8000-000000000001';
 select * into strict original from public.paige_invoice_operations where id=op.provider_observation_operation_id;
 for patch,check_label in select * from (values
  (jsonb_build_object('result',original.result||'{"state":"paid"}'::jsonb),'history cannot claim an observed payment was paid'),
  (jsonb_build_object('result',original.result||'{"source_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb),'history result must retain its exact source hash'),
  (jsonb_build_object('result',original.result||'{"invoice_version":9007199254740992}'::jsonb),'history cannot carry an unsafe invoice source version'),
  (jsonb_build_object('result',original.result-'rail_recorded'),'history cannot omit actual receipt acknowledgment'),
  (jsonb_build_object('command',original.command||'{"private_note":"not-retained"}'::jsonb),'closed history excludes private extra content'),
  (jsonb_build_object('actor_user_id','aaaaaaaa-0000-4000-8000-000000000099'),'history cannot substitute the original actor')
 ) t(value,label) loop
  invalid:=to_jsonb(original)||patch;
  perform pg_temp.observation_refused(format(
   'select public._sales_provider_observation_entry((select p from public.paige_invoice_provider_operations p where p.id=%L),jsonb_populate_record(null::public.paige_invoice_operations,%L::jsonb),%L,true)',
   op.id,invalid,op.provider_observation_version-1),'55000',check_label);
 end loop;
 perform pg_temp.observation_check((select count(*)=4 from public.paige_workspace_events where detail->>'effect'='provider_observation_only'),
  'each of four native observations has one original durable Rail receipt');
 insert into e04_observation_state values('guarded_before',jsonb_build_object('operation',to_jsonb(op),
  'invoice_version',(select billing_lifecycle_version from public.paige_invoices where id=op.invoice_id),
  'operations',(select count(*) from public.paige_invoice_operations),
  'rail',(select count(*) from public.paige_workspace_events)));
end $history$;

create function pg_temp.e04_fail_observation_rail() returns trigger language plpgsql as $$
begin
 if new.detail->>'effect'='provider_observation_only' then raise exception 'Controlled original Rail failure';end if;
 return new;
end $$;
create trigger e04_private_observation_rail_failure before insert on public.paige_workspace_events
 for each row execute function pg_temp.e04_fail_observation_rail();
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select pg_temp.observation_refused(format(
 'select public.record_sales_invoice_provider_observation(%L,%L,%L,4,%L::jsonb,%L)',data->>'tenant_id',
 'e4a10000-0000-4000-8000-000000000001','e4a10000-0000-4000-8000-000000000002',
 (select value from e04_observation_state where key='snapshot_a'),'evt_rail_failure'),
 'P0001','an original Rail failure refuses the observation') from e04_commercial_fixture;
reset role;
select pg_temp.observation_check(
 (select to_jsonb(p)=before.value->'operation' from public.paige_invoice_provider_operations p,e04_observation_state before
  where p.id='e4a10000-0000-4000-8000-000000000001' and before.key='guarded_before')
 and (select to_jsonb(billing_lifecycle_version)=before.value->'invoice_version' from public.paige_invoices i,e04_observation_state before
  where i.id=(before.value#>>'{operation,invoice_id}')::uuid and before.key='guarded_before')
 and (select to_jsonb(count(*))=(select value->'operations' from e04_observation_state where key='guarded_before') from public.paige_invoice_operations)
 and (select to_jsonb(count(*))=(select value->'rail' from e04_observation_state where key='guarded_before') from public.paige_workspace_events),
 'Rail failure rolls back the journal pointer source version invoice version and event');
drop trigger e04_private_observation_rail_failure on public.paige_workspace_events;

set local role service_role;
do $recorded$ declare f jsonb; result jsonb; retry jsonb;
begin
 select data into strict f from e04_commercial_fixture;
 result:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001',
  'e4a10000-0000-4000-8000-000000000002',4,(select value from e04_observation_state where key='snapshot_a'),'evt_after_rail_recovery');
 perform pg_temp.observation_check(result->>'observation_version'='5' and result->'rail_recorded'='true'::jsonb and result->'replayed'='false'::jsonb,
  'normal recovery records the original observation and actual Rail once');
 retry:=public.record_sales_invoice_provider_observation((f->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001',
  'e4a10000-0000-4000-8000-000000000002',4,(select value from e04_observation_state where key='snapshot_a'),'evt_same_observation_retry');
 perform pg_temp.observation_check(retry->'observation_id'=result->'observation_id' and retry->'replayed'='true'::jsonb,
  'retry returns the retained original observation receipt');
end $recorded$;
reset role;
select pg_temp.observation_check((select count(*)=5 and bool_and(actor_id is null and actor_agent_slug is null and capability_key='sales_payment_reconcile'
 and (select count(*) from jsonb_object_keys(detail))=4) from public.paige_workspace_events where detail->>'effect'='provider_observation_only'),
 'receipt retries do not duplicate events or fabricate owner or specialist activity');
select pg_temp.observation_check((select to_jsonb(p)=(select value from e04_observation_state where key='original_receipt')
 from public.paige_invoice_payments p where provider_operation_id='e4a10000-0000-4000-8000-000000000001'),
 'link and audit integrity never alter the original captured payment');
set local role authenticated;
select pg_temp.observation_refused('select public._sales_provider_observation_entry(null,null,0,true)','42501','ordinary role cannot validate private provider history directly');
reset role;
set local role anon;
select pg_temp.observation_refused('select public._sales_provider_observation_entry(null,null,0,true)','42501','anonymous role cannot inspect private provider history');
reset role;

select pg_temp.check_true((select count(*)=43 from e04_observation_checks),'all43 intended observation controls executed');
select jsonb_build_object('proof','E04_PROVIDER_CONTEXT_CAS_JOURNAL','status','PASS','checks',(select count(*) from e04_observation_checks),
 'scope','Synthetic original commercial/dispatch/provider-readback metadata, actual native allocation/context/CAS/journal and DB roles; actual observation Rail; no provider, hosted Auth, financial adjustment or customer acceptance') as evidence;

\if :{?e04_observation_work}
-- Establish the ORIGINAL terminal settlement work through its real writers.
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select public.register_sales_payment_reconciliation_work((data->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001') from e04_commercial_fixture;
select public.settle_sales_payment_reconciliation_work((data->>'tenant_id')::uuid,'e4a10000-0000-4000-8000-000000000001') from e04_commercial_fixture;
reset role;
select set_config('test.e04_work_operation','e4a10000-0000-4000-8000-000000000001',true);
select set_config('test.e04_work_tenant',(data->>'tenant_id'),true) from e04_commercial_fixture;
select set_config('test.e04_work_merchant','acct_e4observation',true);
select set_config('test.e04_work_charge','ch_e4source',true);
select set_config('test.e04_work_settlement','txn_e4capture',true);
\ir fixtures/exp04_provider_observation_work_checks.sql
\endif
rollback;
