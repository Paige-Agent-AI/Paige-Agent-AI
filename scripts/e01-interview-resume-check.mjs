/** EXP01 PR4 — latest_solo_business_interview_thread() resume lookup, proven against a
 * real local PostgreSQL. Rollback-only: fixture schema + platform-assert shims + the REAL
 * checkpoint migration + the REAL new migration, then the cases in
 * supabase/tests/e01_interview_resume.sql. Mirrors scripts/int304-continuation-read-check.mjs. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;if(!url)throw Error('INT336_DATABASE_URL required');const parsed=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!/^\/int336_test/.test(parsed.pathname))throw Error('isolated localhost fixture required');
const root=path.resolve(import.meta.dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const stripTx=p=>p.replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
// Platform shims: auth/tenant context from GUC settings, and the canonical-tenant asserts
// the sibling chain leans on. The checkpoint validation itself is the REAL migration's.
const shims=`
create schema if not exists auth;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role()returns text language sql stable as $$select coalesce(current_setting('request.jwt.claim.role',true),'authenticated')$$;
create function public.current_user_tenant_id()returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.is_tenant_owner(a uuid,t uuid)returns boolean language sql stable as $$select exists(select 1 from public.tenant_members where user_id=a and tenant_id=t and is_owner and status='active')$$;
create function public.solo_setup_access_scope()returns text language sql stable as $$select 'owner_full'::text$$;
create function public.solo_setup_can_read()returns boolean language sql stable as $$select exists(select 1 from public.tenant_members m where m.user_id=auth.uid() and m.tenant_id=public.current_user_tenant_id() and m.status='active')$$;
create function public.solo_setup_assert_canonical_tenant()returns uuid language plpgsql stable as $$
declare v_uid uuid:=auth.uid();v_tid uuid:=public.current_user_tenant_id();
begin
  if v_uid is null or v_tid is null then raise exception 'Solo Setup requires an authenticated workspace member' using errcode='42501'; end if;
  return v_tid;
end$$;
create function public.solo_setup_assert_canonical_tenant_for_read()returns uuid language plpgsql stable as $$
declare v_uid uuid:=auth.uid();v_tid uuid:=public.current_user_tenant_id();
begin
  if v_uid is null or v_tid is null or not public.solo_setup_can_read() then raise exception 'Solo Setup requires an authenticated workspace member' using errcode='42501'; end if;
  return v_tid;
end$$;
`;
const fixtureSchema=`
create table public.profiles(user_id uuid primary key);
create table public.tenants(id uuid primary key, account_type text, parent_tenant_id uuid, status text, archived_at timestamptz, lifecycle_execution_paused boolean default false, features jsonb default '{}'::jsonb);
create table public.tenant_members(tenant_id uuid, user_id uuid, role text, status text, is_owner boolean default false);
create table public.tenant_setup_business_context_meta(tenant_id uuid primary key, revision bigint default 0);
create table public.paige_chat_threads(id uuid primary key, tenant_id uuid, caller_user_id uuid, lens text default 'coach', contact_id uuid, studio_session_id uuid, is_archived boolean default false);
create table public.paige_chat_turns(id uuid default gen_random_uuid() primary key, seq bigint, thread_id uuid, role text, content text, interactive_terminal_state text, work_id uuid, bundle_ref jsonb, created_at timestamptz default now());
`;
const roles=['anon','authenticated','service_role'].map(r=>`do $$begin if not exists(select 1 from pg_roles where rolname='${r}')then create role ${r} nologin;end if;end$$;`).join('');
const sql=`begin;${roles}${fixtureSchema}${shims}
${stripTx(read('supabase/migrations/20271107100000_solo_business_interview_checkpoint.sql'))}
${stripTx(read('supabase/migrations/20271113420000_latest_solo_business_interview_thread.sql'))}
${read('supabase/tests/e01_interview_resume.sql')}
rollback;`;
const result=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:60000,windowsHide:true});
if(result.status!==0){console.error(result.stderr);process.exit(1)}
const proofs=(result.stdout+'\n'+result.stderr).split('\n').filter(l=>l.includes('INTERVIEW_RESUME_PROOF'));
const passes=proofs.filter(l=>!l.includes(' FAIL '));
const fails=proofs.filter(l=>l.includes(' FAIL '));
if(fails.length){console.error(fails.join('\n'));process.exit(1)}
if(passes.length<8)throw Error(`expected 8 passing INTERVIEW_RESUME_PROOF lines, saw ${passes.length}`);
console.log(passes.join('\n'));
console.log('PASS e01 interview resume lookup: newest unfinished wins, completed retires, forged checkpoints skipped fail-closed, rejected thread shapes never burn the candidate window, foreign tenant/caller excluded, caller sees own newest, unauthenticated refused, execute authenticated-only');
