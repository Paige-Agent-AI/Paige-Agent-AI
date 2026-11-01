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
 assert.ok(end>0,name);return tail.slice(0,end+tag[1].length+1).replace(/\r\n/g,'\n');
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
 db.run(`TRUNCATE auth.users,public.user_roles,public.tenant_members,public.tenants,public.profiles;
 INSERT INTO auth.users(id) VALUES('${actor}'),('${holder}');
 INSERT INTO public.user_roles VALUES('${actor}','super_admin');
 INSERT INTO public.tenants(id,account_type) VALUES('${tenant}','standalone');`);
 db.run(`INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${actor}','${tenant}'),('${holder}','${tenant}')`);
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
 CREATE TYPE public.tenant_role AS ENUM('owner','admin','member');
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_roles(user_id uuid,role public.app_role,PRIMARY KEY(user_id,role));
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,name text DEFAULT 'Synthetic business',owner_user_id uuid,account_type text,archived_at timestamptz,company boolean DEFAULT false,
 platform_fee_bps integer,parent_tenant_id uuid,stripe_customer_id text,stripe_subscription_id text);
 CREATE TABLE public.tenant_members(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,is_owner boolean,status text,
 role public.tenant_role DEFAULT 'member',business_owner_id uuid,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,
 action text NOT NULL,target_type text,target_id uuid,payload jsonb NOT NULL DEFAULT '{}',tenant_id uuid,
 created_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE public.paige_audit_log ENABLE ROW LEVEL SECURITY;
 GRANT ALL ON public.paige_audit_log TO authenticated,anon,service_role;
 -- Strong overlapping permission port; the actual restrictive recovery namespace must still win.
 CREATE POLICY fixture_permissive_audit ON public.paige_audit_log FOR ALL TO authenticated USING(true) WITH CHECK(true);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TYPE public.notification_type AS ENUM('system');
 CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
 type public.notification_type NOT NULL,title text NOT NULL,message text NOT NULL,action_url text,
 is_read boolean DEFAULT false,metadata jsonb,created_at timestamptz DEFAULT now(),read_at timestamptz);
 ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 GRANT SELECT,UPDATE ON public.notifications TO authenticated;
 -- Minimal original recipient-only SELECT/UPDATE policy ports; no service/other legacy policy claim.
 CREATE POLICY fixture_notice_own_select ON public.notifications FOR SELECT TO authenticated USING(auth.uid()=user_id);
 CREATE POLICY fixture_notice_own_update ON public.notifications FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
 -- Explicit ports for dependencies beneath the original I1 helpers, not a claimed full native schema.
 CREATE FUNCTION public.is_company_workspace(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT company FROM public.tenants WHERE id=t$$;
 CREATE FUNCTION public.is_tenant_owner(u uuid,t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(
 SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=u AND is_owner AND status='active')$$;
 ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin','_user_id uuid')}
 ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin',')')}
 ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_platform_owner',')')}
 ${original('20271116020008_exp08_co_owner_authority.sql','is_tenant_account_holder')}
 ${original('20271116020008_exp08_co_owner_authority.sql','grant_co_owner')}
 REVOKE ALL ON FUNCTION public.grant_co_owner(uuid,uuid) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.grant_co_owner(uuid,uuid) TO authenticated,service_role;
 ${original('20271120010008_exp08_owner_invitations.sql','_solo_shell_tenant')}
 ${original('20271120010008_exp08_owner_invitations.sql','_tenant_account_holder_state')}`);
 assert.equal(scalar("SELECT to_regprocedure('public._exp08_lock_owner_recovery(uuid)') IS NULL"),'t');
 const originalGrantBody=JSON.parse(scalar("SELECT to_json(prosrc) FROM pg_proc WHERE oid='public.grant_co_owner(uuid,uuid)'::regprocedure"));
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
 db.run(`
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
 // Original42 before shared original-grant kernel controls.
 clear();db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',false,'active')`);
 await denied('original public SOLO grant no longer admits a platform role outside recovery',
  ()=>db.exec(`SELECT public.grant_co_owner('${tenant}','${holder}')`),/CO_OWNER_FORBIDDEN/);
 await db.exec(`SELECT public._exp08_grant_co_owner('${tenant}','${holder}',true)`);
 assert.equal(scalar(`SELECT is_owner AND role='owner' FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${holder}'`),'t');
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:grant_co_owner' AND actor_user_id='${actor}' AND tenant_id='${tenant}'`),'1');
 results.push({case:'private recovery grant executes the conserved original grant body and original audit',passed:true});
 const kernelState=state(),publicMetadata=scalar("SELECT (to_jsonb(p)-'prosrc') FROM pg_proc p WHERE oid='public.grant_co_owner(uuid,uuid)'::regprocedure");
 await db.exec(candidate);assert.equal(state(),kernelState);
 assert.equal(scalar("SELECT (to_jsonb(p)-'prosrc') FROM pg_proc p WHERE oid='public.grant_co_owner(uuid,uuid)'::regprocedure"),publicMetadata);
 results.push({case:'grant kernel exact replay preserves original public metadata and native business rows',passed:true});
 for(const role of ['authenticated','anon','service_role']){
  db.role=role;await denied(role+' cannot invoke private grant kernel',()=>db.exec(`SELECT public._exp08_grant_co_owner('${tenant}','${holder}',true)`));db.role='';
 }
 await db.exec(`SELECT public._exp08_set_recovery_holder('${tenant}','${holder}')`);
 db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${actor}',false,'active')`);
 db.actor=holder;await db.exec(`SELECT public.grant_co_owner('${tenant}','${actor}')`);
 assert.equal(scalar(`SELECT is_owner AND role='owner' FROM public.tenant_members WHERE user_id='${actor}'`),'t');
 results.push({case:'actual account holder retains original public grant ABI and effect',passed:true});
 await denied('ordinary account holder is not recovery administrator',()=>db.exec(`SELECT public._exp08_grant_co_owner('${tenant}','${actor}',true)`));
 db.actor=actor;
 await denied('non-holder platform co-owner still cannot use public SOLO grant outside recovery',
  ()=>db.exec(`SELECT public.grant_co_owner('${tenant}','${holder}')`),/CO_OWNER_FORBIDDEN/);
 await denied('null private recovery mode grants no authority',()=>db.exec(`SELECT public._exp08_grant_co_owner('${tenant}','${holder}',NULL)`));
 const beforeDrift=state();
 db.run('GRANT EXECUTE ON FUNCTION public._exp08_grant_co_owner(uuid,uuid,boolean) TO authenticated');
 await denied('private kernel ACL drift refuses replay without repair',()=>db.exec(candidate),/EXP08 recovery private grant metadata or ACL drift/);
 assert.equal(scalar("SELECT has_function_privilege('authenticated','public._exp08_grant_co_owner(uuid,uuid,boolean)','EXECUTE')"),'t');
 db.run('REVOKE EXECUTE ON FUNCTION public._exp08_grant_co_owner(uuid,uuid,boolean) FROM authenticated');
 db.run('GRANT EXECUTE ON FUNCTION public.grant_co_owner(uuid,uuid) TO anon');
 await denied('original public grant ACL drift refuses without repair',()=>db.exec(candidate),/EXP08 recovery original grant metadata drift/);
 assert.equal(scalar("SELECT has_function_privilege('anon','public.grant_co_owner(uuid,uuid)','EXECUTE')"),'t');
 db.run('REVOKE EXECUTE ON FUNCTION public.grant_co_owner(uuid,uuid) FROM anon');
 const kernelDefinition=JSON.parse(scalar("SELECT to_json(pg_get_functiondef('public._exp08_grant_co_owner(uuid,uuid,boolean)'::regprocedure))"));
 db.run(`CREATE OR REPLACE FUNCTION public._exp08_grant_co_owner(_tenant uuid,_user uuid,_recovery boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN RETURN;END;$$`);
 await denied('changed private kernel source refuses without overwriting it',()=>db.exec(candidate),/EXP08 recovery grant kernel replay drift/);
 assert.equal(scalar("SELECT prosrc FROM pg_proc WHERE oid='public._exp08_grant_co_owner(uuid,uuid,boolean)'::regprocedure"),'BEGIN RETURN;END;');
 db.run(kernelDefinition);await db.exec(candidate);assert.equal(state(),beforeDrift);
 const originalKernelBody=JSON.parse(scalar("SELECT to_json(prosrc) FROM pg_proc WHERE oid='public._exp08_grant_co_owner(uuid,uuid,boolean)'::regprocedure"));
 const constant=name=>{
  const match=candidate.match(new RegExp(name+" constant text := (E?'(?:''|[^'])*');"));
  assert.ok(match,name);return JSON.parse(scalar(`SELECT to_json((${match[1]})::text)`));
 };
 const reversions=[['entire original grant body restored',originalGrantBody],
  ...['platform','begin','target'].map(name=>['individual '+name+' recovery span reverted',originalKernelBody.replace(constant('new_'+name),constant('old_'+name))])];
 for(const [label,body] of reversions){
  assert.notEqual(body,originalKernelBody,label);
  db.run(kernelDefinition.replace(originalKernelBody,body));
  await denied(label+' refuses replay',()=>db.exec(candidate),/EXP08 recovery grant kernel replay drift/);
  assert.equal(JSON.parse(scalar("SELECT to_json(prosrc) FROM pg_proc WHERE oid='public._exp08_grant_co_owner(uuid,uuid,boolean)'::regprocedure")),body);
  assert.equal(state(),beforeDrift);db.run(kernelDefinition);
 }
 await db.exec(candidate);
 // Original59 before private atomic audit/receipt controls. Reuse the actual namespace boundary.
 await db.exec(readFileSync(new URL('./exp08-owner-recovery-provenance.sql',import.meta.url),'utf8'));
 const request='e8000000-0000-4000-8000-000000092001';
 const reason='Restore the verified account holder';
 const apply=(id=request,act='set_account_holder',text=reason)=>`SELECT public._exp08_apply_owner_recovery('${tenant}','${act}','${holder}','${text}','${id}')`;
 const read=()=>JSON.parse(scalar(`SELECT public._exp08_read_owner_recovery('${tenant}','${request}')`));
 reset();seat();
 assert.equal(read().status,'not_found');results.push({case:'missing original recovery receipt stays not_found',passed:true});
 const first=JSON.parse(scalar(apply()));
 assert.equal(first.receipt.outcome,'effect_verified');assert.equal(first.receipt.notice_status,'in_app_recorded');
 assert.deepEqual(first.receipt.notified,[holder]);assert.equal(first.audit_id,request);
 assert.equal(scalar(`SELECT public._tenant_account_holder_state('${tenant}')`),'working');
 results.push({case:'private atomic R12 operation persists original recovery audit and native in-app record, not email/seen delivery',passed:true});
 const count=scalar('SELECT count(*) FROM public.paige_audit_log');
 const noticeCount=scalar('SELECT count(*) FROM public.notifications');
 assert.deepEqual(JSON.parse(scalar(apply())),first);assert.deepEqual(read(),first);
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),count);
 assert.equal(scalar('SELECT count(*) FROM public.notifications'),noticeCount);
 results.push({case:'same request replay/read succeeds after holder becomes working without repeating effect or audit',passed:true});
 await denied('same request changed reason refuses replay',()=>db.exec(apply(request,'set_account_holder','A materially different recovery reason')),/OWNER_RECOVERY_REQUEST_MISMATCH/);
 await denied('same request changed action refuses replay',()=>db.exec(apply(request,'grant_owner')),/OWNER_RECOVERY_REQUEST_MISMATCH/);
 db.run(`DELETE FROM public.user_roles`);await denied('receipt current role revocation refuses private reason disclosure',()=>db.exec(`SELECT public._exp08_read_owner_recovery('${tenant}','${request}')`));
 db.run(`INSERT INTO public.user_roles VALUES('${actor}','super_admin')`);
 db.role='authenticated';await denied('client cannot forge a native recovery audit despite overlapping allow port',
  ()=>db.exec(`INSERT INTO public.paige_audit_log(id,action) VALUES('e8000000-0000-4000-8000-000000092002','tenant:owner_recovery.set_account_holder')`),/row-level security/);db.role='';
 for(const role of ['authenticated','anon','service_role']){
  db.role=role;await denied(role+' cannot invoke private recovery apply',()=>db.exec(apply()));
  await denied(role+' cannot invoke private recovery receipt reader',()=>db.exec(`SELECT public._exp08_read_owner_recovery('${tenant}','${request}')`));db.role='';
 }
 db.run('ALTER TABLE public.paige_audit_log DISABLE TRIGGER trg_owner_recovery_audit_truncate');
 await denied('missing native retention boundary refuses receipt',()=>db.exec(`SELECT public._exp08_read_owner_recovery('${tenant}','${request}')`),/OWNER_RECOVERY_AUDIT_UNAVAILABLE/);
 db.run('ALTER TABLE public.paige_audit_log ENABLE TRIGGER trg_owner_recovery_audit_truncate');
 reset();seat();
 const rolled='e8000000-0000-4000-8000-000000092003';
 const beforeRolledNotices=scalar('SELECT count(*) FROM public.notifications');
 await db.exec(`BEGIN;${apply(rolled)};ROLLBACK;`);
 assert.equal(scalar(`SELECT owner_user_id IS NULL FROM public.tenants WHERE id='${tenant}'`),'t');
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${rolled}'`),'0');
 assert.equal(scalar('SELECT count(*) FROM public.notifications'),beforeRolledNotices);
 results.push({case:'outer rollback removes pointer and recovery receipt atomically',passed:true});
 const revoked='e8000000-0000-4000-8000-000000092004';
 await denied('unimplemented Billing-dependent revoke refuses without a success receipt',()=>db.exec(apply(revoked,'revoke_owner')),/OWNER_RECOVERY_REVOKE_UNAVAILABLE/);
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${revoked}'`),'0');
 async function operationRace(label,commit,id){
  reset();seat();const name='exp08_recovery_operation_'+Date.now();
  const oldCount=Number(scalar("SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:account_holder_changed'"));
  const oldNotices=Number(scalar('SELECT count(*) FROM public.notifications'));
  const first=session(`BEGIN;${db.prefix()}${apply(id)};SELECT 'exp08_recovery_operation_locked';`);let second;
  try{
   await until(()=>first.out().includes('exp08_recovery_operation_locked'));
   second=session(`SET application_name='${name}';${db.prefix()}${apply(id)};`);second.p.stdin.end();
   await until(()=>scalar(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0)`)==='t');
   first.p.stdin.end(commit?'COMMIT;\n':'ROLLBACK;\n');assert.equal((await first.done).code,0);
   const r=await second.done;assert.equal(r.code,0,r.err);
   assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${id}'`),'1');
   assert.equal(Number(scalar("SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:account_holder_changed'")),oldCount+1);
   assert.equal(Number(scalar('SELECT count(*) FROM public.notifications')),oldNotices+1);
   assert.equal(JSON.parse(scalar(`SELECT public._exp08_read_owner_recovery('${tenant}','${id}')`)).receipt.outcome,'effect_verified');
   results.push({case:label,passed:true});
  }finally{
   if(!first.p.stdin.destroyed)first.p.stdin.end('ROLLBACK;\n');await first.done;
   if(second){if(!second.p.stdin.destroyed)second.p.stdin.end();await second.done;}
  }
 }
 await operationRace('concurrent same request waits for commit then returns one effect and one durable recovery audit',true,'e8000000-0000-4000-8000-000000092005');
 await operationRace('concurrent same request after first rollback executes once with one committed receipt',false,'e8000000-0000-4000-8000-000000092006');
 db.run(`INSERT INTO public.user_roles VALUES('${holder}','super_admin')`);db.actor=holder;
 await denied('different live administrator cannot read the original private receipt',()=>db.exec(`SELECT public._exp08_read_owner_recovery('${tenant}','${request}')`),/OWNER_RECOVERY_RECEIPT_UNAVAILABLE/);
 await denied('different live administrator cannot reuse original request identity',()=>db.exec(apply()),/OWNER_RECOVERY_REQUEST_MISMATCH/);db.actor=actor;
 await denied('different tenant cannot read original private receipt',()=>db.exec(`SELECT public._exp08_read_owner_recovery('e8000000-0000-4000-8000-000000091020','${request}')`),/OWNER_RECOVERY_RECEIPT_UNAVAILABLE/);
 const invalid='e8000000-0000-4000-8000-000000092007';
 await denied('short reason refuses before any effect or receipt',()=>db.exec(apply(invalid,'set_account_holder','short')),/OWNER_RECOVERY_BAD_REQUEST/);
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${invalid}'`),'0');
 reset();db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${holder}',false,'active')`);
 const bound='e8000000-0000-4000-8000-000000092008';
 db.run(`CREATE FUNCTION public.fixture_recovery_context_consumer() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.is_owner AND NOT OLD.is_owner THEN
 BEGIN PERFORM public._exp08_lock_recovery_effect(NEW.tenant_id,NEW.user_id,'${bound}','revoke_owner');
 RAISE EXCEPTION 'wrong action admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public._exp08_lock_recovery_effect(NEW.tenant_id,'${actor}','${bound}','grant_owner');
 RAISE EXCEPTION 'wrong target admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public._exp08_lock_recovery_effect(NEW.tenant_id,NULL,'${bound}','grant_owner');
 RAISE EXCEPTION 'null target admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public._exp08_lock_recovery_effect(NEW.tenant_id,NEW.user_id,'${bound}','grant_owner');END IF;
 RETURN NEW;END$$;
 CREATE TRIGGER fixture_recovery_context BEFORE UPDATE OF is_owner ON public.tenant_members
 FOR EACH ROW EXECUTE FUNCTION public.fixture_recovery_context_consumer();`);
 await db.exec(apply(bound,'grant_owner'));
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${bound}' AND payload->>'outcome'='effect_verified'`),'1');
 results.push({case:'actual grant effect exposes native same-transaction preparing audit; wrong action/target/null target deny inside domain consumer',passed:true});
 db.run('DROP TRIGGER fixture_recovery_context ON public.tenant_members;DROP FUNCTION public.fixture_recovery_context_consumer()');
 await denied('committed completed audit is not a fresh effect credential',()=>db.exec(`SELECT public._exp08_lock_recovery_effect('${tenant}','${holder}','${bound}','grant_owner')`),/OWNER_RECOVERY_EFFECT_CONTEXT_UNAVAILABLE/);
 db.run(`UPDATE public.paige_audit_log SET payload=jsonb_set(payload,'{outcome}','"preparing"'::jsonb) WHERE id='${bound}'`);
 await denied('stale committed preparing audit is not a current-transaction effect credential',()=>db.exec(`SELECT public._exp08_lock_recovery_effect('${tenant}','${holder}','${bound}','grant_owner')`),/OWNER_RECOVERY_EFFECT_CONTEXT_UNAVAILABLE/);
 db.run(`UPDATE public.paige_audit_log SET payload=jsonb_set(payload,'{outcome}','"effect_verified"'::jsonb) WHERE id='${bound}'`);
 const internal=JSON.parse(scalar(`SELECT public._exp08_read_owner_recovery('${tenant}','${bound}')`));
 assert.equal(internal.receipt.transaction_id,undefined);assert.equal(internal.receipt.backend_pid,undefined);
 results.push({case:'private receipt omits internal backend and transaction identity',passed:true});
 const nativeNotice=first.receipt.notices[0].notification_id;
 db.actor=holder;
 const detail=()=>JSON.parse(scalar(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`));
 // Restore the original R12 notice's recipient as the current active owner in the same scope.
 db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) SELECT '${tenant}','${holder}',true,'active'
 WHERE NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${holder}')`);
 assert.equal(detail().reason,reason);
 results.push({case:'current native recipient reads private recovery reason from original audit, not raw notification',passed:true});
 const raw=JSON.parse(scalar(`SELECT to_jsonb(n) FROM public.notifications n WHERE id='${nativeNotice}'`));
 assert.equal(raw.message.includes(reason),false);assert.equal(raw.title.includes('Synthetic business'),false);
 assert.deepEqual(Object.keys(raw.metadata).sort(),['audit_id','kind']);assert.equal(raw.action_url,null);
 results.push({case:'legacy global notification row holds no business name/reason/private content or navigation authority',passed:true});
 db.role='authenticated';assert.equal(scalar(`SELECT count(*) FROM public.notifications WHERE id='${nativeNotice}'`),'1');
 db.run(`UPDATE public.notifications SET metadata=jsonb_build_object('kind','exp08_owner_recovery','audit_id','${bound}') WHERE id='${nativeNotice}'`);db.role='';
 await denied('client-edited own metadata cannot substitute another native notice binding',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.role='authenticated';db.run(`UPDATE public.notifications SET metadata=jsonb_build_object('kind','exp08_owner_recovery','audit_id','not-a-uuid') WHERE id='${nativeNotice}'`);db.role='';
 await denied('malformed client metadata receives typed refusal, not a private-data read',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.run(`UPDATE public.notifications SET metadata=jsonb_build_object('kind','exp08_owner_recovery','audit_id','${request}') WHERE id='${nativeNotice}'`);
 db.run(`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${holder}'`);
 await denied('currently banned recipient cannot read private notice detail',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.run(`UPDATE auth.users SET banned_until=now()-interval '1 hour' WHERE id='${holder}'`);assert.equal(detail().reason,reason);
 results.push({case:'expired recipient ban retains legitimate scoped notice reading',passed:true});
 db.run(`UPDATE auth.users SET deleted_at=now() WHERE id='${holder}'`);
 await denied('soft-deleted recipient cannot read private notice detail',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.run(`UPDATE auth.users SET deleted_at=NULL WHERE id='${holder}';UPDATE public.tenants SET archived_at=now() WHERE id='${tenant}'`);
 await denied('archived business refuses private recovery detail',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.run(`UPDATE public.tenants SET archived_at=NULL WHERE id='${tenant}'`);
 db.run(`UPDATE public.profiles SET active_tenant_id='e8000000-0000-4000-8000-000000091020' WHERE user_id='${holder}'`);
 await denied('wrong active workspace cannot read private recovery notice',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.run(`UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${holder}';UPDATE public.tenant_members SET is_owner=false,status='revoked' WHERE tenant_id='${tenant}' AND user_id='${holder}'`);
 await denied('recipient departure revokes original active-owner notice detail',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.actor=actor;
 await denied('non-recipient administrator cannot borrow another user notification',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.role='authenticated';assert.equal(scalar(`SELECT count(*) FROM public.notifications WHERE id='${nativeNotice}'`),'0');db.role='';
 results.push({case:'original recipient-only RLS port hides another user raw notification',passed:true});
 for(const role of ['authenticated','anon','service_role']){
  db.role=role;await denied(role+' cannot invoke private notice producer',()=>db.exec(`SELECT public._exp08_record_recovery_notices('${tenant}','${request}')`));
  await denied(role+' cannot invoke private notice detail reader',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${nativeNotice}')`));db.role='';
 }
 reset();seat();const former='e8000000-0000-4000-8000-000000091003',formerRequest='e8000000-0000-4000-8000-000000092009';
 db.run(`INSERT INTO auth.users(id) VALUES('${former}');INSERT INTO public.profiles VALUES('${former}','${tenant}')`);
 db.actor='';db.run(`UPDATE public.tenants SET owner_user_id='${former}' WHERE id='${tenant}'`);db.actor=actor;
 const formerResult=JSON.parse(scalar(apply(formerRequest)));
 assert.equal(formerResult.receipt.notices.length,2);
 const formerNotice=formerResult.receipt.notices.find(x=>x.user_id===former).notification_id;
 db.actor=former;
 assert.equal(JSON.parse(scalar(`SELECT public._exp08_read_recovery_notice('${tenant}','${formerNotice}')`)).reason,reason);
 results.push({case:'approved live original holder-of-record receives only its scoped event detail without a team seat',passed:true});
 db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status) VALUES('${tenant}','${former}',false,'revoked')`);
 await denied('subsequent membership change revokes former-holder snapshot detail',()=>db.exec(`SELECT public._exp08_read_recovery_notice('${tenant}','${formerNotice}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);
 db.actor=actor;reset();seat();const failed='e8000000-0000-4000-8000-000000092010';
 const beforeFailedAudits=scalar('SELECT count(*) FROM public.paige_audit_log'),beforeFailedNotices=scalar('SELECT count(*) FROM public.notifications');
 db.run(`CREATE FUNCTION public.fixture_notice_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION 'fixture native notice insertion failed' USING ERRCODE='23514';END$$;
 CREATE TRIGGER fixture_notice_failure AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.fixture_notice_failure()`);
 await denied('late notice insertion failure refuses entire recovery operation',()=>db.exec(apply(failed)),/fixture native notice insertion failed/);
 assert.equal(scalar(`SELECT owner_user_id IS NULL FROM public.tenants WHERE id='${tenant}'`),'t');
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),beforeFailedAudits);
 assert.equal(scalar('SELECT count(*) FROM public.notifications'),beforeFailedNotices);
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${failed}'`),'0');
 results.push({case:'late native notice failure rolls back pointer, domain/recovery audits and all notices together',passed:true});
 db.run('DROP TRIGGER fixture_notice_failure ON public.notifications;DROP FUNCTION public.fixture_notice_failure()');
 console.log(JSON.stringify({source:baseline?'historical02126':'current candidate',scope:'LOCAL private recovery, durable audit/in-app notices and read-now detail; public RPC, mounted UI, email and Billing-dependent revoke NOT implemented',
  ports:'Auth uid/minimal tables/is_company_workspace/is_tenant_owner; original super-admin/I1 holder-state/eligibility source reused',
  candidateSha256:createHash('sha256').update(candidate).digest('hex'),cases:results},null,2));
}finally{
 db.role='';db.actor='';assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 console.log('Disposed only the local recovery writer preparation database created by this run.');
}
