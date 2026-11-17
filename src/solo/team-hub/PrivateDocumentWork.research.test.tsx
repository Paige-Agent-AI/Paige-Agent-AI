import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepPrivateDocumentWork, keepPrivateResearchWork, privateDocumentWorkSnapshot } from "@/lib/privateDocumentWorkHandoff";
import { PrivateDocumentWork } from "./PrivateDocumentWork";

const { invoke, getSession, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession }, functions: { invoke }, rpc } }));
vi.mock("@/components/paige/chat/PaigeResearchCard", () => ({
  PaigeResearchCard: ({ result }: { result: { run_id: string; sources: { index: number; url: string }[] } }) =>
    <div data-research={result.run_id}>{result.sources.map(s => `[${s.index}] ${s.url}`).join(" ")}</div>,
}));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({ PaigeArtifactCard: () => <div data-document /> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2), receipt = id(7);
const reference = { threadId: id(3), intentId: id(4), workId: id(5) };
const complete = { error: null, data: { durable_work: { ...reference, version: 3, state: "succeeded",
  recoveryState: "terminal_unverified", artifactVerified: false,
  continuation: { workId: reference.workId, state: "succeeded", eligibleForContext: true,
    reason: "canonical_terminal", completion: { resultRef: reference.workId, receiptRef: receipt } } } } };
const pending = { error: null, data: { durable_work: { ...complete.data.durable_work,
  state: "claimed", recoveryState: "observed", continuation: null } } };
const report = { id: reference.workId, question: "Original question", configured: true, stop_reason: "max_hops",
  findings: [{ text: "Original cited finding", confidence: "high", citations: [4] }], coverage: {},
  sources: [{ index: 4, url: "https://example.com/original", title: "Original", tier: null, reliability: null, excluded: false }] };
const session = (user = actor) => ({ data: { session: { user: { id: user }, access_token: "fixture" } } });
const read = (data: unknown) => ({ abortSignal: async () => ({ data, error: null }) });
let host: HTMLDivElement, root: Root;

beforeEach(() => {
  window.sessionStorage.clear();
  getSession.mockReset().mockResolvedValue(session());
  invoke.mockReset().mockResolvedValue(complete);
  rpc.mockReset().mockImplementation(name => read(name === "current_user_tenant_id" ? tenant : report));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
async function open(user = actor, workspace = tenant, key = `${user}:${workspace}`) {
  await act(async () => root.render(<PrivateDocumentWork key={key} actorId={user} tenantId={workspace} />));
  await act(async () => { const details = host.querySelector("details")!; details.open = true; details.dispatchEvent(new Event("toggle")); });
}
async function check() { await act(async () => button("Check original research status")!.click()); }

describe("Team Hub original Research handoff", () => {
  it("uses the original Research control and rechecks the same report, citation and receipt after remount", async () => {
    keepPrivateResearchWork(actor, tenant, reference);
    for (let visit = 0; visit < 2; visit++) {
      await open();
      expect(invoke).toHaveBeenCalledTimes(visit * 2);
      expect(host.textContent).not.toContain(receipt);
      expect(button("Check original document status")).toBeUndefined();
      await check();
      expect(host.querySelector("[data-research]")?.getAttribute("data-research")).toBe(reference.workId);
      expect(host.textContent).toContain(`[4] https://example.com/original`);
      expect(host.textContent).toContain(receipt);
      expect(button("Keep in Team Hub")).toBeUndefined();
      await act(async () => root.render(null));
    }
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(invoke.mock.calls.every(([, args]) => args.body.interactive.kind === "status" &&
      args.body.requestIntentId === reference.intentId && args.body.interactive.workId === reference.workId)).toBe(true);
  });

  it("recovers only the same original job after an explicit action and never repeats a lost response", async () => {
    keepPrivateResearchWork(actor, tenant, reference);
    invoke.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ data: null, error: new Error("response lost") }).mockResolvedValue(complete);
    await open(); await check();
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { button("Recover original research")!.click(); button("Recover original research")!.click(); });
    const resumes = invoke.mock.calls.filter(([, args]) => args.body.researchResume);
    expect(resumes).toHaveLength(1);
    expect(resumes[0][1].body).toEqual({ threadId: reference.threadId, requestIntentId: reference.intentId,
      messages: [{ role: "user", content: "Resume original research" }], interactive: { kind: "message" },
      researchResume: { workId: reference.workId } });
    expect(host.textContent).toContain(receipt);
    expect(host.querySelector("[data-research]")).not.toBeNull();
  });

  it("retires a pending Research read when a Document replaces its locator", async () => {
    keepPrivateResearchWork(actor, tenant, reference);
    await open();
    let settle!: (value: typeof complete) => void;
    invoke.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    await check();
    const signal = invoke.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { keepPrivateDocumentWork(actor, tenant, { ...reference, workId: id(8) }); });
    expect(signal.aborted).toBe(true);
    await act(async () => settle(complete));
    expect(button("Check original document status")).toBeDefined();
    expect(host.textContent).not.toContain(receipt);
    expect(host.querySelector("[data-research]")).toBeNull();
  });

  it("withholds an already-read report when the same untrusted locator appears under a different scope", async () => {
    keepPrivateResearchWork(actor, tenant, reference);
    await open(actor, tenant, "same-host"); await check();
    expect(host.textContent).toContain(receipt);
    keepPrivateResearchWork(id(8), id(9), reference);
    await open(id(8), id(9), "same-host");
    expect(host.textContent).not.toContain(receipt);
    expect(host.querySelector("[data-research]")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not inspect another actor or workspace and refuses a retired session", async () => {
    keepPrivateResearchWork(actor, tenant, reference);
    for (const [user, workspace] of [[id(8), tenant], [actor, id(9)]]) {
      await open(user, workspace);
      expect(button("Check original research status")).toBeUndefined();
    }
    expect(invoke).not.toHaveBeenCalled();
    await open(); getSession.mockResolvedValue(session(id(8))); await check();
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(receipt);
  });

  it.each(["denied", "different-work"])("withholds evidence for %s without a new execution", async reason => {
    keepPrivateResearchWork(actor, tenant, reference);
    invoke.mockResolvedValue(reason === "denied" ? { data: null, error: { context: { status: 403 } } }
      : { data: { durable_work: { ...complete.data.durable_work, workId: id(9) } }, error: null });
    await open(); await check();
    expect(host.textContent).toContain("could not be verified");
    expect(host.textContent).not.toContain(receipt);
    expect(host.querySelector("[data-research]")).toBeNull();
    expect(invoke.mock.calls.every(([, args]) => args.body.interactive.kind === "status")).toBe(true);
  });

  it("removes only the current reference and returns focus without deleting the original work", async () => {
    keepPrivateResearchWork(actor, tenant, reference); await open();
    await act(async () => button("Remove saved reference")!.click());
    expect(privateDocumentWorkSnapshot(actor, tenant)).toBeNull();
    expect(document.activeElement?.tagName).toBe("SUMMARY");
    expect(invoke).not.toHaveBeenCalled();
  });
});
