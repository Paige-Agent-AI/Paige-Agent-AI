// Original EXP08 outcome4 departure proof. Explicit disposable loopback database only.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
import {verifyHubDoorDeparture} from './exp08-team-hub-departure-doors.mjs';
assert.equal(process.env.EXP08_DISPOSABLE,'1','Explicit disposable proof opt-in required');
const host=process.env.PGHOST;
assert(['127.0.0.1','localhost','::1'].includes(host),'Dedicated loopback proof only');
assert.match(process.env.PGPORT??'',/^\d+$/,'Explicit local port required');
const options=process.argv.slice(2),mutants=['scope','authority','pair-locks','protected','identity-check','identity-lock'];
const prerequisitesOnly=options.includes('--prerequisites-only');
const hubDoorsOnly=options.includes('--hub-doors-only');
const protectedOnly=options.includes('--protected-only')||prerequisitesOnly||hubDoorsOnly;
const identityFkOnly=options.includes('--identity-fk-only');
const identityOnly=options.includes('--identity-only')||identityFkOnly;
assert(options.length<=1&&options.every(a=>a==='--baseline'||a==='--protected-only'||a==='--prerequisites-only'||a==='--identity-only'||a==='--identity-fk-only'||a==='--hub-doors-only'||mutants.some(m=>a==='--mutant-'+m)),'Unknown proof option');
const mutant=mutants.find(m=>options.includes('--mutant-'+m));
const repo=fileURLToPath(new URL('../../',import.meta.url));
// Reuse the shared fixture unchanged, preserving the original EXP08 loopback-host ABI.
// Its constructor calls args() dynamically, so database creation uses this same selected host.
class DeparturePostgresFixture extends OperatorPostgresFixture {
 args(database){
  const values=super.args(database),index=values.indexOf('-h');
  assert(index>=0&&values[index+1]==='127.0.0.1','Shared local fixture host argument changed');
  values[index+1]=host;return values;
 }
}
const source=(file,name)=>{const s=readFileSync(join(repo,file),'utf8');const a=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),b=s.indexOf('$function$;',a);assert(a>=0&&b>a);return s.slice(a,b+11);};
// Canonical Git/LF for this never-applied candidate only; incumbent source hashes stay exact.
const inertPatch=readFileSync(join(repo,'scripts/proof/exp08-member-removal-currentness-patch.sql'),'utf8').replace(/\r\n/g,'\n');
const carrierPath=join(repo,'supabase/migrations/20271126140008_exp08_departure_currentness.sql');
assert(existsSync(carrierPath),'Actual versioned forward carrier is required; inert-only fallback is not release proof');
const candidatePatch=readFileSync(carrierPath,'utf8').replace(/\r\n/g,'\n');
assert.equal(candidatePatch.slice(candidatePatch.indexOf('\n')),inertPatch.slice(inertPatch.indexOf('\n')),'Actual forward carrier must preserve the reviewed inert SQL exactly after its first comment');
const db=new DeparturePostgresFixture(Number(process.env.PGPORT));db.prefix=()=>'';
const program=()=>db.psql,args=()=>db.args(),sql=s=>db.run(s);
const connections=[];
const ids={tenant:'e8000000-0000-4000-8000-000000080010',other:'e8000000-0000-4000-8000-000000080020',actor:'e8000000-0000-4000-8000-000000080300',target:'e8000000-0000-4000-8000-000000080200'};
const resetIdentities=()=>sql(`TRUNCATE auth.users,public.profiles;INSERT INTO auth.users(id,email) VALUES('${ids.actor}','test-actor@tests.invalid'),('${ids.target}','test-target@tests.invalid');`);
const output=[];
const business=()=>sql("SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.tenant_members t),'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.user_id) FROM public.profiles p),'audits',(SELECT jsonb_agg(to_jsonb(a)) FROM public.audit_logs a))");
const candidate=!process.argv.includes('--baseline');
const delay=()=>new Promise(r=>setTimeout(r,20));
function connection(text,interactive=false){const p=spawn(program('psql'),args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});p.stdin[interactive?'write':'end'](text+'\n');connections.push({p,done});return {p,done,read:()=>out};}
try{
 sql(`CREATE SCHEMA auth; DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;
 END$$;
 CREATE TYPE public.tenant_role AS ENUM('owner','admin','member');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'authenticated'::text$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.tenants(id uuid PRIMARY KEY);
 CREATE TABLE public.tenant_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,status text,is_owner boolean,role public.tenant_role,joined_at timestamptz DEFAULT now(),UNIQUE(tenant_id,user_id));
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
 CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
 GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;`);
 if(identityFkOnly)sql(`ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN suspended_by uuid,
  ADD CONSTRAINT profiles_suspended_by_fkey FOREIGN KEY(suspended_by) REFERENCES auth.users(id);
  COMMENT ON CONSTRAINT profiles_user_id_fkey ON public.profiles IS 'Exact production constraint semantics; other profile columns/triggers remain outside this minimal fixture';`);
 sql(source('supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql','is_tenant_owner'));
 sql(source('supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql','current_user_tenant_id'));
 sql(source('supabase/migrations/20271115040008_exp08_team_lifecycle.sql','remove_solo_team_member'));
 sql('REVOKE ALL ON FUNCTION public.remove_solo_team_member(uuid,uuid) FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.remove_solo_team_member(uuid,uuid) TO authenticated;');
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.remove_solo_team_member(uuid,uuid)'::regprocedure"),'d8c0eb6a8fdc3fef52eda7df4f9274e1');
 function applyCandidate(){
  const metadata=sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.remove_solo_team_member(uuid,uuid)'::regprocedure");
  const patch=candidatePatch;
  sql(patch);sql(patch);
  assert.equal(sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.remove_solo_team_member(uuid,uuid)'::regprocedure"),metadata,'all original pg_proc metadata and ACLs conserved on patch/replay');
  if(mutant){
   // psql on Windows renders LF as CRLF; normalize the transport copy, never a database hash.
   const before=sql("SELECT pg_get_functiondef('public.remove_solo_team_member(uuid,uuid)'::regprocedure)").replace(/\r\n/g,'\n');
   const edits={
    scope:['IF public.current_user_tenant_id() IS DISTINCT FROM _tenant THEN','IF false THEN'],
    authority:['IF NOT _caller_owner AND NOT EXISTS (\n    SELECT 1 FROM public.tenant_members current_actor','IF false AND NOT EXISTS (\n    SELECT 1 FROM public.tenant_members current_actor'],
    'pair-locks':['  PERFORM 1 FROM public.tenant_members departure_seat\n    WHERE departure_seat.tenant_id = _tenant AND departure_seat.user_id IN (_actor, _member_user_id)\n    ORDER BY departure_seat.user_id FOR UPDATE;','  PERFORM 1;'],
    protected:["IF public.map_tenant_role_to_app_role(_target.role) = 'admin'::public.app_role","IF false AND public.map_tenant_role_to_app_role(_target.role) = 'admin'::public.app_role"],
    'identity-check':['IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM auth.users current_identity','IF false AND NOT EXISTS (SELECT 1 FROM auth.users current_identity'],
    'identity-lock':['PERFORM 1 FROM auth.users current_identity WHERE current_identity.id = _actor FOR SHARE;','PERFORM 1;'],
   };
   const [original,replacement]=edits[mutant];
   assert.equal(before.split(original).length,2,'mutant must alter exactly one actual source span: '+JSON.stringify(before.match(/IF NOT _caller_owner[\s\S]{0,130}/g)));
   sql(before.replace(original,replacement));
  }
 }
 if(candidate){
  // Exercise the ORIGINAL role-sync and protected-role trigger, not a substitute refusal.
  sql(`CREATE TYPE public.app_role AS ENUM('user','admin','super_admin','platform_admin','developer');
   CREATE TABLE public.app_settings_owner(owner_email text);
   CREATE TABLE public.user_roles(user_id uuid,role public.app_role,UNIQUE(user_id,role));`);
  sql(source('supabase/migrations/20270509000000_nothing_reads_the_retired_title_role.sql','map_tenant_role_to_app_role'));
  sql(source('supabase/migrations/20271115040008_exp08_team_lifecycle.sql','sync_tenant_member_to_user_roles'));
  const originalProtection=readFileSync(join(repo,'supabase/migrations/20251020145501_8b37061e-d124-4d12-9907-7b62f110979b.sql'),'utf8');
  const start=originalProtection.indexOf('create or replace function public.prevent_owner_admin_removal()');
  const end=originalProtection.indexOf('$$;',start);
  assert(start>=0&&end>start);sql(originalProtection.slice(start,end+3));
  for(const [name,md5] of [['map_tenant_role_to_app_role','60dfcc70ea811ca2ac255d9e19c20714'],['sync_tenant_member_to_user_roles','be8cc66ffe2f226a62a0d34c11303023'],['prevent_owner_admin_removal','daeb1b91408969a62224140148a99414']]){
   assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE proname='${name}'`),md5,'original production role writer/guard source must match');
  }
  sql(`REVOKE ALL ON FUNCTION public.sync_tenant_member_to_user_roles(),public.prevent_owner_admin_removal() FROM PUBLIC,anon,authenticated,service_role;
   GRANT EXECUTE ON FUNCTION public.sync_tenant_member_to_user_roles(),public.prevent_owner_admin_removal() TO service_role;
   REVOKE ALL ON FUNCTION public.map_tenant_role_to_app_role(public.tenant_role) FROM PUBLIC,postgres,anon,authenticated,service_role;
   GRANT EXECUTE ON FUNCTION public.map_tenant_role_to_app_role(public.tenant_role) TO postgres,PUBLIC,anon,authenticated,service_role;`);
  applyCandidate();
  sql(`CREATE TRIGGER trg_sync_tenant_member_to_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_member_to_user_roles();
   CREATE TRIGGER protect_owner_admin BEFORE UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_admin_removal();`);
  if((!mutant||mutant==='protected')&&!identityOnly&&!prerequisitesOnly&&!hubDoorsOnly)for(const c of [
   {name:'protected last admin',refused:true},
   {name:'protected other active admin',otherRole:'admin',success:true},
   {name:'protected other active owner',otherRole:'owner',success:true},
   {name:'protected inactive admin',otherRole:'admin',otherStatus:'suspended',refused:true},
   {name:'protected other active member',otherRole:'member',refused:true},
   {name:'ordinary admin',ordinary:true,success:true},
   {name:'protected member',targetRole:'member',success:true},
   {name:'protected suspended admin without global admin',targetStatus:'suspended',success:true},
  ]){
   sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants,public.user_roles,auth.users,public.app_settings_owner;
    INSERT INTO public.tenants VALUES('${ids.tenant}'),('${ids.other}');
    INSERT INTO auth.users(id,email) VALUES('${ids.actor}','test-owner@tests.invalid'),('${ids.target}','test-target@tests.invalid');
    INSERT INTO public.app_settings_owner VALUES('${c.ordinary?'different-person':'test-target'}@tests.invalid');
    INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
     ('${ids.tenant}','${ids.actor}','active',true,'owner'),('${ids.tenant}','${ids.target}','${c.targetStatus??'active'}',false,'${c.targetRole??'admin'}');
    INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');`);
   if(c.otherRole)sql(`INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES('${ids.other}','${ids.target}','${c.otherStatus??'active'}',${c.otherRole==='owner'},'${c.otherRole}');`);
   const before=business(),rolesBefore=sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,role) FROM public.user_roles r');
   const call=()=>sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');COMMIT;`);
   if(c.refused){
    assert.throws(call,e=>e.code==='42501'&&e.message.includes('TEAM_MEMBER_PROTECTED'),'protected account must receive its authored pre-write refusal');
    assert.equal(business(),before);assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,role) FROM public.user_roles r'),rolesBefore);
   }else{
    call();assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}'`),'0');
    assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');
    const retained=c.otherRole==='admin'||c.otherRole==='owner';
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${ids.target}' AND role='admin')`),retained?'t':'f');
   }
   output.push({change:c.name,authoredPreWriteRefusal:!!c.refused,originalRoleSync:true,success:!!c.success});
  }
  sql('DROP TRIGGER trg_sync_tenant_member_to_user_roles ON public.tenant_members;DROP TRIGGER protect_owner_admin ON public.user_roles;TRUNCATE public.user_roles,auth.users,public.profiles,public.app_settings_owner;');
 }
 if(candidate&&(!mutant||mutant==='identity-check')&&!protectedOnly&&!identityFkOnly)for(const c of [
  {name:'active actor',success:true},
  {name:'banned actor',banned:true},
  {name:'deleted actor',deleted:true},
  {name:'missing actor identity',missing:true},
  {name:'expired actor ban',expired:true,success:true},
 ]){
  sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants,auth.users;
   INSERT INTO public.tenants VALUES('${ids.tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
    ('${ids.tenant}','${ids.actor}','active',false,'admin'),('${ids.tenant}','${ids.target}','active',false,'member');
   INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');`);
  if(!c.missing)sql(`INSERT INTO auth.users(id,email,deleted_at,banned_until) VALUES('${ids.actor}','test-actor@tests.invalid',${c.deleted?'now()':'NULL'},${c.banned?"now()+interval '1 hour'":c.expired?"now()-interval '1 hour'":'NULL'});`);
  const before=business(),identities=sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u');
  const call=()=>sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');COMMIT;`);
  if(c.success){call();assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE user_id='${ids.target}'`),'0');}
  else{assert.throws(call,e=>e.code==='42501'&&e.message.includes('TEAM_MEMBER_IDENTITY_UNAVAILABLE'),'unavailable actor identity must refuse before the original removal effect');assert.equal(business(),before);}
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u'),identities,'identity admission never writes Auth');
  output.push({change:c.name,success:!!c.success,authUnchanged:true});
 }
 if(candidate&&(!mutant||mutant==='identity-lock')&&!protectedOnly)for(const change of ['ban','delete','soft-delete'])for(const commit of [true,false]){
  resetIdentities();
  sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants;
   INSERT INTO public.tenants VALUES('${ids.tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
    ('${ids.tenant}','${ids.actor}','active',false,'admin'),('${ids.tenant}','${ids.target}','active',false,'member');
   INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');`);
  const before=business();
  const mutation=change==='delete'?`DELETE FROM auth.users WHERE id='${ids.actor}'`:
   `UPDATE auth.users SET ${change==='ban'?"banned_until=clock_timestamp()+interval '1 hour'":'deleted_at=clock_timestamp()'} WHERE id='${ids.actor}'`;
  const held=connection(`BEGIN;SET application_name='exp08_identity_holder';${mutation};SELECT 'held';`,true);
  let waiting;
  try{
   for(let i=0;!held.read().includes('held')&&i<150;i++)await delay();
   assert(held.read().includes('held'),'identity mutation transaction is held');
   waiting=connection(`SET application_name='exp08_identity_waiter';SET statement_timeout='10s';SELECT set_config('request.jwt.claim.sub','${ids.actor}',false);SET ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');`);
   let observed=false;
   for(let i=0;i<150;i++){
    if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE w.application_name='exp08_identity_waiter' AND w.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity h WHERE h.application_name='exp08_identity_holder' AND h.pid=ANY(pg_blocking_pids(w.pid))))")==='t'){observed=true;break;}
    await delay();
   }
   assert(observed,'original removal must actually wait for the actor identity transaction');
  }finally{held.p.stdin.end(commit?'COMMIT;\n':'ROLLBACK;\n');assert.equal((await held.done).code,0);}
  const result=await waiting.done;
  if(commit){
   assert.notEqual(result.code,0);assert(result.err.includes('TEAM_MEMBER_IDENTITY_UNAVAILABLE'),result.err);
   const expected=JSON.parse(before);
   if(identityFkOnly&&change==='delete')expected.profiles=expected.profiles.filter(p=>p.user_id!==ids.actor);
   assert.deepEqual(JSON.parse(business()),expected,'revocation leaves all membership/target-profile/audit rows unchanged; only the original Auth cascade may delete actor profile');
  }
  else{assert.equal(result.code,0,result.err);assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE user_id='${ids.target}'`),'0');}
  assert(!/deadlock|statement timeout/i.test(result.err),'identity serialization must not depend on an abort');
  output.push({change:'identity-first '+change,commit,actualIdentityLockWait:true,removed:!commit,actualProfileFkSemantics:identityFkOnly});
 }
 if(candidate&&!mutant&&!protectedOnly)for(const change of ['ban','delete','soft-delete']){
  resetIdentities();
  sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants;
   INSERT INTO public.tenants VALUES('${ids.tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
    ('${ids.tenant}','${ids.actor}','active',false,'admin'),('${ids.tenant}','${ids.target}','active',false,'member');
   INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');`);
  const held=connection(`BEGIN;SET application_name='exp08_identity_target_holder';SELECT id FROM public.tenant_members WHERE user_id='${ids.target}' FOR UPDATE;SELECT 'held';`,true);
  let removal,revocation;
  const blockedBy=(waiter,holder)=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE w.application_name='${waiter}' AND w.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity h WHERE h.application_name='${holder}' AND h.pid=ANY(pg_blocking_pids(w.pid))))`)==='t';
  try{
   for(let i=0;!held.read().includes('held')&&i<150;i++)await delay();
   assert(held.read().includes('held'));
   removal=connection(`SET application_name='exp08_identity_remover_first';SET statement_timeout='10s';SELECT set_config('request.jwt.claim.sub','${ids.actor}',false);SET ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');`);
   let observed=false;
   for(let i=0;i<150;i++){if(blockedBy('exp08_identity_remover_first','exp08_identity_target_holder')){observed=true;break;}await delay();}
   assert(observed,'remover acquired identity before waiting on the original target');
   const mutation=change==='delete'?`DELETE FROM auth.users WHERE id='${ids.actor}'`:
    `UPDATE auth.users SET ${change==='ban'?"banned_until=clock_timestamp()+interval '1 hour'":'deleted_at=clock_timestamp()'} WHERE id='${ids.actor}'`;
   revocation=connection(`SET application_name='exp08_identity_revoker_second';SET statement_timeout='10s';${mutation};`);
   observed=false;
   for(let i=0;i<150;i++){if(blockedBy('exp08_identity_revoker_second','exp08_identity_remover_first')){observed=true;break;}await delay();}
   assert(observed,'identity revocation must wait on the original remover identity lock');
  }finally{held.p.stdin.end('COMMIT;\n');assert.equal((await held.done).code,0);}
  const a=await removal.done,b=await revocation.done;
  assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
  assert(!/deadlock|statement timeout/i.test(a.err+b.err));
  assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');
  assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE user_id='${ids.target}'`),'0');
  assert.equal(sql(`SELECT active_tenant_id IS NULL FROM public.profiles WHERE user_id='${ids.target}'`),'t');
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${ids.actor}' AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp()))`),'f');
  if(identityFkOnly&&change==='delete')assert.equal(sql(`SELECT count(*) FROM public.profiles WHERE user_id='${ids.actor}'`),'0','Auth deletion applies the original actor-profile cascade after removal');
  output.push({change:'removal-first '+change,actualTargetLockWait:true,actualIdentityLockWait:true,serialRemovalThenRevocation:true,audits:1,actualProfileFkSemantics:identityFkOnly});
 }
 if(identityFkOnly){
  resetIdentities();
  sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants;
   INSERT INTO public.tenants VALUES('${ids.tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
    ('${ids.tenant}','${ids.actor}','active',false,'admin'),('${ids.tenant}','${ids.target}','active',false,'member');
   INSERT INTO public.profiles(user_id,active_tenant_id,suspended_by) VALUES('${ids.actor}','${ids.tenant}',NULL),('${ids.target}','${ids.tenant}','${ids.actor}');`);
  const before=business();
  assert.throws(()=>sql(`DELETE FROM auth.users WHERE id='${ids.actor}'`),e=>e.code==='23503','original suspended_by NO ACTION must refuse Auth deletion');
  assert.equal(business(),before,'failed original Auth deletion rolls back its profile cascade');
  sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');COMMIT;`);
  assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');
  assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE user_id='${ids.target}'`),'0');
  assert.equal(sql(`SELECT suspended_by='${ids.actor}' AND active_tenant_id IS NULL FROM public.profiles WHERE user_id='${ids.target}'`),'t','team removal neither bypasses nor rewrites original Auth restriction');
  output.push({change:'original suspended_by NO ACTION',authDeleteRefused:true,authCascadeRolledBack:true,authorizedTeamRemoval:true,audits:1});
 }
 if(!protectedOnly&&!identityOnly)for(const change of ['unchanged','demoted','suspended','workspace']){
  resetIdentities();
  sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants;
   INSERT INTO public.tenants VALUES('${ids.tenant}'),('${ids.other}');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
    ('${ids.tenant}','${ids.actor}','active',false,'admin'),('${ids.tenant}','${ids.target}','active',false,'member'),('${ids.other}','${ids.actor}','active',false,'admin');
   INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');`);
  const held=connection(`BEGIN;SET application_name='exp08_member_holder';SELECT id FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}' FOR UPDATE;SELECT 'held';`,true);
  let waiting;
  try{
   for(let i=0;!held.read().includes('held')&&i<150;i++)await delay();
   assert(held.read().includes('held'),'original target row is held');
   waiting=connection(`SET application_name='exp08_member_waiter';SELECT set_config('request.jwt.claim.sub','${ids.actor}',false);SET ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');`);
   let observed=false;
   for(let i=0;i<150;i++){
    if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE w.application_name='exp08_member_waiter' AND w.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity h WHERE h.application_name='exp08_member_holder' AND h.pid=ANY(pg_blocking_pids(w.pid))))")==='t'){observed=true;break;}
    await delay();
   }
   assert(observed,'actual original remover waits on the held target');
   if(change==='demoted')sql(`UPDATE public.tenant_members SET role='member' WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}'`);
   if(change==='suspended')sql(`UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}'`);
   if(change==='workspace')sql(`UPDATE public.profiles SET active_tenant_id='${ids.other}' WHERE user_id='${ids.actor}'`);
  }finally{held.p.stdin.end('COMMIT;\n');assert.equal((await held.done).code,0);}
  const result=await waiting.done;
  const remaining=sql(`SELECT count(*) FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}'`);
  const audits=sql('SELECT count(*) FROM public.audit_logs');
  const accepted=result.code===0&&remaining==='0'&&audits==='1';
  output.push({change,actualTargetLockWait:true,accepted,remaining:Number(remaining),audits:Number(audits),error:result.err.trim()});
  if(change==='unchanged')assert(accepted,'authorized positive control must remove once');
  else if(candidate)assert(result.code!==0&&result.err.includes(change==='demoted'?'only an owner or an admin':'your active workspace changed')&&remaining==='1'&&audits==='0','candidate must refuse through the intended authority boundary without a membership or audit effect');
  else assert(accepted,'baseline stale-context counterexample must be demonstrated, not assumed');
 }
 if(candidate&&!protectedOnly&&!identityOnly){
  resetIdentities();
  sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants;
   INSERT INTO public.tenants VALUES('${ids.tenant}'),('${ids.other}');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
    ('${ids.tenant}','${ids.actor}','active',true,'owner'),('${ids.tenant}','${ids.target}','active',false,'admin');
   INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');`);
  const held=connection(`BEGIN;SET application_name='exp08_opposing_holder';SELECT user_id FROM public.profiles ORDER BY user_id FOR UPDATE;SELECT 'held';`,true);
  let first,second;
  try{
   for(let i=0;!held.read().includes('held')&&i<150;i++)await delay();
   assert(held.read().includes('held'));
   first=connection(`SET application_name='exp08_opposing_first';SET statement_timeout='10s';SELECT set_config('request.jwt.claim.sub','${ids.actor}',false);SET ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');`);
   let firstWait=false;
   for(let i=0;i<150;i++){
    if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE w.application_name='exp08_opposing_first' AND w.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity h WHERE h.application_name='exp08_opposing_holder' AND h.pid=ANY(pg_blocking_pids(w.pid))))")==='t'){firstWait=true;break;}
    await delay();
   }
   assert(firstWait,'first departure holds both original membership rows before profile barrier');
   second=connection(`SET application_name='exp08_opposing_second';SET statement_timeout='10s';SELECT set_config('request.jwt.claim.sub','${ids.target}',false);SET ROLE authenticated;SELECT public.remove_solo_team_member('${ids.actor}','${ids.tenant}');`);
   let secondWait=false;
   for(let i=0;i<150;i++){
    if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE w.application_name='exp08_opposing_second' AND w.wait_event_type='Lock')")==='t'){secondWait=true;break;}
    await delay();
   }
   assert(secondWait,'opposing departure must actually wait');
   assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE w.application_name='exp08_opposing_second' AND EXISTS(SELECT 1 FROM pg_stat_activity h WHERE h.application_name='exp08_opposing_first' AND h.pid=ANY(pg_blocking_pids(w.pid))))"),'t','opposing departure uses the same original membership row order');
  }finally{held.p.stdin.end('COMMIT;\n');assert.equal((await held.done).code,0);}
  const a=await first.done,b=await second.done;
  assert.equal(a.code,0,a.err);assert.notEqual(b.code,0);assert(b.err.includes('your active workspace changed'),b.err);
  assert(!/deadlock|statement timeout/i.test(a.err+b.err),'normal opposing calls must not depend on a deadlock or timeout abort');
  assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE user_id='${ids.actor}' AND tenant_id='${ids.tenant}'`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE user_id='${ids.target}' AND tenant_id='${ids.tenant}'`),'0');
  assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');
  output.push({change:'opposing-departures',actualMembershipOrderWait:true,authorizedRemoval:true,revokedCallerRefused:true,deadlock:false,audits:1});
 }
 if(candidate&&!protectedOnly&&!identityOnly){
  for(const c of [
   {name:'self',self:true,error:'you cannot remove yourself'},
   {name:'wrong expected workspace',wrongWorkspace:true,error:'your active workspace changed'},
   {name:'member caller',actorRole:'member',error:'only an owner or an admin'},
   {name:'owner target',targetOwner:true,error:'an owner cannot be removed'},
   {name:'admin target',targetRole:'admin',error:'only the workspace owner may remove an admin'},
   {name:'foreign target',foreign:true,code:'P0001',error:'that person is not on this workspace'},
   {name:'anonymous execution',role:'anon',error:'permission denied for function'},
   {name:'service execution',role:'service_role',error:'permission denied for function'},
   {name:'suspended target',targetStatus:'suspended',success:true},
   {name:'original company standing without actor seat',company:true,success:true},
   {name:'original missing-profile fallback',missingProfile:true,success:true},
  ]){
   resetIdentities();
   sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.tenants;
    INSERT INTO public.tenants VALUES('${ids.tenant}'),('${ids.other}');
    INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES
     ('${ids.tenant}','${ids.actor}','active',false,'${c.actorRole??'admin'}'),
     ('${c.foreign?ids.other:ids.tenant}','${ids.target}','${c.targetStatus??'active'}',${c.targetOwner?'true':'false'},'${c.targetRole??'member'}');
    INSERT INTO public.profiles VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${c.foreign?ids.other:ids.tenant}');`);
   if(c.missingProfile)sql(`DELETE FROM public.profiles WHERE user_id='${ids.actor}'`);
   if(c.company){
    sql(`DELETE FROM public.tenant_members WHERE user_id='${ids.actor}';
     CREATE OR REPLACE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${ids.tenant}'::uuid$$;
     CREATE OR REPLACE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${ids.actor}'::uuid$$;`);
   }
   const before=business();
   const call=()=>sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE ${c.role??'authenticated'};SELECT public.remove_solo_team_member('${c.self?ids.actor:ids.target}','${c.wrongWorkspace?ids.other:ids.tenant}');COMMIT;`);
   if(c.success){
    call();
    assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}'`),'0',c.name);
    assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1',c.name);
    assert.equal(sql(`SELECT active_tenant_id IS NULL FROM public.profiles WHERE user_id='${ids.target}'`),'t',c.name);
   }else{
    assert.throws(call,e=>e.code===(c.code??'42501')&&e.message.includes(c.error),c.name+' must use its original authority refusal');
    assert.equal(business(),before,c.name+' must change no business row');
   }
   if(c.company)sql('CREATE OR REPLACE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE OR REPLACE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;');
   output.push({change:'original boundary: '+c.name,success:c.success??false,businessEffects:c.success?1:0});
  }
 }
 if(candidate&&!protectedOnly&&!identityOnly){
  const signature='public.remove_solo_team_member(uuid,uuid)';
  const saved=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`);
  const metadata=sql(`SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='${signature}'::regprocedure`);
  const before=business(),patch=candidatePatch;
  for(const [name,change] of [
   ['source',saved.replace('BEGIN','BEGIN\n PERFORM 1;')],
   ['security',`ALTER FUNCTION ${signature} SECURITY INVOKER`],
   ['search path',`ALTER FUNCTION ${signature} SET search_path='public'`],
   ['volatility',`ALTER FUNCTION ${signature} IMMUTABLE`],
   ['strictness',`ALTER FUNCTION ${signature} STRICT`],
   ['parallel',`ALTER FUNCTION ${signature} PARALLEL SAFE`],
   ['leakproof',`ALTER FUNCTION ${signature} LEAKPROOF`],
   ['extra role',`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`],
   ['missing browser role',`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`],
   ['owner',`ALTER FUNCTION ${signature} OWNER TO service_role`],
  ]){
   sql(change);
   assert.throws(()=>sql(patch),/EXP08 departure currentness (metadata|replay|source) drift/,name+' must refuse through its guarded preflight');
   assert.equal(business(),before,name+' drift changes no business row');
   sql(`ALTER FUNCTION ${signature} OWNER TO postgres;${saved};REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION ${signature} TO postgres,authenticated;`);
   assert.equal(sql(`SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='${signature}'::regprocedure`),metadata,name+' restoration conserves all original metadata');
   sql(patch);
   output.push({change:'drift: '+name,refused:true,businessUnchanged:true,metadataRestored:true});
  }
 }
 if(candidate&&!mutant&&!protectedOnly&&!identityFkOnly){
  const signature='public.remove_solo_team_member(uuid,uuid)';
  const before=business(),definition=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`);
  const identities=sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u');
  for(const [column,type] of [['id','uuid'],['deleted_at','timestamptz'],['banned_until','timestamptz']]){
   sql(`ALTER TABLE auth.users ALTER COLUMN ${column} TYPE text USING ${column}::text`);
   try{
    assert.throws(()=>sql(candidatePatch),/EXP08 departure currentness original Auth columns missing or drifted/,'Auth column type drift must refuse before source rewrite');
    assert.equal(business(),before);
    assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`),definition,'Auth schema refusal leaves original function untouched');
   }finally{sql(`ALTER TABLE auth.users ALTER COLUMN ${column} TYPE ${type} USING ${column}::${type}`);}
   assert.equal(sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u'),identities,'restore only this disposable Auth fixture');
   sql(candidatePatch);
   output.push({change:'Auth schema: '+column,refused:true,functionUnchanged:true,fixtureRestored:true});
  }
 }
 if(candidate&&!mutant&&(prerequisitesOnly||(!protectedOnly&&!identityOnly))){
  const removal=sql("SELECT pg_get_functiondef('public.remove_solo_team_member(uuid,uuid)'::regprocedure)");
  const before=business();
  const checks=[];
  for(const [signature,mapping]of [['public.map_tenant_role_to_app_role(public.tenant_role)',true],['public.sync_tenant_member_to_user_roles()',false],['public.prevent_owner_admin_removal()',false]]){
   const saved=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`).replace(/\r\n/g,'\n');
   const metadata=sql(`SELECT to_jsonb(p)::text FROM pg_proc p WHERE oid='${signature}'::regprocedure`);
   for(const[name,change]of [
    ['body',saved.replace('AS $function$','AS $function$\n-- simulated prerequisite source change\n')],
    ['security',`ALTER FUNCTION ${signature} SECURITY ${mapping?'DEFINER':'INVOKER'}`],
    ['volatility',`ALTER FUNCTION ${signature} ${mapping?'VOLATILE':'IMMUTABLE'}`],
    ['path',`ALTER FUNCTION ${signature} SET search_path='pg_temp'`],
    ['strictness',`ALTER FUNCTION ${signature} STRICT`],
    ['leakproof',`ALTER FUNCTION ${signature} LEAKPROOF`],
    ['parallel',`ALTER FUNCTION ${signature} PARALLEL SAFE`],
    ['owner',`ALTER FUNCTION ${signature} OWNER TO service_role`],
    ['grant option',`GRANT EXECUTE ON FUNCTION ${signature} TO service_role WITH GRANT OPTION`],
    ['missing essential grant',`REVOKE EXECUTE ON FUNCTION ${signature} FROM ${mapping?'PUBLIC':'postgres'}`],
   ]){
    sql(change);
    try{
     assert.throws(()=>sql(candidatePatch),/EXP08 departure currentness original helper drift:/,'changed original helper must refuse through prerequisite guard: '+signature+'/'+name);
     assert.equal(business(),before,'prerequisite refusal has no business effect');
     assert.equal(sql("SELECT pg_get_functiondef('public.remove_solo_team_member(uuid,uuid)'::regprocedure)"),removal,'prerequisite refusal does not rewrite removal');
    }finally{
     sql(`ALTER FUNCTION ${signature} OWNER TO postgres;${saved};REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,postgres,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION ${signature} TO postgres,${mapping?'PUBLIC,anon,authenticated,':''}service_role;`);
    }
    assert.equal(sql(`SELECT to_jsonb(p)::text FROM pg_proc p WHERE oid='${signature}'::regprocedure`),metadata,'restore only original fixture helper source and all metadata');
    sql(candidatePatch);
    checks.push({signature,change:name,refused:true,removalUnchanged:true,metadataRestored:true});
   }
  }
  const mapping='public.map_tenant_role_to_app_role(public.tenant_role)';
  const saved=sql(`SELECT pg_get_functiondef('${mapping}'::regprocedure)`).replace(/\r\n/g,'\n');
  assert.equal(saved.split('RETURNS app_role').length,2,'return drift changes exactly the mapping result ABI');
  const metadata=sql(`SELECT (to_jsonb(p)-'oid')::text FROM pg_proc p WHERE oid='${mapping}'::regprocedure`);
  try{
   sql(`DROP FUNCTION ${mapping};${saved.replace('RETURNS app_role','RETURNS text')};GRANT EXECUTE ON FUNCTION ${mapping} TO anon,authenticated,service_role;`);
   assert.throws(()=>sql(candidatePatch),/EXP08 departure currentness original helper drift:/,'same helper body with changed return ABI must refuse before removal rewrite');
   assert.equal(business(),before);
   assert.equal(sql("SELECT pg_get_functiondef('public.remove_solo_team_member(uuid,uuid)'::regprocedure)"),removal);
  }finally{
   sql(`DROP FUNCTION ${mapping};${saved};REVOKE ALL ON FUNCTION ${mapping} FROM PUBLIC,postgres,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION ${mapping} TO postgres,PUBLIC,anon,authenticated,service_role;`);
  }
  // Changing a return type requires DROP/recreate, so only this disposable helper's OID changes.
  // Every other pg_proc field remains exact; the prior30 ALTER-only controls retain exact OID too.
  assert.equal(sql(`SELECT (to_jsonb(p)-'oid')::text FROM pg_proc p WHERE oid='${mapping}'::regprocedure`),metadata);
  sql(candidatePatch);
  checks.push({signature:mapping,change:'return ABI',refused:true,removalUnchanged:true,metadataExceptRecreatedOidRestored:true});
  assert.equal(checks.length,31);
  const helperMetadata=()=>sql("SELECT jsonb_object_agg(p.proname,to_jsonb(p)) FROM pg_proc p WHERE p.oid IN ('public.map_tenant_role_to_app_role(public.tenant_role)'::regprocedure,'public.sync_tenant_member_to_user_roles()'::regprocedure,'public.prevent_owner_admin_removal()'::regprocedure)");
  try{
   // Actual no-data managed rebuild: mapping default ACL, both trigger helpers owner-only.
   sql(`DROP FUNCTION ${mapping};${saved};REVOKE EXECUTE ON FUNCTION public.sync_tenant_member_to_user_roles(),public.prevent_owner_admin_removal() FROM service_role;`);
   assert.equal(sql(`SELECT proacl IS NULL FROM pg_proc WHERE oid='${mapping}'::regprocedure`),'t','fixture must exercise actual managed default representation');
   const exactManaged=helperMetadata();
   sql(candidatePatch);sql(candidatePatch);
   assert.equal(helperMetadata(),exactManaged,'patch/replay preserve every managed helper field and raw ACL verbatim');
   assert.equal(business(),before);
   assert.equal(sql("SELECT pg_get_functiondef('public.remove_solo_team_member(uuid,uuid)'::regprocedure)"),removal);
   // A browser grant on either private trigger helper remains forbidden in this tighter form.
   for(const signature of ['public.sync_tenant_member_to_user_roles()','public.prevent_owner_admin_removal()']){
    sql(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`);
    try{assert.throws(()=>sql(candidatePatch),/EXP08 departure currentness original helper drift:/,'managed private trigger must not acquire browser access');}
    finally{sql(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated`);}
    assert.equal(helperMetadata(),exactManaged);
   }
   output.push({change:'actual managed helper ACL variants',defaultPublicMapping:true,ownerOnlyTriggers:true,rawMetadataConserved:true,forbiddenBrowserGrantsRefused:2});
  }finally{
   sql(`DROP FUNCTION ${mapping};${saved};REVOKE ALL ON FUNCTION ${mapping} FROM PUBLIC,postgres,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION ${mapping} TO postgres,PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.sync_tenant_member_to_user_roles(),public.prevent_owner_admin_removal() TO service_role;`);
  }
  assert.equal(sql(`SELECT (to_jsonb(p)-'oid')::text FROM pg_proc p WHERE oid='${mapping}'::regprocedure`),metadata,'restore production fixture except the necessary recreated mapping OID');
  sql(candidatePatch);
  output.push({change:'original helper prerequisites',controls:checks});
 }
 if(candidate&&!mutant&&!protectedOnly&&!identityOnly){
  for(const name of mutants){
   const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--mutant-'+name],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4e6});
   if(child.error)throw child.error;
   assert.equal(child.status,1,'changed original source must fail its actual behavior control: '+name);
   const expected={protected:'protected account must receive its authored pre-write refusal','pair-locks':'opposing departure uses the same original membership row order','identity-check':'unavailable actor identity must refuse before the original removal effect','identity-lock':'original removal must actually wait for the actor identity transaction'}[name]??'candidate must refuse through the intended authority boundary';
   assert((child.stderr??'').includes(expected),name+' must fail for the specific reintroduced behavior, not unrelated setup: '+child.stderr);
   assert((child.stdout??'').includes('Disposed only the local proof database created by this run.'),name+' must dispose its own database before counting the mutation');
   output.push({change:'mutant: '+name,killed:true,actualBehaviorFailure:true});
  }
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--identity-fk-only'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4e6});
  if(child.error)throw child.error;
  assert.equal(child.status,0,'original profile FK concurrency suite must pass: '+child.stderr);
  const end=child.stdout.lastIndexOf('\nDisposed only the local proof database created by this run.');
  assert(end>0,'FK child must dispose only its own database');
  const report=JSON.parse(child.stdout.slice(0,end));
  assert.equal(report.cases.length,10,'all original profile FK cases must execute');
  output.push({change:'original profile FK suite',controls:report.cases,disposed:true});
 }
 if(!mutant)assert.equal(output.length,hubDoorsOnly?0:prerequisitesOnly?2:identityFkOnly?10:identityOnly?17:protectedOnly?8:candidate?60:4,'Every intended control must execute');
 // Retain the exact original 60-entry assertion BEFORE adding this distinct integration group.
 if(candidate&&!mutant&&(hubDoorsOnly||options.length===0)){
  const {controls,catalogue}=await verifyHubDoorDeparture({repo,sql,connection,ids,database:db.database});
  assert.equal(controls.length,30,'Every original Hub-door/departure integration control must execute');
  output.push({change:'original Hub DM and departure integration',candidateState:'INERT/unpublished Hub identity and member-add patches; not part of versioned removal carrier',catalogue,controls});
 }
 const catalogue=JSON.parse(sql("SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(p.prosrc),'owner',p.proowner::regrole::text,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p WHERE p.oid='public.remove_solo_team_member(uuid,uuid)'::regprocedure"));
 console.log(JSON.stringify({scope:'isolated native original writer/helpers; minimal tables and Auth/platform ports, no customer or RLS proof',carrier:'20271126140008_exp08_departure_currentness.sql',carrierLfSha256:createHash('sha256').update(candidatePatch).digest('hex'),catalogue,cases:output},null,2));
}finally{
 db.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db.database}' AND pid<>pg_backend_pid()`,[],'postgres');
 await Promise.allSettled(connections.map(c=>c.done));
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 console.log('Disposed only the local proof database created by this run.');
}
