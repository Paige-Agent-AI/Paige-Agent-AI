import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ tenant: "test-tenant-a", user: "test-user", status: "ready", foreign: false }));
const paige = vi.hoisted(() => ({ handoff: vi.fn(), clearClient: vi.fn(), clearPublic: vi.fn() }));
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: paige.handoff }));
vi.mock("@/solo/paigeClientScope", () => ({ clearPaigeClientScope: paige.clearClient }));
vi.mock("@/solo/paigePublicPresenceScope", () => ({ clearPaigePublicPresenceScope: paige.clearPublic }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: harness.tenant,
  activeUserId: harness.user, loading: false, accountContextStatus: harness.status }) }));
vi.mock("./useOperationsPeople", () => ({ useOperationsPeople: () => ({ members: [], loading: false,
  error: null, partial: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: () => ({ plans: [], loading: false, error: null,
  forbidden: false, refresh: vi.fn(), allItems: [{ id: "test-item", tenant_id: harness.foreign ? "test-foreign" : harness.tenant,
    plan_id: null, title: `${harness.tenant} assigned work`, summary: "Test source", status: "open", priority: "normal",
    item_type: "task", assigned_to_user_id: null, due_at: null }] }) }));
vi.mock("./OperationsDelivery", () => ({ default: () => <div>Delivery test seam</div> }));
vi.mock("./OperationsPlaybooks", () => ({ OperationsPlaybooks: () => <div>Playbook test seam</div> }));
vi.mock("./OperationsWorkEditor", () => ({ OperationsWorkEditor: () => <div>Work edit test seam</div> }));
import { OperationsWorkspace } from "./OperationsWorkspace";
let container: HTMLDivElement;
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { harness.tenant = "test-tenant-a"; harness.user = "test-user"; harness.status = "ready";
  vi.clearAllMocks();
  harness.foreign = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === text);
  expect(button).toBeTruthy(); await act(async () => button?.click());
}
it("removes old workspace work and the open detail drawer on switching", async () => {
  await act(async () => root.render(<OperationsWorkspace />));
  await click("Work");
  const task = container.querySelector<HTMLButtonElement>(".ops-work-card");
  await act(async () => task?.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("test-tenant-a assigned work");
  harness.tenant = "test-tenant-b";
  await act(async () => root.render(<OperationsWorkspace />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("test-tenant-a assigned work");
});
it("refuses an inconsistent source bundle instead of rendering foreign work", async () => {
  harness.foreign = true;
  await act(async () => root.render(<OperationsWorkspace />));
  expect(container.textContent).toContain("Your work couldn’t be loaded");
  expect(container.querySelector(".ops-work-card")).toBeNull();
});
it("does not mount the department while authenticated context is unresolved or failed", async () => {
  harness.status = "error";
  await act(async () => root.render(<OperationsWorkspace />));
  expect(container.textContent).toContain("Choose your workspace");
  expect(container.querySelector(".ops-department-controls")).toBeNull();
});
it("closes details when a canonical URL-controlled view changes", async () => {
  await act(async () => root.render(<OperationsWorkspace view="work" onViewChange={vi.fn()} />));
  await act(async () => container.querySelector<HTMLButtonElement>(".ops-work-card")?.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => root.render(<OperationsWorkspace view="capacity" onViewChange={vi.fn()} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.render(<OperationsWorkspace view="work" onViewChange={vi.fn()} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("hands a bounded review draft to existing PAIGE after clearing old customer scope", async () => {
  const open = vi.fn();
  await act(async () => root.render(<OperationsWorkspace openPaige={open} />));
  await click("Review with PAIGE");
  expect(paige.clearClient).toHaveBeenCalledOnce(); expect(paige.clearPublic).toHaveBeenCalledOnce();
  expect(paige.handoff).toHaveBeenCalledWith(expect.stringContaining("Use current work records"));
  expect(open).toHaveBeenCalledOnce();
});
