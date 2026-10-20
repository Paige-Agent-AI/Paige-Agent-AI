import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanInMotion } from "./PlanInMotion";

const h = vi.hoisted(() => ({ actor: "test-owner", tenant: "test-tenant-a", ready: true, detail: vi.fn(), mutate: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useOptionalTenantContext: () => ({ activeUserId: h.actor, activeTenantId: h.tenant, accountContextStatus: h.ready ? "ready" : "resolving", loading: !h.ready }) }));
vi.mock("./MissionTargetsPanel", () => ({ MissionTargetsPanel: () => <div>Existing target reader</div> }));
vi.mock("./data/useBusinessGamePlanMissions", () => ({ useBusinessGamePlanMissions: (scope: string | null) => ({ status: scope ? "ready" : "loading", refresh: vi.fn(), getDetail: h.detail, mutate: h.mutate,
  items: scope ? [{ id: "play", title: "Reviewed plan", state: "active", stageLabel: "Active", horizonLabel: "Open horizon", nextOwner: "Owner", desired_outcome: "Reviewed outcome" }] : [] }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const render = async (workspace = h.tenant) => { await act(async () => { root.render(<PlanInMotion workspaceId={workspace} />); }); };
const open = async () => { await act(async () => host.querySelector<HTMLButtonElement>(".pim-card")!.click()); };
const detail = (title: string) => ({ mission: { id: "play", title, state: "active", revision: 1 }, brief: { desired_outcome: "Private owner direction", constraints: [], assumptions: [], missing_information: [] } });
beforeEach(() => { h.actor = "test-owner"; h.tenant = "test-tenant-a"; h.ready = true; h.detail.mockReset(); h.mutate.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("retires a private drawer immediately on workspace/actor or unresolved-account change", async () => {
  h.detail.mockResolvedValue(detail("Private Play A")); await render(); await open();
  expect(host.textContent).toContain("Private Play A");
  h.ready = false; await render("test-tenant-a");
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).not.toContain("Private Play A");
  h.ready = true; h.tenant = "test-tenant-b"; await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  h.actor = "test-owner-b"; await render(); expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("discards a late detail across A-B-A and never replaces the new Play", async () => {
  let late!: (v: unknown) => void;
  h.detail.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  await render(); await open(); h.tenant = "test-tenant-b"; await render();
  h.tenant = "test-tenant-a"; await render(); h.detail.mockResolvedValue(detail("Current Play")); await open();
  await act(async () => { late(detail("Retired private response")); });
  expect(host.textContent).toContain("Current Play"); expect(host.textContent).not.toContain("Retired private response");
});
it("a closed drawer cannot reopen when a pending lifecycle write returns", async () => {
  let done!: (v: unknown) => void;
  h.detail.mockResolvedValue(detail("Reviewed Play")); h.mutate.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  await render(); await open();
  const pause = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === "Pause")!;
  await act(async () => pause.click());
  const reason = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Owner review"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Confirm")!.click());
  expect(h.mutate).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  await act(async () => { done({ ok: true, verified: true, railRecorded: true, outcomeUnknown: false, missionId: "play" }); });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("opens a referenced Play through the existing authorized reader and never dispatches a mutation", async () => {
  h.detail.mockResolvedValue(detail("Referenced canonical Play"));
  const close = vi.fn();
  await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId="play" onClosePlay={close} />));
  expect(h.detail).toHaveBeenCalledWith("play"); expect(host.textContent).toContain("Referenced canonical Play");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(close).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(h.mutate).not.toHaveBeenCalled();
});
it("withholds a referenced record when context is unresolved, and offers an honest failed read", async () => {
  h.ready = false;
  await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId="play" />));
  expect(h.detail).not.toHaveBeenCalled();
  h.ready = true; h.detail.mockRejectedValue(Error("MISSION_NOT_FOUND"));
  await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId="play" />));
  expect(host.textContent).toContain("could not be verified in the current workspace");
  expect(host.textContent).toContain("Retry Play read"); expect(h.mutate).not.toHaveBeenCalled();
});
it("retires a previous route read across record changes and removal", async () => {
  let late!: (value: unknown) => void;
  h.detail.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  const route = async (id: string | null) => { await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId={id} />)); };
  await route("play-a");
  h.detail.mockResolvedValue({ ...detail("Current referenced Play"), mission: { id: "play-b", title: "Current referenced Play", state: "active", revision: 2 } });
  await route("play-b");
  await act(async () => { late(detail("Retired route response")); });
  expect(host.textContent).toContain("Current referenced Play"); expect(host.textContent).not.toContain("Retired route response");
  await route(null);
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(h.mutate).not.toHaveBeenCalled();
});
