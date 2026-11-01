-- Original provider proof's synthetic settled operation; every row rolls back.
set local lock_timeout='2s';set local statement_timeout='10s';
create temp table e04_work_state(key text primary key,value jsonb);
create temp table e04_work_checks(label text primary key);
grant select,insert on e04_work_state,e04_work_checks to service_role,authenticated,anon;
do $$begin execute format('grant usage on schema %I to service_role,authenticated,anon',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
create function pg_temp.work_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;insert into e04_work_checks values(label);raise notice 'PASS: %',label;end $$;
create function pg_temp.work_refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt;exception when others then
 if sqlstate=code then perform pg_temp.work_check(true,label);return;end if;
 raise exception 'FAIL: % unexpected %: %',label,sqlstate,sqlerrm;end;
 raise exception 'FAIL: % accepted',label;end $$;
grant execute on function pg_temp.work_check(boolean,text),pg_temp.work_refused(text,text,text) to service_role,authenticated,anon;
insert into e04_work_state select 'original_operation',to_jsonb(p) from public.paige_invoice_provider_operations p where id=current_setting('test.e04_work_operation')::uuid;
insert into e04_work_state select 'original_payment',to_jsonb(p) from public.paige_invoice_payments p where provider_operation_id=current_setting('test.e04_work_operation')::uuid;
insert into e04_work_state select 'original_settlement_work',to_jsonb(w) from public.paige_durable_work w
 join public.paige_invoice_provider_operations p on p.reconciliation_work_id=w.id where p.id=current_setting('test.e04_work_operation')::uuid;
insert into e04_work_state select 'original_balance',to_jsonb(b) from public._sales_invoice_balance_rows(current_setting('test.e04_work_tenant')::uuid,
 (select invoice_id from public.paige_invoice_provider_operations where id=current_setting('test.e04_work_operation')::uuid)) b;
select set_config('test.actor','',true);
set local role service_role;
do $initial$declare one jsonb;again jsonb;claim jsonb;context jsonb;snapshot jsonb;
begin
 one:=public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workA',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
 again:=public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workA',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
 perform pg_temp.work_check(one=again and one->>'attempt_count'='1','same event registers one canonical occurrence without incrementing attempts');
 insert into e04_work_state values('registered',one);
 perform pg_temp.work_refused($q$select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_wrong','acct_other','test',current_setting('test.e04_work_charge'))$q$,'42501','different merchant cannot register event work');
 perform pg_temp.work_refused($q$select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_wrong',current_setting('test.e04_work_merchant'),'live',current_setting('test.e04_work_charge'))$q$,'42501','different provider environment cannot register event work');
 perform pg_temp.work_refused($q$select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_wrong',current_setting('test.e04_work_merchant'),'test','ch_other')$q$,'42501','different captured charge cannot register event work');
 perform pg_temp.work_refused($q$select public.register_sales_provider_observation_work('20000000-0000-0000-0000-000000000002',current_setting('test.e04_work_operation')::uuid,'evt_wrong',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'))$q$,'42501','event work cannot cross tenant scope');
 perform pg_temp.work_refused($q$select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'bad-event',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'))$q$,'22023','unbounded or malformed event identity is refused');
 perform pg_temp.work_refused('select public.claim_sales_provider_observation_work(4)','22023','provider event batch is bounded at three');
 claim:=public.claim_sales_provider_observation_work(3)->'claims';
 perform pg_temp.work_check(jsonb_array_length(claim)=1 and claim#>>'{0,work_id}'=one->>'work_id','only original observation work is claimed');
 claim:=claim->0;insert into e04_work_state values('claim1',claim);
 perform pg_temp.work_check(public.claim_sales_provider_observation_work(3)->'claims'='[]'::jsonb,'an active attempt is not dispatched a second time');
 context:=public.read_sales_provider_observation_work_context(current_setting('test.e04_work_tenant')::uuid,(claim->>'work_id')::uuid,claim->>'server_idempotency_key',1);
 perform pg_temp.work_check(context->>'work_id'=one->>'work_id' and context->>'event_id'='evt_workA'
  and context#>>'{settlement,provider_transaction_id}'=current_setting('test.e04_work_charge'),'claimed work reads the original captured payment context');
 perform pg_temp.work_refused(format('select public.read_sales_provider_observation_work_context(%L,%L,%L,1)',current_setting('test.e04_work_tenant')::uuid,claim->>'work_id','wrong'),'42501','different server key cannot read or heartbeat the work');
 perform pg_temp.work_refused(format('select public.read_sales_provider_observation_work_context(%L,%L,%L,2)',current_setting('test.e04_work_tenant')::uuid,claim->>'work_id',claim->>'server_idempotency_key'),'42501','different attempt cannot read or heartbeat work');
 snapshot:=jsonb_build_object('state','observed','provider_transaction_id',current_setting('test.e04_work_charge'),'provider_settlement_id',current_setting('test.e04_work_settlement'),
  'refunds',jsonb_build_array(jsonb_build_object('id','re_work','amount_minor',10000,'currency','usd',
   'created_at',to_char((now()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'status','pending','balance_transaction',null,'failure_balance_transaction',null)),'disputes','[]'::jsonb);
 insert into e04_work_state values('snapshot',snapshot),('version',context->'observation_version');
 again:=public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(claim->>'work_id')::uuid,claim->>'server_idempotency_key',1,null,null);
 perform pg_temp.work_check(again->>'work_status'='blocked' and again->>'blocked_reason'='provider_observation_unknown','unknown provider evidence stays blocked rather than becoming a payment or success');
 perform pg_temp.work_check(public.claim_sales_provider_observation_work(3)->'claims'='[]'::jsonb,'uncertain evidence respects the original retry delay');
 again:=public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workA',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
 perform pg_temp.work_check(again->>'work_status'='blocked' and again->>'attempt_count'='1','duplicate event cannot reset blocked work or the attempt budget');
end $initial$;
reset role;
select pg_temp.work_check((select to_jsonb(p)=s.value from public.paige_invoice_provider_operations p,e04_work_state s
 where p.id=current_setting('test.e04_work_operation')::uuid and s.key='original_operation'),'unknown event leaves the original provider source unchanged');
update public.paige_durable_work set updated_at=now()-interval '6 minutes' where id=(select (value->>'work_id')::uuid from e04_work_state where key='registered');
set local role service_role;
do $resume$declare c jsonb;old_claim jsonb;result jsonb;again jsonb;v bigint;snapshot jsonb;
begin
 c:=public.claim_sales_provider_observation_work(3)#>'{claims,0}';
 perform pg_temp.work_check(c->>'attempt_count'='2','same finite occurrence resumes with the next canonical attempt');
 insert into e04_work_state values('claim2',c);
 select value into old_claim from e04_work_state where key='claim1';
 perform pg_temp.work_refused(format('select public.read_sales_provider_observation_work_context(%L,%L,%L,1)',current_setting('test.e04_work_tenant')::uuid,c->>'work_id',c->>'server_idempotency_key'),'42501','late prior-attempt worker loses its lease');
 select (value#>>'{}')::bigint into v from e04_work_state where key='version';select value into snapshot from e04_work_state where key='snapshot';
 result:=public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(c->>'work_id')::uuid,c->>'server_idempotency_key',2,v,snapshot);
 perform pg_temp.work_check(result->>'work_status'='succeeded' and result->>'effect'='provider_observation_only'
  and result#>>'{receipt,verified_readback}'='true','work success proves an observed source and never claims a financial effect');
 insert into e04_work_state values('completed',result);
 again:=public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(c->>'work_id')::uuid,c->>'server_idempotency_key',2,v,snapshot);
 perform pg_temp.work_check(again->'receipt'=result->'receipt' and again->'replayed'='true'::jsonb,'lost completion response replays the same immutable receipt');
 perform pg_temp.work_refused(format('select public.complete_sales_provider_observation_work(%L,%L,%L,2,%L,%L::jsonb)',
  current_setting('test.e04_work_tenant')::uuid,c->>'work_id',c->>'server_idempotency_key',v,jsonb_set(snapshot,'{refunds,0,status}','"failed"')),'55000','terminal event cannot adopt later changed evidence');
 again:=public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workA',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
 perform pg_temp.work_check(again->>'work_status'='succeeded' and again->>'attempt_count'='2','re-delivered completed event never reopens terminal work');
 perform pg_temp.work_check(public.claim_sales_provider_observation_work(3)->'claims'='[]'::jsonb,'terminal observation work never re-enters the queue');
end $resume$;
reset role;
insert into e04_work_state select 'terminal_version',to_jsonb(w.version) from public.paige_durable_work w
 where id=(select (value->>'work_id')::uuid from e04_work_state where key='registered');
select pg_temp.work_check((select count(*)=1 from public.paige_workspace_events e,e04_work_state s where s.key='registered'
 and e.source_id=(s.value->>'work_id')::uuid and e.actor_id is null and e.actor_agent_slug is null and e.detail->>'effect'='provider_observation_only'),
 'work completion has exactly one genuine system Rail receipt');

set local role service_role;
do $new_event$declare r jsonb;c jsonb;ctx jsonb;result jsonb;
begin
 r:=public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workB',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
 perform pg_temp.work_check(r->>'work_id'<>(select value->>'work_id' from e04_work_state where key='registered'),'later event gets a separate bounded occurrence in the same C4 store');
 c:=public.claim_sales_provider_observation_work(3)#>'{claims,0}';insert into e04_work_state values('next_claim',c);
 ctx:=public.read_sales_provider_observation_work_context(current_setting('test.e04_work_tenant')::uuid,(c->>'work_id')::uuid,c->>'server_idempotency_key',1);
 result:=public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(c->>'work_id')::uuid,c->>'server_idempotency_key',1,
  (ctx->>'observation_version')::bigint,(select value from e04_work_state where key='snapshot'));
 perform pg_temp.work_check(result#>'{receipt,observation_id}'=(select value#>'{receipt,observation_id}' from e04_work_state where key='completed'),
  'another event with unchanged current facts reuses the original journal receipt');
 result:=public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(c->>'work_id')::uuid,c->>'server_idempotency_key',1,
  (ctx->>'observation_version')::bigint,(select value from e04_work_state where key='snapshot'));
 perform pg_temp.work_check(result->'replayed'='true'::jsonb,'no-op observation completion can recover its own original requested version');
end $new_event$;
reset role;

-- Fail only the C4 work receipt, AFTER the actual journal and transition. Every
-- effect must roll back together; recovery uses the same occurrence and version.
set local role service_role;
select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workRail',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
insert into e04_work_state values('rail_claim',public.claim_sales_provider_observation_work(3)#>'{claims,0}');
reset role;
insert into e04_work_state select 'before_rail',jsonb_build_object('version',p.provider_observation_version,
 'operations',(select count(*) from public.paige_invoice_operations),'events',(select count(*) from public.paige_workspace_events))
 from public.paige_invoice_provider_operations p where p.id=current_setting('test.e04_work_operation')::uuid;
create function pg_temp.e04_fail_work_rail() returns trigger language plpgsql as $$
begin if new.source_id=(select (value->>'work_id')::uuid from e04_work_state where key='rail_claim') then raise exception 'Controlled work Rail failure';end if;return new;end $$;
create trigger e04_work_rail_failure before insert on public.paige_workspace_events for each row execute function pg_temp.e04_fail_work_rail();
set local role service_role;
select pg_temp.work_refused(format('select public.complete_sales_provider_observation_work(%L,%L,%L,1,%L,%L::jsonb)',
 current_setting('test.e04_work_tenant')::uuid,c.value->>'work_id',c.value->>'server_idempotency_key',b.value->>'version',
 jsonb_set(s.value,'{refunds,0,status}','"failed"')),'P0001','work Rail failure refuses the entire original observation completion')
 from e04_work_state c,e04_work_state b,e04_work_state s where c.key='rail_claim' and b.key='before_rail' and s.key='snapshot';
reset role;
select pg_temp.work_check((select to_jsonb(p.provider_observation_version)=b.value->'version'
 and (select to_jsonb(count(*)) from public.paige_invoice_operations)=b.value->'operations'
 and (select to_jsonb(count(*)) from public.paige_workspace_events)=b.value->'events'
 from public.paige_invoice_provider_operations p,e04_work_state b where p.id=current_setting('test.e04_work_operation')::uuid and b.key='before_rail')
 and (select w.status='claimed' from public.paige_durable_work w,e04_work_state c where c.key='rail_claim' and w.id=(c.value->>'work_id')::uuid),
 'work receipt failure rolls back journal pointer history events and terminal transition');
drop trigger e04_work_rail_failure on public.paige_workspace_events;
set local role service_role;
select pg_temp.work_check(public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(c.value->>'work_id')::uuid,c.value->>'server_idempotency_key',1,
 (b.value->>'version')::bigint,jsonb_set(s.value,'{refunds,0,status}','"failed"'))->>'work_status'='succeeded','same original occurrence recovers after Rail failure')
 from e04_work_state c,e04_work_state b,e04_work_state s where c.key='rail_claim' and b.key='before_rail' and s.key='snapshot';
select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workExhaust',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
insert into e04_work_state values('exhaust_claim',public.claim_sales_provider_observation_work(3)#>'{claims,0}');
reset role;
update public.paige_durable_work set attempt_count=max_attempts,dispatch_started_attempt=max_attempts
 where id=(select (value->>'work_id')::uuid from e04_work_state where key='exhaust_claim');
set local role service_role;
select pg_temp.work_check(public.complete_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,(value->>'work_id')::uuid,value->>'server_idempotency_key',25,null,null)->>'blocked_reason'='provider_observation_exhausted',
 'uncertain event stops at the existing twenty-five-attempt ceiling') from e04_work_state where key='exhaust_claim';
select pg_temp.work_check(public.claim_sales_provider_observation_work(3)->'claims'='[]'::jsonb,'exhausted event never silently resets its retry budget');
select public.register_sales_provider_observation_work(current_setting('test.e04_work_tenant')::uuid,current_setting('test.e04_work_operation')::uuid,'evt_workExpiry',current_setting('test.e04_work_merchant'),'test',current_setting('test.e04_work_charge'));
insert into e04_work_state values('expired_claim',public.claim_sales_provider_observation_work(3)#>'{claims,0}');
reset role;
update public.paige_durable_work set lease_until=now()-interval '1 second'
 where id=(select (value->>'work_id')::uuid from e04_work_state where key='expired_claim');
set local role service_role;
select pg_temp.work_check(public.claim_sales_provider_observation_work(3)#>>'{claims,0,attempt_count}'='2','interrupted event resumes through original expired-and-reconciled C4 transition');
select pg_temp.work_refused(format('select public.read_sales_provider_observation_work_context(%L,%L,%L,1)',current_setting('test.e04_work_tenant')::uuid,value->>'work_id',value->>'server_idempotency_key'),'42501','expired old attempt cannot act after recovery') from e04_work_state where key='expired_claim';
reset role;
set local role authenticated;
select pg_temp.work_refused('select public.claim_sales_provider_observation_work(1)','42501','ordinary browser role cannot claim private provider work');
reset role;set local role anon;
select pg_temp.work_refused('select public.claim_sales_provider_observation_work(1)','42501','anonymous role cannot claim private provider work');
reset role;
select pg_temp.work_check((select to_jsonb(p)=s.value from public.paige_invoice_payments p,e04_work_state s
 where p.provider_operation_id=current_setting('test.e04_work_operation')::uuid and s.key='original_payment'),'all event work leaves the exact original captured payment intact');
select pg_temp.work_check((select to_jsonb(w)=s.value from public.paige_durable_work w,e04_work_state s
 where s.key='original_settlement_work' and w.id=(s.value->>'id')::uuid),'later event work never reopens or changes terminal settlement work');
select pg_temp.work_check((select to_jsonb(b)=s.value from public._sales_invoice_balance_rows(current_setting('test.e04_work_tenant')::uuid,
 (select invoice_id from public.paige_invoice_provider_operations where id=current_setting('test.e04_work_operation')::uuid)) b,e04_work_state s where s.key='original_balance'),
 'provider observations do not forgive debt or alter canonical financial allocation');
do $count$begin if (select count(*) from e04_work_checks)<>39 then raise exception 'Missing native work controls';end if;end $count$;
select jsonb_build_object('proof','E04_PROVIDER_OBSERVATION_WORK','checks',(select count(*) from e04_work_checks),
 'boundary','Original C4 envelope leases transitions journal and Rail; selected tables/test Auth; no Stripe or financial adjustment') as evidence;
