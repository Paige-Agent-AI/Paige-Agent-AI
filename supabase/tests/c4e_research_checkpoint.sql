-- Run on an isolated fixture database. The two transactions model distinct
-- workers: the first commits its checkpoint and leaves before publication.
\set ON_ERROR_STOP on
\set actor '00000000-0000-4000-8000-00000000c4e1'
\set tenant '00000000-0000-4000-8000-00000000c4e2'
\set thread '00000000-0000-4000-8000-00000000c4e3'
\set intent '00000000-0000-4000-8000-00000000c4e4'
\set unknown_intent '00000000-0000-4000-8000-00000000c4e5'
\set invalid_intent '00000000-0000-4000-8000-00000000c4e6'
\set payload '{"version":1,"question":"Research a public fixture","max_hops":1}'

create function pg_temp.check_c4e(label text, condition boolean) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'C4e assertion failed: %',label; end if;
  raise notice 'C4e PASS: %',label;
end $$;
create function pg_temp.refuses_c4e(label text, command text, expected_code text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate<>expected_code then raise; end if;
    raise notice 'C4e PASS: %',label;
    return;
  end;
  raise exception 'C4e unexpectedly admitted: %',label;
end $$;
create function pg_temp.admit_c4e(thread uuid,intent uuid) returns void language sql as $$
  update public.paige_chat_threads set interactive_latest_intent=intent,interactive_admitted_intent=intent,
    interactive_executor_intent=intent,interactive_runtime_binding=jsonb_build_object(
      'intent_id',intent,'mode','normal','function_slug','paige-ai-chat')
  where id=thread;
$$;

insert into auth.users(id) values (:'actor');
insert into public.tenants(id,status) values (:'tenant','active');
insert into public.profiles(user_id,active_tenant_id) values (:'actor',:'tenant');
insert into public.tenant_members(tenant_id,user_id,status,role) values (:'tenant',:'actor','active','owner');
insert into public.paige_chat_threads(id,caller_user_id,tenant_id,audience)
  values (:'thread',:'actor',:'tenant','workspace');
update public.paige_chat_interactive_rollout set active=true where singleton;
select jsonb_build_object('tenant_id',:'tenant','actor_user_id',:'actor','authority_source','server_resolved',
  'approval_reusable',false,'budget_context','{}'::jsonb) as authority \gset

select pg_temp.check_c4e('RPC is service only',
  not has_function_privilege('authenticated','public.advance_paige_research_work(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,jsonb)','execute')
  and not has_function_privilege('anon','public.advance_paige_research_work(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,jsonb)','execute'));
set request.jwt.claims='{"role":"service_role"}';
set role service_role;
select work_id as original from public.prepare_paige_research_work(:'tenant',:'actor',:'intent',:'thread',
  :'payload',:'authority','test-epoch') \gset
select pg_temp.refuses_c4e('prepared Work without current admission cannot dispatch',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','begin'),'42501');
reset role;
select pg_temp.admit_c4e(:'thread',:'intent');
set role service_role;
select public.advance_paige_research_work(:'original',:'tenant',:'actor',:'thread',:'intent',:'payload','begin') as opened \gset
select pg_temp.check_c4e('claims one original attempt', :'opened'::jsonb->>'state'='execute');
select pg_temp.check_c4e('duplicate delivery cannot execute', public.advance_paige_research_work(
  :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','begin')->>'state'='in_progress');
select pg_temp.refuses_c4e('changed objective is denied',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'original',:'tenant',:'actor',:'thread',:'intent','{"version":1,"question":"Different request"}','begin'),'42501');
select pg_temp.refuses_c4e('another intent cannot read the original Work',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'original',:'tenant',:'actor',:'thread',:'unknown_intent',:'payload','begin'),'42501');
select pg_temp.check_c4e('checkpoint durable before save', public.advance_paige_research_work(
  :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','checkpoint',(:'opened'::jsonb->>'version')::bigint,
  jsonb_build_object('report',jsonb_build_object('run_id',:'original','question','Research a public fixture',
    'findings','[{"text":"Verified public fixture","citations":[1]}]'::jsonb,
    'sources','[{"index":1,"url":"https://example.gov/evidence","title":"Public evidence","snippet":"Fixture","reliability_score":0.9,"tier":"T1","reliability":"high","published_at":null,"fetched_at":"2026-11-10T00:00:00Z","excluded":false}]'::jsonb,
    'coverage','{"configured":true,"stop_reason":"answered","hops_used":1,"searches":1,"reads":1,"note":"Verified"}'::jsonb)))
  ->>'state'='ready');
reset role;

select pg_temp.check_c4e('report and receipt absent at interruption', not exists(
  select 1 from public.research_runs where id=:'original') and not exists(
  select 1 from public.paige_workspace_events where source_id=:'original'));

select pg_temp.admit_c4e(:'thread',:'unknown_intent');
set role service_role;
select pg_temp.refuses_c4e('superseded checkpoint cannot publish',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','publish'),'42501');
reset role;
select pg_temp.admit_c4e(:'thread',:'intent');
set role service_role;
select pg_temp.check_c4e('replacement gets ready, never execute', public.advance_paige_research_work(
  :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','begin')->>'state'='ready');
begin;
select public.record_capability_run(:'tenant',:'actor','deep_research','capability_succeeded',:'original',
  _job_attempt_id=>'unrelated-attempt',_detail=>'{}'::jsonb);
select pg_temp.refuses_c4e('an existing receipt cannot be adopted as this attempt',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','publish'),'55000');
rollback;
select public.advance_paige_research_work(:'original',:'tenant',:'actor',:'thread',:'intent',:'payload','publish') as recovered \gset
select pg_temp.check_c4e('same report, citations and receipt', :'recovered'::jsonb->>'state'='complete'
  and :'recovered'::jsonb#>>'{result,run_id}'=:'original'
  and :'recovered'::jsonb#>'{result,findings,0,citations}'='[1]'::jsonb
  and :'recovered'::jsonb#>>'{result,sources,0,url}'='https://example.gov/evidence'
  and :'recovered'::jsonb#>>'{result,receipt_id}' is not null);
select pg_temp.check_c4e('lost acknowledgement reads the same result', public.advance_paige_research_work(
  :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','begin')=:'recovered'::jsonb
  and public.advance_paige_research_work(
    :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','publish')=:'recovered'::jsonb);
reset role;
update public.research_sources set url='https://example.gov/changed' where run_id=:'original';
set role service_role;
select pg_temp.refuses_c4e('changed citation provenance cannot replay a saved report',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'original',:'tenant',:'actor',:'thread',:'intent',:'payload','begin'),'55000');
reset role;
update public.research_sources set url='https://example.gov/evidence' where run_id=:'original';

select pg_temp.admit_c4e(:'thread',:'unknown_intent');
set role service_role;
select work_id as uncertain from public.prepare_paige_research_work(:'tenant',:'actor',:'unknown_intent',:'thread',
  :'payload',:'authority','test-epoch') \gset
select pg_temp.check_c4e('uncertain attempt dispatched once', public.advance_paige_research_work(
  :'uncertain',:'tenant',:'actor',:'thread',:'unknown_intent',:'payload','begin')->>'state'='execute');
reset role;
update public.paige_durable_work set lease_until=now()-interval '1 second' where id=:'uncertain';
set role service_role;
select pg_temp.check_c4e('expired uncheckpointed call cannot redispatch', public.advance_paige_research_work(
  :'uncertain',:'tenant',:'actor',:'thread',:'unknown_intent',:'payload','begin')->>'state'='outcome_unknown'
  and public.advance_paige_research_work(:'uncertain',:'tenant',:'actor',:'thread',:'unknown_intent',:'payload','begin')
  ->>'state'='outcome_unknown');

reset role;
select pg_temp.admit_c4e(:'thread',:'invalid_intent');
set role service_role;
select work_id as invalid from public.prepare_paige_research_work(:'tenant',:'actor',:'invalid_intent',:'thread',
  :'payload',:'authority','test-epoch') \gset
select public.advance_paige_research_work(:'invalid',:'tenant',:'actor',:'thread',:'invalid_intent',:'payload','begin') as opened \gset
select public.advance_paige_research_work(:'invalid',:'tenant',:'actor',:'thread',:'invalid_intent',:'payload',
  'checkpoint',(:'opened'::jsonb->>'version')::bigint,
  jsonb_build_object('report',jsonb_build_object('run_id',:'invalid','question','Research a public fixture',
    'findings','[{"text":"Unbound citation","citations":[99]}]'::jsonb,'sources','[]'::jsonb,
    'coverage','{"configured":true,"stop_reason":"answered"}'::jsonb)));
select pg_temp.refuses_c4e('unbound citation aborts the publication transaction',
  format('select public.advance_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',
    :'invalid',:'tenant',:'actor',:'thread',:'invalid_intent',:'payload','publish'),'22023');
reset role;
select pg_temp.check_c4e('failed publication leaves no report or receipt',
  not exists(select 1 from public.research_runs where id=:'invalid')
  and not exists(select 1 from public.paige_workspace_events where source_id=:'invalid')
  and (select research_checkpoint is not null and status='claimed' from public.paige_durable_work where id=:'invalid'));
select pg_temp.check_c4e('exactly one native report, source and Rail receipt',
  (select count(*)=1 from public.research_runs where work_id=:'original')
  and (select count(*)=1 from public.research_sources where run_id=:'original')
  and (select count(*)=1 and bool_and(job_attempt_id=:'original'||':1')
    from public.paige_workspace_events where source_id=:'original')
  and (select attempt_count=1 and dispatch_started_attempt=1 and research_checkpoint is null
    from public.paige_durable_work where id=:'original'));
