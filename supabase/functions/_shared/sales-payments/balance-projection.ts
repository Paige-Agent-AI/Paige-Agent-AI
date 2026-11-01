/** Validate the one canonical receivable balance; evidence classes remain separate. */
export function readAllocatedBalance(value:Record<string,unknown>,total:number):{manual:number;verified:number;allocated:number;remaining:number}|null {
 const amount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
 const manual=value.manual_recorded_cents,remaining=value.remaining_cents;
 const hasSplit=value.provider_verified_cents!==undefined||value.allocated_cents!==undefined;
 const verified=hasSplit?value.provider_verified_cents:0,allocated=hasSplit?value.allocated_cents:manual;
 if(!amount(total)||!amount(manual)||!amount(verified)||!amount(allocated)||!amount(remaining)||
  !Number.isSafeInteger(manual+verified)||allocated!==manual+verified||allocated>total||remaining!==total-allocated)return null;
 return {manual,verified,allocated,remaining};
}

export type InvoiceFinancialSummary=Readonly<{
 schema_version:3;invoice_id:string;invoice_version:number;currency:string;
 standing:'recorded'|'needs_review'|'allocation_required'|'unavailable'|'not_applicable';
 outstanding_minor:number|null;refund_payable_minor:number|null;credit_minor:number|null;
 manual_recorded_minor:number;provider_confirmed_minor:number;provider_net_minor:number|null;
 test_provider_minor:number;source_hash:string|null;
}>;
const financialKeys=['schema_version','invoice_id','invoice_version','currency','standing','outstanding_minor',
 'refund_payable_minor','credit_minor','manual_recorded_minor','provider_confirmed_minor','provider_net_minor','test_provider_minor','source_hash'];
/** Decode native financial facts only. No inferred allocation, refund offset,
 * principal repricing or replacement balance calculation belongs in a reader. */
export function readInvoiceFinancialSummary(value:unknown,expected:{id:string;version:number;currency:string;status:string}):InvoiceFinancialSummary|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 const r=value as Record<string,unknown>,amount=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
 if(Object.keys(r).length!==financialKeys.length||Object.keys(r).some(k=>!financialKeys.includes(k))
  ||r.schema_version!==3||r.invoice_id!==expected.id||r.invoice_version!==expected.version||r.currency!==expected.currency
  ||!['recorded','needs_review','allocation_required','unavailable','not_applicable'].includes(String(r.standing))
  ||!['manual_recorded_minor','provider_confirmed_minor','test_provider_minor'].every(k=>amount(r[k])))return null;
 if(r.source_hash!==null&&(typeof r.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(r.source_hash)))return null;
 if(expected.status==='issued'?(r.standing==='not_applicable'):r.standing!=='not_applicable')return null;
 if(r.standing==='recorded'){
  if(!['outstanding_minor','refund_payable_minor','credit_minor'].every(k=>amount(r[k]))
   ||!Number.isSafeInteger(r.provider_net_minor)||r.source_hash===null)return null;
 }else if(r.outstanding_minor!==null||r.refund_payable_minor!==null||r.credit_minor!==null||r.provider_net_minor!==null)return null;
 return Object.freeze({...r}) as InvoiceFinancialSummary;
}
