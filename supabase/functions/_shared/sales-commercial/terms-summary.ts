import type {CommercialTermsCreateCommand} from './terms-command.ts';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Server-resolved canonical labels only. Display precision follows the currency, never a
 * blanket /100 rule. Unknown currencies remain explicit minor units, not invented decimals.
 * This summary is an exact single-act proposal, not package authority or payment execution.
 */
export function commercialTermsSummary(command:CommercialTermsCreateCommand,preview:unknown):string {
 if(!object(preview)||preview.eligible!==true||!object(preview.context))throw new TypeError('COMMERCIAL_PREVIEW_UNAVAILABLE');
 const context=preview.context;
 if(context.client_id!==command.client_id||context.offer_id!==command.offer_id||context.labels_truncated!==false
  ||typeof context.client_name!=='string'||!context.client_name.trim()||context.client_name.length>200
  ||typeof context.offer_name!=='string'||!context.offer_name.trim()||context.offer_name.length>200)throw new TypeError('COMMERCIAL_CONTEXT_UNAVAILABLE');
 const currency=command.agreed_currency.toUpperCase();
 const supported=new Set(Intl.supportedValuesOf('currency'));
 let amount=currency+' '+command.agreed_amount_minor+' minor units';
 if(supported.has(currency)){const format=new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'code'});const digits=format.resolvedOptions().maximumFractionDigits;if(digits===undefined)throw new TypeError('CURRENCY_PRECISION_UNAVAILABLE');amount=format.format(command.agreed_amount_minor/(10**digits));}
 const cadence=command.term_kind==='installment'?command.installments_total+' installments at '+command.interval_count+'-month intervals':'one-time obligation';
 return 'Create draft commercial terms for '+context.client_name+' / '+context.offer_name+': '+amount+' total; '+cadence+'; starts '+command.starts_on+(command.ends_on?'; ends '+command.ends_on:'; no end date specified')+'; payment timing '+command.payment_schedule+'. This creates recorded commercial terms only. It does not issue an invoice, request signature, activate a payment schedule or collect money.';
}
