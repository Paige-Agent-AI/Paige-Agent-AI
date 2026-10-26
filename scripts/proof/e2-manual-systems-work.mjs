// Disposable loopback native proof over the original Work migrations/creator.
// Reuses the existing PostgreSQL fixture; no remote target, credential or writer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Explicit disposable loopback PostgreSQL port required');
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const migration=read('supabase/migrations/20271114240002_e02_manual_systems_work_request.sql');
const envelope=read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql');
const document=read('supabase/migrations/20270418000000_paige_durable_document_work.sql');
const current=read('supabase/migrations/20271108201000_e09_customer_private_chat.sql');
const marker='CREATE OR REPLACE FUNCTION public.create_paige_durable_work(';
assert.equal(current.split(marker).length,2);
const start=current.indexOf(marker),end=current.indexOf('$function$;',start);
assert.ok(end>start);const creator=current.slice(start,end+'$function$;'.length);
const boundary=document.indexOf('-- Authenticated submission:');assert.ok(boundary>0);
const fixture=new OperatorPostgresFixture(port);let assertions=0;
const ids={actor:randomUUID(),admin:randomUUID(),viewer:randomUUID(),operator:randomUUID(),tenant:randomUUID(),second:randomUUID(),thread:randomUUID(),otherThread:randomUUID()};
const payload={version:1,scope:'tenant',scan_flavor:'manual',action_filing:'none'};
const authority=(actor,tenant)=>({tenant_id:tenant,actor_user_id:actor,authority_source:'server_resolved',role_gate:'owner_or_admin',approval_reusable:false});
const key='public._create_manual_systems_check_work(uuid,uuid,uuid,uuid)';
const as=(role,sql,params=[])=>{const prior=fixture.role;fixture.role=role;try{return fixture.run(sql,params);}finally{fixture.role=prior;}};
const call=(intent=randomUUID(),actor=ids.actor,tenant=ids.tenant,thread=ids.thread)=>as('service_role',
 'SELECT row_to_json(r)::text FROM public._create_manual_systems_check_work($1,$2,$3,$4)r',[actor,tenant,intent,thread]);
const decode=text=>JSON.parse(text.split(/\r?\n/).find(l=>l.startsWith('{')));
const count=()=>Number(fixture.run('SELECT count(*) FROM public.paige_durable_work'));
const deny=(fn,code)=>{const before=count();assert.throws(fn,e=>e.code===code);assert.equal(count(),before);assertions++;};
const originalShape=()=>fixture.run(`SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl::text,p.prosrc,p.prosecdef,p.proconfig)ORDER BY p.oid)::text FROM pg_proc p WHERE p.oid IN(
 'public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer)'::regprocedure,
 'public._paige_durable_work_protect_identity()'::regprocedure,
 'public._analytics_metric_actor_authorized(uuid,uuid)'::regprocedure)`);
const sql=fixture.sql.bind(fixture);
function asyncNative(text,label){
 const child=spawn(fixture.psql,fixture.args(),{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 const completed=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 completed.catch(()=>{});
 child.stdin.end(`\\set VERBOSITY verbose\nSET application_name='${label}';${text}`);
 return completed;
}
async function observedWait(label){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  if(fixture.run("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[label])==='1')return;
  await new Promise(resolve=>setTimeout(resolve,15));
 }
 throw Error('A real second PostgreSQL connection did not reach its lock wait');
}
try{
 // The existing fixture connects only to its literal loopback host. A hosted
 // service container sees its own NAT interface, not the runner's loopback.
 assert.deepEqual(fixture.args(),['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',fixture.database,'-A','-t','-v','ON_ERROR_STOP=1']);
 assert.equal(fixture.run('SELECT current_database()=$1',[fixture.database]),'t');
 if(port===5432){
  assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(fixture.run("SELECT current_setting('port')='5432' AND inet_server_addr() IS NOT NULL"),'t');
 }else assert.equal(fixture.run("SELECT inet_server_addr()='127.0.0.1'::inet"),'t');
 fixture.run(`CREATE EXTENSION pgcrypto;
 DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')THEN CREATE ROLE anon NOLOGIN;END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')THEN CREATE ROLE authenticated NOLOGIN;END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role')THEN CREATE ROLE service_role NOLOGIN BYPASSRLS;END IF;
 END$$;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text,account_type text,parent_tenant_id uuid);
 CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,is_owner boolean DEFAULT false,PRIMARY KEY(tenant_id,user_id));
 CREATE TABLE public.paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid,caller_user_id uuid,audience text,is_archived boolean DEFAULT false);
 CREATE FUNCTION auth.uid()RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE FUNCTION public.current_user_tenant_id()RETURNS uuid LANGUAGE sql STABLE AS $$SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid()$$;
 CREATE FUNCTION public.is_platform_owner()RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
 CREATE TABLE public.marketing_content(id uuid PRIMARY KEY);
 CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY);`);
 for(const table of ['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_systems_check_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'])fixture.run(`CREATE TABLE public.${table}(id uuid PRIMARY KEY)`);
 fixture.run(envelope);fixture.run(document.slice(0,boundary));fixture.run(creator);
 fixture.run(read('supabase/migrations/20271110031000_durable_work_thread_detach.sql'));
 fixture.run(read('supabase/migrations/20271113360002_exp02_metric_actor_authority.sql'));
 fixture.run('INSERT INTO auth.users(id)VALUES($1),($2),($3),($4)',[ids.actor,ids.admin,ids.viewer,ids.operator]);
 fixture.run("INSERT INTO public.tenants VALUES($1,'active','standalone',NULL),($2,'active','standalone',NULL)",[ids.tenant,ids.second]);
 for(const [actor,tenant,role]of [[ids.actor,ids.tenant,'owner'],[ids.admin,ids.second,'admin'],[ids.viewer,ids.tenant,'member']]){
  fixture.run('INSERT INTO public.profiles VALUES($1,$2)',[actor,tenant]);
  fixture.run("INSERT INTO public.tenant_members VALUES($2,$1,$3,'active',false)",[actor,tenant,role]);
 }
 fixture.run('INSERT INTO public.profiles VALUES($1,$2)',[ids.operator,ids.tenant]);
 fixture.run("INSERT INTO public.paige_chat_threads VALUES($1,$2,$3,'workspace',false),($4,$5,$6,'workspace',false)",[ids.thread,ids.tenant,ids.actor,ids.otherThread,ids.second,ids.admin]);
 deny(()=>call(),'42883'); // Genuine absent-contract baseline, not a stubbed answer.
 const shape=originalShape();fixture.run(migration);assert.equal(originalShape(),shape);assertions++;
 const metadata=JSON.parse(fixture.run(`SELECT json_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
 'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE'),
 'server',has_function_privilege('service_role',oid,'EXECUTE'))FROM pg_proc WHERE oid='${key}'::regprocedure`));
 assert.deepEqual(metadata,{owner:'postgres',definer:true,config:['search_path=""','lock_timeout=3s'],anon:false,auth:false,server:true});assertions++;
 const installed=fixture.run(`SELECT md5(pg_get_functiondef(oid))||'|'||proacl::text FROM pg_proc WHERE oid='${key}'::regprocedure`);
 deny(()=>fixture.run(migration),'42723');
 assert.equal(fixture.run(`SELECT md5(pg_get_functiondef(oid))||'|'||proacl::text FROM pg_proc WHERE oid='${key}'::regprocedure`),installed);assertions++;
 const intent=randomUUID(),first=decode(call(intent)),saved=fixture.run('SELECT row_to_json(w)::text FROM public.paige_durable_work w WHERE id=$1',[first.work_id]);
 assert.deepEqual(first,{work_id:first.work_id,work_status:'claimed',work_version:2,resumed_existing:false});
 assert.match(first.work_id,/^[0-9a-f-]{36}$/);assert.equal(count(),1);assertions++;
 const row=JSON.parse(saved);assert.deepEqual(row.request_payload,payload);assert.equal(row.max_attempts,1);assert.equal(row.attempt_count,1);assert.equal(row.dispatch_started_attempt,0);assert.equal(row.capability_key,'systems.check');assert.equal(row.work_kind,'systems_check');assertions++;
 assert.deepEqual(decode(call(intent)),{...first,resumed_existing:true});assert.equal(fixture.run('SELECT row_to_json(w)::text FROM public.paige_durable_work w WHERE id=$1',[first.work_id]),saved);assert.equal(count(),1);assertions++;
 // A lost acknowledgement is another read of the SAME intent, not another job.
 const lost=randomUUID();call(lost);const original=fixture.run('SELECT id FROM public.paige_durable_work WHERE intent_id=$1',[lost]);
 assert.equal(decode(call(lost)).work_id,original);assert.equal(count(),2);assertions++;
 for(const status of ['cancelled','outcome_unknown']){
  const stoppedIntent=randomUUID(),stopped=decode(call(stoppedIntent));
  fixture.run("UPDATE public.paige_durable_work SET status=$1,settled_at=CASE WHEN $1='cancelled' THEN now() END,terminal_outcome=CASE WHEN $1='cancelled' THEN '{\"cancelled\":true}'::jsonb END,version=version+1 WHERE id=$2",[status,stopped.work_id]);
  const snapshot=fixture.run('SELECT row_to_json(w)::text FROM public.paige_durable_work w WHERE id=$1',[stopped.work_id]);
  assert.deepEqual(decode(call(stoppedIntent)),{...stopped,work_status:status,work_version:stopped.work_version+1,resumed_existing:true});
  assert.equal(fixture.run('SELECT row_to_json(w)::text FROM public.paige_durable_work w WHERE id=$1',[stopped.work_id]),snapshot);assertions++;
 }
 const second=decode(call(randomUUID(),ids.admin,ids.second,ids.otherThread));assert.notEqual(second.work_id,first.work_id);assertions++;
 assert.equal(decode(call(randomUUID(),ids.actor,ids.tenant,null)).resumed_existing,false);assertions++;
 for(const role of ['anon','authenticated'])deny(()=>as(role,'SELECT * FROM public._create_manual_systems_check_work($1,$2,$3,$4)',[ids.actor,ids.tenant,randomUUID(),ids.thread]),'42501');
 for(const actor of [ids.viewer,ids.operator,randomUUID(),null])deny(()=>call(randomUUID(),actor),actor===null?'22023':'42501');
 deny(()=>call(randomUUID(),ids.actor,ids.second),'42501');deny(()=>call(randomUUID(),ids.actor,ids.tenant,ids.otherThread),'42501');
 deny(()=>call(null),'22023');deny(()=>call(randomUUID(),ids.actor,null),'22023');
 fixture.run('DELETE FROM public.profiles WHERE user_id=$1',[ids.admin]);
 deny(()=>call(randomUUID(),ids.admin,ids.second,ids.otherThread),'42501');
 fixture.run('INSERT INTO public.profiles VALUES($1,$2)',[ids.admin,ids.second]);
 for(const [table,column,value,where,args,restore]of [
  ['profiles','active_tenant_id',ids.second,'user_id=$2',[ids.actor],ids.tenant],
  ['tenant_members','role','member','user_id=$2',[ids.actor],'owner'],
  ['tenant_members','status','inactive','user_id=$2',[ids.actor],'active'],
  ['tenants','status','trial','id=$2',[ids.tenant],'active'],
  ['tenants','account_type','agency','id=$2',[ids.tenant],'standalone'],
  ['tenants','parent_tenant_id',ids.second,'id=$2',[ids.tenant],null],
  ['auth.users','deleted_at','2099-01-01','id=$2',[ids.actor],null],
  ['auth.users','banned_until','2099-01-01','id=$2',[ids.actor],null],
  ['paige_chat_threads','audience','customer','id=$2',[ids.thread],'workspace'],
  ['paige_chat_threads','is_archived','true','id=$2',[ids.thread],'false'],
 ]){const name=table.startsWith('auth.')?table:'public.'+table;fixture.run(`UPDATE ${name} SET ${column}=$1 WHERE ${where}`,[value,...args]);deny(()=>call(intent),'42501');fixture.run(`UPDATE ${name} SET ${column}=$1 WHERE ${where}`,[restore,...args]);}
 deny(()=>call(intent,ids.actor,ids.tenant,null),'22023');
 fixture.run('UPDATE public.paige_durable_work SET max_attempts=2 WHERE id=$1',[first.work_id]);deny(()=>call(intent),'22023');fixture.run('UPDATE public.paige_durable_work SET max_attempts=1 WHERE id=$1',[first.work_id]);
 const foreignIntent=randomUUID();as('service_role','SELECT * FROM public.create_paige_durable_work($1,$2,$3,$4,$5,$6,$7::jsonb,$8,60,1)',[ids.tenant,ids.actor,foreignIntent,ids.thread,'systems.check','systems_check',JSON.stringify(authority(ids.actor,ids.tenant)),`tenant:${ids.tenant}:systems-check:manual:v1`]);
 deny(()=>call(foreignIntent),'22023');assert.equal(fixture.run('SELECT request_payload IS NULL FROM public.paige_durable_work WHERE intent_id=$1',[foreignIntent]),'t');assertions++;
 const timeoutIntent=randomUUID();
 assert.deepEqual(decode(fixture.run("BEGIN;SET LOCAL lock_timeout='9s';SELECT * FROM public._create_manual_systems_check_work($1,$2,$3,$4);SELECT json_build_object('restored_timeout',current_setting('lock_timeout'));COMMIT",[ids.actor,ids.tenant,timeoutIntent,ids.thread])),{restored_timeout:'9s'});assertions++;
 // Two genuine connections share one unique original intent; the second waits
 // until the first transaction commits, then returns the SAME prepared row.
 const racedIntent=randomUUID(),held=await fixture.holdArchive('SET LOCAL ROLE service_role;'+sql('SELECT * FROM public._create_manual_systems_check_work($1,$2,$3,$4)',[ids.actor,ids.tenant,racedIntent,ids.thread]),[],{manualRelease:true});
 const label='e2_systems_request_'+randomUUID().replaceAll('-',''),racing=asyncNative(sql('SET ROLE service_role; SELECT row_to_json(r)FROM public._create_manual_systems_check_work($1,$2,$3,$4)r;',[ids.actor,ids.tenant,racedIntent,ids.thread]),label);
 try{await observedWait(label);}finally{held.release();}await held.completed;
 const raced=await racing;assert.equal(raced.code,0,raced.err);assert.equal(decode(raced.out).resumed_existing,true);assert.equal(fixture.run('SELECT count(*)FROM public.paige_durable_work WHERE intent_id=$1',[racedIntent]),'1');assertions++;
 // Current authority must be re-read after an actual lock wait, not borrowed
 // from a statement's old snapshot or the original Work's authority labels.
 for(const [table,column,value,where,target,restore]of [
  ['public.profiles','active_tenant_id',ids.second,'user_id',ids.actor,ids.tenant],
  ['public.tenants','status','inactive','id',ids.tenant,'active'],
  ['public.tenant_members','role','member','user_id',ids.actor,'owner'],
  ['auth.users','banned_until','2099-01-01','id',ids.actor,null],
  ['public.paige_chat_threads','audience','customer','id',ids.thread,'workspace'],
 ]){
  const hold=await fixture.holdArchive(`UPDATE ${table} SET ${column}=$1 WHERE ${where}=$2`,[value,target],{manualRelease:true});
  const waitLabel='e2_systems_scope_'+randomUUID().replaceAll('-',''),before=count();
  const attempt=asyncNative(sql('SET ROLE service_role;SELECT * FROM public._create_manual_systems_check_work($1,$2,$3,$4);',[ids.actor,ids.tenant,randomUUID(),ids.thread]),waitLabel);
  try{await observedWait(waitLabel);}finally{hold.release();}await hold.completed;
  const refused=await attempt;assert.notEqual(refused.code,0);assert.match(refused.err,/42501:.*SYSTEMS_WORK_UNAVAILABLE/);assert.equal(count(),before);fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${where}=$2`,[restore,target]);assertions++;
 }
 const blocked=await fixture.holdArchive('UPDATE public.profiles SET active_tenant_id=active_tenant_id WHERE user_id=$1',[ids.actor],{manualRelease:true});
 try{deny(()=>call(),'55P03');}finally{blocked.release(false);}await blocked.completed;
 assert.equal(fixture.run('SELECT count(*)FROM public.paige_systems_check_run'),'0');assert.equal(originalShape(),shape);assertions++;
 let manualDispatchProof;
 if(process.argv.includes('--manual-dispatch')){
  const source=read('supabase/migrations/20271115040202_e02_manual_systems_dispatch.sql'),names=[];
  const startKey='public._start_manual_systems_check_work(uuid)';
  const fresh=(thread=ids.thread)=>decode(call(randomUUID(),ids.actor,ids.tenant,thread)).work_id;
  const row=id=>fixture.run('SELECT row_to_json(w)::text FROM public.paige_durable_work w WHERE id=$1',[id]);
  const begin=id=>as('service_role','SELECT row_to_json(r)FROM public._start_manual_systems_check_work($1)r',[id]);
  const test=(name,fn)=>{fn();names.push(name);};
  const refused=(id,code,reason)=>{const before=row(id);assert.throws(()=>begin(id),e=>e.code===code&&(!reason||e.message.includes(reason)));assert.equal(row(id),before);names.push(reason??code);};
  test('real absent-contract baseline',()=>assert.throws(()=>begin(randomUUID()),e=>e.code==='42883'));
  const old=originalShape();fixture.run(source);test('original contracts unchanged',()=>assert.equal(originalShape(),old));
  test('server-only bounded function metadata',()=>assert.deepEqual(decode(fixture.run(`SELECT json_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE'),'server',has_function_privilege('service_role',oid,'EXECUTE'))FROM pg_proc WHERE oid='${startKey}'::regprocedure`)),{owner:'postgres',definer:true,config:['search_path=""','lock_timeout=3s'],anon:false,auth:false,server:true}));
  const installed=fixture.run(`SELECT md5(prosrc)||'|'||proacl::text FROM pg_proc WHERE oid='${startKey}'::regprocedure`);
  test('duplicate DDL refused without replacement',()=>{assert.throws(()=>fixture.run(source),e=>e.code==='42723');assert.equal(fixture.run(`SELECT md5(prosrc)||'|'||proacl::text FROM pg_proc WHERE oid='${startKey}'::regprocedure`),installed);});
  const id=fresh(),prior=JSON.parse(row(id)),started=decode(begin(id)),after=JSON.parse(row(id));
  test('same original identity and fixed payload',()=>assert.deepEqual(started,{work_id:id,work_status:'claimed',server_idempotency_key:prior.idempotency_key,tenant_id:ids.tenant,initiating_user_id:ids.actor,thread_id:ids.thread,attempt_count:1,request_payload:payload}));
  test('single native CAS, same attempt and bounded lease',()=>{assert.equal(after.dispatch_started_attempt,1);assert.equal(after.version,prior.version+1);assert.equal(after.attempt_count,1);assert.equal(after.max_attempts,1);assert.ok(new Date(after.lease_until)-new Date(after.heartbeat_at)<=300001);assert.ok(new Date(after.lease_until)>new Date(prior.lease_until));});
  for(const k of ['id','tenant_id','initiating_user_id','intent_id','thread_id','idempotency_key','request_payload','authority_context','scope_epoch','claimed_at','created_at'])assert.deepEqual(after[k],prior[k],k);
  refused(id,'55000','SYSTEMS_WORK_ALREADY_DISPATCHED'); // Lost ACK never means retry the scan.
  test('explicitly unthreaded preparation supported',()=>assert.equal(decode(begin(fresh(null))).thread_id,null));
  for(const role of ['anon','authenticated'])test(role+' execute refusal',()=>assert.throws(()=>as(role,'SELECT *FROM public._start_manual_systems_check_work($1)',[fresh()]),e=>e.code==='42501'));
  refused(null,'22023');refused(randomUUID(),'42501');
  for(const [table,column,value,where,target,restore]of [
   ['public.profiles','active_tenant_id',ids.second,'user_id',ids.actor,ids.tenant],
   ['public.tenants','status','trial','id',ids.tenant,'active'],
   ['public.tenants','account_type','agency','id',ids.tenant,'standalone'],
   ['public.tenants','parent_tenant_id',ids.second,'id',ids.tenant,null],
   ['public.tenant_members','role','member','user_id',ids.actor,'owner'],
   ['public.tenant_members','status','inactive','user_id',ids.actor,'active'],
   ['auth.users','banned_until','2099-01-01','id',ids.actor,null],
   ['auth.users','deleted_at','2099-01-01','id',ids.actor,null],
   ['public.paige_chat_threads','audience','customer','id',ids.thread,'workspace'],
   ['public.paige_chat_threads','is_archived','true','id',ids.thread,'false'],
  ]){const w=fresh();fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${where}=$2`,[value,target]);try{refused(w,'42501');}finally{fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${where}=$2`,[restore,target]);}}
  const payloadless=fixture.run('SELECT id FROM public.paige_durable_work WHERE intent_id=$1',[foreignIntent]);refused(payloadless,'42501');
  for(const direct of [true,false]){const w=fresh(),run=direct?w:randomUUID();fixture.run('INSERT INTO public.paige_systems_check_run(id,work_id)VALUES($1,$2)',[run,direct?null:w]);try{refused(w,'55000','SYSTEMS_WORK_RECONCILIATION_REQUIRED');}finally{fixture.run('DELETE FROM public.paige_systems_check_run WHERE id=$1',[run]);}}
  const ceiling=fresh();fixture.run('UPDATE public.paige_durable_work SET max_attempts=2 WHERE id=$1',[ceiling]);refused(ceiling,'42501');
  for(const status of ['cancelled','outcome_unknown']){const w=fresh();fixture.run("UPDATE public.paige_durable_work SET status=$1,terminal_outcome=CASE WHEN $1='cancelled' THEN '{\"cancelled\":true}'::jsonb END,settled_at=CASE WHEN $1='cancelled' THEN now() END WHERE id=$2",[status,w]);refused(w,'55000');}
  const expired=fresh();fixture.run("UPDATE public.paige_durable_work SET lease_until=clock_timestamp()-interval '1second' WHERE id=$1",[expired]);refused(expired,'55000');
  // A second native session waits on the original row, then observes the first
  // transaction's committed dispatch marker and refuses a duplicate execution.
  const shared=fresh(),h=await fixture.holdArchive('SET LOCAL ROLE service_role;'+sql('SELECT *FROM public._start_manual_systems_check_work($1)',[shared]),[],{manualRelease:true});
  const label='e2_systems_cas_'+randomUUID().replaceAll('-',''),second=asyncNative(sql('SET ROLE service_role;SELECT *FROM public._start_manual_systems_check_work($1)',[shared]),label);
  try{await observedWait(label);}finally{h.release();}await h.completed;const duplicate=await second;
  test('two native claimers, one dispatch marker',()=>{assert.notEqual(duplicate.code,0);assert.match(duplicate.err,/55000:.*SYSTEMS_WORK_ALREADY_DISPATCHED/);assert.equal(JSON.parse(row(shared)).dispatch_started_attempt,1);});
  // Causal negative control: removing only the original-row lock admits BOTH
  // native callers. The repaired assertion above would reject that result.
  const replace=source.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
  assert.equal(replace.split('FOR UPDATE;').length,2);
  try{
   fixture.run(replace.replace('FOR UPDATE;',';'));
   const w=fresh(),held=await fixture.holdArchive('SET LOCAL ROLE service_role;'+sql('SELECT *FROM public._start_manual_systems_check_work($1)',[w]),[],{manualRelease:true});
   const label='e2_systems_unsafe_'+randomUUID().replaceAll('-',''),pending=asyncNative(sql('SET ROLE service_role;SELECT *FROM public._start_manual_systems_check_work($1)',[w]),label);
   try{await observedWait(label);}finally{held.release();}await held.completed;
   const unsafe=await pending;test('row-lock removal control exposes duplicate admission',()=>assert.equal(unsafe.code,0,unsafe.err));
  }finally{fixture.run(replace);}
  let claimWaits=1;
  for(const [table,column,value,where,target,restore]of [
   ['public.profiles','active_tenant_id',ids.second,'user_id',ids.actor,ids.tenant],
   ['public.tenants','status','inactive','id',ids.tenant,'active'],
   ['public.tenant_members','role','member','user_id',ids.actor,'owner'],
   ['auth.users','banned_until','2099-01-01','id',ids.actor,null],
   ['public.paige_chat_threads','audience','customer','id',ids.thread,'workspace'],
  ]){
   const w=fresh(),before=row(w),h=await fixture.holdArchive(`UPDATE ${table} SET ${column}=$1 WHERE ${where}=$2`,[value,target],{manualRelease:true});
   const label='e2_systems_claim_'+randomUUID().replaceAll('-',''),pending=asyncNative(sql('SET ROLE service_role;SELECT *FROM public._start_manual_systems_check_work($1)',[w]),label);
   try{await observedWait(label);claimWaits++;}finally{h.release();}await h.completed;
   try{const denied=await pending;test('current authority after actual claim lock wait',()=>{assert.notEqual(denied.code,0);assert.match(denied.err,/42501:.*SYSTEMS_WORK_UNAVAILABLE/);assert.equal(row(w),before);});}finally{fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${where}=$2`,[restore,target]);}
  }
  const timed=fresh();fixture.run("UPDATE public.paige_durable_work SET lease_until=clock_timestamp()+interval '1second' WHERE id=$1",[timed]);
  const timedBefore=row(timed),hTime=await fixture.holdArchive('UPDATE public.paige_durable_work SET version=version WHERE id=$1',[timed],{manualRelease:true});
  const timeLabel='e2_systems_time_'+randomUUID().replaceAll('-',''),timeRead=asyncNative(sql('SET ROLE service_role;SELECT *FROM public._start_manual_systems_check_work($1)',[timed]),timeLabel);
  try{await observedWait(timeLabel);claimWaits++;await new Promise(r=>setTimeout(r,1100));}finally{hTime.release();}await hTime.completed;
  const late=await timeRead;test('expiry during row wait uses actual time',()=>{assert.notEqual(late.code,0);assert.match(late.err,/55000:.*SYSTEMS_WORK_NOT_CLAIMABLE/);assert.equal(row(timed),timedBefore);});
  const timeoutWork=fresh(),hTimeout=await fixture.holdArchive('UPDATE public.profiles SET active_tenant_id=active_tenant_id WHERE user_id=$1',[ids.actor],{manualRelease:true});
  try{refused(timeoutWork,'55P03');}finally{hTimeout.release(false);}await hTimeout.completed;
  const settingWork=fresh();test('caller timeout restored after bounded claim',()=>assert.deepEqual(decode(fixture.run("BEGIN;SET LOCAL lock_timeout='9s';SELECT *FROM public._start_manual_systems_check_work($1);SELECT json_build_object('restored_timeout',current_setting('lock_timeout'));COMMIT",[settingWork])),{restored_timeout:'9s'}));
  test('no original scan/result or unrelated contract change',()=>{assert.equal(fixture.run('SELECT count(*)FROM public.paige_systems_check_run'),'0');assert.equal(originalShape(),old);});
  manualDispatchProof={checkpoints:names.length,nativeSessions:2,observedClaimWaits:claimWaits,unsafeControlObservedWaits:1,rowLockRemovalDetected:true,migrationSha256:createHash('sha256').update(source).digest('hex'),grantAndRelease:'OWNER_APPROVAL_REQUIRED',workerOrScan:false};
 }
 console.log(JSON.stringify({pass:true,nativeCaseCheckpoints:assertions,actualNativeCreatorSha256:createHash('sha256').update(creator).digest('hex'),originalNativeMetadataUnchanged:true,originalWorkOnly:true,simultaneousFactoryConnections:2,observedLockWaits:6,boundedLockTimeoutProven:true,dispatchOrCustomerScan:false,productionAcceptance:false,...(manualDispatchProof?{manualDispatchProof}:{})}));
}finally{
 await fixture.close();assert.match(fixture.database,/^operator_account_lifecycle_proof_[0-9_]+$/);
 fixture.role='';fixture.run('DROP DATABASE '+fixture.database,[],'postgres');
}
