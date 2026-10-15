import {expect,it,vi} from 'vitest';
import {readAuthenticatedClientInvoiceLedger,readAuthenticatedClientInvoicePaymentRequest} from '../../supabase/functions/_shared/sales-invoice-client';

const id=(n:number)=>`ec041101-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),target={tenantId:id(2),clientId:id(3),invoiceId:id(4)};
const page=()=>({invoice_id:target.invoiceId,current_invoice_number:'SYN-1',version:1,
  payment_ledger:{rows:[{id:id(5),kind:'receipt'}],count:1,as_of:'2026-10-14T12:00:00Z'},has_more:false,next_cursor:null});
function fixture(){return {
  auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}},error:null})},
  rpc:vi.fn().mockResolvedValue({data:page(),error:null}),
};}
it('uses only actual authenticated client scope and the existing canonical ledger collector',async()=>{
  const caller=fixture();const result=await readAuthenticatedClientInvoiceLedger(caller,target);
  expect(result?.ledger_complete).toBe(true);expect(caller.auth.getUser).toHaveBeenCalledTimes(2);
  expect(caller.rpc).toHaveBeenCalledWith('read_client_sales_invoice_payment_ledger_scoped',{
    p_expected_actor_id:actor,p_expected_tenant_id:target.tenantId,p_client_id:target.clientId,p_invoice_id:target.invoiceId,_limit:100,_cursor:null,
  });
});
it('refuses unverified callers and malformed selectors before dispatch',async()=>{
  const caller=fixture();expect(await readAuthenticatedClientInvoiceLedger(caller,{...target,clientId:'bad'})).toBeNull();
  expect(caller.auth.getUser).not.toHaveBeenCalled();caller.auth.getUser.mockResolvedValue({data:{user:null},error:null});
  expect(await readAuthenticatedClientInvoiceLedger(caller,target)).toBeNull();expect(caller.rpc).not.toHaveBeenCalled();
});
it('never retries a refused client read through owner or bearer authority',async()=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data:null,error:{code:'42501'}});
  expect(await readAuthenticatedClientInvoiceLedger(caller,target)).toBeNull();expect(caller.rpc).toHaveBeenCalledTimes(1);
  expect(caller.rpc.mock.calls[0][0]).toBe('read_client_sales_invoice_payment_ledger_scoped');
});
it('rejects a returned invoice identity that differs from the exact request',async()=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data:{...page(),invoice_id:id(9)},error:null});
  expect(await readAuthenticatedClientInvoiceLedger(caller,target)).toBeNull();
});
it('rejects an actor change after the canonical ledger read',async()=>{
  const caller=fixture();caller.auth.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:id(9)}},error:null});
  expect(await readAuthenticatedClientInvoiceLedger(caller,target)).toBeNull();
});
it('reuses immutable ledger cursor/version consistency across pages',async()=>{
  const caller=fixture();const first=page();first.payment_ledger.count=2;first.has_more=true;
  const cursor={invoice_id:target.invoiceId,version:1,ordinal:1};Object.assign(first,{next_cursor:cursor});
  const second=page();second.payment_ledger.count=2;second.payment_ledger.rows=[{id:id(6),kind:'reversal'}];
  caller.rpc.mockResolvedValueOnce({data:first,error:null}).mockResolvedValueOnce({data:second,error:null});
  const result=await readAuthenticatedClientInvoiceLedger(caller,target);
  expect(result?.ledger_complete).toBe(true);expect(caller.rpc.mock.calls[1][1]._cursor).toEqual(cursor);
  expect((result?.payment_ledger as {rows:unknown[]}).rows).toHaveLength(2);
});
it('refuses changed ledger version rather than displaying a torn document',async()=>{
  const caller=fixture();const first=page();first.payment_ledger.count=2;first.has_more=true;Object.assign(first,{next_cursor:{ordinal:1}});
  caller.rpc.mockResolvedValueOnce({data:first,error:null}).mockResolvedValueOnce({data:{...page(),version:2},error:null});
  expect(await readAuthenticatedClientInvoiceLedger(caller,target)).toBeNull();
});
it('binds the original selector values before asynchronous session verification',async()=>{
  const caller=fixture(),selected={...target};caller.auth.getUser.mockImplementation(async()=>{
    selected.invoiceId=id(9);return {data:{user:{id:actor}},error:null};
  });
  expect((await readAuthenticatedClientInvoiceLedger(caller,selected))?.invoice_id).toBe(target.invoiceId);
  expect(caller.rpc.mock.calls[0][1].p_invoice_id).toBe(target.invoiceId);
});
it('reads only the exact client-scoped approved payment request without dispatch',async()=>{
  const caller=fixture();const reply={invoice_id:target.invoiceId,remaining_cents:305000,payment_request:{environment:'test'}};
  caller.rpc.mockResolvedValue({data:reply,error:null});
  expect(await readAuthenticatedClientInvoicePaymentRequest(caller,target)).toEqual(reply);
  expect(caller.rpc).toHaveBeenCalledExactlyOnceWith('read_client_sales_invoice_payment_request_scoped',{
    p_expected_actor_id:actor,p_expected_tenant_id:target.tenantId,p_client_id:target.clientId,p_invoice_id:target.invoiceId,
  });expect(caller.auth.getUser).toHaveBeenCalledTimes(2);
});
it('rejects wrong invoice, refused request or a changed authenticated actor without fallback',async()=>{
  for(const kind of ['wrong_invoice','refused','changed_actor']){
    const caller=fixture();caller.rpc.mockResolvedValue(kind==='refused'?{data:null,error:{code:'42501'}}:{data:{invoice_id:kind==='wrong_invoice'?id(9):target.invoiceId},error:null});
    if(kind==='changed_actor')caller.auth.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:id(9)}},error:null});
    expect(await readAuthenticatedClientInvoicePaymentRequest(caller,target)).toBeNull();expect(caller.rpc).toHaveBeenCalledTimes(1);
  }
});
