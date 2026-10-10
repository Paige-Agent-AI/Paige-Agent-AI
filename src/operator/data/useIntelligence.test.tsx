import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceSurface from "@/operator/surfaces/settings/IntelligenceSurface";
import { syntheticTrajectory, syntheticTrajectoryPage } from "@/test/fixtures/trajectory";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, auth: {
  getSession: mock.getSession, onAuthStateChange: mock.auth,
} } }));
let notify: (event: string, session: { user: { id: string } } | null) => void;
let root: Root; let node: HTMLDivElement; let cache: QueryClient;
const user = (id: string) => ({ user: { id } });
let denial = false;
let delayed: ((value: { data: unknown; error: unknown }) => void) | undefined;
beforeEach(() => {
  denial = false; delayed = undefined; mock.rpc.mockReset();
  mock.getSession.mockResolvedValue({ data: { session: user("operator-a") } });
  mock.auth.mockImplementation((cb) => { notify = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
  mock.rpc.mockImplementation((name: string) => {
    if (name === "is_platform_admin") return Promise.resolve({ data: true, error: null });
    const value = name === "operator_intelligence_metrics" ? { traces: { total: 12345 } } : name === "operator_intelligence_trajectories" ? { contract_version: 1, observed_at: "2026-10-10T12:00:00Z", items: [], next_cursor: null } : [];
    return { abortSignal: () => name === "operator_intelligence_trace_tail" && delayed
      ? new Promise((resolve) => { delayed = resolve; })
      : Promise.resolve({ data: value, error: denial ? { code: "42501" } : null }) };
  });
});
async function mount() {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(<QueryClientProvider client={cache}><IntelligenceSurface /></QueryClientProvider>));
  await vi.waitFor(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); expect(node.textContent).toContain("12,345"); });
}
async function click(text: string) {
  const button = Array.from(node.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.includes(text))!;
  await act(async () => { button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); button.click(); });
}
async function draft() {
  await click("Improvement Studio");
  const field = node.querySelector<HTMLTextAreaElement>("#intel-improvement-problem")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Keep my recommendation");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
afterEach(async () => { if (root) await act(async () => root.unmount()); cache?.clear(); node?.remove(); });
describe("Operator Intelligence identity and authority fences", () => {
  it("refuses trajectory permission and discards all previously readable evidence", async () => {
    await mount();
    mock.rpc.mockImplementation((name: string) => ({ abortSignal: () => Promise.resolve({
      data: null, error: name === "operator_intelligence_trajectories" ? { code: "42501" } : null,
    }) }));
    await act(async () => { await cache.invalidateQueries({ queryKey: ["operator_intelligence", "operator-a", 1, "trajectories"] }); });
    await flush();
    expect(node.textContent).toContain("Platform Operator access required");
    expect(node.textContent).not.toContain("12,345");
  });
  it("does not render an unsupported trajectory contract as task evidence", async () => {
    await mount();
    mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: { ...syntheticTrajectoryPage(), contract_version: 2 }, error: null }) }));
    await act(async () => { await cache.invalidateQueries({ queryKey: ["operator_intelligence", "operator-a", 1, "trajectories"] }); });
    await click("Forensic Observatory"); await flush();
    expect(node.textContent).toContain("Task trajectories could not load");
    expect(node.textContent).not.toContain(syntheticTrajectory.id);
  });
  it("fences a late selected task after close and account switch", async () => {
    await mount(); let resolveTask: (value: unknown) => void = () => {};
    mock.rpc.mockImplementation((name: string, args: { p_work_id?: string }) => {
      if (name === "is_platform_admin") return Promise.resolve({ data: true, error: null });
      return { abortSignal: () => name === "operator_intelligence_trajectories" && args.p_work_id
        ? new Promise(resolve => { resolveTask = resolve; })
        : Promise.resolve({ data: name === "operator_intelligence_trajectories" ? syntheticTrajectoryPage() : [], error: null }) };
    });
    await act(async () => { await cache.invalidateQueries({ queryKey: ["operator_intelligence", "operator-a", 1, "trajectories"] }); });
    await click("Forensic Observatory"); await click("Inspect task"); await flush();
    await click("Close inspection");
    resolveTask({ data: syntheticTrajectoryPage(), error: null }); await flush();
    expect(node.textContent).not.toContain("Recorded task timeline");
    await click("Inspect task"); await flush();
    await act(async () => { notify("SIGNED_IN", user("operator-b")); }); await flush();
    resolveTask({ data: syntheticTrajectoryPage(), error: null }); await flush();
    expect(node.textContent).not.toContain("Recorded task timeline");
  });
  it("retains a session draft through same-user renewal and refocus sign-in", async () => {
    await mount(); await draft();
    await act(async () => { notify("TOKEN_REFRESHED", user("operator-a")); }); await flush();
    await act(async () => { notify("SIGNED_IN", user("operator-a")); }); await flush();
    expect(node.querySelector<HTMLTextAreaElement>("#intel-improvement-problem")?.value).toBe("Keep my recommendation");
  });
  it("discards the previous subject's draft on account switch and removes evidence on sign-out", async () => {
    await mount(); await draft();
    await act(async () => { notify("SIGNED_IN", user("operator-b")); }); await flush(); await click("Improvement Studio");
    expect(node.querySelector<HTMLTextAreaElement>("#intel-improvement-problem")?.value).toBe("");
    await act(async () => { notify("SIGNED_OUT", null); });
    expect(node.textContent).toContain("Platform Operator access required"); expect(node.textContent).not.toContain("12,345");
  });
  it("fences all evidence and drafts after one source refuses permission, including delayed reads", async () => {
    await mount(); await draft(); delayed = () => {};
    await act(async () => { void cache.invalidateQueries({ queryKey: ["operator_intelligence", "operator-a", 1, "traces"] }); });
    denial = true;
    await act(async () => { await cache.invalidateQueries({ queryKey: ["operator_intelligence", "operator-a", 1, "metrics"] }); }); await flush();
    expect(node.textContent).toContain("Platform Operator access required");
    expect(node.querySelector("textarea")).toBeNull(); expect(node.textContent).not.toContain("12,345");
    delayed?.({ data: [{ id: "late-private-trace" }], error: null }); await flush();
    expect(node.textContent).not.toContain("late-private-trace"); expect(node.textContent).not.toContain("Download draft");
  });
  it("drops a late old-user authority response after sign-out", async () => {
    await mount(); let allow: (value: unknown) => void = () => {};
    mock.rpc.mockImplementation((name) => name === "is_platform_admin" ? new Promise((resolve) => { allow = resolve; }) : { abortSignal: () => Promise.resolve({ data: [], error: null }) });
    await act(async () => notify("TOKEN_REFRESHED", user("operator-a")));
    await act(async () => notify("SIGNED_OUT", null));
    allow({ data: true, error: null }); await flush();
    expect(node.textContent).toContain("Platform Operator access required");
  });
});
