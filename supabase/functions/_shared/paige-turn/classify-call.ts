// INT-334 R4 — the turn classifier's model call (the IO half of classify.ts).
//
// ONE cheap structured call, bounded by a hard deadline, whose answer is advisory. Since #1844 it
// opens through the shared Model Fabric (`fabricCompletion`, cognitive class `cheap`, job identity
// `turn_classify`): the fabric alone picks the provider — Anthropic's cheap tier while OpenAI is
// off, Luna first the day the Sol canary's release bar is met and the flip lands. No provider line
// lives here anymore, and the fabric's budget gate now covers the classifier (R4's recorded S3 gap:
// this call sat outside every tenant ceiling) with the router's established policy unchanged —
// accrual that cannot be read proceeds ungated but LOUD, and the cheap band at a hard ceiling
// CONTINUES GATED with the hit recorded (the budget contract's own rule) — the classifier is never
// darkened by budget; only a THROW (a reasoning-band block is unreachable here) would read as null.
//
// Every failure — timeout, HTTP error, malformed JSON, a value outside the closed enums, a budget
// stop — is `null`, and the Turn Route then takes its conservative default (operational, governed
// tools). The call never throws into the turn, and it never grants authority: it may raise the
// cognitive class of a turn's REASONING, nothing else.

import { fabricCompletion, type FabricCompletionResult } from "../model-fabric.ts";
import type { TraceCtx } from "../llm-trace.ts";
import { CLASSIFY_SYSTEM, classifyPrompt, parseClassification } from "./classify.ts";
import type { TurnClassification } from "./route.ts";

// The pure gate lives with the classifier's other pure half; chat imports it from here.
export { routeNeedsClassifier } from "./classify.ts";

/**
 * The classifier's budget. On most fresh turns nothing else is awaited between the classifier's start
 * and the first model call, so this is added to the time to first token in the worst case. Set from
 * production traces of comparable small Haiku calls (session-summary, ~200 tokens in / 35 out, 30 days:
 * p50 840 ms, p90 1.46 s). Past it the classifier is ignored and the route takes its conservative
 * default (operational, governed tools) — a timeout costs the cheap-tier saving, never correctness.
 */
export const TURN_CLASSIFY_DEADLINE_MS = 1200;

/** The fabric-side job identity (snake_case). The trace keeps the caller's `turn-classify` tag. */
export const TURN_CLASSIFY_JOB = "turn_classify";

export async function classifyTurn(message: string, acceptedStep: string | null, trace?: TraceCtx): Promise<TurnClassification | null> {
  // The deadline bounds the WHOLE call, not only the provider fetch: the fabric's budget reads run
  // before the fetch and carry no abort signal of their own, so the call itself is raced and a slow
  // gate read costs the classifier, never the turn. The signal still aborts the fetch leg the
  // moment the window ends.
  const signal = AbortSignal.timeout(TURN_CLASSIFY_DEADLINE_MS);
  try {
    const r: FabricCompletionResult | null = await Promise.race([
      fabricCompletion({
        cognitive_class: "cheap",
        job: TURN_CLASSIFY_JOB,
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: classifyPrompt(message, acceptedStep) },
        ],
        max_tokens: 120,
        temperature: 0,
      }, { trace, signal }),
      new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true })),
    ]);
    if (!r || !r.ok) return null;
    const content = (r.response as { choices?: { message?: { content?: unknown } }[] } | undefined)?.choices?.[0]?.message?.content;
    return parseClassification(typeof content === "string" ? content : null);
  } catch (e) {
    console.warn("[paige] turn classifier unavailable; conservative route:", (e as Error)?.name ?? "error");
    return null;
  }
}
