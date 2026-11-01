// Local private recovery admission/R12 effect preparation; no public RPC or authenticated proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
assert.equal(process.env.EXP08_DISPOSABLE,'1');
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
assert.match(process.env.PGPORT??'',/^\d+$/);
assert.ok(process.argv.slice(2).every(x=>x==='--baseline-02126')&&process.argv.length<=3,'Unknown proof option');
const baseline=process.argv.includes('--baseline-02126');
const historical=baseline?spawnSync('git',['show','02126ee52:scripts/proof/exp08-owner-recovery-writers.sql'],{encoding:'utf8',windowsHide:true}):null;
if(historical)assert.equal(historical.status,0,historical.stderr);
const candidate=historical?.stdout??readFileSync(new URL('./exp08-owner-recovery-writers.sql',import.meta.url),'utf8');
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
 INSERT INTO auth.users(id) VALUES('${actor}'),('${holder}');
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
async function identityUpdateWait(label,change){
 reset();const name='exp08_recovery_identity_'+Date.now();
 const first=session(`BEGIN;${db.prefix()}SELECT public._exp08_lock_owner_recovery('${tenant}');SELECT 'exp08_recovery_identity_locked';`);
 let second;
 try{
  await until(()=>first.out().includes('exp08_recovery_identity_locked'));
  second=session(`SET application_name='${name}';${change};`);second.p.stdin.end();
  await until(()=>scalar(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0)`)==='t');
  first.p.stdin.end('ROLLBACK;\n');assert.equal((await first.done).code,0);
  const r=await second.done;assert.equal(r.code,0,r.err);
  await denied(label+' then refuses subsequent admission');
 }finally{
  if(!first.p.stdin.destroyed)first.p.stdin.end('ROLLBACK;\n');await first.done;
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
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_roles(user_id uuid,role public.app_role,PRIMARY KEY(user_id,role));
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,owner_user_id uuid,account_type text,archived_at timestamptz,company boolean DEFAULT false,
 platform_fee_bps integer,parent_tenant_id uuid,stripe_customer_id text,stripe_subscription_id text);
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
 db.run(`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}'`);await denied('soft-deleted identity with surviving role refused');reset();
 db.run(`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${actor}'`);await denied('currently banned identity refused');reset();
 db.run(`UPDATE auth.users SET banned_until=now()-interval '1 hour' WHERE id='${actor}'`);await call();
 results.push({case:'expired ban does not deny otherwise legitimate recovery admission',passed:true});reset();
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
 await tenantWait('soft deletion committed before identity lock is refused',`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}'`,true);
 await tenantWait('ban committed before identity lock is refused',`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${actor}'`,true);
 await tenantWait('rolled-back soft deletion retains legitimate admission',`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}'`,false);
 await tenantWait('rolled-back ban retains legitimate admission',`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${actor}'`,false);
 await identityUpdateWait('admission identity lock blocks competing ban',`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${actor}'`);
 await identityUpdateWait('admission identity lock blocks competing soft deletion',`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}'`);
 // Add the real I1 pointer guard/audit only after preserving all original30 admission controls.
 db.run(`CREATE TABLE public.paige_audit_log(id uuid DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,
 action text,target_type text,target_id uuid,payload jsonb,tenant_id uuid);
 ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin',')')}
 ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_platform_owner',')')}
 ${original('20271120010008_exp08_owner_invitations.sql','guard_tenant_owner_only_columns')}
 ${original('20271120010008_exp08_owner_invitations.sql','_tenant_account_holder_changed')}
 CREATE TRIGGER original_holder_guard BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_owner_only_columns();
 CREATE TRIGGER original_holder_audit AFTER UPDATE OF owner_user_id ON public.tenants FOR EACH ROW
 WHEN(OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id) EXECUTE FUNCTION public._tenant_account_holder_changed();`);
 const setHolder=()=>db.exec(`SELECT public._exp08_set_recovery_holder('${tenant}','${holder}')`);
 const seat=()=>db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',true,'active')`);
 const clear=()=>{reset();db.run('TRUNCATE public.paige_audit_log');};
 clear();await denied('R12 refuses a live target without an active owner seat',setHolder,/OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER/);
 seat();db.run(`UPDATE public.tenant_members SET status='suspended'`);
 await denied('R12 refuses a suspended target owner seat',setHolder,/OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER/);
 clear();seat();db.run(`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${holder}'`);
 await denied('R12 refuses a banned target rather than restoring an unusable holder',setHolder,/OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER/);
 clear();seat();db.run(`UPDATE auth.users SET deleted_at=now() WHERE id='${holder}'`);
 await denied('R12 refuses a soft-deleted target',setHolder,/OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER/);
 clear();seat();
 await db.exec(`DO $$BEGIN
 PERFORM set_config('paige.owner_recovery','off',true);
 PERFORM public._exp08_set_recovery_holder('${tenant}','${holder}');
 IF current_setting('paige.owner_recovery',true)<>'off' THEN RAISE EXCEPTION 'flag leaked';END IF;
 END$$;`);
 assert.equal(scalar(`SELECT public._tenant_account_holder_state('${tenant}')`),'working');
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:account_holder_changed'
 AND actor_user_id='${actor}' AND tenant_id='${tenant}' AND payload->>'recovery'='true'`),'1');
 results.push({case:'R12 private effect uses original pointer guard/audit and restores caller flag',passed:true});
 await denied('R12 repeated effect refuses the now-working holder without a duplicate pointer audit',setHolder);
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),'1');
 clear();seat();
 await db.exec(`BEGIN;SELECT public._exp08_set_recovery_holder('${tenant}','${holder}');ROLLBACK;`);
 assert.equal(scalar(`SELECT owner_user_id IS NULL FROM public.tenants WHERE id='${tenant}'`),'t');
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),'0');
 results.push({case:'outer transaction rollback removes private pointer effect and original audit together',passed:true});
 for(const role of ['authenticated','anon','service_role']){
  db.role=role;await denied(role+' cannot invoke private R12 effect',setHolder);db.role='';
 }
 clear();db.run(`INSERT INTO public.tenants(id,account_type) VALUES('e8000000-0000-4000-8000-000000091020','standalone');
 INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('e8000000-0000-4000-8000-000000091020','${holder}',true,'active')`);
 await denied('R12 refuses an owner seat belonging only to another business',setHolder,/OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER/);
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),'0');
 clear();seat();
 db.run(`CREATE FUNCTION public.fixture_recovery_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION 'fixture late audit failure' USING ERRCODE='23514';END$$;
 CREATE TRIGGER zz_fixture_recovery_failure AFTER UPDATE OF owner_user_id ON public.tenants
 FOR EACH ROW EXECUTE FUNCTION public.fixture_recovery_audit_failure();`);
 await db.exec(`DO $$BEGIN
 PERFORM set_config('paige.owner_recovery','off',true);
 BEGIN PERFORM public._exp08_set_recovery_holder('${tenant}','${holder}');
 RAISE EXCEPTION 'expected fixture failure';
 EXCEPTION WHEN check_violation THEN
 IF current_setting('paige.owner_recovery',true)<>'off' THEN RAISE EXCEPTION 'flag leaked after failure';END IF;
 END;END$$;`);
 assert.equal(scalar(`SELECT owner_user_id IS NULL FROM public.tenants WHERE id='${tenant}'`),'t');
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),'0');
 results.push({case:'late trigger failure atomically removes pointer/audit and restores recovery flag',passed:true});
 db.run('DROP TRIGGER zz_fixture_recovery_failure ON public.tenants;DROP FUNCTION public.fixture_recovery_audit_failure()');
 console.log(JSON.stringify({source:baseline?'historical02126':'current candidate',scope:'LOCAL private admission and R12 effect with original I1 audit; public recovery RPC/recovery receipt/notices NOT implemented',
  ports:'Auth uid/minimal tables/is_company_workspace/is_tenant_owner; original super-admin/I1 holder-state/eligibility source reused',
  candidateSha256:createHash('sha256').update(candidate).digest('hex'),cases:results},null,2));
}finally{
 db.role='';db.actor='';assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 console.log('Disposed only the local recovery writer preparation database created by this run.');
}
