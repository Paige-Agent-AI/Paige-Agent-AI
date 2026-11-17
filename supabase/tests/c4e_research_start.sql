-- Synthetic records in the empty rollback-only local fixture. Counts below are
-- input metadata to preserve, not claims of model/provider executions.
create temporary table c4e_start_checks(label text primary key);
create temporary table c4e_start_cases(label text primary key,work_id uuid,thread_id uuid,intent_id uuid,payload jsonb);
grant select on c4e_start_cases to service_role,authenticated,anon;
grant insert on c4e_start_checks to service_role,authenticated,anon;
create function pg_temp.check_start(label text,condition boolean)returns void language plpgsql as $$
begin
 if condition is distinct from true then raise exception 'C4E_START_FAIL: %',label;end if;
 insert into c4e_start_checks values(label);
end$$;
create function pg_temp.refuse_start(label text,statement text,expected text)returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if sqlstate<>expected then raise;end if;
  insert into c4e_start_checks values(label);return;
 end;
 raise exception 'C4E_START_FAIL admitted: %',label;
end$$;
set request.jwt.claims='{"role":"service_role"}';
insert into auth.users(id)values('00000000-0000-4000-8000-00000000c401');
insert into tenants(id,status)values('00000000-0000-4000-8000-00000000c402','active');
insert into profiles values('00000000-0000-4000-8000-00000000c401','00000000-0000-4000-8000-00000000c402');
insert into tenant_members(tenant_id,user_id,status,role)values(
 '00000000-0000-4000-8000-00000000c402','00000000-0000-4000-8000-00000000c401','active','owner');
update paige_chat_interactive_rollout set active=true where singleton;
create function pg_temp.seed_start(label text,record jsonb default '{"v":1,"state":"FINAL","mode":"research","rounds":2,"tools":3}')returns void language plpgsql as $$
declare t uuid:=gen_random_uuid();i uuid:=gen_random_uuid();w uuid;
 p jsonb:='{"version":1,"question":"Research the public fixture","max_hops":1}';
begin
 insert into paige_chat_threads(id,caller_user_id,tenant_id,interactive_latest_intent,
  interactive_executor_intent,interactive_admitted_intent,interactive_runtime_binding)
 values(t,'00000000-0000-4000-8000-00000000c401','00000000-0000-4000-8000-00000000c402',i,i,i,
  jsonb_build_object('intent_id',i,'mode','normal','function_slug','paige-ai-chat'));
 select work_id into w from public.prepare_paige_research_work(
  '00000000-0000-4000-8000-00000000c402','00000000-0000-4000-8000-00000000c401',i,t,p,
  jsonb_build_object('tenant_id','00000000-0000-4000-8000-00000000c402',
   'actor_user_id','00000000-0000-4000-8000-00000000c401',
   'authority_source','server_resolved','approval_reusable',false,'budget_context','{}'::jsonb,
   'chat_turn_record',record),'start-fixture');
 insert into c4e_start_cases values(label,w,t,i,p);
end$$;
create function pg_temp.invoke_start(label text,phase text default 'begin')returns jsonb language sql as $$
 select public.advance_paige_research_work(c.work_id,'00000000-0000-4000-8000-00000000c402',
  '00000000-0000-4000-8000-00000000c401',c.thread_id,c.intent_id,
  case when phase='resume' then null else c.payload end,phase)
 from c4e_start_cases c where c.label=$1
$$;

select pg_temp.seed_start('original');
set role service_role;
create temporary table c4e_started as select pg_temp.invoke_start('original') as result;
select pg_temp.check_start('original execution is claimed',(select result->>'state'='execute' from c4e_started));
reset role;
-- Causal control: original20 claims Work but has no accepted Chat receipt here.
select pg_temp.check_start('canonical accepted reference exists BEFORE execute',
 (select count(*)=1 from paige_chat_turns t join c4e_start_cases c on c.label='original'
  where t.thread_id=c.thread_id and t.interactive_intent_id=c.intent_id and t.role='assistant'
   and t.interactive_actor_id='00000000-0000-4000-8000-00000000c401'
   and t.interactive_tenant_id='00000000-0000-4000-8000-00000000c402'
   and t.interactive_terminal_state='WAIT_WORK'
   and t.bundle_ref#>>'{interactive,effects,0,tool}'='deep_research'
   and t.bundle_ref#>>'{interactive,effects,0,outcome}'='durable_accepted'
   and t.bundle_ref#>>'{interactive,effects,0,work_id}'=c.work_id::text));
select pg_temp.check_start('prior counts plus exactly one accepted Research tool',
 (select t.bundle_ref#>>'{turn_state,rounds}'='2' and t.bundle_ref#>>'{turn_state,tools}'='4'
   and t.bundle_ref#>>'{turn_state,mode}'='research'
   and t.bundle_ref#>>'{turn_state,waiting_on,work_ids,0}'=c.work_id::text
  from paige_chat_turns t join c4e_start_cases c on t.thread_id=c.thread_id where c.label='original'));
select pg_temp.check_start('global terminal evidence remains true',
 (select public.paige_chat_interactive_evidence(c.thread_id,'00000000-0000-4000-8000-00000000c401',
  '00000000-0000-4000-8000-00000000c402',c.intent_id)->>'terminal'='true' from c4e_start_cases c where label='original'));
set role service_role;
select pg_temp.check_start('duplicate begin cannot execute',pg_temp.invoke_start('original')->>'state'='in_progress');
reset role;
select pg_temp.check_start('one original dispatch and receipt',
 (select w.attempt_count=1 and w.dispatch_started_attempt=1 and t.message_count=1
  from c4e_start_cases c join paige_durable_work w on w.id=c.work_id
   join paige_chat_threads t on t.id=c.thread_id where c.label='original')
 and (select count(*)=1 from paige_chat_turns));
set role service_role;
select pg_temp.check_start('accepted terminal does not block the original checkpoint',
 public.advance_paige_research_work(c.work_id,'00000000-0000-4000-8000-00000000c402',
  '00000000-0000-4000-8000-00000000c401',c.thread_id,c.intent_id,c.payload,'checkpoint',
  (select (result->>'version')::bigint from c4e_started),
  jsonb_build_object('report',jsonb_build_object('run_id',c.work_id,'question',c.payload->>'question',
   'findings','[]'::jsonb,'sources','[]'::jsonb,'coverage',jsonb_build_object('configured',true,'stop_reason','answered'))))
 ->>'state'='ready') from c4e_start_cases c where c.label='original';
select pg_temp.check_start('same intent resumes the original checkpoint',pg_temp.invoke_start('original','resume')->>'state'='ready');
reset role;
select pg_temp.check_start('checkpoint resume adds no execution or acceptance',
 (select w.attempt_count=1 and w.dispatch_started_attempt=1 and w.research_checkpoint is not null
  from c4e_start_cases c join paige_durable_work w on w.id=c.work_id where c.label='original')
 and (select count(*)=1 from paige_chat_turns));

select pg_temp.seed_start('unstarted');
set role service_role;
select pg_temp.check_start('resume only never starts a prepared job',pg_temp.invoke_start('unstarted','resume')->>'state'='blocked');
reset role;
select pg_temp.check_start('resume only writes no acceptance',
 not exists(select 1 from paige_chat_turns t join c4e_start_cases c on t.thread_id=c.thread_id where c.label='unstarted'));

select pg_temp.seed_start('missing-record',null);
select pg_temp.seed_start('false-count','{"v":1,"state":"FINAL","mode":"research","rounds":true,"tools":1}');
select pg_temp.seed_start('negative-count','{"v":1,"state":"FINAL","mode":"research","rounds":-1,"tools":1}');
select pg_temp.seed_start('fractional-count','{"v":1,"state":"FINAL","mode":"research","rounds":1.5,"tools":1}');
select pg_temp.seed_start('oversize-count','{"v":1,"state":"FINAL","mode":"research","rounds":1001,"tools":1}');
select pg_temp.seed_start('unknown-mode','{"v":1,"state":"FINAL","mode":"invented","rounds":1,"tools":1}');
select pg_temp.seed_start('pending-approval','{"v":1,"state":"WAIT_APPROVAL","mode":"action","rounds":1,"tools":1}');
select pg_temp.seed_start('contradictory-wait','{"v":1,"state":"FINAL","mode":"research","rounds":1,"tools":1,"waiting_on":{"kind":"work"}}');
set role service_role;
select pg_temp.refuse_start('invalid metadata: '||label,format('select pg_temp.invoke_start(%L)',label),'22023')
 from c4e_start_cases where label in('missing-record','false-count','negative-count','fractional-count','oversize-count','unknown-mode','pending-approval','contradictory-wait');
reset role;
select pg_temp.check_start('invalid metadata causes no dispatch',not exists(
 select 1 from c4e_start_cases c join paige_durable_work w on w.id=c.work_id
 where c.label in('missing-record','false-count','negative-count','fractional-count','oversize-count','unknown-mode','pending-approval','contradictory-wait')
  and (w.dispatch_started_attempt<>0 or w.status<>'blocked')));

select pg_temp.seed_start('write-failure');
create function pg_temp.reject_acceptance()returns trigger language plpgsql as $$
begin raise exception 'fixture persistence failure';end$$;
create trigger c4e_acceptance_failure before insert on paige_chat_turns for each row execute function pg_temp.reject_acceptance();
set role service_role;
select pg_temp.refuse_start('canonical writer failure refuses execution','select pg_temp.invoke_start(''write-failure'')','P0001');
reset role;
drop trigger c4e_acceptance_failure on paige_chat_turns;
select pg_temp.check_start('writer failure rolls back claim and receipt',
 (select w.status='blocked' and w.dispatch_started_attempt=0 and t.message_count=0
  from c4e_start_cases c join paige_durable_work w on w.id=c.work_id join paige_chat_threads t on t.id=c.thread_id
  where c.label='write-failure') and not exists(select 1 from paige_chat_turns t
   join c4e_start_cases c on c.thread_id=t.thread_id where c.label='write-failure'));

select pg_temp.seed_start('claim-failure');
create function pg_temp.reject_claim()returns trigger language plpgsql as $$
begin if new.status='claimed' and new.dispatch_started_attempt>0 then raise exception 'fixture claim failure';end if;return new;end$$;
create trigger c4e_claim_failure before update on paige_durable_work for each row execute function pg_temp.reject_claim();
set role service_role;
select pg_temp.refuse_start('later claim failure refuses execution','select pg_temp.invoke_start(''claim-failure'')','P0001');
reset role;
drop trigger c4e_claim_failure on paige_durable_work;
select pg_temp.check_start('later failure also rolls back original acceptance',
 (select w.status='blocked' and w.dispatch_started_attempt=0 and t.message_count=0
  from c4e_start_cases c join paige_durable_work w on w.id=c.work_id join paige_chat_threads t on t.id=c.thread_id
  where c.label='claim-failure') and not exists(select 1 from paige_chat_turns t
   join c4e_start_cases c on c.thread_id=t.thread_id where c.label='claim-failure'));

select pg_temp.seed_start('stopped');
insert into paige_chat_turns(thread_id,role,interactive_actor_id,interactive_tenant_id,interactive_supersedes_id)
 select thread_id,'system','00000000-0000-4000-8000-00000000c401','00000000-0000-4000-8000-00000000c402',intent_id
 from c4e_start_cases where label='stopped';
set role service_role;
select pg_temp.refuse_start('original Stop evidence is still enforced','select pg_temp.invoke_start(''stopped'')','42501');
reset role;
select pg_temp.seed_start('old-terminal');
select public.paige_chat_interactive_settle(c.thread_id,'00000000-0000-4000-8000-00000000c401',
 '00000000-0000-4000-8000-00000000c402',c.intent_id,'Already waiting',null,null,
 jsonb_build_object('turn_state',jsonb_build_object('v',1,'state','WAIT_WORK'),
  'interactive',jsonb_build_object('request_intent_id',c.intent_id)),null)
 from c4e_start_cases c where label='old-terminal';
set role service_role;
select pg_temp.refuse_start('prewritten terminal is not a generic start bypass','select pg_temp.invoke_start(''old-terminal'')','42501');
reset role;

select pg_temp.seed_start('foreign');
set role service_role;
select pg_temp.refuse_start('foreign tenant refuses before persistence',format(
 'select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,''begin'')',
 work_id,'00000000-0000-4000-8000-00000000ffff','00000000-0000-4000-8000-00000000c401',thread_id,intent_id,payload),'42501')
 from c4e_start_cases where label='foreign';
select pg_temp.refuse_start('foreign intent refuses before persistence',format(
 'select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,''begin'')',
 work_id,'00000000-0000-4000-8000-00000000c402','00000000-0000-4000-8000-00000000c401',thread_id,
 '00000000-0000-4000-8000-00000000ffff',payload),'42501') from c4e_start_cases where label='foreign';
reset role;
update tenant_members set status='inactive';
set role service_role;
select pg_temp.refuse_start('revocation refuses before persistence','select pg_temp.invoke_start(''foreign'')','42501');
reset role;
update tenant_members set status='active';
set role authenticated;
select pg_temp.refuse_start('authenticated direct start denied','select pg_temp.invoke_start(''foreign'')','42501');
reset role;
set role anon;
select pg_temp.refuse_start('anonymous direct start denied','select pg_temp.invoke_start(''foreign'')','42501');
reset role;
select pg_temp.check_start('refused work has no accepted reference',not exists(select 1 from paige_chat_turns t
 join c4e_start_cases c on c.thread_id=t.thread_id where c.label='foreign'));
select pg_temp.check_start('start does not fabricate a report',(select count(*)=0 from research_runs));
select pg_temp.seed_start('mode-pending','{"v":1,"state":"FINAL","mode":"pending","rounds":1,"tools":0,"private_note":"must not enter the receipt"}');
select pg_temp.seed_start('mode-action','{"v":1,"state":"FINAL","mode":"action","rounds":2,"tools":2}');
select pg_temp.seed_start('mode-build','{"v":1,"state":"FINAL","mode":"build","rounds":2,"tools":2,"resumed":{"kind":"work"}}');
select pg_temp.seed_start('mode-delegation','{"v":1,"state":"FINAL","mode":"multi_agent","rounds":2,"tools":2}');
set role service_role;
select pg_temp.check_start('acceptance projects mode: '||label,pg_temp.invoke_start(label)->>'state'='execute')
 from c4e_start_cases where label in('mode-pending','mode-action','mode-build','mode-delegation');
reset role;
select pg_temp.check_start('accepted Research mode follows canonical reducer precedence',not exists(
 select 1 from c4e_start_cases c join paige_chat_turns t on t.thread_id=c.thread_id
 where c.label in('mode-pending','mode-action','mode-build','mode-delegation')
  and t.bundle_ref#>>'{turn_state,mode}' is distinct from case c.label when 'mode-build' then 'build'
   when 'mode-delegation' then 'multi_agent' else 'research' end));
select pg_temp.check_start('acceptance adds exactly one tool to the pre-batch snapshot',not exists(
 select 1 from c4e_start_cases c join paige_chat_turns t on t.thread_id=c.thread_id
 where c.label in('mode-pending','mode-action','mode-build','mode-delegation')
  and t.bundle_ref#>>'{turn_state,tools}' is distinct from case c.label when 'mode-pending' then '1' else '3' end));
select pg_temp.check_start('original bounded resumption kind survives acceptance',
 (select t.bundle_ref#>>'{turn_state,resumed,kind}'='work'
  from c4e_start_cases c join paige_chat_turns t on t.thread_id=c.thread_id where c.label='mode-build'));
select pg_temp.check_start('private snapshot prose is not copied into the receipt',
 (select t.bundle_ref::text not like '%must not enter the receipt%'
  from c4e_start_cases c join paige_chat_turns t on t.thread_id=c.thread_id where c.label='mode-pending'));
select 'C4E_START_PROOF checks='||count(*) from c4e_start_checks;
