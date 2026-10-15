import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {e04CommercialFixture,e04Id} from '../../test/fixtures/e04-commercial-presentation';
import {preparationReviewDocument} from '../../../supabase/functions/_shared/agreements/preparation-review';
import {CommercialAgreementPreparation} from './CommercialAgreementPreparation';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
type Caller=Awaited<ReturnType<typeof e04CommercialFixture>>['caller'];
const h=vi.hoisted(()=>({caller:null as Caller|null,actor:'',invoke:vi.fn(),listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 rpc:(...args:Parameters<Caller['rpc']>)=>h.caller!.rpc(...args),from:(table:string)=>h.caller!.from(table),functions:{invoke:h.invoke},
 auth:{getSession:async()=>({data:{session:{user:{id:h.actor}}}}),onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{
  h.listeners.add(callback);callback('INITIAL_SESSION',{user:{id:h.actor}});return {data:{subscription:{unsubscribe:()=>h.listeners.delete(callback)}}};
 }},
}}));
let f:Awaited<ReturnType<typeof e04CommercialFixture>>,host:HTMLDivElement,root:Root;
const recorded=vi.fn(),focus=vi.fn();
beforeEach(async()=>{sessionStorage.clear();f=await e04CommercialFixture();h.caller=f.caller;h.actor=e04Id(9);h.listeners.clear();h.invoke.mockReset();recorded.mockReset();focus.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function paint(agreement=f.agreement){await act(async()=>{root.render(<CommercialAgreementPreparation tenantId={f.tenant} invoiceId={f.invoice} agreementId={agreement} onRecorded={recorded} onReturnFocus={focus}/>);});}
const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label)!;
const waitFor=(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,0));});check();});
async function click(label:string){await act(async()=>{button(label).click();await new Promise(r=>setTimeout(r,0));});}
async function proposal(){return {outcome:'approval_required',fingerprint:'0123456789abcdef',preview:{consequence:{...f.command,kind:'retain_signing_document',principal_minor:350000,currency:'usd',engagement:f.proposed.presentation.payload.engagement}},review_document:await preparationReviewDocument(f.proposed)};}
async function review(data?:unknown){h.invoke.mockResolvedValueOnce({data:data??await proposal(),error:null});await paint();await click('Prepare agreement for signing');await waitFor(()=>expect(button('Prepare review')).toBeDefined());await click('Prepare review');await waitFor(()=>expect(document.body.textContent).not.toContain('Verifying the exact agreement text…'));}
function receipt(){return {ok:true,outcome:'agreement_prepared',historical_receipt:true,receipt_id:e04Id(8),row:{id:f.agreement,tenant_id:f.tenant,version_at_preparation:4,
 invoice_id:f.invoice,invoice_version:1,invoice_draft_version:2,terms_id:f.terms,terms_version:3,client_id:f.client,offer_id:f.offer,payload_digest:f.command.payload_digest,document_sha256:'a'.repeat(64),prepared_at:'2026-10-15T00:00:00Z',actor_user_id:h.actor},operation:{id:f.operation,action:f.command.action}};}
it('uses real source and canonical review text; browser recovery retains only the closed intent',async()=>{
 await review();expect(document.querySelector('details article')?.textContent).toBe(f.proposed.presented_body_markdown);expect(document.body.textContent).toContain('2026-11-01');expect(button('Prepare this agreement').disabled).toBe(false);
 const sent=h.invoke.mock.calls[0][1].body;expect(sent.command).toEqual(f.command);expect(sent).not.toHaveProperty('review_document');
 expect(sessionStorage.length).toBe(1);const saved=sessionStorage.getItem(sessionStorage.key(0)!)!;expect(saved).toContain(f.command.payload_digest);expect(saved).not.toMatch(/Owner-recorded service|body_markdown|content_storage_key|document_sha256/);
 await click('Cancel');expect(h.invoke).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each(['original','displayed','consequence'])('blocks approval when %s differs from the canonical digest/facts',async kind=>{
 const p=await proposal();if(kind==='original')p.review_document.body_markdown='Changed legal text';if(kind==='displayed')p.review_document.presented_body_markdown='Different text on screen';if(kind==='consequence')p.preview.consequence.principal_minor=350001;
 await review(p);expect(button('Prepare this agreement').disabled).toBe(true);expect(document.body.textContent).toContain('Cancel and refresh');expect(document.querySelector('details article')).toBeNull();expect(h.invoke).toHaveBeenCalledOnce();
});
it.each(['start','price','role'])('asks for recorded %s before opening approval',async kind=>{
 if(kind==='start')f.rows.tenant_client_agreements.starts_on=null;if(kind==='price')f.rows.tenant_client_agreements.price_basis='quote_pending';if(kind==='role')f.authority.admin=false;
 await paint();await click('Prepare agreement for signing');expect(document.querySelector('[role="dialog"]')).toBeNull();expect(h.invoke).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')).not.toBeNull();
});
it('requires an actual complete receipt before refreshing the recorded result',async()=>{
 await review();h.invoke.mockResolvedValueOnce({data:{ok:true,outcome:'agreement_prepared'},error:null});await click('Prepare this agreement');expect(recorded).not.toHaveBeenCalled();expect(button('Cancel').disabled).toBe(true);
 const original=h.invoke.mock.calls[0][1].body;h.invoke.mockResolvedValueOnce({data:receipt(),error:null});await click('Recover original operation');expect(h.invoke.mock.calls[2][1].body).toEqual(original);expect(recorded).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it('masks the document on actor change, preserving a same-actor refresh',async()=>{
 await review();await act(async()=>{for(const callback of h.listeners)callback('TOKEN_REFRESHED',{user:{id:h.actor}});});expect(document.querySelector('details article')).not.toBeNull();
 await act(async()=>{h.actor=e04Id(99);for(const callback of [...h.listeners])callback('SIGNED_IN',{user:{id:h.actor}});});expect(document.querySelector('details article')).toBeNull();expect(recorded).not.toHaveBeenCalled();expect(h.invoke).toHaveBeenCalledOnce();
});
it('does not keep an old approval when its source identity changes',async()=>{
 await review();await paint(e04Id(99));expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.body.textContent).not.toContain('Owner-recorded service responsibilities.');expect(recorded).not.toHaveBeenCalled();
});
