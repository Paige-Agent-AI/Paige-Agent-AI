import {assembleFixedRepaymentSchedule, type FixedRepaymentAssembly} from '../sales-collections/model.ts';
import type {ScheduleRow} from '../sales-collections/model.ts';

/** Internal, server-resolved references only. Never accept these as model-provided authority.
 * The callable resolver must authenticate and read canonical records before using this preview.
 * This module has no writer, provider dispatch, approval, receipt or balance calculation.
 */
export interface CommercialAssemblyContext {
 tenant_id:string;
 client:{id:string;tenant_id:string} | null;
 agreement:
  | {kind:'signed';id:string;tenant_id:string;client_id:string;version:number;document_ref:string|null}
  | {kind:'unsigned';id:string;tenant_id:string;client_id:string;version:number;signature_required_before_collection:boolean}
  | {kind:'upload';id:string;tenant_id:string;document_ref:string|null}
  | null;
 /** Null means commercial terms have not been grounded; never infer no taxes/fees. */
 agreed_obligation:{tenant_id:string;client_id:string;currency:string;total_cents:number;rows:ScheduleRow[]} | null;
 delivery_channels:('email'|'sms')[] | null;
}
export type CommercialAssemblyPreview =
 | {state:'needs_input';fields:string[]}
 | {state:'refused';code:'RESOURCE_SCOPE_MISMATCH'|'INVALID_CANONICAL_CONTEXT'|'COMMERCIAL_TERMS_CONFLICT'|'INVALID_REPAYMENT_INPUT'|'SCHEDULE_LIMIT'|'CUSTOM_DATES_COUNT_MISMATCH'}
 | {state:'ready_for_review';tenant_id:string;client_id:string;
    schedule:Extract<FixedRepaymentAssembly,{state:'ready'}>;
    agreement:{kind:'signed'|'unsigned'|'upload';id:string;version:number|null;document_ref:string|null;
      treatment:'include_existing_signed_document'|'canonical_signature_workflow'|'attach_uploaded_document_only'};
    delivery_channels:('email'|'sms')[];dependencies:('signature_before_collection')[];
    authority:'not_evaluated';execution:'not_started'};

const reference=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200&&v.trim()===v;
const version=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;

/** Exact principal and schedule preview; ready_for_review is neither permission nor execution.
 * Signed terms cannot be silently changed. Uploaded files never become executable agreements.
 * A later canonical Trust decision must authorize every material act in the bounded package.
 */
export function previewCommercialAssembly(input:unknown,context:CommercialAssemblyContext):CommercialAssemblyPreview {
 const {tenant_id,client,agreement,agreed_obligation,delivery_channels}=context;
 if(!reference(tenant_id))return {state:'refused',code:'INVALID_CANONICAL_CONTEXT'};
 if(client&&client.tenant_id!==tenant_id)return {state:'refused',code:'RESOURCE_SCOPE_MISMATCH'};
 if(client&&!reference(client.id))return {state:'refused',code:'INVALID_CANONICAL_CONTEXT'};
 if(agreement&&(agreement.tenant_id!==tenant_id||('client_id' in agreement&&client&&agreement.client_id!==client.id)))
  return {state:'refused',code:'RESOURCE_SCOPE_MISMATCH'};
 if(agreed_obligation&&(agreed_obligation.tenant_id!==tenant_id||(client&&agreed_obligation.client_id!==client.id)))
  return {state:'refused',code:'RESOURCE_SCOPE_MISMATCH'};
 if(agreement&&(!reference(agreement.id)||!['signed','unsigned','upload'].includes(agreement.kind)
   ||('version' in agreement&&!version(agreement.version))
   ||(agreement.kind==='unsigned'&&typeof agreement.signature_required_before_collection!=='boolean')
   ||('document_ref' in agreement&&agreement.document_ref!==null&&!reference(agreement.document_ref))))
  return {state:'refused',code:'INVALID_CANONICAL_CONTEXT'};
 if(delivery_channels&&(delivery_channels.length<1||delivery_channels.length>2
   ||delivery_channels.some(c=>c!=='email'&&c!=='sms')||new Set(delivery_channels).size!==delivery_channels.length))
  return {state:'refused',code:'INVALID_CANONICAL_CONTEXT'};
 const schedule=assembleFixedRepaymentSchedule(input);
 if(schedule.state==='refused')return schedule;
 const fields=schedule.state==='needs_input'?[...schedule.fields]:[];
 if(!client)fields.push('client');
 if(!agreement)fields.push('agreement_or_document');
 if(agreement&&'document_ref' in agreement&&agreement.document_ref===null)fields.push('agreement_document');
 if(!agreed_obligation)fields.push('agreed_terms_including_taxes_and_fees');
 if(!delivery_channels)fields.push('delivery_channel');
 if(fields.length)return {state:'needs_input',fields};
 if(schedule.state!=='ready'||!client||!agreement||!agreed_obligation||!delivery_channels)
  return {state:'refused',code:'INVALID_CANONICAL_CONTEXT'};
 const actual=schedule.rows,agreed=agreed_obligation.rows;
 if(!Array.isArray(agreed)||agreed.length!==actual.length||agreed_obligation.total_cents!==schedule.terms.total_cents
   ||agreed_obligation.currency!==schedule.terms.currency||agreed.some((row,i)=>!row||row.due_date!==actual[i].due_date
    ||row.amount_cents!==actual[i].amount_cents||row.currency!==actual[i].currency))
  return {state:'refused',code:'COMMERCIAL_TERMS_CONFLICT'};
 const signed=agreement.kind==='signed',upload=agreement.kind==='upload';
 return {state:'ready_for_review',tenant_id,client_id:client.id,schedule,
  agreement:{kind:agreement.kind,id:agreement.id,version:'version' in agreement?agreement.version:null,
   document_ref:'document_ref' in agreement?agreement.document_ref:null,
   treatment:signed?'include_existing_signed_document':upload?'attach_uploaded_document_only':'canonical_signature_workflow'},
  delivery_channels:[...delivery_channels],dependencies:agreement.kind==='unsigned'&&agreement.signature_required_before_collection?['signature_before_collection']:[],
  authority:'not_evaluated',execution:'not_started'};
}
