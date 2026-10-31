// Original EXP08 outcome4 departure proof. Explicit disposable loopback database only.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
assert.equal(process.env.EXP08_DISPOSABLE,'1','Explicit disposable proof opt-in required');
assert.equal(process.env.PGHOST,'127.0.0.1','Dedicated loopback proof only');
assert.match(process.env.PGPORT??'',/^\d+$/,'Explicit local port required');
const options=process.argv.slice(2),mutants=['scope','authority','pair-locks'];
assert(options.length<=1&&options.every(a=>a==='--baseline'||mutants.some(m=>a==='--mutant-'+m)),'Unknown proof option');
const mutant=mutants.find(m=>options.includes('--mutant-'+m));
const repo=fileURLToPath(new URL('../../',import.meta.url));
const db=new OperatorPostgresFixture(Number(process.env.PGPORT));db.prefix=()=>'';
const program=()=>db.psql,args=()=>db.args(),sql=s=>db.run(s);
const source=(file,name)=>{const s=readFileSync(join(repo,file),'utf8');const a=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),b=s.indexOf('$function$;',a);assert(a>=0&&b>a);return s.slice(a,b+11);};
// Canonical Git/LF for this never-applied candidate only; incumbent source hashes stay exact.
const candidatePatch=readFileSync(join(repo,'scripts/proof/exp08-member-removal-currentness-patch.sql'),'utf8').replace(/\r\n/g,'\n');
const connections=[];
const ids={tenant:'e8000000-0000-4000-8000-000000080010',other:'e8000000-0000-4000-8000-000000080020',actor:'e8000000-0000-4000-8000-000000080300',target:'e8000000-0000-4000-8000-000000080200'};
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
 CREATE TABLE public.tenants(id uuid PRIMARY KEY);
 CREATE TABLE public.tenant_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,status text,is_owner boolean,role public.tenant_role,joined_at timestamptz DEFAULT now(),UNIQUE(tenant_id,user_id));
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
 CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
 GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;`);
 sql(source('supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql','is_tenant_owner'));
 sql(source('supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql','current_user_tenant_id'));
 sql(source('supabase/migrations/20271115040008_exp08_team_lifecycle.sql','remove_solo_team_member'));
 sql('REVOKE ALL ON FUNCTION public.remove_solo_team_member(uuid,uuid) FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.remove_solo_team_member(uuid,uuid) TO authenticated;');
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.remove_solo_team_member(uuid,uuid)'::regprocedure"),'d8c0eb6a8fdc3fef52eda7df4f9274e1');
 if(candidate){
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
   };
   const [original,replacement]=edits[mutant];
   assert.equal(before.split(original).length,2,'mutant must alter exactly one actual source span: '+JSON.stringify(before.match(/IF NOT _caller_owner[\s\S]{0,130}/g)));
   sql(before.replace(original,replacement));
  }
 }
 for(const change of ['unchanged','demoted','suspended','workspace']){
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
 if(candidate){
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
 if(candidate){
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
 if(candidate){
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
 if(candidate&&!mutant){
  for(const name of mutants){
   const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--mutant-'+name],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4e6});
   if(child.error)throw child.error;
   assert.equal(child.status,1,'changed original source must fail its actual behavior control: '+name);
   assert((child.stderr??'').includes(name==='pair-locks'?'opposing departure uses the same original membership row order':'candidate must refuse through the intended authority boundary'),name+' must fail for the specific reintroduced behavior, not unrelated setup: '+child.stderr);
   assert((child.stdout??'').includes('Disposed only the local proof database created by this run.'),name+' must dispose its own database before counting the mutation');
   output.push({change:'mutant: '+name,killed:true,actualBehaviorFailure:true});
  }
 }
 if(!mutant)assert.equal(output.length,candidate?29:4,'Every intended control must execute');
 console.log(JSON.stringify({scope:'isolated native original writer/helpers; minimal tables and Auth/platform ports, no customer or RLS proof',cases:output},null,2));
}finally{
 db.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db.database}' AND pid<>pg_backend_pid()`,[],'postgres');
 await Promise.allSettled(connections.map(c=>c.done));
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 console.log('Disposed only the local proof database created by this run.');
}
