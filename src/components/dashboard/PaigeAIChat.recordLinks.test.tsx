/**
 * Experience 04 E4-S3 — "See it, then verify it" in the Solo PAIGE chat. An answer whose reads drew on
 * records shows links to them beside it — live from the `paige_record_links` frame and again after a
 * reload from `bundle_ref.paige_record_links` — built from the CURRENT account through the one route
 * map. References only travel; a malformed entry or an account that mounts no such surface shows less,
 * never a dead or foreign link. Asserts what a person SEES, never how the loop is written.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  turns: [] as Array<Record<string, unknown>>,
  // A fresh workspace per case: composer drafts live in a module-level store keyed by scope.
  tenant: "account-0",
  /** The active workspace the chat renders links for (account_type / parent / number). */
  activeTenant: { account_number: 3855, account_type: "standalone", parent_tenant_id: null } as Record<string, unknown>,
  /** The props the Live surface was last given — so a case can drive a voice interruption. */
  live: null as null | { onVoiceInterrupt: () => void },
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenant, activeTenant: harness.activeTenant }),
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
  harness.activeTenant = { account_number: 3855, account_type: "standalone", parent_tenant_id: null };
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
    root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} {...extra} />);
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

const lines = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("[data-paige-turn-line]"));
const lastLine = (host: HTMLElement) => lines(host).at(-1) ?? null;
const lineText = (el: HTMLElement | null) => el?.querySelector(".ptl-text")?.textContent ?? null;
const rowsOf = (el: HTMLElement | null) =>
  Array.from(el?.querySelectorAll<HTMLElement>("[data-paige-turn-step]") ?? []).map((r) => [r.textContent?.replace(/^(In progress|Done|Problem|Stopped): /, ""), r.dataset.status]);
const openTrace = async (el: HTMLElement) => {
  const btn = el.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (btn && btn.getAttribute("aria-expanded") === "false") await act(async () => { btn.click(); });
};

const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const LINKS = [
  { destination: "contacts", record_id: CLIENT, subject: "Acme Ltd" },
  { destination: "sales_invoices", record_id: null },
  { destination: "business_time_zone", record_id: null },
];
const nav = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-paige-record-links]");
const anchors = (host: HTMLElement) => Array.from(nav(host)?.querySelectorAll("a") ?? []).map((a) => [a.textContent, a.getAttribute("href")]);

describe("E4-S3 — read links beside a live answer", () => {
  it("renders the links from the frame, addressed from the current Solo account", async () => {
    server(body([say("Acme is signed; one payment is overdue."), frame({ paige_record_links: LINKS }), DONE]));
    const host = await mount();
    await ask(host, "Where does Acme stand?");
    // One group per answer, not one navigation landmark per message; its name is the visible lead line.
    expect(nav(host)?.tagName).not.toBe("NAV");
    expect(nav(host)?.getAttribute("role")).toBe("group");
    expect(nav(host)?.hasAttribute("aria-label")).toBe(false);
    const leadId = nav(host)?.getAttribute("aria-labelledby");
    expect(leadId).toBeTruthy();
    expect(host.ownerDocument.getElementById(leadId!)?.textContent).toBe("See it in your workspace");
    expect(nav(host)?.contains(host.ownerDocument.getElementById(leadId!))).toBe(true);
    expect(host.querySelectorAll("nav").length).toBe(0);
    expect(anchors(host)).toEqual([
      ["Open Acme Ltd", `/solo/3855/clients/people?person=${CLIENT}`],
      ["Open invoices", "/solo/3855/sales/payments?view=invoices"],
      ["Open business time zone setting", "/solo/3855/settings/setup/business-profile#business-time-zone"],
    ]);
    // A way to check, never a claim of change.
    expect(nav(host)?.textContent).not.toMatch(/Updated|Recorded|Added|Saved/);
  });

  it("drops malformed and unknown entries and never renders an address it was sent", async () => {
    server(body([say("Here."), frame({ paige_record_links: [
      { destination: "https://evil.example/x", record_id: null },
      { destination: "contacts", record_id: "javascript:alert(1)", subject: "Acme" },
      "contacts",
    ] }), DONE]));
    const host = await mount();
    await ask(host);
    expect(anchors(host)).toEqual([["Open Clients", "/solo/3855/clients/people"]]);
    expect(host.innerHTML).not.toContain("evil.example");
    expect(host.innerHTML).not.toContain("javascript:");
  });

  it("gives a sub-account the client list only", async () => {
    harness.activeTenant = { account_number: 3856, account_type: "sub_account", parent_tenant_id: "e4000000-0000-4000-8000-00000000aaaa" };
    server(body([say("Here."), frame({ paige_record_links: LINKS }), DONE]));
    const host = await mount();
    await ask(host);
    expect(anchors(host)).toEqual([["Open Clients", "/business/3856/clients/people"]]);
  });

  it("renders nothing for an account that mounts none of these surfaces", async () => {
    harness.activeTenant = { account_number: 3857, account_type: "agency", parent_tenant_id: null };
    server(body([say("Here."), frame({ paige_record_links: LINKS }), DONE]));
    const host = await mount();
    await ask(host);
    expect(nav(host)).toBeNull();
    expect(host.textContent).toContain("Here.");
  });
});

describe("E4-S3 — the same links after a reload", () => {
  it("rebuilds the links from bundle_ref.paige_record_links", async () => {
    harness.threads = [{ id: "thread-l", title: "Acme", updated_at: "2026-10-14T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Where does Acme stand?", created_at: "2026-10-14T09:00:00Z" },
      { id: "a1", role: "assistant", content: "Acme is signed; one payment is overdue.", created_at: "2026-10-14T09:00:09Z", bundle_ref: {
        turn_state: { v: 1, state: "FINAL", mode: "action", rounds: 2, tools: 1 },
        turn_trace: [{ label: "Checked where that client stands", group: "shared", status: "done" }],
        paige_record_links: LINKS,
      } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(anchors(host)).toEqual([
      ["Open Acme Ltd", `/solo/3855/clients/people?person=${CLIENT}`],
      ["Open invoices", "/solo/3855/sales/payments?view=invoices"],
      ["Open business time zone setting", "/solo/3855/settings/setup/business-profile#business-time-zone"],
    ]);
  });

  it("an old turn with no links renders no links row", async () => {
    harness.threads = [{ id: "thread-o", title: "Old", updated_at: "2026-10-14T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Hi", created_at: "2026-10-14T09:00:00Z" },
      { id: "a1", role: "assistant", content: "Hello.", created_at: "2026-10-14T09:00:01Z", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 } } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(nav(host)).toBeNull();
  });
});

describe("E4-S3 — every live assistant rebuild carries the links (no frame order can drop them)", () => {
  it("each direct or scoped stream snapshot that carries crmResults also carries recordLinks", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/dashboard/PaigeAIChat.tsx", "utf8");
    const literals = src.split("\n").filter((l) => /\b(?:setMessages|setStreamMessages)\(\[\.\.\.newMessages, \{ id: assistantId/.test(l) && l.includes("crmResults:"));
    expect(literals.length).toBeGreaterThanOrEqual(10);
    for (const l of literals) expect(l).toContain("recordLinks:");
  });
});
