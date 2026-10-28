import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ identity: null as unknown, create: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/portal/customerIdentity", () => ({ useShellCustomerIdentity: () => f.identity }));
vi.mock("@/lib/client-portal-booking", () => ({ createCustomerBooking: f.create, reconcileCustomerBooking: f.reconcile }));
import { customerBookingRecoveryKey, useClientPortalBooking } from "./useClientPortalBooking";
import type { CustomerBookingInput } from "@/lib/client-portal-booking";
const id = (n: number) => `e09b7000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const frame = (tenant = id(2), client = id(3), actor = id(1), checking = false) => ({ viewer: "customer", phase: "ready", checking,
  frame: { actorId: actor, profile: { tenant_id: tenant, id: client } } });
const saved = { state: "saved", booking: { id: id(6), title: "Client check-in", start_at: "2026-11-09T10:00:00Z", end_at: "2026-11-09T10:30:00Z", status: "scheduled", timezone: "UTC" } };
const input = { calendar: { id: id(5), title: "Client check-in", slug: "test-check-in", description: null, durationMin: 30, timezone: "UTC" },
  start: "2026-11-09T10:00:00Z", notes: "", answers: {}, location: "phone", appointmentTypeId: null } satisfies CustomerBookingInput;
let root: Root, host: HTMLDivElement, state: ReturnType<typeof useClientPortalBooking>;
function Probe() { state = useClientPortalBooking(); return <span>{state.booking?.title}</span>; }
const render = async (value: unknown = frame()) => act(async () => { f.identity = value; root.render(<Probe />); await Promise.resolve(); });
const key = customerBookingRecoveryKey(id(1), id(2), id(3));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); f.create.mockResolvedValue(saved); f.reconcile.mockResolvedValue(saved);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("writes only a scoped nonsecret recovery pointer BEFORE the original create", async () => {
  await render(); f.create.mockImplementation(async (_scope, request) => { expect(localStorage.getItem(key)).toBe(request); return saved; });
  await act(async () => { expect(await state.confirm(input)).toBe(true); });
  expect(f.create).toHaveBeenCalledTimes(1); expect(state.phase).toBe("saved"); expect(state.booking?.id).toBe(id(6)); expect(localStorage.getItem(key)).toBeNull();
});
it("a lost response retains the same request and refuses a second create", async () => {
  f.create.mockResolvedValue({ state: "unverified" }); await render(); await act(async () => { await state.confirm(input); });
  const request = state.pending; expect(request).toBeTruthy(); expect(localStorage.getItem(key)).toBe(request);
  await act(async () => { expect(await state.confirm(input)).toBe(false); }); expect(f.create).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await state.reconcile()).toBe(true); });
  expect(f.reconcile.mock.calls[0][1]).toBe(request); expect(f.create).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).toBeNull();
});
it("returning to the same customer scope holds a persisted request without an automatic write", async () => {
  localStorage.setItem(key, id(9)); await render(); expect(state.phase).toBe("unverified"); expect(state.pending).toBe(id(9));
  expect(f.create).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled();
});
it("a native not-found or unverified recovery cannot clear the pointer", async () => {
  localStorage.setItem(key, id(9)); f.reconcile.mockResolvedValue({ state: "unverified" }); await render();
  await act(async () => { expect(await state.reconcile()).toBe(false); });
  expect(state.pending).toBe(id(9)); expect(localStorage.getItem(key)).toBe(id(9)); expect(state.phase).toBe("unverified");
});
it("storage refusal blocks dispatch rather than losing return/recovery safety", async () => {
  await render(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  await act(async () => { expect(await state.confirm(input)).toBe(false); });
  expect(state.phase).toBe("storage-unavailable"); expect(f.create).not.toHaveBeenCalled();
});
it("malformed old recovery data is held rather than overwritten with another request", async () => {
  localStorage.setItem(key, "unknown old request"); await render(); expect(state.phase).toBe("storage-unavailable");
  await act(async () => { expect(await state.confirm(input)).toBe(false); }); expect(f.create).not.toHaveBeenCalled();
});
it("a definite pre-write refusal permits corrected input after clearing its pointer", async () => {
  f.create.mockResolvedValue({ state: "refused", code: "SLOT_UNAVAILABLE", message: null }); await render();
  await act(async () => { await state.confirm(input); }); expect(state.phase).toBe("refused"); expect(state.code).toBe("SLOT_UNAVAILABLE"); expect(state.pending).toBeNull();
});
it("a different business never receives saved data or the other business pointer", async () => {
  localStorage.setItem(key, id(9)); await render(); await render(frame(id(20), id(30)));
  expect(state.booking).toBeNull(); expect(state.pending).toBeNull(); expect(state.phase).toBe("idle"); expect(localStorage.getItem(key)).toBe(id(9));
});
it("a stale callback cannot book for a later selected business", async () => {
  await render(); const oldScope = state.scope; await render(frame(id(20), id(30))); expect(oldScope?.current()).toBe(false);
});
it("a late saved response is concealed after a relationship switch and remains recoverable on return", async () => {
  let finish!: (v: unknown) => void; f.create.mockImplementation(() => new Promise(r => { finish = r; })); await render();
  let running!: Promise<boolean>; await act(async () => { running = state.confirm(input); }); const marker = localStorage.getItem(key);
  await render(frame(id(20), id(30))); await act(async () => { finish(saved); await running; });
  expect(state.booking).toBeNull(); expect(localStorage.getItem(key)).toBe(marker);
  await render(); expect(state.phase).toBe("unverified"); expect(state.pending).toBe(marker);
});
it("a same-scope access recheck retires a late response without leaving the request stuck as sending", async () => {
  let finish!: (v: unknown) => void; f.create.mockImplementation(() => new Promise(r => { finish = r; })); await render();
  let running!: Promise<boolean>; await act(async () => { running = state.confirm(input); });
  await render(frame(id(2), id(3), id(1), true)); await act(async () => { finish(saved); await running; });
  await render(); expect(state.phase).toBe("unverified"); expect(state.busy).toBe(false); expect(state.pending).toBeTruthy();
});
for (const viewer of ["staff", "inactive", "unknown"]) it(`${viewer} viewers cannot acquire customer booking controls`, async () => {
  await render({ ...frame(), viewer }); expect(state.enabled).toBe(false); expect(state.scope).toBeNull();
  await act(async () => { expect(await state.confirm(input)).toBe(false); }); expect(f.create).not.toHaveBeenCalled();
});
