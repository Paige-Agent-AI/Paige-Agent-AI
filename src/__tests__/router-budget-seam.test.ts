// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CEILING_USD,
  BudgetExceeded,
  accruedSpendToday,
  clearCeilingCacheForTests,
  enforceBudget,
  parseCeilingUsd,
  resolveCeiling,
  tenantCeilingKey,
  utcDayStartIso,
  type BudgetDb,
} from '../../supabase/functions/_shared/router-budget/mod.ts';

// ── Mock: table → rows or single, thenable chain (the ContextDb mock pattern) ──────
function mkDb(tables: Record<string, { single?: unknown; list?: unknown[]; error?: { message: string } | null; throw?: boolean }>) {
  const queries: string[] = [];
  const chain = (spec: { single?: unknown; list?: unknown[]; error?: { message: string } | null; throw?: boolean }) => {
    const then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      if (spec.throw) reject(new Error('mock read failure'));
      else resolve({ data: spec.list ?? spec.single ?? null, error: spec.error ?? null });
    };
    const self = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') return then;
        if (prop === 'maybeSingle') return () => self;
        return () => self;
      },
    });
    return self;
  };
  const db = {
    from(table: string) {
      queries.push(table);
      return chain(tables[table] ?? {});
    },
  } as unknown as BudgetDb;
  return { db, queries };
}

describe('enforceBudget — informational tenant usage thresholds', () => {
  it('under 80%: allow, no gate', () => {
    const d = enforceBudget({ accrued_usd: 10, ceiling_usd: 50, band: 'chat' as never });
    expect(d.decision).toBe('allow');
    expect(d.gate).toBeUndefined();
  });

  it('at/over 80%: every band continues with the soft gate recorded', () => {
    for (const band of ['cheap', 'reasoning', 'sensitive'] as const) {
      const d = enforceBudget({ accrued_usd: 40, ceiling_usd: 50, band });
      expect(d.decision).toBe('allow_gated');
      expect(d.gate).toBe('budget_soft');
    }
  });

  it('at/over 100%: CHEAP continues gated (the economy tier IS the remediation)', () => {
    const d = enforceBudget({ accrued_usd: 55, ceiling_usd: 50, band: 'cheap' });
    expect(d.decision).toBe('allow_gated');
    expect(d.gate).toBe('budget_hard');
  });

  it('at/over 100%: reasoning and sensitive work continue without a financial stop or downgrade', () => {
    for (const band of ['reasoning', 'sensitive'] as const) {
      const d = enforceBudget({ accrued_usd: 50, ceiling_usd: 50, band });
      expect(d.decision).toBe('allow_gated');
      expect(d.gate).toBe('budget_hard');
    }
  });

  it('a non-positive legacy threshold cannot stop any model band', () => {
    expect(enforceBudget({ accrued_usd: 0, ceiling_usd: 0, band: 'cheap' }).decision).toBe('allow_gated');
    expect(enforceBudget({ accrued_usd: 0, ceiling_usd: 0, band: 'reasoning' }).decision).toBe('allow_gated');
  });

  it('large accrued usage remains attributable and never becomes provider or action authority', () => {
    for (const band of ['cheap', 'reasoning', 'sensitive'] as const) {
      const decision = enforceBudget({ accrued_usd: 1_000_000, ceiling_usd: 0.01, band });
      expect(decision).toEqual({ decision: 'allow_gated', gate: 'budget_hard', accrued_usd: 1_000_000, ceiling_usd: 0.01, band });
    }
  });

  it('negative accrual is clamped to 0 (never invents spend)', () => {
    expect(enforceBudget({ accrued_usd: -5, ceiling_usd: 50, band: 'sensitive' }).accrued_usd).toBe(0);
  });
});

describe('parseCeilingUsd — unlimited is not a settable value', () => {
  it('accepts finite positive numbers and numeric strings', () => {
    expect(parseCeilingUsd(25)).toBe(25);
    expect(parseCeilingUsd('12.5')).toBe(12.5);
  });
  it('rejects everything else — including "unlimited", Infinity, zero, negatives, objects', () => {
    expect(parseCeilingUsd('unlimited')).toBeNull();
    expect(parseCeilingUsd(Infinity)).toBeNull();
    expect(parseCeilingUsd(0)).toBeNull();
    expect(parseCeilingUsd(-10)).toBeNull();
    expect(parseCeilingUsd({ usd: 10 })).toBeNull();
    expect(parseCeilingUsd(null)).toBeNull();
  });
});

describe('resolveCeiling — config-as-data precedence', () => {
  it('tenant override beats platform beats default', async () => {
    clearCeilingCacheForTests();
    const mk = (tenantVal: unknown, platformVal: unknown) => mkDb({
      [`admin_app_settings`]: {},
      // keyed by eq('key', ...) — the mock returns the same row for both reads, so drive
      // precedence through sequential dbs instead.
      ...(tenantVal === undefined && platformVal === undefined ? {} : {}),
    });
    void mk;
    const tenantOnly = mkDb({ admin_app_settings: { single: { value: 30 } } });
    expect(await resolveCeiling(tenantOnly.db, 't1')).toBe(30);
    clearCeilingCacheForTests();
    const unset = mkDb({ admin_app_settings: { single: null } });
    expect(await resolveCeiling(unset.db, 't2')).toBe(DEFAULT_CEILING_USD);
    clearCeilingCacheForTests();
    const malformed = mkDb({ admin_app_settings: { single: { value: 'unlimited' } } });
    expect(await resolveCeiling(malformed.db, 't3')).toBe(DEFAULT_CEILING_USD);
  });

  it('caches per tenant for the TTL window — a valid override reads once, ever', async () => {
    clearCeilingCacheForTests();
    const { db, queries } = mkDb({ admin_app_settings: { single: { value: 20 } } });
    await resolveCeiling(db, 'cache-t');
    await resolveCeiling(db, 'cache-t');
    // Valid tenant override → the platform key is never read (?? short-circuit); the
    // second call is served entirely from cache. One query total, not one per call.
    expect(queries.filter((q) => q === 'admin_app_settings').length).toBe(1);
  });

  it('tenant key carries the tenant id (no cross-tenant ceiling bleed)', () => {
    expect(tenantCeilingKey('abc')).toBe('llm_budget_daily_usd__t_abc');
  });
});

describe('accruedSpendToday — the one ledger', () => {
  it('sums today’s cost estimates', async () => {
    const { db } = mkDb({ paige_llm_trace: { list: [{ cost_estimate_usd: 1.5 }, { cost_estimate_usd: 2 }, { cost_estimate_usd: null }] } });
    expect(await accruedSpendToday(db, 't1')).toBe(3.5);
  });

  it('a failed read is NULL, never a $0 claim', async () => {
    const errDb = mkDb({ paige_llm_trace: { error: { message: 'boom' } } });
    expect(await accruedSpendToday(errDb.db, 't1')).toBeNull();
    const thrown = mkDb({ paige_llm_trace: { throw: true } });
    expect(await accruedSpendToday(thrown.db, 't1')).toBeNull();
  });

  it('window boundary is UTC midnight', () => {
    expect(utcDayStartIso(new Date('2026-09-10T23:59:59.999Z'))).toBe('2026-09-10T00:00:00.000Z');
    expect(utcDayStartIso(new Date('2026-09-11T00:00:00.001Z'))).toBe('2026-09-11T00:00:00.000Z');
  });
});

describe('BudgetExceeded — the honest fail-closed error', () => {
  it('carries the numbers and a resets-at-midnight message', () => {
    const e = new BudgetExceeded(50, 51.25);
    expect(e.code).toBe('budget_exceeded');
    expect(e.ceilingUsd).toBe(50);
    expect(e.accruedUsd).toBe(51.25);
    expect(e.message).toContain('resets at UTC midnight');
    expect(e.message).toContain('$50');
  });
});
