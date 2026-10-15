import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MissionTargetEditor } from "./MissionTargetEditor";
import type { MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";
import type { TargetMetricRead } from "./mission-target-client";

const target: MissionTarget = { id: "44444444-4444-4444-8444-444444444444", tenant_id: "22222222-2222-4222-8222-222222222222", mission_id: "33333333-3333-4333-8333-333333333333", title: "Recorded cash target", revision: 1, state: "active",
  metric: { key: "sales.cash.recorded_received", version: "1.0.0", unit: "currency_minor", value_kind: "currency_totals", currency: "usd", dimensions: {}, range_key: "quarter", semantics: "event_timestamp_cohort", business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least", desired_value: "1000", upper_value: null };
const metadata = (expires: number): TargetMetricRead => ({ kind: "ready", metric: { label: "Recorded receipts", definition: "Canonical recorded receipts", values: { kind: "currency_totals", by_currency: [] },
  unit: "currency_minor", dimensions: {}, range: { semantics: "event_timestamp_cohort" }, reference_expires_at: new Date(expires).toISOString(), evidence_ref: "aneb_v1_" + "c".repeat(64) } } as TargetMetricRead);
let root: Root, host: HTMLDivElement;
const save = vi.fn(async () => {}), read = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); save.mockClear(); read.mockReset(); read.mockResolvedValue(metadata(Date.now() + 60000)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async () => { await act(async () => root.render(<MissionTargetEditor actorId="11111111-1111-4111-8111-111111111111" tenantId={target.tenant_id} missionId={target.mission_id} missionRevision={3} target={target} busy={false} readMetric={read} onSave={save} onCancel={() => {}} />)); };
async function fill(label: string, value: string) {
  const control = [...host.querySelectorAll("label")].find(l => l.querySelector("span")?.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async () => { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
it("allows an explicit prospective currency target with no recorded bucket without inventing actuals", async () => {
  await render(); await fill("Target value", "12.34"); await fill("Currency", "USD"); await fill("Why this target", "Reviewed prospective goal"); await submit();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ expected_mission_revision: 3, expected_target_revision: 1,
    definition: expect.objectContaining({ desired_value: "1234", metric: expect.objectContaining({ currency: "usd" }) }) }) }));
  expect(host.textContent).toContain("Actuals stay unavailable"); expect(host.textContent).not.toContain("Target met");
});
it("refuses expired definition evidence and provides an explicit fresh read", async () => {
  read.mockResolvedValueOnce(metadata(Date.now() - 1));
  await render(); await fill("Why this target", "Review definition"); await submit();
  expect(save).not.toHaveBeenCalled(); expect(host.textContent).toContain("Refresh the measurement definition");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Refresh measurement definition")!.click());
  await submit(); expect(save).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
});
