// @vitest-environment node
// Media budget + approval policy — the pure decision core of the media seam.
// The OWNER BILLING SUPERSESSION (2026-10-27, ANT-162) removed every monetary
// stop: spend totals are informational and never interrupt a job. These tests
// pin that (the old fail-closed rulings are superseded), and pin the RETAINED
// approval boundary (draft allowance / premium / video-always) unchanged.
import { describe, expect, it } from "vitest";
import {
  decideMediaBudget,
  mediaBand,
  resolveApprovalPolicy,
} from "../../supabase/functions/_shared/media-provider/budget.ts";

describe("media approval boundary — ACTION-SPECIFIC only (billing supersession + correction a42e0598)", () => {
  it("video ALWAYS requires approval, whatever the estimate", () => {
    expect(resolveApprovalPolicy({ mode: "video", tier: "standard", estimatedCostUsd: 0.01, draftAllowanceUsd: 0.1 }))
      .toEqual({ approvalRequired: true, reason: "video_requires_approval" });
  });

  it("premium models always require confirmation", () => {
    expect(resolveApprovalPolicy({ mode: "image", tier: "premium", estimatedCostUsd: 0.04, draftAllowanceUsd: 0.1 }))
      .toEqual({ approvalRequired: true, reason: "premium_model" });
  });

  it("standard images proceed WITHOUT any dollar-threshold confirmation — whatever the estimate (correction a42e0598)", () => {
    expect(resolveApprovalPolicy({ mode: "image", tier: "standard", estimatedCostUsd: 0.03, draftAllowanceUsd: 0.1 }))
      .toEqual({ approvalRequired: false, reason: "standard_no_action_gate" });
    // The formerly-blocked case: a BIG estimate against a SMALL allowance no longer confirms
    // on money — the monetary-only trigger is gone.
    expect(resolveApprovalPolicy({ mode: "image", tier: "standard", estimatedCostUsd: 99, draftAllowanceUsd: 0.1 }))
      .toEqual({ approvalRequired: false, reason: "standard_no_action_gate" });
    expect(resolveApprovalPolicy({ mode: "image_edit", tier: "standard", estimatedCostUsd: 99, draftAllowanceUsd: 0 }))
      .toEqual({ approvalRequired: false, reason: "standard_no_action_gate" });
  });
});

describe("media band mapping", () => {
  it("premium tiers and video are never the cheap band (band context for display; nothing blocks on money anymore)", () => {
    expect(mediaBand("video", "standard")).toBe("reasoning");
    expect(mediaBand("image", "premium")).toBe("reasoning");
    expect(mediaBand("image_edit", "premium")).toBe("reasoning");
    expect(mediaBand("image", "standard")).toBe("cheap");
  });
});

describe("decideMediaBudget — informational spend (OWNER BILLING SUPERSESSION 2026-10-27)", () => {
  it("unknown accrual ALLOWS — the job proceeds and the total renders as unknown, never a pause", () => {
    const v = decideMediaBudget({ accruedUsd: null, ceilingUsd: 20, mode: "image", tier: "standard", estimatedCostUsd: 0.03 });
    expect(v.verdict).toBe("allow");
    expect(v.spend.accruedUsd).toBeNull();
  });

  it("an UNSET ceiling ALLOWS — spend is on by default; no monetary off-switch remains", () => {
    const v = decideMediaBudget({ accruedUsd: 5, ceilingUsd: null, mode: "image", tier: "standard", estimatedCostUsd: 0.03 });
    expect(v.verdict).toBe("allow");
    expect(v.spend.ceilingUsd).toBeNull();
  });

  it("EXCEEDED totals ALLOW — the ceiling number rides along for display; the job is never interrupted", () => {
    const v = decideMediaBudget({ accruedUsd: 25, ceilingUsd: 20, mode: "video", tier: "premium", estimatedCostUsd: 5 });
    expect(v.verdict).toBe("allow");
    expect(v.spend).toEqual({ accruedUsd: 25, ceilingUsd: 20 });
  });

  it("a marginal job that would cross any former ceiling still ALLOWS", () => {
    const v = decideMediaBudget({ accruedUsd: 19.99, ceilingUsd: 20, mode: "image", tier: "standard", estimatedCostUsd: 0.5 });
    expect(v.verdict).toBe("allow");
  });

  it("the platform guard ALWAYS allows and returns the totals for alerting", async () => {
    const { decidePlatformSpendGuard } = await import("../../supabase/functions/_shared/media-provider/budget.ts");
    expect(decidePlatformSpendGuard({ platformAccruedUsd: 500, platformCeilingUsd: 100, estimatedCostUsd: 5 }).ok).toBe(true);
    expect(decidePlatformSpendGuard({ platformAccruedUsd: null, platformCeilingUsd: 100, estimatedCostUsd: 5 }).ok).toBe(true);
  });
});
