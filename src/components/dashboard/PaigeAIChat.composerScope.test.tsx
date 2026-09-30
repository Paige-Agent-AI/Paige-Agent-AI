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
  PaigeLiveConversation: (props: { ensureThread: () => Promise<string>; onVoiceTurn: (text: string, sink: LiveVoiceSink) => Promise<void>; onVoiceInterrupt: () => void }) => {
    harness.liveEnsureThread = props.ensureThread;
    harness.liveVoiceTurn = props.onVoiceTurn;
    harness.liveInterrupt = props.onVoiceInterrupt;
    return null;
  },
}));

import { PaigeAIChat } from "./PaigeAIChat";

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

  it.each(["http-500", "fetch-rejection"] as const)("does not offer unsafe or inert Live replay after %s", async (failure) => {
    if (failure === "http-500") vi.mocked(fetch).mockResolvedValueOnce(serverFailure());
    else vi.mocked(fetch).mockRejectedValueOnce(new Error("fixture-network-failure"));
    await render();
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
    await render();
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
      await render();
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

      await render(originProps);
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
      await render(targetProps);
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
      await render(originProps);
      await waitForWritable();
      expect(textarea().value).toBe(`origin ${change} draft`);
    },
  );

  it("adopts and migrates the Live thread when the complete scope remains unchanged", async () => {
    let resolveThread: ((id: string) => void) | null = null;
    harness.ensureThread.mockImplementationOnce(() => new Promise((resolve) => { resolveThread = resolve; }));
    await render({ clientId: "client-a", businessMissionId: "mission-a" });
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
      expect(textarea().disabled).toBe(true);

      await act(async () => {
        resolveOrigin?.(streamed("STALE THREAD A"));
        await settle();
      });
      expect(host.textContent).not.toContain("STALE THREAD A");
      expect(textarea().disabled).toBe(true);

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
      expect(textarea().value).toBe("thread A retained draft");
    },
  );

  it("rolls back the optimistic user turn on Cancel while retaining the scoped draft", async () => {
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

    const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="Cancel PAIGE response"]')!;
    await act(async () => {
      cancel.click();
      await settle();
    });

    expect(originSignal?.aborted).toBe(true);
    expect(textarea().value).toBe("cancel-safe prompt");
    expect(host.textContent?.match(/cancel-safe prompt/g)).toHaveLength(1);

    await act(async () => {
      send().click();
      await settle();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent?.match(/cancel-safe prompt/g)).toHaveLength(1);
    const retryBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
    expect(retryBody.messages.filter((message: { role: string }) => message.role === "user")).toHaveLength(1);
  });

  it("migrates a lazy new-chat draft and preserves a newer edit after successful Retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => serverFailure()));
    await render({ clientId: "client-a" });
    await type("original submission");
    await act(async () => {
      send().click();
      await settle();
    });
    expect(textarea().value).toBe("original submission");
    expect(harness.ensureThread).toHaveBeenCalledTimes(1);

    await type("newer edit that must survive");
    vi.stubGlobal("fetch", vi.fn(async () => successfulStream()));
    const retry = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Retry")!;
    await act(async () => {
      retry.click();
      await settle();
    });

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
