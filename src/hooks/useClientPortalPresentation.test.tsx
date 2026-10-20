import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actorA = "test-actor-a", actorB = "test-actor-b";
type Listener = (event: string, session: { user: { id: string } } | null) => void;
let actor: string | null;
let listener: Listener | null;
const getUser = vi.fn(), rpc = vi.fn(), unsubscribe = vi.fn();
const rawRead = vi.fn((..._args: unknown[]) => { throw new Error("Raw CRM is not a presentation contract"); });
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (...args: unknown[]) => rawRead(...args),
  rpc: (...args: unknown[]) => rpc(...args),
  auth: {
    getUser: () => getUser(),
    onAuthStateChange: (callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    },
  },
} }));
const { useClientPortalBrandState } = await import("./useClientPortalBrand");
const { useClientPortalConfigState, normalizePortalConfig } = await import("./useClientPortalConfig");

const brand = (id = actorA) => ({ tenant_id: `test-tenant-${id}`, tenant_name: id, logo_url: null, primary_color: "#26483e" });
const config = (id = actorA) => ({ welcome: { headline: id }, modules: [{ key: "documents", visible: false }] });
const cases = [
  { kind: "brand", rpc: "get_client_portal_brand", value: (id = actorA) => [brand(id)], expected: brand, empty: null },
  { kind: "config", rpc: "get_client_portal_config", value: config, expected: config, empty: {} },
] as const;
type Kind = typeof cases[number]["kind"];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let state: { data: unknown; loading: boolean };
function BrandProbe() { const value = useClientPortalBrandState(); state = { data: value.brand, loading: value.loading }; return <output>{JSON.stringify(state)}</output>; }
function ConfigProbe() { const value = useClientPortalConfigState(); state = { data: value.config, loading: value.loading }; return <output>{JSON.stringify(state)}</output>; }
let root: Root, host: HTMLDivElement, mounted: boolean;
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function mount(kind: Kind) { mounted = true; await act(async () => root.render(kind === "brand" ? <BrandProbe /> : <ConfigProbe />)); await flush(); }
function authResult(id: string | null) { return { data: { user: id ? { id } : null }, error: null }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function auth(event: string, id: string | null) { act(() => listener?.(event, id ? { user: { id } } : null)); await flush(); }
beforeEach(() => {
  actor = actorA; listener = null; mounted = false;
  getUser.mockReset(); rpc.mockReset(); unsubscribe.mockClear(); rawRead.mockClear();
  getUser.mockImplementation(async () => authResult(actor));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { if (mounted) act(() => root.unmount()); host.remove(); });

describe.each(cases)("customer $kind presentation lifetime", subject => {
  beforeEach(() => rpc.mockImplementation(async () => ({ data: subject.value(actor ?? actorA), error: null })));
  it("uses verified actual Auth and only the incumbent argument-free native reader", async () => {
    await mount(subject.kind);
    expect(state).toEqual({ data: subject.expected(), loading: false });
    expect(rpc).toHaveBeenCalledWith(subject.rpc);
    expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
    expect(rawRead).not.toHaveBeenCalled();
  });
  it.each(["missing", "refused"])("does not read customer records when Auth is %s", async mode => {
    getUser.mockResolvedValue(mode === "missing" ? authResult(null) : { ...authResult(actorA), error: { message: "verification failed" } });
    await mount(subject.kind);
    expect(state).toEqual({ data: subject.empty, loading: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("ignores data returned alongside an RPC refusal", async () => {
    rpc.mockResolvedValue({ data: subject.value(), error: { message: "forbidden" } });
    await mount(subject.kind); expect(state).toEqual({ data: subject.empty, loading: false });
  });
  it("settles neutrally for a malformed native presentation payload", async () => {
    rpc.mockResolvedValue({ data: subject.kind === "brand" ? [{ tenant_name: "No relationship" }] : "invalid", error: null });
    await mount(subject.kind); expect(state).toEqual({ data: subject.empty, loading: false });
  });
  it("settles neutrally after a thrown transport failure and can recover on focus", async () => {
    rpc.mockRejectedValueOnce(new Error("offline")); await mount(subject.kind);
    expect(state).toEqual({ data: subject.empty, loading: false });
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    expect(state).toEqual({ data: subject.expected(), loading: false });
  });
  it("synchronously retires loaded data at sign-out and rejects a stale focus session", async () => {
    await mount(subject.kind);
    act(() => listener?.("SIGNED_OUT", null));
    expect(state).toEqual({ data: subject.empty, loading: false });
    const calls = rpc.mock.calls.length;
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    expect(rpc).toHaveBeenCalledTimes(calls);
  });
  it("a late initial Auth result cannot resurrect presentation after sign-out", async () => {
    const pending = deferred<ReturnType<typeof authResult>>(); getUser.mockReturnValueOnce(pending.promise);
    await mount(subject.kind); await auth("SIGNED_OUT", null);
    pending.resolve(authResult(actorA)); await flush();
    expect(state).toEqual({ data: subject.empty, loading: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("retires pending old-actor RPC data before the next actor resolves", async () => {
    const pending = deferred<{ data: unknown; error: null }>(); rpc.mockReturnValueOnce(pending.promise);
    await mount(subject.kind); actor = actorB;
    await auth("SIGNED_IN", actorB);
    expect(state).toEqual({ data: subject.expected(actorB), loading: false });
    pending.resolve({ data: subject.value(actorA), error: null }); await flush();
    expect(state).toEqual({ data: subject.expected(actorB), loading: false });
    expect(host.textContent).not.toContain(actorA);
  });
  it("does not borrow an Auth callback subject that getUser cannot verify", async () => {
    await mount(subject.kind); rpc.mockClear();
    await auth("SIGNED_IN", actorB); // verified Auth is still A
    expect(state).toEqual({ data: subject.empty, loading: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("withholds the previous presentation while refreshed authority is pending", async () => {
    await mount(subject.kind); const pending = deferred<ReturnType<typeof authResult>>(); getUser.mockReturnValueOnce(pending.promise);
    await auth("TOKEN_REFRESHED", actorA);
    expect(state).toEqual({ data: subject.empty, loading: true });
    pending.resolve(authResult(actorA)); await flush();
    expect(state).toEqual({ data: subject.expected(), loading: false });
  });
  it("focus reload consumes a newly absent or revoked native relationship", async () => {
    await mount(subject.kind); rpc.mockResolvedValue({ data: subject.kind === "brand" ? [] : {}, error: null });
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    expect(state).toEqual({ data: subject.empty, loading: false });
  });
  it("defers SDK calls outside Auth callbacks and cancels queued sign-in after sign-out", async () => {
    await mount(subject.kind); getUser.mockClear(); rpc.mockClear();
    act(() => { listener?.("TOKEN_REFRESHED", { user: { id: actorA } }); expect(getUser).not.toHaveBeenCalled(); listener?.("SIGNED_OUT", null); });
    await flush(); expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    expect(state).toEqual({ data: subject.empty, loading: false });
  });
  it("a legitimate later sign-in can recover after sign-out", async () => {
    await mount(subject.kind); await auth("SIGNED_OUT", null); actor = actorB; await auth("SIGNED_IN", actorB);
    expect(state).toEqual({ data: subject.expected(actorB), loading: false });
  });
  it("removes Auth/focus listeners and ignores late reads after unmount", async () => {
    const pending = deferred<{ data: unknown; error: null }>(); rpc.mockReturnValueOnce(pending.promise);
    await mount(subject.kind); act(() => root.unmount()); mounted = false;
    const calls = getUser.mock.calls.length;
    pending.resolve({ data: subject.value(), error: null }); window.dispatchEvent(new Event("focus")); await flush();
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(getUser).toHaveBeenCalledTimes(calls);
  });
});

it("preserves subtractive configuration normalization without inventing modules", () => {
  expect(normalizePortalConfig({ modules: [null, { key: 3 }, { key: "documents", visible: false, order: 2 }, { key: "tasks", order: Infinity }], welcome: { headline: "Saved", subhead: 3 } })).toEqual({ modules: [{ key: "documents", visible: false, order: 2 }, { key: "tasks" }], welcome: { headline: "Saved" } });
  expect(normalizePortalConfig(null)).toEqual({});
});
