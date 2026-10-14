import { describe, expect, it } from "vitest";
import { parseWeeklySourceItems, projectWeeklyCommitmentChat, type WeeklyCommitmentSnapshot } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import { planningItemHref, reviewWeeklyProposal, weeklyStateLabel } from "./weekly-responsibility";

const id = "11111111-1111-4111-8111-111111111111";
describe("weekly responsibility private presentation", () => {
  it("accepts only bounded typed Planning references; malformed or duplicate evidence has no links", () => {
    const item = { id, kind: "task", title: "Review a delivery", status: "blocked", priority: "high", due_at: null };
    expect(parseWeeklySourceItems([item])).toEqual([item]);
    // PostgreSQL left(title,160) bounds Unicode characters, not UTF-16 code units.
    expect(parseWeeklySourceItems([{ ...item, title: "\u{1F4C5}".repeat(160) }])).toHaveLength(1);
    expect(parseWeeklySourceItems([{ ...item, title: "\u{1F4C5}".repeat(161) }])).toBeNull();
    for (const value of [[{ ...item, id: "crm:123" }], [item, item], [{ ...item, kind: "mission" }], Array(51).fill(item), [{ title: "private injection" }]]) {
      expect(parseWeeklySourceItems(value)).toBeNull();
    }
  });
  it("source links preserve only the current route address and typed UUID, never authority or raw row contents", () => {
    expect(planningItemHref("/solo/42/paige/chat", { kind: "planning_item", id })).toBe(`/solo/42/operations/work?weeklySource=planning_item&item=${id}`);
    expect(planningItemHref("/login", { kind: "planning_item", id })).toBeNull();
    expect(planningItemHref("/solo/42/paige/chat", { kind: "planning_item", id: "other?tenant=secret" })).toBeNull();
  });
  it("local proposals validate exact civil schedule and never invent next-run instants", () => {
    expect(reviewWeeklyProposal(1, "09:00", "America/New_York")).toEqual({ weekday: 1, local_time: "09:00", timezone: "America/New_York" });
    for (const [day, time, zone] of [[0, "09:00", "UTC"], [1, "25:00", "UTC"], [1, "09:00", "browser default"]] as const) {
      expect(reviewWeeklyProposal(day, time, zone)).toBeNull();
    }
  });
  it("unknown latest attempts cannot be presented as an older completed check", () => {
    expect(weeklyStateLabel("unknown")).toBe("Awaiting attention");
    expect(weeklyStateLabel("running")).toBe("Processing");
    expect(weeklyStateLabel("requested")).toBe("Awaiting approval");
  });
  it("model status remains minimized after adding private browser source references", () => {
    const snapshot = { source: "canonical_process_and_act_receipts", read_at: "2026-10-13T00:00:00Z", limit: 50, has_more: false,
      business_time_zone: { state: "configured", zone: "UTC" }, checks: [{ automation_id: id, last_verified_run: {
        receipt_id: id, source_items: [{ id, title: "PRIVATE SOURCE TITLE" }], counts: { open: 1 } } }] } as unknown as WeeklyCommitmentSnapshot;
    expect(projectWeeklyCommitmentChat(snapshot)).not.toContain("PRIVATE SOURCE TITLE");
    expect(projectWeeklyCommitmentChat(snapshot)).not.toContain("source_items");
    expect(projectWeeklyCommitmentChat(snapshot)).toContain("receipt_id");
  });
});
