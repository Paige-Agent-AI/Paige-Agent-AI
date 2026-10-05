import {date,integer,only,object,text,UUID} from '../sales-collections/primitives.ts';

/** Creation of a recorded fixed obligation only. Signing, scheduling, invoicing and collection
 * remain independent acts. The SQL common writer owns business validation and saved facts.
 * No actor, tenant, approval, provider or account readiness is accepted from model arguments.
 */
export interface CommercialTermsCreateCommand {
 action:'collection.create_commercial_terms';client_id:string;offer_id:string;
 term_kind:'one_time'|'installment';agreed_amount_minor:number;agreed_currency:string;
 billing_interval:'month'|null;interval_count:number|null;installments_total:number|null;
 payment_schedule:'on_signing'|'on_start'|'in_advance'|'in_arrears'|'on_milestone'|'custom';
 starts_on:string;ends_on:string|null;title:string|null;notes:string|null;
}
// Match PostgreSQL btrim(text): ASCII spaces only, before fingerprinting.
const canonicalText=(value:unknown,max:number):string|null=>{const checked=text(value,max);return checked===null?null:(checked.replace(/^ +| +$/g,'')||null);};
const keys=['action','client_id','offer_id','term_kind','agreed_amount_minor','agreed_currency',
 'billing_interval','interval_count','installments_total','payment_schedule','starts_on','ends_on','title','notes'];
const invalid=():never=>{throw new TypeError('COMMERCIAL_TERMS_CREATE_INVALID');};
/** No defaults, financial calculator or permissive field bag. Required facts must be obtained
 * before this act; package assembly owns missing-fact clarification and agreement conflicts.
 * This first write supports explicit negotiated fixed obligations, not catalog repricing,
 * indefinite recurring mandates, fee/interest accrual or modification of executed terms.
 */
export function parseCommercialTermsCreateCommand(value:unknown):CommercialTermsCreateCommand {
 if(!object(value))return invalid();only(value,keys);
 if(keys.some(key=>!Object.prototype.hasOwnProperty.call(value,key))||value.action!=='collection.create_commercial_terms'
  ||typeof value.client_id!=='string'||!UUID.test(value.client_id)
  ||typeof value.offer_id!=='string'||!UUID.test(value.offer_id)
  ||!['one_time','installment'].includes(String(value.term_kind))
  ||typeof value.agreed_currency!=='string'||!/^[a-z]{3}$/.test(value.agreed_currency)
  ||!['on_signing','on_start','in_advance','in_arrears','on_milestone','custom'].includes(String(value.payment_schedule))
  ||(value.title!==null&&typeof value.title!=='string')||(value.notes!==null&&typeof value.notes!=='string'))return invalid();
 const amount=integer(value.agreed_amount_minor,1),start=date(value.starts_on),end=value.ends_on===null?null:date(value.ends_on);
 if(end!==null&&end<start)return invalid();
 const installment=value.term_kind==='installment';
 if(installment?(value.billing_interval!=='month'||!Number.isSafeInteger(value.interval_count)
   ||Number(value.interval_count)<1||Number(value.interval_count)>12
   ||!Number.isSafeInteger(value.installments_total)||Number(value.installments_total)<2||Number(value.installments_total)>240)
  :(value.billing_interval!==null||value.interval_count!==null||value.installments_total!==null))return invalid();
 return {action:'collection.create_commercial_terms',client_id:value.client_id.toLowerCase(),offer_id:value.offer_id.toLowerCase(),
  term_kind:value.term_kind as CommercialTermsCreateCommand['term_kind'],agreed_amount_minor:amount,agreed_currency:value.agreed_currency,
  billing_interval:installment?'month':null,interval_count:installment?Number(value.interval_count):null,
  installments_total:installment?Number(value.installments_total):null,payment_schedule:value.payment_schedule as CommercialTermsCreateCommand['payment_schedule'],
  starts_on:start,ends_on:end,title:canonicalText(value.title,200),notes:canonicalText(value.notes,2000)};
}
