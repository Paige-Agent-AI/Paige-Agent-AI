// INT-334 R4 — the turn classifier's model call (the IO half of classify.ts).
//
// ONE cheap structured call, bounded by a hard deadline, whose answer is advisory. It runs on the
// classification tier directly rather than through `routedChatCompletion("classify")`: that lane's
// open model measured 5.6 s mean / 8.9 s p90 on production over 14 days (paige_llm_trace, job_kind
// extract), far too slow for the front door of every chat turn. When the shared Model Fabric lands
// (R5–R7) this moves to the fabric's `cheap` class (Luna first) and this file's provider line goes.
//
// Every failure — timeout, HTTP error, malformed JSON, a value outside the closed enums — is `null`,
// and the Turn Route then takes its conservative default (operational, governed tools). The call
// never throws into the turn.

import { callClaude } from "../claude.ts";
import type { TraceCtx } from "../llm-trace.ts";
import { CLASSIFY_SYSTEM, classifyPrompt, parseClassification } from "./classify.ts";
import type { TurnClassification } from "./route.ts";

// The pure gate lives with the classifier's other pure half; chat imports it from here.
export { routeNeedsClassifier } from "./classify.ts";

/** The classifier's budget. Its latency overlaps the turn's context assembly; past this it is ignored. */
export const TURN_CLASSIFY_DEADLINE_MS = 2000;

export async function classifyTurn(message: string, acceptedStep: string | null, trace?: TraceCtx): Promise<TurnClassification | null> {
  try {
    const r = await callClaude({
      tier: "classification",
      system: CLASSIFY_SYSTEM,
      messages: [{ role: "user", content: classifyPrompt(message, acceptedStep) }],
      maxTokens: 120,
      temperature: 0,
      signal: AbortSignal.timeout(TURN_CLASSIFY_DEADLINE_MS),
      trace,
    });
    return parseClassification(r?.text);
  } catch (e) {
    console.warn("[paige] turn classifier unavailable; conservative route:", (e as Error)?.name ?? "error");
    return null;
  }
}
