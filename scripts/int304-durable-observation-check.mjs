/** Native read-only observation proof reuses canonical envelope fixture; rollback-only. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;if(!url)throw Error('INT336_DATABASE_URL required');const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||!/^\/int336_test/.test(parsed.pathname))throw Error('isolated localhost fixture required');
const root=path.resolve(import.meta.dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');let schema=read('scripts/proof/paige-durable-work-concurrency.mjs').match(/const fixtureSchema = `([\s\S]*?)`;/)?.[1];if(!schema)throw Error('fixture missing');schema=schema.replace(/create role (\w+)([^;]*);/g,(_,n,o)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${n}')then create role ${n}${o};end if;end$$;`);
let migration=read('supabase/migrations/20270601000012_int304_durable_observation.sql');
if(process.env.OBSERVATION_MUTATION==='artifact') migration=migration.replace(' recovery:=', " verified:=w.status='succeeded'; recovery:=");
const sql=`begin;${schema}
create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create function public.current_user_tenant_id()returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.has_tenant_role(a uuid,t uuid,r text)returns boolean language sql stable as $$select exists(select 1 from public.tenant_members where user_id=a and tenant_id=t and role=r and status='active')$$;
alter table public.paige_chat_threads add column interactive_latest_intent uuid;
create table public.paige_chat_turns(id uuid default gen_random_uuid(),work_id uuid,thread_id uuid,role text,interactive_intent_id uuid,interactive_actor_id uuid,interactive_tenant_id uuid,interactive_terminal_state text,bundle_ref jsonb);
create table public.marketing_content(id uuid,tenant_id uuid,work_id uuid,kind text,document_revision int,title text,body text);
alter table public.research_runs add column tenant_id uuid,add column user_id uuid,add column question text,add column configured boolean,add column stop_reason text,add column coverage jsonb,add column findings jsonb;
create table public.research_sources(run_id uuid,tenant_id uuid,user_id uuid,excluded boolean,source_index int,url text);
${read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql')}
alter table public.paige_durable_work add column request_payload jsonb;
${migration}
${read('supabase/tests/int304_durable_observation.sql')}
rollback;`;
const result=spawnSync(process.env.PSQL_BIN??'psql',['-X','--no-password','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:45000,windowsHide:true});if(result.status!==0){console.error(result.stderr);process.exit(1)}console.log((result.stdout+'\n'+result.stderr).split('\n').filter(l=>l.includes('OBSERVATION_PROOF')).join('\n'));



