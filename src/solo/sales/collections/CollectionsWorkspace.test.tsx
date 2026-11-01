import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CollectionsWorkspace} from './CollectionsWorkspace';
import type {CollectionInvoice,CollectionReceipt} from './api';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const fixture=vi.hoisted(()=>({tenant:'11111111-1111-4111-8111-111111111111',agreement:'88888888-8888-4888-8888-888888888888',invoices:[] as CollectionInvoice[],receipts:[] as CollectionReceipt[]}));
vi.mock('next-themes',()=>({useTheme:()=>({resolvedTheme:'light'})}));
// E4-S3: the register judges Overdue on the business calendar, read through read_business_time_zone.
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn(async(name:string)=>name==='read_business_time_zone'?{data:{state:'configured',zone:'America/New_York',set_at:null,local_date:null,can_set:true},error:null}:{data:null,error:null})}}));
vi.mock('../../useSoloCommercialTerms',()=>({useSoloCommercialTerms:()=>({phase:'ready',tenantId:fixture.tenant,canManage:true})}));
vi.mock('./useCollections',()=>({useCollections:()=>({state:'ready',invoices:fixture.invoices,receipts:fixture.receipts,agreements:[{id:fixture.agreement,client_name:'Example client',title:'Exact saved plan',collection_terms:{kind:'installment'},collection_terms_version:1,terms_current:true}],error:'',retry:vi.fn(),more:vi.fn(),loadingMore:false,invoiceHasMore:false,receiptHasMore:false,agreementHasMore:false})}));
vi.mock('./CollectionPlanBuilder',()=>({CollectionPlanBuilder:({onDirty,initialAgreementId}:{onDirty(d:boolean):void;initialAgreementId?:string})=><div data-agreement={initialAgreementId}><button onClick={()=>onDirty(true)}>Edit plan fixture</button></div>}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{fixture.invoices=[];fixture.receipts=[];host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(()=>{act(()=>root.unmount());host.remove()});
const render=async()=>{await act(async()=>root.render(<CollectionsWorkspace tenantId={fixture.tenant}/>));await act(async()=>{await Promise.resolve()})};
const click=async(text:string)=>act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent===text)!.click()});
it('identifies provider evidence in the primary Receipts register',async()=>{
 fixture.receipts=[{id:'44444444-4444-4444-8444-444444444444',tenant_id:fixture.tenant,invoice_id:'22222222-2222-4222-8222-222222222222',client_id:'33333333-3333-4333-8333-333333333333',client_name:'Example provider client',invoice_number:'INV-1',source_invoice_number:null,kind:'receipt',amount_cents:5000,currency:'usd',method:'stripe',provider:'stripe',received_at:'2026-01-01T12:00:00Z',created_at:'2026-01-01T12:00:00Z',reference:null,notes:null,reason:null,actor_user_id:'66666666-6666-4666-8666-666666666666',reverses_payment_id:null,provenance:'provider_verified'}];
 await render();await click('Receipts');
 expect(host.textContent).toContain('Provider confirmed');
 expect(host.textContent).not.toContain('Human recorded');
});
it('shows conserved mixed payments in the detail and excludes satisfied obligations from due counts',async()=>{
 fixture.invoices=[{id:'22222222-2222-4222-8222-222222222222',tenant_id:fixture.tenant,client_id:'33333333-3333-4333-8333-333333333333',client_name:'Example balance client',invoice_number:'INV-1',source_invoice_number:'SOURCE-1',status:'recorded',version:1,amount_cents:10000,currency:'usd',due_date:'2026-01-01',created_at:'2026-01-01T12:00:00Z',manual_recorded_cents:2500,provider_verified_cents:7500,allocated_cents:10000,remaining_cents:0,receipt_count:2,record_kind:'imported',provenance:'owner_imported_unverified',collection_required:false}];
 await render();
 const facts=[...host.querySelectorAll('.sc-facts article')];
 expect(facts.find(x=>x.textContent?.startsWith('Outstanding'))?.textContent).toContain('$0.00');
 expect(facts.find(x=>x.textContent?.startsWith('Overdue'))?.querySelector('strong')?.textContent).toBe('0');
 await click('Open');
 expect(document.body.textContent).toContain('Manually recorded: $25.00');
 expect(document.body.textContent).toContain('Provider confirmed: $75.00');
 expect(document.body.textContent).toContain('Total applied: $100.00');
});
it('opens the exact selected saved agreement rather than the default builder row',async()=>{await render();await click('Plans');await click('Review plan terms');expect(document.querySelector('[data-agreement]')?.getAttribute('data-agreement')).toBe(fixture.agreement)});
it('protects shell navigation until explicit discard of dirty builder entries',async()=>{await render();await click('Create collection');await click('Edit plan fixture');const proceed=vi.fn();const event=new CustomEvent('paige:sales-before-navigation',{cancelable:true,detail:{proceed}});await act(async()=>{window.dispatchEvent(event)});expect(event.defaultPrevented).toBe(true);expect(proceed).not.toHaveBeenCalled();await click('Keep editing');expect(proceed).not.toHaveBeenCalled();await act(async()=>{window.dispatchEvent(new CustomEvent('paige:sales-before-navigation',{cancelable:true,detail:{proceed}}))});await click('Discard entries');expect(proceed).toHaveBeenCalledOnce()});
it('captures sidebar SPA navigation before router handlers and preserves entries on cancellation',async()=>{await render();await click('Create collection');await click('Edit plan fixture');const nav=document.createElement('nav');nav.className='tcs-nav-links';const link=document.createElement('a');link.href='/solo/example/clients';link.textContent='Clients';nav.append(link);document.body.append(nav);const routed=vi.fn();link.addEventListener('click',routed);await act(async()=>link.click());expect(routed).not.toHaveBeenCalled();await click('Keep editing');expect(document.body.textContent).toContain('Edit plan fixture');nav.remove()});

const financialInvoice=():CollectionInvoice=>({id:'22222222-2222-4222-8222-222222222222',tenant_id:fixture.tenant,client_id:'33333333-3333-4333-8333-333333333333',client_name:'Example actual-balance client',invoice_number:'INV-ACTUAL',source_invoice_number:'SOURCE-ACTUAL',status:'recorded',version:1,amount_cents:10000,currency:'usd',due_date:null,created_at:'2026-01-01T12:00:00Z',manual_recorded_cents:0,provider_verified_cents:0,allocated_cents:0,remaining_cents:10000,receipt_count:1,record_kind:'imported',provenance:'owner_imported_unverified',collection_required:true,payment_evidence_version:2,test_provider_verified_cents:5000});
it('keeps the original actual debt and separates TEST history in the register and detail',async()=>{
 fixture.invoices=[financialInvoice()];await render();
 expect([...host.querySelectorAll('.sc-facts article')].find(x=>x.textContent?.startsWith('Outstanding'))?.textContent).toContain('$100.00');
 expect(host.textContent).toContain('Test payments do not reduce outstanding balances');await click('Open');
 expect(document.body.textContent).toContain('Test payments: $50.00');expect(document.body.textContent).toContain('No money moved');
 expect(document.body.textContent).toContain('Provider confirmed: $0.00');expect(document.body.textContent).toContain('Total applied: $0.00');
});
it('explicitly labels an actual-format TEST receipt in both original receipt trails',async()=>{
 const invoice=financialInvoice();fixture.invoices=[invoice];fixture.receipts=[{id:'44444444-4444-4444-8444-444444444444',tenant_id:fixture.tenant,invoice_id:invoice.id,client_id:invoice.client_id,client_name:invoice.client_name,invoice_number:invoice.invoice_number,source_invoice_number:null,kind:'receipt',amount_cents:5000,currency:'usd',method:'stripe',provider:'stripe',provider_environment:'test',payment_evidence_version:2,received_at:invoice.created_at,created_at:invoice.created_at,reference:null,notes:null,reason:null,actor_user_id:invoice.client_id,reverses_payment_id:null,provenance:'provider_verified'}];
 await render();await click('Receipts');expect(host.textContent).toContain('Test payment · no money moved');
 await click('Due & upcoming');await click('Open');expect(document.querySelector('.sc-imported-actions')?.textContent).toContain('Test payment · no money moved');
});
it('a fully LIVE-paid obligation keeps zero outstanding and separate TEST history',async()=>{
 fixture.invoices=[{...financialInvoice(),provider_verified_cents:10000,allocated_cents:10000,remaining_cents:0,collection_required:false}];await render();
 expect([...host.querySelectorAll('.sc-facts article')].find(x=>x.textContent?.startsWith('Outstanding'))?.textContent).toContain('$0.00');
 await click('Open');expect(document.body.textContent).toContain('Provider confirmed: $100.00');expect(document.body.textContent).toContain('Test payments: $50.00');
});

it('retains an uncertain current invoice with withheld total, no overdue judgment and an inspectable original row',async()=>{
 const base=financialInvoice();fixture.invoices=[{...base,status:'issued',record_kind:'managed',provenance:'canonical_record',remaining_cents:null,collection_required:null,financial_evidence_version:3,financial:{schema_version:3,invoice_id:base.id,invoice_version:1,currency:'usd',standing:'needs_review',outstanding_minor:null,refund_payable_minor:null,credit_minor:null,manual_recorded_minor:0,provider_confirmed_minor:10000,provider_net_minor:null,test_provider_minor:5000,source_hash:'a'.repeat(64)}}];
 await render();const outstanding=[...host.querySelectorAll('.sc-facts article')].find(x=>x.textContent?.startsWith('Outstanding'));expect(outstanding?.textContent).toContain('On hold');expect(outstanding?.textContent).not.toContain('$0.00');expect(host.textContent).toContain('Verification pending');expect(host.querySelector('.sc-register-row button')?.textContent).toContain('Example actual-balance client');
});
it('shows current refund and credit separately from original gross receipt history',async()=>{
 const base=financialInvoice();fixture.invoices=[{...base,status:'issued',record_kind:'managed',provenance:'canonical_record',provider_verified_cents:10000,allocated_cents:10000,remaining_cents:9000,financial_evidence_version:3,financial:{schema_version:3,invoice_id:base.id,invoice_version:1,currency:'usd',standing:'recorded',outstanding_minor:9000,refund_payable_minor:1000,credit_minor:0,manual_recorded_minor:0,provider_confirmed_minor:10000,provider_net_minor:9000,test_provider_minor:5000,source_hash:'a'.repeat(64)}}];
 await render();await click('Open');expect(document.body.textContent).toContain('Refund owed: $10.00');expect(document.body.textContent).toContain('Credits recorded: $0.00');expect(document.body.textContent).toContain('Provider net after verified adjustments: $90.00');expect(document.body.textContent).toContain('Gross receipt history: $100.00');
});
