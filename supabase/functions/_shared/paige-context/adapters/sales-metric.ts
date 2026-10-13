/**
 * Sales metric helpers — the shared plumbing behind the `payments` and `sales_pipeline` snapshot
 * adapters (Operating Fabric F2a).
 *
 * WHY THIS EXISTS. The Sales department already owns governed, tenant-safe measurements of its own
 * domain: the INT-341 producer behind the INT-340 evidence issuer, reached ONLY through
 * `readBusinessMetric` (`../../analytics-metrics/read.ts`). That seam re-resolves the caller's
 * workspace and role on the server, refuses foreign scope, and verifies every value before it returns.
 * These helpers turn its outcomes into Domain Snapshot material without doing any domain math:
 *
 *   - NO ARITHMETIC ON MONEY ACROSS CURRENCIES. Each currency the producer returns becomes its own
 *     metric. Nothing here adds two currencies together, ever.
 *   - A FAILURE IS NEVER A ZERO. Every refusal, unverified read or unavailable source becomes a closed
 *     reason code; a value the producer did not return is not invented.
 *   - AN AMOUNT THAT CANNOT BE SHOWN EXACTLY IS LEFT OUT AND SAID SO. Minor units arrive as decimal
 *     strings; one beyond JavaScript's exact-integer range is dropped and the domain becomes partial.
 *   - EVIDENCE REFERENCES STAY OUT. The issuer's evidence reference is a short-lived bearer-like token
 *     for re-reading; it never enters a snapshot. Provenance is `metric_key@source_revision_ref`.
 *   - READS ARE SEQUENTIAL. The issuer revokes the caller's previous live reference for the same metric
 *     and range key, so two reads of one key must not overlap. Callers await one read before the next.
 *
 * F2b GENERALISED THESE IN PLACE rather than forking them: the interpreter accepts distribution and
 * diagnostic-event values, an expected owning department, and a per-key list of exclusions that are part
 * of a figure's definition. The Sales adapters pass exactly what they passed before. Non-Sales adapters
 * import the same functions under neutral names from `./issuer-metric.ts`.
 *
 * Pure apart from the injected caller: no Deno globals, no hidden clock. Deno and vitest import it.
 */

import { completedUtcDayBoundary, readBusinessMetric, type MetricCaller, type MetricReadOutcome } from "../../analytics-metrics/read.ts";
import { contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult } from "../mod.ts";
import {
  formatCurrencyMinor,
  SNAPSHOT_BOUNDS,
  resolveSnapshotPeriod,
  type DomainSnapshot,
  type SnapshotDomain,
  type SnapshotMetric,
  type SnapshotPeriod,
} from "../snapshot.ts";

const DAY_MS = 86_400_000;

/** One verified measurement, as `readBusinessMetric` projects it (evidence reference included). */
export type SalesMetric = NonNullable<MetricReadOutcome["metric"]>;

/**
 * Closed reason codes these adapters report. All match the composer's adapter-reason form
 * (`[A-Za-z0-9_][A-Za-z0-9_:.-]{0,119}`) and none collides with a composer code.
 */
export const SALES_METRIC_REASON = {
  refused: "metric_read_refused",
  incomplete: "metric_request_incomplete",
  notVerified: "metric_evidence_not_verified",
  sourceUnavailable: "metric_source_unavailable",
  shapeUnexpected: "metric_shape_unexpected",
  windowUnreadable: "metric_window_unreadable",
  aborted: "aborted",
  scopeMismatch: "adapter_scope_mismatch",
  /** The measurement came back owned by a department other than the one the adapter projects. */
  ownerUnexpected: "metric_owner_unexpected",
} as const;
export type SalesMetricReason = (typeof SALES_METRIC_REASON)[keyof typeof SALES_METRIC_REASON];

// ── Window ───────────────────────────────────────────────────────────────────────────────────────────

export type SalesMetricRangeKey = "week" | "month" | "quarter" | "year";

export type SalesMetricWindow = {
  readonly range_key: SalesMetricRangeKey;
  /** ISO UTC instant, inclusive. */
  readonly range_start: string;
  /** ISO UTC instant, exclusive. Never after `now`. */
  readonly range_end: string;
  /** Plain words, present only when the period's end had to be pulled back to `now`. */
  readonly window_note?: string;
};

/**
 * How far behind the edge function's `now` an in-progress window ends. The issuer refuses an end after
 * the DATABASE clock, which is a different host; without this margin an edge clock a little ahead of
 * the database would turn every in-period read into an unverified one. Two seconds of very recent
 * records are the price, and the window note says the period is counted up to just now.
 */
export const SALES_WINDOW_CLOCK_MARGIN_MS = 2_000;

/**
 * Sales activity uses completed UTC days, as the canonical metric reader's named Sales periods do.
 * This is opt-in at the two Sales adapters: neutral Clients/Operations and current-state reads retain
 * their requested windows. Explicit custom intervals disclose their contained completed-day subset;
 * an interval containing no such day is unavailable, never an invented zero. Comparison callers use
 * this effective period so their adjacent cohorts have identical lengths.
 */
export function salesReportingPeriod(period: SnapshotPeriod, now: Date): {
  readonly period: SnapshotPeriod;
  readonly windowNote: string;
  readonly coverageNote?: string;
} | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  const cutoff = completedUtcDayBoundary(now);
  let effective: SnapshotPeriod;
  if (period.key === "custom") {
    const requestedStart = Date.parse(period.start);
    const requestedEnd = Date.parse(period.end);
    if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd)) return null;
    const floorStart = completedUtcDayBoundary(new Date(requestedStart)).getTime();
    const start = floorStart === requestedStart ? floorStart : floorStart + DAY_MS;
    const end = Math.min(completedUtcDayBoundary(new Date(requestedEnd)).getTime(), cutoff.getTime());
    effective = { ...period, start: new Date(start).toISOString(), end: new Date(end).toISOString(), timezone: "UTC" };
  } else {
    const resolved = resolveSnapshotPeriod({ key: period.key, now: cutoff, timezone: "UTC" });
    if ("reason" in resolved) return null;
    effective = resolved.period;
  }
  const start = Date.parse(effective.start);
  const end = Date.parse(effective.end);
  // Preserve the existing database-clock safety margin at the midnight boundary as well.
  if (end <= start || end > nowMs - SALES_WINDOW_CLOCK_MARGIN_MS || start < tenYearsBefore(nowMs)) return null;
  const lastDay = new Date(end - DAY_MS).toISOString().slice(0, 10);
  const windowNote = `Sales reporting: last completed UTC day ${lastDay}; UTC interval ${effective.start} to ${effective.end} (exclusive cutoff).`
    + (period.key === "custom" ? ` Requested interval ${period.start} to ${period.end}; partial UTC days are excluded.` : "");
  const narrowedCustom = period.key === "custom" && (effective.start !== period.start || effective.end !== period.end);
  return { period: effective, windowNote,
    ...(narrowedCustom ? { coverageNote: "Sales activity covers only completed UTC days within the requested interval; partial UTC days are excluded." } : {}),
  };
}

/** The issuer refuses a start more than ten calendar years before its own clock. */
function tenYearsBefore(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  return d.getTime();
}

/**
 * The issuer window for a snapshot period: [period.start, min(period.end, now − margin)), whole
 * milliseconds. The issuer refuses an end after its own clock and a start more than ten years back, so
 * both are honoured here rather than sent to be refused; the margin absorbs a small edge-ahead-of-
 * database clock difference (`SALES_WINDOW_CLOCK_MARGIN_MS`). `range_key` is chosen by the window's
 * length (the issuer's revocation key, not a claim about calendar alignment). The note is set when the
 * period reaches past now, so the figure is a count so far. Null when nothing readable remains.
 */
export function salesMetricWindow(period: SnapshotPeriod, now: Date): SalesMetricWindow | null {
  const nowMs = now instanceof Date ? Math.floor(now.getTime()) : Number.NaN;
  const startMs = Math.floor(Date.parse(period.start));
  const periodEndMs = Math.floor(Date.parse(period.end));
  if (!Number.isFinite(nowMs) || !Number.isFinite(startMs) || !Number.isFinite(periodEndMs)) return null;
  const endMs = Math.min(periodEndMs, nowMs - SALES_WINDOW_CLOCK_MARGIN_MS);
  if (endMs <= startMs || startMs < tenYearsBefore(nowMs)) return null;
  const length = endMs - startMs;
  const range_key: SalesMetricRangeKey = length <= 7 * DAY_MS
    ? "week"
    : length <= 31 * DAY_MS
    ? "month"
    : length <= 92 * DAY_MS
    ? "quarter"
    : "year";
  const window: SalesMetricWindow = {
    range_key,
    range_start: new Date(startMs).toISOString(),
    range_end: new Date(endMs).toISOString(),
  };
  // E2-3b (QA #2102 point 5, review round): the producer counts raw record timestamps in
  // [start, end) — to the second, no day boundary — so the truthful cutoff note fires whenever
  // the end was pulled back to now (endMs < periodEndMs covers BOTH an end after now AND the
  // rolling periods that resolve end = now exactly). A window that already ended in the past is
  // complete and carries no note; the range dates speak for it. This neutral timestamp helper
  // does not impose a day boundary. The two Sales activity adapters separately opt into
  // salesReportingPeriod and carry that effective completed-day interval in their headline note.
  if (endMs < periodEndMs) return { ...window, window_note: "counted up to just now; the period ends later" };
  return window;
}

/** One issuer read for this window. The caller is the authenticated user's client; tenant is server-derived. */
export function readSalesMetric(
  caller: MetricCaller,
  tenantId: string | null,
  metricKey: string,
  window: SalesMetricWindow,
  clock: () => number = Date.now,
): Promise<MetricReadOutcome> {
  return readBusinessMetric(caller, { tenantId }, {
    metric_key: metricKey,
    period: "custom",
    range_key: window.range_key,
    range_start: window.range_start,
    range_end: window.range_end,
  }, clock);
}

// ── Outcome → closed result ──────────────────────────────────────────────────────────────────────────

/** The value kinds the Sales adapters read. Kept as its own name so they read exactly as before. */
export type SalesValueKind = "count" | "currency_totals";

/**
 * Every issuer value kind a snapshot adapter projects (F2b widened this beyond Sales). `decimal` and
 * `series` are deliberately absent: no adapter reads them yet, so asking for one is a type error.
 */
export type IssuerValueKind = SalesValueKind | "distribution" | "diagnostic_events";

/**
 * What an adapter expects from one read, beyond its value kind (F2b).
 *
 * `ownerDepartment`: `readBusinessMetric` checks the owning department only for `sales.*` keys
 * (`analytics-metrics/read.ts`), so an adapter projecting another department's figures states the
 * owner it expects and anything else is refused as `metric_owner_unexpected`.
 *
 * `definitionalExclusions`: some producers report PARTIAL because their own definition leaves records
 * out (passing checks are not "unresolved findings"; a paused client is not an "active client"). For
 * such a key the read is partial only when an exclusion carries a reason OUTSIDE this list, or when the
 * producer marked it partial with nothing excluded at all. An empty list or none keeps the plain rule.
 */
export type IssuerMetricExpectation = {
  readonly kind: IssuerValueKind;
  readonly ownerDepartment?: string;
  readonly definitionalExclusions?: readonly string[];
};

/** `metric` present = a usable read; `failure` present = a closed reason. Narrow with `in`. */
export type SalesMetricResult =
  | { readonly metric: SalesMetric; readonly partial: boolean }
  | { readonly failure: SalesMetricReason };

/** Whether the source's PARTIAL means "incomplete", given the reasons its definition always excludes. */
function sourcePartial(metric: SalesMetric, definitional: readonly string[] | undefined): boolean {
  const marked = metric.truth_state === "PARTIAL" || metric.coverage.state === "partial";
  if (!marked || definitional === undefined || definitional.length === 0) return marked;
  // Marked partial with nothing excluded: the producer knows something it did not itemise. Fail closed.
  if (metric.coverage.excluded_count === 0) return true;
  return metric.exclusions.some((e) => e.count > 0 && !definitional.includes(e.reason));
}

/**
 * Map a read outcome to a usable metric or a closed reason. An available read whose source reported
 * UNAVAILABLE (or returned no values) is a failure, never a zero; a value of an unexpected kind, or a
 * figure owned by an unexpected department, is too.
 */
export function interpretSalesMetric(
  outcome: MetricReadOutcome,
  expect: IssuerValueKind | IssuerMetricExpectation,
): SalesMetricResult {
  const want: IssuerMetricExpectation = typeof expect === "string" ? { kind: expect } : expect;
  if (outcome.status === "refused") return { failure: SALES_METRIC_REASON.refused };
  if (outcome.status === "needs_input") return { failure: SALES_METRIC_REASON.incomplete };
  if (outcome.status !== "available" || !outcome.metric) return { failure: SALES_METRIC_REASON.notVerified };
  const metric = outcome.metric;
  if (want.ownerDepartment !== undefined && metric.owner_department !== want.ownerDepartment) {
    return { failure: SALES_METRIC_REASON.ownerUnexpected };
  }
  if (metric.truth_state === "UNAVAILABLE" || metric.values === null) {
    return { failure: SALES_METRIC_REASON.sourceUnavailable };
  }
  if (metric.values.kind !== want.kind) return { failure: SALES_METRIC_REASON.shapeUnexpected };
  return { metric, partial: sourcePartial(metric, want.definitionalExclusions) };
}

/** Window + read + interpretation in one call. A window with nothing readable is a closed failure. */
export async function readSalesFigure(
  caller: MetricCaller,
  tenantId: string | null,
  metricKey: string,
  period: SnapshotPeriod,
  now: Date,
  expect: IssuerValueKind | IssuerMetricExpectation,
  clock: () => number = Date.now,
): Promise<SalesMetricResult & { readonly window: SalesMetricWindow | null }> {
  const window = salesMetricWindow(period, now);
  if (window === null) return { failure: SALES_METRIC_REASON.windowUnreadable, window };
  const outcome = await readSalesMetric(caller, tenantId, metricKey, window, clock);
  return { ...interpretSalesMetric(outcome, expect), window };
}

// ── Values ───────────────────────────────────────────────────────────────────────────────────────────

export type CurrencyFigure = { readonly currency: string; readonly amountMinor: number };

export type CurrencyFigures = {
  readonly figures: readonly CurrencyFigure[];
  /** Entries left out: an unrecognisable currency code or an amount that is not an exact integer. */
  readonly dropped: number;
};

const CURRENCY_CODE = /^[a-z]{3}$/i;
const MINOR_UNITS = /^-?\d+$/;

/**
 * One figure per currency the producer returned, code upper-cased. An entry is dropped (and counted)
 * when its code is not three letters or its amount is not a whole number JavaScript holds exactly.
 * Never sums: a repeated currency (the producer groups by currency, so this should not happen) drops
 * the repeat rather than adding it.
 */
export function currencyFigures(metric: SalesMetric): CurrencyFigures {
  const values = metric.values;
  if (values === null || values.kind !== "currency_totals") return { figures: [], dropped: 0 };
  const figures: CurrencyFigure[] = [];
  let dropped = 0;
  for (const entry of values.by_currency) {
    const code = typeof entry.currency === "string" ? entry.currency : "";
    const raw = typeof entry.amount_minor === "string" ? entry.amount_minor : "";
    const amount = MINOR_UNITS.test(raw) ? Number(raw) : Number.NaN;
    const currency = code.toUpperCase();
    if (!CURRENCY_CODE.test(code) || !Number.isSafeInteger(amount) || figures.some((f) => f.currency === currency)) {
      dropped += 1;
      continue;
    }
    figures.push({ currency, amountMinor: amount === 0 ? 0 : amount }); // never a negative zero
  }
  return { figures, dropped };
}

/** The producer's count, or null when the value is not a count. */
export function countFigure(metric: SalesMetric): number | null {
  const values = metric.values;
  return values !== null && values.kind === "count" && Number.isSafeInteger(values.count) ? values.count : null;
}

/**
 * The amount for one currency in one window, when it is KNOWN: present in the figures, or absent from a
 * window whose read was complete with nothing dropped (absence there is a real zero). Undefined
 * otherwise. A partial window knows nothing for comparison purposes.
 */
export function knownAmount(
  window: { readonly figures: CurrencyFigures; readonly partial: boolean },
  currency: string,
): number | undefined {
  if (window.partial) return undefined;
  const hit = window.figures.figures.find((f) => f.currency === currency);
  if (hit) return hit.amountMinor;
  return window.figures.dropped === 0 ? 0 : undefined;
}

export type ChangeDirection = "up" | "down" | "flat";

export function changeDirection(previous: number, current: number): ChangeDirection {
  return current > previous ? "up" : current < previous ? "down" : "flat";
}

/** "Recorded receipts in USD went up from USD 10.00 in <prev> to USD 12.50 in <period>." */
export function currencyChangeSummary(
  noun: string,
  currency: string,
  previous: number,
  current: number,
  previousLabel: string,
  periodLabel: string,
): string {
  const was = formatCurrencyMinor(previous, currency);
  const now = formatCurrencyMinor(current, currency);
  const direction = changeDirection(previous, current);
  if (direction === "flat") return `${noun} in ${currency} held at ${now} in ${periodLabel}, the same as in ${previousLabel}.`;
  return `${noun} in ${currency} went ${direction} from ${was} in ${previousLabel} to ${now} in ${periodLabel}.`;
}

/** "New opportunities went up from 3 in <prev> to 5 in <period>." */
export function countChangeSummary(
  noun: string,
  previous: number,
  current: number,
  previousLabel: string,
  periodLabel: string,
): string {
  const direction = changeDirection(previous, current);
  if (direction === "flat") return `${noun} held at ${current} in ${periodLabel}, the same as in ${previousLabel}.`;
  return `${noun} went ${direction} from ${previous} in ${previousLabel} to ${current} in ${periodLabel}.`;
}

// ── Draft → DomainSnapshot ───────────────────────────────────────────────────────────────────────────

type Change = DomainSnapshot["changes"][number];
type Risk = DomainSnapshot["risks"][number];
type Source = DomainSnapshot["sources"][number];

/**
 * A risk while drafting. `figure_key` names the headline figure it is about, so trimming for length
 * never leaves a risk beside a figure that was cut. It is stripped before the snapshot is returned.
 */
export type SalesDraftRisk = Risk & { readonly figure_key?: string };

/**
 * What one adapter accumulates while it reads, before it becomes a DomainSnapshot. `headlineReads`
 * counts headline reads that produced a usable metric; `failures` keeps every failure in read order;
 * `nouns` maps each headline key to the plain-words group it belongs to, for the trimming note.
 */
export type SalesSnapshotDraft = {
  headline: SnapshotMetric[];
  changes: Change[];
  risks: SalesDraftRisk[];
  notes: string[];
  sources: Source[];
  asOf: number[];
  headlineReads: number;
  failures: { readonly reason: SalesMetricReason; readonly headline: boolean }[];
  nouns: Record<string, string>;
};

export function emptySalesDraft(): SalesSnapshotDraft {
  return {
    headline: [], changes: [], risks: [], notes: [], sources: [], asOf: [], headlineReads: 0, failures: [], nouns: {},
  };
}

/** Add one headline figure and remember which group it belongs to. */
export function pushSalesHeadline(draft: SalesSnapshotDraft, metric: SnapshotMetric, noun: string): void {
  draft.headline.push(metric);
  draft.nouns[metric.key] = noun;
}

/**
 * Record where a usable metric came from. The evidence reference is deliberately NOT used. `system`
 * names the producing department (default `sales`, the F2a adapters).
 */
export function noteSalesSource(
  draft: SalesSnapshotDraft,
  adapterId: string,
  metric: SalesMetric,
  system = "sales",
): void {
  const reference = `${metric.metric_key}@${metric.source_revision_ref}`;
  if (!draft.sources.some((s) => s.reference === reference)) {
    draft.sources.push({ system, adapter: adapterId, reference });
  }
  const asOf = Date.parse(metric.as_of);
  if (Number.isFinite(asOf)) draft.asOf.push(asOf);
}

/** Plain note text for one figure; kept short so several fit the 300-character note. */
export const SALES_NOTE = {
  failed: (noun: string) => `${noun} could not be read`,
  // The Sales producer marks a figure PARTIAL for more than one reason (some records excluded, zero-valued
  // deals whose values may be unrecorded, test allocations touching a balance), so the note states only
  // what is known: the source itself calls the figure incomplete.
  partial: (noun: string) => `${noun}: the source marks this figure as incomplete`,
  dropped: (noun: string, n: number) =>
    `${noun}: ${n === 1 ? "one amount" : `${n} amounts`} could not be shown exactly and ${n === 1 ? "was" : "were"} left out`,
  noComparison: (noun: string) => `${noun}: no comparison with the previous period`,
  trimmed: (what: string, n: number) => `${n} more ${what} left out for length`,
  trimmedFigures: (n: number, groups: readonly string[]) =>
    `${n} more ${n === 1 ? "figure was" : "figures were"} left out for length${groups.length > 0 ? ` (${groups.join(", ")})` : ""}`,
  trimmedComparisons: (n: number) =>
    `${n === 1 ? "one comparison" : `${n} comparisons`} for ${n === 1 ? "a figure" : "figures"} left out ${n === 1 ? "was" : "were"} left out too`,
} as const;

function boundedNote(parts: readonly string[]): string {
  const joined = parts.join("; ");
  const text = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
  return text.length <= SNAPSHOT_BOUNDS.note ? text : `${text.slice(0, SNAPSHOT_BOUNDS.note - 1)}…`;
}

/**
 * Turn a draft into the adapter's result. If NO headline read produced a usable metric, the result is
 * the first failure in read order: a refusal is `unavailable` (not authorised here), anything else is
 * `degraded` (asked, and the read did not complete). Otherwise it is `available`, partial with a note
 * whenever anything was missing, dropped or trimmed to fit the validator's bounds.
 */
export function finishSalesSnapshot(
  draft: SalesSnapshotDraft,
  meta: { readonly domain: SnapshotDomain; readonly owner: string; readonly period: SnapshotPeriod; readonly now: Date },
): ContextSourceResult<DomainSnapshot> {
  if (draft.headlineReads === 0 || draft.sources.length === 0) {
    const first = draft.failures.find((f) => f.headline) ?? draft.failures[0];
    const reason = first?.reason ?? SALES_METRIC_REASON.notVerified;
    if (reason === SALES_METRIC_REASON.refused) {
      const result = contextUnavailable(reason);
      return { status: result.status, reason: result.reason, data: null };
    }
    return contextDegraded<DomainSnapshot>(reason);
  }
  const notes = [...draft.notes];
  const fit = <T>(items: readonly T[], max: number, what: string): T[] => {
    if (items.length <= max) return [...items];
    notes.push(SALES_NOTE.trimmed(what, items.length - max));
    return items.slice(0, max);
  };
  const keptRisks = fit(draft.risks, SNAPSHOT_BOUNDS.risks, "risks were");
  const headline = trimHeadline(draft, keptRisks, notes);
  // A comparison is about one figure; if that figure was cut for length, the comparison goes with it.
  const shown = new Set(headline.map((m) => m.key));
  const orphaned = draft.changes.filter((c) => c.metric_key !== undefined && !shown.has(c.metric_key)).length;
  if (orphaned > 0) notes.push(SALES_NOTE.trimmedComparisons(orphaned));
  const changes = fit(
    draft.changes.filter((c) => c.metric_key === undefined || shown.has(c.metric_key)),
    SNAPSHOT_BOUNDS.changes,
    "changes were",
  );
  const risks: Risk[] = keptRisks.map((r) => ({
    kind: r.kind,
    summary: r.summary,
    severity: r.severity,
    ...(r.reference !== undefined ? { reference: r.reference } : {}),
  }));
  const sources = draft.sources.slice(0, SNAPSHOT_BOUNDS.sources);

  // The read happened at `now`; a producer stamp is used only when it is not after `now`.
  const nowMs = meta.now.getTime();
  const stamps = draft.asOf.filter((ms) => ms <= nowMs);
  const as_of = new Date(stamps.length > 0 ? Math.max(...stamps) : nowMs).toISOString();

  const snapshot: DomainSnapshot = {
    domain: meta.domain,
    owner: meta.owner,
    period: meta.period,
    as_of,
    freshness: "live_read",
    coverage: notes.length > 0 ? "partial" : "full",
    ...(notes.length > 0 ? { coverage_note: boundedNote(notes) } : {}),
    headline,
    changes,
    outcomes: [],
    risks,
    upcoming: [],
    goal_links: [],
    sources,
  };
  return contextAvailable(snapshot);
}

/**
 * Fit the headline to its bound. Figures a kept risk is about are never cut (risks are bounded below
 * the headline, so that always fits); the rest are cut from the end, and the note names their groups.
 */
function trimHeadline(
  draft: SalesSnapshotDraft,
  keptRisks: readonly SalesDraftRisk[],
  notes: string[],
): SnapshotMetric[] {
  const all = draft.headline;
  let excess = all.length - SNAPSHOT_BOUNDS.headline;
  if (excess <= 0) return [...all];
  const pinned = new Set(keptRisks.map((r) => r.figure_key).filter((k): k is string => k !== undefined));
  const cut = new Set<number>();
  for (let i = all.length - 1; i >= 0 && excess > 0; i--) {
    if (pinned.has(all[i].key)) continue;
    cut.add(i);
    excess -= 1;
  }
  // Unreachable while risks are bounded below the headline; kept so the result is always in bounds.
  for (let i = all.length - 1; i >= 0 && excess > 0; i--) {
    if (cut.has(i)) continue;
    cut.add(i);
    excess -= 1;
  }
  const groups: string[] = [];
  for (const i of [...cut].sort((a, b) => a - b)) {
    const noun = draft.nouns[all[i].key];
    if (noun !== undefined && !groups.includes(noun)) groups.push(noun);
  }
  notes.push(SALES_NOTE.trimmedFigures(cut.size, groups));
  return all.filter((_, i) => !cut.has(i));
}

/** The metric key suffix for one currency: `<base>_usd`. Keys are lower case by contract. */
export function currencyKey(base: string, currency: string): string {
  return `${base}_${currency.toLowerCase()}`;
}

/**
 * Add one currency metric's figures to the headline. A complete read with no amounts at all says so
 * as a real zero count (`<base>_records`, "none recorded"); a partial or failed read never does.
 * Returns the figures for later comparison or risk checks.
 */
export function addCurrencyHeadline(
  draft: SalesSnapshotDraft,
  args: {
    readonly base: string;
    readonly label: string;
    readonly noneLabel: string;
    readonly noun: string;
    readonly basis: SnapshotMetric["basis"];
    readonly metric: SalesMetric;
    readonly partial: boolean;
    readonly windowNote?: string;
  },
): CurrencyFigures {
  const figures = currencyFigures(args.metric);
  for (const f of figures.figures) {
    pushSalesHeadline(draft, {
      key: currencyKey(args.base, f.currency),
      label: args.label,
      value: f.amountMinor,
      unit: "currency_minor",
      currency: f.currency,
      basis: args.basis,
      ...(args.windowNote !== undefined ? { window_note: args.windowNote } : {}),
    }, args.noun);
  }
  if (figures.figures.length === 0 && figures.dropped === 0 && !args.partial) {
    pushSalesHeadline(draft, {
      key: `${args.base}_records`,
      label: args.noneLabel,
      value: 0,
      unit: "count",
      basis: args.basis,
      ...(args.windowNote !== undefined ? { window_note: args.windowNote } : {}),
    }, args.noun);
  }
  if (args.partial) draft.notes.push(SALES_NOTE.partial(args.noun));
  if (figures.dropped > 0) draft.notes.push(SALES_NOTE.dropped(args.noun, figures.dropped));
  return figures;
}
