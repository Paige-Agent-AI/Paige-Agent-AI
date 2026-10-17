import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRailApi } from "./PaigeAIChat";

const port = vi.hoisted(() => ({
  tenant: "test-tenant-a" as string | null,
  actor: "test-owner-a" as string | null,
  turns: [] as Array<Record<string, unknown>>,
  rail: null as ChatRailApi | null,
  read: vi.fn(),
  loadTurns: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: port.tenant }) }));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => port.actor }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => null }));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({ PaigeLiveConversation: () => null }));
vi.mock("@/components/chat/MessageAudioButton", () => ({ MessageAudioButton: () => null }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({ useChatDocumentUpload: () => ({
  attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
  handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
  removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => port.read(...args),
  auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-session" } } })) },
} }));
vi.mock("@/hooks/usePaigeThreads", () => ({ usePaigeThreads: () => ({
  threads: [{ id: "thread-a", title: "Saved research", updated_at: "2026-01-01" }],
  isLoading: false, isFetched: true, loadTurns: (...args: unknown[]) => port.loadTurns(...args),
  ensureThread: vi.fn(async () => "thread-a"), onTurnPersisted: vi.fn(),
  renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
}) }));

import { PaigeAIChat } from "./PaigeAIChat";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const storedTurn = (saved = true, runId: string | null = "run-a", id = "answer-a") => ({
  id, role: "assistant", content: "Here is the earlier research.",
  bundle_ref: { paige_research: [{ run_id: runId, question: "Stored question", saved }] },
});
const run = (text = "Canonical finding", id = "run-a") => ({
  id, question: "Canonical question", configured: true, stop_reason: "answered", entity_profile: null,
  findings: [{ text, citations: [7, 2], confidence: "high" }],
  sources: [
    { index: 2, url: "https://example.org/two", title: "Second source", reliability: "high", tier: "A", excluded: false },
    { index: 7, url: "https://example.org/seven", title: "Seventh source", reliability: "high", tier: "A", excluded: false },
  ],
  coverage: { unverified_notes: ["Historical context remains limited"] },
});

describe("ordinary Chat history restores existing Research through its governed reader", () => {
  let host: HTMLDivElement;
  let root: Root;
  let instance = 0;
  beforeEach(() => {
    instance += 1;
    port.tenant = `test-tenant-${instance}`;
    port.actor = "test-owner-a";
    port.turns = [storedTurn()];
    port.read.mockReset().mockResolvedValue({ data: run(), error: null });
    port.loadTurns.mockReset().mockImplementation(async () => port.turns);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"New answer"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const render = async (thread = "thread-a") => {
    await act(async () => {
      root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false}
        activeThreadId={thread} renderRail={api => { port.rail = api; return null; }} />);
      await flush();
    });
  };
  const cards = () => Array.from(host.querySelectorAll<HTMLElement>("[data-research-card]"));
  const unavailable = () => {
    expect(host.textContent).toContain("Unavailable");
    expect(host.textContent).not.toContain("Reloading");
    expect(host.textContent).not.toContain("Loading this run");
    expect(host.querySelector(".dr-saved")).toBeNull();
  };

  it("actually calls the reader once per run and renders canonical evidence with original citation indices", async () => {
    port.turns.push(storedTurn(true, "run-a", "answer-b"));
    await render();
    expect(port.read.mock.calls).toEqual([["get_workspace_research_run", { _run_id: "run-a" }]]);
    expect(cards()).toHaveLength(2);
    expect(cards().every(card => card.textContent?.includes("Canonical finding"))).toBe(true);
    expect(host.querySelectorAll(".dr-saved")).toHaveLength(2);
    expect(cards()[0].querySelector(".dr-cites")?.textContent).toBe("[7] Seventh source [2] Second source ");
    expect(host.textContent).toContain("Historical context remains limited");
    expect(host.textContent).not.toContain("Loading this run");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => (cards()[0].querySelector(".dr-sources-toggle") as HTMLButtonElement).click());
    expect(cards()[0].querySelector("ol")?.textContent).toContain("[7] Seventh source");
  });

  it("does not invent a reader call or a saved outcome for an unsaved reference with no run identity", async () => {
    port.turns = [storedTurn(false, null)];
    await render();
    expect(port.read).not.toHaveBeenCalled();
    unavailable();
  });

  it("can display current evidence without promoting a historical unconfirmed save", async () => {
    port.turns = [storedTurn(false)];
    await render();
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Canonical finding");
    expect(host.querySelector(".dr-saved")).toBeNull();
  });

  it.each(["null", "denied", "throw"])("settles a %s read without a stale Saved badge or automatic replay", async kind => {
    if (kind === "throw") port.read.mockRejectedValue(new Error("private provider detail"));
    else port.read.mockResolvedValue({ data: kind === "denied" ? run() : null, error: kind === "denied" ? { message: "private denial" } : null });
    await render();
    expect(port.read).toHaveBeenCalledTimes(1);
    unavailable();
    expect(host.textContent).not.toMatch(/private|Canonical finding/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds a hung read, suppresses its later success and never retries the research", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValue(pending.promise);
    await render();
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Loading this run");
    expect(host.querySelector(".dr-saved")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_001); await flush(); });
    unavailable();
    await act(async () => { pending.resolve({ data: run("Late finding"), error: null }); await flush(); });
    unavailable();
    expect(host.textContent).not.toContain("Late finding");
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["wrong identity", "partial sources", "malformed findings", "duplicate source index"])(
    "does not turn %s into a saved complete report", async kind => {
      const value = run();
      if (kind === "wrong identity") value.id = "another-run";
      if (kind === "partial sources") value.sources.pop();
      if (kind === "malformed findings") Object.assign(value.findings[0], { citations: null });
      if (kind === "duplicate source index") value.sources[1].index = 2;
      port.read.mockResolvedValue({ data: value, error: null });
      await render();
      expect(port.read).toHaveBeenCalledTimes(1);
      unavailable();
      expect(host.textContent).not.toContain("Canonical finding");
    },
  );

  it.each(["thread", "tenant", "actor"])("rejects a late %s A→B→A read even when the run id is reused", async boundary => {
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValueOnce(old.promise).mockResolvedValue({ data: run("Current finding"), error: null });
    await render();
    expect(port.read).toHaveBeenCalledTimes(1);
    const originalTenant = port.tenant;
    if (boundary === "tenant") port.tenant = "test-tenant-other";
    if (boundary === "actor") port.actor = "test-owner-other";
    await render(boundary === "thread" ? "thread-b" : "thread-a");
    port.tenant = originalTenant;
    port.actor = "test-owner-a";
    await render();
    await act(async () => { old.resolve({ data: run("Foreign late finding"), error: null }); await flush(); });
    expect(host.textContent).not.toContain("Foreign late finding");
    expect(host.textContent).toContain("Current finding");
    expect(port.read).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the same-thread history read alive when a new ordinary turn starts", async () => {
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValue(old.promise);
    await render();
    expect(port.read).toHaveBeenCalledTimes(1);
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "A new question");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).click(); await flush(); });
    await act(async () => { old.resolve({ data: run("Earlier saved finding"), error: null }); await flush(); });
    expect(host.textContent).toContain("Earlier saved finding");
    expect(host.textContent).not.toContain("Loading this run");
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["continuation", "failure"])("keeps settled history evidence across a later stream %s", async outcome => {
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValue(old.promise);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    await render();
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Another question");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).click(); await flush(); });
    await act(async () => { old.resolve({ data: run("Settled during reply"), error: null }); await flush(); });
    expect(host.textContent).toContain("Settled during reply");
    await act(async () => {
      if (outcome === "failure") controller.error(new Error("synthetic transport failure"));
      else {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Later reply"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      }
      await flush();
    });
    expect(host.textContent).toContain("Settled during reply");
    expect(host.textContent).not.toContain("Loading this run");
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("settles the retained old reference when selecting another conversation fails", async () => {
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValue(old.promise);
    await render();
    port.loadTurns.mockRejectedValueOnce(new Error("synthetic history refusal"));
    await render("thread-b");
    unavailable();
    await act(async () => { old.resolve({ data: run("Late old finding"), error: null }); await flush(); });
    expect(host.textContent).not.toContain("Late old finding");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("discards a pending result after unmount and a new ordinary mount", async () => {
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValueOnce(old.promise).mockResolvedValue({ data: run("New mount finding"), error: null });
    await render();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await act(async () => { old.resolve({ data: run("Unmounted finding"), error: null }); await flush(); });
    expect(host.textContent).toContain("New mount finding");
    expect(host.textContent).not.toContain("Unmounted finding");
    expect(port.read).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads distinct runs independently within one deadline and ignores a hung run's late answer", async () => {
    vi.useFakeTimers();
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.turns.push(storedTurn(true, "run-b", "answer-b"));
    port.read.mockImplementation((_name: string, args: { _run_id: string }) => args._run_id === "run-a"
      ? old.promise : Promise.resolve({ data: run("Ready independently", "run-b"), error: null }));
    await render();
    expect(port.read.mock.calls).toEqual([
      ["get_workspace_research_run", { _run_id: "run-a" }],
      ["get_workspace_research_run", { _run_id: "run-b" }],
    ]);
    expect(cards()[0].textContent).toContain("Loading this run");
    expect(cards()[1].textContent).toContain("Ready independently");
    expect(cards()[1].querySelector(".dr-saved")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_001); await flush(); });
    expect(cards()[0].textContent).toContain("Unavailable");
    expect(cards()[0].querySelector(".dr-saved")).toBeNull();
    await act(async () => { old.resolve({ data: run("Too late"), error: null }); await flush(); });
    expect(host.textContent).not.toContain("Too late");
    expect(cards()[1].textContent).toContain("Ready independently");
    expect(port.read).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores malformed references and never trusts a Saved flag without a run identity", async () => {
    port.turns = [{ id: "answer-a", role: "assistant", content: "Earlier research", bundle_ref: { paige_research: [
      null, 42, { run_id: "bad-question", question: 42, saved: true }, { run_id: [], question: "Bad id", saved: true },
      { run_id: null, question: "Unconfirmed reference", saved: true },
      { run_id: "run-a", question: "Stored question", saved: true },
    ] } }];
    await render();
    expect(cards()).toHaveLength(2);
    expect(cards()[0].textContent).toContain("Unavailable");
    expect(cards()[0].querySelector(".dr-saved")).toBeNull();
    expect(cards()[1].textContent).toContain("Canonical finding");
    expect(port.read.mock.calls).toEqual([["get_workspace_research_run", { _run_id: "run-a" }]]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an expired response even if the deadline timer has not had a chance to run", async () => {
    vi.useFakeTimers();
    const old = deferred<{ data: ReturnType<typeof run>; error: null }>();
    port.read.mockReturnValue(old.promise);
    await render();
    // Advancing wall time alone deliberately does not deliver queued timer callbacks.
    vi.setSystemTime(Date.now() + 8_001);
    await act(async () => { old.resolve({ data: run("Expired before timer"), error: null }); await flush(); });
    unavailable();
    expect(host.textContent).not.toContain("Expired before timer");
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
