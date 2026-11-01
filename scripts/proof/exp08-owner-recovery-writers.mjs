// Local private recovery-lock preparation only; no recovery effect or authenticated proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
assert.equal(process.env.EXP08_DISPOSABLE,'1');
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
assert.match(process.env.PGPORT??'',/^\d+$/);
const candidate=readFileSync(new URL('./exp08-owner-recovery-writers.sql',import.meta.url),'utf8');
const source=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
function original(file,name,argumentPrefix=''){
 const s=source(file),a=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('+argumentPrefix);
 assert.ok(a>=0,name);const tail=s.slice(a),tag=tail.match(/AS\s+(\$[a-z_]*\$)/i);
 assert.ok(tag,name);const end=tail.indexOf(tag[1]+';',tag.index+tag[0].length);
 assert.ok(end>0,name);return tail.slice(0,end+tag[1].length+1);
}
const db=new OperatorPostgresFixture(Number(process.env.PGPORT));
const actor='e8000000-0000-4000-8000-000000091001',holder='e8000000-0000-4000-8000-000000091002';
const tenant='e8000000-0000-4000-8000-000000091010';
const results=[];
const scalar=q=>db.run(q).split('\n').at(-1);
const call=()=>db.exec(`SELECT public._exp08_lock_owner_recovery('${tenant}')`);
async function denied(label,fn=call,pattern=/OWNER_RECOVERY_FORBIDDEN|permission denied/){
 await assert.rejects(fn,pattern,label);results.push({case:label,passed:true});
}
function reset(){
 db.role='';db.actor=actor;
 db.run(`TRUNCATE auth.users,public.user_roles,public.tenant_members,public.tenants;
 INSERT INTO auth.users VALUES('${actor}'),('${holder}');
 INSERT INTO public.user_roles VALUES('${actor}','super_admin');
 INSERT INTO public.tenants(id,account_type) VALUES('${tenant}','standalone');`);
}
function session(input){
 const p=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let out='',err='';p.stdout.on('data',d=>{out+=d;});p.stderr.on('data',d=>{err+=d;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
 p.stdin.write(input+'\n');return {p,done,out:()=>out};
}
async function until(predicate){
 const deadline=Date.now()+10000;
 while(!predicate()){assert.ok(Date.now()<deadline,'Actual local lock wait timed out');await new Promise(r=>setTimeout(r,30));}
}
async function tenantWait(label,change,commit){
 reset();const name='exp08_recovery_wait_'+Date.now();
 const first=session(`BEGIN;${change};SELECT 'exp08_recovery_holder_locked';`);
 let second;
 try{
  await until(()=>first.out().includes('exp08_recovery_holder_locked'));
  second=session(`SET application_name='${name}';${db.prefix()}SELECT public._exp08_lock_owner_recovery('${tenant}');`);
  second.p.stdin.end();
  await until(()=>scalar(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0)`)==='t');
  first.p.stdin.end(commit?'COMMIT;\n':'ROLLBACK;\n');
  assert.equal((await first.done).code,0);
  const result=await second.done;
  if(commit){assert.notEqual(result.code,0);assert.match(result.err,/OWNER_RECOVERY_FORBIDDEN/);}
  else assert.equal(result.code,0,result.err);
  results.push({case:label,passed:true});
 }finally{
  if(!first.p.stdin.destroyed)first.p.stdin.end('ROLLBACK;\n');
  await first.done;
  if(second){if(!second.p.stdin.destroyed)second.p.stdin.end();await second.done;}
 }
}
try{
 await db.exec(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN;END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN;END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN;END IF;
 END$$;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TYPE public.app_role AS ENUM('super_admin','platform_admin','admin');
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE public.user_roles(user_id uuid,role public.app_role,PRIMARY KEY(user_id,role));
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,owner_user_id uuid,account_type text,archived_at timestamptz,company boolean DEFAULT false);
 CREATE TABLE public.tenant_members(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,is_owner boolean,status text);
 -- Explicit ports for dependencies beneath the original I1 helpers, not a claimed full native schema.
 CREATE FUNCTION public.is_company_workspace(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT company FROM public.tenants WHERE id=t$$;
 CREATE FUNCTION public.is_tenant_owner(u uuid,t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(
 SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=u AND is_owner AND status='active')$$;
 ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin','_user_id uuid')}
 ${original('20271116020008_exp08_co_owner_authority.sql','is_tenant_account_holder')}
 ${original('20271120010008_exp08_owner_invitations.sql','_solo_shell_tenant')}
 ${original('20271120010008_exp08_owner_invitations.sql','_tenant_account_holder_state')}`);
 assert.equal(scalar("SELECT to_regprocedure('public._exp08_lock_owner_recovery(uuid)') IS NULL"),'t');
 results.push({case:'baseline private recovery lock step absent; not a production defect claim',passed:true});
 await db.exec(candidate);reset();await call();
 results.push({case:'live native super_admin may lock eligible holderless SOLO without changing it',passed:true});
 const state=()=>scalar(`SELECT jsonb_build_object('tenant',(SELECT to_jsonb(t) FROM public.tenants t),'members',(SELECT jsonb_agg(to_jsonb(m)) FROM public.tenant_members m))`);
 const before=state();await call();assert.equal(state(),before);
 results.push({case:'repeated lock step produces no effect or receipt',passed:true});
 db.actor='';await denied('unauthenticated refused');reset();
 db.run(`DELETE FROM public.user_roles`);await denied('revoked actual super_admin role refused');reset();
 db.run(`UPDATE public.user_roles SET role='platform_admin'`);await denied('platform_admin is not recovery authority');reset();
 db.run(`DELETE FROM auth.users WHERE id='${actor}'`);await denied('deleted identity with surviving role refused');reset();
 db.run(`UPDATE public.tenants SET account_type='agency'`);await denied('agency excluded');reset();
 db.run(`UPDATE public.tenants SET company=true`);await denied('company workspace excluded');reset();
 db.run(`UPDATE public.tenants SET archived_at=now()`);await denied('archived holderless business excluded');reset();
 db.run(`UPDATE public.tenants SET owner_user_id='${holder}';INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',true,'active')`);
 await denied('working holder excluded');reset();
 db.run(`UPDATE public.tenants SET owner_user_id='${holder}';INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',true,'suspended')`);
 await denied('billing-paused holder remains holder');reset();
 db.run(`UPDATE public.tenants SET owner_user_id='${holder}';DELETE FROM auth.users WHERE id='${holder}'`);
 assert.equal(scalar(`SELECT public._exp08_lock_owner_recovery('${tenant}')`),holder);
 results.push({case:'dangling previous holder returned using original I1 state semantics',passed:true});reset();
 for(const role of ['authenticated','anon','service_role']){
  db.role=role;await denied(role+' cannot invoke private recovery lock');db.role='';
 }
 db.run("SET paige.owner_recovery='on';DELETE FROM public.user_roles");await denied('caller-set recovery flag grants no authority');
 await tenantWait('working holder committed during actual tenant wait is refused',`UPDATE public.tenants SET owner_user_id='${holder}' WHERE id='${tenant}';INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',true,'active')`,true);
 await tenantWait('paused holder committed during actual tenant wait is refused',`UPDATE public.tenants SET owner_user_id='${holder}' WHERE id='${tenant}';INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',true,'suspended')`,true);
 await tenantWait('archiving committed during actual tenant wait is refused',`UPDATE public.tenants SET archived_at=now() WHERE id='${tenant}'`,true);
 await tenantWait('rolled-back competing holder change leaves legitimate recovery admission',`UPDATE public.tenants SET owner_user_id='${holder}' WHERE id='${tenant}';INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',true,'active')`,false);
 console.log(JSON.stringify({scope:'LOCAL private lock preparation; effect/audit/receipt/notices/public RPC NOT implemented',
  ports:'Auth uid/minimal tables/is_company_workspace/is_tenant_owner; original super-admin/I1 holder-state/eligibility source reused',
  candidateSha256:createHash('sha256').update(candidate).digest('hex'),cases:results},null,2));
}finally{
 db.role='';db.actor='';assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 console.log('Disposed only the local recovery writer preparation database created by this run.');
}
