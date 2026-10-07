import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRailApi } from "./PaigeAIChat";
import type { LiveVoiceSink } from "@/components/paige/live/PaigeLiveConversation";

const harness = vi.hoisted(() => ({
  tenantId: "tenant-a" as string | null,
  userId: "user-a" as string | null,
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  isFetched: true,
  rail: null as ChatRailApi | null,
  micCallbacks: [] as Array<{ onText: (text: string, at?: number | null) => void; disabled?: boolean }>,
  liveEnsureThread: null as (() => Promise<string>) | null,
  liveVoiceTurn: null as ((text: string, sink: LiveVoiceSink) => Promise<void>) | null,
  liveInterrupt: null as (() => void) | null,
  ensureThread: vi.fn(async () => "thread-created"),
  loadTurns: vi.fn(async () => [] as Array<{ role: string; content: string }>),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId, activeTenant: { account_number: 42 } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => harness.userId }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({
  DictationMicButton: (props: { onText: (text: string, at?: number | null) => void; disabled?: boolean }) => {
    harness.micCallbacks.push(props);
    return <button type="button" aria-label="Dictate" disabled={props.disabled}>Dictate</button>;
  },
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null,
    isProcessingFile: false,
    isDragOver: false,
    fileInputRef: { current: null },
    acceptString: ".pdf",
    handleFileSelect: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    removeAttachment: vi.fn(),
    openFilePicker: vi.fn(),
    setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) } },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: harness.threads,
    isLoading: false,
    isFetched: harness.isFetched,
    loadTurns: harness.loadTurns,
    ensureThread: harness.ensureThread,
    onTurnPersisted: vi.fn(),
    renameThread: vi.fn(),
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: (props: { disabled?: boolean; ensureThread: () => Promise<string>; onVoiceTurn: (text: string, sink: LiveVoiceSink) => Promise<void>; onVoiceInterrupt: () => void }) => {
    harness.liveEnsureThread = props.ensureThread;
    harness.liveVoiceTurn = props.onVoiceTurn;
    harness.liveInterrupt = props.onVoiceInterrupt;
    return <button aria-label="Start Live Conversation" disabled={props.disabled}>Live</button>;
  },
}));

import { PaigeAIChat } from "./PaigeAIChat";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { supabase } from "@/integrations/supabase/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const successfulStream = () => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Done" } }] })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const streamed = (content: string) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const serverFailure = () => new Response(
  JSON.stringify({ code: "chat_unavailable", reason: "Temporary failure." }),
  { status: 500, headers: { "Content-Type": "application/json" } },
);

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PaigeAIChat ComposerScopeState integration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let testNumber = 0;

  beforeEach(() => {
    testNumber += 1;
    harness.tenantId = `tenant-${testNumber}`;
    harness.userId = `user-${testNumber}`;
    harness.threads = [];
    harness.isFetched = true;
    harness.rail = null;
    harness.micCallbacks = [];
    harness.liveEnsureThread = null;
    harness.liveVoiceTurn = null;
    harness.ensureThread.mockReset();
    harness.ensureThread.mockResolvedValue(`thread-created-${testNumber}`);
    harness.loadTurns.mockReset();
    harness.loadTurns.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => successfulStream()));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async (extra: Record<string, unknown> = {}) => {
    await act(async () => {
      root.render(
        <PaigeAIChat
          hideHeader
          fill
          enableHistory
          soloTenantSafety
          liveConversation={false}
          renderRail={(api) => { harness.rail = api; return null; }}
          {...extra}
        />,
      );
      await settle();
    });
  };
  const textarea = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
  const send = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  const type = async (value: string) => {
    await act(async () => setTextareaValue(textarea(), value));
  };
  const waitForWritable = async () => {
    for (let attempt = 0; attempt < 6 && textarea().disabled; attempt += 1) {
      await act(async () => settle());
    }
    expect(textarea().disabled).toBe(false);
  };

  // Ask PAIGE from a surface (src/lib/paigePromptHandoff.ts): the question lands in the composer and
  it("keeps Live guarded after Stop until canonical settlement, while text remains writable", async () => {
    let resolveStatus!: (response: Response) => void;
    const status = new Promise<Response>((resolve) => { resolveStatus = resolve; });
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.interactive?.kind === "status") return status;
      if (body.interactive?.kind === "stop") return new Response("{}", { status: 200 });
      return new Response(new ReadableStream({ start() {} }), { status: 200 });
    }));
    await render({ liveConversation: true });
    await type("work first");
    await act(async () => { send().click(); await settle(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Stop PAIGE response"]')!.click(); await settle(); });
    const live = host.querySelector<HTMLButtonElement>('button[aria-label="Start Live Conversation"]')
      ?? Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Live"));
    expect(live).toBeDefined();
    expect(live!.disabled).toBe(true);
    await type("next thought");
    expect(textarea().disabled).toBe(false);
    expect(send().disabled).toBe(false);
    expect(bodies.filter((body) => (body.interactive as { kind?: string })?.kind === "message")).toHaveLength(1);
    await act(async () => { resolveStatus(new Response(JSON.stringify({ settled: true }), { status: 200 })); await settle(); });
    expect(live!.disabled).toBe(false);
    expect(textarea().value).toBe("next thought");
  });

  it.each(["preflight", "rejected"] as const)("restores predecessor settlement polling after a %s successor", async (failure) => {
    let messages = 0;
    let statuses = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.interactive?.kind === "status") {
        statuses += 1;
        return new Response(JSON.stringify({ settled: statuses > 1 }), { status: 200 });
      }
      messages += 1;
      if (messages > 1) return new Response(JSON.stringify({ message_accepted: false }), { status: 429 });
      return successfulStream();
    }));
    await render({ liveConversation: true });
    await type("first instruction");
    await act(async () => { send().click(); await settle(); });
    const live = host.querySelector<HTMLButtonElement>('button[aria-label="Start Live Conversation"]')!;
    expect(live.disabled).toBe(true);
    if (failure === "preflight") vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: null });
    await type("rejected successor");
    await act(async () => { send().click(); await settle(); });
    expect(live.disabled).toBe(false);
    expect(statuses).toBe(2);
    expect(textarea().value).toBe("rejected successor");
  });

  // waits for the owner. Nothing is sent on their behalf.
  it("puts a question handed off before the chat mounted into the composer, without sending it", async () => {
    handOffPaigePrompt("How did my leads do this month?");
    await render();
    await waitForWritable();
    expect(textarea().value).toBe("How did my leads do this month?");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("appends a later Ask PAIGE question after what the owner already typed", async () => {
    await render();
    await waitForWritable();
    await type("My own note");
    await act(async () => { handOffPaigePrompt("Which source should I double down on?"); await settle(); });
    expect(textarea().value).toBe("My own note\n\nWhich source should I double down on?");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes the client portal's prefill event too", async () => {
    await render();
    await waitForWritable();
    await act(async () => { window.dispatchEvent(new CustomEvent("paige:prefill", { detail: { prompt: "What's my next step?" } })); await settle(); });
    expect(textarea().value).toBe("What's my next step?");
  });

  it.each(["http-500", "fetch-rejection"] as const)("does not offer unsafe or inert Live replay after %s", async (failure) => {
    if (failure === "http-500") vi.mocked(fetch).mockResolvedValueOnce(serverFailure());
    else vi.mocked(fetch).mockRejectedValueOnce(new Error("fixture-network-failure"));
    await render({ liveConversation: true });
    await waitForWritable();
    const sink = { challenge: "test-challenge", proof: vi.fn(), done: vi.fn(), failed: vi.fn() };
    await act(async () => { await harness.liveVoiceTurn!("Keep my spoken question", sink); await settle(); });
    expect(host.textContent).toContain("Keep my spoken question");
    expect(host.textContent).toContain("Paige's answer was interrupted");
    expect(host.textContent).not.toContain("Your message wasn't sent");
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Retry")).toBe(false);
    expect(sink.failed).toHaveBeenCalledTimes(1);
    expect(sink.done).not.toHaveBeenCalled();
    expect(textarea().disabled).toBe(false);
  });

  it("honestly refuses offline Live without an inert Retry or request", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await render({ liveConversation: true });
    await waitForWritable();
    const sink = { challenge: "test-challenge", proof: vi.fn(), done: vi.fn(), failed: vi.fn() };
    await act(async () => { await harness.liveVoiceTurn!("Offline spoken question", sink); await settle(); });
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain("You appear to be offline. This message has not been sent.");
    expect(host.textContent).toContain("Offline spoken question");
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Retry")).toBe(false);
    expect(sink.failed).toHaveBeenCalledTimes(1);
    expect(sink.done).not.toHaveBeenCalled();
    expect(textarea().disabled).toBe(false);
  });

  it.each(["explicit-error", "eof", "rejection", "interrupt", "timeout", "done"] as const)(
    "keeps the same visible Live transcript and settles the sink on %s",
    async (ending) => {
      let upstream!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(new ReadableStream<Uint8Array>({ start(c) { upstream = c; } }));
      let expireTurn: (() => void) | undefined;
      const realSetTimeout = window.setTimeout.bind(window);
      vi.spyOn(window, "setTimeout").mockImplementation(((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 360_000) expireTurn = fn as () => void;
        return realSetTimeout(fn, delay, ...args);
      }) as typeof window.setTimeout);
      vi.mocked(fetch).mockResolvedValueOnce(response);
      await render({ liveConversation: true });
      await waitForWritable();
      const sink = { challenge: "test-challenge", proof: vi.fn(), done: vi.fn(), failed: vi.fn() };
      let turn!: Promise<void>;
      const enc = new TextEncoder();
      await act(async () => {
        turn = harness.liveVoiceTurn!("My spoken question", sink);
        await settle();
        upstream.enqueue(enc.encode('data: {"paige_live_output":"signed-first-chunk"}\n\ndata: {"choices":[{"delta":{"content":"First sentence."}}]}\n\n'));
        await settle();
      });
      expect(host.textContent).toContain("My spoken question");
      expect(host.textContent).toContain("First sentence.");
      await act(async () => {
        if (ending === "interrupt") harness.liveInterrupt!();
        if (ending === "timeout") { expect(expireTurn).toBeDefined(); expireTurn!(); }
        if (ending === "rejection") upstream.error(new Error("upstream interrupted"));
        else {
          if (ending === "explicit-error") upstream.enqueue(enc.encode('data: {"paige_live_error":"answer_interrupted"}\n\ndata: [DONE]\n\n'));
          if (ending === "done") upstream.enqueue(enc.encode('data: [DONE]\n\n'));
          upstream.close();
        }
        await turn;
        await settle();
      });
      expect(host.textContent).toContain("My spoken question");
      expect(host.textContent).toContain("First sentence.");
      expect(sink.proof).toHaveBeenCalledWith("signed-first-chunk");
      expect(sink.done).toHaveBeenCalledTimes(ending === "done" ? 1 : 0);
      expect(sink.failed).toHaveBeenCalledTimes(ending === "done" ? 0 : 1);
      if (ending !== "done" && ending !== "interrupt") {
        expect(host.textContent).toContain("Paige's answer was interrupted");
        expect(host.textContent).not.toContain("Your message wasn't sent");
        expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Retry")).toBe(false);
      }
      expect(textarea().disabled).toBe(false);
    },
  );

  it.each(["tenant", "effective-user", "client", "mission", "clear-focus"] as const)(
    "does not adopt a Live thread when the %s scope changes while thread creation is pending",
    async (change) => {
      const originalTenant = harness.tenantId;
      const originalUser = harness.userId;
      const originProps = change === "client"
        ? { clientId: "client-a" }
        : change === "mission"
          ? { businessMissionId: "mission-a" }
          : change === "clear-focus"
            ? { clientId: "client-a", businessMissionId: "mission-a" }
            : {};
      const targetProps = change === "client"
        ? { clientId: "client-b" }
        : change === "mission"
          ? { businessMissionId: "mission-b" }
          : {};
      let resolveThread: ((id: string) => void) | null = null;
      harness.ensureThread.mockImplementationOnce(() => new Promise((resolve) => { resolveThread = resolve; }));

      await render({ ...originProps, liveConversation: true });
      await waitForWritable();
      await type(`origin ${change} draft`);
      const ensureForOrigin = harness.liveEnsureThread!;
      let pendingCreation: Promise<string> | null = null;
      await act(async () => {
        pendingCreation = ensureForOrigin();
        await Promise.resolve();
      });
      expect(harness.ensureThread).toHaveBeenCalledTimes(1);

      if (change === "tenant") harness.tenantId = `${originalTenant}-next`;
      if (change === "effective-user") harness.userId = `${originalUser}-next`;
      if (change === "tenant" || change === "effective-user") {
        // A real tenant/user query publishes a new result object for the new scope.
        harness.threads = [...harness.threads];
      }
      await render({ ...targetProps, liveConversation: true });
      await waitForWritable();
      expect(textarea().value).toBe("");

      await act(async () => {
        resolveThread?.(`orphan-${change}-${testNumber}`);
        await pendingCreation;
        await settle();
      });
      expect(harness.rail!.activeThreadId).toBeNull();
      expect(textarea().value).toBe("");

      harness.tenantId = originalTenant;
      harness.userId = originalUser;
      if (change === "tenant" || change === "effective-user") {
        harness.threads = [...harness.threads];
      }
      await render({ ...originProps, liveConversation: true });
      await waitForWritable();
      expect(textarea().value).toBe(`origin ${change} draft`);
    },
  );

  it("adopts and migrates the Live thread when the complete scope remains unchanged", async () => {
    let resolveThread: ((id: string) => void) | null = null;
    harness.ensureThread.mockImplementationOnce(() => new Promise((resolve) => { resolveThread = resolve; }));
    await render({ clientId: "client-a", businessMissionId: "mission-a", liveConversation: true });
    await waitForWritable();
    await type("same-scope draft");
    const ensureForOrigin = harness.liveEnsureThread!;
    let pendingCreation: Promise<string> | null = null;

    await act(async () => {
      pendingCreation = ensureForOrigin();
      await Promise.resolve();
    });
    await act(async () => {
      resolveThread?.(`live-thread-${testNumber}`);
      await pendingCreation;
      await settle();
    });

    expect(harness.rail!.activeThreadId).toBe(`live-thread-${testNumber}`);
    expect(textarea().value).toBe("same-scope draft");
  });

  it("does not permit typing while history is unresolved, then enables a confirmed empty history", async () => {
    harness.isFetched = false;
    await render();
    expect(textarea().disabled).toBe(true);
    expect(host.textContent).toContain("Loading your conversations");

    harness.isFetched = true;
    await render();
    expect(textarea().disabled).toBe(false);
  });

  it.each([
    {
      mount: "tenant workspace",
      tenantId: "test-tenant-workspace",
      props: { soloTenantSafety: false, platform: false },
    },
    {
      mount: "tenant-less platform desk",
      tenantId: null,
      props: { soloTenantSafety: false, platform: true },
    },
    {
      mount: "Solo workspace",
      tenantId: "test-tenant-solo",
      props: { soloTenantSafety: true, platform: false },
    },
  ])("resolves a complete writable scope for the explicit $mount mount row", async ({ tenantId, props }) => {
    harness.tenantId = tenantId;
    harness.threads = [];

    await render(props);
    await waitForWritable();
    expect(send().disabled).toBe(true);
    expect(harness.micCallbacks.at(-1)?.disabled).toBe(false);

    await type("mount-owned draft");
    expect(textarea().value).toBe("mount-owned draft");
    expect(send().disabled).toBe(false);
  });

  it("keeps agency and sub-account drafts isolated when the active tenant switches without a remount", async () => {
    harness.tenantId = "test-tenant-agency";
    await render({ soloTenantSafety: false });
    await waitForWritable();
    await type("agency draft");
    const agencyDictation = harness.micCallbacks.at(-1)!.onText;

    harness.tenantId = "test-tenant-sub-account";
    harness.threads = [...harness.threads];
    await render({ soloTenantSafety: false });
    await waitForWritable();
    expect(textarea().value).toBe("");
    await act(async () => agencyDictation(" late agency words"));
    expect(textarea().value).toBe("");
    await type("sub-account draft");

    harness.tenantId = "test-tenant-agency";
    harness.threads = [...harness.threads];
    await render({ soloTenantSafety: false });
    await waitForWritable();
    expect(textarea().value).toBe("agency draft");

    harness.tenantId = "test-tenant-sub-account";
    harness.threads = [...harness.threads];
    await render({ soloTenantSafety: false });
    await waitForWritable();
    expect(textarea().value).toBe("sub-account draft");
  });

  it("keeps A visible but non-writable during B hydration, then restores each per-thread draft", async () => {
    await render();
    await act(async () => {
      harness.rail!.onSelect("thread-a");
      await settle();
    });
    await type("draft A");

    let resolveB: ((turns: Array<{ role: string; content: string }>) => void) | null = null;
    harness.loadTurns.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    await act(async () => {
      harness.rail!.onSelect("thread-b");
      await Promise.resolve();
    });
    expect(textarea().disabled).toBe(true);
    expect(textarea().value).toBe("draft A");

    await act(async () => {
      resolveB?.([]);
      await settle();
    });
    expect(textarea().disabled).toBe(false);
    expect(textarea().value).toBe("");
    await type("draft B");

    await act(async () => {
      harness.rail!.onSelect("thread-a");
      await settle();
    });
    expect(textarea().value).toBe("draft A");
  });

  it("restores a controlled parent to the displayed thread when the requested load fails", async () => {
    harness.threads = [
      { id: "thread-a", title: "A", updated_at: "2026-09-22T00:00:00Z" },
      { id: "thread-b", title: "B", updated_at: "2026-09-22T00:01:00Z" },
    ];
    harness.loadTurns
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("controlled load failed"));
    let selectControlledThread: ((id: string | null) => void) | null = null;

    const ControlledHost = () => {
      const [threadId, setThreadId] = useState<string | null>("thread-a");
      selectControlledThread = setThreadId;
      return (
        <PaigeAIChat
          hideHeader
          fill
          enableHistory
          activeThreadId={threadId}
          onActiveThreadIdChange={setThreadId}
          renderRail={(api) => { harness.rail = api; return null; }}
        />
      );
    };

    await act(async () => {
      root.render(<ControlledHost />);
      await settle();
    });
    await waitForWritable();
    await type("draft A survives");

    await act(async () => {
      selectControlledThread?.("thread-b");
      await settle();
    });

    expect(harness.loadTurns).toHaveBeenCalledTimes(2);
    expect(harness.rail!.activeThreadId).toBe("thread-a");
    expect(textarea().disabled).toBe(false);
    expect(textarea().value).toBe("draft A survives");
  });

  it("publishes a controlled rail selection before hydration can project the prior thread", async () => {
    harness.threads = [
      { id: "thread-a", title: "A", updated_at: "2026-09-22T00:00:00Z" },
      { id: "thread-b", title: "B", updated_at: "2026-09-22T00:01:00Z" },
    ];
    let selectControlledThread: ((id: string | null) => void) | null = null;
    const ControlledHost = () => {
      const [threadId, setThreadId] = useState<string | null>("thread-a");
      selectControlledThread = setThreadId;
      return (
        <PaigeAIChat
          hideHeader
          fill
          enableHistory
          activeThreadId={threadId}
          onActiveThreadIdChange={setThreadId}
          renderRail={(api) => { harness.rail = api; return null; }}
        />
      );
    };

    await act(async () => {
      root.render(<ControlledHost />);
      await settle();
    });
    await waitForWritable();
    expect(selectControlledThread).not.toBeNull();

    let resolveB: ((turns: Array<{ role: string; content: string }>) => void) | null = null;
    harness.loadTurns.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    await act(async () => {
      harness.rail!.onSelect("thread-b");
      await settle();
    });
    await act(async () => {
      resolveB?.([{ role: "assistant", content: "THREAD B LOADED" }]);
      await settle();
    });

    expect(harness.rail!.activeThreadId).toBe("thread-b");
    expect(host.textContent).toContain("THREAD B LOADED");
    expect(textarea().disabled).toBe(false);
  });

  it("keeps an already-new pending turn intact when New chat is clicked again", async () => {
    let resolveThread: ((id: string) => void) | null = null;
    harness.ensureThread.mockImplementationOnce(() => new Promise((resolve) => { resolveThread = resolve; }));
    await render();
    await waitForWritable();
    await type("pending new-chat turn");

    await act(async () => {
      send().click();
      await Promise.resolve();
      harness.rail!.onNewChat();
      resolveThread?.("thread-after-repeat-new");
      await settle();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Done");
    expect(textarea().value).toBe("");
    expect(harness.rail!.activeThreadId).toBe("thread-after-repeat-new");
  });

  it("isolates an account switch before cleanup and drops the origin dictation callback", async () => {
    await render();
    await type("origin words");
    const originDelivery = harness.micCallbacks.at(-1)!.onText;

    harness.tenantId = `tenant-switched-${testNumber}`;
    await render();
    expect(textarea().value).toBe("");

    await act(async () => originDelivery(" late"));
    expect(textarea().value).toBe("");
  });

  it("isolates client, mission, and explicit no-focus drafts and drops late focused dictation", async () => {
    await render({ clientId: "client-a" });
    await waitForWritable();
    await type("client A draft");
    const clientADelivery = harness.micCallbacks.at(-1)!.onText;

    await render({ clientId: "client-b" });
    await waitForWritable();
    expect(textarea().value).toBe("");
    await type("client B draft");
    await act(async () => clientADelivery(" late A"));
    expect(textarea().value).toBe("client B draft");

    await render({ businessMissionId: "mission-a" });
    await waitForWritable();
    expect(textarea().value).toBe("");
    await type("mission A draft");

    await render({ businessMissionId: "mission-b" });
    await waitForWritable();
    expect(textarea().value).toBe("");
    await type("mission B draft");

    await render();
    await waitForWritable();
    expect(textarea().value).toBe("");
    await type("no focus draft");

    await render({ clientId: "client-a" });
    await waitForWritable();
    expect(textarea().value).toBe("client A draft");
    await render({ clientId: "client-b" });
    await waitForWritable();
    expect(textarea().value).toBe("client B draft");
    await render({ businessMissionId: "mission-a" });
    await waitForWritable();
    expect(textarea().value).toBe("mission A draft");
    await render({ businessMissionId: "mission-b" });
    await waitForWritable();
    expect(textarea().value).toBe("mission B draft");
    await render();
    await waitForWritable();
    expect(textarea().value).toBe("no focus draft");
  });

  it("releases focus before saved-thread hydration without moving the focused new-chat draft", async () => {
    const onFocusRelease = vi.fn();
    let releaseFocusedLoad: ((turns: Array<{ role: string; content: string }>) => void) | null = null;
    harness.loadTurns.mockImplementationOnce(() => new Promise((resolve) => { releaseFocusedLoad = resolve; }));

    await render({ clientId: "client-a", onFocusRelease });
    await type("focused new-chat draft");
    await act(async () => {
      harness.rail!.onSelect("saved-thread");
      await Promise.resolve();
    });
    expect(onFocusRelease).toHaveBeenCalledWith("thread_resumed");

    await render({ onFocusRelease });
    expect(textarea().value).toBe("");
    await act(async () => {
      releaseFocusedLoad?.([]);
      await settle();
    });

    await render({ clientId: "client-a", onFocusRelease });
    expect(textarea().value).toBe("focused new-chat draft");
  });

  it.each([false, true])(
    "aborts an origin rail stream, releases its busy state, and never clears the target request (solo=%s)",
    async (soloTenantSafety) => {
      await render({ soloTenantSafety });
      await act(async () => {
        harness.rail!.onSelect("thread-a");
        await settle();
      });
      await type("thread A retained draft");

      let resolveOrigin: ((response: Response) => void) | null = null;
      let resolveTarget: ((response: Response) => void) | null = null;
      let originSignal: AbortSignal | undefined;
      const fetchMock = vi.fn()
        .mockImplementationOnce((_url: string, init?: RequestInit) => {
          originSignal = init?.signal as AbortSignal | undefined;
          return new Promise<Response>((resolve) => { resolveOrigin = resolve; });
        })
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveTarget = resolve; }));
      vi.stubGlobal("fetch", fetchMock);

      await act(async () => {
        send().click();
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        harness.rail!.onSelect("thread-b");
        await settle();
      });
      const originWasAborted = originSignal?.aborted === true;
      expect.soft(originWasAborted).toBe(true);
      if (!originWasAborted) {
        await act(async () => {
          resolveOrigin?.(streamed("PRE-FIX ORIGIN COMPLETION"));
          await settle();
        });
        return;
      }
      expect(textarea().disabled).toBe(false);
      expect(textarea().value).toBe("");

      await type("thread B prompt");
      await act(async () => {
        send().click();
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(textarea().disabled).toBe(!soloTenantSafety);

      await act(async () => {
        resolveOrigin?.(streamed("STALE THREAD A"));
        await settle();
      });
      expect(host.textContent).not.toContain("STALE THREAD A");
      expect(textarea().disabled).toBe(!soloTenantSafety);

      await act(async () => {
        resolveTarget?.(streamed("FRESH THREAD B"));
        await settle();
      });
      expect(host.textContent).toContain("FRESH THREAD B");
      expect(textarea().disabled).toBe(false);

      await act(async () => {
        harness.rail!.onNewChat();
        await settle();
      });
      expect(textarea().disabled).toBe(false);
      expect(textarea().value).toBe("");

      await act(async () => {
        harness.rail!.onSelect("thread-a");
        await settle();
      });
      expect(textarea().value).toBe(soloTenantSafety ? "" : "thread A retained draft");
    },
  );

  it("keeps typing passive during Thinking and keeps a newer draft when the answer settles", async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await type("first instruction");
    await act(async () => { send().click(); await settle(); });
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(textarea().disabled).toBe(false);
    expect(textarea().value).toBe("");
    textarea().focus();
    await type("my next thought");
    expect(signal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.(streamed("current answer finished")); await settle(); });
    expect(textarea().value).toBe("my next thought");
    expect(document.activeElement).toBe(textarea());
  });

  it("Send during Thinking supersedes the existing fence and drops stale bytes", async () => {
    let finishOld: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(async () => streamed("newest instruction answered"));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await type("first instruction");
    await act(async () => { send().click(); await settle(); });
    const oldInit = fetchMock.mock.calls[0][1] as RequestInit;
    await type("instead use this instruction");
    await act(async () => { send().click(); await settle(); });
    expect(oldInit.signal?.aborted).toBe(true);
    const oldBody = JSON.parse(String(oldInit.body));
    const newBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(newBody.interactive).toEqual({ kind: "message", supersedesIntentId: oldBody.requestIntentId });
    expect(newBody.threadId).toBe(oldBody.threadId);
    expect(newBody.approvedConfirmations).toBeUndefined();
    expect(newBody.resume).toBeUndefined();
    await act(async () => { finishOld?.(streamed("STALE OLD TAIL")); await settle(); });
    expect(host.textContent).not.toContain("STALE OLD TAIL");
    expect(host.textContent).toContain("newest instruction answered");
    expect(textarea().disabled).toBe(false);
  });

  it("consumes a submitted draft synchronously so rapid duplicate Enter cannot execute it twice", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => streamed("one answer"));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await type("only once");
    await act(async () => { send().click(); send().click(); await settle(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(1);
  });

  it("retains the next draft until lazy thread resolution makes the first send canonical", async () => {
    let resolveThread!: (id: string) => void;
    harness.ensureThread.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveThread = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async () => streamed("first answer")));
    await render();
    await type("first instruction");
    await act(async () => { send().click(); await settle(); });
    await type("next thought");
    await act(async () => { send().click(); await settle(); });
    expect(fetch).not.toHaveBeenCalled();
    expect(textarea().value).toBe("next thought");
    expect(Array.from(host.querySelectorAll('[data-paige-message-id]')).some((m) => m.textContent?.includes("next thought"))).toBe(false);
    await act(async () => { resolveThread("thread-created"); await settle(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("next thought");
  });

  it("keeps an ambiguous HTTP failure truthful and never offers an execution replay", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => serverFailure()));
    await render(); await type("create the task");
    await act(async () => { send().click(); await settle(); });
    expect(host.textContent).toContain("create the task");
    expect(host.textContent).toContain("Check what finished before repeating any action");
    expect(host.textContent).not.toContain("Your message wasn't sent");
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Retry")).toBe(false);
    expect(textarea().value).toBe("");
  });

  it("Stop during lazy thread creation releases submission readiness for a fresh Send", async () => {
    let resolveThread!: (id: string) => void;
    harness.ensureThread.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveThread = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async () => streamed("new instruction answered")));
    await render(); await type("obsolete instruction");
    await act(async () => { send().click(); await settle(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Stop PAIGE response"]')!.click(); await settle(); });
    expect(textarea().value).toBe("obsolete instruction");
    expect(fetch).not.toHaveBeenCalled();
    await type("new instruction");
    await act(async () => { send().click(); resolveThread("thread-created"); await settle(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("new instruction answered");
    expect(textarea().disabled).toBe(false);
  });

  it("a superseded HTTP error body cannot overwrite the newer turn", async () => {
    let resolveBody!: (body: unknown) => void;
    const slowError = { ok: false, status: 502, clone: () => ({ json: () => new Promise((resolve) => { resolveBody = resolve; }) }) };
    const fetchMock = vi.fn().mockResolvedValueOnce(slowError).mockResolvedValueOnce(streamed("current answer"));
    vi.stubGlobal("fetch", fetchMock);
    await render(); await type("old instruction");
    await act(async () => { send().click(); await settle(); });
    await type("new instruction");
    await act(async () => { send().click(); await settle(); });
    await act(async () => { resolveBody({ message_accepted: true }); await settle(); });
    expect(host.textContent).toContain("current answer");
    expect(host.textContent).not.toContain("Check what finished before repeating any action");
  });

  it("Stop preserves the canonical optimistic turn and a next draft without resending work", async () => {
    let originSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        originSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          originSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      })
      .mockImplementationOnce(async () => successfulStream());
    vi.stubGlobal("fetch", fetchMock);

    await render();
    await waitForWritable();
    await type("cancel-safe prompt");
    await act(async () => {
      send().click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await type("next thought survives Stop");
    const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="Stop PAIGE response"]')!;
    await act(async () => {
      cancel.click();
      await settle();
    });

    expect(originSignal?.aborted).toBe(true);
    expect(textarea().value).toBe("next thought survives Stop");
    expect(host.textContent?.match(/cancel-safe prompt/g)).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent?.match(/cancel-safe prompt/g)).toHaveLength(1);
    const retryBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
    expect(retryBody.interactive.kind).toBe("stop");
    expect(retryBody.interactive.supersedesIntentId).toBe(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).requestIntentId);
  });

  it("migrates the thread scope and preserves a newer draft after an ambiguous server failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => serverFailure()));
    await render({ clientId: "client-a" });
    await type("original submission");
    await act(async () => {
      send().click();
      await settle();
    });
    expect(textarea().value).toBe("");
    expect(harness.ensureThread).toHaveBeenCalledTimes(1);

    await type("newer edit that must survive");
    const retry = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Retry");
    expect(retry).toBeUndefined();

    expect(textarea().value).toBe("newer edit that must survive");
    expect(host.textContent).not.toContain("Your message wasn't sent");
    expect(fetch).toHaveBeenCalledTimes(1);

    await render({ clientId: "client-b" });
    await waitForWritable();
    expect(textarea().value).toBe("");
    await render({ clientId: "client-a" });
    await waitForWritable();
    // The first send migrated this draft from the focused new-chat slot to the
    // persisted thread. Returning to focus A opens a fresh new-chat slot; the
    // thread-owned edit is retained in its real-thread handle, never leaked here.
    expect(textarea().value).toBe("");
  });

  it("reconciles a failed focused-thread draft into the post-release thread scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => serverFailure()));
    const releases = vi.fn();
    let setFocusedClient: ((id: string | null) => void) | null = null;
    const FocusedHost = () => {
      const [focusedClient, setFocusedClientState] = useState<string | null>("client-a");
      setFocusedClient = setFocusedClientState;
      return (
        <PaigeAIChat
          hideHeader
          fill
          enableHistory
          clientId={focusedClient}
          onFocusRelease={(reason) => {
            releases(reason);
            setFocusedClientState(null);
          }}
          renderRail={(api) => { harness.rail = api; return null; }}
        />
      );
    };

    await act(async () => {
      root.render(<FocusedHost />);
      await settle();
    });
    await waitForWritable();
    await type("focused failed draft");
    await act(async () => {
      send().click();
      await settle();
    });
    const createdThreadId = "thread-created-" + testNumber;
    expect(harness.rail!.activeThreadId).toBe(createdThreadId);
    expect(textarea().value).toBe("focused failed draft");

    await act(async () => {
      setFocusedClient?.("client-b");
      await settle();
    });
    await waitForWritable();
    await act(async () => {
      setFocusedClient?.("client-a");
      await settle();
    });
    await waitForWritable();
    expect(textarea().value).toBe("");

    await act(async () => {
      harness.rail!.onSelect(createdThreadId);
      await settle();
    });
    await waitForWritable();

    expect(releases).toHaveBeenCalledWith("thread_resumed");
    expect(harness.rail!.activeThreadId).toBe(createdThreadId);
    expect(textarea().value).toBe("focused failed draft");
  });
});
