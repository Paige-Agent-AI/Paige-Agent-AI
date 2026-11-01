-- Selected-schema proof extension of the ORIGINAL Sales provider SQL runner.
-- __OPERATION__, __TOKEN__, __TENANT__ are runner-owned synthetic UUIDs.
-- No hosted Auth, real Stripe, financial adjustment, or customer acceptance.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
create temp table e04_observation_checks(label text primary key);
create temp table e04_observation_state(key text primary key,value jsonb);
grant select,insert on e04_observation_checks,e04_observation_state to authenticated,service_role,anon;
do $$begin execute format('grant usage on schema %I to authenticated,service_role,anon',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
create function pg_temp.observation_check(_ok boolean,_label text) returns void language plpgsql as $$
begin if _ok is distinct from true then raise exception 'FAIL: %',_label;end if;
 insert into e04_observation_checks values(_label);raise notice 'PASS: %',_label;end $$;
create function pg_temp.observation_refused(_sql text,_code text,_label text) returns void language plpgsql as $$
begin begin execute _sql;exception when others then
 if sqlstate=_code then perform pg_temp.observation_check(true,_label);return;end if;
 raise exception 'FAIL: % unexpected %: %',_label,sqlstate,sqlerrm;end;
 raise exception 'FAIL: % accepted',_label;end $$;
grant execute on function pg_temp.observation_check(boolean,text),pg_temp.observation_refused(text,text,text) to authenticated,service_role,anon;

insert into e04_observation_state select 'original_operation',to_jsonb(p) from public.paige_invoice_provider_operations p where id='__OPERATION__';
insert into e04_observation_state select 'original_receipt',to_jsonb(p) from public.paige_invoice_payments p where provider_operation_id='__OPERATION__';
insert into e04_observation_state select 'original_balance',to_jsonb(b) from public._sales_invoice_balance_rows('__TENANT__',(select invoice_id from public.paige_invoice_provider_operations where id='__OPERATION__')) b;
select set_config('test.actor','',true);
set local role service_role;
do $initial$declare context jsonb;snapshot jsonb;one jsonb;two jsonb;three jsonb;again jsonb;failed jsonb;
begin
 context:=public.read_sales_invoice_provider_observation_context('__TENANT__','__OPERATION__');
 perform pg_temp.observation_check(context->>'observation_version'='0' and context->'observation_id'='null'::jsonb,'original captured payment begins with no later observation');
 perform pg_temp.observation_check(context#>>'{settlement,provider_transaction_id}'='ch_fixture' and context#>>'{settlement,provider_settlement_id}'='txn_fixture'
  and context#>>'{settlement,amount_minor}'='50000','context keeps the exact original receipt and capture');
 snapshot:=jsonb_build_object('state','observed','provider_transaction_id','ch_fixture','provider_settlement_id','txn_fixture',
  'refunds',jsonb_build_array(jsonb_build_object('id','re_observation','amount_minor',10000,'currency','usd',
   'created_at',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'status','pending','balance_transaction',null,'failure_balance_transaction',null)),'disputes','[]'::jsonb);
 insert into e04_observation_state values('snapshot_a',snapshot);
 one:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',0,snapshot,'evt_first');
 perform pg_temp.observation_check(one->>'state'='observed' and one->>'effect'='provider_observation_only' and one->>'observation_version'='1'
  and one->'replayed'='false'::jsonb,'new provider facts create one original observation without claiming payment');
 again:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',0,snapshot,'evt_retry');
 perform pg_temp.observation_check(again->>'observation_id'=one->>'observation_id' and again->'replayed'='true'::jsonb,'same original version and facts replay the retained observation');
 again:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',1,snapshot,'evt_same');
 perform pg_temp.observation_check(again->>'observation_id'=one->>'observation_id' and again->>'current_observation_version'='1','unchanged provider facts do not create another journal row');
 failed:=jsonb_set(snapshot,'{refunds,0,status}','"failed"'::jsonb);
 insert into e04_observation_state values('snapshot_b',failed);
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,0,%L::jsonb,%L)',
  '__TENANT__','__OPERATION__','__TOKEN__',failed,'evt_stale'),'40001','changed provider facts cannot commit through a stale source version');
 two:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',1,failed,'evt_failed');
 perform pg_temp.observation_check(two->>'observation_version'='2' and two->>'observation_id'<>one->>'observation_id','changed provider facts retain a distinct immutable observation');
 three:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',2,snapshot,'evt_aba');
 perform pg_temp.observation_check(three->>'observation_version'='3' and three->>'observation_id'<>one->>'observation_id','returning facts retain a new source incarnation rather than an old replay');
 context:=public.read_sales_invoice_provider_observation_context('__TENANT__','__OPERATION__');
 perform pg_temp.observation_check(context->>'observation_version'='3' and context->>'observation_id'=three->>'observation_id'
  and context#>>'{settlement,provider_transaction_id}'='ch_fixture','fresh context joins the current observation with the original payment');
end $initial$;
reset role;

-- This first control is the causal RED on the earlier unguarded journal.
select pg_temp.observation_refused($$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version+1 where id='__OPERATION__'$$,
 '42501','source counter cannot advance without a matching immutable observation');
select pg_temp.observation_refused($$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version-1 where id='__OPERATION__'$$,
 '42501','source counter cannot move backwards');
select pg_temp.observation_refused($$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version+2 where id='__OPERATION__'$$,
 '42501','source counter cannot skip a version');
select pg_temp.observation_refused($$update public.paige_invoice_provider_operations set provider_observation_operation_id=null where id='__OPERATION__'$$,
 '42501','retained observation pointer cannot be cleared');
select pg_temp.observation_refused($$update public.paige_invoice_provider_operations set provider_observation_version=provider_observation_version+1,provider_observation_operation_id=allocation_payment_id where id='__OPERATION__'$$,
 '55000','captured payment receipt cannot masquerade as a new observation');

do $history$declare op public.paige_invoice_provider_operations%rowtype;original public.paige_invoice_operations%rowtype;
 patch jsonb;label text;
begin
 select * into strict op from public.paige_invoice_provider_operations where id='__OPERATION__';
 select * into strict original from public.paige_invoice_operations where id=op.provider_observation_operation_id;
 for patch,label in select * from (values
  (jsonb_build_object('result',original.result||'{"state":"paid"}'::jsonb),'observation history cannot claim a payment was paid'),
  (jsonb_build_object('result',original.result||'{"source_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb),'history result must retain the exact original source hash'),
  (jsonb_build_object('result',original.result||'{"invoice_version":9007199254740992}'::jsonb),'history cannot carry an unsafe invoice source version'),
  (jsonb_build_object('result',original.result-'rail_recorded'),'history cannot omit actual receipt acknowledgment'),
  (jsonb_build_object('command',original.command||'{"private_note":"not-retained"}'::jsonb),'closed history excludes private extra content'),
  (jsonb_build_object('actor_user_id','aaaaaaaa-0000-4000-8000-000000000099'),'history cannot substitute the original actor')
 ) t(value,label) loop
  perform pg_temp.observation_refused(format('select public._sales_provider_observation_entry((select p from public.paige_invoice_provider_operations p where p.id=%L),jsonb_populate_record(null::public.paige_invoice_operations,%L::jsonb),%L,true)',
   op.id,to_jsonb(original)||patch,op.provider_observation_version-1),'55000',label);
 end loop;
 perform pg_temp.observation_check((select count(*)=3 from public.paige_workspace_events where detail->>'effect'='provider_observation_only'),
  'each native observation has one original durable Rail receipt');
 insert into e04_observation_state values('guarded_before',jsonb_build_object('operation',to_jsonb(op),
  'invoice_version',(select billing_lifecycle_version from public.paige_invoices where id=op.invoice_id),
  'operations',(select count(*) from public.paige_invoice_operations),'rail',(select count(*) from public.paige_workspace_events)));
end $history$;

create function pg_temp.e04_fail_observation_rail() returns trigger language plpgsql as $$
begin if new.detail->>'effect'='provider_observation_only' then raise exception 'Controlled original Rail failure';end if;return new;end $$;
create trigger e04_private_observation_rail_failure before insert on public.paige_workspace_events for each row execute function pg_temp.e04_fail_observation_rail();
set local role service_role;
select pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,3,%L::jsonb,%L)',
 '__TENANT__','__OPERATION__','__TOKEN__',(select value from e04_observation_state where key='snapshot_b'),'evt_rail_failure'),
 'P0001','original Rail failure refuses the observation');
reset role;
select pg_temp.observation_check(
 (select to_jsonb(p)=before.value->'operation' from public.paige_invoice_provider_operations p,e04_observation_state before where p.id='__OPERATION__' and before.key='guarded_before')
 and (select to_jsonb(billing_lifecycle_version)=before.value->'invoice_version' from public.paige_invoices i,e04_observation_state before where i.id=(before.value#>>'{operation,invoice_id}')::uuid and before.key='guarded_before')
 and (select to_jsonb(count(*))=(select value->'operations' from e04_observation_state where key='guarded_before') from public.paige_invoice_operations)
 and (select to_jsonb(count(*))=(select value->'rail' from e04_observation_state where key='guarded_before') from public.paige_workspace_events),
 'Rail failure atomically rolls back journal pointer source version invoice version and event');
drop trigger e04_private_observation_rail_failure on public.paige_workspace_events;
set local role service_role;
do $recovery$declare result jsonb;retry jsonb;
begin
 result:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',3,(select value from e04_observation_state where key='snapshot_b'),'evt_recovery');
 perform pg_temp.observation_check(result->>'observation_version'='4' and result->'rail_recorded'='true'::jsonb and result->'replayed'='false'::jsonb,'normal recovery records the observation and actual Rail once');
 retry:=public.record_sales_invoice_provider_observation('__TENANT__','__OPERATION__','__TOKEN__',3,(select value from e04_observation_state where key='snapshot_b'),'evt_recovery_retry');
 perform pg_temp.observation_check(retry->>'observation_id'=result->>'observation_id' and retry->'replayed'='true'::jsonb,'recovery retries return the original retained observation receipt');
 perform pg_temp.observation_refused(format('select public.read_sales_invoice_provider_observation_context(%L,%L)','20000000-0000-0000-0000-000000000002','__OPERATION__'),
  '42501','foreign tenant cannot read original observation context');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,4,%L::jsonb,%L)',
  '__TENANT__','__OPERATION__','10000000-0000-0000-0000-000000000099',(select value from e04_observation_state where key='snapshot_b'),'evt_wrong_claim'),
  '42501','wrong original dispatch claim cannot write observation facts');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,9007199254740991,%L::jsonb,%L)',
  '__TENANT__','__OPERATION__','__TOKEN__',(select value from e04_observation_state where key='snapshot_b'),'evt_unsafe_version'),
  '22023','unsafe source versions are refused before a write');
 perform pg_temp.observation_refused(format('select public.record_sales_invoice_provider_observation(%L,%L,%L,4,%L::jsonb,%L)',
  '__TENANT__','__OPERATION__','__TOKEN__',(select value||'{"private_note":"not-retained"}'::jsonb from e04_observation_state where key='snapshot_b'),'evt_extra'),
  '22023','provider observation cannot retain arbitrary private content');
end $recovery$;
reset role;
select pg_temp.observation_check((select count(*)=4 and bool_and(actor_id is null and actor_agent_slug is null and capability_key='sales_payment_reconcile'
 and (select count(*) from jsonb_object_keys(detail))=4) from public.paige_workspace_events where detail->>'effect'='provider_observation_only'),
 'observation receipts do not duplicate or fabricate owner or specialist activity');
select pg_temp.observation_check((select to_jsonb(p)=(select value from e04_observation_state where key='original_receipt') from public.paige_invoice_payments p where provider_operation_id='__OPERATION__'),
 'observation history never alters the original captured payment');
select pg_temp.observation_check((select to_jsonb(b)=(select value from e04_observation_state where key='original_balance') from public._sales_invoice_balance_rows('__TENANT__',(select invoice_id from public.paige_invoice_provider_operations where id='__OPERATION__')) b),
 'provider observation does not forgive debt reverse cash or change the canonical balance');
set local role authenticated;
select pg_temp.observation_refused('select public._sales_provider_observation_entry(null,null,0,true)','42501','ordinary role cannot inspect private provider history directly');
select pg_temp.observation_refused($$select public.read_sales_invoice_provider_observation_context('__TENANT__','__OPERATION__')$$,'42501','ordinary role cannot invoke the service observation reader');
reset role;
set local role anon;
select pg_temp.observation_refused('select public._sales_provider_observation_entry(null,null,0,true)','42501','anonymous role cannot inspect private provider history');
select pg_temp.observation_refused($$select public.read_sales_invoice_provider_observation_context('__TENANT__','__OPERATION__')$$,'42501','anonymous role cannot invoke the observation reader');
reset role;
select jsonb_build_object('proof','E04_PROVIDER_OBSERVATION_SELECTED_SCHEMA','checks',(select count(*) from e04_observation_checks),
 'boundary','Original provider proof and writer bodies; reduced tables/test Auth; no hosted Auth, financial adjustment, actual provider or customer acceptance');
rollback;
