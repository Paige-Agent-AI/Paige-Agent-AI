// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ docs: [] as unknown[], loading: false, error: null as string|null,
  reload: vi.fn(), loadMore: vi.fn(), hasMore: false, read: vi.fn(), remove: vi.fn(), confirm: vi.fn() }));
vi.mock("@/hooks/useKnowledgeDocuments", () => ({ useKnowledgeDocuments: () => state }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/knowledge-service", () => ({ readKnowledge: state.read, deleteKnowledge: state.remove }));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: state.confirm, dialog: null }) }));
vi.mock("@/components/knowledge/KnowledgeMetadataEditor", () => ({ KnowledgeMetadataEditor: () => null }));
vi.mock("@/pages/admin/TenantKnowledgeAdmin", () => ({ AddDocDialog: () => null }));
import { KnowledgeLibrary } from "@/solo/knowledge/KnowledgeLibrary";
const doc = { id:"document-a", tenant_id:"test-tenant-a", revision:2, title:"Intake guide", summary:"Eligibility and stages", category:"Program", tags:["qualification"], source:"paste", source_url:null, chunk_count:2, created_at:"2026-09-01", updated_at:"2026-09-01", content:"Private methodology" };
let container: HTMLDivElement, root: Root;
async function render(tenant="test-tenant-a") { await act(async () => root.render(<KnowledgeLibrary tenantId={tenant} account="test-account" />)); }
async function click(text: string) { const b=[...container.querySelectorAll("button")].find(b=>b.textContent?.includes(text)); expect(b).toBeTruthy(); await act(async()=>b!.click()); }
beforeEach(()=>{ (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true; container=document.createElement("div"); document.body.append(container);root=createRoot(container);state.docs=[doc];state.loading=false;state.error=null;state.hasMore=false;state.read.mockReset().mockResolvedValue([doc]);state.remove.mockReset();state.confirm.mockReset().mockResolvedValue(true); });
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
describe("Settings canonical Knowledge library",()=>{
  it("opens canonical detail and returns to the library",async()=>{await render();await click("Intake guide");expect(state.read).toHaveBeenCalledWith({},"test-tenant-a",{documentId:"document-a"});expect(container.textContent).toContain("Private methodology");await click("Back to knowledge");expect(container.textContent).not.toContain("Private methodology");});
  it("does not send a delete after the workspace changes during confirmation",async()=>{let resolve!:(v:boolean)=>void;state.confirm.mockImplementation(()=>new Promise(r=>{resolve=r;}));await render();await click("Intake guide");await click("Remove document");await render("test-tenant-b");await act(async()=>resolve(true));expect(state.remove).not.toHaveBeenCalled();expect(container.textContent).not.toContain("Private methodology");});
  it("keeps uncertain deletion from becoming success or an automatic retry",async()=>{state.remove.mockRejectedValue(new Error("network lost"));await render();await click("Intake guide");await click("Remove document");expect(state.remove).toHaveBeenCalledTimes(1);expect(container.textContent).toContain("Check document status");expect(container.textContent).not.toContain("Document removed.");await click("Check document status");expect(state.remove).toHaveBeenCalledTimes(1);});
  it("reports retained source files and missing receipt after verified deletion",async()=>{state.remove.mockResolvedValue({outcome:"capability_completed_unrecorded",document_absent:true,chunks_absent:true});await render();await click("Intake guide");await click("Remove document");expect(container.textContent).toContain("Document removed.");expect(container.textContent).toContain("Original uploaded files were retained.");expect(container.textContent).toContain("receipt");});
});
