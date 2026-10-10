/** Native read-only continuation-fields proof (INT-304 CL-3 / C4d). Reuses the canonical
 * envelope fixture; rollback-only. Cases live in supabase/tests/int304_durable_continuation.sql. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;if(!url)throw Error('INT336_DATABASE_URL required');const parsed=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!/^\/int336_test/.test(parsed.pathname))throw Error('isolated localhost fixture required');
const root=path.resolve(import.meta.dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');const readMigration=suffix=>{const f=fs.readdirSync(path.join(root,'supabase/migrations')).find(x=>x.endsWith(suffix));if(!f)throw Error('migration missing: '+suffix);return read('supabase/migrations/'+f)};let schema=read('scripts/proof/paige-durable-work-concurrency.mjs').match(/const fixtureSchema = `([\s\S]*?)`;/)?.[1];if(!schema)throw Error('fixture missing');schema=schema.replace(/create role (\w+)([^;]*);/g,(_,n,o)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${n}')then create role ${n}${o};end if;end$$;`);
const sql=`begin;${schema}
create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create function public.current_user_tenant_id()returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.has_tenant_role(a uuid,t uuid,r text)returns boolean language sql stable as $$select exists(select 1 from public.tenant_members where user_id=a and tenant_id=t and role=r and status='active')$$;
alter table public.paige_chat_threads add column interactive_latest_intent uuid;
create table public.paige_chat_turns(id uuid default gen_random_uuid(),work_id uuid,thread_id uuid,role text,interactive_intent_id uuid,interactive_actor_id uuid,interactive_tenant_id uuid,interactive_terminal_state text,bundle_ref jsonb);
${read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql')}
alter table public.paige_durable_work add column request_payload jsonb;
${readMigration('_int304_durable_continuation_read.sql').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'')}
${read('supabase/tests/int304_durable_continuation.sql')}
rollback;`;
const result=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:45000,windowsHide:true});if(result.status!==0){console.error(result.stderr);process.exit(1)}
const proofs=(result.stdout+'\n'+result.stderr).split('\n').filter(l=>l.includes('CONTINUATION_PROOF'));
if(proofs.length<20)throw Error(`expected at least 20 CONTINUATION_PROOF lines, saw ${proofs.length}`);
console.log(proofs.join('\n'));
console.log('PASS durable continuation read: exact validated fields with canonical objective, permission/tenant/actor/intent/archival gates, approval-pending only from a real expired approval, blank objective refused, ambiguous lineage refused, capability class closed, service/anon refused');
