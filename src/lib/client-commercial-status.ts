import {readLinkedPortalClient,type ClientDeliveryPortalPort,type LinkedPortalClient,type PortalLinkRead} from './client-delivery-portal';
import {readAllocatedBalance} from '../../supabase/functions/_shared/sales-payments/balance-projection';

type Row=Record<string,unknown>;
export type ClientCommercialCursor=Readonly<{issued_at:string;id:string}>;
export type ClientInvoiceSummary=Readonly<{
  id:string;invoiceNumber:string|null;status:'issued'|'void'|'recorded';
  currency:string;issuedAt:string;dueDate:string|null;issuedSnapshotVersion:number|null;
  amountMinor:string;allocatedMinor:string;remainingMinor:string;manualRecordedMinor:string;
  providerVerifiedMinor:string;testProviderMinor:string;documentAvailable:boolean;
}>;
export type ClientBalance=Readonly<{
  currency:string;remainingMinor:string;manualRecordedMinor:string;providerVerifiedMinor:string;testProviderMinor:string;
}>;
export type ClientInvoiceDetail=Omit<ClientInvoiceSummary,'issuedAt'|'dueDate'|'documentAvailable'>&Readonly<{document:Row|null}>;
export type ClientCommercialStatus=Readonly<{
  invoices:readonly ClientInvoiceSummary[];invoiceCount:number;hasMore:boolean;nextCursor:ClientCommercialCursor|null;
  balances:readonly ClientBalance[];invoice:ClientInvoiceDetail|null;readAt:string;
  nextPayment:Readonly<{state:'unavailable';reason:'effective_due_obligation_not_recorded'}>;
  engagementCompletion:Readonly<{state:'not_evaluated'}>;
}>;
export type ClientCommercialRead={kind:'ready';scope:LinkedPortalClient;status:ClientCommercialStatus}
  |Exclude<PortalLinkRead,{kind:'ready'}>;

const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const timestamp=(v:unknown):v is string=>typeof v==='string'&&v.length<=50&&Number.isFinite(Date.parse(v));
const minor=(v:unknown):v is string=>typeof v==='string'&&/^-?(?:0|[1-9][0-9]{0,37})$/.test(v);
const currency=(v:unknown):v is string=>typeof v==='string'&&/^[a-z]{3}$/.test(v);
const same=(a:LinkedPortalClient,b:LinkedPortalClient)=>a.actorId===b.actorId&&a.tenantId===b.tenantId&&a.clientId===b.clientId;
function balance(value:unknown):ClientBalance|null{
  if(!object(value)||!currency(value.currency)||![value.remaining_minor,value.manual_recorded_minor,value.provider_verified_minor,value.test_provider_minor].every(minor))return null;
  return Object.freeze({currency:value.currency,remainingMinor:value.remaining_minor as string,
    manualRecordedMinor:value.manual_recorded_minor as string,providerVerifiedMinor:value.provider_verified_minor as string,testProviderMinor:value.test_provider_minor as string});
}
function invoice(value:unknown,detail=false):ClientInvoiceSummary|ClientInvoiceDetail|null{
  if(!object(value)||!uuid(value.id)||!currency(value.currency)
    ||typeof value.status!=='string'||!['issued','void','recorded'].includes(value.status)
    ||!(value.invoice_number===null||typeof value.invoice_number==='string'&&value.invoice_number.length<=200)
    ||!(value.issued_snapshot_version===null||Number.isSafeInteger(value.issued_snapshot_version)&&Number(value.issued_snapshot_version)>0)
    ||![value.amount_minor,value.allocated_minor,value.remaining_minor,value.manual_recorded_minor,value.provider_verified_minor,value.test_provider_minor].every(minor))return null;
  const canonical=readAllocatedBalance({manual_recorded_cents:Number(value.manual_recorded_minor),provider_verified_cents:Number(value.provider_verified_minor),
    allocated_cents:Number(value.allocated_minor),remaining_cents:Number(value.remaining_minor)},Number(value.amount_minor));
  const testAmount=Number(value.test_provider_minor);
  if(!canonical||!Number.isSafeInteger(testAmount)||testAmount<0||testAmount>canonical.verified)return null;
  const common={id:value.id,invoiceNumber:value.invoice_number as string|null,status:value.status as ClientInvoiceSummary['status'],currency:value.currency,
    issuedSnapshotVersion:value.issued_snapshot_version as number|null,amountMinor:value.amount_minor as string,
    allocatedMinor:value.allocated_minor as string,remainingMinor:value.remaining_minor as string,
    manualRecordedMinor:value.manual_recorded_minor as string,providerVerifiedMinor:value.provider_verified_minor as string,testProviderMinor:value.test_provider_minor as string};
  if(detail){
    if(value.document!==null&&!object(value.document))return null;
    return Object.freeze({...common,document:value.document as Row|null});
  }
  if(!timestamp(value.issued_at)||typeof value.document_available!=='boolean'
    ||!(value.due_date===null||typeof value.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.due_date)))return null;
  return Object.freeze({...common,issuedAt:value.issued_at,dueDate:value.due_date as string|null,documentAvailable:value.document_available});
}
/** This narrows a canonical read, never computes a balance, next due or settlement. */
export function projectClientCommercialStatus(value:unknown,scope:LinkedPortalClient,invoiceId?:string):ClientCommercialStatus|null{
  if(!object(value)||value.schema_version!==1||value.actor_id!==scope.actorId||value.tenant_id!==scope.tenantId||value.client_id!==scope.clientId
    ||value.balance_basis!=='canonical_invoice_allocations'||!timestamp(value.read_at)
    ||!Array.isArray(value.invoices)||value.invoices.length>40||!Array.isArray(value.balances)
    ||typeof value.has_more!=='boolean'||!Number.isSafeInteger(value.invoice_count)||Number(value.invoice_count)<value.invoices.length
    ||!object(value.next_payment)||value.next_payment.state!=='unavailable'||value.next_payment.reason!=='effective_due_obligation_not_recorded'
    ||!object(value.engagement_completion)||value.engagement_completion.state!=='not_evaluated')return null;
  const invoices=value.invoices.map(row=>invoice(row));
  const balances=value.balances.map(balance);
  if(invoices.some(row=>row===null)||balances.some(row=>row===null)
    ||new Set(invoices.map(row=>row!.id)).size!==invoices.length
    ||new Set(balances.map(row=>row!.currency)).size!==balances.length)return null;
  let nextCursor:ClientCommercialCursor|null=null;
  if(value.has_more){
    const cursor=value.next_cursor,last=invoices[invoices.length-1] as ClientInvoiceSummary|undefined;
    if(!object(cursor)||!uuid(cursor.id)||!timestamp(cursor.issued_at)||!last||cursor.id!==last.id||cursor.issued_at!==last.issuedAt||Number(value.invoice_count)<=invoices.length)return null;
    nextCursor=Object.freeze({id:cursor.id,issued_at:cursor.issued_at});
  }else if(value.next_cursor!==null)return null;
  const detail=value.invoice===null?null:invoice(value.invoice,true) as ClientInvoiceDetail|null;
  if(invoiceId?detail?.id!==invoiceId:value.invoice!==null)return null;
  return Object.freeze({invoices:Object.freeze(invoices as ClientInvoiceSummary[]),balances:Object.freeze(balances as ClientBalance[]),
    invoiceCount:Number(value.invoice_count),hasMore:value.has_more,nextCursor,invoice:detail,readAt:value.read_at,
    nextPayment:Object.freeze({state:'unavailable',reason:'effective_due_obligation_not_recorded'}),engagementCompletion:Object.freeze({state:'not_evaluated'})});
}

/** Use the existing actual-user/self-link proof before and after every SDK read. */
export async function readClientCommercialStatus(
  caller:ClientDeliveryPortalPort,actorId:string,current:()=>boolean,
  options:{invoiceId?:string;after?:ClientCommercialCursor}={},
):Promise<ClientCommercialRead>{
  if(!current())return {kind:'scope_changed'};
  if(options.invoiceId!==undefined&&!uuid(options.invoiceId))return {kind:'unavailable'};
  if(options.after&&(!uuid(options.after.id)||!timestamp(options.after.issued_at)))return {kind:'unavailable'};
  try{
    const before=await readLinkedPortalClient(caller,actorId,current);
    if(!current())return {kind:'scope_changed'};
    if(before.kind!=='ready')return before;
    const reply=await caller.rpc('read_client_commercial_status_scoped',{
      p_expected_actor_id:before.scope.actorId,p_expected_tenant_id:before.scope.tenantId,p_client_id:before.scope.clientId,
      p_invoice_id:options.invoiceId??null,p_limit:40,p_after:options.after??null,
    });
    if(!current())return {kind:'scope_changed'};
    const after=await readLinkedPortalClient(caller,actorId,current);
    if(!current())return {kind:'scope_changed'};
    if(after.kind!=='ready')return after;
    if(!same(before.scope,after.scope))return {kind:'refused'};
    if(reply.error)return object(reply.error)&&['42501','40001','22023'].includes(String(reply.error.code))?{kind:'refused'}:{kind:'unavailable'};
    const status=projectClientCommercialStatus(reply.data,after.scope,options.invoiceId);
    return status?{kind:'ready',scope:after.scope,status}:{kind:'unavailable'};
  }catch{return {kind:current()?'unavailable':'scope_changed'};}
}
