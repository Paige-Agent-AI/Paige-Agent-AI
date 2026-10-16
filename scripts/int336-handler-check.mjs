import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {confirmFingerprint} from '../supabase/functions/_shared/confirm-fingerprint.ts';
import {crmApprovalSubject,canonicalizeCrmCommand,CRM_ACTION_CAPABILITY} from '../supabase/functions/_shared/crm-command/catalog.ts';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key'})[k]??''}};
globalThis.fetch=async()=>new Response('{}',{status:503});
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);
const req=(extras={})=>new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Newest context'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'},...extras})});
const scenario=(status,extra={})=>fake.setScenario({authUser:{id:actor},tables:{paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],...extra.tables},rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},check_rate_limit:{data:true,error:null},paige_chat_interactive_begin_v2:{data:{status,turn_id:status==='accepted'?id(5):null},error:null},...extra.rpcs}});
// INT-346: version 2 + active:false is NO LONGER a 503 for a typed message — it is the
// conversational degraded admission, proven end to end by int346-conversational-handler-check.
// This loop keeps only genuinely broken rollout metadata failing closed.
for(const protocol of [{data:null,error:{code:'PGRST202'}},{data:{version:1,active:true},error:null},{data:null,error:null}]){
 const denied=scenario('accepted',{rpcs:{paige_chat_interactive_protocol:protocol}});
 const response=await capturedHandler()(req());
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'INTERACTIVE_PROTOCOL_NOT_READY',message_accepted:false});
 assert.equal(denied.rpc.some(x=>/interactive_(begin|executor|settle)|turn_append/.test(x.name)),false,'mixed version must refuse before acceptance, acquisition or persistence');
 assert.equal(denied.from.some(x=>x.table==='paige_chat_turns'),false);
}
for(const status of ['duplicate','superseded','stopped']){
const rec=scenario(status);const res=await capturedHandler()(req({interactive:{kind:status==='stopped'?'stop':'message',supersedesIntentId:id(6)}}));
const json=await res.json();assert.equal(json.code,'INTERACTIVE_'+status.toUpperCase());assert.equal(json.message_accepted,status==='duplicate');assert.equal(rec.rpc.some(x=>x.name==='paige_chat_interactive_executor_v2'),false);
assert.equal(rec.rpc.find(x=>x.name==='paige_chat_interactive_begin_v2').client,'jwt');
}
const rec=scenario('accepted',{tables:{paige_chat_turns:[{role:'user',content:'Newest context',bundle_ref:{interactive:{request_intent_id:intent}}}]},rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},paige_chat_interactive_settle:{data:id(8),error:null},paige_chat_interactive_executor_v2:args=>({data:{latest:intent,executor:args.p_operation==='state'?null:intent,acquired:true},error:null})}});
const res=await capturedHandler()(req({clientId:id(7)})); await res.text();
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2'&&x.args.p_operation==='acquire').length,1);
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2'&&x.args.p_operation==='release').length,1);
assert.ok(rec.from.find(x=>x.table==='paige_chat_turns'));
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_turn_append'&&x.args.p_role==='user').length,0);
for(const proof of [null,{role:'assistant',bundle_ref:{interactive:{request_intent_id:intent},turn_state:{state:'INTERRUPTED'}}},{role:'system',bundle_ref:{interactive:{supersedes_intent_id:intent,stopped:true}}}]){
const statusRec=scenario('accepted',{tables:{paige_chat_turns:proof?[proof]:[]},rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},paige_chat_interactive_executor_v2:{data:{latest:null,executor:null,terminal:false,stopped:false},error:null}}});
const statusRes=await capturedHandler()(req({interactive:{kind:'status'}}));
assert.deepEqual(await statusRes.json(),{executor_active:false,settled:false});
assert.equal(statusRec.rpc.some(x=>x.name==='paige_chat_interactive_begin_v2'||x.name==='paige_chat_turn_append'),false);
assert.equal(statusRec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2').every(x=>x.args.p_operation==='state'),true);
}
for (const evidence of [{terminal:true,stopped:false},{terminal:false,stopped:true}]) {
 for (const executor of [null,intent]) {
 const statusRec=scenario('accepted',{rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},paige_chat_interactive_executor_v2:{data:{latest:null,executor,...evidence},error:null}}});
 const response=await capturedHandler()(req({interactive:{kind:'status'}}));
 assert.deepEqual(await response.json(),{executor_active:executor!==null,settled:executor===null});
 assert.equal(statusRec.from.some(c=>c.table==='paige_chat_turns'),false,'status must use canonical authority, not JSON');
 }
}
console.log('PASS real handler: stop/replay/status scope, canonical settlement, JWT begin, service executor, authoritative history, early-exit token release, no second user append');

// Original-operation observations are reads even while the execution protocol drains.
const effect=id(20),pipeline=id(21);
const original={tenantId:tenant,actorId:actor,actorKind:'human',idempotencyKey:'original-op',commandHash:'a'.repeat(32),command:{type:'update-pipeline',pipelineId:pipeline,expectedVersion:2,name:'Updated',description:null}};
const receipt={tenant_id:tenant,actor_user_id:actor,actor_kind:'human',idempotency_key:'original-op',command_hash:original.commandHash,result:{ok:true,outcome:'updated',pipeline_id:pipeline}};
for (const variant of ['success','foreign-tenant','foreign-actor','stale-version','missing-original','unavailable-read','revoked-permission','forged-effect']) {
 const statusRec=scenario('accepted',{tables:{pipeline_command_results:variant==='unavailable-read'?[]:[receipt]},rpcs:{
   paige_chat_interactive_protocol:{data:{version:2,active:false},error:null},
   current_user_tenant_id:{data:variant==='foreign-tenant'?id(99):tenant,error:null},
   read_pipeline_metadata_original:args=>({data:variant==='missing-original'||args._effect!==effect?null:{...original,actorId:variant==='foreign-actor'?id(99):actor},error:variant==='revoked-permission'?{message:'denied'}:null}),
   get_pipeline_catalogue:{data:{items:[{id:pipeline,version:variant==='stale-version'?4:3,name:'Updated',description:null}]},error:null},
   paige_chat_interactive_executor_v2:{data:{executor:intent,terminal:true},error:null},
 }});
 const response=await capturedHandler()(req({interactive:{kind:'status',pipelineEffectId:variant==='forged-effect'?id(99):effect}}));
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{executor_active:true,settled:false,original_operation:variant==='success'?{outcome:'confirmed_success',verified_readback:true,pipeline_id:pipeline,version:3}:{outcome:'outcome_unknown',verified_readback:false}});
 assert.equal(statusRec.inserts.length,0);
 assert.equal(statusRec.functions.length,0);
 assert.equal(statusRec.rpc.some(x=>/begin_v2|settle|turn_append/.test(x.name)),false);
 assert.equal(statusRec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2').every(x=>x.args.p_operation==='state'),true);
 assert.equal(statusRec.rpc.filter(x=>['read_pipeline_metadata_original','get_pipeline_catalogue','current_user_tenant_id'].includes(x.name)).every(x=>x.client==='jwt'),true);
}
console.log('PASS original-operation status: DRAINING readback, foreign tenant/actor, stale/missing evidence, no writes/providers/releases, caller-bound authority');

for (const valid of [true,false]) {
 const work=id(30),workIntent=id(31),artifact=id(32);
 const observation={workId:work,threadId:thread,intentId:intent,workIntentId:workIntent,tenantId:tenant,actorId:actor,state:'succeeded',version:3,recoveryState:'observed',approvalState:'unavailable',cancelled:false,artifactVerified:true,artifactRef:artifact};
 const statusRec=scenario('accepted',{rpcs:{
   paige_chat_interactive_protocol:{data:{version:2,active:false},error:null},
   current_user_tenant_id:{data:tenant,error:null},
   read_paige_durable_observation:{data:valid?observation:null,error:null},
   paige_chat_interactive_executor_v2:{data:{executor:intent,terminal:true},error:null},
 }});
 const response=await capturedHandler()(req({interactive:{kind:'status',workId:work}}));
 const body=await response.json();
 assert.equal(body.executor_active,true);assert.equal(body.settled,false);
 const {tenantId,actorId,...safe}=observation;
 assert.deepEqual(body.durable_work,valid?safe:null);
 assert.equal(statusRec.inserts.length,0);assert.equal(statusRec.functions.length,0);
 assert.equal(statusRec.rpc.some(x=>/begin_v2|settle|turn_append|transition|prepare|submit|claim/.test(x.name)),false);
 assert.equal(statusRec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2').every(x=>x.args.p_operation==='state'),true);
 assert.equal(statusRec.rpc.filter(x=>x.name==='read_paige_durable_observation').every(x=>x.client==='jwt'),true);
}
console.log('PASS durable observation status: caller-bound read during DRAINING, no consumption/activation/release');

// Normal typed status supplies no effect id: only protected canonical discovery may select it.
for(const variant of ['success','missing-terminal','ambiguous','foreign-tenant','changed-reference','revoked-final','forged-reference','stale-version','lost-receipt','superseded-after-catalogue','membership-revoked-after-catalogue']) {
 let discoveries=0,discoveryRevoked=false;
 const statusRec=scenario('accepted',{tables:{pipeline_command_results:variant==='lost-receipt'?[]:[receipt]},rpcs:{
  paige_chat_interactive_protocol:{data:{version:2,active:false},error:null},
  current_user_tenant_id:{data:variant==='foreign-tenant'?id(99):tenant,error:null},
  find_pipeline_metadata_original_effect:args=>{assert.deepEqual(args,{_thread:thread,_intent:intent});discoveries++;if(discoveryRevoked)return{data:null,error:null};return{data:['missing-terminal','ambiguous'].includes(variant)?null:variant==='forged-reference'?{effectId:effect,settled:true}:variant==='changed-reference'&&discoveries>1?id(99):effect,error:variant==='revoked-final'&&discoveries>1?{message:'denied'}:null};},
  read_pipeline_metadata_original:args=>({data:args._effect===effect?original:null,error:null}),
  get_pipeline_catalogue:()=>{if(['superseded-after-catalogue','membership-revoked-after-catalogue'].includes(variant))discoveryRevoked=true;return{data:{items:[{id:pipeline,version:variant==='stale-version'?4:3,name:'Updated',description:null}]},error:null};},
  paige_chat_interactive_executor_v2:{data:{executor:intent,terminal:true},error:null},
 }});
 const response=await capturedHandler()(req({interactive:{kind:'status'}}));const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.executor_active,true);assert.equal(body.settled,false);
 if(variant==='success')assert.deepEqual(body.original_operation,{outcome:'confirmed_success',verified_readback:true,pipeline_id:pipeline,version:3});
 else if(['stale-version','lost-receipt','superseded-after-catalogue','membership-revoked-after-catalogue'].includes(variant))assert.deepEqual(body.original_operation,{outcome:'outcome_unknown',verified_readback:false});
 else assert.equal(body.original_operation,undefined,'no authoritative original identity must not fabricate an observation');
 if(variant==='success')assert.equal(discoveries,4);
 assert.equal(statusRec.inserts.length,0);assert.equal(statusRec.functions.length,0);
 assert.equal(statusRec.rpc.some(x=>/begin_v2|settle|turn_append|transition|prepare|submit|claim/.test(x.name)),false);
 assert.equal(statusRec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2').every(x=>x.args.p_operation==='state'),true);
 assert.equal(statusRec.rpc.filter(x=>x.name==='find_pipeline_metadata_original_effect').every(x=>x.client==='jwt'),true);
}
console.log('PASS automatic original-operation observation: ordinary typed status, DRAINING, authoritative identity only, ambiguity/refusal/race unknown, no release or effect');

// Optional native context proof: reuse the existing canonical PostgreSQL fixture,
// then call the ACTUAL unchanged publication SQL from the actual HTTP status path.
// Other SDK proposal/record reads stay protected doubles; this is not hosted RLS/JWT proof.
let nativePublication=null,nativePublicationCalls=0;
if(process.env.APPROVAL_RECOVERY_DATABASE_URL){
 const database=process.env.APPROVAL_RECOVERY_DATABASE_URL,parsed=new URL(database);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&!parsed.password&&/^\/int336_test[a-z0-9_]*$/i.test(parsed.pathname),'credential-free empty loopback fixture required');
 const options={encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024};
 const built=spawnSync(process.execPath,['scripts/int336-publication-context-db-check.mjs'],{...options,env:{...process.env,INT336_DATABASE_URL:database}});
 assert.equal(built.status,0,built.stderr);console.log(built.stdout.trim());
 const sql=statement=>{const r=spawnSync(process.env.PSQL_BIN??'psql',['-X','-qAt','-v','ON_ERROR_STOP=1',database],{...options,input:statement});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const auth=who=>`reset role;set test.actor='${who}';set role authenticated;`;
 nativePublication=(variant,args)=>{
  assert.deepEqual(args,{p_thread:thread,p_intent:intent});
  sql(`reset role;delete from public.paige_chat_turns where thread_id='${thread}';delete from public.paige_chat_threads where id='${thread}';
   insert into public.tenants(id,account_type)values('${tenant}','standalone')on conflict(id)do nothing;
   insert into public.profiles values('${actor}','${tenant}')on conflict(user_id)do update set active_tenant_id=excluded.active_tenant_id;
   insert into public.tenant_members values('${tenant}','${actor}','active','owner',now())on conflict(tenant_id,user_id)do update set status='active',role='owner';
   insert into public.paige_chat_threads(id,caller_user_id,tenant_id)values('${thread}','${actor}','${tenant}');
   ${auth(actor)}select public.paige_chat_interactive_begin_v2('${thread}','${intent}',null,'Fixture pending instruction',false,false,true);
   ${variant==='publication-proof'?'':`reset role;set role service_role;
    select public.paige_chat_interactive_executor_v2('${thread}','${actor}','${tenant}','${intent}','acquire');
    select public.paige_chat_interactive_settle('${thread}','${actor}','${tenant}','${intent}','Fixture canonical terminal',null,null,'{"interactive":{"request_intent_id":"${intent}"},"turn_state":{"v":1,"state":"WAIT_APPROVAL"}}',null);
    ${variant==='publication-held'?'':`select public.paige_chat_interactive_executor_v2('${thread}','${actor}','${tenant}','${intent}','release');`}`}
   reset role;
   ${variant==='publication-scope'?`update public.profiles set active_tenant_id='00000000-0000-4000-8000-000000000013'where user_id='${actor}';`:''}
   ${variant==='publication-member'?`update public.tenant_members set status='removed'where tenant_id='${tenant}'and user_id='${actor}';`:''}
   ${variant==='publication-latest'?`${auth(actor)}select public.paige_chat_interactive_begin_v2('${thread}','00000000-0000-4000-8000-000000009999','${intent}','New fixture instruction',false,false,true);`:''}`);
  nativePublicationCalls++;
  return sql(`${auth(variant==='publication-actor'?'00000000-0000-4000-8000-000000009998':actor)}select public.paige_chat_interactive_publication_context_v2('${thread}','${intent}');`)==='t';
 };
}

// Reload authority comes only from a fresh server read of the immutable terminal
// AND its still-live native confirmation. No history JSON, settlement or retry.
const publicationRaces=[];
const reloadVariants=['available','admin-current','contact-current','contact-create','company-create','contact-ref-current','contact-ref-missing','contact-ref-changed-id','company-current','task-current','equivalent-version','missing-terminal','terminal-removed','json-only','wrong-actor','wrong-tenant','wrong-intent','closed-terminal','unknown-effect','superseded','executor-held','member-refused','role-member','foreign-thread','archived-thread','scope-changed','member-revoked','expired','consumed','consumed-after-read','foreign-pending','missing-issuance','newer-issuance','newer-issuance-microsecond','newer-creation-microsecond','wrong-tool','wrong-command','wrong-key','wrong-fingerprint','duplicate-card','duplicate-pending','changed-version','changed-microsecond','missing-contact-version','company-changed-version','task-changed-version','unsupported-preview','unsupported-activity','protocol-paused','contact-race-before-final','consume-race-after-receipt','publication-false','publication-member','publication-actor','publication-error','publication-null','publication-shape','publication-scope','publication-latest','publication-held','publication-proof','publication-expired','consumed-during-publication','version-during-publication'];
for(const variant of reloadVariants){
 const isRef=variant.startsWith('contact-ref-');
 const isContact=isRef||['contact-current','equivalent-version','changed-version','changed-microsecond','missing-contact-version','contact-race-before-final','version-during-publication'].includes(variant);
 const isCompany=variant.startsWith('company-'),isTask=variant.startsWith('task-');
 const revision='2026-10-16T12:00:00.123456Z';
 const command=variant==='contact-create'?{action:'contact.create',patch:{first_name:'Fixture',last_name:'Person'}}
  :variant==='company-create'?{action:'company.create',contact_id:id(74),patch:{name:'Fixture company'}}
  :isContact?{action:'contact.update',...(isRef?{client_ref:'CLT-FIXTURE'}:{contact_id:id(74)}),expected_updated_at:revision,patch:{title:'Fixture title'}}
  :isCompany?{action:'company.update',company_id:id(74),expected_updated_at:revision,patch:{name:'Fixture company'}}
  :isTask?{action:'task.update',task_id:id(74),expected_updated_at:revision,patch:{title:'Fixture revised work'}}
  :variant==='unsupported-activity'?{action:'activity.log',contact_id:id(74),patch:{body:'Fixture note'}}
  :variant==='unsupported-preview'?{action:'task.delete',task_id:id(74),expected_updated_at:'2026-10-16T12:00:00Z'}:{action:'task.create',patch:{title:'Fixture work'}};
 const tool=CRM_ACTION_CAPABILITY[command.action];
 const nativeCommand=canonicalizeCrmCommand(isRef?{...command,contact_id:id(74)}:command);
 const args={command:nativeCommand,idempotency_key:'fixture-original-key',approval_subject:await crmApprovalSubject(command.action,nativeCommand)};
 const fingerprint=await confirmFingerprint(tool,args),turnId=id(70);
 const card={tool,summary:'Review fixture work',fingerprint,command,idempotency_key:args.idempotency_key};
 const issued=new Date(Date.now()-4000).toISOString(),terminalAt=new Date(Date.now()-2000).toISOString().replace(/\.\d{3}Z$/,'.123456Z');
 const native={id:id(71),user_id:actor,tenant_id:tenant,thread_id:null,scoped_client_id:null,tool_name:tool,args,fingerprint,summary:card.summary,
  issued_in_request:id(72),server_issued_at:issued,created_at:issued,expires_at:new Date(Date.now()+300000).toISOString(),consumed_at:null};
 const terminal={id:turnId,thread_id:thread,role:'assistant',created_at:terminalAt,interactive_intent_id:intent,interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_terminal_state:'WAIT_APPROVAL',
  bundle_ref:{turn_state:{v:1,state:'WAIT_APPROVAL'},interactive:{request_intent_id:intent,effects:[{tool,outcome:'approval_required'}]},paige_confirm:[card]}};
 if(variant==='json-only')delete terminal.interactive_terminal_state;
 if(variant==='wrong-actor')terminal.interactive_actor_id=id(99);
 if(variant==='wrong-tenant')terminal.interactive_tenant_id=id(99);
 if(variant==='wrong-intent')terminal.interactive_intent_id=id(99);
 if(variant==='closed-terminal')terminal.interactive_terminal_state='FINAL';
 if(variant==='unknown-effect')terminal.bundle_ref.interactive.effects.push({tool:'plan_create',outcome:'outcome_unknown'});
 if(variant==='expired')native.expires_at=issued;
 if(variant==='consumed')native.consumed_at=issued;
 if(variant==='foreign-pending')native.tenant_id=id(99);
 if(variant==='missing-issuance')native.server_issued_at=null;
 if(variant==='newer-issuance')native.server_issued_at=new Date(Date.now()-1000).toISOString();
 if(variant==='newer-issuance-microsecond')native.server_issued_at=terminalAt.replace('123456','123457');
 if(variant==='newer-creation-microsecond')native.created_at=terminalAt.replace('123456','123457');
 if(variant==='wrong-tool')native.tool_name='crm_create_contact';
 if(variant==='wrong-command')native.args={...args,command:{...command,patch:{title:'Different work'}}};
 if(variant==='wrong-key')native.args={...args,idempotency_key:'another-key'};
 if(variant==='wrong-fingerprint')native.fingerprint='f'.repeat(16);
 if(variant==='duplicate-card')terminal.bundle_ref.paige_confirm.push(card);
 let switched=false,memberReads=0,terminalReads=0,pendingReads=0,publicationReads=0,publicationLastReadCount=0,versionChanged=false,consumed=false,lastPendingQuery=-1;
 const originalNow=Date.now,clock=Date.now();let syntheticNow=clock;
 const currentRevision=variant.includes('changed-version')?'2026-10-16T12:00:01.123456Z'
  :variant==='changed-microsecond'?'2026-10-16T12:00:00.123457Z':variant==='equivalent-version'?'2026-10-16T12:00:00.123456+00:00':revision;
 const recoveryRec=scenario('accepted',{tables:{
  profiles:()=>[{active_tenant_id:switched? id(99):tenant}],
  tenant_members:()=>{memberReads++;return variant==='member-refused'||variant==='member-revoked'&&memberReads>1?[]:[{tenant_id:tenant,user_id:actor,role:variant==='role-member'?'member':variant==='admin-current'?'admin':'owner',status:'active'}];},
  paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:variant==='foreign-thread'?id(99):actor,is_archived:variant==='archived-thread',interactive_latest_intent:variant==='superseded'?id(99):intent,interactive_executor_intent:variant==='executor-held'?intent:null}],
  paige_chat_turns:()=>{terminalReads++;if(terminalReads>1&&variant==='contact-race-before-final')versionChanged=true;if(terminalReads>1&&variant==='consume-race-after-receipt')consumed=true;return variant==='missing-terminal'||variant==='terminal-removed'&&terminalReads>1?[]:structuredClone([terminal]);},
  paige_pending_confirmations:()=>{const query=recoveryRec.from.length;if(query!==lastPendingQuery){pendingReads++;lastPendingQuery=query;}if(variant==='scope-changed')switched=true;return structuredClone(variant==='duplicate-pending'?[native,{...native,id:id(73)}]:consumed||variant==='consumed-after-read'&&pendingReads>1?[{...native,consumed_at:issued}]:[native]);},
  contacts:()=>[{id:id(74),tenant_id:tenant,updated_at:variant==='missing-contact-version'?null:versionChanged?'2026-10-16T12:00:01.123456Z':currentRevision,created_at:currentRevision}],
  clients:variant==='contact-ref-missing'?[]:[{id:variant==='contact-ref-changed-id'?id(75):id(74)}],
  businesses:[{id:id(74),tenant_id:tenant,updated_at:null,created_at:currentRevision}],
  tasks:[{id:id(74),tenant_id:tenant,updated_at:null,created_at:currentRevision}],
 },rpcs:{paige_chat_interactive_publication_context_v2:args=>{
  publicationReads++;publicationLastReadCount=recoveryRec.from.length;assert.deepEqual(args,{p_thread:thread,p_intent:intent});
  if(variant==='consumed-during-publication')consumed=true;
  if(variant==='version-during-publication')versionChanged=true;
  if(variant==='publication-expired')syntheticNow=clock+600000;
  const nativeValue=nativePublication&&['available','publication-member','publication-actor','publication-scope','publication-latest','publication-held','publication-proof','publication-expired','consumed-during-publication','version-during-publication'].includes(variant)?nativePublication(variant,args):null;
  return {data:nativeValue!==null?nativeValue:variant==='publication-null'?null:variant==='publication-shape'?{available:true}:['publication-false','publication-member','publication-actor','publication-scope','publication-latest','publication-held','publication-proof'].includes(variant)?false:true,error:variant==='publication-error'?{message:'fixture publication refusal'}:null};
 },paige_chat_interactive_protocol:{data:{version:2,active:variant!=='protocol-paused'},error:null},current_user_tenant_id:()=>({data:switched?id(99):tenant,error:null}),paige_chat_interactive_executor_v2:{data:{latest:intent,executor:variant==='executor-held'?intent:null,terminal:true,stopped:false},error:null}}});
 if(variant==='publication-expired')Date.now=()=>syntheticNow;
 let response;try{response=await capturedHandler()(req({interactive:{kind:'status',approvalTurnId:turnId}}));}finally{Date.now=originalNow;}
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const result=await response.json();const available=['available','admin-current','contact-current','contact-create','company-create','contact-ref-current','company-current','task-current','equivalent-version','consumed-during-publication','version-during-publication'].includes(variant);
 assert.equal(result.approval_recovery?.status,available?'available':'unavailable',`server recovery ${variant}: ${JSON.stringify(result)}`);
 if(available){assert.equal(publicationReads,1,'fresh native publication context is mandatory');assert.equal(result.approval_recovery.turn_id,turnId);assert.equal(result.approval_recovery.intent_id,intent);assert.equal(result.approval_recovery.tenant_id,tenant);assert.deepEqual(result.approval_recovery.confirmations,[card]);}
 else assert.equal(result.approval_recovery.confirmations,undefined,'refusal returns no executable proposal');
 if(['consumed-during-publication','version-during-publication'].includes(variant))publicationRaces.push({variant,card,args,native,command});
 if(publicationReads){assert.equal(recoveryRec.rpc.at(-1).name,'paige_chat_interactive_publication_context_v2','native context is the LAST awaited authority');assert.equal(recoveryRec.rpc.at(-1).client,'jwt');assert.equal(recoveryRec.from.length,publicationLastReadCount,'no query follows native publication context');}
 assert.equal(recoveryRec.inserts.length,0);assert.equal(recoveryRec.functions.length,0);
 assert.equal(recoveryRec.rpc.some(c=>/begin_v2|settle|turn_append|transition|prepare|submit|claim|execute_crm/.test(c.name)),false,'recovery never admits, settles or executes');
 assert.equal(recoveryRec.rpc.filter(c=>c.name==='paige_chat_interactive_executor_v2').every(c=>c.args.p_operation==='state'),true,'recovery never releases an executor');
}
console.log(`PASS actual read-only approval recovery: ${reloadVariants.length} positive/negative native-boundary variants; no provider, execution, admission, settlement or release`);


if(nativePublication){assert.equal(nativePublicationCalls,10);console.log('PASS actual status handler + actual native publication SQL:10 current/actor/member/workspace/latest/released/canonical-proof/expiry/read-projection controls; proposal/domain ports remain synthetic');}
// Publication is a read snapshot, never future execution authority. A consumed
// proposal remains refused by the ACTUAL native CRM door even if recovered just before.
await import('../supabase/functions/crm-command/index.ts');const crmHandler=capturedHandler();
for(const race of publicationRaces){
 let claimed=race.variant==='consumed-during-publication';
 for(let attempt=0;attempt<2;attempt++){
  const nativeRec=fake.setScenario({authUser:{id:actor},tables:{tenant_members:[{role:'owner',status:'active'}],tenants:[{account_type:'standalone',account_number:'101',parent_tenant_id:null}],paige_pending_confirmations:filters=>{
   if(filters.some(([op,columns])=>op==='select'&&columns==='args')){if(claimed)return[];claimed=true;return[{args:race.args}];}return[];
  }},rpcs:{current_user_tenant_id:{data:tenant,error:null},read_crm_command_result:{data:null,error:null},resolve_tool_autonomy:{data:'confirm',error:null},execute_crm_command:{data:null,error:{message:'CRM_VERSION_CONFLICT'}}}});
  const response=await crmHandler(new Request('https://test.supabase.co/functions/v1/crm-command',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({command:race.command,expected_tenant_id:tenant,idempotency_key:race.card.idempotency_key,approved_fingerprint:race.card.fingerprint})}));
  const body=await response.json();assert.notEqual(body.ok,true);assert.ok(response.status>=400);
  assert.equal(nativeRec.inserts.some(row=>row.table==='paige_pending_confirmations'&&!row.update),false,'no blind reproposal');
  assert.equal(nativeRec.rpc.filter(row=>row.name==='execute_crm_command').length,race.variant==='version-during-publication'&&attempt===0?1:0);
 }
}
console.log('PASS final-context race read projections: actual CRM door refuses consumed confirmations twice without execution/reproposal; version conflict is an explicit executor-port refusal, not a native CAS proof');
