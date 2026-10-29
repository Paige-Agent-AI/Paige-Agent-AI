import { afterEach, expect, it, vi } from "vitest";
import type { SoloBooking } from "@/components/tenant-calendar/useSoloCalendar";
import { localDateInZone } from "../../../supabase/functions/_shared/paige-context/snapshot";
import { rangeFor } from "@/components/tenant-calendar/useSoloCalendar";
import { operationsWeek } from "./operations-week";
import { weeklyCalendarBookings, weeklyCalendarCursor } from "./operations-weekly-calendar";

const week = (date = "2026-10-29", zone = "America/New_York") => {
  const value = operationsWeek("test-tenant", [], [], { kind: "configured", date, zone });
  if (value.kind !== "ready") throw new Error("Week fixture is invalid");
  return value;
};
const booking = (id: string, changes: Partial<SoloBooking> = {}): SoloBooking => ({
  id, title: `Appointment ${id}`, start_at: "2026-10-29T14:00:00Z", end_at: "2026-10-29T15:00:00Z", status: "confirmed",
  source: "internal", guest_name: null, guest_email: null, guest_phone: null, calendar_id: null, location_type: null,
  location_value: null, notes: null, booking_kind: "appointment", capacity: null, class_session_id: null,
  host_user_id: "owner-a", host_full_name: null, timezone: "America/New_York", intake_answers: null, appointment_type: null, ...changes,
});
afterEach(() => vi.unstubAllEnvs());

it.each(["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York"])("covers the business week from a %s device across DST and distant zones", deviceZone => {
  vi.stubEnv("TZ", deviceZone);
  for (const businessZone of ["America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Australia/Sydney"]) {
    for (const date of ["2026-03-08", "2026-10-04", "2026-11-01", "2026-12-31"]) {
      const current = week(date, businessZone), cursor = weeklyCalendarCursor(current);
      expect(cursor).not.toBeNull();
      const [from, to] = rangeFor("agenda", cursor!);
      expect(localDateInZone(from.getTime(), businessZone)! < current.days[0].date).toBe(true);
      expect(localDateInZone(to.getTime() - 1, businessZone)! > current.days[6].date).toBe(true);
    }
  }
});
it("withholds invalid business-zone or insufficient Calendar coverage", () => {
  expect(weeklyCalendarCursor({ ...week(), zone: "Unavailable/Zone" })).toBeNull();
  expect(weeklyCalendarCursor({ ...week(), days: week().days.map((day, index) => index === 6 ? { ...day, date: "2027-01-01" } : day) })).toBeNull();
});
it("uses actual host ownership and the native conflict detector, without mutating records", () => {
  const records = [booking("first"), booking("overlap", { start_at: "2026-10-29T14:30:00Z", end_at: "2026-10-29T15:30:00Z" }),
    booking("adjacent", { start_at: "2026-10-29T15:30:00Z", end_at: "2026-10-29T16:00:00Z" }),
    booking("foreign-host", { host_user_id: "owner-b" }), booking("unassigned", { host_user_id: null }),
    booking("cancelled", { status: "cancelled" }), booking("no-show", { status: "no_show" })];
  const before = JSON.stringify(records), review = weeklyCalendarBookings(week(), "owner-a", records);
  expect(review.rows.map(row => row.id)).toEqual(["first", "overlap", "adjacent"]);
  expect([...review.conflicts]).toEqual(["first", "overlap"]); expect(review.unassigned).toBe(1);
  expect(JSON.stringify(records)).toBe(before);
});
it("includes multi-day commitments and respects exclusive midnight ends in the business zone", () => {
  const records = [booking("ends-before-week", { start_at: "2026-10-25T04:00:00Z", end_at: "2026-10-26T04:00:00Z" }),
    booking("spans-week", { start_at: "2026-10-25T04:00:00Z", end_at: "2026-11-03T05:00:00Z" }),
    booking("starts-after-week", { start_at: "2026-11-02T05:00:00Z", end_at: "2026-11-02T06:00:00Z" }),
    booking("sunday", { start_at: "2026-11-01T05:30:00Z", end_at: "2026-11-01T06:30:00Z" })];
  expect(weeklyCalendarBookings(week(), "owner-a", records).rows.map(row => row.id)).toEqual(["spans-week", "sunday"]);
});
it("does not adopt device-local or malformed times and excludes invalid durations", () => {
  const records = [booking("offset-free", { start_at: "2026-10-29T10:00:00" }), booking("invalid", { end_at: "not a date" }),
    booking("zero", { end_at: "2026-10-29T14:00:00Z" }), booking("reverse", { end_at: "2026-10-29T13:00:00Z" }),
    booking("other-invalid", { host_user_id: "owner-b", end_at: "not a date" })];
  const review = weeklyCalendarBookings(week(), "owner-a", records);
  expect(review.rows).toEqual([]); expect(review.unreadable).toBe(4); expect(review.conflicts.size).toBe(0);
});
