// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const ports=vi.hoisted(()=>({list:vi.fn(),read:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/lib/knowledge-extraction-service',()=>({listKnowledgePendingReviews:ports.list,readKnowledgePendingReviewTarget:ports.read}));
vi.mock('@/solo/knowledge/AddKnowledgeFlow',()=>({AddKnowledgeFlow:({replacementTarget,onClose}:{replacementTarget:{title:string};onClose:()=>void})=><div role="dialog"><p>{replacementTarget.title}</p><button onClick={onClose}>Close original review</button></div>}));
import {KnowledgePendingReviews} from '@/solo/knowledge/KnowledgePendingReviews';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.resetAllMocks();});
const item={documentId:'doc-a',revision:2,title:'Agreement',recordState:'draft',reviewAvailable:true,workId:'work-a',status:'succeeded'};
const render=async(tenantId='tenant-a',onRefreshed?:()=>void)=>{await act(async()=>root.render(<KnowledgePendingReviews tenantId={tenantId} onPublished={()=>{}} onRefreshed={onRefreshed}/>));};
const click=async(label:string)=>{const b=[...document.body.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);expect(b).toBeTruthy();await act(async()=>b!.click());};
it('reopens an original durable source and staged metadata without another upload',async()=>{ports.list.mockResolvedValue({items:[item],nextCursor:null});ports.read.mockResolvedValue({id:'doc-a',tenant_id:'tenant-a',revision:2,title:'Saved agreement',content:'Reviewed',tags:[]});await render();await click('Open Agreement');expect(document.body.textContent).toContain('Saved agreement');expect(ports.read).toHaveBeenCalledTimes(1);await click('Close original review');expect(document.body.querySelector('[role="dialog"]')).toBeNull();});
it('keeps discovery failure explicit and offers a read-only retry',async()=>{ports.list.mockRejectedValue(new Error('offline'));await render();expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be read');ports.list.mockResolvedValue({items:[],nextCursor:null});await click('Reload unfinished documents');expect(host.textContent).toContain('No unfinished documents found.');});
it('discards an old workspace response even after A is opened again',async()=>{let resolve!:(v:unknown)=>void;ports.list.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({items:[],nextCursor:null});await render();await render('tenant-b');await render('tenant-a');await act(async()=>resolve({items:[item],nextCursor:null}));expect(host.querySelector('[aria-label="Open Agreement"]')).toBeNull();});
it('confirms an unchanged manual refresh and refreshes the published library without reopening or rewriting a source',async()=>{
  const refreshed=vi.fn();ports.list.mockResolvedValue({items:[item],nextCursor:null});await render('tenant-a',refreshed);
  expect(refreshed).not.toHaveBeenCalled();const trigger=[...host.querySelectorAll('button')].find(b=>b.textContent==='Reload unfinished documents')!;trigger.focus();
  await click('Reload unfinished documents');
  expect(host.textContent).toContain('Checked 1 unfinished document: 1 ready for review.');
  expect(ports.list).toHaveBeenCalledTimes(2);expect(ports.read).not.toHaveBeenCalled();expect(refreshed).toHaveBeenCalledOnce();expect(document.activeElement).toBe(trigger);
});
it('reports a failed refresh without signaling a successful library refresh',async()=>{
  const refreshed=vi.fn();ports.list.mockResolvedValueOnce({items:[item],nextCursor:null}).mockRejectedValueOnce(new Error('offline'));
  await render('tenant-a',refreshed);await click('Reload unfinished documents');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be read');expect(refreshed).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Checked 1');
});
