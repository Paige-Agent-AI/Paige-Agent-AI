import {UUID,MAX_MINOR,MAX_SCHEDULE,object,invalid,integer,date,text,only} from './primitives.ts';
export {UUID,MAX_MINOR,MAX_SCHEDULE,object,invalid,integer,date,text,only} from './primitives.ts';
import {parseCommercialTermsCreateCommand,type CommercialTermsCreateCommand} from '../sales-commercial/terms-command.ts';
export const COLLECTION_ACTIONS = { 'collection.create_commercial_terms':'sales_create_commercial_terms', 'collection.save_terms': 'sales_save_collection_terms', 'collection.stage_import': 'sales_stage_collection_import', 'collection.commit_import': 'sales_commit_collection_import', 'collection.record_receipt':'sales_record_manual_payment', 'collection.reverse_receipt':'sales_reverse_manual_payment' } as const;
export type CollectionKind = 'full'|'installment'|'recurring'|'deposit'|'milestone'|'custom';
export type CollectionDate = { due_date:string; amount_cents:number; label:string|null };
export type CollectionTerms = {
  schema_version:1; kind:CollectionKind; currency:string; total_cents:number; anchor_date:string;
  cadence:'monthly'|'quarterly'|'annual'|'custom'; count:number|null; end_date:string|null;
  dates:CollectionDate[]; deposit_cents:number|null;
  late_fee:{fixed_cents:number;rate_bps:number;grace_days:number;agreement_basis:string|null};
  interest:{annual_bps:number;agreement_basis:string|null};
};
export function anchoredDate(anchor:string,index:number,months:number):string{
  const [year,month,day]=anchor.split('-').map(Number);const target=year*12+month-1+index*months;
  const y=Math.floor(target/12),m=target%12;if(y>9999)invalid();
  const end=new Date(Date.UTC(y,m+1,0)).getUTCDate();return `${String(y).padStart(4,'0')}-${String(m+1).padStart(2,'0')}-${String(Math.min(day,end)).padStart(2,'0')}`;
}
export function parseCollectionTerms(value:unknown):CollectionTerms{
  if(!object(value))return invalid();only(value,['schema_version','kind','currency','total_cents','anchor_date','cadence','count','end_date','dates','deposit_cents','late_fee','interest']);
  if(value.schema_version!==1||!['full','installment','recurring','deposit','milestone','custom'].includes(String(value.kind))||typeof value.currency!=='string'||!/^[a-z]{3}$/.test(value.currency)||!['monthly','quarterly','annual','custom'].includes(String(value.cadence)))return invalid();
  const kind=value.kind as CollectionKind,total=integer(value.total_cents,1),anchor=date(value.anchor_date),count=value.count==null?null:integer(value.count,1,MAX_SCHEDULE),end=value.end_date==null?null:date(value.end_date);
  if(end&&end<anchor)return invalid();
  if((kind==='full'&&count!==1)||(kind==='installment'&&(count===null||count<2))||(kind==='deposit'&&count!==2))return invalid();
  const dates:CollectionDate[]=[];
  if(value.dates!==undefined){if(!Array.isArray(value.dates)||value.dates.length>MAX_SCHEDULE)return invalid();for(const row of value.dates){if(!object(row))return invalid();only(row,['due_date','amount_cents','label']);dates.push({due_date:date(row.due_date),amount_cents:integer(row.amount_cents,1),label:text(row.label,120)});}}
  if(value.cadence==='custom'){
    if(!dates.length||dates[0].due_date!==anchor||(count!==null&&count!==dates.length)||dates.some((row,i)=>i>0&&row.due_date<=dates[i-1].due_date)||dates.some(row=>end!==null&&row.due_date>end))return invalid();
    if(kind!=='recurring'&&dates.reduce((sum,row)=>sum+row.amount_cents,0)!==total)return invalid();
    if(kind==='recurring'&&dates.some(row=>row.amount_cents!==total))return invalid();
  }else if(dates.length||kind==='milestone'||kind==='custom')return invalid();
  if(count!==null&&value.cadence!=='custom'){
    const last=anchoredDate(anchor,count-1,{monthly:1,quarterly:3,annual:12}[value.cadence as 'monthly'|'quarterly'|'annual']);
    if(end&&last>end)return invalid();
  }
  if(kind!=='recurring'&&value.cadence!=='custom'&&count!==null&&total<count)return invalid();
  const deposit=value.deposit_cents==null?null:integer(value.deposit_cents,1,total-1);if((kind==='deposit')!==(deposit!==null))return invalid();
  if(kind==='deposit'&&dates.length&&dates[0].amount_cents!==deposit)return invalid();
  const late=object(value.late_fee)?value.late_fee:{};const interest=object(value.interest)?value.interest:{};
  if(value.late_fee!=null&&!object(value.late_fee)||value.interest!=null&&!object(value.interest))return invalid();
  only(late,['fixed_cents','rate_bps','grace_days','agreement_basis']);only(interest,['annual_bps','agreement_basis']);
  const lateFee={fixed_cents:integer(late.fixed_cents??0),rate_bps:integer(late.rate_bps??0,0,10000),grace_days:integer(late.grace_days??0,0,3650),agreement_basis:text(late.agreement_basis,2000)};
  const interestTerms={annual_bps:integer(interest.annual_bps??0,0,10000),agreement_basis:text(interest.agreement_basis,2000)};
  if((lateFee.fixed_cents>0||lateFee.rate_bps>0)&&!lateFee.agreement_basis?.trim()||interestTerms.annual_bps>0&&!interestTerms.agreement_basis?.trim())return invalid();
  return {schema_version:1,kind,currency:value.currency,total_cents:total,anchor_date:anchor,cadence:value.cadence as CollectionTerms['cadence'],count:count??(dates.length||null),end_date:end,dates,deposit_cents:deposit,late_fee:lateFee,interest:interestTerms};
}

export type CollectionCommand =
 | CommercialTermsCreateCommand
 | {action:'collection.save_terms';agreement_id:string;expected_version:number;terms:CollectionTerms}
 | {action:'collection.stage_import';source_account:string;rows:CollectionImportRow[]}
 | {action:'collection.commit_import';batch_id:string;expected_digest:string}
 | {action:'collection.record_receipt';invoice_id:string;expected_version:number;amount_cents:number;currency:string;method:string;received_at:string;reference:string|null;notes:string|null}
 | {action:'collection.reverse_receipt';invoice_id:string;expected_version:number;payment_id:string;reason:string};
export type CollectionImportRow =
 | {entity:'invoice';entity_id:string;client_id:string;invoice_id:string|null;invoice_number:string;currency:string;amount_cents:number;due_date:string|null;memo:string|null}
 | {entity:'receipt';entity_id:string;invoice_entity_id:string|null;invoice_id:string|null;payment_id:string|null;currency:string;amount_cents:number;method:string;received_at:string;reference:string|null};
export type CollectionAgreementRow = {id:string;tenant_id:string;client_id:string;client_name:string|null;offer_id:string;title:string|null;status:string;agreed_amount_minor:number|null;agreed_currency:string|null;collection_terms:CollectionTerms|null;collection_terms_version:number;terms_current:boolean};
export type CollectionExportCursor = {snapshot_id:string;after_position:number;entity:'invoice'|'receipt'};
export type CollectionInvoiceRow = {id:string;tenant_id:string;client_id:string;client_name:string|null;invoice_number:string;source_invoice_number:string|null;status:string;version:number|null;amount_cents:number;currency:string;due_date:string|null;created_at:string;manual_recorded_cents:number;remaining_cents:number;receipt_count:number;record_kind:'managed'|'imported'|'provider_or_legacy';provenance:'owner_imported_unverified'|'canonical_record'};
export type CollectionReceiptRow = {id:string;tenant_id:string;invoice_id:string;client_id:string;client_name:string|null;invoice_number:string;source_invoice_number:string|null;kind:'receipt'|'reversal';amount_cents:number;currency:string;method:string;received_at:string;created_at:string;reference:string|null;notes:string|null;reason:string|null;actor_user_id:string;reverses_payment_id:string|null;provenance:'owner_imported_unverified'|'human_recorded'};
export type CollectionRegisterPage<T extends CollectionInvoiceRow|CollectionReceiptRow>={rows:T[];has_more:boolean;next_cursor:CollectionExportCursor|null;snapshot_at:string;membership_captured_at:string;facts_read_at:string;export_completed_at:string|null;membership_count:number;balance_basis:'manual_recorded_only';membership_boundary:'canonical_ids_snapshot'};
export type CollectionImportReview = {rows:{row:number;entity:'invoice'|'receipt';entity_id:string;already_imported:boolean;target_invoice_id:string|null}[];conflicts:{row:number;entity:'invoice'|'receipt';entity_id:string;code:string}[];eligible_commit:boolean;provenance:'owner_imported_unverified'};
export type CollectionImportBatch = {id:string;source_account:string;rows:CollectionImportRow[];content_digest:string;state:'staged'|'committed';review:CollectionImportReview;created_at?:string;committed_at?:string|null};
export function parseCollectionImportRows(value:unknown):CollectionImportRow[]{
  if(!Array.isArray(value)||value.length<1||value.length>200)return invalid();
  const seen=new Set<string>();return value.map(row=>{
    if(!object(row)||!['invoice','receipt'].includes(String(row.entity)))return invalid();
    const entityId=text(row.entity_id,200,true)!,key=`${row.entity}:${entityId}`;if(seen.has(key))return invalid();seen.add(key);
    const uuid=(v:unknown,nullable=true):string|null=>{if(v==null&&nullable)return null;if(typeof v!=='string'||!UUID.test(v))return invalid();return v.toLowerCase();};
    if(typeof row.currency!=='string'||!/^[a-z]{3}$/.test(row.currency))return invalid();
    const common={entity_id:entityId,currency:row.currency,amount_cents:integer(row.amount_cents,1)};
    if(row.entity==='invoice'){only(row,['entity','entity_id','client_id','invoice_id','invoice_number','currency','amount_cents','due_date','memo']);return {entity:'invoice',...common,client_id:uuid(row.client_id,false)!,invoice_id:uuid(row.invoice_id),invoice_number:text(row.invoice_number,100,true)!,due_date:row.due_date==null?null:date(row.due_date),memo:text(row.memo,2000)};}
    only(row,['entity','entity_id','invoice_entity_id','invoice_id','payment_id','currency','amount_cents','method','received_at','reference']);
    const invoiceId=uuid(row.invoice_id),invoiceEntity=text(row.invoice_entity_id,200);if((invoiceId===null)===(invoiceEntity===null))return invalid();
    if(typeof row.method!=='string'||!['zelle','cash','wire','check','bank_transfer','other'].includes(row.method)||typeof row.received_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(row.received_at))return invalid();
    const received=new Date(row.received_at);if(!Number.isFinite(received.valueOf())||received.toISOString().slice(0,19)!==row.received_at.slice(0,19))return invalid();
    return {entity:'receipt',...common,invoice_entity_id:invoiceEntity,invoice_id:invoiceId,payment_id:uuid(row.payment_id),method:row.method,received_at:received.toISOString(),reference:text(row.reference,200)};
  });
}
export function parseCollectionCommand(value:unknown):CollectionCommand{
  if(!object(value))return invalid();
  if(value.action==='collection.create_commercial_terms')return parseCommercialTermsCreateCommand(value);
  if(value.action==='collection.record_receipt'||value.action==='collection.reverse_receipt'){
    if(typeof value.invoice_id!=='string'||!UUID.test(value.invoice_id))return invalid();
    const common={invoice_id:value.invoice_id.toLowerCase(),expected_version:integer(value.expected_version,1,Number.MAX_SAFE_INTEGER)};
    if(value.action==='collection.reverse_receipt'){
      only(value,['action','invoice_id','expected_version','payment_id','reason']);if(typeof value.payment_id!=='string'||!UUID.test(value.payment_id))return invalid();
      return {action:value.action,...common,payment_id:value.payment_id.toLowerCase(),reason:text(value.reason,500,true)!};
    }
    only(value,['action','invoice_id','expected_version','amount_cents','currency','method','received_at','reference','notes']);
    if(typeof value.currency!=='string'||!/^[a-z]{3}$/.test(value.currency)||typeof value.method!=='string'||!['zelle','cash','wire','check','bank_transfer','other'].includes(value.method)||typeof value.received_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.received_at))return invalid();
    const received=new Date(value.received_at);if(!Number.isFinite(received.valueOf())||received.toISOString().slice(0,19)!==value.received_at.slice(0,19))return invalid();
    return {action:value.action,...common,amount_cents:integer(value.amount_cents,1),currency:value.currency,method:value.method,received_at:received.toISOString(),reference:text(value.reference,200),notes:text(value.notes,2000)};
  }
  if(value.action==='collection.save_terms'){only(value,['action','agreement_id','expected_version','terms']);if(typeof value.agreement_id!=='string'||!UUID.test(value.agreement_id))return invalid();return {action:value.action,agreement_id:value.agreement_id.toLowerCase(),expected_version:integer(value.expected_version,0,Number.MAX_SAFE_INTEGER),terms:parseCollectionTerms(value.terms)};}
  if(value.action==='collection.stage_import'){only(value,['action','source_account','rows']);return {action:value.action,source_account:text(value.source_account,200,true)!,rows:parseCollectionImportRows(value.rows)};}
  if(value.action==='collection.commit_import'){only(value,['action','batch_id','expected_digest']);if(typeof value.batch_id!=='string'||!UUID.test(value.batch_id)||typeof value.expected_digest!=='string'||!/^[a-f0-9]{64}$/.test(value.expected_digest))return invalid();return {action:value.action,batch_id:value.batch_id.toLowerCase(),expected_digest:value.expected_digest};}
  return invalid();
}
