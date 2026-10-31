import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SoloBooking, UseSoloCalendarResult } from "@/components/tenant-calendar/useSoloCalendar";
import { OperationsWeeklyWorkload } from "./OperationsWeeklyWorkload";
import { operationsWeek } from "./operations-week";
import type { TeamMemberRecord } from "../team-workspace-contract";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/components/tenant-calendar/useSoloCalendar", async original => ({
  ...await original<typeof import("@/components/tenant-calendar/useSoloCalendar")>(), useSoloCalendar: read,
}));
let container: HTMLDivElement, root: Root, state: UseSoloCalendarResult;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const booking = { id: "booking-a", host_user_id: "owner-a", title: "Client review", start_at: "2026-10-29T14:00:00Z",
  end_at: "2026-10-29T15:00:00Z", status: "confirmed" } as SoloBooking;
const members = [{ user_id: "owner-a", membership_id: "member-a", status: "active", full_name: "Morgan Reed" },
  { user_id: "owner-b", membership_id: "member-b", status: "active", full_name: "Alex Lane" }] as TeamMemberRecord[];
const week = operationsWeek("test-tenant", [], [], { kind: "configured", date: "2026-10-29", zone: "America/New_York" });
if (week.kind !== "ready") throw new Error("Invalid test week");
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  state = { bookings: [booking], phase: "ready", stale: false, lastSyncedAt: new Date("2026-10-29T13:00:00Z"), retry: vi.fn(async () => {}) } as unknown as UseSoloCalendarResult;
  read.mockReset().mockImplementation(() => state);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const mount = async (tenantId = "test-tenant", value: ReturnType<typeof operationsWeek> = week) => {
  if (value.kind !== "ready") throw new Error("Invalid test week");
  await act(async () => root.render(<OperationsWeeklyWorkload tenantId={tenantId} week={value} members={members} onInspectItem={vi.fn()} />));
};
const change = async (node: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
};
const click = async (label: string) => {
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click());
};
const start = async () => { await mount(); await change(container.querySelector("select")!, "owner-a"); await click("Check Calendar commitments"); };

it("reads only on request through the original agenda hook and preserves entered net capacity", async () => {
  await mount(); expect(read).not.toHaveBeenCalled();
  await change(container.querySelector("select")!, "owner-a"); expect(read).not.toHaveBeenCalled();
  const hours = container.querySelector<HTMLInputElement>('input[type="number"]')!;
  await change(hours, "8"); await click("Check Calendar commitments");
  expect(read).toHaveBeenCalledWith("test-tenant", "agenda", expect.any(Date));
  expect(container.querySelector(".ops-week-calendar")!.textContent).toContain("Client review");
  expect(container.textContent).toContain("Thu, Oct 29, 10:00 AM"); expect(hours.value).toBe("8");
  expect(container.textContent).toContain("entered work capacity already excludes appointments and is unchanged");
  await click("Hide Calendar commitments"); expect(container.querySelector(".ops-week-calendar")).toBeNull();
});
it.each(["loading", "refused", "stale", "unconfirmed"])("does not expose retained appointments as current after %s", async reason => {
  state = { ...state, ...(reason === "loading" ? { phase: "loading" as const } : reason === "refused" ? { phase: "error" as const, error: "permission denied" }
    : reason === "stale" ? { stale: true } : { lastSyncedAt: null }) };
  await start(); const calendar = container.querySelector(".ops-week-calendar")!;
  expect(calendar.textContent).not.toContain(booking.title); expect(calendar.textContent).not.toContain("0 recorded");
  expect(calendar.textContent).toContain(reason === "loading" ? "Reading Calendar" : "does not mean the week is free");
});
it("recovers through native retry and withholds a rejected refresh rather than promising success", async () => {
  state = { ...state, phase: "error", retry: vi.fn(async () => { state = { ...state, phase: "ready" }; }) };
  await start(); await click("Refresh Calendar"); await mount(); expect(state.retry).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".ops-week-calendar")!.textContent).toContain(booking.title);
  state = { ...state, retry: vi.fn(async () => { throw new Error("read failed"); }) };
  await mount(); await click("Refresh Calendar");
  expect(container.querySelector(".ops-week-calendar")!.textContent).not.toContain(booking.title);
  expect(container.textContent).toContain("does not mean the week is free");
});
it("requires a new explicit read after person, business or week changes and after reload", async () => {
  await start(); await change(container.querySelector("select")!, "owner-b");
  expect(container.querySelector(".ops-week-calendar")).toBeNull();
  await click("Check Calendar commitments"); expect(container.querySelector(".ops-week-calendar-list")!.children).toHaveLength(0);
  await mount("test-tenant-b"); expect(container.textContent).not.toContain(booking.title); expect(container.querySelector(".ops-week-calendar")).toBeNull();
  const next = operationsWeek("test-tenant", [], [], { kind: "configured", date: "2026-11-05", zone: "America/New_York" });
  await mount("test-tenant-b", next); expect(container.querySelector(".ops-week-calendar")).toBeNull();
  await act(async () => root.unmount()); root = createRoot(container); await mount(); expect(container.querySelector(".ops-week-calendar")).toBeNull();
});
