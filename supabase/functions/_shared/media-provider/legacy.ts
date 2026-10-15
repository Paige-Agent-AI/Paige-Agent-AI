/**
 * Legacy image-provider adapter — the SYNC shape of the media-provider seam.
 *
 * THE RECONCILIATION (owner authorization: "Keep existing image providers
 * functional. Where current generate-image behavior overlaps, reconcile it
 * deliberately into the canonical seam rather than creating two competing ways
 * to generate the same asset."):
 *
 *   The existing `generate-image` edge function stays the executor for the four
 *   providers it already serves (gemini / openai / replicate / ideogram) — it
 *   is NOT modified, and its proven tail (bytes → paige-generated Storage →
 *   save_marketing_content library + version stacking → audit → memory capture)
 *   is REUSED, never duplicated here. What this adapter adds is the governed
 *   wrapper the owner authorized: a durable job row, budget decision, approval
 *   boundary, and a Rail receipt around that existing execution.
 *
 *   One asset pipeline, one library, one storage bucket — two callers of the
 *   same executor, with the seam (paige-media) as the governed front door for
 *   Vibe Studio.
 */

import {
  COMMERCIAL_USE_DISCLOSURE,
  type ExecuteInput,
  type ExecuteResult,
  type MediaModelInfo,
  type MediaProviderAdapter,
  type MediaProviderName,
} from "./mod.ts";
import { envKey } from "../env-key.ts";

/** Which env secret visibility marks each legacy provider as configured (booleans only). */
const LEGACY_KEY_NAMES: Record<Exclude<MediaProviderName, "fal">, string[]> = {
  gemini: ["GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  replicate: ["REPLICATE_API_TOKEN", "REPLICATE_API_KEY"],
  ideogram: ["IDEOGRAM_API_KEY"],
};

function legacyCatalog(provider: Exclude<MediaProviderName, "fal">): MediaModelInfo[] {
  // The executor owns model selection for these providers (validated allow-lists
  // live there). The seam surfaces one honest entry per provider so the UI can
  // disclose availability + estimate; the executor's reported model is recorded
  // on the job as truth.
  const configured = LEGACY_KEY_NAMES[provider].some((n) => !!envKey(n));
  const est = provider === "replicate" ? 0.04 : 0.03;
  return [
    {
      id: `${provider}:auto`,
      label: provider === "gemini"
        ? "Gemini Image (executor-selected)"
        : provider === "openai"
          ? "GPT Image (executor-selected)"
          : provider === "replicate"
            ? "Flux via Replicate"
            : "Ideogram (text-in-image)",
      mode: "image",
      tier: "standard",
      estCostPerUnitUsd: est,
      unit: "image",
    },
    ...(configured ? [] : []),
  ];
}

/**
 * Invoke the existing generate-image executor FORWARDING THE CALLER'S JWT
 * (compliance H4): generate-image authenticates a user (auth.getUser + the
 * session workspace's owner/admin check) — the verified caller's own header passes it
 * natively; a service-key invoke could not. This adapter therefore runs only
 * inside the authenticated submit/approve request; the sweeper never dispatches
 * legacy providers.
 */
async function invokeGenerateImage(input: ExecuteInput): Promise<ExecuteResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const sizeKey = input.aspectRatio === "2:3"
    ? "portrait"
    : input.aspectRatio === "3:2"
      ? "landscape"
      : "square";

  const resp = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.callerJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: input.prompt,
      size: sizeKey,
      provider: input.provider,
      tenant_id: input.tenantId,
      ...(input.model && !input.model.includes(":auto") ? { model: input.model } : {}),
      ...(input.reuseContentId ? { reuse_content_id: input.reuseContentId } : {}),
    }),
  });
  // generate-image returns 200 for honest needs_config/errors alike (its
  // contract) — read the body, not just the status.
  const data = await resp.json().catch(() => ({}));
  if (data?.error) throw new Error(String(data.error).slice(0, 300));
  if (!data?.url) throw new Error("generate-image returned no url");
  return {
    artifactUrl: String(data.url),
    storagePath: data.path ?? null,
    contentId: data.content_id ?? null,
    model: data.model ?? input.model ?? input.provider,
  };
}

function makeLegacyAdapter(provider: Exclude<MediaProviderName, "fal">): MediaProviderAdapter {
  const keyNames = LEGACY_KEY_NAMES[provider];
  return {
    name: provider,
    isConfigured: () => keyNames.some((n) => !!envKey(n)),
    getCapabilities: () => ({
      provider,
      execution: "sync" as const,
      models: legacyCatalog(provider),
      configured: keyNames.some((n) => !!envKey(n)),
    }),
    getLicenseClass: () => ({
      licenseClass: "provider_and_model_terms",
      commercialUse: "conditional" as const,
      disclosure: COMMERCIAL_USE_DISCLOSURE,
    }),
    getRetentionPolicy: () => ({
      policy: "bytes are uploaded to Paige Storage by the generate-image executor on completion",
      copyDeadline: "immediate (synchronous execution)",
    }),
    estimateCost: (input) =>
      input.mode === "image"
        ? { estimatedCostUsd: provider === "replicate" ? 0.04 : 0.03, basis: "estimate: curated price table — actual may differ", unit: "image" as const }
        : null,
    async submit(): Promise<never> {
      throw new Error(`${provider} is a sync adapter; use execute`);
    },
    async poll(): Promise<never> {
      throw new Error(`${provider} is a sync adapter; use execute`);
    },
    async fetchResult(): Promise<never> {
      throw new Error(`${provider} is a sync adapter; use execute`);
    },
    async cancel(): Promise<never> {
      throw new Error(`${provider} is a sync adapter; nothing to cancel`);
    },
    execute: invokeGenerateImage,
  };
}

export const legacyAdapters: Record<Exclude<MediaProviderName, "fal">, MediaProviderAdapter> = {
  gemini: makeLegacyAdapter("gemini"),
  openai: makeLegacyAdapter("openai"),
  replicate: makeLegacyAdapter("replicate"),
  ideogram: makeLegacyAdapter("ideogram"),
};
