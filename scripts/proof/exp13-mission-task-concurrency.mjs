// Actual original full-schema Task writer. Existing disposable loopback CI only.
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {retireSyntheticTenantSQL} from './operator-postgres-fixture.mjs';
assert.equal(process.env.CI,'true','Only the existing disposable full-schema CI stack');
const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d','postgresql://postgres:postgres@127.0.0.1:54322/postgres'];
const bin=process.env.PSQL_BIN||'psql',run=sql=>execFileSync(bin,args,{input:sql,encoding:'utf8',windowsHide:true,timeout:15000}).trim();
const actor=randomUUID(),peer=randomUUID(),tenant=randomUUID(),source=randomUUID(),steps=[randomUUID(),randomUUID(),randomUUID()],suffix=randomUUID().slice(0,10),names=[];
const literal=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const service="SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);";
let mission,binding;
function command(index,schedule={dueAt:null,timeZone:null,reason:null}){return {approval_channel:'operator_card',action:'task.create',patch:{title:`Review synthetic step ${index+1}`,description:'Synthetic reviewed deliverable',assignee_user_id:actor,due_date:schedule.dueAt,
 metadata:{mission_source_v1:{...binding,stepId:steps[index],schedule}}}};}
const execute=(who,c,key)=>`public.execute_crm_command('${tenant}','${who}',${literal(c)},'${key}')`;
function session(name){names.push(name);const child=spawn(bin,args,{windowsHide:true,env:{...process.env,PGAPPNAME:name}});let stdout='',stderr='';
 child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});return {child,done,output:()=>stdout};}
async function until(fn,message){const until=Date.now()+10000;while(Date.now()<until){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);}
const blocked=(waiting,holding)=>run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.application_name='${holding}' WHERE w.application_name='${waiting}' AND h.pid=ANY(pg_blocking_pids(w.pid)));`)==='t';
async function race(firstSQL,secondSQL,label,expected){
 const one=session(`e13-task-${suffix}-${label}-one`),two=session(`e13-task-${suffix}-${label}-two`);
 try{
  one.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${firstSQL};SELECT 'E13_TASK_LOCK_HELD';\n`);
  await until(()=>one.output().includes('E13_TASK_LOCK_HELD'),'first original lock was not acquired');
  two.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='12s';${service}SELECT ${secondSQL};COMMIT;`);
  await until(()=>blocked(`e13-task-${suffix}-${label}-two`,`e13-task-${suffix}-${label}-one`),'actual original lock wait was not observed');
  one.child.stdin.end('COMMIT;\n');assert.equal((await one.done).code,0,'first transaction committed');
  const result=await two.done;assert.notEqual(result.code,0,'second effect refused');assert.match(result.stderr,expected);
 }finally{
  if(!one.child.stdin.writableEnded)one.child.stdin.end('ROLLBACK;\n');if(!two.child.stdin.writableEnded)two.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([one.done,two.done]);
 }
}
try{
 run(`INSERT INTO auth.users(id,aud,role,email) VALUES('${actor}','authenticated','authenticated','task-race-owner-${suffix}@tests.invalid'),('${peer}','authenticated','authenticated','task-race-peer-${suffix}@tests.invalid');
  INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id)
  VALUES('${tenant}','task-race-${suffix}','Synthetic Task race','active','standalone','TSR',${9500000+Math.floor(Math.random()*400000)},'{}','{}','${actor}');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES('${tenant}','${actor}','owner','active',true,now()),('${tenant}','${peer}','owner','active',true,now());
  INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${actor}','${tenant}'),('${peer}','${tenant}') ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
  INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state) VALUES('${source}','${tenant}','Synthetic Task race','Draft only','${actor}','canonical');`);
 const reference=JSON.parse(run(`SELECT jsonb_build_object('contractVersion',1,'tenantId',tenant_id,'documentId',id,'revision',revision,'contentSha256',encode(sha256(convert_to(content,'UTF8')),'hex')) FROM public.tenant_knowledge_docs WHERE id='${source}';`));
 const intent={contractVersion:1,sources:[{reference,title:'Synthetic Task race',excerpts:[{start:0,end:10,text:'Draft only'}]}],steps:steps.map((id,index)=>({id,title:`Review synthetic step ${index+1}`,description:'Synthetic reviewed deliverable',responsible:{kind:'person',userId:actor},dueOn:null,dependencies:[],sourceIds:[source],basis:'recommendation',proposedTask:{action:'task.create',assigneeUserId:actor}}))};
 const result=run(`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims',${literal({sub:actor,role:'authenticated'})}::text,true);
 SELECT public.create_business_mission('${randomUUID()}','Synthetic Task race','Verify original Tasks',NULL,'Unknown','Review source','{}'::text[],'Real receipts','Draft only','{}'::text[],'{}'::text[],NULL,'owner_ui',NULL,true,${literal(intent)});COMMIT;`).split('\n').find(s=>s.startsWith('{')&&s.includes('mission_id'));
 mission=JSON.parse(result).mission_id;
 run(`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims',${literal({sub:actor,role:'authenticated'})}::text,true);SELECT public.transition_business_mission('${mission}',1,'${randomUUID()}','active');COMMIT;`);
 binding={contractVersion:1,missionId:mission,missionRevision:2,briefVersion:1,intentSha256:run(`SELECT encode(sha256(convert_to(document_work_intent::text,'UTF8')),'hex') FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}' AND mission_id='${mission}' AND version=1;`)};
 const key=randomUUID();
 await race(`${service}SELECT ${execute(actor,command(0),key)}`,execute(peer,command(0),randomUUID()),'cross-actor',/CRM_MISSION_TASK_EXISTS/);
 assert.equal(run(`SELECT count(*) FROM public.tasks WHERE tenant_id='${tenant}';`),'1');
 assert.equal(run(`SELECT count(*) FROM public.crm_command_results WHERE tenant_id='${tenant}' AND action='task.create';`),'1');
 const inspected=JSON.parse(run(`BEGIN;${service}SELECT public.read_crm_command_result('${tenant}','${peer}',${literal({action:'task.inspect_mission_result',mission_id:mission,step_id:steps[0]})},'inspect-only');COMMIT;`).split('\n').find(s=>s.startsWith('{')&&s.includes('inspection')));
 assert.equal(inspected.status,'available');assert.equal(inspected.receipt.receipt_recorded,true);
 assert.equal(inspected.origin.stepId,steps[0]);assert.equal(inspected.origin.missionRevision,2);
 const schedule={dueAt:'2027-02-10T10:00:00.000Z',timeZone:'UTC',reason:'Explicit synthetic work appointment'};
 const scheduled=JSON.parse(run(`BEGIN;${service}SELECT ${execute(actor,command(1,schedule),randomUUID())};COMMIT;`).split('\n').find(s=>s.startsWith('{')&&s.includes('receipt_recorded')));
 assert.equal(Date.parse(scheduled.readback.due_date),Date.parse(schedule.dueAt));assert.deepEqual(scheduled.mission_source_v1.schedule,schedule);
 await race(`UPDATE public.tenant_knowledge_docs SET content='Changed source version',revision=revision+1 WHERE id='${source}'`,execute(actor,command(2),randomUUID()),'source-change',/CRM_MISSION_SOURCE_CHANGED/);
 assert.equal(run(`SELECT count(*) FROM public.tasks WHERE tenant_id='${tenant}';`),'2','changed source creates no third Task');
 assert.equal(run(`SELECT count(*) FROM public.crm_command_results WHERE tenant_id='${tenant}' AND action='task.create';`),'2','changed source creates no receipt');
 const recovered=JSON.parse(run(`BEGIN;${service}SELECT public.read_crm_command_result('${tenant}','${peer}',${literal({action:'task.inspect_mission_result',mission_id:mission,offset:0})},'inspect-existing-only');COMMIT;`).split('\n').find(s=>s.startsWith('{')&&s.includes('listing')));
 assert.equal(recovered.listing,true);assert.equal(recovered.records.length,2);assert.equal(recovered.has_more,false);assert.equal(recovered.next_offset,null);
 assert.deepEqual(new Set(recovered.records.map(r=>r.stepId)),new Set(steps.slice(0,2)));assert.equal(recovered.records.every(r=>r.status==='available'&&r.receipt.receipt_recorded&&!Object.hasOwn(r.task,'description')),true);
 assert.equal(run(`SELECT count(*) FROM public.tasks WHERE tenant_id='${tenant}';`),'2','read-only recovery creates no work');
 console.log('PASS: original cross-actor Task race, real tenant/source waits, one original effect, explicit schedule, read-only receipt recovery and stale-source refusal');
}finally{
 for(const name of names)run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${name}' AND pid<>pg_backend_pid();`);
 run(`BEGIN;
  DELETE FROM public.crm_command_results WHERE tenant_id='${tenant}';DELETE FROM public.tasks WHERE tenant_id='${tenant}';
  ALTER TABLE public.business_mission_brief_versions DISABLE TRIGGER business_mission_brief_immutable;
  DELETE FROM public.business_mission_mutation_receipts WHERE tenant_id='${tenant}';DELETE FROM public.business_mission_brief_versions WHERE tenant_id='${tenant}';DELETE FROM public.business_missions WHERE tenant_id='${tenant}';
  ALTER TABLE public.business_mission_brief_versions ENABLE TRIGGER business_mission_brief_immutable;
  DELETE FROM public.paige_audit_log WHERE tenant_id='${tenant}';DELETE FROM public.tenant_knowledge_docs WHERE tenant_id='${tenant}';DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
  DELETE FROM public.profiles WHERE user_id IN('${actor}','${peer}');${retireSyntheticTenantSQL(tenant)} DELETE FROM auth.users WHERE id IN('${actor}','${peer}');COMMIT;`);
}
