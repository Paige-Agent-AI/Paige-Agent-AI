// Read-only authenticated API acceptance, using the existing synthetic PROOF_* / LIVE_DRIVE_*
// credential-injection pattern. QA owns provisioning and the explicit fixture handoff.
// Never searches credentials, creates fixtures, dispatches work, settles or activates execution.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const BASE='https://xygzykjyynhzqytbqnzu.supabase.co';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const closed=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const role=key=>{try{return JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{return null;}};
const ensure=(ok,code)=>{if(!ok)throw Error(code);};
const outcomes=['confirmed_success','confirmed_failure','refused_before_dispatch','outcome_unknown'];

export async function runObservationProof(config,request=fetch){
 const f=config?.fixture;
 ensure(closed(f,['actorId','tenantId','cases'])&&uuid(f.actorId)&&uuid(f.tenantId)&&Array.isArray(f.cases)&&f.cases.length>0&&f.cases.length<=20,'FIXTURE_INVALID');
 for(const c of f.cases){
  ensure(closed(c,['name','threadId','intentId','pipelineEffectId','workId','expectOutcome','expectWorkState','expectArtifactVerified','expectExecutorHeld'])&&typeof c.name==='string'&&/^[a-z0-9_-]{1,60}$/i.test(c.name)&&uuid(c.threadId)&&uuid(c.intentId)&&typeof c.expectExecutorHeld==='boolean','CASE_INVALID');
  ensure(Boolean(c.pipelineEffectId)!==Boolean(c.workId),'ONE_OBSERVATION_REQUIRED');
  if(c.pipelineEffectId)ensure(uuid(c.pipelineEffectId)&&outcomes.includes(c.expectOutcome),'OUTCOME_CASE_INVALID');
  if(c.workId)ensure(uuid(c.workId)&&['unavailable','claimed','blocked','succeeded','failed','cancelled','expired','outcome_unknown'].includes(c.expectWorkState)&&typeof c.expectArtifactVerified==='boolean','WORK_CASE_INVALID');
 }
 ensure(typeof config.email==='string'&&config.email.length>0&&typeof config.password==='string'&&config.password.length>0,'QA_AUTH_NOT_CONFIGURED');
 ensure(typeof config.anonKey==='string'&&(config.anonKey.startsWith('sb_publishable_')||role(config.anonKey)==='anon'),'PUBLIC_KEY_REQUIRED');
 let token;const results=[];
 const call=async(path,method='GET',body,auth=true)=>{
  const r=await request(BASE+path,{method,headers:{apikey:config.anonKey,'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  ensure(r.ok,'AUTHENTICATED_READ_REFUSED');return r.status===204?null:r.json();
 };
 const scope=async()=>{
  const user=await call('/auth/v1/user');ensure(user?.id===f.actorId,'ACTOR_MISMATCH');
  const tenant=await call('/rest/v1/rpc/current_user_tenant_id','POST',{});ensure(tenant===f.tenantId,'TENANT_MISMATCH');
 };
 try{
  const session=await call('/auth/v1/token?grant_type=password','POST',{email:config.email,password:config.password},false);
  const candidateToken=session?.access_token;
  ensure(typeof candidateToken==='string'&&role(candidateToken)==='authenticated','CALLER_SESSION_REQUIRED');
  token=candidateToken;ensure(session.user?.id===f.actorId,'CALLER_SESSION_REQUIRED');
  await scope();
  for(const c of f.cases){
   for(let replay=0;replay<2;replay++){
    await scope();
    const interactive={kind:'status',...(c.pipelineEffectId?{pipelineEffectId:c.pipelineEffectId}:{workId:c.workId})};
    const observed=await call('/functions/v1/paige-ai-chat','POST',{threadId:c.threadId,requestIntentId:c.intentId,messages:[{role:'user',content:'Status'}],interactive});
    await scope();
    ensure(observed?.executor_active===c.expectExecutorHeld&&typeof observed.settled==='boolean'&&(!c.expectExecutorHeld||observed.settled===false),'EXECUTOR_OBSERVATION_MISMATCH');
    if(c.pipelineEffectId){const p=observed.original_operation;ensure(p?.outcome===c.expectOutcome&&p.verified_readback===(c.expectOutcome!=='outcome_unknown'),'OUTCOME_OBSERVATION_MISMATCH');}
    else if(c.expectWorkState==='unavailable')ensure(observed.durable_work===null,'WORK_MUST_BE_UNAVAILABLE');
    else {const w=observed.durable_work;ensure(w?.workId===c.workId&&w.threadId===c.threadId&&w.intentId===c.intentId&&w.state===c.expectWorkState&&w.artifactVerified===c.expectArtifactVerified&&w.approvalState==='unavailable'&&!('eligibleForExecution'in w),'WORK_OBSERVATION_MISMATCH');}
   }
   results.push({case:c.name,status:'PASS',replay:'read-only',observation:c.pipelineEffectId?c.expectOutcome:c.expectWorkState,verifiedEvidence:c.pipelineEffectId?c.expectOutcome!=='outcome_unknown':c.expectArtifactVerified});
  }
  return {status:'PASS',boundary:'authenticated-read-only-api',results,soloUi:'UNVERIFIED',continuation:'NOT_RUN',securityClearance:'UNVERIFIED'};
 }finally{if(typeof token==='string')await call('/auth/v1/logout?scope=local','POST',{});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const path=process.argv[2];
 if(!path){console.log(JSON.stringify({status:'BLOCKED',reason:'approved_QA_fixture_and_secure_auth_injection_required'}));process.exitCode=2;}
 else try{const fixture=JSON.parse(await readFile(path,'utf8'));const result=await runObservationProof({fixture,email:process.env.PROOF_EMAIL??process.env.LIVE_DRIVE_EMAIL,password:process.env.PROOF_PASSWORD??process.env.LIVE_DRIVE_PASSWORD,anonKey:process.env.PROOF_ANON_KEY});console.log(JSON.stringify(result));}
 catch{console.log(JSON.stringify({status:'FAIL',reason:'authenticated_observation_acceptance_failed'}));process.exitCode=1;}
}
