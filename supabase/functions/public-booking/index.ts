// Native booking engine — public availability + appointment creation.
// Anon-callable (verify_jwt=false); all writes go through the service role after
// server-side validation, so the public never touches tables directly.
// Source of truth is internal_bookings + staff_calendar_settings — no external
// provider required (Google/Cal.com/Apple sync is optional, layered on later).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Shared notification primitives (§12): the Twilio sender, merge-field renderer,
// and opt-in lifecycle-trigger parsing/rendering — the same code the scheduled
// worker and the self-serve reschedule/cancel path use.
import {
  channelsOf, type Lifecycle, lifecycleEmailHtml, parseLifecycle, renderTemplate, sendSms, targetsOf,
} from "../_shared/bookingNotify.ts";
// Anon abuse control (§13): per-IP / per-slug throttle for this anon-callable
// surface, layered on top of the existing per-host create cap. Fail-open on the
// limiter's own error so a hiccup never blocks a legit booking.
import { clientIp, overRateLimit } from "../_shared/rateLimit.ts";
import { findClientIdByAddress, insertClientWithAddresses } from "../_shared/contact-methods.ts";
import { primaryPhonesForUsers } from "../_shared/user-contact-methods.ts";
// Per-host Zoom (§9): when a calendar meets over Zoom and the assigned host has
// connected their own Zoom, mint the meeting on THEIR account and drop the real
// join link into the confirmation. Best-effort (§13) — any failure falls back to
// the existing 'link to follow' label and never blocks the booking.
import { createZoomMeeting } from "../_shared/zoomMeetings.ts";

// Per-window ceilings (60s). Availability is cheap but the obvious hammer target;
// create is expensive (writes + emails) so it's capped tighter. All sit ABOVE any
// legitimate human rate — a person paging a booking calendar or booking a slot
// never approaches these; a script does.
const RL_AVAIL_PER_IP = 60; // one visitor paging forward fires a handful/min
const RL_AVAIL_PER_SLUG = 240; // distributed hammering of one page (many IPs)
const RL_CREATE_PER_IP = 15; // a real booking is ~1; 15/min still stops a flood
const TOO_MANY = "Too many requests — please try again shortly.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// --- Weekly availability contract -------------------------------------------
interface DayWindow { day: number; start: string; end: string } // day 0=Sun..6=Sat, "HH:MM"
const DEFAULT_AVAILABILITY: DayWindow[] = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));

function parseAvailability(raw: unknown): DayWindow[] {
  if (!Array.isArray(raw)) return DEFAULT_AVAILABILITY;
  const out = raw.filter(
    (w): w is DayWindow =>
      w && typeof w === "object" &&
      typeof (w as DayWindow).day === "number" &&
      /^\d{2}:\d{2}$/.test((w as DayWindow).start ?? "") &&
      /^\d{2}:\d{2}$/.test((w as DayWindow).end ?? ""),
  );
  return out.length ? out : DEFAULT_AVAILABILITY;
}

// Per-host availability: absent/NULL/malformed → inherit the calendar's (return
// null so the engine falls back). A present array is used verbatim after
// validation — an EMPTY custom set legitimately means "this host keeps no hours
// on this calendar" and must NOT fall back to the 9–5 default the way the
// calendar-level parser does (that fallback is only right for the shared default).
function parseHostAvailability(raw: unknown): DayWindow[] | null {
  if (raw == null || !Array.isArray(raw)) return null;
  return raw.filter(
    (w): w is DayWindow =>
      w && typeof w === "object" &&
      typeof (w as DayWindow).day === "number" &&
      /^\d{2}:\d{2}$/.test((w as DayWindow).start ?? "") &&
      /^\d{2}:\d{2}$/.test((w as DayWindow).end ?? ""),
  );
}

// --- Timezone math (Intl-based; no external tz lib) -------------------------
function offsetMin(atUtcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(atUtcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
  return (asUtc - atUtcMs) / 60000;
}
/** A wall-clock time in `tz` → the UTC instant (ms). */
function zonedWallToUtcMs(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  return guess - offsetMin(guess, tz) * 60000;
}
/** The Y/M/D of a UTC instant as seen in `tz`. */
function ymdInTz(ms: number, tz: string): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, mo: +p.month, d: +p.day, wd };
}

interface HostSettings {
  user_id: string; // primary / fallback host (top priority)
  hosts: string[]; // full host pool, priority-ordered (single-host = [user_id])
  roundRobin: boolean; // distribute bookings across hosts instead of always the primary
  assignmentStrategy: "balanced" | "availability" | "priority"; // round-robin host chooser
  collective: boolean; // every host must attend — slot needs ALL hosts free, booking records every host
  isClass: boolean; // one host, many guests share a slot up to capacity
  capacity: number; // Class-only ceiling per session (irrelevant otherwise)
  tenant_id: string | null;
  calendarId: string | null; // set when the page is backed by a first-class calendar
  availability: DayWindow[]; // CALENDAR-level default hours (shared fallback)
  // Per-host override of hours/timezone, keyed by user_id. NULL fields inherit
  // the calendar's `availability`/`timezone` — an absent entry (or all-NULL one)
  // means the host uses the calendar default, so existing rosters are unchanged.
  hostAvailability: Record<string, { availability: DayWindow[] | null; timezone: string | null }>;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  timezone: string;
  minNoticeMin: number;
  dateOverrides: DateOverride[]; // per-date block-outs / special hours
  horizonDays: number; // how far ahead guests may book (rolling window)
  redirectUrl: string | null; // where to send the guest after booking
  title: string | null;
  description: string | null;
  accent: string | null;
  logoUrl: string | null; // per-calendar logo override (wins over tenant logo)
  theme: string; // 'light' | 'dark' booking page
  subtitle: string | null; // category line above the title
  showCompanyName: boolean; // render the brand/company name next to the logo
  locationType: string; // legacy single (fallback) — chosen method stored on booking
  locationValue: string | null;
  locationOptions: { type: string; value: string | null }[]; // owner-offered methods
  intakeQuestions: IntakeQuestion[]; // owner-authored booking-form questions
  appointmentTypes: AppointmentType[]; // owner-authored service menu
  confirmGuest: boolean; // send guest a confirmation
  confirmHost: boolean; // notify the host of new bookings
  lifecycle: Lifecycle[]; // opt-in owner-authored on-booking-created messages
}

function parseNotify(raw: unknown): { confirmGuest: boolean; confirmHost: boolean } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { confirmGuest: o.confirm_guest !== false, confirmHost: o.confirm_host !== false };
}
const KNOWN_LOCATIONS = ["google_meet", "zoom", "phone", "in_person", "custom"];
function parseLocationOptions(raw: unknown, fallbackType: string, fallbackValue: string | null): { type: string; value: string | null }[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out = arr
    .map((o) => (o && typeof o === "object" ? o : {}) as Record<string, unknown>)
    .map((o) => ({ type: String(o.type ?? ""), value: typeof o.value === "string" ? o.value : null }))
    .filter((o) => KNOWN_LOCATIONS.includes(o.type));
  if (out.length) return out;
  // Legacy fallback: a single method (or the old ask_invitee triple).
  if (fallbackType === "ask_invitee") return [{ type: "google_meet", value: null }, { type: "zoom", value: null }, { type: "phone", value: null }];
  return [{ type: KNOWN_LOCATIONS.includes(fallbackType) ? fallbackType : "phone", value: fallbackValue }];
}

// --- Custom intake questions (tenant-authored per calendar) -----------------
interface IntakeQuestion {
  id: string; label: string; type: string; required: boolean;
  options: string[]; placeholder: string | null;
}
const INTAKE_TYPES = ["text", "textarea", "select", "radio", "checkbox", "phone", "url", "number"];
const INTAKE_CHOICE_TYPES = ["select", "radio", "checkbox"];
function parseIntakeQuestions(raw: unknown): IntakeQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => (q && typeof q === "object" ? q : {}) as Record<string, unknown>)
    .map((q, i) => ({
      id: String(q.id ?? `q${i}`).slice(0, 64),
      label: String(q.label ?? "").trim().slice(0, 240),
      type: INTAKE_TYPES.includes(String(q.type)) ? String(q.type) : "text",
      required: q.required === true,
      options: Array.isArray(q.options) ? q.options.map((o) => String(o).slice(0, 200)).filter(Boolean).slice(0, 40) : [],
      placeholder: typeof q.placeholder === "string" ? q.placeholder.slice(0, 200) : null,
    }))
    // Drop blank-labeled questions and choice questions with no options — a
    // required choice with zero options is unanswerable and would silently
    // make the whole booking page unbookable (guards Paige-authored config too).
    .filter((q) => q.label.length > 0 && !(INTAKE_CHOICE_TYPES.includes(q.type) && q.options.length === 0))
    .slice(0, 30);
}
/** Validate + sanitize guest answers against the question set. Returns the
 *  stored answer map, or an error string naming the first missing required. */
function collectAnswers(questions: IntakeQuestion[], raw: unknown): { answers: Record<string, string | string[]> } | { error: string } {
  const provided = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};
  for (const q of questions) {
    const v = provided[q.id];
    if (q.type === "checkbox") {
      const arr = Array.isArray(v) ? v.map((x) => String(x).slice(0, 500)).filter(Boolean) : [];
      // Only keep known options; de-dupe and cap length so a crafted payload
      // can't balloon the stored answer / notification email.
      const filtered = q.options.length ? arr.filter((x) => q.options.includes(x)) : arr;
      const kept = Array.from(new Set(filtered)).slice(0, q.options.length || 40);
      if (q.required && kept.length === 0) return { error: `Please answer: ${q.label}` };
      if (kept.length) out[q.id] = kept;
    } else {
      const s = (v == null ? "" : String(v)).trim().slice(0, 2000);
      if (q.required && !s) return { error: `Please answer: ${q.label}` };
      // For choice types, only accept an offered option.
      if (s && (q.type === "select" || q.type === "radio") && q.options.length && !q.options.includes(s)) {
        return { error: `Please pick a valid option for: ${q.label}` };
      }
      // Per-type format validation (field-named, same 400 shape as above) so a
      // malformed answer is caught here rather than stored and surfaced later.
      if (s && q.type === "number" && !Number.isFinite(Number(s))) {
        return { error: `Please enter a number for: ${q.label}` };
      }
      if (s && q.type === "url") {
        let okUrl = false;
        try { okUrl = /^https?:$/.test(new URL(s).protocol); } catch { okUrl = false; }
        if (!okUrl) return { error: `Please enter a valid link for: ${q.label}` };
      }
      if (s && q.type === "phone") {
        const digits = s.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15 || !/^[+0-9().\-\s]+$/.test(s)) {
          return { error: `Please enter a valid phone number for: ${q.label}` };
        }
      }
      if (s) out[q.id] = s;
    }
  }
  return { answers: out };
}

// --- Date overrides / block-out days ----------------------------------------
// Per-date exceptions to the weekly pattern: block a whole day, or set special
// hours for one date. Tenant-authored per calendar (§9).
interface DateOverride { date: string; blocked: boolean; windows: { start: string; end: string }[] }
function parseDateOverrides(raw: unknown): DateOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => (o && typeof o === "object" ? o : {}) as Record<string, unknown>)
    .map((o) => ({
      date: String(o.date ?? ""),
      blocked: o.blocked === true,
      windows: Array.isArray(o.windows)
        ? (o.windows as unknown[])
            .map((w) => (w && typeof w === "object" ? w : {}) as Record<string, unknown>)
            .filter((w) => /^\d{2}:\d{2}$/.test(String(w.start)) && /^\d{2}:\d{2}$/.test(String(w.end)))
            .map((w) => ({ start: String(w.start), end: String(w.end) }))
            .slice(0, 6)
        : [],
    }))
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date))
    .slice(0, 366);
}

// --- Appointment types (a "service menu" on one page) -----------------------
// price_cents/currency are OPTIONAL (§2 — pricing is never forced): a null
// price_cents means the type is unpriced and the public page shows no price.
interface AppointmentType { id: string; name: string; description: string | null; duration_min: number; price_cents: number | null; currency: string; }
function parseAppointmentTypes(raw: unknown): AppointmentType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (t && typeof t === "object" ? t : {}) as Record<string, unknown>)
    .map((t, i) => {
      // Accept a number or a non-empty numeric string; anything else → unpriced.
      // (Number(null)/Number("") both coerce to 0, which would wrongly price a
      // type at $0.00 — so guard the empty/nullish cases explicitly.)
      const rawPrice = t.price_cents;
      const priceNum = typeof rawPrice === "number"
        ? rawPrice
        : (typeof rawPrice === "string" && rawPrice.trim() !== "" ? Number(rawPrice) : NaN);
      return {
        id: String(t.id ?? `t${i}`).slice(0, 64),
        name: String(t.name ?? "").trim().slice(0, 120),
        description: typeof t.description === "string" ? t.description.slice(0, 500) : null,
        duration_min: Math.max(5, Math.min(1440, Number(t.duration_min) || 30)),
        price_cents: Number.isFinite(priceNum) ? Math.max(0, Math.round(priceNum)) : null,
        currency: typeof t.currency === "string" && t.currency.trim() ? t.currency.trim().toLowerCase().slice(0, 8) : "usd",
      };
    })
    .filter((t) => t.name.length > 0)
    .slice(0, 20);
}

interface Busy { start: number; end: number } // UTC ms

/** All candidate slot starts in the availability windows (busy-agnostic). */
function windowStarts(h: HostSettings, fromMs: number, toMs: number, nowMs: number): number[] {
  const starts: number[] = [];
  const durMs = h.durationMin * 60000;
  const earliest = nowMs + h.minNoticeMin * 60000;
  const dayMs = 86_400_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Walk CALENDAR dates (not fixed 24h steps) in the host's timezone. Stepping
  // a raw UTC-ms cursor by exactly 86_400_000 can skip the short (23h) day of
  // a DST spring-forward transition when `fromMs` falls late in the host's
  // local day — the fixed step then lands past that date entirely. Deriving
  // each next date via calendar arithmetic (not elapsed milliseconds) visits
  // every date exactly once regardless of DST.
  let { y, mo, d } = ymdInTz(fromMs - dayMs, h.timezone);
  while (zonedWallToUtcMs(y, mo - 1, d, 12, 0, h.timezone) <= toMs + dayMs) {
    // Weekday of a calendar date is timezone-independent — pure date math.
    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    // Date overrides win over the weekly pattern: a blocked date yields nothing;
    // a date with custom windows uses those; otherwise fall back to the week.
    const override = h.dateOverrides.find((o) => o.date === `${y}-${pad(mo)}-${pad(d)}`);
    if (!override?.blocked) {
      const windows = override
        ? override.windows.map((w) => ({ day: wd, start: w.start, end: w.end }))
        : h.availability.filter((w) => w.day === wd);
      for (const w of windows) {
        const [sh, sm] = w.start.split(":").map(Number);
        const [eh, em] = w.end.split(":").map(Number);
        const winStart = zonedWallToUtcMs(y, mo - 1, d, sh, sm, h.timezone);
        const winEnd = zonedWallToUtcMs(y, mo - 1, d, eh, em, h.timezone);
        for (let s = winStart; s + durMs <= winEnd; s += durMs) {
          if (s < fromMs || s > toMs) continue;
          if (s < earliest) continue;
          starts.push(s);
        }
      }
    }
    const next = new Date(Date.UTC(y, mo - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
  }
  return Array.from(new Set(starts)).sort((a, b) => a - b);
}
/** Is [s, s+dur] free of buffer-padded conflicts against `busy`? */
function isFree(h: HostSettings, busy: Busy[], s: number): boolean {
  const e = s + h.durationMin * 60000;
  return !busy.some((b) => s < b.end + h.bufferAfterMin * 60000 && e + h.bufferBeforeMin * 60000 > b.start);
}
/** A host's EFFECTIVE settings for window computation: their OWN availability +
 *  timezone when set, else the calendar's. Everything else (duration, buffers,
 *  min-notice, horizon, date overrides) stays calendar-level and shared. A host
 *  with no per-host override (the default for every existing roster) returns `h`
 *  unchanged by identity — so a calendar with no custom hours behaves EXACTLY as
 *  before this feature (regression-free). */
function hostView(h: HostSettings, uid: string): HostSettings {
  const c = h.hostAvailability[uid];
  if (!c || (c.availability == null && c.timezone == null)) return h;
  return { ...h, availability: c.availability ?? h.availability, timezone: c.timezone ?? h.timezone };
}
/** Is `startMs` a real window start for THIS host's own hours (± the same ±1-min
 *  probe the create-path re-validation uses)? */
function isHostWindowStart(h: HostSettings, uid: string, startMs: number, nowMs: number): boolean {
  const hv = hostView(h, uid);
  return windowStarts(hv, startMs - 60000, startMs + 60000, nowMs).some((s) => s === startMs);
}
/** Single-host open slots (that host's own window ∧ that host free). */
function computeSlots(h: HostSettings, busy: Busy[], fromMs: number, toMs: number, nowMs: number): number[] {
  const hv = hostView(h, h.user_id);
  return windowStarts(hv, fromMs, toMs, nowMs).filter((s) => isFree(hv, busy, s));
}
/** Round-robin open slots — UNION across hosts: a slot opens if AT LEAST ONE host
 *  is free AND the slot falls inside THAT host's own windows. Each host's grid is
 *  computed from their own hours/timezone, so a slot only one host works still
 *  shows (and can only be assigned to a host it's valid for — see the create path). */
function roundRobinSlots(h: HostSettings, busyByHost: Record<string, Busy[]>, fromMs: number, toMs: number, nowMs: number): number[] {
  const open = new Set<number>();
  for (const uid of h.hosts) {
    const hv = hostView(h, uid);
    const busy = busyByHost[uid] ?? [];
    for (const s of windowStarts(hv, fromMs, toMs, nowMs)) {
      if (isFree(hv, busy, s)) open.add(s);
    }
  }
  return Array.from(open).sort((a, b) => a - b);
}
/** Collective open slots — INTERSECTION across hosts: a slot opens only if EVERY
 *  host is free AND the slot falls inside EVERY host's own windows (everyone must
 *  attend). Build each host's set of free window-starts, then keep the starts
 *  common to all. When all hosts inherit, every set is the calendar grid and this
 *  reduces to the old "calendar window ∧ all hosts free". */
function collectiveSlots(h: HostSettings, busyByHost: Record<string, Busy[]>, fromMs: number, toMs: number, nowMs: number): number[] {
  const perHost = h.hosts.map((uid) => {
    const hv = hostView(h, uid);
    const busy = busyByHost[uid] ?? [];
    return new Set(windowStarts(hv, fromMs, toMs, nowMs).filter((s) => isFree(hv, busy, s)));
  });
  if (!perHost.length) return [];
  const [first, ...rest] = perHost;
  const out: number[] = [];
  for (const s of first) if (rest.every((set) => set.has(s))) out.push(s);
  return out.sort((a, b) => a - b);
}
/** Class open slots: a slot with an existing session is open while it has room;
 *  a slot with none yet is open if the host has no OTHER conflict (`busy` must
 *  already exclude this host's own class_seat rows via loadBusy's filter, else
 *  a class's own seats would "conflict" with its own session and hide every
 *  one of its own slots). */
function classSlots(h: HostSettings, busy: Busy[], sessions: Map<number, { capacity: number; booked: number }>, fromMs: number, toMs: number, nowMs: number): number[] {
  const hv = hostView(h, h.user_id); // a class has one host — use their own hours
  return windowStarts(hv, fromMs, toMs, nowMs).filter((s) => {
    const sess = sessions.get(s);
    return sess ? sess.booked < sess.capacity : isFree(hv, busy, s);
  });
}
/** Existing (non-cancelled) class sessions in the window + their live seat
 *  counts — two queries total regardless of session count, not one-per-session. */
async function loadClassSessions(admin: ReturnType<typeof createClient>, calendarId: string, fromMs: number, toMs: number): Promise<Map<number, { capacity: number; booked: number }>> {
  const { data: sessions } = await admin
    .from("internal_bookings")
    .select("id, start_at, capacity")
    .eq("calendar_id", calendarId).eq("booking_kind", "class_session").neq("status", "cancelled")
    .gte("start_at", new Date(fromMs - 86_400_000).toISOString())
    .lte("start_at", new Date(toMs + 86_400_000).toISOString());
  const out = new Map<number, { capacity: number; booked: number }>();
  const list = sessions ?? [];
  if (!list.length) return out;
  const ids = list.map((s) => s.id as string);
  const { data: seats } = await admin
    .from("internal_bookings")
    .select("class_session_id")
    .in("class_session_id", ids).neq("status", "cancelled");
  const counts = new Map<string, number>();
  for (const s of seats ?? []) {
    const sid = s.class_session_id as string;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  for (const s of list) {
    out.set(Date.parse(s.start_at as string), { capacity: s.capacity as number, booked: counts.get(s.id as string) ?? 0 });
  }
  return out;
}

// First-class calendar (the `calendars` entity) resolved by slug. This is the
// path created via the Calendars manager — many branded calendars per tenant.
// The availability owner is the calendar's top-priority host.
async function loadCalendar(admin: ReturnType<typeof createClient>, slug: string): Promise<HostSettings | null> {
  const { data: cal } = await admin
    .from("calendars")
    .select("id, tenant_id, type, title, description, logo_url, accent, duration_min, buffer_before_min, buffer_after_min, min_notice_min, timezone, availability_json, enabled, theme, subtitle, show_company_name, location_type, location_value, notify_config, location_options, booking_horizon_days, redirect_url, intake_questions, appointment_types, date_overrides, capacity, assignment_strategy")
    .eq("slug", slug)
    .maybeSingle();
  // `enabled` is the authoritative bookability gate and the ONLY lifecycle state
  // a public visitor is allowed past. A Draft (never published) and a Paused
  // preset both carry enabled=false, so both are refused here — an unauthenticated
  // visitor can never resolve a preset its owner has not explicitly published.
  // (Publish is the only seam that sets enabled=true; see
  // 20270301000000_calendar_booking_preset_lifecycle.sql / publish_calendar_preset.)
  if (!cal || cal.enabled !== true) return null;
  // Load the FULL host pool (priority-ordered). Single-host calendars book the
  // primary; round-robin/collective calendars use the whole pool.
  const { data: hosts } = await admin
    .from("calendar_hosts")
    .select("user_id, priority, availability_json, timezone")
    .eq("calendar_id", cal.id)
    .order("priority", { ascending: true });
  const hostRows = hosts ?? [];
  const hostIds = hostRows.map((h) => h.user_id as string);
  if (!hostIds.length) return null; // no host = nobody to book with yet
  // Per-host hours/timezone (NULL → inherit the calendar's). Keyed by user_id so
  // hostView() can resolve each host's effective schedule.
  const hostAvailability: HostSettings["hostAvailability"] = {};
  for (const hr of hostRows) {
    hostAvailability[hr.user_id as string] = {
      availability: parseHostAvailability(hr.availability_json),
      timezone: (typeof hr.timezone === "string" && hr.timezone.trim()) ? (hr.timezone as string) : null,
    };
  }
  // assignment_strategy.mode picks how round-robin chooses among free hosts;
  // anything unrecognized falls back to the balanced default.
  const stratMode = (cal.assignment_strategy && typeof cal.assignment_strategy === "object"
    ? (cal.assignment_strategy as Record<string, unknown>).mode
    : null);
  const assignmentStrategy: HostSettings["assignmentStrategy"] =
    stratMode === "priority" || stratMode === "availability" ? stratMode : "balanced";
  return {
    user_id: hostIds[0],
    hosts: hostIds,
    roundRobin: cal.type === "round_robin" && hostIds.length > 1,
    assignmentStrategy,
    collective: cal.type === "collective" && hostIds.length > 1,
    isClass: cal.type === "event",
    capacity: Math.max(1, cal.capacity ?? 8),
    tenant_id: cal.tenant_id ?? null,
    calendarId: cal.id,
    availability: parseAvailability(cal.availability_json),
    hostAvailability,
    durationMin: Math.max(5, cal.duration_min ?? 30),
    bufferBeforeMin: Math.max(0, cal.buffer_before_min ?? 0),
    bufferAfterMin: Math.max(0, cal.buffer_after_min ?? 0),
    timezone: cal.timezone || "America/New_York",
    minNoticeMin: Math.max(0, cal.min_notice_min ?? 60),
    dateOverrides: parseDateOverrides(cal.date_overrides),
    horizonDays: Math.max(1, cal.booking_horizon_days ?? 60),
    redirectUrl: (cal.redirect_url as string) || null,
    title: cal.title ?? null,
    description: cal.description ?? null,
    accent: cal.accent ?? null,
    logoUrl: cal.logo_url ?? null,
    theme: cal.theme === "dark" ? "dark" : "light",
    subtitle: cal.subtitle ?? null,
    showCompanyName: cal.show_company_name !== false,
    locationType: cal.location_type ?? "phone",
    locationValue: cal.location_value ?? null,
    locationOptions: parseLocationOptions(cal.location_options, cal.location_type ?? "phone", cal.location_value ?? null),
    intakeQuestions: parseIntakeQuestions(cal.intake_questions),
    appointmentTypes: parseAppointmentTypes(cal.appointment_types),
    ...parseNotify(cal.notify_config),
    lifecycle: parseLifecycle(cal.notify_config),
  };
}

// Legacy per-staff booking page (staff_calendar_settings) — kept for back-compat.
async function loadHost(admin: ReturnType<typeof createClient>, slug: string): Promise<HostSettings | null> {
  const { data } = await admin
    .from("staff_calendar_settings")
    .select("user_id, tenant_id, availability_json, default_meeting_duration_min, buffer_before_min, buffer_after_min, timezone, booking_page_enabled, booking_page_title, booking_page_description, booking_page_accent")
    .eq("booking_page_slug", slug)
    .maybeSingle();
  if (!data || data.booking_page_enabled !== true) return null;
  return {
    user_id: data.user_id,
    hosts: [data.user_id],
    roundRobin: false,
    assignmentStrategy: "balanced",
    collective: false,
    isClass: false,
    capacity: 1,
    tenant_id: data.tenant_id ?? null,
    calendarId: null,
    availability: parseAvailability(data.availability_json),
    hostAvailability: {}, // legacy single-staff page — one host, calendar-level hours
    durationMin: Math.max(5, data.default_meeting_duration_min ?? 30),
    bufferBeforeMin: Math.max(0, data.buffer_before_min ?? 0),
    bufferAfterMin: Math.max(0, data.buffer_after_min ?? 0),
    timezone: data.timezone || "America/New_York",
    minNoticeMin: 60,
    dateOverrides: [],
    horizonDays: 60,
    redirectUrl: null,
    title: data.booking_page_title ?? null,
    description: data.booking_page_description ?? null,
    accent: data.booking_page_accent ?? null,
    logoUrl: null,
    theme: "light",
    subtitle: null,
    showCompanyName: true,
    locationType: "phone",
    locationValue: null,
    locationOptions: [{ type: "phone", value: null }],
    intakeQuestions: [],
    appointmentTypes: [],
    confirmGuest: true,
    confirmHost: true,
    lifecycle: [], // legacy per-staff page has no lifecycle config
  };
}

/** White-label branding for the booking page: tenant brand + host overrides. */
async function loadBranding(admin: ReturnType<typeof createClient>, host: HostSettings) {
  let name: string | null = null;
  let logoUrl: string | null = host.logoUrl; // per-calendar logo wins
  let accent = host.accent;
  if (host.tenant_id) {
    const { data: t } = await admin.from("tenants").select("name, brand").eq("id", host.tenant_id).maybeSingle();
    const brand = (t?.brand ?? {}) as Record<string, string>;
    name = brand.brand_name ?? brand.display_name ?? brand.name ?? (t?.name as string | undefined) ?? null;
    logoUrl = logoUrl || brand.logo_url || null;
    accent = accent || brand.accent_color || brand.primary_color || null;
  }
  return {
    name: name || "Paige Agent AI",
    logoUrl,
    accent: accent || "#EBB94C",
    title: host.title,
    description: host.description,
    theme: host.theme,
    subtitle: host.subtitle,
    showCompanyName: host.showCompanyName,
    durationMin: host.durationMin,
    locationType: host.locationType,
    locationValue: host.locationValue,
    locationOptions: host.locationOptions,
    redirectUrl: host.redirectUrl,
    intakeQuestions: host.intakeQuestions,
    appointmentTypes: host.appointmentTypes,
  };
}

/** Comma-joined display names for a host roster — used so a Collective guest sees
 *  who's on the panel before booking, not just after (in the confirmation email).
 *  Uses the host's profile `full_name` ONLY. A host with no display name is OMITTED,
 *  never identified by their auth email: this string is returned to UNAUTHENTICATED
 *  `/book` callers, so leaking a staff email here is an anon PII disclosure
 *  (E6 §39 MED-2, 2026-09-13). Dropping the per-host auth lookup also removes an
 *  unnecessary N calls to `auth.admin.getUserById`. */
async function resolveHostNames(admin: ReturnType<typeof createClient>, hostIds: string[]): Promise<string | null> {
  const { data: profs } = await admin.from("profiles").select("user_id, full_name").in("user_id", hostIds);
  const nameByUid = new Map((profs ?? []).map((p) => [p.user_id as string, p.full_name as string | null]));
  const names = hostIds
    .map((uid) => nameByUid.get(uid) || null)
    .filter((n): n is string => !!n);
  return names.length ? names.join(", ") : null;
}

async function loadBusy(admin: ReturnType<typeof createClient>, userId: string, fromMs: number, toMs: number): Promise<Busy[]> {
  const { data } = await admin
    .from("internal_bookings")
    .select("start_at, end_at, status")
    .eq("host_user_id", userId)
    .neq("status", "cancelled")
    // class_seat rows are redundant with their one class_session row (which
    // already carries the host's real busy interval) — including them here
    // would return one duplicate "busy" entry per registrant on a popular
    // class, unbounded at scale. Duplicates don't change isFree()'s verdict,
    // but there's no reason to pay the cost.
    .neq("booking_kind", "class_seat")
    .gte("start_at", new Date(fromMs - 86_400_000).toISOString())
    .lte("start_at", new Date(toMs + 86_400_000).toISOString());
  return (data ?? []).map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }));
}

// --- On-booking CRM linkage --------------------------------------------------
// internal_bookings.contact_id already exists as an FK into clients, but
// nothing populates it — a booking was a CRM dead end. Tenant-scoped
// (or operator-scoped, for a null-tenant calendar) find-or-create by email,
// so the same guest booking twice links to one contact instead of two.
// Never throws: a CRM hiccup must not block a guest's booking from
// succeeding — the caller treats a null return as "no contact, proceed anyway."
async function findOrCreateContact(
  admin: ReturnType<typeof createClient>,
  tenantId: string | null,
  createdBy: string,
  name: string,
  email: string,
  phone: string | null,
): Promise<string | null> {
  try {
    // The guest is the contact holding this address as ANY of its emails, in the host's
    // workspace, matched exactly on the address (no pattern, so no wildcard can misattribute).
    // A booking with no workspace matches no contact: every contact belongs to one.
    const findExisting = async (): Promise<string | null> =>
      tenantId ? await findClientIdByAddress(admin, tenantId, "email", email, "public-booking") : null;

    const existing = await findExisting();
    if (existing || !tenantId) return existing;

    // The guest's email (and phone) become the new contact's first contact methods.
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const { data: created, error } = await insertClientWithAddresses(admin, {
      tenant_id: tenantId, created_by: createdBy,
      first_name: parts[0] || "Guest", last_name: parts.slice(1).join(" "),
      source: "booking_page",
      created_by_channel_type: "form", // #10 channel-of-origin (public booking guest)
    }, { email, phone }, "public-booking");
    if (created) return created.id;

    // Unique-violation race: a concurrent request for the same guest+host just
    // attached this email to the contact it created (ours rolled back whole, contact and all) — go
    // find that contact instead of failing.
    if (error?.code === "23505") return await findExisting();
    return null;
  } catch {
    return null;
  }
}

// --- Confirmation emails (guest + host) + .ics invite -----------------------
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("CALENDAR_EMAIL_FROM") ?? Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <calendar@paigeagent.ai>";
// Signed self-serve link (matches booking-manage's verifier: HMAC over the
// base64url payload, keyed by the service-role key).
const SIGN_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
function b64url(bytes: Uint8Array): string {
  let s = ""; for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
// btoa() only accepts Latin1 — any em dash, curly quote, or non-ASCII guest/tenant
// content throws InvalidCharacterError. Encode as UTF-8 bytes first.
function b64utf8(s: string): string {
  let bin = ""; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
// TTL must comfortably exceed the booking horizon (default 60 days, tenant-
// configurable) so a guest who books far out still has a live reschedule/cancel
// link at meeting time. Matches booking-manage's ~400-day verifier ceiling.
const MANAGE_TOKEN_TTL_DAYS = 400;
// Signed self-serve link. The payload widened from {b} to {b, iat, exp, ver}:
// `iat`/`exp` bound the link to a ~30-day lifetime and `ver` pins the booking's
// manage_token_version so a later revocation (bumping that column) invalidates
// links minted before it. The HMAC signer/secret is unchanged, so booking-manage
// verifies the same way — it just gains extra claims to enforce. A brand-new
// booking is always version 0, so callers can omit `ver`.
async function manageUrl(bookingId: string, ver = 0): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + MANAGE_TOKEN_TTL_DAYS * 86_400;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ b: bookingId, iat, exp, ver })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGN_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
  return `${PUBLIC_BASE}/booking/manage?token=${payload}.${sig}`;
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function textOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#1B1230";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1B1230" : "#FFFFFF";
}
function locationLabel(type: string, value: string | null): string {
  switch (type) {
    case "google_meet": return "Google Meet — link to follow";
    case "zoom": return "Zoom — link to follow";
    case "phone": return value ? `Phone call: ${value}` : "Phone call";
    case "in_person": return value ? `In person: ${value}` : "In person";
    case "custom": return value || "Details to follow";
    default: return "To be confirmed";
  }
}
function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function buildIcs(o: { uid: string; startMs: number; endMs: number; title: string; desc: string; location: string; organizer: string; attendee: string; attendeeName: string }): string {
  const clean = (s: string) => String(s ?? "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Paige Agent AI//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${o.uid}`, `DTSTAMP:${icsStamp(Date.now())}`, `DTSTART:${icsStamp(o.startMs)}`, `DTEND:${icsStamp(o.endMs)}`,
    `SUMMARY:${clean(o.title)}`, `DESCRIPTION:${clean(o.desc)}`, `LOCATION:${clean(o.location)}`,
    `ORGANIZER;CN=${clean(o.organizer)}:mailto:noreply@paigeagent.ai`,
    `ATTENDEE;CN=${clean(o.attendeeName)};RSVP=TRUE:mailto:${o.attendee}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
async function sendEmail(to: string, subject: string, html: string, ics?: string, opts?: { from?: string; replyTo?: string }): Promise<boolean> {
  if (!RESEND_KEY) return false;
  const body: Record<string, unknown> = { from: opts?.from || EMAIL_FROM, to: [to], subject, html };
  if (opts?.replyTo) body.reply_to = opts.replyTo;
  if (ics) body.attachments = [{ filename: "invite.ics", content: b64utf8(ics) }];
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch { return false; }
}
function guestEmailHtml(brandName: string, accent: string, title: string, whenLabel: string, location: string, host: string | null, manageLink: string): string {
  const on = textOn(accent);
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="height:5px;background:${esc(accent)};"></td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">${esc(brandName)}</div>
        <h1 style="color:#101828;font-size:20px;margin:10px 0 4px;">You're booked</h1>
        <p style="color:#667085;font-size:14px;margin:0 0 18px;">Your time is reserved. Details are below and an invite is attached.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#101828;">
          <tr><td style="padding:6px 0;color:#98a0ae;width:88px;">Session</td><td style="padding:6px 0;font-weight:600;">${esc(title)}</td></tr>
          <tr><td style="padding:6px 0;color:#98a0ae;">When</td><td style="padding:6px 0;font-weight:600;">${esc(whenLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#98a0ae;">Where</td><td style="padding:6px 0;">${esc(location)}</td></tr>
          ${host ? `<tr><td style="padding:6px 0;color:#98a0ae;">With</td><td style="padding:6px 0;">${esc(host)}</td></tr>` : ""}
        </table>
      </td></tr>
      <tr><td style="padding:18px 32px 26px;border-top:1px solid #eef0f3;">
        <p style="color:#667085;font-size:13px;margin:0 0 4px;">Need to make a change? <a href="${esc(manageLink)}" style="color:#7A67E8;font-weight:600;text-decoration:none;">Reschedule or cancel</a>.</p>
        <p style="color:#98a0ae;font-size:12px;margin:0;">Or just reply to this email.</p>
      </td></tr>
    </table></td></tr></table></body></html>`;
}
function hostEmailHtml(accent: string, title: string, whenLabel: string, guestName: string, guestEmail: string, guestPhone: string | null, location: string, notes: string | null, intakeRows: { label: string; value: string }[]): string {
  const intakeHtml = intakeRows.length
    ? intakeRows.map((r) => `<tr><td style="padding:6px 0;color:#98a0ae;vertical-align:top;">${esc(r.label)}</td><td style="padding:6px 0;">${esc(r.value)}</td></tr>`).join("")
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="height:5px;background:${esc(accent)};"></td></tr>
      <tr><td style="padding:28px 32px;">
        <h1 style="color:#101828;font-size:19px;margin:0 0 14px;">New booking</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#101828;">
          <tr><td style="padding:6px 0;color:#98a0ae;width:88px;">Session</td><td style="padding:6px 0;font-weight:600;">${esc(title)}</td></tr>
          <tr><td style="padding:6px 0;color:#98a0ae;">When</td><td style="padding:6px 0;font-weight:600;">${esc(whenLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#98a0ae;">Guest</td><td style="padding:6px 0;">${esc(guestName)} &lt;${esc(guestEmail)}&gt;</td></tr>
          ${guestPhone ? `<tr><td style="padding:6px 0;color:#98a0ae;">Phone</td><td style="padding:6px 0;">${esc(guestPhone)}</td></tr>` : ""}
          <tr><td style="padding:6px 0;color:#98a0ae;">Where</td><td style="padding:6px 0;">${esc(location)}</td></tr>
          ${notes ? `<tr><td style="padding:6px 0;color:#98a0ae;vertical-align:top;">Notes</td><td style="padding:6px 0;">${esc(notes)}</td></tr>` : ""}
          ${intakeHtml}
        </table>
      </td></tr>
    </table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const slug = typeof body?.slug === "string" ? body.slug.toLowerCase() : "";
    if (!slug) return json({ error: "slug required" }, 400);
    const ip = clientIp(req);

    // Prefer a first-class calendar; fall back to the legacy per-staff page.
    const host = (await loadCalendar(admin, slug)) ?? (await loadHost(admin, slug));
    if (!host) return json({ error: "This booking page isn't available." }, 404);

    const now = Date.now();

    // Selected appointment type (service menu). When types exist, the chosen
    // one's duration drives the slot grid; default to the first if none sent.
    const selectType = (id: unknown): AppointmentType | null => {
      if (!host.appointmentTypes.length) return null;
      const wanted = typeof id === "string" ? id : "";
      return host.appointmentTypes.find((t) => t.id === wanted) ?? host.appointmentTypes[0];
    };

    if (action === "availability") {
      // Throttle this cheap, anon action per-IP (catches one client rotating
      // slugs) and per-slug (catches distributed hammering of one page). Short-
      // circuits so an already-blocked IP doesn't also charge the slug bucket.
      if (await overRateLimit(admin, `pb:avail:ip:${ip}`, RL_AVAIL_PER_IP) ||
          await overRateLimit(admin, `pb:avail:slug:${slug}`, RL_AVAIL_PER_SLUG)) {
        return json({ error: TOO_MANY }, 429);
      }
      const selType = selectType(body?.appointmentTypeId);
      const effHost = selType ? { ...host, durationMin: selType.duration_min } : host;
      const fromMs = Math.max(now, Date.parse(body?.from) || now);
      // Cap the window at the calendar's booking horizon (how far ahead guests may book).
      // With no explicit `to`, serve up to the horizon but bound the first payload to
      // ~92 days; the page refetches with an explicit `to` as the guest pages forward.
      const horizonMs = now + host.horizonDays * 86_400_000;
      const defaultToMs = now + Math.min(host.horizonDays, 92) * 86_400_000;
      const toMs = Math.min(horizonMs, Date.parse(body?.to) || defaultToMs);
      let slots: number[];
      // Populated only for Class: spots remaining per slot, so the guest sees
      // "3 of 10 left" rather than a slot just vanishing at zero.
      let classSpots: Record<string, { capacity: number; remaining: number }> | undefined;
      if (effHost.isClass) {
        // A slot with an existing session is open while it has room; a slot
        // with none yet is open if the host has no OTHER conflict.
        const busy = await loadBusy(admin, effHost.user_id, fromMs, toMs);
        const sessions = await loadClassSessions(admin, host.calendarId as string, fromMs, toMs);
        slots = classSlots(effHost, busy, sessions, fromMs, toMs, now);
        classSpots = {};
        for (const s of slots) {
          const sess = sessions.get(s);
          classSpots[new Date(s).toISOString()] = sess
            ? { capacity: sess.capacity, remaining: sess.capacity - sess.booked }
            : { capacity: effHost.capacity, remaining: effHost.capacity };
        }
      } else if (effHost.collective) {
        // Everyone must attend: a slot shows only if EVERY host is free for it.
        // Fetch every host's busy set concurrently — the loads are independent.
        const busyByHost: Record<string, Busy[]> = {};
        const loaded = await Promise.all(effHost.hosts.map(async (uid) => [uid, await loadBusy(admin, uid, fromMs, toMs)] as const));
        for (const [uid, b] of loaded) busyByHost[uid] = b;
        slots = collectiveSlots(effHost, busyByHost, fromMs, toMs, now);
      } else if (effHost.roundRobin) {
        // Combined team availability: a slot shows if any host is free for it.
        // Fetch every host's busy set concurrently — the loads are independent.
        const busyByHost: Record<string, Busy[]> = {};
        const loaded = await Promise.all(effHost.hosts.map(async (uid) => [uid, await loadBusy(admin, uid, fromMs, toMs)] as const));
        for (const [uid, b] of loaded) busyByHost[uid] = b;
        slots = roundRobinSlots(effHost, busyByHost, fromMs, toMs, now);
      } else {
        const busy = await loadBusy(admin, effHost.user_id, fromMs, toMs);
        slots = computeSlots(effHost, busy, fromMs, toMs, now);
      }
      // Collective only: who the guest is meeting, shown before they book (the
      // confirmation email already names hosts — this is the same info surfaced
      // one step earlier, on the picker itself).
      const withHosts = effHost.collective && effHost.hosts.length > 1
        ? await resolveHostNames(admin, effHost.hosts)
        : null;
      return json({
        durationMin: effHost.durationMin,
        timezone: host.timezone,
        branding: await loadBranding(admin, host),
        slots: slots.map((s) => new Date(s).toISOString()),
        ...(classSpots ? { classSpots } : {}),
        ...(withHosts ? { withHosts } : {}),
      });
    }

    if (action === "create") {
      // Per-IP throttle for the expensive write path, in ADDITION to the
      // per-host (and per-calendar class) caps below — this bounds an attacker
      // spraying bookings across many slugs/hosts from one IP, which those
      // per-target caps miss. Fail-open on limiter error (never block a real
      // booking); fail-closed 429 on a genuine limit.
      if (await overRateLimit(admin, `pb:create:ip:${ip}`, RL_CREATE_PER_IP)) {
        return json({ error: TOO_MANY }, 429);
      }
      const startMs = Date.parse(body?.start);
      const name = String(body?.guest?.name ?? "").trim().slice(0, 120);
      const email = String(body?.guest?.email ?? "").trim().toLowerCase().slice(0, 200);
      const phone = String(body?.guest?.phone ?? "").trim().slice(0, 40) || null;
      const notes = String(body?.notes ?? "").trim().slice(0, 1000) || null;
      if (!Number.isFinite(startMs)) return json({ error: "Invalid time." }, 400);
      if (startMs > now + host.horizonDays * 86_400_000) return json({ error: "That time is too far out." }, 400);
      if (!name) return json({ error: "Name is required." }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "A valid email is required." }, 400);

      // Appointment type (service menu): if the calendar offers types, require a
      // valid pick — its duration drives the meeting length and is stored.
      let selType: AppointmentType | null = null;
      if (host.appointmentTypes.length) {
        selType = host.appointmentTypes.find((t) => t.id === body?.appointmentTypeId) ?? null;
        if (!selType) return json({ error: "Please choose a service." }, 400);
      }
      const effHost = selType ? { ...host, durationMin: selType.duration_min } : host;

      // Owner-authored intake questions: validate required, keep only known
      // options, cap lengths. A missing required answer blocks the booking.
      const intake = collectAnswers(host.intakeQuestions, body?.answers);
      if ("error" in intake) return json({ error: intake.error }, 400);

      // Abuse control: class registration bursts are legitimate (many guests
      // signing up for one popular session inside a minute is normal, not
      // abuse) — scope that check per-calendar with a much higher ceiling
      // instead of the tight per-host counter used for everything else.
      if (effHost.isClass) {
        const { count: recentClass } = await admin
          .from("internal_bookings")
          .select("id", { count: "exact", head: true })
          .eq("calendar_id", host.calendarId).eq("booking_kind", "class_seat")
          .gte("created_at", new Date(now - 60_000).toISOString());
        if ((recentClass ?? 0) >= 30) return json({ error: "Too many requests — please try again shortly." }, 429);
      } else {
        const { count: recent } = await admin
          .from("internal_bookings")
          .select("id", { count: "exact", head: true })
          .eq("host_user_id", host.user_id)
          .eq("source", "booking_page")
          .gte("created_at", new Date(now - 60_000).toISOString());
        if ((recent ?? 0) >= 5) return json({ error: "Too many requests — please try again shortly." }, 429);
      }

      // Re-validate the slot is a real window start (for the selected duration)
      // against the RIGHT host's OWN hours: collective needs it inside EVERY
      // host's windows, round-robin inside AT LEAST ONE host's (the specific host
      // is then picked from those free AND in-window below), single/class inside
      // the one host's. A slot that's free but outside the chosen host's real
      // hours must never book.
      let winValid: boolean;
      if (effHost.collective) {
        winValid = effHost.hosts.every((uid) => isHostWindowStart(effHost, uid, startMs, now));
      } else if (effHost.roundRobin) {
        winValid = effHost.hosts.some((uid) => isHostWindowStart(effHost, uid, startMs, now));
      } else {
        winValid = isHostWindowStart(effHost, effHost.user_id, startMs, now);
      }
      if (!winValid) return json({ error: "That time is no longer available. Please pick another." }, 409);

      // Resolve the meeting method from the owner's offered options. One option →
      // fixed; several → the invitee's validated choice. Phone uses their number.
      const opts = host.locationOptions.length ? host.locationOptions : [{ type: host.locationType, value: host.locationValue }];
      const chosenType = String(body?.location ?? "").trim();
      const picked = opts.length === 1 ? opts[0] : (opts.find((o) => o.type === chosenType) ?? opts[0]);
      const locationType = picked.type;
      const locationValue = picked.type === "phone" ? (picked.value ?? phone ?? null) : (picked.value ?? null);
      const endMs = startMs + effHost.durationMin * 60000;

      // On-booking CRM linkage (§7/§8): resolve or create the guest's CRM
      // contact before writing the booking, so it's never a dead end. One
      // contact per guest regardless of booking type — a collective booking's
      // N host-leg rows all point at the same contact.
      const contactId = await findOrCreateContact(admin, host.tenant_id, host.user_id, name, email, phone);

      // Assign host(s) + write the booking. Each branch produces the same
      // shape (a row with id/start_at/end_at/title, plus which host(s) to
      // notify) so the confirmation-email tail below runs unchanged for all three.
      let bookingRow: { id: string; start_at: string; end_at: string; title: string };
      let hostsToNotify: string[];
      // Set on a collective booking so the Zoom mint below can stamp every leg
      // (the one meeting on the primary host) with the join link / meeting id.
      let collectiveGroupId: string | null = null;

      if (effHost.isClass) {
        // Race-safe capacity: lock/find-or-create the session, count, insert
        // the seat — all inside one Postgres function call (an EXCLUDE
        // constraint can't express "≤ N rows share this key", only pairwise
        // overlap, so this needs its own atomic lock→count→insert).
        const { data: seat, error } = await admin.rpc("create_class_booking", {
          _calendar_id: host.calendarId, _host_user_id: host.user_id, _tenant_id: host.tenant_id,
          _start_at: new Date(startMs).toISOString(), _end_at: new Date(endMs).toISOString(),
          _timezone: host.timezone, _capacity: effHost.capacity,
          _title: selType ? `${selType.name} — ${name}` : `${host.title || "Class"} — ${name}`,
          _guest_name: name, _guest_email: email, _guest_phone: phone, _notes: notes,
          _location_type: locationType, _location_value: locationValue,
          _intake_answers: Object.keys(intake.answers).length ? intake.answers : null,
          _source: "booking_page", _contact_id: contactId,
        });
        if (error) {
          if ((error as { message?: string }).message === "sold_out")
            return json({ error: "This class is full. Please pick another time." }, 409);
          const code = (error as { code?: string }).code;
          if (code === "23P01" || code === "23505")
            return json({ error: "That time was just booked. Please pick another." }, 409);
          return json({ error: error.message }, 500);
        }
        // The RPC's RETURNING * hands back every internal_bookings column
        // (host_user_id, tenant_id, calendar_id, reminder_state, ...) — narrow
        // to the same public shape the other two branches already return via
        // an explicit .select(), so a class booking doesn't leak internal
        // identifiers the single/round-robin/collective paths withhold.
        const seatRow = seat as { id: string; start_at: string; end_at: string; title: string };
        bookingRow = { id: seatRow.id, start_at: seatRow.start_at, end_at: seatRow.end_at, title: seatRow.title };
        hostsToNotify = [host.user_id];
      } else if (effHost.collective) {
        // Everyone must attend: one symmetric row per host, sharing a group id.
        // Every row is independently protected by the (rescoped) EXCLUDE
        // constraint — this is the direct fix for a host's busy time being
        // invisible to the DB when only one row recorded one chosen host.
        const groupId = crypto.randomUUID();
        collectiveGroupId = groupId;
        const title = selType ? `${selType.name} with ${name}` : `Meeting with ${name}`;
        const rows = effHost.hosts.map((uid) => ({
          tenant_id: host.tenant_id, host_user_id: uid, calendar_id: host.calendarId,
          booking_kind: "collective", collective_group_id: groupId, contact_id: contactId,
          guest_name: name, guest_email: email, guest_phone: phone, notes, title,
          start_at: new Date(startMs).toISOString(), end_at: new Date(endMs).toISOString(),
          timezone: host.timezone, status: "scheduled", source: "booking_page",
          location_type: locationType, location_value: locationValue,
          intake_answers: Object.keys(intake.answers).length ? intake.answers : null,
          appointment_type: selType
            ? { id: selType.id, name: selType.name, duration_min: selType.duration_min, ...(selType.price_cents != null ? { price_cents: selType.price_cents, currency: selType.currency } : {}) }
            : null,
        }));
        const { data: rowsInserted, error } = await admin.from("internal_bookings").insert(rows).select("id, start_at, end_at, title");
        if (error) {
          const code = (error as { code?: string }).code;
          if (code === "23505" || code === "23P01")
            return json({ error: "That time was just booked. Please pick another." }, 409);
          return json({ error: error.message }, 500);
        }
        bookingRow = (rowsInserted as (typeof bookingRow)[])[0];
        hostsToNotify = effHost.hosts;
      } else {
        // Single / round-robin — unchanged.
        let chosenHost = host.user_id;
        if (effHost.roundRobin) {
          // Load every host's busy set for the day concurrently (independent
          // reads), then narrow to those free at this slot — preserving the
          // roster's priority order. The unique (host, start) index still guards
          // against a race on the specific host we land on.
          const dayMs = 86_400_000;
          const busyByHost: Record<string, Busy[]> = {};
          const loaded = await Promise.all(effHost.hosts.map(async (uid) => [uid, await loadBusy(admin, uid, startMs - dayMs, startMs + dayMs)] as const));
          for (const [uid, b] of loaded) busyByHost[uid] = b;
          // Candidate hosts: free AND the slot is inside THEIR own hours. Without
          // the window check a host who is merely free (but off-hours) could be
          // assigned a booking outside their real schedule — the whole point of
          // per-host hours. Priority order is preserved by filtering `hosts`.
          const free = effHost.hosts.filter((uid) =>
            isFree(effHost, busyByHost[uid] ?? [], startMs) && isHostWindowStart(effHost, uid, startMs, now));
          if (!free.length) return json({ error: "That time is no longer available. Please pick another." }, 409);

          if (effHost.assignmentStrategy === "priority") {
            // Strict roster order: the highest-priority free host takes it.
            chosenHost = free[0];
          } else if (effHost.assignmentStrategy === "availability") {
            // Give it to the free host with the most open time that day, so the
            // busiest host is spared; ties fall to priority order (free is
            // already priority-ordered, so the first max wins).
            const { y, mo, d } = ymdInTz(startMs, effHost.timezone);
            const dayStart = zonedWallToUtcMs(y, mo - 1, d, 0, 0, effHost.timezone);
            const dayEnd = zonedWallToUtcMs(y, mo - 1, d + 1, 0, 0, effHost.timezone);
            // Count each host's open slots that day against THEIR own hours — a
            // host on a lighter custom schedule shouldn't look "more open" only
            // because the calendar default is wider than the hours they work.
            const openCount = (uid: string) => {
              const hv = hostView(effHost, uid);
              return windowStarts(hv, dayStart, dayEnd, now).filter((s) => isFree(hv, busyByHost[uid] ?? [], s)).length;
            };
            let best = free[0];
            let bestOpen = openCount(best);
            for (const uid of free.slice(1)) {
              const c = openCount(uid);
              if (c > bestOpen) { best = uid; bestOpen = c; }
            }
            chosenHost = best;
          } else {
            // Balanced (default): fewest upcoming bookings, tie-broken by
            // priority order — the fairest rotation across the team.
            const loads = await Promise.all(free.map(async (uid) => {
              const { count } = await admin.from("internal_bookings")
                .select("id", { count: "exact", head: true })
                .eq("host_user_id", uid).neq("status", "cancelled")
                .gte("start_at", new Date(now).toISOString());
              return { uid, count: count ?? 0 };
            }));
            loads.sort((a, b) => a.count - b.count || effHost.hosts.indexOf(a.uid) - effHost.hosts.indexOf(b.uid));
            chosenHost = loads[0].uid;
          }
        } else {
          const busy = await loadBusy(admin, host.user_id, startMs - 86_400_000, startMs + 86_400_000);
          if (!isFree(effHost, busy, startMs)) return json({ error: "That time is no longer available. Please pick another." }, 409);
        }

        const { data, error } = await admin.from("internal_bookings").insert({
          tenant_id: host.tenant_id,
          host_user_id: chosenHost,
          calendar_id: host.calendarId,
          contact_id: contactId,
          guest_name: name,
          guest_email: email,
          guest_phone: phone,
          title: selType ? `${selType.name} with ${name}` : `Meeting with ${name}`,
          notes,
          start_at: new Date(startMs).toISOString(),
          end_at: new Date(endMs).toISOString(),
          timezone: host.timezone,
          status: "scheduled",
          source: "booking_page",
          location_type: locationType,
          location_value: locationValue,
          intake_answers: Object.keys(intake.answers).length ? intake.answers : null,
          appointment_type: selType
            ? { id: selType.id, name: selType.name, duration_min: selType.duration_min, ...(selType.price_cents != null ? { price_cents: selType.price_cents, currency: selType.currency } : {}) }
            : null,
        }).select("id, start_at, end_at, title").single();
        if (error) {
          // 23505 = exact-start unique violation; 23P01 = the GiST exclusion
          // constraint (overlapping time range for this host) — both mean the
          // slot was just taken in a race.
          const code = (error as { code?: string }).code;
          if (code === "23505" || code === "23P01")
            return json({ error: "That time was just booked. Please pick another." }, 409);
          return json({ error: error.message }, 500);
        }
        bookingRow = data as typeof bookingRow;
        hostsToNotify = [chosenHost];
      }

      // Zoom (best-effort, §13): if this calendar meets over Zoom and the
      // assigned host has connected their OWN Zoom (§9), mint a real meeting on
      // their account and persist the join link + meeting id onto the booking so
      // the confirmation carries a live link instead of "link to follow". For
      // collective, the ONE meeting is minted on the primary host and stamped
      // onto every leg (all attend the same meeting — never N meetings). Any
      // failure (no connection, API error, un-refreshable token) is logged and
      // the booking proceeds unchanged with the existing label — a Zoom problem
      // NEVER blocks or rolls back a booking that's already committed.
      let zoomJoinUrl: string | null = null;
      if (locationType === "zoom") {
        try {
          // hostsToNotify[0] is the meeting owner in every mode: the assigned
          // host (round-robin), the sole host (single/class), or the primary
          // host (collective — effHost.hosts[0]).
          const meetingHost = hostsToNotify[0];
          const zoom = await createZoomMeeting(admin, meetingHost, {
            topic: bookingRow.title || selType?.name || host.title || "Meeting",
            startISO: bookingRow.start_at,
            durationMin: effHost.durationMin,
            timezone: host.timezone,
          });
          if (zoom) {
            zoomJoinUrl = zoom.join_url;
            const patch = { location_value: zoom.join_url, meeting_url: zoom.join_url, zoom_meeting_id: zoom.meeting_id };
            const { error: stampErr } = collectiveGroupId
              ? await admin.from("internal_bookings").update(patch).eq("collective_group_id", collectiveGroupId).neq("status", "cancelled")
              : await admin.from("internal_bookings").update(patch).eq("id", bookingRow.id);
            // A stamp failure just means the row lacks the URL for later
            // update/cancel sync — the meeting exists and the email still gets
            // the link (zoomJoinUrl is already set). Log, don't fail.
            if (stampErr) console.error("public-booking: zoom link stamp failed", { bookingId: bookingRow.id, err: stampErr.message });
          }
        } catch (e) {
          console.error("public-booking: zoom meeting mint failed (booking kept, link-to-follow fallback)", {
            bookingId: bookingRow.id, host: hostsToNotify[0], err: (e as Error)?.message,
          });
        }
      }

      // Confirmation emails (guest + every host to notify) with an .ics invite
      // — non-blocking: a mail failure must never fail a booking that's
      // already committed.
      try {
        const brand = await loadBranding(admin, host);
        const whenLabel = new Intl.DateTimeFormat("en-US", {
          timeZone: host.timezone, weekday: "long", month: "long", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZoneName: "short",
        }).format(new Date(startMs));
        // A minted Zoom link (best-effort above) replaces the "link to follow"
        // label for the guest, host, and .ics — everyone gets the live join URL.
        const loc = zoomJoinUrl || locationLabel(locationType, locationValue);
        const title = selType?.name || host.title || "Your session";
        const ics = buildIcs({
          uid: `${bookingRow.id}@paigeagent.ai`, startMs, endMs, title,
          desc: host.description || "", location: loc, organizer: brand.name, attendee: email, attendeeName: name,
        });
        // Owner-facing: render each answered intake question as a labeled row.
        const intakeRows = host.intakeQuestions
          .map((q) => {
            const a = intake.answers[q.id];
            const v = Array.isArray(a) ? a.join(", ") : (a ?? "");
            return v ? { label: q.label, value: v } : null;
          })
          .filter((r): r is { label: string; value: string } => r !== null);
        const mUrl = await manageUrl(bookingRow.id);

        const hostInfos = await Promise.all(hostsToNotify.map(async (uid) => {
          const { data: hostUser } = await admin.auth.admin.getUserById(uid);
          return { uid, email: (hostUser as { user?: { email?: string } } | null)?.user?.email };
        }));
        // Collective only: name every attending host in the guest's email
        // ("With: Jane Doe, Sam Lee") instead of just the brand name — the
        // same names the availability step already showed before they booked.
        let withLine = brand.name;
        if (effHost.collective && hostsToNotify.length > 1) {
          withLine = (await resolveHostNames(admin, hostsToNotify)) || withLine;
        }

        // §6/§9: the guest is the tenant's CLIENT, so the confirmation wears the
        // tenant's own sending identity (their {slug}@ address / verified domain),
        // not the platform calendar@. Host-notify below stays on the platform
        // address (staff-facing). Falls back to EMAIL_FROM if unresolved.
        let guestSender: { from?: string; replyTo?: string } | undefined;
        let guestSenderAccount = "platform";
        if (host.confirmGuest && host.tenant_id) {
          try {
            const { data: ident } = await admin.rpc("tenant_sender_identity", { _tenant_id: host.tenant_id });
            const fromAddr = (ident as { from_address?: string } | null)?.from_address;
            const fromName = (ident as { from_name?: string } | null)?.from_name || brand.name;
            if (fromAddr) {
              const cleanName = String(fromName).replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
              guestSender = {
                from: cleanName ? `${cleanName} <${fromAddr}>` : fromAddr,
                replyTo: (ident as { reply_to?: string } | null)?.reply_to || undefined,
              };
              guestSenderAccount = "tenant";
            }
          } catch { /* keep platform fallback */ }
        }

        const guestOk = host.confirmGuest
          ? await sendEmail(email, `Confirmed: ${title} · ${whenLabel}`,
              guestEmailHtml(brand.name, brand.accent, title, whenLabel, loc, withLine, mUrl), ics, guestSender)
          : false;

        const hostSendResults: { email: string; ok: boolean }[] = [];
        if (host.confirmHost) {
          for (const info of hostInfos) {
            if (!info.email) continue;
            const ok = await sendEmail(info.email, `New booking: ${name} · ${whenLabel}`,
              hostEmailHtml(brand.accent, title, whenLabel, name, email, phone, loc, notes, intakeRows), ics);
            hostSendResults.push({ email: info.email, ok });
          }
        }
        await admin.from("email_send_log").insert([
          { template_name: "booking_confirmation", recipient_email: email, status: guestOk ? "sent" : "skipped", sender_account: guestSenderAccount, metadata: { via: "public-booking", slug } },
          ...hostSendResults.map((r) => ({ template_name: "booking_host_notify", recipient_email: r.email, status: r.ok ? "sent" : "skipped", sender_account: "platform", metadata: { via: "public-booking", slug } })),
        ]).then(() => {}, () => {});

        // Surface the booking to staff as an actionable in-app notification
        // (§8) — same best-effort tail as the emails above; a notifier hiccup
        // must never fail a booking that's already committed.
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-team-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ event: "booking_created", booking_id: bookingRow.id, host_user_ids: hostsToNotify }),
        }).catch((e) => console.error("public-booking: notify-team-event dispatch failed", { bookingId: bookingRow.id, err: (e as Error)?.message }));

        // Opt-in lifecycle triggers (§8): fire any owner-authored
        // on-booking-created message. This is SEPARATE from the built-in
        // confirmation above and only runs when the tenant added a `created`
        // entry to notify_config.lifecycle — so a default calendar never
        // double-sends. Each send is claimed in booking_notifications_sent (the
        // same idempotency ledger the scheduled worker uses), keyed per
        // event/target/channel/recipient, so a duplicate call can't double-send.
        const createdLc = host.lifecycle.filter((l) => l.event === "created");
        if (createdLc.length) {
          const vars: Record<string, string> = {
            guest_name: name || "there", when: whenLabel, where: loc, title, service: title,
          };
          const hostEmails = hostInfos.map((h) => h.email).filter((e): e is string => !!e);
          // Each host's primary phone (only fetched when a host-targeted step exists). An
          // unreadable phone list skips SMS-to-host, loudly.
          let hostPhones: string[] = [];
          if (createdLc.some((l) => l.to !== "guest")) {
            try {
              const phones = await primaryPhonesForUsers(admin, hostsToNotify);
              hostPhones = hostsToNotify.map((uid) => phones.get(uid) ?? "").filter(Boolean);
            } catch (e) {
              console.error("[public-booking] host_phone_read_failed", (e as Error).message);
            }
          }
          // claim→send→delete-on-failure, mirroring the worker so a failed send
          // is retryable and a won claim guarantees exactly one send.
          const claimLc = async (key: string, rec: string) => {
            const { error } = await admin.from("booking_notifications_sent")
              .insert({ booking_id: bookingRow.id, notif_key: key, recipient_email: rec || null, status: "sending" });
            return !error;
          };
          const finishLc = async (key: string, ok: boolean) => {
            if (ok) await admin.from("booking_notifications_sent").update({ status: "sent" }).eq("booking_id", bookingRow.id).eq("notif_key", key);
            else await admin.from("booking_notifications_sent").delete().eq("booking_id", bookingRow.id).eq("notif_key", key);
          };
          for (const lc of createdLc) {
            for (const who of targetsOf(lc.to)) {
              for (const ch of channelsOf(lc.channel)) {
                const recipients = ch === "email"
                  ? (who === "guest" ? (email ? [email] : []) : hostEmails)
                  : (who === "guest" ? (phone ? [phone] : []) : hostPhones);
                for (const rec of recipients) {
                  const key = `lc:created:${who}:${ch}:${rec}`;
                  if (!(await claimLc(key, rec))) continue;
                  let ok = false;
                  if (ch === "email") {
                    const subject = lc.subject ? renderTemplate(lc.subject, vars) : `Confirmed: ${title} · ${whenLabel}`;
                    const bodyText = lc.body ? renderTemplate(lc.body, vars) : `You're booked for ${title} on ${whenLabel}. ${loc}.`;
                    ok = await sendEmail(rec, subject, lifecycleEmailHtml(brand.name, brand.accent, subject, bodyText, mUrl),
                      undefined, who === "guest" ? guestSender : undefined);
                  } else {
                    const line = lc.body ? renderTemplate(lc.body, vars) : `Confirmed: ${title} on ${whenLabel}. ${loc}.`;
                    ok = await sendSms(rec, `${line}\nReschedule or cancel: ${mUrl}`);
                  }
                  await finishLc(key, ok);
                }
              }
            }
          }
        }
      } catch (e) {
        // Best-effort: a mail/notify failure must never fail a committed
        // booking — but log it (visible in Supabase edge logs). Two real bugs
        // (a scope CHECK violation, a btoa Latin1 crash) hid behind this exact
        // silent catch; a trace here is the difference between a log line and
        // an hour of forensic debugging.
        console.error("public-booking: post-booking email/notify tail failed", {
          bookingId: bookingRow.id, slug, err: (e as Error)?.message, stack: (e as Error)?.stack,
        });
      }

      return json({ ok: true, booking: bookingRow });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
