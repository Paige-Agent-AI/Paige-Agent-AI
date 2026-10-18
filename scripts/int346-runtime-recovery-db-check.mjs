// Actual incumbent INT-346 and Rail functions in a disposable loopback database.
// Runtime packets, users, provider event IDs and pending records are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './proof/operator-postgres-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..');
const db=new OperatorPostgresFixture(Number(process.argv[2]));db.prefix=()=>'';
const baseline=process.argv.includes('--baseline');
let passed=0;
const check=(name,fn)=>{fn();console.log(`ok ${++passed} - ${name}`);};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(2),tenant=id(3),foreign=id(99),worker=id(80),nonce=id(81);
const deployment=`abcdefghijklmnopqrst_${id(82)}_441`;
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const m=name=>path.join(root,'supabase/migrations',name);
const strip=text=>text.replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
function source(file,name){
 const text=fs.readFileSync(file,'utf8'),start=text.search(new RegExp(`create or replace function public\\.${name}\\(`,'i'));
 assert(start>=0,`incumbent ${name}`);const rest=text.slice(start),tag=rest.match(/\bAS\s+(\$\w*\$)/i);
 assert(tag);const end=rest.indexOf(`${tag[1]};`,tag.index+tag[0].length);assert(end>=0);
 return rest.slice(0,end+tag[1].length+1);
}
const sql=text=>db.run(text);
const json=text=>JSON.parse(sql(text).split(/\r?\n/).find(line=>line.startsWith('{')||line.startsWith('[')));
const service=text=>`SET ROLE service_role;${text};RESET ROLE;`;
const scope=(thread,intent)=>`${q(thread)},${q(actor)},${q(tenant)},${q(intent)}`;
const state=(thread,intent)=>json(`SELECT public.paige_chat_interactive_executor_v2(${scope(thread,intent)},'state')`);
const admit=(thread,intent,supersedes=null)=>sql(`SET test.actor=${q(actor)};SET test.tenant=${q(tenant)};SET ROLE authenticated;
 SELECT public.paige_chat_interactive_begin_v2(${q(thread)},${q(intent)},${supersedes?q(supersedes):'NULL'},'Protected synthetic request',false,false,true);RESET ROLE`);
const thread=n=>{const th=id(n);sql(`INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id)VALUES(${q(th)},${q(actor)},${q(tenant)})`);return th;};
const acquire=(th,intent,requestNonce=nonce)=>json(service(`SELECT public.paige_chat_interactive_acquire_bound(${scope(th,intent)},${q(requestNonce)},${q(worker)},${q(deployment)})`));
const recover=(th,intent,requestNonce=nonce)=>json(service(`SELECT public.paige_chat_interactive_recover_bound(${scope(th,intent)},${q(requestNonce)})`));
const proof=()=>json(`SELECT jsonb_build_object('source','supabase_control_plane','event_type','Shutdown','reason','CPUTime',
 'event_id',${q(id(83))},'execution_id',${q(worker)},'deployment_id',${q(deployment)},'project_ref','abcdefghijklmnopqrst',
 'function_id',${q(id(82))},'function_slug','paige-ai-chat','event_at',clock_timestamp(),
 'query_start',clock_timestamp()-interval '1 minute','query_end',clock_timestamp(),'packet_sha256',repeat('a',64))`);
const attest=(th,intent,p=proof(),requestNonce=nonce)=>sql(`SELECT private.paige_chat_attest_runtime_shutdown(${scope(th,intent)},${q(requestNonce)},${q(JSON.stringify(p))}::jsonb)`);
function rejects(name,fn,match=/./){check(name,()=>assert.throws(fn,match));}
try{
 const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],
  {encoding:'utf8',env:{...process.env,INT336_DATABASE_URL:`postgresql://postgres@127.0.0.1:${db.port}/int336_test_emitter`}});
 assert.equal(emitted.status,0,emitted.stderr);
 const prefix=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
 sql(prefix+strip(fs.readFileSync(m('20270601000008_int346_server_issued_interactive_receipts.sql'),'utf8'))+
  strip(fs.readFileSync(m('20270602000301_int346_conversational_admission.sql'),'utf8'))+
  strip(fs.readFileSync(m('20271108110000_int346_database_executor_isolation.sql'),'utf8'))+`COMMIT;
  ALTER TABLE public.paige_chat_threads ADD COLUMN audience text DEFAULT 'workspace';
  ALTER TABLE public.paige_chat_turns ADD PRIMARY KEY(id);
  CREATE SCHEMA private;REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated;GRANT USAGE ON SCHEMA private TO service_role;
  CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,status text);
  INSERT INTO public.tenant_members VALUES(${q(tenant)},${q(actor)},'active');
  CREATE TABLE public.paige_subagents(slug text,tenant_id uuid,rail_display_name text);
  CREATE TABLE public.paige_workspace_events(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,
   source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,
   actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
  CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
  GRANT ALL ON public.paige_chat_threads,public.paige_chat_turns TO service_role;
  UPDATE public.paige_chat_interactive_rollout SET active=true;`);
 sql(source(m('20261220000000_an_act_that_landed_but_was_not_recorded.sql'),'_workspace_event_display'));
 sql('ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_native_planning');
 sql(source(m('20271108191000_planning_native_receipts_history.sql'),'_workspace_event_display'));
 sql(fs.readFileSync(m('20270107000000_receipt_correlation_and_detail.sql'),'utf8'));
 sql('REVOKE ALL ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) TO service_role');
 const oldBody=sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.paige_chat_interactive_executor_v2(uuid,uuid,uuid,uuid,text)'::regprocedure`);
 const displayIdentity=sql(`SELECT oid::text||':'||coalesce(proacl::text,'NULL') FROM pg_proc WHERE oid='public._workspace_event_display(text,text,text)'::regprocedure`);
 const displayed=()=>json(`SELECT jsonb_agg(public._workspace_event_display('capability_run',o,c) ORDER BY o,c) FROM
  unnest(ARRAY['capability_succeeded','capability_failed','capability_refused','capability_outcome_unknown','capability_completed_unrecorded'])o,
  unnest(ARRAY['crm_create_contact','n8n_run_workflow','plan_create','unclassified_synthetic'])c`);
 const displayBefore=displayed();
 const migration=fs.readFileSync(m('20271110021000_chat_runtime_recovery.sql'),'utf8');
 if(!baseline){sql(migration);sql(migration);}
 const th=thread(10),intent=id(11);admit(th,intent);
 check('future bound acquire reaches actual incumbent native authority',()=>assert.equal(acquire(th,intent).acquired,true));
 check('incumbent v2 function body and five-argument ABI unchanged',()=>assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.paige_chat_interactive_executor_v2(uuid,uuid,uuid,uuid,text)'::regprocedure`),oldBody));
 check('non-target Rail projection outputs/OID/ACL unchanged after two applications',()=>{
  assert.deepEqual(displayed(),displayBefore);assert.equal(sql(`SELECT oid::text||':'||coalesce(proacl::text,'NULL') FROM pg_proc WHERE oid='public._workspace_event_display(text,text,text)'::regprocedure`),displayIdentity);
 });
 check('binding is exact original admission + request nonce + isolate + deployment',()=>{
  const b=json(`SELECT interactive_runtime_binding FROM public.paige_chat_threads WHERE id=${q(th)}`);
  assert.equal(b.request_nonce,nonce);assert.equal(b.execution_id,worker);assert.equal(b.deployment_id,deployment);assert.equal(b.intent_id,intent);
  assert.equal(sql(`SELECT count(*) FROM public.paige_chat_turns WHERE id=${q(b.admission_turn_id)} AND interactive_runtime_binding=${q(JSON.stringify(b))}::jsonb`),'1');
 });
 check('same intent/new HTTP request cannot adopt or overwrite original claim',()=>{
  assert.equal(acquire(th,intent,id(84)).acquired,false);assert.equal(json(`SELECT interactive_runtime_binding FROM public.paige_chat_threads WHERE id=${q(th)}`).request_nonce,nonce);
 });
 rejects('wrong actor refused by incumbent scope',()=>sql(service(`SELECT public.paige_chat_interactive_acquire_bound(${q(th)},${q(foreign)},${q(tenant)},${q(intent)},${q(nonce)},${q(worker)},${q(deployment)})`)),/scope mismatch/);
 rejects('wrong tenant refused',()=>sql(service(`SELECT public.paige_chat_interactive_acquire_bound(${q(th)},${q(actor)},${q(foreign)},${q(intent)},${q(nonce)},${q(worker)},${q(deployment)})`)),/scope mismatch/);
 rejects('authenticated customer cannot mint binding',()=>sql(`SET ROLE authenticated;SELECT public.paige_chat_interactive_acquire_bound(${scope(th,intent)},${q(nonce)},${q(worker)},${q(deployment)})`),/permission denied/);
 rejects('raw service table write cannot forge binding',()=>sql(service(`UPDATE public.paige_chat_threads SET interactive_runtime_binding='{}' WHERE id=${q(th)}`)),/server-owned/);
 rejects('raw service table write cannot mint shutdown proof',()=>sql(service(`UPDATE public.paige_chat_turns SET interactive_runtime_shutdown='{"verified":true}' WHERE interactive_intent_id=${q(intent)}`)),/server-owned|immutable/);
 sql(`INSERT INTO public.paige_chat_turns(id,thread_id,role,content)VALUES(${q(id(88))},${q(th)},'user','Unprotected synthetic legacy row')`);
 rejects('new guard blocks proof UPDATE on a row outside the old interactive guard',()=>sql(service(`UPDATE public.paige_chat_turns SET interactive_runtime_shutdown='{"verified":true}' WHERE id=${q(id(88))}`)),/server-owned/);
 rejects('new guard blocks proof INSERT without any original protected fields',()=>sql(service(`INSERT INTO public.paige_chat_turns(thread_id,role,content,interactive_runtime_shutdown)VALUES(${q(th)},'user','Forgery','{"verified":true}')`)),/server-owned/);
 rejects('service cannot invoke operator attestation despite postgres session',()=>sql(service(`SELECT private.paige_chat_attest_runtime_shutdown(${scope(th,intent)},${q(nonce)},'{}')`)),/permission denied/);
 rejects('caller GUC cannot authorize attestation',()=>sql(`SET test.verified='true';SET ROLE service_role;SELECT private.paige_chat_attest_runtime_shutdown(${scope(th,intent)},${q(nonce)},'{}')`),/permission denied/);
 rejects('no proof means no recovery or release',()=>recover(th,intent),/verified original/);
 for(const [key,value] of [['source','browser'],['event_type','Log'],['reason','EarlyDrop'],['reason',null],['execution_id',foreign],['deployment_id',deployment+'1'],['project_ref','foreignproject0000000'],['function_id',foreign],['function_slug','other-function'],['event_id','not-an-event'],['packet_sha256','a']]){
  rejects(`operator packet refuses wrong ${key}:${String(value)}`,()=>attest(th,intent,{...proof(),[key]:value}),/evidence/);
 }
 rejects('shutdown before bound admission refused',()=>attest(th,intent,{...proof(),event_at:'2020-01-01T00:00:00Z'}),/window/);
 rejects('missing event time refused',()=>attest(th,intent,{...proof(),event_at:null}),/window/);
 rejects('wrong request nonce refused',()=>attest(th,intent,proof(),id(84)),/bound executor/);
 const packet=proof();attest(th,intent,packet);
 check('identical operator packet replay is non-mutating',()=>{const before=sql(`SELECT interactive_runtime_shutdown::text FROM public.paige_chat_turns WHERE interactive_intent_id=${q(intent)}`);attest(th,intent,packet);assert.equal(sql(`SELECT interactive_runtime_shutdown::text FROM public.paige_chat_turns WHERE interactive_intent_id=${q(intent)}`),before);});
 rejects('conflicting operator evidence refused',()=>attest(th,intent,{...packet,event_id:foreign}),/conflict/);
 const actualWriter=source(m('20270107000000_receipt_correlation_and_detail.sql'),'record_capability_run');
 sql(actualWriter.replace(/as \$\$[\s\S]*$/i,()=> 'as $$BEGIN RETURN;END$$;'));
 rejects('void recorder acknowledgement without a real Rail row cannot release',()=>recover(th,intent),/readback unavailable/);
 check('missing Rail readback rolls back terminal and executor changes',()=>{assert.equal(state(th,intent).executor,intent);assert.equal(state(th,intent).terminal,false);assert.equal(sql(`SELECT interactive_recovery_hold IS NULL FROM public.paige_chat_threads WHERE id=${q(th)}`),'t');});
 sql(actualWriter);
 sql(`UPDATE public.tenant_members SET status='inactive' WHERE user_id=${q(actor)}`);
 rejects('Rail membership failure rolls back terminal/release/hold',()=>recover(th,intent),/CAPABILITY_RUN_FORBIDDEN/);
 check('failed Rail leaves original held and no fabricated terminal',()=>{assert.equal(state(th,intent).executor,intent);assert.equal(state(th,intent).terminal,false);assert.equal(sql(`SELECT count(*) FROM public.paige_workspace_events`),'0');});
 sql(`UPDATE public.tenant_members SET status='active' WHERE user_id=${q(actor)}`);
 const next=id(12);admit(th,next,intent);
 const result=recover(th,intent);
 check('truthful native interrupted receipt + actual unknown Rail + exact release',()=>{assert.equal(result.state,'INTERRUPTED');assert.equal(result.outcome,'outcome_unknown');assert.equal(result.receipt_recorded,true);assert.equal(state(th,intent).executor,null);assert.equal(state(th,intent).latest,next);assert.equal(sql(`SELECT count(*) FROM public.paige_workspace_events WHERE source_id=${q(result.receipt_id)} AND outcome='capability_outcome_unknown'`),'1');});
 check('recovery replay reads original result without second receipt or successor change',()=>{const replay=recover(th,intent);assert.equal(replay.receipt_id,result.receipt_id);assert.equal(replay.replayed,true);assert.equal(sql(`SELECT count(*) FROM public.paige_workspace_events`),'1');assert.equal(state(th,intent).latest,next);});
 check('full operator packet replay after release remains a read of original immutable evidence',()=>{
  const before=sql(`SELECT interactive_runtime_shutdown::text FROM public.paige_chat_turns WHERE interactive_intent_id=${q(intent)} AND role='user'`);
  attest(th,intent,packet);assert.equal(sql(`SELECT interactive_runtime_shutdown::text FROM public.paige_chat_turns WHERE interactive_intent_id=${q(intent)} AND role='user'`),before);
 });
 rejects('old five-argument acquire cannot escape thread hold',()=>sql(service(`SELECT public.paige_chat_interactive_executor_v2(${scope(th,next)},'acquire')`)),/paige_chat_runtime_held_claim/);
 check('new bound request uses only read-only recovery lane',()=>{assert.equal(acquire(th,next,id(85)).acquired,true);assert.equal(json(`SELECT interactive_runtime_binding FROM public.paige_chat_threads WHERE id=${q(th)}`).mode,'read_only_recovery');});
 check('Stop preserves hold and original current executor',()=>{sql(`SET test.actor=${q(actor)};SET test.tenant=${q(tenant)};SET ROLE authenticated;SELECT public.paige_chat_interactive_begin_v2(${q(th)},NULL,${q(next)},'',false,true,true);RESET ROLE`);assert.equal(state(th,next).executor,next);assert.equal(sql(`SELECT interactive_recovery_hold::text FROM public.paige_chat_threads WHERE id=${q(th)}`),result.receipt_id);});
 const other=thread(20),oi=id(21);admit(other,oi);
 check('unrelated thread keeps existing ordinary five-argument behavior',()=>assert.equal(json(service(`SELECT public.paige_chat_interactive_executor_v2(${scope(other,oi)},'acquire')`)).acquired,true));
 rejects('unbound historical claim cannot be retroactively bound/recovered',()=>recover(other,oi),/verified original/);
 check('unbound acquisition retry cannot upgrade its original runtime',()=>assert.equal(acquire(other,oi).acquired,false));
 const customer=thread(30),ci=id(31);admit(customer,ci);sql(`UPDATE public.paige_chat_threads SET audience='customer_private' WHERE id=${q(customer)}`);
 rejects('new binding does not widen customer-private audience',()=>acquire(customer,ci),/workspace scope/);
 const fresh=thread(40),fi=id(41);admit(fresh,fi);
 rejects('missing runtime identity does not bind future admission',()=>sql(service(`SELECT public.paige_chat_interactive_acquire_bound(${scope(fresh,fi)},NULL,${q(worker)},${q(deployment)})`)),/runtime identity/);
 check('ordinary future provisioned scope remains compatible after missing bound identity',()=>assert.equal(json(service(`SELECT public.paige_chat_interactive_executor_v2(${scope(fresh,fi)},'acquire')`)).acquired,true));
 const completed=thread(60),done=id(61);admit(completed,done);acquire(completed,done,id(87));
 const donePayload=JSON.stringify({interactive:{request_intent_id:done},turn_state:{state:'FINAL'}});
 sql(service(`SELECT public.paige_chat_interactive_settle(${scope(completed,done)},'Original final receipt',NULL,NULL,${q(donePayload)}::jsonb,NULL)`));
 attest(completed,done,proof(),id(87));
 rejects('original protected terminal cannot be replaced with a recovery story',()=>recover(completed,done,id(87)),/receipt conflict/);
 check('terminal conflict keeps original immutable result and performs no release',()=>{assert.equal(state(completed,done).executor,done);assert.equal(sql(`SELECT content FROM public.paige_chat_turns WHERE thread_id=${q(completed)} AND role='assistant'`),'Original final receipt');});
 // A second actual connection enters the unchanged incumbent function while the
 // native recovery transaction owns its row. The committed CHECK still prevents
 // the old body's eventual UPDATE from acquiring the successor.
 const race=thread(50),ri=id(51),rn=id(52);admit(race,ri);acquire(race,ri,id(86));attest(race,ri,proof(),id(86));admit(race,rn,ri);
 const holder=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let holderError='';holder.stderr.on('data',b=>holderError+=b);
 const ended=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('close',c=>c===0?resolve():reject(Error(holderError)));});
 const locked=new Promise(resolve=>holder.stdout.on('data',b=>{if(String(b).includes('RECOVERY_HELD'))resolve();}));
 holder.stdin.end(`BEGIN;SET ROLE service_role;SELECT public.paige_chat_interactive_recover_bound(${scope(race,ri)},${q(id(86))});SELECT 'RECOVERY_HELD';SELECT pg_sleep(1.2);COMMIT;`);
 await Promise.race([locked,ended.then(()=>{throw Error('recovery holder ended before signal');})]);
 rejects('already-entered unchanged old native acquire cannot cross committed recovery fence',()=>sql(service(`SELECT public.paige_chat_interactive_executor_v2(${scope(race,rn)},'acquire')`)),/paige_chat_runtime_held_claim/);
 await ended;
 check('native concurrency preserves successor admission and unknown hold',()=>{assert.equal(state(race,rn).latest,rn);assert.equal(state(race,rn).executor,null);assert.equal(json(`SELECT public.paige_chat_interactive_runtime_context(${scope(race,rn)})`).recovery_read_only,true);});
 console.log(`PASS ${passed} native checks / 0 failed; no production/provider/customer operation`);
}finally{await db.close();}
