import {object,UUID} from '../sales-collections/primitives.ts';
import {resolveWorkspaceAuthority} from '../workspace-authority.ts';
import {projectCapabilities,type Lane} from '../paige-capability-status/projection.ts';
import {AGREEMENT_SEND} from '../paige-spine/domains/agreement.ts';
import {commsProviderExecutionAllowed} from '../comms-provider-boundary.ts';
import {commsEmailContentDigest} from '../comms-email/contract.ts';
import {canonicalPresentationJson} from './preparation-json.ts';
import {admitPreparedSignatureRequest,preparedSignatureConfirmationStore,type PreparedSignatureCommandPorts} from './prepared-signature-command.ts';
import {readExactPreparedSignatureRequest,type PreparedSignatureEmailPorts} from './prepared-signature-request.ts';
import {readPreparedSignatureOutcome} from './prepared-signature-outcome.ts';
import {preparedSignatureWorkStore} from './prepared-signature-work.ts';
import {preparedSignatureCredentialStore} from './prepared-signature-credentials.ts';
import type {OwnerPreparationCaller,OwnerPreparationService} from './owner-preparation.ts';

type Reply={data:unknown;error:unknown};
type Query=PromiseLike<Reply>&{select(columns:string):Query;eq(key:string,value:unknown):Query;maybeSingle():PromiseLike<Reply>;single():PromiseLike<Reply>};
/** The concrete original authenticated handler supplies its SDK service client.
 * This interface narrows SDK types; none of these methods is request data. */
export type PreparedSignatureOriginService={
 rpc(name:string,args:Record<string,unknown>):PromiseLike<Reply>;
 from(table:string):{select(columns:string):Query;insert(row:Record<string,unknown>):Query};
 functions:{invoke(name:string,options:{body:Record<string,unknown>}):PromiseLike<Reply>};
};
type Context={caller:OwnerPreparationCaller;service:PreparedSignatureOriginService;source:OwnerPreparationService;
 email:PreparedSignatureEmailPorts;actorId:string;tenantId:string};
type Review=Awaited<ReturnType<typeof readExactPreparedSignatureRequest>>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
const fail=():never=>{throw Error('ORIGINAL_SIGNATURE_REQUEST_RECONCILIATION_REQUIRED');};

/** Originating Sales adapter over the existing gate, confirmations, Work,
 * signer credentials and canonical message sender. No alternative provider,
 * executor, approval store or recovery worker. Existing history wins BEFORE
 * readiness; a repeated or interrupted request can never dispatch again. */
export async function runOriginatingPreparedSignatureRequest(value:unknown,ctx:Context){
 let captured:unknown;try{captured=structuredClone(value);}catch{return {state:'refused' as const,code:'INVALID_REQUEST'};}
 if(!object(captured)||!uuid(captured.operation_id)||!uuid(ctx.actorId)||!uuid(ctx.tenantId))return {state:'refused' as const,code:'INVALID_REQUEST'};
 const operationId=captured.operation_id,{actorId,tenantId,caller,service}=ctx;
 let reviewed:Review|null=null;
 const authorize:PreparedSignatureCommandPorts['authorizeCurrent']=async()=>{
  try{
   const user=await caller.auth.getUser();
   if(user.error||!user.data.user||user.data.user.id!==actorId||user.data.user.is_anonymous===true)return null;
   const current=await caller.rpc('current_user_tenant_id');if(current.error||current.data!==tenantId)return null;
   const [authority,member]=await Promise.all([
    resolveWorkspaceAuthority(caller,service,actorId,tenantId),
    service.from('tenant_members').select('role,status').eq('tenant_id',tenantId).eq('user_id',actorId).eq('status','active').maybeSingle(),
   ]);
   if(!authority.seat||member.error||!object(member.data)||member.data.status!=='active'||!['owner','admin'].includes(String(member.data.role)))return null;
   return {actorId,tenantId,principal:'person' as const,role:member.data.role as 'owner'|'admin'};
  }catch{return null;}
 };
 const lane=async()=>{
  const r=await caller.rpc('resolve_tool_autonomy',{_tenant_id:tenantId,_tool_key:'agreement_send'});
  return !r.error&&['auto','confirm','off'].includes(String(r.data))?r.data as Lane:'unresolved' as const;
 };
 const providerAllowed=async(request:Review)=>{
  for(const recipient of request.args.recipients)if(!await commsProviderExecutionAllowed(service,{tenantId,actorUserId:actorId,recipientEmail:recipient.email}))return false;
  return true;
 };
 const fresh=async(request:Review,recipientEmail?:string)=>{
  if(!await authorize())return fail();
  const allowed=recipientEmail?await commsProviderExecutionAllowed(service,{tenantId,actorUserId:actorId,recipientEmail}):await providerAllowed(request);
  if(!allowed||!await authorize())return fail();
 };
 const outcome=(scope:unknown,operation:string,digest:string)=>{
  if(!object(scope)||scope.actorId!==actorId||scope.tenantId!==tenantId||operation!==operationId||!object(captured)||!object(captured.review))return fail();
  return readPreparedSignatureOutcome({tenant_id:tenantId,agreement_id:captured.review.agreement_id,operation_id:operation,expected_request_sha256:digest},caller,service,actorId);
 };
 const ports:PreparedSignatureCommandPorts={
  authorizeCurrent:authorize,
  async availability(){
   if(!reviewed||!await providerAllowed(reviewed))return 'unavailable';
   const mode=await lane();if(mode==='unresolved')return 'unknown';
   return projectCapabilities({tools:[{name:'agreement_send',description:'Request signatures on the exact reviewed agreement.'}],spine:[AGREEMENT_SEND],legacy:{},
    isMutating:()=>true,lanes:new Map([['agreement_send',mode]]),workspaceAdminTools:new Set(['agreement_send']),isWorkspaceAdmin:!!await authorize(),readiness:new Map()})[0]?.availability??'unknown';
  },
  autonomy:lane,
  async readCurrentRequest(input){reviewed=await readExactPreparedSignatureRequest(input,caller,ctx.source,actorId,ctx.email);return reviewed;},
  readOriginalOutcome:outcome,
  pending:preparedSignatureConfirmationStore(service,{actorId,tenantId,operationId}),
  async audit(v){
   const r=await service.from('paige_audit_log').insert({actor_user_id:actorId,actor_role:'sales:'+v.scope.role,tenant_id:tenantId,
    action:'sales.agreement_signature_request_governed_decision',target_type:'agreement',target_id:v.agreementId,
    payload:{capability:'agreement_send',decision:v.decision.kind,risk:v.decision.risk,lane_requested:v.decision.audit.laneRequested,
     lane_effective:v.decision.audit.laneEffective,operation_id:operationId,request_sha256:v.requestDigest}}).select('id').single();
   return !r.error&&object(r.data)&&uuid(r.data.id)?r.data.id:null;
  },
  async executeOriginal(v){
   // Re-read exactly what the ORIGINAL claim covered, after its consumption.
   // Native writers independently repeat current authority/source checks.
   const input=Object.fromEntries(Object.entries(captured as Record<string,unknown>).filter(([k])=>k!=='approved_fingerprint'));
   const current=await readExactPreparedSignatureRequest(input,caller,ctx.source,actorId,ctx.email);
   if(canonicalPresentationJson(current)!==canonicalPresentationJson(v.request))return fail();
   await fresh(current);
   const a=current.args,bound={actorId,tenantId,operationId,requestSha256:current.request_sha256,agreementId:a.agreementId,preparationId:a.preparationId};
   const work=await preparedSignatureWorkStore(service,bound).register({confirmationId:v.confirmationId,requestNonce:v.requestNonce,fingerprint:v.fingerprint,auditId:v.auditId});
   if(work.work_status!=='claimed')return fail();
   await fresh(current);
   const issued=await preparedSignatureCredentialStore(service,{...bound,preparationSha256:a.preparationSha256,documentSha256:a.document.sha256},a.recipients.map(r=>r.id)).issue();
   try{
    if(issued.recovered||issued.receipt.work_id!==work.work_id)return fail();
    for(const recipient of a.recipients){
     await fresh(current,recipient.email);
     const invitation=a.messages.find(m=>m.signer_id===recipient.id);if(!invitation)return fail();
     const childOperation=crypto.randomUUID();
     const command={action:'agreement.send',agreement_id:a.agreementId,agreement_work_id:work.work_id,agreement_operation_id:operationId,
      agreement_request_sha256:current.request_sha256,signer_id:recipient.id,operation_id:childOperation};
     const governance={actor_user_id:actorId,tenant_id:tenantId,tool:'agreement_send',action:'agreement.send',approval_channel:'chat-canonical',decision_receipt_recorded:true,
      approved_fingerprint:v.fingerprint,purpose:'agreement_signature_request',agreement_work_id:work.work_id,agreement_operation_id:operationId,
      agreement_request_sha256:current.request_sha256,signer_id:recipient.id,operation_id:childOperation};
     const prepared=await service.rpc('prepare_comms_email_send',{_actor_user_id:actorId,_expected_tenant_id:tenantId,_operation_id:childOperation,
      _contact_id:a.source.client_id,_recipient:invitation.to,_connector_id:a.sender.connector_id,_from_address:a.sender.from_address,
      _subject:invitation.subject,_body_text:invitation.body_text,_body_html:invitation.body_html,
      _content_digest:await commsEmailContentDigest({recipient:invitation.to,connectorId:a.sender.connector_id,subject:invitation.subject,bodyText:invitation.body_text}),_command:command,_governance:governance});
     if(prepared.error||!object(prepared.data)||prepared.data.ok!==true||!uuid(prepared.data.message_id)||prepared.data.state!=='prepared'||prepared.data.replayed===true)return fail();
     await fresh(current,recipient.email);
     const token=issued.takeCredential(recipient.id);if(!token)return fail();
     // Only this existing private provider door receives the volatile token.
     // Its own native claim and exact-source checks precede actual dispatch.
     try{await service.functions.invoke('send-message',{body:{channel:'email',to:invitation.to,contact_id:a.source.client_id,connector_id:a.sender.connector_id,
      message_id:prepared.data.message_id,subject:invitation.subject,body:invitation.body_html,comms_email_operation_id:childOperation,
      idempotency_key:'comms-email:'+childOperation,agreement_signature_token:token}});}catch{/* Native readback below, never an automatic repeat. */}
     const actual=await service.rpc('read_comms_email_send_result',{_actor_user_id:actorId,_expected_tenant_id:tenantId,_operation_id:childOperation});
     if(actual.error||!object(actual.data)||actual.data.outcome!=='provider_accepted'||actual.data.provider_receipt_available!==true)return fail();
    }
   }finally{
    issued.dispose();
    // Reconcile genuine accepted children, including partial progress after a
    // lost response. The ORIGINAL native publisher owns the effect and receipt.
    // An invocation callback or this RPC's reply is never reported as success.
    if(await authorize())try{await service.rpc('_publish_prepared_agreement_request',{_actor:actorId,_tenant:tenantId,_operation:operationId,_request_sha256:current.request_sha256});}catch{/* Original private result read remains authoritative. */}
   }
  },
  nonce:()=>crypto.randomUUID(),
 };
 return await admitPreparedSignatureRequest(captured,ports);
}
