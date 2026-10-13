// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  composeBusinessReview,
  type BusinessReviewWho,
} from '../../supabase/functions/_shared/paige-context/business-review.ts';
import {
  createPaymentsSnapshotAdapter,
} from '../../supabase/functions/_shared/paige-context/adapters/payments.ts';
import {
  createSalesPipelineSnapshotAdapter,
} from '../../supabase/functions/_shared/paige-context/adapters/sales-pipeline.ts';
import {
  currencyFigures,
  emptySalesDraft,
  finishSalesSnapshot,
  pushSalesHeadline,
  SALES_WINDOW_CLOCK_MARGIN_MS,
  salesMetricWindow,
  salesReportingPeriod,
  type SalesMetric,
} from '../../supabase/functions/_shared/paige-context/adapters/sales-metric.ts';
import {
  previousPeriod,
  resolveSnapshotPeriod,
  validateDomainSnapshot,
  type DomainSnapshot,
  type SnapshotPeriod,
} from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import type { ContextIdentity, ContextSourceResult } from '../../supabase/functions/_shared/paige-context/mod.ts';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────

const TENANT = 'a3400000-0000-4000-8000-0000000000f2';
const NOW = new Date('2026-10-12T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;

const WHO: BusinessReviewWho = { actorId: 'actor-f2a', tenantId: TENANT, role: 'owner', accountShape: 'solo' };

function period(key = 'last_7_days', extra: { customStart?: string; customEnd?: string } = {}): SnapshotPeriod {
  const r = resolveSnapshotPeriod({ key, now: NOW, timezone: 'UTC', ...extra });
  if ('reason' in r) throw new Error(`fixture period refused: ${r.reason}`);
  return r.period;
}

const IDENTITY: ContextIdentity = {
  actorId: WHO.actorId,
  tenantId: TENANT,
  workspaceId: TENANT,
  role: 'owner',
  actAsClientId: null,
  accountShape: 'solo',
  scopeEpoch: TENANT,
};

type Values =
  | { kind: 'count'; count: number }
  | { kind: 'currency_totals'; by_currency: { currency: string; amount_minor: string; record_count: number }[]; breakdown: [] };

/** What the fake issuer answers for one read. `error` = the RPC's Postgres error code. */
type Script = { values?: Values | null; truth?: 'LIVE' | 'PARTIAL' | 'UNAVAILABLE'; error?: string };
type IssueArgs = { p_metric_key: string; p_range_key: string; p_range_start: string; p_range_end: string };

function money(...rows: [string, string][]): Values {
  return { kind: 'currency_totals', by_currency: rows.map(([currency, amount_minor]) => ({ currency, amount_minor, record_count: 1 })), breakdown: [] };
}
const count = (n: number): Values => ({ kind: 'count', count: n });

/** The previous window ends at least a day before NOW in every fixture. */
const isPrevious = (a: IssueArgs) => Date.parse(a.p_range_end) < NOW_MS - DAY / 2;

function defaultScript(a: IssueArgs): Script {
  return { values: a.p_metric_key.startsWith('sales.opportunities.') ? count(0) : money() };
}

/**
 * A fake authenticated client. The issuer and resolver answer payloads that pass `parseMetricResult`
 * (the shape `src/lib/analytics/metric-read.test.ts` uses, with Sales ownership). Every call is
 * recorded in order; issuer calls in flight are tracked so overlap is visible.
 */
function fakeCaller(opts: {
  script?: (a: IssueArgs) => Script;
  scope?: (n: number) => string | null;
  /** The n-th workspace lookup never answers. */
  scopeHangs?: (n: number) => boolean;
  onResolve?: (n: number) => void;
} = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const store = new Map<string, Record<string, unknown>>();
  let refs = 0;
  let scopeCalls = 0;
  let resolves = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const caller = {
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'current_user_tenant_id') {
        scopeCalls += 1;
        if (opts.scopeHangs?.(scopeCalls)) return new Promise<never>(() => {});
        return { data: opts.scope ? opts.scope(scopeCalls) : TENANT, error: null };
      }
      if (name === 'issue_analytics_evidence_bundle') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        const a = args as unknown as IssueArgs;
        const s = (opts.script ?? defaultScript)(a);
        if (s.error) return { data: null, error: { code: s.error } };
        const truth = s.truth ?? 'LIVE';
        const values = truth === 'UNAVAILABLE' ? null : s.values ?? defaultScript(a).values;
        refs += 1;
        const ref = 'aneb_v1_' + refs.toString(16).padStart(64, '0');
        const result = {
          metric_key: a.p_metric_key, metric_version: '1.0.0', owner_department: 'sales', label: 'Sales figure',
          definition: 'Canonical Sales measurement.', formula: 'SUM by currency',
          range: { key: a.p_range_key, start: a.p_range_start, end: a.p_range_end, bounds: '[start,end)', timezone: 'UTC', semantics: 'event_timestamp_cohort' },
          dimensions: {}, values, unit: values?.kind === 'count' ? 'count' : 'currency_minor', source_refs: ['public.paige_invoices'],
          as_of: NOW.toISOString(), freshness: { queried_at: NOW.toISOString(), source_updated_through: null },
          coverage: truth === 'LIVE'
            ? { state: 'complete', candidate_count: 1, contributing_count: 1, excluded_count: 0 }
            : truth === 'PARTIAL'
            ? { state: 'partial', candidate_count: 2, contributing_count: 1, excluded_count: 1 }
            : { state: 'unavailable', candidate_count: 1, contributing_count: 0, excluded_count: 1 },
          exclusions: truth === 'LIVE' ? [] : [{ reason: 'invalid_currency', count: 1 }],
          truth_state: truth, caveats: [], source_revision_ref: 'sr_v1_' + 'a'.repeat(64), account_epoch: TENANT,
          account_epoch_ref: 'ae_v1_' + 'b'.repeat(64), evidence_ref: ref, reference_expires_at: new Date(NOW_MS + 900_000).toISOString(),
        };
        store.set(ref, result);
        return { data: structuredClone(result), error: null };
      }
      if (name === 'resolve_analytics_evidence_reference') {
        resolves += 1;
        opts.onResolve?.(resolves);
        const hit = store.get(String(args?.p_evidence_ref));
        return hit ? { data: structuredClone(hit), error: null } : { data: null, error: { code: '42501' } };
      }
      return { data: null, error: { code: 'PGRST202' } };
    },
  };
  return {
    caller,
    calls,
    issued: () => calls.filter((c) => c.name === 'issue_analytics_evidence_bundle').map((c) => c.args as unknown as IssueArgs),
    maxInFlight: () => maxInFlight,
  };
}

const clock = () => NOW_MS;

/** Every money figure is USD 999.00; opportunity counts keep their own kind. */
const usdEverywhere = (a: IssueArgs): Script =>
  a.p_metric_key.startsWith('sales.opportunities.') ? defaultScript(a) : { values: money(['usd', '99900']) };

function ctx(p: SnapshotPeriod = period(), signal?: AbortSignal) {
  return { identity: IDENTITY, period: p, now: NOW, ...(signal ? { signal } : {}) };
}

function data(result: ContextSourceResult<DomainSnapshot> | undefined): DomainSnapshot {
  if (!result || result.status !== 'available' || result.data === null) {
    throw new Error(`expected an available domain, got ${result?.status}:${result?.reason}`);
  }
  return result.data;
}

const review = (f: ReturnType<typeof fakeCaller>, request: Parameters<typeof composeBusinessReview>[2] = { timezone: 'UTC' }, who = WHO) =>
  composeBusinessReview(f.caller, who, request, { now: NOW });

// ── window ───────────────────────────────────────────────────────────────────────────────────────────

describe('salesMetricWindow', () => {
  it('maps window length to the issuer range key', () => {
    expect(salesMetricWindow(period('last_7_days'), NOW)?.range_key).toBe('week');
    expect(salesMetricWindow(period('last_30_days'), NOW)?.range_key).toBe('month');
    expect(salesMetricWindow(period('custom', { customStart: '2026-08-01', customEnd: '2026-10-01' }), NOW)?.range_key).toBe('quarter');
    expect(salesMetricWindow(period('custom', { customStart: '2025-12-01', customEnd: '2026-10-01' }), NOW)?.range_key).toBe('year');
  });

  const JUST_BEFORE_NOW = new Date(NOW_MS - SALES_WINDOW_CLOCK_MARGIN_MS).toISOString();

  it('clamps an end after now to just before now, and says so', () => {
    const p = period('custom', { customStart: '2026-10-10T00:00:00Z', customEnd: '2026-10-12T12:00:30Z' });
    const w = salesMetricWindow(p, NOW);
    expect(w?.range_end).toBe(JUST_BEFORE_NOW);
    expect(w?.window_note).toMatch(/up to just now/);
  });

  it('ends an in-progress window a margin before now, so a database clock slightly behind still accepts it', () => {
    // last_7_days ends at now; the issuer refuses an end after ITS clock, which may lag the edge clock.
    const w = salesMetricWindow(period(), NOW);
    expect(SALES_WINDOW_CLOCK_MARGIN_MS).toBeGreaterThan(0);
    expect(w?.range_end).toBe(JUST_BEFORE_NOW);
    expect(w?.window_note).toBeUndefined();
    // a window that already ended is left exactly as it is
    const prior = salesMetricWindow(previousPeriod(period()), NOW);
    expect(prior?.range_end).toBe(period().start);
  });

  it('refuses a window with nothing left, or a start more than ten years back', () => {
    const p = period();
    expect(salesMetricWindow(p, new Date(Date.parse(p.start)))).toBeNull();
    const old: SnapshotPeriod = { ...p, start: '2016-10-12T11:59:59.000Z', end: '2016-12-01T00:00:00.000Z' };
    expect(salesMetricWindow(old, NOW)).toBeNull();
  });
});

// ── payments adapter ─────────────────────────────────────────────────────────────────────────────────

describe('Sales completed-day reporting cutoff', () => {
  it('excludes current-day timestamps and discloses the actual cutoff without moving current snapshots', async () => {
    const dates = ['2026-10-11T23:50:00Z', '2026-10-12T11:55:00Z'].map(Date.parse);
    const f = fakeCaller({ script: (a) => a.p_metric_key === 'sales.opportunities.created'
      ? { values: count(dates.filter(t => t >= Date.parse(a.p_range_start) && t < Date.parse(a.p_range_end)).length) }
      : defaultScript(a) });
    const s = data(await createSalesPipelineSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    const created = s.headline.find(m => m.key === 'sales_pipeline.opportunities_created');
    expect(created?.value).toBe(1);
    expect(created?.window_note).toMatch(/last completed UTC day/);
    expect(created?.window_note).toContain('2026-10-12T00:00:00.000Z');
    const reads = f.issued();
    expect(reads[0].p_range_start).toBe('2026-10-05T00:00:00.000Z');
    expect(reads[0].p_range_end).toBe('2026-10-12T00:00:00.000Z');
    expect(reads[2].p_range_end).toBe(new Date(NOW_MS - SALES_WINDOW_CLOCK_MARGIN_MS).toISOString());
    expect(s.headline.find(m => m.key === 'sales_pipeline.opportunities_open')?.basis).toBe('point_in_time');
  });

  it('compares adjacent equal-length completed-day cohorts for receipts and leaves balances current', async () => {
    const f = fakeCaller();
    const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    const [current, prior, balance] = f.issued();
    expect(current.p_range_end).toBe('2026-10-12T00:00:00.000Z');
    expect(prior.p_range_end).toBe(current.p_range_start);
    expect(Date.parse(current.p_range_end) - Date.parse(current.p_range_start))
      .toBe(Date.parse(prior.p_range_end) - Date.parse(prior.p_range_start));
    expect(balance.p_range_end).toBe(new Date(NOW_MS - SALES_WINDOW_CLOCK_MARGIN_MS).toISOString());
    expect(s.headline.find(m => m.key.startsWith('payments.cash_recorded_received'))?.window_note).toMatch(/last completed UTC day/);
  });

  it('discloses the completed-day subset of an explicit historical midday interval', async () => {
    const requested = period('custom', { customStart: '2026-09-01T12:00:00Z', customEnd: '2026-09-03T12:00:00Z' });
    const f = fakeCaller();
    const s = data(await createSalesPipelineSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx(requested)));
    expect(f.issued()[0].p_range_start).toBe('2026-09-02T00:00:00.000Z');
    expect(f.issued()[0].p_range_end).toBe('2026-09-03T00:00:00.000Z');
    const note = s.headline.find(m => m.key === 'sales_pipeline.opportunities_created')?.window_note;
    expect(note).toContain(requested.start);
    expect(note).toContain(requested.end);
    expect(note).toMatch(/partial UTC days.*excluded/i);
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/partial UTC days.*excluded/i);
    expect(validateDomainSnapshot(s, { domain: 'sales_pipeline', period: requested, notAfter: NOW }).ok).toBe(true);
    expect(f.issued()[1].p_range_end).toBe(f.issued()[0].p_range_start);
  });

  it('reports a period with no completed day as unavailable, keeps current figures and preserves neutral windows', async () => {
    const requested = period('today');
    const f = fakeCaller();
    const s = data(await createSalesPipelineSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx(requested)));
    expect(f.issued().map(a => a.p_metric_key)).toEqual(['sales.opportunities.open_current', 'sales.pipeline.open_value']);
    expect(s.headline.some(m => m.key === 'sales_pipeline.opportunities_created')).toBe(false);
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/new opportunities.*could not|could not.*new opportunities/i);
    // The neutral Clients/Operations helper must continue to use its requested timestamp window.
    expect(salesMetricWindow(period(), NOW)?.range_end).toBe(new Date(NOW_MS - SALES_WINDOW_CLOCK_MARGIN_MS).toISOString());
  });

  it('holds the completed-day read at clock-margin midnight and releases the exact next cutoff afterward', () => {
    expect(salesReportingPeriod(period(), new Date('2026-10-13T00:00:01Z'))).toBeNull();
    const next = salesReportingPeriod(period(), new Date('2026-10-13T00:00:03Z'));
    expect(next?.period.start).toBe('2026-10-06T00:00:00.000Z');
    expect(next?.period.end).toBe('2026-10-13T00:00:00.000Z');
    expect(next?.windowNote).toMatch(/last completed UTC day 2026-10-12/);
    expect(next?.windowNote.length).toBeLessThanOrEqual(300);
  });
});

describe('payments adapter', () => {
  it('keeps every currency separate, upper-cases codes, and never sums them', async () => {
    const f = fakeCaller({ script: (a) => a.p_metric_key === 'sales.cash.recorded_received' && !isPrevious(a)
      ? { values: money(['eur', '5000'], ['usd', '125000']) }
      : defaultScript(a) });
    const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    const cash = s.headline.filter((m) => m.key.startsWith('payments.cash_recorded_received_'));
    expect(cash.map((m) => [m.key, m.currency, m.value])).toEqual([
      ['payments.cash_recorded_received_eur', 'EUR', 5000],
      ['payments.cash_recorded_received_usd', 'USD', 125000],
    ]);
    expect(s.headline.some((m) => m.value === 130000)).toBe(false);
    expect(cash[0].label).toMatch(/not bank-verified/);
    expect(validateDomainSnapshot(s, { domain: 'payments', period: period(), notAfter: NOW }).ok).toBe(true);
  });

  it('reads one metric at a time, in order, never two issuances in flight', async () => {
    const f = fakeCaller();
    await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx());
    expect(f.maxInFlight()).toBe(1);
    expect(f.issued().map((a) => a.p_metric_key)).toEqual([
      'sales.cash.recorded_received', 'sales.cash.recorded_received',
      'sales.receivables.outstanding_current', 'sales.receivables.overdue_current',
    ]);
    // Sales comparisons end at the effective completed-day reporting start.
    expect(f.issued()[1].p_range_end).toBe(f.issued()[0].p_range_start);
  });

  it.each([1, 2, 3])('stops before the next read when aborted after read %i', async (k) => {
    const controller = new AbortController();
    const f = fakeCaller({ onResolve: (n) => { if (n === k) controller.abort(); } });
    const r = await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx(period(), controller.signal));
    expect(r).toEqual({ status: 'degraded', reason: 'aborted', data: null });
    expect(f.issued()).toHaveLength(k);
  });

  it('marks a PARTIAL figure as partial coverage and names it', async () => {
    const f = fakeCaller({ script: (a) => a.p_metric_key === 'sales.receivables.outstanding_current'
      ? { values: money(['usd', '40000']), truth: 'PARTIAL' }
      : defaultScript(a) });
    const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/outstanding receivables: the source marks this figure as incomplete/i);
    expect(s.headline.find((m) => m.key === 'payments.receivables_outstanding_usd')?.value).toBe(40000);
  });

  it('drops an amount it cannot hold exactly, keeps the rest, and says so', async () => {
    const f = fakeCaller({ script: (a) => a.p_metric_key === 'sales.receivables.outstanding_current'
      ? { values: money(['eur', '1200'], ['usd', '900719925474099300']) }
      : defaultScript(a) });
    const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    const outstanding = s.headline.filter((m) => m.key.startsWith('payments.receivables_outstanding'));
    expect(outstanding.map((m) => m.currency)).toEqual(['EUR']);
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/could not be shown exactly/);
    expect(validateDomainSnapshot(s, { domain: 'payments', period: period(), notAfter: NOW }).ok).toBe(true);
  });

  it('adds an act risk for overdue money and none when nothing is overdue', async () => {
    const overdue = (rows: [string, string][]) => fakeCaller({ script: (a) => a.p_metric_key === 'sales.receivables.overdue_current'
      ? { values: money(...rows) }
      : defaultScript(a) });
    const owing = data(await createPaymentsSnapshotAdapter(overdue([['usd', '50000'], ['eur', '0']]).caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(owing.risks).toEqual([{ kind: 'receivables_overdue', severity: 'act', summary: expect.stringContaining('USD 500.00') }]);

    const zero = data(await createPaymentsSnapshotAdapter(overdue([['usd', '0']]).caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(zero.risks).toEqual([]);
    const none = data(await createPaymentsSnapshotAdapter(overdue([]).caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(none.risks).toEqual([]);
    expect(none.headline.find((m) => m.key === 'payments.receivables_overdue_records')).toMatchObject({ value: 0, unit: 'count' });
  });

  describe('previous-period change', () => {
    const cashBoth = (current: Script, previous: Script) => fakeCaller({ script: (a) => a.p_metric_key === 'sales.cash.recorded_received'
      ? (isPrevious(a) ? previous : current)
      : defaultScript(a) });

    it('is built per currency when both windows are available', async () => {
      const f = cashBoth({ values: money(['eur', '3000'], ['usd', '15000']) }, { values: money(['usd', '10000']) });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.changes).toEqual([
        { summary: 'Recorded receipts in EUR went up from EUR 0.00 in the previous 7 days to EUR 30.00 in the last 7 days.', metric_key: 'payments.cash_recorded_received_eur', direction: 'up' },
        { summary: 'Recorded receipts in USD went up from USD 100.00 in the previous 7 days to USD 150.00 in the last 7 days.', metric_key: 'payments.cash_recorded_received_usd', direction: 'up' },
      ]);
      expect(s.coverage).toBe('full');
    });

    it('is left out when the previous window could not be read', async () => {
      const f = cashBoth({ values: money(['usd', '15000']) }, { error: 'XX000' });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.changes).toEqual([]);
      expect(s.coverage_note).toMatch(/previous period's recorded receipts could not be read/i);
    });

    it('is left out when the previous window is partial (absence there is not a zero)', async () => {
      const f = cashBoth({ values: money(['eur', '3000'], ['usd', '15000']) }, { values: money(['usd', '10000']), truth: 'PARTIAL' });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.changes).toEqual([]);
      expect(s.coverage_note).toMatch(/no comparison with the previous period/);
    });

    it('never applies to point-in-time balances', async () => {
      const s = data(await createPaymentsSnapshotAdapter(fakeCaller().caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.changes.every((c) => !c.metric_key?.includes('receivables'))).toBe(true);
      expect(s.headline.filter((m) => m.key.includes('receivables')).every((m) => m.basis === 'point_in_time')).toBe(true);
    });
  });

  describe('a partial or dropped read is never a zero', () => {
    const outstandingIs = (s: Script) => fakeCaller({ script: (a) => a.p_metric_key === 'sales.receivables.outstanding_current' ? s : defaultScript(a) });

    it('a PARTIAL read with no amounts shows no "none recorded" zero', async () => {
      const f = outstandingIs({ values: money(), truth: 'PARTIAL' });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.headline.some((m) => m.key.startsWith('payments.receivables_outstanding'))).toBe(false);
      expect(s.coverage).toBe('partial');
      expect(s.coverage_note).toMatch(/outstanding receivables: the source marks this figure as incomplete/i);
    });

    it('a read whose every amount was dropped shows no zero either', async () => {
      const f = outstandingIs({ values: money(['usd', '900719925474099300'], ['eur', '-900719925474099300']) });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.headline.some((m) => m.key.startsWith('payments.receivables_outstanding'))).toBe(false);
      expect(s.coverage).toBe('partial');
      expect(s.coverage_note).toMatch(/outstanding receivables: 2 amounts could not be shown exactly/i);
    });

    it('a currency missing from a previous window that dropped an amount gets no change', async () => {
      // previous window: USD known, JPY dropped (unsafe), EUR and GBP absent. Absence is a zero only
      // in a window that dropped nothing, so EUR and GBP have no known previous amount.
      const f = fakeCaller({ script: (a) => a.p_metric_key !== 'sales.cash.recorded_received'
        ? defaultScript(a)
        : isPrevious(a)
        ? { values: money(['usd', '10000'], ['jpy', '99999999999999999999']) }
        : { values: money(['eur', '3000'], ['gbp', '100'], ['usd', '15000']) } });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.changes.map((c) => c.metric_key)).toEqual(['payments.cash_recorded_received_usd']);
      expect(s.coverage_note).toMatch(/recorded receipts: no comparison with the previous period/i);
    });

    it('a PARTIAL current window is not compared with a complete previous one', async () => {
      const f = fakeCaller({ script: (a) => a.p_metric_key !== 'sales.cash.recorded_received'
        ? defaultScript(a)
        : isPrevious(a)
        ? { values: money(['usd', '10000']) }
        : { values: money(['usd', '15000']), truth: 'PARTIAL' } });
      const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
      expect(s.changes).toEqual([]);
      expect(s.coverage_note).toMatch(/recorded receipts: no comparison with the previous period/i);
    });
  });

  it('many currencies: trimming for length never leaves an overdue risk without its figure', async () => {
    const TEN = ['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'chf', 'sek', 'nok', 'dkk'];
    const f = fakeCaller({ script: () => ({ values: money(...TEN.map((c, i) => [c, String(1000 * (i + 1))] as [string, string])) }) });
    const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(s.headline).toHaveLength(24);
    expect(s.risks).toHaveLength(10);
    const shown = new Set(s.headline.map((m) => m.key));
    for (const c of TEN) expect(shown.has(`payments.receivables_overdue_${c}`)).toBe(true);
    expect(s.changes.every((c) => c.metric_key === undefined || shown.has(c.metric_key))).toBe(true);
    expect(s.coverage_note).toMatch(/6 more figures were left out for length \(outstanding receivables\)/);
    expect(validateDomainSnapshot(s, { domain: 'payments', period: period(), notAfter: NOW }).ok).toBe(true);
  });

  it('refusal makes the domain unavailable, never a zero', async () => {
    const f = fakeCaller({ script: () => ({ error: '42501' }) });
    const r = await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx());
    expect(r).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
  });

  it('an unverified issuer read degrades the domain', async () => {
    const f = fakeCaller({ script: () => ({ error: 'XX000' }) });
    const r = await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx());
    expect(r).toEqual({ status: 'degraded', reason: 'metric_evidence_not_verified', data: null });
  });

  it('a source that reports UNAVAILABLE is a named failure, not a zero', async () => {
    const f = fakeCaller({ script: (a) => a.p_metric_key === 'sales.cash.recorded_received' ? { truth: 'UNAVAILABLE' } : defaultScript(a) });
    const s = data(await createPaymentsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(s.headline.some((m) => m.key.startsWith('payments.cash_recorded_received'))).toBe(false);
    expect(s.coverage_note).toMatch(/recorded receipts could not be read/i);
  });

  it('refuses to read for a scope other than the composer identity', async () => {
    const f = fakeCaller();
    const r = await createPaymentsSnapshotAdapter(f.caller, { tenantId: 'someone-else' }, clock).read(ctx());
    expect(r.status).toBe('degraded');
    expect(f.calls).toHaveLength(0);
  });
});

// ── sales pipeline adapter ───────────────────────────────────────────────────────────────────────────

describe('sales pipeline adapter', () => {
  it('reads created (with a change), open now and open value per currency — never won or lost', async () => {
    const f = fakeCaller({ script: (a) => {
      if (a.p_metric_key === 'sales.opportunities.created') return { values: count(isPrevious(a) ? 3 : 5) };
      if (a.p_metric_key === 'sales.opportunities.open_current') return { values: count(12) };
      return { values: money(['gbp', '700000'], ['usd', '2500000']) };
    } });
    const s = data(await createSalesPipelineSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(s.headline.map((m) => [m.key, m.value, m.basis])).toEqual([
      ['sales_pipeline.opportunities_created', 5, 'in_period'],
      ['sales_pipeline.opportunities_open', 12, 'point_in_time'],
      ['sales_pipeline.open_value_gbp', 700000, 'point_in_time'],
      ['sales_pipeline.open_value_usd', 2500000, 'point_in_time'],
    ]);
    expect(s.changes).toEqual([{
      summary: 'New opportunities went up from 3 in the previous 7 days to 5 in the last 7 days.',
      metric_key: 'sales_pipeline.opportunities_created',
      direction: 'up',
    }]);
    expect(f.issued().map((a) => a.p_metric_key).some((k) => /won|lost/.test(k))).toBe(false);
    expect(f.maxInFlight()).toBe(1);
    expect(validateDomainSnapshot(s, { domain: 'sales_pipeline', period: period(), notAfter: NOW }).ok).toBe(true);
  });

  it.each([
    ['current', (a: IssueArgs) => !isPrevious(a)],
    ['previous', (a: IssueArgs) => isPrevious(a)],
  ] as const)('never compares opportunity counts when the %s window is partial', async (_label, partialWindow) => {
    const f = fakeCaller({ script: (a) => {
      if (a.p_metric_key === 'sales.opportunities.created') {
        return { values: count(isPrevious(a) ? 3 : 5), truth: partialWindow(a) ? 'PARTIAL' : 'LIVE' };
      }
      if (a.p_metric_key === 'sales.opportunities.open_current') return { values: count(12) };
      return { values: money(['usd', '2500000']) };
    } });
    const s = data(await createSalesPipelineSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx()));
    expect(s.changes).toEqual([]);
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/new opportunities: no comparison with the previous period/i);
  });

  it.each([1, 2, 3])('stops before the next read when aborted after read %i', async (k) => {
    const controller = new AbortController();
    const f = fakeCaller({ onResolve: (n) => { if (n === k) controller.abort(); } });
    const r = await createSalesPipelineSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx(period(), controller.signal));
    expect(r).toEqual({ status: 'degraded', reason: 'aborted', data: null });
    expect(f.issued()).toHaveLength(k);
  });
});

describe('finishSalesSnapshot trimming', () => {
  it('drops a comparison whose figure was cut for length, and says so', () => {
    const draft = emptySalesDraft();
    for (let i = 0; i < 26; i++) {
      pushSalesHeadline(draft, { key: `sales_pipeline.f${i}`, label: 'Figure', value: i, unit: 'count', basis: 'point_in_time' }, 'test figures');
    }
    draft.changes.push({ summary: 'Kept went up.', metric_key: 'sales_pipeline.f0', direction: 'up' });
    draft.changes.push({ summary: 'Cut went up.', metric_key: 'sales_pipeline.f25', direction: 'up' });
    draft.headlineReads = 1;
    draft.sources.push({ system: 'sales', adapter: 'test', reference: 'k@r' });
    const s = data(finishSalesSnapshot(draft, { domain: 'sales_pipeline', owner: 'sales', period: period(), now: NOW }));
    expect(s.headline).toHaveLength(24);
    expect(s.changes.map((c) => c.metric_key)).toEqual(['sales_pipeline.f0']);
    expect(s.coverage_note).toMatch(/2 more figures were left out for length \(test figures\); one comparison for a figure left out was left out too/);
  });
});

// ── the composition entry point ──────────────────────────────────────────────────────────────────────

describe('composeBusinessReview', () => {
  it('answers the weekly question with both adapted areas and honest gaps everywhere else', async () => {
    const f = fakeCaller({ script: (a) => a.p_metric_key === 'sales.cash.recorded_received' && !isPrevious(a)
      ? { values: money(['usd', '125000']) }
      : defaultScript(a) });
    const r = await review(f);
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(r.snapshot.period.key).toBe('last_7_days');
    expect(r.snapshot.domains.payments.status).toBe('available');
    expect(r.snapshot.domains.sales_pipeline.status).toBe('available');
    // This fixture's issuer answers every key as a Sales figure, so the F2b clients adapter refuses it
    // by owner (metric_owner_unexpected) — still an honest gap. F2b's own suite covers clients read.
    expect(r.projection).toMatch(/\[Clients\] NOT AVAILABLE/);
    expect(r.projection).toMatch(/\[Work and tasks\] NOT AVAILABLE/);
    expect(r.projection).toContain('USD 1,250.00');
    // evidence references are bearer-like; they never leave the metric read
    expect(JSON.stringify(r)).not.toMatch(/aneb_v1_/);
    expect(validateDomainSnapshot(r.snapshot.domains.payments.data, { domain: 'payments', period: r.snapshot.period, notAfter: NOW }).ok).toBe(true);
  });

  it('a refused read leaves payments NOT AVAILABLE and never a 0 headline', async () => {
    const f = fakeCaller({ script: () => ({ error: '42501' }) });
    const r = await review(f);
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(r.snapshot.domains.payments).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
    expect(r.projection).toMatch(/\[Payments and collections\] NOT AVAILABLE/);
    expect(r.projection).not.toMatch(/USD 0|: 0 \(/);
  });

  it('a workspace that does not match before composing reads nothing at all', async () => {
    const f = fakeCaller({ scope: () => 'a-different-workspace' });
    const r = await review(f);
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(f.calls.some((c) => c.name === 'issue_analytics_evidence_bundle')).toBe(false);
    // the composer's own pre-check stops it, before any adapter (or its per-read check) runs
    expect(r.snapshot.budget.adapters_run).toBe(0);
    expect(f.calls.map((c) => c.name)).toEqual(['current_user_tenant_id']);
    for (const d of r.snapshot.requested) expect(r.snapshot.domains[d]).toEqual({ status: 'degraded', reason: 'scope_changed', data: null });
  });

  it('a workspace switch seen mid-read voids every domain', async () => {
    // The first few scope answers match, then the user switches workspace while reads are in flight.
    const f = fakeCaller({ scope: (n) => (n <= 3 ? TENANT : 'switched-workspace'), script: usdEverywhere });
    const r = await review(f);
    if (!('snapshot' in r)) throw new Error(r.reason);
    // F2b: four adapters now run (payments, sales_pipeline, operations, clients).
    expect(r.snapshot.budget.adapters_run).toBe(4);
    expect(f.issued().length).toBeGreaterThan(0);
    for (const d of r.snapshot.requested) expect(r.snapshot.domains[d].status).toBe('degraded');
    expect(r.snapshot.degradation.every((e) => e.reason === 'scope_changed')).toBe(true);
    expect(r.projection).not.toContain('USD 999.00');
  });

  it('a switch after every adapter settled still voids every domain', async () => {
    // 14 reads since F2b (8 F2a + 3 operations + 3 clients). Each read checks the workspace before and
    // after, except the Systems Check list: this fixture answers it in a Sales shape the contract
    // rejects, so that read stops after its first check. 1 pre-check + 27 = 28 answers that match; the
    // 29th is the explicit post-compose read, and only it reports a different workspace.
    const f = fakeCaller({ scope: (n) => (n <= 28 ? TENANT : 'switched-workspace'), script: usdEverywhere });
    const r = await review(f);
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(f.issued()).toHaveLength(14);
    expect(f.calls.filter((c) => c.name === 'current_user_tenant_id')).toHaveLength(29);
    for (const d of r.snapshot.requested) expect(r.snapshot.domains[d]).toEqual({ status: 'degraded', reason: 'scope_changed', data: null });
    expect(r.projection).not.toContain('USD 999.00');
  });

  it('a workspace lookup that never answers before composing fails closed, bounded, and reads nothing', async () => {
    const f = fakeCaller({ scopeHangs: (n) => n === 1 });
    const r = await composeBusinessReview(f.caller, WHO, { timezone: 'UTC' }, { now: NOW, timeoutMs: 50 });
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(f.issued()).toHaveLength(0);
    for (const d of r.snapshot.requested) expect(r.snapshot.domains[d]).toEqual({ status: 'degraded', reason: 'scope_changed', data: null });
  }, 2000);

  it('a workspace lookup that never answers after composing voids every domain', async () => {
    // 1 pre-check + 27 per-read lookups answer (14 reads since F2b; see the test above); the 29th, the
    // explicit post-compose read, hangs.
    const f = fakeCaller({ scopeHangs: (n) => n === 29, script: usdEverywhere });
    const r = await composeBusinessReview(f.caller, WHO, { timezone: 'UTC' }, { now: NOW, timeoutMs: 500 });
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(f.issued()).toHaveLength(14);
    for (const d of r.snapshot.requested) expect(r.snapshot.domains[d]).toEqual({ status: 'degraded', reason: 'scope_changed', data: null });
    expect(r.projection).not.toContain('USD 999.00');
  }, 3000);

  it('discloses the Sales completed-day cutoff while other reads retain their requested current window', async () => {
    const f = fakeCaller();
    const r = await review(f, { timezone: 'UTC', period: 'custom', customStart: '2026-10-10T00:00:00Z', customEnd: '2026-10-12T12:00:30Z' });
    if (!('snapshot' in r)) throw new Error(r.reason);
    const current = f.issued().filter((a) => a.p_range_start === '2026-10-10T00:00:00.000Z');
    expect(current.length).toBeGreaterThan(0);
    const salesActivity = current.filter(a => ['sales.opportunities.created', 'sales.cash.recorded_received'].includes(a.p_metric_key));
    expect(salesActivity.every(a => a.p_range_end === '2026-10-12T00:00:00.000Z')).toBe(true);
    expect(current.filter(a => !salesActivity.includes(a)).every(a => a.p_range_end === new Date(NOW_MS - SALES_WINDOW_CLOCK_MARGIN_MS).toISOString())).toBe(true);
    const created = data(r.snapshot.domains.sales_pipeline).headline.find((m) => m.key === 'sales_pipeline.opportunities_created');
    expect(created?.window_note).toMatch(/last completed UTC day 2026-10-11/);
  });

  it('no workspace: every domain says so, and nothing is called', async () => {
    const f = fakeCaller();
    const r = await review(f, { timezone: 'UTC' }, { ...WHO, tenantId: null });
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(f.calls).toHaveLength(0);
    expect(r.snapshot.degradation.every((e) => e.reason === 'no_workspace')).toBe(true);
  });

  it('a bad period is a refusal before any read', async () => {
    const f = fakeCaller();
    expect(await review(f, { timezone: 'Not/AZone' })).toEqual({ ok: false, reason: 'invalid_timezone' });
    expect(f.calls).toHaveLength(0);
  });

  it('focus narrows the read to the asked-for areas', async () => {
    const f = fakeCaller();
    const r = await review(f, { timezone: 'UTC', focus: ['collections'] });
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(r.snapshot.requested).toEqual(['payments']);
    expect(f.issued().every((a) => !a.p_metric_key.startsWith('sales.opportunities') && a.p_metric_key !== 'sales.pipeline.open_value')).toBe(true);
  });
});

// ── helpers in isolation ─────────────────────────────────────────────────────────────────────────────

describe('currencyFigures', () => {
  const metric = (by: { currency: string; amount_minor: string }[]) =>
    ({ values: { kind: 'currency_totals', by_currency: by.map((b) => ({ ...b, record_count: 1 })), breakdown: [] } }) as unknown as SalesMetric;
  it('drops malformed codes, non-integers and unsafe magnitudes; keeps negative receipts', () => {
    const r = currencyFigures(metric([
      { currency: 'usd', amount_minor: '-500' },
      { currency: 'us', amount_minor: '1' },
      { currency: 'eur', amount_minor: '1.5' },
      { currency: 'gbp', amount_minor: '9007199254740993' },
    ]));
    expect(r).toEqual({ figures: [{ currency: 'USD', amountMinor: -500 }], dropped: 3 });
  });
  it('the previous window helper ends where the period starts', () => {
    expect(previousPeriod(period()).end).toBe(period().start);
  });
});
