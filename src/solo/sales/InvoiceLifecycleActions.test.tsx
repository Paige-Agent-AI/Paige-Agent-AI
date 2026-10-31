import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {InvoiceLifecycleActions} from './InvoiceLifecycleActions';
import {invoiceLifecycleFixtureRow} from '../../../scripts/live-drive/harness/sales-invoice-lifecycle/fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,functions:{invoke:h.invoke},auth:{getSession:async()=>({data:{session:{user:{id:'66666666-6666-4666-8666-666666666666'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}));
const tenant='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
let host:HTMLDivElement,root:Root;const changed=vi.fn();
beforeEach(()=>{sessionStorage.clear();h.rpc.mockReset();h.invoke.mockReset();changed.mockReset();h.rpc.mockImplementation(async(name:string)=>({data:name==='read_sales_invoice'?invoiceLifecycleFixtureRow(id,'issued'):name==='list_sales_invoice_payment_operations'?{rows:[]}:[{id:'77777777-7777-4777-8777-777777777777',provider:'resend',from_address:'business@example.test'}],error:null}));host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async(canManage=true,version=2)=>act(async()=>{root.render(<InvoiceLifecycleActions tenantId={tenant} invoiceId={id} version={version} canManage={canManage} onChanged={changed}/>);await Promise.resolve();});
const button=(text:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===text)!;
const click=async(text:string)=>act(async()=>button(text).click());
const field=(name:string,value:string)=>act(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.startsWith(name))!;const control=label.querySelector('input,select,textarea') as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;const proto=control instanceof HTMLInputElement?HTMLInputElement.prototype:control instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(control,value);control.dispatchEvent(new Event(control instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});
it('reviews partial human receipt with integer amount and unchanged calendar date, cancel restores focus/input',async()=>{h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Record human receipt',preview:{invoice_number:'INV-01',remaining_cents:15000}},error:null});await render();expect(host.textContent).toContain('$150.00');await click('Record received payment');field('Amount received (USD)','75.29');field('Date received','2026-10-03');field('Reference','Actual human reference');await click('Review received payment');await click('Prepare review');expect(h.invoke.mock.calls[0][1].body.command).toMatchObject({action:'invoice.record_manual_payment',amount_cents:7529,currency:'usd',received_at:'2026-10-03T12:00:00.000Z',reference:'Actual human reference'});await click('Cancel');expect(document.activeElement?.textContent).toBe('Review received payment');expect((document.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe('75.29');expect(changed).not.toHaveBeenCalled();});
it('keeps invalid overpayment in form without proposing and asks before discarding entered input',async()=>{await render();await click('Record received payment');field('Amount received (USD)','151.00');await click('Review received payment');expect(document.body.textContent).toContain('within the outstanding balance');expect(h.invoke).not.toHaveBeenCalled();await click('Cancel');expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();await click('Continue editing');expect((document.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe('151.00');});
it('role without management cannot propose publication/payment/link/email',async()=>{await render(false);expect(button('Record received payment').disabled).toBe(true);expect(button('Create / replace share link').disabled).toBe(true);expect(button('Void invoice').disabled).toBe(true);expect(h.invoke).not.toHaveBeenCalled();});
it('checks SMS A2P and recipient eligibility without a browser-selected connection or recipient',async()=>{h.invoke.mockResolvedValue({data:{eligible:false,readiness:{reason:'SMS_A2P_NOT_APPROVED'}},error:null});await render();await click('Send invoice');await click('SMS');await click('Check delivery readiness');expect(h.invoke.mock.calls[0][1].body.command).toMatchObject({action:'invoice.sms_send',connector_id:null,invoice_id:id});expect(h.invoke.mock.calls[0][1].body.command).not.toHaveProperty('to');expect(host.textContent).toContain('approved A2P');expect(button('Review invoice delivery').disabled).toBe(true);});
it('ignores an old ready response after changing channel away and back',async()=>{let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>resolve=r));await render();await click('Send invoice');await click('Check delivery readiness');await click('SMS');await click('Email');await act(async()=>resolve({data:{eligible:true,readiness:{reason:'READY_FOR_GOVERNED_REVIEW'}},error:null}));expect(button('Review invoice delivery').disabled).toBe(true);expect(host.textContent).not.toContain('Ready for review.');});
it('version change drops pending email eligibility and keeps send review disabled',async()=>{let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>resolve=r));await render();await click('Send invoice');field('Business email connection','77777777-7777-4777-8777-777777777777');await click('Check delivery readiness');expect((document.querySelector('select') as HTMLSelectElement).disabled).toBe(true);await render(true,3);await act(async()=>resolve({data:{ok:true,eligible:true,summary:'Old result'},error:null}));expect(button('Review invoice delivery').disabled).toBe(true);expect(document.body.textContent).not.toContain('Old result');});
it('a draft number is assigned on issuance and never described as previously issued',async()=>{
 const row=invoiceLifecycleFixtureRow(id,'draft');row.invoice_number='DRAFT-22222222-2222-4222-8222-222222222222';
 h.rpc.mockResolvedValue({data:row,error:null});await render();
 expect(host.textContent).toContain('Draft · not issued');expect(host.textContent).toContain('Assigned when issued');expect(host.textContent).not.toContain('Previously issued invoice');expect(host.textContent).not.toContain(row.invoice_number);
});

it.each(['draft','issued','void'] as const)('does not call a %s lifecycle audit amount a different lifecycle obligation',async status=>{
 const row=invoiceLifecycleFixtureRow(id,status);
 h.rpc.mockImplementation(async(name:string)=>({data:name==='read_sales_invoice'?row:name==='list_sales_invoice_payment_operations'?{rows:[]}:[],error:null}));
 await render();const terms=Array.from(host.querySelectorAll('dt')).map(el=>el.textContent);
 expect(terms).toContain(status==='draft'?'Draft total':status==='void'?'Original invoice total':'Invoice total');
 expect(terms).toContain(status==='draft'?'Unissued draft amount':status==='void'?'Recorded balance (voided)':'Outstanding balance');
 if(status!=='issued'){expect(terms).not.toContain('Outstanding balance');expect(host.textContent).not.toContain('Paid');}
 expect(host.textContent).toContain(status==='draft'?'$200.00':'$150.00');expect(h.invoke).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
});

it('request-editor abandonment is visible outside the hidden manual editor',async()=>{await render();await click('Request customer payment');await click('Send invoice');const dialog=document.querySelector('[role="alertdialog"]');expect(dialog).not.toBeNull();expect(dialog!.closest('[hidden]')).toBeNull();await click('Continue editing');expect(document.body.textContent).toContain('Prepare payment review');});

it('unknown accepted payment recovery closes to its original trigger and retains exact selector',async()=>{
 const reference={commercial_terms_id:'44444444-4444-4444-8444-444444444444',signing_id:'55555555-5555-4555-8555-555555555555',signing_version:4,terms_version:1,sequence:2};
 h.rpc.mockImplementation(async(name:string)=>({data:name==='read_sales_invoice'?invoiceLifecycleFixtureRow(id,'issued'):name==='list_sales_invoice_payment_operations'?{rows:[{id:'33333333-3333-4333-8333-333333333333',provider:'stripe',purpose:'installment',invoice_version:2,amount_minor:30000,currency:'usd',state:'outcome_unknown',obligation_reference:reference}]}:[],error:null}));
 h.invoke.mockResolvedValue({data:{outcome:'outcome_unknown'},error:null});
 await render();button('Check existing request').focus();await click('Check existing request');await click('Recover original operation');
 expect(h.invoke.mock.calls[0][1].body).toMatchObject({operation_id:'33333333-3333-4333-8333-333333333333',command:{purpose:'installment',obligation_reference:reference}});
 expect(h.invoke.mock.calls[0][1].body.command).not.toHaveProperty('amount_minor');
 await click('Close review');expect(document.activeElement).toBe(button('Check existing request'));
 expect(changed).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
});

const financialInvoice=(patch:Record<string,unknown>):Record<string,unknown>&{payments:Record<string,unknown>[]}=>({
 ...invoiceLifecycleFixtureRow(id,'issued'),payment_evidence_version:2,
 manual_recorded_cents:0,provider_verified_cents:0,allocated_cents:0,remaining_cents:20000,
 test_provider_verified_cents:5000,
 payments:[{...invoiceLifecycleFixtureRow(id,'issued').payments[0],method:'stripe',evidence_kind:'provider_verified',provider:'stripe',provider_verified_at:'2026-10-01T12:00:00Z',provider_environment:'test'}],
 ...patch,
});
const readFinancialInvoice=(row:Record<string,unknown>)=>h.rpc.mockImplementation(async(name:string)=>({data:name==='read_sales_invoice'?row:name==='list_sales_invoice_payment_operations'?{rows:[]}:[],error:null}));
const displayedAmount=(label:string)=>Array.from(host.querySelectorAll('dt')).find(term=>term.textContent===label)?.nextElementSibling?.textContent;
it('shows TEST evidence separately while retaining the full actual business receivable',async()=>{
 readFinancialInvoice(financialInvoice({}));await render();
 expect(displayedAmount('Outstanding balance')).toBe('$200.00');
 expect(displayedAmount('Less live provider-confirmed payments')).toBe('− $0.00');
 expect(displayedAmount('TEST provider confirmations')).toBe('$50.00');
 expect(host.textContent).toContain('Issued · outstanding');
 expect(host.textContent).toContain('TEST provider confirmation · no customer funds');
 expect(host.textContent).toContain('TEST confirmations do not reduce the business balance');
 expect(host.textContent).not.toContain('Paid ·');
 expect(button('Record received payment').disabled).toBe(false);
 expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Correct payment')).toBe(false);
 expect(h.invoke).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
});
it('uses native mixed business amounts without subtracting TEST a second time',async()=>{
 const row=financialInvoice({manual_recorded_cents:5000,provider_verified_cents:2000,allocated_cents:7000,remaining_cents:13000});
 const test=row.payments[0];
 row.payments=[test,{...test,id:'55555555-5555-4555-8555-555555555556',amount_cents:2000,provider_environment:'live'},
  {...test,id:'55555555-5555-4555-8555-555555555557',evidence_kind:'manual_recorded',method:'cash',provider:null,provider_environment:null,provider_verified_at:null}];
 (row as Record<string,unknown>).payments_count=3;
 readFinancialInvoice(row);await render(false);
 expect(displayedAmount('Outstanding balance')).toBe('$130.00');
 expect(displayedAmount('Less business-recorded payments')).toBe('− $50.00');
 expect(displayedAmount('Less live provider-confirmed payments')).toBe('− $20.00');
 expect(displayedAmount('TEST provider confirmations')).toBe('$50.00');
 expect(host.textContent).toContain('Partially paid · outstanding');
 expect(button('Record received payment').disabled).toBe(true);expect(h.invoke).not.toHaveBeenCalled();
});
it('keeps old provider records readable without claiming their unqualified balance is live collection',async()=>{
 const row=financialInvoice({manual_recorded_cents:0,provider_verified_cents:20000,allocated_cents:20000,remaining_cents:0});
 delete (row as Record<string,unknown>).payment_evidence_version;delete (row as Record<string,unknown>).test_provider_verified_cents;
 delete (row.payments[0] as Record<string,unknown>).provider_environment;
 readFinancialInvoice(row);await render();
 expect(host.textContent).toContain('Issued · provider environment unverified');
 expect(host.textContent).toContain('Provider payment record · environment unverified');
 expect(displayedAmount('Recorded balance · verification pending')).toBe('$0.00');
 expect(displayedAmount('Provider records · environment unverified')).toBe('$200.00');
 expect(host.textContent).not.toContain('Paid · provider-confirmed');expect(host.textContent).not.toContain('TEST provider confirmations');
 expect(h.invoke).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
});
