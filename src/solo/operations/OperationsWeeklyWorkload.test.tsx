import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsWeek } from "./OperationsWeek";

vi.mock("../data/useBusinessTimeZone", async original => ({ ...await original<typeof import("../data/useBusinessTimeZone")>(),
  useBusinessCalendarDay: () => ({ day: { kind: "configured", zone: "America/New_York", date: "2026-10-29" }, refresh: vi.fn() }) }));
let container: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const member = { user_id: "owner-a", membership_id: "member-a", status: "active", full_name: "Morgan Reed" } as TeamMemberRecord;
const plan = { id: "plan-work", tenant_id: "test-tenant", assigned_to_user_id: "owner-a", title: "Review client delivery", item_type: "task",
  due_at: "2026-10-30T14:00:00Z", remind_at: null, status: "blocked", updated_at: "2026-10-28T12:00:00Z" } as PlanItem;
const task = { id: "crm-work", tenant_id: "test-tenant", user_id: "owner-a", title: "Prepare workshop", status: "pending",
  due_date: "2026-10-29T14:00:00Z", estimated_minutes: 90, updated_at: "2026-10-28T12:00:00Z" } as CrmWorkRecord;
const inspectPlan = vi.fn(), inspectTask = vi.fn();
const mount = async (items = [plan], tasks = [task], members = [member], tenantId = "test-tenant") => {
  await act(async () => root.render(<OperationsWeek tenantId={tenantId} items={items} tasks={tasks} members={members}
    onInspectItem={inspectPlan} onInspectTask={inspectTask} />));
};
const review = () => container.querySelector<HTMLDetailsElement>(".ops-week-review")!;
const result = () => container.querySelector(".ops-week-review-result")?.textContent;
const input = (label: string) => [...review().querySelectorAll<HTMLInputElement>("input")]
  .find(node => node.getAttribute("aria-label") === label || node.closest("label")?.textContent?.startsWith(label))!;
const change = async (node: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const prototype = node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};
const selectPerson = () => change(review().querySelector("select")!, member.user_id);

it("mounts the review inside the original week and requires a current roster selection", async () => {
  await mount();
  expect(review().open).toBe(false); expect(result()).toBeUndefined();
  expect(input("Hours available").disabled).toBe(true);
  expect(review().textContent).toContain("Calendar availability and dependencies still need checking");
  await selectPerson();
  expect(result()).toContain("1 h 30 min estimated"); expect(result()).toContain("Confirm available hours");
  expect(review().textContent).toContain("1 estimate needs confirmation");
  expect(review().textContent).toContain("1 blocked commitment");
});
it("compares corrected estimates, announces excess effort and never changes the original records", async () => {
  await mount(); await selectPerson(); await change(input("Hours available"), "2");
  await change(input(`Estimated minutes: ${plan.title}`), "60");
  expect(result()).toContain("2 h 30 min estimated / 2 h entered capacity");
  expect(result()).toContain("exceeds your budget by 30 min");
  await change(input(`Estimated minutes: ${task.title}`), "30");
  expect(result()).toContain("1 h 30 min estimated / 2 h entered capacity");
  expect(result()).toContain("Timing, other work and dependencies still need review");
  expect(task.estimated_minutes).toBe(90); expect(plan.due_at).toBe("2026-10-30T14:00:00Z");
});
it("opens exact original inspectors and resetting returns to saved estimates", async () => {
  inspectPlan.mockReset(); inspectTask.mockReset(); await mount(); await selectPerson();
  await change(input(`Estimated minutes: ${task.title}`), "15");
  const rows = review().querySelectorAll<HTMLButtonElement>("li button");
  await act(async () => { rows[0].click(); rows[1].click(); });
  expect(inspectTask).toHaveBeenCalledExactlyOnceWith(task); expect(inspectPlan).toHaveBeenCalledExactlyOnceWith(plan);
  await act(async () => [...review().querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Reset review inputs")!.click());
  expect(input(`Estimated minutes: ${task.title}`).value).toBe("90"); expect(input("Hours available").value).toBe("");
  expect(review().textContent).toContain("No time has been reserved or action authorized");
});
it("does not compare partial or invalid estimates as a feasible plan", async () => {
  await mount(); await selectPerson(); await change(input("Hours available"), "0.1");
  expect(input("Hours available").getAttribute("aria-invalid")).toBe("true");
  expect(result()).not.toContain("entered capacity");
  await change(input("Hours available"), "10"); await change(input(`Estimated minutes: ${task.title}`), "");
  expect(result()).toContain("missing estimates prevent a complete comparison");
  await change(input(`Estimated minutes: ${plan.title}`), "-1");
  expect(input(`Estimated minutes: ${plan.title}`).getAttribute("aria-invalid")).toBe("true");
  expect(result()).not.toContain("Estimated effort is within");
});
it("does not borrow a person's entered capacity or revised effort after selection changes", async () => {
  const other = { ...member, membership_id: "member-b", user_id: "owner-b", full_name: "Alex Lane" };
  await mount([plan], [task], [member, other]); await selectPerson();
  await change(input("Hours available"), "10"); await change(input(`Estimated minutes: ${task.title}`), "15");
  await change(review().querySelector("select")!, other.user_id);
  expect(input("Hours available").value).toBe(""); expect(review().querySelectorAll("li")).toHaveLength(0);
  await selectPerson(); expect(input(`Estimated minutes: ${task.title}`).value).toBe("90");
});
it.each(["version", "estimate", "title", "roster"])("discards stale review inputs when original %s changes", async field => {
  await mount(); await selectPerson(); await change(input("Hours available"), "10");
  await change(input(`Estimated minutes: ${task.title}`), "15");
  await mount([plan], [{ ...task, ...(field === "version" ? { updated_at: "2026-10-29T13:00:00Z" }
    : field === "estimate" ? { estimated_minutes: 120 } : field === "title" ? { title: "Changed original work" } : {}) }],
    field === "roster" ? [] : [member]);
  expect(result()).toBeUndefined();
  if (field !== "roster") expect(review().querySelector("select")!.value).toBe("");
  else expect(review().textContent).toContain("roster is unavailable");
});
it("starts a new review on week changes, account changes and reload", async () => {
  await mount(); await selectPerson(); await change(input("Hours available"), "10");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Next work week"]')!.click());
  expect(result()).toBeUndefined();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "This week")!.click());
  await selectPerson(); expect(input("Hours available").value).toBe("");
  await change(input("Hours available"), "10");
  await mount([{ ...plan, tenant_id: "test-tenant-b", title: "Other business work" }], [], [member], "test-tenant-b");
  expect(container.textContent).not.toContain(plan.title); expect(result()).toBeUndefined();
  await act(async () => root.unmount()); root = createRoot(container); await mount();
  await selectPerson(); expect(input("Hours available").value).toBe("");
});
