// Focused native authority races in the existing disposable CI Supabase stack.
// Existing accepted work only: no creation or worker wake branch or external effect.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {retireSyntheticTenantSQL} from './operator-postgres-fixture.mjs';

const url=new URL(process.env.CURA_PREPARATION_TEST_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.ok(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'
 &&['postgresql:','postgres:'].includes(url.protocol)&&url.hostname==='127.0.0.1'&&url.port==='54322'
 &&url.pathname==='/postgres'&&url.username==='postgres'&&url.password==='postgres'&&!url.search&&!url.hash,
 'Disposable CI loopback stack required');
const childEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')&&key!=='DATABASE_URL'));
const psql=process.env.PSQL_BIN||'psql',args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',url.toString()];
const run=sql=>execFileSync(psql,args,{input:sql,encoding:'utf8',windowsHide:true,timeout:20000,env:childEnv}).trim();
const fixture=readFileSync(new URL('../../supabase/tests/e09_cura_preparation_readback.sql',import.meta.url),'utf8');
const start=fixture.indexOf('INSERT INTO auth.users'),end=fixture.indexOf('CREATE FUNCTION pg_temp.as_user(');
assert.ok(start>0&&end>start&&fixture.includes('cura-preparation-reader-a'),'Original synthetic fixture required');
let seed=fixture.slice(start,end);
const contactStart=seed.indexOf('-- A real external-client relationship');
const contactEnd=seed.indexOf('UPDATE public.profiles',contactStart);
assert.ok(contactStart>0&&contactEnd>contactStart,'Bounded original contact fixture boundary required');
// Publisher races need no CRM client or contact-created event.
seed=seed.slice(0,contactStart)+seed.slice(contactEnd);
const operatorSeed=/INSERT INTO public\.user_roles\(user_id,role\) VALUES\('[^']+','super_admin'\);/g;
const operatorSeeds=[...seed.matchAll(operatorSeed)];
assert.equal(operatorSeeds.length,1,'Exactly one unneeded operator fixture must be omitted');
const operatorUser=/VALUES\('([^']+)'/.exec(operatorSeeds[0][0])?.[1];
assert.ok(operatorUser,'Original isolated operator identity required');
seed=seed.replace(operatorSeed,'');
let omittedWorkspace=0;
seed=seed.replace(/UPDATE public\.profiles SET active_tenant_id=[^;]+;/g,sql=>sql.replace(",'"+operatorUser+"'",()=>{omittedWorkspace++;return '';}));
assert.equal(omittedWorkspace,1,'Unneeded operator keeps no staff workspace assignment');
const u=s=>`e0c10100-0000-4000-8000-0000000000${s}`;
const t=s=>`e0c10200-0000-4000-8000-00000000000${s}`;
const actor=u('a1'),a=t('a'),b=t('b'),c=t('c'),intent='e0c10500-0000-4000-8000-000000000001';
const claim=`DO $$ BEGIN PERFORM set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true); END $$; SET LOCAL ROLE authenticated;`;
const observe=`SELECT public.read_cura_knowledge_preparation('${a}','${intent}','Program FAQ','Approved program details.')`;
const processes=new Set();
const session=(sql,name,{hold=false}={})=>{
 const child=spawn(psql,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:childEnv});processes.add(child);
 let out='',err='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 const done=new Promise((resolve,reject)=>{
  child.on('error',error=>{readyReject(error);reject(error);});
  child.stdout.on('data',data=>{out+=data; if(out.includes('CURA_LOCK_HELD'))readyResolve();});
  child.stderr.on('data',data=>{err+=data;});
  child.on('close',code=>{clearTimeout(timer);processes.delete(child);
   if(code){const error=new Error(`Isolated authority query failed: ${err}`);readyReject(error);reject(error);}
   else {readyResolve();resolve(out.trim());}
  });
 });
 done.catch(()=>{});ready.catch(()=>{});
 child.stdin.write(`BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='10s'; SET LOCAL application_name='${name}'; ${sql}\n`);
 if(hold)child.stdin.write("SELECT 'CURA_LOCK_HELD';\n");else child.stdin.end('ROLLBACK;\n');
 return {ready,done,release:()=>{if(!child.stdin.destroyed)child.stdin.end('ROLLBACK;\n');}};
};
const waitForLock=async name=>{
 for(let n=0;n<60;n++){
  if(run(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`)!=='0')return;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('Expected native lock wait was not observed');
};
const attempt=()=>JSON.parse(run(`BEGIN; ${claim} CREATE TEMP TABLE answer(v jsonb);
 DO $$ BEGIN INSERT INTO answer ${observe}; EXCEPTION WHEN OTHERS THEN INSERT INTO answer VALUES(jsonb_build_object('sqlstate',SQLSTATE)); END $$;
 SELECT v FROM answer; ROLLBACK;`).split(/\r?\n/).find(line=>line.startsWith('{')));
const base=()=>run(`BEGIN;
 UPDATE public.tenants SET parent_tenant_id=NULL WHERE id IN ('${a}','${b}');
 UPDATE public.tenant_members SET status='active',role='owner',is_owner=true WHERE user_id='${actor}' AND tenant_id IN ('${a}','${b}');
 DELETE FROM public.tenant_members WHERE user_id='${actor}' AND tenant_id='${c}'; COMMIT;`);
const inherited=()=>run(`BEGIN;
 UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='${actor}' AND tenant_id='${a}';
 UPDATE public.tenants SET parent_tenant_id='${b}' WHERE id='${a}'; COMMIT;`);
const count=()=>run(`SELECT count(*) FROM public.paige_durable_work WHERE tenant_id IN ('${a}','${b}','${c}')`);
let originalDefinition,seeded=false;
const platformAdminCount=()=>run("SELECT count(*) FROM public.user_roles WHERE role='super_admin'");
const originalAdminCount=platformAdminCount();
try{
 originalDefinition=run("SELECT pg_get_functiondef('public.read_cura_knowledge_preparation(uuid,uuid,text,text)'::regprocedure)");
 assert.equal(run(`SELECT (SELECT count(*) FROM public.tenants WHERE id IN ('${a}','${b}','${c}'))+(SELECT count(*) FROM auth.users WHERE id IN ('${u('a1')}','${u('a2')}','${u('a5')}','${u('b1')}','${u('f1')}'))`),'0','Fixture IDs must be absent before seeding');
 run(`BEGIN; ${seed}
  INSERT INTO public.tenants(id,slug,name,status,account_type) VALUES('${c}','test-tenant-cura-concurrency-c','Authority test C','active','standalone');
  SELECT transition.work_status FROM public.paige_durable_work work
  CROSS JOIN LATERAL public.transition_paige_durable_work(work.id,work.idempotency_key,'cancelled',
   '{"fixture_cancelled":true}'::jsonb,'Synthetic concurrency fixture: no worker dispatch') transition
  WHERE work.tenant_id IN ('${a}','${b}'); COMMIT;`);
 seeded=true;
 assert.equal(platformAdminCount(),originalAdminCount,'Authority races create no platform administrator');
 assert.equal(count(),'5','Only original synthetic accepted work is seeded');
 assert.equal(run(`SELECT count(*) FROM public.paige_durable_work WHERE tenant_id IN ('${a}','${b}') AND status='cancelled' AND jsonb_typeof(terminal_outcome)='object' AND settled_at IS NOT NULL`),'5','Canonical cancellation terminal fields verified');
 const cases=[
  {name:'direct-downgrade',setup:()=>{},revoke:`UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='${actor}' AND tenant_id='${a}'`},
  {name:'ancestor-downgrade',setup:inherited,revoke:`UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='${actor}' AND tenant_id='${b}'`},
  {name:'ancestor-delete',setup:inherited,revoke:`DELETE FROM public.tenant_members WHERE user_id='${actor}' AND tenant_id='${b}'`},
  {name:'ancestor-reparent',setup:()=>{inherited();run(`BEGIN; UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='${actor}' AND tenant_id='${b}';
   UPDATE public.tenants SET parent_tenant_id='${c}' WHERE id='${b}'; INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES('${c}','${actor}','owner','active',true,now()); COMMIT;`);},
   revoke:`UPDATE public.tenants SET parent_tenant_id=NULL WHERE id='${b}'`},
 ];
 for(const test of cases){
  base();test.setup();assert.equal(attempt().preparation_recorded,true,`${test.name}: incumbent publisher permitted`);
  const holder=session(`${claim} ${observe};`,'cura-holder',{hold:true});await holder.ready;
  const revoker=session(`${test.revoke};`,'cura-revoker');await waitForLock('cura-revoker');
  holder.release();await Promise.all([holder.done,revoker.done]);
  run(`BEGIN; ${test.revoke}; COMMIT;`);
  assert.equal(attempt().sqlstate,'42501',`${test.name}: committed revocation refused`);
  assert.equal(count(),'5',`${test.name}: no extra work`);
  // The deletion case is restored explicitly for the next original setup.
  if(test.name==='ancestor-delete')run(`INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES('${b}','${actor}','owner','active',true,now());`);
 }
 for(const weakened of [false,true]){
 if(weakened){
  const needle='publisher IS DISTINCT FROM true OR current_memberships IS DISTINCT FROM locked_memberships';
  assert.equal(originalDefinition.split(needle).length,2,'Exact isolated negative-control target required');
  run(originalDefinition.replace(needle,'publisher IS DISTINCT FROM true'));
 }
 // Force a new ancestor grant AFTER the member-lock query's snapshot while that
 // query waits on a different original ancestor row. No production instrumentation.
 base();inherited();run(`BEGIN;
  UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='${actor}' AND tenant_id='${b}';
  UPDATE public.tenants SET parent_tenant_id='${c}' WHERE id='${b}'; COMMIT;`);
 const blocker=session(`SELECT tenant_id FROM public.tenant_members WHERE user_id='${actor}' AND tenant_id='${b}' FOR UPDATE;`,'cura-blocker',{hold:true});await blocker.ready;
 const waiting=session(`${claim} CREATE TEMP TABLE answer(v jsonb);
  DO $$ BEGIN INSERT INTO answer ${observe}; EXCEPTION WHEN OTHERS THEN INSERT INTO answer VALUES(jsonb_build_object('sqlstate',SQLSTATE)); END $$; SELECT v FROM answer;`,'cura-late-grant');
 await waitForLock('cura-late-grant');
 run(`INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES('${c}','${actor}','owner','active',true,now());`);
 blocker.release();await blocker.done;
 const late=JSON.parse((await waiting.done).split(/\r?\n/).find(line=>line.startsWith('{')));
 if(weakened)assert.equal(late.preparation_recorded,true,'Native negative control reproduces unlocked-grant admission');
 else assert.equal(late.sqlstate,'42501','New unlocked grant cannot supply publisher authority');
 assert.equal(attempt().preparation_recorded,true,'A fresh request locks the now-committed grant');
 run(`DELETE FROM public.tenant_members WHERE user_id='${actor}' AND tenant_id='${c}'`);
 assert.equal(attempt().sqlstate,'42501','Grant then revoke before fresh admission is refused');
 assert.equal(count(),'5','Concurrent observations created no work or worker wake');
 run(originalDefinition);
 }
 console.log('PASS: native direct/ancestor revocation orderings, hierarchy lock waits, late grant snapshot refusal and native negative control, fresh grant and grant/revoke; original work only');
}finally{
 for(const child of processes)child.kill('SIGKILL');
 if(originalDefinition)run(originalDefinition);
 if(seeded){
 run(`BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s';
  DELETE FROM public.tenant_knowledge_docs WHERE tenant_id IN ('${a}','${b}','${c}');
  DELETE FROM public.paige_durable_work WHERE tenant_id IN ('${a}','${b}','${c}');
  DELETE FROM public.clients WHERE tenant_id IN ('${a}','${b}','${c}');
  DELETE FROM public.audit_logs WHERE user_id IN ('${u('a1')}','${u('a2')}','${u('a5')}','${u('b1')}','${u('f1')}');
  UPDATE public.tenants SET parent_tenant_id=NULL WHERE id IN ('${a}','${b}','${c}');
  DELETE FROM public.tenant_members WHERE tenant_id IN ('${a}','${b}','${c}');
  DELETE FROM public.profiles WHERE user_id IN ('${u('a1')}','${u('a2')}','${u('a5')}','${u('b1')}','${u('f1')}');
  ${retireSyntheticTenantSQL(a)} ${retireSyntheticTenantSQL(b)} ${retireSyntheticTenantSQL(c)}
  DELETE FROM public.user_roles WHERE user_id IN ('${u('a1')}','${u('a2')}','${u('a5')}','${u('b1')}','${u('f1')}');
  DELETE FROM auth.users WHERE id IN ('${u('a1')}','${u('a2')}','${u('a5')}','${u('b1')}','${u('f1')}'); COMMIT;`);
 assert.equal(run(`SELECT count(*) FROM public.tenants WHERE id IN ('${a}','${b}','${c}')`),'0','Synthetic fixture cleanup verified');
 assert.equal(platformAdminCount(),originalAdminCount,'Synthetic cleanup preserves platform roles');
 }
}
