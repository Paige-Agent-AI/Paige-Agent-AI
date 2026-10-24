import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resizeCallbacks: Array<ResizeObserverCallback> = [];

class HarnessResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.stubGlobal("ResizeObserver", HarnessResizeObserver);
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/app" }) };
});
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/playbook", () => ({
  usePlaybook: () => ({ persona: { greeting: "Harness greeting", name: "Paige", role: "AI COO" }, quickActions: [] }),
}));
const portalFixture=vi.hoisted(()=>({phase:"not-client",frame:null as unknown,checking:false,
  read:vi.fn(),outcome:vi.fn(),reload:vi.fn(),summary:vi.fn()}));
const memoryFixture = vi.hoisted(() => ({
  actor: "d2000000-0000-4000-8000-000000000001", tenant: "d2100000-0000-4000-8000-000000000001" as string | null,
  loading: false, scope: vi.fn(), session: vi.fn(), auth: vi.fn(), unsubscribe:vi.fn(),
  authChange:null as null|((event:string,session:{user:{id:string}}|null)=>void),
  context: { block: "", loading: false, hasCreditData: false },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: memoryFixture.tenant, loading: memoryFixture.loading }) }));
const staffFixture = vi.hoisted(() => ({ isAdmin: true, loading: false }));
// The not-client branch is the owner's chat; only staff reach it (owner ruling 2026-10-19).
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ ...staffFixture, mode: "client", setMode: () => {} }) }));
// Round 2: the not-client gate asks staff STANDING (any staff role, membership, owned tenant, agency seat), not the
// "admin" role alone. The fixture drives it: isAdmin true = staff, false = not staff.
vi.mock("@/lib/portal/portalStaffStanding", () => ({ usePortalStaffStanding: (_id: string, enabled: boolean) => enabled ? { loading: staffFixture.loading, staff: staffFixture.loading ? null : staffFixture.isAdmin } : { loading: false, staff: null } }));
vi.mock("@/hooks/useClientPortalFrame", () => ({useClientPortalFrame: () => portalFixture, useSharedClientPortalFrame: () => portalFixture}));
vi.mock("@/lib/customer-chat",()=>({readCustomerChat:(...args:unknown[])=>portalFixture.read(...args),readCustomerChatOutcome:(...args:unknown[])=>portalFixture.outcome(...args)}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: null, loading: false }) }));
vi.mock("@/hooks/useClientChatContext", () => ({
  useClientChatContext: () => ({ contextBlock: memoryFixture.context.block, isLoading: memoryFixture.context.loading, hasCreditData: memoryFixture.context.hasCreditData }),
}));
vi.mock("@/hooks/useProfileSnapshot", () => ({ useProfileSnapshot: () => ({ snapshot: {}, refresh: vi.fn() }) }));
vi.mock("@/hooks/useBeforeUnloadGuard", () => ({ useBeforeUnloadGuard: () => undefined }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/usePaigeMemory", () => ({
  usePaigeMemory: (scope: unknown) => {
    memoryFixture.scope(scope);
    return {
      extractDocumentSummary: vi.fn(), getSessionDocumentContext: vi.fn(() => ""), trackActivity: vi.fn(),
      generateSessionSummary: portalFixture.summary, resetSession: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null },
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">Dictate</button> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => memoryFixture.session(...args),
    getUser: (...args: unknown[]) => memoryFixture.auth(...args),
    onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{memoryFixture.authChange=callback;return {data:{subscription:{unsubscribe:()=>{memoryFixture.unsubscribe();if(memoryFixture.authChange===callback)memoryFixture.authChange=null;}}}};} }, functions: { invoke: vi.fn() } },
}));

import { PaigeChat } from "./PaigeChat";
const actualMemory = await vi.importActual<typeof import("@/hooks/usePaigeMemory")>("@/hooks/usePaigeMemory");
type TestMemoryScope = { actorId: string; tenantId: string | null; clientId: string | null; enabled: boolean };
let memoryApi: ReturnType<typeof actualMemory.usePaigeMemory>;
function MemoryProbe({ scope }: { scope: TestMemoryScope }) {
  memoryApi = actualMemory.usePaigeMemory(scope);
  return null;
}
const pendingMemory = <T,>() => {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(value => { resolve = value; }), resolve: (value: T) => resolve(value) };
};
const memoryMessages = Array.from({ length: 25 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Turn ${index}` }));
const memoryFlush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };

function setGeometry(transcript: HTMLDivElement, scrollHeight: { value: number }) {
  Object.defineProperties(transcript, {
    clientHeight: { configurable: true, get: () => 300 },
    scrollHeight: { configurable: true, get: () => scrollHeight.value },
    scrollTo: {
      configurable: true,
      value: ({ top }: ScrollToOptions) => { transcript.scrollTop = Math.min(Number(top), scrollHeight.value - 300); },
    },
  });
  transcript.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, right: 600, top: 0, bottom: 300,
    width: 600, height: 300, toJSON: () => ({}),
  });
  const message = transcript.querySelector<HTMLElement>("[data-paige-message-id]")!;
  message.getBoundingClientRect = () => ({
    x: 0, y: -transcript.scrollTop, left: 0, right: 600, top: -transcript.scrollTop,
    bottom: scrollHeight.value - transcript.scrollTop, width: 600, height: scrollHeight.value, toJSON: () => ({}),
  });
}

describe("normal PaigeChat remount scroll behavior", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", HarnessResizeObserver);
    portalFixture.phase="not-client";portalFixture.frame=null;portalFixture.checking=false;
    staffFixture.isAdmin=true;staffFixture.loading=false;
    portalFixture.read.mockReset();portalFixture.outcome.mockReset().mockResolvedValue({executor_active:false,settled:true});portalFixture.summary.mockClear();
    memoryFixture.actor = "d2000000-0000-4000-8000-000000000001";
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001";
    memoryFixture.loading = false; memoryFixture.scope.mockClear();memoryFixture.authChange=null;memoryFixture.unsubscribe.mockClear();
    memoryFixture.context = { block: "", loading: false, hasCreditData: false };
    memoryFixture.auth.mockReset().mockImplementation(async () => ({ data: { user: { id: memoryFixture.actor } }, error: null }));
    memoryFixture.session.mockReset().mockImplementation(async () => ({ data: { session: { user: { id: memoryFixture.actor }, access_token: "synthetic-session" } } }));
    sessionStorage.clear();
    resizeCallbacks.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const scope = (): TestMemoryScope => ({ actorId: memoryFixture.actor, tenantId: memoryFixture.tenant, clientId: null, enabled: true });
  const renderMemory = async (value = scope()) => act(async () => { root.render(<MemoryProbe scope={value} />); await memoryFlush(); });
  const memoryFetch = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ summary: "Generated", memory_write_status: "acknowledged" }),
    { status: 200, headers: { "Content-Type": "application/json" } })));

  it("posts an immutable last-20 transcript with its captured actor, selected workspace and focused client", async () => {
    memoryFetch(); const selected = { ...scope(), clientId: "d2200000-0000-4000-8000-000000000001" };
    await renderMemory(selected);
    const messages = memoryMessages.map(message => ({ ...message }));
    const session = pendingMemory<{ data: { session: { user: { id: string }; access_token: string } } }>();
    memoryFixture.session.mockReturnValueOnce(session.promise);
    const task = memoryApi.generateSessionSummary(messages, "origin-session");
    messages[5].content = "Mutated after dispatch";
    session.resolve({ data: { session: { user: { id: selected.actorId }, access_token: "synthetic-session" } } });
    await act(async () => { await task; await memoryFlush(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    const posted = JSON.parse(String(init.body));
    expect(posted.sessionMemoryScope).toEqual({ v: 1, actor_id: selected.actorId, tenant_id: selected.tenantId, client_id: selected.clientId });
    expect(posted.clientId).toBe(selected.clientId);
    expect(posted.sessionId).toBe("origin-session");
    expect(posted.sessionMessages).toHaveLength(20);
    expect(posted.sessionMessages[0].content).toBe("Turn 5");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["actor", "tenant", "client"])("rejects delayed and retained callbacks after a %s A→B→A transition", async boundary => {
    memoryFetch(); const original = scope(); await renderMemory(original);
    const oldGenerate = memoryApi.generateSessionSummary;
    const session = pendingMemory<{ data: { session: { user: { id: string }; access_token: string } } }>();
    memoryFixture.session.mockReturnValueOnce(session.promise);
    const oldTask = oldGenerate(memoryMessages, "old-session"); await act(memoryFlush);
    const changed = { ...original, ...(boundary === "actor" ? { actorId: "d2000000-0000-4000-8000-000000000002" }
      : boundary === "tenant" ? { tenantId: "d2100000-0000-4000-8000-000000000002" } : { clientId: "d2200000-0000-4000-8000-000000000001" }) };
    await renderMemory(changed); await renderMemory(original);
    session.resolve({ data: { session: { user: { id: original.actorId }, access_token: "synthetic-session" } } });
    await act(async () => { await oldTask; await oldGenerate(memoryMessages, "retained-old-session"); await memoryFlush(); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { await memoryApi.generateSessionSummary(memoryMessages, "fresh-session"); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).sessionId).toBe("fresh-session");
  });

  it("does not borrow a new auth actor while an old summary waits for a session", async () => {
    memoryFetch(); await renderMemory();
    memoryFixture.session.mockResolvedValueOnce({ data: { session: { user: { id: "d2000000-0000-4000-8000-000000000002" }, access_token: "new-actor-session" } } });
    await act(async () => { await memoryApi.generateSessionSummary(memoryMessages, "old-session"); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("abandons an unresolved summary session when its owning component unmounts", async () => {
    memoryFetch(); await renderMemory();
    const session = pendingMemory<{ data: { session: { user: { id: string }; access_token: string } } }>();
    memoryFixture.session.mockReturnValueOnce(session.promise);
    const task = memoryApi.generateSessionSummary(memoryMessages, "unmounted-session"); await act(memoryFlush);
    await act(async () => root.unmount()); root = createRoot(host);
    session.resolve({ data: { session: { user: { id: memoryFixture.actor }, access_token: "synthetic-session" } } });
    await task; expect(fetch).not.toHaveBeenCalled();
  });

  it("respects the absolute deadline even before the browser can deliver its timer", async () => {
    vi.useFakeTimers(); memoryFetch(); await renderMemory();
    const session = pendingMemory<{ data: { session: { user: { id: string }; access_token: string } } }>();
    memoryFixture.session.mockReturnValueOnce(session.promise);
    const task = memoryApi.generateSessionSummary(memoryMessages, "expired-session"); await act(memoryFlush);
    vi.setSystemTime(Date.now() + 35_001);
    session.resolve({ data: { session: { user: { id: memoryFixture.actor }, access_token: "synthetic-session" } } });
    await act(async () => { await task; await memoryFlush(); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["scope", "unmount", "deadline"])("aborts an in-flight summary fetch at its %s boundary", async boundary => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Synthetic abort", "AbortError")), { once: true });
    })));
    await renderMemory();
    const task = memoryApi.generateSessionSummary(memoryMessages, "pending-session"); await act(memoryFlush);
    expect(fetch).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    if (boundary === "scope") await renderMemory({ ...scope(), tenantId: "d2100000-0000-4000-8000-000000000002" });
    else if (boundary === "unmount") { await act(async () => root.unmount()); root = createRoot(host); }
    else await act(async () => { await vi.advanceTimersByTimeAsync(35_001); });
    await task; expect(signal?.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });

  const ordinaryUser = () => ({ id: memoryFixture.actor, user_metadata: {} } as never);
  const renderOrdinaryChat = async (user = ordinaryUser(), clientId?: string) => act(async () => {
    root.render(<PaigeChat user={user} session={null} clientId={clientId} />); await memoryFlush();
  });
  const sendOrdinary = async (text: string) => {
    await act(async () => {
      const input = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).click(); await memoryFlush(); });
  };
  const ordinaryStream = () => vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Same-scope answer"}}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { "Content-Type": "text/event-stream" } })));
  const observedScope = () => memoryFixture.scope.mock.lastCall?.[0] as TestMemoryScope;

  it.each([false, true])("enables an untouched cold-start summary after legitimate tenant hydration (intermediate loading=%s)", async intermediate => {
    vi.useFakeTimers(); ordinaryStream();
    memoryFixture.tenant = null; memoryFixture.loading = true;
    await renderOrdinaryChat();
    const unresolvedScope = observedScope();
    expect(unresolvedScope).toMatchObject({ actorId: memoryFixture.actor, tenantId: null, clientId: null });
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001";
    if (intermediate) { await renderOrdinaryChat(); expect(observedScope().enabled).toBe(false); }
    memoryFixture.loading = false; await renderOrdinaryChat();
    expect(observedScope()).toEqual({ actorId: memoryFixture.actor, tenantId: memoryFixture.tenant, clientId: null, enabled: true });
    expect(unresolvedScope.enabled).toBe(false);
    await sendOrdinary("First question after workspace hydration");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).toHaveBeenCalledTimes(1);
    expect(portalFixture.summary.mock.calls[0][0]).toEqual(expect.arrayContaining([{ role: "user", content: "First question after workspace hydration" }]));
  });

  it.each(["actor", "client", "settled-null", "settled-after-loading", "unscoped-transcript"])("does not adopt a cold transcript after %s changes", async boundary => {
    vi.useFakeTimers(); ordinaryStream();
    const user = ordinaryUser(); memoryFixture.tenant = null; memoryFixture.loading = boundary !== "settled-null";
    await renderOrdinaryChat(user);
    if (boundary === "actor") { await renderOrdinaryChat({ id: "d2000000-0000-4000-8000-000000000002", user_metadata: {} } as never); await renderOrdinaryChat(user); }
    if (boundary === "client") { await renderOrdinaryChat(user, "d2200000-0000-4000-8000-000000000001"); await renderOrdinaryChat(user); }
    if (boundary === "settled-after-loading") { memoryFixture.loading = false; await renderOrdinaryChat(user); }
    if (boundary === "unscoped-transcript") await sendOrdinary("Question before workspace is known");
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001"; memoryFixture.loading = false;
    await renderOrdinaryChat(user); expect(observedScope().enabled).toBe(false);
    await sendOrdinary("Retained conversation after hydration");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).not.toHaveBeenCalled();
  });

  it("refuses an asynchronous context opening that replaced the initial greeting before tenant hydration", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Unscoped dynamic opening"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    memoryFixture.tenant = null; memoryFixture.loading = true;
    memoryFixture.context = { block: "Synthetic context supplied before workspace resolution", loading: false, hasCreditData: true };
    await renderOrdinaryChat();
    expect(host.textContent).toContain("Unscoped dynamic opening");
    expect(host.textContent).not.toContain("Harness greeting");
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001"; memoryFixture.loading = false;
    await renderOrdinaryChat(); expect(observedScope().enabled).toBe(false);
    await sendOrdinary("This replaced opening must not be adopted");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("paige-factory-reset")); });
    await sendOrdinary("Fresh explicitly reset conversation");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).toHaveBeenCalledTimes(1);
  });

  it("refuses a started opening that completes only after tenant hydration", async () => {
    vi.useFakeTimers();
    const opening = pendingMemory<Response>();
    const response = () => new Response('data: {"choices":[{"delta":{"content":"Late unknown-context opening"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(opening.promise).mockImplementation(async () => response()));
    memoryFixture.tenant = null; memoryFixture.loading = true;
    memoryFixture.context = { block: "Synthetic pending context before workspace resolution", loading: false, hasCreditData: true };
    await renderOrdinaryChat(); expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Harness greeting");
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001"; memoryFixture.loading = false;
    await renderOrdinaryChat(); const hydratedScope = observedScope();
    opening.resolve(response()); await act(memoryFlush);
    expect(host.textContent).toContain("Late unknown-context opening");
    expect(hydratedScope.enabled).toBe(false);
    await sendOrdinary("This late opening must not be adopted");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).not.toHaveBeenCalled();
  });

  it("revokes a hydrated origin across a null detach and return until an explicit reset", async () => {
    vi.useFakeTimers(); ordinaryStream(); memoryFixture.tenant = null; memoryFixture.loading = true;
    await renderOrdinaryChat(); memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001"; memoryFixture.loading = false;
    await renderOrdinaryChat(); await sendOrdinary("Original hydrated workspace question");
    memoryFixture.tenant = null; memoryFixture.loading = true; await renderOrdinaryChat();
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001"; memoryFixture.loading = false; await renderOrdinaryChat();
    expect(observedScope().enabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("paige-factory-reset")); });
    expect(observedScope().enabled).toBe(true); await sendOrdinary("Fresh reset after detach");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(portalFixture.summary.mock.calls[0][0])).not.toContain("Original hydrated workspace question");
  });

  it.each(["actor", "tenant", "client"])("keeps ordinary inactivity summaries origin-bound after %s changes until an explicit reset", async boundary => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Same-scope answer"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const user = { id: memoryFixture.actor, user_metadata: {} } as never;
    const renderChat = async (nextUser = user, clientId?: string) => act(async () => { root.render(<PaigeChat user={nextUser} session={null} clientId={clientId} />); await memoryFlush(); });
    const send = async (text: string) => {
      await act(async () => {
        const input = host.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).click(); await memoryFlush(); });
    };
    await renderChat(); await send("Original view question");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).toHaveBeenCalledTimes(1);
    expect(portalFixture.summary.mock.calls[0][0]).toEqual(expect.arrayContaining([{ role: "assistant", content: "Same-scope answer" }]));
    portalFixture.summary.mockClear();
    await send("Another original view question");
    if (boundary === "tenant") memoryFixture.tenant = "d2100000-0000-4000-8000-000000000002";
    await renderChat(boundary === "actor" ? { id: "d2000000-0000-4000-8000-000000000002", user_metadata: {} } as never : user,
      boundary === "client" ? "d2200000-0000-4000-8000-000000000001" : undefined);
    memoryFixture.tenant = "d2100000-0000-4000-8000-000000000001";
    await renderChat();
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).not.toHaveBeenCalled();
    await send("A retained mixed-scope transcript must not be summarized");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("paige-factory-reset")); });
    await send("Fresh reset session");
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); });
    expect(portalFixture.summary).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(portalFixture.summary.mock.calls[0][0])).not.toContain("Original view question");
  });

  it("does not inherit an unresolvable anchor after remount and follows subsequent growth", async () => {
    const props = { user: { id: "owner-a", user_metadata: {} } as never, session: null };
    await act(async () => root.render(<PaigeChat {...props} />));
    const first = host.querySelector<HTMLDivElement>("[data-paige-transcript-scroll=true]")!;
    const firstHeight = { value: 1_200 };
    setGeometry(first, firstHeight);
    const firstId = first.querySelector<HTMLElement>("[data-paige-message-id]")!.dataset.paigeMessageId;
    first.dispatchEvent(new WheelEvent("wheel"));
    first.scrollTop = 425;
    first.dispatchEvent(new Event("scroll", { bubbles: true }));

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<PaigeChat {...props} />));
    const remount = host.querySelector<HTMLDivElement>("[data-paige-transcript-scroll=true]")!;
    const remountHeight = { value: 1_200 };
    setGeometry(remount, remountHeight);
    const remountId = remount.querySelector<HTMLElement>("[data-paige-message-id]")!.dataset.paigeMessageId;
    expect(remountId).not.toBe(firstId);

    await act(async () => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(remount.scrollTop).toBe(900);

    await act(async () => window.dispatchEvent(new Event("paige-factory-reset")));
    expect(remount.scrollTop).toBe(900);

    remountHeight.value = 1_350;
    await act(async () => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(remount.scrollTop).toBe(1_050);
  });

  it("hydrates canonical customer history and keeps the same draft concealed during a session recheck",async()=>{
    const actor="e0915000-0000-4000-8000-000000000001";
    portalFixture.phase="ready";
    portalFixture.frame={actorId:actor,profile:{id:"e0935000-0000-4000-8000-000000000001",
      tenant_id:"e0925000-0000-4000-8000-000000000001"},
      brand:{tenant_name:"Test customer practice",logo_url:null,primary_color:null},config:{}};
    portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",
      messages:[{id:"e0955000-0000-4000-8000-000000000001",role:"user",content:"Saved private question"},
        {id:"e0955000-0000-4000-8000-000000000002",role:"assistant",content:"Saved private answer"}]});
    const props={user:{id:actor,user_metadata:{}} as never,session:null};
    await act(async()=>{root.render(<PaigeChat {...props}/>);for(let i=0;i<30;i++)await Promise.resolve();});
    expect(host.textContent).toContain("Saved private answer");
    expect(host.textContent).toContain("Cura");
    expect(host.textContent).toContain("AI client success agent for Test customer practice");
    expect(host.querySelector('[data-paige-message-id="e0955000-0000-4000-8000-000000000002"]')).not.toBeNull();
    const input=host.querySelector("textarea")!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"My unsent private draft");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    portalFixture.checking=true;
    await act(async()=>root.render(<PaigeChat {...props}/>));
    expect(host.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("My unsent private draft");
    expect(host.querySelector("[inert]")).not.toBeNull();
    expect(host.textContent).toContain("Checking your conversation");
    portalFixture.checking=false;
    await act(async()=>{root.render(<PaigeChat {...props}/>);for(let i=0;i<30;i++)await Promise.resolve();});
    expect(host.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("My unsent private draft");
    expect(portalFixture.summary).not.toHaveBeenCalled();
  });

  const returningCustomer=()=>{
    portalFixture.phase="ready";
    portalFixture.frame={actorId:memoryFixture.actor,profile:{id:"e0935000-0000-4000-8000-000000000001",
      tenant_id:"e0925000-0000-4000-8000-000000000001"},
      brand:{tenant_name:"Test practice",logo_url:null,primary_color:null},config:{}};
    return {user:{id:memoryFixture.actor,user_metadata:{}} as never,session:null};
  };

  it("sends the selected customer business, verified bearer and private-only turn to CURA",async()=>{
    const props=returningCustomer();portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",messages:[]});
    const sent=vi.fn(async(..._args:unknown[])=>new Response('data: {"choices":[{"delta":{"content":"Authorized customer reply"}}]}\n\ndata: [DONE]\n\n',{status:200,headers:{"Content-Type":"text/event-stream"}}));vi.stubGlobal("fetch",sent);
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    const input=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"My approved program?");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await memoryFlush();});
    expect(sent).toHaveBeenCalledTimes(1);const init=sent.mock.calls[0][1] as RequestInit;const headers=new Headers(init.headers);
    expect(headers.get("x-client-portal-business")).toBe("e0925000-0000-4000-8000-000000000001");
    expect(headers.get("Authorization")).toBe("Bearer synthetic-session");expect(memoryFixture.auth).toHaveBeenCalledWith("synthetic-session");
    const body=JSON.parse(String(init.body));expect(body.messages).toEqual([{role:"user",content:"My approved program?"}]);expect(body.surfaceContext).toEqual({kind:"customer_portal"});
    for(const k of ["clientId","clientContext","sessionDocumentContext","approvedConfirmations","attachments","document"])expect(body).not.toHaveProperty(k);
  });
  it("a different cached login cannot send the original customer's private request",async()=>{
    const props=returningCustomer();portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",messages:[]});
    const sent=vi.fn(async(..._args:unknown[])=>new Response("data: [DONE]\n\n"));vi.stubGlobal("fetch",sent);
    memoryFixture.session.mockResolvedValue({data:{session:{user:{id:"other-login"},access_token:"synthetic-other"}}});
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});const input=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Keep my question");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await memoryFlush();});
    expect(sent).not.toHaveBeenCalled();expect(input.value).toBe("Keep my question");
  });

  it("an actual Auth identity event aborts a private request and rejects its late reply",async()=>{
    const props=returningCustomer();portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",messages:[{id:"private-old",role:"assistant",content:"Private previous customer answer"}]});
    let finish!:(response:Response)=>void;const sent=vi.fn((..._args:unknown[])=>new Promise<Response>(r=>{finish=r;}));vi.stubGlobal("fetch",sent);
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});const input=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"My private request");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await memoryFlush();});
    expect(sent).toHaveBeenCalledTimes(1);expect(memoryFixture.authChange).not.toBeNull();
    await act(async()=>{memoryFixture.authChange?.("SIGNED_OUT",null);await memoryFlush();});
    expect((sent.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);expect(host.textContent).not.toContain("Private previous customer answer");
    await act(async()=>{finish(new Response('data: {"choices":[{"delta":{"content":"LATE_PRIVATE_REPLY"}}]}\n\ndata: [DONE]\n\n'));await memoryFlush();});
    expect(host.textContent).not.toContain("LATE_PRIVATE_REPLY");expect(memoryFixture.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("a genuine empty current conversation replaces an older transcript while preserving the draft",async()=>{
    const props=returningCustomer();
    portalFixture.read.mockResolvedValueOnce({threadId:"old-thread",messages:[{id:"old-turn",role:"assistant",content:"Older saved answer"}]})
      .mockResolvedValueOnce({threadId:"new-thread",messages:[]});
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    const input=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Keep my draft");input.dispatchEvent(new Event("input",{bubbles:true}));});
    portalFixture.checking=true;await act(async()=>root.render(<PaigeChat {...props}/>));
    portalFixture.checking=false;await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    expect(host.textContent).not.toContain("Older saved answer");
    expect(host.textContent).toContain("the AI client success agent for Test practice");
    expect(host.querySelector("textarea")).toBe(input);expect(input.value).toBe("Keep my draft");
  });
  it("an interrupted history read times out, ignores its late result and permits an explicit fresh retry",async()=>{
    vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn());const props=returningCustomer();
    const pending=pendingMemory<{threadId:string;messages:unknown[]}>();
    portalFixture.read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({threadId:"retry-thread",messages:[{id:"retry-answer",role:"assistant",content:"Recovered canonical answer"}]});
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    const signal=portalFixture.read.mock.calls[0][1] as AbortSignal;
    const input=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Unsent question");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{vi.advanceTimersByTime(20_000);await memoryFlush();});
    expect(signal.aborted).toBe(true);expect(host.textContent).toContain("Your conversation couldn’t be loaded.");
    expect(host.textContent).not.toContain("READY WHEN YOU ARE");
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);
    pending.resolve({threadId:"stale-thread",messages:[{id:"late-turn",role:"assistant",content:"Late old result"}]});await act(memoryFlush);
    expect(host.textContent).not.toContain("Late old result");
    await act(async()=>{const retry=[...host.querySelectorAll("button")].find(b=>b.textContent==="Try again")!;retry.focus();retry.click();await memoryFlush();});
    expect(host.textContent).toContain("Recovered canonical answer");expect(input.value).toBe("Unsent question");
    expect(document.activeElement).toBe(input);
    expect(portalFixture.read).toHaveBeenCalledTimes(2);expect(fetch).not.toHaveBeenCalled();
  });
  it("a late history reply cannot bypass the absolute deadline before its timer runs",async()=>{
    vi.useFakeTimers();const props=returningCustomer();const pending=pendingMemory<{threadId:string;messages:unknown[]}>();
    portalFixture.read.mockReturnValueOnce(pending.promise);
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    vi.setSystemTime(Date.now()+20_001);pending.resolve({threadId:"late-thread",messages:[{id:"late",role:"assistant",content:"Beyond deadline"}]});
    await act(memoryFlush);
    expect(host.textContent).toContain("Your conversation couldn’t be loaded.");expect(host.textContent).not.toContain("Beyond deadline");
    expect((portalFixture.read.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  });
  it("unmount retires the original history request and cannot revive its late transcript",async()=>{
    const props=returningCustomer();const pending=pendingMemory<{threadId:string;messages:unknown[]}>();portalFixture.read.mockReturnValueOnce(pending.promise);
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    const signal=portalFixture.read.mock.calls[0][1] as AbortSignal;
    await act(async()=>root.unmount());root=createRoot(host);
    expect(signal.aborted).toBe(true);pending.resolve({threadId:"old",messages:[{id:"old",role:"assistant",content:"Retired transcript"}]});await act(memoryFlush);
    expect(host.textContent).not.toContain("Retired transcript");
  });

  it("retires private customer text when relationship access is lost",async()=>{
    const props={user:{id:"customer-test",user_metadata:{}} as never,session:null};
    portalFixture.phase="ready";
    portalFixture.frame={actorId:"customer-test",profile:{id:"customer-contact",tenant_id:"customer-business"},
      brand:{tenant_name:"Test practice"},config:{}};
    portalFixture.read.mockResolvedValue({threadId:"private-thread",
      messages:[{id:"private-message",role:"assistant",content:"Customer-private saved answer"}]});
    await act(async()=>{root.render(<PaigeChat {...props}/>);for(let i=0;i<30;i++)await Promise.resolve();});
    expect(host.textContent).toContain("Customer-private saved answer");
    portalFixture.phase="unavailable";portalFixture.frame=null;
    await act(async()=>root.render(<PaigeChat {...props}/>));
    expect(host.textContent).not.toContain("Customer-private saved answer");
    expect(host.textContent).toContain("customer access is no longer available");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("shows explicit assistant disablement without offering a send or retry loop",async()=>{
    portalFixture.phase="ready";
    portalFixture.frame={actorId:"customer-test",profile:{id:"customer-contact",tenant_id:"customer-business"},
      brand:{tenant_name:"Test practice"},config:{assistant:{enabled:false}}};
    const props={user:{id:"customer-test",user_metadata:{}} as never,session:null};
    await act(async()=>root.render(<PaigeChat {...props}/>));
    expect(host.textContent).toContain("This business has turned off its AI assistant");
    expect(host.querySelector("[inert]")).not.toBeNull();
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);
    expect(portalFixture.read).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].some(b=>b.textContent==="Try again")).toBe(false);
  });

  // Owner ruling 2026-10-19: PAIGE is the owner's COO and is never inside the Customer Portal. A person
  // on /app whose customer access is not active (a former customer opening a bookmarked page) is not
  // staff, so they never get the owner's chat, its PAIGE persona, or a turn sent to it.
  it("never gives a non-staff viewer without a customer frame the owner's PAIGE chat", async () => {
    staffFixture.isAdmin=false;
    await act(async()=>{root.render(<PaigeChat user={{id:"former-customer",user_metadata:{}} as never} session={null}/>);for(let i=0;i<10;i++)await Promise.resolve();});
    expect(host.textContent).toContain("Your access to this portal isn’t active.");
    expect(host.textContent).not.toMatch(/paige/i);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("[data-paige-transcript-scroll=true]")).toBeNull();
    // Round 2 render: the one way to get help from here (the drive clicks it in the harness).
    expect([...host.querySelectorAll("button")].map(b=>b.textContent)).toContain("Contact support");
  });
  // Round 2 (verifier §58 #9): staff without the "admin" role (a coach, a platform operator, an agency seat) are
  // staff too, and must not be told their customer access isn't active.
  it("keeps the owner's chat for any staff standing, not only the admin role", async () => {
    staffFixture.isAdmin=true;
    await act(async()=>{root.render(<PaigeChat user={{id:"coach-a",user_metadata:{}} as never} session={null}/>);for(let i=0;i<10;i++)await Promise.resolve();});
    expect(host.textContent).not.toContain("isn’t active");
    expect(host.querySelector("textarea")).not.toBeNull();
  });
  it("says it couldn't check, rather than either answer, when staff standing is unknown", async () => {
    staffFixture.loading=true;
    await act(async()=>{root.render(<PaigeChat user={{id:"unknown-a",user_metadata:{}} as never} session={null}/>);for(let i=0;i<10;i++)await Promise.resolve();});
    expect(host.textContent).toContain("Checking your conversation…");
    expect(host.querySelector("textarea")).toBeNull();
  });
  it("keeps the owner's chat for an admin previewing /app (§58)", async () => {
    await act(async()=>{root.render(<PaigeChat user={{id:"owner-a",user_metadata:{}} as never} session={null}/>);for(let i=0;i<10;i++)await Promise.resolve();});
    expect(host.querySelector("textarea")).not.toBeNull();
  });
  const prepareCustomerRecovery=async(response:()=>Promise<Response>)=>{
    const props=returningCustomer();portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",messages:[]});
    const sent=vi.fn(response);vi.stubGlobal("fetch",sent);
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    const input=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"My original private question");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await memoryFlush();});
    return {props,input,sent};
  };
  for(const [name,response] of [
    ["transport loss",async()=>{throw Error("Synthetic connection lost");}],
    ["possibly accepted refusal",async()=>new Response(JSON.stringify({code:"INTERACTIVE_ACCEPTANCE_UNKNOWN",message_accepted:true}),{status:409,headers:{"Content-Type":"application/json"}})],
    ["premature stream end",async()=>new Response('data: {"choices":[{"delta":{"content":"Partial private reply"}}]}\n\n',{headers:{"Content-Type":"text/event-stream"}})],
  ] as const)it("customer recovery holds the original question after "+name+" without resending",async()=>{
    const {input,sent}=await prepareCustomerRecovery(response);
    expect(host.textContent).toContain("We couldn’t confirm this reply");
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain("My original private question");
    expect(host.textContent).not.toContain("READY WHEN YOU ARE");
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await memoryFlush();});
    expect(sent).toHaveBeenCalledTimes(1);expect(portalFixture.outcome).not.toHaveBeenCalled();
  });
  it("customer recovery restores only a definitely unaccepted question for explicit correction",async()=>{
    const {input,sent}=await prepareCustomerRecovery(async()=>new Response(JSON.stringify({code:"INTERACTIVE_SCOPE_UNAVAILABLE",message_accepted:false}),{status:403,headers:{"Content-Type":"application/json"}}));
    expect(input.value).toBe("My original private question");expect(host.textContent).not.toContain("We couldn’t confirm this reply");
    expect(sent).toHaveBeenCalledTimes(1);expect(portalFixture.outcome).not.toHaveBeenCalled();
  });
  it("customer recovery reads the original intent and restores only settled canonical history",async()=>{
    const {sent}=await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    const payload=JSON.parse(String((sent.mock.calls[0] as unknown[])[1]&&((sent.mock.calls[0] as unknown[])[1] as RequestInit).body));
    portalFixture.read.mockResolvedValue({threadId:payload.threadId,messages:[{id:"saved-user",role:"user",content:"My original private question"},{id:"saved-reply",role:"assistant",content:"Actually saved customer answer"}]});
    const check=[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!;
    expect(check).toBeDefined();await act(async()=>{check.click();await memoryFlush();});
    expect(portalFixture.outcome).toHaveBeenCalledWith(portalFixture.frame,payload.threadId,payload.requestIntentId,expect.any(AbortSignal));
    expect(host.textContent).toContain("Actually saved customer answer");expect(host.textContent).toContain("Your saved conversation is up to date.");
    expect(document.activeElement).toBe(host.querySelector("textarea"));expect(sent).toHaveBeenCalledTimes(1);
  });
  it("customer recovery does not mistake an unconfirmed original status for completion",async()=>{
    const {sent}=await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    portalFixture.outcome.mockResolvedValue({executor_active:false,settled:false});
    const check=[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!;expect(check).toBeDefined();
    await act(async()=>{check.click();await memoryFlush();});
    expect(host.textContent).toContain("Your reply is still unconfirmed");expect(host.textContent).not.toContain("up to date");
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);expect(sent).toHaveBeenCalledTimes(1);
  });

  it("customer recovery times out its original read and ignores a late settled result",async()=>{
    vi.useFakeTimers();const {sent}=await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    const pending=pendingMemory<{executor_active:boolean;settled:boolean}>();portalFixture.outcome.mockReturnValueOnce(pending.promise);
    const check=[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!;
    await act(async()=>{check.click();check.click();await memoryFlush();});
    expect(portalFixture.outcome).toHaveBeenCalledTimes(1);const signal=portalFixture.outcome.mock.calls[0][3] as AbortSignal;
    await act(async()=>{vi.advanceTimersByTime(20_000);await memoryFlush();});
    expect(signal.aborted).toBe(true);expect(host.textContent).toContain("Your conversation couldn’t be checked just now.");
    await act(async()=>{pending.resolve({executor_active:false,settled:true});await memoryFlush();});
    expect(host.textContent).not.toContain("up to date");expect(portalFixture.read).toHaveBeenCalledTimes(1);expect(sent).toHaveBeenCalledTimes(1);
  });
  it("customer recovery retains an interrupted original request at the reply deadline",async()=>{
    vi.useFakeTimers();const pending=pendingMemory<Response>();const {sent}=await prepareCustomerRecovery(()=>pending.promise);
    const signal=(sent.mock.calls[0] as unknown[])[1] as RequestInit;
    await act(async()=>{vi.advanceTimersByTime(360_000);await memoryFlush();});
    expect(signal.signal?.aborted).toBe(true);expect(host.textContent).toContain("We couldn’t confirm this reply");
    await act(async()=>{pending.resolve(new Response('data: {"choices":[{"delta":{"content":"LATE_AFTER_REPLY_DEADLINE"}}]}\n\ndata: [DONE]\n\n'));await memoryFlush();});
    expect(host.textContent).not.toContain("LATE_AFTER_REPLY_DEADLINE");expect(sent).toHaveBeenCalledTimes(1);
  });
  it("customer recovery clears private text on an Auth event during its original status read",async()=>{
    await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    const pending=pendingMemory<{executor_active:boolean;settled:boolean}>();portalFixture.outcome.mockReturnValueOnce(pending.promise);
    const check=[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!;
    await act(async()=>{check.click();await memoryFlush();memoryFixture.authChange?.("SIGNED_OUT",null);await memoryFlush();});
    expect(host.textContent).not.toContain("My original private question");expect((portalFixture.outcome.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
    await act(async()=>{pending.resolve({executor_active:false,settled:true});await memoryFlush();});
    expect(portalFixture.read).toHaveBeenCalledTimes(1);expect(host.textContent).not.toContain("up to date");
  });
  it("customer recovery refuses an otherwise settled response that reloads a different thread",async()=>{
    await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    portalFixture.read.mockResolvedValue({threadId:"foreign-thread",messages:[{id:"foreign",role:"assistant",content:"FOREIGN_PRIVATE_REPLY"}]});
    await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!.click();await memoryFlush();});
    expect(host.textContent).not.toContain("FOREIGN_PRIVATE_REPLY");expect(host.textContent).not.toContain("up to date");expect(host.textContent).toContain("Your conversation couldn’t be checked just now.");
  });
  it("customer recovery keeps a newer canonical intent held after reading an older settled one",async()=>{
    await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",latestRequestIntentId:"e0965000-0000-4000-8000-000000000002",messages:[{id:"new-original",role:"user",content:"Newer canonical question"}]});
    await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!.click();await memoryFlush();});
    expect(host.textContent).toContain("Newer canonical question");expect(host.textContent).not.toContain("up to date");
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);
  });
  it("customer recovery checks a returning original native intent before admitting a new question",async()=>{
    const props=returningCustomer();portalFixture.read.mockResolvedValue({threadId:"e0945000-0000-4000-8000-000000000001",latestRequestIntentId:"e0965000-0000-4000-8000-000000000001",messages:[{id:"saved",role:"user",content:"Previously admitted private question"}]});
    portalFixture.outcome.mockResolvedValue({executor_active:false,settled:false});const sent=vi.fn();vi.stubGlobal("fetch",sent);
    await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    expect(host.textContent).toContain("Your reply is still unconfirmed");expect(host.textContent).toContain("Previously admitted private question");
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);expect(sent).not.toHaveBeenCalled();
  });

  it("customer recovery retains the dispatched original intent through an ordinary access recheck",async()=>{
    const held=pendingMemory<Response>();const {props,sent}=await prepareCustomerRecovery(()=>held.promise);
    const original=JSON.parse(String(((sent.mock.calls[0] as unknown[])[1] as RequestInit).body));
    portalFixture.outcome.mockResolvedValue({executor_active:false,settled:false});
    portalFixture.checking=true;await act(async()=>root.render(<PaigeChat {...props}/>));
    portalFixture.checking=false;await act(async()=>{root.render(<PaigeChat {...props}/>);await memoryFlush();});
    expect(portalFixture.outcome).toHaveBeenCalledWith(portalFixture.frame,original.threadId,original.requestIntentId,expect.any(AbortSignal));
    expect(host.textContent).toContain("Your reply is still unconfirmed");
    expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);
    await act(async()=>{held.resolve(new Response('data: {"choices":[{"delta":{"content":"LATE_RECHECK_REPLY"}}]}\n\ndata: [DONE]\n\n'));await memoryFlush();});
    expect(host.textContent).not.toContain("LATE_RECHECK_REPLY");expect(sent).toHaveBeenCalledTimes(1);
  });
  it("customer recovery does not treat an empty DONE stream as a saved answer",async()=>{
    await prepareCustomerRecovery(async()=>new Response('data: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}}));
    expect(host.textContent).toContain("We couldn’t confirm this reply");expect(host.querySelector("button[aria-label='Send message']")?.hasAttribute("disabled")).toBe(true);
  });

  it("customer recovery restores keyboard focus to its read action after a failed check",async()=>{
    await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});portalFixture.outcome.mockRejectedValueOnce(Error("Synthetic unavailable status"));
    const check=[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!;
    await act(async()=>{check.click();await memoryFlush();});
    expect(document.activeElement).toBe(check);expect(host.textContent).toContain("Your conversation couldn’t be checked just now.");
  });
  it("customer recovery does not take focus from other work when its settled read finishes",async()=>{
    await prepareCustomerRecovery(async()=>{throw Error("Synthetic lost acknowledgement");});
    const pending=pendingMemory<{executor_active:boolean;settled:boolean}>();portalFixture.outcome.mockReturnValueOnce(pending.promise);
    await act(async()=>{[...host.querySelectorAll("button")].find(b=>b.textContent==="Check conversation")!.click();await memoryFlush();});
    const other=document.createElement("textarea");document.body.append(other);other.focus();
    await act(async()=>{pending.resolve({executor_active:false,settled:true});await memoryFlush();});
    expect(document.activeElement).toBe(other);other.remove();
  });

});
