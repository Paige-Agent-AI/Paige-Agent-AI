/**
 * Actual CRM receipt cards, live and restored from their reduced assistant metadata.
 * Existing SDK/transport ports are neutral doubles; the Chat/card/router implementation is real.
 * References grant nothing and are always addressed from the current workspace.
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
  loadOverride: null as null | (() => Promise<Array<Record<string, unknown>>>),
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
    loadTurns: vi.fn(async () => harness.loadOverride ? harness.loadOverride() : harness.turns), ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: (props: { onVoiceInterrupt: () => void }) => { harness.live = props; return null; },
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
  harness.loadOverride = null;
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

const OTHER = "e4000000-0000-4000-8000-0000000c0002";
const reduced = { action: "contact.update", outcome: "succeeded", receipt_recorded: true };
const reference = { destination: "contacts", record_id: CLIENT, subject: "CLT-1234" };
function history(result: Record<string, unknown>, id = "saved") {
  return [{ id, role: "assistant", content: "Saved the correction.", created_at: "2026-10-14T09:00:01Z",
    bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "action", rounds: 1, tools: 1 },
      turn_trace: [{ label: "Updated the contact", group: "client", status: "done" }], paige_crm_result: [result] } }];
}
const receipt = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-paige-crm-result]");
const href = (host: HTMLElement) => receipt(host)?.querySelector("a")?.getAttribute("href");
async function rerender() { await act(async () => { lastRoot!.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} />); await flush(); }); }

describe("actual CRM card reference across stream and reload", () => {
  it("opens the exact Task from a live receipt and its reduced reloaded history", async () => {
    const result={action:"task.update",outcome:"succeeded",receipt_recorded:true};
    server(body([frame({paige_crm_result:{...result,readback:{id:CLIENT,title:"Neutral saved Task"},
      record_locator:{record_id:CLIENT,deep_link_status:"exact",deep_link:"/solo/999/foreign"}}}),say("Saved."),DONE]));
    const host=await mount();await ask(host,"Show the verified saved Task");
    expect(href(host)).toBe(`/solo/3855/operations/work?task=${CLIENT}`);expect(receipt(host)?.textContent).toContain("Open task");
    harness.threads=[{id:"thread-a",title:"Saved Task",updated_at:"2026-10-14T10:00:00Z"}];
    harness.turns=history({...result,record_reference:{destination:"operations_work",record_id:CLIENT}});
    await act(async()=>{lastRoot!.unmount();});
    const reloaded=await mount();await act(flush);
    expect(href(reloaded)).toBe(`/solo/3855/operations/work?task=${CLIENT}`);expect(receipt(reloaded)?.textContent).toContain("Open task");
    expect(reloaded.innerHTML).not.toContain("/solo/999");expect(reloaded.innerHTML).not.toContain("Neutral saved Task");
  });
  it("restores the native contact label and exact current-workspace destination", async () => {
    harness.threads = [{ id: "thread-a", title: "Saved", updated_at: "2026-10-14T10:00:00Z" }];
    harness.turns = history({ ...reduced, record_reference: reference });
    server();
    const host = await mount();
    await act(flush);
    expect(receipt(host)?.textContent).toContain("CLT-1234");
    expect(receipt(host)?.textContent).toContain("Open exact record");
    expect(href(host)).toBe(`/solo/3855/clients/people?person=${CLIENT}`);
    expect(lastLine(host)?.dataset.kind).toBe("done");
    expect(lineText(lastLine(host))).toContain("What PAIGE did");
  });
  it("does not derive a structured receipt link from assistant Markdown", async () => {
    harness.threads = [{ id: "thread-a", title: "Saved", updated_at: "2026-10-14T10:00:00Z" }];
    harness.turns = history(reduced);
    harness.turns[0].content = `Open [CLT-1234](/solo/3855/clients/people?person=${CLIENT}).`;
    server(); const host = await mount(); await act(flush);
    expect(receipt(host)?.textContent).toContain("CRM record");
    expect(href(host)).toBeUndefined();
  });
  it("addresses a live receipt from the current account, ignoring the supplied old address", async () => {
    server(body([frame({ paige_crm_result: { ...reduced, readback: { id: CLIENT, client_ref: "CLT-1234" },
      record_locator: { record_id: CLIENT, deep_link: "/solo/999/foreign", deep_link_status: "exact" } } }), say("Saved."), DONE]));
    const host = await mount();
    await ask(host, "correct the saved contact");
    expect(href(host)).toBe(`/solo/3855/clients/people?person=${CLIENT}`);
    expect(host.innerHTML).not.toContain("/solo/999");
  });
  it.each([reduced, { ...reduced, record_reference: { ...reference, record_id: "invalid" } },
    { ...reduced, record_reference: { ...reference, path: "/solo/999" } },
    { ...reduced, outcome: "failed", record_reference: reference },
    { ...reduced, receipt_recorded: false, record_reference: reference },
    { ...reduced, action: "contact.hard_delete", record_reference: reference },
    { ...reduced, action: "task.create", record_reference: reference },
    { ...reduced, record_reference: reference, readback: { id: OTHER }, record_locator: { deep_link: "/foreign" } }])("leaves an old or invalid receipt generic without resurrecting a URL (%j)", async result => {
    harness.threads = [{ id: "thread-a", title: "Saved", updated_at: "2026-10-14T10:00:00Z" }];
    harness.turns = history(result);
    server();
    const host = await mount(); await act(flush);
    expect(receipt(host)).not.toBeNull();
    expect(href(host)).toBeUndefined();
    expect(receipt(host)?.textContent).not.toContain("CLT-1234");
  });
  it("ignores late A history after an A-to-B-to-A lifetime transition", async () => {
    let release!: (turns: Array<Record<string, unknown>>) => void;
    const late = new Promise<Array<Record<string, unknown>>>(resolve => { release = resolve; });
    harness.threads = [{ id: "thread-a", title: "A", updated_at: "2026-10-14T10:00:00Z" }];
    harness.loadOverride = () => late;
    server();
    const host = await mount();
    const tenantA = harness.tenant;
    harness.loadOverride = null; harness.tenant = "account-b"; harness.activeTenant.account_number = 400;
    const bId = "e4000000-0000-4000-8000-0000000c0003";
    harness.turns = history({ ...reduced, record_reference: { ...reference, record_id: bId, subject: "CLT-ABCD" } }, "fresh-b");
    harness.threads = [{ id: "thread-b", title: "B", updated_at: "2026-10-14T10:00:00Z" }];
    await rerender();
    expect(receipt(host)?.textContent).toContain("CLT-ABCD");
    expect(href(host)).toBe(`/solo/400/clients/people?person=${bId}`);
    expect(host.innerHTML).not.toContain(`/solo/3855/clients/people?person=${CLIENT}`);
    harness.tenant = tenantA; harness.activeTenant.account_number = 3855;
    harness.threads = [{ id: "thread-a", title: "A", updated_at: "2026-10-14T10:00:00Z" }];
    harness.turns = history({ ...reduced, record_reference: { ...reference, record_id: OTHER, subject: "CLT-5678" } }, "fresh-a");
    await rerender(); await act(flush);
    await act(async () => { release(history({ ...reduced, record_reference: reference }, "stale-a")); await flush(); });
    expect(receipt(host)?.textContent).toContain("CLT-5678");
    expect(receipt(host)?.textContent).not.toContain("CLT-1234");
    expect(href(host)).toBe(`/solo/3855/clients/people?person=${OTHER}`);
  });
});
