// _shared/openrouter-models.ts — THE ONE PLACE an OpenRouter model id is chosen (§18), the twin of
// openai-models.ts. Pure data: no imports, no I/O, no env, so the allow-list and the Responses
// adapter read identical constants.
//
// PO-EXP25 (2026-11-23): All classes route through OpenRouter Auto (`openrouter/auto`).
// OpenRouter Auto selects the best model for each request based on task difficulty, benchmark
// performance, live prices, and prompt caching. No dedicated GPT models, no Featherless, no
// Anthropic, no Groq — OpenRouter Auto only. GPT models are excluded from Auto selection.
//
// This is a temporary routing decision until model comparison (OpenRouter Auto vs direct
// model selection vs hybrid) is completed and the right model for each route is chosen.
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

// All classes route through OpenRouter Auto. Auto selects the model per request.
export const OPENROUTER_CHEAP = "openrouter/auto";
export const OPENROUTER_OPERATIONAL = "openrouter/auto";
export const OPENROUTER_FRONTIER = "openrouter/auto";

export type OpenRouterReasoningClass = "cheap" | "operational" | "frontier";

export const OPENROUTER_MODEL_BY_CLASS: Readonly<Record<OpenRouterReasoningClass, string>> = {
  cheap: OPENROUTER_CHEAP,
  operational: OPENROUTER_OPERATIONAL,
  frontier: OPENROUTER_FRONTIER,
};

/** Reverse map for trace/readback: Auto doesn't map to a single class. */
export const OPENROUTER_CLASS_BY_MODEL: Readonly<Record<string, OpenRouterReasoningClass>> = {
  [OPENROUTER_CHEAP]: "cheap",
};

/** OpenRouter Auto excludes GPT models from selection. */
export const OPENROUTER_EXCLUDED_MODELS = ["openai/*"];