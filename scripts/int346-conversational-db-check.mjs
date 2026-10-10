/** INT-346 conversational admission — real PostgreSQL contract on an isolated localhost db.
 * While the rollout is staged (active=false): effectful admissions stay refused, conversational
 * admissions are accepted and recorded, acquire stays refused, conversational settlement issues
 * a server receipt without an executor claim (even beside a stale pre-rollout claim, which it
 * preserves), the receipt is terminal evidence, replay is idempotent, Stop works, direct column
 * writes are refused, and once ACTIVE the conversational class disappears while effectful work
 * resumes exactly as before.
 */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;
const parsed=new URL(url);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.startsWith('/int336_test'))throw Error('Isolated localhost database required');
const root=path.resolve(import.meta.dirname,'..');
const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],{encoding:'utf8',env:process.env});
if(emitted.status!==0)throw Error(emitted.stderr);
const baseline=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
const strip=(name)=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
const issuance=strip('20270601000008_int346_server_issued_interactive_receipts.sql');
const conversational=strip('20270602000301_int346_conversational_admission.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const th=id(1),a=id(2),t=id(3),staleIntent=id(4),conv=id(5),eff=id(6),next=id(7),conv2=id(8),racing=id(9);
const sql=baseline+`
insert into paige_chat_threads(id,caller_user_id,tenant_id)values('${th}','${a}','${t}');
set test.actor='${a}';set test.tenant='${t}';set role authenticated;
-- A pre-rollout in-flight executor claim, staged the canonical way (pre-issuance semantics).
do $$begin perform paige_chat_interactive_begin('${th}','${staleIntent}',null,'Old running turn',false,false);end $$;
reset role;set role service_role;
select paige_chat_interactive_executor('${th}','${a}','${t}','${staleIntent}','acquire');
reset role;
`+issuance+conversational+`
grant select on public.paige_chat_threads to service_role;
grant select on public.paige_chat_turns to service_role;
set test.actor='${a}';set test.tenant='${t}';set role authenticated;
do $$begin
  -- Staged rollout: effectful admission still refused (unchanged contract, default p_effectful).
  begin perform paige_chat_interactive_begin_v2('${th}','${eff}',null,'Effectful during drain',false,false);raise exception 'effectful accepted during drain';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
  -- Conversational admission accepted while the stale pre-rollout claim sits on another intent.
  if(paige_chat_interactive_begin_v2('${th}','${conv}',null,'Ordinary typed message',false,false,false))->>'status'<>'accepted' then raise exception 'conversational not accepted';end if;
end $$;reset role;set role service_role;
do $$begin
  if not exists(select 1 from paige_chat_threads where id='${th}' and interactive_latest_intent='${conv}' and interactive_admission='conversational') then raise exception 'admission class not recorded';end if;
  -- No executor authority may be taken for a conversational intent while staged.
  begin perform paige_chat_interactive_executor_v2('${th}','${a}','${t}','${conv}','acquire');raise exception 'conversational acquired';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_NOT_READY' then raise;end if;end;
  -- The conversational receipt issues WITHOUT an executor, preserves the stale claim, and is
  -- terminal evidence for its intent.
  perform paige_chat_interactive_settle('${th}','${a}','${t}','${conv}','Answered in words',null,null,
   '{"interactive":{"request_intent_id":"${conv}","admission":"conversational"},"turn_state":{"state":"FINAL"}}'::jsonb,null);
  if not exists(select 1 from paige_chat_turns where thread_id='${th}' and interactive_intent_id='${conv}' and interactive_terminal_state='FINAL') then raise exception 'conversational receipt missing';end if;
  if(select interactive_executor_intent from paige_chat_threads where id='${th}')<>'${staleIntent}' then raise exception 'conversational settle disturbed the stale claim';end if;
  if not((paige_chat_interactive_evidence('${th}','${a}','${t}','${conv}')->>'terminal')::boolean) then raise exception 'conversational receipt is not terminal evidence';end if;
  -- Idempotent settle returns the same receipt; a drifted payload still conflicts.
  if paige_chat_interactive_settle('${th}','${a}','${t}','${conv}','Answered in words',null,null,
   '{"interactive":{"request_intent_id":"${conv}","admission":"conversational"},"turn_state":{"state":"FINAL"}}'::jsonb,null)
   <> (select id from paige_chat_turns where thread_id='${th}' and interactive_intent_id='${conv}'
       and role='assistant' and interactive_terminal_state='FINAL') then raise exception 'idempotent settle diverged';end if;
  begin perform paige_chat_interactive_settle('${th}','${a}','${t}','${conv}','Drifted',null,null,
   '{"interactive":{"request_intent_id":"${conv}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);raise exception 'drifted settle accepted';exception when others then if sqlerrm<>'interactive receipt conflict' then raise;end if;end;
  -- An unadmitted intent cannot settle without the executor; a foreign actor cannot settle either.
  begin perform paige_chat_interactive_settle('${th}','${a}','${t}','${next}','Forged',null,null,
   '{"interactive":{"request_intent_id":"${next}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);raise exception 'unadmitted settle accepted';exception when others then if sqlerrm<>'interactive executor mismatch' then raise;end if;end;
  begin perform paige_chat_interactive_settle('${th}','${id(9)}','${t}','${conv}','Forged',null,null,
   '{"interactive":{"request_intent_id":"${conv}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);raise exception 'foreign actor settled';exception when others then if sqlerrm<>'thread scope mismatch' then raise;end if;end;
  -- The stale claim still blocks activation exactly as before this change.
  begin perform paige_chat_interactive_activate(repeat('a',40),repeat('b',64));raise exception 'activation with held executor';exception when others then if sqlerrm<>'INTERACTIVE_DRAIN_REQUIRED' then raise;end if;end;
end $$;reset role;set role authenticated;
do $$begin
  -- Replay of the settled conversational intent is duplicate, never a re-admission.
  if(paige_chat_interactive_begin_v2('${th}','${conv}',null,'Retry',false,false,false))->>'status'<>'duplicate' then raise exception 'settled conversational replay';end if;
  -- Stop is available while staged and supersedes the live intent, clearing the
  -- admission class with it; the stopped intent can then never settle (latest is null).
  perform paige_chat_interactive_begin_v2('${th}',null,'${conv}','',false,true,false);
  -- Direct client writes to the admission column are refused (a null->null no-op
  -- would not trip the change-guard, so the probe writes a value).
  begin update paige_chat_threads set interactive_admission='conversational' where id='${th}';raise exception 'direct admission write';exception when insufficient_privilege then null;end;
  -- An UNSETTLED second conversational intent, for the post-activation guard below.
  if(paige_chat_interactive_begin_v2('${th}','${conv2}',null,'Second typed message',false,false,false))->>'status'<>'accepted' then raise exception 'second conversational not accepted';end if;
  -- An UNSETTLED conversational intent that will still be CURRENT when activation lands,
  -- pinning the reviewer-verified in-flight race boundary.
  if(paige_chat_interactive_begin_v2('${th}','${racing}',null,'Racing typed message',false,false,false))->>'status'<>'accepted' then raise exception 'racing conversational not accepted';end if;
end $$;reset role;set role service_role;
-- The established drain procedure: the old handler's legacy JSON FINAL, then legacy release.
set role authenticated;
select paige_chat_turn_append('${th}','assistant','Old answer',null,null,null,null,null,
 '{"interactive":{"request_intent_id":"${staleIntent}"},"turn_state":{"state":"FINAL"}}',null);
reset role;set role service_role;
select paige_chat_interactive_executor('${th}','${a}','${t}','${staleIntent}','release');
select paige_chat_interactive_activate(repeat('a',40),repeat('b',64));
reset role;set role service_role;
do $$begin
  -- Reviewer-verified boundary: activation racing an in-flight conversational turn -- the
  -- intent admitted while staged is STILL the thread's current conversational admission,
  -- so trusted service code can settle it truthfully. A NEW conversational admission is
  -- refused once ACTIVE (the block below pins that). Accepted, pinned.
  perform paige_chat_interactive_settle('${th}','${a}','${t}','${racing}','Racing answer',null,null,
   '{"interactive":{"request_intent_id":"${racing}","admission":"conversational"},"turn_state":{"state":"FINAL"}}'::jsonb,null);
  if not exists(select 1 from paige_chat_turns where thread_id='${th}' and interactive_intent_id='${racing}' and interactive_terminal_state='FINAL') then raise exception 'racing settle missing';end if;
end $$;
reset role;set role authenticated;
do $$begin
  -- ACTIVE: the conversational class disappears; effectful admission resumes unchanged.
  begin perform paige_chat_interactive_begin_v2('${th}','${next}',null,'Conversational after activation',false,false,false);raise exception 'conversational accepted after activation';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_REQUIRED' then raise;end if;end;
  if(paige_chat_interactive_begin_v2('${th}','${next}',null,'Protected',false,false))->>'status'<>'accepted' then raise exception 'effectful not accepted when active';end if;
  if exists(select 1 from paige_chat_threads where id='${th}' and interactive_latest_intent='${next}' and interactive_admission is not null) then raise exception 'effectful admission misrecorded';end if;
  -- A NEW conversational admission is refused once ACTIVE.
  begin perform paige_chat_interactive_begin_v2('${th}','${id(10)}',null,'Late conversational',false,false,false);raise exception 'late conversational accepted';exception when others then if sqlerrm<>'INTERACTIVE_PROTOCOL_REQUIRED' then raise;end if;end;
end $$;reset role;set role service_role;
do $$begin
  -- An unsettled conversational intent that is no longer the thread's CURRENT admission cannot
  -- use the relaxed settle branch: it binds to the CURRENT latest admission, not a memory of one.
  begin perform paige_chat_interactive_settle('${th}','${a}','${t}','${conv2}','Late conversational',null,null,
   '{"interactive":{"request_intent_id":"${conv2}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);raise exception 'superseded conversational settle accepted';exception when others then if sqlerrm<>'interactive executor mismatch' then raise;end if;end;
  -- And a drifted re-settle of the receipt that DOES exist conflicts rather than rewriting it.
  begin perform paige_chat_interactive_settle('${th}','${a}','${t}','${conv}','Late drifted',null,null,
   '{"interactive":{"request_intent_id":"${conv}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);raise exception 'drifted late settle accepted';exception when others then if sqlerrm<>'interactive receipt conflict' then raise;end if;end;
end $$;

do $$begin
  -- A stopped conversational intent (latest cleared by Stop) can never settle again.
  if exists(select 1 from paige_chat_threads where id='${th}' and interactive_latest_intent='${conv}') then raise exception 'stop did not clear latest';end if;
  begin perform paige_chat_interactive_settle('${th}','${a}','${t}','${conv}','After stop',null,null,
   '{"interactive":{"request_intent_id":"${conv}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);raise exception 'stopped conversational settle accepted';exception when others then if sqlerrm<>'interactive receipt conflict' then raise;end if;end;
end $$;
select paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','acquire');
select paige_chat_interactive_settle('${th}','${a}','${t}','${next}','Protected answer',null,null,
 '{"interactive":{"request_intent_id":"${next}"},"turn_state":{"state":"FINAL"}}'::jsonb,null);
select paige_chat_interactive_executor_v2('${th}','${a}','${t}','${next}','release');
reset role;rollback;
`;
const out=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8'});
if(out.status!==0){console.error(out.stderr);process.exit(out.status??1);}
console.log('PASS conversational admission DB contract: staged accepts only non-effectful, acquire refused, receipt without executor (stale claim preserved), terminal evidence + idempotent/conflicting settle, forged/foreign refused, activation still drain-gated, ACTIVE retires the class and resumes effectful work');
