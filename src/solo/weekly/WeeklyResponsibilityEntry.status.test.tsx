import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WeeklyCheck } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import type { WeeklyOwnerRead } from "./weekly-owner-read";

const h = vi.hoisted(() => ({ eligible: true, key: "test-owner-a:tenant-a", read: { status: "loading" } as WeeklyOwnerRead,
  enabled: [] as boolean[], refresh: vi.fn(), control: vi.fn() }));
vi.mock("./useWeeklyResponsibility", () => ({ useWeeklyOwnerAudience: () => ({ eligible: h.eligible, key: h.key }),
  useWeeklyResponsibility: (enabled: boolean) => { h.enabled.push(enabled); return { read: h.read, refresh: h.refresh, control: h.control }; } }));
vi.mock("./WeeklyResponsibilityPanel", () => ({ WeeklyResponsibilityPanel: () => <p>Original weekly inspection</p> }));
vi.mock("./WeeklyDraftComposer", () => ({ WeeklyDraftComposer: () => null }));
import { WeeklyResponsibilityEntry } from "./WeeklyResponsibilityEntry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  h.eligible = true; h.key = "test-owner-a:tenant-a"; h.read = { status: "loading" }; h.enabled = [];
  h.refresh.mockReset(); h.control.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const id = (n: number) => `e5050000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function check(): WeeklyCheck {
  return { automation_id: id(1), name: "Original weekly check", revision: 1, schedule_status: "scheduled",
    schedule: { weekday: 1, local_time: "09:00", timezone: "America/New_York" }, execution_availability: "held",
    execution_hold_reason: "trigger_unavailable", next_run_at: null, intended_next_run_at: null, last_run: null,
    last_verified_run: { event_id: id(2), act_id: id(3), receipt_id: id(4), observed_at: "2026-10-23T12:00:00Z",
      scheduled_for: "2026-10-23T12:00:00Z", schedule_revision: 1, status: "completed", truncated: false,
      counts: { open: 2, blocked: 0, overdue: 0, due_next_week: 1, undated: 1 } } };
}
function ready(checks: WeeklyCheck[], more = false): WeeklyOwnerRead {
  return { status: "ready", snapshot: { source: "canonical_process_and_act_receipts", read_at: "2026-10-24T12:00:00Z",
    business_time_zone: { state: "missing", zone: null }, limit: 50, has_more: more, checks } };
}
async function render(props: { showOutcome?: boolean; hideEmpty?: boolean } = { showOutcome: true }) {
  await act(async () => root.render(<MemoryRouter><WeeklyResponsibilityEntry {...props} /></MemoryRouter>));
}
const caption = () => host.querySelector('[data-weekly-entry-outcome]');
it("opts the existing Overview controller into a read and refreshes the same original inspection on entry", async () => {
  h.read = ready([check()]); await render(); expect(h.enabled).toEqual([true]);
  expect(caption()?.textContent).toContain("Verified result available");
  const open = host.querySelector<HTMLButtonElement>('button[aria-label="Weekly responsibility"]')!;
  expect(open.getAttribute("aria-describedby")).toBe(caption()?.id);
  await act(async () => open.click()); expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Original weekly inspection");
  expect(h.control).not.toHaveBeenCalled();
});
it.each(["loading", "unavailable", "refused"] as const)("keeps %s distinct from empty and any prior result", async status => {
  h.read = ready([check()]); await render(); h.read = { status }; await render();
  expect(caption()?.textContent).toBe(status === "loading" ? "Checking weekly status…" : status === "refused" ? "Owner access needed" : "Status unverified");
  expect(caption()?.textContent).not.toContain("Verified result available"); expect(h.control).not.toHaveBeenCalled();
});
it("adds no empty-result clutter or success claim", async () => {
  h.read = ready([]); await render(); expect(caption()).toBeNull();
  expect(host.querySelector('button[aria-label="Weekly responsibility"]')).toBeTruthy();
});
it.each(["unknown", "failed"] as const)("preserves a newer %s attempt beside an older verified result", async status => {
  const row = check(); row.last_run = { event_id: id(5), act_id: id(6), scheduled_for: "2026-10-24T12:00:00Z", status };
  h.read = ready([row]); await render(); expect(caption()?.textContent).toContain("Needs review");
  expect(caption()?.textContent).toContain("Earlier result verified");
  expect(caption()?.getAttribute("title")).toContain("Oct 23");
  expect(caption()?.getAttribute("title")).toContain("UTC");
  expect(caption()?.textContent).not.toContain("Verified result available");
});
it("cannot promote a completed-looking attempt without a verified result", async () => {
  const row = check(); row.last_verified_run = null;
  row.last_run = { event_id: id(5), act_id: id(6), scheduled_for: "2026-10-24T12:00:00Z", status: "completed" };
  h.read = ready([row]); await render(); expect(caption()?.textContent).toBe("No verified result");
});
it("labels bounded coverage and does not manufacture the unseen history", async () => {
  h.read = ready([check()], true); await render(); expect(caption()?.textContent).toContain("Shown checks");
  expect(caption()?.getAttribute("title")).toContain("Other responsibilities may not be shown");
});
it("does not turn bounded empty coverage into proof that no other responsibilities exist", async () => {
  h.read = ready([], true); await render(); expect(caption()?.textContent).toBe("Shown checks · No verified result");
  expect(caption()?.getAttribute("title")).toContain("Other responsibilities may not be shown");
});
it("does not call a verified result earlier when the failed occurrence is older", async () => {
  const row = check(); row.last_run = { event_id: id(5), act_id: id(6), scheduled_for: "2026-10-22T12:00:00Z", status: "failed" };
  h.read = ready([row]); await render(); expect(caption()?.textContent).toBe("Needs review");
  expect(caption()?.getAttribute("title")).toContain("Oct 23");
});
it("keeps default Chat request-driven and first-value hideEmpty unchanged", async () => {
  h.read = ready([]); await render({}); expect(h.enabled).toEqual([false]); expect(caption()).toBeNull();
  await render({ hideEmpty: true }); expect(h.enabled.at(-1)).toBe(true); expect(host.textContent).toBe("");
});
it("retires private summary when current audience or workspace changes", async () => {
  h.read = ready([check()]); await render(); h.key = "test-owner-b:tenant-b"; h.read = { status: "loading" }; await render();
  expect(caption()?.textContent).toBe("Checking weekly status…"); h.eligible = false; await render();
  expect(host.textContent).toBe(""); expect(h.control).not.toHaveBeenCalled();
});
