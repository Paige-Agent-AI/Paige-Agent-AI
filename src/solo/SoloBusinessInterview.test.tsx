import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanSoloSetupBrief } from "./settings-setup-contract";
import { SoloBusinessInterview } from "./SoloBusinessInterview";
const state = vi.hoisted(() => ({ context: {} as Record<string, unknown>, rpc: vi.fn(), save: vi.fn(), reconcile: vi.fn(), refresh: vi.fn(), tenant: "tenant-a" }));
vi.mock("./data/useSoloBusinessContext", () => ({ useSoloBusinessContext: () => state.context }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: state.tenant, activeTenant: { account_number: "test-tenant-a" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
let host: HTMLDivElement; let root: Root;
async function render(threadId: string | null = "thread-a", busy = false) { await act(async () => root.render(<MemoryRouter><SoloBusinessInterview threadId={threadId} busy={busy} refreshEpoch={0} onPause={() => {}} /></MemoryRouter>)); }
function button(text: string) { return [...host.querySelectorAll("button")].find(node => node.textContent === text)!; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function input(value: string) { await act(async () => { const node = host.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => {
  state.tenant = "tenant-a"; state.rpc.mockReset(); state.save.mockReset(); state.refresh.mockReset();
  state.context = { loading: false, error: null, saving: false, accessScope: "owner_full", resolvedTenantId: "tenant-a", contextRevision: 7,
    brief: cleanSoloSetupBrief({ publicName: "Test business", industry: "Consulting", provenance: { industry: { source: "connection_sourced", confidence: "observed" } }, updatedAt: "original" }),
    pendingProposal: null, businessOwners: [{ id: "existing-owner" }], primaryBusinessEmail: "test@example.invalid", knowledgeSources: [{ id: "existing-source" }], paigeProfile: { identity: "existing-profile" }, voiceExamples: [{ id: "existing-example" }], save: state.save, refresh: state.refresh };
  state.rpc.mockImplementation(async (_name, args) => ({ data: args._checkpoint ? { tenantId: state.tenant, threadId: args._thread_id, ...args._checkpoint, contextRevisionAtCheckpoint: args._expected_context_revision } : null, error: null }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("owner interview review over canonical Setup", () => {
  it("restores correction focus only after a delayed checkpoint releases the controls", async () => {
    const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const flush = async () => act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
    let resolveWrite!: (value: unknown) => void;
    state.rpc.mockImplementation(async (name) => name === "get_solo_business_interview_checkpoint" ? { data: null, error: null } : await new Promise(resolve => { resolveWrite = resolve; }));
    state.save.mockResolvedValue({ ok: true, kind: "saved", readback: { tenantId: "tenant-a", brief: state.context.brief, contextRevision: 8 } });
    await render(); await click(host.querySelector('[aria-label="Correct Industry"]')!); await click(button("Confirm and save to Setup"));
    await flush(); expect((host.querySelector('[aria-label="Correct Industry"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveWrite({ data: { tenantId: "tenant-a", threadId: "thread-a", phase: "active", nextField: "industry", contextRevisionAtCheckpoint: 8 }, error: null }));
    await flush(); expect(document.activeElement).toBe(host.querySelector('[aria-label="Correct Industry"]'));
  });
  it("requires explicit review/save, preserves unrelated records, then supports correction in the same thread", async () => {
    state.save.mockImplementation(async next => { state.context.brief = cleanSoloSetupBrief({ ...next.brief, industry: next.brief.industry.trim(), updatedAt: "stored" }); state.context.contextRevision = 8; return { ok: true, kind: "saved", readback: { tenantId: "tenant-a", brief: state.context.brief, contextRevision: 8 } }; });
    await render(); expect(state.save).not.toHaveBeenCalled();
    await click(host.querySelector('[aria-label="Correct Industry"]')!); await input("  Design consultancy  ");
    expect(state.save).not.toHaveBeenCalled(); await click(button("Confirm and save to Setup")); await render();
    const saved = state.save.mock.calls[0][0];
    expect(saved.knowledgeSources).toBe(state.context.knowledgeSources); expect(saved.voiceExamples).toBe(state.context.voiceExamples); expect(saved.businessOwners).toBe(state.context.businessOwners);
    expect(saved.brief.provenance.industry.source).toBe("owner_confirmed"); expect(saved.brief.sourceDecisions.industry).toBe("override");
    expect(host.textContent).toContain("Design consultancy"); expect(host.textContent).toContain("read back from the server");
    expect(state.rpc).toHaveBeenCalledWith("save_solo_business_interview_checkpoint", expect.objectContaining({ _thread_id: "thread-a", _expected_context_revision: 8 }));
    await click(host.querySelector('[aria-label="Correct Industry"]')!); await input("Architecture practice"); await click(button("Confirm and save to Setup")); await render();
    expect(state.save.mock.calls[1][0].brief.industry).toBe("Architecture practice"); expect(host.textContent).toContain("Architecture practice");
  });
  it("blocks a stale review rather than overwrite a newer Setup snapshot", async () => {
    await render(); await click(host.querySelector('[aria-label="Correct Industry"]')!); state.context.contextRevision = 9; await render(); await click(button("Confirm and save to Setup"));
    expect(state.save).not.toHaveBeenCalled(); expect(host.textContent).toContain("Setup changed while you were reviewing");
  });
  it("adopts an unchanged connection-sourced fact after explicit review", async () => {
    state.save.mockResolvedValue({ ok: false, kind: "failed", error: "Synthetic writer unavailable." });
    await render(); await click(host.querySelector('[aria-label="Correct Industry"]')!); await click(button("Confirm and save to Setup"));
    expect(state.save.mock.calls[0][0].brief.sourceDecisions.industry).toBe("adopt");
  });
  it("ignores an earlier checkpoint read after the owner records newer navigation", async () => {
    let resolveGet!: (value: unknown) => void;
    state.rpc.mockImplementation(async (name, args) => name === "get_solo_business_interview_checkpoint"
      ? await new Promise(resolve => { resolveGet = resolve; })
      : { data: { tenantId: "tenant-a", threadId: "thread-a", ...args._checkpoint, contextRevisionAtCheckpoint: args._expected_context_revision }, error: null });
    await render(); await click(button("Skip this topic"));
    await act(async () => resolveGet({ data: { tenantId: "tenant-a", threadId: "thread-a", phase: "paused", nextField: "offers", contextRevisionAtCheckpoint: 7 }, error: null }));
    expect(button("Resume interview")).toBeUndefined(); expect(button("Pause interview")).toBeTruthy();
    await click(button("Skip this topic"));
    const writes = state.rpc.mock.calls.filter(([name]) => name === "save_solo_business_interview_checkpoint");
    expect(writes[1][1]._checkpoint.nextField).toBe("offers");
  });
  it("does not claim success after a failed writer", async () => {
    state.save.mockResolvedValue({ ok: false, kind: "conflict", error: "Reload before retrying." });
    await render(); await click(host.querySelector('[aria-label="Correct Industry"]')!); await click(button("Confirm and save to Setup"));
    expect(host.textContent).toContain("Reload before retrying."); expect(host.textContent).not.toContain("Saved to Setup"); expect(state.rpc.mock.calls.filter(([name]) => name.startsWith("save_"))).toHaveLength(0);
  });
  it("retains an uncertain edit, checks the canonical record, and never retries the save", async () => {
    state.context.reconcileSave = state.reconcile;
    state.save.mockImplementation(async () => {
      state.context.saveOutcomeUnknown = true;
      return { ok: false, kind: "unknown", error: "Unknown save" };
    });
    await render(); await click(host.querySelector('[aria-label="Correct Industry"]')!); await input("Design consultancy");
    await click(button("Confirm and save to Setup")); await render();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Design consultancy");
    expect((button("Confirm and save to Setup") as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).not.toContain("Saved to Setup");
    state.reconcile.mockImplementation(async () => {
      state.context.saveOutcomeUnknown = false;
      const brief = cleanSoloSetupBrief({ industry: "Design consultancy", provenance: { industry: { source: "owner_confirmed", confidence: "confirmed" } } });
      state.context.brief = brief;
      return { ok: true, kind: "reconciled", readback: { tenantId: "tenant-a", brief, contextRevision: 8 } };
    });
    await click(button("Check saved Setup")); await render();
    expect(host.textContent).toContain("on file in Setup");
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls.filter(([name]) => name.startsWith("save_"))).toHaveLength(0);
  });
  it("retains successful Setup evidence when checkpoint recording fails", async () => {
    state.save.mockResolvedValue({ ok: true, kind: "saved", readback: { tenantId: "tenant-a", brief: state.context.brief, contextRevision: 8 } });
    await render(); state.rpc.mockResolvedValue({ data: null, error: true }); await click(host.querySelector('[aria-label="Correct Industry"]')!); await click(button("Confirm and save to Setup"));
    expect(host.textContent).toContain("Setup was saved. Interview progress was not recorded");
  });
  it("routes a mixed/private proposal to complete Setup without consuming it", async () => {
    state.context.pendingProposal = { id: "proposal-a", reason: "review", proposedAt: "now", patch: { industry: "Design", registeredStreet: "private" } };
    await render(); expect(button("Review in Setup")).toBeTruthy(); expect(host.querySelector("textarea")).toBeNull(); expect(state.save).not.toHaveBeenCalled();
  });
  it("resumes navigation but does not treat the checkpoint as confirmed business facts", async () => {
    state.rpc.mockResolvedValue({ data: { tenantId: "tenant-a", threadId: "thread-a", phase: "paused", nextField: "offers", contextRevisionAtCheckpoint: 1 }, error: null });
    await render(); expect(button("Resume interview")).toBeTruthy(); expect(host.textContent).toContain("Not yet recorded"); expect(state.save).not.toHaveBeenCalled();
  });
  it("fences owner controls on account switch and while Chat is busy", async () => {
    await render("thread-a", true); expect((host.querySelector('[aria-label="Correct Industry"]') as HTMLButtonElement).disabled).toBe(true);
    state.tenant = "tenant-b"; await render(); expect(host.querySelector("textarea")).toBeNull(); expect(host.querySelector('[aria-label="Correct Industry"]')).toBeNull();
  });
});
