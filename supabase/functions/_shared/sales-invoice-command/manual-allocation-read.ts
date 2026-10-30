import {UUID} from './contract.ts';
import {parseManualPaymentAllocations,type ManualPaymentAllocation} from './manual-allocation.ts';

export type ManualReceiptRpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export type ManualReceiptScope={tenantId:string;invoiceId:string;version:number;receipt:{id:string;kind:string;amount_cents:number;evidence_kind?:'manual_recorded'|'provider_verified'}};
export type ManualReceiptAssignmentRead=
 |{state:'assigned';allocations:ManualPaymentAllocation[];reversalPaymentId:string|null}
 |{state:'unassigned'|'unverified';allocations:[];reversalPaymentId:string|null}
 |{state:'refused'}
 |{state:'stale'};
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
/** Closed presentation of one ORIGINAL immutable operation/receipt. Not a ledger,
 * allocation calculator, permission decision or provider settlement projection. */
export function readManualReceiptAssignments(value:unknown,scope:ManualReceiptScope):ManualReceiptAssignmentRead{
 const unavailable:ManualReceiptAssignmentRead={state:'unverified',allocations:[],reversalPaymentId:null};
 if(!object(value)||Object.keys(value).sort().join(',')!=='allocations,amount_cents,currency,invoice_id,invoice_version,payment_id,reversal_payment_id,state'
  ||value.invoice_id!==scope.invoiceId||value.invoice_version!==scope.version||value.payment_id!==scope.receipt.id
  ||value.amount_cents!==scope.receipt.amount_cents||value.currency!=='usd'
  ||!(value.reversal_payment_id===null||typeof value.reversal_payment_id==='string'&&UUID.test(value.reversal_payment_id)&&value.reversal_payment_id!==scope.receipt.id))return unavailable;
 const reversalPaymentId=value.reversal_payment_id as string|null;
 if(value.state==='assigned'){
  try{return{state:'assigned',allocations:parseManualPaymentAllocations(value.allocations,scope.receipt.amount_cents),reversalPaymentId};}catch{return unavailable;}
 }
 if(['unassigned','unverified'].includes(String(value.state))&&Array.isArray(value.allocations)&&value.allocations.length===0)return{state:value.state as 'unassigned'|'unverified',allocations:[],reversalPaymentId};
 return unavailable;
}
export async function readOriginalManualReceiptAssignments(rpc:ManualReceiptRpc,scope:ManualReceiptScope):Promise<ManualReceiptAssignmentRead>{
 if(!UUID.test(scope.tenantId)||!UUID.test(scope.invoiceId)||!UUID.test(scope.receipt.id)||!Number.isSafeInteger(scope.version)||scope.version<1
  ||scope.receipt.kind!=='receipt'||scope.receipt.evidence_kind==='provider_verified')return{state:'refused'};
 try{
  const {data,error}=await rpc('read_sales_invoice_manual_allocations',{_expected_tenant_id:scope.tenantId,_invoice_id:scope.invoiceId,_expected_version:scope.version,_payment_id:scope.receipt.id});
  if(error)return{state:object(error)&&error.code==='40001'?'stale':'refused'};
  return readManualReceiptAssignments(data,scope);
 }catch{return{state:'refused'};}
}
