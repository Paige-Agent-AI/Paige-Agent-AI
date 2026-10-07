/** Native authority regression; only an empty localhost int336_test* database. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const url = process.env.INT336_DATABASE_URL;
const parsed = new URL(url);
if (!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || !parsed.pathname.startsWith('/int336_test')) throw Error('Isolated localhost database required');
const root = path.resolve(import.meta.dirname,'..');
const migrationDir = path.join(root,'supabase/migrations');
const baseline = spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],{encoding:'utf8',env:process.env});
if (baseline.status !== 0) throw Error(baseline.stderr);
const prelude = baseline.stdout.slice(0,baseline.stdout.indexOf("insert into paige_chat_threads(id,caller_user_id,tenant_id)values"));
const migration = fs.readdirSync(migrationDir).find(f=>f.endsWith('_int346_server_issued_interactive_receipts.sql'));
const patch = migration ? fs.readFileSync(path.join(migrationDir,migration),'utf8').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'') : '';
const upgrade = `
insert into paige_chat_threads(id,caller_user_id,tenant_id) values
('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
set test.actor='00000000-0000-4000-8000-000000000002';set test.tenant='00000000-0000-4000-8000-000000000003';set role authenticated;
select paige_chat_interactive_begin('00000000-0000-4000-8000-000000000020',null,'00000000-0000-4000-8000-000000000021','',false,true);
select paige_chat_interactive_begin('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000023','Newer instruction',false,false);
reset role;
`;
const upgradedCheck = `set role authenticated;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_begin_v2('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021',null,'Delayed stopped instruction',false,false);
 if r->>'status'<>'superseded' then raise exception 'pre-rollout Stop resurrected';end if;
 r:=paige_chat_interactive_begin_v2('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000023',null,'Delayed superseded instruction',false,false);
 if r->>'status'<>'superseded' then raise exception 'pre-rollout predecessor resurrected';end if;
end$$;
reset role;set role service_role;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_executor_v2('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000021','acquire');
 if (r->>'acquired')::boolean or (r->>'stopped')::boolean or (r->>'terminal')::boolean then raise exception 'legacy denial promoted to authority';end if;
end$$;reset role;
`;
const sql = prelude + upgrade + patch + patch + "set role service_role;select public.paige_chat_interactive_activate(repeat('a',40),repeat('b',64));reset role;\n" + upgradedCheck + `
insert into paige_chat_threads(id,caller_user_id,tenant_id) values
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
set test.actor='00000000-0000-4000-8000-000000000002';
set test.tenant='00000000-0000-4000-8000-000000000003';
set role authenticated;
select paige_chat_interactive_begin_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004',null,'A bounded assignment',false,false);
reset role; set role service_role;
select paige_chat_interactive_executor_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','acquire');
reset role; set role authenticated;
select paige_chat_turn_append('00000000-0000-4000-8000-000000000001','assistant','Untrusted statement',null,null,null,null,null,
'{"interactive":{"request_intent_id":"00000000-0000-4000-8000-000000000004"},"turn_state":{"state":"FINAL"}}',null);
reset role; set role service_role;
do $$begin
 begin perform paige_chat_interactive_executor_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','release');
 raise exception 'FAIL: caller-authored terminal released executor';
 exception when others then if sqlerrm <> 'INTERACTIVE_RECONCILIATION_REQUIRED' then raise; end if; end;
end$$;
reset role;
grant insert,update,select on paige_chat_turns to authenticated;
set role authenticated;
do $$begin
 begin insert into paige_chat_turns(thread_id,role,content,interactive_terminal_state)
 values('00000000-0000-4000-8000-000000000001','assistant','Denied','FINAL');
 raise exception 'protected insert admitted';exception when insufficient_privilege then null;end;
 begin update paige_chat_turns set interactive_terminal_state='FINAL';
 raise exception 'protected update admitted';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_settle('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','Denied',null,null,'{}',null);
 raise exception 'authenticated issuance admitted';exception when insufficient_privilege then null;end;
end$$;
-- Counterfeit supersession is not an authoritative Stop.
select paige_chat_turn_append('00000000-0000-4000-8000-000000000001','system','',null,null,null,null,null,
'{"interactive":{"supersedes_intent_id":"00000000-0000-4000-8000-000000000009","stopped":true}}',null);
reset role;set role service_role;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_executor_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000009','state');
 if (r->>'stopped')::boolean then raise exception 'counterfeit stop admitted';end if;
end$$;
-- Successor may supersede the live executor, but cannot steal its token.
reset role;set role authenticated;
select paige_chat_interactive_begin_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','Successor',false,false);
reset role;set role service_role;
do $$declare a uuid:='00000000-0000-4000-8000-000000000002'; t uuid:='00000000-0000-4000-8000-000000000003'; th uuid:='00000000-0000-4000-8000-000000000001'; i uuid:='00000000-0000-4000-8000-000000000004'; j jsonb; first_id uuid; replay_id uuid;begin
 j:=jsonb_build_object('interactive',jsonb_build_object('request_intent_id',i,'effects',jsonb_build_array(jsonb_build_object('tool','test_write','outcome','outcome_unknown'))),'turn_state',jsonb_build_object('state','INTERRUPTED'));
 begin perform paige_chat_interactive_settle(th,a,i,i,'Receipt',null,null,j,null);raise exception 'wrong tenant admitted';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_settle(th,i,t,i,'Receipt',null,null,j,null);raise exception 'wrong actor admitted';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_settle(i,a,t,i,'Receipt',null,null,j,null);raise exception 'wrong thread admitted';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_settle(th,a,t,'00000000-0000-4000-8000-000000000009','Receipt',null,null,jsonb_set(j,'{interactive,request_intent_id}','"00000000-0000-4000-8000-000000000009"'),null);raise exception 'stale intent admitted';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_settle(th,a,t,i,'Receipt',null,null,jsonb_set(j,'{turn_state,state}','"NOT_TERMINAL"'),null);raise exception 'unknown state admitted';exception when others then if sqlerrm<>'invalid interactive terminal' then raise;end if;end;
 first_id:=paige_chat_interactive_settle(th,a,t,i,'Receipt',null,null,j,null);
 replay_id:=paige_chat_interactive_settle(th,a,t,i,'Receipt',null,null,j,null);
 if first_id<>replay_id then raise exception 'replay created second receipt';end if;
 begin perform paige_chat_interactive_settle(th,a,t,i,'Conflicting receipt',null,null,j,null);raise exception 'conflicting replay admitted';exception when others then if sqlerrm<>'interactive receipt conflict' then raise;end if;end;
 if not (paige_chat_interactive_executor_v2(th,a,t,i,'state')->>'terminal')::boolean then raise exception 'lost-response recovery failed';end if;
 perform paige_chat_interactive_executor_v2(th,a,t,i,'release');
 if not (paige_chat_interactive_executor_v2(th,a,t,'00000000-0000-4000-8000-000000000005','acquire')->>'acquired')::boolean then raise exception 'successor acquire failed';end if;
 perform paige_chat_interactive_executor_v2(th,a,t,i,'release');
 if paige_chat_interactive_executor_v2(th,a,t,i,'state')->>'executor'<>'00000000-0000-4000-8000-000000000005' then raise exception 'old release cleared successor';end if;
 replay_id:=paige_chat_interactive_settle(th,a,t,i,'Receipt',null,null,j,null);
 if replay_id<>first_id then raise exception 'late retry duplicated receipt';end if;
end$$;
reset role;set role authenticated;
select paige_chat_interactive_begin_v2('00000000-0000-4000-8000-000000000001',null,'00000000-0000-4000-8000-000000000005','',false,true);
reset role;set role service_role;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_executor_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','state');
 if not (r->>'stopped')::boolean or r->>'executor' is null then raise exception 'Stop must retain running executor';end if;
 begin perform paige_chat_interactive_executor_v2('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','release');raise exception 'Stop alone released running executor';exception when others then if sqlerrm<>'INTERACTIVE_RECONCILIATION_REQUIRED' then raise;end if;end;
end$$;
reset role; rollback;
`;
const psql=process.env.PSQL_BIN??'psql';
if(process.argv.includes('--race')) {
 const setup=sql.slice(0,sql.indexOf("reset role; set role authenticated;\nselect paige_chat_turn_append"))+'reset role;commit;';
 const initialized=spawnSync(psql,['-X','-v','ON_ERROR_STOP=1',url],{input:setup,encoding:'utf8'});
 if(initialized.status!==0)throw Error(initialized.stderr);
 const th='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',tenant='00000000-0000-4000-8000-000000000003',intent='00000000-0000-4000-8000-000000000004';
 let unlockReady;
 const ready=new Promise(r=>unlockReady=r);
 const first=spawn(psql,['-X','-v','ON_ERROR_STOP=1',url],{stdio:['pipe','pipe','pipe']});
 let stderr='';first.stderr.on('data',c=>stderr+=c);
 first.stdout.on('data',c=>{if(String(c).includes('LOCKED'))unlockReady();});
 const finished=new Promise((resolve,reject)=>{first.on('error',reject);first.on('exit',code=>code===0?resolve():reject(Error(stderr)));});
 first.stdin.end(`begin;set role service_role;
 select paige_chat_interactive_settle('${th}','${actor}','${tenant}','${intent}','Issued',null,null,
 '{"interactive":{"request_intent_id":"${intent}"},"turn_state":{"state":"INTERRUPTED"}}',null);
 \\echo LOCKED
 select pg_sleep(2);commit;`);
 await Promise.race([ready,finished.then(()=>{throw Error('issuer finished before lock signal');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('lock signal timeout')),5000))]);
 const start=Date.now();
 const second=spawnSync(psql,['-X','-v','ON_ERROR_STOP=1',url],{encoding:'utf8',input:`set role service_role;select paige_chat_interactive_executor_v2('${th}','${actor}','${tenant}','${intent}','release');`});
 assert.equal(second.status,0,second.stderr);assert.ok(Date.now()-start>=1200,'release raced ahead of issuance commit');await finished;
 const third=spawnSync(psql,['-X','-v','ON_ERROR_STOP=1','-At',url],{encoding:'utf8',input:`set role service_role;select paige_chat_interactive_executor_v2('${th}','${actor}','${tenant}','${intent}','acquire')->>'acquired';`});
 assert.equal(third.status,0,third.stderr);assert.ok(third.stdout.includes('false'),'terminal intent executed twice');
 console.log('PASS two-connection race: release waits for authoritative issuance commit; terminal intent cannot execute again');process.exit(0);
}
const run=spawnSync(psql,['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8'});
if(run.status!==0){console.error(run.stderr);process.exit(run.status??1)}
console.log('PASS native PostgreSQL: issuance ACL, protected fields, counterfeit terminal/Stop, exact scope/state, immutable replay, superseded settlement, lost-response recovery, compare-release and Stop hold');
