import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Sessions from "./Sessions";
import type { ClientPortalSessionsState, PortalSession } from "@/hooks/useClientPortalSessions";

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0923000-0000-0000-0000-000000000002";
const f = vi.hoisted(() => ({
  state: null as unknown as ClientPortalSessionsState,
  slots: vi.fn(),
  color: "#26483e" as string | null,
}));
vi.mock("@/hooks/useClientPortalSessions", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalSessions")>()),
  useClientPortalSessions: () => f.state,
  fetchRescheduleSlots: (...a: unknown[]) => f.slots(...a),
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrand: () => ({ tenant_id: T, tenant_name: "Northwind Studio", primary_color: f.color, logo_url: null }),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const session = (id: string, startMs: number, extra: Partial<PortalSession> = {}): PortalSession => ({
  id, title: "Strategy call", start_at: iso(startMs), end_at: iso(startMs + HOUR), timezone: "UTC", status: "scheduled", kind: "single",
  location: { type: "zoom", label: "Zoom", join_url: "https://zoom.example.test/j/1", kind: "video" },
  calendar: { slug: "northwind-strategy", duration_min: 60, appointment_type_id: "type-60", accent: null },
  change: { can_cancel: true, can_reschedule: true, deadline: iso(startMs - HOUR), reason: null },
  ...extra,
});

let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app/sessions"]}>
      <Routes>
        <Route path="/app/sessions" element={<Sessions />} />
        <Route path="/app/messages" element={<p>Messages page</p>} />
        <Route path="/app" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
};
const buttons = (scope: ParentNode = document) => Array.from(scope.querySelectorAll("button"));
const button = (label: string, scope: ParentNode = document) => buttons(scope)
  .find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
const card = (scope: ParentNode, title: string) =>
  Array.from(scope.querySelectorAll("li")).find(li => li.querySelector("h3")?.textContent === title) as HTMLElement;
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  f.color = "#26483e";
  f.slots.mockResolvedValue({ slots: [iso(Date.now() + 50 * HOUR), iso(Date.now() + 51 * HOUR)], timezone: "UTC" });
  f.state = {
    upcoming: [session("s1", Date.now() + 26 * HOUR)], past: [], pastLoaded: false, pastLoading: false,
    hasMoreUpcoming: false, hasMorePast: false, loadingMore: false,
    loading: false, error: null, unavailable: false, multipleBusinesses: false, tenantId: T, scopeEpoch: 0, changes: {},
    refresh: vi.fn().mockResolvedValue(undefined), loadPast: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(true), reschedule: vi.fn().mockResolvedValue(true),
    retryChange: vi.fn().mockResolvedValue(true), dismissChange: vi.fn(),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
/** Pin "now" to local noon so today / tomorrow / within-a-day wording is deterministic. Timers stay real. */
const NOON = new Date(2026, 9, 19, 12, 0, 0).getTime();
const atNoon = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOON); };

it("shows an open session with its join link, its change deadline and both actions", async () => {
  await render();
  expect(host.querySelector("h1")?.textContent).toBe("Sessions");
  expect(host.textContent).toContain("Your sessions with Northwind Studio.");
  expect(host.textContent).toContain("Strategy call");
  expect(host.textContent).toMatch(/You can change this until /);
  const join = host.querySelector('a[href="https://zoom.example.test/j/1"]') as HTMLAnchorElement;
  expect(join.target).toBe("_blank");
  expect(join.rel).toContain("noopener");
  expect(button("Reschedule", host)).toBeDefined();
  expect(button("Cancel", host)).toBeDefined();
  // A compact header, never a hero banner.
  expect(host.querySelectorAll("h1")).toHaveLength(1);
});

it("on a closed window says so on one locked line, with the message link on that same line, and no change actions", async () => {
  atNoon();
  f.state.upcoming = [session("s1", NOON + 30 * 60_000, {
    change: { can_cancel: false, can_reschedule: false, deadline: iso(NOON - 30 * 60_000), reason: "WINDOW_CLOSED" },
  })];
  await render();
  expect(button("Reschedule", host)).toBeUndefined();
  expect(button("Cancel", host)).toBeUndefined();
  expect(host.textContent).not.toMatch(/You can change this until|Changes close in/);
  const closed = Array.from(host.querySelectorAll("p")).find(p => p.textContent?.startsWith("Changes closed at "))!;
  expect(closed).toBeDefined();
  expect(closed.querySelector("svg.lucide-lock")).not.toBeNull();
  const link = closed.parentElement!.querySelector('a[href="/app/messages"]');
  expect(link?.textContent).toContain("Message Northwind Studio");
});

it("states the change deadline in normal text, and within a day as time left", async () => {
  atNoon();
  f.state.upcoming = [session("s1", NOON + 4 * HOUR, {
    change: { can_cancel: true, can_reschedule: true, deadline: iso(NOON + 3 * HOUR + 10 * 60_000), reason: null },
  })];
  await render();
  const line = Array.from(host.querySelectorAll("p")).find(p => p.textContent === "Changes close in 3 hrs")!;
  expect(line).toBeDefined();
  expect(line.className).toContain("text-sm");
  expect(line.className).toContain("text-foreground");
  expect(line.className).not.toContain("text-muted-foreground");
  // On the action row: the line and the actions share one container.
  expect(line.parentElement!.querySelector('[data-testid="session-actions"]')).not.toBeNull();
});

it("in Upcoming shows time-relevant pills only, never 'Scheduled'", async () => {
  atNoon();
  f.state.upcoming = [
    session("live", NOON - 10 * 60_000, { title: "Live call" }),
    session("today", NOON + HOUR, { title: "Today call" }),
    session("tomorrow", NOON + 24 * HOUR, { title: "Tomorrow call" }),
    session("later", NOON + 5 * 24 * HOUR, { title: "Later call" }),
  ];
  await render();
  expect(card(host, "Live call").textContent).toContain("Happening now");
  expect(card(host, "Today call").textContent).toContain("Today · in 1 hr");
  expect(card(host, "Tomorrow call").textContent).toContain("Tomorrow");
  expect(card(host, "Later call").querySelector(".rounded-full")).toBeNull();
  expect(host.textContent).not.toContain("Scheduled");
});

it("makes Join the filled primary, in the business accent, when an online session is today or live", async () => {
  atNoon();
  f.state.upcoming = [
    session("today", NOON + HOUR, { title: "Today call", location: { type: "zoom", label: "Zoom", join_url: "https://zoom.example.test/j/today", kind: "video" } }),
    session("later", NOON + 5 * 24 * HOUR, { title: "Later call", location: { type: "zoom", label: "Zoom", join_url: "https://zoom.example.test/j/later", kind: "video" } }),
  ];
  await render();
  const today = host.querySelector('a[href="https://zoom.example.test/j/today"]') as HTMLAnchorElement;
  const later = host.querySelector('a[href="https://zoom.example.test/j/later"]') as HTMLAnchorElement;
  expect(today.className).toContain("bg-primary");
  expect(today.style.backgroundColor).not.toBe("");
  expect(later.className).not.toContain("bg-primary");
  expect(later.className).toContain("border-border");
  expect(later.style.backgroundColor).toBe("");
  // Reschedule stays outline and Cancel ghost beside it.
  const row = card(host, "Today call");
  expect(button("Reschedule", row)!.className).toContain("border");
  expect(button("Cancel", row)!.className).not.toContain("border-border");
});

it("never paints the accent on Join when the brand and the sessions disagree about the business", async () => {
  atNoon();
  f.state.tenantId = "e0923000-0000-0000-0000-0000000000ff";
  f.state.upcoming = [session("today", NOON + HOUR)];
  await render();
  const join = host.querySelector('a[href="https://zoom.example.test/j/1"]') as HTMLAnchorElement;
  expect(join.className).toContain("bg-primary");
  expect(join.style.backgroundColor).toBe("");
});

it("lays the actions on a two-column grid below 640px, with Cancel on its own row at the same left edge", async () => {
  await render();
  const actions = host.querySelector('[data-testid="session-actions"]')!;
  expect(actions.className).toMatch(/(^| )grid( |$)/);
  expect(actions.className).toContain("grid-cols-2");
  expect(actions.className).toContain("sm:flex");
  const cancel = button("Cancel", actions)!;
  expect(cancel.className).toContain("col-span-2");
  expect(cancel.className).toContain("justify-start");
  expect(cancel.className).toContain("px-0");
  expect(cancel.className).toContain("sm:px-4");
});

it("picks the location icon from the location kind, and a clock when the kind is missing", async () => {
  const at = (id: string, kind: string | undefined, label: string) => session(id, Date.now() + (26 + Number(id.slice(1))) * HOUR, {
    title: label, location: { type: "x", label, join_url: null, ...(kind ? { kind } : {}) } as PortalSession["location"],
  });
  f.state.upcoming = [at("k1", "video", "Video"), at("k2", "phone", "Phone"), at("k3", "in_person", "Office"), at("k4", "tbd", "TBD"), at("k5", undefined, "Unsaid")];
  await render();
  const icon = (title: string) => card(host, title).querySelector("p.inline-flex svg")!.getAttribute("class");
  expect(icon("Video")).toContain("lucide-video");
  expect(icon("Phone")).toContain("lucide-phone");
  expect(icon("Office")).toContain("lucide-map-pin");
  expect(icon("TBD")).toContain("lucide-map-pin");
  expect(icon("Unsaid")).toContain("lucide-map-pin");
  expect(icon("TBD")).not.toContain("lucide-clock");
});

it("uses a 12px weekday and month on the date tile and a medium-weight time line", async () => {
  await render();
  const tile = host.querySelector("li time")!;
  const [weekday, , month] = Array.from(tile.querySelectorAll("span"));
  expect(weekday.className).toContain("text-xs");
  expect(month.className).toContain("text-xs");
  expect(tile.innerHTML).not.toContain("text-[11px]");
  const timeLine = Array.from(host.querySelectorAll("li p")).find(p => p.className.includes("tabular-nums"))!;
  expect(timeLine.className).toContain("font-medium");
});

it("on a calendar with rescheduling off still allows cancelling and points the move to messages", async () => {
  f.state.upcoming = [session("s1", Date.now() + 26 * HOUR, {
    change: { can_cancel: true, can_reschedule: false, deadline: iso(Date.now() + 25 * HOUR), reason: "CALENDAR_UNAVAILABLE" },
  })];
  await render();
  expect(button("Reschedule", host)).toBeUndefined();
  expect(button("Cancel", host)).toBeDefined();
  expect(host.querySelector('a[href="/app/messages"]')).not.toBeNull();
});

it("reschedules from the drawer: slots for the booked service, day then time, the business accent on the act", async () => {
  // Fixed same-day UTC slots: relative-to-now slots straddle midnight at certain
  // wall-clock hours (CI-evenning flake), leaving the first day group with one
  // time button and times[1] undefined.
  f.slots.mockResolvedValue({ slots: ["2026-12-01T14:00:00.000Z", "2026-12-01T15:30:00.000Z"], timezone: "UTC" });
  await render();
  await click(button("Reschedule", host)!);
  expect(f.slots).toHaveBeenCalledTimes(1);
  expect(f.slots.mock.calls[0][0]).toMatchObject({ id: "s1", calendar: { slug: "northwind-strategy", appointment_type_id: "type-60" } });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Reschedule Strategy call");
  const confirm = button("Pick a new time", dialog)!;
  expect(confirm.disabled).toBe(true);
  const [dayGroup, timeGroup] = Array.from(dialog.querySelectorAll('[role="group"]'));
  // Days wrap on a grid, weekday over date; the chosen one in inverse fill.
  expect(dayGroup.className).toContain("grid-cols-3");
  expect(dayGroup.className).toContain("sm:grid-cols-5");
  expect(dayGroup.className).not.toContain("overflow-x-auto");
  const firstDay = dayGroup.querySelector("button")!;
  const [weekday, date] = Array.from(firstDay.querySelectorAll("span"));
  expect(weekday.textContent).toMatch(/^[A-Za-z]{2,4}\.?$/);
  expect(date.textContent).toMatch(/\d/);
  expect(firstDay.className).toContain("bg-foreground");
  expect(firstDay.className).toContain("text-background");
  expect(dialog.querySelector('[data-testid="reschedule-summary"]')).toBeNull();
  const times = timeGroup.querySelectorAll("button");
  await click(times[1]);
  expect(times[1].getAttribute("aria-pressed")).toBe("true");
  expect(times[1].className).toContain("bg-foreground");
  expect(times[1].className).toContain("text-background");
  expect(times[0].className).not.toContain("bg-foreground");
  const summary = dialog.querySelector('[data-testid="reschedule-summary"]')!;
  expect(summary.textContent).toMatch(/From .+ to .+/);
  expect(summary.querySelector("svg.lucide-arrow-right")).not.toBeNull();
  // The summary carries from → to; the button names the act once.
  const move = button("Move session", dialog)!;
  expect(move).toBeDefined();
  expect(buttons(dialog).some(b => /Move to/.test(b.textContent ?? ""))).toBe(false);
  expect(move.disabled).toBe(false);
  expect(move.style.backgroundColor).not.toBe("");
  const { slots } = await f.slots.mock.results[0].value;
  await click(move);
  expect(f.state.reschedule).toHaveBeenCalledWith("s1", slots[1]);
  expect(host.textContent).toMatch(/Moved Strategy call to .*calendar is updated/);
});

it("keeps the drawer open and reloads open times when the move is refused", async () => {
  (f.state.reschedule as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  // Fixed same-day UTC slots (same wall-clock determinism as the drawer test above).
  f.slots.mockResolvedValue({ slots: ["2026-12-01T14:00:00.000Z", "2026-12-01T15:30:00.000Z"], timezone: "UTC" });
  await render();
  await click(button("Reschedule", host)!);
  const dialog = document.querySelector('[role="dialog"]')!;
  const times = Array.from(dialog.querySelectorAll('[role="group"]'))[1].querySelectorAll("button");
  await click(times[0]);
  await click(button("Move session", dialog)!);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(f.slots).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toMatch(/Moved Strategy call/);
});

it("offers a message when the business has no other open times", async () => {
  f.slots.mockResolvedValue({ slots: [], timezone: "UTC" });
  await render();
  await click(button("Reschedule", host)!);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("No open times right now");
  expect(dialog.querySelector('a[href="/app/messages"]')).not.toBeNull();
});

it("cancels only after a confirm that names the session", async () => {
  await render();
  await click(button("Cancel", host)!);
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("Cancel Strategy call?");
  // On a phone the dialog keeps a 16px side margin and its rounded corners.
  expect(dialog.className).toContain("w-[calc(100%-2rem)]");
  expect(dialog.className).toMatch(/(^| )rounded-xl( |$)/);
  expect(dialog.className).not.toMatch(/(^| )w-full( |$)/);
  expect(f.state.cancel).not.toHaveBeenCalled();
  await click(button("Cancel session", dialog)!);
  expect(f.state.cancel).toHaveBeenCalledWith("s1");
  expect(host.textContent).toMatch(/Cancelled Strategy call on .*off Northwind Studio's calendar/);
});

it("keeping the session cancels nothing", async () => {
  await render();
  await click(button("Cancel", host)!);
  await click(button("Keep session", document.querySelector('[role="alertdialog"]')!)!);
  expect(f.state.cancel).not.toHaveBeenCalled();
});

it("on a refusal with no retry: the reason, a Message link as its action, Dismiss as quiet text, and the changes held", async () => {
  f.state.changes = { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "failed", error: "COMMS_PROVIDER_EXECUTION_DISABLED", actionsHeld: true } };
  await render();
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Changes can't be made online right now");
  const link = alert.querySelector('a[href="/app/messages"]')!;
  expect(link.textContent).toContain("Message Northwind Studio");
  const dismiss = button("Dismiss", alert)!;
  // Same row as the link, as a quiet text button (no outline, no fill).
  expect(dismiss.parentElement).toBe(link.parentElement);
  expect(dismiss.className).toContain("text-muted-foreground");
  expect(dismiss.className).not.toMatch(/border|bg-/);
  expect(button("Retry", host)).toBeUndefined();
  expect(button("Try again", host)).toBeUndefined();
  expect(button("Reschedule", host)).toBeUndefined();
  expect(button("Cancel", host)).toBeUndefined();
  expect(host.textContent).not.toMatch(/You can change this until/);
  await click(dismiss);
  expect(f.state.dismissChange).toHaveBeenCalledWith("s1");

  // Once the list has re-read, the server's own view decides again.
  f.state = { ...f.state, changes: { s1: { ...f.state.changes.s1, actionsHeld: false } } };
  await render();
  expect(host.querySelector('[role="alert"] a[href="/app/messages"]')).not.toBeNull();
  expect(button("Reschedule", host)).toBeDefined();
  expect(button("Cancel", host)).toBeDefined();
});

it("keeps Try again for a rate-limited refusal, and the session's actions", async () => {
  f.state.changes = { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "failed", error: "RATE_LIMITED" } };
  await render();
  const alert = host.querySelector('[role="alert"]')!;
  expect(button("Try again", alert)).toBeDefined();
  expect(alert.querySelector('a[href="/app/messages"]')).toBeNull();
  expect(button("Reschedule", host)).toBeDefined();
});

it("shows a refused change in the customer's words, and an unknown one with a safe retry", async () => {
  f.state.changes = { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "failed", error: "SESSION_CHANGE_WINDOW_CLOSED" } };
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Changes to this session have closed");
  expect(host.textContent).not.toContain("SESSION_CHANGE_WINDOW_CLOSED");
  expect(button("Retry", host)).toBeUndefined();

  f.state = { ...f.state, changes: { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "unconfirmed", error: null } } };
  await render();
  expect(host.textContent).toContain("Retrying won't change it twice");
  await click(button("Retry", host)!);
  expect(f.state.retryChange).toHaveBeenCalledWith("s1");
});

it("disables the actions while a change is in flight and says what is happening", async () => {
  f.state.changes = { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "sending", error: null } };
  await render();
  expect(host.textContent).toContain("Cancelling…");
  expect(button("Reschedule", host)!.disabled).toBe(true);
  expect(button("Cancel", host)!.disabled).toBe(true);
});

it("labels the booking's own time zone only when it reads differently", async () => {
  f.state.upcoming = [session("s1", Date.now() + 26 * HOUR, { timezone: "Asia/Tokyo" })];
  await render();
  const viewer = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (viewer !== "Asia/Tokyo") expect(host.textContent).toContain("in Tokyo time");
  f.state = { ...f.state, upcoming: [session("s1", Date.now() + 26 * HOUR, { timezone: viewer })] };
  await render();
  expect(host.textContent).not.toMatch(/ time$|in .* time/);
});

it("keeps past sessions collapsed until opened, then reads them", async () => {
  await render();
  const toggle = button("Past sessions", host)!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(f.state.loadPast).not.toHaveBeenCalled();
  await click(toggle);
  expect(f.state.loadPast).toHaveBeenCalledTimes(1);
  expect(button("Past sessions", host)!.getAttribute("aria-expanded")).toBe("true");
});

it("shows past sessions without any change actions", async () => {
  f.state.past = [session("p1", Date.now() - 48 * HOUR, { status: "done", change: { can_cancel: false, can_reschedule: false, deadline: null, reason: "NOT_SCHEDULED" } })];
  f.state.pastLoaded = true;
  await render();
  const toggle = button("Past sessions", host)!;
  await click(toggle);
  const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(region.textContent).toContain("Completed");
  // A compact divided row, not a card: date · title · time · status.
  const list = region.querySelector("ol")!;
  expect(list.className).toContain("divide-y");
  const row = list.querySelector("li")!;
  expect(row.className).not.toMatch(/rounded|bg-card|(^| )border( |$)|p-4/);
  expect(row.querySelector("time")?.getAttribute("dateTime")).toBe(f.state.past[0].start_at);
  expect(row.textContent).toContain("Strategy call");
  // Where it was, in the server's settled place-only wording, muted, with its icon.
  const place = row.querySelector('[data-testid="past-location"]')!;
  expect(place.textContent).toBe("Zoom");
  expect(place.className).toContain("text-muted-foreground");
  expect(place.querySelector("svg.lucide-video")).not.toBeNull();
  // The pill sits in a fixed-width column so the time column ends on one edge.
  const pillCol = row.querySelector('[data-testid="past-pill"]')!;
  expect(pillCol.className).toContain("w-24");
  expect(pillCol.className).toContain("shrink-0");
  expect(pillCol.textContent).toBe("Completed");
  expect(button("Reschedule", region)).toBeUndefined();
  expect(button("Cancel", region)).toBeUndefined();
});

it("routes an empty schedule to messaging the business, with no booking from here", async () => {
  f.state.upcoming = [];
  await render();
  expect(host.textContent).toContain("No upcoming sessions");
  expect(host.querySelector('a[href="/app/messages"]')?.textContent).toContain("Message Northwind Studio");
  expect(host.textContent).not.toMatch(/book a session/i);
});

it("uses one empty-state treatment for empty, unavailable and more than one business", async () => {
  const shell = () => {
    const h3 = host.querySelector("h3")!;
    let el: HTMLElement | null = h3;
    while (el && !el.className.includes("rounded-xl")) el = el.parentElement;
    return { box: el!.className, plate: el!.querySelector("span")!.className, heading: h3.className };
  };
  f.state.upcoming = [];
  await render();
  const empty = shell();
  f.state = { ...f.state, unavailable: true };
  await render();
  const unavailable = shell();
  f.state = { ...f.state, unavailable: false, multipleBusinesses: true };
  await render();
  const multiple = shell();
  expect(unavailable).toEqual(empty);
  expect(multiple).toEqual(empty);
  expect(empty.box).not.toContain("border-dashed");
});

it("shows loading, not an empty state, while the first read is in flight", async () => {
  f.state.loading = true; f.state.upcoming = []; f.state.tenantId = null;
  await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading your sessions");
  expect(host.textContent).not.toContain("No upcoming sessions");
});

it("explains an unavailable account with a way back home", async () => {
  f.state.unavailable = true; f.state.upcoming = [];
  await render();
  expect(host.textContent).toContain("Sessions aren't available on this account");
  expect(host.querySelector('a[href="/app"]')?.textContent).toContain("Back to Home");
});

it("explains more than one business with a way back home", async () => {
  f.state.multipleBusinesses = true; f.state.upcoming = [];
  await render();
  expect(host.textContent).toContain("more than one business");
  expect(host.querySelector('a[href="/app"]')?.textContent).toContain("Back to Home");
  expect(button("Reschedule", host)).toBeUndefined();
});

it("keeps loaded sessions on a failed refresh, with a retry", async () => {
  f.state.error = "We couldn't load your sessions. Check your connection and try again.";
  await render();
  expect(host.textContent).toContain("Strategy call");
  await click(button("Try again", host)!);
  expect(f.state.refresh).toHaveBeenCalled();
});

it("never paints the business accent when the brand and the sessions disagree about the business", async () => {
  f.state.tenantId = "e0923000-0000-0000-0000-0000000000ff";
  await render();
  await click(button("Reschedule", host)!);
  const dialog = document.querySelector('[role="dialog"]')!;
  const times = Array.from(dialog.querySelectorAll('[role="group"]'))[1].querySelectorAll("button");
  await click(times[0]);
  const move = button("Move session", dialog)!;
  expect(move.style.backgroundColor).toBe("");
});

/** Every quiet (outline / ghost) control on this page, by label. */
const QUIET = ["Reschedule", "Cancel", "Dismiss", "Show more upcoming", "Show earlier sessions", "Try again", "Retry"];
/** The tokens behind hover:bg-muted / hover:text-foreground, read from the real stylesheet. */
const tokenContrast = () => {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const block = (sel: string) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf("}", i)); };
  const hsl = (b: string, name: string) => {
    const m = b.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
    if (!m) throw new Error(`--${name} missing`);
    return m.slice(1).map(Number) as [number, number, number];
  };
  const lum = ([h, s0, l0]: [number, number, number]) => {
    const s1 = s0 / 100, l = l0 / 100, a = s1 * Math.min(l, 1 - l);
    const ch = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const [r, g, b] = [0, 8, 4].map(ch).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const light = block(":root"), dark = block(".dark");
  return {
    lightHover: ratio(hsl(light, "foreground"), hsl(light, "muted")),
    darkHover: ratio(hsl(dark, "foreground"), hsl(dark, "muted")),
    // The shared variant's hover fill under a dark label: the defect these overrides replace.
    lightShared: ratio(hsl(light, "foreground"), hsl(light, "secondary")),
  };
};

it("hovers every quiet button to muted with a foreground label, which clears 4.5:1 in both themes", async () => {
  f.state.hasMoreUpcoming = true; f.state.hasMorePast = true;
  f.state.error = "We couldn't load your sessions. Check your connection and try again.";
  f.state.upcoming = [session("s1", Date.now() + 26 * HOUR), session("s2", Date.now() + 30 * HOUR, { title: "Review" })];
  f.state.changes = { s2: { sessionId: "s2", action: "cancel", start: null, requestId: "r2", status: "unconfirmed", error: null } };
  await render();
  // The done banner's Dismiss.
  await click(button("Cancel", card(host, "Strategy call"))!);
  await click(button("Cancel session", document.querySelector('[role="alertdialog"]')!)!);
  await click(button("Past sessions", host)!);
  const seen = new Set<string>();
  for (const b of buttons(host)) {
    const label = b.textContent?.trim() ?? "";
    if (!QUIET.includes(label)) continue;
    seen.add(label);
    // The ChangeNotice / done-banner "Dismiss" text buttons are quiet text, not the variant; both are fine.
    if (!b.className.includes("hover:bg-")) { expect(b.className).toContain("hover:text-foreground"); continue; }
    expect(b.className, label).toContain("hover:bg-muted");
    expect(b.className, label).toContain("hover:text-foreground");
    expect(b.className, label).not.toContain("hover:bg-secondary");
  }
  expect([...seen].sort()).toEqual([...QUIET].sort());
  const c = tokenContrast();
  expect(c.lightShared).toBeLessThan(1.5);
  expect(c.lightHover).toBeGreaterThanOrEqual(4.5);
  expect(c.darkHover).toBeGreaterThanOrEqual(4.5);
});

it("words the deadline the same on every card: 'Change until' on a wide screen, the long form on a phone", async () => {
  await render();
  const row = card(host, "Strategy call");
  expect(row.querySelectorAll('[data-testid="session-actions"] > *')).toHaveLength(3);
  const short = row.querySelector('[data-testid="deadline-short"]')!;
  expect(short.textContent).toBe("Change until ");
  expect(short.className).toContain("hidden");
  expect(short.className).toContain("sm:inline");
  expect(row.textContent).toContain("You can change this until");

  // Two actions (no Join): the same wording, so neighbouring cards never disagree.
  f.state.upcoming = [session("s1", Date.now() + 26 * HOUR, { location: { type: "x", label: "Office", join_url: null, kind: "in_person" } })];
  await render();
  expect(host.querySelector('[data-testid="deadline-short"]')?.textContent).toBe("Change until ");
  expect(host.textContent).toContain("You can change this until");
});

it("loads with the Upcoming heading and cards the size of real ones", async () => {
  f.state.loading = true; f.state.upcoming = []; f.state.tenantId = null;
  await render();
  const sk = host.querySelector('[data-testid="sessions-skeleton"]')!;
  expect(sk.textContent).toContain("Upcoming");
  const cards = sk.querySelectorAll('[data-testid="session-skeleton-card"]');
  expect(cards).toHaveLength(2);
  // A 64px date tile, three text lines, then the bordered action row with a 44px control: a real card's height.
  expect(cards[0].className).toContain("p-4");
  expect(cards[0].querySelector(".h-16.w-14")).not.toBeNull();
  const actionRow = cards[0].querySelector(".border-t")!;
  expect(actionRow).not.toBeNull();
  expect(actionRow.querySelector(".h-11")).not.toBeNull();
});

it("hides the page subtitle when the page cannot be used on this account", async () => {
  f.state.unavailable = true; f.state.upcoming = [];
  await render();
  expect(host.textContent).not.toContain("Your sessions with");
  f.state = { ...f.state, unavailable: false, multipleBusinesses: true };
  await render();
  expect(host.textContent).not.toContain("Your sessions with");
});

it("on a phone keeps the closed line and its Message link as one unit, the link indented under the words", async () => {
  atNoon();
  f.state.upcoming = [session("s1", NOON + 30 * 60_000, {
    change: { can_cancel: false, can_reschedule: false, deadline: iso(NOON - 30 * 60_000), reason: "WINDOW_CLOSED" },
  })];
  await render();
  const unit = host.querySelector('[data-testid="closed-line"]')!;
  const [words, link] = Array.from(unit.children) as HTMLElement[];
  // The words are not their own 44px row on a phone; the link is the tap target, tucked under them.
  expect(words.className).not.toMatch(/(^| )min-h-\[44px\]/);
  expect(words.className).toContain("sm:min-h-[44px]");
  expect(link.tagName).toBe("A");
  expect(link.className).toContain("ml-[22px]");
  expect(link.className).toContain("-mt-1.5");
  expect(link.className).toContain("sm:ml-0");
});

it("indents a wrapped refusal past its icon", async () => {
  f.state.changes = { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "failed", error: "SESSION_CHANGE_WINDOW_CLOSED" } };
  await render();
  const text = host.querySelector('[role="alert"] [data-testid="refusal-text"]')!;
  expect(text.className).toContain("flex");
  expect(text.className).toContain("items-start");
  const icon = text.querySelector("svg")!;
  expect(icon.getAttribute("class")).toContain("shrink-0");
  expect(icon.getAttribute("class")).not.toContain("inline");
  expect(text.querySelector("span")!.textContent).toContain("Changes to this session have closed");
});

it("lets the location line wrap without an orphaned word", async () => {
  f.state.upcoming = [session("s1", Date.now() + 26 * HOUR, { location: { type: "in_person", label: "In person: 14 Harbour Lane, Suite 3", join_url: null, kind: "in_person" } })];
  await render();
  const label = Array.from(card(host, "Strategy call").querySelectorAll("span")).find(sp => sp.textContent === "In person: 14 Harbour Lane, Suite 3")!;
  expect(label.className).toContain("[text-wrap:pretty]");
});

it("never drops a refusal when the re-read takes its session out of Upcoming: it shows at the top, by name", async () => {
  f.state.upcoming = [session("s1", Date.now() + 26 * HOUR)];
  await render();
  // The session was cancelled elsewhere; the engine refused the move and the re-read moved it out of Upcoming.
  f.state = {
    ...f.state, upcoming: [],
    changes: { s1: { sessionId: "s1", action: "reschedule", start: iso(Date.now() + 50 * HOUR), requestId: "r1", status: "failed", error: "SESSION_NOT_CHANGEABLE" } },
  };
  await render();
  const orphan = host.querySelector('[data-testid="orphan-change"]')!;
  expect(orphan).not.toBeNull();
  expect(orphan.getAttribute("role")).toBe("alert");
  expect(orphan.textContent).toContain("Strategy call:");
  expect(orphan.textContent).toContain("already been cancelled or completed");
  expect(host.textContent).not.toMatch(/Moved Strategy call/);
  await click(button("Dismiss", orphan)!);
  expect(f.state.dismissChange).toHaveBeenCalledWith("s1");
});

it("says a session moved elsewhere in plain words, and keeps its own actions", async () => {
  f.state.changes = { s1: { sessionId: "s1", action: "cancel", start: null, requestId: "r1", status: "failed", error: "SESSION_MOVED" } };
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("This session was moved before your change went through");
  expect(host.querySelector('[data-testid="orphan-change"]')).toBeNull();
  expect(button("Reschedule", host)).toBeDefined();
  expect(button("Cancel", host)).toBeDefined();
});
