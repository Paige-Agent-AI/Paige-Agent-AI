import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fetchRescheduleSlots,
  portalSessionChangeCopy,
  refusalWayOut,
  sessionTiming,
  useClientPortalSessions,
  useNextPortalSession,
  PORTAL_SESSIONS_POLL_MS,
  type ClientPortalSessionsState,
  type NextPortalSession,
  type PortalSession,
} from "./useClientPortalSessions";

const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  getUser: vi.fn(),
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => f.rpc(...args),
    functions: { invoke: (...args: unknown[]) => f.invoke(...args) },
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

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0923000-0000-0000-0000-000000000002";
const raw = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id, title: "Strategy call", start_at: start, end_at: new Date(Date.parse(start) + 3_600_000).toISOString(),
  timezone: "America/New_York", status: "scheduled", kind: "single",
  location: { type: "zoom", label: "Zoom", join_url: "https://zoom.example.test/j/1" },
  calendar: { slug: "northwind-strategy", duration_min: 60, appointment_type_id: "type-60", accent: null },
  change: { can_cancel: true, can_reschedule: true, deadline: new Date(Date.parse(start) - 3_600_000).toISOString(), reason: null },
  ...extra,
});
const page = (sessions: unknown[], next_before: string | null = null) =>
  ({ data: { tenant_id: T, server_now: "2026-10-17T12:00:00Z", sessions, next_before }, error: null });
/** A non-2xx edge answer: supabase-js puts the body on the error's Response. */
const httpError = (status: number, body: unknown) =>
  ({ data: null, error: { name: "FunctionsHttpError", context: { status, json: async () => body } } });

let root: Root, host: HTMLDivElement;
let state: ClientPortalSessionsState;
function Probe() { state = useClientPortalSessions(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const mount = async () => { await act(async () => root.render(<Probe />)); await flush(); };
const readCalls = () => f.rpc.mock.calls.filter(c => c[0] === "client_portal_sessions");
const engineCalls = () => f.invoke.mock.calls.filter(c => c[0] === "booking-manage");

beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  f.rpc.mockImplementation(async (_n: string, a: { p_window: string }) =>
    a.p_window === "past" ? page([raw("p1", "2026-09-01T15:00:00Z", { status: "done" })]) : page([raw("s2", "2026-10-25T15:00:00Z"), raw("s1", "2026-10-20T15:00:00Z")]));
  f.invoke.mockResolvedValue({ data: { ok: true, status: "cancelled" }, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("reads upcoming sessions soonest first with the server tenant, asking for no tenant on the first read", async () => {
  await mount();
  expect(state.loading).toBe(false);
  expect(state.upcoming.map(s => s.id)).toEqual(["s1", "s2"]);
  expect(state.tenantId).toBe(T);
  expect(readCalls()[0][1]).toEqual({ p_tenant_id: null, p_window: "upcoming", p_before: null, p_limit: 20 });
  // Past sessions are not read until asked for.
  expect(readCalls().some(c => c[1].p_window === "past")).toBe(false);
});

it("pins the server-resolved tenant on every later read", async () => {
  await mount();
  await act(async () => { await state.refresh(); });
  expect(readCalls()[1][1].p_tenant_id).toBe(T);
  await act(async () => { await state.loadPast(); });
  expect(readCalls().find(c => c[1].p_window === "past")![1]).toEqual({ p_tenant_id: T, p_window: "past", p_before: null, p_limit: 20 });
  expect(state.past.map(s => s.id)).toEqual(["p1"]);
});

it("reports no relationship honestly when the read is null", async () => {
  f.rpc.mockResolvedValue({ data: null, error: null });
  await mount();
  expect(state.unavailable).toBe(true);
  expect(state.upcoming).toEqual([]);
});

it("reports more than one business as its own state and stops polling", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "select an authorized customer relationship" } });
  await mount();
  expect(state.multipleBusinesses).toBe(true);
  expect(state.error).toBeNull();
  const before = readCalls().length;
  await act(async () => { vi.advanceTimersByTime(PORTAL_SESSIONS_POLL_MS * 2); });
  await flush();
  expect(readCalls().length).toBe(before);
});

it("keeps loaded sessions on a failed refresh and says the read failed", async () => {
  await mount();
  f.rpc.mockResolvedValue({ data: null, error: { message: "network" } });
  await act(async () => { await state.refresh(); });
  expect(state.error).toContain("couldn't load");
  expect(state.upcoming.map(s => s.id)).toEqual(["s1", "s2"]);
});

it("polls on a 60-second interval while visible", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await mount();
  const before = readCalls().length;
  await act(async () => { vi.advanceTimersByTime(PORTAL_SESSIONS_POLL_MS); });
  await flush();
  expect(readCalls().length).toBe(before + 1);
});

it("never offers a non-https join link", async () => {
  f.rpc.mockResolvedValue(page([raw("s1", "2026-10-20T15:00:00Z", { location: { type: "custom", label: "Room 4", join_url: "javascript:alert(1)" } })]));
  await mount();
  expect(state.upcoming[0].location.join_url).toBeNull();
});

it("reads the location kind from the server, inside location or top level, and treats anything else as not said", async () => {
  f.rpc.mockResolvedValue(page([
    raw("s1", "2026-10-20T15:00:00Z", { location: { type: "zoom", label: "Zoom", join_url: null, kind: "video" } }),
    raw("s2", "2026-10-21T15:00:00Z", { location_kind: "in_person", location: { type: "in_person", label: "In person", join_url: null } }),
    raw("s3", "2026-10-22T15:00:00Z", { location: { type: "phone", label: "Phone call", join_url: null, kind: "carrier-pigeon" } }),
    raw("s4", "2026-10-23T15:00:00Z"),
  ]));
  await mount();
  expect(state.upcoming.map(s => s.location.kind)).toEqual(["video", "in_person", null, null]);
});

it("holds a refusal whose way out is a message until a fresh read of the list lands", async () => {
  await mount();
  // Not one of the refusals that re-read on their own: the hold lasts until the next read.
  f.invoke.mockResolvedValue(httpError(409, { ok: false, code: "COMMS_PROVIDER_EXECUTION_DISABLED" }));
  await act(async () => { await state.cancel("s1"); });
  await flush();
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "COMMS_PROVIDER_EXECUTION_DISABLED", actionsHeld: true });
  expect(readCalls().length).toBe(1);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  expect(readCalls().length).toBe(2);
  // The reason stays until dismissed; only the hold on the session's own actions is lifted.
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "COMMS_PROVIDER_EXECUTION_DISABLED", actionsHeld: false });
});

it("a read already in flight when the refusal came does not lift the hold", async () => {
  await mount();
  let land!: () => void;
  f.rpc.mockImplementationOnce(() => new Promise((resolve) => { land = () => resolve(page([raw("s1", "2026-10-20T15:00:00Z")])); }));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  f.invoke.mockResolvedValue(httpError(409, { ok: false, code: "COMMS_PROVIDER_EXECUTION_DISABLED" }));
  await act(async () => { await state.cancel("s1"); });
  await act(async () => { land(); });
  await flush();
  expect(readCalls().length).toBe(2);
  expect(state.changes.s1.actionsHeld).toBe(true);
});

it("does not hold the actions for a refusal the customer can retry or re-pick", async () => {
  await mount();
  f.invoke.mockResolvedValueOnce(httpError(429, { ok: false, code: "RATE_LIMITED" }));
  await act(async () => { await state.cancel("s1"); });
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "RATE_LIMITED", actionsHeld: false });
  f.invoke.mockResolvedValueOnce(httpError(409, { ok: false, code: "SLOT_UNAVAILABLE" }));
  await act(async () => { await state.reschedule("s2", "2026-10-21T16:00:00Z"); });
  expect(state.changes.s2).toMatchObject({ status: "failed", error: "SLOT_UNAVAILABLE", actionsHeld: false });
});

it("names the way out of each refusal", () => {
  expect(refusalWayOut("RATE_LIMITED")).toBe("retry");
  expect(refusalWayOut("SLOT_UNAVAILABLE")).toBe("pick");
  for (const c of ["SESSION_CHANGE_UNAVAILABLE", "SESSION_CHANGE_WINDOW_CLOSED", "COMMS_PROVIDER_EXECUTION_DISABLED", "SESSION_NOT_FOUND", "SESSION_NOT_CHANGEABLE"]) {
    expect(refusalWayOut(c)).toBe("message");
  }
  for (const c of ["AUTH_REQUIRED", "REQUEST_ID_CONFLICT", "NEW_TIME_REQUIRED", "SOMETHING_NEW", null]) expect(refusalWayOut(c)).toBe("again");
});

it("cancels through booking-manage in customer mode with a request id and the pinned tenant", async () => {
  await mount();
  let ok = false;
  await act(async () => { ok = await state.cancel("s1"); });
  await flush();
  expect(ok).toBe(true);
  const [, { body }] = engineCalls()[0];
  expect(body).toMatchObject({ mode: "customer", action: "cancel", booking_id: "s1", tenant_id: T });
  expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(body).not.toHaveProperty("token");
  expect(body).not.toHaveProperty("start");
  expect(state.changes).toEqual({});
  // The list is re-read after a confirmed change.
  expect(readCalls().length).toBe(2);
});

it("reschedules with the new start as an ISO instant", async () => {
  await mount();
  await act(async () => { await state.reschedule("s1", "2026-10-21T16:00:00.000Z"); });
  const [, { body }] = engineCalls()[0];
  expect(body).toMatchObject({ mode: "customer", action: "reschedule", booking_id: "s1", start: "2026-10-21T16:00:00.000Z" });
});

it("treats a definite refusal as failed, with the engine's code, and re-reads the server's view", async () => {
  await mount();
  f.invoke.mockResolvedValue(httpError(409, { ok: false, code: "SESSION_CHANGE_WINDOW_CLOSED", error: "Changes to this session have closed." }));
  let ok = true;
  await act(async () => { ok = await state.cancel("s1"); });
  await flush();
  expect(ok).toBe(false);
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "SESSION_CHANGE_WINDOW_CLOSED", action: "cancel" });
  expect(readCalls().length).toBe(2);
});

it("retries an unknown outcome with the SAME request id, and a later new change gets a new one", async () => {
  await mount();
  f.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Failed to fetch" } });
  await act(async () => { await state.cancel("s1"); });
  expect(state.changes.s1.status).toBe("unconfirmed");
  const firstId = engineCalls()[0][1].body.request_id;
  // A 5xx may have come after the write: still unknown, still the same id.
  f.invoke.mockResolvedValueOnce(httpError(500, { error: "boom" }));
  await act(async () => { await state.retryChange("s1"); });
  expect(state.changes.s1.status).toBe("unconfirmed");
  expect(engineCalls()[1][1].body.request_id).toBe(firstId);
  // Asking the same cancel again while unknown also reuses the id.
  f.invoke.mockResolvedValueOnce({ data: { ok: true, replay: true }, error: null });
  await act(async () => { await state.cancel("s1"); });
  await flush();
  expect(engineCalls()[2][1].body.request_id).toBe(firstId);
  expect(state.changes).toEqual({});
  // A fresh change after that is a new request.
  await act(async () => { await state.cancel("s2"); });
  expect(engineCalls()[3][1].body.request_id).not.toBe(firstId);
});

it("does not reuse an unknown cancel's id for a reschedule of the same session", async () => {
  await mount();
  f.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError" } });
  await act(async () => { await state.cancel("s1"); });
  await act(async () => { await state.reschedule("s1", "2026-10-21T16:00:00Z"); });
  expect(engineCalls()[1][1].body.request_id).not.toBe(engineCalls()[0][1].body.request_id);
});

it("halts for more than one business when the engine says so", async () => {
  await mount();
  f.invoke.mockResolvedValue(httpError(409, { ok: false, code: "MULTIPLE_RELATIONSHIPS" }));
  await act(async () => { await state.cancel("s1"); });
  expect(state.multipleBusinesses).toBe(true);
  expect(state.upcoming).toEqual([]);
});

it("resets everything on a change of signed-in identity and re-reads without the old tenant", async () => {
  await mount();
  f.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError" } });
  await act(async () => { await state.cancel("s1"); });
  expect(state.changes.s1).toBeDefined();
  const epoch = state.scopeEpoch;
  await act(async () => { f.authListener!("SIGNED_IN", { user: { id: "u2" } }); });
  await flush();
  expect(state.scopeEpoch).toBe(epoch + 1);
  expect(state.changes).toEqual({});
  expect(readCalls().at(-1)![1].p_tenant_id).toBeNull();
});

it("ignores a read that started before the identity changed", async () => {
  await mount();
  let release: (v: unknown) => void = () => {};
  f.rpc.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  const pending = act(async () => { await state.refresh(); });
  await act(async () => { f.authListener!("SIGNED_OUT", null); });
  release(page([raw("old", "2026-10-22T15:00:00Z")]));
  await pending;
  await flush();
  expect(state.upcoming).toEqual([]);
  expect(state.unavailable).toBe(true);
});

it("maps refusal codes to customer copy and never shows an unknown code raw", () => {
  expect(portalSessionChangeCopy("SLOT_UNAVAILABLE")).toMatch(/just taken/);
  expect(portalSessionChangeCopy("SESSION_CHANGE_WINDOW_CLOSED")).toMatch(/closed/);
  expect(portalSessionChangeCopy("COMMS_PROVIDER_EXECUTION_DISABLED")).not.toMatch(/COMMS|PROVIDER/);
  expect(portalSessionChangeCopy("SOMETHING_ELSE")).toBe("This session wasn't changed. Try again.");
  expect(portalSessionChangeCopy(null)).toBe("This session wasn't changed. Try again.");
});

it("asks the booking page's availability for the booked service and never offers the current start", async () => {
  const session = { ...raw("s1", "2026-10-20T15:00:00Z") } as unknown as PortalSession;
  f.invoke.mockResolvedValue({ data: { slots: ["2026-10-21T16:00:00.000Z", "2026-10-20T15:00:00.000Z", "2026-10-21T15:00:00.000Z"], timezone: "America/New_York" }, error: null });
  const result = await fetchRescheduleSlots(session);
  expect(f.invoke).toHaveBeenCalledWith("public-booking", { body: { action: "availability", slug: "northwind-strategy", appointmentTypeId: "type-60" } });
  expect(result.slots).toEqual(["2026-10-21T15:00:00.000Z", "2026-10-21T16:00:00.000Z"]);
});

it("useNextPortalSession reads one upcoming session, and nothing when disabled", async () => {
  let next: NextPortalSession = { state: "loading" };
  function NextProbe({ on }: { on: boolean }) { next = useNextPortalSession(on); return null; }
  f.rpc.mockResolvedValue(page([raw("s1", "2026-10-20T15:00:00Z")]));
  await act(async () => root.render(<NextProbe on />));
  await flush();
  expect(next.state).toBe("session");
  expect(readCalls()[0][1]).toEqual({ p_tenant_id: null, p_window: "upcoming", p_before: null, p_limit: 1 });
  f.rpc.mockClear();
  await act(async () => root.render(<NextProbe on={false} />));
  await flush();
  expect(next.state).toBe("unavailable");
  expect(readCalls()).toHaveLength(0);
});

it("a taken time (409 SLOT_UNAVAILABLE) is a refusal, never success, and the list is re-read", async () => {
  await mount();
  f.invoke.mockResolvedValue(httpError(409, { ok: false, code: "SLOT_UNAVAILABLE", error: "That time was just taken." }));
  let ok = true;
  await act(async () => { ok = await state.reschedule("s1", "2026-10-21T16:00:00Z"); });
  await flush();
  expect(ok).toBe(false);
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "SLOT_UNAVAILABLE", action: "reschedule", actionsHeld: false });
  expect(readCalls().length).toBe(2);
});

it("a session cancelled or completed elsewhere (409 SESSION_NOT_CHANGEABLE) is a refusal and re-reads", async () => {
  await mount();
  f.invoke.mockResolvedValue(httpError(409, { ok: false, code: "SESSION_NOT_CHANGEABLE" }));
  let ok = true;
  await act(async () => { ok = await state.reschedule("s1", "2026-10-21T16:00:00Z"); });
  await flush();
  expect(ok).toBe(false);
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "SESSION_NOT_CHANGEABLE" });
  expect(portalSessionChangeCopy(state.changes.s1.error)).toMatch(/already been cancelled or completed/);
  expect(readCalls().length).toBe(2);
});

it("a session moved elsewhere (409 with current_start) says it moved, never 'cancelled' or 'taken', and re-reads", async () => {
  await mount();
  const moved = { current_start: "2026-10-22T15:00:00.000Z" };
  f.invoke.mockResolvedValueOnce(httpError(409, { ok: false, code: "SESSION_NOT_CHANGEABLE", ...moved }));
  await act(async () => { await state.cancel("s1"); });
  await flush();
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "SESSION_MOVED", actionsHeld: false });
  expect(portalSessionChangeCopy("SESSION_MOVED")).toMatch(/was moved before your change went through, so nothing was changed/);
  expect(refusalWayOut("SESSION_MOVED")).toBe("again");
  expect(readCalls().length).toBe(2);
  f.invoke.mockResolvedValueOnce(httpError(409, { ok: false, code: "SLOT_UNAVAILABLE", ...moved }));
  await act(async () => { await state.reschedule("s2", "2026-10-21T16:00:00Z"); });
  await flush();
  expect(state.changes.s2).toMatchObject({ status: "failed", error: "SESSION_MOVED" });
  expect(readCalls().length).toBe(3);
});

it("a 200 with ok:false is a refusal too, never success", async () => {
  await mount();
  f.invoke.mockResolvedValueOnce({ data: { ok: false, code: "SLOT_UNAVAILABLE" }, error: null });
  let ok = true;
  await act(async () => { ok = await state.reschedule("s1", "2026-10-21T16:00:00Z"); });
  expect(ok).toBe(false);
  expect(state.changes.s1).toMatchObject({ status: "failed", error: "SLOT_UNAVAILABLE" });
});

it("a 200 replay of this same request is still success, and re-reads", async () => {
  await mount();
  f.invoke.mockResolvedValueOnce({ data: { ok: true, replay: true }, error: null });
  let ok = false;
  await act(async () => { ok = await state.reschedule("s1", "2026-10-21T16:00:00Z"); });
  await flush();
  expect(ok).toBe(true);
  expect(state.changes).toEqual({});
  expect(readCalls().length).toBe(2);
});

it("words how near a session is: now, today with time left, tomorrow, ended, and nothing later", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const at = (startMin: number, lenMin = 60) => ({
    start_at: new Date(now + startMin * 60_000).toISOString(), end_at: new Date(now + (startMin + lenMin) * 60_000).toISOString(),
  });
  expect(sessionTiming(at(-10), now, "UTC")).toEqual({ label: "Happening now", tone: "live" });
  expect(sessionTiming(at(45), now, "UTC")).toEqual({ label: "Today · in 45 min", tone: "plain" });
  expect(sessionTiming(at(3 * 60 + 10), now, "UTC")?.label).toBe("Today · in 3 hrs");
  expect(sessionTiming(at(24 * 60), now, "UTC")).toEqual({ label: "Tomorrow", tone: "plain" });
  expect(sessionTiming(at(-120), now, "UTC")?.label).toBe("Ended");
  expect(sessionTiming(at(5 * 24 * 60), now, "UTC")).toBeNull();
  // The day is the viewer's: 11 PM in Tokyo is already tomorrow there.
  expect(sessionTiming(at(14 * 60), now, "Asia/Tokyo")?.label).toBe("Tomorrow");
});
