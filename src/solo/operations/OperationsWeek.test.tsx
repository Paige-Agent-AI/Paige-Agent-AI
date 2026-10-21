import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { BusinessCalendarDay } from "../data/useBusinessTimeZone";
import { OperationsWeek } from "./OperationsWeek";

const h = vi.hoisted(() => ({ day: { kind: "configured", zone: "America/New_York", date: "2026-10-21" } as BusinessCalendarDay, refresh: vi.fn() }));
vi.mock("../data/useBusinessTimeZone", async original => ({ ...await original<typeof import("../data/useBusinessTimeZone")>(), useBusinessCalendarDay: () => ({ day: h.day, refresh: h.refresh }) }));
let container: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { h.day = { kind: "configured", zone: "America/New_York", date: "2026-10-21" }; h.refresh.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const record = { id: "original", tenant_id: "tenant-a", title: "Confirm the handoff", item_type: "task", status: "open",
  due_at: "2026-10-21T14:00:00Z", remind_at: null, assigned_to_user_id: null } as PlanItem;
const mount = async (items = [record], tenantId = "tenant-a", inspect = vi.fn()) => {
  await act(async () => root.render(<OperationsWeek tenantId={tenantId} items={items} tasks={[]} onInspectItem={inspect} />));
  return inspect;
};
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes(text));
const control = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it("opens the exact original saved work and identifies its deadline source", async () => {
  const inspect = await mount(); await act(async () => button(record.title)!.click());
  expect(inspect).toHaveBeenCalledExactlyOnceWith(record);
  expect(container.textContent).toContain("Deadline · Planning");
  expect(container.textContent).toContain("America/New_York");
  expect(container.textContent).toContain("do not reserve Calendar time");
});
it("browses the next week and returns without changing or rescheduling the original record", async () => {
  const inspect = await mount(); await act(async () => control("Next work week").click());
  expect(container.textContent).toContain("Oct 26–Nov 1, 2026"); expect(button(record.title)).toBeUndefined();
  await act(async () => button("This week")!.click()); expect(button(record.title)).toBeTruthy();
  expect(record.due_at).toBe("2026-10-21T14:00:00Z"); expect(inspect).not.toHaveBeenCalled();
});
it("reveals a weekend commitment rather than dropping it from the business week", async () => {
  await mount([{ ...record, due_at: "2026-10-25T14:00:00Z" }]);
  expect(container.querySelector('time[datetime="2026-10-25"]')).toBeTruthy(); expect(button(record.title)).toBeTruthy();
});
it("renders a saved reminder as a reminder rather than a task deadline or completed effect", async () => {
  await mount([{ ...record, item_type: "reminder", due_at: "2026-10-20T14:00:00Z", remind_at: "2026-10-22T14:00:00Z" }]);
  expect(button(record.title)?.textContent).toContain("Reminder · Planning");
  expect(container.textContent).not.toContain("Deadline · Planning"); expect(container.textContent).not.toContain("Delivered");
});
it.each(["loading", "missing", "invalid", "refused", "unreadable", "no_workspace"] as const)("withholds private work positions for calendar state %s and offers only a reader retry", async reason => {
  h.day = { kind: "withheld", reason, canSet: false }; const inspect = await mount();
  expect(container.textContent).not.toContain(record.title); expect(container.querySelector("time")).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeTruthy();
  if (reason === "loading") expect(button("Refresh business calendar")).toBeUndefined();
  else { await act(async () => button("Refresh business calendar")!.click()); expect(h.refresh).toHaveBeenCalledTimes(1); }
  expect(inspect).not.toHaveBeenCalled();
});
it("remounts the week selection on a tenant change and does not resurrect the old tenant's selected offset", async () => {
  await mount(); await act(async () => control("Next work week").click());
  const other = { ...record, tenant_id: "tenant-b", title: "Other original work" };
  await mount([other], "tenant-b"); expect(container.textContent).not.toContain(record.title);
  expect(button(other.title)).toBeTruthy(); expect(button("This week")?.disabled).toBe(true);
  await mount(); expect(button(record.title)).toBeTruthy(); expect(button("This week")?.disabled).toBe(true);
});
it("reports undated and malformed original times without pretending the week contains them", async () => {
  await mount([{ ...record, due_at: null }, { ...record, id: "invalid", due_at: "not-a-date" }]);
  expect(container.textContent).toContain("0 dated commitments"); expect(container.textContent).toContain("1 active item needs a saved date");
  expect(container.textContent).toContain("1 saved date is unavailable"); expect(button(record.title)).toBeUndefined();
});
