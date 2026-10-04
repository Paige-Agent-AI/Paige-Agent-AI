import {supabase} from '@/integrations/supabase/client';
import {UUID,parseCollectionTerms,type CollectionTerms} from '../../../../supabase/functions/_shared/sales-collections/contract';
import type {BillingRpc} from '../billingDrafts';
export type Agreement={id:string;tenant_id:string;client_id:string;client_name:string|null;title:string;status:string;agreed_amount_minor:number|null;agreed_currency:string|null;collection_terms:CollectionTerms|null;collection_terms_version:number;terms_current:boolean};
export type CollectionInvoice={id:string;tenant_id:string;client_id:string;client_name:string|null;invoice_number:string;source_invoice_number:string|null;status:string;version:number|null;amount_cents:number;currency:string;due_date:string|null;created_at:string;manual_recorded_cents:number;remaining_cents:number;receipt_count:number;record_kind:'managed'|'imported'|'provider_or_legacy';provenance:'owner_imported_unverified'|'canonical_record'};
export type CollectionReceipt={id:string;tenant_id:string;invoice_id:string;client_id:string;client_name:string|null;invoice_number:string;source_invoice_number:string|null;kind:'receipt'|'reversal';amount_cents:number;currency:string;method:string;received_at:string;created_at:string;reference:string|null;notes:string|null;reason:string|null;actor_user_id:string;reverses_payment_id:string|null;provenance:'owner_imported_unverified'|'human_recorded'};
export type RegisterCursor={snapshot_id:string;after_position:number;entity:'invoice'|'receipt'};
export type RegisterPage<T>={rows:T[];has_more:boolean;next_cursor:RegisterCursor|null;snapshot_at:string;membership_captured_at:string;facts_read_at:string;export_completed_at:string|null;membership_count:number;balance_basis:'manual_recorded_only';membership_boundary:'canonical_ids_snapshot'};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const int=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const id=(v:unknown)=>typeof v==='string'&&UUID.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const nullable=(v:unknown)=>v===null||typeof v==='string';
export function decodeInvoice(v:unknown,tenant:string):CollectionInvoice|null{
 if(!obj(v)||v.tenant_id!==tenant||!id(v.id)||!id(v.client_id)||!nullable(v.client_name)||typeof v.invoice_number!=='string'||!nullable(v.source_invoice_number)||typeof v.status!=='string'||!(v.version===null||int(v.version)&&Number(v.version)>=1)||!int(v.amount_cents)||!int(v.manual_recorded_cents)||!int(v.remaining_cents)||v.remaining_cents!==Number(v.amount_cents)-Number(v.manual_recorded_cents)||!int(v.receipt_count)||typeof v.currency!=='string'||!/^[a-z]{3}$/.test(v.currency)||!nullable(v.due_date)||!stamp(v.created_at)||!['managed','imported','provider_or_legacy'].includes(String(v.record_kind))||!['owner_imported_unverified','canonical_record'].includes(String(v.provenance)))return null;
 if(v.record_kind==='imported'&&v.provenance!=='owner_imported_unverified')return null;
 return v as unknown as CollectionInvoice;
}
export function decodeReceipt(v:unknown,tenant:string):CollectionReceipt|null{
 if(!obj(v)||v.tenant_id!==tenant||!id(v.id)||!id(v.invoice_id)||!id(v.client_id)||!id(v.actor_user_id)||!nullable(v.client_name)||typeof v.invoice_number!=='string'||!nullable(v.source_invoice_number)||!['receipt','reversal'].includes(String(v.kind))||!int(v.amount_cents)||v.amount_cents===0||typeof v.currency!=='string'||!/^[a-z]{3}$/.test(v.currency)||typeof v.method!=='string'||!stamp(v.received_at)||!stamp(v.created_at)||!nullable(v.reference)||!nullable(v.notes)||!nullable(v.reason)||!(v.reverses_payment_id===null||id(v.reverses_payment_id))||!['owner_imported_unverified','human_recorded'].includes(String(v.provenance)))return null;
 return v as unknown as CollectionReceipt;
}
export function decodeRegister<T>(v:unknown,tenant:string,entity:'invoice'|'receipt',decode:(v:unknown,t:string)=>T|null):RegisterPage<T>|null{
 if(!obj(v)||!Array.isArray(v.rows)||v.rows.length>50||typeof v.has_more!=='boolean'||!stamp(v.snapshot_at)||!stamp(v.membership_captured_at)||!stamp(v.facts_read_at)||!(v.export_completed_at===null||stamp(v.export_completed_at))||!int(v.membership_count)||Number(v.membership_count)>10000||v.balance_basis!=='manual_recorded_only'||v.membership_boundary!=='canonical_ids_snapshot')return null;
 const c=v.next_cursor;if(c!==null&&(!obj(c)||c.entity!==entity||!id(c.snapshot_id)||!int(c.after_position)))return null;
 if(v.has_more!==(c!==null))return null;
 const rows=v.rows.map(row=>decode(row,tenant));if(rows.some(row=>row===null))return null;
 return {...v,rows} as unknown as RegisterPage<T>;
}
export function decodeAgreement(v:unknown,tenant:string):Agreement|null{
 if(!obj(v)||v.tenant_id!==tenant||!id(v.id)||!id(v.client_id)||!nullable(v.client_name)||typeof v.title!=='string'||typeof v.status!=='string'||!int(v.collection_terms_version)||typeof v.terms_current!=='boolean'||!(v.agreed_amount_minor===null||int(v.agreed_amount_minor))||!nullable(v.agreed_currency))return null;
 try{return {...v,collection_terms:v.collection_terms===null?null:parseCollectionTerms(v.collection_terms)} as unknown as Agreement}catch{return null}
}
const rpc:BillingRpc=(name,args)=>(supabase.rpc as unknown as BillingRpc).call(supabase,name,args);
export async function readRegister<T>(tenant:string,entity:'invoice'|'receipt',cursor:RegisterCursor|null,decode:(v:unknown,t:string)=>T|null):Promise<RegisterPage<T>>{
 const {data,error}=await rpc('list_sales_collection_register',{_expected_tenant_id:tenant,_entity:entity,_limit:50,_cursor:cursor});const result=!error?decodeRegister(data,tenant,entity,decode):null;if(!result)throw new Error('Collections could not be read.');return result;
}
export async function readAgreements(tenant:string,before:string|null=null):Promise<{rows:Agreement[];has_more:boolean;next_cursor:string|null}>{
 const {data,error}=await rpc('list_sales_collection_agreements',{_expected_tenant_id:tenant,_limit:50,_before_id:before});if(error||!obj(data)||!Array.isArray(data.rows)||data.rows.length>50||typeof data.has_more!=='boolean'||!(data.next_cursor===null||id(data.next_cursor))||data.has_more!==(data.next_cursor!==null))throw Error('Agreements could not be read.');const rows=data.rows.map(v=>decodeAgreement(v,tenant));if(rows.some(v=>!v))throw Error('Agreements could not be read.');return {rows:rows as Agreement[],has_more:data.has_more,next_cursor:data.next_cursor as string|null};
}
export function escapeCsv(value:unknown):string{let cell=String(value??'');if(/^\s*[=+@-]/.test(cell))cell="'"+cell;return '"'+cell.replace(/"/g,'""')+'"'}
export async function exportRegister(tenant:string,entity:'invoice'|'receipt'):Promise<string>{
 const all:(CollectionInvoice|CollectionReceipt)[]=[],seen=new Set<string>();let cursor:RegisterCursor|null=null;let snapshot:string|null=null;let completed:string|null=null;
 do{const page=entity==='invoice'?await readRegister(tenant,entity,cursor,decodeInvoice):await readRegister(tenant,entity,cursor,decodeReceipt);if(snapshot&&snapshot!==page.membership_captured_at)throw Error('Export snapshot changed. Retry.');snapshot=page.membership_captured_at;completed=page.export_completed_at;for(const row of page.rows){if(seen.has(row.id))throw Error('Export cursor repeated. Retry.');seen.add(row.id);all.push(row)}cursor=page.next_cursor;if(all.length>10000)throw Error('Export exceeds 10,000 records. Narrow the export.');}while(cursor);
 const columns=entity==='invoice'?['id','client_id','client_name','invoice_number','source_invoice_number','status','amount_cents','manual_recorded_cents','remaining_cents','currency','due_date','provenance']:['id','client_id','client_name','invoice_id','invoice_number','source_invoice_number','kind','amount_cents','currency','method','received_at','reference','provenance'];return [['membership_captured_at',snapshot,'export_completed_at',completed,'financial_facts','read_time'].map(escapeCsv).join(','),columns.map(escapeCsv).join(','),...all.map(row=>columns.map(c=>escapeCsv((row as unknown as Record<string,unknown>)[c])).join(','))].join('\r\n');
}
