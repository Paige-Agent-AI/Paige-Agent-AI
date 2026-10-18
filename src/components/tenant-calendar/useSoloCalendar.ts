import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

/**
 * Real calendar reads/writes for the Solo-native Calendar surface.
 *
 * This is a SECOND CALLER of the same seams CalendarAdmin already uses — never a
 * second data model. Every read is scoped by the SERVER-RESOLVED `activeTenantId`
 * the adapter passes down (§9); no tenant identifier is accepted from the URL or
 * the request body. `list_team_bookings` is itself tenant-isolated and
 * overlap-aware, and `admin_set_booking_status` performs the change server-side
 * so a refusal is reported truthfully rather than silently no-oping (§13).
 */

export type ViewMode = "week" | "month" | "agenda";

/** Mirrors the shape `list_team_bookings` returns. Kept structural, not imported,
 *  so this hook does not depend on the 1,230-line admin page's module graph. */
export interface SoloBooking {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  source: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  calendar_id: string | null;
  location_type: string | null;
  location_value: string | null;
  notes: string | null;
  booking_kind: string;
  capacity: number | null;
  /** Set on a `class_seat` row: the `class_session` it belongs to. Returned by
   *  `list_team_bookings` and previously discarded here, which is what left a
   *  class rendering once per attendee. */
  class_session_id: string | null;
  host_user_id: string | null;
  host_full_name: string | null;
  timezone: string | null;
  /** Both are returned by `list_team_bookings` and were previously discarded.
   *  `intake_answers` is keyed by question id; the labels live on the calendar. */
  intake_answers: Record<string, unknown> | null;
  appointment_type: { name?: string; duration_min?: number } | null;
}

/** One stored working window. `day` is 0=Sun..6=Sat, times are "HH:MM" local to
 *  the calendar's own timezone. Shape mirrors what `public-booking` parses. */
export interface DayWindow { day: number; start: string; end: string }

/** A stored exception for one date: either the whole day off, or replacement windows. */
export interface DateOverride { date: string; blocked: boolean; windows: { start: string; end: string }[] }

/** A single reminder row out of `calendars.notify_config.reminders`. The channel
 *  vocabulary is the sender's own (`process-booking-notifications`): "email",
 *  "sms", or "both"; recipient is "guest" (the column default), "host" or "both". */
export interface CalendarReminder {
  channel: "email" | "sms" | "both";
  offset_min: number;
  to: "guest" | "host" | "both";
}
/** `calendars.notify_config` — Calendar-owned appointment communication: WHETHER a
 *  confirmation goes out and WHEN a reminder fires. It does NOT record whether an
 *  SMS-capable channel is connected or permitted; that lives with the tenant's
 *  phone identity, is not read here, and must never be inferred from this row. */
export interface CalendarNotifyConfig {
  confirm_guest: boolean;
  confirm_host: boolean;
  reminders: CalendarReminder[];
}

export interface SoloCalendarMeta {
  id: string;
  title: string;
  color: string | null;
  accent: string | null;
  type: string | null;
  /** Real configuration, read straight off the `calendars` row. Every one of these
   *  is a stored column — none is defaulted here, because a default rendered as
   *  stored data is a fabrication (§13). `availability_json` in particular is NULL
   *  on every auto-provisioned calendar, and the Mon–Fri 9–5 fallback that the
   *  public booking engine applies lives in that edge function, NOT in the row. */
  slug: string | null;
  enabled: boolean | null;
  duration_min: number | null;
  buffer_before_min: number | null;
  buffer_after_min: number | null;
  min_notice_min: number | null;
  booking_horizon_days: number | null;
  capacity: number | null;
  timezone: string | null;
  location_type: string | null;
  location_value: string | null;
  /** The four jsonb columns arrive as arbitrary JSON, and are typed as such. The
   *  database guarantees they PARSE, never that they hold the shape this surface
   *  expects — a hand-edited or half-migrated row can hold anything. So every read
   *  goes through a parser below (`parseNotifyConfig` · `parseWindows` ·
   *  `parseOverrides` · `parseIntakeQuestions`) which returns the honest shape or
   *  nothing. Declaring them pre-parsed would be a lie the compiler then enforces,
   *  and the first malformed row would throw inside a render. */
  notify_config: unknown;
  availability_json: unknown;
  date_overrides: unknown;
  intake_questions: unknown;
}

/** The exact column list read from `calendars`. Kept as one constant so the select
 *  and the type cannot drift apart. */
export const CALENDAR_COLUMNS =
  "id, title, color, accent, type, slug, enabled, duration_min, buffer_before_min, buffer_after_min, min_notice_min, booking_horizon_days, capacity, timezone, location_type, location_value, notify_config, availability_json, date_overrides, intake_questions" as const;

export const UNASSIGNED_CALENDAR = "__unassigned__";
/** The one fallback tint, used only when a calendar stores no colour of its own. */
export const DEFAULT_CALENDAR_COLOR = "#7A67E8";

export function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d: Date) { const x = startOfDay(d); return addDays(x, -x.getDay()); }

export function rangeFor(view: ViewMode, cursor: Date): [Date, Date] {
  if (view === "agenda") { const s = startOfDay(cursor); return [s, addDays(s, 14)]; }
  if (view === "week") { const s = startOfWeek(cursor); return [s, addDays(s, 7)]; }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const s = startOfWeek(first);
  return [s, addDays(s, 42)];
}

/**
 * The range label.
 *
 * Written out field-by-field rather than handing Intl a `{day, year}` skeleton.
 * That skeleton has no CLDR pattern, so ICU falls back to emitting the literal
 * field name — which is exactly how the shipped label rendered
 * "Aug 23 – 2026 (day: 29)" for any week inside a single month.
 */
export function rangeLabel(view: ViewMode, cursor: Date): string {
  if (view === "month") {
    return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const [s, endExclusive] = rangeFor(view, cursor);
  const e = addDays(endExclusive, -1);
  const year = e.getFullYear();
  const sMonth = s.toLocaleDateString(undefined, { month: "short" });
  const eMonth = e.toLocaleDateString(undefined, { month: "short" });
  return s.getMonth() === e.getMonth()
    ? `${sMonth} ${s.getDate()} – ${e.getDate()}, ${year}`
    : `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${year}`;
}

/** A stable, well-spread hue per host. Hosts store no colour of their own, so
 *  colour-by-host derives one; fixed S/L keeps it AA-legible in both themes. */
export function hostColor(id: string | null): string {
  if (!id) return DEFAULT_CALENDAR_COLOR;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${(h % 24) * 15} 62% 48%)`;
}

/** A booking that no longer occupies time cannot collide with anything. */
function occupiesTime(b: SoloBooking) {
  return b.status !== "cancelled" && b.status !== "no_show";
}

/**
 * REAL conflict detection: two bookings collide when they share a host and their
 * [start, end) intervals actually overlap. Nothing here is inferred from a title,
 * a duration heuristic, or a hardcoded date — an empty book yields zero conflicts.
 */
export function findConflicts(bookings: SoloBooking[]): Set<string> {
  const conflicted = new Set<string>();
  const byHost = new Map<string, SoloBooking[]>();
  for (const b of bookings) {
    if (!occupiesTime(b)) continue;
    const key = b.host_user_id ?? "__unhosted__";
    const list = byHost.get(key);
    if (list) list.push(b); else byHost.set(key, [b]);
  }
  for (const list of byHost.values()) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const aEnd = new Date(a.end_at).getTime();
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (new Date(b.start_at).getTime() >= aEnd) break; // sorted — nothing later can overlap
        conflicted.add(a.id);
        conflicted.add(b.id);
      }
    }
  }
  return conflicted;
}

/* ------------------------------------------------------ class seat folding --- */

export interface FoldedBookings {
  /** What the grid and the conflict detector see: one row per real appointment. */
  visible: SoloBooking[];
  /** Every attendee row, kept whole, filed under the session it belongs to. */
  seatsBySession: Map<string, SoloBooking[]>;
}

/**
 * Fold a class's attendee rows onto the class itself.
 *
 * `list_team_bookings` returns a group booking as a `class_session` marker PLUS
 * one `class_seat` row per attendee, every one of them carrying the session's
 * host and its exact start/end. Handing those rows straight to the surface draws
 * the class once per attendee, and handing them to `findConflicts` reports every
 * attendee as a double-booking of the host — both of which shipped.
 *
 * The seats are folded, never DISCARDED: the detail drawer lists the real
 * attendees off this map, and a seat whose session is not in the fetched range
 * stays visible on its own rather than disappearing from the schedule.
 */
export function foldClassSeats(rows: SoloBooking[]): FoldedBookings {
  const sessionIds = new Set<string>();
  for (const b of rows) if (b.booking_kind === "class_session") sessionIds.add(b.id);

  const seatsBySession = new Map<string, SoloBooking[]>();
  const visible: SoloBooking[] = [];
  for (const b of rows) {
    const sid = b.class_session_id;
    if (b.booking_kind === "class_seat" && sid && sessionIds.has(sid)) {
      const held = seatsBySession.get(sid);
      if (held) held.push(b); else seatsBySession.set(sid, [b]);
      continue;
    }
    visible.push(b);
  }
  return { visible, seatsBySession };
}

/** The attendees who still hold their place. A cancelled or no-show seat stays in
 *  the record — the detail can say so — but is never counted as booked. The count
 *  is only ever the rows that exist; it is never derived from capacity (§13). */
export function seatsHeld(seats: SoloBooking[] | undefined): SoloBooking[] {
  return (seats ?? []).filter(occupiesTime);
}

/* ------------------------------------------------------------ availability --- */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse stored working windows, or return null when the calendar stores none.
 *
 * NULL IS LOAD-BEARING AND MUST SURVIVE. Every auto-provisioned calendar has
 * `availability_json = NULL`, and the Mon–Fri 09:00–17:00 that public booking
 * applies lives in THAT EDGE FUNCTION, not in the row. Substituting it here would
 * paint stored hours a tenant never set — a fabrication in exactly the shape §13
 * forbids. An unconfigured calendar therefore reads as unconfigured.
 */
export function parseWindows(raw: unknown): DayWindow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DayWindow[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const { day, start, end } = w as Record<string, unknown>;
    if (typeof day !== "number" || day < 0 || day > 6) continue;
    if (typeof start !== "string" || !TIME.test(start)) continue;
    if (typeof end !== "string" || !TIME.test(end)) continue;
    if (end <= start) continue;
    out.push({ day, start, end });
  }
  // A present-but-unusable value is not the same as an absent one, but neither is
  // it hours we can draw; both report as "nothing stored we can render".
  return out.length ? out : null;
}

/** Reads `calendars.intake_questions` — the labelled questions a booking's
 *  `intake_answers` keys refer to. Rows without a usable id/label are dropped
 *  rather than rendered as a blank question. */
export function parseIntakeQuestions(raw: unknown): { id: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q) => {
    if (!q || typeof q !== "object") return [];
    const { id, label } = q as Record<string, unknown>;
    return typeof id === "string" && typeof label === "string" ? [{ id, label }] : [];
  });
}

/** Reads `calendars.notify_config`. Returns null when the row stores nothing usable
 *  so the surface can say so, rather than rendering the column DEFAULT as if the
 *  owner had chosen it (§13). Unknown channels/recipients fall back to the sender's
 *  own coercion ("email" / "guest") so what is shown matches what would actually go. */
export function parseNotifyConfig(raw: unknown): CalendarNotifyConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const reminders: CalendarReminder[] = Array.isArray(o.reminders)
    ? o.reminders.flatMap((r) => {
        if (!r || typeof r !== "object") return [];
        const { channel, offset_min, to } = r as Record<string, unknown>;
        if (typeof offset_min !== "number" || !Number.isFinite(offset_min)) return [];
        const ch = channel === "sms" || channel === "both" ? channel : "email";
        const rcpt = to === "host" || to === "both" ? to : "guest";
        return [{ channel: ch as CalendarReminder["channel"], offset_min, to: rcpt as CalendarReminder["to"] }];
      })
    : [];
  if (typeof o.confirm_guest !== "boolean" && typeof o.confirm_host !== "boolean" && reminders.length === 0) {
    return null;
  }
  return { confirm_guest: o.confirm_guest === true, confirm_host: o.confirm_host === true, reminders };
}

/** True when this calendar's own reminder config asks for SMS. This is the ONLY
 *  condition under which the surface offers the Connections remediation path —
 *  Calendar decides that an SMS reminder should happen; whether an SMS channel is
 *  connected and permitted is decided elsewhere and is not read here. */
export function wantsSms(cfg: CalendarNotifyConfig | null): boolean {
  return !!cfg?.reminders.some((r) => r.channel === "sms" || r.channel === "both");
}

export function parseOverrides(raw: unknown): DateOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: DateOverride[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const { date, blocked, windows } = o as Record<string, unknown>;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const w = Array.isArray(windows)
      ? windows.flatMap((x) => {
          const s = (x as Record<string, unknown>)?.start;
          const e = (x as Record<string, unknown>)?.end;
          return typeof s === "string" && typeof e === "string" && TIME.test(s) && TIME.test(e) && e > s
            ? [{ start: s, end: e }]
            : [];
        })
      : [];
    out.push({ date, blocked: blocked === true, windows: w });
  }
  return out;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DayAvailability {
  /** false when the calendar stores no usable hours — render as unconfigured, never as 9–5. */
  configured: boolean;
  /** true when a stored date override marks the whole day off. */
  blocked: boolean;
  windows: { start: string; end: string }[];
}

/**
 * The stored hours for one calendar on one date: a date override wins over the
 * weekly pattern, exactly as the booking engine resolves it.
 */
export function availabilityFor(cal: SoloCalendarMeta, day: Date): DayAvailability {
  const windows = parseWindows(cal.availability_json);
  const override = parseOverrides(cal.date_overrides).find((o) => o.date === isoDate(day));
  if (override) {
    if (override.blocked) return { configured: true, blocked: true, windows: [] };
    if (override.windows.length) return { configured: true, blocked: false, windows: override.windows };
  }
  if (!windows) return { configured: false, blocked: false, windows: [] };
  const forDay = windows.filter((w) => w.day === day.getDay()).map(({ start, end }) => ({ start, end }));
  return { configured: true, blocked: false, windows: forDay };
}

/** "09:00" -> 9.5 for 09:30. Used to place shading on the hour grid. */
export function hourOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

export type LoadPhase = "loading" | "ready" | "error";

export interface UseSoloCalendarResult {
  /** Folded: a class is ONE appointment here, never one per attendee. */
  bookings: SoloBooking[];
  calendars: SoloCalendarMeta[];
  /** The attendee rows a class was folded from, keyed by session id. */
  seatsBySession: Map<string, SoloBooking[]>;
  conflicts: Set<string>;
  phase: LoadPhase;
  error: string | null;
  calendarsError: string | null;
  /** True when the most recent LIVE refresh failed and the rows on screen may no
   *  longer be true. The rows are deliberately kept — losing a schedule someone is
   *  reading is worse than showing it with an honest warning — so the surface owes
   *  the person a visible freshness state, not a console line. */
  stale: boolean;
  /** When the rows on screen were last actually confirmed against the database.
   *  Null until a read has genuinely succeeded, and NEVER advanced by a failed
   *  one: it names the last time the schedule was true, not the last attempt. */
  lastSyncedAt: Date | null;
  /** Re-read now, keeping the rows on screen while it runs. Resolves when the
   *  attempt has settled so a caller can show its own progress honestly. */
  retry: () => Promise<void>;
  refresh: () => void;
  setStatus: (id: string, status: string) => Promise<{ ok: boolean; message?: string }>;
  createBooking: (input: CreateBookingInput) => Promise<{ ok: boolean; message?: string; category?: BookingWriteCategory }>;
  /** Move a booking to a new time through the tenant-gated
   *  `reschedule_internal_booking` RPC — never a raw table UPDATE (RLS would scope
   *  it to the caller's own rows and a refusal would silently no-op, §13). The
   *  server enforces caller scope, the DB overlap constraint refuses a clash, and
   *  the UPDATE emits the `booking.rescheduled` governed Rail signal on its own. */
  reschedule: (id: string, startAt: Date, durationMinutes: number) => Promise<{ ok: boolean; message?: string }>;
  /** Edit a booking's details (title, guest, notes, calendar) through the
   *  tenant-gated `update_internal_booking` RPC. It never touches start/end or
   *  status, so it moves no time and files no false "moved"/"cancelled" Rail
   *  event — a details edit is not a client-visible scheduling moment. */
  edit: (input: EditBookingInput) => Promise<{ ok: boolean; message?: string }>;
  colorForBooking: (b: SoloBooking, colorBy: "calendar" | "host") => string;
}

export interface CreateBookingInput {
  title: string;
  startAt: Date;
  durationMinutes: number;
  calendarId: string;
  guestName: string | null;
  blocked: boolean;
  /** The business's own CRM client this appointment is FOR (`clients.id`), or null
   *  for a guest who is not a client. It is what lets that client see the session
   *  in their portal: the customer read matches `internal_bookings.contact_id`, and
   *  a free-text guest name links nothing. The server re-checks that the client
   *  belongs to this tenant (`BOOKING_BAD_CONTACT`), so this is a choice, never a
   *  grant. Optional so a caller that has no client to name changes nothing. */
  contactId?: string | null;
}

export interface EditBookingInput {
  id: string;
  title: string;
  guestName: string | null;
  notes: string | null;
  /** `UNASSIGNED_CALENDAR` sentinel maps to a real NULL calendar_id. */
  calendarId: string;
}

/**
 * Map a booking-write RPC failure to one honest sentence.
 *
 * The SQLSTATEs are the ones the shared server guard actually raises, plus the two
 * the overlap constraint raises: 23505 / 23P01 = the time collides with something
 * already held (create relies on these same two codes), 42501 = the caller may not
 * change this booking (`BOOKING_FORBIDDEN`), P0002 = the row is gone
 * (`BOOKING_NOT_FOUND`), 22023 = the time itself is invalid (`BOOKING_BAD_TIME`).
 * Anything else surfaces verbatim rather than being flattened to a generic line —
 * a swallowed real cause is exactly what §13/§32 forbid.
 */
/** A stable, machine-readable class for a booking write refusal, so a caller (and
 *  future telemetry) can act on the KIND of failure, not parse a sentence. Every
 *  category is honest about whether a write happened: `conflict`/`invalid`/
 *  `forbidden`/`not_found` are server refusals with no row written; `unavailable`
 *  means the request never resolved to the RPC (not deployed / ambiguous overload)
 *  so nothing was booked; `network` never reached the server; `unknown` surfaces
 *  the real cause verbatim rather than flattening it (§13). */
export type BookingWriteCategory =
  | "conflict" | "forbidden" | "not_found" | "invalid" | "unavailable" | "network" | "unknown";

export interface BookingWriteFailure { category: BookingWriteCategory; message: string; }

/**
 * Classify a booking write error into an honest, actionable category + sentence.
 *
 * `verb` tailors only the phrasing where add and change genuinely differ (a 42501
 * on create is "this account can't add here", on edit "you can't change that").
 * The category is operation-independent. A refusal must NEVER read as a success
 * and a real cause must NEVER be swallowed — an unrecognised failure surfaces
 * verbatim (§13/§32).
 */
export function classifyBookingWriteError(
  err: { code?: string; message?: string } | null | undefined,
  verb: "add" | "change" = "change",
): BookingWriteFailure {
  const message = err?.message ?? "";
  const code = err?.code;
  // PostgREST could not resolve the RPC — the function is not deployed, or two
  // overloads are ambiguous. The request never ran, so NOTHING was booked; say
  // that plainly and keep it retryable rather than dumping a schema-cache string.
  if (code === "PGRST202" || code === "PGRST203"
      || /could not find the function|no function matches|schema cache|choose the best candidate/i.test(message)) {
    return { category: "unavailable", message: "Scheduling isn’t available right now — nothing was booked. Please try again in a moment." };
  }
  switch (code) {
    case "23505":
    case "23P01":
      return { category: "conflict", message: "Something is already on your schedule at that time." };
    case "42501":
      return {
        category: "forbidden",
        message: verb === "add"
          ? "This account can’t add an appointment here — check you’re signed in to the workspace you mean to book on."
          : "You can't change that booking.",
      };
    case "P0002":
      return { category: "not_found", message: "That appointment no longer exists." };
    case "22023":
      // 22023 is shared across the booking seams: reschedule raises it for a bad
      // time, the edit/create seams also raise it for a missing title, a calendar
      // that no longer belongs to the tenant, or a host who is not on it. Reporting
      // "that time could not be used" for any of those would be a lie (§13), so the
      // guard's own message prefix decides the sentence.
      if (message.includes("BOOKING_TITLE_REQUIRED")) return { category: "invalid", message: "An appointment needs a title." };
      if (message.includes("BOOKING_BAD_CALENDAR")) return { category: "invalid", message: "That calendar is no longer available." };
      if (message.includes("BOOKING_BAD_HOST")) return { category: "invalid", message: "That host isn’t on this workspace." };
      // create_internal_booking refuses a client that is not this tenant's own.
      if (message.includes("BOOKING_BAD_CONTACT")) return { category: "invalid", message: "That client isn’t in this workspace. Choose the client again, or book them as a guest." };
      return { category: "invalid", message: "That time could not be used." };
    default:
      // No SQLSTATE usually means the request never reached Postgres — a transport
      // failure. Name it; otherwise surface the real cause verbatim (never swallow).
      if (!code && (message === "" || /network|failed to fetch|timeout|connection|fetch/i.test(message))) {
        return { category: "network", message: "Couldn’t reach the scheduling service — check your connection and try again." };
      }
      return { category: "unknown", message: message || "That appointment could not be saved." };
  }
}

/** The honest sentence for a change (edit/reschedule) write error. Thin wrapper
 *  over {@link classifyBookingWriteError} so those seams keep one shared mapper. */
export function bookingWriteMessage(err: { code?: string; message: string }): string {
  return classifyBookingWriteError(err, "change").message;
}

/** One read per burst. A cancel-and-rebook writes several rows in quick
 *  succession; this is long enough to arrive as one refresh and short enough
 *  that the schedule is current before anyone looks away. Matches the interval
 *  the admin calendar has used since the live schedule shipped. */
const LIVE_REFRESH_DEBOUNCE_MS = 400;

/**
 * The exact `create_internal_booking` payload for one New appointment.
 *
 * Pure, so the contract with the server can be asserted without a network double.
 * Two rules live here rather than in the drawer:
 *
 *  - A chosen client goes through as `_contact_id`. Without it a booking the
 *    business makes for a client is invisible to that client — the portal read
 *    keys on `contact_id`, never on a typed name.
 *  - Blocked time never carries a client. It is the owner holding their own time,
 *    not a session with anyone, and its payload stays exactly what it was before
 *    clients could be chosen (no `_contact_id` key at all), as does a booking for a
 *    guest who is not a client.
 */
export function buildCreateBookingArgs(
  input: CreateBookingInput,
  ctx: { uid: string; tenantId: string; timezone: string },
): Record<string, unknown> {
  const end = new Date(input.startAt.getTime() + Math.max(5, input.durationMinutes) * 60000);
  const args: Record<string, unknown> = {
    _title: input.blocked ? "Blocked" : input.title.trim(),
    _start_at: input.startAt.toISOString(),
    _end_at: end.toISOString(),
    _timezone: ctx.timezone,
    _host_user_id: ctx.uid,
    _guest_name: input.guestName?.trim() || null,
    _tenant_id: ctx.tenantId,
    _calendar_id: input.calendarId === UNASSIGNED_CALENDAR ? null : input.calendarId,
    _status: input.blocked ? "blocked" : "scheduled",
    _source: "manual",
  };
  const contactId = input.contactId?.trim();
  if (!input.blocked && contactId) args._contact_id = contactId;
  return args;
}

/**
 * The calendar a client session lands on when the owner has not chosen one.
 *
 * A session the client can see but that sits on no calendar can never be moved or
 * cancelled from their portal: the portal's change rules (notice window, whether
 * the calendar is open) come from the calendar row, so with no calendar there is
 * nothing to admit the change against. So once a client is chosen the drawer
 * offers the first calendar that is not paused. A calendar stored as
 * `enabled = false` is skipped, because the portal refuses a reschedule on a
 * paused one; `null` (never recorded) counts as open, matching the read. Returns
 * null when no calendar qualifies, and the drawer then says why it matters.
 */
export function defaultCalendarForClient(
  calendars: ReadonlyArray<Pick<SoloCalendarMeta, "id" | "enabled">>,
): string | null {
  return calendars.find((c) => c.enabled !== false)?.id ?? null;
}

export function useSoloCalendar(
  activeTenantId: string | null,
  view: ViewMode,
  cursor: Date,
): UseSoloCalendarResult {
  const [rawBookings, setBookings] = useState<SoloBooking[]>([]);
  const [calendars, setCalendars] = useState<SoloCalendarMeta[]>([]);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [lastSyncedMs, setLastSyncedMs] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  /**
   * Channel health, tracked SEPARATELY from read freshness.
   *
   * These are two different truths and one boolean cannot carry both. A read can
   * succeed at this instant while the subscription is dead — and then a
   * successful Retry would clear a "stale" flag that also stood for "the channel
   * is down", putting the surface back to LIVE over a calendar that still cannot
   * receive changes. Only resubscription clears this one.
   */
  const [channelDown, setChannelDown] = useState(false);
  const bookingSeq = useRef(0);
  /** Load/refresh ordering. A load owns the surface's phase; a refresh is quiet
   *  and must wait its turn rather than cutting in front of one. */
  const loadSeq = useRef(0);
  const loadInFlight = useRef(false);
  const pendingRefresh = useRef(false);
  /** Declared before `fetchBookings` so the deferred-refresh path can reach the
   *  latest reader without depending on it and re-creating the callback. */
  const fetchRef = useRef<(mode: "load" | "refresh") => Promise<boolean>>();
  /** An outage gap is owed: the channel dropped and no read has closed it yet. */
  const catchUpPending = useRef(false);
  /** Whether the CURRENT subscription is believed to be delivering. */
  const channelHealthy = useRef(false);
  /**
   * Bumped every time the channel comes back up, so a read can be told apart
   * from the subscription it was issued under. "Healthy now" is not enough: a
   * read taken during an outage, or one that spanned a drop and a recovery,
   * carries a snapshot from the wrong side of the gap.
   */
  const healthEpoch = useRef(0);
  /** Mirrors `channelDown` for callbacks that must stay referentially stable. */
  const channelDownRef = useRef(false);
  useEffect(() => { channelDownRef.current = channelDown; }, [channelDown]);
  /** Bumped to ask the shared hook for a brand-new subscription. */
  const [resubscribeKey, setResubscribeKey] = useState(0);
  const calendarSeq = useRef(0);

  const [from, to] = useMemo(() => rangeFor(view, cursor), [view, cursor]);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  useEffect(() => {
    let cancelled = false;
    const seq = ++calendarSeq.current;
    // Clear first: the previous account's calendars must never linger while a new
    // one resolves (§9 — no substitution across an account switch).
    setCalendars([]);
    setCalendarsError(null);
    if (!activeTenantId) return;
    void (async () => {
      const { data, error: err } = await supabase
        .from("calendars")
        .select(CALENDAR_COLUMNS)
        .eq("tenant_id", activeTenantId);
      if (cancelled || seq !== calendarSeq.current) return;
      if (err) { setCalendarsError(err.message); return; }
      setCalendars((data as SoloCalendarMeta[] | null) ?? []);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId, nonce]);

  /**
   * The one booking read, in two modes.
   *
   * "load" is a first paint or a range change: the previous account's or week's
   * events must not linger, so it clears and shows the loading state. "refresh"
   * is a live update behind an unchanged view: it must NOT blank a schedule that
   * is on screen and still true, so it leaves everything standing and swaps the
   * rows in when the read lands.
   *
   * Every read takes a sequence number and drops itself if a newer one has
   * started, so a slow response can never overwrite a fresher one.
   */
  const fetchBookings = useCallback(async (mode: "load" | "refresh") => {
    if (!activeTenantId) return;
    // A background refresh must never supersede a load that is still running.
    // It would take the newer sequence number, the load's rows would then be
    // discarded as superseded, and if the refresh itself failed its quiet error
    // path would leave `phase` on "loading" with nothing in it — a blank range
    // until someone pressed Retry. Defer instead, and run once the load settles.
    if (mode === "refresh" && loadInFlight.current) {
      pendingRefresh.current = true;
      return false;
    }
    // Which live subscription this read is being issued under. -1 means it was
    // started while the channel was down, so its rows can never prove the gap
    // closed however healthy things look by the time they land.
    const startEpoch = channelHealthy.current ? healthEpoch.current : -1;
    const seq = ++bookingSeq.current;
    const myLoad = mode === "load" ? ++loadSeq.current : 0;
    if (mode === "load") loadInFlight.current = true;
    if (mode === "load") {
      setPhase("loading"); setBookings([]); setError(null);
      // A fresh load supersedes any earlier refresh failure: whatever it returns
      // is the new truth, and the old warning must not outlive it.
      setRefreshFailed(false);
    }
    const { data, error: err } = await supabase.rpc("list_team_bookings" as never, {
      _from: fromIso,
      _to: toIso,
      _host_ids: null,
      _tenant_id: activeTenantId,
    } as never);
    // Release the load gate before the supersede guard, so a load that is itself
    // superseded still hands the gate back and never strands a queued refresh.
    if (mode === "load" && myLoad === loadSeq.current) {
      loadInFlight.current = false;
      if (pendingRefresh.current) {
        pendingRefresh.current = false;
        queueMicrotask(() => { void fetchRef.current?.("refresh"); });
      }
    }
    // Superseded by a newer read. Its rows are not ours to publish, and it is
    // not ours to call a success either — the newer read owns that answer.
    if (seq !== bookingSeq.current) return false;
    if (err) {
      if (mode === "load") { setError(err.message); setPhase("error"); return false; }
      // A background refresh that fails must not tear down a schedule the person
      // is reading, so the rows stay. But they are now of unknown freshness, and
      // the person reading them has to be told: `stale` drives a visible state on
      // the surface with a way to try again. The console line is kept as well
      // (§32 — never swallow), but it is no longer the only report.
      console.error("[solo-calendar] live booking refresh failed", err);
      setRefreshFailed(true);
      return false;
    }
    setBookings((data as SoloBooking[] | null) ?? []);
    setPhase("ready");
    // Only a read that actually returned rows moves this. A failed attempt must
    // never advance it, or the surface would claim a freshness it does not have.
    setLastSyncedMs(Date.now());
    setRefreshFailed(false);
    /**
     * A read that LANDS over a LIVE subscription is what actually closes an
     * outage gap — so the clearing decision belongs here, with the read, not
     * with whichever caller happened to ask for it.
     *
     * Binding it to the caller broke two ways. A catch-up deferred behind a
     * load returns `false` to its caller and settles later, so its success
     * never reached the handler that was waiting for it and a caught-up
     * calendar stayed stale. And a catch-up whose channel died again mid-flight
     * still resolved `true`, so the caller cleared a latch that had just been
     * legitimately re-set — reporting LIVE over a dead subscription, the exact
     * false confidence this state exists to prevent.
     *
     * Checking HERE, at the moment the rows arrive, answers both — but health
     * alone is not the test. A load already in flight when the channel came back
     * was read from the wrong side of the gap: it can miss anything committed in
     * the last moments of the outage, and clearing on it would report LIVE over
     * exactly what the latch exists to flag. So the read must ALSO have been
     * issued under the subscription that is still live now.
     */
    if (
      catchUpPending.current &&
      channelHealthy.current &&
      startEpoch >= 0 &&
      startEpoch === healthEpoch.current
    ) {
      catchUpPending.current = false;
      setChannelDown(false);
    }
    return true;
  }, [activeTenantId, fromIso, toIso]);

  useEffect(() => {
    if (!activeTenantId) {
      // Abandon anything in flight: the previous account's bookings must never
      // land after the account has changed (§9).
      bookingSeq.current++;
      loadInFlight.current = false;
      pendingRefresh.current = false;
      catchUpPending.current = false;
      channelHealthy.current = false;
      setChannelDown(false);
      setPhase("loading");
      setBookings([]);
      setError(null);
      setRefreshFailed(false);
      setLastSyncedMs(null);
      return;
    }
    void fetchBookings("load");
  }, [fetchBookings, activeTenantId, nonce]);

  /**
   * Live invalidation.
   *
   * A guest booking through the public page, or a teammate creating, moving or
   * cancelling an appointment, changes none of this hook's dependencies — so
   * without a change subscription the open Calendar keeps showing a schedule
   * that is no longer true until someone navigates or reloads.
   *
   * This is the same seam the admin calendar uses: `internal_bookings` changes
   * filtered to the SERVER-RESOLVED tenant, delivered by Postgres under the
   * subscriber's own RLS — so it enables a change stream and widens nothing. The
   * event itself is never trusted as data; it only triggers a re-read through
   * the same tenant-isolated RPC every other read goes through.
   */
  useEffect(() => { fetchRef.current = fetchBookings; }, [fetchBookings]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBookingChange = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(
      () => { void fetchRef.current?.("refresh"); },
      LIVE_REFRESH_DEBOUNCE_MS,
    );
  }, []);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  /** The person's own "try again" on a stale calendar. Same quiet read the change
   *  subscription drives — the rows stay put while it runs — but immediate, and it
   *  cancels any debounce already queued so one press is one read. */
  const retry = useCallback(async () => {
    if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null; }
    // Re-reading cannot revive a dead subscription. Without also rebuilding it,
    // "try again" would fetch fresh rows and leave the surface permanently
    // stale — technically honest, but a dead end: the only way back to a live
    // calendar would be a full page reload. Asking for a new subscription makes
    // the recovery reachable, and it stays truthful either way — the new channel
    // reports SUBSCRIBED and the catch-up clears it, or it does not and the
    // surface stays stale.
    // Gate on channel HEALTH, not on the stale flag. The surface can be stale
    // while the subscription is perfectly live — an outage gap the catch-up has
    // not closed yet — and rebuilding a working channel to fix that would just
    // churn it. Only a channel we believe is dead needs replacing.
    if (!channelHealthy.current) setResubscribeKey((n) => n + 1);
    await fetchRef.current?.("refresh");
  }, []);

  /**
   * A change stream that stops delivering fails SILENTLY: `onBookingChange`
   * simply never fires again, so no read errors and nothing marks the schedule
   * stale. The surface would go on presenting itself as live over a calendar
   * that can no longer update — the exact false-confidence the freshness state
   * exists to prevent. So the channel's own status feeds that same state.
   */
  const onChannelStatus = useCallback((status: string) => {
    if (status === "SUBSCRIBED") {
      // A fresh live subscription: reads issued before this moment belong to the
      // old one and cannot vouch for the gap.
      if (!channelHealthy.current) healthEpoch.current += 1;
      channelHealthy.current = true;
      if (!catchUpPending.current) return;
      // Resubscribing proves FUTURE changes can arrive again. It proves nothing
      // about the rows already on screen: everything that changed during the
      // outage was never delivered, so they are still stale. So this only ASKS
      // for the catch-up read; the stale state is cleared by that read landing
      // over a live channel, never by this status alone. A failed, hung, or
      // deferred catch-up therefore leaves the surface exactly where it was:
      // stale, with a way to try again. Fires on the transition only — not a poll.
      void fetchRef.current?.("refresh");
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      channelHealthy.current = false;
      catchUpPending.current = true;
      console.error("[solo-calendar] realtime channel not delivering:", status);
      setChannelDown(true);
    }
  }, []);

  useRealtimeTable("internal_bookings", onBookingChange, {
    filter: activeTenantId ? `tenant_id=eq.${activeTenantId}` : undefined,
    enabled: Boolean(activeTenantId),
    onStatus: onChannelStatus,
    resubscribeKey,
  });

  // A class arrives as a session marker plus one row per attendee. Fold before
  // anything else sees the rows, so the grid draws one appointment and the
  // conflict detector never mistakes a classmate for a double-booked host.
  const { visible: bookings, seatsBySession } = useMemo(
    () => foldClassSeats(rawBookings),
    [rawBookings],
  );

  const conflicts = useMemo(() => findConflicts(bookings), [bookings]);

  const lastSyncedAt = useMemo(
    () => (lastSyncedMs == null ? null : new Date(lastSyncedMs)),
    [lastSyncedMs],
  );

  const colorForBooking = useCallback((b: SoloBooking, colorBy: "calendar" | "host") => {
    if (colorBy === "host") return hostColor(b.host_user_id);
    const cal = calendars.find((c) => c.id === b.calendar_id);
    return cal?.color || cal?.accent || DEFAULT_CALENDAR_COLOR;
  }, [calendars]);

  const setStatus = useCallback(async (id: string, status: string) => {
    // The tenant-gated RPC, not a raw UPDATE: RLS scopes a direct table write to
    // the caller's own rows, so changing another host's booking would no-op while
    // reporting success. The RPC refuses truthfully instead.
    const { error: err } = await supabase.rpc("admin_set_booking_status" as never, {
      _booking_id: id,
      _status: status,
    } as never);
    if (err) {
      return {
        ok: false,
        message: /FORBIDDEN/.test(err.message) ? "You can't change that booking." : err.message,
      };
    }
    setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status } : b)));
    return { ok: true };
  }, []);

  const createBooking = useCallback(async (input: CreateBookingInput) => {
    if (!activeTenantId) return { ok: false, message: "No authorized account is resolved." };
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    if (!uid) return { ok: false, message: "This session is not signed in." };
    const { error: err } = await supabase.rpc(
      "create_internal_booking" as never,
      buildCreateBookingArgs(input, {
        uid,
        tenantId: activeTenantId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }) as never,
    );
    if (err) {
      // Every refusal is classified into an honest, actionable category and
      // sentence (never a raw PostgREST/SQLSTATE dump, never a false success): an
      // overlap reads as a clash, a 42501 as an authority/workspace problem, a
      // PGRST202/203 (the RPC not resolving) as "nothing was booked, try again",
      // and an unrecognised cause is surfaced verbatim (§13/§32). The caller shows
      // the sentence; `category` is returned for observability.
      const { category, message } = classifyBookingWriteError(err as { code?: string; message?: string }, "add");
      return { ok: false, category, message };
    }
    setNonce((n) => n + 1);
    return { ok: true };
  }, [activeTenantId]);

  const reschedule = useCallback(async (id: string, startAt: Date, durationMinutes: number) => {
    if (!activeTenantId) return { ok: false, message: "No authorized account is resolved." };
    // Duration is preserved from the drawer (prefilled from the booking's own
    // length), floored at 5 min exactly as create does, so a rescheduled meeting
    // keeps its shape unless the person deliberately changes it.
    const end = new Date(startAt.getTime() + Math.max(5, durationMinutes) * 60000);
    // The tenant-gated RPC, never a raw UPDATE: RLS scopes a direct write to the
    // caller's own rows so moving a teammate's booking would no-op while reporting
    // success. The RPC enforces tenant + host/admin scope and refuses truthfully,
    // the DB overlap constraint refuses a clash, and the UPDATE fires the
    // `booking.rescheduled` Rail signal on its own.
    const { error: err } = await supabase.rpc("reschedule_internal_booking" as never, {
      _booking_id: id,
      _start_at: startAt.toISOString(),
      _end_at: end.toISOString(),
      _tenant_id: activeTenantId,
    } as never);
    if (err) return { ok: false, message: bookingWriteMessage(err as { code?: string; message: string }) };
    // The row moved server-side. The realtime channel will carry the new time in,
    // but nudge a read so the grid is correct even if that one event is missed.
    setNonce((n) => n + 1);
    return { ok: true };
  }, [activeTenantId]);

  const edit = useCallback(async (input: EditBookingInput) => {
    if (!activeTenantId) return { ok: false, message: "No authorized account is resolved." };
    const title = input.title.trim();
    if (!title) return { ok: false, message: "An appointment needs a title." };
    // Details only — never start/end or status — so a typo fix or a guest name
    // being added moves no time and files no false Rail event (§13). Tenant-gated
    // RPC for the same RLS reason as reschedule; the server also refuses a
    // calendar that belongs to another tenant.
    const { error: err } = await supabase.rpc("update_internal_booking" as never, {
      _booking_id: input.id,
      _title: title,
      _guest_name: input.guestName?.trim() || null,
      _notes: input.notes?.trim() || null,
      _calendar_id: input.calendarId === UNASSIGNED_CALENDAR ? null : input.calendarId,
      _tenant_id: activeTenantId,
    } as never);
    if (err) return { ok: false, message: bookingWriteMessage(err as { code?: string; message: string }) };
    setNonce((n) => n + 1);
    return { ok: true };
  }, [activeTenantId]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return {
    bookings, calendars, seatsBySession, conflicts, phase, error, calendarsError,
    // Either truth makes the schedule unreliable: the last read failed, or the
    // change stream is not delivering. Both must clear before this says LIVE.
    stale: refreshFailed || channelDown, lastSyncedAt, retry,
    refresh, setStatus, createBooking, reschedule, edit, colorForBooking,
  };
}
