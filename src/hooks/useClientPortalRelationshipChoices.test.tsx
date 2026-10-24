import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, expect, it, vi} from "vitest";
import type {ClientPortalRelationshipPage} from "@/lib/client-portal-relationships";
const f = vi.hoisted(() => ({fetch: vi.fn(), listeners: [] as ((event: string, session: {user: {id: string}} | null) => void)[]}));
vi.mock("@/lib/client-portal-relationships", () => ({fetchClientPortalRelationshipChoices: (...args: unknown[]) => f.fetch(...args)}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {auth: {onAuthStateChange: (cb: typeof f.listeners[number]) => {
  f.listeners.push(cb); return {data: {subscription: {unsubscribe: vi.fn()}}};
}}}}));
import {useClientPortalRelationshipChoices} from "./useClientPortalRelationshipChoices";
const a = "e0915000-0000-0000-0000-000000000001", b = "e0915000-0000-0000-0000-000000000002";
const row = (client = a, tenant = a) => ({clientId: client, tenantId: tenant, businessName: "Test Studio", logoUrl: null, logoDarkUrl: null});
const page = (rows = [row()], more = false): ClientPortalRelationshipPage => ({actorId: a, relationships: rows, hasMore: more, nextAfter: more ? rows.at(-1)!.clientId : null});
let state: ReturnType<typeof useClientPortalRelationshipChoices>, root: Root, host: HTMLDivElement;
function Probe({actor = a}: {actor?: string}) {state = useClientPortalRelationshipChoices(actor); return <output>{state.actor}:{state.phase}:{state.rows.map(r => r.clientId).join(",")}</output>;}
function deferred<T>() {let resolve!: (v: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};}
const flush = () => act(async () => {for (let i = 0; i < 20; i++) await Promise.resolve();});
beforeEach(() => {vi.clearAllMocks(); f.listeners = []; f.fetch.mockResolvedValue(page()); host = document.createElement("div"); document.body.append(host); root = createRoot(host);});
afterEach(() => {act(() => root.unmount()); host.remove(); vi.useRealTimers();});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("reads original choices and clears them before focus revalidation", async () => {
  await act(async () => root.render(<Probe/>)); await flush(); expect(state.phase).toBe("ready");
  const next = deferred<ClientPortalRelationshipPage>(); f.fetch.mockReturnValue(next.promise);
  act(() => window.dispatchEvent(new Event("focus"))); expect(state.rows).toEqual([]); expect(state.phase).toBe("loading");
  next.resolve(page([])); await flush(); expect(state.phase).toBe("ready"); expect(state.rows).toEqual([]);
});
it("retires late prior-actor requests and old Auth listeners", async () => {
  const old = deferred<ClientPortalRelationshipPage>(); f.fetch.mockReturnValueOnce(old.promise).mockResolvedValue({...page([row(b)]), actorId: b});
  await act(async () => root.render(<Probe/>)); const listener = f.listeners[0];
  await act(async () => root.render(<Probe actor={b}/>)); await flush(); expect(state.rows[0].clientId).toBe(b);
  act(() => listener("SIGNED_OUT", null)); old.resolve(page()); await flush(); expect(state.actor).toBe(b); expect(state.rows[0].clientId).toBe(b);
});
it("aborts on sign-out and withholds even a late successful read", async () => {
  const next = deferred<ClientPortalRelationshipPage>(); f.fetch.mockReturnValue(next.promise);
  await act(async () => root.render(<Probe/>)); const signal = f.fetch.mock.calls[0][1].signal;
  act(() => f.listeners[0]("SIGNED_OUT", null)); expect(signal.aborted).toBe(true); next.resolve(page()); await flush();
  expect(state.phase).toBe("error"); expect(state.rows).toEqual([]);
});
it("paginates once, focuses only the first new identity, and refuses cross-page duplicates", async () => {
  f.fetch.mockResolvedValueOnce(page([row()], true)).mockResolvedValueOnce(page([row(b, b)], false));
  await act(async () => root.render(<Probe/>)); await flush();
  await act(async () => {void state.loadMore(); void state.loadMore();}); await flush();
  expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.fetch.mock.calls[1][1].after).toBe(a); expect(state.rows).toHaveLength(2); expect(state.addedId).toBe(b);
  f.fetch.mockResolvedValueOnce(page([row()], true)); await act(async () => {void state.reload();}); await flush();
  f.fetch.mockResolvedValueOnce(page([row(b, a)])); await act(async () => {void state.loadMore();}); await flush();
  expect(state.phase).toBe("error"); expect(state.rows).toEqual([]);
});
it("has a real deadline even when the native/Auth reader never settles, then can retry", async () => {
  vi.useFakeTimers(); f.fetch.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(page());
  await act(async () => root.render(<Probe/>)); await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(state.phase).toBe("error"); expect(f.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {void state.reload();}); await flush(); expect(state.phase).toBe("ready");
});
it("cached-page return revalidates choices and retires the previous list", async () => {
  await act(async () => root.render(<Probe/>)); await flush();
  const next = deferred<ClientPortalRelationshipPage>(); f.fetch.mockReturnValue(next.promise);
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}))); expect(state.phase).toBe("loading"); expect(state.rows).toEqual([]);
  next.resolve(page([])); await flush(); expect(state.rows).toEqual([]); expect(state.phase).toBe("ready");
});
