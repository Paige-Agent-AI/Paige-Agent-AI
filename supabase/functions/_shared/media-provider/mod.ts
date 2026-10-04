/**
 * Vibe Media Provider seam — the ONE internal provider interface for the
 * governed media-generation layer (owner build authorization 2026-09-12).
 *
 * Implements the provider-adapter design from
 * docs/VIBE-MEDIA-PROVIDER-DUE-DILIGENCE.md §4: one governed seam, many
 * adapters; swapping providers is a registry change, not a rewrite.
 *
 * TWO ADAPTER SHAPES, ONE INTERFACE:
 *  - ASYNC adapters (fal): submit() → provider_request_id → poll()/webhook →
 *    fetchResult() → the seam copies bytes into Paige Storage (the provider URL
 *    is NEVER the canonical asset source).
 *  - SYNC adapters (the four existing image providers): execute() runs the
 *    generation to completion through the EXISTING generate-image executor —
 *    the deliberate reconciliation the owner authorization requires: generate-
 *    image is not broken or replaced (owner decision: preserve it), it simply
 *    gains a governed caller. Its proven storage/library/memory tail is reused,
 *    never duplicated.
 *
 * HONESTY (CLAUDE.md §13): estimateCost returns an ESTIMATE from a curated,
 * env-overridable price table — labeled as such. getLicenseClass/getRetentionPolicy
 * describe the provider's contractual posture; nothing here promises copyright,
 * exclusivity, trademark/likeness clearance, or legal approval (owner
 * authorization: "Paige must never promise…").
 *
 * Dependency-free core (no npm:/Deno globals) so vitest imports it directly,
 * the _shared/durable-job precedent. The fal adapter (fal.ts) is IO and is
 * exercised through its exported pure helpers + contract tests.
 */

export type MediaMode = "image" | "image_edit" | "video";
export type MediaProviderName = "fal" | "gemini" | "openai" | "replicate" | "ideogram";

/** Models the seam will submit to — curated ids, env-overridable (§10 config-as-data). */
export interface MediaModelInfo {
  readonly id: string;
  readonly label: string;
  readonly mode: MediaMode;
  /** standard = draft allowance applies; premium = always requires confirmation. */
  readonly tier: "standard" | "premium";
  /** Curated ESTIMATE per unit — a price-table value, never an invoice truth. */
  readonly estCostPerUnitUsd: number;
  readonly unit: "image" | "second";
}

/**
 * The adapter contract. `capabilities` reports truthful availability BEFORE any
 * key check is needed for listing; `configured` reports whether the provider's
 * secret is visible (boolean only — never the value).
 */
export interface MediaProviderAdapter {
  readonly name: MediaProviderName;
  /** True when this adapter's secret is visible in the runtime environment. */
  isConfigured(): boolean;
  /** Truthful capability + model listing for disclosure UI. */
  getCapabilities(): {
    provider: MediaProviderName;
    /** 'async' = submit/poll/fetchResult/cancel; 'sync' = execute only. */
    execution: "async" | "sync";
    models: readonly MediaModelInfo[];
    configured: boolean;
  };
  /** License/commercial posture for disclosure — contract language, not legal advice. */
  getLicenseClass(): { licenseClass: string; commercialUse: "conditional"; disclosure: string };
  /** What happens to outputs at the provider if we did NOT copy them. */
  getRetentionPolicy(): { policy: string; copyDeadline: string };
  estimateCost(input: { mode: MediaMode; model: string; videoSeconds?: number }): {
    estimatedCostUsd: number;
    basis: string;
    unit: "image" | "second";
  } | null;
  /** ASYNC adapters only. */
  submit(input: SubmitInput): Promise<{ providerRequestId: string }>;
  poll(input: ProviderRef): Promise<PollResult>;
  fetchResult(input: ProviderRef): Promise<{ artifactUrls: string[] }>;
  cancel(input: ProviderRef): Promise<{ requested: boolean; alreadyCompleted?: boolean; notFound?: boolean }>;
  /** SYNC adapters only (legacy image providers via the existing executor). */
  execute(input: ExecuteInput): Promise<ExecuteResult>;
}

export interface SubmitInput {
  model: string;
  mode: MediaMode;
  prompt: string;
  aspectRatio?: string;
  /** Reference assets for image_edit (Paige Storage urls the provider can fetch). */
  referenceUrls?: string[];
  videoSeconds?: number;
  /** Signed webhook receiver endpoint; absent → polling only. */
  webhookUrl?: string;
}
export interface ProviderRef {
  model: string;
  providerRequestId: string;
}
export type PollStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
export interface PollResult {
  status: PollStatus;
  queuePosition?: number;
  error?: string;
}
export interface ExecuteInput {
  tenantId: string;
  prompt: string;
  aspectRatio?: string;
  provider: MediaProviderName;
  model?: string;
  /** marketing_content row to stack a new version onto, when regenerating. */
  reuseContentId?: string | null;
  /**
   * The ALREADY-VERIFIED caller's JWT, forwarded verbatim (sync adapters only).
   * Compliance mechanics: generate-image authenticates a USER (auth.getUser +
   * the session workspace's owner/admin check) — a service-key invoke has no user and cannot
   * pass it. This is the authenticated request's own Authorization header,
   * re-sent server-to-server; never logged, never stored. Consequence: legacy
   * sync providers execute ONLY inside the authenticated request; the sweeper
   * never dispatches them.
   */
  callerJwt: string;
}
export interface ExecuteResult {
  artifactUrl: string;
  storagePath: string | null;
  contentId: string | null;
  model: string;
}

/** Terminal per the durable-job contract — terminal is terminal for completion. */
export const MEDIA_TERMINAL_STATES: readonly string[] = ["succeeded", "failed", "cancelled"] as const;
/** Every state a completion claim may legally move (the resurrect guard's domain). */
export const MEDIA_NON_TERMINAL_STATES: readonly string[] = [
  "created",
  "blocked",
  "submitted",
  "processing",
  "outcome_unknown",
  "expired",
] as const;

/**
 * The truthful commercial-use disclosure, rendered wherever an asset or job is
 * shown (owner authorization's exact required language).
 */
export const COMMERCIAL_USE_DISCLOSURE =
  "This asset was generated using the recorded provider and model. Commercial-use status depends on the applicable provider and model terms, your source materials, and your intended use.";

/** Estimate a job's cost from the curated table. Returns null for unknown models. */
export function estimateFromCatalog(
  catalog: readonly MediaModelInfo[],
  input: { mode: MediaMode; model: string; videoSeconds?: number },
): { estimatedCostUsd: number; basis: string; unit: "image" | "second" } | null {
  const entry = catalog.find((m) => m.id === input.model && m.mode === input.mode);
  if (!entry) return null;
  if (entry.unit === "second") {
    const seconds = Math.max(1, Math.min(12, Math.round(input.videoSeconds ?? 5)));
    return {
      estimatedCostUsd: Math.round(entry.estCostPerUnitUsd * seconds * 10000) / 10000,
      basis: `estimate: $${entry.estCostPerUnitUsd.toFixed(3)}/s × ${seconds}s (curated price table — actual may differ)`,
      unit: "second",
    };
  }
  return {
    estimatedCostUsd: entry.estCostPerUnitUsd,
    basis: `estimate: curated price table ($${entry.estCostPerUnitUsd.toFixed(3)}/image — actual may differ)`,
    unit: "image",
  };
}
