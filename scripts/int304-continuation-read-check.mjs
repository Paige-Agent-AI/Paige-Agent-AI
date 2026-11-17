/** Native read-only continuation-fields proof (INT-304 CL-3 / C4d). Reuses the canonical
 * envelope fixture; rollback-only. Cases live in supabase/tests/int304_durable_continuation.sql. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;if(!url)throw Error('INT336_DATABASE_URL required');const parsed=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!/^\/int336_test/.test(parsed.pathname))throw Error('isolated localhost fixture required');
const root=path.resolve(import.meta.dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');const readMigration=suffix=>{const f=fs.readdirSync(path.join(root,'supabase/migrations')).find(x=>x.endsWith(suffix));if(!f)throw Error('migration missing: '+suffix);return read('supabase/migrations/'+f)};let schema=read('scripts/proof/paige-durable-work-concurrency.mjs').match(/const fixtureSchema = `([\s\S]*?)`;/)?.[1];if(!schema)throw Error('fixture missing');schema=schema.replace(/create role (\w+)([^;]*);/g,(_,n,o)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${n}')then create role ${n}${o};end if;end$$;`);
const sql=`begin;${schema}
create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('role',auth.role())$$;
create function public.current_user_tenant_id()returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.has_tenant_role(a uuid,t uuid,r text)returns boolean language sql stable as $$select exists(select 1 from public.tenant_members where user_id=a and tenant_id=t and role=r and status='active')$$;
create function public.is_tenant_member(t uuid)returns boolean language sql stable as $$select exists(select 1 from public.tenant_members where user_id=auth.uid() and tenant_id=t and status='active')$$;
alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
create table public.profiles(user_id uuid primary key,active_tenant_id uuid);
alter table public.research_runs add column work_id uuid,add column tenant_id uuid,add column user_id uuid,
 add column question text,add column domain text,add column caller text,add column findings jsonb,
 add column coverage jsonb,add column stop_reason text,add column configured boolean,add column entity_profile jsonb;
create table public.research_sources(run_id uuid,tenant_id uuid,user_id uuid,source_index int,url text,title text,snippet text,
 reliability_score numeric(4,3),tier text,reliability text,published_at timestamptz,fetched_at timestamptz,excluded boolean);
${read('supabase/migrations/20271108180000_research_current_scope.sql').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'')}
${read('supabase/migrations/20271108181000_research_native_readback.sql').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'')}
alter table public.paige_chat_threads add column interactive_latest_intent uuid;
create table public.paige_chat_turns(id uuid default gen_random_uuid(),work_id uuid,thread_id uuid,role text,interactive_intent_id uuid,interactive_actor_id uuid,interactive_tenant_id uuid,interactive_terminal_state text,bundle_ref jsonb);
${read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql')}
alter table public.paige_durable_work add column request_payload jsonb;
create table public.marketing_content(id uuid, tenant_id uuid, work_id uuid, kind text, document_revision int, title text, body text);
create table public.paige_workspace_events(id uuid, tenant_id uuid, actor_id uuid, source_kind text, source_id uuid, source_revision bigint,
 capability_key text, outcome text, job_attempt_id text, detail jsonb);
${readMigration('_int304_durable_continuation_read.sql').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'')}
${read('supabase/migrations/20270601000014_int304_durable_observation.sql')}
${readMigration('_exp05_c4d_original_completion.sql').split('end $document_receipt$;')[1].replace(/^commit;\r?$/mg,'')}
${readMigration('_exp05_research_original_completion.sql').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'')}
${read('supabase/tests/int304_durable_continuation.sql')}
rollback;`;
const result=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:45000,windowsHide:true});if(result.status!==0){console.error(result.stderr);process.exit(1)}
const proofs=(result.stdout+'\n'+result.stderr).split('\n').filter(l=>l.includes('CONTINUATION_PROOF'));
if(proofs.length<55)throw Error(`expected at least 55 CONTINUATION_PROOF lines, saw ${proofs.length}`);
console.log(proofs.join('\n'));
console.log('PASS durable continuation read: original Document and Research completion pairs, exact report/source digest and attempt receipt, current Auth/profile/seat checks, tenant/actor/intent isolation, no writes on reconnect, tamper/unknown/legacy/conflicting-receipt refusal');
