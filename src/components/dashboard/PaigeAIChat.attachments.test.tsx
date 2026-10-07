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
  loadTurns: vi.fn(async () => [] as Array<{ id?: string; role: string; content: string; bundle_ref?: unknown }>),
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

describe("INT-338 real composer attachment integration", () => {
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

  const file = (name = "Screenshot.png", read = async () => new Uint8Array([1,2,3]).buffer) => {
    const f = new File([], name, { type: name.endsWith(".pdf") ? "application/pdf" : "image/png" });
    Object.defineProperties(f, { size: { value: 3 }, arrayBuffer: { value: read } }); return f;
  };
  const stage = async (f: File, route: "paste" | "drop" = "paste") => {
    const e = new Event(route, { bubbles: true, cancelable: true });
    Object.defineProperty(e, route === "paste" ? "clipboardData" : "dataTransfer", { value: { files: [f], items: [], types: ["Files"] } });
    await act(async () => { (route === "paste" ? textarea() : host.querySelector('[data-solo-composer]')!).dispatchEvent(e); await settle(); });
    return e;
  };
  const remove = () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove attachment"]');
  it.each(["paste", "drop"] as const)("%s during Thinking stages once and Send supersedes with one document", async route => {
    const bodies: Array<{ requestIntentId: string; interactive: { kind: string; supersedesIntentId?: string }; document?: { base64: string } }> = []; const controllers: ReadableStreamDefaultController<Uint8Array>[] = []; const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const b = JSON.parse(String(init.body)); if (b.interactive?.kind !== "message") return new Response(JSON.stringify({ settled: true }));
      bodies.push(b); signals.push(init.signal as AbortSignal);
      return new Response(new ReadableStream({ start(c) { controllers.push(c); } }));
    }));
    await render(); await type("first work"); await act(async () => { send().click(); await settle(); });
    expect(textarea().disabled).toBe(false); expect(signals[0].aborted).toBe(false);
    await stage(file(route === "drop" ? "Document.pdf" : "Screenshot.png"), route);
    expect(host.textContent).toContain(route === "drop" ? "Document.pdf" : "Screenshot.png"); expect(bodies).toHaveLength(1);
    await type("follow up with this file"); expect(signals[0].aborted).toBe(false);
    await act(async () => { send().click(); send().click(); await settle(); });
    expect(bodies).toHaveLength(2); expect(signals[0].aborted).toBe(true);
    expect(bodies[1].interactive.supersedesIntentId).toBe(bodies[0].requestIntentId);
    expect(bodies[1].document).toMatchObject({ base64: "AQID" }); expect(bodies[0].document).toBeUndefined();
    expect(host.querySelector('[data-solo-composer]')?.textContent).not.toContain("Screenshot.png");
    await act(async () => { controllers[0].enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"STALE TAIL"}}]}\n\n')); await settle(); });
    expect(host.textContent).not.toContain("STALE TAIL");
  });
  it("Stop preserves a staged attachment and the next draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const b = JSON.parse(String(init.body)); return b.interactive?.kind === "message" ? new Response(new ReadableStream({ start() {} })) : new Response(JSON.stringify({ settled: true }));
    }));
    await render(); await type("work"); await act(async () => { send().click(); await settle(); });
    await stage(file("Document.pdf"), "drop"); await type("next thought");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Stop PAIGE response"]')!.click(); await settle(); });
    expect(textarea().value).toBe("next thought"); expect(host.textContent).toContain("Document.pdf"); expect(textarea().disabled).toBe(false);
  });
  it("processing blocks Send including Enter, while typing remains editable", async () => {
    let resolve!: (value: ArrayBuffer) => void; await render(); await type("draft");
    await stage(file("late.png", () => new Promise(r => { resolve = r; })));
    expect(send().disabled).toBe(true); expect(textarea().disabled).toBe(false);
    await type("newer draft"); await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle(); });
    expect(fetch).not.toHaveBeenCalled(); expect(textarea().value).toBe("newer draft");
    await act(async () => resolve(new Uint8Array([1]).buffer)); expect(send().disabled).toBe(false);
  });
  it.each(["thread", "workspace", "client", "mission"])("%s switch fences a late attachment", async kind => {
    let resolve!: (value: ArrayBuffer) => void; await render({ activeThreadId: "thread-a" }); await waitForWritable();
    await stage(file("foreign.png", () => new Promise(r => { resolve = r; })));
    if (kind === "workspace") harness.tenantId = "workspace-b";
    await render(kind === "thread" ? { activeThreadId: "thread-b" } : kind === "client" ? { activeThreadId: "thread-a", clientId: "client-b" } : kind === "mission" ? { activeThreadId: "thread-a", businessMissionId: "mission-b" } : { activeThreadId: "thread-a" });
    await act(async () => resolve(new Uint8Array([1]).buffer)); await act(async () => settle());
    expect(host.textContent).not.toContain("foreign.png"); expect(fetch).not.toHaveBeenCalled();
  });
  it("surrounding chrome refuses file navigation and does not stage or send", async () => {
    await render(); const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { files: [file()], types: ["Files"] } });
    await act(async () => host.querySelector('[data-solo-chat-engine]')!.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true); expect(host.textContent).not.toContain("Screenshot.png"); expect(fetch).not.toHaveBeenCalled();
  });
  it("same-tick paste then Enter cannot send before bytes are prepared", async () => {
    let resolve!: (value: ArrayBuffer) => void; await render(); await type("draft");
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { files: [file("late.png", () => new Promise(r => { resolve = r; }))], items: [] } });
    await act(async () => { textarea().dispatchEvent(e); textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle(); });
    expect(fetch).not.toHaveBeenCalled(); expect(textarea().value).toBe("draft");
    await act(async () => resolve(new Uint8Array([1]).buffer));
  });
  it.each(["paste", "drop"] as const)("%s beside ASK_USER remains a new message without answer or approval authority", async route => {
    harness.loadTurns.mockResolvedValue([
      { role: "user", content: "Plan onboarding" },
      { id: "question", role: "assistant", content: "When should it start?", bundle_ref: { turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } }, paige_ask: { v: 1, ask_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", question: "When should it start?", options: [], multi: false, allow_other: true, needs: "date", objective: null } } },
    ]);
    await render({ activeThreadId: "standing-question" }); await waitForWritable();
    await stage(file(), route); await type("Read this first");
    expect(host.textContent).toContain("Your file goes as a new message — her question stays unanswered");
    await act(async () => { send().click(); await settle(); });
    const b = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(b.document.base64).toBe("AQID"); expect(b.resume).toBeUndefined(); expect(b.approvedConfirmations).toBeUndefined(); expect(b.declinedConfirmations).toBeUndefined();
  });
});
