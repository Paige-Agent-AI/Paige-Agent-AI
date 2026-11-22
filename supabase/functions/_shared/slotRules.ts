// Shared slot-validity rules — the single source of truth for "is this start a
// real, bookable window start?" Extracted so the public booking engine and the
// guest self-serve reschedule path validate a chosen time the SAME way; a stale
// or hand-crafted slot must not be able to slip past overrides, the booking
// horizon, minimum notice, or buffer-padded conflicts on one path but not the
// other. Pure Deno/TS, no external deps, no I/O — the caller loads the calendar
// config + busy intervals and passes them in.

// day 0=Sun..6=Sat, "HH:MM" wall-clock in the calendar's timezone.
export interface DayWindow { day: number; start: string; end: string }

// Calendar-level fallback is the original booking engine's weekday 9–5 policy.
// Host overrides are deliberately NOT parsed here: an explicit empty host
// schedule means no hours, whereas a missing calendar schedule uses this default.
const DEFAULT_AVAILABILITY: DayWindow[] = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));

export function parseCalendarAvailability(raw: unknown): DayWindow[] {
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
// Per-date exception to the weekly pattern: block a whole day, or set special hours.
export interface DateOverride { date: string; blocked: boolean; windows: { start: string; end: string }[] }
export interface Busy { start: number; end: number } // UTC ms

/** Everything needed to decide whether a start time is a legitimate slot. */
export interface SlotRules {
  availability: DayWindow[];
  durationMin: number;
  minNoticeMin: number;
  horizonDays: number;
  dateOverrides: DateOverride[];
  timezone: string;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

// --- Timezone math (Intl-based; no external tz lib) — identical to the engine ---
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
/** The Y/M/D (+weekday) of a UTC instant as seen in `tz`. */
function ymdInTz(ms: number, tz: string): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, mo: +p.month, d: +p.day, wd };
}

/** All candidate slot starts in the availability windows over [fromMs, toMs]
 *  (busy-agnostic). Mirrors public-booking's windowStarts, including the
 *  DST-safe calendar-date walk and the date-override precedence. */
export function windowStarts(r: SlotRules, fromMs: number, toMs: number, nowMs: number): number[] {
  const starts: number[] = [];
  const durMs = r.durationMin * 60000;
  const earliest = nowMs + r.minNoticeMin * 60000;
  const dayMs = 86_400_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Walk CALENDAR dates (not fixed 24h steps) in the calendar's timezone.
  // Stepping a raw UTC-ms cursor by exactly 86_400_000 can skip the short (23h)
  // day of a DST spring-forward transition when `fromMs` falls late in the local
  // day. Deriving each next date via calendar arithmetic visits every date once.
  let { y, mo, d } = ymdInTz(fromMs - dayMs, r.timezone);
  while (zonedWallToUtcMs(y, mo - 1, d, 12, 0, r.timezone) <= toMs + dayMs) {
    // Weekday of a calendar date is timezone-independent — pure date math.
    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    // Date overrides win over the weekly pattern: a blocked date yields nothing;
    // a date with custom windows uses those; otherwise fall back to the week.
    const override = r.dateOverrides.find((o) => o.date === `${y}-${pad(mo)}-${pad(d)}`);
    if (!override?.blocked) {
      const windows = override
        ? override.windows.map((w) => ({ day: wd, start: w.start, end: w.end }))
        : r.availability.filter((w) => w.day === wd);
      for (const w of windows) {
        const [sh, sm] = w.start.split(":").map(Number);
        const [eh, em] = w.end.split(":").map(Number);
        const winStart = zonedWallToUtcMs(y, mo - 1, d, sh, sm, r.timezone);
        const winEnd = zonedWallToUtcMs(y, mo - 1, d, eh, em, r.timezone);
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

/** Is [s, s+dur] free of buffer-padded conflicts against `busy`? Identical
 *  padding to the engine's isFree — before/after buffers widen each busy block. */
export function isFree(r: SlotRules, busy: Busy[], s: number): boolean {
  const e = s + r.durationMin * 60000;
  return !busy.some((b) => s < b.end + r.bufferAfterMin * 60000 && e + r.bufferBeforeMin * 60000 > b.start);
}

/** Is `startMs` a legitimate window start — a real slot on an open date, past
 *  minimum notice, and inside the booking horizon? Busy-agnostic (conflict/
 *  buffer checks are the caller's, via isFree against the host's real bookings),
 *  so this is the exact parity check to the engine's create-time re-validation:
 *  `windowStarts(...).some(s => s === startMs)` plus the horizon ceiling. */
export function isValidSlotStart(r: SlotRules, startMs: number, nowMs: number): boolean {
  if (!Number.isFinite(startMs)) return false;
  // Horizon ceiling — mirrors the engine's "that time is too far out" guard.
  if (startMs > nowMs + r.horizonDays * 86_400_000) return false;
  // A single-slot probe window (±1 min) is enough to test membership without
  // materializing the whole horizon's worth of starts.
  return windowStarts(r, startMs - 60_000, startMs + 60_000, nowMs).some((s) => s === startMs);
}
