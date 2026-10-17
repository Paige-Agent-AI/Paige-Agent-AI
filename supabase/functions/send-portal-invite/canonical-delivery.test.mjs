// Actual HTTP handler + actual scope/policy helpers; controlled SDK/provider only.
// Native authorization/concurrency are separately exercised in PostgreSQL. No network.
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const ids={actor:'e0913400-0000-4000-8000-000000000001',tenant:'e0923400-0000-4000-8000-000000000001',
 contact:'e0933400-0000-4000-8000-000000000001',invite:'e0943400-0000-4000-8000-000000000001',
 operation:'e0953400-0000-4000-8000-000000000001',receipt:'e0963400-0000-4000-8000-000000000001',claim:'e0973400-0000-4000-8000-000000000001'};
const input={expected_tenant_id:ids.tenant,invitation_id:ids.invite,delivery_operation_id:ids.operation};
const code=file=>stripTypeScriptTypes(readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
function harness(config={}){
 const calls=[],effects=[],reads=[];let saved=config.saved??null,contextCalls=0,tokenReads=0,policyReads=0;
 const native=(outcome='pending')=>({actor_id:ids.actor,tenant_id:ids.tenant,found:true,operation_id:ids.operation,invitation_id:ids.invite,
  receipt_id:ids.receipt,requested_by:ids.actor,reconciled_by:ids.actor,outcome,provider_message_id:outcome==='provider_accepted'?'controlled-message':null,observed_at:'2026-10-17T12:00:00Z'});
 if(typeof saved==='string')saved=native(saved);
 const caller={auth:{getUser:async()=>({data:{user:config.noAuth?null:{id:ids.actor}},error:null})},rpc:async(name,args)=>{
  calls.push({side:'caller',name,args});
  if(name==='current_user_tenant_id')return {data:++contextCalls===(config.switchAt??-1)?ids.contact:ids.tenant,error:null};
  if(name==='read_client_portal_invitation_delivery')return {data:config.badRead?{...native(),token:'FORBIDDEN'}:saved??{actor_id:ids.actor,tenant_id:ids.tenant,operation_id:ids.operation,found:false},error:config.noOwner?{code:'42501'}:null};
  if(name==='prepare_client_portal_invitation')return {data:{actor_id:ids.actor,tenant_id:ids.tenant,contact_id:ids.contact,recipient:config.wrongRecipient?'other@tests.invalid':'customer@tests.invalid',proposal_hash:'a'.repeat(64)},error:null};
  if(name==='claim_client_portal_invitation_delivery'){
   if(config.claimError)return {data:null,error:{code:'40001'}};
   saved=saved??native();return {data:{...saved,disposition:config.disposition??'dispatch',...(['busy','held','recorded'].includes(config.disposition)?{}:{claim_id:ids.claim,provider_key:`customer-portal-delivery/v1/${ids.tenant}/${ids.operation}`})},error:null};
  }
  throw Error('unexpected caller RPC '+name);
 }};
 const admin={rpc:async(name,args)=>{
  calls.push({side:'service',name,args});
  if(name==='comms_provider_execution_allowed')return {data:config.floor!==false,error:config.floorError?{message:'unavailable'}:null};
  if(name==='resolve_tenant_brand')return {data:{tenant_name:'Test tenant',primary_color:'#150C31',logo_url:null},error:null};
  if(name==='tenant_sender_identity')return {data:{from_address:'no-reply@tests.invalid',from_name:'Test tenant',reply_to:'help@tests.invalid'},error:null};
  if(name==='finalize_client_portal_invitation_delivery'){
   if(config.finalizeError)return {data:null,error:{message:'storage unavailable'}};
   saved=native(config.disposition==='reconcile'&&['refused','failed'].includes(args.p_outcome)?'outcome_unknown':args.p_outcome);return {data:saved,error:null};
  }
  throw Error('unexpected service RPC '+name);
 },from(table){
  reads.push(table);const filters=[];
  const result=()=>{
   if(table==='tenant_invite_tokens')return {data:{id:ids.invite,tenant_id:ids.tenant,contact_id:ids.contact,email:'customer@tests.invalid',kind:'consumer',token:'PRIVATE_INVITATION_TOKEN',expires_at:'2099-01-01',revoked_at:config.revoked||++tokenReads===(config.revokeAt??-1)?'2026-10-17':null,uses:0,max_uses:1,last_used_at:null,portal_operation_id:config.unbound?null:ids.operation,portal_receipt_id:ids.receipt,portal_proposal_hash:'a'.repeat(64)},error:null};
   if(table==='clients'){
    const policy=filters.some(x=>x[0]==='select'&&x[1].startsWith('dnd_active'));
    if(policy)++policyReads;
    return {data:{id:ids.contact,tenant_id:ids.tenant,first_name:'Customer',dnd_active:config.dnd||policyReads===(config.dndAt??-1),dnd_until:null,timezone:'UTC'},error:null};
   }
   if(table==='paige_suppressions')return {data:config.suppressed?[{id:'suppressed',reason:'unsubscribed'}]:[],error:config.suppressionError?{message:'unavailable'}:null};
   if(table==='tenant_comms_preferences')return {data:config.quiet?{autosend_dnd_enabled:true,autosend_dnd_start:'00:00',autosend_dnd_end:'23:59',autosend_dnd_timezone:'UTC',autosend_dnd_channels:['email']}:null,error:null};
   throw Error('unexpected table '+table);
  };
  const query=new Proxy({}, {get(_,prop){if(prop==='then')return resolve=>resolve(result());if(prop==='maybeSingle')return async()=>result();return(...args)=>{filters.push([prop,...args]);return query}}});return query;
 }};
 const ctx=vm.createContext({Response,Request,Headers,URL,TextEncoder,TextDecoder,crypto:webcrypto,Date,AbortController,setTimeout,clearTimeout,
  console:{warn:()=>{},error:()=>{}},createClient:(_url,key)=>key==='controlled-anon'?caller:admin,
  Deno:{env:{get:name=>({SUPABASE_URL:'https://sdk.invalid',SUPABASE_ANON_KEY:'controlled-anon',SUPABASE_SERVICE_ROLE_KEY:'controlled-service',RESEND_API_KEY:'controlled-provider',PLATFORM_DEFAULT_EMAIL_FROM:'no-reply@tests.invalid',PUBLIC_SITE_URL:'https://portal.invalid'}[name])},serve:fn=>ctx.handler=fn},
  fetch:async(url,options)=>{effects.push({url,options});if(config.transport)throw Error('controlled transport failure');return new Response(JSON.stringify(config.providerBody??{id:'controlled-message'}),{status:config.providerStatus??200});}
 });
 vm.runInContext(code('../_shared/comms-provider-boundary.ts').replace(/\bexport /g,''),ctx);
 vm.runInContext(code('../_shared/pre-send-pipeline.ts').replace(/\bexport /g,''),ctx);
 vm.runInContext('globalThis.sendCanonicalPortalInvite=(()=>{'+code('./canonical-delivery.ts').replace(/\bexport /g,'')+';return sendCanonicalPortalInvite;})();',ctx);
 vm.runInContext(code('./index.ts'),ctx);
 vm.runInContext('globalThis.senderOptions={key:RESEND_KEY,site:PUBLIC_BASE,defaultFrom:EMAIL_FROM,senderFrom,copy:inviteCopy,html:inviteHtml};',ctx);
 return {calls,effects,reads,native,run:async(body=input,auth=true)=>{
  const req=new Request('https://handler.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer controlled-user'}:{})},body:JSON.stringify(body)});
  const res=await ctx.sendCanonicalPortalInvite(req,body,ctx.senderOptions,{contactId:ids.contact,recipient:'customer@tests.invalid',proposalHash:'a'.repeat(64)});
  return {status:res.status,body:await res.json()};
 }};
}
test('Actual internal sender uses canonical recipient, existing tenant template, same provider key and durable receipt',async()=>{
 const h=harness(),result=await h.run();assert.equal(result.status,200);assert.equal(result.body.outcome,'provider_accepted');assert.equal(result.body.delivery_confirmed,false);
 assert.equal(result.body.receipt_id,ids.receipt);assert.equal(h.effects.length,1);
 const effect=h.effects[0],payload=JSON.parse(effect.options.body);assert.equal(effect.url,'https://api.resend.com/emails');assert.deepEqual(payload.to,['customer@tests.invalid']);
 assert.equal(payload.from,'Test tenant <no-reply@tests.invalid>');assert.equal(payload.reply_to,'help@tests.invalid');assert.match(payload.html,/PRIVATE_INVITATION_TOKEN/);
 assert.equal(effect.options.headers['Idempotency-Key'],`customer-portal-delivery/v1/${ids.tenant}/${ids.operation}`);
 const claim=h.calls.find(x=>x.name==='claim_client_portal_invitation_delivery'),final=h.calls.find(x=>x.name==='finalize_client_portal_invitation_delivery');
 assert.match(claim.args.p_payload_digest,/^[0-9a-f]{64}$/);assert.equal(final.args.p_payload_digest,claim.args.p_payload_digest);
 for(const forbidden of ['PRIVATE_INVITATION_TOKEN','join_url','claim_id','provider_key','payload_digest'])assert(!JSON.stringify(result.body).includes(forbidden));
 assert.equal(h.calls.filter(x=>x.name==='read_client_portal_invitation_delivery').length,2);
});
for(const [label,config,auth]of [['no bearer',{},false],['no Auth',{noAuth:true}],['no owner',{noOwner:true}],['wrong workspace',{switchAt:1}],['forged native DTO',{badRead:true}],['protected floor',{floor:false}],['failed floor read',{floorError:true}],['revoked invitation',{revoked:true}],['unattested legacy invitation',{unbound:true}],['recipient changed',{wrongRecipient:true}],['client DND',{dnd:true}],['suppression',{suppressed:true}],['suppression read failure',{suppressionError:true}],['team quiet hours',{quiet:true}]])
 test('Actual handler refuses '+label+' before claim/egress',async()=>{const h=harness(config),r=await h.run(input,auth);assert.equal(r.body.ok,false);assert.equal(h.effects.length,0);assert(!h.calls.some(x=>x.name==='claim_client_portal_invitation_delivery'));if(['no bearer','no Auth','no owner','wrong workspace','forged native DTO'].includes(label))assert.equal(h.reads.length,0)});
for(const disposition of ['busy','held'])test(disposition+' never grants a second provider request',async()=>{const h=harness({disposition}),r=await h.run();assert.equal(r.body.ok,false);assert.equal(h.effects.length,0)});
for(const outcome of ['provider_accepted','failed','refused'])test('Known '+outcome+' is read back without provider/privileged data access',async()=>{const h=harness({saved:outcome}),r=await h.run();assert.equal(r.body.outcome,outcome);assert.equal(r.body.replayed,true);assert.equal(h.effects.length,0);assert.equal(h.reads.length,0)});
for(const config of [{switchAt:2},{revokeAt:2},{dndAt:2}])test('Changed pre-egress scope/policy never dispatches '+JSON.stringify(config),async()=>{const h=harness(config),r=await h.run();assert.equal(r.body.ok,false);assert.equal(h.effects.length,0);assert.equal(h.calls.find(x=>x.name==='finalize_client_portal_invitation_delivery').args.p_outcome,'refused')});
for(const config of [{transport:true},{providerStatus:503},{providerBody:{id:'bad/message'}},{providerBody:{unexpected:true}},{finalizeError:true}])test('Uncertain provider/storage result remains unknown '+JSON.stringify(config),async()=>{const h=harness(config),r=await h.run();assert.equal(r.body.ok,false);assert.equal(r.body.outcome,'outcome_unknown');assert.equal(h.effects.length,1)});
test('An uncertain claim is not retried or reported as failed',async()=>{const h=harness({claimError:true}),r=await h.run();assert.equal(r.body.outcome,'outcome_unknown');assert.equal(h.effects.length,0)});
test('Native recovery uses the same key and is explicitly effectful',async()=>{const h=harness({saved:'outcome_unknown',disposition:'reconcile'}),r=await h.run();assert.equal(r.body.replayed,true);assert.equal(h.effects.length,1);assert.equal(h.effects[0].options.headers['Idempotency-Key'],`customer-portal-delivery/v1/${ids.tenant}/${ids.operation}`)});
test('A revoked invitation stops recovery without declaring the original uncertain send refused',async()=>{const h=harness({saved:'outcome_unknown',disposition:'reconcile',revokeAt:2}),r=await h.run();assert.equal(r.body.outcome,'outcome_unknown');assert.equal(r.body.replayed,true);assert.equal(h.effects.length,0)});
test('A rejected provider recovery preserves original uncertainty',async()=>{const h=harness({saved:'outcome_unknown',disposition:'reconcile',providerStatus:400}),r=await h.run();assert.equal(r.body.outcome,'outcome_unknown');assert.equal(h.effects.length,1)});
for(const body of [{...input,email:'changed@tests.invalid'},{...input,approved:true},{...input,token:'FORBIDDEN'},{...input,invitation_id:'invalid'}])test('Request cannot override authority/recipient '+Object.keys(body).join(','),async()=>{const h=harness(),r=await h.run(body);assert.equal(r.status,400);assert.equal(h.calls.length,0);assert.equal(h.effects.length,0)});
