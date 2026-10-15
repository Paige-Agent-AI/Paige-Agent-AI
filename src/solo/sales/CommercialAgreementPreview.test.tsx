import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CommercialAgreementPreview} from './CommercialAgreementPreview';

const fixture=vi.hoisted(()=>({prepare:vi.fn(),accepted:vi.fn(),rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc}}));
vi.mock('../../../supabase/functions/_shared/agreements/commercial-presentation-read',()=>({prepareCommercialPresentationFromRecords:fixture.prepare}));
vi.mock('../../../supabase/functions/_shared/agreements/accepted-commercial-read',()=>({readAcceptedCommercialAgreement:fixture.accepted}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
const proposed=(title='Synthetic agreement')=>({state:'proposed',presentation:{payload:{title,source:{agreement_version:4,invoice_draft_version:3,terms_version:5}}},presented_body_markdown:'Original saved services.\n\nPrincipal: USD 3,500.00\nDeposit: USD 500.00\nTen dated payments of USD 300.00.'});
const accepted=()=>({...proposed(),state:'recorded',completed_at:'2026-10-15T00:00:00Z',receipt_id:'test-receipt'});
beforeEach(()=>{fixture.prepare.mockReset().mockResolvedValue(proposed());fixture.accepted.mockReset().mockResolvedValue(accepted());fixture.rpc.mockReset();host=document.createElement('div');host.className='solo-campaigns';document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
const render=(tenantId='test-tenant-a',invoiceId='test-invoice-a',key='same',mode:'proposed'|'accepted'='proposed')=>act(()=>root.render(<CommercialAgreementPreview key={key} tenantId={tenantId} invoiceId={invoiceId} agreementId="test-agreement-a" mode={mode}/>));
const button=(text:string)=>[...document.body.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent===text)!;
const open=async()=>{await act(async()=>button('Review saved agreement').click());};
const close=async()=>{await act(async()=>button('Close').click());};
it('prepares only on explicit open and uses the existing Sales dialog theme and exact source selector',async()=>{
 render();expect(fixture.prepare).not.toHaveBeenCalled();await open();expect(fixture.prepare.mock.calls[0].slice(0,2)).toEqual(['test-tenant-a',{invoice_id:'test-invoice-a',agreement_id:'test-agreement-a'}]);
 const dialog=document.body.querySelector('[role=dialog]')!;expect(dialog.classList.contains('paige-solo')).toBe(true);expect(dialog.getAttribute('data-theme')).toBe('light');expect(document.body.textContent).toContain('Original saved services.');expect(document.body.textContent).toContain('USD 3,500.00');expect(document.body.textContent).toContain('Invoice draft version 3');expect(document.body.textContent).toContain('preview does not send');expect(fixture.rpc).not.toHaveBeenCalled();
});
it('closes during preparation, ignores the late reply, and rereads on return',async()=>{
 let finish!:(value:unknown)=>void;fixture.prepare.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));render();await open();expect(document.body.textContent).toContain('Preparing agreement text');await close();
 await act(async()=>finish(proposed('Late old document')));expect(document.body.querySelector('[role=dialog]')).toBeNull();fixture.prepare.mockResolvedValue(proposed('Fresh document'));await open();expect(document.body.textContent).toContain('Fresh document');expect(document.body.textContent).not.toContain('Late old document');expect(fixture.prepare).toHaveBeenCalledTimes(2);
});
it('names missing canonical facts without inventing agreement terms or claiming a signature',async()=>{
 fixture.prepare.mockResolvedValue({state:'needs_input',fields:['recorded_collection_terms','tax_and_fee_treatment']});render();await open();expect(document.body.textContent).toContain('Record the dated payment schedule');expect(document.body.textContent).toContain('Record tax and fee treatment');expect(document.body.textContent).not.toContain('USD 3,500');expect(document.body.querySelector('input,textarea')).toBeNull();
});
it('recovers a refused preparation with a fresh read and keeps internal failures out of the UI',async()=>{
 fixture.prepare.mockResolvedValueOnce({state:'refused',code:'PRESENTATION_SOURCE_UNAVAILABLE'}).mockResolvedValue(proposed());render();await open();expect(document.body.querySelector('[role=alert]')).not.toBeNull();expect(document.body.textContent).not.toContain('PRESENTATION_SOURCE_UNAVAILABLE');await act(async()=>button('Try again').click());expect(document.body.textContent).toContain('Original saved services.');expect(fixture.prepare).toHaveBeenCalledTimes(2);
});
it('retires prior content before a different workspace or invoice read can resolve',async()=>{
 render();await open();expect(document.body.textContent).toContain('Original saved services.');let finish!:(value:unknown)=>void;fixture.prepare.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));render('test-tenant-b','test-invoice-b');expect(document.body.textContent).not.toContain('Original saved services.');expect(document.body.textContent).toContain('Preparing agreement text');await act(async()=>finish(proposed('Workspace B agreement')));expect(document.body.textContent).toContain('Workspace B agreement');
});
it('unmounts the viewer when the parent account/source epoch changes',async()=>{
 render();await open();render('test-tenant-a','test-invoice-a','new-account-epoch');expect(document.body.querySelector('[role=dialog]')).toBeNull();expect(document.body.textContent).not.toContain('Original saved services.');
});
it('handles a transport rejection without exposing its exception',async()=>{
 fixture.prepare.mockRejectedValue(new Error('Synthetic private transport detail'));render();await open();expect(document.body.querySelector('[role=alert]')).not.toBeNull();expect(document.body.textContent).not.toContain('Synthetic private');expect(button('Try again')).toBeDefined();
});
it('supports Escape and restores focus to the existing inspection entry',async()=>{
 render();const trigger=button('Review saved agreement');await open();act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.body.querySelector('[role=dialog]')).toBeNull();await vi.waitFor(()=>expect(document.activeElement).toBe(trigger));
});
it('returns to the invoice through the document exit and rereads on the next review',async()=>{
 render();await open();await act(async()=>button('Back to invoice').click());expect(document.body.querySelector('[role=dialog]')).toBeNull();await open();expect(fixture.prepare).toHaveBeenCalledTimes(2);
});
it('reads accepted text only on explicit open, through the retained reader and the same document dialog',async()=>{
 render('test-tenant-a','test-invoice-a','same','accepted');expect(fixture.accepted).not.toHaveBeenCalled();await act(async()=>button('Review accepted agreement').click());
 expect(fixture.accepted.mock.calls[0].slice(0,2)).toEqual(['test-tenant-a',{invoice_id:'test-invoice-a',agreement_id:'test-agreement-a'}]);expect(fixture.prepare).not.toHaveBeenCalled();
 expect(document.body.querySelector('[aria-label="Accepted agreement document"]')?.textContent).toContain('Original saved services');expect(document.body.textContent).toContain('Accepted payment terms version 5');expect(document.body.textContent).toContain('does not activate commercial terms');expect(document.body.textContent).toContain('Signing completion recorded at 2026-10-15T00:00:00Z');
 await act(async()=>button('Back to invoice').click());expect(document.body.querySelector('[role=dialog]')).toBeNull();await act(async()=>button('Review accepted agreement').click());expect(fixture.accepted).toHaveBeenCalledTimes(2);
});
it('leaves legacy accepted economics unverified rather than substituting a current proposal',async()=>{
 fixture.accepted.mockResolvedValue({state:'unverified'});render('test-tenant-a','test-invoice-a','same','accepted');await act(async()=>button('Review accepted agreement').click());expect(document.body.textContent).toContain('Current payment terms cannot establish what was signed');expect(document.body.textContent).not.toContain('USD 3,500');expect(document.body.querySelector('article')).toBeNull();expect(fixture.prepare).not.toHaveBeenCalled();
});
it('retries an unavailable retained read without exposing private failures or using proposed text',async()=>{
 fixture.accepted.mockRejectedValueOnce(Error('Private retained failure'));render('test-tenant-a','test-invoice-a','same','accepted');await act(async()=>button('Review accepted agreement').click());expect(document.body.querySelector('[role=alert]')).not.toBeNull();expect(document.body.textContent).not.toContain('Private retained failure');await act(async()=>button('Try again').click());expect(document.body.textContent).toContain('Original saved services');expect(fixture.prepare).not.toHaveBeenCalled();
});
it('retires accepted text on close, late return and source-mode change',async()=>{
 let finish!:(v:unknown)=>void;fixture.accepted.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));render('test-tenant-a','test-invoice-a','same','accepted');await act(async()=>button('Review accepted agreement').click());await close();await act(async()=>finish(accepted()));expect(document.body.querySelector('[role=dialog]')).toBeNull();
 await act(async()=>button('Review accepted agreement').click());expect(document.body.textContent).toContain('Accepted payment terms version');fixture.prepare.mockResolvedValue({state:'needs_input',fields:['recorded_collection_terms']});render();expect(document.body.querySelector('[aria-label="Accepted agreement document"]')).toBeNull();expect(document.body.textContent).not.toContain('USD 3,500');await act(async()=>{});
});
