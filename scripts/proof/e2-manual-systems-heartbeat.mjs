// Disposable native proof; existing Work fixture, migrations and original writer.
// Controlled surrounding Auth tables are not authenticated customer acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const port=Number(process.argv[2]),baselineOnly=process.argv.includes('--baseline');
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Explicit disposable loopback PostgreSQL port required');
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const fixture=new OperatorPostgresFixture(port),ids=Object.fromEntries(['actor','admin','tenant','other','thread'].map(k=>[k,randomUUID()]));
const key='public.heartbeat_paige_durable_work(uuid,text,integer)';let checks=0;
const decode=s=>JSON.parse(s.split(/\r?\n/).find(l=>l.startsWith('{')));
const as=(role,sql,params=[])=>{const prev=fixture.role;fixture.role=role;try{return fixture.run(sql,params);}finally{fixture.role=prev;}};
const create=(actor=ids.actor,thread=ids.thread)=>{
 const row=decode(as('service_role','SELECT row_to_json(r)FROM public._create_manual_systems_check_work($1,$2,$3,$4)r',[actor,ids.tenant,randomUUID(),thread]));
 // Model post-dispatch state only. This is not proof of the held dispatch PR.
 fixture.run('UPDATE public.paige_durable_work SET dispatch_started_attempt=1 WHERE id=$1',[row.work_id]);
 return decode(fixture.run('SELECT row_to_json(w)FROM public.paige_durable_work w WHERE id=$1',[row.work_id]));
};
const hb=(row,seconds=300,k=row.idempotency_key,role='service_role')=>decode(as(role,'SELECT row_to_json(r)FROM public.heartbeat_paige_durable_work($1,$2,$3)r',[row.id,k,seconds]));
const snapshot=id=>fixture.run('SELECT row_to_json(w)FROM public.paige_durable_work w WHERE id=$1',[id]);
const check=(label,fn)=>{fn();checks++;console.log('PASS '+label);};
const deny=(row,code='42501',fn=()=>hb(row))=>{const before=snapshot(row.id);assert.throws(fn,e=>e.code===code);assert.equal(snapshot(row.id),before);};
const change=(table,column,value,where,id,previous,fn)=>{
 const relation=table==='auth.users'?table:`public.${table}`;
 fixture.run(`UPDATE ${relation} SET ${column}=$1 WHERE ${where}=$2`,[value,id]);try{fn();}finally{fixture.run(`UPDATE ${relation} SET ${column}=$1 WHERE ${where}=$2`,[previous,id]);}
};
const causal=()=>{
 const row=create(),out=[];out.push(hb(row).work_status==='claimed');
 try{hb(row,300,'wrong-key');out.push(false);}catch(e){out.push(e.code==='42501');}
 change('tenant_members','status','inactive','user_id',ids.actor,'active',()=>{
  try{hb(row);out.push(false);}catch(e){out.push(e.code==='42501');}
 });
 fixture.run("UPDATE public.paige_durable_work SET claimed_at=clock_timestamp()-interval '4 minutes',lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[row.id]);
 hb(row,3600);out.push(fixture.run("SELECT lease_until<=claimed_at+interval '5 minutes' FROM public.paige_durable_work WHERE id=$1",[row.id])==='t');
 return out;
};
function asyncNative(text,label){
 const child=spawn(fixture.psql,fixture.args(),{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 const done=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 done.catch(()=>{});child.stdin.end(`\\set VERBOSITY verbose\nSET application_name='${label}';SET ROLE service_role;${text}`);return done;
}
async function observedWait(label){
 const until=Date.now()+5000;
 while(Date.now()<until){if(fixture.run("SELECT count(*)FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[label])==='1')return;await new Promise(r=>setTimeout(r,15));}
 throw Error('Second native connection did not reach the expected real lock wait');
}
try{
 assert.deepEqual(fixture.args().slice(0,5),['-X','-h','127.0.0.1','-p',String(port)]);
 if(port===5432)assert.equal(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true',true);
 else assert.equal(fixture.run("SELECT inet_server_addr()='127.0.0.1'::inet"),'t');
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
 CREATE FUNCTION public.is_platform_owner(uuid)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 CREATE FUNCTION public.is_tenant_admin_as(uuid,uuid)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 CREATE TABLE public.marketing_content(id uuid PRIMARY KEY);CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY);`);
 for(const t of ['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_systems_check_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'])fixture.run(`CREATE TABLE public.${t}(id uuid PRIMARY KEY)`);
 fixture.run(read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql'));
 const doc=read('supabase/migrations/20270418000000_paige_durable_document_work.sql');fixture.run(doc.slice(0,doc.indexOf('-- Authenticated submission:')));
 const source=read('supabase/migrations/20271108201000_e09_customer_private_chat.sql'),a=source.indexOf('CREATE OR REPLACE FUNCTION public.create_paige_durable_work('),b=source.indexOf('$function$;',a);assert.ok(a>0&&b>a);fixture.run(source.slice(a,b+11));
 fixture.run(read('supabase/migrations/20271110031000_durable_work_thread_detach.sql'));
 fixture.run(read('supabase/migrations/20271113360002_exp02_metric_actor_authority.sql'));
 const knowledge=read('supabase/migrations/20270531600000_knowledge_durable_authority.sql');
 const ka=knowledge.indexOf('CREATE OR REPLACE FUNCTION public.knowledge_actor_authorized('),kb=knowledge.indexOf('create or replace function public.create_paige_durable_work(');assert.ok(ka>0&&kb>ka);fixture.run(knowledge.slice(ka,kb));
 fixture.run(read('supabase/migrations/20271114240002_e02_manual_systems_work_request.sql'));
 fixture.run('INSERT INTO auth.users(id)VALUES($1),($2)',[ids.actor,ids.admin]);
 fixture.run("INSERT INTO public.tenants VALUES($1,'active','standalone',NULL),($2,'active','standalone',NULL)",[ids.tenant,ids.other]);
 for(const [actor,role]of [[ids.actor,'owner'],[ids.admin,'admin']]){
  fixture.run('INSERT INTO public.profiles VALUES($1,$2)',[actor,ids.tenant]);
  fixture.run("INSERT INTO public.tenant_members VALUES($1,$2,$3,'active',false)",[ids.tenant,actor,role]);
 }
 fixture.run("INSERT INTO public.paige_chat_threads VALUES($1,$2,$3,'workspace',false)",[ids.thread,ids.tenant,ids.actor]);
 const red=causal();assert.deepEqual(red,[true,true,false,false]);console.log('BASELINE original heartbeat: 2 PASS / 2 FAIL (revocation and finite budget)');
 if(!baselineOnly){
  const migration=read('supabase/migrations/20271115080002_e02_manual_systems_heartbeat.sql');
  const definition=()=>fixture.run(`SELECT pg_get_functiondef('${key}'::regprocedure)`).replaceAll('\r\n','\n');
  const body=()=>fixture.run(`SELECT prosrc FROM pg_proc WHERE oid='${key}'::regprocedure`).replaceAll('\r\n','\n');
  // A CREATE OR REPLACE reparses the default expression at a new source offset.
  // Compare its actual SQL meaning, retaining every other pg_proc attribute.
  const metadata=()=>fixture.run(`SELECT ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0)))::text FROM pg_proc p WHERE oid='${key}'::regprocedure`);
  const otherFunctions=()=>fixture.run(`SELECT md5(jsonb_agg(to_jsonb(p)ORDER BY p.oid)::text)FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.oid<>'${key}'::regprocedure`);
  const oldBody=body(),oldDefinition=definition(),oldMetadata=metadata(),oldOthers=otherFunctions();
  fixture.run(migration);const candidateBody=body(),candidateDefinition=definition();
  check('full ABI/default/OID/owner/ACL/config/planner metadata unchanged',()=>assert.equal(metadata(),oldMetadata));
  check('every other public function unchanged',()=>assert.equal(otherFunctions(),oldOthers));
  check('whole incumbent other-kind body inverse is exact',()=>{
   const vars='\n  _manual_identity public.paige_durable_work%rowtype;\n  _manual_now timestamptz;\n  _manual_budget timestamptz;\n';
   const from=candidateBody.indexOf('  -- E02 manual heartbeat:');
   const end='  -- E02 manual heartbeat end; incumbent other-kind path follows unchanged.\n';
   const until=candidateBody.indexOf(end,from)+end.length;assert.ok(from>0&&until>from);
   assert.equal((candidateBody.slice(0,from)+candidateBody.slice(until)).replace(vars,''),oldBody);
  });
  check('new-flow causal baseline becomes 4 PASS / 0 FAIL',()=>assert.deepEqual(causal(),[true,true,true,true]));
  const row=create();
  check('repeat heartbeat retains UUID/attempt/dispatch and fixed ceiling',()=>{
   for(let i=0;i<2;i++)assert.equal(hb(row).work_status,'claimed');
   assert.equal(fixture.run("SELECT attempt_count=1 AND max_attempts=1 AND dispatch_started_attempt=1 AND lease_until<=claimed_at+interval '5 minutes' FROM public.paige_durable_work WHERE id=$1",[row.id]),'t');
  });
  check('current Admin with no conversation can renew',()=>assert.equal(hb(create(ids.admin,null)).work_status,'claimed'));
  for(const role of ['anon','authenticated'])check(role+' cannot execute heartbeat',()=>deny(row,'42501',()=>hb(row,300,row.idempotency_key,role)));
  for(const seconds of [null,29,3601])check('manual invalid lease '+seconds+' refused unchanged',()=>deny(row,'22023',()=>hb(row,seconds)));
  check('wrong original key refused unchanged',()=>deny(row,'42501',()=>hb(row,300,randomUUID())));
  check('foreign Work key does not authorize original row',()=>deny(row,'42501',()=>hb(row,300,create(ids.admin,null).idempotency_key)));
  for(const [table,column,value,where,id,previous,label]of [
   ['tenant_members','status','inactive','user_id',ids.actor,'active','revoked membership'],
   ['tenant_members','role','member','user_id',ids.actor,'owner','demoted actor'],
   ['profiles','active_tenant_id',ids.other,'user_id',ids.actor,ids.tenant,'changed workspace'],
   ['tenants','status','trial','id',ids.tenant,'active','inactive execution eligibility'],
   ['tenants','account_type','agency','id',ids.tenant,'standalone','wrong account type'],
   ['tenants','parent_tenant_id',ids.other,'id',ids.tenant,null,'subaccount'],
   ['paige_chat_threads','is_archived',true,'id',ids.thread,false,'archived conversation'],
   ['paige_chat_threads','audience','client','id',ids.thread,'workspace','wrong conversation audience'],
   ['paige_chat_threads','caller_user_id',ids.admin,'id',ids.thread,ids.actor,'foreign conversation actor'],
   ['auth.users','deleted_at','2099-01-01','id',ids.actor,null,'deleted Auth actor'],
   ['auth.users','banned_until','2099-01-01','id',ids.actor,null,'banned Auth actor'],
  ])change(table,column,value,where,id,previous,()=>check(label+' refused unchanged',()=>deny(row)));
  for(const status of ['cancelled','outcome_unknown','failed','succeeded','expired']){
   const terminal=create();fixture.run("UPDATE public.paige_durable_work SET status=$1,terminal_outcome=CASE WHEN $1 IN('cancelled','failed','succeeded')THEN '{}'::jsonb END,settled_at=CASE WHEN $1 IN('cancelled','failed','succeeded')THEN clock_timestamp()END WHERE id=$2",[status,terminal.id]);
   check(status+' never revived or retried',()=>deny(terminal,'55000'));
  }
  const undispatched=create();fixture.run('UPDATE public.paige_durable_work SET dispatch_started_attempt=0 WHERE id=$1',[undispatched.id]);
  check('prepared but undispatched work cannot renew',()=>deny(undispatched));
  const future=create();fixture.run("UPDATE public.paige_durable_work SET claimed_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[future.id]);
  check('future attempt timestamp refused unchanged',()=>deny(future));
  for(const [name,assignment]of [
   ['original lease expired',"lease_until=clock_timestamp()-interval '1 second'"],
   ['original finite budget elapsed',"claimed_at=clock_timestamp()-interval '6 minutes',lease_until=clock_timestamp()+interval '1 minute'"],
  ]){const expired=create();fixture.run(`UPDATE public.paige_durable_work SET ${assignment} WHERE id=$1`,[expired.id]);
   check(name+' becomes expired with no renewal',()=>{assert.equal(hb(expired).work_status,'expired');assert.equal(hbSafeStatus(expired),'expired');});}
  function hbSafeStatus(r){return fixture.run('SELECT status FROM public.paige_durable_work WHERE id=$1 AND lease_until IS NULL AND attempt_count=1 AND dispatch_started_attempt=1',[r.id]);}
  // Malformed reserved-purpose rows are created through the original writer;
  // immutable identity/payload triggers stay enabled throughout this proof.
  function generic(capability='systems.check',kind='systems_check',overrides={}){
   const authority={tenant_id:ids.tenant,actor_user_id:ids.actor,authority_source:'server_resolved',role_gate:'owner_or_admin',approval_reusable:false,...overrides.authority};
   const made=decode(fixture.run('SELECT row_to_json(r)FROM public.create_paige_durable_work($1,$2,$3,NULL,$4,$5,$6::jsonb,$7,60,$8)r',[ids.tenant,ids.actor,randomUUID(),capability,kind,JSON.stringify(authority),overrides.epoch??`tenant:${ids.tenant}:systems-check:manual:v1`,overrides.max??1]));
   fixture.run('UPDATE public.paige_durable_work SET request_payload=$1::jsonb,dispatch_started_attempt=1 WHERE id=$2',[JSON.stringify(overrides.payload??{version:1,scope:'tenant',scan_flavor:'manual',action_filing:'none'}),made.work_id]);
   return decode(snapshot(made.work_id));
  }
  for(const [label,r]of [
   ['reserved kind with other capability',generic('documents.create')],
   ['reserved capability with other kind',generic('systems.check','document_authoring')],
   ['incorrect epoch',generic(undefined,undefined,{epoch:'wrong-epoch'})],
   ['extra reusable authority',generic(undefined,undefined,{authority:{approval_reusable:true}})],
   ['extra payload field',generic(undefined,undefined,{payload:{version:1,scope:'tenant',scan_flavor:'manual',action_filing:'none',extra:true}})],
   ['wrong attempt ceiling',generic(undefined,undefined,{max:2})],
  ])check(label+' refuses fallback unchanged',()=>deny(r));
  // Whole-source inverse plus actual incumbent-kind behavior: this slice does
  // not retroactively change authority or renewal policy for unrelated Work.
  for(const [cap,kind]of [['documents.create','document_authoring'],['knowledge.extract','knowledge_extract'],['research.run','research']]){
   const legacy=generic(cap,kind);check(kind+' retains incumbent renewal',()=>assert.equal(hb(legacy,30).work_status,'claimed'));
   check(kind+' retains wrong-key refusal',()=>deny(legacy,'42501',()=>hb(legacy,30,'wrong')));
  }
  check('exact migration replay is inert for Work and metadata',()=>{const before=snapshot(row.id);fixture.run(migration);assert.equal(snapshot(row.id),before);assert.equal(metadata(),oldMetadata);assert.equal(body(),candidateBody);});
  for(const [label,mutate,restore]of [
   ['changed incumbent body',()=>fixture.run(oldDefinition.replace(oldBody,oldBody+'\n-- drift')),()=>fixture.run(candidateDefinition)],
   ['changed candidate body',()=>fixture.run(candidateDefinition.replace(candidateBody,candidateBody+'\n-- drift')),()=>fixture.run(candidateDefinition)],
   ['public execution drift',()=>fixture.run(`GRANT EXECUTE ON FUNCTION ${key} TO PUBLIC`),()=>fixture.run(`REVOKE EXECUTE ON FUNCTION ${key} FROM PUBLIC`)],
   ['ordinary actor execution drift',()=>fixture.run(`GRANT EXECUTE ON FUNCTION ${key} TO authenticated`),()=>fixture.run(`REVOKE EXECUTE ON FUNCTION ${key} FROM authenticated`)],
   ['search path drift',()=>fixture.run(`ALTER FUNCTION ${key} SET search_path=public`),()=>fixture.run(candidateDefinition)],
  ]){mutate();try{check(label+' blocks migration',()=>assert.throws(()=>fixture.run(migration),e=>e.code==='P0001'));}finally{restore();}}
  check('all function metadata and other functions restored exactly',()=>{assert.equal(metadata(),oldMetadata);assert.equal(otherFunctions(),oldOthers);});
  // A held current-authority update must block BEFORE the Work row is locked.
  const locked=create(),lockedSnapshot=snapshot(locked.id);let holder=await fixture.holdArchive(fixture.sql("UPDATE public.profiles SET active_tenant_id=$1 WHERE user_id=$2",[ids.other,ids.actor]),[],{manualRelease:true});
  let waiting;
  try{
   waiting=asyncNative(fixture.sql('SELECT * FROM public.heartbeat_paige_durable_work($1,$2,300)',[locked.id,locked.idempotency_key]),'e02_hb_authority');await observedWait('e02_hb_authority');
   fixture.run('BEGIN;SELECT id FROM public.paige_durable_work WHERE id=$1 FOR UPDATE NOWAIT;COMMIT',[locked.id]);
  }finally{holder.release();await holder.completed;}
  const revoked=await waiting;check('actual authority lock wait precedes Work and refuses committed workspace change',()=>{assert.notEqual(revoked.code,0);assert.match(revoked.err,/42501/);assert.equal(snapshot(locked.id),lockedSnapshot);});
  fixture.run('UPDATE public.profiles SET active_tenant_id=$1 WHERE user_id=$2',[ids.tenant,ids.actor]);
  for(const [budget,mutant]of [[false,false],[true,false],[false,true]]){
   if(mutant)fixture.run(candidateDefinition.replace('_manual_now:=clock_timestamp();','_manual_now:=now();'));
   const expiring=create();fixture.run(`UPDATE public.paige_durable_work SET ${budget?"claimed_at=clock_timestamp()-interval '295 seconds',lease_until=clock_timestamp()+interval '1 minute'":"lease_until=clock_timestamp()+interval '5 seconds'"} WHERE id=$1`,[expiring.id]);
   holder=await fixture.holdArchive(fixture.sql('SELECT id FROM public.paige_durable_work WHERE id=$1 FOR UPDATE',[expiring.id]),[],{manualRelease:true});
   try{
    waiting=asyncNative(fixture.sql('SELECT row_to_json(r)FROM public.heartbeat_paige_durable_work($1,$2,300)r',[expiring.id,expiring.idempotency_key]),'e02_hb_expiry');await observedWait('e02_hb_expiry');
    const deadline=budget?"w.claimed_at+interval '5 minutes'":'w.lease_until';
    assert.equal(fixture.run(`SELECT a.xact_start<${deadline} FROM public.paige_durable_work w CROSS JOIN pg_stat_activity a WHERE w.id=$1 AND a.application_name='e02_hb_expiry'`,[expiring.id]),'t','The actual heartbeat transaction must precede expiry');
    const limit=Date.now()+10000;let elapsed=false;
    while(Date.now()<limit){if(fixture.run(`SELECT clock_timestamp()>${deadline} FROM public.paige_durable_work w WHERE w.id=$1`,[expiring.id])==='t'){elapsed=true;break;}await new Promise(r=>setTimeout(r,30));}
    assert.equal(elapsed,true,'Actual original expiry must pass while the row is held');
   }finally{holder.release();await holder.completed;}
   const result=await waiting;
   try{check(mutant?'reintroduced transaction-start clock wrongly renews: causal negative control':(budget?'finite budget':'original lease')+' expiring during real Work lock wait cannot revive',()=>{assert.equal(result.code,0,result.err);assert.equal(decode(result.out).work_status,mutant?'claimed':'expired');});}finally{if(mutant)fixture.run(candidateDefinition);}
  }
  const concurrent=create(),n=Number(fixture.run('SELECT count(*)FROM public.paige_durable_work'));
  const simultaneous=await Promise.all([1,2].map(i=>asyncNative(fixture.sql('SELECT row_to_json(r)FROM public.heartbeat_paige_durable_work($1,$2,300)r',[concurrent.id,concurrent.idempotency_key]),'e02_hb_concurrent_'+i)));
  check('two real renewals retain one original Work and attempt; no scan result',()=>{
   simultaneous.forEach(x=>{assert.equal(x.code,0,x.err);assert.equal(decode(x.out).work_status,'claimed');});
   assert.equal(Number(fixture.run('SELECT count(*)FROM public.paige_durable_work')),n);
   assert.equal(fixture.run('SELECT count(*)FROM public.paige_systems_check_run'),'0');
   assert.equal(fixture.run('SELECT attempt_count=1 AND dispatch_started_attempt=1 FROM public.paige_durable_work WHERE id=$1',[concurrent.id]),'t');
  });
 }
}finally{
 fixture.role='';fixture.run(`DROP DATABASE ${fixture.database} WITH (FORCE)`,[],'postgres');
}
console.log(`Native manual heartbeat: ${checks} candidate checkpoints; synthetic only; no scan or customer acceptance.`);
