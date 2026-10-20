import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWeeklyResponsibility } from "./useWeeklyResponsibility";
import type { WeeklyOwnerRead } from "./weekly-owner-read";
import { setScopedUserId } from "@/lib/scopedUser";

const harness = vi.hoisted(() => ({ context: { loading: false, accountContextStatus: "ready", activeUserId: "actor-a", activeTenantId: "tenant-a", activeTenant: { account_type: "standalone" as string | null, parent_tenant_id: null as string | null }, isPlatformStaff: false, soloShellEnabled: true },
  impersonating: false, read: vi.fn(), authEvent: null as null | ((event: string) => void) }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: harness.impersonating, target: harness.impersonating ? { contactId: "client" } : null }) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => harness.context }));
vi.mock("./weekly-owner-read", () => ({ readWeeklyOwner: harness.read }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: (fn: (event: string) => void) => { harness.authEvent = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
let root: Root, container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Harness() { const { read, refresh } = useWeeklyResponsibility(); return <div>{read.status === "ready" ? read.snapshot.read_at : read.status}<button onClick={() => void refresh()}>Refresh</button></div>; }
function ready(label: string): WeeklyOwnerRead { return { status: "ready", snapshot: { source: "canonical_process_and_act_receipts", read_at: label, business_time_zone: { state: "missing", zone: null }, limit: 50, has_more: false, checks: [] } }; }
beforeEach(() => { setScopedUserId(null); harness.impersonating = false; harness.context = { loading: false, accountContextStatus: "ready", activeUserId: "actor-a", activeTenantId: "tenant-a", activeTenant: { account_type: "standalone", parent_tenant_id: null }, isPlatformStaff: false, soloShellEnabled: true }; harness.read.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); setScopedUserId(null); container.remove(); });
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
