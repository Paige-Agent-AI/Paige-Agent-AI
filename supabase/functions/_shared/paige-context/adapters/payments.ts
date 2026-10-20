/**
 * `payments` Domain Snapshot adapter (Operating Fabric F2a) — a projection over the Sales department's
 * governed measurements. Owner: `sales` (the producing department owns these numbers; this adapter only
 * shapes them for the snapshot).
 *
 * What it reads, one at a time, through `readBusinessMetric` only:
 *   a) recorded receipts in the period          → payments.cash_recorded_received_<cur>  (in period)
 *   b) recorded receipts in the previous period → changes[] only, never a headline
 *   c) outstanding receivables now              → payments.receivables_outstanding_<cur> (right now)
 *   d) overdue receivables now                  → payments.receivables_overdue_<cur>     (right now)
 *                                                  + an `act` risk for any currency above zero
 *
 * Recorded receipts are business records (manual, imported or provider-verified), not a bank-verified
 * settlement; the label says so. Receivables are current balances: no historical balance exists, so
 * they never carry a change. Currencies are never added together.
 */

import type { MetricCaller } from "../../analytics-metrics/read.ts";
import { contextDegraded, type ContextSourceResult } from "../mod.ts";
import { formatCurrencyMinor, previousPeriod, type DomainSnapshot, type DomainSnapshotAdapter } from "../snapshot.ts";
import {
  addCurrencyHeadline,
  changeDirection,
  currencyChangeSummary,
  currencyFigures,
  currencyKey,
  emptySalesDraft,
  finishSalesSnapshot,
  knownAmount,
  noteSalesSource,
  readSalesFigure,
  salesReportingPeriod,
  SALES_METRIC_REASON,
  SALES_NOTE,
  type CurrencyFigures,
  type SalesSnapshotDraft,
} from "./sales-metric.ts";

export const PAYMENTS_ADAPTER_ID = "payments.sales_metrics.v1";

export const PAYMENTS_SALES_METRICS = {
  cashReceived: "sales.cash.recorded_received",
  outstanding: "sales.receivables.outstanding_current",
  overdue: "sales.receivables.overdue_current",
} as const;

const CASH = {
  base: "payments.cash_recorded_received",
  label: "Recorded receipts collected (business records, not bank-verified settlement)",
  noneLabel: "Recorded receipts collected (none recorded in any currency)",
  noun: "recorded receipts",
} as const;
const OUTSTANDING = {
  base: "payments.receivables_outstanding",
  label: "Outstanding receivables (unpaid balance owed now)",
  noneLabel: "Outstanding receivables (nothing owed in any currency)",
  noun: "outstanding receivables",
} as const;
const OVERDUE = {
  base: "payments.receivables_overdue",
  label: "Overdue receivables (unpaid and past the due date)",
  noneLabel: "Overdue receivables (nothing overdue in any currency)",
  noun: "overdue receivables",
} as const;

type Window = { readonly figures: CurrencyFigures; readonly partial: boolean };

/**
 * One change per currency whose amount is KNOWN in both windows (`knownAmount`). A partial window, or
 * a currency missing from a window that dropped an entry, produces no change and a note instead.
 */
function addCashChanges(
  draft: SalesSnapshotDraft,
  current: Window,
  previous: Window,
  labels: { readonly period: string; readonly previous: string },
): void {
  const currencies = [...new Set([...current.figures.figures, ...previous.figures.figures].map((f) => f.currency))].sort();
  let skipped = current.partial || previous.partial;
  const keys = new Set(draft.headline.map((m) => m.key));
  for (const currency of currencies) {
    const now = knownAmount(current, currency);
    const before = knownAmount(previous, currency);
    if (now === undefined || before === undefined) {
      skipped = true;
      continue;
    }
    const key = currencyKey(CASH.base, currency);
    draft.changes.push({
      summary: currencyChangeSummary("Recorded receipts", currency, before, now, labels.previous, labels.period),
      ...(keys.has(key) ? { metric_key: key } : {}),
      direction: changeDirection(before, now),
    });
  }
  if (skipped) draft.notes.push(SALES_NOTE.noComparison(CASH.noun));
}

/**
 * The payments adapter. `caller` must be the authenticated user's client (or a wrapper around it): every
 * read re-resolves the workspace and role on the server. `scope.tenantId` must equal the identity the
 * composer passes; a mismatch is reported, never read through. Reads run one after another — the issuer
 * revokes a caller's previous reference for the same metric and range key — and the abort signal is
 * checked before each.
 */
export function createPaymentsSnapshotAdapter(
  caller: MetricCaller,
  scope: { readonly tenantId: string | null },
  clock: () => number = Date.now,
): DomainSnapshotAdapter {
  return {
    domain: "payments",
    owner: "sales",
    async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
      if (ctx.identity.tenantId !== scope.tenantId) return contextDegraded(SALES_METRIC_REASON.scopeMismatch);
      const aborted = () => ctx.signal?.aborted === true;
      const tenantId = scope.tenantId;
      const draft = emptySalesDraft();
      const reporting = salesReportingPeriod(ctx.period, ctx.now);
      if (reporting?.coverageNote) draft.notes.push(reporting.coverageNote);
      if (!reporting) draft.notes.push("No readable completed UTC-day Sales activity window for this period.");

      // a) recorded receipts in the period
      if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
      const cash = reporting ? await readSalesFigure(
        caller, tenantId, PAYMENTS_SALES_METRICS.cashReceived, reporting.period, ctx.now, "currency_totals", clock,
      ) : { failure: SALES_METRIC_REASON.windowUnreadable, window: null };
      let current: Window | null = null;
      if ("metric" in cash) {
        draft.headlineReads += 1;
        noteSalesSource(draft, PAYMENTS_ADAPTER_ID, cash.metric);
        const figures = addCurrencyHeadline(draft, {
          ...CASH,
          basis: "in_period",
          metric: cash.metric,
          partial: cash.partial,
          windowNote: reporting?.windowNote,
        });
        current = { figures, partial: cash.partial };
      } else {
        draft.failures.push({ reason: cash.failure, headline: true });
        draft.notes.push(SALES_NOTE.failed(CASH.noun));
      }

      // b) the same figure for the window just before — only worth reading when there is something to compare
      if (current !== null && reporting !== null) {
        if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
        const prior = previousPeriod(reporting.period);
        const before = await readSalesFigure(
          caller, tenantId, PAYMENTS_SALES_METRICS.cashReceived, prior, ctx.now, "currency_totals", clock,
        );
        if ("metric" in before) {
          noteSalesSource(draft, PAYMENTS_ADAPTER_ID, before.metric);
          addCashChanges(draft, current, { figures: currencyFigures(before.metric), partial: before.partial }, {
            period: ctx.period.label,
            previous: prior.label,
          });
        } else {
          draft.failures.push({ reason: before.failure, headline: false });
          draft.notes.push(SALES_NOTE.failed("the previous period's recorded receipts"));
        }
      }

      // c) outstanding receivables now
      if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
      const outstanding = await readSalesFigure(
        caller, tenantId, PAYMENTS_SALES_METRICS.outstanding, ctx.period, ctx.now, "currency_totals", clock,
      );
      if ("metric" in outstanding) {
        draft.headlineReads += 1;
        noteSalesSource(draft, PAYMENTS_ADAPTER_ID, outstanding.metric);
        addCurrencyHeadline(draft, { ...OUTSTANDING, basis: "point_in_time", metric: outstanding.metric, partial: outstanding.partial });
      } else {
        draft.failures.push({ reason: outstanding.failure, headline: true });
        draft.notes.push(SALES_NOTE.failed(OUTSTANDING.noun));
      }

      // d) overdue receivables now, and what needs the owner's attention
      if (aborted()) return contextDegraded(SALES_METRIC_REASON.aborted);
      const overdue = await readSalesFigure(
        caller, tenantId, PAYMENTS_SALES_METRICS.overdue, ctx.period, ctx.now, "currency_totals", clock,
      );
      if ("metric" in overdue) {
        draft.headlineReads += 1;
        noteSalesSource(draft, PAYMENTS_ADAPTER_ID, overdue.metric);
        const figures = addCurrencyHeadline(draft, {
          ...OVERDUE,
          basis: "point_in_time",
          metric: overdue.metric,
          partial: overdue.partial,
        });
        for (const f of figures.figures) {
          if (f.amountMinor <= 0) continue;
          draft.risks.push({
            kind: "receivables_overdue",
            summary: `${formatCurrencyMinor(f.amountMinor, f.currency)} is overdue: owed by clients and past its due date.`,
            severity: "act",
            figure_key: currencyKey(OVERDUE.base, f.currency),
          });
        }
      } else {
        draft.failures.push({ reason: overdue.failure, headline: true });
        draft.notes.push(SALES_NOTE.failed(OVERDUE.noun));
      }

      return finishSalesSnapshot(draft, { domain: "payments", owner: "sales", period: ctx.period, now: ctx.now });
    },
  };
}
