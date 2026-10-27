// @vitest-environment node
// Media credit seam — the pure decision core: whole-credit conversion (never
// reserve less than the estimate), allowance notice bands, the ledger RPC
// result parser, and the platform spend guard's deliberate degrade posture.
// The SQL invariants (append-only, closure, anti-leakage release gate,
// lazy mint) are covered by the migration's pgTAP suite in CI
// (supabase/tests/media_credit_ledger.sql) — this file owns the edge logic.
import { describe, expect, it } from "vitest";
import { allowanceNoticeBand, estimateCredits } from "../../supabase/functions/_shared/media-provider/credits.ts";
import { decidePlatformSpendGuard } from "../../supabase/functions/_shared/media-provider/budget.ts";
import { MEDIA_CREDIT_PACKS } from "../../supabase/functions/_shared/media-provider/config.ts";

describe("estimateCredits — whole credits, rounding UP (never under-reserve)", () => {
  it("converts a $0.039 image to 4 credits at $0.01/credit", () => {
    expect(estimateCredits(0.039, 0.01)).toBe(4);
  });
  it("exact cents convert exactly", () => {
    expect(estimateCredits(0.75, 0.01)).toBe(75);
    expect(estimateCredits(4.0, 0.01)).toBe(400);
  });
  it("a $0.75 fast video reserves 75 credits; a $4.00 standard video 400", () => {
    expect(estimateCredits(0.75, 0.01)).toBe(75);
    expect(estimateCredits(4.0, 0.01)).toBe(400);
  });
  it("degenerate inputs reserve the minimum 1 credit, never 0 or NaN", () => {
    expect(estimateCredits(0, 0.01)).toBe(1);
    expect(estimateCredits(-1, 0.01)).toBe(1);
    expect(estimateCredits(NaN, 0.01)).toBe(1);
    expect(estimateCredits(0.039, 0)).toBe(4); // bad config falls back to $0.01
  });
});

describe("allowanceNoticeBand — the 50/80/100 notices", () => {
  it("is quiet below 50%", () => {
    expect(allowanceNoticeBand(100, 300)).toBeNull();
    expect(allowanceNoticeBand(149, 300)).toBeNull();
  });
  it("fires at 50, 80, and 100 exactly", () => {
    expect(allowanceNoticeBand(150, 300)).toBe(50);
    expect(allowanceNoticeBand(240, 300)).toBe(80);
    expect(allowanceNoticeBand(300, 300)).toBe(100);
    expect(allowanceNoticeBand(400, 300)).toBe(100);
  });
  it("a zero allowance never notifies (nothing to measure against)", () => {
    expect(allowanceNoticeBand(50, 0)).toBeNull();
  });
});

describe("decidePlatformSpendGuard — informational totals (billing supersession 2026-10-27)", () => {
  it("NEVER blocks: totals past any former ceiling still allow, riding along for alerting", () => {
    const v = decidePlatformSpendGuard({ platformAccruedUsd: 24.9, platformCeilingUsd: 25, estimatedCostUsd: 0.2 });
    expect(v.ok).toBe(true);
    expect(v.platformAccruedUsd).toBe(24.9);
  });
  it("an unreadable accrual also allows (the total renders as unknown)", () => {
    const v = decidePlatformSpendGuard({ platformAccruedUsd: null, platformCeilingUsd: 25, estimatedCostUsd: 0.2 });
    expect(v.ok).toBe(true);
    expect(v.platformAccruedUsd).toBeNull();
  });
});


describe("MEDIA_CREDIT_PACKS — the >=20% contribution-margin product rule", () => {
  const PROCESSING_PCT = 0.029;
  const PROCESSING_FIXED = 0.3;
  it("every pack clears 20% contribution margin after payment processing", () => {
    for (const pack of MEDIA_CREDIT_PACKS) {
      const providerCost = pack.credits * 0.01;
      const net = pack.priceUsd - PROCESSING_PCT * pack.priceUsd - PROCESSING_FIXED;
      const margin = (net - providerCost) / pack.priceUsd;
      expect(margin).toBeGreaterThanOrEqual(0.2);
    }
  });
  it("credits are whole numbers and prices are the configured trio", () => {
    expect(MEDIA_CREDIT_PACKS.map((p) => p.priceUsd)).toEqual([5, 15, 40]);
    for (const pack of MEDIA_CREDIT_PACKS) {
      expect(Number.isInteger(pack.credits)).toBe(true);
    }
  });
});
