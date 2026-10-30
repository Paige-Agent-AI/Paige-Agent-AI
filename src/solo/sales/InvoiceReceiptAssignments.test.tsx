import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {InvoiceReceiptAssignments} from './InvoiceReceiptAssignments';
import {readManualReceiptAssignments,readOriginalManualReceiptAssignments} from './manualReceiptAssignments';
import {acceptedPlanFixture,acceptedPlanFixtureIds as ids} from '../../../scripts/live-drive/sales-payments/accepted-plan-fixture';
import type {InvoiceReceipt} from './invoiceLifecycleApi';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({rpc:vi.fn(),auth:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 rpc:h.rpc,
 auth:{
  getSession:async()=>({data:{session:{user:{id:'66666666-6666-4666-8666-666666666666'}}}}),
  onAuthStateChange:(callback:typeof h.auth)=>{h.auth=callback;return{data:{subscription:{unsubscribe(){}}}}},
 },
}}));
let host:HTMLDivElement,root:Root,fixture:Awaited<ReturnType<typeof acceptedPlanFixture>>,data:Record<string,unknown>;
const receipt:InvoiceReceipt={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',kind:'receipt',amount_cents:80000,method:'cash',received_at:'2026-10-30T12:00:00.000Z',reference:null,notes:null,actor_user_id:ids.actor,reverses_payment_id:null,reason:null,evidence_kind:'manual_recorded'};
const scope={tenantId:ids.tenant,invoiceId:ids.invoice,version:3,receipt},reload=vi.fn();
beforeEach(async()=>{fixture=await acceptedPlanFixture();h.auth=null;h.rpc.mockReset();reload.mockReset();data={invoice_id:ids.invoice,invoice_version:3,payment_id:receipt.id,amount_cents:80000,currency:'usd',reversal_payment_id:null,state:'assigned',allocations:[{obligation:fixture.view.obligations[0],amount_cents:50000},{obligation:fixture.view.obligations[1],amount_cents:30000}]};h.rpc.mockImplementation(async()=>({data,error:null}));host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(()=>{act(()=>root.unmount());host.remove()});
type Props=React.ComponentProps<typeof InvoiceReceiptAssignments>;
const render=(overrides:Partial<Props>={})=>act(async()=>{root.render(<InvoiceReceiptAssignments {...scope} canManage onReload={reload} {...overrides}/>);await Promise.resolve()});
const button=(name:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent===name);
const click=(name:string)=>act(async()=>{const target=button(name);expect(target).toBeDefined();target!.click();await Promise.resolve()});
it('reads only on inspection through the same native tenant/invoice/version/receipt and keeps original corrected assignments visible',async()=>{
 data.reversal_payment_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';await render();expect(h.rpc).not.toHaveBeenCalled();await click('Inspect payment assignments');
 expect(h.rpc).toHaveBeenCalledExactlyOnceWith('read_sales_invoice_manual_allocations',{_expected_tenant_id:ids.tenant,_invoice_id:ids.invoice,_expected_version:3,_payment_id:receipt.id});
 expect(host.textContent).toContain('Payment 1 · $500.00');expect(host.textContent).toContain('Payment 2 · $300.00');expect(host.textContent).toContain('recorded full correction');expect(host.textContent).toContain('no longer reduce');expect(host.textContent).toContain('does not verify a provider payment or refund');expect(document.activeElement).toBe(host.querySelector('h5'));
 await click('Close assignments');expect(document.activeElement).toBe(button('Inspect payment assignments'));expect(host.textContent).not.toContain('$500.00');
});
it.each([{invoice_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},{invoice_version:4},{payment_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},{amount_cents:79999},{currency:'eur'},{raw_command:'private'},{allocations:[]},{reversal_payment_id:receipt.id}])('withholds mismatched or malformed original receipt facts: %o',patch=>{
 expect(readManualReceiptAssignments({...data,...patch},scope)).toEqual({state:'unverified',allocations:[],reversalPaymentId:null});
});
it.each(['unassigned','unverified'] as const)('reports %s history without inventing installment allocations',async state=>{
 data={...data,state,allocations:[]};await render();await click('Inspect payment assignments');expect(host.textContent).not.toContain('Payment 1 ·');expect(host.textContent).toContain(state==='unassigned'?'PAIGE will not guess':'could not be verified');
});
it('retains a corrected legacy unassigned receipt without inventing earlier assignments',async()=>{
 data={...data,state:'unassigned',allocations:[],reversal_payment_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};await render();await click('Inspect payment assignments');expect(host.textContent).toContain('recorded full correction');expect(host.textContent).toContain('does not assign it to accepted payments');expect(host.textContent).not.toContain('original assignments are retained');
});
it('withholds a correction claim when the receipt observation itself is unverified',()=>{
 expect(readManualReceiptAssignments({...data,state:'unverified',allocations:[],reversal_payment_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},scope)).toEqual({state:'unverified',allocations:[],reversalPaymentId:null});
});
it('retries a denied read and offers original reload after an actual stale read without writing',async()=>{
 h.rpc.mockResolvedValueOnce({data:null,error:{code:'42501'}}).mockResolvedValueOnce({data:null,error:{code:'40001'}}).mockResolvedValueOnce({data,error:null});
 await render();await click('Inspect payment assignments');expect(host.textContent).toContain('Check workspace access');await click('Refresh receipt assignments');await click('Reload original invoice');expect(reload).toHaveBeenCalledOnce();await click('Refresh receipt assignments');expect(host.textContent).toContain('Payment 2 · $300.00');
});
it('retires a cancelled late read and the same actor A→B→A batch, then permits a fresh original read',async()=>{
 let resolve!:(value:{data:unknown;error:null})=>void;h.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r}));await render();await click('Inspect payment assignments');await click('Cancel receipt reading');await act(async()=>resolve({data,error:null}));expect(host.textContent).not.toContain('$500.00');
 await click('Inspect payment assignments');expect(host.textContent).toContain('$500.00');await act(async()=>{h.auth?.('SIGNED_IN',{user:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}});h.auth?.('SIGNED_IN',{user:{id:ids.actor}})});expect(host.textContent).not.toContain('$500.00');await click('Inspect payment assignments');expect(host.textContent).toContain('$500.00');
});
it('retires private receipt details on version, business incarnation or financial role changes',async()=>{
 await render();await click('Inspect payment assignments');await render({accountEpoch:'other-business'});await render({accountEpoch:null});expect(host.textContent).not.toContain('$500.00');await click('Inspect payment assignments');await render({canManage:false});expect(host.textContent).toBe('');await render({version:4});expect(host.textContent).not.toContain('$500.00');
});
it('does not invoke the manual receipt reader for provider evidence or an invalid scope',async()=>{
 expect(await readOriginalManualReceiptAssignments(h.rpc,{...scope,receipt:{...receipt,evidence_kind:'provider_verified'}})).toEqual({state:'refused'});expect(await readOriginalManualReceiptAssignments(h.rpc,{...scope,tenantId:'invalid'})).toEqual({state:'refused'});expect(h.rpc).not.toHaveBeenCalled();
 await render({receipt:{...receipt,evidence_kind:'provider_verified'}});expect(host.textContent).toBe('');
});
