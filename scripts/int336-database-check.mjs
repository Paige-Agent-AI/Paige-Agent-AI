/** Isolated native PostgreSQL proof. INT336_DATABASE_URL must name an empty localhost int336_test* database. */
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import path from 'node:path';
const url=process.env.INT336_DATABASE_URL; if(!url)throw Error('Set INT336_DATABASE_URL to an isolated empty localhost int336_test database');
const parsed=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.startsWith('/int336_test'))throw Error('Only isolated localhost int336_test databases are permitted');
const root=path.resolve(import.meta.dirname,'..');
const canonical=fs.readFileSync(path.join(root,'supabase/migrations/20261020100000_chat_turn_append_tenant_scope.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20270601000000_int336_interactive_thread_fence.sql'),'utf8');
const issuanceFile=fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_int346_server_issued_interactive_receipts.sql'));
const issuance=issuanceFile?fs.readFileSync(path.join(root,'supabase/migrations',issuanceFile),'utf8').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,''):'';
const prelude=`begin;
do $$begin if to_regclass('public.paige_chat_threads') is not null then raise exception 'Use an empty isolated database';end if;
 if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;end$$;
create schema auth;
create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function public.current_user_tenant_id()returns uuid language sql as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.is_platform_owner()returns boolean language sql as $$select false$$;
create table public.paige_chat_threads(id uuid primary key,caller_user_id uuid,tenant_id uuid,message_count int default 0,last_message_at timestamptz,auto_delete_at timestamptz,updated_at timestamptz);
create table public.paige_chat_turns(id uuid default gen_random_uuid(),thread_id uuid,role text,content text,bundle_ref jsonb,surfaces_used text[],load_id uuid,model text,tokens_used int,latency_ms int,tool_calls jsonb);
grant usage on schema public,auth to authenticated;grant select,insert,update on paige_chat_threads to authenticated;
`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const thread=id(1),actor=id(2),tenant=id(3),a=id(4),b=id(5),stop=id(6);
const fixture=`
insert into paige_chat_threads(id,caller_user_id,tenant_id)values('${thread}','${actor}','${tenant}');
set test.actor='${actor}';set test.tenant='${tenant}';set role authenticated;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_begin('${thread}','${b}','${a}','Newest text',false,false);if r->>'status'<>'accepted'then raise exception 'accept failed';end if;
 r:=paige_chat_interactive_begin('${thread}','${a}',null,'Delayed predecessor',false,false);if r->>'status'<>'superseded'then raise exception 'late predecessor accepted';end if;
 r:=paige_chat_interactive_begin('${thread}','${b}','${a}','Newest text',false,false);if r->>'status'<>'accepted'then raise exception 'pending continuation refused';end if;
 if(select message_count from paige_chat_threads where id='${thread}')<>1 then raise exception 'duplicate user turn';end if;
 begin update paige_chat_threads set interactive_executor_intent='${a}'where id='${thread}';raise exception 'direct update admitted';exception when insufficient_privilege then null;end;
 begin insert into paige_chat_threads(id,interactive_executor_intent)values(gen_random_uuid(),'${a}');raise exception 'direct insert admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;set role service_role;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_executor('${thread}','${actor}','${tenant}','${b}','acquire');if not(r->>'acquired')::boolean then raise exception 'acquire failed';end if;
 begin perform paige_chat_interactive_executor('${thread}','${a}','${tenant}','${b}','state');raise exception 'wrong actor admitted';exception when insufficient_privilege then null;end;
 begin perform paige_chat_interactive_executor('${thread}','${actor}','${tenant}','${b}','release');raise exception 'missing receipt released';exception when others then if sqlerrm<>'INTERACTIVE_RECONCILIATION_REQUIRED'then raise;end if;end;
end$$;
reset role;set role authenticated;
do $$declare r jsonb;begin r:=paige_chat_interactive_begin('${thread}','${b}','${a}','Newest text',false,false);if r->>'status'<>'duplicate'then raise exception 'running intent restarted';end if;end$$;
reset role;set role service_role;
select paige_chat_interactive_settle('${thread}','${actor}','${tenant}','${b}','Interrupted after readback',null,null,
 '{"interactive":{"request_intent_id":"${b}","effects":[{"tool":"comms_send_email","outcome":"outcome_unknown"}]},"turn_state":{"v":1,"state":"INTERRUPTED","mode":"action","tools":1,"rounds":1}}'::jsonb,null);
reset role;set role service_role;
select paige_chat_interactive_executor('${thread}','${actor}','${tenant}','${a}','release');
do $$begin if(paige_chat_interactive_executor('${thread}','${actor}','${tenant}','${b}','state')->>'executor')<>'${b}'then raise exception 'old release cleared new token';end if;end$$;
select paige_chat_interactive_executor('${thread}','${actor}','${tenant}','${b}','release');
reset role;set role authenticated;
do $$declare r jsonb;begin
 r:=paige_chat_interactive_begin('${thread}','${b}','${a}','Newest text',false,false);if r->>'status'<>'duplicate'then raise exception 'terminal intent restarted';end if;
 perform paige_chat_interactive_begin('${thread}','${a}','${stop}','',false,true);
 r:=paige_chat_interactive_begin('${thread}','${stop}',null,'Late after Stop',false,false);if r->>'status'<>'superseded'then raise exception 'Stop resurrection';end if;
 perform set_config('test.tenant','${a}',false);begin perform paige_chat_interactive_begin('${thread}','${a}',null,'Foreign tenant',false,false);raise exception 'wrong tenant admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;rollback;`;
const activate="set role service_role;select public.paige_chat_interactive_activate(repeat('a',40),repeat('b',64));reset role;\n";
const protectedFixture=fixture.replaceAll('paige_chat_interactive_begin(', 'paige_chat_interactive_begin_v2(').replaceAll('paige_chat_interactive_executor(', 'paige_chat_interactive_executor_v2(');
const proofSql=prelude+canonical.slice(canonical.indexOf('CREATE OR REPLACE FUNCTION'))+'\n'+migration+'\n'+(process.argv.includes('--emit-baseline')?'':issuance+activate)+(process.argv.includes('--emit-baseline')?fixture:protectedFixture);
if(process.argv.includes('--emit-fixture')){process.stdout.write(proofSql);process.exit(0)}
const run=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:proofSql,encoding:'utf8'});
if(run.status!==0){console.error(run.stderr);process.exit(run.status??1)}
console.log('PASS native PostgreSQL final migration + real canonical append: scope, atomic one-turn acceptance, predecessor/Stop tombstone, direct columns, pending/running/terminal replay, guarded receipt recovery, token compare-release');
