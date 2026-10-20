import {createClient} from 'npm:@supabase/supabase-js@2';
import {commsProviderExecutionAllowed} from '../_shared/comms-provider-boundary.ts';
import {runPreSend} from '../_shared/pre-send-pipeline.ts';

export type Options={key:string;site:string;defaultFrom:string;
 senderFrom:(name:string,fallback:string)=>string;
 copy:(kind:string,name:string)=>{subject:string;textLead:string};
 html:(name:string,accent:string,logo:string|null,url:string,first:string,kind:string)=>string};
type Data=Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_ID=/^[A-Za-z0-9_-]{1,200}$/;
const object=(v:unknown):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Data,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const identifier=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'};
const response=(status:number,data:Data)=>new Response(JSON.stringify({delivery_confirmed:false,...data}),{status,headers});
const refused=(status:number,code:string,outcome='refused')=>response(status,{ok:false,emailed:false,outcome,code});
const coreKeys=['actor_id','tenant_id','found','operation_id','invitation_id','receipt_id','requested_by','reconciled_by','outcome','provider_message_id','observed_at'];
export function deliveryReceipt(value:unknown,actor:string,tenant:string,operation:string,claim=false):Data{
 if(!object(value)||value.actor_id!==actor||value.tenant_id!==tenant||value.operation_id!==operation)throw Error('invalid_native_scope');
 if(value.found===false&&!claim&&exact(value,['actor_id','tenant_id','operation_id','found']))return value;
 const extra=claim?(value.disposition==='dispatch'||value.disposition==='reconcile'?['disposition','claim_id','provider_key']:['disposition']):[];
 if(value.found!==true||!exact(value,[...coreKeys,...extra])||!identifier(value.invitation_id)||!identifier(value.receipt_id)
   ||!identifier(value.requested_by)||!identifier(value.reconciled_by)
   ||!['pending','provider_accepted','failed','refused','outcome_unknown'].includes(String(value.outcome))
   ||typeof value.observed_at!=='string'||!Number.isFinite(Date.parse(value.observed_at)))throw Error('invalid_native_receipt');
 if(value.outcome==='provider_accepted'){
  if(typeof value.provider_message_id!=='string'||!MESSAGE_ID.test(value.provider_message_id))throw Error('invalid_provider_receipt');
 }else if(value.provider_message_id!==null)throw Error('unexpected_provider_receipt');
 if(claim){
  if(!['dispatch','reconcile','busy','held','recorded'].includes(String(value.disposition)))throw Error('invalid_claim');
  if(extra.length===3&&(!identifier(value.claim_id)||value.provider_key!==`customer-portal-delivery/v1/${tenant}/${operation}`))throw Error('invalid_claim');
 }
 return value;
}
export function savedDelivery(value:Data,replayed:boolean):Response{
 return response(value.outcome==='provider_accepted'?200:value.outcome==='outcome_unknown'||value.outcome==='pending'?503:422,
  {ok:value.outcome==='provider_accepted',emailed:value.outcome==='provider_accepted',outcome:value.outcome,
   invitation_id:value.invitation_id,delivery_operation_id:value.operation_id,receipt_id:value.receipt_id,replayed});
}

/** New caller contract over the SAME sender. Claim keys/leases/tokens never leave this adapter. */
export async function sendCanonicalPortalInvite(req:Request,input:unknown,options:Options,expected:{contactId:string;recipient:string;proposalHash:string}):Promise<Response>{
 if(!expected||!identifier(expected.contactId)||typeof expected.recipient!=='string'||expected.recipient.trim().toLowerCase()!==expected.recipient
  ||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected.recipient)||! /^[0-9a-f]{64}$/.test(expected.proposalHash))return refused(400,'INVITATION_TARGET_BINDING_REQUIRED');
 if(!object(input)||!exact(input,['expected_tenant_id','invitation_id','delivery_operation_id'])
   ||!identifier(input.expected_tenant_id)||!identifier(input.invitation_id)||!identifier(input.delivery_operation_id))return refused(400,'INVITATION_REQUEST_INVALID');
 const tenant=input.expected_tenant_id.toLowerCase(),invitationId=input.invitation_id.toLowerCase(),operation=input.delivery_operation_id.toLowerCase();
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const authorization=req.headers.get('Authorization');
 if(!url||!anon||!service)return refused(503,'INVITATION_UNAVAILABLE');
 if(!authorization||!/^Bearer\s+\S+$/i.test(authorization))return refused(401,'UNAUTHENTICATED');
 const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const verified=await caller.auth.getUser().catch(()=>null);
 if(!verified||verified.error||!identifier(verified.data.user?.id))return refused(401,'UNAUTHENTICATED');
 const actor=verified.data.user.id.toLowerCase();
 let dispatched=false,claim:Data|null=null,payloadHash='';
 const current=async()=>{
  const auth=await caller.auth.getUser();if(auth.error||!identifier(auth.data.user?.id)||auth.data.user.id.toLowerCase()!==actor)return false;
  const context=await caller.rpc('current_user_tenant_id');return !context.error&&context.data===tenant;
 };
 const read=async()=>{
  const result=await caller.rpc('read_client_portal_invitation_delivery',{p_tenant_id:tenant,p_operation_id:operation});
  if(result.error)throw Error('native_read_unavailable');return deliveryReceipt(result.data,actor,tenant,operation);
 };
 const finish=async(outcome:string,message:string|null=null)=>{
  if(!claim)throw Error('missing_claim');
  const result=await admin.rpc('finalize_client_portal_invitation_delivery',{
   p_tenant_id:tenant,p_operation_id:operation,p_claim_id:claim.claim_id,p_payload_digest:payloadHash,p_outcome:outcome,p_message_id:message,
  });
  if(result.error)throw Error('native_write_unconfirmed');
  const value=deliveryReceipt(result.data,actor,tenant,operation);if(value.invitation_id!==invitationId||value.receipt_id!==claim.receipt_id)throw Error('native_write_unconfirmed');
  return value;
 };
 try{
  if(!await current())return refused(409,'WORKSPACE_CHANGED');
  // This actual caller-JWT read positively proves current native owner authority BEFORE privileged data.
  const previous=await read();
  if(previous.found===true){
   if(previous.invitation_id!==invitationId)return refused(409,'INVITATION_OPERATION_CONFLICT');
   if(['provider_accepted','failed','refused'].includes(String(previous.outcome)))return savedDelivery(previous,true);
  }
  if(!await commsProviderExecutionAllowed(admin,{tenantId:tenant,actorUserId:actor}))return refused(403,'COMMS_PROVIDER_EXECUTION_DISABLED');
  const loadToken=async()=>{
   const result=await admin.from('tenant_invite_tokens').select('id,tenant_id,contact_id,email,kind,token,expires_at,revoked_at,uses,max_uses,last_used_at,portal_operation_id,portal_proposal_hash,portal_receipt_id')
    .eq('id',invitationId).eq('tenant_id',tenant).maybeSingle();
   const v:unknown=result.data;
   if(result.error||!object(v)||v.id!==invitationId||v.tenant_id!==tenant||v.kind!=='consumer'||v.contact_id!==expected.contactId
     ||!identifier(v.portal_operation_id)||!identifier(v.portal_receipt_id)||typeof v.portal_proposal_hash!=='string'||!/^[0-9a-f]{64}$/.test(v.portal_proposal_hash)
     ||typeof v.email!=='string'||v.email.trim().toLowerCase()!==expected.recipient||typeof v.token!=='string'||!/^[A-Za-z0-9_-]{16,256}$/.test(v.token)
     ||v.revoked_at!==null||v.last_used_at!==null||v.uses!==0||v.max_uses!==1
     ||typeof v.expires_at!=='string'||!Number.isFinite(Date.parse(v.expires_at))||Date.parse(v.expires_at)<=Date.now())throw Error('invitation_changed');
   return v;
  };
  const token=await loadToken(),recipient=String(token.email).trim().toLowerCase(),contact=String(token.contact_id);
  const target=async()=>{
   const result=await caller.rpc('prepare_client_portal_invitation',{p_tenant_id:tenant,p_contact_id:contact});const value:unknown=result.data;
   if(result.error||!object(value)||!exact(value,['actor_id','tenant_id','contact_id','recipient','proposal_hash'])
     ||value.actor_id!==actor||value.tenant_id!==tenant||value.contact_id!==contact||value.recipient!==recipient
     ||value.proposal_hash!==expected.proposalHash)throw Error('invitation_changed');
  };
  await target();
  if(!options.key)return refused(503,'INVITATION_SENDER_NOT_CONFIGURED');
  const client=await admin.from('clients').select('id,tenant_id,first_name').eq('id',contact).eq('tenant_id',tenant).maybeSingle();
  if(client.error||client.data?.id!==contact||client.data?.tenant_id!==tenant)return refused(409,'INVITATION_CHANGED');
  const firstName=typeof client.data.first_name==='string'?client.data.first_name.trim():'';
  const brandResult=await admin.rpc('resolve_tenant_brand',{_tenant_id:tenant});
  const brand:unknown=Array.isArray(brandResult.data)?brandResult.data[0]:brandResult.data;
  if(brandResult.error||!object(brand)||typeof brand.tenant_name!=='string'||!brand.tenant_name.trim())return refused(503,'INVITATION_BRAND_UNAVAILABLE');
  const name=brand.tenant_name.trim(),accent=typeof brand.primary_color==='string'?brand.primary_color:'#150C31',logo=typeof brand.logo_url==='string'?brand.logo_url:null;
  let from=options.senderFrom(name,options.defaultFrom),replyTo:string|undefined;
  const identity=await admin.rpc('tenant_sender_identity',{_tenant_id:tenant});
  if(!identity.error&&object(identity.data)&&typeof identity.data.from_address==='string'&&identity.data.from_address.trim()){
   from=options.senderFrom(typeof identity.data.from_name==='string'?identity.data.from_name:name,identity.data.from_address.trim());
   if(typeof identity.data.reply_to==='string'&&identity.data.reply_to.trim())replyTo=identity.data.reply_to.trim();
  }
  const copy=options.copy('consumer',name),join=`${options.site}/join/${String(token.token)}`;
  const payload={from,...(replyTo?{reply_to:replyTo}:{}),to:[recipient],subject:copy.subject,
   html:options.html(name,accent,logo,join,firstName,'consumer'),text:`${firstName?`Hi ${firstName},`:'Hi there,'}\n\n${copy.textLead}\n\nOpen it: ${join}\n`};
  const encoded=JSON.stringify(payload);payloadHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded))),b=>b.toString(16).padStart(2,'0')).join('');
  const preSend=()=>runPreSend(admin as unknown as Parameters<typeof runPreSend>[0],{tenantId:tenant,channel:'email',to:recipient,contactId:contact});
  const policy=await preSend();if(!policy.proceed)return refused(409,'INVITATION_POLICY_HELD','held');
  const claimed=await caller.rpc('claim_client_portal_invitation_delivery',{p_tenant_id:tenant,p_invitation_id:invitationId,p_operation_id:operation,p_payload_digest:payloadHash});
  if(claimed.error)return refused(409,'INVITATION_DELIVERY_REQUIRES_READBACK','outcome_unknown');
  claim=deliveryReceipt(claimed.data,actor,tenant,operation,true);if(claim.invitation_id!==invitationId)throw Error('invalid_claim_scope');
  if(!['dispatch','reconcile'].includes(String(claim.disposition)))return savedDelivery(claim,true);
  // Re-resolve actual Auth/workspace/owner/contact/lifecycle/policy/floor immediately before egress.
  try{
   if(!await current())throw Error('context_changed');await target();const latest=await loadToken();
   if(latest.token!==token.token||String(latest.email).trim().toLowerCase()!==recipient)throw Error('invitation_changed');
   if(!(await preSend()).proceed||!await commsProviderExecutionAllowed(admin,{tenantId:tenant,actorUserId:actor,recipientEmail:recipient}))throw Error('policy_changed');
  }catch{
   await finish('refused');
   // A stopped recovery says nothing about the ORIGINAL uncertain attempt.
   if(!await current())return refused(409,'WORKSPACE_CHANGED','outcome_unknown');
   const actual=await read();
   if(actual.found!==true||actual.invitation_id!==invitationId||actual.receipt_id!==claim.receipt_id)throw Error('readback_unavailable');
   return savedDelivery(actual,claim.disposition==='reconcile');
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let outcome='outcome_unknown',message:string|null=null;
  try{
   dispatched=true;
   const result=await fetch('https://api.resend.com/emails',{method:'POST',signal:controller.signal,
    headers:{Authorization:`Bearer ${options.key}`,'Content-Type':'application/json','Idempotency-Key':String(claim.provider_key)},body:encoded});
   const value:unknown=await result.json().catch(()=>null);
   if(result.ok&&object(value)&&typeof value.id==='string'&&MESSAGE_ID.test(value.id)){outcome='provider_accepted';message=value.id;}
   else if([400,401,403,404,422].includes(result.status))outcome='failed';
  }catch{/* Transport/timeout is unknown; never persist provider errors or invitation-bearing payloads. */}
  finally{clearTimeout(timer);}
  await finish(outcome,message);
  if(!await current())return refused(409,'WORKSPACE_CHANGED','outcome_unknown');
  const actual=await read();if(actual.found!==true||actual.invitation_id!==invitationId||actual.receipt_id!==claim.receipt_id)throw Error('readback_unavailable');
  return savedDelivery(actual,claim.disposition==='reconcile');
 }catch{
  return refused(dispatched||claim?503:409,dispatched||claim?'INVITATION_OUTCOME_UNCONFIRMED':'INVITATION_CHANGED',dispatched||claim?'outcome_unknown':'refused');
 }
}
