import React, { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoloBooking, SoloCalendarMeta } from "./useSoloCalendar";
import { UNASSIGNED_CALENDAR as UNASSIGNED, findConflicts } from "./useSoloCalendar";

const setStatus = vi.fn(async () => ({ ok: true }) as { ok: boolean; message?: string });
const createBooking = vi.fn(async () => ({ ok: true }) as { ok: boolean; message?: string; category?: string });
type EditArg = { id: string; title: string; guestName: string | null; notes: string | null; calendarId: string };
// Typed so .mock.calls carries the real argument tuple (id, startAt, minutes) /
// (EditArg) rather than an empty tuple the assertions would have to cast blindly.
const reschedule = vi.fn<(id: string, startAt: Date, durationMinutes: number) => Promise<{ ok: boolean; message?: string }>>(
  async () => ({ ok: true }),
);
const edit = vi.fn<(input: EditArg) => Promise<{ ok: boolean; message?: string }>>(
  async () => ({ ok: true }),
);
const refresh = vi.fn();
const retry = vi.fn(async () => {});

const state: {
  bookings: SoloBooking[];
  calendars: SoloCalendarMeta[];
  phase: "loading" | "ready" | "error";
  error: string | null;
  stale: boolean;
  lastSyncedAt: Date | null;
} = { bookings: [], calendars: [], phase: "ready", error: null, stale: false, lastSyncedAt: null };

// Only the DATA BOUNDARY is faked. The component's rendering, drawer, keyboard
// handling and focus restoration are the real shipped code; the hook's own
// range/label/conflict logic is tested against the real implementation next door.
vi.mock("./useSoloCalendar", async () => {
  const actual = await vi.importActual<typeof import("./useSoloCalendar")>("./useSoloCalendar");
  return {
    ...actual,
    useSoloCalendar: () => {
      // Mirrors the real hook exactly: the class fold runs BEFORE the grid and
      // the conflict detector see anything, so these tests exercise the shipped
      // folding logic rather than a convenient stand-in for it.
      const folded = actual.foldClassSeats(state.bookings);
      return {
      bookings: folded.visible,
      calendars: state.calendars,
      seatsBySession: folded.seatsBySession,
      conflicts: actual.findConflicts(folded.visible),
      phase: state.phase,
      error: state.error,
      calendarsError: null,
      stale: state.stale,
      lastSyncedAt: state.lastSyncedAt,
      retry,
      refresh,
      setStatus,
      createBooking,
      reschedule,
      edit,
      colorForBooking: (b: SoloBooking) => {
        const c = state.calendars.find((x) => x.id === b.calendar_id);
        return c?.color || c?.accent || actual.DEFAULT_CALENDAR_COLOR;
      },
      };
    },
  };
});

// The client list is the Pipeline's own canonical read. Only its boundary is faked
// here, the same way the Pipeline's tests fake it; the picker markup is real.
const clientRead: {
  phase: "loading" | "ready" | "error";
  clients: { id: string; name: string; primaryEmail: string | null }[];
  hasMore: boolean;
} = { phase: "ready", clients: [], hasMore: false };
const clientRetry = vi.fn();
const clientLoadMore = vi.fn();
const clientReadTenants: (string | null)[] = [];
vi.mock("@/solo/deals/useSoloDealClients", () => ({
  useSoloDealClients: (tenantId: string | null) => {
    clientReadTenants.push(tenantId);
    return { ...clientRead, retry: clientRetry, loadMore: clientLoadMore };
  },
}));

const { SoloCalendarWorkspace } = await import("./SoloCalendarWorkspace");

/** A calendar row with every stored column at its honest "not recorded" value, so a
 *  test states ONLY the columns it is about. */
function calendarMeta(over: Partial<SoloCalendarMeta> & { id: string; title: string }): SoloCalendarMeta {
  return {
    color: null, accent: null, type: null,
    slug: null, enabled: null, duration_min: null, buffer_before_min: null,
    buffer_after_min: null, min_notice_min: null, booking_horizon_days: null,
    capacity: null, timezone: null, location_type: null, location_value: null,
    notify_config: null, availability_json: null, date_overrides: null, intake_questions: null,
    ...over,
  };
}

function booking(over: Partial<SoloBooking> & { id: string; start_at: string; end_at: string }): SoloBooking {
  return {
    title: "Discovery call", status: "scheduled", source: "manual",
    guest_name: null, guest_email: null, guest_phone: null, calendar_id: null,
    location_type: null, location_value: null, notes: null,
    booking_kind: "appointment", capacity: null, class_session_id: null,
    intake_answers: null, appointment_type: null,
    host_user_id: "host-a", host_full_name: null, timezone: null,
    ...over,
  };
}

/** "Today at hh:mm" as an ISO string, so the rendered week always contains it. */
function todayAt(hour: number, minutes = 0) {
  const d = new Date();
  d.setHours(hour, minutes, 0, 0);
  return d.toISOString();
}

let container: HTMLDivElement;
let root: Root;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <SoloCalendarWorkspace activeTenantId="tenant-1" connectionsHref="/solo/1/integrations" />,
    );
  });
}

const text = () => container.textContent ?? "";
const dialog = () => document.querySelector('[role="dialog"]');
const chip = (title: RegExp) =>
  [...container.querySelectorAll<HTMLButtonElement>("button.sc-ev")]
    .find((b) => title.test(b.getAttribute("title") ?? "")) ?? null;
const buttonByText = (re: RegExp, scope: ParentNode = container) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => re.test(b.textContent ?? "")) ?? null;

function click(el: Element | null) {
  expect(el, "expected the element under test to exist").toBeTruthy();
  act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

/** Set a controlled form control's value the way React sees it: the framework
 *  overrides the native value setter, so a plain `el.value = …` does not trigger
 *  onChange. Go through the prototype setter and dispatch both input and change. */
function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const byId = <T extends Element>(id: string) => document.querySelector<T>(id);

beforeEach(() => {
  state.bookings = [];
  state.calendars = [];
  state.phase = "ready";
  state.error = null;
  state.stale = false;
  state.lastSyncedAt = null;
  retry.mockClear();
  setStatus.mockClear();
  setStatus.mockResolvedValue({ ok: true });
  createBooking.mockClear();
  clientRead.phase = "ready";
  clientRead.clients = [];
  clientRead.hasMore = false;
  clientRetry.mockClear();
  clientLoadMore.mockClear();
  clientReadTenants.length = 0;
  reschedule.mockClear();
  reschedule.mockResolvedValue({ ok: true });
  edit.mockClear();
  edit.mockResolvedValue({ ok: true });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Solo Calendar — a truthful surface", () => {
  it("renders no duplicate heading: the Clients tab strip already names this view", () => {
    mount();
    // The retired presentation drew an <h1>Calendar</h1> plus an eyebrow and a
    // description INSIDE the Clients panel, directly under the Clients heading.
    expect(container.querySelector("h1")).toBeNull();
  });

  it("states plainly that nothing overlaps when the book is empty", () => {
    mount();
    expect(text()).toMatch(/No overlapping appointments in this range/i);
  });

  it("invents no counts for an empty book", () => {
    mount();
    // The retired sheet reserved a hard 560px for four tiles reading 0 / 0 / 0 / 0.
    expect(text()).not.toMatch(/still to come/i);
    expect(text()).not.toMatch(/Cancelled \/ no-show/i);
  });

  it("reports a load failure instead of drawing an empty week as success", () => {
    state.phase = "error";
    state.error = "permission denied for function list_team_bookings";
    mount();
    expect(text()).toMatch(/couldn’t load this range/i);
    expect(text()).toMatch(/permission denied/i);
  });

  it("labels the range without the Intl field-name fallback the old header emitted", () => {
    mount();
    expect(text()).not.toMatch(/\(day:/);
  });
});

describe("Solo Calendar — colour coding from real calendar rows", () => {
  it("paints an event with its own calendar's stored colour", () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: "#2E7D8F", accent: null, type: "meeting" })];
    state.bookings = [booking({ id: "b1", calendar_id: "cal-1", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    expect(chip(/Discovery call/)?.getAttribute("style")).toContain("#2E7D8F");
  });

  it("falls back to the accent when a calendar stores no colour", () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: null, accent: "#8A5A9E", type: "meeting" })];
    state.bookings = [booking({ id: "b1", calendar_id: "cal-1", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    expect(chip(/Discovery call/)?.getAttribute("style")).toContain("#8A5A9E");
  });

  it("lists the account's real calendars as toggles and hides their events when switched off", () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: "#2E7D8F", accent: null, type: "meeting" })];
    state.bookings = [booking({ id: "b1", calendar_id: "cal-1", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    expect(chip(/Discovery call/)).toBeTruthy();
    click(buttonByText(/Consults/));
    expect(chip(/Discovery call/)).toBeNull();
  });
});

describe("Solo Calendar — conflicts are measured, never asserted", () => {
  it("counts a real overlap in the notice", () => {
    state.bookings = [
      booking({ id: "b1", start_at: todayAt(10), end_at: todayAt(11) }),
      booking({ id: "b2", title: "Review", start_at: todayAt(10, 30), end_at: todayAt(11, 30) }),
    ];
    expect(findConflicts(state.bookings).size).toBe(2);
    mount();
    expect(text()).toMatch(/2 appointments overlap another on the same host/i);
  });

  it("marks only the overlapping chips", () => {
    state.bookings = [
      booking({ id: "b1", start_at: todayAt(10), end_at: todayAt(11) }),
      booking({ id: "b2", title: "Review", start_at: todayAt(10, 30), end_at: todayAt(11, 30) }),
      booking({ id: "b3", title: "Clear one", start_at: todayAt(15), end_at: todayAt(16) }),
    ];
    mount();
    expect(chip(/Discovery call/)?.className).toContain("sc-ev--conflict");
    expect(chip(/Clear one/)?.className).not.toContain("sc-ev--conflict");
  });
});

describe("Solo Calendar — the detail drawer", () => {
  function openDetail(over: Partial<SoloBooking> = {}) {
    state.bookings = [booking({
      id: "b1", start_at: todayAt(10), end_at: todayAt(11),
      guest_name: "A. Guest", host_full_name: "Owner", ...over,
    })];
    mount();
    const target = chip(/Discovery call/)!;
    target.focus();
    click(target);
    return target;
  }

  it("opens as an in-page dialog, not a detached browser window", () => {
    openDetail();
    const d = dialog();
    expect(d).toBeTruthy();
    expect(d?.getAttribute("aria-modal")).toBe("true");
    expect(d?.textContent).toContain("A. Guest");
    // A true pop-out would need a proven cross-window sync pattern; there is none.
    expect(d?.classList.contains("sc-drawer")).toBe(true);
  });

  it("closes on Escape and restores focus to the event that opened it", () => {
    const target = openDetail();
    expect(dialog()).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it("routes a status change through the tenant-gated seam", () => {
    openDetail();
    click(buttonByText(/Cancel appointment/i, document.body));
    expect(setStatus).toHaveBeenCalledWith("b1", "cancelled");
  });

  it("surfaces a refusal rather than reporting a change that did not happen", async () => {
    setStatus.mockResolvedValueOnce({ ok: false, message: "You can't change that booking." });
    openDetail();
    click(buttonByText(/No-show/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(dialog()?.textContent).toContain("You can't change that booking.");
  });

  it("moves a booking through the reschedule seam with the new time and its length preserved", async () => {
    openDetail(); // b1 = 10:00–11:00 today → 60 minutes
    click(buttonByText(/Reschedule/i, document.body));
    const d = dialog();
    expect(d?.textContent).toContain("Reschedule");
    // Length prefills to the booking's real 60 minutes; the start can be moved.
    expect(byId<HTMLSelectElement>("#sc-rs-dur")!.value).toBe("60");
    setValue(byId<HTMLInputElement>("#sc-rs-time")!, "14:30");
    click(buttonByText(/Move appointment/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(reschedule).toHaveBeenCalledTimes(1);
    const [id, startAt, minutes] = reschedule.mock.calls[0];
    expect(id).toBe("b1");
    expect(minutes).toBe(60);
    expect(startAt.getHours()).toBe(14);
    expect(startAt.getMinutes()).toBe(30);
    expect(dialog()).toBeNull(); // a successful move closes the form
  });

  it("keeps the reschedule form open and shows the refusal when a move is rejected", async () => {
    reschedule.mockResolvedValueOnce({ ok: false, message: "Something is already on your schedule at that time." });
    openDetail();
    click(buttonByText(/Reschedule/i, document.body));
    click(buttonByText(/Move appointment/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(dialog()?.textContent).toContain("Something is already on your schedule at that time.");
  });

  it("does not offer Reschedule or Edit on a booking that is off the schedule", () => {
    openDetail({ status: "cancelled" });
    expect((buttonByText(/Reschedule/i, document.body) as HTMLButtonElement).disabled).toBe(true);
    expect((buttonByText(/Edit details/i, document.body) as HTMLButtonElement).disabled).toBe(true);
  });

  it("withholds Reschedule on a class session — a single-row move would orphan its seats", () => {
    // reschedule_internal_booking moves ONE row; a class marker and its seats share
    // a start/end, so moving just the marker separates the class from its attendees.
    // Until an atomic group-move seam exists the action is disabled — but the class's
    // details can still be edited, which never touches time.
    openDetail({ booking_kind: "class_session", capacity: 8 });
    expect((buttonByText(/Reschedule/i, document.body) as HTMLButtonElement).disabled).toBe(true);
    expect((buttonByText(/Edit details/i, document.body) as HTMLButtonElement).disabled).toBe(false);
  });

  it("edits details through the update seam, carrying the current values", async () => {
    openDetail(); // title "Discovery call", guest "A. Guest"
    click(buttonByText(/Edit details/i, document.body));
    const d = dialog();
    expect(d?.textContent).toContain("Edit details");
    expect(byId<HTMLInputElement>("#sc-ed-title")!.value).toBe("Discovery call");
    expect(byId<HTMLInputElement>("#sc-ed-guest")!.value).toBe("A. Guest");
    setValue(byId<HTMLInputElement>("#sc-ed-title")!, "Discovery call — intake");
    click(buttonByText(/Save changes/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toMatchObject({
      id: "b1", title: "Discovery call — intake", guestName: "A. Guest",
    });
    expect(dialog()).toBeNull();
  });

  it("refuses to save an edit with an empty title, without calling the seam", () => {
    openDetail();
    click(buttonByText(/Edit details/i, document.body));
    setValue(byId<HTMLInputElement>("#sc-ed-title")!, "   ");
    click(buttonByText(/Save changes/i, document.body));
    expect(edit).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("An appointment needs a title.");
  });

  it("surfaces an edit refusal rather than reporting a change that did not happen", async () => {
    edit.mockResolvedValueOnce({ ok: false, message: "You can't change that booking." });
    openDetail();
    click(buttonByText(/Edit details/i, document.body));
    click(buttonByText(/Save changes/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(dialog()?.textContent).toContain("You can't change that booking.");
  });

  it("says 'Not recorded' rather than inventing a placeholder for absent detail", () => {
    openDetail({ guest_name: null, guest_email: null, host_full_name: null });
    expect(dialog()?.textContent).toContain("Not recorded");
  });

  it("shows a refused New appointment as an honest category and keeps the form open — never a booked-looking success", async () => {
    // The seam classifies a live refusal (e.g. the RPC not resolving) as an
    // honest, actionable sentence. The drawer must surface it and STAY OPEN — a
    // refusal that closed the form would read exactly like a saved appointment.
    createBooking.mockResolvedValueOnce({
      ok: false, category: "unavailable",
      message: "Scheduling isn’t available right now — nothing was booked. Please try again in a moment.",
    });
    mount();
    click(buttonByText(/New appointment/i, document.body));
    setValue(byId<HTMLInputElement>("#sc-title")!, "Intro call");
    click(buttonByText(/Save appointment/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(dialog()?.textContent).toContain("nothing was booked");
    expect(dialog()?.textContent).toContain("New appointment"); // still open
  });

  it("closes the New appointment form only on a real success", async () => {
    createBooking.mockResolvedValueOnce({ ok: true });
    mount();
    click(buttonByText(/New appointment/i, document.body));
    setValue(byId<HTMLInputElement>("#sc-title")!, "Intro call");
    click(buttonByText(/Save appointment/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("names the overlap inside the drawer when this appointment is one", () => {
    state.bookings = [
      booking({ id: "b1", start_at: todayAt(10), end_at: todayAt(11) }),
      booking({ id: "b2", title: "Review", start_at: todayAt(10, 30), end_at: todayAt(11, 30) }),
    ];
    mount();
    click(chip(/Discovery call/));
    expect(dialog()?.textContent).toMatch(/overlaps another appointment on the same host/i);
  });
});

describe("Solo Calendar — a session booked for a client reaches that client", () => {
  const NORTHWIND = [
    { id: "client-jordan", name: "Jordan Rivera", primaryEmail: "jordan@northwind.example" },
    { id: "client-sam", name: "Sam Okafor", primaryEmail: null },
  ];
  type CreateArg = { title: string; guestName: string | null; blocked: boolean; calendarId: string; contactId?: string | null };
  const lastCreate = () => (createBooking.mock.calls.at(-1) as unknown as [CreateArg])[0];
  const trigger = () => document.querySelector<HTMLButtonElement>('button[role="combobox"].sc-combo-trigger')!;
  const listOpen = () => !!document.querySelector(".sc-combo-pop [cmdk-list]");
  const openClients = () => { if (!listOpen()) click(trigger()); };
  const options = () => [...document.querySelectorAll<HTMLElement>(".sc-combo-pop [cmdk-item]")];
  /** Each row as the owner reads it: the name, then the muted email when there is one. */
  const optionLabels = () => options().map((o) => {
    const name = o.querySelector(".sc-combo-opt-name")?.textContent ?? o.textContent ?? "";
    const email = o.querySelector(".sc-combo-opt-email")?.textContent;
    return email ? `${name} · ${email}` : name;
  });
  const pick = (re: RegExp) => {
    openClients();
    click(options().find((o) => re.test(o.textContent ?? "")) ?? null);
  };
  const searchBox = () => document.querySelector<HTMLInputElement>(".sc-combo-pop [cmdk-input]")!;
  const openCreate = () => { mount(); click(buttonByText(/New appointment/i, document.body)); };
  const save = async () => {
    click(buttonByText(/Save appointment/i, document.body));
    await act(async () => { await Promise.resolve(); });
  };
  const key = (el: Element, k: string) => {
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
  };

  beforeAll(() => {
    // jsdom has neither; the list (cmdk) and its positioning (Radix) both use them.
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
  });

  it("reads this account's own client list, and only once the form is opened", () => {
    clientRead.clients = NORTHWIND;
    mount();
    expect(clientReadTenants).toEqual([]);
    click(buttonByText(/New appointment/i, document.body));
    expect(new Set(clientReadTenants)).toEqual(new Set(["tenant-1"]));
    openClients();
    expect(optionLabels()).toEqual([
      "Not a client (guest only)", "Jordan Rivera · jordan@northwind.example", "Sam Okafor",
    ]);
  });

  it("is ONE combobox placed directly under Title, with no native select and no second search box", () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    const fields = [...dialog()!.querySelectorAll<HTMLElement>(".sc-drawer-body > .sc-field")];
    const titleAt = fields.findIndex((f) => f.querySelector("#sc-title"));
    expect(fields[titleAt + 1]?.querySelector('[role="combobox"]')).toBe(trigger());
    expect(fields[titleAt + 1]?.querySelector("select")).toBeNull();
    expect(byId("#sc-client")).toBeNull();
    expect(byId("#sc-client-search")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    openClients();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    // The list renders inside the drawer, so it sits above the form and inside its focus trap.
    expect(dialog()!.contains(document.querySelector(".sc-combo-pop"))).toBe(true);
    expect(document.activeElement).toBe(searchBox());
  });

  it("passes the chosen client's id, shows them as a chip, and prefills the guest name", async () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    setValue(byId<HTMLInputElement>("#sc-title")!, "Strategy session");
    pick(/Jordan Rivera/);
    expect(listOpen()).toBe(false);
    expect(trigger().querySelector(".sc-combo-chip-name")?.textContent).toBe("Jordan Rivera");
    expect(trigger().querySelector(".sc-combo-chip-email")?.textContent).toBe("jordan@northwind.example");
    expect(byId<HTMLInputElement>("#sc-guest")!.value).toBe("Jordan Rivera");
    expect(dialog()?.textContent).toMatch(/see this session in their client portal/);
    await save();
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(lastCreate()).toMatchObject({
      title: "Strategy session", guestName: "Jordan Rivera", blocked: false, contactId: "client-jordan",
    });
    expect(dialog()).toBeNull();
  });

  it("removes the chosen client from the chip, and the booking then carries no client", async () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    setValue(byId<HTMLInputElement>("#sc-title")!, "Intro call");
    pick(/Jordan Rivera/);
    click(document.querySelector('button[aria-label="Remove Jordan Rivera"]'));
    expect(trigger().querySelector(".sc-combo-chip")).toBeNull();
    expect(trigger().textContent).toContain("Not a client (guest only)");
    expect(document.activeElement).toBe(trigger());
    await save();
    expect(lastCreate()).toMatchObject({ contactId: null, guestName: "Jordan Rivera" });
  });

  it("is operable from the keyboard: arrows move, Enter chooses, Escape closes the list but not the form", () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    openClients();
    key(searchBox(), "ArrowDown");
    key(searchBox(), "Enter");
    expect(trigger().querySelector(".sc-combo-chip-name")?.textContent).toBe("Jordan Rivera");
    openClients();
    key(searchBox(), "Escape");
    expect(listOpen()).toBe(false);
    expect(dialog()?.textContent).toContain("New appointment");
    // A second Escape, with the list closed, is the drawer's again.
    key(document.activeElement ?? document.body, "Escape");
    expect(dialog()).toBeNull();
  });

  it("does not overwrite a guest name the owner typed, but follows a switch between clients", () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    setValue(byId<HTMLInputElement>("#sc-guest")!, "J. Rivera (Northwind)");
    pick(/Jordan Rivera/);
    expect(byId<HTMLInputElement>("#sc-guest")!.value).toBe("J. Rivera (Northwind)");

    setValue(byId<HTMLInputElement>("#sc-guest")!, "");
    pick(/Jordan Rivera/);
    expect(byId<HTMLInputElement>("#sc-guest")!.value).toBe("Jordan Rivera");
    pick(/Sam Okafor/);
    expect(byId<HTMLInputElement>("#sc-guest")!.value).toBe("Sam Okafor");
  });

  it("still books a free-text guest who is not a client, with no client attached", async () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    setValue(byId<HTMLInputElement>("#sc-title")!, "Intro call");
    setValue(byId<HTMLInputElement>("#sc-guest")!, "Riley from the referral");
    await save();
    expect(lastCreate()).toMatchObject({ guestName: "Riley from the referral", blocked: false, contactId: null });
  });

  it("clears the client again when the owner switches back to a guest", async () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    setValue(byId<HTMLInputElement>("#sc-title")!, "Intro call");
    pick(/Jordan Rivera/);
    pick(/Not a client/);
    await save();
    expect(lastCreate()).toMatchObject({ contactId: null, guestName: "Jordan Rivera" });
  });

  it("leaves blocked-time creation exactly as it was", async () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    await save();
    expect(lastCreate()).toMatchObject({ title: "", blocked: true, guestName: null, contactId: null });
  });

  it("refuses to save a client session with no title, rather than filing it as blocked time", async () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    pick(/Jordan Rivera/);
    await save();
    expect(createBooking).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toMatch(/Add a title for this session/);
  });

  it("narrows the list by name or email, and names a search that matches nobody", () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    openClients();
    setValue(searchBox(), "northwind.example");
    // Once the owner types, the matches lead and the guest row follows them.
    expect(optionLabels()).toEqual(["Jordan Rivera · jordan@northwind.example", "Not a client (guest only)"]);
    setValue(searchBox(), "okafor");
    expect(optionLabels()).toEqual(["Sam Okafor", "Not a client (guest only)"]);
    setValue(searchBox(), "nobody");
    expect(optionLabels()).toEqual(["Not a client (guest only)"]);
    expect(document.querySelector(".sc-combo-status")?.textContent).toBe("No client matches “nobody”.");
  });

  it("chooses the first MATCH when the owner types a search and presses Enter, never the guest row", () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    openClients();
    // Nothing typed: "Not a client" leads, is the current value, and is highlighted.
    expect(optionLabels()[0]).toBe("Not a client (guest only)");
    setValue(searchBox(), "jor");
    const highlighted = () => document.querySelector<HTMLElement>('.sc-combo-pop [cmdk-item][data-selected="true"]');
    // The highlight follows the first visible match …
    expect(highlighted()?.querySelector(".sc-combo-opt-name")?.textContent).toBe("Jordan Rivera");
    // … while the current value (still the guest) keeps its own, different mark.
    const guestRow = options().find((o) => /Not a client/.test(o.textContent ?? ""))!;
    expect(guestRow.dataset.current).toBe("true");
    expect(guestRow.dataset.selected).not.toBe("true");
    key(searchBox(), "Enter");
    expect(trigger().querySelector(".sc-combo-chip-name")?.textContent).toBe("Jordan Rivera");
  });

  it("reopens the list with the current client highlighted, so Enter keeps them, and names the booking field for a client", () => {
    clientRead.clients = NORTHWIND;
    openCreate();
    expect(document.querySelector('label[for="sc-guest"]')?.textContent).toBe("Guest name");
    openClients();
    pick(/Jordan Rivera/);
    expect(trigger().querySelector(".sc-combo-chip-name")?.textContent).toBe("Jordan Rivera");
    expect(document.querySelector('label[for="sc-guest"]')?.textContent).toBe("Name on the booking");
    openClients();
    const highlighted = document.querySelector<HTMLElement>('.sc-combo-pop [cmdk-item][data-selected="true"]');
    expect(highlighted?.querySelector(".sc-combo-opt-name")?.textContent).toBe("Jordan Rivera");
    key(searchBox(), "Enter");
    expect(trigger().querySelector(".sc-combo-chip-name")?.textContent).toBe("Jordan Rivera");
  });

  it("says plainly when the client list cannot be read, retries from the list, and still allows a guest booking", async () => {
    clientRead.phase = "error";
    openCreate();
    expect(dialog()?.textContent).toMatch(/client list couldn’t be read/);
    openClients();
    expect(searchBox().disabled).toBe(true);
    expect(document.querySelector(".sc-combo-status")?.textContent).toMatch(/couldn’t be read/);
    pick(/Try again/);
    expect(clientRetry).toHaveBeenCalledTimes(1);
    setValue(byId<HTMLInputElement>("#sc-title")!, "Intro call");
    setValue(byId<HTMLInputElement>("#sc-guest")!, "Jordan Rivera");
    await save();
    expect(lastCreate()).toMatchObject({ contactId: null, guestName: "Jordan Rivera" });
  });

  it("names the loading and empty states in the list instead of showing an empty picker", () => {
    clientRead.phase = "loading";
    openCreate();
    openClients();
    expect(document.querySelector(".sc-combo-status")?.textContent).toBe("Loading your clients…");
    expect(optionLabels()).toEqual(["Not a client (guest only)"]);
    act(() => root.unmount());
    container.remove();

    clientRead.phase = "ready";
    openCreate();
    expect(dialog()?.textContent).toMatch(/No clients yet/);
    openClients();
    expect(document.querySelector(".sc-combo-status")?.textContent).toMatch(/No clients yet/);
  });

  it("offers more clients from the list footer when the list is paged", () => {
    clientRead.clients = NORTHWIND;
    clientRead.hasMore = true;
    openCreate();
    expect(buttonByText(/Load more clients/i, document.body)).toBeNull();
    pick(/Load more clients/);
    expect(clientLoadMore).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".sc-combo-foot")?.textContent).toContain("Load more clients");
  });
});

describe("Solo Calendar — the drawer's form chrome meets the floor in both themes", () => {
  const css = readFileSync(resolve(process.cwd(), "src/components/tenant-calendar/solo-calendar.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  /** Every value a --pg token is given, in file order (Obsidian block, then Mineral). */
  const values = (name: string) => [...tokens.matchAll(new RegExp(`--pg-${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => m[1]);
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** The declarations of the first rule whose selector list contains `selector`. */
  const ruleFor = (selector: string) => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1].split(",").map((x) => x.trim()).includes(selector)) return m[2];
    }
    return null;
  };

  it("paints placeholders in the muted token at full opacity, which clears 4.5:1 on every field surface", () => {
    mount(); // the shared teardown unmounts a root; the assertions themselves are on the stylesheet
    for (const sel of [".sc-field input::placeholder", ".sc-field textarea::placeholder"]) {
      const rule = ruleFor(sel);
      expect(rule, `${sel} has a rule`).toBeTruthy();
      expect(rule).toMatch(/color:\s*var\(--pg-muted\)/);
      expect(rule).toMatch(/opacity:\s*1\b/);
    }
    const [muted, surface, raised] = [values("muted"), values("surface"), values("raised")];
    expect(muted).toHaveLength(2);
    for (let theme = 0; theme < 2; theme++) {
      expect(contrast(muted[theme], surface[theme])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(muted[theme], raised[theme])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rings every focusable control in this drawer stylesheet indigo — no focus outline is gold", () => {
    mount();
    const focusRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /:focus(-visible)?\b/.test(m[1]) && /outline\s*:/.test(m[2]));
    expect(focusRules.length).toBeGreaterThanOrEqual(8);
    for (const m of focusRules) {
      expect(m[2], m[1].trim()).not.toMatch(/gold/);
    }
    for (const sel of [".sc-btn:focus-visible", ".sc-seg button:focus-visible", ".sc-group-head:focus-visible",
      ".sc-check:focus-visible", ".sc-ev:focus-visible", ".sc-dayrow:focus-visible"]) {
      expect(ruleFor(sel), sel).toMatch(/outline:\s*2px solid hsl\(var\(--ring\)\)/);
    }
  });

  it("gives both buttons inside the client box the box's full 44px — no border eating a dead edge", () => {
    mount();
    const box = ruleFor(".sc-combo")!;
    expect(box).toMatch(/min-height:\s*44px/);
    expect(box).not.toMatch(/(^|;|\s)border\s*:/);
    expect(box).toMatch(/box-shadow:\s*inset 0 0 0 1px/);
    expect(ruleFor(".sc-combo-trigger")).toMatch(/min-height:\s*44px/);
    const clear = ruleFor(".sc-combo-clear")!;
    expect(clear).toMatch(/width:\s*44px/);
    expect(clear).toMatch(/min-height:\s*44px/);
  });

  it("marks the current client differently from the keyboard highlight", () => {
    mount();
    expect(ruleFor('.sc-combo-pop [cmdk-item].sc-combo-opt[data-selected="true"]')).toMatch(/--pg-violet/);
    expect(ruleFor(".sc-combo-check")).not.toMatch(/--pg-violet/);
    expect(ruleFor('.sc-combo-pop [cmdk-item].sc-combo-opt[data-current="true"] .sc-combo-opt-name')).toMatch(/font-weight:\s*600/);
  });

  it("rings a focused drawer field in the indigo ring token, never gold", () => {
    mount();
    const rule = ruleFor(".sc-field input:focus-visible");
    expect(rule).toMatch(/outline:\s*2px solid hsl\(var\(--ring\)\)/);
    expect(rule).not.toMatch(/gold/);
  });
});

describe("Solo Calendar — a client session lands on a calendar the portal can change it on", () => {
  const JORDAN = [{ id: "client-jordan", name: "Jordan Rivera", primaryEmail: "jordan@northwind.example" }];
  const NO_CAL_HINT = /Pick a calendar so they can reschedule or cancel within its notice window\./;
  const trigger = () => document.querySelector<HTMLButtonElement>('button[role="combobox"].sc-combo-trigger')!;
  const pickJordan = () => {
    if (!document.querySelector(".sc-combo-pop [cmdk-list]")) click(trigger());
    click([...document.querySelectorAll(".sc-combo-pop [cmdk-item]")].find((o) => /Jordan/.test(o.textContent ?? "")) ?? null);
  };
  const calSelect = () => byId<HTMLSelectElement>("#sc-cal")!;
  const openCreate = () => { mount(); click(buttonByText(/New appointment/i, document.body)); };

  beforeAll(() => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
  });
  beforeEach(() => {
    clientRead.clients = JORDAN;
    state.calendars = [
      calendarMeta({ id: "cal-paused", title: "Paused intake", enabled: false }),
      calendarMeta({ id: "cal-strategy", title: "Strategy sessions", enabled: true }),
      calendarMeta({ id: "cal-review", title: "Reviews", enabled: true }),
    ];
  });

  it("fills an untouched Unassigned calendar with the first open one once a client is chosen", async () => {
    openCreate();
    expect(calSelect().value).toBe(UNASSIGNED);
    pickJordan();
    expect(calSelect().value).toBe("cal-strategy");
    expect(dialog()?.textContent).not.toMatch(NO_CAL_HINT);
    setValue(byId<HTMLInputElement>("#sc-title")!, "Strategy session");
    click(buttonByText(/Save appointment/i, document.body));
    await act(async () => { await Promise.resolve(); });
    expect((createBooking.mock.calls.at(-1) as unknown as [{ calendarId: string }])[0].calendarId).toBe("cal-strategy");
  });

  it("never overwrites a calendar the owner already picked", () => {
    openCreate();
    setValue(calSelect(), "cal-review");
    pickJordan();
    expect(calSelect().value).toBe("cal-review");
  });

  it("keeps a calendar already in the field when the client changes, even if the calendar list has moved", () => {
    openCreate();
    pickJordan();
    expect(calSelect().value).toBe("cal-strategy");
    click(document.querySelector('button[aria-label="Remove Jordan Rivera"]'));
    // A live refresh reorders the calendars; the field already holds a real calendar.
    state.calendars = [state.calendars[2], state.calendars[1]];
    act(() => {
      root.render(<SoloCalendarWorkspace activeTenantId="tenant-1" connectionsHref="/solo/1/integrations" />);
    });
    pickJordan();
    expect(calSelect().value).toBe("cal-strategy");
  });

  it("respects an owner who chose Unassigned on purpose, and says what that costs the client", () => {
    openCreate();
    setValue(calSelect(), "cal-review");
    setValue(calSelect(), UNASSIGNED);
    pickJordan();
    expect(calSelect().value).toBe(UNASSIGNED);
    expect(dialog()?.textContent).toMatch(NO_CAL_HINT);
    const hint = [...dialog()!.querySelectorAll(".sc-field-hint")].find((p) => NO_CAL_HINT.test(p.textContent ?? ""))!;
    expect(calSelect().getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("says what is missing when there is no open calendar to offer", () => {
    state.calendars = [calendarMeta({ id: "cal-paused", title: "Paused intake", enabled: false })];
    openCreate();
    pickJordan();
    expect(calSelect().value).toBe(UNASSIGNED);
    expect(dialog()?.textContent).toMatch(NO_CAL_HINT);
  });

  it("shows no calendar hint for a guest who is not a client", () => {
    openCreate();
    expect(dialog()?.textContent).not.toMatch(NO_CAL_HINT);
  });
});

describe("Solo Calendar — no control is hidden at narrow widths", () => {
  // Found by the four-viewport capture: below the rail breakpoint the rail is
  // display:none, which made the calendar toggles, colour coding and settings
  // UNREACHABLE at 1024x768 and 900x1000. A responsive layout may move a control;
  // it may not delete it.
  it("offers a View options entry point that carries the rail's controls", () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: "#2E7D8F", accent: null, type: "meeting" })];
    mount();
    const opener = buttonByText(/View options/i);
    expect(opener).toBeTruthy();
    expect(opener?.className).toContain("sc-options-btn");
    click(opener);
    const d = dialog();
    expect(d).toBeTruthy();
    // The SAME controls, not a reduced copy.
    expect(d?.textContent).toContain("Calendars");
    expect(d?.textContent).toContain("Consults");
    expect(d?.textContent).toContain("Colour by");
    expect(d?.textContent).toContain("Settings");
  });

  it("keeps the calendar toggle functional from inside that drawer", () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: "#2E7D8F", accent: null, type: "meeting" })];
    state.bookings = [booking({ id: "b1", calendar_id: "cal-1", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    click(buttonByText(/View options/i));
    click(buttonByText(/Consults/, document.body));
    expect(chip(/Discovery call/)).toBeNull();
  });

  it("restores focus to the View options button on Escape", () => {
    mount();
    const opener = buttonByText(/View options/i)!;
    opener.focus();
    click(opener);
    expect(dialog()).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

// Calendar settings — availability, booking rules, event types, colours, reminders —
// are Calendar-owned and live on the calendar itself. Connections owns whether an
// SMS-capable channel is connected and permitted. The two interweave at exactly one
// point: a Calendar-configured SMS reminder needs a channel Calendar does not own.
// These tests pin that seam in BOTH directions, because the failure mode is a
// standing link that quietly implies Connections owns scheduling.
// The compact state is driven by a container query, which jsdom does not evaluate — so
// these tests pin the two things that must be TRUE IN THE MARKUP for that query to be
// able to do its job, and the rendered-browser drive proves the swap itself at every
// required frame. Splitting it this way keeps each layer honest about what it can see.
describe("Solo Calendar — the chip survives a narrow column", () => {
  const withOne = () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: "#2E7D8F", type: "meeting" })];
    state.bookings = [booking({
      id: "b1", title: "Quarterly planning session with the onboarding team",
      start_at: todayAt(9), end_at: todayAt(10), calendar_id: "cal-1",
    })];
  };
  const weekChip = () => container.querySelector<HTMLButtonElement>("button.sc-ev--grid.sc-ev--compactable");

  it("names the chip explicitly, so the accessible name cannot shrink with the column", () => {
    withOne();
    mount();
    const chip = weekChip()!;
    // The visible text is width-dependent; the NAME is not. It must carry the title
    // and the time whether or not the title is the thing on screen.
    expect(chip.getAttribute("aria-label")).toMatch(/Quarterly planning session with the onboarding team/);
    expect(chip.getAttribute("aria-label")).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });

  it("carries a compact stand-in for the title in the week grid", () => {
    withOne();
    mount();
    const chip = weekChip()!;
    const compact = chip.querySelector(".sc-ev-compact");
    expect(compact, "the week chip needs something to swap in when the column starves").toBeTruthy();
    // It states the start time in the short form — "9a", "10a", "2:30p" — derived from
    // the same real start_at, never a placeholder. Measured reason for the short form:
    // "10:00 AM" overflowed the chip at the 520px mount, by 16.9px once a conflict flag
    // shared the row. ":00" is dropped on the hour; the minute is kept when it matters.
    expect(compact!.textContent).toMatch(/^\d{1,2}(:\d{2})?[ap]?$/i);
    // The full, unabbreviated time stays on the accessible name.
    expect(chip.getAttribute("aria-label")).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    // and it is hidden from assistive tech, because the aria-label already says it.
    expect(compact!.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks week and month chips as grid chips, and leaves the agenda alone", () => {
    withOne();
    mount();
    expect(weekChip(), "week chip should be a grid chip").toBeTruthy();

    click(buttonByText(/^Month$/));
    const monthChip = container.querySelector("button.sc-ev--grid");
    expect(monthChip, "month chip should be a grid chip").toBeTruthy();
    // The month chip already renders a time, so it needs no second stand-in.
    expect(monthChip!.classList.contains("sc-ev--compactable")).toBe(false);
    expect(monthChip!.querySelector(".sc-ev-time")).toBeTruthy();

    click(buttonByText(/^Agenda$/));
    // Agenda rows are 492px wide even at the tightest measured frame; compacting them
    // would remove readable text for no reason.
    expect(container.querySelector("button.sc-ev.sc-ev--grid")).toBeNull();
    expect(container.querySelector("button.sc-ev")).toBeTruthy();
  });

  it("keeps the conflict flag and the cancelled state independent of the swap", () => {
    state.calendars = [calendarMeta({ id: "cal-1", title: "Consults", color: "#2E7D8F", type: "meeting" })];
    state.bookings = [
      booking({ id: "x1", title: "One", start_at: todayAt(14), end_at: todayAt(15), calendar_id: "cal-1" }),
      booking({ id: "x2", title: "Two", start_at: todayAt(14, 30), end_at: todayAt(15, 30), calendar_id: "cal-1" }),
      booking({ id: "x3", title: "Gone", start_at: todayAt(11), end_at: todayAt(12), status: "cancelled", calendar_id: "cal-1" }),
    ];
    mount();
    // Both halves of a real overlap stay flagged, and the flag is not part of the
    // text that the compact treatment replaces.
    expect(container.querySelectorAll("button.sc-ev--conflict .sc-ev-flag").length).toBe(2);
    const off = container.querySelector("button.sc-ev--off");
    expect(off, "a cancelled booking keeps its own state class").toBeTruthy();
    expect(off!.getAttribute("aria-label")).toMatch(/cancelled/i);
  });
});

describe("Solo Calendar — calendar settings stay Calendar-owned", () => {
  const withNotify = (notify_config: unknown) => {
    state.calendars = [calendarMeta({
      id: "cal-1", title: "Consults", color: "#2E7D8F", accent: null, type: "meeting",
      notify_config,
    })];
  };
  const openConfig = () => {
    const cog = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => /How Consults is configured/i.test(b.getAttribute("aria-label") ?? ""));
    click(cog ?? null);
  };

  // CHANGED, owner-ruled 2026-08-30. This test previously asserted the OPPOSITE —
  // that the settings group carried no link out — because calendar configuration
  // was Calendar-owned and a signpost would have implied otherwise. Configuration
  // now lives in Settings › Connections › Calendars, so the absence of an exit is
  // the defect and the exit is the requirement. The cog drawers are unchanged and
  // still read a calendar's setup in place.
  it("carries a standing exit to the settings home, and still points at the cog for a quick read", () => {
    mount();
    click(buttonByText(/^Settings$/));
    const exit = container.querySelector<HTMLAnchorElement>('a[href="/solo/1/integrations"]');
    expect(exit?.textContent).toMatch(/Manage calendar settings/i);
    expect(text()).toMatch(/Open a calendar's cog above/i);
    expect(text()).toMatch(/Settings → Connections → Calendars/);
  });

  it("reads confirmations and reminders off the calendar row", () => {
    withNotify({
      confirm_guest: true,
      confirm_host: false,
      reminders: [{ channel: "email", offset_min: 1440, to: "guest" }],
    });
    mount();
    openConfig();
    expect(text()).toMatch(/Confirmations and reminders/i);
    expect(text()).toMatch(/1 day before/i);
    expect(text()).toMatch(/Email · to the guest/i);
  });

  it("says a calendar stores no notification settings rather than showing the column default", () => {
    withNotify(null);
    mount();
    openConfig();
    expect(text()).toMatch(/stores no notification settings/i);
    expect(text()).toContain("UNAVAILABLE");
  });

  it("offers no Connections path when the stored reminders are email-only", () => {
    withNotify({ confirm_guest: true, confirm_host: true, reminders: [{ channel: "email", offset_min: 60, to: "guest" }] });
    mount();
    openConfig();
    expect(container.querySelector('a[href="/solo/1/integrations"]')).toBeNull();
  });

  it("offers the Connections remediation only when this calendar's own reminders ask for SMS", () => {
    withNotify({ confirm_guest: true, confirm_host: true, reminders: [{ channel: "sms", offset_min: 120, to: "guest" }] });
    mount();
    openConfig();
    const link = container.querySelector<HTMLAnchorElement>('a[href="/solo/1/integrations"]');
    expect(link?.textContent).toMatch(/Settings → Connections/);
    // It is a remediation for a channel, and says so — it never claims to know that
    // SMS is unavailable, because this surface does not read sending capability.
    expect(text()).toMatch(/SMS sending capability is not read here/i);
  });

  it("treats a 'both' reminder as asking for SMS too", () => {
    withNotify({ confirm_guest: true, confirm_host: true, reminders: [{ channel: "both", offset_min: 30, to: "both" }] });
    mount();
    openConfig();
    expect(container.querySelector('a[href="/solo/1/integrations"]')).toBeTruthy();
    expect(text()).toMatch(/Email and SMS · to guest and host/i);
  });
});

describe("Solo Calendar — a class is one appointment, not one per attendee", () => {
  /** The shape `list_team_bookings` really returns for a group booking: the
   *  session marker plus one `class_seat` per attendee, all on the same host at
   *  the same hour. */
  function groupBooking(seats: { id: string; name: string; email?: string; status?: string }[]) {
    return [
      booking({
        id: "class-1", title: "Group coaching", booking_kind: "class_session",
        capacity: 8, start_at: todayAt(10), end_at: todayAt(11),
      }),
      ...seats.map((s) =>
        booking({
          id: s.id, title: "Group coaching", booking_kind: "class_seat",
          class_session_id: "class-1", guest_name: s.name, guest_email: s.email ?? null,
          status: s.status ?? "scheduled", start_at: todayAt(10), end_at: todayAt(11),
        }),
      ),
    ];
  }

  it("draws the class once, however many people are booked into it", () => {
    state.bookings = groupBooking([
      { id: "seat-1", name: "Attendee One" },
      { id: "seat-2", name: "Attendee Two" },
      { id: "seat-3", name: "Attendee Three" },
    ]);
    mount();
    expect(container.querySelectorAll("button.sc-ev")).toHaveLength(1);
  });

  it("does not accuse the host of double-booking themselves with their own class", () => {
    state.bookings = groupBooking([
      { id: "seat-1", name: "Attendee One" },
      { id: "seat-2", name: "Attendee Two" },
    ]);
    mount();
    expect(container.querySelectorAll(".sc-ev--conflict")).toHaveLength(0);
    expect(text()).toMatch(/No overlapping appointments in this range/i);
  });

  it("lists the real attendees in the class detail", () => {
    state.bookings = groupBooking([
      { id: "seat-1", name: "Attendee One", email: "one@example.com" },
      { id: "seat-2", name: "Attendee Two", email: "two@example.com" },
    ]);
    mount();
    click(chip(/Group coaching/));
    const d = dialog();
    expect(d?.textContent).toMatch(/Who is booked/);
    expect(d?.textContent).toMatch(/Attendee One/);
    expect(d?.textContent).toMatch(/one@example\.com/);
    expect(d?.textContent).toMatch(/Attendee Two/);
    expect(d?.textContent).toMatch(/2 of 8 booked/);
  });

  it("keeps a cancelled attendee on the record without counting them as booked", () => {
    state.bookings = groupBooking([
      { id: "seat-1", name: "Attendee One" },
      { id: "seat-2", name: "Attendee Two", status: "cancelled" },
    ]);
    mount();
    click(chip(/Group coaching/));
    expect(dialog()?.textContent).toMatch(/1 of 8 booked/);
    expect(dialog()?.textContent).toMatch(/Attendee Two/);
  });

  it("says a class is empty rather than showing an authoritative-looking count", () => {
    state.bookings = [
      booking({
        id: "class-1", title: "Group coaching", booking_kind: "class_session",
        capacity: 8, start_at: todayAt(10), end_at: todayAt(11),
      }),
    ];
    mount();
    click(chip(/Group coaching/));
    expect(dialog()?.textContent).toMatch(/No attendee is booked into this session yet/i);
  });

  it("still flags a real clash between the class and a separate appointment", () => {
    state.bookings = [
      ...groupBooking([{ id: "seat-1", name: "Attendee One" }]),
      booking({ id: "solo", title: "Discovery call", start_at: todayAt(10, 30), end_at: todayAt(11, 30) }),
    ];
    mount();
    expect(container.querySelectorAll(".sc-ev--conflict")).toHaveLength(2);
  });
});

describe("Solo Calendar — an honest freshness state when a refresh fails", () => {
  /**
   * Console-only was the defect: the rows stayed on screen and nothing told the
   * owner they might no longer be true. Keeping the rows is right; letting them
   * read as current is not.
   */
  const staleRow = () => booking({ id: "b1", start_at: todayAt(10), end_at: todayAt(11) });

  it("says nothing at all while refreshes are succeeding", () => {
    state.bookings = [staleRow()];
    state.lastSyncedAt = new Date();
    mount();
    expect(text()).not.toMatch(/may be out of date/i);
    expect(buttonByText(/^Retry$/)).toBeNull();
  });

  it("says the calendar may be out of date, and keeps the appointments on screen", () => {
    state.bookings = [staleRow()];
    state.stale = true;
    mount();
    expect(text()).toMatch(/Calendar may be out of date/i);
    expect(text()).toMatch(/could not refresh the latest booking changes/i);
    // The rows are still there — the notice replaces nothing.
    expect(chip(/Discovery call/)).toBeTruthy();
  });

  it("announces the state politely rather than trapping or interrupting", () => {
    state.bookings = [staleRow()];
    state.stale = true;
    mount();
    const live = container.querySelector('[role="status"]');
    expect(live, "the freshness state must be announced to assistive tech").toBeTruthy();
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toMatch(/Calendar may be out of date/i);
  });

  it("offers a real Retry that drives the real refresh", () => {
    state.bookings = [staleRow()];
    state.stale = true;
    mount();
    const btn = buttonByText(/^Retry$/);
    expect(btn, "a stale calendar must offer a way back").toBeTruthy();
    click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("names a last-updated time only when a real one exists", () => {
    state.bookings = [staleRow()];
    state.stale = true;
    state.lastSyncedAt = null;
    mount();
    // No successful refresh has ever landed — inventing "just now" would be the lie.
    expect(text()).toMatch(/Calendar may be out of date/i);
    expect(text()).not.toMatch(/Last updated/i);

    act(() => root.unmount());
    container.remove();

    state.lastSyncedAt = new Date();
    mount();
    expect(text()).toMatch(/Last updated/i);
  });

  it("drops the notice once the calendar is fresh again", () => {
    state.bookings = [staleRow()];
    state.stale = true;
    mount();
    expect(text()).toMatch(/Calendar may be out of date/i);

    act(() => root.unmount());
    container.remove();

    state.stale = false;
    state.lastSyncedAt = new Date();
    mount();
    expect(text()).not.toMatch(/may be out of date/i);
    expect(buttonByText(/^Retry$/)).toBeNull();
  });
});

describe("Solo Calendar — an open drawer follows the live rows", () => {
  /** Re-render with new rows the way a successful live refresh would. */
  function refreshWith(rows: SoloBooking[]) {
    state.bookings = rows;
    act(() => {
      root.render(
        <SoloCalendarWorkspace activeTenantId="tenant-1" connectionsHref="/solo/1/integrations" />,
      );
    });
  }

  it("follows a booking that MOVED, instead of reporting the old time", () => {
    state.bookings = [booking({
      id: "b1", title: "Discovery call", start_at: todayAt(10), end_at: todayAt(11),
    })];
    mount();
    click(chip(/Discovery call/)!);
    expect(dialog()?.textContent).toContain("10:00");

    refreshWith([booking({
      id: "b1", title: "Discovery call", start_at: todayAt(15), end_at: todayAt(16),
    })]);

    const d = dialog();
    expect(d).toBeTruthy();
    expect(d?.textContent).toContain("3:00");
    expect(d?.textContent).not.toContain("10:00");
  });

  it("follows a status change, so a cancelled appointment does not still read scheduled", () => {
    state.bookings = [booking({ id: "b1", title: "Discovery call", status: "scheduled", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    click(chip(/Discovery call/)!);
    expect(dialog()?.textContent).toContain("scheduled");

    refreshWith([booking({ id: "b1", title: "Discovery call", status: "cancelled", start_at: todayAt(10), end_at: todayAt(11) })]);
    expect(dialog()?.textContent).toContain("cancelled");
  });

  it("keeps focus inside the surface when the drawer closes because its booking vanished", () => {
    // The drawer restores focus to the element that opened it — but that element
    // is the chip, and when the booking is deleted the chip is gone too. Without
    // a fallback, focus is restored NOWHERE and a keyboard user is dropped onto
    // document.body with the panel gone from under them.
    state.bookings = [booking({ id: "b1", title: "Discovery call", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    const opener = chip(/Discovery call/)!;
    opener.focus();
    click(opener);
    expect(dialog()).toBeTruthy();

    refreshWith([]);

    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it("closes the drawer when the booking is GONE, rather than leaving actions on a row that no longer exists", () => {
    state.bookings = [booking({ id: "b1", title: "Discovery call", start_at: todayAt(10), end_at: todayAt(11) })];
    mount();
    click(chip(/Discovery call/)!);
    expect(dialog()).toBeTruthy();

    refreshWith([]);
    expect(dialog()).toBeNull();
  });

  it("leaves an untouched drawer open across a refresh that changed nothing about it", () => {
    state.bookings = [
      booking({ id: "b1", title: "Discovery call", start_at: todayAt(10), end_at: todayAt(11) }),
      booking({ id: "b2", title: "Strategy session", start_at: todayAt(13), end_at: todayAt(14) }),
    ];
    mount();
    click(chip(/Discovery call/)!);
    expect(dialog()).toBeTruthy();

    // A different appointment changed; this one did not.
    refreshWith([
      booking({ id: "b1", title: "Discovery call", start_at: todayAt(10), end_at: todayAt(11) }),
      booking({ id: "b2", title: "Strategy session", start_at: todayAt(16), end_at: todayAt(17) }),
    ]);
    expect(dialog()?.textContent).toContain("Discovery call");
  });
});
