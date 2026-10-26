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
 for(const t of ['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'])fixture.run(`CREATE TABLE public.${t}(id uuid PRIMARY KEY)`);

 // Actual original Systems schema, not a substitute result table.
 const tableFrom=(path,name)=>{const sql=read(path);const start=sql.indexOf('create table if not exists public.'+name+' (');assert.ok(start>=0);const end=sql.indexOf('\n);',start);assert.ok(end>start);return sql.slice(start,end+3);};
 fixture.run('CREATE TABLE public.paige_departments(slug text PRIMARY KEY)');
 const systems='supabase/migrations/20260816000000_systems_check_layer1.sql';
 for(const table of ['paige_systems_check_registry','paige_systems_check_run','paige_systems_check_finding'])fixture.run(tableFrom(systems,table));
 const coverage=read('supabase/migrations/20261203000000_systems_check_reads_a_full_sweep.sql');
 const coverageStart=coverage.indexOf('ALTER TABLE public.paige_systems_check_run');assert.ok(coverageStart>0);
 fixture.run(coverage.slice(coverageStart,coverage.indexOf(';',coverageStart)+1));
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
  const migration=read('supabase/migrations/20271116010102_e02_manual_systems_heartbeat.sql');
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
  assert.equal(checks,57,'All 57 original heartbeat checkpoints remain intact');
 fixture.run(read('supabase/migrations/20271114220002_e02_manual_systems_capture.sql'));
 // Original table, vocabulary, display and writer; no replacement receipt ledger.
 const baseRail=read('supabase/migrations/20261201000200_n8n_workspace_rail_events.sql');
 fixture.run(baseRail.slice(baseRail.indexOf('CREATE TABLE'),baseRail.indexOf('-- Fixed product copy')));
 const agentRail=read('supabase/migrations/20261201000800_the_rail_says_which_agent_acted.sql');
 const actorCols=agentRail.indexOf('ALTER TABLE public.paige_workspace_events\n  ADD COLUMN');
 assert.ok(actorCols>0);fixture.run(agentRail.slice(actorCols,agentRail.indexOf(';',actorCols)+1));
 const vocabulary=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql');
 fixture.run(vocabulary.slice(vocabulary.indexOf('ALTER TABLE public.paige_workspace_events'),vocabulary.indexOf('CREATE OR REPLACE FUNCTION public._workspace_event_display')));
 const display=read('supabase/migrations/20270548000000_studio_publish_autonomy_catalogue.sql');
 const ds=display.indexOf('CREATE OR REPLACE FUNCTION public._workspace_event_display');
 assert.ok(ds>=0);fixture.run(display.slice(ds,display.indexOf('END $$;',ds)+7));
 fixture.run(read('supabase/migrations/20270107000000_receipt_correlation_and_detail.sql'));
 fixture.run(read('supabase/migrations/20270416000000_the_receipt_seam_lost_its_lock_to_an_overload.sql'));
 fixture.run(`INSERT INTO public.paige_systems_check_registry(check_id,check_name,domain,severity,data_source,runner_key,remediation_prompt)VALUES('native_a','Native A','data_product','low','native_seam','native_a','Inspect original source')`);
 const railCount=()=>Number(fixture.run("SELECT count(*)FROM public.paige_workspace_events"));
 const originalWriter=(id)=>`SELECT public._record_workspace_rail_event('${ids.tenant}','${ids.actor}','system_check','${id}',0,'check_completed',NULL,NULL,NULL,NULL,NULL,'{"scope":"tenant","scan_flavor":"manual","action_filing":"none"}'::jsonb);`;
 const receiptId=randomUUID();
 fixture.run('BEGIN;'+originalWriter(receiptId)+originalWriter(receiptId)+"DO $$BEGIN IF(SELECT count(*)FROM public.paige_workspace_events)<>1 THEN RAISE EXCEPTION 'Original receipt deduplication failed';END IF;END$$;ROLLBACK;");
 assert.equal(railCount(),0);
 const sourceRun=(row,patch={})=>{
  const run={id:row.id,tenant_id:row.tenant_id,scan_flavor:'manual',started_at:row.claimed_at,completed_at:new Date().toISOString(),check_count:1,pass_count:1,fail_count:0,triggered_by:{scope:'tenant',action_filing:'none'},work_id:row.id,...patch};
  fixture.run(`INSERT INTO public.paige_systems_check_run SELECT *FROM jsonb_populate_record(NULL::public.paige_systems_check_run,$1::jsonb)`,[JSON.stringify({...run,created_at:new Date().toISOString()})]);
  return run;
 };
 const finding=(run,patch={})=>fixture.run(`INSERT INTO public.paige_systems_check_finding SELECT *FROM jsonb_populate_record(NULL::public.paige_systems_check_finding,$1::jsonb)`,[JSON.stringify({id:randomUUID(),run_id:run.id,check_id:'native_a',tenant_id:run.tenant_id,status:'pass',created_at:new Date().toISOString(),...patch})]);
  const finalizerKey='public.transition_paige_durable_work(uuid,text,text,jsonb,text,text,text,integer,boolean)';
  const finalizerMigration=read('supabase/migrations/20271116010352_e02_manual_systems_finalizer.sql');
  const finalizerBody=()=>fixture.run(`SELECT prosrc FROM pg_proc WHERE oid='${finalizerKey}'::regprocedure`).replaceAll('\r\n','\n');
  const finalizerDefinition=()=>fixture.run(`SELECT pg_get_functiondef('${finalizerKey}'::regprocedure)`).replaceAll('\r\n','\n');
  const finalizerMetadata=()=>fixture.run(`SELECT ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0)))::text FROM pg_proc p WHERE oid='${finalizerKey}'::regprocedure`);
  const finalizerOthers=()=>fixture.run(`SELECT md5(jsonb_agg(to_jsonb(p)ORDER BY p.oid)::text)FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.oid<>'${finalizerKey}'::regprocedure`);
  const finishSQL=(row,{status='succeeded',outcome={verified_readback:true},summary=null,blocked=null,error=null,reconciled=false,key=row.idempotency_key}={})=>fixture.sql('SELECT row_to_json(r)FROM public.transition_paige_durable_work($1,$2,$3,$4::jsonb,$5,$6,$7,300,$8)r',[row.id,key,status,JSON.stringify(outcome),summary,blocked,error,reconciled]);
  const finish=(row,options={},role='service_role')=>decode(as(role,finishSQL(row,options)));
  const incumbentBody=finalizerBody(),incumbentDefinition=finalizerDefinition(),incumbentMetadata=finalizerMetadata(),incumbentOthers=finalizerOthers();
  const unsafe=create();assert.equal(finish(unsafe).work_status,'succeeded');
  assert.equal(fixture.run('SELECT count(*)FROM public.paige_systems_check_run WHERE work_id=$1',[unsafe.id]),'0');
  assert.equal(fixture.run('SELECT count(*)FROM public.paige_workspace_events WHERE source_id=$1',[unsafe.id]),'0');
  console.log('BASELINE original finalizer accepts a caller flag without original Systems result or receipt: reproduced, not customer execution.');
  fixture.run(finalizerMigration);
  const candidateFinalizerBody=finalizerBody(),candidateFinalizerDefinition=finalizerDefinition();
  check('finalizer retains whole ABI/OID/defaults/owner/ACL/config/planner metadata',()=>assert.equal(finalizerMetadata(),incumbentMetadata));
  check('finalizer changes no other public function',()=>assert.equal(finalizerOthers(),incumbentOthers));
  check('entire incumbent non-Systems finalizer inverse is exact',()=>{
   const start=candidateFinalizerBody.indexOf('  -- E02 manual finalizer:');
   const end='  -- E02 manual finalizer end; incumbent other-kind path follows unchanged.\n';
   const stop=candidateFinalizerBody.indexOf(end,start)+end.length;
   const vars=candidateFinalizerBody.slice(candidateFinalizerBody.indexOf('\n  _manual_identity'),candidateFinalizerBody.indexOf('\nbegin\n')+1);
   assert.ok(start>0&&stop>start&&vars.startsWith('\n  _manual_identity'));
   assert.equal((candidateFinalizerBody.slice(0,start)+candidateFinalizerBody.slice(stop)).replace(vars,''),incumbentBody);
  });
  const refuseFinish=(row,code='55000',options={},role='service_role')=>{
   const before=snapshot(row.id),receipts=railCount();
   assert.throws(()=>finish(row,options,role),e=>e.code===code);
   assert.equal(snapshot(row.id),before);assert.equal(railCount(),receipts);
  };
  for(const [label,prepare]of [
   ['partial source for unfiltered Work',row=>finding(sourceRun(row,{selected_runner_keys:['native_a']}))],
   ['empty marked subset for unfiltered Work',row=>finding(sourceRun(row,{selected_runner_keys:[]}))],
   ['missing original run',()=>{}],
   ['incomplete run',row=>finding(sourceRun(row,{completed_at:null}))],
   ['foreign run tenant',row=>finding(sourceRun(row,{tenant_id:ids.other}))],
   ['missing original Work link',row=>finding(sourceRun(row,{work_id:null}))],
   ['scheduled source purpose',row=>finding(sourceRun(row,{scan_flavor:'scheduled'}))],
   ['source before current attempt',row=>finding(sourceRun(row,{started_at:'2020-01-01T00:00:00Z'}))],
   ['source past fixed attempt budget',row=>finding(sourceRun(row,{completed_at:'2090-01-01T00:00:00Z'}))],
   ['missing persisted finding',row=>sourceRun(row)],
   ['foreign finding tenant',row=>finding(sourceRun(row),{tenant_id:ids.other})],
   ['mismatched source totals',row=>finding(sourceRun(row,{check_count:2}))],
   ['mismatched source pass total',row=>finding(sourceRun(row,{pass_count:0}))],
   ['duplicate source checks',row=>{const run=sourceRun(row,{check_count:2,pass_count:2});finding(run);finding(run);}],
   ['unexpected remediation draft',row=>finding(sourceRun(row),{paige_drafted_fix:'Synthetic unapproved draft'})],
   ['future source completion within budget',row=>finding(sourceRun(row,{completed_at:new Date(Date.now()+60000).toISOString()}))],
  ]){const r=create();prepare(r);check('finalizer refuses '+label+' without settlement/receipt',()=>refuseFinish(r));}
  for(const triggered_by of [{scope:'operator',action_filing:'none'},{scope:'tenant',action_filing:'automatic'}]){
   const r=create(),before=snapshot(r.id),receipts=railCount();
   check('original source constraint refuses incompatible manual purpose '+JSON.stringify(triggered_by),()=>{
    assert.throws(()=>sourceRun(r,{triggered_by}),e=>e.code==='23514');
    assert.equal(snapshot(r.id),before);assert.equal(railCount(),receipts);
   });
  }
  for(const role of ['anon','authenticated'])check(role+' cannot invoke original finalizer',()=>refuseFinish(create(),'42501',{},role));
  check('finalizer refuses wrong original key unchanged',()=>refuseFinish(create(),'42501',{key:randomUUID()}));
  for(const [table,column,value,where,id,previous,label]of [
   ['tenant_members','status','inactive','user_id',ids.actor,'active','revoked membership'],
   ['tenant_members','role','member','user_id',ids.actor,'owner','demoted actor'],
   ['profiles','active_tenant_id',ids.other,'user_id',ids.actor,ids.tenant,'changed workspace'],
   ['tenants','status','trial','id',ids.tenant,'active','inactive business'],
   ['tenants','account_type','agency','id',ids.tenant,'standalone','wrong account type'],
   ['tenants','parent_tenant_id',ids.other,'id',ids.tenant,null,'subaccount'],
   ['paige_chat_threads','is_archived',true,'id',ids.thread,false,'archived conversation'],
   ['auth.users','banned_until','infinity','id',ids.actor,null,'banned actor'],
   ['auth.users','deleted_at','2020-01-01','id',ids.actor,null,'deleted actor'],
  ]){const r=create();check('finalizer refuses '+label,()=>change(table,column,value,where,id,previous,()=>refuseFinish(r,'42501')));}
  for(const [label,r]of [
   ['reserved kind with other capability',generic('documents.create')],
   ['reserved capability with other kind',generic('systems.check','document_authoring')],
   ['wrong immutable scope epoch',generic(undefined,undefined,{epoch:'wrong'})],
   ['reusable authority',generic(undefined,undefined,{authority:{approval_reusable:true}})],
   ['expanded payload',generic(undefined,undefined,{payload:{version:1,scope:'tenant',scan_flavor:'manual',action_filing:'none',extra:true}})],
   ['wrong attempt ceiling',generic(undefined,undefined,{max:2})],
  ])check('finalizer refuses '+label+' instead of generic fallback',()=>refuseFinish(r,'42501'));
  const undispatchedFinal=create();fixture.run('UPDATE public.paige_durable_work SET dispatch_started_attempt=0 WHERE id=$1',[undispatchedFinal.id]);
  check('finalizer refuses undispatched request',()=>refuseFinish(undispatchedFinal,'42501'));
  const good=create();finding(sourceRun(good));
  for(const [label,options,code]of [
   ['contradictory caller source',{outcome:{verified_readback:true,run_id:randomUUID()}},'55000'],
   ['unverified caller result',{outcome:{verified_readback:false}},'55000'],
   ['invented summary',{summary:'Everything is healthy and all problems are fixed'},'55000'],
   ['contradictory error',{error:'failed'},'55000'],
   ['null outcome',{outcome:null},'22023'],
  ])check('finalizer refuses '+label,()=>refuseFinish(good,code,options));
  check('actual persisted source produces one original completion and Rail receipt',()=>{
   assert.equal(finish(good).work_status,'succeeded');
   const w=JSON.parse(snapshot(good.id));assert.equal(w.terminal_outcome.run_id,w.id);assert.equal(w.terminal_outcome.check_count,1);
   assert.equal(w.attempt_count,1);assert.equal(w.dispatch_started_attempt,1);assert.equal(w.lease_until,null);
   assert.equal(w.safe_summary,'Systems Check completed. Review the recorded findings.');
   assert.equal(fixture.run("SELECT count(*)FROM public.paige_workspace_events WHERE source_id=$1 AND source_kind='system_check'AND outcome='check_completed'",[good.id]),'1');
  });
  const settledGood=snapshot(good.id),receiptGood=fixture.run('SELECT row_to_json(e)FROM public.paige_workspace_events e WHERE source_id=$1',[good.id]);
  check('verified exact replay is inert for Work and original Rail',()=>{finish(good);assert.equal(snapshot(good.id),settledGood);assert.equal(fixture.run('SELECT row_to_json(e)FROM public.paige_workspace_events e WHERE source_id=$1',[good.id]),receiptGood);});
  check('later original finding correction does not invalidate historical completion replay',()=>{
   fixture.run("UPDATE public.paige_systems_check_finding SET paige_drafted_fix=jsonb_build_object('summary','Later separately authorized correction')WHERE run_id=$1",[good.id]);
   finish(good);assert.equal(snapshot(good.id),settledGood);
  });
  const savedReceipt=JSON.parse(receiptGood);fixture.run('DELETE FROM public.paige_workspace_events WHERE source_id=$1',[good.id]);
  check('lost receipt cannot be manufactured by terminal replay',()=>refuseFinish(good));
  fixture.run('INSERT INTO public.paige_workspace_events SELECT *FROM jsonb_populate_record(NULL::public.paige_workspace_events,$1::jsonb)',[JSON.stringify(savedReceipt)]);
  check('succeeded terminal cannot change to failure',()=>refuseFinish(good,'55000',{status:'failed',outcome:{failure:'later'}}));
  const conflict=create();finding(sourceRun(conflict));fixture.run(originalWriter(conflict.id));
  check('existing contradictory receipt refuses settlement without overwrite',()=>refuseFinish(conflict));
  const rollback=create();finding(sourceRun(rollback));
  fixture.run("CREATE FUNCTION public.test_receipt_failure()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Controlled original Rail refusal' USING ERRCODE='42501';END$$;CREATE TRIGGER test_receipt_failure BEFORE INSERT ON public.paige_workspace_events FOR EACH ROW EXECUTE FUNCTION public.test_receipt_failure();");
  try{check('original Rail write failure rolls back the entire completion',()=>refuseFinish(rollback,'42501'));}finally{fixture.run('DROP TRIGGER test_receipt_failure ON public.paige_workspace_events;DROP FUNCTION public.test_receipt_failure()');}
  for(const status of ['expired','outcome_unknown']){
   const r=create();finding(sourceRun(r));fixture.run('UPDATE public.paige_durable_work SET status=$1,lease_until=NULL WHERE id=$2',[status,r.id]);
   for(const reconciled of [false,null])check(status+' refuses absent explicit reconciliation '+reconciled,()=>refuseFinish(r,'55000',{reconciled}));
   check(status+' reconciles only actual completed source to original receipt',()=>assert.equal(finish(r,{reconciled:true}).work_status,'succeeded'));
  }
  // Non-success states retain canonical semantics; no claim of absent partial data.
  for(const status of ['failed','cancelled','blocked','outcome_unknown']){
   const r=create();sourceRun(r,{completed_at:null});
   const options={status,outcome:{reason:'original canonical state'},blocked:'Original source needs review'};
   check('manual '+status+' retains original semantics with partial source',()=>assert.equal(finish(r,options).work_status,status));
   if(['failed','cancelled'].includes(status))check(status+' terminal replay remains immutable',()=>{const before=snapshot(r.id);finish(r,options);assert.equal(snapshot(r.id),before);refuseFinish(r);});
  }
  for(const [cap,kind]of [['documents.create','document_authoring'],['knowledge.extract','knowledge_extract'],['research.run','research']]){
   const r=generic(cap,kind);
   check(kind+' keeps incumbent finalization and exact replay',()=>{assert.equal(finish(r,{summary:'Original result'}).work_status,'succeeded');const before=snapshot(r.id);finish(r,{summary:'Original result'});assert.equal(snapshot(r.id),before);});
  }
  check('finalizer migration replay preserves all Work/metadata and other functions',()=>{const before=snapshot(good.id);fixture.run(finalizerMigration);assert.equal(snapshot(good.id),before);assert.equal(finalizerMetadata(),incumbentMetadata);assert.equal(finalizerOthers(),incumbentOthers);});
  for(const [label,mutate,restore]of [
   ['incumbent source drift',()=>fixture.run(incumbentDefinition.replace(incumbentBody,()=>incumbentBody+'\n-- drift')),()=>fixture.run(candidateFinalizerDefinition)],
   ['candidate source drift',()=>fixture.run(candidateFinalizerDefinition.replace(candidateFinalizerBody,()=>candidateFinalizerBody+'\n-- drift')),()=>fixture.run(candidateFinalizerDefinition)],
   ['public ACL drift',()=>fixture.run(`GRANT EXECUTE ON FUNCTION ${finalizerKey} TO PUBLIC`),()=>fixture.run(`REVOKE EXECUTE ON FUNCTION ${finalizerKey} FROM PUBLIC`)],
   ['ordinary actor ACL drift',()=>fixture.run(`GRANT EXECUTE ON FUNCTION ${finalizerKey} TO authenticated`),()=>fixture.run(`REVOKE EXECUTE ON FUNCTION ${finalizerKey} FROM authenticated`)],
   ['search path drift',()=>fixture.run(`ALTER FUNCTION ${finalizerKey} SET search_path=public`),()=>fixture.run(candidateFinalizerDefinition)],
   ['default lease drift',()=>fixture.run(candidateFinalizerDefinition.replace('DEFAULT 300','DEFAULT 3600')),()=>fixture.run(candidateFinalizerDefinition)],
  ]){mutate();try{check('finalizer guard refuses '+label,()=>assert.throws(()=>fixture.run(finalizerMigration),e=>e.code==='P0001'));}finally{restore();}}
  const authorityFinal=create(),authorityBefore=snapshot(authorityFinal.id);
  const authorityHold=await fixture.holdArchive('UPDATE public.profiles SET active_tenant_id=$1 WHERE user_id=$2',[ids.other,ids.actor],{manualRelease:true});
  const authorityLabel='e02_final_authority_'+randomUUID().replaceAll('-','');let authorityPending;
  try{authorityPending=asyncNative(finishSQL(authorityFinal),authorityLabel);await observedWait(authorityLabel);fixture.run('BEGIN;SELECT id FROM public.paige_durable_work WHERE id=$1 FOR UPDATE NOWAIT;COMMIT',[authorityFinal.id]);}finally{authorityHold.release();await authorityHold.completed;}
  const authorityResult=await authorityPending;
  check('real finalizer authority wait precedes Work and observes committed revocation',()=>{assert.notEqual(authorityResult.code,0);assert.match(authorityResult.err,/42501/);assert.equal(snapshot(authorityFinal.id),authorityBefore);});
  fixture.run('UPDATE public.profiles SET active_tenant_id=$1 WHERE user_id=$2',[ids.tenant,ids.actor]);
  const waitPastLease=async(row,label)=>{
   await observedWait(label);const deadline=Date.now()+8000;
   while(Date.now()<deadline){if(fixture.run('SELECT clock_timestamp()>lease_until FROM public.paige_durable_work WHERE id=$1',[row.id])==='t')return;await new Promise(r=>setTimeout(r,30));}
   throw Error('Actual original lease did not expire during observed native wait');
  };
  for(const seam of ['work','run','finding','receipt'])for(const mutant of [false,true]){
   if(mutant)fixture.run(candidateFinalizerDefinition.replaceAll('clock_timestamp()','now()'));
   const r=create();finding(sourceRun(r));fixture.run("UPDATE public.paige_durable_work SET lease_until=clock_timestamp()+interval '4 seconds'WHERE id=$1",[r.id]);
   const before=snapshot(r.id),label='e02_final_'+seam+'_'+randomUUID().replaceAll('-','');
   const detail={version:1,work_id:r.id,run_id:r.id,scope:'tenant',scan_flavor:'manual',action_filing:'none',check_count:1,pass_count:1,fail_count:0};
   const holdSQL=seam==='work'?'SELECT id FROM public.paige_durable_work WHERE id=$1 FOR UPDATE':seam==='run'?'UPDATE public.paige_systems_check_run SET check_count=check_count WHERE id=$1':seam==='finding'?'UPDATE public.paige_systems_check_finding SET status=status WHERE run_id=$1':fixture.sql("SELECT public._record_workspace_rail_event($1,$2,'system_check',$3,0,'check_completed',NULL,NULL,NULL,NULL,NULL,$4::jsonb)",[ids.tenant,ids.actor,r.id,JSON.stringify(detail)]);
   const held=await fixture.holdArchive(holdSQL,[r.id],{manualRelease:true});let pending;
   try{pending=asyncNative(finishSQL(r),label);await waitPastLease(r,label);}finally{held.release();await held.completed;}
   const result=await pending;
   try{check((mutant?'transaction-start clock mutant wrongly succeeds after ':'actual clock refuses lease expiry during ')+seam+' wait',()=>{
    if(mutant){assert.equal(result.code,0,result.err);assert.equal(JSON.parse(snapshot(r.id)).status,'succeeded');}
    else {assert.notEqual(result.code,0);assert.match(result.err,/55000:.*SYSTEMS_WORK_RECONCILIATION_REQUIRED/);assert.equal(snapshot(r.id),before);assert.equal(fixture.run('SELECT count(*)FROM public.paige_workspace_events WHERE source_id=$1',[r.id]),seam==='receipt'?'1':'0');}
   });}finally{if(mutant)fixture.run(candidateFinalizerDefinition);}
  }
  const concurrentFinal=create();finding(sourceRun(concurrentFinal));const priorVersion=Number(JSON.parse(snapshot(concurrentFinal.id)).version);
  const completionHold=await fixture.holdArchive('SET LOCAL ROLE service_role;'+finishSQL(concurrentFinal),[],{manualRelease:true});
  const completionLabel='e02_final_replay_'+randomUUID().replaceAll('-','');const completionPending=asyncNative(finishSQL(concurrentFinal),completionLabel);
  try{await observedWait(completionLabel);}finally{completionHold.release();await completionHold.completed;}
  const completionResult=await completionPending;
  check('two real completion sessions yield one Work transition/attempt/original receipt',()=>{assert.equal(completionResult.code,0,completionResult.err);const w=JSON.parse(snapshot(concurrentFinal.id));assert.equal(Number(w.version),priorVersion+1);assert.equal(w.attempt_count,1);assert.equal(fixture.run('SELECT count(*)FROM public.paige_workspace_events WHERE source_id=$1',[w.id]),'1');});
  const timestamped=create();finding(sourceRun(timestamped));
  const timestampHold=await fixture.holdArchive('SELECT id FROM public.paige_durable_work WHERE id=$1 FOR UPDATE',[timestamped.id],{manualRelease:true});
  const timestampLabel='e02_final_time_'+randomUUID().replaceAll('-','');const timestampPending=asyncNative(finishSQL(timestamped),timestampLabel);
  try{await observedWait(timestampLabel);fixture.run('UPDATE public.paige_systems_check_run SET completed_at=clock_timestamp()WHERE id=$1',[timestamped.id]);}finally{timestampHold.release();await timestampHold.completed;}
  const timestampResult=await timestampPending;
  check('completion timestamp follows actual source readback rather than pre-wait transaction',()=>{assert.equal(timestampResult.code,0,timestampResult.err);assert.equal(fixture.run('SELECT w.settled_at>=r.completed_at AND w.updated_at=w.settled_at FROM public.paige_durable_work w JOIN public.paige_systems_check_run r ON r.id=w.id WHERE w.id=$1',[timestamped.id]),'t');});
  fixture.run(read('supabase/migrations/20271116010202_e02_manual_systems_dispatch.sql'));
  const request=decode(as('service_role','SELECT row_to_json(r)FROM public._create_manual_systems_check_work($1,$2,$3,$4)r',[ids.actor,ids.tenant,randomUUID(),ids.thread]));
  const claim=decode(as('service_role','SELECT row_to_json(r)FROM public._start_manual_systems_check_work($1)r',[request.work_id]));
  const chain=JSON.parse(snapshot(claim.work_id));assert.equal(hb(chain).work_status,'claimed');finding(sourceRun(chain));
  check('original request→approved claim→heartbeat→source verification→original Rail retains one identity',()=>{assert.equal(finish(chain).work_status,'succeeded');const w=JSON.parse(snapshot(chain.id));assert.equal(w.id,request.work_id);assert.equal(w.terminal_outcome.run_id,w.id);assert.equal(w.attempt_count,1);assert.equal(w.max_attempts,1);assert.equal(fixture.run('SELECT count(*)FROM public.paige_workspace_events WHERE source_id=$1',[w.id]),'1');});
  const adminFinal=create(ids.admin,null);finding(sourceRun(adminFinal));
  check('eligible admin without a conversation retains original actor on result and receipt',()=>{assert.equal(finish(adminFinal).work_status,'succeeded');assert.equal(fixture.run('SELECT actor_id FROM public.paige_workspace_events WHERE source_id=$1',[adminFinal.id]),ids.admin);});
  check('terminal replay still refuses currently revoked authority',()=>change('tenant_members','status','inactive','user_id',ids.actor,'active',()=>refuseFinish(good,'42501')));
  check('manual original finalizer cannot claim a second attempt',()=>refuseFinish(create(),'55000',{status:'claimed'}));
  fixture.run("INSERT INTO public.paige_systems_check_registry(check_id,check_name,domain,severity,data_source,runner_key,remediation_prompt)VALUES('native_b','Native B','data_product','low','native_seam','native_b','Inspect original source')");
  const mixed=create(),mixedRun=sourceRun(mixed,{check_count:2,pass_count:0,fail_count:1});finding(mixedRun,{status:'fail'});finding(mixedRun,{check_id:'native_b',status:'skip'});
  check('successful capture retains actual failed/skipped findings without implying healthy checks',()=>{assert.equal(finish(mixed).work_status,'succeeded');const result=JSON.parse(snapshot(mixed.id)).terminal_outcome;assert.equal(result.check_count,2);assert.equal(result.pass_count,0);assert.equal(result.fail_count,1);});
  check('finalizer metadata/source remain exact after native controls',()=>{assert.equal(finalizerMetadata(),incumbentMetadata);assert.equal(finalizerBody(),candidateFinalizerBody);});

 }
}finally{
 fixture.role='';fixture.run(`DROP DATABASE ${fixture.database} WITH (FORCE)`,[],'postgres');
}
console.log(`Native manual heartbeat + finalizer: ${checks} candidate checkpoints; synthetic only; no scan or customer acceptance.`);
