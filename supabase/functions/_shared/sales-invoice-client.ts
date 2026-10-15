import {collectInvoiceLedger} from './sales-invoice-ledger.ts';

type Reply={data:unknown;error:unknown};
type Caller={
  auth:{getUser():PromiseLike<{data:{user:{id:string}|null}|null;error:unknown}>};
  rpc(name:string,args:Record<string,unknown>):PromiseLike<Reply>;
};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Actual caller JWT plus canonical client scope; no bearer mint or owner fallback. */
export async function readAuthenticatedClientInvoiceLedger(
  caller:Caller,target:{tenantId:unknown;clientId:unknown;invoiceId:unknown},
):Promise<Record<string,unknown>|null>{
  const {tenantId,clientId,invoiceId}=target;
  if(!uuid(tenantId)||!uuid(clientId)||!uuid(invoiceId))return null;
  try{
    const before=await caller.auth.getUser();
    const actorId=before.data?.user?.id;
    if(before.error||!uuid(actorId))return null;
    const projection=await collectInvoiceLedger(caller,'read_client_sales_invoice_payment_ledger_scoped',{
      p_expected_actor_id:actorId,p_expected_tenant_id:tenantId,p_client_id:clientId,p_invoice_id:invoiceId,
    });
    if(!projection||projection.invoice_id!==invoiceId)return null;
    const after=await caller.auth.getUser();
    if(after.error||after.data?.user?.id!==actorId)return null;
    return projection;
  }catch{return null;}
}

/** Read only the canonical approved request; no provider dispatch or bearer grant. */
export async function readAuthenticatedClientInvoicePaymentRequest(
  caller:Caller,target:{tenantId:unknown;clientId:unknown;invoiceId:unknown},
):Promise<Record<string,unknown>|null>{
  const {tenantId,clientId,invoiceId}=target;
  if(!uuid(tenantId)||!uuid(clientId)||!uuid(invoiceId))return null;
  try{
    const before=await caller.auth.getUser(),actorId=before.data?.user?.id;
    if(before.error||!uuid(actorId))return null;
    const {data,error}=await caller.rpc('read_client_sales_invoice_payment_request_scoped',{
      p_expected_actor_id:actorId,p_expected_tenant_id:tenantId,p_client_id:clientId,p_invoice_id:invoiceId,
    });
    if(error||!data||typeof data!=='object'||Array.isArray(data))return null;
    const result=data as Record<string,unknown>;
    if(result.invoice_id!==invoiceId)return null;
    const after=await caller.auth.getUser();
    if(after.error||after.data?.user?.id!==actorId)return null;
    return result;
  }catch{return null;}
}
