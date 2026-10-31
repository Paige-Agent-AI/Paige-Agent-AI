import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSoloPlanningReminder } from "./soloPlanningReminder";
import { readWeeklyPlanningSource } from "../operations/operations-weekly-source";
import type { PlanItem } from "@/hooks/usePlanList";
vi.mock("../operations/operations-weekly-source", () => ({ readWeeklyPlanningSource: vi.fn() }));
const actorId = "e8000000-0000-4000-8000-000000000001", tenantId = "e8000000-0000-4000-8000-000000000002";
const itemId = "e8000000-0000-4000-8000-000000000003";
const metadata = () => ({ tenant_id: tenantId, plan_item_id: itemId, plan_id: null, source: "paige_planning",
  reminder_claimed_at: "2026-10-30T12:00:00.123456Z", scheduled_remind_at: "2026-10-30T11:00:00Z",
  claim_source_version: "2026-10-30T12:00:00.123456Z", remind_target: "assigned" });
const item = (): PlanItem => ({ id: itemId, tenant_id: tenantId, plan_id: null, item_type: "reminder",
  title: "Current authorized task", summary: null, status: "open", priority: "normal", assigned_to_user_id: actorId,
  contact_id: null, created_by: actorId, due_at: null, linked_action_id: null,
  remind_at: "2026-10-30T11:00:00+00:00", reminded_at: "2026-10-30T08:00:00.123456-04:00",
  remind_target: "assigned", updated_at: "2026-10-30T12:00:01.999999Z" });
const read = (m: unknown = metadata(), current = () => true) => readSoloPlanningReminder(m, { actorId, tenantId }, current);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(readWeeklyPlanningSource).mockResolvedValue({ kind: "verified", item: item() }); });
describe("original Planning reminder consumer", () => {
  it("reads current original prose; equivalent offsets retain microseconds and later row version is valid", async () => {
    expect(await read()).toEqual({ kind: "verified", item: item() });
    expect(readWeeklyPlanningSource).toHaveBeenCalledWith({ actorId, tenantId, itemId }, expect.any(Function));
  });
  for (const [label, change] of [
    ["legacy", () => ({ plan_item_id: itemId, source: "paige_planning" })],
    ["private metadata prose", () => ({ ...metadata(), title: "Untrusted private title" })],
    ["foreign tenant", () => ({ ...metadata(), tenant_id: actorId })],
    ["bad item", () => ({ ...metadata(), plan_item_id: "wrong" })],
    ["invalid calendar", () => ({ ...metadata(), reminder_claimed_at: "2026-02-30T12:00:00Z" })],
    ["overflow hour", () => ({ ...metadata(), reminder_claimed_at: "2026-10-30T24:00:00Z" })],
    ["missing timezone", () => ({ ...metadata(), reminder_claimed_at: "2026-10-30T12:00:00" })],
    ["excess precision", () => ({ ...metadata(), reminder_claimed_at: "2026-10-30T12:00:00.1234567Z" })],
    ["bad claim version", () => ({ ...metadata(), claim_source_version: "unknown" })],
  ] as const) it(`withholds ${label} before any resource read`, async () => {
    expect(await read(change())).toEqual({ kind: "unavailable" }); expect(readWeeklyPlanningSource).not.toHaveBeenCalled();
  });
  for (const [label, change] of [
    ["different microsecond", { reminded_at: "2026-10-30T12:00:00.123457Z" }],
    ["retimed", { remind_at: "2026-10-30T11:01:00Z" }],
    ["unclaimed", { reminded_at: null }], ["cancelled", { status: "cancelled" }], ["done", { status: "done" }],
    ["different target", { remind_target: "team" }], ["foreign row", { tenant_id: actorId }],
    ["different plan", { plan_id: itemId }], ["different item", { id: actorId }],
  ] as const) it(`withholds ${label} after the current original read`, async () => {
    vi.mocked(readWeeklyPlanningSource).mockResolvedValue({ kind: "verified", item: { ...item(), ...change } });
    expect(await read()).toEqual({ kind: "unavailable" });
  });
  it("withholds original reader refusal and transport failure", async () => {
    vi.mocked(readWeeklyPlanningSource).mockResolvedValueOnce({ kind: "unavailable" }).mockRejectedValueOnce(new Error("transport"));
    expect(await read()).toEqual({ kind: "unavailable" }); expect(await read()).toEqual({ kind: "unavailable" });
  });
  it("retires a late result on context loss without exposing cached prose", async () => {
    let current = true;
    vi.mocked(readWeeklyPlanningSource).mockImplementationOnce(async () => { current = false; return { kind: "verified", item: item() }; });
    expect(await read(metadata(), () => current)).toEqual({ kind: "unavailable" });
  });
  it("captures occurrence metadata before awaiting the original resource", async () => {
    const m = metadata();
    vi.mocked(readWeeklyPlanningSource).mockImplementationOnce(async () => { m.plan_item_id = actorId; m.reminder_claimed_at = "2026-10-30T12:00:00.123457Z"; return { kind: "verified", item: item() }; });
    expect((await read(m)).kind).toBe("verified");
  });
});
