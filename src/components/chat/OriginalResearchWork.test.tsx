import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginalResearchWork } from "./OriginalResearchWork";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { getSession, invoke, rpc } = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession }, functions: { invoke }, rpc } }));
vi.mock("@/components/paige/chat/PaigeResearchCard", () => ({
  PaigeResearchCard: ({ result }: { result: { run_id: string; stop_reason: string; sources: { index: number; url: string }[] } }) =>
    <div>Report {result.run_id} {result.stop_reason} {result.sources.map(s => `[${s.index}] ${s.url}`).join(" ")}</div>,
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reference = { threadId: id(1), intentId: id(2), workId: id(3) };
const receiptRef = id(4), actorId = id(6), tenantId = id(7);
const response = { error: null, data: { durable_work: { ...reference, state: "succeeded", version: 3,
  recoveryState: "terminal_unverified", artifactVerified: false, artifactRef: null,
  continuation: { workId: reference.workId, eligibleForContext: true, reason: "canonical_terminal",
    state: "succeeded", completion: { resultRef: reference.workId, receiptRef } } } } };
const report = { id: reference.workId, question: "Original question", configured: true, stop_reason: "max_hops",
  findings: [{ text: "A cited finding", confidence: "high", citations: [4] }], coverage: {},
  sources: [{ index: 4, url: "https://example.com/original", title: "Original", tier: null, reliability: null, excluded: false }] };
const read = (value: unknown) => ({ abortSignal: () => Promise.resolve(value) });

describe("original Research status control", () => {
  let host: HTMLDivElement, root: Root, active: boolean;
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); active = true;
    getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: actorId }, access_token: "fixture" } } });
    invoke.mockReset().mockResolvedValue(response);
    rpc.mockReset().mockImplementation(name => read({ error: null, data: name === "current_user_tenant_id" ? tenantId : report }));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  async function open(key = "first") {
    await act(async () => root.render(<OriginalResearchWork key={key} reference={reference}
      actorId={actorId} tenantId={tenantId} current={() => active} />));
  }
  async function click() { await act(async () => host.querySelector("button")!.click()); }

  it("reopens the exact saved partial report, original citation numbering and receipt using reads only", async () => {
    await open();
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { host.querySelector("button")!.click(); host.querySelector("button")!.click(); });
    expect(invoke).toHaveBeenCalledTimes(2); // one check, receipt pinned before/after report
    expect(host.textContent).toContain(receiptRef);
    expect(host.textContent).toContain(reference.workId);
    expect(host.textContent).toContain("max_hops");
    expect(host.textContent).toContain("[4] https://example.com/original");
    await open("reload");
    expect(host.textContent).not.toContain(receiptRef);
    await click();
    expect(host.textContent).toContain(receiptRef);
    expect(invoke).toHaveBeenCalledTimes(4);
    for (const [, args] of invoke.mock.calls) expect(args.body).toEqual({ threadId: reference.threadId,
      requestIntentId: reference.intentId, messages: [{ role: "user", content: "Status" }],
      interactive: { kind: "status", workId: reference.workId } });
    expect(rpc.mock.calls.every(([name]) => ["current_user_tenant_id", "get_workspace_research_run"].includes(name))).toBe(true);
  });

  it("withholds the report if its original receipt changes during the governed read", async () => {
    invoke.mockResolvedValueOnce(response).mockResolvedValueOnce({ ...response, data: { durable_work: {
      ...response.data.durable_work, continuation: { ...response.data.durable_work.continuation,
        completion: { resultRef: reference.workId, receiptRef: id(9) } } } } });
    await open(); await click();
    expect(host.textContent).toContain("could not be verified");
    expect(host.textContent).not.toContain(receiptRef);
    expect(host.textContent).not.toContain("Report ");
  });

  it.each(["actor", "workspace"])("refuses changed %s after the first status await", async changed => {
    invoke.mockImplementation(async () => {
      if (changed === "actor") getSession.mockResolvedValue({ data: { session: { user: { id: id(9) } } } });
      else rpc.mockImplementation(() => read({ error: null, data: id(9) }));
      return response;
    });
    await open(); await click();
    expect(host.textContent).not.toContain(receiptRef);
    expect(rpc.mock.calls.some(([name]) => name === "get_workspace_research_run")).toBe(false);
  });

  it("aborts and discards a late response after leaving the conversation", async () => {
    let settle!: (value: typeof response) => void;
    invoke.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    await open(); await click();
    const signal = invoke.mock.calls[0][1].signal as AbortSignal;
    await open("other");
    expect(signal.aborted).toBe(true);
    await act(async () => settle(response));
    expect(host.textContent).not.toContain(receiptRef);
    expect(rpc.mock.calls.some(([name]) => name === "get_workspace_research_run")).toBe(false);
  });

  it("inspects the same intent after UNKNOWN without creating a new run", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("response lost") });
    await open(); await click();
    expect(host.textContent).toContain("could not be verified");
    expect(invoke).toHaveBeenCalledTimes(1);
    await click();
    expect(host.textContent).toContain(receiptRef);
    expect(invoke.mock.calls.every(([, args]) => args.body.requestIntentId === reference.intentId &&
      args.body.interactive.kind === "status")).toBe(true);
  });

  it("respects rate-limit Retry-After without a duplicate request", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(null, { status: 429, headers: { "Retry-After": "30" } }) } });
    await open(); await click(); await click();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("could not be verified");
  });

  it("withholds evidence when the governed report read is denied or incomplete", async () => {
    rpc.mockImplementation(name => read(name === "current_user_tenant_id"
      ? { data: tenantId, error: null } : { data: { ...report, sources: [] }, error: null }));
    await open(); await click();
    expect(host.textContent).toContain("could not be verified");
    expect(host.textContent).not.toContain(receiptRef);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("discards the report when the workspace changes during its awaited read", async () => {
    rpc.mockImplementation(name => {
      if (name === "current_user_tenant_id") return read({ data: tenantId, error: null });
      return { abortSignal: async () => {
        rpc.mockImplementation(() => read({ data: id(9), error: null }));
        return { data: report, error: null };
      } };
    });
    await open(); await click();
    expect(host.textContent).not.toContain(receiptRef);
    expect(host.textContent).not.toContain("Report ");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("recovers the original pending job explicitly, then inspects the same report and receipt without a question", async () => {
    const pending = { error: null, data: { durable_work: { ...response.data.durable_work,
      state: "claimed", recoveryState: "observed", continuation: null } } };
    invoke.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ data: null, error: new Error("resume response lost") }).mockResolvedValue(response);
    await open(); await click();
    const recover = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Recover original research")!;
    await act(async () => { recover.click(); recover.click(); });
    const resumes = invoke.mock.calls.filter(([, args]) => args.body.researchResume);
    expect(resumes).toHaveLength(1);
    expect(resumes[0][1].body).toEqual({ threadId: reference.threadId, requestIntentId: reference.intentId,
      messages: [{ role: "user", content: "Resume original research" }], interactive: { kind: "message" },
      researchResume: { workId: reference.workId } });
    expect(host.textContent).toContain(receiptRef);
    expect(host.textContent).toContain(reference.workId);
    expect(invoke.mock.calls.filter(([, args]) => args.body.interactive.kind === "status")).toHaveLength(4);
  });
});
