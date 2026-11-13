/** Actual Chat history decoder, SSE consumer and Studio handoff component.
 * Auth/history/native/transport ports are doubles. Generic deliverable cards are
 * prop spies; ChatStudioHandoff, its native adapters and original launcher are real.
 * No original USER-source lost-ACK recovery path is assumed by these tests. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const port = vi.hoisted(() => ({
  tenant: "", actor: "22222222-2222-4222-8222-222222222222", turns: [] as Array<Record<string, unknown>>,
  activeTenant: {} as Record<string, unknown>, load: vi.fn(), rpc: vi.fn(), batch: vi.fn(), wire: [] as string[],
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: port.tenant, activeTenant: port.activeTenant, activeUserId: port.actor, accountContextLoading: false, accountContextStatus: "ready" }) }));
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
  rpc: (...args: unknown[]) => port.rpc(...args),
  auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-session" } } })) },
  functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
} }));
vi.mock("@/hooks/usePaigeThreads", () => ({ usePaigeThreads: () => ({
  threads: [], isLoading: false, isFetched: true, loadTurns: (...args: unknown[]) => port.load(...args),
  ensureThread: vi.fn(async () => "44444444-4444-4444-8444-444444444444"), onTurnPersisted: vi.fn(),
  renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
}) }));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({ PaigeArtifactCard: ({ artifact, tenantId }: { artifact: unknown; tenantId: string }) => <div data-testid="generic-artifact">{JSON.stringify({ artifact, tenantId })}</div> }));
vi.mock("@/components/chat/PaigeCrmResultCard", () => ({ PaigeCrmResultCard: ({ result }: { result: unknown }) => <div data-testid="crm">{JSON.stringify(result)}</div> }));
vi.mock("@/components/paige/chat/PaigeResearchCard", () => ({ PaigeResearchCard: ({ result }: { result: unknown }) => <div data-testid="research">{JSON.stringify(result)}</div> }));
vi.mock("@/components/chat/ExtractionProposalCard", () => ({ ExtractionProposalCard: ({ proposal }: { proposal: unknown }) => <div data-testid="proposal">{JSON.stringify(proposal)}</div> }));

import { PaigeAIChat } from "./PaigeAIChat";
import { loadChatStudioSources } from "@/solo/studio/studio-data";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const SOURCE = "33333333-3333-4333-8333-333333333333", THREAD = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555", OTHER = "66666666-6666-4666-8666-666666666666";
const BRIEF = "The original public launch brief, read from its native source.";
const QUESTION = "Which business or project should NEXUS build this for?";
const enc = new TextEncoder(), DONE = "data: [DONE]\n\n";
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const say = (text: string) => frame({ choices: [{ delta: { content: text } }] });
const pointer = (extra: Record<string, unknown> = {}) => ({ artifactType: "studio", kind: "studio_source", id: SOURCE, title: "Studio brief", tenant_id: port.tenant, url: null, ...extra });
const history = (candidate: unknown = pointer()) => [{ id: "saved-original-assistant", role: "assistant", content: QUESTION, created_at: "2026-11-13T15:00:00Z", bundle_ref: { paige_artifact: [candidate] } },
  { id: "later-user", role: "user", content: "Later message" }, { id: "later-assistant", role: "assistant", content: "The later conversation stays here." }];
const calls = (name: string) => port.rpc.mock.calls.filter(call => call[0] === name);
const lostHistory = (id = SOURCE) => [{ id, role: "user", content: "Create the original public launch page.", created_at: "2026-11-13T15:00:00Z", bundle_ref: null },
  { id: "original-interrupted-answer", role: "assistant", content: "The earlier answer was interrupted.", bundle_ref: { turn_state: { v: 1, state: "INTERRUPTED", mode: "fast_answer", rounds: 1, tools: 0 } } }];
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
type Chunk = string | Uint8Array | Promise<unknown>;
function body(chunks: Chunk[]) { return { ok: true, status: 200, body: { getReader() { let i = 0; return {
  async read(): Promise<{ done: boolean; value?: Uint8Array }> {
    while (i < chunks.length && chunks[i] instanceof Promise) await chunks[i++];
    if (i >= chunks.length) return { done: true };
    const chunk = chunks[i++] as string | Uint8Array; port.wire.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return { done: false, value: typeof chunk === "string" ? enc.encode(chunk) : chunk };
  }, releaseLock() {}, async cancel() {},
}; } } }; }
function server(chunks: Chunk[] = [say("Ordinary answer."), DONE]) {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    if (request.interactive?.kind === "stop") return new Response("{}", { status: 200 });
    requests.push(request); return body(chunks);
  }));
  return requests;
}
const mounted: Array<() => Promise<void>> = [];
let caseNumber = 0;
beforeEach(() => {
  port.tenant = `11111111-1111-4111-8111-${String(++caseNumber).padStart(12, "0")}`;
  port.actor = "22222222-2222-4222-8222-222222222222";
  port.activeTenant = { id: port.tenant, slug: "studio-test-workspace", account_number: 3855, account_type: "standalone", parent_tenant_id: null };
  port.turns = []; port.wire = []; port.load.mockReset().mockImplementation(async () => port.turns);
  port.batch.mockReset().mockResolvedValue({ data: { ok: true, source_turn_ids: [] }, error: null });
  port.rpc.mockReset().mockImplementation((name: string, args: unknown) => {
    if (name === "chat_studio_sources") return port.batch(args);
    if (name === "chat_studio_reference") return Promise.resolve({ data: { ok: true, state: "prepared", brief: BRIEF }, error: null });
    if (name === "chat_studio_start") return Promise.resolve({ data: { ok: true, state: "ready", session_id: SESSION, thread_id: THREAD, created: true }, error: null });
    throw Error(`Unexpected native call: ${name}`);
  });
  window.localStorage.clear(); window.sessionStorage.clear();
});
afterEach(async () => { while (mounted.length) await mounted.pop()!(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(thread: string | null = null) {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host); let closed = false;
  let selected = thread;
  const render = async (next = selected) => { selected = next; await act(async () => { root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} activeThreadId={selected ?? undefined} />); await flush(); }); };
  const close = async () => { if (closed) return; closed = true; await act(async () => root.unmount()); host.remove(); };
  mounted.push(close); await render();
  for (let i = 0; i < 6 && host.querySelector("textarea")?.disabled; i++) await act(flush);
  return { host, close, render };
}
async function ask(host: HTMLElement) {
  const textarea = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Create a public launch page"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  const send = host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  expect(send.disabled).toBe(false); await act(async () => { send.click(); await flush(); });
}
const handoffs = (host: ParentNode) => host.querySelectorAll(".th-studio-handoff");
const generic = (host: HTMLElement) => Array.from(host.querySelectorAll('[data-testid="generic-artifact"]')).map(node => JSON.parse(node.textContent!));

describe("actual Chat saved assistant Studio reference", () => {
  it("survives full component unmount/reload with the exact original source and tenant, without starting", async () => {
    server(); port.turns = history();
    const first = await mount(THREAD);
    expect(first.host.textContent).toContain(BRIEF); expect(first.host.textContent).toContain("The later conversation stays here.");
    expect(handoffs(first.host)).toHaveLength(1); expect(generic(first.host)).toEqual([]);
    expect(calls("chat_studio_reference").map(call => call[1])).toEqual([{ p_expected_tenant: port.tenant, p_source_turn_id: SOURCE }]);
    expect(calls("chat_studio_start")).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
    await first.close(); const reloaded = await mount(THREAD);
    expect(reloaded.host.textContent).toContain(BRIEF); expect(handoffs(reloaded.host)).toHaveLength(1);
    expect(calls("chat_studio_reference").map(call => call[1])).toEqual(Array(2).fill({ p_expected_tenant: port.tenant, p_source_turn_id: SOURCE }));
    expect(calls("chat_studio_start")).toHaveLength(0); expect(generic(reloaded.host)).toEqual([]);
  });
  it("requires native ready evidence and an explicit Open click to launch the original session", async () => {
    server(); port.turns = history(); port.rpc.mockResolvedValue({ data: { ok: true, state: "ready", session_id: SESSION }, error: null });
    const launches: CustomEvent[] = [], listener = (event: Event) => launches.push(event as CustomEvent);
    window.addEventListener("paige-studio", listener);
    try {
      const { host } = await mount(THREAD); expect(launches).toHaveLength(0); expect(generic(host)).toEqual([]);
      const open = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Open Studio")!;
      expect(open).toBeTruthy(); await act(async () => open.click());
      expect(launches).toHaveLength(1); expect(launches[0].detail.sessionId).toBe(SESSION);
      expect(Object.keys(launches[0].detail).sort()).toEqual(["returnFocus", "sessionId"]); expect(calls("chat_studio_start")).toHaveLength(0);
    } finally { window.removeEventListener("paige-studio", listener); }
  });
  it.each([
    ["extra session ID", { session_id: SESSION }], ["extra project ID", { project_id: SESSION }],
    ["URL", { url: "https://example.com/project" }], ["malformed source", { id: "authored-source" }],
    ["wrong kind", { kind: "page" }], ["foreign tenant", { tenant_id: OTHER }],
  ])("never turns %s metadata into a ready project or native start", async (_label, extra) => {
    server(); port.turns = history(pointer(extra)); const { host } = await mount(THREAD);
    expect(handoffs(host)).toHaveLength(0); expect(calls("chat_studio_reference")).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
    expect(generic(host)).toEqual([]); expect(host.textContent).not.toContain("Open Studio");
  });
  it.each([{ ok: false, code: "not_allowed" }, { ok: true, state: "ready", session_id: "authored" }, { ok: true, state: "prepared", brief: BRIEF, session_id: SESSION }])("never trusts a refused or malformed native projection %j", async data => {
    server(); port.turns = history(); port.rpc.mockResolvedValue({ data, error: null }); const { host } = await mount(THREAD);
    expect(handoffs(host)).toHaveLength(0); expect(calls("chat_studio_reference")).toHaveLength(1); expect(calls("chat_studio_start")).toHaveLength(0);
    expect(host.textContent).not.toContain("Open Studio"); expect(generic(host)).toEqual([]);
  });
});

describe("bounded current native Studio-source lookup", () => {
  it("accepts only an exact subset and returns canonical pointers, never ready/session data", async () => {
    port.batch.mockResolvedValue({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null });
    expect(await loadChatStudioSources(port.tenant, THREAD, [SOURCE, OTHER])).toEqual({ ok: true, references: [{ sourceTurnId: SOURCE, tenantId: port.tenant }] });
    expect(calls("chat_studio_sources")[0][1]).toEqual({ p_expected_tenant: port.tenant, p_thread_id: THREAD, p_source_turn_ids: [SOURCE, OTHER] });
    expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it.each([
    null, { ok: false, code: "not_allowed" }, { ok: true, source_turn_ids: [OTHER] },
    { ok: true, source_turn_ids: [SOURCE], session_id: SESSION }, { ok: true, source_turn_ids: [SOURCE], url: "https://example.com" },
    { ok: true, source_turn_ids: [SOURCE, SOURCE] }, { ok: true, source_turn_ids: ["authored"] },
  ])("fails closed without projecting or retrying malformed/foreign/UNKNOWN data %j", async data => {
    port.batch.mockResolvedValue({ data, error: null }); expect(await loadChatStudioSources(port.tenant, THREAD, [SOURCE])).toEqual({ ok: false });
    expect(calls("chat_studio_sources")).toHaveLength(1); expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("rejects invalid and oversized caller batches before native read", async () => {
    expect(await loadChatStudioSources(port.tenant, THREAD, ["authored"])).toEqual({ ok: false });
    expect(await loadChatStudioSources(port.tenant, THREAD, Array(51).fill(SOURCE))).toEqual({ ok: false });
    const stop = new AbortController(); stop.abort();
    expect(await loadChatStudioSources(port.tenant, THREAD, [SOURCE], stop.signal)).toEqual({ ok: false });
    expect(calls("chat_studio_sources")).toHaveLength(0);
  });
});

describe("lost stage acknowledgment on actual original USER history", () => {
  it("recovers only on the original USER footer across reload, leaving the interrupted assistant unchanged", async () => {
    server(); port.turns = lostHistory(); port.batch.mockResolvedValue({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null });
    const first = await mount(THREAD); await act(flush);
    const original = first.host.querySelector(`[data-paige-message-id="${SOURCE}"]`)!;
    expect(original.textContent).toContain("Create the original public launch page."); expect(handoffs(original)).toHaveLength(1);
    expect(first.host.querySelector('[data-paige-message-id="original-interrupted-answer"]')?.textContent).toContain("The earlier answer was interrupted.");
    expect(calls("chat_studio_sources")[0][1]).toEqual({ p_expected_tenant: port.tenant, p_thread_id: THREAD, p_source_turn_ids: [SOURCE] });
    expect(calls("chat_studio_start")).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
    await first.close(); const reloaded = await mount(THREAD); await act(flush);
    expect(handoffs(reloaded.host.querySelector(`[data-paige-message-id="${SOURCE}"]`)!)).toHaveLength(1);
    expect(calls("chat_studio_sources")).toHaveLength(2); expect(calls("chat_studio_start")).toHaveLength(0);
    const footer = reloaded.host.querySelector(`[data-paige-message-id="${SOURCE}"]`)!;
    await act(async () => { const target = footer.querySelector('select[aria-label="Project target"]') as HTMLSelectElement; target.value = "custom"; target.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { Array.from(footer.querySelectorAll("button")).find(button => button.textContent === "Start Studio project")!.click(); await flush(); });
    expect(calls("chat_studio_start")).toHaveLength(1);
    expect(calls("chat_studio_start")[0][1]).toMatchObject({ p_expected_tenant: port.tenant, p_source_turn_id: SOURCE, p_project_context: { target: { kind: "custom" } } });
  });
  it("does not duplicate an original source already carried by an assistant reference", async () => {
    server(); port.turns = [lostHistory()[0], ...history()]; const { host } = await mount(THREAD);
    expect(handoffs(host)).toHaveLength(1); expect(calls("chat_studio_sources")).toHaveLength(0);
    expect(handoffs(host.querySelector(`[data-paige-message-id="${SOURCE}"]`)!)).toHaveLength(0);
  });
  it("ignores USER-authored bundle references unless the native batch proves that original row", async () => {
    server(); port.turns = [{ ...lostHistory()[0], bundle_ref: { paige_artifact: [pointer()] } }];
    const { host } = await mount(THREAD); await act(flush);
    expect(handoffs(host)).toHaveLength(0); expect(calls("chat_studio_reference")).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("reads all loaded USER IDs sequentially in <=50 chunks and recovers a source in an older chunk", async () => {
    server(); const ids = Array.from({ length: 73 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
    port.turns = ids.map(id => ({ id, role: "user", content: `Original loaded request ${id}`, bundle_ref: null }));
    port.batch.mockImplementation(async (args: { p_source_turn_ids: string[] }) => ({ data: { ok: true, source_turn_ids: args.p_source_turn_ids.includes(ids[0]) ? [ids[0]] : [] }, error: null }));
    const { host } = await mount(THREAD); await act(flush);
    const batches = calls("chat_studio_sources").map(call => call[1].p_source_turn_ids as string[]);
    expect(batches.map(batch => batch.length)).toEqual([50, 23]); expect(new Set(batches.flat())).toEqual(new Set(ids));
    expect(handoffs(host.querySelector(`[data-paige-message-id="${ids[0]}"]`)!)).toHaveLength(1); expect(calls("chat_studio_start")).toHaveLength(0);
    expect(port.load).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ok: false, code: "scope_changed" }, { ok: true, source_turn_ids: [OTHER] }])("does not promote or continue chunks after a refused/foreign/UNKNOWN batch %j", async data => {
    server(); port.turns = Array.from({ length: 60 }, (_, i) => ({ id: `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`, role: "user", content: "Original request", bundle_ref: null }));
    port.batch.mockResolvedValue({ data, error: null }); const { host } = await mount(THREAD); await act(flush);
    expect(calls("chat_studio_sources")).toHaveLength(1); expect(handoffs(host)).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("rejects a late older-chunk result after a thread switch without starting or fetching extra history", async () => {
    server(); const late = pending<{ data: unknown; error: null }>();
    port.turns = Array.from({ length: 55 }, (_, i) => ({ id: i === 0 ? SOURCE : `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`, role: "user", content: "Original request", bundle_ref: null }));
    port.batch.mockResolvedValueOnce({ data: { ok: true, source_turn_ids: [] }, error: null }).mockReturnValueOnce(late.promise);
    const mounted = await mount(THREAD); await act(flush); expect(calls("chat_studio_sources")).toHaveLength(2);
    port.turns = []; await mounted.render(OTHER);
    await act(async () => { late.resolve({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null }); await flush(); });
    expect(handoffs(mounted.host)).toHaveLength(0); expect(calls("chat_studio_reference")).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("keeps only earlier verified sources when a later chunk is unavailable", async () => {
    server(); port.turns = Array.from({ length: 51 }, (_, i) => ({ id: i === 50 ? SOURCE : i === 0 ? OTHER : `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`, role: "user", content: "Original loaded request", bundle_ref: null }));
    port.batch.mockResolvedValueOnce({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null }).mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    const { host } = await mount(THREAD); await act(flush);
    expect(handoffs(host.querySelector(`[data-paige-message-id="${SOURCE}"]`)!)).toHaveLength(1);
    expect(handoffs(host.querySelector(`[data-paige-message-id="${OTHER}"]`)!)).toHaveLength(0);
    expect(calls("chat_studio_sources")).toHaveLength(2); expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("one recovery budget aborts transport and ignores a late result without reading another chunk", async () => {
    server(); const historyRead = pending<Array<Record<string, unknown>>>(), sourceRead = pending<{ data: unknown; error: null }>();
    port.load.mockReturnValue(historyRead.promise); let nativeSignal: AbortSignal | undefined;
    port.batch.mockReturnValue(Object.assign(sourceRead.promise, { abortSignal: (signal: AbortSignal) => { nativeSignal = signal; return sourceRead.promise; } }));
    const { host } = await mount(THREAD); const micro = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => { historyRead.resolve(Array.from({ length: 51 }, (_, i) => ({ id: i === 50 ? SOURCE : `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`, role: "user", content: "Original loaded request", bundle_ref: null }))); await micro(); });
      expect(calls("chat_studio_sources")).toHaveLength(1); expect(nativeSignal?.aborted).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_001); await micro(); });
      expect(nativeSignal?.aborted).toBe(true);
      await act(async () => { sourceRead.resolve({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null }); await micro(); });
      expect(handoffs(host)).toHaveLength(0); expect(calls("chat_studio_sources")).toHaveLength(1); expect(calls("chat_studio_start")).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it.each(["actor", "tenant", "thread"])("rejects out-of-order %s A-B-A batch evidence", async boundary => {
    server(); port.turns = lostHistory(); const late = pending<{ data: unknown; error: null }>();
    port.batch.mockReturnValueOnce(late.promise); const mounted = await mount(THREAD);
    const originalActor = port.actor, originalTenant = port.tenant, originalAccount = port.activeTenant;
    if (boundary === "actor") port.actor = OTHER;
    if (boundary === "tenant") { port.tenant = OTHER; port.activeTenant = { ...port.activeTenant, id: OTHER }; }
    await mounted.render(boundary === "thread" ? OTHER : THREAD);
    port.actor = originalActor; port.tenant = originalTenant; port.activeTenant = originalAccount; await mounted.render(THREAD);
    await act(async () => { late.resolve({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null }); await flush(); });
    expect(handoffs(mounted.host)).toHaveLength(0); expect(calls("chat_studio_reference")).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("a cancelled/unmounted history read cannot mount its late result into a new Chat", async () => {
    server(); port.turns = lostHistory(); const late = pending<{ data: unknown; error: null }>(); port.batch.mockReturnValueOnce(late.promise);
    const first = await mount(THREAD); await first.close(); const next = await mount(THREAD);
    await act(async () => { late.resolve({ data: { ok: true, source_turn_ids: [SOURCE] }, error: null }); await flush(); });
    expect(handoffs(next.host)).toHaveLength(0); expect(calls("chat_studio_reference")).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
  });
});

describe("actual Chat streamed Studio reference retention", () => {
  it("retains the same deduplicated pointer through answer, document/image, CRM, research and proposal frames", async () => {
    const doc = { id: "existing-document", title: "Existing document", artifactType: "document", tenant_id: port.tenant };
    const image = { id: "existing-image", title: "Existing image", artifactType: "image", tenant_id: port.tenant };
    const raw = frame({ paige_artifact: pointer() }); const bytes = enc.encode(raw);
    server([bytes.slice(0, 27), bytes.slice(27), frame({ paige_artifact: pointer() }), say("Which business "),
      frame({ paige_artifact: doc }), frame({ paige_crm_result: { action: "read_contact", receipt_recorded: true } }),
      frame({ paige_research: { run_id: "original-run", findings: [] } }), frame({ paige_artifact: image }),
      frame({ extraction_proposal: { id: "original-proposal", fields: [{ field: "name", value: "Public label" }] } }),
      say("or project should NEXUS build this for?"), DONE]);
    const { host } = await mount(); await ask(host);
    expect(host.textContent).toContain(QUESTION); expect(host.textContent).toContain(BRIEF); expect(handoffs(host)).toHaveLength(1);
    expect(calls("chat_studio_reference")).toHaveLength(1); expect(calls("chat_studio_start")).toHaveLength(0);
    expect(generic(host).map(value => value.artifact.artifactType)).toEqual(["document", "image"]);
    expect(host.querySelector('[data-testid="crm"]')).toBeTruthy(); expect(host.querySelector('[data-testid="research"]')).toBeTruthy();
  });
  it("keeps existing CRM/research cards visible when the Studio pointer arrives before later answer text", async () => {
    const beforeStudio = deferred(), afterStudio = deferred();
    server([frame({ paige_crm_result: { action: "read_contact", receipt_recorded: true } }),
      frame({ paige_research: { run_id: "original-run", findings: [] } }), beforeStudio.promise,
      frame({ paige_artifact: pointer() }), afterStudio.promise, say(QUESTION), DONE]);
    const { host } = await mount(); await ask(host);
    expect(host.querySelector('[data-testid="crm"]')).toBeTruthy(); expect(host.querySelector('[data-testid="research"]')).toBeTruthy();
    try {
      await act(async () => { beforeStudio.resolve(); await flush(); });
      // This commit mounts the real supplemental native reader. Settle its
      // independent read while keeping the provider's answer gate closed.
      for (let i = 0; i < 4 && handoffs(host).length === 0; i++) await act(flush);
      expect(port.wire).toHaveLength(3); expect(port.wire[2]).toContain("studio_source");
      expect(host.querySelector('[data-testid="crm"]')).toBeTruthy(); expect(host.querySelector('[data-testid="research"]')).toBeTruthy();
      expect(calls("chat_studio_reference").map(call => call[1])).toEqual([{ p_expected_tenant: port.tenant, p_source_turn_id: SOURCE }]);
      expect(handoffs(host)).toHaveLength(1);
    } finally { await act(async () => { beforeStudio.resolve(); afterStudio.resolve(); await flush(); }); }
    expect(calls("chat_studio_start")).toHaveLength(0);
  });
  it("shows an inert pointer handoff while the answer text is still in flight", async () => {
    const answer = deferred(); server([frame({ paige_artifact: pointer() }), answer.promise, say(QUESTION), DONE]);
    const { host } = await mount(); await ask(host);
    try {
      expect(handoffs(host)).toHaveLength(1); expect(host.textContent).toContain(BRIEF);
      expect(calls("chat_studio_reference")).toHaveLength(1); expect(calls("chat_studio_start")).toHaveLength(0);
    } finally { await act(async () => { answer.resolve(); await flush(); }); }
  });
  it.each([
    ["extra ID", { session_id: SESSION }], ["URL", { url: "https://example.com/open" }], ["foreign scope", { tenant_id: OTHER }],
  ])("drops streamed %s source metadata and preserves the ordinary answer", async (_label, extra) => {
    server([frame({ paige_artifact: pointer(extra) }), say(QUESTION), DONE]); const { host } = await mount(); await ask(host);
    expect(host.textContent).toContain(QUESTION); expect(handoffs(host)).toHaveLength(0); expect(generic(host)).toEqual([]);
    expect(calls("chat_studio_reference")).toHaveLength(0); expect(calls("chat_studio_start")).toHaveLength(0);
  });
});
