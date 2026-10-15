/**
 * INT-328 — a confirm card reloaded from history passes its email preview through the SAME gate
 * the live stream uses (`parseConfirmPreview`). Before the fix a stored `bundle_ref.paige_confirm`
 * preview reached the card raw: a malformed one (a non-string body) threw inside the card and took
 * the whole transcript down with it.
 *
 * HONEST SCOPE (§13): a reloaded turn is always `confirmResolved`, and a resolved card renders the
 * settled sentence — it never mounts the envelope. So the crash the review described is not
 * reachable through the UI today; the gate is defence in depth for the day a reloaded card is shown
 * live. These cases guard the reload path; they do not (cannot) fail on the pre-fix code.
 *
 * PROOF CLASS: rendered harness (jsdom) — the real Solo chat with threads, tenant and network
 * stubbed. Not an authenticated runtime drive. (Harness copied from PaigeAIChat.turnStates.test.)
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  turns: [] as Array<Record<string, unknown>>,
  // A fresh workspace per case: composer drafts live in a module-level store keyed by scope.
  tenant: "account-0",
  /** The props the Live surface was last given — so a case can drive a voice interruption. */
  live: null as null | { onVoiceInterrupt: () => void },
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenant, activeTenant: { account_number: "42" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
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
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: harness.threads, isLoading: false, isFetched: true,
    loadTurns: vi.fn(async () => harness.turns), ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: (props: { onVoiceInterrupt: () => void }) => { harness.live = props; return null; },
}));
vi.mock("@/components/chat/PaigeCrmResultCard", () => ({
  PaigeCrmResultCard: ({ result }: { result: unknown }) => <div data-testid="crm">{JSON.stringify(result)}</div>,
}));
vi.mock("@/components/paige/chat/PaigeResearchCard", () => ({
  PaigeResearchCard: ({ result }: { result: unknown }) => <div data-testid="research">{JSON.stringify(result)}</div>,
}));
vi.mock("@/components/chat/MessageAudioButton", () => ({ MessageAudioButton: () => <button type="button" data-testid="listen">Listen</button> }));

import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { supabase } from "@/integrations/supabase/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const say = (text: string) => frame({ choices: [{ delta: { content: text } }] });
const turn = (event: string, state: string, mode: string) => frame({ paige_turn: { v: 1, event, state, mode } });
const step = (id: string, seq: number, label: string, status?: string, extra: Record<string, unknown> = {}) =>
  frame({ paige_step: { id, seq, round: 1, kind: "action", label, group: "owner", ...(status ? { status } : {}), ...extra } });
const DONE = "data: [DONE]\n\n";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
type Chunk = string | Promise<unknown>;
const body = (chunks: Chunk[]) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      let i = 0;
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          while (i < chunks.length && chunks[i] instanceof Promise) await chunks[i++];
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: enc.encode(chunks[i++] as string) };
        },
        releaseLock() {},
        async cancel() {},
      };
    },
  },
});
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function server(...replies: Array<ReturnType<typeof body>>) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }>; approvedConfirmations?: string[]; declinedConfirmations?: string[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: unknown; signal?: AbortSignal }) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const reply = replies[bodies.length - 1] ?? body([say("Okay."), DONE]);
    return reply;
  }));
  return bodies;
}

const mounted: Array<() => Promise<void>> = [];
beforeEach(() => {
  harness.threads = [];
  harness.turns = [];
  harness.tenant = `account-${Math.random().toString(36).slice(2)}`;
  // Composer drafts persist per scope; every case starts from an empty one.
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.unstubAllGlobals();
});

let lastRoot: ReturnType<typeof createRoot> | null = null;
async function mount(extra: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  lastRoot = root;
  await act(async () => {
    root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety {...extra} />);
    await flush();
  });
  mounted.push(async () => { await act(async () => { root.unmount(); }); host.remove(); });
  for (let attempt = 0; attempt < 6 && host.querySelector("textarea")!.disabled; attempt += 1) await act(async () => flush());
  return host;
}

async function ask(host: HTMLElement, text = "Who hasn't heard from us in two weeks?") {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  await act(async () => { send.click(); await flush(); });
}


const EMAIL = {
  to_name: "Maya Ortiz",
  to_address: "maya@ortizlandscaping.example",
  from_address: "jordan@northlightadvisory.example",
  subject: "Notes from Tuesday's planning call",
  body_text: "Hi Maya,\n\nHere is what we agreed on Tuesday.\n\nJordan",
};
const SUMMARY = `Email Maya Ortiz at maya@ortizlandscaping.example from jordan@northlightadvisory.example: "Notes from Tuesday's planning call"`;

function history(preview: unknown) {
  harness.threads = [{ id: "thread-e", title: "Maya", updated_at: "2026-10-05T10:00:00Z" }];
  harness.turns = [
    { id: "u1", role: "user", content: "Send Maya the recap.", created_at: "2026-10-05T09:00:00Z" },
    { id: "a1", role: "assistant", content: "Here's the recap I'll send.", created_at: "2026-10-05T09:00:05Z", bundle_ref: {
      paige_confirm: [{ tool: "comms_send_email", summary: SUMMARY, preview }],
    } },
  ];
}

describe("a reloaded email approval card", () => {
  it("a malformed stored preview renders the server's sentence and the transcript survives", async () => {
    history({ ...EMAIL, body_text: 5 });
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.textContent).toContain("Here's the recap I'll send.");
    expect(host.textContent).toContain(SUMMARY);
    expect(host.querySelector("[data-confirm-preview]")).toBeNull();
  });

  it("a well-formed stored preview: the reload says what was asked, settled — never a live Approve", async () => {
    history(EMAIL);
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    // A reloaded card renders the settled sentence, not the envelope (a past decision is never
    // re-presented as one to take, §15).
    expect(host.textContent).toContain(`Earlier, Paige asked you to confirm: ${SUMMARY}`);
    expect(Array.from(host.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === "Approve")).toBe(false);
  });

  it("a stored preview under the server's alias passes the same gate", async () => {
    harness.threads = [{ id: "thread-e", title: "Maya", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Send Maya the recap.", created_at: "2026-10-05T09:00:00Z" },
      { id: "a1", role: "assistant", content: "Here's the recap I'll send.", created_at: "2026-10-05T09:00:05Z", bundle_ref: {
        paige_confirm: [{ tool: "comms_send_email", summary: SUMMARY, confirm_preview: { ...EMAIL, subject: ["not", "text"] } }],
      } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-confirm-preview]")).toBeNull();
    expect(host.textContent).toContain(SUMMARY);
  });
});
