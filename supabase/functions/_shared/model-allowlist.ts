// _shared/model-allowlist.ts — the Model Router's per-provider model allow-list.
//
// A caller may request a specific model via `model_override` (e.g. a tenant on a Flux
// preset asking for flux-1.1-pro). That override is untrusted input — it must be checked
// against a curated allow-list before it reaches a provider, so no caller can smuggle in
// an unvetted/expensive/renamed model id, drive spend, or route a send to a model we never
// approved (§13 secure-by-construction; §14 cost-low/right-model). An empty/undefined
// override means "use the route's provider default" and is always allowed — the router
// picks the default, not the caller.
//
// This is a plain data + one assertion module (no I/O, no env). Model ids are the current,
// real ids as of 2026-07 for each provider; extend a provider's list here (one home, §12)
// rather than special-casing an id at a call site.

import { DoctrineViolation } from "./model-router-gates.ts";
import { CLAUDE_CLASSIFICATION, CLAUDE_REASONING } from "./claude-models.ts";
import { OPENAI_CHEAP, OPENAI_FRONTIER, OPENAI_OPERATIONAL } from "./openai-models.ts";

/**
 * Per-provider allowed model ids. Keys are the router's provider slugs. Anything not listed
 * for a provider is rejected by assertModelAllowed. Keep ids exact (they are sent verbatim
 * to each provider's API).
 */
export const MODEL_ALLOWLIST: Record<string, string[]> = {
  // Anthropic — Claude tiers via claude.ts. "reasoning"/"classification" are the router's tier
  // aliases; the concrete ids are DERIVED from claude-models.ts so a model switch there is the only edit
  // (INT-329). A retired id is deliberately NOT kept: claudeText maps any non-classification
  // override to the reasoning tier, so a stale "claude-sonnet-5" override would run the CURRENT
  // model under the old label.
  anthropic: [
    "reasoning",
    "classification",
    CLAUDE_REASONING,
    CLAUDE_CLASSIFICATION,
    "claude-opus-4-8",
  ],

  // OpenAI — the GPT-6 reasoning family (INT-334; ids DERIVED from openai-models.ts, Responses API via
  // openai-responses.ts), the legacy gpt-4o pair (Chat Completions client, no live caller), and
  // gpt-image-1 for image generation.
  openai: [
    OPENAI_CHEAP,
    OPENAI_OPERATIONAL,
    OPENAI_FRONTIER,
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-image-1",
  ],

  // Groq — open-fast text (OpenAI-compatible). Llama 3.3 70B is the workhorse.
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ],

  // Featherless — open-flexible text (already wired in model-router.ts). The plan-gated
  // larger ids are listed so an override can request them; reachability is enforced by the
  // provider client's fail-closed/fallback behavior, not here.
  featherless: [
    "Qwen/Qwen2.5-7B-Instruct",
    "Qwen/Qwen2.5-14B-Instruct",
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Meta-Llama-3.1-8B-Instruct",
  ],

  // Ideogram — image-with-text (typography-accurate). V_2 is quality, V_2_TURBO is fast.
  ideogram: [
    "V_2",
    "V_2_TURBO",
  ],

  // Replicate — premium image (Flux family) + a 3D backup path. Ids are the Replicate
  // model slugs (owner/name), used verbatim in replicateRun({model,...}).
  replicate: [
    "black-forest-labs/flux-1.1-pro",
    "black-forest-labs/flux-dev",
    "black-forest-labs/flux-schnell",
    "black-forest-labs/flux-kontext-pro",
  ],

  // Meshy — text-to-3D primary. meshy-4 is stable, meshy-5 is the newer generation.
  meshy: [
    "meshy-4",
    "meshy-5",
  ],

  // ElevenLabs — audio/voice synthesis.
  elevenlabs: [
    "eleven_multilingual_v2",
  ],

  // Gemini — open-fast image (already inside generate-image today).
  gemini: [
    "gemini-2.5-flash-image",
  ],
};

/**
 * Assert that `model` is allowed for `provider`. An empty/undefined model means "provider
 * default" and is always allowed (the router chose the default, not an untrusted caller).
 * A non-empty model that isn't on the provider's list — or a provider we don't know —
 * throws a typed DoctrineViolation('model-override', ...) so the router can audit and reject
 * the smuggled id fail-closed.
 */
export function assertModelAllowed(provider: string, model?: string): void {
  const m = (model ?? "").trim();
  if (!m) return; // provider default — always allowed

  const allowed = MODEL_ALLOWLIST[provider];
  if (!allowed) {
    throw new DoctrineViolation("model-override", "unknown provider for model override", {
      provider,
      model: m,
    });
  }
  if (!allowed.includes(m)) {
    throw new DoctrineViolation("model-override", "model is not on the provider allow-list", {
      provider,
      model: m,
      allowed,
    });
  }
}
