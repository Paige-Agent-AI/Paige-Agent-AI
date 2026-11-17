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
