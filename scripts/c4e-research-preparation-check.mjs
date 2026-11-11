/** Native preparation proof, rollback-only on an empty localhost int336_test database. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;
if(!url) throw Error('INT336_DATABASE_URL required');
const parsed=new URL(url);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!/^\/int336_test[a-z0-9_]*$/.test(parsed.pathname)) throw Error('Empty isolated localhost database required');
const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const migration=suffix=>{
  const files=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith(suffix));
  if(files.length!==1)throw Error('Expected one original migration: '+suffix);
  return read('supabase/migrations/'+files[0]).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
};
const proof=read('scripts/proof/paige-durable-work-concurrency.mjs');
let schema=proof.match(/const fixtureSchema = `([\s\S]*?)`;/)?.[1];
if(!schema)throw Error('Canonical fixture schema missing');
schema=schema.replace(/create role (\w+)([^;]*);/g,(_,name,options)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${name}')then create role ${name}${options};end if;end$$;`);
const document=read('supabase/migrations/20270418000000_paige_durable_document_work.sql');
const columns=document.slice(document.indexOf('alter table public.paige_durable_work'),document.indexOf('-- The canonical artifact'));
const identity=document.match(/create or replace function public\._paige_durable_work_protect_identity\(\)[\s\S]*?\$\$;/)?.[0];
if(!identity)throw Error('Canonical immutable payload trigger missing');
const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_c4e_research_preparation.sql'));
if(!file)throw Error('Preparation migration missing');
const sql=`begin;
do $$begin if to_regclass('public.paige_durable_work')is not null or to_regclass('public.tenants')is not null then raise exception 'Database must be empty';end if;end$$;
${schema}
${read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql')}
${columns}\n${identity}
${read('supabase/migrations/'+file).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'')}
${read('supabase/tests/c4e_research_preparation.sql')}
rollback;`;
// Same canonical rollback fixture, now exercising the REAL terminal writer and
// evidence predicate together with Research start. No always-false evidence stub.
const startSql=`begin;
${schema}
create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
create table public.profiles(user_id uuid primary key,active_tenant_id uuid);
create function public.current_user_tenant_id()returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.is_tenant_member(t uuid)returns boolean language sql stable as $$select exists(select 1 from public.tenant_members where user_id=auth.uid() and tenant_id=t and status='active')$$;
alter table public.paige_chat_threads add column audience text default 'workspace',
 add column interactive_latest_intent uuid,add column interactive_executor_intent uuid,
 add column interactive_admitted_intent uuid,add column interactive_recovery_hold uuid,
 add column interactive_runtime_binding jsonb,add column message_count int default 0,
 add column last_message_at timestamptz,add column auto_delete_at timestamptz,add column updated_at timestamptz;
create table public.paige_chat_turns(id uuid primary key default gen_random_uuid(),thread_id uuid,
 role text,content text,surfaces_used text[],model text,bundle_ref jsonb,tool_calls jsonb);
${migration('_int346_server_issued_interactive_receipts.sql')}
${migration('_int346_conversational_admission.sql')}
${read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql')}
${columns}\n${identity}
${migration('_c4e_research_preparation.sql')}
${migration('_research_current_scope.sql')}
${migration('_c4e_research_checkpoint.sql')}
${process.env.C4E_RESEARCH_START_NEGATIVE_CONTROL==='1'?'':migration('_exp05_research_accepted_start.sql')}
${read('supabase/tests/c4e_research_start.sql')}
rollback;`;
const psql=process.env.PSQL_BIN??'psql';
const result=spawnSync(psql,['-X','--no-password','-v','ON_ERROR_STOP=1',url],{input:sql+'\n'+startSql,encoding:'utf8',timeout:45000,windowsHide:true});
if(result.status!==0){console.error(result.stderr);process.exit(1)}
console.log(result.stdout.split('\n').filter(line=>line.includes('C4E_PROOF')).join('\n'));
const startProof=result.stdout.match(/C4E_START_PROOF checks=(\d+)/);
if(!startProof||Number(startProof[1])<41)throw Error('Research start proof did not finish all controls');
console.log(startProof[0]);
console.log('PASS native rollback-only preparation and accepted Research start; canonical receipt before execution, unchanged terminal/Stop evidence, atomic refusal, exact identity and no duplicate dispatch');
