import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWeeklyResponsibility } from "./useWeeklyResponsibility";
import type { WeeklyOwnerRead } from "./weekly-owner-read";

const harness = vi.hoisted(() => ({ context: { loading: false, accountContextStatus: "ready", activeUserId: "actor-a", activeTenantId: "tenant-a", isPlatformStaff: false, soloShellEnabled: true },
  read: vi.fn(), authEvent: null as null | ((event: string) => void) }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => harness.context }));
vi.mock("./weekly-owner-read", () => ({ readWeeklyOwner: harness.read }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: (fn: (event: string) => void) => { harness.authEvent = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
let root: Root, container: HTMLDivElement;
function Harness() { const { read, refresh } = useWeeklyResponsibility(); return <div>{read.status === "ready" ? read.snapshot.read_at : read.status}<button onClick={() => void refresh()}>Refresh</button></div>; }
function ready(label: string): WeeklyOwnerRead { return { status: "ready", snapshot: { source: "canonical_process_and_act_receipts", read_at: label, business_time_zone: { state: "missing", zone: null }, limit: 50, has_more: false, checks: [] } }; }
beforeEach(() => { harness.context = { loading: false, accountContextStatus: "ready", activeUserId: "actor-a", activeTenantId: "tenant-a", isPlatformStaff: false, soloShellEnabled: true }; harness.read.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
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
