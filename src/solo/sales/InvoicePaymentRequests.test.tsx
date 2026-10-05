import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {InvoicePaymentRequests} from './InvoicePaymentRequests';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({rpc:vi.fn(),review:null as unknown}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
const tenant='11111111-1111-4111-8111-111111111111',invoice='22222222-2222-4222-8222-222222222222',operation='33333333-3333-4333-8333-333333333333';
it('blocks a new request while an unknown operation exists and checks the saved identity',async()=>{
 h.rpc.mockResolvedValue({data:{rows:[{id:operation,provider:'stripe',purpose:'partial',invoice_version:3,amount_minor:50000,currency:'usd',state:'outcome_unknown'}]},error:null});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>{root.render(<InvoicePaymentRequests tenantId={tenant} invoiceId={invoice} version={4} remaining={300000} canManage onReview={(command,operationId)=>{h.review={command,operationId,tenantId:tenant};}}/>);await Promise.resolve();});const buttons=[...host.querySelectorAll('button')];expect(buttons.find(b=>b.textContent==='Request customer payment')?.disabled).toBe(true);await act(async()=>buttons.find(b=>b.textContent==='Check existing request')!.click());expect(h.review).toMatchObject({operationId:operation,tenantId:tenant,command:{action:'invoice.payment_request',invoice_id:invoice,expected_version:3,amount_minor:50000,purpose:'partial',provider:'stripe'}});}finally{act(()=>root.unmount());host.remove();}
});
it('does not enable payment initiation when the canonical request list cannot be read',async()=>{
 h.rpc.mockResolvedValue({data:null,error:{message:'denied'}});const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>{root.render(<InvoicePaymentRequests tenantId={tenant} invoiceId={invoice} version={4} remaining={300000} canManage onReview={(command,operationId)=>{h.review={command,operationId,tenantId:tenant};}}/>);await Promise.resolve();});expect(host.textContent).toContain('Payment requests could not be read');expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Request customer payment')).toBe(false);}finally{act(()=>root.unmount());host.remove();}
});

it('announces a rejected operation read and offers retry rather than remaining in loading',async()=>{h.rpc.mockRejectedValue(Error('Network'));const host=document.createElement('div');document.body.append(host);const root=createRoot(host);try{await act(async()=>{root.render(<InvoicePaymentRequests tenantId={tenant} invoiceId={invoice} version={4} remaining={300000} canManage onReview={()=>{}}/>);await Promise.resolve();});expect(host.textContent).toContain('Payment requests could not be read');expect(host.querySelector('[role="alert"]')).not.toBeNull();expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Retry payment status')).toBe(true);}finally{act(()=>root.unmount());host.remove();}});
