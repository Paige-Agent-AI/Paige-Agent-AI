import assert from 'node:assert/strict';
import {fixture,tenant,agreement,actor,client,signer,next,at,prepare,save} from '../_shared/agreements/test-fixtures/owner-preparation.ts';
import {executeOwnerPreparation} from '../_shared/agreements/owner-preparation.ts';
import {readPreparedSignatureReview} from '../_shared/agreements/prepared-signature-review.ts';
import {sha256Hex} from '../_shared/agreements/token.ts';
import {PREPARED_SIGNING_LINK_MARKER} from '../_shared/agreements/prepared-signature-review-contract.ts';

const origin='https://e04-prepared-command.invalid',connector='aaaaaaaa-1111-4000-8000-000000000001',operation='aaaaaaaa-1111-4000-8000-000000000002';
const confirmation='aaaaaaaa-1111-4000-8000-000000000003',work='aaaaaaaa-1111-4000-8000-000000000004',audit='aaaaaaaa-1111-4000-8000-000000000005';
const event='aaaaaaaa-1111-4000-8000-000000000006',message='aaaaaaaa-1111-4000-8000-000000000007';
type Obj=Record<string,unknown>;
type State={f:Awaited<ReturnType<typeof fixture>>;body:Obj;role:string;provider:boolean;lane:string;calls:string[];
 pending:Obj|null;workRow:Obj|null;credentials:Obj|null;outcome:Obj|null;child:Obj|null;providerOutcome:string;callbackOutcome:string;
 writes:{approval:number;claim:number;audit:number;work:number;credentials:number;message:number;provider:number;publication:number};
 auditFails:boolean;claimLost:boolean;retireAfterProvider:boolean;callbackLost:boolean};
let current:State;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const nativeError=(code='42501')=>json({code,message:'Controlled private cause'},403);
let handler:(req:Request)=>Promise<Response>=()=>Promise.resolve(json({},500));

async function transport(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 const req=new Request(input,init),url=new URL(req.url);assert.equal(url.origin,origin,'No live provider or external request');
 const s=current;s.calls.push(req.method+' '+url.pathname);
 if(url.pathname==='/auth/v1/user')return json({id:s.f.state.actor,is_anonymous:s.f.state.anonymous});
 if(url.pathname.startsWith('/storage/v1/object/')){
  const info=url.pathname.startsWith('/storage/v1/object/info/');
  const parts=url.pathname.replace(/^\/storage\/v1\/object\/(?:info\/|authenticated\/)?/,'').split('/');
  const bucket=parts.shift()!,path=decodeURIComponent(parts.join('/')),store=s.f.service.storage.from(bucket);
  if(info){const r=await store.info(path);return r.error?json(r.error,404):json(r.data);}
  const r=await store.download(path);return r.error||!r.data?json({error:'Not found'},404):new Response(await r.data.arrayBuffer(),{headers:{'Content-Type':'application/pdf'}});
 }
 if(url.pathname.startsWith('/rest/v1/rpc/')){
  const name=url.pathname.slice('/rest/v1/rpc/'.length),a=await req.json();
  if(['current_user_tenant_id','is_tenant_admin','read_paige_agreement_preparation'].includes(name))return json((await s.f.caller.rpc(name,a)).data);
  if(name==='_read_agreement_document_preparation')return json((await s.f.service.rpc(name,a)).data);
  if(name==='check_public_rate_limit')return json(true);
  if(name==='is_tenant_admin_as')return json(s.role==='owner'||s.role==='admin');
  if(name==='agency_can_manage_child')return json(false);
  if(name==='resolve_tool_autonomy')return json(s.lane);
  if(name==='comms_provider_execution_allowed')return json(s.provider);
  if(name==='tenant_sender_identity')return json({from_name:'Controlled Studio',from_address:'owner@studio.example.test',reply_to:null,tenant_name:'Controlled Studio'});
  if(name==='_read_prepared_agreement_request_status'){
   assert.deepEqual(a,{_actor:actor,_tenant:tenant,_operation:operation,_request_sha256:s.body.expected_request_sha256});return json(s.outcome);
  }
  if(name==='_read_prepared_agreement_confirmation')return json(s.pending?{state:'proposed',confirmation_id:confirmation,expires_at:new Date(Date.now()+600000).toISOString(),args:s.pending.args}:null);
  if(name==='_issue_prepared_agreement_confirmation'){
   s.writes.approval++;s.pending={args:a._args,fingerprint:a._fingerprint,issued:a._request_nonce,consumed:false};return json({expires_at:new Date(Date.now()+600000).toISOString()});
  }
  if(name==='_claim_prepared_agreement_confirmation'){
   s.writes.claim++;if(!s.pending||s.pending.consumed||s.pending.fingerprint!==a._fingerprint)return json(null);
   assert.notEqual(a._request_nonce,s.pending.issued);s.pending.consumed=true;
   if(s.claimLost)return nativeError('08006');return json({confirmation_id:confirmation,request_nonce:a._request_nonce,args:s.pending.args});
  }
  if(name==='_register_prepared_agreement_work'){
   assert(s.pending?.consumed);assert.equal(a._audit,audit);assert.equal(a._confirmation,confirmation);s.writes.work++;
   s.workRow={kind:'prepared_signature_work',execution:'unavailable',work_id:work,work_status:'claimed',operation_id:operation,request_sha256:s.body.expected_request_sha256,agreement_id:agreement,preparation_id:next};
   s.outcome={kind:'prepared_signature_request_result',state:'prepared',tenant_id:tenant,actor_id:actor,operation_id:operation,request_sha256:s.body.expected_request_sha256,agreement_id:agreement,work_id:work,receipt_id:null};return json(s.workRow);
  }
  if(name==='_read_prepared_agreement_work')return json(s.workRow);
  if(name==='_read_prepared_agreement_credentials')return json(s.credentials);
  if(name==='_issue_prepared_agreement_credentials'){
   assert(s.workRow);s.writes.credentials++;assert.equal(a._credentials.length,1);
   const approved=(s.pending!.args as Obj).request as Obj,doc=approved.document as Obj;
   s.credentials={kind:'prepared_agreement_credentials',state:'recorded',tenant_id:tenant,actor_id:actor,operation_id:operation,agreement_id:agreement,preparation_id:next,
    request_sha256:s.body.expected_request_sha256,preparation_sha256:approved.preparationSha256,document_sha256:doc.sha256,work_id:work,event_id:event,
    credentials:a._credentials.map((v:Obj)=>({...v,expires_at:new Date(Date.now()+14*86400000).toISOString()}))};
   // The real C44 issuance freezes the original source. C50's proved native
   // reader then returns uncertainty rather than the unissued prepared state.
   s.outcome={...s.outcome,state:'outcome_unknown'};return json(s.credentials);
  }
  if(name==='prepare_comms_email_send'){
   assert(s.credentials);assert.equal(a._actor_user_id,actor);assert.equal(a._expected_tenant_id,tenant);assert.equal(a._governance.purpose,'agreement_signature_request');
   assert.equal(a._governance.approval_channel,'chat-canonical');assert.equal(a._governance.signer_id,signer);assert.equal(a._governance.agreement_operation_id,operation);
   assert(!JSON.stringify(a).includes('/sign/'),'Native message retains only the reviewed link marker');s.writes.message++;s.child={...a,message_id:message,outcome:'prepared'};
   return json({ok:true,state:'prepared',message_id:message,replayed:false});
  }
  if(name==='read_comms_email_send_result')return json({outcome:s.child?.outcome??'unknown',provider_receipt_available:s.child?.outcome==='provider_accepted'});
  if(name==='_publish_prepared_agreement_request'){
   if(s.child?.outcome!=='provider_accepted')return nativeError('23514');s.writes.publication++;s.outcome={...s.outcome,state:'provider_accepted',receipt_id:event};
   return json({state:'recorded',receipt_id:event});
  }
  throw Error('Unexpected original RPC '+name);
 }
 if(url.pathname==='/functions/v1/send-message'){
  assert.equal(req.headers.get('authorization'),'Bearer synthetic-service');assert(s.credentials&&s.child);
  const b=await req.json();assert.equal(b.message_id,message);assert.equal(b.comms_email_operation_id,s.child._operation_id);
  assert.equal(await sha256Hex(b.agreement_signature_token),(s.credentials.credentials as Obj[])[0].token_hash);
  s.writes.provider++;s.child.outcome=s.providerOutcome;
  if(s.retireAfterProvider)s.f.state.activeTenant=work;
  if(s.callbackLost)throw Error('Controlled lost response after original provider facts');
  return json({ok:true,outcome:s.callbackOutcome});
 }
 if(url.pathname.startsWith('/rest/v1/')){
  const table=url.pathname.slice('/rest/v1/'.length);
  if(table==='paige_audit_log'&&req.method==='POST'){
   const a=await req.json();s.writes.audit++;assert.equal(a.action,'sales.agreement_signature_request_governed_decision');assert.equal(a.tenant_id,tenant);assert.equal(a.actor_user_id,actor);
   assert.equal(a.payload.operation_id,operation);assert.equal(a.payload.request_sha256,s.body.expected_request_sha256);return s.auditFails?nativeError():json({id:audit});
  }
  const row=table==='tenants'?{name:'Controlled Studio',account_type:'solo',parent_tenant_id:null}:
   table==='tenant_members'?{role:s.role,status:'active'}:table==='channel_connectors'?{id:connector,tenant_id:tenant,provider:'sendgrid',channel_type:'email',active:true,status:'active',from_address:'owner@studio.example.test',from_name:'Controlled Studio',reply_to:null,mailbox_class:'shared_support',mailbox_owner_user_id:null,config:{}}:
   table==='tenant_email_domains'?{tenant_id:tenant,domain:'studio.example.test',sendgrid_status:'verified',sendgrid_domain_id:'controlled-domain',sendgrid_verified_at:at}:
   table==='clients'?{dnd_active:false,dnd_until:null,dnd_reason:null,timezone:'UTC'}:
   table==='tenant_comms_preferences'?{autosend_dnd_enabled:false,autosend_dnd_channels:[]}:
   table==='paige_agreements'?{document_path:null}:null;
  if(['user_roles','paige_suppressions'].includes(table))return json([]);
  assert(row,'Unexpected original table '+table);return json(req.headers.get('accept')?.includes('object+json')?row:[row]);
 }
 throw Error('Unexpected original HTTP request '+req.method+' '+url.pathname);
}

async function arrange(){
 const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);await executeOwnerPreparation(save(),f.caller,f.service);
 current={f,body:{},role:'owner',provider:true,lane:'confirm',calls:[],pending:null,workRow:null,credentials:null,outcome:null,child:null,
  providerOutcome:'provider_accepted',callbackOutcome:'provider_accepted',writes:{approval:0,claim:0,audit:0,work:0,credentials:0,message:0,provider:0,publication:0},auditFails:false,claimLost:false,retireAfterProvider:false,callbackLost:false};
 const review={tenant_id:tenant,agreement_id:agreement,preparation_id:next,preparation_sha256:String(f.rows.get(next)!.preparation_sha256),expected_source:{client_id:client,version:1,updated_at:at}};
 const saved=await readPreparedSignatureReview(review,f.caller,f.service,actor);
 const initial={operation_id:operation,review,expected_review_sha256:saved.review_sha256,connector_id:connector,
  messages:[{signer_id:signer,subject:'Please review your engagement',body_text:'Review the exact document before signing.\n'+PREPARED_SIGNING_LINK_MARKER}]};
 const response=await handler(new Request(origin+'/agreement-send?review=prepared-request',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json'},body:JSON.stringify(initial)}));
 assert.equal(response.status,200,'The original actual-SDK private review is the positive control');
 const checked=(await response.json()).review;
 current.body={...initial,expected_request_sha256:checked.request_sha256};current.calls=[];return current;
}

Deno.test('original owner prepared command uses concrete governed execution',async t=>{
 const old={serve:Deno.serve,env:Deno.env.get,fetch:globalThis.fetch};
 try{
  Deno.serve=((fn:typeof handler)=>{handler=fn;return {} as never;}) as unknown as typeof Deno.serve;
  Deno.env.get=name=>({SUPABASE_URL:origin,SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SENDGRID_MAIL_SEND_API_KEY:'synthetic-configured'} as Record<string,string>)[name];
  globalThis.fetch=transport;await import('./index.ts?original-prepared-command-proof');
  const invoke=(extra:Obj={},query='?command=prepared-request')=>handler(new Request(origin+'/agreement-send'+query,{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json'},body:JSON.stringify({...current.body,...extra})}));
  await t.step('exact original request proposes HIGH approval without Work, credentials or sending',async()=>{
   const s=await arrange(),r=await invoke(),v=await r.json();assert.equal(r.status,200);assert.equal(v.result.state,'approval_required');assert.equal(v.result.request_sha256,s.body.expected_request_sha256);
   assert.equal(r.headers.get('Cache-Control'),'no-store, private');assert.equal(r.headers.get('Vary'),'Authorization');assert.equal(s.writes.approval,1);assert.equal(s.writes.work+s.writes.credentials+s.writes.message+s.writes.provider,0);
  });
  await t.step('only the original consumed confirmation can reach canonical Work and provider truth',async()=>{
   const s=await arrange(),proposal=await(await invoke()).json();const r=await invoke({approved_fingerprint:proposal.result.fingerprint}),v=await r.json();
   assert.equal(v.result.state,'provider_accepted');assert.equal(v.result.receipt_id,event);assert.deepEqual({...s.writes,audit:0},{approval:1,claim:1,audit:0,work:1,credentials:1,message:1,provider:1,publication:1});
   const snapshot={...s.writes};assert.deepEqual((await(await invoke({approved_fingerprint:proposal.result.fingerprint})).json()).result,v.result);assert.deepEqual(s.writes,snapshot);
   assert(!JSON.stringify(v).includes('token_hash'));assert(!JSON.stringify(v).includes('synthetic-service'));
  });
  await t.step('provider callback success cannot replace original uncertain native facts',async()=>{
   const s=await arrange();s.providerOutcome='unknown';const proposal=await(await invoke()).json(),v=await(await invoke({approved_fingerprint:proposal.result.fingerprint})).json();
   assert.equal(v.result.state,'outcome_unknown');assert.equal(v.result.receipt_id,null);assert.equal(s.writes.provider,1);const counts={...s.writes};await invoke({approved_fingerprint:proposal.result.fingerprint});assert.deepEqual(s.writes,counts);
  });
  await t.step('lost response after genuine provider facts is reconciled without another send',async()=>{
   const s=await arrange(),proposal=await(await invoke()).json();s.callbackLost=true;
   const v=await(await invoke({approved_fingerprint:proposal.result.fingerprint})).json();assert.equal(v.result.state,'provider_accepted');assert.equal(v.result.receipt_id,event);assert.equal(s.writes.provider,1);
  });
  await t.step('changed original source cannot consume the older approval',async()=>{
   const s=await arrange(),proposal=await(await invoke()).json();s.f.original.version++;
   const v=await(await invoke({approved_fingerprint:proposal.result.fingerprint})).json();assert.equal(v.result.state,'refused');assert.equal(s.writes.claim+s.writes.work+s.writes.provider,0);assert.equal(s.writes.approval,1);
  });
  await t.step('retired business after an attempted provider effect withholds private results',async()=>{
   const s=await arrange(),proposal=await(await invoke()).json();s.retireAfterProvider=true;
   const v=await(await invoke({approved_fingerprint:proposal.result.fingerprint})).json();assert.equal(v.result.state,'outcome_unknown');assert(!Object.hasOwn(v.result,'receipt_id'));assert(!Object.hasOwn(v.result,'tenant_id'));
   assert.equal(s.writes.provider,1);assert.equal(s.writes.publication,0);
  });
  await t.step('provider hold, member, anonymous and foreign-business contexts never obtain approval or effect',async()=>{
   for(const variant of ['provider','member','anonymous','foreign']){const s=await arrange();if(variant==='provider')s.provider=false;if(variant==='member')s.role='member';if(variant==='anonymous')s.f.state.anonymous=true;if(variant==='foreign')s.f.state.activeTenant=work;
    const v=await(await invoke()).json();assert(v.ok===false||v.result?.state==='refused');assert.equal(s.writes.approval+s.writes.work+s.writes.credentials+s.writes.provider,0);}
  });
  await t.step('failed decision audit and lost claim acknowledgement cannot execute or renew approval',async()=>{
   let s=await arrange();s.auditFails=true;assert.equal((await(await invoke()).json()).result.state,'refused');assert.equal(s.writes.approval+s.writes.work+s.writes.provider,0);
   s=await arrange();const proposal=await(await invoke()).json();s.claimLost=true;const v=await(await invoke({approved_fingerprint:proposal.result.fingerprint})).json();assert.equal(v.result.state,'outcome_unknown');assert.equal(s.writes.work+s.writes.provider,0);assert.equal(s.writes.approval,1);
  });
  await t.step('query and body governance cannot fall through into legacy sending',async()=>{
   const s=await arrange();for(const query of ['?command=prepared-request&command=prepared-request','?command=prepared-request&review=prepared-request','?command=other'])assert.equal((await invoke({},query)).status,400);
   const v=await(await invoke({actor_id:work,approved:true})).json();assert.equal(v.result.state,'refused');assert.equal(s.writes.provider+s.writes.approval,0);
  });
 }finally{Deno.serve=old.serve;Deno.env.get=old.env;globalThis.fetch=old.fetch;}
});
