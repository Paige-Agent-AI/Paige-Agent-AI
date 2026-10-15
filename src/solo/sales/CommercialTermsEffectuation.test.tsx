import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CommercialTermsEffectuation} from './CommercialTermsEffectuation';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({read:vi.fn(),invoke:vi.fn(),listeners:new Set<(event?:string,session?:{user:{id:string}}|null)=>void>()}));
vi.mock('../../../supabase/functions/_shared/agreements/accepted-commercial-read',()=>({readAcceptedCommercialAgreement:h.read}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:h.invoke},auth:{getSession:async()=>({data:{session:{user:{id:'11111111-0000-4000-8000-000000000001'}}}}),
 onAuthStateChange:(callback:(event?:string,session?:{user:{id:string}}|null)=>void)=>{h.listeners.add(callback);return {data:{subscription:{unsubscribe:()=>h.listeners.delete(callback)}}};}}}}));
const tenant='aaaaaaaa-0000-4000-8000-000000000001',invoice='66666666-0000-4000-8000-000000000001',agreement='99999999-0000-4000-8000-000000000001',terms='55555555-0000-4000-8000-000000000001';
const stamp='2026-10-15T05:17:00.123456+00:00',digest='a'.repeat(64),sealed='b'.repeat(64);
const source={tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,agreement_version:4,terms_id:terms,terms_version:3,terms_updated_at:stamp,invoice_draft_version:2};
const read=()=>({state:'recorded',presentation:{payload:{source},payload_digest:digest},sealed_sha256:sealed,presented_body_markdown:'PRIVATE retained legal text'});
const consequence={agreement_id:terms,signing_id:agreement,signing_version:4,terms_version:3,invoice_id:invoice,payload_digest:digest,sealed_sha256:sealed,
 expected_updated_at:stamp,invoice_draft_version:2,client_id:'33333333-0000-4000-8000-000000000001',amount_cents:350000,currency:'usd',starts_on:'2026-10-15',state_before:'draft',state_after:'active',effect:'activate_matching_terms'};
const success=()=>({ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:'88888888-0000-4000-8000-000000000001',
 row:{id:terms,tenant_id:tenant,status_at_execution:'active',signing_id:agreement,signing_version:4,terms_version:3,effective_at:'2026-10-15T05:17:00Z',source_digest:digest,actor_user_id:'11111111-0000-4000-8000-000000000001',effect:'activate_matching_terms'},operation:{id:'77777777-0000-4000-8000-000000000001',action:'collection.effectuate_terms'}});
const proposal=(value:unknown=consequence)=>({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Make matching terms effective',preview:{consequence:value}},error:null});
let host:HTMLDivElement,root:Root;const recorded=vi.fn(),returnFocus=vi.fn();
beforeEach(()=>{h.read.mockReset().mockResolvedValue(read());h.invoke.mockReset();h.listeners.clear();recorded.mockReset();returnFocus.mockReset();sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async()=>act(async()=>{root.render(<CommercialTermsEffectuation tenantId={tenant} invoiceId={invoice} agreementId={agreement} termsId={terms} termsVersion={3} termsUpdatedAt={stamp} onRecorded={recorded} onReturnFocus={returnFocus}/>);await Promise.resolve();});
const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(v=>v.textContent===label)!;
const click=async(label:string)=>act(async()=>{button(label).click();await Promise.resolve();});
it('reads the retained source explicitly, and cancel creates no operation',async()=>{
 await render();expect(h.read).not.toHaveBeenCalled();await click('Review making terms effective');
 expect(h.read).toHaveBeenCalledWith(tenant,{invoice_id:invoice,agreement_id:agreement},expect.anything());expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
 await click('Cancel');expect(h.invoke).not.toHaveBeenCalled();expect(recorded).not.toHaveBeenCalled();await vi.waitFor(()=>expect(document.activeElement).toBe(button('Review making terms effective')));
});
it('uses the existing actual review and identical source-bound operation for approved execution',async()=>{
 h.invoke.mockResolvedValueOnce(proposal()).mockResolvedValueOnce({data:success(),error:null});await render();await click('Review making terms effective');await click('Prepare review');
 expect(document.body.textContent).toContain('$3,500.00');expect(document.body.textContent).toContain('Draft terms become active');expect(button('Approve action').disabled).toBe(false);
 await click('Approve action');const first=h.invoke.mock.calls[0][1].body,last=h.invoke.mock.calls[1][1].body;
 expect(last).toEqual({...first,approved_fingerprint:'0123456789abcdef'});expect(first.command.expected_updated_at).toBe(stamp);
 expect(JSON.stringify(first)).not.toContain('PRIVATE');expect(JSON.stringify(first)).not.toContain('body_markdown');expect(recorded).toHaveBeenCalledWith(expect.stringContaining('refreshed commercial status'));
});
it.each([undefined,{...consequence,signing_id:terms},{...consequence,amount_cents:-1}])('withholds approval when the authoritative consequence is unavailable or mismatched',async(value)=>{
 h.invoke.mockResolvedValue(proposal(value===undefined?null:value));await render();await click('Review making terms effective');await click('Prepare review');
 expect(button('Approve action').disabled).toBe(true);expect(document.body.textContent).toContain('exact accepted source');await click('Approve action');expect(h.invoke).toHaveBeenCalledOnce();
 await click('Cancel');expect(recorded).not.toHaveBeenCalled();
});
it.each(['refused','unverified'])('does not prepare a write for %s retained evidence',async(state)=>{
 h.read.mockResolvedValue({state});await render();await click('Review making terms effective');expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.querySelector('[role="alert"]')).not.toBeNull();expect(h.invoke).not.toHaveBeenCalled();
});
it.each([{terms_version:4},{terms_updated_at:'2026-10-15T05:17:00.123Z'},{terms_id:agreement}])('refuses accepted/current source drift %s',async(change)=>{
 h.read.mockResolvedValue({...read(),presentation:{payload:{source:{...source,...change}},payload_digest:digest}});await render();await click('Review making terms effective');
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.body.textContent).toContain('Current commercial terms changed');expect(h.invoke).not.toHaveBeenCalled();
});
it('drops a retained read returned after the actual account event',async()=>{
 let resolve!:(value:unknown)=>void;h.read.mockImplementation(()=>new Promise(r=>resolve=r));await render();await click('Review making terms effective');
 await act(async()=>{for(const listener of h.listeners)listener();});await act(async()=>resolve(read()));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(h.invoke).not.toHaveBeenCalled();expect(document.body.textContent).toContain('account changed');
});
it('keeps review and uncertain intent intact when the same actor refreshes a token',async()=>{
 await render();await act(async()=>{for(const listener of h.listeners)listener('INITIAL_SESSION',{user:{id:'11111111-0000-4000-8000-000000000001'}});});
 h.invoke.mockResolvedValueOnce(proposal()).mockRejectedValueOnce(Error('Interrupted'));await click('Review making terms effective');await click('Prepare review');await click('Approve action');
 await act(async()=>{for(const listener of h.listeners)listener('TOKEN_REFRESHED',{user:{id:'11111111-0000-4000-8000-000000000001'}});});
 expect(button('Cancel').disabled).toBe(true);expect(button('Recover original operation')).toBeDefined();expect(sessionStorage.length).toBe(1);expect(recorded).not.toHaveBeenCalled();
});
it('recovers the original uncertain act after reload without inventing another write',async()=>{
 h.invoke.mockResolvedValueOnce(proposal()).mockRejectedValueOnce(Error('Interrupted')).mockResolvedValueOnce({data:success(),error:null});
 await render();await click('Review making terms effective');await click('Prepare review');await click('Approve action');const original=h.invoke.mock.calls[0][1].body;
 expect(button('Cancel').disabled).toBe(true);act(()=>root.unmount());root=createRoot(host);await render();await click('Review making terms effective');
 expect(document.body.textContent).toContain('Recovering the saved');await click('Recover original operation');expect(h.invoke.mock.calls[2][1].body).toEqual(original);
 expect(recorded).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it('preserves the original uncertain intent when a success response names a different operation',async()=>{
 h.invoke.mockResolvedValueOnce(proposal()).mockResolvedValueOnce({data:{ok:true,operation:{action:'collection.stage_import'}},error:null});
 await render();await click('Review making terms effective');await click('Prepare review');await click('Approve action');expect(recorded).not.toHaveBeenCalled();expect(button('Cancel').disabled).toBe(true);expect(sessionStorage.length).toBe(1);expect(document.body.textContent).toContain('did not verify this commercial change');
});
it('clearly identifies genuine recovery of an earlier Collections intent',async()=>{
 const previous={actorId:'11111111-0000-4000-8000-000000000001',tenantId:tenant,operationId:'77777777-0000-4000-8000-000000000001',command:{action:'collection.stage_import',source_account:'Synthetic source',rows:[{entity:'invoice',entity_id:'SYN-1',client_id:'33333333-0000-4000-8000-000000000001',invoice_id:null,invoice_number:'SYN-1',currency:'usd',amount_cents:10000,due_date:null,memo:null}]}};
 sessionStorage.setItem(`paige:collection-operation:11111111-0000-4000-8000-000000000001:${tenant}`,JSON.stringify(previous));
 h.invoke.mockResolvedValue({data:{ok:true,operation:{action:'collection.stage_import'}},error:null});await render();await click('Review making terms effective');
 expect(document.body.textContent).toContain('The newly requested action has not started');await click('Recover original operation');
 expect(h.invoke.mock.calls[0][1].body.command).toEqual(previous.command);expect(recorded).toHaveBeenCalledWith(expect.stringContaining('earlier collection operation'));
});
