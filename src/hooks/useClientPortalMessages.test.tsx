import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useClientPortalMessages, portalSendFailureCopy, PORTAL_MESSAGES_POLL_MS, type ClientPortalMessagesState } from "./useClientPortalMessages";

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

const T = "e0923000-0000-0000-0000-000000000001";
const msg = (id: string, author: "customer" | "business", at: string, body = `body ${id}`) =>
  ({ id, author, kind: "message", body, created_at: at });

let root: Root, host: HTMLDivElement;
let state: ClientPortalMessagesState;
function Probe() { state = useClientPortalMessages(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const mount = async () => { await act(async () => root.render(<Probe />)); await flush(); };
const conversationCalls = () => f.rpc.mock.calls.filter(c => c[0] === "client_portal_conversation");
const sendCalls = () => f.rpc.mock.calls.filter(c => c[0] === "client_portal_send_message");

beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_conversation"
    ? { data: { tenant_id: T, messages: [msg("b", "business", "2026-10-02T10:00:00Z"), msg("a", "customer", "2026-10-01T10:00:00Z")], has_more: false }, error: null }
    : { data: { ok: true, replayed: false, message_id: "new", created_at: "2026-10-03T10:00:00Z" }, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("loads newest-first rows into chronological order with the server tenant", async () => {
  await mount();
  expect(state.loading).toBe(false);
  expect(state.messages.map(m => m.id)).toEqual(["a", "b"]);
  expect(state.tenantId).toBe(T);
  expect(conversationCalls()[0][1]).toEqual({ p_tenant_id: null, p_before: null, p_limit: 50 });
});

it("reports no relationship honestly when the conversation is null", async () => {
  f.rpc.mockResolvedValue({ data: null, error: null });
  await mount();
  expect(state.unavailable).toBe(true);
  expect(state.messages).toEqual([]);
});

it("surfaces a read failure instead of an empty conversation", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  await mount();
  expect(state.error).toContain("couldn't load");
  expect(state.unavailable).toBe(false);
});

it("sends with a request id and the resolved tenant, shows the confirmed row, then refreshes", async () => {
  await mount();
  let ok = false;
  await act(async () => { ok = await state.send("  Hello there  ", "help"); });
  await flush();
  expect(ok).toBe(true);
  const args = sendCalls()[0][1];
  expect(args).toMatchObject({ p_body: "Hello there", p_kind: "help", p_tenant_id: T });
  expect(args.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.outbox).toEqual([]);
  expect(conversationCalls().length).toBe(2);
});

it("keeps a definite refusal as failed without retry semantics", async () => {
  await mount();
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_send_message"
    ? { data: { ok: false, error: "INVALID_BODY" }, error: null } : { data: null, error: null });
  await act(async () => { await state.send("x", "message"); });
  expect(state.outbox[0]).toMatchObject({ status: "failed", error: "INVALID_BODY" });
});

it("retries an unconfirmed send with the SAME request id and never invents a second message", async () => {
  await mount();
  const conversation = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name: string, a: unknown) => name === "client_portal_send_message"
    ? Promise.reject(new Error("network")) : conversation(name, a));
  await act(async () => { await state.send("Are you there?", "message"); });
  expect(state.outbox[0].status).toBe("unconfirmed");
  const firstId = sendCalls()[0][1].p_request_id;
  f.rpc.mockImplementation(async (name: string, a: unknown) => name === "client_portal_send_message"
    ? { data: { ok: true, replayed: true, message_id: "new", created_at: "2026-10-03T10:00:00Z" }, error: null }
    : { data: { tenant_id: T, messages: [msg("new", "customer", "2026-10-03T10:00:00Z", "Are you there?"), msg("a", "customer", "2026-10-01T10:00:00Z")], has_more: false }, error: null });
  await act(async () => { await state.retry(state.outbox[0].localId); });
  await flush();
  expect(sendCalls()[1][1].p_request_id).toBe(firstId);
  expect(state.outbox).toEqual([]);
  expect(state.messages.filter(m => m.id === "new")).toHaveLength(1);
});

it("pages older messages with p_before and the server's has_more", async () => {
  f.rpc.mockImplementation(async (name: string, a: { p_before: string | null }) => a.p_before
    ? { data: { tenant_id: T, messages: [msg("z", "business", "2026-09-01T10:00:00Z")], has_more: false }, error: null }
    : { data: { tenant_id: T, messages: [msg("a", "customer", "2026-10-01T10:00:00Z")], has_more: true }, error: null });
  await mount();
  expect(state.hasMore).toBe(true);
  await act(async () => { await state.loadMore(); });
  expect(conversationCalls()[1][1]).toMatchObject({ p_before: "2026-10-01T10:00:00Z" });
  expect(state.messages.map(m => m.id)).toEqual(["z", "a"]);
  expect(state.hasMore).toBe(false);
  // A later refresh of the newest page keeps the loaded history.
  await act(async () => { await state.refresh(); });
  expect(state.messages.map(m => m.id)).toEqual(["z", "a"]);
  expect(state.hasMore).toBe(false);
});

it("refreshes on focus and on the visible interval", async () => {
  vi.useFakeTimers();
  await mount();
  const before = conversationCalls().length;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  expect(conversationCalls().length).toBe(before + 1);
  await act(async () => { vi.advanceTimersByTime(PORTAL_MESSAGES_POLL_MS); });
  await flush();
  expect(conversationCalls().length).toBe(before + 2);
});

it("clears the previous customer's thread and outbox when the identity changes", async () => {
  await mount();
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_send_message"
    ? { data: { ok: false, error: "INVALID_BODY" }, error: null }
    : { data: { tenant_id: T, messages: [], has_more: false }, error: null });
  await act(async () => { await state.send("private", "message"); });
  const epoch = state.scopeEpoch;
  await act(async () => { f.authListener!("SIGNED_IN", { user: { id: "u2" } }); });
  await flush();
  expect(state.scopeEpoch).toBeGreaterThan(epoch);
  expect(state.outbox).toEqual([]);
  expect(state.messages).toEqual([]);
});

it("reports an account linked to several businesses as its own state and stops polling", async () => {
  vi.useFakeTimers();
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "select an authorized customer relationship" } });
  await mount();
  expect(state.multipleBusinesses).toBe(true);
  expect(state.error).toBeNull();
  expect(state.unavailable).toBe(false);
  const before = conversationCalls().length;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { vi.advanceTimersByTime(PORTAL_MESSAGES_POLL_MS * 3); });
  await flush();
  expect(conversationCalls().length).toBe(before);
  let ok = true;
  await act(async () => { ok = await state.send("hello", "message"); });
  expect(ok).toBe(false);
  expect(sendCalls()).toHaveLength(0);
});

it("does not mistake a signed-out 42501 for several businesses", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "customer authentication required" } });
  await mount();
  expect(state.multipleBusinesses).toBe(false);
  expect(state.error).toContain("couldn't load");
});

it("treats a 42501 send refusal as definite (not unconfirmed) and halts", async () => {
  await mount();
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_send_message"
    ? { data: null, error: { code: "42501", message: "select an authorized customer relationship" } }
    : { data: { tenant_id: T, messages: [], has_more: false }, error: null });
  await act(async () => { await state.send("Hello", "message"); });
  expect(state.outbox[0]).toMatchObject({ status: "failed", error: "MULTIPLE_RELATIONSHIPS" });
  expect(state.multipleBusinesses).toBe(true);
  expect(portalSendFailureCopy("MULTIPLE_RELATIONSHIPS")).toMatch(/more than one business/);
});

it("keeps a rate-limited send retryable with the same request id and honest copy", async () => {
  await mount();
  const conversation = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name: string, a: unknown) => name === "client_portal_send_message"
    ? { data: { ok: false, error: "RATE_LIMITED" }, error: null } : conversation(name, a));
  await act(async () => { await state.send("one more", "message"); });
  expect(state.outbox[0]).toMatchObject({ status: "failed", error: "RATE_LIMITED" });
  expect(portalSendFailureCopy("RATE_LIMITED")).toBe("You've sent a lot of messages in a short time. Wait a minute, then try again.");
  const firstId = sendCalls()[0][1].p_request_id;
  await act(async () => { await state.retry(state.outbox[0].localId); });
  expect(sendCalls()[1][1].p_request_id).toBe(firstId);
});
