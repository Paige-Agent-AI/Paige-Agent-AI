import {collectInvoiceLedger} from './sales-invoice-ledger.ts';

// E09 Payments: the customer's own portal session reading an invoice their business issued them.
// The client and the business are derived from the caller JWT on the server
// (public.client_portal_invoice_*); nothing here accepts a client id, mints a bearer grant, falls
// back to an owner read, or dispatches a payment. Read-only by construction.
type Reply={data:unknown;error:unknown};
export type PortalInvoiceCaller={
  auth:{getUser():PromiseLike<{data:{user:{id:string}|null}|null;error:unknown}>};
  rpc(name:string,args:Record<string,unknown>):PromiseLike<Reply>;
};
export type PortalInvoiceTarget={invoiceId:string;tenantId:string|null};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** invoice_id is required; tenant_id only narrows the caller's own relationship. Any other param is ignored. */
export function portalInvoiceTarget(params:URLSearchParams):PortalInvoiceTarget|null{
  const invoiceId=params.get('invoice_id'),tenantId=params.get('tenant_id');
  if(invoiceId===null||!UUID.test(invoiceId))return null;
  if(tenantId!==null&&!UUID.test(tenantId))return null;
  return {invoiceId,tenantId};
}

// The same signed-in subject must hold the session before and after the read; a session that
// changed mid-read answers nothing rather than a result read under someone else.
async function asSameSubject<T>(caller:PortalInvoiceCaller,read:()=>Promise<T|null>):Promise<T|null>{
  try{
    const before=await caller.auth.getUser(),subject=before.data?.user?.id;
    if(before.error||typeof subject!=='string'||!UUID.test(subject))return null;
    const value=await read();
    if(value===null)return null;
    const after=await caller.auth.getUser();
    if(after.error||after.data?.user?.id!==subject)return null;
    return value;
  }catch{return null;}
}

/** The visible invoice's frozen document and payment history, paged by the incumbent collector. */
export function readPortalInvoiceLedger(caller:PortalInvoiceCaller,target:PortalInvoiceTarget):Promise<Record<string,unknown>|null>{
  return asSameSubject(caller,async()=>{
    const projection=await collectInvoiceLedger(caller,'client_portal_invoice_ledger',{p_invoice_id:target.invoiceId,p_tenant_id:target.tenantId});
    return projection&&projection.invoice_id===target.invoiceId?projection:null;
  });
}

/** The business's EXISTING payment request, as the incumbent projection validates it. Never creates one. */
export function readPortalInvoicePaymentRequest(caller:PortalInvoiceCaller,target:PortalInvoiceTarget):Promise<Record<string,unknown>|null>{
  return asSameSubject(caller,async()=>{
    const {data,error}=await caller.rpc('client_portal_invoice_payment_request',{p_invoice_id:target.invoiceId,p_tenant_id:target.tenantId});
    if(error||!isObject(data)||data.invoice_id!==target.invoiceId)return null;
    return data;
  });
}
