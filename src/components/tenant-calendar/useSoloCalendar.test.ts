import { describe, expect, it } from "vitest";
import {
  UNASSIGNED_CALENDAR, addDays, bookingWriteMessage, buildCreateBookingArgs, classifyBookingWriteError,
  defaultCalendarForClient,
  findConflicts, foldClassSeats, rangeFor, rangeLabel, startOfWeek,
  type CreateBookingInput, type SoloBooking,
} from "./useSoloCalendar";

function booking(over: Partial<SoloBooking> & { id: string; start_at: string; end_at: string }): SoloBooking {
  return {
    title: "Consult", status: "scheduled", source: "manual",
    guest_name: null, guest_email: null, guest_phone: null, calendar_id: null,
    location_type: null, location_value: null, notes: null,
    booking_kind: "appointment", capacity: null, class_session_id: null,
    intake_answers: null, appointment_type: null,
    host_user_id: "host-a", host_full_name: null, timezone: null,
    ...over,
  };
}

describe("rangeLabel", () => {
  // The shipped label handed Intl a `{day, year}` skeleton whenever the week sat
  // inside one month. That skeleton has no CLDR pattern, so ICU emitted the
  // literal field name and the toolbar read "Aug 23 – 2026 (day: 29)".
  it("does not emit an Intl field-name fallback for a same-month week", () => {
    const label = rangeLabel("week", new Date(2026, 7, 26));
    expect(label).not.toMatch(/\(day:/);
    expect(label).not.toMatch(/\(month:/);
  });

  it("renders a same-month week as one month, two days and a year", () => {
    expect(rangeLabel("week", new Date(2026, 7, 26))).toBe("Aug 23 – 29, 2026");
  });

  it("names both months when the week straddles a boundary", () => {
    // Aug 30 2026 is a Sunday, so this week runs Aug 30 – Sep 5.
    expect(rangeLabel("week", new Date(2026, 7, 31))).toBe("Aug 30 – Sep 5, 2026");
  });

  it("labels a month view with the month and year alone", () => {
    expect(rangeLabel("month", new Date(2026, 7, 15))).toBe("August 2026");
  });

  it("labels the agenda as its real fourteen-day window", () => {
    expect(rangeLabel("agenda", new Date(2026, 7, 3))).toBe("Aug 3 – 16, 2026");
  });
});

describe("rangeFor", () => {
  it("asks for exactly the week that is drawn", () => {
    const cursor = new Date(2026, 7, 26);
    const [from, to] = rangeFor("week", cursor);
    expect(from.getTime()).toBe(startOfWeek(cursor).getTime());
    expect(to.getTime()).toBe(addDays(startOfWeek(cursor), 7).getTime());
  });

  it("covers the whole six-week month grid", () => {
    const [from, to] = rangeFor("month", new Date(2026, 7, 15));
    expect(Math.round((to.getTime() - from.getTime()) / 86400000)).toBe(42);
  });
});

describe("findConflicts", () => {
  it("reports nothing for an empty book — no invented conflicts", () => {
    expect(findConflicts([]).size).toBe(0);
  });

  it("flags two appointments that genuinely overlap on one host", () => {
    const c = findConflicts([
      booking({ id: "a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "b", start_at: "2026-08-24T14:30:00Z", end_at: "2026-08-24T15:30:00Z" }),
    ]);
    expect([...c].sort()).toEqual(["a", "b"]);
  });

  it("treats back-to-back appointments as clear, not overlapping", () => {
    const c = findConflicts([
      booking({ id: "a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "b", start_at: "2026-08-24T15:00:00Z", end_at: "2026-08-24T16:00:00Z" }),
    ]);
    expect(c.size).toBe(0);
  });

  it("does not flag an overlap across two different hosts", () => {
    const c = findConflicts([
      booking({ id: "a", host_user_id: "host-a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "b", host_user_id: "host-b", start_at: "2026-08-24T14:30:00Z", end_at: "2026-08-24T15:30:00Z" }),
    ]);
    expect(c.size).toBe(0);
  });

  it("ignores a cancelled appointment — it no longer holds the slot", () => {
    const c = findConflicts([
      booking({ id: "a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "b", status: "cancelled", start_at: "2026-08-24T14:30:00Z", end_at: "2026-08-24T15:30:00Z" }),
    ]);
    expect(c.size).toBe(0);
  });

  it("ignores a no-show for the same reason", () => {
    const c = findConflicts([
      booking({ id: "a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "b", status: "no_show", start_at: "2026-08-24T14:30:00Z", end_at: "2026-08-24T15:30:00Z" }),
    ]);
    expect(c.size).toBe(0);
  });

  it("flags every member of a three-way pile-up", () => {
    const c = findConflicts([
      booking({ id: "a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T16:00:00Z" }),
      booking({ id: "b", start_at: "2026-08-24T14:30:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "c", start_at: "2026-08-24T15:30:00Z", end_at: "2026-08-24T17:00:00Z" }),
    ]);
    expect([...c].sort()).toEqual(["a", "b", "c"]);
  });
});

/* ------------------------------------------------------ class seat folding --- */

/**
 * `list_team_bookings` returns a class as SEVERAL rows: one `class_session`
 * marker plus one `class_seat` per attendee, all sharing the session's host and
 * its exact start/end. Handing every one of those rows to the grid draws the
 * class N+1 times, and handing them to `findConflicts` marks every attendee as a
 * double-booking of the host — which is what shipped, and what these cover.
 */
const CLASS_START = "2026-08-24T18:00:00Z";
const CLASS_END = "2026-08-24T19:00:00Z";

function classRows() {
  return [
    booking({
      id: "class-1", title: "Group coaching", booking_kind: "class_session",
      capacity: 8, start_at: CLASS_START, end_at: CLASS_END,
    }),
    booking({
      id: "seat-1", booking_kind: "class_seat", class_session_id: "class-1",
      guest_name: "Attendee One", start_at: CLASS_START, end_at: CLASS_END,
    }),
    booking({
      id: "seat-2", booking_kind: "class_seat", class_session_id: "class-1",
      guest_name: "Attendee Two", start_at: CLASS_START, end_at: CLASS_END,
    }),
    booking({
      id: "seat-3", booking_kind: "class_seat", class_session_id: "class-1",
      guest_name: "Attendee Three", start_at: CLASS_START, end_at: CLASS_END,
    }),
  ];
}

describe("foldClassSeats", () => {
  it("draws a class with three attendees as ONE appointment, not four", () => {
    expect(foldClassSeats(classRows()).visible.map((b) => b.id)).toEqual(["class-1"]);
  });

  it("stops the attendees being reported as host conflicts", () => {
    // Every one of those four rows shares host-a and the same hour, so the
    // unfolded list is a four-way pile-up on the host.
    expect(findConflicts(classRows()).size).toBe(4);
    expect(findConflicts(foldClassSeats(classRows()).visible).size).toBe(0);
  });

  it("keeps every attendee record, filed under its session", () => {
    const seats = foldClassSeats(classRows()).seatsBySession.get("class-1") ?? [];
    expect(seats.map((s) => s.guest_name)).toEqual(["Attendee One", "Attendee Two", "Attendee Three"]);
  });

  it("counts only the seats that still hold a place", () => {
    const rows = classRows();
    rows[2] = { ...rows[2], status: "cancelled" };
    const seats = foldClassSeats(rows).seatsBySession.get("class-1") ?? [];
    // The cancelled attendee is KEPT as a record — the detail can say they
    // cancelled — but the surface must never count them as booked.
    expect(seats).toHaveLength(3);
    expect(seats.filter((s) => s.status !== "cancelled" && s.status !== "no_show")).toHaveLength(2);
  });

  it("reports no seats for a class nobody has joined — never an invented count", () => {
    const [session] = classRows();
    const { visible, seatsBySession } = foldClassSeats([session]);
    expect(visible.map((b) => b.id)).toEqual(["class-1"]);
    expect(seatsBySession.get("class-1")).toBeUndefined();
  });

  it("leaves a seat whose session is not in this range visible rather than dropping it", () => {
    // A seat that has nothing to fold into is still a real booking. Discarding
    // it would delete an appointment from the tenant's own schedule.
    const orphan = booking({
      id: "seat-orphan", booking_kind: "class_seat", class_session_id: "class-elsewhere",
      guest_name: "Attendee Four", start_at: CLASS_START, end_at: CLASS_END,
    });
    expect(foldClassSeats([orphan]).visible.map((b) => b.id)).toEqual(["seat-orphan"]);
  });

  it("leaves an ordinary appointment exactly as it found it", () => {
    const rows = [
      booking({ id: "a", start_at: "2026-08-24T14:00:00Z", end_at: "2026-08-24T15:00:00Z" }),
      booking({ id: "b", start_at: "2026-08-24T16:00:00Z", end_at: "2026-08-24T17:00:00Z" }),
    ];
    const { visible, seatsBySession } = foldClassSeats(rows);
    expect(visible).toEqual(rows);
    expect(seatsBySession.size).toBe(0);
  });

  it("still flags a REAL clash between a class and a separate appointment", () => {
    // Folding must not make the host look free: an unrelated booking that
    // genuinely overlaps the class is still a conflict.
    const rows = [
      ...classRows(),
      booking({ id: "solo", start_at: "2026-08-24T18:30:00Z", end_at: "2026-08-24T19:30:00Z" }),
    ];
    expect([...findConflicts(foldClassSeats(rows).visible)].sort()).toEqual(["class-1", "solo"]);
  });
});

describe("bookingWriteMessage", () => {
  // The reschedule and edit seams raise these exact SQLSTATEs (the overlap codes
  // come from the DB exclusion constraint, the rest from the shared guard). Each
  // must become one honest sentence, and an unrecognised failure must surface its
  // real cause verbatim rather than be flattened to a generic line (§13/§32).
  it("names an overlap for both the unique and the exclusion-constraint code", () => {
    const taken = "Something is already on your schedule at that time.";
    expect(bookingWriteMessage({ code: "23505", message: "duplicate key" })).toBe(taken);
    expect(bookingWriteMessage({ code: "23P01", message: "conflicting key value violates exclusion constraint" })).toBe(taken);
  });

  it("maps the guard's own error codes to their plain meaning", () => {
    expect(bookingWriteMessage({ code: "42501", message: "BOOKING_FORBIDDEN: wrong tenant" }))
      .toBe("You can't change that booking.");
    expect(bookingWriteMessage({ code: "P0002", message: "BOOKING_NOT_FOUND" }))
      .toBe("That appointment no longer exists.");
    expect(bookingWriteMessage({ code: "22023", message: "BOOKING_BAD_TIME: end must be after start" }))
      .toBe("That time could not be used.");
  });

  // 22023 is shared: reschedule raises it for a bad time, but the edit seam also
  // raises it for a missing title or a calendar that left the tenant. Reporting
  // "that time could not be used" for a details edit that never touched the time
  // would be a lie (§13) — the guard's prefix decides the sentence.
  it("tells 22023 sub-cases apart by the guard's message prefix", () => {
    expect(bookingWriteMessage({ code: "22023", message: "BOOKING_TITLE_REQUIRED" }))
      .toBe("An appointment needs a title.");
    expect(bookingWriteMessage({ code: "22023", message: "BOOKING_BAD_CALENDAR: calendar not in this tenant" }))
      .toBe("That calendar is no longer available.");
    // A bare/unknown 22023 (e.g. a genuine bad time) keeps the time sentence.
    expect(bookingWriteMessage({ code: "22023", message: "some other 22023" }))
      .toBe("That time could not be used.");
  });

  it("surfaces an unrecognised failure verbatim instead of swallowing it", () => {
    expect(bookingWriteMessage({ code: "08006", message: "connection failure" })).toBe("connection failure");
    expect(bookingWriteMessage({ message: "no code at all" })).toBe("no code at all");
  });
});

describe("classifyBookingWriteError", () => {
  // The create seam routes refusals through this so a real live failure reports an
  // honest, actionable CATEGORY and never reads as a booked appointment (§13/§32).
  it("classifies an overlap as a conflict for both constraint codes", () => {
    for (const code of ["23505", "23P01"]) {
      expect(classifyBookingWriteError({ code, message: "x" }, "add")).toEqual({
        category: "conflict", message: "Something is already on your schedule at that time.",
      });
    }
  });

  it("phrases a 42501 as an authority/workspace problem on add, and a change refusal on change", () => {
    expect(classifyBookingWriteError({ code: "42501", message: "BOOKING_FORBIDDEN: staff of this tenant required" }, "add"))
      .toEqual({ category: "forbidden", message: expect.stringMatching(/can’t add an appointment here/i) });
    expect(classifyBookingWriteError({ code: "42501", message: "BOOKING_FORBIDDEN: auth required" }, "change"))
      .toEqual({ category: "forbidden", message: "You can't change that booking." });
  });

  it("reads the RPC not resolving (not deployed / ambiguous overload) as 'nothing was booked', by code OR message", () => {
    const owed = { category: "unavailable" as const, message: expect.stringMatching(/nothing was booked/i) };
    expect(classifyBookingWriteError({ code: "PGRST202", message: "Could not find the function public.create_internal_booking(...) in the schema cache" }, "add")).toEqual(owed);
    expect(classifyBookingWriteError({ code: "PGRST203", message: "Could not choose the best candidate function" }, "add")).toEqual(owed);
    // Even with no recognised code, the tell in the message routes to unavailable.
    expect(classifyBookingWriteError({ message: "No function matches the given name and argument types" }, "add")).toEqual(owed);
  });

  it("splits 22023 into the real invalid reason by the guard's prefix", () => {
    expect(classifyBookingWriteError({ code: "22023", message: "BOOKING_TITLE_REQUIRED" }, "add").message).toMatch(/needs a title/i);
    expect(classifyBookingWriteError({ code: "22023", message: "BOOKING_BAD_CALENDAR: calendar not in this tenant" }, "add").message).toMatch(/no longer available/i);
    expect(classifyBookingWriteError({ code: "22023", message: "BOOKING_BAD_HOST: host is not a member of this tenant" }, "add").message).toMatch(/host isn’t on this workspace/i);
    expect(classifyBookingWriteError({ code: "22023", message: "BOOKING_BAD_TIME: end must be after start" }, "add").message).toMatch(/time could not be used/i);
    for (const c of ["22023"]) expect(classifyBookingWriteError({ code: c, message: "x" }, "add").category).toBe("invalid");
  });

  it("names a transport failure as network when there is no SQLSTATE, and surfaces any other cause verbatim", () => {
    expect(classifyBookingWriteError({ message: "TypeError: Failed to fetch" }, "add")).toEqual({
      category: "network", message: expect.stringMatching(/couldn’t reach the scheduling service/i),
    });
    expect(classifyBookingWriteError({ message: "" }, "add").category).toBe("network");
    // A coded-but-unmapped failure keeps its real cause (never swallowed).
    expect(classifyBookingWriteError({ code: "40001", message: "serialization failure" }, "add")).toEqual({
      category: "unknown", message: "serialization failure",
    });
  });
});

describe("buildCreateBookingArgs — a session the business books for a client", () => {
  const ctx = { uid: "host-user", tenantId: "tenant-northwind", timezone: "America/Chicago" };
  const base: CreateBookingInput = {
    title: "Strategy session", startAt: new Date("2026-11-03T15:00:00Z"), durationMinutes: 45,
    calendarId: "cal-1", guestName: "Jordan Rivera", blocked: false,
  };

  it("links the chosen client as _contact_id, so that client can see the session in their portal", () => {
    const args = buildCreateBookingArgs({ ...base, contactId: "client-jordan" }, ctx);
    expect(args._contact_id).toBe("client-jordan");
    expect(args._guest_name).toBe("Jordan Rivera");
    expect(args._tenant_id).toBe("tenant-northwind");
    expect(args._status).toBe("scheduled");
  });

  it("sends no _contact_id for a guest who is not a client — the payload is what it always was", () => {
    expect(buildCreateBookingArgs({ ...base, contactId: null }, ctx)).toEqual({
      _title: "Strategy session",
      _start_at: "2026-11-03T15:00:00.000Z",
      _end_at: "2026-11-03T15:45:00.000Z",
      _timezone: "America/Chicago",
      _host_user_id: "host-user",
      _guest_name: "Jordan Rivera",
      _tenant_id: "tenant-northwind",
      _calendar_id: "cal-1",
      _status: "scheduled",
      _source: "manual",
    });
    expect("_contact_id" in buildCreateBookingArgs(base, ctx)).toBe(false);
  });

  it("never attaches a client to blocked time, and leaves the blocked payload unchanged", () => {
    const args = buildCreateBookingArgs(
      { ...base, title: "", guestName: null, blocked: true, calendarId: UNASSIGNED_CALENDAR, contactId: "client-jordan" },
      ctx,
    );
    expect("_contact_id" in args).toBe(false);
    expect(args).toMatchObject({ _title: "Blocked", _status: "blocked", _calendar_id: null, _guest_name: null });
  });

  it("treats a blank client id as no client", () => {
    expect("_contact_id" in buildCreateBookingArgs({ ...base, contactId: "  " }, ctx)).toBe(false);
  });
});

describe("classifyBookingWriteError — a client from another workspace", () => {
  it("names the client refusal instead of calling it a bad time", () => {
    const r = classifyBookingWriteError({ code: "22023", message: "BOOKING_BAD_CONTACT: contact not in this tenant" }, "add");
    expect(r.category).toBe("invalid");
    expect(r.message).toMatch(/client isn’t in this workspace/);
    expect(r.message).not.toMatch(/time could not be used/);
  });
});

describe("defaultCalendarForClient — a client session must land somewhere the portal can change it", () => {
  it("offers the first calendar when none is paused", () => {
    expect(defaultCalendarForClient([{ id: "cal-intro", enabled: true }, { id: "cal-review", enabled: true }])).toBe("cal-intro");
  });

  it("treats a calendar whose open state was never recorded as open", () => {
    expect(defaultCalendarForClient([{ id: "cal-intro", enabled: null }])).toBe("cal-intro");
  });

  it("skips a paused calendar, because the portal refuses to reschedule on one", () => {
    expect(defaultCalendarForClient([{ id: "cal-paused", enabled: false }, { id: "cal-open", enabled: true }])).toBe("cal-open");
  });

  it("returns nothing when there is no calendar to offer", () => {
    expect(defaultCalendarForClient([])).toBeNull();
    expect(defaultCalendarForClient([{ id: "cal-paused", enabled: false }])).toBeNull();
  });
});
