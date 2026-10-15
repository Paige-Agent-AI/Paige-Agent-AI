import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MissionTargetsPanel } from "./MissionTargetsPanel";

const h = vi.hoisted(() => ({ tenant: "22222222-2222-4222-8222-222222222222", model: {} as Record<string, unknown> }));
vi.mock("@/hooks/useTenantContext", () => ({ useOptionalTenantContext: () => ({ activeUserId: "11111111-1111-4111-8111-111111111111", activeTenantId: h.tenant, accountContextStatus: "ready", loading: false }) }));
vi.mock("./data/useMissionTargets", () => ({ useMissionTargets: () => h.model }));
const target = { id: "44444444-4444-4444-8444-444444444444", tenant_id: h.tenant, mission_id: "33333333-3333-4333-8333-333333333333", revision: 1, state: "active", title: "Active clients goal",
  metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count", currency: null, dimensions: {}, range_key: "quarter", semantics: "current_snapshot", business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least", desired_value: "10", upper_value: null };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const run = vi.fn(), history = vi.fn();
const render = async (revision = 3) => { await act(async () => { root.render(<MissionTargetsPanel workspaceId={h.tenant} mission={{ id: target.mission_id, revision, state: "active" }} />); }); };
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === name)!;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.tenant = target.tenant_id; run.mockReset(); history.mockReset();
  h.model = { list: { kind: "ready", targets: [target], totalCount: 1, hasMore: false }, offset: 0, actuals: { [target.id]: { kind: "unavailable" } },
    pending: null, recoveryUnavailable: false, busy: false, notice: null, receipt: null, railRecorded: false, run, history, refresh: vi.fn(), readMetric: vi.fn(async () => ({ kind: "unavailable" })) };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("never renders unavailable actuals as zero or attainment", async () => {
  await render(); expect(host.textContent).toContain("Actual unavailable");
  expect(host.textContent).not.toContain("Target met"); expect(host.querySelector(".mgt-values")).toBeNull();
});
it("keeps the reason and decision open after a refused transition, using original CAS", async () => {
  run.mockResolvedValue({ kind: "refused", mayHavePersisted: false, code: "MISSION_TARGET_REVISION_CONFLICT" });
  await render(); await act(async () => button("Pause target").click());
  const reason = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Review strategy"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ tool: "mission_target_transition", args: expect.objectContaining({ expected_mission_revision: 3, expected_target_revision: 1, reason: "Review strategy", to_state: "paused" }) }));
  expect(host.querySelector("textarea")?.value).toBe("Review strategy");
});
it("retrieves durable saved receipts again after reopening instead of depending on ephemeral success state", async () => {
  history.mockResolvedValue({ kind: "ready", versions: [{ target, reason: "Reviewed owner goal", at: "2026-10-14T12:00:00Z", receipt: { id: "66666666-6666-4666-8666-666666666666", requestKey: "55555555-5555-4555-8555-555555555555", operation: "target_create" } }], totalCount: 1, hasMore: false });
  for (let visit = 0; visit < 2; visit++) {
    await render();
    await act(async () => { const node = host.querySelector<HTMLDetailsElement>(".mgt-history")!; node.open = true; node.dispatchEvent(new Event("toggle")); });
    expect(host.textContent).toContain("66666666-6666-4666-8666-666666666666"); expect(host.textContent).toContain("Reviewed owner goal");
    if (visit === 0) { act(() => root.unmount()); root = createRoot(host); }
  }
  expect(history).toHaveBeenCalledTimes(2); expect(run).not.toHaveBeenCalled();
});
it("locks new changes behind retained uncertain intent and never calls another writer automatically", async () => {
  h.model.pending = { args: { request_key: "retained-original" } };
  await render(); expect(button("Add target").disabled).toBe(true); expect(button("Pause target").disabled).toBe(true);
  expect(host.textContent).toContain("original target request is retained"); expect(run).not.toHaveBeenCalled();
});
it("keeps the same editor and unsaved fields during a pending request and a definite refusal", async () => {
  await render(); await act(async () => button("Revise target").click());
  const form = host.querySelector<HTMLFormElement>(".mgt-editor")!, title = form.querySelector<HTMLInputElement>("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Owner's unfinished draft"); title.dispatchEvent(new Event("input", { bubbles: true })); });
  h.model.pending = { args: { request_key: "retained-original" } }; h.model.busy = true;
  await render();
  expect(host.querySelector(".mgt-editor")).toBe(form);
  expect(form.querySelector("fieldset")?.disabled).toBe(true);
  h.model.pending = null; h.model.busy = false;
  await render();
  expect(host.querySelector(".mgt-editor")).toBe(form);
  expect(title.value).toBe("Owner's unfinished draft");
  expect(form.querySelector("fieldset")?.disabled).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
it("requires a fresh Play read after a Play CAS conflict before another change", async () => {
  run.mockResolvedValue({ kind: "refused", mayHavePersisted: false, code: "MISSION_REVISION_CONFLICT" });
  await render(); await act(async () => button("Pause target").click());
  const reason = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Review strategy"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(button("Add target").disabled).toBe(true);
  expect(host.textContent).toContain("Close and reopen this Play");
  await render(4);
  expect(button("Add target").disabled).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});
it("never silently upgrades an open draft to a newer Play revision", async () => {
  await render(); await act(async () => button("Revise target").click());
  const form = host.querySelector<HTMLFormElement>(".mgt-editor")!;
  await render(4);
  expect(host.querySelector(".mgt-editor")).toBe(form);
  expect(form.querySelector("fieldset")?.disabled).toBe(true);
  expect(host.textContent).toContain("Cancel this edit");
  expect(host.textContent).not.toContain("Verifying change");
  expect(run).not.toHaveBeenCalled();
});
it("preserves a conflicted draft until explicit cancel and opens the latest record as a new edit", async () => {
  h.model.readMetric = vi.fn(async () => ({ kind: "ready", metric: { label: "Active clients", definition: "Current scoped clients", values: { kind: "count", count: 12 }, unit: "count", dimensions: {}, range: { semantics: "current_snapshot" }, reference_expires_at: new Date(Date.now() + 60000).toISOString(), evidence_ref: "aneb_v1_" + "c".repeat(64) } }));
  run.mockResolvedValue({ kind: "refused", mayHavePersisted: false, code: "MISSION_TARGET_REVISION_CONFLICT" });
  await render(); await act(async () => button("Revise target").click());
  const form = host.querySelector<HTMLFormElement>(".mgt-editor")!, reason = form.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Keep this draft reason"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(form.querySelector("fieldset")?.disabled).toBe(true); expect(reason.value).toBe("Keep this draft reason");
  h.model.list = { kind: "ready", targets: [{ ...target, revision: 2, title: "Latest canonical goal" }], totalCount: 1, hasMore: false };
  await render(); expect(host.querySelector(".mgt-editor")).toBe(form);
  await act(async () => form.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => button("Revise target").click());
  const latest = host.querySelector<HTMLFormElement>(".mgt-editor")!;
  expect(latest).not.toBe(form); expect(latest.querySelector("input")?.value).toBe("Latest canonical goal");
  expect(latest.querySelector("fieldset")?.disabled).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});
