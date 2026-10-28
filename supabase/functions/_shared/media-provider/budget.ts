/**
 * Media budget + approval policy — the pure decision core for the media seam.
 *
 * OWNER BILLING SUPERSESSION (2026-10-27, ANT-162): ALL PAIGE-imposed tenant
 * spending ceilings are REMOVED — attributable media usage bills the consuming
 * tenant at published rates through the canonical usage meter; totals are
 * informational and never interrupt a job. This supersedes the 2026-09-12
 * fail-closed ceiling rulings this file was built under: the ladder no longer
 * denies — unknown accrual, an unset ceiling, and exceeded totals all ALLOW,
 * with the accrual/ceiling numbers returned for display only. The APPROVAL
 * boundary below (draft allowance / premium / video-always) is a business-action
 * permission, not a monetary ceiling, and is retained unchanged. Rate limits
 * and other technical anti-abuse live outside this file and are retained.
 *
 * The router-budget import and band mapping survive for callers that still
 * render band context; nothing denies on money here anymore.
 *
 * Approval boundary (owner authorization, "Required behavior"):
 *   within automatic draft allowance → may proceed only if policy permits
 *     (standard-tier image/image_edit, estimate ≤ allowance, budget allow)
 *   above draft allowance → require confirmation
 *   premium video / expensive generation → always require confirmation
 *     (video ALWAYS requires confirmation, whatever the estimate)
 *
 * Dependency-free pure functions — vitest-importable like the durable-job seam.
 */

import { enforceBudget, type BudgetBand, type BudgetDecision } from "../router-budget/mod.ts";
import type { MediaMode } from "./mod.ts";

export type MediaApprovalPolicy =
  | { approvalRequired: false; reason: "within_draft_allowance" }
  | { approvalRequired: true; reason: "video_requires_approval" | "premium_model" | "above_draft_allowance" };

export function resolveApprovalPolicy(input: {
  mode: MediaMode;
  tier: "standard" | "premium";
  estimatedCostUsd: number;
  draftAllowanceUsd: number;
}): MediaApprovalPolicy {
  if (input.mode === "video") return { approvalRequired: true, reason: "video_requires_approval" };
  if (input.tier === "premium") return { approvalRequired: true, reason: "premium_model" };
  if (input.estimatedCostUsd > input.draftAllowanceUsd) {
    return { approvalRequired: true, reason: "above_draft_allowance" };
  }
  return { approvalRequired: false, reason: "within_draft_allowance" };
}

/**
 * The band a media job routes through the shared ladder. Premium tiers are
 * never "cheap" (they fail closed at the hard ceiling, like reasoning).
 */
export function mediaBand(mode: MediaMode, tier: "standard" | "premium"): BudgetBand {
  if (tier === "premium") return "reasoning";
  if (mode === "video") return "reasoning";
  return "cheap";
}

// String-literal discriminant: this repo compiles non-strict, where boolean
// discrimination does not narrow. Post-supersession there is no deny verdict —
// the totals are informational and never interrupt a job.
export type MediaBudgetDecision =
  | { verdict: "allow"; decision?: BudgetDecision; spend: { accruedUsd: number | null; ceilingUsd: number | null } };

/**
 * Platform-wide accrual read for the UTC day via `media_spend_today_all` — the
 * feed for the ENFORCED platform-level guard (media_spend_ceiling_usd; the
 * owner's truthful-naming correction: this one is a real cap, actually metered).
 */
export async function readPlatformMediaAccrual(
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<number | null> {
  try {
    const { data, error } = await rpc("media_spend_today_all", {});
    if (error) {
      console.error("[media-budget] platform accrual read error:", error.message ?? "unknown");
      return null;
    }
    const n = data === null || data === undefined ? 0 : Number(data);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    console.error("[media-budget] platform accrual read threw:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

/**
 * The platform guard is INFORMATIONAL (billing supersession 2026-10-27): the
 * platform-wide accrual total is returned for display/alerting and never pauses
 * spend. The 2026-09-12 runaway-spend backstop it replaced is superseded;
 * runaway protection now lives in billing alerts and technical anti-abuse.
 */
export function decidePlatformSpendGuard(input: {
  platformAccruedUsd: number | null;
  platformCeilingUsd: number;
  estimatedCostUsd: number;
}): { ok: true; platformAccruedUsd: number | null; platformCeilingUsd: number } {
  return { ok: true, platformAccruedUsd: input.platformAccruedUsd, platformCeilingUsd: input.platformCeilingUsd };
}

/**
 * Decide a media job against spend. POST-SUPERSESSION this NEVER denies on
 * money: unknown accrual, an unset ceiling, and exceeded totals all allow —
 * the numbers ride along so surfaces can show "today's media spend" honestly.
 * The approval boundary (resolveApprovalPolicy) still governs confirmation.
 */
export function decideMediaBudget(input: {
  accruedUsd: number | null;
  ceilingUsd: number | null;
  mode: MediaMode;
  tier: "standard" | "premium";
  estimatedCostUsd: number;
}): MediaBudgetDecision {
  void mediaBand(input.mode, input.tier); // band context retained for callers; no denial path remains
  return {
    verdict: "allow",
    spend: { accruedUsd: input.accruedUsd, ceilingUsd: input.ceilingUsd },
  };
}

/** Accrual read for the UTC day via the service-role RPC `media_spend_today`. */
export async function readMediaAccrual(
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  tenantId: string,
): Promise<number | null> {
  try {
    const { data, error } = await rpc("media_spend_today", { _tenant: tenantId });
    if (error) {
      console.error("[media-budget] accrual read error:", error.message ?? "unknown");
      return null;
    }
    const n = data === null || data === undefined ? 0 : Number(data);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    console.error("[media-budget] accrual read threw:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}
