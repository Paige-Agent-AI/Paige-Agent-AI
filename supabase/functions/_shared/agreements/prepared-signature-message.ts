import {object,UUID} from '../sales-collections/primitives.ts';
import {PAIGE_APP_ORIGIN} from '../canonical-app-url.ts';
import {normalizeCommsEmailAddress} from '../comms-email/contract.ts';
import {PREPARED_SIGNING_LINK_MARKER} from './prepared-signature-review-contract.ts';
import {preparedSignatureCredentialStore} from './prepared-signature-credentials.ts';
import {readPreparedRequestSender,type PreparedSignatureEmailPorts} from './prepared-signature-request.ts';
import {sha256Hex,tokenState} from './token.ts';
import {canonicalPresentationJson} from './preparation-json.ts';

type Ports=Pick<PreparedSignatureEmailPorts,'admin'|'environment'>;
type Sender=Awaited<ReturnType<typeof readPreparedRequestSender>>;
export type PreparedSignatureMessageSource=Readonly<{
 messageId:string;operationId:string;tenantId:string;actorId:string;clientId:string;connectorId:string;connectorProvider:'sendgrid'|'resend';
 agreementId:string;workId:string;parentOperationId:string;requestSha256:string;preparationId:string;
 preparationSha256:string;documentSha256:string;credentialEventId:string;commitment:string;expiresAt:string;
 signerId:string;recipientIds:readonly string[];recipient:string;subject:string;bodyText:string;bodyHtml:string;sender:Readonly<Sender>;
}>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=(code:string):never=>{throw Error('PREPARED_SIGNATURE_MESSAGE_'+code);};
export const isPreparedAgreementMessage=(v:unknown):boolean=>object(v)
 &&(object(v.governance)&&v.governance.purpose==='agreement_signature_request'||Object.hasOwn(v,'agreement_source'));

export function assertPreparedSignatureSenderEnvelope(source:PreparedSignatureMessageSource,envelope:{address:string;name:string|null;replyTo:string|null}){
 const reply=envelope.replyTo?normalizeCommsEmailAddress(envelope.replyTo):null;
 if(normalizeCommsEmailAddress(envelope.address)!==source.sender.from_address||envelope.name!==source.sender.from_name
  ||envelope.replyTo&&!reply||reply!==source.sender.reply_to)return fail('SENDER_CHANGED');
}

/** Shape/cross-record checks of ORIGINAL native readback only. This projection
 * never grants approval, a claim, provider permission or access to another signer. */
export function capturePreparedSignatureMessage(value:unknown):PreparedSignatureMessageSource{
 let v:unknown;try{v=structuredClone(value);}catch{return fail('INVALID_SOURCE');}
 if(!object(v)||!object(v.agreement_source)||!object(v.governance))return fail('INVALID_SOURCE');
 const a=v.agreement_source,g=v.governance,s=a.sender,m=a.message,p=a.signer;
 if(a.kind!=='prepared_agreement_message_source'||a.source_only!==true||!object(s)||!object(m)||!object(p)
  ||g.purpose!=='agreement_signature_request'||g.tool!=='agreement_send'||g.action!=='agreement.send'
  ||g.approval_channel!=='chat-canonical'||g.decision_receipt_recorded!==true
  ||!uuid(v.message_id)||!uuid(v.operation_id)||!uuid(v.tenant_id)||!uuid(v.actor_user_id)||!uuid(v.contact_id)||!uuid(v.connector_id)
  ||!uuid(a.agreement_id)||!uuid(a.work_id)||!uuid(a.agreement_operation_id)||!uuid(a.preparation_id)||!uuid(a.credential_event_id)
  ||!uuid(p.id)||!hash(a.request_sha256)||!hash(a.preparation_sha256)||!hash(a.document_sha256)||!hash(a.credential_commitment)
  ||a.tenant_id!==v.tenant_id||a.actor_id!==v.actor_user_id||a.client_id!==v.contact_id||a.operation_id!==v.operation_id
  ||g.actor_user_id!==a.actor_id||g.tenant_id!==a.tenant_id||g.operation_id!==a.operation_id
  ||g.agreement_work_id!==a.work_id||g.agreement_operation_id!==a.agreement_operation_id
  ||g.agreement_request_sha256!==a.request_sha256||g.signer_id!==p.id
   // Native binding retains the original connector label; the reviewed sender
   // names the actual SendGrid transport. Shape alone grants no dispatch: the
   // original native source and recorded alias are revalidated before a claim
   // and again at effect time by prepareSignatureMessage.
   ||(v.provider!=='sendgrid'&&v.provider!=='resend')||s.provider!=='sendgrid'||s.connector_id!==v.connector_id||s.from_address!==v.from_address
  ||typeof s.from_address!=='string'||normalizeCommsEmailAddress(s.from_address)!==s.from_address
  ||!(s.from_name===null||typeof s.from_name==='string'&&!/[\r\n<>]/.test(s.from_name)&&!s.from_name.includes('\u0000'))
  ||!(s.reply_to===null||typeof s.reply_to==='string'&&normalizeCommsEmailAddress(s.reply_to)===s.reply_to)
  ||m.signer_id!==p.id||m.to!==p.email||m.to!==v.recipient||typeof m.to!=='string'
  ||normalizeCommsEmailAddress(m.to)!==m.to||m.subject!==v.subject||typeof m.subject!=='string'
  ||m.body_text!==v.body_text||typeof m.body_text!=='string'||m.body_html!==v.body_html||typeof m.body_html!=='string'
  ||m.body_text.split(PREPARED_SIGNING_LINK_MARKER).length!==2||m.body_html.split(PREPARED_SIGNING_LINK_MARKER).length!==2
  ||/\/sign\/[a-f0-9]{64}/i.test(m.body_text+'\n'+m.body_html)
  ||!Array.isArray(a.recipient_ids)||a.recipient_ids.length<1||a.recipient_ids.length>100
  ||!a.recipient_ids.every(uuid)||new Set(a.recipient_ids).size!==a.recipient_ids.length||!a.recipient_ids.includes(p.id)
  ||typeof a.credential_expires_at!=='string'||!Number.isFinite(Date.parse(a.credential_expires_at)))return fail('INVALID_SOURCE');
 return Object.freeze({messageId:v.message_id,operationId:v.operation_id,tenantId:v.tenant_id,actorId:v.actor_user_id,
   clientId:v.contact_id,connectorId:v.connector_id,connectorProvider:v.provider as 'sendgrid'|'resend',agreementId:a.agreement_id,workId:a.work_id,parentOperationId:a.agreement_operation_id,
  requestSha256:a.request_sha256,preparationId:a.preparation_id,preparationSha256:a.preparation_sha256,documentSha256:a.document_sha256,
  credentialEventId:a.credential_event_id,commitment:a.credential_commitment,expiresAt:a.credential_expires_at,signerId:p.id,
  recipientIds:Object.freeze([...a.recipient_ids]),recipient:m.to,subject:m.subject,bodyText:m.body_text,bodyHtml:m.body_html,
  sender:Object.freeze({connector_id:s.connector_id,provider:'sendgrid',from_address:s.from_address,from_name:s.from_name,reply_to:s.reply_to})});
}

/** Private RAM-only link material. Serialization carries no raw token or link.
 * The one original native claim MUST win before revalidate/apply. The same
 * native binding repeats act-time authority on dispatching, after any waits.
 * No mint, rotation, approval, claim, sender, provider or record write occurs here. */
export async function prepareSignatureMessage(source:PreparedSignatureMessageSource,rawToken:unknown,ports:Ports){
 const bound=capturePreparedSignatureMessageSourceCopy(source);
 if(!hash(rawToken))return fail('CREDENTIAL_REQUIRED');
 const store=preparedSignatureCredentialStore(ports.admin,{actorId:bound.actorId,tenantId:bound.tenantId,
  operationId:bound.parentOperationId,agreementId:bound.agreementId,preparationId:bound.preparationId,
  requestSha256:bound.requestSha256,preparationSha256:bound.preparationSha256,documentSha256:bound.documentSha256},bound.recipientIds);
 let receipt;try{receipt=await store.read();}catch{return fail('CREDENTIAL_UNVERIFIED');}
 const credential=receipt?.credentials.find(c=>c.signer_id===bound.signerId);
 if(!receipt||receipt.work_id!==bound.workId||receipt.event_id!==bound.credentialEventId||!credential||!credential.token_hash
  ||credential.expires_at!==bound.expiresAt||await sha256Hex(rawToken)!==credential.token_hash
  ||await sha256Hex(credential.token_hash)!==bound.commitment
  ||!tokenState({token_hash:credential.token_hash,token_expires_at:credential.expires_at,token_revoked_at:null},new Date()).usable)return fail('CREDENTIAL_UNVERIFIED');
 const sender=async()=>{
  let current;try{current=await readPreparedRequestSender(ports,bound.tenantId,bound.connectorId,bound.actorId);}catch{return fail('SENDER_CHANGED');}
  if(canonicalPresentationJson(current)!==canonicalPresentationJson(bound.sender))return fail('SENDER_CHANGED');
 };
 await sender();
 const url=new URL('/sign/'+rawToken,PAIGE_APP_ORIGIN).href;
 let html:string|null=bound.bodyHtml.replace(PREPARED_SIGNING_LINK_MARKER,()=>url);
 let text:string|null=bound.bodyText.replace(PREPARED_SIGNING_LINK_MARKER,()=>url),validated=false,used=false;
 return Object.freeze({
  async revalidate(attempt:number){
   validated=false;if(used||!Number.isInteger(attempt)||attempt<1)return fail('SOURCE_CHANGED');
   await sender();
   let current;try{current=await ports.admin.rpc('read_comms_email_send_binding',{_message_id:bound.messageId});}catch{return fail('SOURCE_CHANGED');}
   if(current.error||!object(current.data)||current.data.eligible!==true||current.data.state!=='dispatching'
    ||current.data.attempts!==attempt||canonicalPresentationJson(capturePreparedSignatureMessage(current.data))!==canonicalPresentationJson(bound)
    ||!tokenState({token_hash:credential.token_hash,token_expires_at:credential.expires_at,token_revoked_at:null},new Date()).usable)return fail('SOURCE_CHANGED');
   validated=true;
  },
  apply(message:{body_html?:string|null;body_text?:string|null}){
   if(!validated||used||html===null||text===null)return fail('SOURCE_CHANGED');
   message.body_html=html;message.body_text=text;html=null;text=null;used=true;validated=false;
  },
  dispose(){html=null;text=null;validated=false;used=true;},
 });
}
function capturePreparedSignatureMessageSourceCopy(source:PreparedSignatureMessageSource):PreparedSignatureMessageSource{
 // It is an internal captured value, never a request-authorized scope. Clone
 // again before the first await so a mutable caller cannot retarget the link.
 try{return Object.freeze(structuredClone(source));}catch{return fail('INVALID_SOURCE');}
}
