import {UUID} from '../sales-invoice-command/contract.ts';
import {parseCommercialDraftCommand,type CommercialDraftCommand} from './draft-command.ts';

export type DraftWorkOrder={action:'invoice.draft_create'|'invoice.draft_revise';invoice_id:string;expected_version:number;draft:Record<string,unknown>};
/** Server scope and stable operation only. No model chooses a new invoice identity. This is
 * identity math, not a financial calculator or execution/approval grant. */
export async function commercialDraftWorkOrder(intent:CommercialDraftCommand,scope:{tenantId:string;actorId:string;operationId:string}):Promise<DraftWorkOrder>{
 for(const value of Object.values(scope))if(!UUID.test(value))throw new TypeError('DRAFT_SCOPE_INVALID');
 const checked=parseCommercialDraftCommand(intent);
 if(checked.action==='invoice.draft_revise')return checked;
 const seed=JSON.stringify(['sales_canonical_invoice_draft_v1',scope.tenantId.toLowerCase(),scope.actorId.toLowerCase(),scope.operationId.toLowerCase()]);
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(seed))).slice(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {...checked,invoice_id:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`,expected_version:0};
}
/** Approval executes this exact stored work order, not re-authored model arguments. Scope and
 * generated identity are independently checked before the canonical business RPC. */
export async function validateStoredDraftWorkOrder(value:unknown,scope:{tenantId:string;actorId:string;operationId:string}):Promise<DraftWorkOrder>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('DRAFT_WORK_ORDER_INVALID');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==4||Object.keys(v).some(k=>!['action','invoice_id','expected_version','draft'].includes(k)))throw new TypeError('DRAFT_WORK_ORDER_INVALID');
 const intent=parseCommercialDraftCommand(v.action==='invoice.draft_create'?{action:v.action,draft:v.draft}:v);
 const expected=await commercialDraftWorkOrder(intent,scope);
 if(v.invoice_id!==expected.invoice_id||v.expected_version!==expected.expected_version)throw new TypeError('DRAFT_WORK_ORDER_INVALID');
 return expected;
}
