/**
 * Issuer metric helpers — the department-neutral names for the plumbing every snapshot adapter over
 * the INT-340 evidence issuer shares (Operating Fabric F2b).
 *
 * ONE HOME, NOT A FORK. F2a built this plumbing for the Sales adapters in `./sales-metric.ts`; F2b
 * generalised it IN PLACE there (more value kinds, an expected owning department, a per-key rule for
 * what PARTIAL means) so `payments` and `sales_pipeline` read exactly as before. This module re-exports
 * the shared pieces under neutral names and adds the few helpers non-Sales adapters need: a closed
 * label map for distribution buckets, the systems-check event reader, and plain time words. Every rule
 * in `./sales-metric.ts` holds here too: a failure is never a zero, evidence references never enter a
 * snapshot, reads are sequential.
 *
 * Pure apart from the injected caller: no Deno globals, no hidden clock. Deno and vitest import it.
 */

import type { DiagnosticEvent } from "../../analytics-metrics/metric-contract.ts";
import type { SalesMetric } from "./sales-metric.ts";

export {
  emptySalesDraft as emptyIssuerDraft,
  finishSalesSnapshot as finishIssuerSnapshot,
  interpretSalesMetric as interpretIssuerMetric,
  noteSalesSource as noteIssuerSource,
  pushSalesHeadline as pushIssuerHeadline,
  readSalesFigure as readIssuerFigure,
  SALES_METRIC_REASON as ISSUER_METRIC_REASON,
  SALES_NOTE as ISSUER_NOTE,
  salesMetricWindow as issuerMetricWindow,
  countFigure,
} from "./sales-metric.ts";
export type {
  IssuerMetricExpectation,
  IssuerValueKind,
  SalesDraftRisk as IssuerDraftRisk,
  SalesMetric as IssuerMetric,
  SalesMetricReason as IssuerMetricReason,
  SalesMetricResult as IssuerMetricResult,
  SalesSnapshotDraft as IssuerSnapshotDraft,
} from "./sales-metric.ts";

/**
 * The ONE exclusion reason the settings producer writes for every non-diagnostic key
 * (`supabase/migrations/20270601000005_int340_settings_metric_producers.sql`, the `exclusions` build).
 * It names definitional exclusions (a passing check, a paused client) together with a version after
 * the read instant, so it is treated as describing the figure's definition, not missing data. Two
 * honest limits on that reading, both accepted for F2b:
 *   - A NARROW RACE AT ISSUE TIME. The read instant is the issuer's `clock_timestamp()` at entry; the
 *     producer's SELECT runs a moment later under READ COMMITTED, so a row committed in that gap with a
 *     version after the instant is excluded silently under this text (e.g. one active client
 *     undercounted). The window is sub-millisecond in practice; it is not zero.
 *   - For `operations.unresolved_findings_current` the same text also covers checks that were deferred
 *     (skip) or could not run (error), not only passing checks. The figure — checks that ran and failed
 *     — is still correct by definition; the deferred and could-not-run checks are surfaced by the
 *     exceptions read (error findings as risks, deferred ones in its "not in the counts" note).
 * The real fix is a producer-emitted "PARTIAL by definition only" flag (a recorded F2b hand-off). Until
 * then, any OTHER reason — or a change to this text upstream — makes the figure partial (fail closed).
 */
export const SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION =
  "Out-of-scope context, ineligible current state, version after as_of, or unknown supported quantity.";

// ── Distribution buckets through a closed map ────────────────────────────────────────────────────────

/**
 * Producer keys → the adapter's own bucket names. A key mapped to `null` is known and deliberately not
 * shown (it is counted elsewhere); a key not in the map at all is unknown and is dropped and counted.
 * Producer labels are raw enum keys, so they are NEVER passed through to the snapshot.
 */
export type ClosedBucketMap = Readonly<Record<string, string | null>>;

export type ClosedBuckets = {
  /** Records per bucket, for buckets that received at least one known key. */
  readonly counts: Readonly<Record<string, number>>;
  /** Records under known-but-not-shown keys. */
  readonly hidden: number;
  /** Records under keys the map does not know; left out, never shown as text. */
  readonly dropped: number;
  /** Whether the distribution had no items at all. */
  readonly empty: boolean;
};

export function closedBuckets(metric: SalesMetric, map: ClosedBucketMap): ClosedBuckets {
  const values = metric.values;
  const counts: Record<string, number> = {};
  let hidden = 0;
  let dropped = 0;
  if (values === null || values.kind !== "distribution") return { counts, hidden, dropped, empty: true };
  for (const item of values.items) {
    const n = Number.isSafeInteger(item.count) && item.count >= 0 ? item.count : 0;
    if (!Object.prototype.hasOwnProperty.call(map, item.key)) {
      dropped += n;
      continue;
    }
    const bucket = map[item.key];
    if (bucket === null) {
      hidden += n;
      continue;
    }
    counts[bucket] = (counts[bucket] ?? 0) + n;
  }
  return { counts, hidden, dropped, empty: values.items.length === 0 };
}

/** "3 records in a category Paige does not recognise were left out" — never the category itself. */
export function droppedBucketNote(noun: string, n: number): string {
  return `${noun}: ${n === 1 ? "one record" : `${n} records`} in a category Paige does not recognise ${n === 1 ? "was" : "were"} left out`;
}

// ── Diagnostic events ────────────────────────────────────────────────────────────────────────────────

/** The systems-check findings the producer listed (the contract already checked their shape). */
export function systemsCheckEvents(metric: SalesMetric): DiagnosticEvent[] {
  const values = metric.values;
  if (values === null || values.kind !== "diagnostic_events") return [];
  return values.items.filter((e) => e.source === "systems_check");
}

// ── Time in plain words ──────────────────────────────────────────────────────────────────────────────

/** "2026-10-11 09:00 UTC", or null for an unreadable instant. Deterministic, locale-free. */
export function plainUtcMinute(iso: string | null | undefined): string | null {
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} UTC`;
}
