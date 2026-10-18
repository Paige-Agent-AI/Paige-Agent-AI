import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Router, NavigationType, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrmWorkRecord } from "./operations/operations-native-work";

// The host, Operations controller, Workspace, Sheet and native editor are real.
// Only unrelated departments, shell integrations and backend/command ports are doubled.
const port = vi.hoisted(() => ({ actor: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222", readTask: vi.fn(), submit: vi.fn(), failOperations: false }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeUserId: port.actor,
  activeTenantId: port.tenant, loading: false, accountContextStatus: "ready", isPlatformStaff: false,
  activeTenant: { account_number: "123", name: "Synthetic company", account_type: "standalone", features: { solo_setup_completed: true } } }) }));
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: () => ({ plans: [], allItems: [], loading: false, error: null, forbidden: false, refresh: vi.fn() }) }));
vi.mock("./operations/useOperationsPeople", () => ({ useOperationsPeople: () => ({ members: [{ membership_id: "synthetic-membership", user_id: port.actor, full_name: "Sample owner", status: "active", avatar_url: null }], loading: false, error: null, refresh: vi.fn() }) }));
vi.mock("./operations/useOperationsCrmWork", () => ({ useOperationsCrmWork: () => {
  if (port.failOperations) throw new Error("Synthetic department render failure");
  return { tasks: [], loading: false, error: null, forbidden: false, hasMore: false, refresh: vi.fn(), readTask: port.readTask };
} }));
vi.mock("./operations/operations-crm-work-command", async original => ({ ...await original<typeof import("./operations/operations-crm-work-command")>(), submitCrmWorkStageOperation: port.submit }));
vi.mock("./operations/OperationsDelivery", () => ({ default: () => null }));
vi.mock("./operations/OperationsPlaybooks", () => ({ OperationsPlaybooks: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: false, error: null })) } }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/hooks/usePendingApprovals", () => ({ usePendingApprovals: () => ({ items: [] }) }));
vi.mock("@/components/auth/WorkspaceExitControl", () => ({ WorkspaceExitControl: () => null }));
vi.mock("@/components/admin/voice/DialPadTrigger", () => ({ DialPadTrigger: () => null }));
vi.mock("@/components/ui/paige", () => ({ AgentPresenceProvider: ({ children }: React.PropsWithChildren) => children,
  useAgentPresence: () => ({ expandRail: vi.fn(), railExpanded: false }) }));
vi.mock("@/lib/voice/VoiceDeviceProvider", () => ({ VoiceDeviceProvider: ({ children }: React.PropsWithChildren) => children }));
vi.mock("@/components/admin/voice/DialPadSurface", () => ({ DialPadSurface: () => null }));
vi.mock("@/components/admin/voice/IncomingCallOverlay", () => ({ IncomingCallOverlay: () => null }));
vi.mock("@/components/admin/voice/LiveTranscriptPanel", () => ({ LiveTranscriptPanel: () => null }));
vi.mock("./SoloSetupReadinessNotice", () => ({ SoloSetupReadinessNotice: () => null }));
vi.mock("./SoloPaigeWorkspace", () => ({ SoloPaigeWorkspace: () => <textarea aria-label="Existing PAIGE draft" defaultValue="Keep this sibling draft" /> }));
vi.mock("./CommandCenter", () => ({ CommandHub: () => <div>Command Center test surface</div> }));
vi.mock("./conversations", () => ({ ClientsHub: () => null }));
vi.mock("@/components/tenant-relationships/TenantRelationshipsClientsWorkspace", () => ({ TenantRelationshipsClientsWorkspace: () => null }));
vi.mock("./growth2", () => ({ GrowthHub: () => null }));
vi.mock("./AdsWorkspace", () => ({ AdsWorkspace: () => null }));
vi.mock("./SalesWorkspace", () => ({ SalesWorkspace: () => null }));
vi.mock("./finance/FinanceWorkspace", () => ({ FinanceWorkspace: () => null }));
vi.mock("@/components/tenant-calendar/TenantCanonicalCalendarWorkspace", () => ({ TenantCanonicalCalendarWorkspace: () => null }));
vi.mock("./marketplace", () => ({ Marketplace: () => null }));
vi.mock("./settings", () => ({ SoloSettings: () => <input aria-label="Other department input" defaultValue="Initial settings value" /> }));
vi.mock("./vault/useBusinessVault", () => ({ useVaultAccess: () => ({}), canShowVaultNavigation: () => false }));
vi.mock("./vibe", () => ({ VibeStudio: () => null }));
import SoloApp from "./SoloApp";

const id = "33333333-3333-4333-8333-333333333333";
const work = `/solo/123/operations/work?task=${id}`;
const capacity = "/solo/123/operations/capacity", settings = "/solo/123/settings/setup";
const task = (): CrmWorkRecord => ({ id, tenant_id: port.tenant, user_id: port.actor, title: "Synthetic shell Task",
  description: "Current synthetic details", status: "pending", due_date: "2026-11-02T10:00:00Z", updated_at: "2026-10-18T00:00:00.123456Z",
  created_at: "2026-10-17T00:00:00Z", deal_id: null, biz_id: null, recorded_priority: null, estimated_minutes: null });
function Controls() {
  const navigate = useNavigate(), location = useLocation();
  return <div><output data-actual-address>{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>History Back</button><button onClick={() => navigate(1)}>History Forward</button>
    <button onClick={() => navigate(capacity)}>Go Capacity</button><button onClick={() => navigate(settings)}>Go Settings</button>
    <button onClick={() => navigate(work)}>Go Task</button></div>;
}
let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); port.actor = "11111111-1111-4111-8111-111111111111"; port.tenant = "22222222-2222-4222-8222-222222222222";
  port.readTask.mockReset(); port.readTask.mockImplementation(async () => ({ status: "available", found: true, task: task() }));
  port.submit.mockReset(); port.failOperations = false; sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (entries = [settings, work], initialIndex = entries.length - 1) => {
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={initialIndex}><Controls /><Routes>
    <Route path="/solo/:account/*" element={<SoloApp />} /></Routes></MemoryRouter>));
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const checkbox = () => dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
const address = () => host.querySelector("[data-actual-address]")?.textContent;
async function click(label: string) { const target = label === "Close" ? dialog()! : document;
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === label);
  expect(button).toBeTruthy(); await act(async () => button!.click()); }

it.each([capacity, settings])("keeps the actual dirty inspector mounted through POP to %s", async prior => {
  await mount([prior, work]); expect(dialog()?.textContent).toContain(task().title);
  const nativeInput = checkbox()!; await act(async () => nativeInput.click()); expect(nativeInput.checked).toBe(true);
  const screenHost = host.querySelector("[data-solo-screen-host]"), paige = host.querySelector('[aria-label="Existing PAIGE draft"]');
  await click("History Back");
  expect(dialog(), "actual shell must retain its guarded Operations subtree").toBeTruthy();
  expect(checkbox()).toBe(nativeInput); expect(nativeInput.checked).toBe(true); expect(address()).toBe(work);
  expect(host.querySelector("[data-solo-screen-host]")).toBe(screenHost); expect(host.querySelector('[aria-label="Existing PAIGE draft"]')).toBe(paige);
  expect(port.readTask).toHaveBeenCalledTimes(1); expect(port.submit).not.toHaveBeenCalled();
});

it.each([capacity, settings])("keeps the actual dirty inspector and Forward entry for %s", async next => {
  await mount([work, next], 0); const nativeInput = checkbox()!; await act(async () => nativeInput.click());
  await click("History Forward"); expect(address()).toBe(work); expect(checkbox()).toBe(nativeInput); expect(nativeInput.checked).toBe(true);
  await click("Close"); expect(dialog()).toBeNull(); expect(address()).toBe("/solo/123/operations/work");
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Work"));
  await click("History Forward"); expect(address()).toBe(next); expect(dialog()).toBeNull();
  expect(port.submit).not.toHaveBeenCalled();
});

it("preserves accepted Back and unrelated PAIGE state after an intentional Close", async () => {
  await mount(); const nativeInput = checkbox()!; await act(async () => nativeInput.click());
  const paige = host.querySelector<HTMLTextAreaElement>('[aria-label="Existing PAIGE draft"]')!;
  paige.value = "Protected sibling draft";
  await click("History Back"); expect(address()).toBe(work); expect(checkbox()).toBe(nativeInput);
  await click("Close"); await click("History Back"); expect(address()).toBe(settings); expect(dialog()).toBeNull();
  expect(host.querySelector('[aria-label="Existing PAIGE draft"]')).toBe(paige); expect(paige.value).toBe("Protected sibling draft");
  await click("History Forward"); expect(address()).toBe("/solo/123/operations/work"); expect(dialog()).toBeNull();
});

it.each(["review", "pending", "unknown"])("retains %s command/inspection state across a cross-department departure", async phase => {
  let release!: (value: unknown) => void;
  port.submit.mockImplementation(() => phase === "pending" ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ kind: "uncertain", message: "Synthetic unknown result" }));
  await mount(); const nativeInput = checkbox()!; await act(async () => nativeInput.click()); await click("Review due date");
  if (phase !== "review") await click("Confirm task change");
  const retained = sessionStorage.getItem(`paige:operations-crm-stage:${port.actor}:${port.tenant}`);
  const existingCalls = port.submit.mock.calls.length;
  const review = dialog(); const panel = review?.querySelector('[aria-label="Review task assignment or due date"]');
  const reviewedText = panel?.textContent;
  expect(panel).toBeTruthy(); expect(Boolean(retained)).toBe(phase !== "review");
  await click("History Back"); expect(address()).toBe(work); expect(dialog()).toBeTruthy();
  // Opening the incumbent review intentionally replaces the editor. Retain
  // that exact current review/unknown panel, rather than resurrecting its input.
  expect(dialog()).toBe(review); expect(dialog()?.querySelector('[aria-label="Review task assignment or due date"]')).toBe(panel);
  expect(panel?.textContent).toBe(reviewedText);
  expect(sessionStorage.getItem(`paige:operations-crm-stage:${port.actor}:${port.tenant}`)).toBe(retained);
  expect(port.submit).toHaveBeenCalledTimes(existingCalls); expect(existingCalls).toBe(phase === "review" ? 0 : 1);
  if (phase === "pending") {
    await act(async () => release({ kind: "uncertain", message: "Synthetic unknown result" }));
    expect(dialog()?.textContent).toContain("Recover original action"); expect(port.submit).toHaveBeenCalledTimes(1);
  }
});

it.each(["actor", "tenant"] as const)("retires the mounted draft on %s A→B→A rather than borrowing the old hold", async field => {
  await mount(); const nativeInput = checkbox()!; await act(async () => nativeInput.click());
  const prior = port[field]; port[field] = "77777777-7777-4777-8777-777777777777"; await mount();
  expect(nativeInput.isConnected).toBe(false); expect(checkbox()?.checked).toBe(false);
  const intermediate = checkbox(); port[field] = prior; await mount();
  expect(intermediate?.isConnected).toBe(false); expect(checkbox()).not.toBe(nativeInput); expect(checkbox()?.checked).toBe(false);
  expect(port.readTask).toHaveBeenCalledTimes(3); expect(port.submit).not.toHaveBeenCalled();
});

it("aborts a retired shell read and does not publish its late reply after actor/tenant A→B→A", async () => {
  let release!: (value: unknown) => void; const old = task();
  port.readTask.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await mount(); const signal = port.readTask.mock.calls[0][1] as AbortSignal;
  const prior = port.tenant; port.tenant = "77777777-7777-4777-8777-777777777777"; await mount();
  port.tenant = prior; await mount(); const currentInput = checkbox();
  await act(async () => release({ status: "available", found: true, task: { ...old, title: "Retired Task must not paint" } }));
  expect(signal.aborted).toBe(true); expect(checkbox()).toBe(currentInput); expect(dialog()?.textContent).not.toContain("Retired Task must not paint");
  expect(port.submit).not.toHaveBeenCalled();
});

it("keeps ordinary department remount and screen-host scroll ownership unchanged", async () => {
  await mount([settings]); const settingsInput = host.querySelector<HTMLInputElement>('[aria-label="Other department input"]')!;
  settingsInput.value = "Departing settings draft"; const priorHost = host.querySelector<HTMLElement>("[data-solo-screen-host]")!;
  expect(priorHost.style.overflow).toBe("auto"); await click("Go Capacity");
  expect(settingsInput.isConnected).toBe(false); expect(host.querySelector<HTMLElement>("[data-solo-screen-host]")?.style.overflow).toBe("hidden");
  await click("History Back"); expect(host.querySelector("[data-solo-screen-host]")).not.toBe(priorHost);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Other department input"]')?.value).toBe("Initial settings value");
  expect(host.querySelector<HTMLElement>("[data-solo-screen-host]")?.style.overflow).toBe("auto");
});

it("resets an Operations render failure on a changed path while retaining its healthy host", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    port.failOperations = true; await mount(["/solo/123/operations/work"]);
    expect(host.querySelector('[aria-label="Page unavailable"]')).toBeTruthy();
    const priorHost = host.querySelector("[data-solo-screen-host]"); port.failOperations = false; await click("Go Capacity");
    expect(host.querySelector('[aria-label="Page unavailable"]')).toBeNull(); expect(host.querySelector('[aria-label="Capacity"]')).toBeTruthy();
    expect(host.querySelector("[data-solo-screen-host]")).toBe(priorHost);
  } finally { error.mockRestore(); }
});

it.each([[NavigationType.Pop, settings], [NavigationType.Push, settings], [NavigationType.Pop, "/solo/123/paige/chat"], [NavigationType.Push, "/solo/123/paige/chat"]] as const)("makes an unindexed %s departure to %s explicit until intentional Close", async (navigationType, destination) => {
  const previous = window.history.state; window.history.replaceState(null, "");
  const navigator = { createHref: () => "/", go: vi.fn(), push: vi.fn(), replace: vi.fn() };
  const render = async (pathname: string, search: string, key: string) => { await act(async () => root.render(
    <Router navigator={navigator} navigationType={navigationType} location={{ pathname, search, hash: "", state: null, key }}>
      <Controls /><Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes></Router>)); };
  try {
    await render("/solo/123/operations/work", `?task=${id}`, "accepted"); const input = checkbox()!; await act(async () => input.click());
    await render(destination, "", "unaccepted"); expect(address()).toBe(destination); expect(checkbox()).toBe(input); expect(input.checked).toBe(true);
    expect(host.querySelector<HTMLElement>(".tcs-canvas")?.style.visibility).not.toBe("hidden");
    expect(host.textContent).toContain("Your address changed"); expect(navigator.go).not.toHaveBeenCalled(); expect(navigator.replace).not.toHaveBeenCalled();
    await click("Close"); expect(dialog()).toBeNull();
    if (destination === settings) expect(host.querySelector('[aria-label="Other department input"]')).toBeTruthy();
    else expect(host.querySelector('[data-paige-full="true"]')).toBeTruthy();
    expect(port.submit).not.toHaveBeenCalled();
  } finally { window.history.replaceState(previous, ""); }
});
