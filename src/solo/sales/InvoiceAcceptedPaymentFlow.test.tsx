// Actual original components and retained-record decoder; synthetic SDK ports.
// No authenticated identity, native write, provider or settlement proof.
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {InvoiceLifecycleActions} from './InvoiceLifecycleActions';
import {acceptedPlanFixture,acceptedPlanFixtureIds as ids} from '../../../scripts/live-drive/sales-payments/accepted-plan-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),pending:null as Promise<unknown>|null,callbacks:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock('../../../supabase/functions/_shared/sales-payments/accepted-obligation-read',async importOriginal=>{
 const original=await importOriginal<typeof import('../../../supabase/functions/_shared/sales-payments/accepted-obligation-read')>();
 return{...original,readAcceptedInvoicePaymentPlan:(...args:Parameters<typeof original.readAcceptedInvoicePaymentPlan>)=>{const pending=original.readAcceptedInvoicePaymentPlan(...args);h.pending=pending;return pending}};
});
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,functions:{invoke:h.invoke},auth:{
 getSession:async()=>({data:{session:{user:{id:'66666666-6666-4666-8666-666666666666'}}}}),
 onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{h.callbacks.add(callback);return{data:{subscription:{unsubscribe(){h.callbacks.delete(callback)}}}}},
}}}));
let host:HTMLDivElement,root:Root,fixture:Awaited<ReturnType<typeof acceptedPlanFixture>>,operations:Array<Record<string,unknown>>;
const changed=vi.fn();
beforeEach(async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);fixture=await acceptedPlanFixture();operations=[];h.pending=null;h.callbacks.clear();h.rpc.mockReset();h.invoke.mockReset();changed.mockReset();
 h.rpc.mockImplementation(async(name:string)=>({data:name==='read_sales_invoice'?fixture.raw:name==='list_sales_invoice_payment_operations'?{rows:operations}:name==='read_sales_accepted_invoice_obligations'?fixture.native:[],error:null}));
});
afterEach(()=>{act(()=>root.unmount());host.remove()});
const render=()=>act(async()=>{root.render(<InvoiceLifecycleActions tenantId={ids.tenant} invoiceId={ids.invoice} version={2} canManage onChanged={changed}/>);await Promise.resolve()});
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===label);
const click=async(label:string)=>act(async()=>{const target=button(label);expect(target).toBeDefined();target!.click();await Promise.resolve()});
const inspect=async()=>{await click('Read accepted payment plan');expect(h.pending).not.toBeNull();await act(async()=>{await h.pending})};
const field=async(value:string)=>act(()=>{const input=host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;expect(input).not.toBeNull();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))});
it('preserves the inspected plan/selection across the original approval and returns focus after original status reload',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Review the exact accepted payment',preview:{invoice_number:'INV-1042',remaining_cents:350000,client_name:'Synthetic client',client_id:ids.client,invoice_id:ids.invoice,amount_minor:30000,currency:'usd',provider:'stripe',merchant_account_id:'acct_fixture',environment:'test'}},error:null});
 await render();await inspect();await click('Select payment 2');const originalPlan=host.querySelector('[aria-label="Accepted payment plan"]');
 await click('Review selected payment request');expect(h.invoke).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await click('Prepare review');expect(h.invoke.mock.calls[0][1].body.command).toEqual({action:'invoice.payment_request',invoice_id:ids.invoice,expected_version:2,provider:'stripe',purpose:'installment',obligation_reference:fixture.view.obligations[1].reference});
 await click('Cancel');expect(host.querySelector('[aria-label="Accepted payment plan"]')).toBe(originalPlan);expect(button('Payment 2 selected')).toBeDefined();
 expect(document.activeElement).toBe(button('Review selected payment request'));expect(h.rpc.mock.calls.filter(([name])=>name==='read_sales_accepted_invoice_obligations')).toHaveLength(1);
 expect(h.rpc.mock.calls.filter(([name])=>name==='list_sales_invoice_payment_operations')).toHaveLength(2);expect(h.callbacks.size).toBe(1);expect(changed).not.toHaveBeenCalled();
});
it('recovers the same original unknown request and accepted selector rather than initiating another payment',async()=>{
 h.invoke.mockImplementation(async(_name:string,{body}:{body:{operation_id:string;command:Record<string,unknown>}})=>{
  if(h.invoke.mock.calls.length===1){operations=[{id:body.operation_id,provider:'stripe',purpose:'installment',invoice_version:2,amount_minor:30000,currency:'usd',state:'outcome_unknown',obligation_reference:fixture.view.obligations[1].reference}];return{data:{outcome:'outcome_unknown'},error:null}}
  operations=[{...operations[0],state:'customer_action_required'}];return{data:{ok:true,outcome:'customer_action_required'},error:null};
 });
 await render();await inspect();await click('Select payment 2');await click('Review selected payment request');await click('Prepare review');const original=h.invoke.mock.calls[0][1].body;
 await click('Close review');expect(button('Review selected payment request')?.disabled).toBe(true);expect(document.activeElement).toBe(button('Check existing request'));expect(sessionStorage.length).toBe(1);
 await click('Check existing request');await click('Recover original operation');expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(h.invoke).toHaveBeenCalledTimes(2);
 expect(host.textContent).toContain('Payment requested');expect(host.textContent).not.toContain('Payment confirmed');expect(changed).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it.each(['received_payment','partial_request'] as const)('uses the existing discard guard before replacing an unsaved %s with an accepted target',async draft=>{
 await render();await inspect();await click('Select payment 2');
 if(draft==='received_payment')await click('Record received payment');else{await click('Request customer payment');await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())}
 await field('75.29');await click('Review selected payment request');expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();expect(h.invoke).not.toHaveBeenCalled();
 await click('Continue editing');expect(host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe('75.29');expect(button('Payment 2 selected')).toBeDefined();
 await click('Review selected payment request');await click('Discard changes');expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(h.invoke).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
});
