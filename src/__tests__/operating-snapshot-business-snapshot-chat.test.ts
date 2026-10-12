// @vitest-environment node
/**
 * Operating Fabric F2 — the `get_business_snapshot` chat seam: the argument contract, the strict parser,
 * and the dispatch that maps one tool call to one business review and a bounded, honest tool result.
 *
 * Two kinds of test. Outcome mapping uses an injected composition so each result shape is pinned exactly.
 * End to end uses the real `composeBusinessReview` over a fake issuer whose payloads pass the real
 * `parseMetricResult` contract.
 */
import { describe, expect, it, vi } from 'vitest';
import { objectInputSchema } from '../../supabase/functions/_shared/capability-kit/mod.ts';
import {
  BUSINESS_SNAPSHOT_CAPABILITY_KEY,
  BUSINESS_SNAPSHOT_FALLBACK_TIMEZONE,
  BUSINESS_SNAPSHOT_INPUT_DEFINITION,
  BUSINESS_SNAPSHOT_READ_DOMAINS,
  BUSINESS_SNAPSHOT_TOOL_DESCRIPTION,
  BUSINESS_SNAPSHOT_TOOL_NAME,
  accountShapeForCallerTier,
  classifyBusinessSnapshot,
  dispatchBusinessSnapshotChat,
  parseBusinessSnapshotArgs,
  snapshotTimezone,
  type BusinessSnapshotChatContext,
} from '../../supabase/functions/_shared/paige-context/business-snapshot-chat.ts';
import type { BusinessReviewResult } from '../../supabase/functions/_shared/paige-context/business-review.ts';
import {
  resolveSnapshotPeriod,
  SNAPSHOT_REASON,
  type BusinessOperatingSnapshot,
  type DomainSnapshot,
  type SnapshotDomain,
} from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import { contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult } from '../../supabase/functions/_shared/paige-context/mod.ts';

const TENANT = 'a3400000-0000-4000-8000-0000000000c7';
const OTHER = 'a3400000-0000-4000-8000-0000000000d8';
const NOW = new Date('2026-10-12T12:00:00.000Z');
const NOW_MS = NOW.getTime();

const ctx = (over: Partial<BusinessSnapshotChatContext> = {}): BusinessSnapshotChatContext => ({
  actorId: 'actor-chat', tenantId: TENANT, role: 'owner', accountShape: 'solo', userTimezone: 'America/New_York',
  toolName: BUSINESS_SNAPSHOT_TOOL_NAME, args: {}, ...over,
});

function period() {
  const r = resolveSnapshotPeriod({ key: 'last_7_days', now: NOW, timezone: 'UTC' });
  if ('reason' in r) throw new Error(r.reason);
  return r.period;
}

/** A composed snapshot with chosen per-domain results; every other requested domain is `no_adapter`. */
function snapshotWith(results: Partial<Record<SnapshotDomain, ContextSourceResult<DomainSnapshot>>>, requested?: SnapshotDomain[]): BusinessOperatingSnapshot {
  const req = requested ?? [...BUSINESS_SNAPSHOT_READ_DOMAINS, 'campaigns'];
  const domains: Record<string, ContextSourceResult<DomainSnapshot>> = {};
  for (const d of req) {
    const r = results[d] ?? contextUnavailable(SNAPSHOT_REASON.noAdapter);
    domains[d] = { status: r.status, reason: r.reason, data: r.data } as ContextSourceResult<DomainSnapshot>;
  }
  return {
    version: 1, tenant_id: TENANT, actor_id: 'actor-chat', account_shape: 'solo', period: period(), composed_at: NOW.toISOString(),
    requested: req, domains, degradation: [], budget: { adapters_run: 4, timed_out: [], truncated: [] },
  };
}
const refusedAll = () => Object.fromEntries(BUSINESS_SNAPSHOT_READ_DOMAINS.map((d) => [d, contextUnavailable('metric_read_refused')]));
const reviewOf = (s: BusinessOperatingSnapshot): BusinessReviewResult => ({ ok: true, snapshot: s, projection: 'Business read for the last 7 days. Report only what is listed above.' });
const composeReturning = (r: BusinessReviewResult) => vi.fn(async () => r);
const noCaller = { rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })) };

// ── argument contract ────────────────────────────────────────────────────────────────────────────────

describe('argument contract', () => {
  it('is a valid capability-kit input definition, and the built schema refuses extra fields', () => {
    const schema = objectInputSchema(BUSINESS_SNAPSHOT_INPUT_DEFINITION) as unknown as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as object).sort()).toEqual(['custom_end', 'custom_start', 'focus', 'period']);
    expect(schema.required).toEqual([]);
  });

  it('names exactly one tool and one Spine key', () => {
    expect(BUSINESS_SNAPSHOT_TOOL_NAME).toBe('get_business_snapshot');
    expect(BUSINESS_SNAPSHOT_CAPABILITY_KEY).toBe('business.operating_snapshot');
  });

  it('the description never invites ad-spend estimates, currency sums or memory writes, and stays platform-generic (§2)', () => {
    const d = BUSINESS_SNAPSHOT_TOOL_DESCRIPTION;
    expect(d).toMatch(/never state or estimate those/);
    expect(d).toMatch(/Do not add currencies together/);
    expect(d).toMatch(/Do not store these figures as memory/);
    expect(d).toMatch(/at the same time as read_business_metric/);
    expect(d).not.toMatch(/credit|funding|loan|lend|financ/i);
    expect(d.length).toBeLessThan(1600);
  });
});

describe('parseBusinessSnapshotArgs', () => {
  it('no arguments is the whole default review', () => {
    expect(parseBusinessSnapshotArgs(undefined)).toEqual({ ok: true, args: {} });
    expect(parseBusinessSnapshotArgs({})).toEqual({ ok: true, args: {} });
  });

  it('keeps a valid period, custom bounds and focus (trimmed)', () => {
    expect(parseBusinessSnapshotArgs({ period: 'custom', custom_start: ' 2026-10-01 ', custom_end: '2026-10-08', focus: [' Payments ', 'clients'] }))
      .toEqual({ ok: true, args: { period: 'custom', customStart: '2026-10-01', customEnd: '2026-10-08', focus: ['Payments', 'clients'] } });
  });

  it.each([
    ['tenant_id', TENANT], ['workspace_id', TENANT], ['actor_id', 'x'], ['user_id', 'x'], ['role', 'super_admin'],
    ['timezone', 'Asia/Tokyo'], ['time_zone', 'UTC'], ['tz', 'UTC'], ['account_id', TENANT],
  ])('refuses a model-supplied identity field (%s) and says it comes from the session', (key, value) => {
    const r = parseBusinessSnapshotArgs({ [key]: value });
    expect(r.ok).toBe(false);
    if ('fix' in r) {
      expect(r.fix).toMatch(/signed-in session/);
      expect(r.fix).not.toContain(String(value));
    }
  });

  it('refuses any other unknown field', () => {
    const r = parseBusinessSnapshotArgs({ metric_key: 'sales.cash.recorded_received' });
    expect(r.ok).toBe(false);
    if ('fix' in r) expect(r.fix).toMatch(/only a period/);
  });

  it.each([
    [{ period: 'this_week' }],
    [{ period: 7 }],
    [{ custom_start: '2026-10-01', custom_end: '2026-10-08' }],
    [{ period: 'last_7_days', custom_start: '2026-10-01' }],
    [{ period: 'custom', custom_start: '' }],
    [{ period: 'custom', custom_start: 'x'.repeat(41) }],
    [{ period: 'custom', custom_end: 20261008 }],
    [{ focus: 'payments' }],
    [{ focus: [1] }],
    [{ focus: [''] }],
    [{ focus: ['p'.repeat(41)] }],
    [{ focus: Array.from({ length: 13 }, () => 'payments') }],
    ['payments'],
    [['payments']],
    [null],
    [new Date(0)],
    [new Map([['period', 'today']])],
  ])('refuses a malformed request %#', (raw) => {
    expect(parseBusinessSnapshotArgs(raw).ok).toBe(false);
  });
});

describe('accountShapeForCallerTier', () => {
  it('maps only the tiers that run their own business; agency, operator and client get no shape', () => {
    expect(accountShapeForCallerTier('tenant')).toBe('solo');
    expect(accountShapeForCallerTier('subaccount')).toBe('sub_account');
    for (const t of ['agency', 'god', 'client', undefined, null, 'TENANT']) expect(accountShapeForCallerTier(t)).toBeNull();
  });
});

describe('snapshotTimezone', () => {
  it('uses the client-reported zone when readable, otherwise UTC — never a model value', () => {
    expect(snapshotTimezone('America/New_York')).toBe('America/New_York');
    expect(snapshotTimezone(undefined)).toBe(BUSINESS_SNAPSHOT_FALLBACK_TIMEZONE);
    expect(snapshotTimezone('')).toBe('UTC');
    expect(snapshotTimezone(42)).toBe('UTC');
    // Within the request schema's 80 characters the zone is passed on, so an unknown one is REFUSED by the
    // period resolver rather than silently replaced; only a value the schema would reject becomes UTC.
    expect(snapshotTimezone('Etc/' + 'A'.repeat(76))).toBe('Etc/' + 'A'.repeat(76));
    expect(snapshotTimezone('A'.repeat(81))).toBe('UTC');
  });
});

// ── dispatch: what is refused before anything is read ───────────────────────────────────────────────

describe('dispatch refuses before reading', () => {
  it.each([
    ['another tool name', { toolName: 'read_business_metric' }],
    ['no active business', { tenantId: null }],
    ['a workspace that is not an id', { tenantId: 'acme' }],
    ['no signed-in person', { actorId: '' }],
    ['no account shape (agency, operator or client lens)', { accountShape: null }],
    ['an agency lens (§61: resell, not operator use)', { accountShape: 'agency' }],
    ['the platform operator lens', { accountShape: 'operator' }],
    ['a model-supplied tenant', { args: { tenant_id: OTHER } }],
    ['a model-supplied time zone', { args: { timezone: 'Asia/Tokyo' } }],
    ['a malformed period', { args: { period: 'forever' } }],
  ])('%s → invalid, composition never called, no RPC', async (_label, over) => {
    const compose = vi.fn();
    const caller = { rpc: vi.fn() };
    const r = await dispatchBusinessSnapshotChat(ctx(over as Partial<BusinessSnapshotChatContext>), { caller, compose });
    expect(r.outcome).toBe('invalid');
    expect(r.content.success).toBe(false);
    expect(String(r.content.note)).toMatch(/Nothing was read/);
    expect(r.snapshot).toBeUndefined();
    expect(compose).not.toHaveBeenCalled();
    expect(caller.rpc).not.toHaveBeenCalled();
  });
});

describe('dispatch passes only session identity and the reported zone', () => {
  it('who comes from the context; the time zone is the reported one; the args become the request', async () => {
    const compose = composeReturning(reviewOf(snapshotWith({ payments: contextAvailable({} as DomainSnapshot) })));
    await dispatchBusinessSnapshotChat(ctx({ args: { period: 'last_30_days', focus: ['payments'] } }), { caller: noCaller, compose }, { now: NOW });
    expect(compose).toHaveBeenCalledTimes(1);
    const [caller, who, request, opts] = compose.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>, unknown];
    expect(caller).toBe(noCaller);
    expect(who).toEqual({ actorId: 'actor-chat', tenantId: TENANT, role: 'owner', accountShape: 'solo' });
    expect(request).toEqual({ period: 'last_30_days', timezone: 'America/New_York', customStart: undefined, customEnd: undefined, focus: ['payments'] });
    expect(opts).toEqual({ now: NOW });
  });

  it('a context without a role passes null, never a guess (the issuer re-resolves the seat)', async () => {
    const compose = composeReturning(reviewOf(snapshotWith({})));
    const { role: _r, ...bare } = ctx();
    await dispatchBusinessSnapshotChat(bare, { caller: noCaller, compose });
    expect((compose.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).toEqual({ actorId: 'actor-chat', tenantId: TENANT, role: null, accountShape: 'solo' });
  });

  it.each(['sub_account', 'enterprise'] as const)('a %s workspace is read', async (shape) => {
    const compose = composeReturning(reviewOf(snapshotWith({})));
    await dispatchBusinessSnapshotChat(ctx({ accountShape: shape }), { caller: noCaller, compose });
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('an absent reported zone becomes UTC explicitly', async () => {
    const compose = composeReturning(reviewOf(snapshotWith({})));
    await dispatchBusinessSnapshotChat(ctx({ userTimezone: undefined }), { caller: noCaller, compose });
    expect((compose.mock.calls[0] as unknown as [unknown, unknown, { timezone: string }])[2].timezone).toBe('UTC');
  });
});

// ── dispatch: outcome mapping ───────────────────────────────────────────────────────────────────────

describe('outcome mapping', () => {
  it('a period the resolver refuses → invalid with the plain fix (unrecognised device zone)', async () => {
    const compose = composeReturning({ ok: false, reason: 'invalid_timezone' });
    const r = await dispatchBusinessSnapshotChat(ctx({ userTimezone: 'Mars/Olympus' }), { caller: noCaller, compose });
    expect(r.outcome).toBe('invalid');
    expect(String(r.content.fix)).toMatch(/time zone was not recognised/);
    expect(JSON.stringify(r.content)).not.toContain('Mars/Olympus');
  });

  it('at least one area read → succeeded; the review goes to the model, the structured snapshot does not', async () => {
    const s = snapshotWith({ payments: contextAvailable({} as DomainSnapshot), clients: contextDegraded('metric_evidence_not_verified') });
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: noCaller, compose: composeReturning(reviewOf(s)) });
    expect(r.outcome).toBe('succeeded');
    expect(r.content).toEqual({ success: true, period: 'the last 7 days', review: expect.stringContaining('Report only what is listed'), note: expect.stringMatching(/read only/) });
    expect(r.snapshot).toBe(s);
    expect(JSON.stringify(r.content)).not.toContain(TENANT);
  });

  it('every read area refused → refused, no review text, never "you lack access", no retry under another identity', async () => {
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: noCaller, compose: composeReturning(reviewOf(snapshotWith(refusedAll()))) });
    expect(r.outcome).toBe('refused');
    expect(r.content.code).toBe('review_not_authorized');
    expect(r.content.review).toBeUndefined();
    expect(String(r.content.note)).toMatch(/owners and admins/);
    expect(String(r.content.note)).toMatch(/Do not retry under another identity/);
    expect(JSON.stringify(r.content)).not.toMatch(/lack access|not allowed|permission denied/i);
  });

  it('some refused and some unreadable → unavailable, not refused (a race is not a verdict)', async () => {
    const s = snapshotWith({ ...refusedAll(), clients: contextDegraded('metric_source_unavailable') });
    expect(classifyBusinessSnapshot(s)).toBe('unavailable');
  });

  it('the workspace check voided every area → unavailable, active_business_unconfirmed, never "you switched"', async () => {
    const changed = Object.fromEntries([...BUSINESS_SNAPSHOT_READ_DOMAINS, 'campaigns'].map((d) => [d, contextDegraded(SNAPSHOT_REASON.scopeChanged)]));
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: noCaller, compose: composeReturning(reviewOf(snapshotWith(changed))) });
    expect(r.outcome).toBe('unavailable');
    expect(r.content.code).toBe('active_business_unconfirmed');
    expect(r.content.review).toBeUndefined();
    expect(JSON.stringify(r.content)).not.toMatch(/business changed|you switched/i);
  });

  it('nothing readable → unavailable WITH the review, which names every unknown area', async () => {
    const s = snapshotWith(Object.fromEntries(BUSINESS_SNAPSHOT_READ_DOMAINS.map((d) => [d, contextDegraded('metric_source_unavailable')])));
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: noCaller, compose: composeReturning(reviewOf(s)) });
    expect(r.outcome).toBe('unavailable');
    expect(r.content.code).toBe('review_unavailable');
    expect(typeof r.content.review).toBe('string');
    expect(String(r.content.note)).toMatch(/unknown, not zero/);
  });

  it('only areas that are not read here were asked for → unavailable, worded as not readable here, not "just now"', async () => {
    const s = snapshotWith({}, ['campaigns', 'paid_acquisition']);
    expect(classifyBusinessSnapshot(s)).toBe('unavailable');
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: noCaller, compose: composeReturning(reviewOf(s)) });
    expect(String(r.content.error)).toMatch(/can be read in a business review yet/);
    expect(String(r.content.error)).not.toMatch(/just now/);
  });

  it('a composition that throws → failed, never a figure, and logged by error name only (§32)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const compose = vi.fn(async () => { throw new TypeError('secret payload ' + TENANT); });
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: noCaller, compose });
    expect(spy).toHaveBeenCalledWith('[business-snapshot] compose failed:', 'TypeError');
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TENANT);
    spy.mockRestore();
    expect(r.outcome).toBe('failed');
    expect(r.snapshot).toBeUndefined();
    expect(String(r.content.note)).toMatch(/do not state any figure/);
  });
});

// ── end to end over a fake issuer ────────────────────────────────────────────────────────────────────

type Values =
  | { kind: 'count'; count: number }
  | { kind: 'distribution'; items: { key: string; label: string; count: number }[] }
  | { kind: 'diagnostic_events'; items: unknown[] }
  | { kind: 'currency_totals'; by_currency: { currency: string; amount_minor: string; record_count: number }[]; breakdown: [] };

const SNAPSHOT_KEYS = new Set([
  'business.active_clients_current', 'business.lifecycle_current', 'business.onboarding_current',
  'operations.current_system_exceptions', 'operations.unresolved_findings_current',
  'sales.opportunities.open_current', 'sales.pipeline.open_value', 'sales.receivables.outstanding_current', 'sales.receivables.overdue_current',
]);
const owner = (key: string) => key.startsWith('sales.') ? 'sales' : key.startsWith('business.') ? 'client_experience' : 'operations_pmo';
function values(key: string): Values {
  if (key === 'operations.current_system_exceptions') return { kind: 'diagnostic_events', items: [] };
  if (key === 'operations.recorded_workflow_runs') return { kind: 'distribution', items: [{ key: 'succeeded', label: 'succeeded', count: 2 }] };
  if (key === 'business.lifecycle_current') return { kind: 'distribution', items: [{ key: 'client_active', label: 'client_active', count: 3 }] };
  if (key === 'business.onboarding_current') return { kind: 'distribution', items: [{ key: 'completed', label: 'completed', count: 3 }] };
  if (key.startsWith('sales.cash') || key.startsWith('sales.receivables') || key === 'sales.pipeline.open_value') {
    return { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '125000', record_count: 2 }], breakdown: [] };
  }
  return { kind: 'count', count: 3 };
}

function fakeIssuer(opts: { refuseIssue?: boolean; scope?: (n: number) => string; scopeError?: (n: number) => boolean; scopeHang?: (n: number) => boolean } = {}) {
  const calls: string[] = [];
  const store = new Map<string, Record<string, unknown>>();
  let scopeCalls = 0;
  let refs = 0;
  const caller = {
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push(name);
      if (name === 'current_user_tenant_id') {
        scopeCalls += 1;
        if (opts.scopeHang?.(scopeCalls)) return new Promise<never>(() => {});
        if (opts.scopeError?.(scopeCalls)) return { data: null, error: { code: '57014' } };
        return { data: opts.scope ? opts.scope(scopeCalls) : TENANT, error: null };
      }
      if (name === 'issue_analytics_evidence_bundle') {
        if (opts.refuseIssue) return { data: null, error: { code: '42501' } };
        const key = String(args?.p_metric_key);
        const v = values(key);
        const contributing = v.kind === 'count' ? v.count : v.kind === 'distribution' ? v.items.reduce((n, i) => n + i.count, 0) : v.kind === 'diagnostic_events' ? v.items.length : 1;
        refs += 1;
        const ref = 'aneb_v1_' + refs.toString(16).padStart(64, '0');
        const result = {
          metric_key: key, metric_version: '1.0.0', owner_department: owner(key), label: 'Label', definition: 'Definition.', formula: 'Formula.',
          range: { key: args?.p_range_key, start: args?.p_range_start, end: args?.p_range_end, bounds: '[start,end)', timezone: 'UTC',
            semantics: SNAPSHOT_KEYS.has(key) ? 'current_snapshot' : 'event_timestamp_cohort' },
          dimensions: {}, values: v, unit: v.kind === 'currency_totals' ? 'currency_minor' : 'count', source_refs: ['public.x'],
          as_of: NOW.toISOString(), freshness: { queried_at: NOW.toISOString(), source_updated_through: key.startsWith('operations.') ? NOW.toISOString() : null },
          coverage: { state: 'complete', candidate_count: contributing, contributing_count: contributing, excluded_count: 0 },
          exclusions: [], truth_state: 'LIVE', caveats: [], source_revision_ref: 'sr_v1_' + 'c'.repeat(64), account_epoch: TENANT,
          account_epoch_ref: 'ae_v1_' + 'd'.repeat(64), evidence_ref: ref, reference_expires_at: new Date(NOW_MS + 900_000).toISOString(),
        };
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
  return { caller, calls };
}
const e2e = { now: NOW, clock: () => NOW_MS, timeoutMs: 2000 };

describe('end to end over the real composition', () => {
  it('an owner with readable sources → succeeded; the tool result carries no evidence reference or tenant id and stays bounded', async () => {
    const f = fakeIssuer();
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: f.caller }, e2e);
    expect(r.outcome).toBe('succeeded');
    const wire = JSON.stringify(r.content);
    expect(wire).not.toMatch(/aneb_v1_|ae_v1_/);
    expect(wire).not.toContain(TENANT);
    expect(wire.length).toBeLessThan(8000);
    expect(String(r.content.review)).toMatch(/NOT AVAILABLE/);
    for (const d of BUSINESS_SNAPSHOT_READ_DOMAINS) expect([d, r.snapshot?.domains[d]?.status, r.snapshot?.domains[d]?.reason]).toEqual([d, "available", undefined]);
  });

  it('every issuance refused (a member, or another seat the issuer does not admit) → refused', async () => {
    const r = await dispatchBusinessSnapshotChat(ctx({ role: 'member' }), { caller: fakeIssuer({ refuseIssue: true }).caller }, e2e);
    expect(r.outcome).toBe('refused');
    expect(r.content.code).toBe('review_not_authorized');
  });

  it.each([
    ['the active business switches after the reads', { scope: (n: number) => (n === 1 ? TENANT : OTHER) }],
    ['the workspace check errors', { scopeError: (n: number) => n > 1 }],
    ['the workspace check never answers', { scopeHang: (n: number) => n > 1 }],
  ])('%s → active_business_unconfirmed, no figure survives, no claim of a switch', async (_label, opts) => {
    const f = fakeIssuer(opts);
    const r = await dispatchBusinessSnapshotChat(ctx(), { caller: f.caller }, { ...e2e, timeoutMs: 50 });
    expect(r.outcome).toBe('unavailable');
    expect(r.content.code).toBe('active_business_unconfirmed');
    expect(JSON.stringify(r.content)).not.toMatch(/125000|1,250|business changed/);
  });

  it('a focus on an area that is not read here issues no metric read at all', async () => {
    const f = fakeIssuer();
    const r = await dispatchBusinessSnapshotChat(ctx({ args: { focus: ['ads'] } }), { caller: f.caller }, e2e);
    expect(r.outcome).toBe('unavailable');
    expect(f.calls.filter((c) => c === 'issue_analytics_evidence_bundle')).toHaveLength(0);
    expect(String(r.content.review)).toMatch(/ad spend/i);
  });
});
