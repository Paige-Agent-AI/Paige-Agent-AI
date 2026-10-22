import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeeklyResponsibilityPanel } from "./WeeklyResponsibilityPanel";
import type { WeeklyFutureControl, WeeklyOwnerRead } from "./weekly-owner-read";
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
function recordedSnapshot() {
  const data = snapshot();
  data.checks.push({ automation_id: id, name: "Weekly check", revision: 2, schedule_status: "paused", schedule: { weekday: 1, local_time: "09:00", timezone: "UTC" },
    execution_availability: "held", execution_hold_reason: "paused", next_run_at: null, intended_next_run_at: null, last_run: null, last_verified_run: null });
  return data;
}
async function render(read: WeeklyOwnerRead, control?: WeeklyFutureControl) {
  await act(async () => root.render(<MemoryRouter><WeeklyResponsibilityPanel read={read} refresh={() => {}} control={control} pathname="/solo/42/paige/chat" /></MemoryRouter>));
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
  for (const name of ["Pause future checks", "Change unavailable", "Resume unavailable", "Cancel responsibility"]) {
    expect(Array.from(container.querySelectorAll("button")).find(b => b.textContent === name)?.disabled).toBe(true);
  }
});

it.each(["pause", "cancel"] as const)("reviews the exact responsibility before %s, and preserves owner cancellation", async action => {
  const data = recordedSnapshot(); data.checks[0].schedule_status = "scheduled";
  const control = vi.fn<WeeklyFutureControl>().mockResolvedValue({ status: "saved", snapshot: data });
  await render({ status: "ready", snapshot: data }, control);
  await click(action === "pause" ? "Pause future checks" : "Cancel responsibility");
  expect(control).not.toHaveBeenCalled(); expect(container.textContent).toContain("UTC");
  expect(container.textContent).toContain("An attempt already running can finish");
  expect(document.activeElement?.textContent).toBe("Keep current schedule");
  await click("Keep current schedule"); expect(control).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe(action === "pause" ? "Pause future checks" : "Cancel responsibility");
  await click(action === "pause" ? "Pause future checks" : "Cancel responsibility");
  await click(action === "pause" ? "Confirm pause" : "Confirm cancellation");
  expect(control).toHaveBeenCalledExactlyOnceWith(data.checks[0], action);
  expect(container.textContent).toContain("history is preserved");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Refresh weekly responsibility");
});

it("keeps unknown feedback visible when the controller withholds the unconfirmed record", async () => {
  const data = recordedSnapshot(); data.checks[0].schedule_status = "scheduled";
  const control = vi.fn<WeeklyFutureControl>().mockResolvedValue({ status: "unknown" });
  await render({ status: "ready", snapshot: data }, control); await click("Cancel responsibility"); await click("Confirm cancellation");
  await render({ status: "unavailable" }, control);
  expect(container.textContent).toContain("result is unknown");
  expect(container.textContent).toContain("Nothing will be repeated automatically");
  expect(control).toHaveBeenCalledTimes(1);
});

it("a replaced read retires the old control review", async () => {
  const data = recordedSnapshot(); data.checks[0].schedule_status = "scheduled";
  const control = vi.fn<WeeklyFutureControl>();
  await render({ status: "ready", snapshot: data }, control); await click("Cancel responsibility");
  const changed = structuredClone(data); changed.checks[0].revision++;
  await render({ status: "ready", snapshot: changed }, control);
  expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent === "Confirm cancellation")).toBe(false);
  expect(control).not.toHaveBeenCalled();
});
it("permission and failed read clear all private result content and never claim an empty schedule", async () => {
  for (const status of ["refused", "unavailable", "loading"] as const) {
    await render({ status });
    expect(container.textContent).not.toContain("No weekly responsibility is registered");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href*="weeklySource"]')).toBeNull();
  }
});
it("qualifies historical totals without inventing a missing reminder time", async () => {
  const data = recordedSnapshot();
  data.checks[0].last_verified_run = { event_id: id, act_id: id, receipt_id: id, observed_at: "2026-10-12T13:00:00Z", scheduled_for: "2026-10-12T13:00:00Z", schedule_revision: 1,
    status: "completed", truncated: false, observation_version: 1, counts: { open: 2, blocked: 0, overdue: 2, due_next_week: 0, undated: 0 },
    source_items: [{ id, kind: "reminder", title: "Historical reminder", status: "open", priority: "normal", due_at: "2020-01-01T00:00:00Z" }] };
  await render({ status: "ready", snapshot: data });
  expect(container.textContent).toContain("Historical totals: 2 overdue");
  expect(container.textContent).toContain("may include reminder dates");
  expect(container.textContent).toContain("Reminder time was not recorded");
  expect(container.textContent).not.toContain("not scheduled");
});
it("distinguishes corrected work deadlines from the reminder time observed at the check", async () => {
  const data = recordedSnapshot();
  data.checks[0].last_verified_run = { event_id: id, act_id: id, receipt_id: id, observed_at: "2026-10-12T13:00:00Z", scheduled_for: "2026-10-12T13:00:00Z", schedule_revision: 1,
    status: "completed", truncated: false, observation_version: 2, counts: { open: 2, blocked: 0, overdue: 1, due_next_week: 0, undated: 0 },
    source_items: [{ id, kind: "reminder", title: "Future reminder", status: "open", priority: "normal", due_at: null, remind_at: "2099-11-03T15:00:00Z" }] };
  await render({ status: "ready", snapshot: data });
  expect(container.textContent).toContain("Work deadlines: 1 overdue");
  expect(container.textContent).toContain("Reminder at the check:");
  expect(container.textContent).toContain("Nov 3");
  expect(container.textContent).not.toContain("Historical totals");
});
