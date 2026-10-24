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
  useWeeklyOwnerAudience: () => ({ eligible: harness.eligible, key: "actor:tenant", context: { activeUserId: "actor", activeTenantId: "tenant" } }) }));
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
it.each(["Chat", "Calendar"].flatMap(surface => ["pause", "authorize"].map(action => ({ surface, action }))))("$surface keeps its original dialog when Escape dismisses only $action review", async ({ surface, action }) => {
  const control = vi.fn();
  harness.read.mockReturnValue({ read: { status: "ready", snapshot: { source: "canonical_process_and_act_receipts",
    read_at: "2026-10-13T13:00:00Z", business_time_zone: { state: "configured", zone: "UTC" }, limit: 50, has_more: false,
    checks: [{ automation_id: "11111111-1111-4111-8111-111111111111", name: "Weekly check", revision: 2,
      schedule_status: action === "authorize" ? "requested" : "scheduled", schedule: { weekday: 1, local_time: "09:00", timezone: "UTC" },
      execution_availability: "available", execution_hold_reason: null, next_run_at: "2026-10-19T09:00:00Z",
      intended_next_run_at: null, last_run: null, last_verified_run: null }] } }, refresh: vi.fn(), control });
  await act(async () => root.render(<MemoryRouter>{surface === "Chat" ? <WeeklyResponsibilityEntry />
    : <WeeklyCalendarResponsibility>{slot => <section>{slot({ closeViewOptions: () => {}, returnFocus: () => {} })}</section>}</WeeklyCalendarResponsibility>}</MemoryRouter>));
  const opener = container.querySelector<HTMLButtonElement>(".e5-weekly-open")!;
  await act(async () => opener.click());
  const find = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
  await act(async () => document.querySelector<HTMLElement>(".e5-weekly-controls summary")!.click());
  const pause = find(action === "authorize" ? "Review authorization" : "Pause future checks"); await act(async () => pause.click());
  const keep = find(action === "authorize" ? "Not now" : "Keep current schedule"); expect(document.activeElement).toBe(keep);
  await act(async () => keep.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  expect(document.querySelector('[aria-label="Review future checks"]')).toBeNull();
  expect(document.activeElement).toBe(pause); expect(control).not.toHaveBeenCalled();
  await act(async () => pause.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
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
