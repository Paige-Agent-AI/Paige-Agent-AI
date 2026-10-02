// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/knowledge-service', () => ({ readKnowledge: api.read }));
vi.mock('@/pages/admin/TenantKnowledgeAdmin', () => ({ AddDocDialog: () => null }));
vi.mock('@/components/knowledge/KnowledgeMetadataEditor', () => ({ KnowledgeMetadataEditor: () => null }));
vi.mock('@/components/paige/PaigeWorkspaceContext', () => ({ usePaigeWorkspace: () => ({ activeTenantId: 'tenant-a', notifyKnowledgeAdded: vi.fn() }) }));
// The real Review body and its handlers run; select its tab without testing Radix itself.
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({children}: React.PropsWithChildren) => <div>{children}</div>, TabsList: () => null, TabsTrigger: () => null, TabsContent: ({children,value}: React.PropsWithChildren<{value:string}>) => value === 'review' ? <section>{children}</section> : null }));
import { KnowledgePanel } from '../components/paige/KnowledgePanel';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
async function mount() { host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<KnowledgePanel tenantName="Example workspace"/>)); }
afterEach(async()=>{await act(async()=>root?.unmount());host?.remove();vi.resetAllMocks();});
async function click(text: string) { const button=[...host.querySelectorAll('button')].find(el=>el.textContent===text);expect(button).toBeTruthy();await act(async()=>button!.click()); }
const row = {id:'doc',tenant_id:'tenant-a',revision:1,title:'Private source',summary:null,category:null,tags:[],source:'paste',source_url:null,chunk_count:1,created_at:'2026-09-30',updated_at:'2026-09-30',share_to_network:false,network_review_status:'none'};
describe('Knowledge Review pagination',()=>{
 it('reaches a shared101st source without claiming an empty full library',async()=>{
  api.read.mockResolvedValueOnce(Array.from({length:100},(_,i)=>({...row,id:`doc-${i}`}))).mockResolvedValueOnce([{...row,id:'shared',title:'Older shared source',share_to_network:true,network_review_status:'pending'}]);
  await mount();expect(host.textContent).toContain('No shared sources in the loaded documents');expect(host.textContent).not.toContain("haven't shared anything");
  await click('Load more documents');expect(host.textContent).toContain('Older shared source');expect(api.read).toHaveBeenLastCalledWith(expect.anything(),'tenant-a',{limit:100,offset:100});
 });
 it('provides an explicit reload in the Review error state',async()=>{
  api.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);await mount();expect(host.textContent).toContain('could not be read');await click('Reload Knowledge');expect(host.textContent).toContain('No shared sources in the loaded documents');expect(api.read).toHaveBeenCalledTimes(2);
 });
});
