import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: f.getUser, getSession: f.getSession }, functions: { invoke: f.invoke }, rpc: f.rpc,
} }));
import { createCustomerBooking, readCustomerBookingCalendars, readCustomerBookingOutcome, reconcileCustomerBooking,
  type CustomerBookingScope, type CustomerBookingInput } from "./client-portal-booking";
const id = (n: number) => `e09b8000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = (): CustomerBookingScope => ({ actorId: id(1), tenantId: id(2), clientId: id(3), current: () => true });
const request = id(4), work = id(5);
const saved = () => ({ ok: true, state: "saved", tenant_id: id(2), client_id: id(3), request_id: request, replayed: false,
  booking: { id: work, title: "Client check-in", start_at: "2026-11-09T10:00:00Z", end_at: "2026-11-09T10:30:00Z", timezone: "UTC", status: "scheduled" } });
const input = (): CustomerBookingInput => ({ calendar: { id: id(6), slug: "test-consultation", title: "Client check-in", description: null, durationMin: 30, timezone: "UTC" },
  start: "2026-11-09T10:00:00Z", appointmentTypeId: null, location: "phone", notes: "Review progress", answers: { goal: "Plan next steps" } });
const actual = () => ({ data: { user: { id: id(1) } }, error: null });
beforeEach(() => {
  vi.resetAllMocks(); f.getUser.mockResolvedValue(actual());
  f.getSession.mockResolvedValue({ data: { session: { user: { id: id(1) }, access_token: "synthetic-customer-only" } }, error: null });
  f.invoke.mockResolvedValue({ data: saved(), error: null });
});
describe("original Portal booking transport", () => {
  it("uses the same captured customer bearer and selected-business header without guest identity or a trusted plan", async () => {
    expect(await createCustomerBooking(scope(), request, input())).toEqual({ state: "saved", booking: saved().booking });
    const [name, args] = f.invoke.mock.calls[0];
    expect(name).toBe("public-booking"); expect(args.headers).toEqual({ Authorization: "Bearer synthetic-customer-only", "x-client-portal-business": id(2) });
    expect(args.body).toMatchObject({ mode: "customer", tenant_id: id(2), client_id: id(3), request_id: request, action: "create", calendar_id: id(6) });
    for (const key of ["guest", "actor_id", "role", "p_plan"]) expect(args.body).not.toHaveProperty(key);
  });
  for (const key of ["tenant_id", "client_id", "request_id"]) it(`refuses another result's ${key}`, () => {
    expect(readCustomerBookingOutcome({ ...saved(), [key]: id(99) }, scope(), request)).toEqual({ state: "unverified" });
  });
  it("rejects an expanded private booking projection", () => {
    expect(readCustomerBookingOutcome({ ...saved(), booking: { ...saved().booking, notes: "Internal" } }, scope(), request)).toEqual({ state: "unverified" });
  });
  it("retains the actual cancelled state of a recovered original record", () => {
    expect(readCustomerBookingOutcome({ ...saved(), booking: { ...saved().booking, status: "cancelled" } }, scope(), request))
      .toMatchObject({ state: "saved", booking: { status: "cancelled" } });
  });
  it("a known pre-dispatch sign-in refusal cannot invoke the writer", async () => {
    f.getUser.mockResolvedValue({ data: { user: { id: id(99) } }, error: null });
    expect(await createCustomerBooking(scope(), request, input())).toMatchObject({ state: "refused", code: "CUSTOMER_SESSION_UNVERIFIED" });
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("a lost create response is unknown and never invokes another create", async () => {
    f.invoke.mockRejectedValue(new Error("Connection interrupted"));
    expect(await createCustomerBooking(scope(), request, input())).toEqual({ state: "unverified" }); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it("explicit recovery reads the original request and does not create", async () => {
    expect(await reconcileCustomerBooking(scope(), request)).toMatchObject({ state: "saved" });
    expect(f.invoke).toHaveBeenCalledTimes(1); expect(f.invoke.mock.calls[0][1].body).toEqual({ mode: "customer", action: "reconcile", request_id: request, tenant_id: id(2), client_id: id(3) });
  });
  it("an authorization refusal during recovery does not prove the original work was not saved", async () => {
    f.invoke.mockResolvedValue({ data: { state: "refused", code: "AUTH_REQUIRED" }, error: null });
    expect(await reconcileCustomerBooking(scope(), request)).toEqual({ state: "unverified" });
  });
  it("a conflicting original request never permits a new create", () => {
    expect(readCustomerBookingOutcome({ state: "refused", code: "REQUEST_ID_CONFLICT" }, scope(), request)).toEqual({ state: "unverified" });
  });
  it("retires a late response when the current customer context changes", async () => {
    let current = true; const s = { ...scope(), current: () => current };
    f.invoke.mockImplementation(async () => { current = false; return { data: saved(), error: null }; });
    expect(await createCustomerBooking(s, request, input())).toEqual({ state: "unverified" });
  });
  it("captures the exact confirmed input before waiting for sign-in", async () => {
    let resolve!: (v: ReturnType<typeof actual>) => void;
    f.getUser.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const i = input(), result = createCustomerBooking(scope(), request, i);
    i.start = "2026-11-09T15:00:00Z"; i.answers.goal = "Changed"; resolve(actual()); await result;
    expect(f.invoke.mock.calls[0][1].body).toMatchObject({ start: "2026-11-09T10:00:00Z", answers: { goal: "Plan next steps" } });
  });
  it("reads only the original bounded calendar page with exact native relationship and Auth headers", async () => {
    const headers: Record<string, string> = {}; f.rpc.mockImplementation((name, args) => {
      expect(name).toBe("client_portal_booking_calendars"); expect(args).toEqual({ p_tenant_id: id(2), p_expected_client_id: id(3), p_after_slug: null, p_limit: 20 });
      const query = { setHeader: (k: string, v: string) => { headers[k] = v; return query; }, then: (resolve: (v: unknown) => void) =>
        Promise.resolve({ data: { tenant_id: id(2), client_id: id(3), calendars: [], has_more: false, next_after_slug: null }, error: null }).then(resolve) }; return query;
    });
    expect(await readCustomerBookingCalendars(scope())).toEqual({ calendars: [], next: null });
    expect(headers).toEqual({ Authorization: "Bearer synthetic-customer-only", "x-client-portal-business": id(2) });
  });
});
