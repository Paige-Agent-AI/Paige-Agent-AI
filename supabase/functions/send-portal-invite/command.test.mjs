// Actual HTTP handler/module graph, including the real Kit/confirmation kernel and sender.
// Only Auth/database/provider boundaries are controlled. Native SQL is tested separately.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import * as nodeUtil from 'node:util';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const ids={actor:'e0913500-0000-4000-8000-000000000001',tenant:'e0923500-0000-4000-8000-000000000001',contact:'e0933500-0000-4000-8000-000000000001',operation:'e0943500-0000-4000-8000-000000000001',invite:'e0953500-0000-4000-8000-000000000001',receipt:'e0963500-0000-4000-8000-000000000001',claim:'e0973500-0000-4000-8000-000000000001'};
const input={expected_tenant_id:ids.tenant,contact_id:ids.contact,operation_id:ids.operation};
function harness(config={}){
 const effects=[],calls=[],writes=[],proposals=[];let handler,operation=null,delivery=null,contextCalls=0;
 const nativeDelivery=outcome=>({actor_id:ids.actor,tenant_id:ids.tenant,operation_id:operation?.operation_id??ids.operation,found:true,invitation_id:ids.invite,receipt_id:ids.receipt,
  requested_by:ids.actor,reconciled_by:ids.actor,outcome,provider_message_id:outcome==='provider_accepted'?'controlled-message':null,observed_at:new Date().toISOString()});
 const caller={auth:{getUser:async()=>({data:{user:config.noAuth?null:{id:ids.actor}},error:null})},rpc:async(name,args)=>{
  calls.push({side:'caller',name,args});
  if(name==='current_user_tenant_id')return {data:++contextCalls===(config.switchAt??-1)?ids.contact:ids.tenant,error:null};
  if(config.noOwner&&['read_client_portal_invitation_operation','prepare_client_portal_invitation','read_client_portal_invitation_delivery'].includes(name))return {data:null,error:{code:'42501'}};
  if(name==='read_client_portal_invitation_operation')return {data:operation&&args.p_operation_id===operation.operation_id?operation:{actor_id:ids.actor,tenant_id:ids.tenant,operation_id:args.p_operation_id,found:false},error:null};
  if(name==='prepare_client_portal_invitation')return {data:config.linked?null:{actor_id:ids.actor,tenant_id:ids.tenant,contact_id:ids.contact,recipient:config.recipient??'customer@tests.invalid',proposal_hash:(config.changed?'b':'a').repeat(64)},error:config.linked?{code:'42501'}:null};
  if(name==='resolve_tool_autonomy')return {data:config.lane??'confirm',error:config.laneError?{message:'unavailable'}:null};
  if(name==='create_client_portal_invitation'){
   const replayed=!!operation;
   operation=operation??{actor_id:ids.actor,tenant_id:ids.tenant,operation_id:args.p_operation_id,found:true,invitation_id:ids.invite,contact_id:ids.contact,recipient:'customer@tests.invalid',proposal_hash:'a'.repeat(64),receipt_id:ids.receipt,created_at:new Date().toISOString(),expires_at:'2099-01-01',state:'prepared'};
   if(config.createTimeout)throw Error('controlled lost acknowledgement');return {data:{...operation,replayed},error:null};
  }
  if(name==='read_client_portal_invitation_delivery')return {data:delivery&&delivery.operation_id===args.p_operation_id?delivery:{actor_id:ids.actor,tenant_id:ids.tenant,operation_id:args.p_operation_id,found:false},error:null};
  if(name==='claim_client_portal_invitation_delivery'){delivery=delivery??nativeDelivery('pending');return {data:{...delivery,disposition:'dispatch',claim_id:ids.claim,provider_key:`customer-portal-delivery/v1/${ids.tenant}/${args.p_operation_id}`},error:null}};
  throw Error('unexpected caller RPC '+name);
 }};
 function query(table){let kind=null,payload=null,singleResult=false;const filters=[];
  const answer=()=>{
   if(table==='paige_audit_log'){writes.push({table,kind,payload});return {data:null,error:config.auditError?{message:'unavailable'}:null}};
   if(table==='paige_pending_confirmations'){
    if(config.approvalStoreError)return {data:null,error:{message:'unavailable'}};
    if(kind==='insert'){
     writes.push({table,kind,payload});if(proposals.some(p=>p.fingerprint===payload.fingerprint&&!p.consumed_at))return {data:null,error:{code:'23505'}};
     const row={...payload,consumed_at:null};proposals.push(row);return {data:row,error:null};
    }
    const matches=proposals.filter(row=>filters.every(([method,key,value])=>{
     if(method==='eq'||method==='is')return row[key]===value;
     if(method==='in')return value.includes(row[key]);
     if(method==='not')return row[key]!==null&&row[key]!==undefined;
     if(method==='neq')return row[key]!==value;
     if(method==='gt')return row[key]>value;
     if(method==='lte')return row[key]<=value;
     if(method==='contains')return Object.entries(value).every(([k,v])=>row[key]?.[k]===v);
     return true;
    }));
    if(kind==='update')for(const row of matches){writes.push({table,kind,payload});Object.assign(row,payload)}
    return {data:singleResult?matches.at(-1)??null:matches,error:null};
   }
   if(table==='tenant_invite_tokens'){
    const row={id:ids.invite,tenant_id:ids.tenant,contact_id:ids.contact,email:'customer@tests.invalid',kind:'consumer',token:'PRIVATE_INVITATION_TOKEN',expires_at:'2099-01-01',revoked_at:null,uses:0,max_uses:1,last_used_at:null,created_by:ids.actor,portal_operation_id:operation?.operation_id??null,portal_receipt_id:ids.receipt,portal_proposal_hash:'a'.repeat(64)};
    return {data:singleResult?row:operation?[row]:[],error:null};
   }
   if(table==='clients')return {data:{id:ids.contact,tenant_id:ids.tenant,first_name:'Customer',dnd_active:config.dnd===true,dnd_until:null,timezone:'UTC'},error:null};
   if(table==='paige_suppressions')return {data:config.suppressed?[{id:'held',reason:'unsubscribed'}]:[],error:null};
   if(table==='tenant_comms_preferences')return {data:null,error:null};
   if(table==='email_send_log')return {data:delivery&&['pending','outcome_unknown'].includes(delivery.outcome)?[{id:ids.receipt,tenant_id:ids.tenant,idempotency_key:`customer-portal-delivery/v1/${ids.tenant}/${delivery.operation_id}`,metadata:{operation_id:delivery.operation_id,invite_id:ids.invite,contact_id:ids.contact}}]:[],error:null};
   throw Error('unexpected table '+table);
  };
  const q=new Proxy({}, {get(_,prop){if(prop==='then')return resolve=>resolve(answer());if(prop==='maybeSingle')return async()=>{singleResult=true;return answer()};return(...args)=>{if(['insert','update'].includes(prop)){kind=prop;payload=args[0]}else filters.push([prop,...args]);return q}}});return q;
 }
 const admin={from:query,rpc:async(name,args)=>{
  calls.push({side:'service',name,args});
  if(name==='comms_provider_execution_allowed')return {data:config.floor!==false,error:null};
  if(name==='resolve_tenant_brand')return {data:{tenant_name:'Test tenant',primary_color:'#150C31',logo_url:null},error:null};
  if(name==='tenant_sender_identity')return {data:{from_address:'no-reply@tests.invalid',from_name:'Test tenant'},error:null};
  if(name==='finalize_client_portal_invitation_delivery'){delivery=nativeDelivery(args.p_outcome);return {data:delivery,error:null}};
  if(name==='record_capability_run')return {data:true,error:config.railError?{message:'controlled refusal'}:null};
  throw Error('unexpected service RPC '+name);
 }};
 const context=vm.createContext({Response,Request,Headers,URL,TextEncoder,TextDecoder,Date,AbortController,setTimeout,clearTimeout,crypto:webcrypto,
  console:{error:()=>{},warn:()=>{}},Deno:{env:{get:name=>({SUPABASE_URL:'https://sdk.invalid',SUPABASE_ANON_KEY:'controlled-anon',SUPABASE_SERVICE_ROLE_KEY:'controlled-service',RESEND_API_KEY:'controlled-provider',PLATFORM_DEFAULT_EMAIL_FROM:'no-reply@tests.invalid',PUBLIC_SITE_URL:'https://portal.invalid'}[name])},serve:fn=>handler=fn},
  fetch:async(url,options)=>{effects.push({url,options});if(config.transport)throw Error('controlled failure');return new Response(JSON.stringify({id:'controlled-message'}),{status:200})}
 });
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);
  const javascript=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const require=specifier=>specifier==='node:util'?nodeUtil:specifier.startsWith('npm:@supabase/')?{createClient:(_url,key)=>key==='controlled-anon'?caller:admin}:specifier.startsWith('.')?load(path.resolve(path.dirname(file),specifier)):(()=>{throw Error('Unapproved test import '+specifier)})();
  vm.runInContext('(function(require,module,exports){'+javascript+'\n})',context,{filename:file})(require,mod,mod.exports);return mod.exports;
 }
 load(fileURLToPath(new URL('./index.ts',import.meta.url)));
 const run=async(body=input)=>{const res=await handler(new Request('https://handler.invalid',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer controlled-user'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()}};
 caller.functions={invoke:async(name,{body})=>{calls.push({side:'invoke',name,body});assert.equal(name,'send-portal-invite');const r=await run(body);return r.status<400?{data:r.body,error:null}:{data:null,error:{context:{json:async()=>r.body}}}}};
 const chat=load(fileURLToPath(new URL('../_shared/comms-email/chat.ts',import.meta.url)));
 return {config,effects,calls,writes,proposals,run,chat:async({approved=[],args={contact_id:ids.contact},turn=1}={})=>chat.dispatchCommsEmailChat({tenantId:ids.tenant,userId:ids.actor,toolName:'client_portal_invitation_send',args,approved:new Set(approved),sameToolCalls:1,
  turn:{thread_id:ids.claim,user_turn_ordinal:turn,user_turn:'Invite this customer'}},{caller,admin})};
}
test('Actual HTTP command proposes through the real high-risk kernel without minting or sending, then executes its stored call once',async()=>{
 const h=harness(),proposal=await h.run();assert.equal(proposal.status,202);assert.equal(proposal.body.outcome,'approval_required');assert.match(proposal.body.fingerprint,/^[0-9a-f]{16}$/);
 assert.equal(h.effects.length,0);assert(!h.calls.some(x=>x.name==='create_client_portal_invitation'));assert.equal(h.proposals.length,1);
 const sent=await h.run({...input,approved_fingerprint:proposal.body.fingerprint});assert.equal(sent.status,200);assert.equal(sent.body.outcome,'provider_accepted');assert.equal(sent.body.rail_recorded,true);
 assert.equal(h.effects.length,1);assert.equal(h.proposals[0].consumed_at!==null,true);assert(h.calls.some(x=>x.name==='record_capability_run'));
 const replay=await h.run({...input,approved_fingerprint:proposal.body.fingerprint});assert.equal(replay.body.replayed,true);assert.equal(h.effects.length,1);
 for(const field of ['PRIVATE_INVITATION_TOKEN','join_url','claim_id','provider_key','payload_digest','approved_fingerprint'])assert(!JSON.stringify(sent.body).includes(field));
});
for(const [label,config]of [['unavailable owner',{noOwner:true}],['missing Auth',{noAuth:true}],['protected floor',{floor:false}],['client DND',{dnd:true}],['suppressed recipient',{suppressed:true}],['disabled autonomy',{lane:'off'}],['unresolved autonomy',{laneError:true}],['decision receipt refused',{auditError:true}],['proposal store refused',{approvalStoreError:true}]])
 test('No effect or invitation creation for '+label,async()=>{const h=harness(config),r=await h.run();assert.notEqual(r.status,200);assert.equal(h.effects.length,0);assert(!h.calls.some(x=>x.name==='create_client_portal_invitation'))});
test('High risk stays confirmation-required even with auto autonomy',async()=>{const h=harness({lane:'auto'}),r=await h.run();assert.equal(r.body.outcome,'approval_required');assert.equal(h.effects.length,0)});
for(const mutation of [p=>p.user_id=ids.contact,p=>p.tenant_id=ids.contact,p=>p.tool_name='other_tool',p=>p.server_issued_at=null,p=>p.issued_in_request=null,p=>p.expires_at='2000-01-01',p=>p.consumed_at=new Date().toISOString()])
 test('Unclaimable scope/issuance/expiry/consumption cannot approve an invitation',async()=>{const h=harness(),p=await h.run();mutation(h.proposals[0]);const r=await h.run({...input,approved_fingerprint:p.body.fingerprint});assert.equal(r.body.ok,false);assert.equal(h.effects.length,0);assert(!h.calls.some(x=>x.name==='create_client_portal_invitation'))});
test('A changed recipient/version cannot use an earlier approval',async()=>{const h=harness(),p=await h.run();h.config.changed=true;h.config.recipient='changed@tests.invalid';const r=await h.run({...input,approved_fingerprint:p.body.fingerprint});assert.equal(r.body.ok,false);assert.equal(h.effects.length,0);assert(!h.calls.some(x=>x.name==='create_client_portal_invitation'))});
test('A lost native creation acknowledgement remains unknown and does not send',async()=>{const h=harness(),p=await h.run();h.config.createTimeout=true;const r=await h.run({...input,approved_fingerprint:p.body.fingerprint});assert.equal(r.body.outcome,'outcome_unknown');assert.equal(h.effects.length,0);assert.equal(h.calls.filter(x=>x.name==='create_client_portal_invitation').length,1)});
test('After customer activation, a returning owner still reads the known delivery receipt without re-inviting',async()=>{const h=harness(),p=await h.run();await h.run({...input,approved_fingerprint:p.body.fingerprint});h.config.linked=true;const r=await h.run();assert.equal(r.body.outcome,'provider_accepted');assert.equal(r.body.replayed,true);assert.equal(h.effects.length,1)});
test('Unknown delivery requires a fresh trusted confirmation cycle, not automatic recovery',async()=>{const h=harness({transport:true}),p=await h.run();const unknown=await h.run({...input,approved_fingerprint:p.body.fingerprint});assert.equal(unknown.body.outcome,'outcome_unknown');const again=await h.run();assert.equal(again.body.outcome,'approval_required');assert.notEqual(again.body.fingerprint,p.body.fingerprint);assert.equal(h.effects.length,1)});
test('Two simultaneous approvals cannot redeem the same stored proposal twice',async()=>{const h=harness(),p=await h.run();await Promise.all([h.run({...input,approved_fingerprint:p.body.fingerprint}),h.run({...input,approved_fingerprint:p.body.fingerprint})]);assert.equal(h.effects.length,1);assert.equal(h.calls.filter(x=>x.name==='create_client_portal_invitation').length,1)});
test('Consumed approval cannot automatically recover an unknown provider result',async()=>{const h=harness({transport:true}),p=await h.run();await h.run({...input,approved_fingerprint:p.body.fingerprint});const r=await h.run({...input,approved_fingerprint:p.body.fingerprint});assert.equal(r.body.ok,false);assert.equal(h.effects.length,1)});
test('An accepted native email with a missing Rail receipt is reported truthfully',async()=>{const h=harness({railError:true}),p=await h.run();const r=await h.run({...input,approved_fingerprint:p.body.fingerprint});assert.equal(r.body.outcome,'provider_accepted');assert.equal(r.body.rail_recorded,false);assert.equal(h.effects.length,1)});
test('A new turn or interface recovers the original unknown operation, never mints another token or provider key',async()=>{
 const h=harness({transport:true}),p=await h.run();await h.run({...input,approved_fingerprint:p.body.fingerprint});
 const again=await h.run({...input,operation_id:ids.contact});assert.equal(again.body.outcome,'approval_required');assert.equal(again.body.operation_id,ids.operation);
 assert.equal(h.calls.filter(x=>x.name==='create_client_portal_invitation').length,1);assert.equal(h.effects.length,1);
 h.config.transport=false;const finished=await h.run({...input,approved_fingerprint:again.body.fingerprint});assert.equal(finished.body.outcome,'provider_accepted');
 assert.equal(h.calls.filter(x=>x.name==='create_client_portal_invitation').length,1);assert.equal(h.effects.length,2);
 assert.equal(h.effects[0].options.headers['Idempotency-Key'],h.effects[1].options.headers['Idempotency-Key']);
});
test('Actual shared Chat dispatcher reaches the same HTTP confirmation, stored target, sender and receipt',async()=>{
 const h=harness(),p=await h.chat();assert.equal(p.content.needs_confirm,true);assert.equal(h.effects.length,0);assert.equal(h.proposals.length,1);
 const sent=await h.chat({approved:[p.content.confirm_fingerprint],args:{contact_id:ids.actor},turn:2});
 assert.equal(sent.content.success,true);assert.equal(sent.content.outcome,'provider_accepted');assert.equal(sent.content.delivery_confirmed,false);assert.equal(h.effects.length,1);
 const request=h.calls.filter(x=>x.side==='invoke').at(-1).body;assert.equal(request.contact_id,ids.contact);assert.equal(sent.spent,p.content.confirm_fingerprint);
 assert(!JSON.stringify(sent.content).includes('PRIVATE_INVITATION_TOKEN'));assert(!JSON.stringify(sent.content).includes('payload_digest'));
});
test('A later Chat turn reuses the original unknown operation through a fresh canonical card',async()=>{
 const h=harness({transport:true}),p=await h.chat();await h.chat({approved:[p.content.confirm_fingerprint],turn:2});const original=h.calls.find(x=>x.name==='create_client_portal_invitation').args.p_operation_id;
 const again=await h.chat({turn:3});assert.equal(again.content.needs_confirm,true);assert.notEqual(again.content.confirm_fingerprint,p.content.confirm_fingerprint);assert.equal(h.effects.length,1);
 assert.equal(h.proposals.at(-1).args.operation_id,original);assert.equal(h.calls.filter(x=>x.name==='create_client_portal_invitation').length,1);
});
test('After lost creation acknowledgement, a new browser operation resumes the original token before any email attempt',async()=>{
 const h=harness(),p=await h.run();h.config.createTimeout=true;await h.run({...input,approved_fingerprint:p.body.fingerprint});h.config.createTimeout=false;
 const recovered=await h.run({...input,operation_id:ids.contact});assert.equal(recovered.body.outcome,'approval_required');assert.equal(recovered.body.operation_id,ids.operation);
 const sent=await h.run({...input,approved_fingerprint:recovered.body.fingerprint});assert.equal(sent.body.outcome,'provider_accepted');
 assert.equal(h.calls.filter(x=>x.name==='create_client_portal_invitation').length,1);assert.equal(h.effects.length,1);
});
test('A model confirm flag never becomes an approval on the shared dispatcher',async()=>{
 const h=harness(),r=await h.chat({args:{contact_id:ids.contact,confirm:true}});assert.equal(r.content.needs_confirm,true);assert.equal(h.effects.length,0);
 assert(!('approved_fingerprint'in h.calls.find(x=>x.side==='invoke').body));
});
test('Customer/unauthorized role cannot mint or send through the shared dispatcher',async()=>{
 const h=harness({noOwner:true}),r=await h.chat();assert.equal(r.content.success,false);assert.equal(h.proposals.length,0);assert.equal(h.effects.length,0);assert(!h.calls.some(x=>x.name==='create_client_portal_invitation'));
});
for(const body of [{...input,confirm:true},{...input,approved:true},{...input,recipient:'override@tests.invalid'},{...input,approved_fingerprint:'forged'}])test('Model-authored approval/recipient input is refused',async()=>{const h=harness(),r=await h.run(body);assert.equal(r.status,400);assert.equal(h.effects.length,0);assert.equal(h.calls.length,0)});
