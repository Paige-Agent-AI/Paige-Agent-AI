/**
 * `sales_pipeline` Domain Snapshot adapter (Operating Fabric F2a) — a projection over the Sales
 * department's governed measurements. Owner: `sales`.
 *
 * What it reads, one at a time, through `readBusinessMetric` only:
 *   a) opportunities created in the period          → sales_pipeline.opportunities_created (in period)
 *   b) opportunities created in the previous period → changes[] only, never a headline
 *   c) open opportunities now                       → sales_pipeline.opportunities_open    (right now)
 *   d) open pipeline value now                      → sales_pipeline.open_value_<cur>      (right now)
 *
 * Won and lost are NOT read: their producer counts by close DATE and refuses any bound that is not a
 * UTC midnight, which a rolling "this week" window is not. Saying nothing about them is honest; a
 * rounded window would silently answer a different question. Open counts and values are current state
 * and never carry a change. Currencies are never added together.
 */

import type { MetricCaller } from "../../analytics-metrics/read.ts";
import { contextDegraded, type ContextSourceResult } from "../mod.ts";
import { previousPeriod, type DomainSnapshot, type DomainSnapshotAdapter } from "../snapshot.ts";
import {
  addCurrencyHeadline,
  changeDirection,
  countChangeSummary,
  countFigure,
  emptySalesDraft,
  finishSalesSnapshot,
  noteSalesSource,
  pushSalesHeadline,
  readSalesFigure,
  salesReportingPeriod,
  SALES_METRIC_REASON,
  SALES_NOTE,
} from "./sales-metric.ts";

export const SALES_PIPELINE_ADAPTER_ID = "sales_pipeline.sales_metrics.v1";

export const SALES_PIPELINE_SALES_METRICS = {
  created: "sales.opportunities.created",
  open: "sales.opportunities.open_current",
  openValue: "sales.pipeline.open_value",
} as const;

const CREATED = { key: "sales_pipeline.opportunities_created", label: "New opportunities created", noun: "new opportunities" } as const;
const OPEN = { key: "sales_pipeline.opportunities_open", label: "Open opportunities", noun: "open opportunities" } as const;
const OPEN_VALUE = {
  base: "sales_pipeline.open_value",
  label: "Open pipeline value (deal values still in play)",
  noneLabel: "Open pipeline value (no open deal value in any currency)",
  noun: "open pipeline value",
} as const;

/**
 * The sales pipeline adapter. Same rules as the payments adapter: the caller is the authenticated
 * user's client, the scope must match the composer's identity, reads are sequential, and the abort
 * signal is checked before each.
 */
export function createSalesPipelineSnapshotAdapter(
  caller: MetricCaller,
  scope: { readonly tenantId: string | null },
  clock: () => number = Date.now,
): DomainSnapshotAdapter {
  return {
    domain: "sales_pipeline",
    owner: "sales",
    async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
      if (ctx.identity.tenantId !== scope.tenantId) return contextDegraded(SALES_METRIC_REASON.scopeMismatch);
      const aborted = () => ctx.signal?.aborted === true;
      const tenantId = scope.tenantId;
      const draft = emptySalesDraft();
      const reporting = salesReportingPeriod(ctx.period, ctx.now);
      if (reporting?.coverageNote) draft.notes.push(reporting.coverageNote);
      if (!reporting) draft.notes.push("No readable completed UTC-day Sales activity window for this period.");

      // a) opportunities created in the period
      if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
      const created = reporting ? await readSalesFigure(
        caller, tenantId, SALES_PIPELINE_SALES_METRICS.created, reporting.period, ctx.now, "count", clock,
      ) : { failure: SALES_METRIC_REASON.windowUnreadable, window: null };
      let current: { readonly count: number; readonly partial: boolean } | null = null;
      if ("metric" in created) {
        const count = countFigure(created.metric);
        if (count === null) {
          draft.failures.push({ reason: SALES_METRIC_REASON.shapeUnexpected, headline: true });
          draft.notes.push(SALES_NOTE.failed(CREATED.noun));
        } else {
          draft.headlineReads += 1;
          noteSalesSource(draft, SALES_PIPELINE_ADAPTER_ID, created.metric);
          const windowNote = reporting?.windowNote;
          pushSalesHeadline(draft, {
            key: CREATED.key,
            label: CREATED.label,
            value: count,
            unit: "count",
            basis: "in_period",
            ...(windowNote !== undefined ? { window_note: windowNote } : {}),
          }, CREATED.noun);
          if (created.partial) draft.notes.push(SALES_NOTE.partial(CREATED.noun));
          current = { count, partial: created.partial };
        }
      } else {
        draft.failures.push({ reason: created.failure, headline: true });
        draft.notes.push(SALES_NOTE.failed(CREATED.noun));
      }

      // b) the window just before, for a change — only when there is a current count to compare
      if (current !== null && reporting !== null) {
        if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
        const prior = previousPeriod(reporting.period);
        const before = await readSalesFigure(
          caller, tenantId, SALES_PIPELINE_SALES_METRICS.created, prior, ctx.now, "count", clock,
        );
        const previousCount = "metric" in before ? countFigure(before.metric) : null;
        if ("metric" in before && previousCount !== null) {
          noteSalesSource(draft, SALES_PIPELINE_ADAPTER_ID, before.metric);
          if (current.partial || before.partial) {
            draft.notes.push(SALES_NOTE.noComparison(CREATED.noun));
          } else {
            draft.changes.push({
              summary: countChangeSummary("New opportunities", previousCount, current.count, prior.label, ctx.period.label),
              metric_key: CREATED.key,
              direction: changeDirection(previousCount, current.count),
            });
          }
        } else {
          draft.failures.push({ reason: "failure" in before ? before.failure : SALES_METRIC_REASON.shapeUnexpected, headline: false });
          draft.notes.push(SALES_NOTE.failed("the previous period's new opportunities"));
        }
      }

      // c) open opportunities now
      if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
      const open = await readSalesFigure(
        caller, tenantId, SALES_PIPELINE_SALES_METRICS.open, ctx.period, ctx.now, "count", clock,
      );
      const openCount = "metric" in open ? countFigure(open.metric) : null;
      if ("metric" in open && openCount !== null) {
        draft.headlineReads += 1;
        noteSalesSource(draft, SALES_PIPELINE_ADAPTER_ID, open.metric);
        pushSalesHeadline(draft, { key: OPEN.key, label: OPEN.label, value: openCount, unit: "count", basis: "point_in_time" }, OPEN.noun);
        if (open.partial) draft.notes.push(SALES_NOTE.partial(OPEN.noun));
      } else {
        draft.failures.push({ reason: "failure" in open ? open.failure : SALES_METRIC_REASON.shapeUnexpected, headline: true });
        draft.notes.push(SALES_NOTE.failed(OPEN.noun));
      }

      // d) open pipeline value now, per currency
      if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
      const value = await readSalesFigure(
        caller, tenantId, SALES_PIPELINE_SALES_METRICS.openValue, ctx.period, ctx.now, "currency_totals", clock,
      );
      if ("metric" in value) {
        draft.headlineReads += 1;
        noteSalesSource(draft, SALES_PIPELINE_ADAPTER_ID, value.metric);
        addCurrencyHeadline(draft, { ...OPEN_VALUE, basis: "point_in_time", metric: value.metric, partial: value.partial });
      } else {
        draft.failures.push({ reason: value.failure, headline: true });
        draft.notes.push(SALES_NOTE.failed(OPEN_VALUE.noun));
      }

      return finishSalesSnapshot(draft, { domain: "sales_pipeline", owner: "sales", period: ctx.period, now: ctx.now });
    },
  };
}
