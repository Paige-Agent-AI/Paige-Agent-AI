// @vitest-environment node
/**
 * Operating Fabric F2b — the `operations` and `clients` snapshot adapters, the generalised issuer
 * helpers they share with F2a, and their registration in the business review.
 *
 * The fake issuer below answers payloads that pass the real `parseMetricResult` contract, shaped the
 * way the settings producer (20270601000005) shapes them: owner department by key prefix, current
 * snapshot semantics for state keys, ONE generic exclusion reason, raw enum keys as distribution labels.
 */
import { describe, expect, it } from 'vitest';
import { composeBusinessReview, type BusinessReviewWho } from '../../supabase/functions/_shared/paige-context/business-review.ts';
import {
  createOperationsSnapshotAdapter,
  OPERATIONS_METRICS,
} from '../../supabase/functions/_shared/paige-context/adapters/operations.ts';
import { CLIENTS_METRICS, createClientsSnapshotAdapter } from '../../supabase/functions/_shared/paige-context/adapters/clients.ts';
import {
  closedBuckets,
  interpretIssuerMetric,
  plainUtcMinute,
  SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION,
  type IssuerMetric,
} from '../../supabase/functions/_shared/paige-context/adapters/issuer-metric.ts';
import { interpretSalesMetric } from '../../supabase/functions/_shared/paige-context/adapters/sales-metric.ts';
import {
  projectOperatingSnapshot,
  resolveSnapshotPeriod,
  validateDomainSnapshot,
  type DomainSnapshot,
  type SnapshotPeriod,
} from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import type { ContextIdentity, ContextSourceResult } from '../../supabase/functions/_shared/paige-context/mod.ts';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────

const TENANT = 'a3400000-0000-4000-8000-0000000000f3';
const NOW = new Date('2026-10-12T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const SWEEP_DONE = '2026-10-11T09:02:00.000Z';
const WHO: BusinessReviewWho = { actorId: 'actor-f2b', tenantId: TENANT, role: 'owner', accountShape: 'solo' };
const IDENTITY: ContextIdentity = {
  actorId: WHO.actorId, tenantId: TENANT, workspaceId: TENANT, role: 'owner', actAsClientId: null, accountShape: 'solo', scopeEpoch: TENANT,
};
const GENERIC = SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION;

function period(key = 'last_7_days'): SnapshotPeriod {
  const r = resolveSnapshotPeriod({ key, now: NOW, timezone: 'UTC' });
  if ('reason' in r) throw new Error(r.reason);
  return r.period;
}
const ctx = (signal?: AbortSignal) => ({ identity: IDENTITY, period: period(), now: NOW, ...(signal ? { signal } : {}) });

type Event = { source: 'systems_check'; at: string; status: 'fail' | 'error'; severity: 'blocking' | 'high' | 'medium' | 'low'; retry_count: null; completed_at: string; check_key: string };
type Values =
  | { kind: 'count'; count: number }
  | { kind: 'distribution'; items: { key: string; label: string; count: number }[] }
  | { kind: 'diagnostic_events'; items: Event[] }
  | { kind: 'currency_totals'; by_currency: { currency: string; amount_minor: string; record_count: number }[]; breakdown: [] };

/** What the fake issuer answers for one key. Coverage is derived: contributing + `excluded`. */
type Script = {
  values?: Values | null;
  truth?: 'LIVE' | 'PARTIAL' | 'UNAVAILABLE';
  excluded?: number;
  exclusions?: { reason: string; count: number }[];
  owner?: string;
  error?: string;
  caveats?: string[];
};
type IssueArgs = { p_metric_key: string; p_range_key: string; p_range_start: string; p_range_end: string };

const count = (n: number): Values => ({ kind: 'count', count: n });
const dist = (...rows: [string, number][]): Values => ({ kind: 'distribution', items: rows.map(([key, n]) => ({ key, label: key, count: n })) });
function finding(check_key: string, severity: Event['severity'], minutesBeforeDone: number, status: Event['status'] = 'fail'): Event {
  return { source: 'systems_check', at: new Date(Date.parse(SWEEP_DONE) - minutesBeforeDone * 60_000).toISOString(), status, severity, retry_count: null, completed_at: SWEEP_DONE, check_key };
}
const events = (...items: Event[]): Values => ({ kind: 'diagnostic_events', items: [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) });

const OWNER_BY_PREFIX = (key: string) => key.startsWith('sales.') ? 'sales' : key.startsWith('business.') ? 'client_experience' : 'operations_pmo';
const SNAPSHOT_KEYS = new Set([
  'business.active_clients_current', 'business.lifecycle_current', 'business.onboarding_current',
  'operations.current_system_exceptions', 'operations.unresolved_findings_current', 'operations.systems_check_latest',
]);

/** Realistic defaults: today's prod shape for one healthy-ish tenant. */
function defaults(key: string): Script {
  switch (key) {
    case OPERATIONS_METRICS.exceptions:
      return { values: events(finding('payment_processor_connected', 'blocking', 1), finding('website_connected', 'high', 2), finding('social_accounts_connected', 'medium', 3)) };
    // 10 findings in the sweep, 3 failing: the 7 passes are excluded by definition, so the producer says PARTIAL.
    case OPERATIONS_METRICS.unresolved:
      return { values: count(3), truth: 'PARTIAL', excluded: 7 };
    case OPERATIONS_METRICS.workflowRuns:
      return { values: dist(['succeeded', 4]) };
    case CLIENTS_METRICS.active:
      return { values: count(1) };
    case CLIENTS_METRICS.lifecycle:
      return { values: dist(['client_active', 1]) };
    case CLIENTS_METRICS.onboarding:
      return { values: dist(['completed', 1]) };
    default:
      return { values: key.startsWith('sales.opportunities.') ? count(0) : { kind: 'currency_totals', by_currency: [], breakdown: [] } };
  }
}

function fakeCaller(opts: { script?: (key: string, a: IssueArgs) => Script | undefined; scope?: (n: number) => string } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const store = new Map<string, Record<string, unknown>>();
  let refs = 0;
  let scopeCalls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const caller = {
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'current_user_tenant_id') {
        scopeCalls += 1;
        return { data: opts.scope ? opts.scope(scopeCalls) : TENANT, error: null };
      }
      if (name === 'issue_analytics_evidence_bundle') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        const a = args as unknown as IssueArgs;
        const key = a.p_metric_key;
        const s: Script = { ...defaults(key), ...(opts.script?.(key, a) ?? {}) };
        if (s.error) return { data: null, error: { code: s.error } };
        const truth = s.truth ?? 'LIVE';
        const values = truth === 'UNAVAILABLE' ? null : s.values ?? null;
        const contributing = values === null ? 0
          : values.kind === 'count' ? values.count
          : values.kind === 'distribution' ? values.items.reduce((n, i) => n + i.count, 0)
          : values.kind === 'diagnostic_events' ? values.items.length : 1;
        const excluded = truth === 'LIVE' ? 0 : (s.excluded ?? (truth === 'UNAVAILABLE' ? 1 : 1));
        const candidate = contributing + excluded;
        const exclusions = truth === 'UNAVAILABLE'
          ? [{ reason: 'Required source or eligible measurement unavailable', count: candidate }]
          : s.exclusions ?? [{ reason: GENERIC, count: excluded }];
        refs += 1;
        const ref = 'aneb_v1_' + refs.toString(16).padStart(64, '0');
        const snapshot = SNAPSHOT_KEYS.has(key);
        const result = {
          metric_key: key, metric_version: '1.0.0', owner_department: s.owner ?? OWNER_BY_PREFIX(key), label: 'Recorded lifecycle stages',
          definition: 'Current canonical client lifecycle: active, paused, churned, funded and alumni clients.', formula: 'Producer formula.',
          range: { key: a.p_range_key, start: a.p_range_start, end: a.p_range_end, bounds: '[start,end)', timezone: 'UTC', semantics: snapshot ? 'current_snapshot' : 'event_timestamp_cohort' },
          dimensions: {}, values, unit: 'count', source_refs: ['public.clients'],
          as_of: NOW.toISOString(),
          freshness: { queried_at: NOW.toISOString(), source_updated_through: key.startsWith('operations.') && key !== OPERATIONS_METRICS.workflowRuns ? SWEEP_DONE : null },
          coverage: {
            state: truth === 'LIVE' ? 'complete' : truth === 'PARTIAL' ? 'partial' : 'unavailable',
            candidate_count: truth === 'UNAVAILABLE' ? excluded : candidate,
            contributing_count: truth === 'UNAVAILABLE' ? 0 : contributing,
            excluded_count: excluded,
          },
          exclusions, truth_state: truth, caveats: s.caveats ?? [], source_revision_ref: 'sr_v1_' + 'c'.repeat(64), account_epoch: TENANT,
          account_epoch_ref: 'ae_v1_' + 'd'.repeat(64), evidence_ref: ref, reference_expires_at: new Date(NOW_MS + 900_000).toISOString(),
        };
        if (truth === 'UNAVAILABLE') result.exclusions = [{ reason: 'Required source or eligible measurement unavailable', count: excluded }];
        store.set(ref, result);
        return { data: structuredClone(result), error: null };
      }
      if (name === 'resolve_analytics_evidence_reference') {
        const hit = store.get(String(args?.p_evidence_ref));
        return hit ? { data: structuredClone(hit), error: null } : { data: null, error: { code: '42501' } };
      }
      return { data: null, error: { code: 'PGRST202' } };
    },
  };
  return {
    caller,
    calls,
    issuedKeys: () => calls.filter((c) => c.name === 'issue_analytics_evidence_bundle').map((c) => String(c.args?.p_metric_key)),
    maxInFlight: () => maxInFlight,
  };
}

const clock = () => NOW_MS;
const ops = (f: ReturnType<typeof fakeCaller>, signal?: AbortSignal) => createOperationsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx(signal));
const clients = (f: ReturnType<typeof fakeCaller>) => createClientsSnapshotAdapter(f.caller, { tenantId: TENANT }, clock).read(ctx());

function data(result: ContextSourceResult<DomainSnapshot> | undefined): DomainSnapshot {
  if (!result || result.status !== 'available' || result.data === null) throw new Error(`expected available, got ${result?.status}:${result?.reason}`);
  const v = validateDomainSnapshot(result.data, { domain: result.data.domain, period: period(), notAfter: NOW });
  if ('reason' in v) throw new Error(`snapshot failed validation: ${v.reason}`);
  return result.data;
}
const fig = (s: DomainSnapshot, key: string) => s.headline.find((m) => m.key === key);

// ── operations ───────────────────────────────────────────────────────────────────────────────────────

describe('operations adapter', () => {
  it('reads three metrics one at a time, in order, never two issuances in flight', async () => {
    const f = fakeCaller();
    data(await ops(f));
    expect(f.issuedKeys()).toEqual([OPERATIONS_METRICS.exceptions, OPERATIONS_METRICS.unresolved, OPERATIONS_METRICS.workflowRuns]);
    expect(f.maxInFlight()).toBe(1);
  });

  it('a PARTIAL that is only the definition (passing checks left out) is not called incomplete', async () => {
    const s = data(await ops(fakeCaller()));
    expect(fig(s, 'operations.unresolved_findings')?.value).toBe(3);
    expect(s.coverage).toBe('full');
    expect(s.coverage_note).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/incomplete/);
  });

  it('a real extra exclusion reason makes the count partial, and says so', async () => {
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.unresolved
      ? { exclusions: [{ reason: GENERIC, count: 6 }, { reason: 'Finding version could not be verified', count: 1 }] }
      : undefined });
    const s = data(await ops(f));
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/open Systems Check findings: the source marks this figure as incomplete/i);
  });

  it('a PARTIAL with nothing itemised as excluded fails closed as partial', () => {
    const metric = { truth_state: 'PARTIAL', coverage: { state: 'partial', excluded_count: 0 }, exclusions: [], owner_department: 'operations_pmo', values: { kind: 'count', count: 2 } } as unknown as IssuerMetric;
    const r = interpretIssuerMetric({ status: 'available', message: '', metric }, { kind: 'count', definitionalExclusions: [GENERIC] });
    expect('metric' in r && r.partial).toBe(true);
  });

  it('ranks findings blocking → high → medium → low; blocking/high act, medium/low watch; ids never shown', async () => {
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.exceptions
      ? { values: events(finding('payment_method_options', 'low', 1), finding('website_connected', 'high', 2), finding('automation_wired', 'medium', 3), finding('comms_configured', 'blocking', 4), finding('a_check_nobody_mapped', 'high', 5)) }
      : undefined });
    const s = data(await ops(f));
    expect(s.risks.map((r) => r.kind)).toEqual(['systems_check_blocking', 'systems_check_high', 'systems_check_high', 'systems_check_medium', 'systems_check_low']);
    expect(s.risks.map((r) => r.severity)).toEqual(['act', 'act', 'act', 'watch', 'watch']);
    expect(s.risks[0].summary).toBe('Systems Check: email, phone and texting are not fully set up (blocking; found 2026-10-11 08:58 UTC).');
    expect(s.risks[2].summary).toMatch(/^Systems Check: one setup item needs attention \(high priority; found /);
    const all = JSON.stringify(s) + projectOperatingSnapshot({ version: 1, tenant_id: TENANT, actor_id: 'a', account_shape: 'solo', period: period(), composed_at: NOW.toISOString(), requested: ['operations'], domains: { operations: { status: 'available', data: s } }, degradation: [], budget: { adapters_run: 1, timed_out: [], truncated: [] } });
    for (const raw of ['payment_method_options', 'website_connected', 'automation_wired', 'comms_configured', 'a_check_nobody_mapped']) expect(all).not.toContain(raw);
    expect(fig(s, 'operations.exceptions_high')?.value).toBe(2);
    expect(fig(s, 'operations.exceptions_low')?.window_note).toBe('from the latest Systems Check, as of 2026-10-11 09:02 UTC');
  });

  it('a check that could not run is said so, not called a failure of the setup item', async () => {
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.exceptions ? { values: events(finding('website_connected', 'high', 1, 'error')) } : undefined });
    expect(data(await ops(f)).risks[0].summary).toMatch(/^Systems Check could not check your website \(high priority/);
  });

  it('when the producer has more findings than it listed: says the list is incomplete and per-priority counts are not available', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => finding('company_info_populated', 'medium', i + 1));
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.exceptions ? { values: events(...twenty), truth: 'PARTIAL', excluded: 5 } : undefined });
    const s = data(await ops(f));
    expect(s.coverage_note).toMatch(/5 more Systems Check items were not listed/);
    for (const sev of ['blocking', 'high', 'medium', 'low']) expect(fig(s, `operations.exceptions_${sev}`)?.value).toBeNull();
    expect(s.risks).toHaveLength(20);
  });

  it('no finished full check: no counts invented, one plain note, never a zero', async () => {
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? undefined : { truth: 'UNAVAILABLE' } });
    const s = data(await ops(f));
    expect(s.headline.some((m) => m.key.startsWith('operations.exceptions_') || m.key === 'operations.unresolved_findings')).toBe(false);
    expect(s.risks.filter((r) => r.kind.startsWith('systems_check'))).toHaveLength(0);
    expect(s.coverage_note?.match(/no finished full Systems Check is on record yet/gi)).toHaveLength(1);
  });

  it('a failed automation run is an act risk; an empty period is "none recorded", never "no failures"', async () => {
    const failing = data(await ops(fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? { values: dist(['failed', 2], ['succeeded', 5]) } : undefined })));
    expect(fig(failing, 'operations.workflow_runs_recorded')?.value).toBe(7);
    expect(fig(failing, 'operations.workflow_runs_failed')?.value).toBe(2);
    expect(failing.risks.find((r) => r.kind === 'automation_runs_failed')).toMatchObject({ severity: 'act', summary: expect.stringMatching(/^2 automation runs failed in /) });

    const empty = data(await ops(fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? { values: dist() } : undefined })));
    expect(fig(empty, 'operations.workflow_runs_failed')).toBeUndefined();
    expect(fig(empty, 'operations.workflow_runs_recorded')?.label).toMatch(/none recorded; not a sign that automations are working/);
    expect(empty.coverage_note).toMatch(/no automation runs were recorded in this period/i);
    expect(JSON.stringify(empty)).not.toMatch(/no failures/i);
  });

  it('a PARTIAL runs read with nothing countable never says "none recorded" or zero', async () => {
    const s = data(await ops(fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? { values: dist(), truth: 'PARTIAL', excluded: 3 } : undefined })));
    const recorded = fig(s, 'operations.workflow_runs_recorded');
    expect(recorded?.value).toBeNull();
    expect(recorded?.label).not.toMatch(/none recorded/);
    expect(fig(s, 'operations.workflow_runs_failed')?.value).toBeNull();
    expect(s.coverage_note).toMatch(/some automation runs could not be counted, so a failed run cannot be ruled out/);
    expect(s.coverage_note).not.toMatch(/no automation runs were recorded/);
  });

  it('a PARTIAL runs read never claims 0 failed; a counted failure still stands', async () => {
    const clean = data(await ops(fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? { values: dist(['succeeded', 4]), truth: 'PARTIAL', excluded: 2 } : undefined })));
    expect(fig(clean, 'operations.workflow_runs_recorded')?.value).toBe(4);
    expect(fig(clean, 'operations.workflow_runs_failed')?.value).toBeNull();
    expect(clean.coverage_note).toMatch(/a failed run cannot be ruled out/);
    const failing = data(await ops(fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? { values: dist(['failed', 1], ['succeeded', 4]), truth: 'PARTIAL', excluded: 2 } : undefined })));
    expect(fig(failing, 'operations.workflow_runs_failed')?.value).toBe(1);
    expect(failing.risks.some((r) => r.kind === 'automation_runs_failed')).toBe(true);
  });

  it('below the newest-20 cap, deferred or missing checks keep the counts by priority and are not called unlisted problems', async () => {
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.exceptions
      ? { values: events(finding('website_connected', 'high', 1), finding('automation_wired', 'low', 2)), truth: 'PARTIAL', excluded: 2 }
      : undefined });
    const s = data(await ops(f));
    expect(fig(s, 'operations.exceptions_high')?.value).toBe(1);
    expect(fig(s, 'operations.exceptions_low')?.value).toBe(1);
    expect(fig(s, 'operations.exceptions_blocking')?.value).toBe(0);
    expect(s.coverage_note).toMatch(/2 Systems Check items were deferred, not recorded or unreadable, so they are not in the counts by priority/);
    expect(s.coverage_note).not.toMatch(/not listed/);
  });

  it('a failed automation run is never the risk trimmed when 20 Systems Check items fill the list', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => finding('company_info_populated', 'blocking', i + 1));
    const f = fakeCaller({ script: (k) => k === OPERATIONS_METRICS.exceptions ? { values: events(...twenty) }
      : k === OPERATIONS_METRICS.workflowRuns ? { values: dist(['failed', 1]) } : undefined });
    const s = data(await ops(f));
    expect(s.risks).toHaveLength(20);
    expect(s.risks[0].kind).toBe('automation_runs_failed');
    expect(s.coverage_note).toMatch(/1 more risks were left out for length/);
  });

  it('unknown run statuses are dropped and counted, never shown', async () => {
    const s = data(await ops(fakeCaller({ script: (k) => k === OPERATIONS_METRICS.workflowRuns ? { values: dist(['succeeded', 1], ['teleported', 3]) } : undefined })));
    expect(fig(s, 'operations.workflow_runs_recorded')?.value).toBe(1);
    expect(s.coverage_note).toMatch(/automation runs: 3 records in a category Paige does not recognise were left out/i);
    expect(JSON.stringify(s)).not.toContain('teleported');
  });

  it('a figure owned by another department is refused by shape, not read', async () => {
    const r = await ops(fakeCaller({ script: () => ({ owner: 'sales' }) }));
    expect(r).toEqual({ status: 'degraded', reason: 'metric_owner_unexpected', data: null });
  });

  it('a refusal (42501) makes the domain unavailable, never a zero', async () => {
    expect(await ops(fakeCaller({ script: () => ({ error: '42501' }) }))).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
  });

  it('stops before the next read once aborted, and refuses a foreign scope', async () => {
    const ac = new AbortController();
    ac.abort();
    const f = fakeCaller();
    expect(await ops(f, ac.signal)).toEqual({ status: 'degraded', reason: 'aborted', data: null });
    expect(f.issuedKeys()).toHaveLength(0);
    const other = await createOperationsSnapshotAdapter(f.caller, { tenantId: 'someone-else' }, clock).read(ctx());
    expect(other).toEqual({ status: 'degraded', reason: 'adapter_scope_mismatch', data: null });
  });
});

// ── clients ──────────────────────────────────────────────────────────────────────────────────────────

describe('clients adapter', () => {
  it('reads three metrics one at a time, in order, never two issuances in flight', async () => {
    const f = fakeCaller();
    data(await clients(f));
    expect(f.issuedKeys()).toEqual([CLIENTS_METRICS.active, CLIENTS_METRICS.lifecycle, CLIENTS_METRICS.onboarding]);
    expect(f.maxInFlight()).toBe(1);
  });

  it('always states what no governed source measures, and that leads live elsewhere', async () => {
    const s = data(await clients(fakeCaller()));
    expect(s.coverage).toBe('partial');
    expect(s.coverage_note).toMatch(/^New clients this period and clients at risk are not measured yet; leads are counted under sales\.$/);
    expect(s.changes).toEqual([]);
    expect(s.headline.every((m) => m.basis === 'point_in_time')).toBe(true);
  });

  it('active clients PARTIAL only by definition (paused/past clients left out) is not called incomplete', async () => {
    const f = fakeCaller({ script: (k) => k === CLIENTS_METRICS.active ? { values: count(1), truth: 'PARTIAL', excluded: 4 } : undefined });
    const s = data(await clients(f));
    expect(fig(s, 'clients.active')?.value).toBe(1);
    expect(s.coverage_note).not.toMatch(/incomplete/);
  });

  it('active clients with a real extra exclusion is called incomplete', async () => {
    const f = fakeCaller({ script: (k) => k === CLIENTS_METRICS.active
      ? { values: count(1), truth: 'PARTIAL', excluded: 2, exclusions: [{ reason: GENERIC, count: 1 }, { reason: 'Unreadable record', count: 1 }] }
      : undefined });
    expect(data(await clients(f)).coverage_note).toMatch(/active clients: the source marks this figure as incomplete/i);
  });

  it('folds the finance-worded stage into past clients; that word never appears anywhere', async () => {
    const f = fakeCaller({ script: (k) => k === CLIENTS_METRICS.lifecycle
      ? { values: dist(['client_active', 2], ['client_alumni', 1], ['client_churned', 1], ['client_funded', 2], ['client_paused', 3]) }
      : undefined });
    const s = data(await clients(f));
    expect(fig(s, 'clients.past')?.value).toBe(3);
    expect(fig(s, 'clients.paused')?.value).toBe(3);
    expect(fig(s, 'clients.churned')?.value).toBe(1);
    const r = await composeBusinessReview(f.caller, WHO, { timezone: 'UTC', focus: ['clients'] }, { now: NOW });
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(JSON.stringify(s)).not.toMatch(/fund/i);
    expect(JSON.stringify(r.snapshot)).not.toMatch(/fund/i);
    expect(r.projection).not.toMatch(/fund/i);
  });

  it('lead or unknown stages are dropped and counted, never shown and never a client', async () => {
    const f = fakeCaller({ script: (k) => k === CLIENTS_METRICS.lifecycle ? { values: dist(['client_paused', 1], ['hot_lead', 4]) } : undefined });
    const s = data(await clients(f));
    expect(s.coverage_note).toMatch(/clients by stage: 4 records in a category Paige does not recognise were left out/i);
    expect(JSON.stringify(s)).not.toContain('hot_lead');
    expect(s.headline.reduce((n, m) => n + (m.key === 'clients.paused' ? Number(m.value) : 0), 0)).toBe(1);
  });

  it('onboarding: steps bucketed by the stage whitelist; pre-invite is never counted as progress', async () => {
    const f = fakeCaller({ script: (k) => k === CLIENTS_METRICS.onboarding
      ? { values: dist(['completed', 2], ['invited', 1], ['pre_invite', 5], ['signing_agreement', 1], ['uploading_docs', 1]) }
      : undefined });
    const s = data(await clients(f));
    expect(fig(s, 'clients.onboarding_in_progress')?.value).toBe(3);
    expect(fig(s, 'clients.onboarding_completed')?.value).toBe(2);
    expect(s.coverage_note).not.toMatch(/recognise/);
  });

  it('clients only at the stage before the invitation are said so, not left as two silent zeros', async () => {
    const s = data(await clients(fakeCaller({ script: (k) => k === CLIENTS_METRICS.onboarding ? { values: dist(['pre_invite', 3]) } : undefined })));
    expect(fig(s, 'clients.onboarding_in_progress')?.value).toBe(0);
    expect(s.coverage_note).toMatch(/3 clients are at the stage before the onboarding invitation and not counted as onboarding/);
    expect(JSON.stringify(s)).not.toContain('pre_invite');
  });

  it('a gap found in this read survives the length bound; the standing note is what gets cut', async () => {
    const f = fakeCaller({ script: (k) => k === CLIENTS_METRICS.active
      ? { values: count(1), truth: 'PARTIAL', excluded: 2, exclusions: [{ reason: GENERIC, count: 1 }, { reason: 'Unreadable record', count: 1 }] }
      : k === CLIENTS_METRICS.lifecycle ? { values: dist(['client_paused', 1], ['hot_lead', 2]), truth: 'PARTIAL', excluded: 1 }
      : k === CLIENTS_METRICS.onboarding ? { truth: 'UNAVAILABLE' } : undefined });
    const s = data(await clients(f));
    expect(s.coverage_note).toMatch(/onboarding steps are not being recorded, so onboarding progress is unknown/i);
    expect(s.coverage_note!.length).toBeLessThanOrEqual(300);
  });

  it('a partial lifecycle read never infers a zero for a stage it returned nothing for', async () => {
    const s = data(await clients(fakeCaller({ script: (k) => k === CLIENTS_METRICS.lifecycle
      ? { values: dist(['client_active', 3], ['client_paused', 2]), truth: 'PARTIAL', excluded: 1 }
      : undefined })));
    expect(fig(s, 'clients.paused')?.value).toBe(2);
    expect(fig(s, 'clients.churned')?.value).toBeNull();
    expect(fig(s, 'clients.past')?.value).toBeNull();
    expect(s.coverage).toBe('partial');
  });

  it('a partial onboarding read never shows "0 part-way through" and says some onboarding is unrecorded', async () => {
    const s = data(await clients(fakeCaller({ script: (k) => k === CLIENTS_METRICS.onboarding
      ? { values: dist(['completed', 1]), truth: 'PARTIAL', excluded: 2 }
      : undefined })));
    expect(fig(s, 'clients.onboarding_in_progress')?.value).toBeNull();
    expect(fig(s, 'clients.onboarding_completed')?.value).toBe(1);
    expect(s.coverage_note).toMatch(/some clients' onboarding steps are not recorded/i);
  });

  it('onboarding not recorded is said in plain words, with no figure and never a zero', async () => {
    const s = data(await clients(fakeCaller({ script: (k) => k === CLIENTS_METRICS.onboarding ? { truth: 'UNAVAILABLE' } : undefined })));
    expect(s.headline.some((m) => m.key.startsWith('clients.onboarding'))).toBe(false);
    expect(s.coverage_note).toMatch(/onboarding steps are not being recorded/i);
  });

  it('no clients at all: nothing to onboard, not "everyone onboarded"', async () => {
    const s = data(await clients(fakeCaller({ script: (k) => k === CLIENTS_METRICS.onboarding ? { values: dist() } : k === CLIENTS_METRICS.lifecycle ? { values: dist() } : k === CLIENTS_METRICS.active ? { values: count(0) } : undefined })));
    expect(fig(s, 'clients.active')?.value).toBe(0);
    expect(s.headline.some((m) => m.key.startsWith('clients.onboarding'))).toBe(false);
    expect(s.coverage_note).toMatch(/there are no clients to onboard yet/i);
  });

  it('a refusal makes the domain unavailable; an unexpected owner is refused by shape', async () => {
    expect(await clients(fakeCaller({ script: () => ({ error: '42501' }) }))).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
    expect(await clients(fakeCaller({ script: () => ({ owner: 'operations_pmo' }) }))).toEqual({ status: 'degraded', reason: 'metric_owner_unexpected', data: null });
  });
});

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────────

describe('generalised issuer helpers', () => {
  it('the Sales interpreter still refuses non-Sales value kinds when asked for a Sales kind', () => {
    const metric = { truth_state: 'LIVE', coverage: { state: 'complete', excluded_count: 0 }, exclusions: [], owner_department: 'sales', values: { kind: 'distribution', items: [] } } as unknown as IssuerMetric;
    expect(interpretSalesMetric({ status: 'available', message: '', metric }, 'count')).toEqual({ failure: 'metric_shape_unexpected' });
  });

  it('closed buckets keep known keys, hide known-not-shown keys and count the unknown', () => {
    const metric = { values: { kind: 'distribution', items: [{ key: 'a', label: 'a', count: 2 }, { key: 'b', label: 'b', count: 1 }, { key: 'z', label: 'z', count: 4 }] } } as unknown as IssuerMetric;
    expect(closedBuckets(metric, { a: 'x', b: null })).toEqual({ counts: { x: 2 }, hidden: 1, dropped: 4, empty: false });
    // Own-property lookup: an inherited name is unknown, never a bucket.
    const proto = { values: { kind: 'distribution', items: [{ key: 'constructor', label: 'c', count: 1 }] } } as unknown as IssuerMetric;
    expect(closedBuckets(proto, {}).dropped).toBe(1);
  });

  it('plain time is UTC to the minute, and null for nonsense', () => {
    expect(plainUtcMinute('2026-10-11T09:02:59.999Z')).toBe('2026-10-11 09:02 UTC');
    expect(plainUtcMinute('not a time')).toBeNull();
    expect(plainUtcMinute(null)).toBeNull();
  });
});

// ── the composition ──────────────────────────────────────────────────────────────────────────────────

describe('composeBusinessReview with F2b', () => {
  it('operations and clients are read; a missing owner Game Plan contract is degraded and unmounted domains remain gaps', async () => {
    const f = fakeCaller();
    const r = await composeBusinessReview(f.caller, WHO, { timezone: 'UTC' }, { now: NOW });
    if (!('snapshot' in r)) throw new Error(r.reason);
    const d = r.snapshot.domains;
    for (const area of ['payments', 'sales_pipeline', 'operations', 'clients']) expect(d[area].status).toBe('available');
    expect(d.game_plan.status).toBe('degraded');
    expect(d.game_plan.reason).toBe('mission_review_unavailable');
    expect(d.game_plan.data).toBeNull();
    for (const area of ['work', 'campaigns', 'revenue', 'communications', 'email', 'bookings', 'outcomes']) {
      expect(d[area].status).toBe('unavailable');
      expect(d[area].reason).toMatch(/^no_adapter/);
    }
    data(d.operations);
    data(d.clients);
    expect(r.projection).toMatch(/\[Operations\] read at/);
    expect(r.projection).toMatch(/\[Clients\] read at/);
    expect(r.projection).toMatch(/\[Work and tasks\] NOT AVAILABLE/);
    expect(r.projection).toMatch(/Risk \(act\): "Systems Check: taking payment is not set up/);
    expect(JSON.stringify(r)).not.toMatch(/aneb_v1_/);
    // 8 F2a reads + 3 operations + 3 clients; each domain read its own keys only
    expect(f.issuedKeys().filter((k) => k.startsWith('operations.'))).toHaveLength(3);
    expect(f.issuedKeys().filter((k) => k.startsWith('business.'))).toHaveLength(3);
  });

  it('a refused seat leaves operations and clients NOT AVAILABLE with no zero headline', async () => {
    const f = fakeCaller({ script: () => ({ error: '42501' }) });
    const r = await composeBusinessReview(f.caller, WHO, { timezone: 'UTC', focus: ['operations', 'clients'] }, { now: NOW });
    if (!('snapshot' in r)) throw new Error(r.reason);
    expect(r.snapshot.domains.operations).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
    expect(r.snapshot.domains.clients).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
    expect(r.projection).toMatch(/\[Operations\] NOT AVAILABLE/);
    expect(r.projection).not.toMatch(/: 0 \(/);
  });
});
