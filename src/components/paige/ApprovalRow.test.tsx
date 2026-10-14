import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalRow } from "./ApprovalRow";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";
const h = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn(), decision: null as Record<string, unknown> | null, filters: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: h.invoke }, from: () => {
  const q: Record<string, unknown> = {};
  q.update = () => q; q.select = () => q; q.eq = (...args: unknown[]) => { h.filters.push(args); return q; };
  q.maybeSingle = async () => ({ data: h.decision, error: null }); return q;
} } }));
vi.mock("sonner", () => ({ toast: { error: h.error } }));
vi.mock("@/components/ui/page", () => ({ PaigeAttribution: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const resolved = vi.fn();
const row = { id: "test-approval", category: "owner.lead_followup", tenant_id: "test-tenant-a", contact_id: "test-contact", status: "pending", summary: "Reply to a lead", sla_state: "on_track", draft_content: null } as ApprovalQueueRow;
async function render(next: Partial<ApprovalQueueRow> = {}) {
  await act(async () => { root.render(<MemoryRouter initialEntries={["/solo/test-account/command-center"]}><ApprovalRow a={{ ...row, ...next }} onResolved={resolved} /></MemoryRouter>); });
}
async function approve() { await act(async () => { [...host.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Approve")!.click(); }); }
beforeEach(() => { h.invoke.mockReset(); h.error.mockClear(); h.decision=null; h.filters=[]; resolved.mockClear(); host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe("approval contextual entry and truthful result",()=>{
  it("routes lead replies to their canonical contact thread, without generic execute approval",async()=>{
    await render(); const link=[...host.querySelectorAll("a")].find(a=>a.textContent==="Review reply");
    expect(link?.getAttribute("href")).toBe("/solo/test-account/clients/conversations?contact=test-contact&approval=test-approval");
    expect([...host.querySelectorAll("button")].some(b=>b.textContent==="Approve")).toBe(false);expect(h.invoke).not.toHaveBeenCalled();
  });
  it("does not invent a destination for a lead without a contact",async()=>{
    await render({contact_id:null});expect(host.textContent).toContain("Open this lead in Conversations");expect(host.querySelector("a")).toBeNull();expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each([null,{}, {ok:false,outcome:"held"}])("keeps a generic row when completion is unconfirmed: %j",async(data)=>{
    h.invoke.mockResolvedValue({data,error:null});await render({category:"owner.review"});await approve();expect(resolved).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalled();expect(host.textContent).toContain("Approve");
  });
  it("keeps the row and recovers the control after a thrown transport failure",async()=>{
    h.invoke.mockRejectedValue(new Error("private transport detail"));await render({category:"owner.review"});await approve();expect(resolved).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't confirm"));expect(host.textContent).toContain("Approve");
  });
  it("resolves a generic approval only on an explicit positive receipt",async()=>{
    h.invoke.mockResolvedValue({data:{ok:true},error:null});await render({category:"owner.review"});await approve();expect(resolved).toHaveBeenCalledTimes(1);
  });
  it.each([{category:"client.followup"},{category:"email",type:"email_draft",metadata:{held_draft_message_id:null}}])("older or unprovable held replies are decline-only: %j",async(next)=>{
    await render(next); expect(host.textContent).toContain("This older draft cannot send");expect([...host.querySelectorAll("button")].some(b=>b.textContent==="Approve")).toBe(false);expect(host.textContent).toContain("Decline");expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each([null,{id:"foreign",status:"rejected"},{id:row.id,status:"pending"}])("does not collapse a decline without exact row readback: %j",async(decision)=>{
    h.decision=decision;await render({category:"client.followup"});
    await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Decline")!.click();});
    const reason=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(reason,"Prepare a fresh reply");reason.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Decline draft")!.click();});
    expect(resolved).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalled();expect(h.filters).toContainEqual(["tenant_id",row.tenant_id]);expect(h.filters).toContainEqual(["status","pending"]);
  });
});
