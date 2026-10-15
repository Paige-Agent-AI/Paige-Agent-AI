import {object,type CollectionCommand} from '../../../../supabase/functions/_shared/sales-collections/contract';
import {currencyDigits} from './presentation';
export type ReceiptConsequence={invoice_number:string;currency:string;original_total_cents:number;remaining_cents:number;amount_cents:number;method:string;received_at:string;resulting_remaining_cents:number};
export function readReceiptConsequence(value:unknown,command:CollectionCommand):ReceiptConsequence|null{
 if(!['collection.record_receipt','collection.reverse_receipt'].includes(command.action)||!object(value))return null;
 const keys=['invoice_number','currency','original_total_cents','remaining_cents','amount_cents','method','received_at','resulting_remaining_cents'];if(Object.keys(value).some(k=>!keys.includes(k))||typeof value.invoice_number!=='string'||typeof value.currency!=='string'||currencyDigits(value.currency)===null||typeof value.method!=='string'||!['zelle','cash','wire','check','bank_transfer','other'].includes(value.method)||typeof value.received_at!=='string'||!Number.isFinite(Date.parse(value.received_at)))return null;
 for(const key of ['original_total_cents','remaining_cents','amount_cents','resulting_remaining_cents'])if(typeof value[key]!=='number'||!Number.isSafeInteger(value[key])||Number(value[key])<0)return null;
 if(Number(value.amount_cents)<=0||Number(value.remaining_cents)>Number(value.original_total_cents)||Number(value.resulting_remaining_cents)>Number(value.original_total_cents))return null;
 if(command.action==='collection.record_receipt'&&(value.currency!==command.currency||value.amount_cents!==command.amount_cents||value.method!==command.method||Date.parse(value.received_at)!==Date.parse(command.received_at)||value.resulting_remaining_cents!==Number(value.remaining_cents)-command.amount_cents))return null;
 if(command.action==='collection.reverse_receipt'&&value.resulting_remaining_cents!==Number(value.remaining_cents)+Number(value.amount_cents))return null;
 return value as ReceiptConsequence;
}
