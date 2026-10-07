/** Actual old/new database sequencing. Synthetic, empty localhost database only. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;
const parsed=new URL(url);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.startsWith('/int336_test'))throw Error('Isolated localhost database required');
const root=path.resolve(import.meta.dirname,'..');
const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],{encoding:'utf8',env:process.env});
if(emitted.status!==0)throw Error(emitted.stderr);
const baseline=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_int346_server_issued_interactive_receipts.sql'));
const patch=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const th=id(1),a=id(2),t=id(3),i=id(4),next=id(5);
const sql=baseline+`
insert into paige_chat_threads(id,caller_user_id,tenant_id)values('${th}','${a}','${t}');
set test.actor='${a}';set test.tenant='${t}';set role authenticated;
select paige_chat_interactive_begin('${th}','${i}',null,'Old running conversation',false,false);
reset role;set role service_role;
select paige_chat_interactive_executor('${th}','${a}','${t}','${i}','acquire');reset role;
`+patch+`
set role authenticated;
do $$begin
 begin perform paige_chat_interactive_activate(repeat('a',40),repeat('b',64));raise exception 'caller activated';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_begin('${th}','${next}',null,'Old new request',false,false);raise exception 'legacy accepted';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_REQUIRED' then raise;end if;end;
 begin perform paige_chat_interactive_begin_v2('${th}','${next}',null,'New during drain',false,false);raise exception 'new accepted during drain';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
end $$;reset role;set role service_role;
do $$begin
 if (paige_chat_interactive_protocol()->>'active')::boolean then raise exception 'migration activated itself';end if;
 begin perform paige_chat_interactive_executor('${th}','${a}','${t}','${next}','acquire');raise exception 'legacy acquired';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_REQUIRED' then raise;end if;end;
 begin perform paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','acquire');raise exception 'v2 acquired during drain';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
 begin perform paige_chat_interactive_activate(repeat('a',40),repeat('b',64));raise exception 'held executor discarded';exception when others then if sqlerrm<>'INTERACTIVE_DRAIN_REQUIRED' then raise;end if;end;
 if paige_chat_interactive_executor('${th}','${a}','${t}','${i}','state')->>'executor'<>'${i}' then raise exception 'migration lost old lock';end if;
end $$;reset role;set role authenticated;
-- Simulate the original handler finishing while DRAINING. This compatibility
-- explicitly retains v1's weakness until independently verified provider drain.
select paige_chat_turn_append('${th}','assistant','Old answer',null,null,null,null,null,
 '{"interactive":{"request_intent_id":"${i}"},"turn_state":{"state":"FINAL"}}',null);
reset role;set role service_role;
select paige_chat_interactive_executor('${th}','${a}','${t}','${i}','release');
select paige_chat_interactive_activate(repeat('a',40),repeat('b',64));
select paige_chat_interactive_activate(repeat('a',40),repeat('b',64));
do $$begin
 begin perform paige_chat_interactive_activate(repeat('c',40),repeat('b',64));raise exception 'conflicting activation accepted';exception when others then if sqlerrm<>'activation evidence conflict' then raise;end if;end;
end $$;reset role;set role authenticated;
select paige_chat_interactive_begin_v2('${th}','${next}',null,'Protected successor',false,false);
reset role;set role service_role;
select paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','acquire');
reset role;set role authenticated;
select paige_chat_turn_append('${th}','assistant','Counterfeit answer',null,null,null,null,null,
 '{"interactive":{"request_intent_id":"${next}"},"turn_state":{"state":"FINAL"}}',null);
reset role;set role service_role;
do $$begin
 begin perform paige_chat_interactive_executor('${th}','${a}','${t}','${next}','release');raise exception 'legacy JSON released active v2';exception when others then if sqlerrm<>'INTERACTIVE_RECONCILIATION_REQUIRED' then raise;end if;end;
 if paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','state')->>'executor'<>'${next}' then raise exception 'counterfeit cleared protected token';end if;
end $$;
select paige_chat_interactive_settle('${th}','${a}','${t}','${next}','Issued answer',null,null,
 '{"interactive":{"request_intent_id":"${next}"},"turn_state":{"state":"FINAL"}}',null);
select paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','release');
reset role;delete from public.paige_chat_interactive_rollout;
set role authenticated;
do $$begin
 begin perform paige_chat_interactive_begin_v2('${th}','${next}',null,'Missing release metadata',false,false);raise exception 'missing protocol accepted';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
end $$;reset role;set role service_role;
do $$begin
 begin perform paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','acquire');raise exception 'missing protocol acquired';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
 begin perform paige_chat_interactive_activate(repeat('a',40),repeat('b',64));raise exception 'missing protocol activated';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
 begin perform paige_chat_interactive_executor('${th}','${a}','${t}','${next}','release');raise exception 'missing protocol used compatibility';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
end $$;reset role;rollback;
`;
const out=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8'});
if(out.status!==0){console.error(out.stderr);process.exit(out.status??1);}
console.log('PASS actual DB mixed versions: old in-flight completion retained during drain; both new admissions blocked; activation refuses held executor; active v2 never accepts legacy JSON');
