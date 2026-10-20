import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeeklyResponsibilityPanel } from "./WeeklyResponsibilityPanel";
import type { WeeklyOwnerRead } from "./weekly-owner-read";
import type { WeeklyCommitmentSnapshot } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";

const prepare = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: prepare }));
let root: Root, container: HTMLDivElement;
beforeEach(() => { prepare.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const id = "11111111-1111-4111-8111-111111111111";
function snapshot(): WeeklyCommitmentSnapshot {
  return { source: "canonical_process_and_act_receipts", read_at: "2026-10-13T13:00:00Z", business_time_zone: { state: "configured", zone: "America/New_York" }, limit: 50, has_more: false, checks: [] };
}
async function render(read: WeeklyOwnerRead) {
  await act(async () => root.render(<MemoryRouter><WeeklyResponsibilityPanel read={read} refresh={() => {}} pathname="/solo/42/paige/chat" /></MemoryRouter>));
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === text);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
it("review prepares only a local exact-schedule request and cannot authorize or register it", async () => {
  await render({ status: "ready", snapshot: snapshot() });
  await click("Prepare a weekly responsibility");
  await click("Review proposal");
  expect(container.textContent).toContain("Local proposal only");
  expect(container.textContent).toContain("America/New_York");
  expect(Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Authorize schedule unavailable")?.disabled).toBe(true);
  expect(prepare).not.toHaveBeenCalled();
  await click("Put request in Chat");
  expect(prepare).toHaveBeenCalledWith(expect.stringContaining("every Monday at 09:00 in America/New_York"));
  expect(prepare).toHaveBeenCalledWith(expect.stringContaining("proposal only"));
  expect(container.textContent).toContain("Nothing has been registered or authorized");
  await click("Discard proposal");
  expect(container.querySelector("form")).toBeNull();
});
it("unknown latest attempt, older verified check and current source navigation remain separate", async () => {
  const value = snapshot();
  value.checks.push({ automation_id: id, name: "Weekly check", revision: 2, schedule_status: "scheduled", schedule: { weekday: 1, local_time: "09:00", timezone: "America/New_York" }, execution_availability: "held", execution_hold_reason: "trigger_off", next_run_at: null, intended_next_run_at: "2026-10-19T13:00:00Z",
    last_run: { event_id: id, act_id: id, scheduled_for: "2026-10-12T13:00:00Z", status: "unknown" },
    last_verified_run: { event_id: id, act_id: id, receipt_id: id, scheduled_for: "2026-10-05T13:00:00Z", observed_at: "2026-10-05T13:01:00Z", schedule_revision: 1, status: "completed", truncated: false,
      counts: { open: 1, blocked: 1, overdue: 0, due_next_week: 0, undated: 1 }, source_items: [{ id, kind: "task", title: "Review original work", status: "blocked", priority: "high", due_at: null }] } });
  await render({ status: "ready", snapshot: value });
  expect(container.textContent).toContain("Awaiting attention");
  expect(container.textContent).toContain("must be reconciled before any replay");
  expect(container.textContent).toContain("did not complete or change the underlying tasks");
  expect(container.textContent).toContain("No executable next run is available");
  expect(container.querySelector('a[href*="weeklySource=planning_item"]')?.getAttribute("href")).toBe(`/solo/42/operations/work?weeklySource=planning_item&item=${id}`);
  expect(container.textContent).toContain(id);
  for (const name of ["Pause unavailable", "Change unavailable", "Resume unavailable", "Cancel unavailable"]) {
    expect(Array.from(container.querySelectorAll("button")).find(b => b.textContent === name)?.disabled).toBe(true);
  }
});
it("permission and failed read clear all private result content and never claim an empty schedule", async () => {
  for (const status of ["refused", "unavailable", "loading"] as const) {
    await render({ status });
    expect(container.textContent).not.toContain("No weekly responsibility is registered");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href*="weeklySource"]')).toBeNull();
  }
});
