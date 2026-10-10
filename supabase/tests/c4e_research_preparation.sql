create temporary table c4e_checks(label text primary key);
create function pg_temp.check_ok(label text,condition boolean)returns void language plpgsql as $$begin if condition is distinct from true then raise exception 'C4E_FAIL: %',label;end if;insert into c4e_checks values(label);end$$;
create function pg_temp.refuses(label text,statement text,expected_code text)returns void language plpgsql as $$begin begin execute statement;exception when others then if sqlstate=expected_code then insert into c4e_checks values(label);return;else raise;end if;end;raise exception 'C4E_FAIL: admitted %',label;end$$;
insert into auth.users(id)values('00000000-0000-4000-8000-000000000001');
insert into tenants(id,status)values('00000000-0000-4000-8000-000000000002','active'),('00000000-0000-4000-8000-000000000003','active');
insert into tenant_members(tenant_id,user_id,status,role)values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','active','owner');
insert into paige_chat_threads(id,caller_user_id,tenant_id)values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
create temporary table c4e_args as select
 '00000000-0000-4000-8000-000000000002'::uuid tenant,
 '00000000-0000-4000-8000-000000000001'::uuid actor,
 '00000000-0000-4000-8000-000000000005'::uuid intent,
 '00000000-0000-4000-8000-000000000004'::uuid thread,
 '{"version":1,"question":"Research this synthetic question","max_hops":2,"freshness_days":30,"strict":true}'::jsonb payload,
 '{"tenant_id":"00000000-0000-4000-8000-000000000002","actor_user_id":"00000000-0000-4000-8000-000000000001","authority_source":"server_resolved","approval_reusable":false,"budget_context":{"status":"not_evaluated"}}'::jsonb authority,
 'test-scope-epoch'::text epoch;
grant select on c4e_args to service_role;
set role service_role;
create temporary table c4e_first as select p.* from c4e_args a cross join lateral public.prepare_paige_research_work(a.tenant,a.actor,a.intent,a.thread,a.payload,a.authority,a.epoch)p;
create temporary table c4e_replay as select p.* from c4e_args a cross join lateral public.prepare_paige_research_work(a.tenant,a.actor,a.intent,a.thread,a.payload,a.authority,a.epoch)p;
reset role;
select pg_temp.check_ok('blocked preparation',(select work_status='blocked' and blocked_reason='research_execution_not_enabled' from c4e_first));
select pg_temp.check_ok('same work on replay',(select f.work_id=r.work_id and r.resumed_existing from c4e_first f,c4e_replay r));
select pg_temp.check_ok('one canonical envelope',(select count(*)=1 from paige_durable_work));
select pg_temp.check_ok('payload pinned',(select w.request_payload=a.payload from paige_durable_work w,c4e_args a));
select pg_temp.check_ok('identity pinned',(select w.tenant_id=a.tenant and w.initiating_user_id=a.actor and w.intent_id=a.intent and w.thread_id=a.thread and w.scope_epoch=a.epoch and w.authority_context=a.authority from paige_durable_work w,c4e_args a));
select pg_temp.check_ok('no execution/terminal',(select dispatch_started_attempt=0 and terminal_outcome is null and settled_at is null and status='blocked' from paige_durable_work));
select pg_temp.check_ok('no fake research result',(select count(*)=0 from research_runs));
select pg_temp.check_ok('caller denied',not has_function_privilege('authenticated','public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text)','EXECUTE'));
select pg_temp.check_ok('anonymous denied',not has_function_privilege('anon','public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text)','EXECUTE'));
select pg_temp.check_ok('service callable',has_function_privilege('service_role','public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text)','EXECUTE'));
select pg_temp.refuses('payload replay conflict',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,intent,thread,payload||'{"question":"Replacement question"}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('scope replay conflict',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,intent,thread,payload,authority,'changed-epoch'),'22023')from c4e_args;
select pg_temp.refuses('budget snapshot replay conflict',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,intent,thread,payload,authority||'{"budget_context":{"status":"changed"}}',epoch),'22023')from c4e_args;
select pg_temp.refuses('foreign tenant denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)','00000000-0000-4000-8000-000000000003',actor,gen_random_uuid(),thread,payload,authority||'{"tenant_id":"00000000-0000-4000-8000-000000000003"}',epoch),'42501')from c4e_args;
select pg_temp.refuses('unknown input denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||'{"approved":true}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('hop expansion denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||'{"max_hops":99}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('wrong actor denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,'00000000-0000-4000-8000-000000000099',gen_random_uuid(),thread,payload,authority||'{"actor_user_id":"00000000-0000-4000-8000-000000000099"}',epoch),'42501')from c4e_args;
select pg_temp.refuses('wrong thread denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),'00000000-0000-4000-8000-000000000099',payload,authority,epoch),'42501')from c4e_args;
select pg_temp.refuses('thread required',format('select public.prepare_paige_research_work(%L,%L,%L,null,%L,%L,%L)',tenant,actor,gen_random_uuid(),payload,authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('missing question denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload-'question',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('oversize input denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||jsonb_build_object('question',repeat('q',20000)),authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('fractional hops denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||'{"max_hops":1.5}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('invalid freshness denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||'{"freshness_days":0}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('invalid strict flag denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||'{"strict":"true"}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('invalid facet denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload||'{"flavor_facets":[123]}',authority,epoch),'22023')from c4e_args;
select pg_temp.refuses('reusable approval denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload,authority||'{"approval_reusable":true}',epoch),'22023')from c4e_args;
select pg_temp.refuses('absent budget snapshot denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,gen_random_uuid(),thread,payload,authority-'budget_context',epoch),'22023')from c4e_args;
select pg_temp.refuses('payload immutable',format('update public.paige_durable_work set request_payload=%L where id=%L','{}',(select work_id from c4e_first)),'22023');
select pg_temp.check_ok('no extra work from refusals',(select count(*)=1 from paige_durable_work));
select pg_temp.check_ok('no wake in preparation',pg_get_functiondef('public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text)'::regprocedure) !~* '(net[.]http|pg_notify|functions/v1)');
grant select on c4e_args to authenticated,anon;
grant insert on c4e_checks to authenticated,anon;
set role authenticated;
select pg_temp.refuses('authenticated actual call denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,intent,thread,payload,authority,epoch),'42501')from c4e_args;
reset role;
set role anon;
select pg_temp.refuses('anonymous actual call denied',format('select public.prepare_paige_research_work(%L,%L,%L,%L,%L,%L,%L)',tenant,actor,intent,thread,payload,authority,epoch),'42501')from c4e_args;
reset role;
do $$declare a record; w record;begin
 select * into a from c4e_args;select * into w from paige_durable_work;
 begin
  update paige_chat_threads set is_archived=true where id=a.thread;
  perform public.prepare_paige_research_work(a.tenant,a.actor,a.intent,a.thread,a.payload,a.authority,a.epoch);
  raise exception 'C4E_FAIL archived replay admitted';
 exception when insufficient_privilege then null;end;
 insert into c4e_checks values('archived thread replay denied');
 begin
  update tenant_members set status='inactive' where user_id=a.actor;
  perform public.prepare_paige_research_work(a.tenant,a.actor,a.intent,a.thread,a.payload,a.authority,a.epoch);
  raise exception 'C4E_FAIL inactive replay admitted';
 exception when insufficient_privilege then null;end;
 insert into c4e_checks values('removed membership replay denied');
 begin
  perform public.transition_paige_durable_work(w.id,w.idempotency_key,'failed','{"reason":"synthetic"}',null,null,'synthetic_failure');
  perform public.prepare_paige_research_work(a.tenant,a.actor,a.intent,a.thread,a.payload,a.authority,a.epoch);
  raise exception 'C4E_FAIL terminal work resurrected';
 exception when sqlstate '55000' then null;end;
 insert into c4e_checks values('terminal replay not resurrected');
 begin
  update paige_durable_work set dispatch_started_attempt=1 where id=w.id;
  perform public.prepare_paige_research_work(a.tenant,a.actor,a.intent,a.thread,a.payload,a.authority,a.epoch);
  raise exception 'C4E_FAIL dispatched work reused';
 exception when sqlstate '55000' then null;end;
 insert into c4e_checks values('started dispatch not reused');
end$$;
select pg_temp.check_ok('denials preserve blocked envelope',(select status='blocked' and blocked_reason='research_execution_not_enabled' and dispatch_started_attempt=0 from paige_durable_work));
select 'C4E_PROOF checks='||count(*) from c4e_checks;
