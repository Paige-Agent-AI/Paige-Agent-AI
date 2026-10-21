import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {CuraKnowledgePanel} from './CuraKnowledgePanel';
import type {CuraKnowledgeSource,CuraShareProposal} from '@/lib/cura-knowledge';

const f=vi.hoisted(()=>({model:null as unknown,context:{accountContextLoading:false,accountContextStatus:'ready',activeTenantId:'b3b30200-0000-4000-8000-000000000001',activeUserId:'b3b30100-0000-4000-8000-000000000001'},exit:vi.fn(),beforeUnload:vi.fn(),hook:vi.fn()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>f.context}));
vi.mock('@/hooks/useCuraKnowledge',()=>({useCuraKnowledge:(...args:unknown[])=>{f.hook(...args);return f.model;}}));
vi.mock('@/hooks/useBeforeUnloadGuard',()=>({useBeforeUnloadGuard:(...args:unknown[])=>f.beforeUnload(...args)}));
vi.mock('@/components/client/useClientAccountExit',()=>({useClientAccountExit:(...args:unknown[])=>f.exit(...args)}));
vi.mock('@/solo/knowledge/AddKnowledgeFlow',()=>({AddKnowledgeFlow:({replacementTarget,onPublished,onClose}:{replacementTarget?:{content?:string};onPublished:()=>void;onClose:()=>void})=><DialogContent><DialogTitle>Review private source</DialogTitle><DialogDescription>Original publication flow</DialogDescription><p>{replacementTarget?.content??'New source'}</p><button onClick={onPublished}>Complete private publication</button><button onClick={onClose}>Done</button></DialogContent>}));
const tenant=f.context.activeTenantId,doc='b3b30300-0000-4000-8000-000000000001',generation='b3b30400-0000-4000-8000-000000000001';
const row=():CuraKnowledgeSource=>({document_id:doc,document_revision:3,title:'Test welcome FAQ',source_state:'prepared',pending_review:false,source_fingerprint:'a'.repeat(64),generation_id:generation,share:null,share_state:'not_shared',updated_at:'2026-10-21T12:00:00Z'});
const proposal=(available=true):CuraShareProposal=>({tenant_id:tenant,audience:'business',document_id:doc,available,customer_kind:'faq',valid_from:null,valid_until:null,expected_share_revision:available?0:1,proposal_hash:'b'.repeat(64),source_fingerprint:'a'.repeat(64),document_revision:3,generation_id:generation,source:available?'paste':null,title:available?'Test welcome FAQ':null,preview:available?'The session lasts 30 minutes.':null,preview_truncated:false,already_shared:false});
let model:Record<string,unknown>,host:HTMLDivElement,root:Root;const back=vi.fn(),pending=vi.fn();
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const render=async()=>{await act(async()=>root.render(<CuraKnowledgePanel tenantId={tenant} onBack={back} onPendingChange={pending}/>));};
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.textContent?.trim()===name)!;
const click=async(name:string)=>{await act(async()=>button(name).click());};
beforeEach(()=>{
 vi.clearAllMocks();f.context.accountContextStatus='ready';f.context.activeTenantId=tenant;
 model={phase:'ready',rows:[row()],hasMore:false,outcome:'list',proposal:null,correction:null,notice:'',query:'',load:vi.fn(),search:vi.fn(),loadMore:vi.fn(),review:vi.fn(),correct:vi.fn(),confirm:vi.fn(),recover:vi.fn(),cancel:vi.fn(),leave:vi.fn()};f.model=model;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('uses the existing publisher source and does not expose an automatic approval',async()=>{
 await render();expect(host.textContent).toContain('Private Knowledge');expect(host.textContent).toContain('Test welcome FAQ');
 await click('Review sharing');expect(model.review).not.toHaveBeenCalled();expect(model.confirm).not.toHaveBeenCalled();
 expect(host.querySelector('select')?.value).toBe('information');await click('Review sharing');
 expect(model.review).toHaveBeenCalledExactlyOnceWith(doc,true,{kind:'information',validFrom:null,validUntil:null});expect(model.confirm).not.toHaveBeenCalled();
});
it('shows exact audience, source preview and expiry before the only share confirmation',async()=>{
 model.outcome='review';model.proposal={...proposal(),valid_until:'2026-11-15T17:00:00Z'};await render();
 expect(host.textContent).toContain('Authorized customers of this business');expect(host.textContent).toContain('The session lasts 30 minutes.');expect(host.textContent).toContain('UTC');
 await click('Approve sharing');expect(model.confirm).toHaveBeenCalledTimes(1);
});
it('passes the deliberately edited UTC expiry into the native sharing review',async()=>{
 await render();await click('Review sharing');
 const input=host.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2026-11-16T17:00');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('Review sharing');expect(model.review).toHaveBeenCalledExactlyOnceWith(doc,true,{kind:'information',validFrom:null,validUntil:'2026-11-16T17:00:00Z'});
});
it('does not allow a duplicate approval for the same existing source and terms',async()=>{
 model.outcome='review';model.proposal={...proposal(),already_shared:true};await render();expect(button('Approve sharing').disabled).toBe(true);await click('Approve sharing');expect(model.confirm).not.toHaveBeenCalled();
});
it('explains that withdrawing a business share does not revoke separately shared client material',async()=>{
 model.outcome='review';model.proposal=proposal(false);await render();expect(host.textContent).toContain('customer-specific shares');await click('Confirm withdrawal');expect(model.confirm).toHaveBeenCalledTimes(1);
});
it('publishes privately through the existing flow and never automatically shares',async()=>{
 await render();await click('Add a source');expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Original publication flow');expect(pending).toHaveBeenLastCalledWith(true);
 await click('Complete private publication');expect(model.load).toHaveBeenCalledTimes(1);expect(model.review).not.toHaveBeenCalled();expect(model.confirm).not.toHaveBeenCalled();
 await click('Done');expect(host.textContent).toContain('Published to your private Knowledge');expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('routes correction to the original publication review, preserving source content',async()=>{
 model.outcome='correction';model.correction={id:doc,content:'Existing reviewed source'};await render();expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Existing reviewed source');expect(model.confirm).not.toHaveBeenCalled();
});
it('requires publication before sharing a draft or unprepared source',async()=>{
 model.rows=[{...row(),source_state:'needs_publication',generation_id:null}];await render();expect(button('Review sharing').disabled).toBe(true);expect(host.textContent).toContain('Publication needed');await click('Review or correct');expect(model.correct).toHaveBeenCalledWith(doc);
});
it('keeps uncertain status recoverable and offers an explicit exit without retrying',async()=>{
 model.outcome='unknown';model.notice='The response was interrupted.';await render();expect(f.exit).toHaveBeenLastCalledWith(true,true);expect(button('Add a source').disabled).toBe(true);expect(button('Back to experience').disabled).toBe(true);
 await click('Check saved status');expect(model.recover).toHaveBeenCalledTimes(1);expect(model.confirm).not.toHaveBeenCalled();await click('Leave this check');expect(model.leave).toHaveBeenCalledTimes(1);expect(back).toHaveBeenCalledTimes(1);
});
it('does not turn failed inventory into a successful empty source list',async()=>{
 model.phase='error';model.rows=[];model.notice='Knowledge sharing could not be checked.';await render();expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be checked');expect(host.textContent).not.toContain('Start with an answer');await click('Reload Knowledge');expect(model.load).toHaveBeenCalledTimes(1);
});
it('has a specific true-empty path without inventing source counts or customer reads',async()=>{
 model.rows=[];await render();expect(host.textContent).toContain('Start with an answer');expect(host.textContent).not.toMatch(/100%|customers read|all caught up/i);expect(button('Add a source')).toBeDefined();
});
it('retires the teaching interface when the selected business is no longer current',async()=>{
 await render();await click('Review sharing');f.context.activeTenantId='b3b30200-0000-4000-8000-000000000002';await render();expect(host.textContent).not.toContain('Test welcome FAQ');expect(host.querySelector('select')).toBeNull();expect(host.textContent).toContain('current business');
});
it('returns focus to the original source control when a sharing form is canceled',async()=>{
 await render();const sourceButton=button('Review sharing');sourceButton.focus();await click('Review sharing');await click('Cancel');expect(document.activeElement?.textContent?.trim()).toBe('Review sharing');expect(model.confirm).not.toHaveBeenCalled();
});
it('loads a valid exact source through the same authenticated hook and offers the full inventory',async()=>{
 model.focusedId=doc;await act(async()=>root.render(<CuraKnowledgePanel tenantId={tenant} reference={{documentId:doc,invalid:false}} onBack={back}/>));
 expect(f.hook).toHaveBeenLastCalledWith({tenant,actor:f.context.activeUserId},doc);expect(host.textContent).toContain('Showing the linked source');expect(document.activeElement).toBe(host.querySelector('h2'));
 await click('Show all sources');expect(model.search).toHaveBeenCalledExactlyOnceWith('');expect(model.confirm).not.toHaveBeenCalled();
});
it('reports a missing linked record without replacing it or presenting a true-empty first use',async()=>{
 model.focusedId=doc;model.rows=[];await render();expect(host.textContent).toContain('linked source is not available');expect(host.textContent).toContain('No source has been substituted');expect(host.textContent).not.toContain('Start with an answer');expect(model.confirm).not.toHaveBeenCalled();
});
it('refuses malformed references before loading private inventory',async()=>{
 await act(async()=>root.render(<CuraKnowledgePanel tenantId={tenant} reference={{documentId:null,invalid:true}} onBack={back}/>));
 expect(f.hook).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Test welcome FAQ');expect(host.querySelector('[role="alert"]')?.textContent).toContain('address could not be read');await click('Back to experience');expect(back).toHaveBeenCalledTimes(1);
});

it('waits for the exact linked read before moving focus from loading to its heading',async()=>{
 model.phase='loading';model.rows=[];model.focusedId=doc;await act(async()=>root.render(<CuraKnowledgePanel tenantId={tenant} reference={{documentId:doc,invalid:false}} onBack={back}/>));
 expect(document.activeElement).not.toBe(host.querySelector('h2'));model.phase='ready';model.rows=[row()];await act(async()=>root.render(<CuraKnowledgePanel tenantId={tenant} reference={{documentId:doc,invalid:false}} onBack={back}/>));
 expect(document.activeElement).toBe(host.querySelector('h2'));expect(model.confirm).not.toHaveBeenCalled();
});

it('holds an incoming reference through source terms and exact review, releasing it on cancel or a settled receipt',async()=>{
 await render();await click('Review sharing');expect(pending).toHaveBeenLastCalledWith(true);await click('Cancel');expect(pending).toHaveBeenLastCalledWith(false);
 model.outcome='preparing';await render();expect(pending).toHaveBeenLastCalledWith(true);model.outcome='review';model.proposal=proposal();await render();expect(pending).toHaveBeenLastCalledWith(true);
 model.outcome='saved';model.proposal=null;await render();expect(pending).toHaveBeenLastCalledWith(false);expect(button('Back to experience').disabled).toBe(false);
});

it("releases a selected-source hold after access is lost without restoring its private form or retrying a write",async()=>{
 await render();await click("Review sharing");expect(pending).toHaveBeenLastCalledWith(true);model.phase="unavailable";model.outcome="list";model.rows=[];model.notice="Your account or permission changed.";await render();
 expect(host.textContent).not.toContain("Test welcome FAQ");expect(host.querySelector("select")).toBeNull();expect(pending).toHaveBeenLastCalledWith(false);expect(button("Back to experience").disabled).toBe(false);
 await click("Back to experience");expect(back).toHaveBeenCalledTimes(1);expect(model.confirm).not.toHaveBeenCalled();expect(model.recover).not.toHaveBeenCalled();expect(model.load).not.toHaveBeenCalled();
});
