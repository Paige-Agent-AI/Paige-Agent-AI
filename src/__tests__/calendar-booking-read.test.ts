import { afterEach, describe, expect, it, vi } from "vitest";
import { readCalendarBooking, type CalendarBookingReadCaller } from "../../supabase/functions/_shared/calendar-booking-read";
import type { ContextIdentity } from "../../supabase/functions/_shared/paige-context/mod";
import { createClient } from "@supabase/supabase-js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity: ContextIdentity = { actorId: id(1), tenantId: id(2), workspaceId: id(2), role: "owner", accountShape: "solo", actAsClientId: null, scopeEpoch: 1 };
const record = () => ({ id: id(3), tenant_id: id(2), calendar_id: id(4), host_user_id: id(1), contact_id: null,
  title: "Neutral meeting", start_at: "2026-10-17T16:00:00+00:00", end_at: "2026-10-17T16:30:00+00:00", timezone: "UTC", status: "scheduled", booking_kind: "single", guest_name: null });
type Response = { data: unknown; error: unknown };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  let current: ContextIdentity | null = { ...identity };
  const calls: { name: string; args: unknown; operations: unknown[]; signal?: AbortSignal }[] = [];
  const pending: Partial<Record<string, PromiseLike<Response>>> = {};
  const responses: Record<string, Response> = { current_user_tenant_id: { data: id(2), error: null }, list_team_bookings: { data: [record()], error: null }, is_tenant_member: { data: true, error: null }, is_tenant_admin: { data: true, error: null } };
  const user = vi.fn(() => Promise.resolve({ data: { user: { id: id(1) } }, error: null }));
  const caller = { auth: { getUser: user }, rpc(name: string, args?: unknown) {
    const call = { name, args, operations: [] as unknown[], signal: undefined as AbortSignal | undefined }; calls.push(call);
    const query = {
      select(value: string) { call.operations.push(["select", value]); return query; },
      eq(key: string, value: unknown) { call.operations.push(["eq", key, value]); return query; },
      limit(value: number) { call.operations.push(["limit", value]); return query; },
      abortSignal(signal: AbortSignal) { call.signal = signal; return query; },
      then<TResult1 = Response, TResult2 = never>(resolve?: ((r: Response) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((e: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
        return Promise.resolve(pending[name] ?? responses[name]).then(resolve, reject);
      },
    }; return query;
  } };
  const deps = { caller, currentIdentity: () => current };
  return { calls, responses, pending, user, deps, switchTo(value: ContextIdentity | null) { current = value; }, read(args: unknown = { booking_id: id(3) }) { return readCalendarBooking(identity, deps, args); } };
}
afterEach(() => { vi.useRealTimers(); });

describe("canonical exact Calendar booking reader", () => {
  it("reads the one canonical record with original caller JWT and exact bounded native query", async () => {
    const f = fixture(); const result = await f.read();
    expect(result).toMatchObject({ status: "available", found: true, booking: record() });
    const read = f.calls.filter(c => c.name === "list_team_bookings"); expect(read).toHaveLength(1);
    expect(read[0].args).toEqual({ _from: "-infinity", _to: "infinity", _host_ids: null, _tenant_id: id(2), _booking_id: id(3) });
    expect(read[0].operations).toEqual([["select", Object.keys(record()).join(",")], ["eq", "id", id(3)], ["limit", 2]]);
    expect(read[0].signal).toBeInstanceOf(AbortSignal); expect(f.user).toHaveBeenCalledTimes(2);
  });
  it("returns authorized not-found without a global absence or successful action claim", async () => {
    const f = fixture(); f.responses.list_team_bookings.data = [];
    expect(await f.read()).toMatchObject({ status: "available", found: false });
  });
  it("keeps unknown calendar/contact/guest null instead of inventing readiness", async () => {
    const f = fixture(); f.responses.list_team_bookings.data = [{ ...record(), calendar_id: null }];
    expect(await f.read()).toMatchObject({ status: "available", booking: { calendar_id: null, contact_id: null, guest_name: null } });
  });
  it("projects no notes, intake answers, credentials, profile data or model-authored URLs", async () => {
    const f = fixture(); f.responses.list_team_bookings.data = [{ ...record(), notes: "private", intake_answers: { secret: true }, meeting_link: "https://untrusted.invalid", host_full_name: "hidden" }];
    const result = await f.read(); expect(result).toMatchObject({ status: "available", booking: record() });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|untrusted|hidden|meeting_link/);
  });
  for (const args of [null, [], {}, { booking_id: "wrong" }, { booking_id: id(3), tenant_id: id(9) }, { booking_id: id(3), actor: id(1) }, { booking_id: id(3), from: "2026-01-01" }]) {
    it("refuses malformed or authority-bearing arguments without a request: " + JSON.stringify(args), async () => {
      const f = fixture(); expect(await f.read(args)).toMatchObject({ status: "needs_input" }); expect(f.calls).toEqual([]); expect(f.user).not.toHaveBeenCalled();
    });
  }
  for (const [label, change] of Object.entries({ actor: { actorId: id(9) }, tenant: { tenantId: id(9) }, workspace: { workspaceId: id(9) }, epoch: { scopeEpoch: 2 }, role: { role: "member" }, shape: { accountShape: "operator" as const }, client: { actAsClientId: id(9) } })) {
    it("refuses current " + label + " mismatch before dispatch", async () => { const f = fixture(); f.switchTo({ ...identity, ...change }); expect(await f.read()).toMatchObject({ status: "refused" }); expect(f.calls).toEqual([]); });
  }
  for (const [label, data] of Object.entries({ null: null, object: record(), duplicate: [record(), record()], wrongId: [{ ...record(), id: id(9) }], foreign: [{ ...record(), tenant_id: id(9) }], missingField: [{ ...record(), title: undefined }], malformedDate: [{ ...record(), start_at: "yesterday" }], reversedTime: [{ ...record(), end_at: "2026-10-17T15:00:00Z" }], oversized: [{ ...record(), title: "x".repeat(2049) }], invalidKind: [{ ...record(), booking_kind: "external" }] })) {
    it("does not expose malformed native " + label + " result", async () => { const f = fixture(); f.responses.list_team_bookings.data = data; const result = await f.read(); expect(result).toMatchObject({ status: "unavailable" }); expect(result).not.toHaveProperty("booking"); expect(result).not.toHaveProperty("found"); });
  }
  for (const name of ["current_user_tenant_id", "list_team_bookings", "is_tenant_member"]) {
    it("settles " + name + " error without false absence or retry", async () => { const f = fixture(); f.responses[name] = { data: null, error: { code: "XX000" } }; expect(await f.read()).toMatchObject({ status: "unavailable" }); expect(f.calls.filter(c => c.name === "list_team_bookings").length).toBeLessThanOrEqual(1); });
  }
  it("native denial remains refused", async () => { const f = fixture(); f.responses.list_team_bookings = { data: null, error: { code: "42501" } }; expect(await f.read()).toMatchObject({ status: "refused" }); });
  it("wrong authenticated actor never starts booking lookup", async () => { const f = fixture(); f.user.mockResolvedValue({ data: { user: { id: id(9) } }, error: null }); expect(await f.read()).toMatchObject({ status: "refused" }); expect(f.calls).toEqual([]); });
  it("server-resolved tenant mismatch never starts booking lookup", async () => { const f = fixture(); f.responses.current_user_tenant_id.data = id(9); expect(await f.read()).toMatchObject({ status: "refused" }); expect(f.calls.some(c => c.name === "list_team_bookings")).toBe(false); });
  it("withdrawn active membership suppresses an otherwise valid read", async () => { const f = fixture(); f.responses.is_tenant_member.data = false; expect(await f.read()).toMatchObject({ status: "refused" }); });
  it("a current non-admin cannot receive another host after a role change", async () => { const f = fixture(); f.responses.list_team_bookings.data = [{ ...record(), host_user_id: id(9) }]; f.responses.is_tenant_admin.data = false; expect(await f.read()).toMatchObject({ status: "refused" }); });
  it("a current owner/admin can receive an authorized other-host record", async () => { const f = fixture(); f.responses.list_team_bookings.data = [{ ...record(), host_user_id: id(9) }]; expect(await f.read()).toMatchObject({ status: "available", found: true }); });
  it("bounds deferred authentication and cannot later start any RPC", async () => {
    vi.useFakeTimers(); const f = fixture(); const slow = deferred<Awaited<ReturnType<typeof f.user>>>(); f.user.mockReturnValue(slow.promise);
    const result = f.read(); await vi.advanceTimersByTimeAsync(8001); expect(await result).toMatchObject({ status: "unavailable" });
    slow.resolve({ data: { user: { id: id(1) } }, error: null }); await vi.runAllTimersAsync(); expect(f.calls).toEqual([]);
  });
  it("aborts a timed-out native read and discards its later valid row without retry", async () => {
    vi.useFakeTimers(); const f = fixture(); const slow = deferred<Response>(); f.pending.list_team_bookings = slow.promise;
    const result = f.read(); await vi.advanceTimersByTimeAsync(1); const read = f.calls.find(c => c.name === "list_team_bookings"); expect(read).toBeDefined();
    await vi.advanceTimersByTimeAsync(8000); expect(await result).toMatchObject({ status: "unavailable" }); expect(read?.signal?.aborted).toBe(true);
    slow.resolve({ data: [record()], error: null }); await vi.runAllTimersAsync(); expect(f.calls.filter(c => c.name === "list_team_bookings")).toHaveLength(1); expect(f.user).toHaveBeenCalledTimes(1);
  });
  it("uses one overall deadline across successive waits, including final authority", async () => {
    vi.useFakeTimers(); const f = fixture(); const slow = deferred<Response>(); f.pending.list_team_bookings = slow.promise;
    const result = f.read(); await vi.advanceTimersByTimeAsync(6000); slow.resolve({ data: [record()], error: null });
    const final = deferred<Response>(); f.pending.is_tenant_member = final.promise;
    await vi.advanceTimersByTimeAsync(2001); expect(await result).toMatchObject({ status: "unavailable" });
    final.resolve({ data: true, error: null }); await vi.runAllTimersAsync(); expect(f.calls.filter(c => c.name === "list_team_bookings")).toHaveLength(1);
  });
  it("rejects late A-to-B-to-A history after scope epoch changes", async () => {
    const f = fixture(); const slow = deferred<Response>(); f.pending.list_team_bookings = slow.promise;
    const result = f.read(); await vi.waitFor(() => expect(f.calls.some(c => c.name === "list_team_bookings")).toBe(true));
    f.switchTo({ ...identity, tenantId: id(9), scopeEpoch: 2 }); f.switchTo({ ...identity, scopeEpoch: 3 }); slow.resolve({ data: [record()], error: null }); expect(await result).toMatchObject({ status: "refused" });
  });
  it("honors caller cancellation and leaves no late continuation", async () => {
    const f = fixture(); const abort = new AbortController(); const slow = deferred<Response>(); f.pending.list_team_bookings = slow.promise;
    const result = readCalendarBooking(identity, { ...f.deps, signal: abort.signal }, { booking_id: id(3) });
    await vi.waitFor(() => expect(f.calls.some(c => c.name === "list_team_bookings")).toBe(true)); abort.abort(); expect(await result).toMatchObject({ status: "unavailable" });
    slow.resolve({ data: [record()], error: null }); await Promise.resolve(); expect(f.user).toHaveBeenCalledTimes(1);
  });
  it("already cancelled and unmounted scopes start no requests", async () => {
    const f = fixture(); f.switchTo(null); expect(await f.read()).toMatchObject({ status: "refused" }); expect(f.calls).toEqual([]);
    const g = fixture(); const abort = new AbortController(); abort.abort();
    expect(await readCalendarBooking(identity, { ...g.deps, signal: abort.signal }, { booking_id: id(3) })).toMatchObject({ status: "unavailable" }); expect(g.calls).toEqual([]); expect(g.user).not.toHaveBeenCalled();
  });
  it("keeps a second eligible tenant and member on the same adapter/provisioning contract", async () => {
    const f = fixture(); const scope = { ...identity, actorId: id(11), tenantId: id(12), workspaceId: id(12), role: "member", scopeEpoch: 4 };
    f.switchTo(scope); f.user.mockResolvedValue({ data: { user: { id: id(11) } }, error: null }); f.responses.current_user_tenant_id.data = id(12);
    f.responses.list_team_bookings.data = [{ ...record(), id: id(13), tenant_id: id(12), host_user_id: id(11) }];
    expect(await readCalendarBooking(scope, f.deps, { booking_id: id(13) })).toMatchObject({ status: "available", booking: { id: id(13), tenant_id: id(12) } });
    expect(f.calls.find(c => c.name === "list_team_bookings")?.args).toMatchObject({ _tenant_id: id(12), _booking_id: id(13) });
  });
  it("deferred final authentication cannot expose a previously obtained record after expiry", async () => {
    vi.useFakeTimers(); const f = fixture(); const slow = deferred<Awaited<ReturnType<typeof f.user>>>();
    f.user.mockResolvedValueOnce({ data: { user: { id: id(1) } }, error: null }).mockReturnValueOnce(slow.promise);
    const result = f.read(); await vi.advanceTimersByTimeAsync(8001); expect(await result).toMatchObject({ status: "unavailable" });
    slow.resolve({ data: { user: { id: id(1) } }, error: null }); await vi.runAllTimersAsync(); expect(f.calls.some(c => c.name === "is_tenant_member")).toBe(false);
  });
  it("thrown transport and auth failures settle without absence or replay", async () => {
    const f = fixture(); f.user.mockRejectedValue(new Error("transport failed")); expect(await f.read()).toMatchObject({ status: "unavailable" }); expect(f.calls).toEqual([]);
    const g = fixture(); g.pending.list_team_bookings = Promise.reject(new Error("native transport failed")); const result = await g.read(); expect(result).toMatchObject({ status: "unavailable" }); expect(result).not.toHaveProperty("found"); expect(g.calls.filter(c => c.name === "list_team_bookings")).toHaveLength(1);
  });
  it("native admin uncertainty cannot disclose another host's booking", async () => {
    const f = fixture(); f.responses.list_team_bookings.data = [{ ...record(), host_user_id: id(9) }]; f.responses.is_tenant_admin = { data: null, error: { code: "57014" } };
    expect(await f.read()).toMatchObject({ status: "unavailable" });
  });
  it("excludes unresolved or customer contexts without native reads", async () => {
    for (const change of [{ tenantId: null }, { role: null }, { accountShape: null }, { actAsClientId: id(8) }, { accountShape: "agency" as const }]) {
      const f = fixture(); const scope = { ...identity, ...change }; f.switchTo(scope);
      expect(await readCalendarBooking(scope, f.deps, { booking_id: id(3) })).toMatchObject({ status: "refused" }); expect(f.calls).toEqual([]);
    }
  });
  it("the actual Supabase caller preserves its JWT and serializes the exact five-argument RPC", async () => {
    const requests: { url: URL; method: string; body: unknown; authorization: string | null; signal: AbortSignal | null | undefined }[] = [];
    const transport: typeof fetch = async (input, options) => {
      const url = new URL(String(input)); const headers = new Headers(options?.headers);
      requests.push({ url, method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : null, authorization: headers.get("Authorization"), signal: options?.signal });
      const data = url.pathname === "/auth/v1/user" ? { id: id(1), app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01" }
        : url.pathname.endsWith("/current_user_tenant_id") ? id(2) : url.pathname.endsWith("/is_tenant_member") ? true : [record()];
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const caller = createClient("https://calendar-fixture.invalid", "fixture-public-key", { global: { fetch: transport, headers: { Authorization: "Bearer TEST_ONLY_CALLER_JWT" } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    // The fixture exercises the real generic client at the adapter's deliberately
    // narrow structural port; avoid expanding Supabase's recursive schema types.
    const result = await readCalendarBooking(identity, { caller: caller as unknown as CalendarBookingReadCaller, currentIdentity: () => identity }, { booking_id: id(3) });
    expect(result).toMatchObject({ status: "available", found: true, booking: record() });
    expect(requests.every(r => r.url.host === "calendar-fixture.invalid" && r.authorization === "Bearer TEST_ONLY_CALLER_JWT")).toBe(true);
    const native = requests.filter(r => r.url.pathname.endsWith("/list_team_bookings")); expect(native).toHaveLength(1);
    expect(native[0].method).toBe("POST"); expect(native[0].body).toEqual({ _from: "-infinity", _to: "infinity", _host_ids: null, _tenant_id: id(2), _booking_id: id(3) });
    expect(native[0].url.searchParams.get("select")).toBe(Object.keys(record()).join(",")); expect(native[0].url.searchParams.get("id")).toBe("eq." + id(3)); expect(native[0].url.searchParams.get("limit")).toBe("2"); expect(native[0].signal).toBeInstanceOf(AbortSignal);
  });
});
