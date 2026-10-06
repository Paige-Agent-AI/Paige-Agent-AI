/**
 * Business Operating Snapshot — the composition seam behind "Give me a read on the business for <period>".
 *
 * WHY THIS EXISTS. PAIGE has ONE runtime (`paige-ai-chat`) and both Chat and Live Conversation consume
 * it. A "read on the business" touches many canonical domains at once — revenue, pipeline, clients,
 * bookings, work, the game plan — and the easy failure is to let one builder query them all, swallow
 * whatever fails, and hand the model a confident paragraph with silent holes in it. That is exactly what
 * the Context Assembly Contract (`docs/brain/paige-context-assembly-contract.md`, seam `./mod.ts`)
 * forbids. This module is the contract applied to that one question:
 *
 *   - READ-ONLY. It writes nothing, calls no model, sends nothing. It assembles.
 *   - DOMAINS OWN THEIR NUMBERS. Every figure arrives from a domain-owned adapter, already computed by
 *     the canonical owner of that domain, namespaced `<domain>.<name>`. The composer never adds, divides
 *     or reconciles across domains — cross-domain arithmetic is where a phantom number is born.
 *   - HONEST DEGRADATION. Every requested domain reports available | unavailable | degraded WITH a
 *     reason: no workspace, scope changed mid-read, over budget, timed out, failed, bad shape, two
 *     owners claiming it, not connected on the platform yet, or not wired. Nothing catches to empty.
 *   - THE STRING IS BUILT LAST. `projectOperatingSnapshot` renders the structured result, bounded, and
 *     tells the model in plain words what is unknown so it never estimates a missing number.
 *
 * Pure and dependency-free: no `npm:`, no Deno globals, no hidden clock (`now` is always injected).
 * Deno and vitest import it directly, like `./mod.ts` and `../paige-turn/route.ts`.
 */

import {
  contextAvailable,
  contextDegraded,
  contextUnavailable,
  degradationLedger,
  identityScopeChanged,
  type AccountShape,
  type ContextIdentity,
  type ContextSourceResult,
  type DegradationEntry,
} from "./mod.ts";

export const OPERATING_SNAPSHOT_VERSION = 1 as const;

const DAY_MS = 86_400_000;

// ── A. Periods ───────────────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_PERIOD_KEYS = [
  "today",
  "last_7_days",
  "last_30_days",
  "current_quarter",
  "custom",
] as const;
export type SnapshotPeriodKey = (typeof SNAPSHOT_PERIOD_KEYS)[number];

export const SNAPSHOT_PERIOD_BASES = ["calendar", "rolling"] as const;
export type SnapshotPeriodBasis = (typeof SNAPSHOT_PERIOD_BASES)[number];

export type SnapshotPeriod = {
  readonly key: SnapshotPeriodKey;
  /** ISO UTC instant, inclusive. */
  readonly start: string;
  /** ISO UTC instant, exclusive. */
  readonly end: string;
  /** IANA time zone the calendar boundaries were computed in. */
  readonly timezone: string;
  readonly basis: SnapshotPeriodBasis;
  /** Plain words for the owner, e.g. "the last 7 days". */
  readonly label: string;
};

export const SNAPSHOT_PERIOD_REFUSALS = [
  "invalid_timezone",
  "custom_bounds_required",
  "custom_bounds_invalid",
  "custom_range_inverted",
  "custom_range_too_long",
  "custom_range_in_future",
  "unknown_period",
] as const;
export type SnapshotPeriodRefusal = (typeof SNAPSHOT_PERIOD_REFUSALS)[number];

export type ResolveSnapshotPeriodInput = {
  readonly key: string;
  readonly now: Date;
  readonly timezone: string;
  readonly customStart?: string;
  readonly customEnd?: string;
  /** Longest custom range accepted, in days. Default 366. */
  readonly maxCustomDays?: number;
};

export type ResolveSnapshotPeriodResult =
  | { readonly ok: true; readonly period: SnapshotPeriod }
  | { readonly ok: false; readonly reason: SnapshotPeriodRefusal };

/** A custom end may sit at most this far past `now` (clock skew), never more. No clamping. */
const FUTURE_TOLERANCE_MS = 60_000;
const DEFAULT_MAX_CUSTOM_DAYS = 366;

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zoneFormatter(timezone: string): Intl.DateTimeFormat | null {
  if (typeof timezone !== "string" || timezone.trim() === "") return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // An unknown zone is a refusal the caller reports (`invalid_timezone`), not a silent fallback.
    return null;
  }
}

function localParts(ms: number, fmt: Intl.DateTimeFormat): LocalParts {
  const out: LocalParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof LocalParts] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0; // some engines render midnight as 24 even under h23
  return out;
}

/** Zone offset (local − UTC) in ms at the given instant. */
function zoneOffsetMs(ms: number, fmt: Intl.DateTimeFormat): number {
  const p = localParts(ms, fmt);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant the given local calendar date begins. The offset is taken at a first guess and
 * re-checked once at the candidate, so a date whose midnight sits on the other side of a DST change from
 * the naive guess (Sydney, Auckland) still lands on the true local midnight. Where a zone springs forward
 * AT midnight (Santiago, Havana, Beirut, Cairo) local midnight does not exist; the day then begins at the
 * earliest candidate that is actually on that date (e.g. 01:00) — never at 23:00 the evening before.
 */
function localMidnightUtc(year: number, month: number, day: number, fmt: Intl.DateTimeFormat): number {
  const naive = Date.UTC(year, month - 1, day);
  const first = naive - zoneOffsetMs(naive, fmt);
  const second = naive - zoneOffsetMs(first, fmt);
  const onDate = [second, first].filter((ms) => {
    const p = localParts(ms, fmt);
    return p.year === year && p.month === month && p.day === day;
  });
  return onDate.length > 0 ? Math.min(...onDate) : second;
}

function isoDate(p: { year: number; month: number; day: number }): string {
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A custom bound is either a full ISO instant with an explicit zone designator, or a bare date — read as
 * local midnight in the period's time zone. A local time with no designator is ambiguous and refused.
 */
function parseCustomBound(value: string, fmt: Intl.DateTimeFormat): number | null {
  const trimmed = value.trim();
  const dateOnly = ISO_DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      return null;
    }
    return localMidnightUtc(year, month, day, fmt);
  }
  if (!ISO_INSTANT.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

export function resolveSnapshotPeriod(input: ResolveSnapshotPeriodInput): ResolveSnapshotPeriodResult {
  if (!(SNAPSHOT_PERIOD_KEYS as readonly string[]).includes(input.key)) {
    return { ok: false, reason: "unknown_period" };
  }
  const key = input.key as SnapshotPeriodKey;
  const fmt = zoneFormatter(input.timezone);
  if (!fmt) return { ok: false, reason: "invalid_timezone" };
  const timezone = fmt.resolvedOptions().timeZone;
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "custom_bounds_invalid" };
  const nowIso = new Date(nowMs).toISOString();
  const today = localParts(nowMs, fmt);

  switch (key) {
    case "today": {
      const start = localMidnightUtc(today.year, today.month, today.day, fmt);
      return {
        ok: true,
        period: { key, start: new Date(start).toISOString(), end: nowIso, timezone, basis: "calendar", label: "today" },
      };
    }
    case "last_7_days":
    case "last_30_days": {
      const days = key === "last_7_days" ? 7 : 30;
      return {
        ok: true,
        period: {
          key,
          start: new Date(nowMs - days * DAY_MS).toISOString(),
          end: nowIso,
          timezone,
          basis: "rolling",
          label: `the last ${days} days`,
        },
      };
    }
    case "current_quarter": {
      const quarter = Math.floor((today.month - 1) / 3) + 1;
      const firstMonth = (quarter - 1) * 3 + 1;
      const start = localMidnightUtc(today.year, firstMonth, 1, fmt);
      return {
        ok: true,
        period: {
          key,
          start: new Date(start).toISOString(),
          end: nowIso,
          timezone,
          basis: "calendar",
          label: `this quarter so far (Q${quarter} ${today.year})`,
        },
      };
    }
    case "custom": {
      if (typeof input.customStart !== "string" || typeof input.customEnd !== "string" ||
          input.customStart.trim() === "" || input.customEnd.trim() === "") {
        return { ok: false, reason: "custom_bounds_required" };
      }
      const start = parseCustomBound(input.customStart, fmt);
      const end = parseCustomBound(input.customEnd, fmt);
      if (start === null || end === null) return { ok: false, reason: "custom_bounds_invalid" };
      if (start >= end) return { ok: false, reason: "custom_range_inverted" };
      if (end > nowMs + FUTURE_TOLERANCE_MS) return { ok: false, reason: "custom_range_in_future" };
      const maxDays = typeof input.maxCustomDays === "number" && Number.isFinite(input.maxCustomDays) &&
          input.maxCustomDays > 0
        ? input.maxCustomDays
        : DEFAULT_MAX_CUSTOM_DAYS;
      if (end - start > maxDays * DAY_MS) return { ok: false, reason: "custom_range_too_long" };
      const firstDay = isoDate(localParts(start, fmt));
      const lastDay = isoDate(localParts(end - 1, fmt));
      return {
        ok: true,
        period: {
          key,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          timezone,
          basis: "calendar",
          label: firstDay === lastDay ? firstDay : `${firstDay} to ${lastDay}`,
        },
      };
    }
  }
}

function describeDuration(ms: number): string {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/**
 * The window of identical length immediately before `period` — what "what changed since the previous
 * review" compares against. It ends where `period` starts. Its key is `custom` (it is an explicit window,
 * not a named one), its basis is inherited, and its label says plainly what it is.
 */
export function previousPeriod(period: SnapshotPeriod): SnapshotPeriod {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const length = end - start;
  const duration = describeDuration(length);
  const label = period.basis === "rolling"
    ? `the previous ${duration}`
    : `the previous ${duration} (just before ${period.label})`;
  return {
    key: "custom",
    start: new Date(start - length).toISOString(),
    end: new Date(start).toISOString(),
    timezone: period.timezone,
    basis: period.basis,
    label,
  };
}

/** Whole days covered, rounded up, minimum 1 — for domain RPCs that take `p_window_days`. */
export function periodWindowDays(period: SnapshotPeriod): number {
  const length = Date.parse(period.end) - Date.parse(period.start);
  if (!Number.isFinite(length) || length <= 0) return 1;
  return Math.max(1, Math.ceil(length / DAY_MS));
}

/** True when the period is exactly N×24h rolling — i.e. a `p_window_days` RPC reads it with no drift. */
export function periodIsRollingDays(period: SnapshotPeriod): boolean {
  const length = Date.parse(period.end) - Date.parse(period.start);
  return period.basis === "rolling" && Number.isFinite(length) && length > 0 && length % DAY_MS === 0;
}

// ── B. Domain snapshot contract ──────────────────────────────────────────────────────────────────────

export const SNAPSHOT_DOMAINS = [
  "revenue",
  "sales_pipeline",
  "clients",
  "payments",
  "communications",
  "email",
  "sms",
  "support",
  "social",
  "paid_acquisition",
  "campaigns",
  "events",
  "bookings",
  "reviews",
  "work",
  "game_plan",
  "operations",
  "outcomes",
  "knowledge",
  "research",
] as const;
export type SnapshotDomain = (typeof SNAPSHOT_DOMAINS)[number];

export function isSnapshotDomain(value: unknown): value is SnapshotDomain {
  return typeof value === "string" && (SNAPSHOT_DOMAINS as readonly string[]).includes(value);
}

export const SNAPSHOT_METRIC_UNITS = ["count", "currency_minor", "percent", "ratio", "days"] as const;
export type SnapshotMetricUnit = (typeof SNAPSHOT_METRIC_UNITS)[number];

/** in_period = activity inside the window; point_in_time = state right now; all_time = since the start. */
export const SNAPSHOT_METRIC_BASES = ["in_period", "point_in_time", "all_time"] as const;
export type SnapshotMetricBasis = (typeof SNAPSHOT_METRIC_BASES)[number];

export type SnapshotMetric = {
  /** Namespaced `<domain>.<name>`; the namespace must equal the owning domain. */
  readonly key: string;
  readonly label: string;
  /** null = the domain could not produce it; it is never rendered as zero. */
  readonly value: number | null;
  readonly unit: SnapshotMetricUnit;
  /** ISO-4217, upper case. Required iff unit is currency_minor. */
  readonly currency?: string;
  readonly basis: SnapshotMetricBasis;
  /** e.g. "rolling 7×24h ending now" when the domain could not align to the calendar period. */
  readonly window_note?: string;
};

export const SNAPSHOT_FRESHNESS = ["live_read", "snapshot"] as const;
export const SNAPSHOT_COVERAGE = ["full", "partial"] as const;
export const SNAPSHOT_CHANGE_DIRECTIONS = ["up", "down", "flat"] as const;
export const SNAPSHOT_RISK_SEVERITIES = ["info", "watch", "act"] as const;
export const SNAPSHOT_GOAL_RELATIONS = ["advances", "threatens", "context"] as const;

export type DomainSnapshot = {
  readonly domain: SnapshotDomain;
  /** The owning lane/system — who to ask when a figure looks wrong. */
  readonly owner: string;
  readonly period: SnapshotPeriod;
  /** ISO instant the domain read happened. */
  readonly as_of: string;
  readonly freshness: (typeof SNAPSHOT_FRESHNESS)[number];
  readonly coverage: (typeof SNAPSHOT_COVERAGE)[number];
  /** Required when coverage is partial, forbidden otherwise. */
  readonly coverage_note?: string;
  readonly headline: readonly SnapshotMetric[];
  readonly changes: readonly {
    readonly summary: string;
    readonly metric_key?: string;
    readonly direction?: (typeof SNAPSHOT_CHANGE_DIRECTIONS)[number];
  }[];
  readonly outcomes: readonly {
    readonly capability_key: string;
    readonly succeeded: number;
    readonly failed: number;
    readonly reference?: string;
  }[];
  readonly risks: readonly {
    readonly kind: string;
    readonly summary: string;
    readonly severity: (typeof SNAPSHOT_RISK_SEVERITIES)[number];
    readonly reference?: string;
  }[];
  readonly upcoming: readonly {
    readonly kind: string;
    readonly at: string;
    readonly summary: string;
    readonly reference?: string;
  }[];
  readonly goal_links: readonly {
    readonly mission_id: string;
    readonly relation: (typeof SNAPSHOT_GOAL_RELATIONS)[number];
  }[];
  /** Provenance; at least one. */
  readonly sources: readonly { readonly system: string; readonly adapter: string; readonly reference?: string }[];
};

export const SNAPSHOT_BOUNDS = {
  headline: 24,
  changes: 20,
  outcomes: 20,
  risks: 20,
  upcoming: 20,
  goal_links: 20,
  sources: 10,
  shortText: 120,
  note: 300,
  summary: 500,
} as const;

export type ValidateDomainSnapshotResult =
  | { readonly ok: true; readonly snapshot: DomainSnapshot }
  | { readonly ok: false; readonly reason: string };

class ShapeError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function fail(reason: string): never {
  throw new ShapeError(reason);
}

type Obj = Record<string, unknown>;

function record(value: unknown, path: string, allowed: readonly string[]): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`not_object:${path}`);
  const obj = value as Obj;
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`unknown_field:${path}.${k}`);
  }
  return obj;
}

function text(obj: Obj, field: string, path: string, max: number): string {
  const v = obj[field];
  if (typeof v !== "string" || v.trim() === "") fail(`field:${path}.${field}`);
  if (v.length > max) fail("over_bound");
  return v;
}

function optionalText(obj: Obj, field: string, path: string, max: number): string | undefined {
  if (obj[field] === undefined) return undefined;
  return text(obj, field, path, max);
}

function oneOf<T extends string>(obj: Obj, field: string, path: string, allowed: readonly T[]): T {
  const v = obj[field];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) fail(`field:${path}.${field}`);
  return v as T;
}

function instant(obj: Obj, field: string, path: string): string {
  const v = text(obj, field, path, SNAPSHOT_BOUNDS.shortText);
  if (!Number.isFinite(Date.parse(v))) fail(`field:${path}.${field}`);
  return v;
}

function count(obj: Obj, field: string, path: string): number {
  const v = obj[field];
  if (typeof v !== "number" || !Number.isFinite(v)) fail("non_finite");
  if (!Number.isSafeInteger(v) || v < 0) fail(`field:${path}.${field}`);
  return v;
}

function list(obj: Obj, field: string, path: string, max: number): readonly unknown[] {
  const v = obj[field];
  if (!Array.isArray(v)) fail(`field:${path}.${field}`);
  if (v.length > max) fail("over_bound");
  return v;
}

const METRIC_KEY = /^([a-z][a-z_]*)\.([a-z0-9_]{1,64})$/;

function namespacedKey(key: string, domain: SnapshotDomain): void {
  const m = METRIC_KEY.exec(key);
  if (!m || m[1] !== domain) fail("metric_namespace");
}

function strip<T extends Obj>(value: T): T {
  for (const k of Object.keys(value)) if (value[k] === undefined) delete value[k];
  return value;
}

function validateMetric(value: unknown, domain: SnapshotDomain, i: number): SnapshotMetric {
  const path = `headline[${i}]`;
  const m = record(value, path, ["key", "label", "value", "unit", "currency", "basis", "window_note"]);
  const key = text(m, "key", path, SNAPSHOT_BOUNDS.shortText);
  namespacedKey(key, domain);
  const label = text(m, "label", path, SNAPSHOT_BOUNDS.shortText);
  const unit = oneOf(m, "unit", path, SNAPSHOT_METRIC_UNITS);
  const raw = m.value;
  let metricValue: number | null;
  if (raw === null) {
    metricValue = null;
  } else if (typeof raw === "number") {
    if (!Number.isFinite(raw)) fail("non_finite");
    metricValue = raw;
  } else {
    fail(`field:${path}.value`);
  }
  let currency: string | undefined;
  if (unit === "currency_minor") {
    const c = m.currency;
    if (typeof c !== "string" || !/^[A-Z]{3}$/.test(c)) fail("currency");
    // Minor units are whole by definition; a fractional cent is a unit error upstream.
    if (metricValue !== null && !Number.isSafeInteger(metricValue)) fail("currency");
    currency = c;
  } else if (m.currency !== undefined) {
    fail("currency");
  }
  const basis = oneOf(m, "basis", path, SNAPSHOT_METRIC_BASES);
  const window_note = optionalText(m, "window_note", path, SNAPSHOT_BOUNDS.note);
  return strip({ key, label, value: metricValue, unit, currency, basis, window_note });
}

/**
 * Exact-shape validation of an adapter's DomainSnapshot. Unknown fields, wrong namespaces, a period that
 * is not the one asked for, non-finite numbers and over-long lists are all refusals with a named reason.
 * The returned snapshot is a fresh object built from the known fields only (and carries the expected
 * period object), so nothing an adapter smuggled in survives into the projection.
 */
export function validateDomainSnapshot(
  value: unknown,
  expected: { readonly domain: SnapshotDomain; readonly period: SnapshotPeriod },
): ValidateDomainSnapshotResult {
  try {
    const s = record(value, "snapshot", [
      "domain", "owner", "period", "as_of", "freshness", "coverage", "coverage_note",
      "headline", "changes", "outcomes", "risks", "upcoming", "goal_links", "sources",
    ]);
    if (s.domain !== expected.domain) fail("domain_mismatch");
    const domain = expected.domain;
    const owner = text(s, "owner", "snapshot", SNAPSHOT_BOUNDS.shortText);

    const p = s.period;
    if (p === null || typeof p !== "object" || Array.isArray(p)) fail("period_mismatch");
    const po = p as Obj;
    if (po.key !== expected.period.key || po.start !== expected.period.start || po.end !== expected.period.end) {
      fail("period_mismatch");
    }

    const as_of = instant(s, "as_of", "snapshot");
    const freshness = oneOf(s, "freshness", "snapshot", SNAPSHOT_FRESHNESS);
    const coverage = oneOf(s, "coverage", "snapshot", SNAPSHOT_COVERAGE);
    let coverage_note: string | undefined;
    if (coverage === "partial") {
      coverage_note = text(s, "coverage_note", "snapshot", SNAPSHOT_BOUNDS.note);
    } else if (s.coverage_note !== undefined) {
      fail("coverage_note");
    }

    const headlineRaw = list(s, "headline", "snapshot", SNAPSHOT_BOUNDS.headline);
    const headline = headlineRaw.map((m, i) => validateMetric(m, domain, i));
    const seen = new Set<string>();
    for (const m of headline) {
      if (seen.has(m.key)) fail("duplicate_metric");
      seen.add(m.key);
    }

    const changes = list(s, "changes", "snapshot", SNAPSHOT_BOUNDS.changes).map((c, i) => {
      const path = `changes[${i}]`;
      const o = record(c, path, ["summary", "metric_key", "direction"]);
      const summary = text(o, "summary", path, SNAPSHOT_BOUNDS.summary);
      const metric_key = optionalText(o, "metric_key", path, SNAPSHOT_BOUNDS.shortText);
      if (metric_key !== undefined) namespacedKey(metric_key, domain);
      const direction = o.direction === undefined
        ? undefined
        : oneOf(o, "direction", path, SNAPSHOT_CHANGE_DIRECTIONS);
      return strip({ summary, metric_key, direction });
    });

    const outcomes = list(s, "outcomes", "snapshot", SNAPSHOT_BOUNDS.outcomes).map((c, i) => {
      const path = `outcomes[${i}]`;
      const o = record(c, path, ["capability_key", "succeeded", "failed", "reference"]);
      return strip({
        capability_key: text(o, "capability_key", path, SNAPSHOT_BOUNDS.shortText),
        succeeded: count(o, "succeeded", path),
        failed: count(o, "failed", path),
        reference: optionalText(o, "reference", path, SNAPSHOT_BOUNDS.note),
      });
    });

    const risks = list(s, "risks", "snapshot", SNAPSHOT_BOUNDS.risks).map((c, i) => {
      const path = `risks[${i}]`;
      const o = record(c, path, ["kind", "summary", "severity", "reference"]);
      return strip({
        kind: text(o, "kind", path, 64),
        summary: text(o, "summary", path, SNAPSHOT_BOUNDS.summary),
        severity: oneOf(o, "severity", path, SNAPSHOT_RISK_SEVERITIES),
        reference: optionalText(o, "reference", path, SNAPSHOT_BOUNDS.note),
      });
    });

    const upcoming = list(s, "upcoming", "snapshot", SNAPSHOT_BOUNDS.upcoming).map((c, i) => {
      const path = `upcoming[${i}]`;
      const o = record(c, path, ["kind", "at", "summary", "reference"]);
      return strip({
        kind: text(o, "kind", path, 64),
        at: instant(o, "at", path),
        summary: text(o, "summary", path, SNAPSHOT_BOUNDS.summary),
        reference: optionalText(o, "reference", path, SNAPSHOT_BOUNDS.note),
      });
    });

    const goal_links = list(s, "goal_links", "snapshot", SNAPSHOT_BOUNDS.goal_links).map((c, i) => {
      const path = `goal_links[${i}]`;
      const o = record(c, path, ["mission_id", "relation"]);
      return {
        mission_id: text(o, "mission_id", path, SNAPSHOT_BOUNDS.shortText),
        relation: oneOf(o, "relation", path, SNAPSHOT_GOAL_RELATIONS),
      };
    });

    const sourcesRaw = list(s, "sources", "snapshot", SNAPSHOT_BOUNDS.sources);
    if (sourcesRaw.length === 0) fail("sources_required");
    const sources = sourcesRaw.map((c, i) => {
      const path = `sources[${i}]`;
      const o = record(c, path, ["system", "adapter", "reference"]);
      return strip({
        system: text(o, "system", path, SNAPSHOT_BOUNDS.shortText),
        adapter: text(o, "adapter", path, SNAPSHOT_BOUNDS.shortText),
        reference: optionalText(o, "reference", path, SNAPSHOT_BOUNDS.note),
      });
    });

    const snapshot: DomainSnapshot = strip({
      domain,
      owner,
      period: { ...expected.period },
      as_of,
      freshness,
      coverage,
      coverage_note,
      headline,
      changes,
      outcomes,
      risks,
      upcoming,
      goal_links,
      sources,
    });
    return { ok: true, snapshot };
  } catch (error) {
    if (error instanceof ShapeError) return { ok: false, reason: error.reason };
    // A hostile getter or proxy: still a refusal, never a pass and never a leaked message.
    return { ok: false, reason: "unreadable" };
  }
}

// ── C. Adapters and the NOT-CONNECTED register ───────────────────────────────────────────────────────

export type SnapshotAdapterContext = {
  readonly identity: ContextIdentity;
  readonly period: SnapshotPeriod;
  readonly now: Date;
  readonly signal?: AbortSignal;
};

export type DomainSnapshotAdapter = {
  readonly domain: SnapshotDomain;
  readonly owner: string;
  read(ctx: SnapshotAdapterContext): Promise<ContextSourceResult<DomainSnapshot>>;
};

/**
 * Domains whose substrate does not exist on the platform yet (Phase 0 grounding, 2026-10-06, HEAD
 * 8b7f975). When one is requested and no adapter is supplied, the composer reports it unavailable with
 * this reason, verbatim — so PAIGE says what is missing instead of implying a zero. Owner-legible words;
 * no table names. Remove an entry in the same change that ships its adapter.
 */
export const NOT_CONNECTED_DOMAINS: Readonly<Partial<Record<SnapshotDomain, string>>> = Object.freeze({
  paid_acquisition: "No ad-account connection exists on the platform yet, so ad spend and results cannot be read.",
  reviews: "Reviews and reputation are not connected to the platform yet.",
  events: "Webinars and event registrations are not tracked on the platform yet.",
  sms: "Business texting has not sent or received any messages through the platform yet, and no texting read is connected.",
  social: "Social accounts can be recorded, but no social account is connected for posting or results, so reach and engagement cannot be read.",
  support: "There is no support-ticket system on the platform yet.",
});

// ── D. Composer ──────────────────────────────────────────────────────────────────────────────────────

export type BusinessOperatingSnapshot = {
  readonly version: typeof OPERATING_SNAPSHOT_VERSION;
  readonly tenant_id: string | null;
  readonly actor_id: string;
  readonly account_shape: AccountShape | null;
  readonly period: SnapshotPeriod;
  readonly composed_at: string;
  readonly requested: SnapshotDomain[];
  readonly domains: Record<string, ContextSourceResult<DomainSnapshot>>;
  readonly degradation: DegradationEntry[];
  readonly budget: {
    readonly adapters_run: number;
    readonly timed_out: string[];
    /** Domains not run because of maxDomains — listed here AND reported unavailable, never silent. */
    readonly truncated: string[];
  };
};

export type ComposeOperatingSnapshotInput = {
  readonly identity: ContextIdentity;
  readonly period: SnapshotPeriod;
  /** Requested domains; deduplicated, order preserved. */
  readonly domains: readonly SnapshotDomain[];
  readonly adapters: readonly DomainSnapshotAdapter[];
  readonly now: Date;
  readonly currentScopeEpoch: number | string;
  /** Per-adapter timeout. Default 4000ms. */
  readonly timeoutMs?: number;
  /** Most domains read in one composition. Default 12. */
  readonly maxDomains?: number;
};

export const SNAPSHOT_DEFAULT_TIMEOUT_MS = 4000;
export const SNAPSHOT_DEFAULT_MAX_DOMAINS = 12;

/** Composer-issued reason codes (adapter-supplied reasons pass through as given). */
export const SNAPSHOT_REASON = {
  noWorkspace: "no_workspace",
  scopeChanged: "scope_changed",
  overBudget: "over_budget",
  timeout: "timeout",
  adapterError: "adapter_error",
  invalidShape: "invalid_shape",
  invalidResult: "invalid_result",
  duplicateAdapter: "duplicate_adapter",
  noAdapter: "no_adapter",
  noReasonGiven: "no_reason_given",
} as const;

/**
 * `contextUnavailable` is typed to `null` data; this re-types the same result for the snapshot record
 * (identical status, reason and null data — no new semantics).
 */
function unavailableSnapshot(reason: string): ContextSourceResult<DomainSnapshot> {
  const result = contextUnavailable(reason);
  return { status: result.status, reason: result.reason, data: null };
}

const ERROR_CODE = /^[A-Z0-9_]{2,64}$/;
const MAX_PASSTHROUGH_REASON = 300;

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function dedupeDomains(domains: readonly SnapshotDomain[]): SnapshotDomain[] {
  const out: SnapshotDomain[] = [];
  for (const d of domains) if (isSnapshotDomain(d) && !out.includes(d)) out.push(d);
  return out;
}

function errorReason(error: unknown): string {
  // The message never leaves: it may carry a query, an email, a provider payload. A short, closed-format
  // code the adapter chose on purpose is the only thing that rides along.
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && ERROR_CODE.test(code)) return `${SNAPSHOT_REASON.adapterError}:${code}`;
  }
  return SNAPSHOT_REASON.adapterError;
}

function passThroughReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim() === "") return SNAPSHOT_REASON.noReasonGiven;
  const flat = reason.replace(/\s+/g, " ").trim();
  return flat.length > MAX_PASSTHROUGH_REASON ? `${flat.slice(0, MAX_PASSTHROUGH_REASON - 1)}…` : flat;
}

type AdapterOutcome =
  | { kind: "result"; result: unknown }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

async function runAdapter(
  adapter: DomainSnapshotAdapter,
  ctx: Omit<SnapshotAdapterContext, "signal">,
  timeoutMs: number,
): Promise<AdapterOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AdapterOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  let pending: Promise<unknown>;
  try {
    pending = Promise.resolve(adapter.read({ ...ctx, signal: controller.signal }));
  } catch (error) {
    pending = Promise.reject(error);
  }
  const work = pending.then(
    (result): AdapterOutcome => ({ kind: "result", result }),
    (error): AdapterOutcome => ({ kind: "error", error }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function settle(
  outcome: AdapterOutcome,
  domain: SnapshotDomain,
  period: SnapshotPeriod,
): ContextSourceResult<DomainSnapshot> {
  if (outcome.kind === "timeout") return contextDegraded(SNAPSHOT_REASON.timeout);
  if (outcome.kind === "error") return contextDegraded(errorReason(outcome.error));
  const result = outcome.result;
  if (result === null || typeof result !== "object") return contextDegraded(SNAPSHOT_REASON.invalidResult);
  const r = result as { status?: unknown; reason?: unknown; data?: unknown };
  if (r.status === "available") {
    const checked = validateDomainSnapshot(r.data, { domain, period });
    return checked.ok
      ? contextAvailable(checked.snapshot)
      : contextDegraded(`${SNAPSHOT_REASON.invalidShape}:${checked.reason}`);
  }
  if (r.status === "unavailable") return unavailableSnapshot(passThroughReason(r.reason));
  if (r.status === "degraded") return contextDegraded(passThroughReason(r.reason));
  return contextDegraded(SNAPSHOT_REASON.invalidResult);
}

/**
 * Assemble one Business Operating Snapshot. Fails closed on a missing workspace or a changed scope
 * (nothing runs), reads each requested domain through its single owning adapter concurrently with its
 * own timeout, validates every available result, and reports every gap with a reason. Never throws for
 * an adapter's sake and never mutates its inputs.
 */
export async function composeOperatingSnapshot(
  input: ComposeOperatingSnapshotInput,
): Promise<BusinessOperatingSnapshot> {
  const { identity, period, now } = input;
  const requested = dedupeDomains(input.domains);
  const timeoutMs = positiveOr(input.timeoutMs, SNAPSHOT_DEFAULT_TIMEOUT_MS);
  const maxDomains = Math.floor(positiveOr(input.maxDomains, SNAPSHOT_DEFAULT_MAX_DOMAINS));

  const domains: Record<string, ContextSourceResult<DomainSnapshot>> = {};
  const timedOut: string[] = [];
  const truncated: string[] = [];
  let adaptersRun = 0;

  const finish = (): BusinessOperatingSnapshot => ({
    version: OPERATING_SNAPSHOT_VERSION,
    tenant_id: identity.tenantId,
    actor_id: identity.actorId,
    account_shape: identity.accountShape,
    period: { ...period },
    composed_at: now.toISOString(),
    requested: [...requested],
    domains,
    degradation: [...degradationLedger(domains)],
    budget: { adapters_run: adaptersRun, timed_out: timedOut, truncated },
  });

  if (identity.tenantId === null || identity.tenantId === "") {
    for (const d of requested) domains[d] = unavailableSnapshot(SNAPSHOT_REASON.noWorkspace);
    return finish();
  }
  if (identityScopeChanged(identity, input.currentScopeEpoch)) {
    for (const d of requested) domains[d] = contextDegraded(SNAPSHOT_REASON.scopeChanged);
    return finish();
  }

  const toRun = requested.slice(0, maxDomains);
  const dropped = requested.slice(maxDomains);

  const jobs: { domain: SnapshotDomain; promise: Promise<AdapterOutcome> }[] = [];
  const planned: Record<string, ContextSourceResult<DomainSnapshot> | "run"> = {};

  for (const domain of toRun) {
    const owners = input.adapters.filter((a) => a.domain === domain);
    if (owners.length > 99) {
      planned[domain] = contextDegraded(SNAPSHOT_REASON.duplicateAdapter);
      continue;
    }
    if (owners.length === 0) {
      const notConnected = NOT_CONNECTED_DOMAINS[domain];
      planned[domain] = notConnected !== undefined
        ? unavailableSnapshot(notConnected)
        : unavailableSnapshot(`${SNAPSHOT_REASON.noAdapter}: ${domain}`);
      continue;
    }
    planned[domain] = "run";
    adaptersRun += 1;
    // Each adapter gets its own copies: one adapter cannot alter what another (or the validator) sees.
    jobs.push({
      domain,
      promise: runAdapter(owners[0], { identity: { ...identity }, period: { ...period }, now: new Date(now.getTime()) }, timeoutMs),
    });
  }

  const outcomes = await Promise.all(jobs.map((j) => j.promise));
  const byDomain = new Map<SnapshotDomain, AdapterOutcome>();
  jobs.forEach((j, i) => byDomain.set(j.domain, outcomes[i]));

  // Assemble in requested order so the record, the ledger and timed_out are deterministic.
  for (const domain of requested) {
    if (dropped.includes(domain)) {
      domains[domain] = unavailableSnapshot(SNAPSHOT_REASON.overBudget);
      truncated.push(domain);
      continue;
    }
    const plan = planned[domain];
    if (plan !== "run") {
      domains[domain] = plan;
      continue;
    }
    const outcome = byDomain.get(domain) as AdapterOutcome;
    if (outcome.kind === "timeout") timedOut.push(domain);
    domains[domain] = settle(outcome, domain, period);
  }
  return finish();
}

export const DEFAULT_REVIEW_DOMAINS: readonly SnapshotDomain[] = Object.freeze([
  "revenue",
  "sales_pipeline",
  "clients",
  "payments",
  "communications",
  "email",
  "campaigns",
  "bookings",
  "work",
  "game_plan",
  "operations",
  "outcomes",
]);

/** Plain-language names people use for a domain. Keys are lower case. */
export const SNAPSHOT_DOMAIN_ALIASES: Readonly<Record<string, SnapshotDomain>> = Object.freeze({
  sales: "sales_pipeline",
  pipeline: "sales_pipeline",
  money: "revenue",
  invoices: "payments",
  collections: "payments",
  texts: "sms",
  text: "sms",
  ads: "paid_acquisition",
  webinars: "events",
  registrations: "events",
  meetings: "bookings",
  calendar: "bookings",
  goals: "game_plan",
  missions: "game_plan",
  tasks: "work",
  blockers: "operations",
  reputation: "reviews",
});

/**
 * The domains a review reads. No focus → the default review set. A focus is mapped by domain name or
 * alias (case-insensitive, trimmed), unknown words are dropped, duplicates removed in order; if nothing
 * in the focus is recognisable, the default review set is read rather than nothing.
 */
export function selectSnapshotDomains(request: { readonly focus?: readonly string[] }): SnapshotDomain[] {
  const focus = request.focus ?? [];
  const out: SnapshotDomain[] = [];
  for (const raw of focus) {
    if (typeof raw !== "string") continue;
    const word = raw.trim().toLowerCase();
    const domain = isSnapshotDomain(word)
      ? word
      : Object.prototype.hasOwnProperty.call(SNAPSHOT_DOMAIN_ALIASES, word)
      ? SNAPSHOT_DOMAIN_ALIASES[word]
      : undefined;
    if (domain !== undefined && !out.includes(domain)) out.push(domain);
  }
  return out.length > 0 ? out : [...DEFAULT_REVIEW_DOMAINS];
}

// ── E. Projection (built LAST, bounded) ──────────────────────────────────────────────────────────────

export const SNAPSHOT_DOMAIN_LABELS: Readonly<Record<SnapshotDomain, string>> = Object.freeze({
  revenue: "Revenue",
  sales_pipeline: "Sales pipeline",
  clients: "Clients",
  payments: "Payments and collections",
  communications: "Conversations",
  email: "Email",
  sms: "Texting",
  support: "Support",
  social: "Social",
  paid_acquisition: "Paid ads",
  campaigns: "Campaigns",
  events: "Events and webinars",
  bookings: "Bookings",
  reviews: "Reviews",
  work: "Work and tasks",
  game_plan: "Game plan",
  operations: "Operations",
  outcomes: "Outcomes",
  knowledge: "Knowledge",
  research: "Research",
});

/** ISO-4217 minor-unit exponents that are not 2. Deterministic; no locale data involved. */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plainNumber(value: number, maxDecimals: number): string {
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toFixed(maxDecimals);
  const [whole, frac = ""] = fixed.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${sign}${group(whole)}${trimmed ? `.${trimmed}` : ""}`;
}

/** Minor units → "USD 1,250.00". Integer math only, so the output never depends on the host locale. */
export function formatCurrencyMinor(minor: number, currency: string): string {
  const exponent = ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  const scale = 10 ** exponent;
  const whole = Math.floor(abs / scale);
  const frac = exponent === 0 ? "" : `.${String(abs % scale).padStart(exponent, "0")}`;
  return `${currency} ${sign}${group(String(whole))}${frac}`;
}

export function formatSnapshotMetricValue(metric: SnapshotMetric): string {
  if (metric.value === null) return "not available";
  switch (metric.unit) {
    case "currency_minor":
      return formatCurrencyMinor(metric.value, metric.currency ?? "");
    case "percent":
      return `${plainNumber(metric.value, 1)}%`;
    case "ratio":
      return plainNumber(metric.value, 2);
    case "days":
      return `${plainNumber(metric.value, 1)} ${metric.value === 1 ? "day" : "days"}`;
    case "count":
      return plainNumber(metric.value, 2);
  }
}

const BASIS_TAG: Readonly<Record<SnapshotMetricBasis, string>> = {
  in_period: "in period",
  point_in_time: "right now",
  all_time: "all time",
};

/** Composer-issued codes → plain words for the model. Anything else is an adapter's own reason. */
export function plainSnapshotReason(domain: SnapshotDomain, reason: string | undefined): string {
  const r = reason ?? SNAPSHOT_REASON.noReasonGiven;
  if (r === NOT_CONNECTED_DOMAINS[domain]) return r;
  if (r === SNAPSHOT_REASON.noWorkspace) return "no business workspace is selected, so nothing was read";
  if (r === SNAPSHOT_REASON.scopeChanged) return "the workspace changed during this read, so nothing from it was used";
  if (r === SNAPSHOT_REASON.overBudget) return "too many areas were asked for at once; ask about this one on its own";
  if (r === SNAPSHOT_REASON.timeout) return "the read did not finish in time";
  if (r === SNAPSHOT_REASON.adapterError || r.startsWith(`${SNAPSHOT_REASON.adapterError}:`)) return "the read failed";
  if (r.startsWith(`${SNAPSHOT_REASON.invalidShape}:`) || r === SNAPSHOT_REASON.invalidResult) {
    return "the read came back in a shape that failed checks, so none of it was used";
  }
  if (r === SNAPSHOT_REASON.duplicateAdapter) return "more than one source claimed this area, so neither was used";
  if (r.startsWith(`${SNAPSHOT_REASON.noAdapter}:`)) return "this area is not wired into the business read yet";
  if (r === SNAPSHOT_REASON.noReasonGiven) return "the source gave no reason";
  return r;
}

function domainSection(domain: SnapshotDomain, result: ContextSourceResult<DomainSnapshot> | undefined): string[] {
  const title = SNAPSHOT_DOMAIN_LABELS[domain];
  if (!result || result.status !== "available" || result.data === null) {
    const reason = result
      ? (result.status === "available" ? "the source returned nothing" : plainSnapshotReason(domain, result.reason))
      : "it was not read";
    return [`[${title}] NOT AVAILABLE — ${reason}`];
  }
  const s = result.data;
  const lines = [`[${title}] ${s.freshness === "snapshot" ? "stored snapshot as of" : "read at"} ${s.as_of}`];
  if (s.coverage === "partial") lines.push(`- Coverage is partial: ${s.coverage_note ?? "no note"}`);
  if (s.headline.length === 0) lines.push("- No figures reported.");
  for (const m of s.headline) {
    const tags = [BASIS_TAG[m.basis], m.window_note].filter((t): t is string => typeof t === "string" && t !== "");
    lines.push(`- ${m.label}: ${formatSnapshotMetricValue(m)} (${tags.join("; ")})`);
  }
  for (const c of s.changes) lines.push(`- Change${c.direction ? ` (${c.direction})` : ""}: ${c.summary}`);
  for (const o of s.outcomes) lines.push(`- Outcome ${o.capability_key}: ${o.succeeded} succeeded, ${o.failed} failed`);
  for (const r of s.risks) lines.push(`- Risk (${r.severity}): ${r.summary}`);
  for (const u of s.upcoming) lines.push(`- Upcoming ${u.at}: ${u.summary}`);
  for (const g of s.goal_links) lines.push(`- Game plan link: ${g.relation} mission ${g.mission_id}`);
  lines.push(`- Source: ${s.sources.map((x) => `${x.system}/${x.adapter}`).join(", ")}`);
  return lines;
}

export const SNAPSHOT_PROJECTION_INSTRUCTION =
  "Report only what is listed above. Name every area marked NOT AVAILABLE. Never estimate a number that is " +
  "not listed. A listed value of 0 is a real zero; an area marked NOT AVAILABLE is unknown, not zero. " +
  "Numbers labelled 'right now' are current state, not activity in the period.";

/**
 * Plain-text projection for the model, built from the structured snapshot. Bounded by `maxChars`: when
 * over, whole domain sections are dropped from the end and a line names every dropped area — never a
 * mid-line cut, never a silent omission. Same input, same string.
 */
export function projectOperatingSnapshot(
  s: BusinessOperatingSnapshot,
  opts?: { readonly maxChars?: number },
): string {
  const maxChars = Math.floor(positiveOr(opts?.maxChars, 6000));
  const p = s.period;
  const header =
    `Business read for ${p.label} (${p.start} to ${p.end}, ${p.timezone}; composed ${s.composed_at}).`;
  const sections = s.requested.map((d) => ({ domain: d, text: domainSection(d, s.domains[d]).join("\n") }));

  const render = (kept: number): string => {
    const parts = [header, ...sections.slice(0, kept).map((x) => x.text)];
    const droppedNames = sections.slice(kept).map((x) => SNAPSHOT_DOMAIN_LABELS[x.domain]);
    if (droppedNames.length > 0) {
      parts.push(
        `Left out for length (not read into this summary; ask about them separately): ${droppedNames.join(", ")}.`,
      );
    }
    parts.push(SNAPSHOT_PROJECTION_INSTRUCTION);
    return parts.join("\n");
  };

  for (let kept = sections.length; kept > 0; kept -= 1) {
    const out = render(kept);
    if (out.length <= maxChars) return out;
  }
  return render(0);
}
