import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CommercialPackageInspection} from './CommercialPackageInspection';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({read:vi.fn(),accepted:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));
vi.mock('../../../supabase/functions/_shared/sales-commercial/package-projection',()=>({readCommercialPackage:h.read}));
vi.mock('../../../supabase/functions/_shared/agreements/accepted-commercial-read',()=>({readAcceptedCommercialAgreement:h.accepted}));
let host:HTMLDivElement,root:Root;
const fixture={success:true,invoice:{currency:'usd',obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,outstanding_minor:350000},agreement:{status:'completed',version:2},commercial_terms:{status:'active',version:3},schedule_preview:{rows:[{due_date:'2026-11-01',amount_cents:50000},...Array.from({length:10},(_,i)=>({due_date:`2027-${String(i+1).padStart(2,'0')}-01`,amount_cents:30000}))],has_more:false},missing_fields:['signed_terms_compatibility'],conflicts:[]};
beforeEach(()=>{h.read.mockReset();h.accepted.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(()=>{act(()=>root.unmount());host.remove()});
const render=(tenant='test-tenant-a',invoice='test-invoice-a',version=1)=>act(()=>root.render(<CommercialPackageInspection tenantId={tenant} invoiceId={invoice} version={version}/>));
it('reads on explicit inspection and presents canonical obligations without implying payment or approval',async()=>{h.read.mockResolvedValue({content:fixture});render();expect(h.read).not.toHaveBeenCalled();await act(async()=>host.querySelector('button')!.click());expect(h.read.mock.calls[0].slice(0,2)).toEqual(['test-tenant-a',{invoice_id:'test-invoice-a'}]);expect(host.textContent).toContain('$3,500.00');expect(host.textContent).toContain('$500.00');expect(host.textContent).toContain('$3,000.00');expect(host.querySelectorAll('ol li')).toHaveLength(11);expect(host.textContent).toContain('not collected payments');expect(host.textContent).toContain('compatibility remains unverified');expect(host.textContent).toContain('Each next action retains its own authorization');expect(host.querySelectorAll('input,select,textarea')).toHaveLength(0)});
it('refuses unavailable reads and preserves retry without exposing provider or database errors',async()=>{h.read.mockResolvedValue({content:{success:false,error:'private failure'}});render();await act(async()=>host.querySelector('button')!.click());expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be read');expect(host.textContent).not.toContain('private failure');await act(async()=>host.querySelector('button')!.click());expect(h.read).toHaveBeenCalledTimes(2)});
it('drops late results and previously visible package when workspace or source version changes',async()=>{let resolve!:(v:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({content:{success:false}});render();await act(async()=>host.querySelector('button')!.click());render('test-tenant-b');await act(async()=>resolve({content:fixture}));expect(host.textContent).not.toContain('$3,500.00');h.read.mockResolvedValue({content:fixture});await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain('$3,500.00');render('test-tenant-b','test-invoice-a',2);expect(host.textContent).not.toContain('$3,500.00')});

const privateRead={state:'recorded',presentation:{payload:{schema_version:1,title:'Synthetic original agreement',currency:'usd',principal_minor:350000,
 source:{agreement_version:4,terms_version:3,invoice_draft_version:1,terms_id:'test-terms'},obligations:[]}},
 presented_body_markdown:'Synthetic private accepted words',completed_at:'2026-10-15T12:00:00Z',receipt_id:'test-receipt',sealed_sha256:'b'.repeat(64)};
const renderOwner=(accountEpoch='owner-epoch-a',canInspectAccepted=true)=>act(()=>root.render(<CommercialPackageInspection {...{tenantId:'test-tenant-a',invoiceId:'test-invoice-a',version:1,accountEpoch,canInspectAccepted}}/>));
const openPrivate=async()=>{
 h.read.mockResolvedValue({content:{...fixture,agreement:{...fixture.agreement,id:'test-agreement-a'}}});h.accepted.mockResolvedValue(privateRead);
 renderOwner();await act(async()=>host.querySelector('button')!.click());
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Inspect accepted terms')!.click());
 expect(host.querySelector('pre')?.textContent).toBe(privateRead.presented_body_markdown);
};
it('retires private accepted words on the canonical account epoch even when business and invoice are unchanged',async()=>{
 await openPrivate();renderOwner('owner-epoch-b');expect(host.querySelector('pre')).toBeNull();expect(h.accepted).toHaveBeenCalledTimes(1);
});
it('retires private accepted words when current verified owner access is withdrawn',async()=>{
 await openPrivate();renderOwner('owner-epoch-a',false);expect(host.querySelector('pre')).toBeNull();
 expect(host.textContent).not.toContain('Inspect accepted terms');expect(h.accepted).toHaveBeenCalledTimes(1);
});
