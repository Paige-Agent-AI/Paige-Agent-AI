// _shared/openai-models.ts — THE ONE PLACE an OpenAI reasoning model id is chosen (§18), the twin of
// claude-models.ts. Pure data: no imports, no I/O, no env, so the allow-list (a plain data module) and
// the Responses adapter read the same constants.
//
// INT-334 (owner ruling 2026-10-06): the GPT-6 family is first-class in the model fabric, by cognitive
// class rather than by caller:
//   cheap        → gpt-6-luna   (classification, extraction, tagging, summarisation, routing support)
//   operational  → gpt-6.1-sol  (normal PAIGE conversation, tool reasoning, planning, synthesis)
//   frontier     → gpt-6-astra  (hard ambiguity, long-horizon orchestration, deep research, large documents)
// Which class a turn needs, and whether OpenAI or another provider serves it, is decided by the fabric's
// route policy — never by a caller hard-coding one of these ids. A provider being chosen never widens
// what PAIGE may do: tenant, authority, approval and risk are resolved downstream, unchanged.
export const OPENAI_CHEAP = "gpt-6-luna";
export const OPENAI_OPERATIONAL = "gpt-6.1-sol";
export const OPENAI_FRONTIER = "gpt-6-astra";

export type OpenAIReasoningClass = "cheap" | "operational" | "frontier";

export const OPENAI_MODEL_BY_CLASS: Readonly<Record<OpenAIReasoningClass, string>> = {
  cheap: OPENAI_CHEAP,
  operational: OPENAI_OPERATIONAL,
  frontier: OPENAI_FRONTIER,
};

/** Reasoning effort per class (Responses `reasoning.effort`). Astra and Sol reject `none`; Luna accepts it.
 *  Kept at the cheapest level that serves the class; escalation is a class change, not an effort bump. */
export const OPENAI_EFFORT_BY_CLASS: Readonly<Record<OpenAIReasoningClass, "none" | "low" | "medium" | "high">> = {
  cheap: "none",
  operational: "medium",
  frontier: "high",
};
