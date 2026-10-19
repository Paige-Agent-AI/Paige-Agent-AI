import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SoloCalendarWorkspace } from "@/components/tenant-calendar/SoloCalendarWorkspace";
import { WeeklyCalendarResponsibility } from "./WeeklyCalendarResponsibility";
import { WeeklyResponsibilityEntry } from "./WeeklyResponsibilityEntry";

const harness = vi.hoisted(() => ({ read: vi.fn(), eligible: true }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeUserId: "actor", activeTenantId: "tenant", loading: false, accountContextStatus: "ready", soloShellEnabled: true, isPlatformStaff: false }) }));
vi.mock("./useWeeklyResponsibility", () => ({ useWeeklyResponsibility: harness.read,
  useWeeklyOwnerAudience: () => ({ eligible: harness.eligible, key: "actor:tenant" }) }));
vi.mock("@/components/tenant-calendar/useSoloCalendar", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/tenant-calendar/useSoloCalendar")>();
  return { ...actual, useSoloCalendar: () => ({ bookings: [], calendars: [], seatsBySession: new Map(), conflicts: [], phase: "ready", error: null,
    stale: false, lastSyncedAt: null, calendarsError: null, colorForBooking: () => "", retry: vi.fn(), refresh: vi.fn() }) };
});
let root: Root, container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { harness.eligible = true; container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  harness.read.mockReset(); harness.read.mockReturnValue({ read: { status: "ready", snapshot: { checks: [], read_at: "2026-10-13T00:00:00Z", business_time_zone: { state: "configured", zone: "UTC" } } }, refresh: vi.fn() }); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
it("responsive Calendar inspection replaces its outer modal and retains one reader/dialog lifetime", async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/calendar"]}><WeeklyCalendarResponsibility>{slot =>
    <SoloCalendarWorkspace activeTenantId="tenant" connectionsHref="/solo/42/settings/connections" weeklyResponsibility={slot} />
  }</WeeklyCalendarResponsibility></MemoryRouter>));
  const viewOptions = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("View options"));
  expect(viewOptions).toBeTruthy();
  await act(async () => viewOptions!.click());
  const outer = container.querySelector('[role="dialog"]')!;
  expect(outer.textContent).toContain("View options");
  const inspect = outer.querySelector<HTMLButtonElement>(".e5-weekly-open")!;
  await act(async () => inspect.click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  const dialogs = document.querySelectorAll('[role="dialog"]');
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].textContent).toContain("Weekly responsibility");
  expect(dialogs[0].textContent).toContain("No weekly responsibility is registered");
  // Opening responsive options must not create a second owner-data controller.
  expect(harness.read.mock.calls.every(args => args.length === 0)).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  // Radix dispatches close autofocus from its deferred FocusScope cleanup.
  await vi.waitFor(() => expect(document.activeElement?.className).toContain("sc-board"));
});
it("Chat Escape returns focus to the existing weekly opener", async () => {
  await act(async () => root.render(<MemoryRouter><WeeklyResponsibilityEntry /></MemoryRouter>));
  const opener = container.querySelector<HTMLButtonElement>(".e5-weekly-open")!;
  await act(async () => opener.click());
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});
it("audience refusal removes Chat and the weekly dialog while preserving the Calendar child", async () => {
  const render = () => <MemoryRouter><WeeklyResponsibilityEntry /><WeeklyCalendarResponsibility>{slot => <section>Existing Calendar{slot({ closeViewOptions: () => {}, returnFocus: () => {} })}</section>}</WeeklyCalendarResponsibility></MemoryRouter>;
  await act(async () => root.render(render()));
  await act(async () => container.querySelector<HTMLButtonElement>(".e5-weekly-open")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  harness.eligible = false; await act(async () => root.render(render()));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(container.querySelector(".e5-weekly-open")).toBeNull();
  expect(container.textContent).toContain("Existing Calendar");
});
