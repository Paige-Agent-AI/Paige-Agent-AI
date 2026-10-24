import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CollectionCommandReview} from './CollectionCommandReview';
import type {CollectionCommand} from '../../../../supabase/functions/_shared/sales-collections/contract';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({invoke:vi.fn(),actor:'66666666-6666-4666-8666-666666666666',onAuth:null as null|((event:string,session:{user:{id:string}}|null)=>void),theme:{resolvedTheme:'light',forcedTheme:undefined as string|undefined}}));
vi.mock('next-themes',()=>({useTheme:()=>h.theme}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:h.invoke},
 auth:{
  getSession:async()=>({data:{session:{user:{id:h.actor}}}}),
  onAuthStateChange:(callback:typeof h.onAuth)=>{h.onAuth=callback;return {data:{subscription:{unsubscribe(){}}}};},
 },
}}));
let host:HTMLDivElement,root:Root;const done=vi.fn(),close=vi.fn();
const command={action:'collection.stage_import' as const,source_account:'Example source',rows:[{entity:'invoice' as const,entity_id:'EX-1',client_id:'33333333-3333-4333-8333-333333333333',invoice_id:null,invoice_number:'EX-1',currency:'usd',amount_cents:10000,due_date:null,memo:null}]};
const tenant='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{sessionStorage.clear();h.actor='66666666-6666-4666-8666-666666666666';h.theme={resolvedTheme:'light',forcedTheme:undefined};h.invoke.mockReset();done.mockReset();close.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async(id=tenant,selected:CollectionCommand=command)=>act(async()=>{root.render(<CollectionCommandReview tenantId={id} command={selected} onComplete={done} onClose={close}/>);await Promise.resolve();});
const button=(name:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!;
const click=async(name:string)=>act(async()=>{button(name).click();await Promise.resolve()});
it('proposes then approves the identical immutable command and operation; cancel never executes',async()=>{
 h.invoke.mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Publish frozen invoice'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});await render();
 await click('Prepare review');expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
 await click('Approve action');const first=h.invoke.mock.calls[0][1].body,last=h.invoke.mock.calls[1][1].body;expect(last).toEqual({...first,approved_fingerprint:'0123456789abcdef'});expect(done).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it('decodes known HTTP refusal without trapping Cancel as unknown',async()=>{h.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({outcome:'refused',message:'Invoice changed'}),{status:422})}});await render();await click('Prepare review');expect(document.body.textContent).toContain('Invoice changed');expect(button('Cancel').disabled).toBe(false);await click('Cancel');expect(close).toHaveBeenCalledOnce();});
it('drops foreign response after workspace changes and issues no old request',async()=>{let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await render();await click('Prepare review');await render('33333333-3333-4333-8333-333333333333');await act(async()=>resolve({data:{ok:true},error:null}));expect(done).not.toHaveBeenCalled();expect(h.invoke).toHaveBeenCalledOnce();});
it('recovers the same operation after unknown result and remount',async()=>{h.invoke.mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:{ok:true},error:null});await render();await click('Prepare review');const original=h.invoke.mock.calls[0][1].body;expect(button('Cancel').disabled).toBe(true);act(()=>root.unmount());root=createRoot(host);await render();expect(button('Cancel').disabled).toBe(true);await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(close).not.toHaveBeenCalled();await click('Recover original operation');expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(done).toHaveBeenCalledOnce();});
it('auth refusal during unknown recovery does not erase original operation',async()=>{h.invoke.mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:null,error:{context:new Response(JSON.stringify({outcome:'refused',code:'UNAUTHENTICATED'}),{status:401})}});await render();await click('Prepare review');const original=h.invoke.mock.calls[0][1].body;await click('Recover original operation');expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(button('Cancel').disabled).toBe(true);expect(sessionStorage.length).toBe(1);});
it('unknown after approval recovers without consumed fingerprint before fresh approval',async()=>{h.invoke.mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef'},error:null}).mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'fedcba9876543210'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});await render();await click('Prepare review');await click('Approve action');await click('Recover original operation');const original=h.invoke.mock.calls[0][1].body;expect(h.invoke.mock.calls[2][1].body).toEqual(original);await click('Approve action');expect(h.invoke.mock.calls[3][1].body).toEqual({...original,approved_fingerprint:'fedcba9876543210'});expect(done).toHaveBeenCalledOnce();});
it('another authenticated actor cannot restore prior session operation in same tenant',async()=>{h.invoke.mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef'},error:null});await render();await click('Prepare review');const old=h.invoke.mock.calls[0][1].body;act(()=>root.unmount());h.actor='77777777-7777-4777-8777-777777777777';root=createRoot(host);await render();expect(button('Cancel').disabled).toBe(false);expect(document.body.textContent).not.toContain('Recovering the saved');await click('Prepare review');expect(h.invoke.mock.calls[1][1].body.operation_id).not.toBe(old.operation_id);});

const uid=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const effective={action:'collection.effectuate_terms' as const,agreement_id:uid(5),expected_version:3,expected_updated_at:'2026-10-14T18:00:00.123456Z',signing_id:uid(4),signing_version:4,invoice_id:uid(6),invoice_draft_version:1,payload_digest:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
const consequence={agreement_id:effective.agreement_id,signing_id:effective.signing_id,signing_version:4,terms_version:3,invoice_id:effective.invoice_id,payload_digest:effective.payload_digest,sealed_sha256:effective.sealed_sha256,expected_updated_at:effective.expected_updated_at,invoice_draft_version:1,client_id:uid(2),amount_cents:350000,currency:'usd',starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated',state_before:'draft',state_after:'active',effect:'activate_matching_terms'};
const proposal=(change={})=>({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Matching accepted terms',preview:{eligible:true,consequence:{...consequence,...change}}},error:null});
const effectiveReceipt=()=>({ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:uid(9),row:{id:effective.agreement_id,tenant_id:tenant,status_at_execution:'active',signing_id:effective.signing_id,signing_version:4,terms_version:3,effective_at:'2026-10-16T12:00:00.123456Z',source_digest:effective.payload_digest,actor_user_id:h.actor,effect:'activate_matching_terms'},operation:{id:uid(8),action:effective.action}});
it('shows exact native commercial consequence and approves the original microsecond source without financial effects',async()=>{
 h.invoke.mockResolvedValueOnce(proposal()).mockResolvedValueOnce({data:effectiveReceipt(),error:null});await render(tenant,effective);await click('Prepare review');
 expect(document.body.textContent).toContain('Review effective terms');expect(document.body.textContent).toContain('$3,500.00');expect(document.body.textContent).toContain('Oct');expect(document.body.textContent).toContain('Not specified in the accepted terms');expect(document.body.textContent).toContain('No invoice, payment request, charge, onboarding or completed service');
 expect(document.activeElement).toBe(document.querySelector('[role="dialog"] h2'));
 await click('Approve effective terms');const first=h.invoke.mock.calls[0][1].body;expect(first.command.expected_updated_at).toBe(effective.expected_updated_at);expect(h.invoke.mock.calls[1][1].body).toEqual({...first,approved_fingerprint:'0123456789abcdef'});expect(done).toHaveBeenCalledWith(effectiveReceipt(),effective);expect(sessionStorage.length).toBe(0);
});
it('explains recording provenance for already active terms without pretending to activate them again',async()=>{
 h.invoke.mockResolvedValue(proposal({state_before:'active',effect:'record_provenance_only'}));await render(tenant,effective);await click('Prepare review');expect(document.body.textContent).toContain('Already active');expect(document.body.textContent).toContain('Record accepted-version evidence');expect(button('Approve effective terms').disabled).toBe(false);
});
it.each([{signing_version:99},{effect:'record_provenance_only'},{expected_updated_at:'2026-10-14T18:00:00.123Z'}])('withholds approval when the exact accepted consequence is invalid: %j',async change=>{
 h.invoke.mockResolvedValue(proposal(change));await render(tenant,effective);await click('Prepare review');expect(document.body.textContent).toContain('exact signed terms could not be verified');expect(button('Approve effective terms').disabled).toBe(true);expect(button('Cancel').disabled).toBe(false);expect(h.invoke).toHaveBeenCalledOnce();
});
it.each([{ok:true},{...effectiveReceipt(),row:{...effectiveReceipt().row,tenant_id:uid(99)}}])('retains uncertain original operation for incomplete or foreign effective receipt',async data=>{
 h.invoke.mockResolvedValue({data,error:null});await render(tenant,effective);await click('Prepare review');expect(done).not.toHaveBeenCalled();expect(button('Recover original operation')).toBeDefined();expect(button('Cancel').disabled).toBe(true);expect(sessionStorage.length).toBe(1);
});
it('recovers the saved different action first and reports its actual command instead of the new requested agreement',async()=>{
 sessionStorage.setItem(`paige:collection-operation:${h.actor}:${tenant}`,JSON.stringify({actorId:h.actor,tenantId:tenant,command,operationId:uid(17)}));h.invoke.mockResolvedValue({data:{ok:true},error:null});await render(tenant,effective);expect(document.body.textContent).toContain('newly requested action has not started');await click('Recover original operation');expect(h.invoke.mock.calls[0][1].body.command).toEqual(command);expect(done).toHaveBeenCalledWith({ok:true},command);
});
it('recovers an uncertain exact commercial operation after remount without reusing its consumed approval',async()=>{
 h.invoke.mockResolvedValueOnce(proposal()).mockRejectedValueOnce(Error('Synthetic interrupted acknowledgement')).mockResolvedValueOnce({data:effectiveReceipt(),error:null});await render(tenant,effective);await click('Prepare review');await click('Approve effective terms');const original=h.invoke.mock.calls[0][1].body;expect(done).not.toHaveBeenCalled();act(()=>root.unmount());root=createRoot(host);await render(tenant,effective);await click('Recover original operation');expect(h.invoke.mock.calls[2][1].body).toEqual(original);expect(done).toHaveBeenCalledWith(effectiveReceipt(),effective);expect(sessionStorage.length).toBe(0);
});
it('requires the native eligibility decision as well as an exact consequence before approval',async()=>{
 const refused=proposal();refused.data.preview.eligible=false;h.invoke.mockResolvedValue(refused);await render(tenant,effective);await click('Prepare review');expect(button('Approve effective terms').disabled).toBe(true);expect(document.body.textContent).toContain('exact signed terms could not be verified');
});
it('preserves the canonical forced workspace theme inside the portalled approval dialog',async()=>{
 h.theme={resolvedTheme:'light',forcedTheme:'dark'};await render(tenant,effective);expect(document.querySelector('[role="dialog"]')?.getAttribute('data-theme')).toBe('dark');
});
