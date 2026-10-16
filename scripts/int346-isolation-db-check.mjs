/** Actual native contracts; empty disposable localhost int336_test* databases only.
 * All actors/packets/clock edits below are synthetic test fixtures, never release evidence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;
const parsed=new URL(url);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.startsWith('/int336_test'))throw Error('Empty isolated localhost database required');
const root=path.resolve(import.meta.dirname,'..'),psql=process.env.PSQL_BIN??'psql';
const baselineOnly=process.argv.includes('--baseline-adoption');
const realWindow=process.argv.includes('--real-window-race');
const run=(sql)=>{
 const r=spawnSync(psql,['-X','-qAt','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
};
const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],{encoding:'utf8',env:process.env});
assert.equal(emitted.status,0,emitted.stderr);
const baseline=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
const strip=(name)=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
const issuance=strip('20270601000008_int346_server_issued_interactive_receipts.sql');
const conversational=strip('20270602000301_int346_conversational_admission.sql');
const candidate=fs.readFileSync(path.join(root,'supabase/migrations/20271108110000_int346_database_executor_isolation.sql'),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(2),tenant=id(3),legacy=id(30),legacyIntent=id(31),bound=id(32),boundIntent=id(33),fresh=id(34),freshIntent=id(35),next=id(36),conv=id(37);
const preconv=id(38),preconvIntent=id(39);
const auth=`set test.actor='${actor}';set test.tenant='${tenant}';set role authenticated;`;
const service='reset role;set role service_role;';
const activate=`select public.paige_chat_interactive_activate(repeat('a',40),repeat('b',64),'database_executor_isolation');`;
const activatePerform=activate.replace(/^select /,'perform ');
run(baseline+issuance+conversational+`commit;
insert into paige_chat_threads(id,caller_user_id,tenant_id,interactive_latest_intent)values
('${legacy}','${actor}','${tenant}','${legacyIntent}'),('${bound}','${actor}','${tenant}','${boundIntent}'),('${fresh}','${actor}','${tenant}',null);
${auth}
select paige_chat_turn_append('${legacy}','user','Synthetic legacy instruction',null,null,null,null,null,
 '{"interactive":{"request_intent_id":"${legacyIntent}"}}',null);
reset role;`);
run(`insert into paige_chat_threads(id,caller_user_id,tenant_id)values('${preconv}','${actor}','${tenant}');${auth}
 select paige_chat_interactive_begin_v2('${preconv}','${preconvIntent}',null,'Pre-upgrade staged conversation',false,false,false);reset role;`);
if(baselineOnly){
 run(`${service}select public.paige_chat_interactive_activate(repeat('a',40),repeat('b',64));${auth}
 do $$begin if(paige_chat_interactive_begin_v2('${legacy}','${legacyIntent}',null,'Legacy replay',false,false))->>'status'<>'duplicate' then raise exception 'UNSAFE_LEGACY_PENDING_ADOPTED';end if;end$$;`);
 throw Error('Baseline unexpectedly rejected the legacy adoption trigger');
}
// The migration never records a premature precommit cutoff or activates itself.
const installCheck=`do $$begin
 begin perform public.paige_chat_interactive_fence_legacy();raise exception 'precommit cutoff accepted';
 exception when others then if sqlerrm<>'INTERACTIVE_RETIREMENT_INSTALL_NOT_COMMITTED' then raise;end if;end;
 if(select active or legacy_admission_closed_at is not null from paige_chat_interactive_rollout where singleton) then raise exception 'migration activated/fenced itself';end if;
end$$;
commit;`;
run(candidate.replace(/commit;\s*$/,()=>installCheck));
run(candidate); // replay-compatible DDL, no second clock or automatic activation
run(`do $$begin
 if not exists(select 1 from paige_chat_threads where id='${preconv}' and interactive_admitted_intent='${preconvIntent}' and interactive_admission='conversational') then raise exception 'issued existing admission lost';end if;
 if exists(select 1 from paige_chat_threads where id in ('${legacy}','${bound}') and interactive_admitted_intent is not null) then raise exception 'legacy backfill promoted';end if;
end$$;`);
const holder=async(lockedThread=null)=>{
 const child=spawn(psql,['-X','-qAt','-v','ON_ERROR_STOP=1',url],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{errors+=b});
 const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(errors)))});
 child.stdin.write(`begin;${lockedThread?`select id from paige_chat_threads where id='${lockedThread}' for update;`:''}select 'RETIREMENT_HOLDER_READY';\n`);
 const until=Date.now()+5000;
 while(!output.includes('RETIREMENT_HOLDER_READY')){if(Date.now()>until)throw Error('holder startup timeout');await new Promise(r=>setTimeout(r,25));}
 let closed=false;
 return {close:async()=>{if(!closed){closed=true;child.stdin.end('rollback;\n');}await ended;}};
};
if(realWindow){
 const held=await holder();
 try{
  run(`${service}select paige_chat_interactive_fence_legacy();`);
  console.log('Native real-window race: cutoff committed; holding a real older idle transaction through400s');
  await new Promise(r=>setTimeout(r,401000));
  run(`${service}do $$begin begin ${activatePerform}raise exception 'old transaction admitted';exception when others then if sqlerrm<>'INTERACTIVE_LEGACY_DATABASE_NOT_RETIRED' then raise;end if;end;end$$;`);
 }finally{await held.close();}
 run(`${service}${activate}`);
 console.log('PASS real400s retirement race: activation refused the actual pre-cutoff transaction; after rollback the same native activation succeeded');
 process.exit(0);
}
run(`${auth}do $$begin
 begin perform paige_chat_interactive_fence_legacy();raise exception 'caller fenced';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_activate(repeat('a',40),repeat('b',64),'database_executor_isolation');raise exception 'caller activated';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_retirement_blockers(clock_timestamp());raise exception 'caller observed controlplane';exception when insufficient_privilege then null;end;
end$$;reset role;
do $$begin if not paige_chat_interactive_legacy_admission_closed() then raise exception 'canonical rejector pin mismatch';end if;end$$;
${service}select paige_chat_interactive_fence_legacy();reset role;
do $$declare t timestamptz;begin
 select legacy_admission_closed_at into t from paige_chat_interactive_rollout where singleton;
 if t is null or t>clock_timestamp() or t<clock_timestamp()-interval '10 seconds' then raise exception 'cutoff not fresh server clock';end if;
 if paige_chat_interactive_fence_legacy() is distinct from t then raise exception 'replay reset cutoff';end if;
 begin ${activatePerform}raise exception 'early activation accepted';exception when others then if sqlerrm<>'INTERACTIVE_LEGACY_RUNTIME_NOT_RETIRED' then raise;end if;end;
end$$;`);
// Reproduce a compiled pre-008 release body waiting past replacement. Replacing
// its definition cannot replace that in-flight invocation; the blocker reader
// must continue to see its transaction until the native old call completes.
const fenceSource=strip('20270601000000_int336_interactive_thread_fence.sql');
const oldExecutor=fenceSource.slice(fenceSource.indexOf('create or replace function public.paige_chat_interactive_executor('));
const currentExecutor=issuance.slice(issuance.indexOf('create or replace function public.paige_chat_interactive_executor('));
const lock=await holder(legacy);
let oldRelease;
try{
 run(oldExecutor);
 oldRelease=spawn(psql,['-X','-qAt','-v','ON_ERROR_STOP=1',url],{stdio:['pipe','pipe','pipe']});
 let errors='';oldRelease.stdout.resume();oldRelease.stderr.on('data',b=>{errors+=b});
 const finished=new Promise((resolve,reject)=>{oldRelease.on('error',reject);oldRelease.on('exit',code=>code===0?resolve():reject(Error(errors)))});
 oldRelease.stdin.end(`set application_name='int346_old_release_fixture';${service}select paige_chat_interactive_executor('${legacy}','${actor}','${tenant}','${legacyIntent}','release');`);
 const until=Date.now()+5000;
 while(run("select exists(select 1 from pg_stat_activity where application_name='int346_old_release_fixture' and wait_event_type='Lock');")!=='t'){
  if(Date.now()>until)throw Error('old release did not reach its native row-lock wait');await new Promise(r=>setTimeout(r,25));
 }
 run(currentExecutor);
 const blockers=JSON.parse(run(`${service}select paige_chat_interactive_retirement_blockers(clock_timestamp());`));
 assert.ok(blockers.older_transactions>=2,'both the row holder and already-running old native body remain observable after replacement');
 await lock.close();await finished;oldRelease=null;
}finally{
 if(oldRelease){await lock.close();oldRelease.kill();}
 run(currentExecutor);
}
const held=await holder();
try{
 const blockers=JSON.parse(run(`${service}select paige_chat_interactive_retirement_blockers(clock_timestamp());`));
 assert.ok(blockers.older_transactions>=1,'actual second-connection idle transaction blocks retirement');
}finally{await held.close();}
assert.deepEqual(JSON.parse(run(`${service}select paige_chat_interactive_retirement_blockers(clock_timestamp());`)),{older_transactions:0,prepared_transactions:0});
run(`begin;select 1;prepare transaction 'int346_synthetic_prepared';`);
try{assert.equal(JSON.parse(run(`${service}select paige_chat_interactive_retirement_blockers(clock_timestamp());`)).prepared_transactions,1);}finally{run("rollback prepared 'int346_synthetic_prepared';");}
run(`begin;set track_activities=off;${service}do $$begin
 begin perform paige_chat_interactive_retirement_blockers(clock_timestamp());raise exception 'unobservable activity accepted';exception when others then if sqlerrm<>'INTERACTIVE_RETIREMENT_OBSERVATION_UNAVAILABLE' then raise;end if;end;
end$$;rollback;
begin;grant execute on function paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) to authenticated;
do $$begin if paige_chat_interactive_legacy_admission_closed() then raise exception 'broadened ACL accepted';end if;end$$;rollback;
begin;create function paige_chat_interactive_begin(text)returns void language sql as 'select';
do $$begin if paige_chat_interactive_legacy_admission_closed() then raise exception 'extra overload accepted';end if;end$$;rollback;
begin;create or replace function paige_chat_interactive_begin(p_thread uuid,p_intent uuid,p_supersedes uuid,p_content text,p_bound_answer boolean default false,p_stop boolean default false)
 returns jsonb language sql security definer set search_path=public as 'select null::jsonb';
do $$begin if paige_chat_interactive_legacy_admission_closed() then raise exception 'mutated body accepted';end if;end$$;rollback;
-- ONLY this protected fixture may backdate its server cutoff instead of sleeping.
update paige_chat_interactive_rollout set legacy_admission_closed_at=clock_timestamp()-interval '401 seconds';
update paige_chat_threads set interactive_executor_intent='${legacyIntent}' where id='${legacy}';
${service}do $$begin begin ${activatePerform}raise exception 'held claim discarded';exception when others then if sqlerrm<>'INTERACTIVE_DRAIN_REQUIRED' then raise;end if;end;end$$;reset role;
-- Fixture-owned claim only; production never clears uncertainty this way.
update paige_chat_threads set interactive_executor_intent=null where id='${legacy}';
${service}${activate}reset role;
do $$begin
 if not(select active and retirement_method='database_executor_isolation' from paige_chat_interactive_rollout where singleton) then raise exception 'proof kind missing';end if;
 ${activatePerform}
 begin perform paige_chat_interactive_activate(repeat('a',40),repeat('b',64));raise exception 'provider evidence substituted';exception when others then if sqlerrm<>'activation evidence conflict' then raise;end if;end;
end$$;
${auth}do $$begin
 if(paige_chat_interactive_begin_v2('${preconv}','${preconvIntent}',null,'Promote conversation',false,false))->>'status'<>'duplicate' then raise exception 'conversation promoted by retry';end if;
 if(paige_chat_interactive_begin_v2('${legacy}','${legacyIntent}',null,'Legacy replay',false,false))->>'status'<>'duplicate' then raise exception 'legacy pending adopted';end if;
 if(paige_chat_interactive_begin_v2('${bound}','${boundIntent}',null,'Unknown bound replay',true,false))->>'status'<>'duplicate' then raise exception 'legacy bound adopted';end if;
 begin perform paige_chat_interactive_begin_v2('${fresh}','${freshIntent}',null,'Null class',false,false,null);raise exception 'null class accepted';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
 begin update paige_chat_threads set interactive_admitted_intent='${freshIntent}' where id='${fresh}';raise exception 'caller lineage admitted';exception when insufficient_privilege then null;end;
 if(paige_chat_interactive_begin_v2('${fresh}','${freshIntent}',null,'Real new instruction',false,false))->>'status'<>'accepted' then raise exception 'fresh admission refused';end if;
 if(paige_chat_interactive_begin_v2('${fresh}','${freshIntent}',null,'Transport retry',false,false))->>'status'<>'accepted' then raise exception 'pending retry refused';end if;
end$$;${service}do $$begin
 if(paige_chat_interactive_executor_v2('${legacy}','${actor}','${tenant}','${legacyIntent}','acquire')->>'acquired')::boolean then raise exception 'direct legacy acquire';end if;
 if(paige_chat_interactive_executor_v2('${bound}','${actor}','${tenant}','${boundIntent}','acquire')->>'acquired')::boolean then raise exception 'direct legacy bound acquire';end if;
 if not(paige_chat_interactive_executor_v2('${fresh}','${actor}','${tenant}','${freshIntent}','acquire')->>'acquired')::boolean then raise exception 'fresh acquire refused';end if;
 if(paige_chat_interactive_executor_v2('${fresh}','${actor}','${tenant}','${freshIntent}','acquire')->>'acquired')::boolean then raise exception 'sameintent second acquire';end if;
end$$;
${auth}select paige_chat_turn_append('${fresh}','assistant','Counterfeit finish',null,null,null,null,null,
 '{"interactive":{"request_intent_id":"${freshIntent}"},"turn_state":{"state":"FINAL"}}',null);
${service}do $$begin
 begin perform paige_chat_interactive_executor('${fresh}','${actor}','${tenant}','${freshIntent}','release');raise exception 'forged JSON released';exception when others then if sqlerrm<>'INTERACTIVE_RECONCILIATION_REQUIRED' then raise;end if;end;
end$$;
${auth}select paige_chat_interactive_begin_v2('${fresh}','${next}','${freshIntent}','Superseding bound answer',true,false);
${service}select paige_chat_interactive_settle('${fresh}','${actor}','${tenant}','${freshIntent}','Unknown effect retained',null,null,
 '{"interactive":{"request_intent_id":"${freshIntent}","effects":[{"tool":"crm_create_task","outcome":"outcome_unknown"}]},"turn_state":{"state":"INTERRUPTED"}}',null);
select paige_chat_interactive_executor_v2('${fresh}','${actor}','${tenant}','${freshIntent}','release');
do $$begin if not(paige_chat_interactive_executor_v2('${fresh}','${actor}','${tenant}','${next}','acquire')->>'acquired')::boolean then raise exception 'new bound answer refused';end if;end$$;
${auth}select paige_chat_interactive_begin_v2('${fresh}','${conv}','${next}','',false,true);
reset role;do $$begin if exists(select 1 from paige_chat_threads where id='${fresh}' and (interactive_latest_intent is not null or interactive_admitted_intent is not null)) then raise exception 'Stop retained admission';end if;end$$;
`);
console.log('PASS native isolation: explicit proof kind/ACL/commit/clock gates, real transaction and prepared blockers, legacy replay/direct-acquire refusal, fresh/pending/bound admissions, forged terminal refusal, superseded settlement and Stop');
