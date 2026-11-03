// Actual original full-schema functions and caller claims, two PostgreSQL sessions.
// No remote database, substitute auth function, customer account or provider.
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {retireSyntheticTenantSQL} from './operator-postgres-fixture.mjs';

const db = new URL('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.equal(process.env.CI, 'true', 'Only the existing disposable full-schema CI stack');
const psql = process.env.PSQL_BIN || 'psql';
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db.toString()];
const run = sql => execFileSync(psql, args, {input:sql, encoding:'utf8', windowsHide:true, timeout:15000}).trim();
const actor=randomUUID(), tenant=randomUUID(), source=randomUUID(), step=randomUUID();
const suffix=randomUUID().slice(0,10), names=[];
const claims=JSON.stringify({sub:actor,role:'authenticated'});
const asActor=`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','${claims}',true);`;
const literal = value => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
let mission;
const create = (key, intent) => `public.create_business_mission('${key}','Synthetic source race','Review this synthetic draft',NULL,'Unknown','Review the source',
 '{}'::text[],'Reviewed draft','Draft only','{}'::text[],'{}'::text[],NULL,'owner_ui',NULL,true,${literal(intent)})`;
const revise = (key, intent) => `public.revise_business_mission_brief('${mission}',1,'${key}','Review this synthetic draft',NULL,'Unknown','Review the source',
 '{}'::text[],'Reviewed draft','Draft only','{}'::text[],'{}'::text[],'Synthetic source race',NULL,NULL,true,${literal(intent)})`;

function session(name) {
  names.push(name);
  const child=spawn(psql,args,{windowsHide:true,env:{...process.env,PGAPPNAME:name}});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
  return {child,done,output:()=>stdout};
}
async function until(predicate,label) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) { if(predicate())return; await new Promise(resolve=>setTimeout(resolve,50)); }
  throw Error(label);
}
async function revokedDuringSourceWait(kind,intent) {
  const blocker=session(`e13-${suffix}-${kind}-block`);
  const writer=session(`e13-${suffix}-${kind}-write`);
  const key=randomUUID();
  try {
    blocker.child.stdin.write(`BEGIN; SET LOCAL statement_timeout='12s';
      UPDATE public.tenant_members SET is_owner=false WHERE tenant_id='${tenant}' AND user_id='${actor}';
      SELECT 'E13_MEMBERSHIP_UPDATE_HELD';\n`);
    await until(()=>blocker.output().includes('E13_MEMBERSHIP_UPDATE_HELD'),'membership update was not acquired');
    writer.child.stdin.end(`BEGIN; SET LOCAL statement_timeout='12s'; ${asActor}
      SELECT ${kind==='create'?create(key,intent):revise(key,intent)}; COMMIT;`);
    // Observe a real backend lock dependency, never infer one from elapsed time.
    await until(()=>run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity b
      ON b.application_name='e13-${suffix}-${kind}-block'
      WHERE w.application_name='e13-${suffix}-${kind}-write' AND b.pid=ANY(pg_blocking_pids(w.pid)));`)==='t',
      'Mission writer did not wait on the original authority row');
    blocker.child.stdin.end('COMMIT;\n');
    const released=await blocker.done;assert.equal(released.code,0,'revoke committed');
    const result=await writer.done;
    assert.notEqual(result.code,0,`${kind} must refuse owner revocation after the source wait`);
    assert.match(result.stderr,/MISSION_OWNER_REQUIRED/,`${kind} rechecks original Mission authority`);
    assert.equal(run(`SELECT count(*) FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}' AND request_key='${key}';`),'0','refused effect has no committed receipt');
    assert.equal(run(`SELECT count(*) FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}';`),'1','no new immutable brief after revoked wait');
  } finally {
    if(!blocker.child.stdin.writableEnded)blocker.child.stdin.end('ROLLBACK;\n');
    if(!writer.child.stdin.writableEnded)writer.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([blocker.done,writer.done]);
    run(`UPDATE public.tenant_members SET is_owner=true WHERE tenant_id='${tenant}' AND user_id='${actor}';`);
  }
}

try {
  run(`INSERT INTO auth.users(id,aud,role,email) VALUES('${actor}','authenticated','authenticated','mission-source-race-${suffix}@tests.invalid');
    INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
    VALUES('${tenant}','mission-source-race-${suffix}','Synthetic Mission source race','active','standalone','MSR',${9500000+Math.floor(Math.random()*400000)},'{}','{}','${actor}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES('${tenant}','${actor}','owner','active',true,now());
    INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${actor}','${tenant}') ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
    INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state)
    VALUES('${source}','${tenant}','Synthetic source race','Draft only','${actor}','canonical');`);
  const reference=JSON.parse(run(`SELECT jsonb_build_object('contractVersion',1,'tenantId',tenant_id,'documentId',id,'revision',revision,
    'contentSha256',encode(sha256(convert_to(content,'UTF8')),'hex')) FROM public.tenant_knowledge_docs WHERE id='${source}';`));
  const intent={contractVersion:1,sources:[{reference,title:'Synthetic source race',excerpts:[{start:0,end:10,text:'Draft only'}]}],steps:[{
    id:step,title:'Review the draft',description:'Synthetic recommendation only',responsible:{kind:'unassigned'},dueOn:null,
    dependencies:[],sourceIds:[source],basis:'recommendation',proposedTask:{action:'task.create',assigneeUserId:null}}]};
  const result=run(`BEGIN;${asActor}SELECT ${create(randomUUID(),intent)};COMMIT;`).split('\n').find(line=>line.startsWith('{')&&line.includes('mission_id'));
  mission=JSON.parse(result).mission_id;
  await revokedDuringSourceWait('create',intent);
  await revokedDuringSourceWait('revise',intent);
  assert.equal(run(`SELECT count(*) FROM public.business_missions WHERE tenant_id='${tenant}';`),'1','only original initial plan remains');
  console.log('PASS: original Mission create/revise source-wait owner revocation; real blocking observed; no duplicate effects');
} finally {
  // Existing proof convention: clean ONLY these synthetic rows in a single TX.
  // Trigger is restored before commit; any cleanup error rolls back its change.
  for(const name of names)run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${name}' AND pid<>pg_backend_pid();`);
  run(`BEGIN;
    ALTER TABLE public.business_mission_brief_versions DISABLE TRIGGER business_mission_brief_immutable;
    DELETE FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}';
    DELETE FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}';
    DELETE FROM public.business_missions WHERE tenant_id='${tenant}';
    ALTER TABLE public.business_mission_brief_versions ENABLE TRIGGER business_mission_brief_immutable;
    DELETE FROM public.paige_audit_log WHERE tenant_id='${tenant}';
    DELETE FROM public.tenant_knowledge_docs WHERE tenant_id='${tenant}';
    DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
    DELETE FROM public.profiles WHERE user_id='${actor}';
    ${retireSyntheticTenantSQL(tenant)}
    DELETE FROM auth.users WHERE id='${actor}'; COMMIT;`);
}
