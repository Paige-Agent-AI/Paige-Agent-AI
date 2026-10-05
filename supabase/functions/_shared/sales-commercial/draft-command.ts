import {UUID} from '../sales-invoice-command/contract.ts';

/** Bounded draft acts only. Issuance, delivery, collection, provider operation and authority
 * stay separate. SQL save_sales_billing_draft remains financial validation and write owner.
 * The adapter supplies create identity from a stable server operation, never model guesses.
 */
export type CommercialDraftCommand =
 | {action:'invoice.draft_create';draft:Record<string,unknown>}
 | {action:'invoice.draft_revise';invoice_id:string;expected_version:number;draft:Record<string,unknown>};
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const inputKeys=['schema_version','client_id','items','kind','deposit_basis_points','currency','cadence','recipient_email','recipient_phone','email_source_method_id','phone_source_method_id','billing_address','agreement_id','processor_intent','payment_method_intents','delivery_channel_intents','due_date','memo'];
const nullableId=(v:unknown)=>v===null||typeof v==='string'&&UUID.test(v);
const nullableText=(v:unknown,max:number)=>v===null||typeof v==='string'&&v.length<=max;
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
/** Structural boundary, not a second invoice calculator. Canonical SQL re-resolves all
 * client/catalog/contact/agreement resources and calculates financial facts after Trust.
 * Missing commercial facts must be obtained before this act; this parser supplies no defaults.
 */
export function parseCommercialDraftCommand(value:unknown):CommercialDraftCommand {
 const invalid=():never=>{throw new TypeError('COMMERCIAL_DRAFT_COMMAND_INVALID')};
 if(!object(value)||!['invoice.draft_create','invoice.draft_revise'].includes(String(value.action)))return invalid();
 const revise=value.action==='invoice.draft_revise';
 const allowed=revise?['action','invoice_id','expected_version','draft']:['action','draft'];
 if(Object.keys(value).length!==allowed.length||Object.keys(value).some(k=>!allowed.includes(k)))return invalid();
 if(revise&&(typeof value.invoice_id!=='string'||!UUID.test(value.invoice_id)||!Number.isSafeInteger(value.expected_version)||Number(value.expected_version)<1))return invalid();
 const d=value.draft;if(!object(d))return invalid();
 const exact=d.schema_version===3,keys=[...inputKeys,...(exact?['deposit_minor']:[])];
 if(Object.keys(d).length!==keys.length||Object.keys(d).some(k=>!keys.includes(k))||(d.schema_version!==2&&!exact)
  ||typeof d.client_id!=='string'||!UUID.test(d.client_id)||d.currency!=='usd'||!['one_time','deposit','recurring'].includes(String(d.kind))
  ||(d.kind==='recurring'?d.cadence!=='monthly':d.cadence!==null)||!date(d.due_date))return invalid();
 if(exact?(d.kind!=='deposit'||d.deposit_basis_points!==null||!Number.isSafeInteger(d.deposit_minor)||Number(d.deposit_minor)<1||Number(d.deposit_minor)>2147483647)
   :d.kind==='deposit'?(!Number.isSafeInteger(d.deposit_basis_points)||Number(d.deposit_basis_points)<1||Number(d.deposit_basis_points)>9999):d.deposit_basis_points!==null)return invalid();
 if(!Array.isArray(d.items)||d.items.length<1||d.items.length>50||d.items.some(i=>!object(i)
  ||Object.keys(i).some(k=>!['price_id','item','description','unit_minor','quantity'].includes(k))
  ||!nullableId(i.price_id)||typeof i.item!=='string'||!i.item.trim()||i.item.length>200
  ||('description' in i&&!nullableText(i.description,10000))||!Number.isSafeInteger(i.quantity)||Number(i.quantity)<1||Number(i.quantity)>1000
  ||(i.price_id===null?(!Number.isSafeInteger(i.unit_minor)||Number(i.unit_minor)<1||Number(i.unit_minor)>2147483647):i.unit_minor!==null)))return invalid();
 if(!nullableId(d.agreement_id)||!nullableId(d.email_source_method_id)||!nullableId(d.phone_source_method_id)
  ||!nullableText(d.recipient_email,254)||!nullableText(d.recipient_phone,40)||!nullableText(d.memo,2000)||!nullableText(d.processor_intent,80))return invalid();
 if(d.billing_address!==null){if(!object(d.billing_address)||Object.keys(d.billing_address).some(k=>!['line1','line2','city','region','postal_code','country'].includes(k))
  ||Object.entries(d.billing_address).some(([k,v])=>!nullableText(v,k==='line1'||k==='line2'?200:100)))return invalid();}
 if(!Array.isArray(d.payment_method_intents)||d.payment_method_intents.length>12||d.payment_method_intents.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(v))
  ||new Set(d.payment_method_intents).size!==d.payment_method_intents.length||!Array.isArray(d.delivery_channel_intents)||d.delivery_channel_intents.length>2
  ||d.delivery_channel_intents.some(v=>v!=='email'&&v!=='sms')||new Set(d.delivery_channel_intents).size!==d.delivery_channel_intents.length)return invalid();
 if(new TextEncoder().encode(JSON.stringify(d)).length>60000)return invalid();
 const draft=structuredClone(d);
 return revise?{action:'invoice.draft_revise',invoice_id:String(value.invoice_id).toLowerCase(),expected_version:Number(value.expected_version),draft}:{action:'invoice.draft_create',draft};
}
