import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {InvoiceAcceptedPaymentPlan} from './InvoiceAcceptedPaymentPlan';
import {acceptedPlanFixture,acceptedPlanFixtureIds as ids} from '../../../scripts/live-drive/sales-payments/accepted-plan-fixture';
import type {AcceptedPaymentPlanRead} from '../../../supabase/functions/_shared/sales-payments/accepted-obligation-read';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({read:vi.fn(),actor:'66666666-6666-4666-8666-666666666666' as string|null,sessionRead:null as null|(()=>Promise<{data:{session:{user:{id:string}}|null}}>),authChanged:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('../../../supabase/functions/_shared/sales-payments/accepted-obligation-read',()=>({readAcceptedInvoicePaymentPlan:h.read}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 rpc:vi.fn(),auth:{
  getSession:async()=>h.sessionRead?await h.sessionRead():({data:{session:h.actor?{user:{id:h.actor}}:null}}),
  onAuthStateChange:(callback:typeof h.authChanged)=>{h.authChanged=callback;return{data:{subscription:{unsubscribe(){}}}}},
 },
}}));
let host:HTMLDivElement,root:Root,fixture:Awaited<ReturnType<typeof acceptedPlanFixture>>;
const review=vi.fn();
beforeEach(async()=>{h.read.mockReset();h.actor=ids.actor;h.sessionRead=null;h.authChanged=null;review.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);fixture=await acceptedPlanFixture();h.read.mockResolvedValue(fixture.view)});
afterEach(()=>{act(()=>root.unmount());host.remove()});
type Props=React.ComponentProps<typeof InvoiceAcceptedPaymentPlan>;
const render=async(overrides:Partial<Props>={})=>act(async()=>{root.render(<InvoiceAcceptedPaymentPlan tenantId={ids.tenant} invoice={fixture.invoice} canManage paymentStatusRead paymentRequestActive={false} onReview={review} {...overrides}/>);await Promise.resolve()});
const button=(text:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===text);
const click=async(text:string)=>act(async()=>{const target=button(text);expect(target).toBeDefined();target!.click();await Promise.resolve()});
const inspect=()=>click('Read accepted payment plan');
it('inspects only on request, retains all11 exact dates/amounts and never equates allocation with service completion',async()=>{
 await render();expect(h.read).not.toHaveBeenCalled();await inspect();
 expect(h.read.mock.calls[0].slice(0,2)).toEqual([ids.tenant,{invoice_id:ids.invoice,agreement_id:ids.signing,client_id:ids.client,invoice_version:2,invoice_draft_version:1,issued_snapshot_version:1,currency:'usd'}]);
 expect(host.textContent).toContain('$3,500.00 accepted principal');expect(host.querySelectorAll('ol>li')).toHaveLength(11);
 expect(Array.from(host.querySelectorAll('time')).map(t=>t.dateTime)).toEqual(fixture.view.obligations.map(r=>r.due_date));
 expect(host.textContent).toContain('Allocated amounts do not establish completed services');expect(host.textContent).toContain('does not record money received');
 expect(host.querySelector('script')).toBeNull();expect(host.querySelector('pre')?.textContent).toBe(fixture.view.accepted.presented_body_markdown);expect(document.activeElement).toBe(host.querySelector('h4'));
 expect(review).not.toHaveBeenCalled();
});
it('reads a native-verified accepted source even when the immutable invoice snapshot retained its earlier draft status',async()=>{expect(fixture.invoice.snapshot.agreement_snapshot?.status).toBe('draft');await render();await inspect();expect(h.read).toHaveBeenCalledOnce();expect(button('Select payment 2')).toBeDefined()});
it('reviews only the exact accepted monthly selector through the existing parent, with no caller amount/date',async()=>{
 await render();await inspect();await click('Select payment 2');await click('Review selected payment request');
 expect(review).toHaveBeenCalledExactlyOnceWith({action:'invoice.payment_request',invoice_id:ids.invoice,expected_version:2,provider:'stripe',purpose:'installment',obligation_reference:fixture.view.obligations[1].reference});
 expect(review.mock.calls[0][0]).not.toHaveProperty('amount_minor');expect(review.mock.calls[0][0]).not.toHaveProperty('due_date');
});
it('retains the original invoice deposit intent for its first accepted payment',async()=>{await render();await inspect();await click('Select payment 1');await click('Review selected payment request');expect(review.mock.calls[0][0]).toMatchObject({purpose:'deposit',obligation_reference:{sequence:1}})});
it('uses native remaining amounts and refuses selecting an already allocated obligation',async()=>{
 fixture.view={...fixture.view,obligations:fixture.view.obligations.map((row,index)=>({...row,remaining_minor:index===0?0:index===1?10000:row.remaining_minor}))};h.read.mockResolvedValue(fixture.view);
 await render();await inspect();expect(button('Select payment 1')).toBeUndefined();expect(host.querySelector('li')?.textContent).toContain('Allocated');
 await click('Select payment 2');expect(host.querySelector('[aria-label="Selected accepted payment"]')?.textContent).toContain('$100.00');await click('Review selected payment request');expect(review.mock.calls[0][0]).not.toHaveProperty('amount_minor');
});
it.each([{paymentStatusRead:false,paymentRequestActive:true},{paymentStatusRead:true,paymentRequestActive:true}])('permits inspection but no second request while original status is unresolved: %o',async status=>{
 await render(status);await inspect();expect(button('Select payment 2')?.disabled).toBe(true);await click('Select payment 2');expect(review).not.toHaveBeenCalled();expect(host.textContent).toContain('Resolve the current payment-request status');
});
it('retires review eligibility when an original request appears while keeping the inspected source visible',async()=>{await render();await inspect();await click('Select payment 2');await render({paymentRequestActive:true});expect(host.textContent).toContain('$3,500.00 accepted principal');expect(button('Review selected payment request')?.disabled).toBe(true);await click('Review selected payment request');expect(review).not.toHaveBeenCalled()});
it('returns focus to the same row after clearing a local selection',async()=>{await render();await inspect();await click('Select payment 2');await click('Clear selection');expect(button('Review selected payment request')).toBeUndefined();expect(document.activeElement).toBe(button('Select payment 2'));expect(review).not.toHaveBeenCalled()});
it('can cancel reading and ignores its late response',async()=>{
 let resolve!:(value:AcceptedPaymentPlanRead)=>void;h.read.mockReturnValue(new Promise(r=>{resolve=r}));await render();await inspect();expect(host.textContent).toContain('Reading the accepted agreement');await click('Cancel reading');await act(async()=>resolve(fixture.view));
 expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(document.activeElement).toBe(button('Read accepted payment plan'));
});
it('refuses old data after a business-scope roundtrip',async()=>{
 let resolve!:(value:AcceptedPaymentPlanRead)=>void;h.read.mockReturnValue(new Promise(r=>{resolve=r}));await render();await inspect();await render({accountEpoch:'business-b'});await render({accountEpoch:null});await act(async()=>resolve(fixture.view));
 expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(button('Select payment 2')).toBeUndefined();expect(h.read).toHaveBeenCalledOnce();
});
it('ignores an old response after invoice version changes',async()=>{
 let resolve!:(value:AcceptedPaymentPlanRead)=>void;h.read.mockReturnValue(new Promise(r=>{resolve=r}));await render();await inspect();await render({invoice:{...fixture.invoice,version:3}});await act(async()=>resolve(fixture.view));expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(review).not.toHaveBeenCalled();
});
it('removes the private source and selection when role access is retired',async()=>{await render();await inspect();await click('Select payment 2');await render({canManage:false});expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(button('Review selected payment request')).toBeUndefined();expect(host.textContent).toContain('authorized owner or financial administrator')});
it('removes private data on sign-out and refuses a late original-actor read after an actor roundtrip',async()=>{
 let resolve!:(value:AcceptedPaymentPlanRead)=>void;h.read.mockReturnValue(new Promise(r=>{resolve=r}));await render();await inspect();
 await act(async()=>h.authChanged?.('SIGNED_OUT',null));expect(host.textContent).toContain('Sign in to inspect');
 await act(async()=>h.authChanged?.('SIGNED_IN',{user:{id:'88888888-8888-4888-8888-888888888888'}}));await act(async()=>h.authChanged?.('SIGNED_IN',{user:{id:ids.actor}}));await act(async()=>resolve(fixture.view));
 expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(button('Select payment 2')).toBeUndefined();expect(review).not.toHaveBeenCalled();
});
it.each(['invoice_not_issued','accepted_source_unavailable','commercial_terms_inactive','accepted_source_changed','test_payment_evidence','allocation_conflict','allocation_required'] as const)('shows the original held state %s without eligible targets',async reason=>{h.read.mockResolvedValue({state:'held',reason});await render();await inspect();expect(host.textContent).toContain('Payment plan needs review');expect(button('Select payment 1')).toBeUndefined();expect(review).not.toHaveBeenCalled()});
it.each(['stale','unverified','refused'] as const)('does not fabricate an empty or signed plan after %s',async state=>{h.read.mockResolvedValue({state});await render();await inspect();expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(button('Select payment 1')).toBeUndefined();expect(button('Refresh payment plan')).toBeDefined();expect(review).not.toHaveBeenCalled()});
it('retries a refused read through the same original source without executing anything',async()=>{h.read.mockResolvedValueOnce({state:'refused'}).mockResolvedValueOnce(fixture.view);await render();await inspect();await click('Refresh payment plan');expect(h.read).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('$3,500.00 accepted principal');expect(review).not.toHaveBeenCalled()});
it('does not call the plan admission for a missing agreement or absent financial permission',async()=>{await render({invoice:{...fixture.invoice,snapshot:{...fixture.invoice.snapshot,agreement_id:null,agreement_snapshot:null}}});expect(host.textContent).toContain('no retained agreement reference');expect(button('Read accepted payment plan')).toBeUndefined();await render({canManage:false});expect(button('Read accepted payment plan')).toBeUndefined();expect(h.read).not.toHaveBeenCalled()});

it('uses the same accepted read to assign one received receipt across deposit and monthly payment without a provider request',async()=>{
 const changed=vi.fn(),values={1:'500',2:'300'};
 await render({manual:{amountMinor:80000,values,onChange:vi.fn(),onAssignmentsChange:changed}});expect(changed).toHaveBeenLastCalledWith(null);await click('Read accepted plan for receipt');
 expect(changed).toHaveBeenLastCalledWith([{obligation:fixture.view.obligations[0],amount_cents:50000},{obligation:fixture.view.obligations[1],amount_cents:30000}]);
 expect(host.textContent).toContain('All received money is assigned');expect(button('Select payment 1')).toBeUndefined();expect(button('Review selected payment request')).toBeUndefined();
 expect(host.querySelectorAll('input[inputmode="decimal"]')).toHaveLength(11);expect(review).not.toHaveBeenCalled();
 await click('Close plan');expect(changed).toHaveBeenLastCalledWith(null);expect(values).toEqual({1:'500',2:'300'});expect(document.activeElement).toBe(button('Read accepted plan for receipt'));
});
it.each([{amountMinor:79999,values:{1:'500',2:'300'}},{amountMinor:90000,values:{1:'600',2:'300'}},{amountMinor:50000,values:{99:'500'}},{amountMinor:0,values:{}},{amountMinor:100,values:{1:'1.001'}}])('withholds incomplete, excessive, unknown or imprecise assignments: %o',async input=>{
 const changed=vi.fn();await render({manual:{...input,onChange:vi.fn(),onAssignmentsChange:changed}});await click('Read accepted plan for receipt');expect(changed).toHaveBeenLastCalledWith(null);expect(host.textContent).not.toContain('All received money is assigned');expect(review).not.toHaveBeenCalled();
});
it('retires manual assignment eligibility when authority, invoice or original payment-request currentness changes',async()=>{
 const changed=vi.fn(),manual={amountMinor:12000,values:{2:'120'},onChange:vi.fn(),onAssignmentsChange:changed};
 await render({manual});await click('Read accepted plan for receipt');expect(changed).toHaveBeenLastCalledWith([{obligation:fixture.view.obligations[1],amount_cents:12000}]);
 await render({manual,paymentRequestActive:true});expect(changed).toHaveBeenLastCalledWith(null);
 await render({manual,canManage:false});expect(host.querySelector('input')).toBeNull();expect(changed).toHaveBeenLastCalledWith(null);
 await render({manual,invoice:{...fixture.invoice,version:3}});expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(changed).toHaveBeenLastCalledWith(null);
});
it('retires an accepted receipt source after batched actor A→B→A events without relying on an intermediate render',async()=>{
 const changed=vi.fn(),manual={amountMinor:12000,values:{2:'120'},onChange:vi.fn(),onAssignmentsChange:changed};
 await render({manual});await click('Read accepted plan for receipt');expect(changed).toHaveBeenLastCalledWith([{obligation:fixture.view.obligations[1],amount_cents:12000}]);
 await act(async()=>{h.authChanged?.('SIGNED_IN',{user:{id:'88888888-8888-4888-8888-888888888888'}});h.authChanged?.('SIGNED_IN',{user:{id:ids.actor}})});
 expect(host.textContent).not.toContain('$3,500.00 accepted principal');expect(changed).toHaveBeenLastCalledWith(null);expect(review).not.toHaveBeenCalled();
});
