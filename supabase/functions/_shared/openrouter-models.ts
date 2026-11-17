// _shared/openrouter-models.ts — THE ONE PLACE an OpenRouter model id is chosen (§18), the twin of
// openai-models.ts. Pure data: no imports, no I/O, no env, so the allow-list and the Responses
// adapter read identical constants.
//
// OpenRouter serves the SAME GPT-6 family PAIGE already routes by cognitive class, under its
// `openai/` provider namespace. Verified against GET https://openrouter.ai/api/v1/models (2026-11-17)
// and a live POST /api/v1/responses with `openai/gpt-6.1-sol`, which returned the completed Responses
// shape the Fabric adapter already parses. Keeping the SAME class→model mapping means adding
// OpenRouter changes WHICH TRANSPORT serves a class, never WHAT the class thinks with — the owner's
// 2026-10-06 class policy (Luna / Sol / Astra) stays intact.
export const OPENROUTER_PROVIDER_PREFIX = "openai/";

/**
 * Edge Function Secret names that may carry the OpenRouter key, in priority order.
 * `OPEN_ROUTER_AI_API` is the configured production secret name; `OPENROUTER_API_KEY`
 * is the original local name and stays as a back-compat alias. NAMES ONLY — no value
 * is ever stored, logged or committed here. Both the Fabric admission gate and the
 * Responses adapter must resolve through this one list so a configured key cannot be
 * admitted on one side and skipped on the other.
 */
export const OPENROUTER_KEY_ENV_NAMES = ["OPEN_ROUTER_AI_API", "OPENROUTER_API_KEY"];

export const OPENROUTER_CHEAP = `${OPENROUTER_PROVIDER_PREFIX}gpt-6-luna`;
export const OPENROUTER_OPERATIONAL = `${OPENROUTER_PROVIDER_PREFIX}gpt-6.1-sol`;
export const OPENROUTER_FRONTIER = `${OPENROUTER_PROVIDER_PREFIX}gpt-6-astra`;

export type OpenRouterReasoningClass = "cheap" | "operational" | "frontier";

export const OPENROUTER_MODEL_BY_CLASS: Readonly<Record<OpenRouterReasoningClass, string>> = {
  cheap: OPENROUTER_CHEAP,
  operational: OPENROUTER_OPERATIONAL,
  frontier: OPENROUTER_FRONTIER,
};

/** Reverse map for trace/readback: an OpenRouter served id names its class without parsing strings. */
export const OPENROUTER_CLASS_BY_MODEL: Readonly<Record<string, OpenRouterReasoningClass>> = {
  [OPENROUTER_CHEAP]: "cheap",
  [OPENROUTER_OPERATIONAL]: "operational",
  [OPENROUTER_FRONTIER]: "frontier",
};
