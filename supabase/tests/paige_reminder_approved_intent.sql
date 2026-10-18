-- Actual canonical native functions; test.actor is only the isolated auth.uid port.
begin;
create temp table reminder_assertions(label text not null);
create temp sequence reminder_assertion_count;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'REMINDER_PROOF_FAIL: %',label; end if;
 perform nextval('pg_temp.reminder_assertion_count'); insert into reminder_assertions values(label); end $$;
insert into auth.users(id) values('a2300000-0000-4000-8000-000000000001'),('a2300000-0000-4000-8000-000000000002');
insert into public.tenants(id,status) values('a2300000-0000-4000-8000-000000000010','active'),('a2300000-0000-4000-8000-000000000011','active');
insert into public.profiles values('a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010');
insert into public.tenant_members(tenant_id,user_id,status,role) values
 ('a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000001','active','member');
insert into public.paige_chat_threads(id,caller_user_id,tenant_id) values
 ('a2300000-0000-4000-8000-000000000020','a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010');
insert into public.paige_pending_confirmations(id,user_id,tenant_id,thread_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
 values('a2300000-0000-4000-8000-000000000030','a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010',
 'a2300000-0000-4000-8000-000000000020','plan_set_reminder','0123456789abcdef',
 '{"title":"Review the neutral handoff","remind_at":"2030-01-02T09:00:00Z"}','Review the neutral handoff',
 'a2300000-0000-4000-8000-000000000040',clock_timestamp()-interval '1 minute');
set test.actor='a2300000-0000-4000-8000-000000000001';
set test.tenant='a2300000-0000-4000-8000-000000000010';
set role authenticated;
select public.paige_chat_interactive_begin_v2('a2300000-0000-4000-8000-000000000020','a2300000-0000-4000-8000-000000000050',null,'Approve the exact reminder',false,false,true);
reset role;set role service_role;
select public.paige_chat_interactive_acquire_bound('a2300000-0000-4000-8000-000000000020','a2300000-0000-4000-8000-000000000001',
 'a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060',
 'a2300000-0000-4000-8000-000000000070','abcdefghijklmnopqrst_a2300000-0000-4000-8000-000000000080_445');
reset role;
do $$declare adopted jsonb; result jsonb; replay jsonb; wid uuid; rid uuid; begin
 if PROOF_BASELINE then
  perform public.plan_set_reminder('Review the neutral handoff','2030-01-02T09:00:00Z','user',null,'in_app',null,null,null,'a2300000-0000-4000-8000-000000000010');
  perform public.plan_set_reminder('Review the neutral handoff','2030-01-02T09:00:00Z','user',null,'in_app',null,null,null,'a2300000-0000-4000-8000-000000000010');
  perform pg_temp.assert_true((select count(*)=1 from public.plan_items),'lost ACK retries must not create a second native reminder');
  return;
 end if;
 adopted:=public.adopt_paige_reminder_approval('a2300000-0000-4000-8000-000000000030','a2300000-0000-4000-8000-000000000001',
 'a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000020',null,'0123456789abcdef',
 'a2300000-0000-4000-8000-000000000040','a2300000-0000-4000-8000-000000000041','a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060');
 wid:=(adopted->>'work_id')::uuid;
 perform pg_temp.assert_true(adopted->>'status'='adopted','exact approval adopted');
 perform pg_temp.assert_true(not adopted?'server_idempotency_key','no server key returned');
 result:=public.execute_paige_approved_reminder(wid,'a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000020',null,
 'a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060');
 rid:=(result->'original_result'->>'item_id')::uuid;
 replay:=public.execute_paige_approved_reminder(wid,'a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000020',null,
 'a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060');
 perform pg_temp.assert_true(result->>'replayed'='false' and replay->>'replayed'='true','lost ACK replays original terminal');
 perform pg_temp.assert_true(replay->'original_result'=result->'original_result','original native result stable');
 perform pg_temp.assert_true((select count(*)=1 from public.plan_items),'one reminder');
 perform pg_temp.assert_true((select count(*)=1 from public.audit_logs where action='plan_set_reminder'),'one native audit');
 perform pg_temp.assert_true((select count(*)=1 from public.paige_workspace_events where capability_key='plan_set_reminder'),'one native Rail');
 perform pg_temp.assert_true((select count(*)=1 from public.paige_durable_work where status='succeeded'),'one durable terminal');
 delete from public.plan_items where id=rid;
 replay:=public.execute_paige_approved_reminder(wid,'a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000020',null,null,null);
 perform pg_temp.assert_true(replay->>'historical'='true' and replay->'original_result'=result->'original_result','deleted original stays historical, never recreated');
 perform pg_temp.assert_true((select count(*)=0 from public.plan_items),'deleted reminder not recreated');
end $$;
create function pg_temp.reminder_case(n integer,overrides jsonb default '{}',bound boolean default true) returns uuid language plpgsql as $$
declare pid uuid:=('a2310000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 th uuid:=('a2320000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 insert into public.paige_chat_threads(id,caller_user_id,tenant_id) values(th,'a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010');
 insert into public.paige_pending_confirmations(id,user_id,tenant_id,thread_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
 values(pid,'a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010',th,'plan_set_reminder',lpad(to_hex(n),16,'0'),
 '{"title":"Review the neutral handoff","remind_at":"2030-01-02T09:00:00Z"}'::jsonb||overrides,'Neutral approved reminder',
 'a2300000-0000-4000-8000-000000000040',clock_timestamp()-interval '1 minute');
 perform public.paige_chat_interactive_begin_v2(th,'a2300000-0000-4000-8000-000000000050',null,'Approve exact native reminder',false,false,true);
 if bound then perform public.paige_chat_interactive_acquire_bound(th,'a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010',
 'a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060','a2300000-0000-4000-8000-000000000070',
 'abcdefghijklmnopqrst_a2300000-0000-4000-8000-000000000080_445');
 else perform public.paige_chat_interactive_executor_v2(th,'a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010',
  'a2300000-0000-4000-8000-000000000050','acquire');end if;
 return pid;
end $$;
create function pg_temp.adopt(pid uuid,ov jsonb default '{}') returns jsonb language plpgsql as $$
declare p public.paige_pending_confirmations%rowtype;
begin
 select * into strict p from public.paige_pending_confirmations where id=pid;
 return public.adopt_paige_reminder_approval(p.id,coalesce((ov->>'actor')::uuid,p.user_id),coalesce((ov->>'tenant')::uuid,p.tenant_id),
 coalesce((ov->>'thread')::uuid,p.thread_id),case when ov?'client' then (ov->>'client')::uuid else p.scoped_client_id end,
 coalesce(ov->>'fingerprint',p.fingerprint),coalesce((ov->>'issued')::uuid,p.issued_in_request),
 coalesce((ov->>'request')::uuid,'a2300000-0000-4000-8000-000000000041'),coalesce((ov->>'intent')::uuid,'a2300000-0000-4000-8000-000000000050'),
 coalesce((ov->>'runtime_nonce')::uuid,'a2300000-0000-4000-8000-000000000060'));
end $$;
create function pg_temp.execute_work(wid uuid,ov jsonb default '{}') returns jsonb language plpgsql as $$
declare w public.paige_durable_work%rowtype;
begin
 select * into strict w from public.paige_durable_work where id=wid;
 return public.execute_paige_approved_reminder(wid,coalesce((ov->>'tenant')::uuid,w.tenant_id),coalesce((ov->>'thread')::uuid,w.thread_id),
 (ov->>'client')::uuid,coalesce((ov->>'intent')::uuid,'a2300000-0000-4000-8000-000000000050'),
 coalesce((ov->>'runtime_nonce')::uuid,'a2300000-0000-4000-8000-000000000060'));
end $$;
create function pg_temp.refuses(statement text,expected_state text,label text) returns void language plpgsql as $$
declare refused boolean:=false;
begin
 begin execute statement;
 exception when others then
  if sqlstate is distinct from expected_state then raise exception 'Wrong refusal for %: % %',label,sqlstate,sqlerrm; end if;
  refused:=true;
 end;
 perform pg_temp.assert_true(refused,label);
end $$;
do $$declare pid uuid; wid uuid; th uuid; r jsonb; before_count bigint; field text; key text; val text; begin
 perform pg_temp.assert_true(has_function_privilege('service_role','public.adopt_paige_reminder_approval(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)','EXECUTE'),'service-only adoption grant');
 perform pg_temp.assert_true(not has_function_privilege('authenticated','public.adopt_paige_reminder_approval(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)','EXECUTE'),'authenticated cannot adopt approval');
 perform pg_temp.assert_true(not has_function_privilege('anon','public.adopt_paige_reminder_approval(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)','EXECUTE'),'anonymous cannot adopt approval');
 perform pg_temp.assert_true(has_function_privilege('authenticated','public.execute_paige_approved_reminder(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'original-JWT execution grant');
 perform pg_temp.assert_true(not has_function_privilege('service_role','public.execute_paige_approved_reminder(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'service cannot call executor');
 perform pg_temp.assert_true(not has_function_privilege('anon','public.execute_paige_approved_reminder(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'anonymous cannot call executor');
 foreach field in array array['scope(uuid,uuid,uuid,uuid)','runtime(uuid,uuid,uuid,uuid,uuid)','args(jsonb,uuid)','policy(uuid)'] loop
  perform pg_temp.assert_true(not has_function_privilege('authenticated','private.paige_reminder_'||field,'EXECUTE'),'internal helper sealed: '||field);
  perform pg_temp.assert_true(not has_function_privilege('service_role','private.paige_reminder_'||field,'EXECUTE'),'no service helper delegation: '||field);
 end loop;
 pid:=pg_temp.reminder_case(1);
 foreach key in array array['actor','tenant','thread','client','issued','intent','runtime_nonce'] loop
  perform pg_temp.refuses(format('select pg_temp.adopt(%L,%L)',pid,jsonb_build_object(key,'a2300000-0000-4000-8000-000000000002')),'42501','adoption rejects wrong '||key);
 end loop;
 perform pg_temp.refuses(format('select pg_temp.adopt(%L,%L)',pid,'{"fingerprint":"fedcba9876543210"}'),'42501','adoption rejects changed fingerprint');
 perform pg_temp.refuses(format('select pg_temp.adopt(%L,%L)',pid,'{"request":"a2300000-0000-4000-8000-000000000040"}'),'42501','same confirmation request cannot claim');
 perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'refusals preserve unconsumed approval');
 perform pg_temp.assert_true(not exists(select 1 from public.paige_durable_work where intent_id=pid),'refusals create no work');
 -- Re-read original exact work after an adopter ACK was lost, never a new claim.
 r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 r:=pg_temp.adopt(pid);perform pg_temp.assert_true(r->>'status'='existing' and (r->>'work_id')::uuid=wid,'adoption ACK loss returns exact envelope');
 perform pg_temp.assert_true((select intent_id=pid and attempt_count=1 and max_attempts=1 from public.paige_durable_work where id=wid),'stable proposal UUID and one dispatch attempt');
 foreach key in array array['tenant','thread','client','intent','runtime_nonce'] loop
  perform pg_temp.refuses(format('select pg_temp.execute_work(%L,%L)',wid,jsonb_build_object(key,'a2300000-0000-4000-8000-000000000002')),'42501','execution rejects wrong '||key);
 end loop;
 perform set_config('test.actor','a2300000-0000-4000-8000-000000000002',true);
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','foreign actor cannot execute');
 perform set_config('test.actor','',true);
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','NULL actor cannot execute');
 perform set_config('test.actor','a2300000-0000-4000-8000-000000000001',true);
 select thread_id into th from public.paige_durable_work where id=wid;
 foreach field in array array['is_archived','audience','profile','membership','rollout','latest','executor','hold','binding'] loop
  -- Each perturbation and refusal lives in its own rollback subtransaction.
  begin
   case field
   when 'is_archived' then update public.paige_chat_threads set is_archived=true where id=th;
   when 'audience' then update public.paige_chat_threads set audience='customer_private' where id=th;
   when 'profile' then update public.profiles set active_tenant_id='a2300000-0000-4000-8000-000000000011';
   when 'membership' then update public.tenant_members set status='inactive';
   when 'rollout' then update public.paige_chat_interactive_rollout set active=false;
   when 'latest' then update public.paige_chat_threads set interactive_latest_intent=gen_random_uuid() where id=th;
   when 'executor' then update public.paige_chat_threads set interactive_executor_intent=null where id=th;
   when 'hold' then update public.paige_chat_threads set interactive_recovery_hold=gen_random_uuid(),interactive_executor_intent=null where id=th;
   when 'binding' then update public.paige_chat_threads set interactive_runtime_binding=interactive_runtime_binding||'{"mode":"read_only_recovery"}' where id=th;
   end case;
   perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','fresh dispatch gate: '||field);
   raise exception 'rollback test mutation' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null; end;
 end loop;
 -- Actual native Stop, not a caller boolean.
 begin
  perform public.paige_chat_interactive_begin_v2(th,null,'a2300000-0000-4000-8000-000000000050','',false,true,true);
  perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','native Stop prevents reminder dispatch');
  raise exception 'rollback test mutation' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 perform pg_temp.assert_true((select count(*)=0 from public.plan_items),'all effect gate refusals create no reminder');
 -- Corrupt generic terminal JSON has no original native audit/Rail proof.
 begin
  perform public.transition_paige_durable_work(wid,(select idempotency_key from public.paige_durable_work where id=wid),'succeeded',
   jsonb_build_object('verified_readback',true,'receipt_version',1,'work_id',wid,'native_args',(select request_payload->'native_args' from public.paige_durable_work where id=wid)),'Invented generic result');
  perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'55000','generic terminal JSON cannot manufacture reminder success');
  raise exception 'rollback test mutation' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 -- Old consumed/declined approval without a native seal is never adopted.
 pid:=pg_temp.reminder_case(2);update public.paige_pending_confirmations set consumed_at=clock_timestamp() where id=pid;
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','historical consumed or declined approval unavailable');
 pid:=pg_temp.reminder_case(3);update public.paige_pending_confirmations set expires_at=clock_timestamp()-interval '1 minute' where id=pid;
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','expired approval unavailable');
 pid:=pg_temp.reminder_case(4);update public.paige_pending_confirmations set server_issued_at=null where id=pid;
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','browser/legacy unissued row unavailable');
 pid:=pg_temp.reminder_case(5);update public.paige_pending_confirmations set server_issued_at=clock_timestamp()+interval '1 minute' where id=pid;
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','proposal must predate canonical current admission');
 pid:=pg_temp.reminder_case(6);update public.paige_pending_confirmations set args=args||'{"unapproved_extra":"no"}' where id=pid;
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'22023','unknown stored argument fails closed');
 -- Named compatibility exclusion leaves exact proposal and old path intact.
 pid:=pg_temp.reminder_case(7);update public.paige_pending_confirmations set scoped_client_id='a2300000-0000-4000-8000-000000000090' where id=pid;
 r:=pg_temp.adopt(pid);perform pg_temp.assert_true(r->>'unsupported_reason'='client_focus_compatibility','client-focused typed path explicitly unsupported');
 perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'client compatibility does not consume');
 perform pg_temp.assert_true(not exists(select 1 from public.paige_durable_work where intent_id=pid),'client compatibility creates no envelope');
 pid:=pg_temp.reminder_case(8,'{}',false);
 r:=pg_temp.adopt(pid);perform pg_temp.assert_true(r->>'unsupported_reason'='unbound_runtime_compatibility','valid old executor explicitly unsupported');
 perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'old runtime compatibility does not consume');
 -- Fresh scope remains necessary for settled historical reads, but Stop/hold/latest do not reauthorize effects.
 r:=pg_temp.execute_work(wid);before_count:=(select count(*) from public.audit_logs);
 update public.paige_pending_confirmations set expires_at=clock_timestamp()-interval '1 minute' where id=(select intent_id from public.paige_durable_work where id=wid);
 update public.paige_chat_threads set interactive_latest_intent=null,interactive_executor_intent=null,interactive_recovery_hold=gen_random_uuid() where id=th;
 perform pg_temp.assert_true(pg_temp.execute_work(wid)->>'historical'='true','terminal replay during expiry/hold/latest mismatch reads history only');
 perform pg_temp.assert_true((select count(*)=before_count from public.audit_logs),'historical replay makes no second native audit');
 update public.plan_items set title='Later legitimate changed title',remind_at='2031-01-01' where id=(r->'original_result'->>'item_id')::uuid;
 perform pg_temp.assert_true(pg_temp.execute_work(wid)->'original_readback'=r->'original_readback','later record edit cannot relabel original receipt');
 begin
  update public.profiles set active_tenant_id='a2300000-0000-4000-8000-000000000011';
  perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','history does not borrow a newer workspace');
  raise exception 'rollback test mutation' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
end $$;
create function pg_temp.inject_failure() returns trigger language plpgsql as $$begin
 raise exception 'Injected reminder transaction failure: %',tg_argv[0] using errcode='P0001'; end $$;
do $$declare pid uuid; wid uuid; stage text; stmt text; before_items bigint; before_audits bigint; before_rails bigint; r jsonb; begin
 -- Each adoption stage must roll back the original approval CAS as well as work.
 foreach stage in array array['consume','create','seal'] loop
  pid:=pg_temp.reminder_case(case stage when 'consume' then 101 when 'create' then 102 else 103 end);
  stmt:=case stage
   when 'consume' then 'create trigger reminder_injection after update on public.paige_pending_confirmations for each row when(new.consumed_at is not null) execute function pg_temp.inject_failure(''consume'')'
   when 'create' then 'create trigger reminder_injection before insert on public.paige_durable_work for each row execute function pg_temp.inject_failure(''create'')'
   else 'create trigger reminder_injection before update on public.paige_durable_work for each row when(new.request_payload is not null) execute function pg_temp.inject_failure(''seal'')' end;
  execute stmt;
  perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'P0001','injected adoption rollback: '||stage);
  execute 'drop trigger reminder_injection on public.'||case when stage='consume' then 'paige_pending_confirmations' else 'paige_durable_work' end;
  perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'approval CAS rolled back: '||stage);
  perform pg_temp.assert_true(not exists(select 1 from public.paige_durable_work where intent_id=pid),'no partial envelope: '||stage);
 end loop;
 -- Mutation/audit/Rail/terminal share one PostgreSQL transaction. No new receipt.
 foreach stage in array array['writer','audit','rail','provenance','terminal'] loop
  pid:=pg_temp.reminder_case(case stage when 'writer' then 104 when 'audit' then 105 when 'rail' then 106 when 'provenance' then 109 else 107 end);
  r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
  before_items:=(select count(*) from public.plan_items);before_audits:=(select count(*) from public.audit_logs);before_rails:=(select count(*) from public.paige_workspace_events);
  stmt:=case stage
   when 'writer' then 'create trigger reminder_injection before insert on public.plan_items for each row execute function pg_temp.inject_failure(''writer'')'
   when 'audit' then 'create trigger reminder_injection before insert on public.audit_logs for each row execute function pg_temp.inject_failure(''audit'')'
   when 'rail' then 'create trigger reminder_injection before insert on public.paige_workspace_events for each row execute function pg_temp.inject_failure(''rail'')'
   when 'provenance' then 'create trigger reminder_injection before update on public.audit_logs for each row execute function pg_temp.inject_failure(''provenance'')'
   else 'create trigger reminder_injection before update on public.paige_durable_work for each row when(new.status=''succeeded'') execute function pg_temp.inject_failure(''terminal'')' end;
  execute stmt;
  perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'P0001','injected execution rollback: '||stage);
  execute 'drop trigger reminder_injection on public.'||case stage when 'writer' then 'plan_items' when 'audit' then 'audit_logs' when 'rail' then 'paige_workspace_events' when 'provenance' then 'audit_logs' else 'paige_durable_work' end;
  perform pg_temp.assert_true((select count(*)=before_items from public.plan_items),'writer rolled back: '||stage);
  perform pg_temp.assert_true((select count(*)=before_audits from public.audit_logs),'audit rolled back: '||stage);
  perform pg_temp.assert_true((select count(*)=before_rails from public.paige_workspace_events),'Rail rolled back: '||stage);
  perform pg_temp.assert_true((select status='claimed' and dispatch_started_attempt=0 and terminal_outcome is null from public.paige_durable_work where id=wid),'no partial dispatch/terminal: '||stage);
  r:=pg_temp.execute_work(wid);
  perform pg_temp.assert_true(r->>'status'='succeeded','rollback permits original exact native attempt: '||stage);
 end loop;
 -- Actual role entry, not just a postgres invocation with a synthetic auth.uid.
 pid:=pg_temp.reminder_case(108);
 set local role service_role;
 r:=public.adopt_paige_reminder_approval(pid,'a2300000-0000-4000-8000-000000000001','a2300000-0000-4000-8000-000000000010',
 'a2320000-0000-4000-8000-000000000108',null,lpad(to_hex(108),16,'0'),'a2300000-0000-4000-8000-000000000040',
 'a2300000-0000-4000-8000-000000000041','a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060');
 reset role;wid:=(r->>'work_id')::uuid;
 set local role authenticated;
 r:=public.execute_paige_approved_reminder(wid,'a2300000-0000-4000-8000-000000000010','a2320000-0000-4000-8000-000000000108',null,
 'a2300000-0000-4000-8000-000000000050','a2300000-0000-4000-8000-000000000060');
 reset role;
 perform pg_temp.assert_true(r->>'status'='succeeded','actual service-adopt then authenticated native execution roles');
end $$;
do $$declare pid uuid; wid uuid; r jsonb; original jsonb; made record; th uuid; n integer; begin
 -- The canonical generic creator can neither seal nor execute an approval.
 pid:=pg_temp.reminder_case(201);select thread_id into th from public.paige_pending_confirmations where id=pid;
 select * into made from public.create_paige_durable_work('a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000001',pid,th,
 'planning.set_reminder','approved_reminder','{"tenant_id":"a2300000-0000-4000-8000-000000000010","actor_user_id":"a2300000-0000-4000-8000-000000000001"}',pid::text);
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','generic row cannot be upgraded into an adopted approval');
 perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'generic-row conflict does not consume approval');
 update public.paige_pending_confirmations set consumed_at=clock_timestamp() where id=pid;
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',made.work_id),'42501','consumed_at plus generic envelope is not an approval seal');
 perform public.transition_paige_durable_work(made.work_id,made.server_idempotency_key,'succeeded','{"verified_readback":true}','Fabricated generic terminal');
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',made.work_id),'42501','generic forged terminal still has no adoption seal');
 -- Current request/runtime nonces are deliberately distinct and cannot crossbind.
 pid:=pg_temp.reminder_case(202);
 perform pg_temp.refuses(format('select pg_temp.adopt(%L,%L)',pid,'{"runtime_nonce":"a2300000-0000-4000-8000-000000000041"}'),'42501','confirmation nonce is not runtime admission nonce');
 update public.paige_chat_threads set audience='customer_private' where id=(select thread_id from public.paige_pending_confirmations where id=pid);
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','customer-private admission cannot adopt owner work');
 -- Exact NULL-thread compatibility, never a disappeared/malformed bound thread.
 pid:=pg_temp.reminder_case(203);update public.paige_pending_confirmations set thread_id=null where id=pid;
 r:=pg_temp.adopt(pid);perform pg_temp.assert_true(r->>'unsupported_reason'='threadless_native_compatibility','canonical NULL-thread proposal retains named legacy path');
 perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'threadless compatibility does not consume');
 pid:=pg_temp.reminder_case(204);delete from public.paige_chat_threads where id=(select thread_id from public.paige_pending_confirmations where id=pid);
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','disappeared nonnull thread never becomes threadless');
 -- Native policy: self reminder for member; team/another assignee needs current app admin.
 insert into public.tenant_members(tenant_id,user_id,status,role) values('a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000002','active','member');
 pid:=pg_temp.reminder_case(205,'{"target":"team"}');r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 update public.tenant_members set role='owner' where user_id='a2300000-0000-4000-8000-000000000001';
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','tenant owner without app admin cannot create team reminder');
 insert into public.user_roles values('a2300000-0000-4000-8000-000000000001','admin');
 r:=pg_temp.execute_work(wid);perform pg_temp.assert_true(r->'original_readback'->>'remind_target'='team' and r->'original_readback'->'assigned_to_user_id'='null'::jsonb,'current app admin preserves native team reminder');
 delete from public.user_roles;
 pid:=pg_temp.reminder_case(206,'{"target_user_id":"a2300000-0000-4000-8000-000000000002"}');r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','ordinary member cannot target another member');
 insert into public.user_roles values('a2300000-0000-4000-8000-000000000001','super_admin');
 r:=pg_temp.execute_work(wid);perform pg_temp.assert_true(r->'original_readback'->>'assigned_to_user_id'='a2300000-0000-4000-8000-000000000002','current super admin preserves native other-member reminder');
 delete from public.user_roles;
 -- All nine stored native fields, including title trimming and incumbent channel normalization.
 insert into public.clients(id,tenant_id) values('a2300000-0000-4000-8000-000000000090','a2300000-0000-4000-8000-000000000010'),
 ('a2300000-0000-4000-8000-000000000091','a2300000-0000-4000-8000-000000000011');
 insert into public.plans(id,tenant_id,created_by,scope,horizon,title,starts_on,ends_on) values
 ('a2300000-0000-4000-8000-000000000092','a2300000-0000-4000-8000-000000000010','a2300000-0000-4000-8000-000000000001','individual','week','Neutral plan','2030-01-01','2030-01-07');
 pid:=pg_temp.reminder_case(207,'{"title":"  Exact approved title  ","summary":"Approved internal reminder","channel":"sms","plan_id":"a2300000-0000-4000-8000-000000000092","contact_id":"a2300000-0000-4000-8000-000000000090"}');
 r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;r:=pg_temp.execute_work(wid);original:=r;
 perform pg_temp.assert_true(r->'original_readback'->>'title'='Exact approved title','native trimmed stored title');
 perform pg_temp.assert_true(r->'original_readback'->>'summary'='Approved internal reminder','stored summary unchanged');
 perform pg_temp.assert_true(r->'original_readback'->>'remind_channel'='in_app','incumbent non-email normalization unchanged');
 perform pg_temp.assert_true(r->'original_readback'->>'plan_id'='a2300000-0000-4000-8000-000000000092','stored plan exact');
 perform pg_temp.assert_true(r->'original_readback'->>'contact_id'='a2300000-0000-4000-8000-000000000090','stored domain contact exact');
 perform pg_temp.assert_true((select data->>'target'='user' and data->>'remind_at' is not null and data->>'contact_id'='a2300000-0000-4000-8000-000000000090'
  from public.audit_logs where id=(r->'original_result'->>'receipt_run_id')::uuid),'native audit original data retained alongside provenance');
 set local timezone='America/Los_Angeles';r:=pg_temp.execute_work(wid);reset timezone;
 perform pg_temp.assert_true(r->'original_result'=original->'original_result' and r->'original_readback'=original->'original_readback','historical receipt survives different session timezone');
 -- The current native target row, membership and role remain authority at execution.
 pid:=pg_temp.reminder_case(208,'{"contact_id":"a2300000-0000-4000-8000-000000000091"}');r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','foreign domain contact not usable');
 pid:=pg_temp.reminder_case(209,'{"target_user_id":"a2300000-0000-4000-8000-000000000002"}');r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 insert into public.user_roles values('a2300000-0000-4000-8000-000000000001','admin');
 update public.tenant_members set status='inactive' where user_id='a2300000-0000-4000-8000-000000000002';
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','assignee revocation before writer is effective');
 delete from public.user_roles;update public.tenant_members set status='active' where user_id='a2300000-0000-4000-8000-000000000002';
 pid:=pg_temp.reminder_case(210);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 update public.paige_durable_work set lease_until=clock_timestamp()-interval '1 second' where id=wid;
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'55000','expired unexecuted lease cannot dispatch');
 -- No fresh approval is inferred from a generic unknown/blocked work state.
 foreach n in array array[211,212] loop
  pid:=pg_temp.reminder_case(n);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
  perform public.transition_paige_durable_work(wid,(select idempotency_key from public.paige_durable_work where id=wid),
   case when n=211 then 'outcome_unknown' else 'blocked' end,null,null,case when n=212 then 'Native review required' end);
  perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'55000','no automatic unknown/blocked recovery: '||n);
 end loop;
end $$;
do $$declare pid uuid; wid uuid; r jsonb; begin
 pid:=pg_temp.reminder_case(301);
 insert into public.tenant_tool_autonomy(tenant_id,tool_key,mode)values('a2300000-0000-4000-8000-000000000010','plan_set_reminder','off');
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','current OFF cannot consume an approval');
 perform pg_temp.assert_true((select consumed_at is null from public.paige_pending_confirmations where id=pid),'OFF adoption leaves proposal unconsumed');
 update public.tenant_tool_autonomy set mode='confirm';r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 update public.tenant_tool_autonomy set mode='off';
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','OFF pulled after adoption prevents native effect');
 perform pg_temp.assert_true((select dispatch_started_attempt=0 and status='claimed' from public.paige_durable_work where id=wid),'OFF leaves original unexecuted envelope');
 update public.tenant_tool_autonomy set mode='auto';r:=pg_temp.execute_work(wid);
 perform pg_temp.assert_true(r->>'status'='succeeded','AUTO still spends only the exact already approved intent');
 update public.tenant_tool_autonomy set mode='off';
 perform pg_temp.assert_true(pg_temp.execute_work(wid)->>'historical'='true','OFF does not suppress historical terminal read');
 delete from public.tenant_tool_autonomy;
 pid:=pg_temp.reminder_case(302);
 insert into public.admin_app_settings values('paige_trust_compass','{"ceiling":0}');
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','canonical Trust rung0 refuses adoption');
 delete from public.admin_app_settings;
 r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 insert into public.admin_app_settings values('paige_trust_compass','{"ceiling":0}');
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'42501','canonical Trust rung0 refuses adopted dispatch');
 delete from public.admin_app_settings;
 insert into public.admin_app_settings values('paige_trust_compass',jsonb_build_object('ceiling',2,'attested_at',clock_timestamp()));
 insert into public.paige_systems_check_registry values('operator_cross_tenant_canary','operator');
 insert into public.paige_systems_check_finding(check_id,status,evidence)values('operator_cross_tenant_canary','fail','{"reason":"Synthetic policy race control"}');
 perform pg_temp.assert_true(public.resolve_tool_autonomy('a2300000-0000-4000-8000-000000000010','plan_set_reminder')='confirm','incumbent safety failure demotes to human-reviewed CONFIRM, not invented OFF');
 r:=pg_temp.execute_work(wid);perform pg_temp.assert_true(r->>'status'='succeeded','explicit approval remains valid under canonical rung1');
end $$;
do $$declare pid uuid; wid uuid; r jsonb; th uuid; consumed timestamptz; ver bigint; begin
 pid:=pg_temp.reminder_case(303);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 select thread_id,consumed_at into th,consumed from public.paige_pending_confirmations where id=pid;
 update public.paige_durable_work set lease_until=now()-interval '1 second' where id=wid;
 perform public.paige_chat_interactive_begin_v2(th,null,'a2300000-0000-4000-8000-000000000050','',false,true,true);
 r:=pg_temp.adopt(pid);
 perform pg_temp.assert_true(r->>'status'='existing' and r->>'work_status'='expired','stopped no-effect expired original normalizes only to canonical expired');
 perform pg_temp.assert_true((select status='expired' and dispatch_started_attempt=0 and terminal_outcome is null and lease_until is null from public.paige_durable_work where id=wid),'expired is neither success nor a reclaimed dispatch');
 perform pg_temp.assert_true((select consumed_at=consumed from public.paige_pending_confirmations where id=pid),'expiry never unconsumes original approval');
 select version into ver from public.paige_durable_work where id=wid;r:=pg_temp.adopt(pid);
 perform pg_temp.assert_true((select version=ver from public.paige_durable_work where id=wid),'repeat expiry observation does not transition again');
 perform pg_temp.refuses(format('select pg_temp.execute_work(%L)',wid),'55000','expired original cannot redispatch after cleanup');
 pid:=pg_temp.reminder_case(304);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 perform public.transition_paige_durable_work(wid,(select idempotency_key from public.paige_durable_work where id=wid),'outcome_unknown');
 r:=pg_temp.adopt(pid);perform pg_temp.assert_true(r->>'work_status'='outcome_unknown','unknown is not expired/reconciled/reclaimed by adoption');
 pid:=pg_temp.reminder_case(305);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 update public.paige_durable_work set lease_until=now()-interval '1 second' where id=wid;
 insert into public.audit_logs(user_id,entity,action,entity_id,data)values('a2300000-0000-4000-8000-000000000001','plan_item','diagnostic_test_only',gen_random_uuid(),jsonb_build_object('approved_reminder_work_id',wid));
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'55000','any existing native correlation prevents no-effect expiry normalization');
 perform pg_temp.assert_true((select status='claimed' from public.paige_durable_work where id=wid),'ambiguous correlation remains held, not falsely expired');
 pid:=pg_temp.reminder_case(306);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 update public.paige_durable_work set lease_until=now()-interval '1 second' where id=wid;
 update public.profiles set active_tenant_id='a2300000-0000-4000-8000-000000000011';
 perform pg_temp.refuses(format('select pg_temp.adopt(%L)',pid),'42501','expiry observation still requires current original workspace');
 perform pg_temp.assert_true((select status='claimed' from public.paige_durable_work where id=wid),'wrong workspace cannot normalize work');
 update public.profiles set active_tenant_id='a2300000-0000-4000-8000-000000000010';
 r:=pg_temp.adopt(pid);perform pg_temp.assert_true(r->>'work_status'='expired','valid original workspace may observe no-effect expiry');
end $$;
create function pg_temp.resolve_reminder(pid uuid,ov jsonb default '{}') returns jsonb language plpgsql as $$
declare p public.paige_pending_confirmations%rowtype;
begin
 select * into strict p from public.paige_pending_confirmations where id=pid;
 return public.resolve_paige_reminder_approval(p.id,coalesce((ov->>'tenant')::uuid,p.tenant_id),
  coalesce((ov->>'thread')::uuid,p.thread_id),(ov->>'client')::uuid);
end $$;

do $$declare pid uuid; wid uuid; th uuid; r jsonb; before_work jsonb; before_proposal jsonb; mode text; field text;
 n integer:=400; made record; p public.paige_pending_confirmations%rowtype; seal jsonb; effect_counts jsonb; before_effects jsonb;
begin
 perform pg_temp.assert_true(to_regprocedure('pg_catalog.sha256(bytea)') is not null,'SHA256 is a pg_catalog builtin, not a new extension');
 perform pg_temp.assert_true(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('abc','UTF8')),'hex')=
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','actual builtin SHA256 known vector');
 perform pg_temp.assert_true(has_function_privilege('authenticated','public.resolve_paige_reminder_approval(uuid,uuid,uuid,uuid)','EXECUTE'),'original-JWT resolver grant');
 foreach mode in array array['anon','service_role'] loop
  perform pg_temp.assert_true(not has_function_privilege(mode,'public.resolve_paige_reminder_approval(uuid,uuid,uuid,uuid)','EXECUTE'),'resolver has no '||mode||' grant');
  perform pg_temp.assert_true(not has_table_privilege(mode,'public.paige_durable_work','SELECT'),'resolver adds no raw durable SELECT: '||mode);
 end loop;
 perform pg_temp.assert_true(not has_table_privilege('authenticated','public.paige_durable_work','SELECT'),'resolver adds no authenticated table SELECT');
 pid:=pg_temp.reminder_case(400);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 select thread_id,to_jsonb(w) into th,before_work from public.paige_durable_work w where id=wid;
 select to_jsonb(p0) into before_proposal from public.paige_pending_confirmations p0 where id=pid;
 select jsonb_build_array((select count(*) from public.plan_items),(select count(*) from public.audit_logs),
  (select count(*) from public.paige_workspace_events)) into before_effects;
 set local role authenticated;
 r:=public.resolve_paige_reminder_approval(pid,'a2300000-0000-4000-8000-000000000010',th,null);
 reset role;
 perform pg_temp.assert_true(r=jsonb_build_object('v',1,'proposal_id',pid,'work_id',wid,'work_status','claimed'),'actual authenticated resolver returns only closed opaque binding/status');
 perform pg_temp.assert_true((select to_jsonb(w)=before_work from public.paige_durable_work w where id=wid)
  and (select to_jsonb(p0)=before_proposal from public.paige_pending_confirmations p0 where id=pid),'resolver does not consume/transition/normalize work');
 perform pg_temp.assert_true(before_effects=jsonb_build_array((select count(*) from public.plan_items),(select count(*) from public.audit_logs),
  (select count(*) from public.paige_workspace_events)),'resolver creates no reminder/audit/Rail');
 perform pg_temp.refuses(format('insert into public.paige_durable_work select (jsonb_populate_record(null::public.paige_durable_work,
  to_jsonb(w)||jsonb_build_object(''id'',gen_random_uuid(),''idempotency_key'',''local_duplicate_intent''))).* from public.paige_durable_work w where id=%L',wid),
  '23505','native unique actor/tenant/proposal intent refuses ambiguous work identity');
 foreach mode in array array['anon','service_role'] loop
  begin
   execute format('set local role %I',mode);
   perform public.resolve_paige_reminder_approval(pid,'a2300000-0000-4000-8000-000000000010',th,null);
   reset role;raise exception 'resolver unexpectedly callable by %',mode;
  exception when insufficient_privilege then reset role;perform pg_temp.assert_true(true,'actual denied resolver role: '||mode);end;
 end loop;
 foreach field in array array['tenant','thread','client'] loop
  perform pg_temp.refuses(format('select pg_temp.resolve_reminder(%L,%L)',pid,jsonb_build_object(field,'a2300000-0000-4000-8000-000000000002')),'42501','resolver exact '||field||' binding');
 end loop;
 foreach field in array array['actor','null_actor','profile','membership','tenant_status','audience','archive'] loop
  begin
   case field
    when 'actor' then perform set_config('test.actor','a2300000-0000-4000-8000-000000000002',true);
    when 'null_actor' then perform set_config('test.actor','',true);
    when 'profile' then update public.profiles set active_tenant_id='a2300000-0000-4000-8000-000000000011';
    when 'membership' then update public.tenant_members set status='inactive';
    when 'tenant_status' then update public.tenants set status='suspended' where id='a2300000-0000-4000-8000-000000000010';
    when 'audience' then update public.paige_chat_threads set audience='customer_private' where id=th;
    when 'archive' then update public.paige_chat_threads set is_archived=true where id=th;
   end case;
   perform pg_temp.refuses(format('select pg_temp.resolve_reminder(%L)',pid),'42501','resolver fresh scope: '||field);
   raise exception 'rollback resolver scope control' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;
 end loop;
 -- Lookup remains observation, even under Stop/OFF/hold/expiry. It must not
 -- activate policy/runtime, normalize expired claims or supply a terminal receipt.
 update public.paige_pending_confirmations set expires_at=now()-interval '1 second' where id=pid;
 update public.paige_durable_work set lease_until=now()-interval '1 second' where id=wid;
 perform public.paige_chat_interactive_begin_v2(th,null,'a2300000-0000-4000-8000-000000000050','',false,true,true);
 update public.paige_chat_threads set interactive_recovery_hold=gen_random_uuid(),interactive_executor_intent=null where id=th;
 insert into public.tenant_tool_autonomy values('a2300000-0000-4000-8000-000000000010','plan_set_reminder','off');
 select to_jsonb(w) into before_work from public.paige_durable_work w where id=wid;
 r:=pg_temp.resolve_reminder(pid);
 perform pg_temp.assert_true(r->>'work_status'='claimed' and (select to_jsonb(w)=before_work from public.paige_durable_work w where id=wid),'expired held/OFF/Stop lookup has no normalization/dispatch');
 delete from public.tenant_tool_autonomy;
 foreach mode in array array['claimed','blocked','expired','outcome_unknown','failed','cancelled','succeeded'] loop
  n:=n+1;pid:=pg_temp.reminder_case(n);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
  if mode='succeeded' then perform pg_temp.execute_work(wid);
  elsif mode<>'claimed' then
   if mode='expired' then update public.paige_durable_work set lease_until=now()-interval '1 second' where id=wid;end if;
   perform public.transition_paige_durable_work(wid,(select idempotency_key from public.paige_durable_work where id=wid),mode,
    case when mode in('failed','cancelled') then '{"reason":"Local no-effect state control"}'::jsonb end,null,
    case when mode='blocked' then 'Local native review required' end);
  end if;
  select to_jsonb(w) into before_work from public.paige_durable_work w where id=wid;
  r:=pg_temp.resolve_reminder(pid);
  perform pg_temp.assert_true(r=jsonb_build_object('v',1,'proposal_id',pid,'work_id',wid,'work_status',mode),'resolver projects exact canonical '||mode);
  perform pg_temp.assert_true((select to_jsonb(w)=before_work from public.paige_durable_work w where id=wid),'lookup leaves '||mode||' unchanged');
 end loop;
 -- Deliberately malformed generic envelopes are written only by this disposable
 -- database owner. There is no new caller grant or API to mint these seals.
 foreach field in array array['unsealed','v','proposal_id','fingerprint','issued_nonce','client_id','original_thread_id',
  'stored_args','native_args','consumed_at_epoch','scope_epoch','work_kind','capability_key','thread_id','intent_id'] loop
  n:=n+1;pid:=pg_temp.reminder_case(n);select * into p from public.paige_pending_confirmations where id=pid;
  update public.paige_pending_confirmations set consumed_at=clock_timestamp() where id=pid returning * into p;
  select * into made from public.create_paige_durable_work(p.tenant_id,p.user_id,
   case when field='intent_id' then gen_random_uuid() else pid end,
   case when field='thread_id' then 'a2300000-0000-4000-8000-000000000020'::uuid else p.thread_id end,
   case when field='capability_key' then 'document_generate' else 'planning.set_reminder' end,
   case when field='work_kind' then 'document_authoring' else 'approved_reminder' end,
   jsonb_build_object('tenant_id',p.tenant_id,'actor_user_id',p.user_id),
   case when field='scope_epoch' then 'incorrect-scope' else pid::text end,300,1);
  seal:=jsonb_build_object('v',1,'proposal_id',pid,'fingerprint',p.fingerprint,'issued_nonce',p.issued_in_request,
   'client_id',null,'original_thread_id',p.thread_id,'stored_args',p.args,'native_args',private.paige_reminder_args(p.args,p.tenant_id),
   'consumed_at_epoch',extract(epoch from p.consumed_at));
  if field in('v','proposal_id','fingerprint','issued_nonce','client_id','original_thread_id','stored_args','native_args','consumed_at_epoch') then
   seal:=seal||jsonb_build_object(field,case when field='v' then '2'::jsonb when field in('stored_args','native_args') then '{}'::jsonb else to_jsonb('incorrect'::text) end);
  end if;
  if field<>'unsealed' then update public.paige_durable_work set request_payload=seal where id=made.work_id;end if;
  perform pg_temp.refuses(format('select pg_temp.resolve_reminder(%L)',pid),'42501','resolver refuses generic/mismatched seal: '||field);
 end loop;
 pid:=pg_temp.reminder_case(450);
 perform pg_temp.refuses(format('select pg_temp.resolve_reminder(%L)',pid),'42501','unconsumed proposal cannot resolve work');
 update public.paige_pending_confirmations set consumed_at=clock_timestamp() where id=pid;
 perform pg_temp.refuses(format('select pg_temp.resolve_reminder(%L)',pid),'42501','old consumed proposal without bridge cannot resolve');
 perform pg_temp.refuses('select public.resolve_paige_reminder_approval(gen_random_uuid(),''a2300000-0000-4000-8000-000000000010'',''a2300000-0000-4000-8000-000000000020'',null)','42501','missing proposal returns no binding');
end $$;

do $$declare pid uuid; wid uuid; th uuid; r jsonb; original jsonb; original_audit jsonb; audit_id uuid; mode text; field text;
 before_work jsonb; before_effects jsonb; n integer:=500; begin
 foreach mode in array array['claimed','blocked','expired','outcome_unknown','failed','cancelled'] loop
  n:=n+1;pid:=pg_temp.reminder_case(n);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
  select thread_id into th from public.paige_durable_work where id=wid;
  if mode<>'claimed' then
   if mode='expired' then update public.paige_durable_work set lease_until=now()-interval '1 second' where id=wid;end if;
   perform public.transition_paige_durable_work(wid,(select idempotency_key from public.paige_durable_work where id=wid),mode,
    case when mode in('failed','cancelled') then '{"reason":"Local no-effect history control"}'::jsonb end,null,
    case when mode='blocked' then 'Local native review required' end);
  end if;
  select to_jsonb(w) into before_work from public.paige_durable_work w where id=wid;
  select jsonb_build_array((select count(*) from public.plan_items),(select count(*) from public.audit_logs),
   (select count(*) from public.paige_workspace_events)) into before_effects;
  perform pg_temp.refuses(format('select public.execute_paige_approved_reminder(%L,%L,%L,null,null,null)',wid,
   'a2300000-0000-4000-8000-000000000010',th),case when mode='claimed' then '42501' else '55000' end,'NULL pair cannot execute native '||mode);
  perform pg_temp.assert_true((select to_jsonb(w)=before_work from public.paige_durable_work w where id=wid),'NULL-pair history leaves '||mode||' envelope unchanged');
  perform pg_temp.assert_true(before_effects=jsonb_build_array((select count(*) from public.plan_items),(select count(*) from public.audit_logs),
   (select count(*) from public.paige_workspace_events)),'NULL pair has no reminder/audit/Rail effect for '||mode);
 end loop;
 pid:=pg_temp.reminder_case(510);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 select thread_id into th from public.paige_durable_work where id=wid;
 perform pg_temp.refuses(format('select public.execute_paige_approved_reminder(%L,%L,%L,null,null,%L)',wid,
  'a2300000-0000-4000-8000-000000000010',th,'a2300000-0000-4000-8000-000000000060'),'42501','mixed NULL intent cannot dispatch');
 perform pg_temp.refuses(format('select public.execute_paige_approved_reminder(%L,%L,%L,null,%L,null)',wid,
  'a2300000-0000-4000-8000-000000000010',th,'a2300000-0000-4000-8000-000000000050'),'42501','mixed NULL runtime nonce cannot dispatch');
 r:=pg_temp.execute_work(wid);original:=r;audit_id:=(r->'original_result'->>'receipt_run_id')::uuid;
 select data into original_audit from public.audit_logs where id=audit_id;
 perform pg_temp.assert_true(not original_audit?'approved_reminder_args' and original_audit->>'approved_reminder_work_id'=wid::text
  and original_audit->>'approved_reminder_args_sha256'=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
   (select (request_payload->'native_args')::text from public.paige_durable_work where id=wid),'UTF8')),'hex'),'new native audit stores opaque seal digest without raw normalized args');
 foreach field in array array['missing_digest','wrong_digest','wrong_work','missing_audit','missing_rail'] loop
  begin
   case field
    when 'missing_digest' then update public.audit_logs set data=data-'approved_reminder_args_sha256' where id=audit_id;
    when 'wrong_digest' then update public.audit_logs set data=data||jsonb_build_object('approved_reminder_args_sha256',repeat('0',64)) where id=audit_id;
    when 'wrong_work' then update public.audit_logs set data=data||jsonb_build_object('approved_reminder_work_id',gen_random_uuid()) where id=audit_id;
    when 'missing_audit' then delete from public.audit_logs where id=audit_id;
    when 'missing_rail' then delete from public.paige_workspace_events where source_id=audit_id;
   end case;
   perform pg_temp.refuses(format('select public.execute_paige_approved_reminder(%L,%L,%L,null,null,null)',wid,
    'a2300000-0000-4000-8000-000000000010',th),'55000','native terminal history requires original work+digest+audit+Rail: '||field);
   raise exception 'rollback digest control' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;
 end loop;
 set local timezone='America/Los_Angeles';
 r:=public.execute_paige_approved_reminder(wid,'a2300000-0000-4000-8000-000000000010',th,null,null,null);
 reset timezone;
 perform pg_temp.assert_true(r->>'historical'='true' and r->'original_result'=original->'original_result' and r->'original_readback'=original->'original_readback','opaque digest replay preserves original native receipt under another timezone');
 perform pg_temp.assert_true((select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_object_agg(key,value order by key desc)::text,'UTF8')),'hex')
  from jsonb_each((select request_payload->'native_args' from public.paige_durable_work where id=wid)))=original_audit->>'approved_reminder_args_sha256','canonical jsonb key order cannot change normalized-args digest');
end $$;
-- Pass actual absence, never a fixture-generated runtime nonce. This differs from
-- pg_temp.adopt's incumbent non-NULL default and exercises the real ten-arg ABI.
create function pg_temp.adopt_nullable_nonce(pid uuid, current_intent uuid, runtime_nonce uuid)
returns jsonb language plpgsql as $$
declare p public.paige_pending_confirmations%rowtype;
begin
 select * into strict p from public.paige_pending_confirmations where id=pid;
 return public.adopt_paige_reminder_approval(p.id,p.user_id,p.tenant_id,p.thread_id,p.scoped_client_id,
  p.fingerprint,p.issued_in_request,'a2300000-0000-4000-8000-000000000041',current_intent,runtime_nonce);
end $$;

do $$declare pid uuid; th uuid; wid uuid; r jsonb; field text; n integer:=600; selected public.paige_pending_confirmations%rowtype;
 current_intent uuid:='a2300000-0000-4000-8000-000000000050'; supplied_intent uuid;
 before_effects jsonb; before_proposal jsonb; before_work jsonb;
begin
 pid:=pg_temp.reminder_case(n,'{}',false);
 select thread_id,to_jsonb(p) into th,before_proposal from public.paige_pending_confirmations p where id=pid;
 perform pg_temp.assert_true((select interactive_runtime_binding is null from public.paige_chat_threads where id=th)
  and (select count(*)=1 and bool_and(interactive_runtime_binding is null) from public.paige_chat_turns
   where thread_id=th and role='user' and interactive_intent_id=current_intent),'real incumbent thread AND admitted user turn are unbound');
 select jsonb_build_array((select count(*) from public.paige_durable_work),(select count(*) from public.plan_items),
  (select count(*) from public.audit_logs),(select count(*) from public.paige_workspace_events)) into before_effects;
 select * into strict selected from public.paige_pending_confirmations where id=pid;
 set local role service_role;
 r:=public.adopt_paige_reminder_approval(selected.id,selected.user_id,selected.tenant_id,selected.thread_id,selected.scoped_client_id,
  selected.fingerprint,selected.issued_in_request,'a2300000-0000-4000-8000-000000000041',current_intent,null);
 reset role;
 perform pg_temp.assert_true(r=jsonb_build_object('v',1,'status','unsupported','unsupported_reason','unbound_runtime_compatibility','proposal_id',pid),
  'current unbound intent with actual NULL nonce returns only named compatibility');
 perform pg_temp.assert_true((select to_jsonb(p)=before_proposal from public.paige_pending_confirmations p where id=pid),'NULL-nonce compatibility never consumes or rewrites approval');
 perform pg_temp.assert_true(before_effects=jsonb_build_array((select count(*) from public.paige_durable_work),(select count(*) from public.plan_items),
  (select count(*) from public.audit_logs),(select count(*) from public.paige_workspace_events)),'NULL-nonce compatibility creates no work/reminder/audit/Rail');

 foreach field in array array['bound','no_intent','wrong_intent','latest','executor','admitted','admission','hold','stop','rollout',
  'turn_binding_only','thread_binding_only','missing_turn','consumed','expired','policy_off'] loop
  n:=n+1;pid:=pg_temp.reminder_case(n,'{}',field='bound');
  select thread_id into th from public.paige_pending_confirmations where id=pid;
  supplied_intent:=current_intent;
  begin
   case field
    when 'no_intent' then supplied_intent:=null;
    when 'wrong_intent' then supplied_intent:='a2300000-0000-4000-8000-000000000099';
    when 'latest' then update public.paige_chat_threads set interactive_latest_intent=gen_random_uuid() where id=th;
    when 'executor' then update public.paige_chat_threads set interactive_executor_intent=null where id=th;
    when 'admitted' then update public.paige_chat_threads set interactive_admitted_intent=gen_random_uuid() where id=th;
    when 'admission' then update public.paige_chat_threads set interactive_admission='conversational' where id=th;
    when 'hold' then update public.paige_chat_threads set interactive_recovery_hold=gen_random_uuid(),interactive_executor_intent=null where id=th;
    when 'stop' then perform public.paige_chat_interactive_begin_v2(th,null,current_intent,'',false,true,true);
    when 'rollout' then update public.paige_chat_interactive_rollout set active=false;
    when 'turn_binding_only' then update public.paige_chat_turns set interactive_runtime_binding='{"v":1}' where thread_id=th and role='user';
    when 'thread_binding_only' then update public.paige_chat_threads set interactive_runtime_binding='{"v":1}' where id=th;
    when 'missing_turn' then delete from public.paige_chat_turns where thread_id=th and role='user';
    when 'consumed' then update public.paige_pending_confirmations set consumed_at=clock_timestamp() where id=pid;
    when 'expired' then update public.paige_pending_confirmations set expires_at=clock_timestamp()-interval '1 second' where id=pid;
    when 'policy_off' then insert into public.tenant_tool_autonomy values('a2300000-0000-4000-8000-000000000010','plan_set_reminder','off');
    else null;
   end case;
   select to_jsonb(p) into before_proposal from public.paige_pending_confirmations p where id=pid;
   select jsonb_build_array((select count(*) from public.paige_durable_work),(select count(*) from public.plan_items),
    (select count(*) from public.audit_logs),(select count(*) from public.paige_workspace_events)) into before_effects;
   perform pg_temp.refuses(format('select pg_temp.adopt_nullable_nonce(%L,%L,null)',pid,supplied_intent),'42501','NULL nonce preserves native refusal: '||field);
   perform pg_temp.assert_true((select to_jsonb(p)=before_proposal from public.paige_pending_confirmations p where id=pid),'NULL-nonce refusal leaves exact proposal unchanged: '||field);
   perform pg_temp.assert_true(before_effects=jsonb_build_array((select count(*) from public.paige_durable_work),(select count(*) from public.plan_items),
    (select count(*) from public.audit_logs),(select count(*) from public.paige_workspace_events)),'NULL-nonce refusal has no work/reminder/audit/Rail effect: '||field);
   raise exception 'rollback NULL-nonce refusal fixture' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;
 end loop;
 -- Compatibility observation never becomes permission for native execution.
 pid:=pg_temp.reminder_case(620);r:=pg_temp.adopt(pid);wid:=(r->>'work_id')::uuid;
 select thread_id,to_jsonb(w) into th,before_work from public.paige_durable_work w where id=wid;
 update public.paige_chat_threads set interactive_runtime_binding=null where id=th;
 update public.paige_chat_turns set interactive_runtime_binding=null where thread_id=th and role='user';
 select jsonb_build_array((select count(*) from public.plan_items),(select count(*) from public.audit_logs),
  (select count(*) from public.paige_workspace_events)) into before_effects;
 perform pg_temp.refuses(format('select public.execute_paige_approved_reminder(%L,%L,%L,null,%L,null)',wid,
  'a2300000-0000-4000-8000-000000000010',th,current_intent),'42501','unbound NULL-nonce compatibility cannot dispatch a sealed reminder');
 perform pg_temp.assert_true((select to_jsonb(w)=before_work from public.paige_durable_work w where id=wid),'unbound execution leaves claim/dispatch marker/terminal unchanged');
 perform pg_temp.assert_true(before_effects=jsonb_build_array((select count(*) from public.plan_items),(select count(*) from public.audit_logs),
  (select count(*) from public.paige_workspace_events)),'unbound execution creates no reminder/audit/Rail');
end $$;
select 'REMINDER_APPROVED_INTENT_PASS='||last_value from pg_temp.reminder_assertion_count;
rollback;
