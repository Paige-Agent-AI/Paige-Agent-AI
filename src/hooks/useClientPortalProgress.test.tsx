import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  nextUpWork,
  parseProgressPage,
  PORTAL_PROGRESS_LOAD_ERROR,
  PORTAL_PROGRESS_REFRESH_ERROR,
  usePortalProgressGlance,
  useClientPortalProgress,
  PORTAL_PROGRESS_POLL_MS,
  type ClientPortalProgressState,
  type PortalProgressGlance,
} from "./useClientPortalProgress";

const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => f.rpc(...args),
    auth: {
      getUser: () => f.getUser(),
      onAuthStateChange: (cb: typeof f.authListener) => {
        f.authListener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Synthetic test tenants (Northwind Studio and a second business); never real accounts.
const T = "e0923000-0000-0000-0000-000000000002";
const T2 = "e0923000-0000-0000-0000-000000000009";
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "task", title: "Draft the launch brief", state: "in_progress", due_at: "2026-10-25T17:00:00Z",
  completed_at: null, shared_at: "2026-10-10T12:00:00Z", parent_id: null, ...extra,
});
const payload = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  tenant_id: T, server_now: "2026-10-17T12:00:00Z",
  summary: { shared: items.length, done: 0, open: items.length, overdue: 0 }, items, has_more: false, ...extra,
});
const ok = (data: unknown) => ({ data, error: null });

let root: Root, host: HTMLDivElement;
let state: ClientPortalProgressState;
function Probe() { state = useClientPortalProgress(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const mount = async () => { await act(async () => root.render(<Probe />)); await flush(); };
const reads = () => f.rpc.mock.calls.filter(c => c[0] === "client_portal_progress");

beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  f.rpc.mockResolvedValue(ok(payload([item("i1"), item("i2", { kind: "milestone", state: "not_started" })])));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("reads the caller's shared progress, asking for no tenant on the first read", async () => {
  await mount();
  expect(state.loading).toBe(false);
  expect(state.items.map(i => i.id)).toEqual(["i1", "i2"]);
  expect(state.summary).toEqual({ shared: 2, done: 0, open: 2, overdue: 0 });
  expect(state.tenantId).toBe(T);
  expect(reads()[0][1]).toEqual({ p_tenant_id: null, p_limit: 100 });
});

it("pins the server-resolved tenant on every later read", async () => {
  await mount();
  await act(async () => { await state.refresh(); });
  expect(reads()[1][1]).toEqual({ p_tenant_id: T, p_limit: 100 });
});

it("never shows a later answer for a different business than the one it pinned", async () => {
  await mount();
  f.rpc.mockResolvedValue(ok(payload([item("other")], { tenant_id: T2 })));
  await act(async () => { await state.refresh(); });
  expect(state.items.map(i => i.id)).toEqual(["i1", "i2"]);
  expect(state.tenantId).toBe(T);
  // The pinned list is still on screen, so this is a failed refresh, not a failed load.
  expect(state.error).toBe(PORTAL_PROGRESS_REFRESH_ERROR);
});

it("reports no relationship (null) as unavailable, not as an error", async () => {
  f.rpc.mockResolvedValue(ok(null));
  await mount();
  expect(state.unavailable).toBe(true);
  expect(state.error).toBeNull();
  expect(state.items).toEqual([]);
});

it("reports a second business as its own state and stops asking", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "select an authorized customer relationship" } });
  await mount();
  expect(state.multipleBusinesses).toBe(true);
  expect(state.error).toBeNull();
  const before = reads().length;
  await act(async () => { window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(PORTAL_PROGRESS_POLL_MS * 2); });
  await flush();
  expect(reads()).toHaveLength(before);
});

it("keeps what it had when a refresh fails, and says so", async () => {
  await mount();
  f.rpc.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "network" } });
  await act(async () => { await state.refresh(); });
  expect(state.items.map(i => i.id)).toEqual(["i1", "i2"]);
  // The list is still shown, so the message says it could not be refreshed, not that nothing loaded.
  expect(state.error).toBe(PORTAL_PROGRESS_REFRESH_ERROR);
  f.rpc.mockResolvedValue(ok(payload([item("i1")])));
  await act(async () => { await state.refresh(); });
  expect(state.error).toBeNull();
});

it("a failed first read says nothing loaded, and so does a failure after the list was cleared", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "network" } });
  await mount();
  expect(state.items).toEqual([]);
  expect(state.error).toBe(PORTAL_PROGRESS_LOAD_ERROR);
  // Load, then a null (no relationship) clears the list; a failure after that is a failed load again.
  f.rpc.mockResolvedValue(ok(payload([item("i1")])));
  await act(async () => { await state.refresh(); });
  f.rpc.mockResolvedValue(ok(null));
  await act(async () => { await state.refresh(); });
  f.rpc.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "network" } });
  await act(async () => { await state.refresh(); });
  expect(state.error).toBe(PORTAL_PROGRESS_LOAD_ERROR);
});

it("refuses a row carrying any key outside the allowlist, so a widened projection fails closed", async () => {
  f.rpc.mockResolvedValue(ok(payload([item("i1", { summary: "Internal note: slow to pay" })])));
  await mount();
  expect(state.items).toEqual([]);
  expect(state.error).toMatch(/couldn't load your progress/);
  expect(JSON.stringify(state)).not.toContain("slow to pay");
});

it("refuses widened envelopes and summaries too", () => {
  expect(() => parseProgressPage({ ...payload([]), assigned_to: "staff-1" })).toThrow();
  expect(() => parseProgressPage(payload([], { summary: { shared: 1, done: 0, open: 1, overdue: 0, private: 3 } }))).toThrow();
  expect(() => parseProgressPage(payload([item("i1", { state: "blocked" })]))).toThrow();
  expect(() => parseProgressPage(payload([item("i1"), item("i1")]))).toThrow();
  expect(parseProgressPage(null)).toBeNull();
});

it("refreshes on focus, on becoming visible, and on the poll", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await mount();
  const n = reads().length;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { vi.advanceTimersByTime(PORTAL_PROGRESS_POLL_MS); });
  await flush();
  expect(reads().length).toBe(n + 3);
});

it("drops everything and re-reads with no pinned tenant when the signed-in person changes", async () => {
  await mount();
  const epoch = state.scopeEpoch;
  f.rpc.mockResolvedValue(ok(payload([item("j1")], { tenant_id: T2 })));
  await act(async () => { f.authListener!("SIGNED_IN", { user: { id: "u2" } }); });
  await flush();
  expect(state.scopeEpoch).toBe(epoch + 1);
  expect(reads().at(-1)![1]).toEqual({ p_tenant_id: null, p_limit: 100 });
  expect(state.items.map(i => i.id)).toEqual(["j1"]);
  expect(state.tenantId).toBe(T2);
});

it("signing out leaves nothing on screen", async () => {
  await mount();
  await act(async () => { f.authListener!("SIGNED_OUT", null); });
  await flush();
  expect(state.items).toEqual([]);
  expect(state.unavailable).toBe(true);
});

let glance: PortalProgressGlance;
function GlanceProbe({ enabled }: { enabled: boolean }) { glance = usePortalProgressGlance(enabled); return null; }

it("the home glance reads the summary with a one-item page, and does not read at all when disabled", async () => {
  f.rpc.mockResolvedValue(ok(payload([item("i1")], { summary: { shared: 5, done: 2, open: 3, overdue: 1 } })));
  await act(async () => root.render(<GlanceProbe enabled />));
  await flush();
  expect(reads()[0][1]).toEqual({ p_tenant_id: null, p_limit: 1 });
  expect(glance).toEqual({
    state: "ready", summary: { shared: 5, done: 2, open: 3, overdue: 1 },
    next: { ...item("i1"), title: "Draft the launch brief" },
  });
  vi.clearAllMocks();
  await act(async () => root.render(<GlanceProbe enabled={false} />));
  await flush();
  expect(reads()).toHaveLength(0);
  expect(glance).toEqual({ state: "unavailable" });
});

it("the home glance says error for a failed read, never a zero", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "network" } });
  await act(async () => root.render(<GlanceProbe enabled />));
  await flush();
  expect(glance).toEqual({ state: "error" });
});

it("the home glance names no next item when the first one is finished or has no due date", async () => {
  f.rpc.mockResolvedValue(ok(payload([item("d1", { state: "done", completed_at: "2026-10-16T12:00:00Z" })])));
  await act(async () => root.render(<GlanceProbe enabled />));
  await flush();
  expect(glance).toMatchObject({ state: "ready", next: null });
  await act(async () => root.unmount());
  root = createRoot(host);
  f.rpc.mockResolvedValue(ok(payload([item("u1", { due_at: null })])));
  await act(async () => root.render(<GlanceProbe enabled />));
  await flush();
  expect(glance).toMatchObject({ state: "ready", next: null });
});

it("next up is past due first, then today, then soonest; at most three; never undated or finished work", () => {
  const now = Date.now();
  const at = (ms: number) => new Date(now + ms).toISOString();
  const H = 3_600_000;
  const picked = nextUpWork([
    item("later", { due_at: at(9 * 24 * H) }),
    item("undated", { due_at: null }),
    item("today", { due_at: at(H) }),
    item("finished", { state: "done", due_at: at(-48 * H), completed_at: at(-H) }),
    item("late", { due_at: at(-24 * H) }),
    item("soon", { due_at: at(3 * 24 * H) }),
  ] as Parameters<typeof nextUpWork>[0]);
  expect(picked.map(i => i.id)).toEqual(["late", "today", "soon"]);
});
