/**
 * The customer-blocking Meet PAIGE defect (owner reproduction 2026-10-19):
 * the FIRST business interview exchange works; the second and subsequent
 * typed answers do not submit — the Send button appears enabled, nothing is
 * dispatched, no error reaches the customer, and the state survives reload.
 *
 * This file mounts the REAL PaigeAIChat exactly the way the Solo surface
 * mounts it (soloTenantSafety + enableHistory, with the parent's thread
 * adoption feeding activeThreadId back after the first turn — the way
 * SoloPaigeWorkspace does through onActiveThreadIdChange) and performs two
 * sequential TYPED turns. Turn requests are answered with SSE; the chat
 * control/status poll is answered with real JSON. The second typed turn must
 * dispatch a second turn request — anything less is the silent no-op.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";

const harness = vi.hoisted(() => ({
  tenantId: "account-a" as string | null,
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  loadTurns: vi.fn(async (_id: string): Promise<Array<{ role: string; content: string }>> => []),
  adoptedThreadId: null as string | null,
  toasts: [] as Array<{ title?: string; description?: string; variant?: string }>,
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId, activeTenant: { account_number: "42" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string; description?: string; variant?: string }) => { harness.toasts.push(t); } }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">mic</button> }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test" } } })) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: harness.threads, isLoading: false, isFetched: true,
    loadTurns: harness.loadTurns, ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: () => <button type="button">Talk live with Paige</button>,
}));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({
  PaigeArtifactCard: ({ artifact }: { artifact: { id: string; title: string } }) => (
    <div data-testid={`artifact-${artifact.id}`}>{artifact.title}</div>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const sseResponse = (frames: string[]) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      let i = 0;
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined };
          const value = new TextEncoder().encode(frames[i]);
          i += 1;
          return { done: false, value };
        },
        releaseLock() {},
      };
    },
  },
});

const contentTurn = (text: string) => [
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
  "data: [DONE]\n\n",
];

/**
 * Faithful fetch: the chat-control header (or an interactive status body) is a JSON
 * poll answered with {settled:true}; everything else is a TURN, answered with SSE.
 */
const faithfulFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const isStatusPoll = Object.keys(headers).some((k) => k.toLowerCase().includes("chat-control"))
    || body.interactive?.kind === "status";
  if (isStatusPoll) return jsonResponse({ settled: true });
  return sseResponse(contentTurn("Thanks — and what matters most right now?"));
});

const mount = async (root: ReturnType<typeof createRoot>, host: HTMLDivElement, props: Record<string, unknown>) => {
  await act(async () => {
    root.render(<PaigeAIChat hideHeader fill enableHistory {...props} />);
    await Promise.resolve();
  });
};

const typeIntoComposer = async (host: HTMLDivElement, text: string) => {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const clickSend = async (host: HTMLDivElement) => {
  const send = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    /send/i.test(b.getAttribute("aria-label") ?? ""))!;
  await act(async () => {
    send.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const turnPosts = () => faithfulFetch.mock.calls.filter(([url, init]) => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  return String(url).includes("/functions/v1/paige-ai-chat") && body.interactive?.kind !== "status";
});

const turnPostsByBody = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls
    .filter(([url, init]) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return String(url).includes("/functions/v1/paige-ai-chat") && body.interactive?.kind !== "status";
    })
    .map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : {}));

describe("Meet PAIGE — the second typed interview turn must actually submit", () => {
  afterEach(() => { vi.unstubAllGlobals(); harness.loadTurns.mockClear(); harness.adoptedThreadId = null; harness.toasts = []; });

  it("dispatches a second turn after the first exchange, with the parent adopting the thread between turns", async () => {
    vi.stubGlobal("fetch", faithfulFetch);
    faithfulFetch.mockClear();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    // The Solo mount, including the parent-side thread adoption feedback.
    await mount(root, host, {
      soloTenantSafety: true,
      activeThreadId: harness.adoptedThreadId,
      onActiveThreadIdChange: (id: string | null) => { harness.adoptedThreadId = id; },
    });

    await typeIntoComposer(host, "We are a small design studio");
    await clickSend(host);
    expect(host.textContent).toContain("Thanks — and what matters most right now?");
    expect(turnPosts().length).toBe(1);

    // The parent adopts the thread the first turn created, exactly as
    // SoloPaigeWorkspace does through onActiveThreadIdChange -> resumedThread.
    await mount(root, host, {
      soloTenantSafety: true,
      activeThreadId: harness.adoptedThreadId,
      onActiveThreadIdChange: (id: string | null) => { harness.adoptedThreadId = id; },
    });

    await typeIntoComposer(host, "Mostly client work is slow right now");
    await clickSend(host);

    // THE defect: on a silent no-op the second turn POST never happens and the
    // composer gives the customer no feedback at all — button enabled, nothing
    // submits, no error. This is the owner's exact reproduction.
    expect(turnPosts().length).toBe(2);
    expect(host.textContent).toContain("Mostly client work is slow right now");

    await act(async () => root.unmount());
    host.remove();
  });

  it("binds the second typed turn to the open question, and an answer refusal reaches the customer", async () => {
    const ASK_ID = "0c64485c-f5cd-471a-ad9e-7c0bb7783333";
    const askTurn = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Thanks — one thing first." } }] })}\n\n`,
      `data: ${JSON.stringify({ paige_choices: { prompt: "What would you most like to improve?", options: [{ label: "More clients", value: "clients" }, { label: "Better margins", value: "margins" }], multi: false, allow_other: true, ask_id: ASK_ID } })}\n\n`,
      "data: [DONE]\n\n",
    ];
    let turn = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (body.interactive?.kind === "status") return jsonResponse({ settled: true });
      turn += 1;
      if (turn === 1) return sseResponse(askTurn);
      // The refusal shape the gate produced live (2026-10-19): a structured
      // ASK_* body the customer must actually see. clone() must return a body
      // the error parsers can read, like a real Response.
      const refused: Response & { clone(): Response } = {
        ok: false, status: 409,
        clone() { return refused; },
        json: async () => ({ code: "ASK_NOT_OPEN", reason: "That question isn't open any more, so your message wasn't sent as an answer." }),
        text: async () => JSON.stringify({ code: "ASK_NOT_OPEN", reason: "That question isn't open any more, so your message wasn't sent as an answer." }),
      } as unknown as Response & { clone(): Response };
      return refused;
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const mount = async () => {
      await act(async () => {
        root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety
          activeThreadId={harness.adoptedThreadId}
          onActiveThreadIdChange={(id: string | null) => { harness.adoptedThreadId = id; }} />);
        await Promise.resolve();
      });
    };
    await mount();

    await typeIntoComposer(host, "We are a small design studio");
    await clickSend(host);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.textContent).toContain("What would you most like to improve?");
    // The parent adopts the thread the ask-turn created (SoloPaigeWorkspace's
    // onActiveThreadIdChange -> resumedThread feedback), then the person answers.
    await mount();

    await typeIntoComposer(host, "Mostly client work is slow right now");
    await clickSend(host);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    // The answer turn carried the binding to the open question.
    const answerPost = turnPostsByBody(fetchMock).find((b) => b.resume?.kind === "answer");
    expect(answerPost?.resume?.ask_id).toBe(ASK_ID);
    // The ride-along the server's admission gate keys on: the turn also names the
    // interactive intent it supersedes (the marker-exclusion input).
    expect(typeof answerPost?.interactive?.supersedesIntentId).toBe("string");
    // And when the server refuses it, the customer is TOLD — never silence.
    expect(harness.toasts.some((t) => (t.title ?? "").includes("question"))).toBe(true);
    expect(harness.toasts.some((t) => (t.description ?? "").includes("wasn't sent as an answer"))).toBe(true);
    // The typed words are back in the composer, not lost.
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("Mostly client work is slow right now");

    await act(async () => root.unmount());
    host.remove();
  });
});
