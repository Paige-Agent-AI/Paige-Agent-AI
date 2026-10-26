import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWeeklyResponsibility } from "./useWeeklyResponsibility";
import type { WeeklyOwnerRead } from "./weekly-owner-read";
import { setScopedUserId } from "@/lib/scopedUser";

type AuthSnapshot = { user: { id: string; last_sign_in_at?: string } };
const harness = vi.hoisted(() => ({ context: { loading: false, accountContextStatus: "ready", activeUserId: "actor-a", activeTenantId: "tenant-a", activeTenant: { account_type: "standalone" as string | null, parent_tenant_id: null as string | null }, isPlatformStaff: false, soloShellEnabled: true },
  impersonating: false, read: vi.fn(), control: vi.fn(), authEvent: null as null | ((event: string, session?: AuthSnapshot | null) => void) }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: harness.impersonating, target: harness.impersonating ? { contactId: "client" } : null }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => harness.context }));
vi.mock("./weekly-owner-read", () => ({ readWeeklyOwner: harness.read, controlWeeklyOwner: harness.control }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: (fn: (event: string, session?: AuthSnapshot | null) => void) => { harness.authEvent = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
let root: Root, container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useWeeklyResponsibility>;
function Harness() { api = useWeeklyResponsibility(); const { read, refresh } = api; return <div>{read.status === "ready" ? read.snapshot.read_at : read.status}<button onClick={() => void refresh()}>Refresh</button></div>; }
function ready(label: string): WeeklyOwnerRead { return { status: "ready", snapshot: { source: "canonical_process_and_act_receipts", read_at: label, business_time_zone: { state: "missing", zone: null }, limit: 50, has_more: false, checks: [] } }; }
function responsibility() {
  const value = ready("current definition");
  if (value.status !== "ready") throw Error("fixture");
  value.snapshot.checks.push({ automation_id: "11111111-1111-4111-8111-111111111111", name: "Synthetic check", revision: 2,
    schedule_status: "scheduled", schedule: { weekday: 1, local_time: "09:00", timezone: "UTC" }, execution_availability: "held",
    execution_hold_reason: "trigger_dark", next_run_at: null, intended_next_run_at: null, last_run: null, last_verified_run: null });
  return value;
}
beforeEach(() => { setScopedUserId(null); harness.impersonating = false; harness.context = { loading: false, accountContextStatus: "ready", activeUserId: "actor-a", activeTenantId: "tenant-a", activeTenant: { account_type: "standalone", parent_tenant_id: null }, isPlatformStaff: false, soloShellEnabled: true }; harness.read.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); setScopedUserId(null); container.remove(); });
it("one deliberate control is single-flight and unknown results require inspection", async () => {
  const value = responsibility(), target = value.snapshot.checks[0];
  let release: (value: { status: "unknown" }) => void = () => {};
  harness.control.mockReset().mockImplementation(() => new Promise(resolve => { release = resolve; }));
  harness.read.mockResolvedValue(value); await act(async () => root.render(<Harness />));
  let first: ReturnType<typeof api.control>;
  await act(async () => { first = api.control(target, "pause"); });
  expect(api.controlBusy).toBe(true);
  expect(await api.control(target, "pause")).toEqual({ status: "refused" });
  await act(async () => { release({ status: "unknown" }); expect(await first!).toEqual({ status: "unknown" }); });
  expect(api.read.status).toBe("unavailable"); expect(api.controlBusy).toBe(false);
  expect(harness.control).toHaveBeenCalledTimes(1); expect(harness.read).toHaveBeenCalledTimes(1);
});
it("a copied record and a stale controller cannot request a change", async () => {
  const value = responsibility(), target = value.snapshot.checks[0];
  harness.control.mockReset(); harness.read.mockResolvedValue(value); await act(async () => root.render(<Harness />));
  expect(await api.control({ ...target }, "pause")).toEqual({ status: "refused" });
  const previous = api.control;
  harness.context = { ...harness.context, activeUserId: "actor-b", activeTenantId: "tenant-b" };
  await act(async () => root.render(<Harness />));
  expect(await previous(target, "pause")).toEqual({ status: "refused" }); expect(harness.control).not.toHaveBeenCalled();
});
it("Auth retirement withholds a late successful control and its private snapshot", async () => {
  const value = responsibility(), target = value.snapshot.checks[0];
  let release: (result: { status: "saved"; snapshot: typeof value.snapshot }) => void = () => {};
  harness.control.mockReset().mockImplementation(() => new Promise(resolve => { release = resolve; }));
  harness.read.mockResolvedValue(value); await act(async () => root.render(<Harness />));
  let pending: ReturnType<typeof api.control>;
  await act(async () => { pending = api.control(target, "cancel"); });
  await act(async () => harness.authEvent?.("SIGNED_OUT"));
  await act(async () => { release({ status: "saved", snapshot: value.snapshot }); expect(await pending!).toEqual({ status: "refused" }); });
  expect(api.read.status).toBe("unavailable"); expect(api.controlBusy).toBe(false);
  expect(harness.control).toHaveBeenCalledTimes(1);
  expect(await api.control(target, "cancel")).toEqual({ status: "refused" });
});
it.each([false, true])("canonical SOLO inspection does not require legacy shell flag %s", async legacyFlag => {
  harness.context.soloShellEnabled = legacyFlag;
  harness.read.mockResolvedValue(ready("canonical owner result"));
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("canonical owner result");
  expect(harness.read).toHaveBeenCalledTimes(1);
});
it.each([
  { account_type: null, parent_tenant_id: null },
  { account_type: "unknown", parent_tenant_id: null },
  { account_type: "agency", parent_tenant_id: null },
  { account_type: "standalone", parent_tenant_id: "parent-tenant" },
])("legacy flag cannot admit noncanonical classification %j", async classification => {
  harness.context.activeTenant = classification;
  harness.read.mockResolvedValue(ready("PRIVATE non-SOLO result"));
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("refused");
  expect(container.textContent).not.toContain("PRIVATE");
  expect(harness.read).not.toHaveBeenCalled();
});
it.each(["resolving", "error", "signed_out"])("unresolved account state %s cannot read even with a canonical classification", async status => {
  harness.context.accountContextStatus = status;
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("refused");
  expect(harness.read).not.toHaveBeenCalled();
});
it("platform staff do not enter the ordinary owner reader", async () => {
  harness.context.isPlatformStaff = true;
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("refused");
  expect(harness.read).not.toHaveBeenCalled();
});
it("StrictMode setup still performs the current canonical read after cleanup", async () => {
  harness.read.mockResolvedValue(ready("current owner read"));
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
  expect(container.textContent).toContain("current owner read");
});
it("account switch hides a resolved result before the new read and drops delayed prior data", async () => {
  let release: (value: WeeklyOwnerRead) => void = () => {};
  harness.read.mockImplementationOnce(() => new Promise<WeeklyOwnerRead>(resolve => { release = resolve; })).mockResolvedValueOnce(ready("account-b current"));
  await act(async () => root.render(<Harness />));
  harness.context = { ...harness.context, activeUserId: "actor-b", activeTenantId: "tenant-b" };
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("account-b current");
  await act(async () => release(ready("PRIVATE account-a")));
  expect(container.textContent).not.toContain("PRIVATE account-a");
});
it("leave and return to the same context cannot accept the original pending result", async () => {
  let release: (value: WeeklyOwnerRead) => void = () => {};
  harness.read.mockImplementationOnce(() => new Promise<WeeklyOwnerRead>(resolve => { release = resolve; })).mockResolvedValue(ready("fresh return"));
  await act(async () => root.render(<Harness />));
  harness.context = { ...harness.context, loading: true }; await act(async () => root.render(<Harness />));
  harness.context = { ...harness.context, loading: false }; await act(async () => root.render(<Harness />));
  await act(async () => release(ready("stale original")));
  expect(container.textContent).toContain("fresh return"); expect(container.textContent).not.toContain("stale original");
});
it("sign-out clears previously verified data without starting a call inside the auth callback", async () => {
  harness.read.mockResolvedValue(ready("private result")); await act(async () => root.render(<Harness />));
  const calls = harness.read.mock.calls.length;
  await act(async () => harness.authEvent?.("SIGNED_OUT"));
  expect(container.textContent).not.toContain("private result");
  expect(harness.read).toHaveBeenCalledTimes(calls);
});
it("View as Client clears verified private data and does not read under the owner JWT", async () => {
  harness.read.mockResolvedValue(ready("private owner result")); await act(async () => root.render(<Harness />));
  const calls = harness.read.mock.calls.length;
  harness.impersonating = true; await act(async () => root.render(<Harness />));
  expect(container.textContent).not.toContain("private owner result"); expect(container.textContent).toContain("refused");
  expect(harness.read).toHaveBeenCalledTimes(calls);
});
it("effective-user leave and return rejects the original pending owner result", async () => {
  let release: (value: WeeklyOwnerRead) => void = () => {};
  harness.read.mockImplementationOnce(() => new Promise<WeeklyOwnerRead>(resolve => { release = resolve; })).mockResolvedValue(ready("fresh owner result"));
  await act(async () => root.render(<Harness />));
  const currentScope = harness.read.mock.calls[0][2] as () => unknown;
  await act(async () => { setScopedUserId("client"); expect(currentScope()).toBeNull(); });
  expect(container.textContent).toContain("refused");
  await act(async () => setScopedUserId(null));
  await act(async () => release(ready("stale PRIVATE owner result")));
  expect(container.textContent).toContain("fresh owner result"); expect(container.textContent).not.toContain("stale PRIVATE");
});

const sameSignIn: AuthSnapshot = { user: { id: "actor-a", last_sign_in_at: "2026-10-25T14:00:00Z" } };
it("retains the original weekly read on a same-session sign-in notification without another request", async () => {
  harness.read.mockResolvedValue(ready("original weekly read")); await act(async () => root.render(<Harness />));
  await act(async () => harness.authEvent?.("INITIAL_SESSION", sameSignIn));
  const original = api.read;
  await act(async () => harness.authEvent?.("SIGNED_IN", sameSignIn));
  expect(api.read).toBe(original); expect(container.textContent).toContain("original weekly read");
  expect(harness.read).toHaveBeenCalledTimes(1);
});
it("accepts the original pending read after same-session visibility recovery", async () => {
  let release!: (value: WeeklyOwnerRead) => void;
  harness.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => { harness.authEvent?.("INITIAL_SESSION", sameSignIn); harness.authEvent?.("SIGNED_IN", sameSignIn); });
  await act(async () => release(ready("original held read")));
  expect(container.textContent).toContain("original held read"); expect(harness.read).toHaveBeenCalledTimes(1);
});
it("retains the original control flight and unknown hold across same-session sign-in", async () => {
  const value = responsibility(), target = value.snapshot.checks[0];
  let release!: (value: { status: "unknown" }) => void;
  harness.control.mockReset().mockImplementation(() => new Promise(resolve => { release = resolve; }));
  harness.read.mockResolvedValue(value); await act(async () => root.render(<Harness />));
  await act(async () => harness.authEvent?.("INITIAL_SESSION", sameSignIn));
  let pending!: ReturnType<typeof api.control>;
  await act(async () => { pending = api.control(target, "pause"); });
  await act(async () => harness.authEvent?.("SIGNED_IN", sameSignIn));
  expect(api.controlBusy).toBe(true); expect(await api.control(target, "pause")).toEqual({ status: "refused" });
  await act(async () => { release({ status: "unknown" }); expect(await pending).toEqual({ status: "unknown" }); });
  await act(async () => harness.authEvent?.("SIGNED_IN", sameSignIn));
  expect(api.read.status).toBe("unavailable"); expect(harness.control).toHaveBeenCalledTimes(1);
  expect(harness.read).toHaveBeenCalledTimes(1);
});
it.each([
  ["SIGNED_IN", { user: { id: "actor-a", last_sign_in_at: "2026-10-25T16:00:00Z" } }],
  ["SIGNED_IN", { user: { id: "foreign", last_sign_in_at: "2026-10-25T14:00:00Z" } }],
  ["SIGNED_IN", { user: { id: "actor-a" } }],
  ["SIGNED_IN", { user: { id: "actor-a", last_sign_in_at: "invalid" } }],
  ["SIGNED_OUT", null], ["USER_UPDATED", sameSignIn],
] as const)("retires original private weekly evidence after a genuine or unverified auth change %s %j", async (event, session) => {
  harness.read.mockResolvedValue(ready("private weekly result")); await act(async () => root.render(<Harness />));
  await act(async () => harness.authEvent?.("INITIAL_SESSION", sameSignIn));
  await act(async () => harness.authEvent?.(event, session));
  expect(container.textContent).not.toContain("private weekly result"); expect(api.read.status).toBe("unavailable");
  expect(harness.read).toHaveBeenCalledTimes(1);
});
it("a late initial notification cannot restore or reanchor a signed-out weekly reader", async () => {
  let release!: (value: WeeklyOwnerRead) => void;
  harness.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => { harness.authEvent?.("SIGNED_OUT", null); harness.authEvent?.("INITIAL_SESSION", sameSignIn); harness.authEvent?.("SIGNED_IN", sameSignIn); });
  await act(async () => release(ready("private late result")));
  expect(container.textContent).not.toContain("private late result"); expect(api.read.status).toBe("unavailable");
  expect(harness.read).toHaveBeenCalledTimes(1);
});
