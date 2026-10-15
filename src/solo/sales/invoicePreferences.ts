import {parseSalesInvoiceCommand} from '../../../supabase/functions/_shared/sales-invoice-command/contract';
export type InvoiceAppearance = {prefix:string;next_number:number;padding:number;template:'classic'|'modern'|'service';accent:string;logo_data_uri:string|null;footer:string;payment_instructions:string};
export type InvoicePreferences = {tenant_id:string;version:number;settings:InvoiceAppearance;can_manage:boolean};
export const DEFAULT_INVOICE_APPEARANCE:InvoiceAppearance={prefix:'INV-',next_number:1,padding:5,template:'classic',accent:'#4931ac',logo_data_uri:null,footer:'',payment_instructions:''};
export function readInvoicePreferences(value:unknown,tenantId:string):InvoicePreferences|null {
  if(!value||typeof value!=='object')return null;
  const r=value as Record<string,unknown>;
  if(r.tenant_id!==tenantId||!Number.isSafeInteger(r.version)||Number(r.version)<0||typeof r.can_manage!=='boolean')return null;
  const settings=r.settings as Record<string,unknown>|null;
  if(!settings||!Number.isSafeInteger(settings.next_number)||Number(settings.next_number)<1||Number(settings.next_number)>999999999)return null;
  // The terminal stored number is an exhausted sequence, not a new settings input.
  try{parseSalesInvoiceCommand({action:'invoice.settings_update',expected_version:r.version,settings:{...settings,next_number:Math.min(Number(settings.next_number),999999998)}});return r as unknown as InvoicePreferences;}catch{return null;}
}
export function invoiceNumberExample(value:InvoiceAppearance):string {return `${value.prefix}${String(value.next_number).padStart(value.padding,'0')}`;}
