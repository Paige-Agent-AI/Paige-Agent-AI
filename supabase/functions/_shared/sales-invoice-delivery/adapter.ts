import { INVOICE_LINK_MARKER } from './binding.ts';
type ObjectValue=Record<string,unknown>;
const object=(v:unknown):ObjectValue|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:null;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export interface DeliveryExecutorInput {actorUserId:string;tenantId:string;operationId:string;command:{invoice_id:string;expected_version:number;connector_id:string|null;action?:'invoice.email_send'|'invoice.sms_send'};governance:ObjectValue}
export interface DeliveryExecutorDependencies {
 readInvoice():Promise<unknown>;prepare(args:ObjectValue):Promise<unknown>;send(body:ObjectValue):Promise<unknown>;
 readiness(invoice:unknown):Promise<{eligible:boolean}>;readOutcome():Promise<unknown>;hash(text:string):Promise<string>;stillCurrent():Promise<boolean>;
}
/** Called only by the canonical governed command's execute branch. It has no approval mechanism. */
export async function executeSalesInvoiceDelivery(input:DeliveryExecutorInput,d:DeliveryExecutorDependencies):Promise<ObjectValue> {
 const unknown=()=>({ok:false,outcome:'outcome_unknown',operation_id:input.operationId,code:'INVOICE_DELIVERY_RECONCILIATION_REQUIRED'});
 const refused=(code:string)=>({ok:false,outcome:'refused',operation_id:input.operationId,code});
 try {
  for(const id of [input.actorUserId,input.tenantId,input.operationId,input.command.invoice_id])if(!uuid.test(id))return refused('INVOICE_DELIVERY_INVALID');
  const sms=input.command.action==='invoice.sms_send';
  if(!sms&&(typeof input.command.connector_id!=='string'||!uuid.test(input.command.connector_id)))return refused('INVOICE_DELIVERY_INVALID');
  if(sms&&input.command.connector_id!==null)return refused('INVOICE_DELIVERY_INVALID');
  if(input.governance.decision_receipt_recorded!==true||!await d.stillCurrent())return refused('INVOICE_DELIVERY_AUTHORITY_UNAVAILABLE');
  const prior=object(await d.readOutcome());
  if(prior){if(prior.outcome==='unknown'||prior.outcome==='dispatching'||prior.state==='dispatching')return unknown();if(prior.outcome!=='prepared')return {...prior,replayed:true};}
  const invoice=object(await d.readInvoice());
  if(!invoice||invoice.id!==input.command.invoice_id||invoice.tenant_id!==input.tenantId||invoice.version!==input.command.expected_version||!Number.isSafeInteger(invoice.issued_snapshot_version)||invoice.status!=='issued'||typeof invoice.document_input_digest!=='string'||!/^[a-f0-9]{64}$/.test(invoice.document_input_digest)||!Number.isSafeInteger(invoice.remaining_cents)||(invoice.remaining_cents as number)<=0||!Number.isSafeInteger(invoice.amount_total_cents))return refused('INVOICE_DELIVERY_INELIGIBLE');
  if(!((await d.readiness(invoice)).eligible))return refused('INVOICE_DELIVERY_NOT_READY');
  const number=typeof invoice.invoice_number==='string'?invoice.invoice_number:'';
  if(!number||number.length>100||/[\r\n]/.test(number))return refused('INVOICE_DELIVERY_ARTIFACT_UNAVAILABLE');
  const label=/^DRAFT-/i.test(number)?'previously issued invoice':number;
  const subject=/^DRAFT-/i.test(number)?'Your invoice':`Invoice ${number}`;
  const cash=(value:unknown)=>`USD ${(Number(value)/100).toFixed(2)}`;
  const emailBody=`<p>Your invoice <strong>${escape(label)}</strong> is ready. A PDF copy is attached.</p><p>Original issued amount: ${cash(invoice.amount_total_cents)}. Remaining obligation at this review: ${cash(invoice.remaining_cents)}.</p><p>Any recorded receipts are business-entered records, not processor-verified payments.</p><p><a href="${INVOICE_LINK_MARKER}">View invoice</a></p><p>Payment instructions are on the invoice. This email does not confirm payment.</p>`;
  const bodyHtml=sms?'Invoice '+label+': original '+cash(invoice.amount_total_cents)+'; remaining '+cash(invoice.remaining_cents)+'. View: '+INVOICE_LINK_MARKER+'. Recorded receipts are not processor verified.':emailBody;
  const contentDigest=await d.hash([subject,bodyHtml,invoice.document_input_digest,String(invoice.issued_snapshot_version)].join('\n'));
  if(!await d.stillCurrent())return refused('WORKSPACE_CHANGED');
  const prepared=object(await d.prepare({_actor_user_id:input.actorUserId,_expected_tenant_id:input.tenantId,_invoice_id:input.command.invoice_id,_expected_version:input.command.expected_version,_operation_id:input.operationId,_connector_id:input.command.connector_id,_subject:subject,_body_html:bodyHtml,_content_digest:contentDigest,_governance:input.governance,...(sms?{_channel:'sms'}:{})}));
  if(!prepared||typeof prepared.message_id!=='string'||!uuid.test(prepared.message_id)||typeof prepared.recipient!=='string'||typeof prepared.client_id!=='string')return refused('INVOICE_DELIVERY_PREPARE_REFUSED');
  if(prepared.state&&prepared.state!=='prepared')return prepared.state==='unknown'||prepared.state==='dispatching'?unknown():{...prepared,replayed:true};
  if(!await d.stillCurrent())return refused('WORKSPACE_CHANGED');
  await d.send({channel:sms?'sms':'email',to:prepared.recipient,contact_id:prepared.client_id,connector_id:input.command.connector_id,message_id:prepared.message_id,subject,body:bodyHtml,invoice_delivery_operation_id:input.operationId});
  const result=object(await d.readOutcome());
  return result&&['provider_accepted','failed'].includes(String(result.outcome))?result:unknown();
 }catch{return unknown();}
}
