// _shared/eval/scorers.ts — §34 Layer 2 (Quality/Evals): the scorer library.
//
// A scorer takes a case's produced output (+ optional expected/rubric) and returns a ScoreResult.
// Two kinds:
//   • DETERMINISTIC — pure, NO LLM, NEVER throws. A scorer that genuinely cannot evaluate its input
//     (missing expected/pattern/metric) returns score:null, status:"needs_config" — NEVER a defaulted
//     pass (§31). score is 0|1|null; passed = score===1 (null when not scored).
//   • LLM_JUDGE — one router call at the "plan" (Claude reasoning) tier (§17: a quality JUDGMENT is
//     frontier-only, never an open model). On any throw/unparseable reply it returns score:null,
//     status:"low_confidence" — INVERTED from the visual critic's fail-open-to-SHIP: a broken JUDGE
//     must NOT fabricate a pass (§31). Assembly lives INSIDE the try (§13 airtight).
//
// §34: pure in-repo — model-router only. No vendor eval/judge SDK.
import { routedChatCompletion } from "../model-router.ts";
import type { TraceCtx } from "../llm-trace.ts";
import { estimateTokenCostUsd } from "../token-pricing.ts";
import type { ScoreResult } from "./types.ts";

/** What a scorer is handed for one case. */
export interface ScorerInput {
  /** The produced output to score (a string, or a structured object like a StrategyPlan). */
  output: unknown;
  /** Gold output/label, when the scorer needs a reference. */
  expected?: unknown;
  /** Rubric text (llm-judge) OR a deterministic scorer's pattern/config. */
  rubric?: string;
  /** §9 — EXPLICIT resolved tenant id, for the judge's L1 trace correlation only. Never body-derived. */
  tenantId?: string | null;
  taskId?: string | null;
  traceId?: string | null;
  /** Human ground-truth label for this case (e.g. a thumbs rating: "positive"|"negative"). Read by human_label. */
  label?: string | null;
}

// Deterministic thresholds used only when a case supplies no explicit threshold via `expected`.
// Documented so the default is never a silent magic number (§24). A case can always override by
// putting a numeric threshold in `expected`.
const DEFAULT_LATENCY_MS = 30_000;
const DEFAULT_COST_USD = 0.5;

// ── helpers (pure) ────────────────────────────────────────────────────────────────────────────────
function outputString(v: unknown): string {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v ?? ""); } catch { return String(v ?? ""); }
}
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
/** Read a numeric metric from output.<keys> or output.metadata.<keys>. Returns null when absent. */
function readMetric(output: unknown, keys: string[]): number | null {
  const o = asObject(output);
  if (!o) return null;
  const meta = asObject(o.metadata) ?? {};
  for (const k of keys) {
    const v = o[k] ?? meta[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Build a deterministic ScoreResult. score===null → an honest needs_config (never a defaulted pass, §31). */
function det(scorer: string, score: 0 | 1 | null, rationale?: string): ScoreResult {
  if (score === null) {
    return { scorer, scorerKind: "deterministic", score: null, passed: null, status: "needs_config", rationale };
  }
  return { scorer, scorerKind: "deterministic", score, passed: score === 1, status: "scored", rationale };
}

// ── the deterministic registry ──────────────────────────────────────────────────────────────────
export const DETERMINISTIC_SCORERS: Record<string, (input: ScorerInput) => ScoreResult> = {
  // Exact equality of output vs expected (string ===, else JSON-structural). No expected → can't score.
  exact_match(input) {
    if (input.expected === undefined) return det("exact_match", null, "no expected value supplied");
    const a = typeof input.output === "string" ? input.output : outputString(input.output);
    const b = typeof input.expected === "string" ? input.expected : outputString(input.expected);
    return det("exact_match", a === b ? 1 : 0);
  },

  // output (as text) contains the expected substring. No expected string → can't score.
  contains(input) {
    if (typeof input.expected !== "string" || input.expected.length === 0) {
      return det("contains", null, "no expected substring supplied");
    }
    return det("contains", outputString(input.output).includes(input.expected) ? 1 : 0);
  },

  // output is valid JSON (an object as-is, or a string that parses). Always evaluable → scored 1|0.
  json_valid(input) {
    if (asObject(input.output) || Array.isArray(input.output)) return det("json_valid", 1);
    if (typeof input.output === "string") {
      try { JSON.parse(input.output); return det("json_valid", 1); } catch { return det("json_valid", 0); }
    }
    return det("json_valid", 0);
  },

  // output (as text) matches a regex from rubric. No/invalid pattern → can't score (needs_config).
  regex_match(input) {
    const pattern = typeof input.rubric === "string" ? input.rubric.trim() : "";
    if (!pattern) return det("regex_match", null, "no regex pattern supplied (rubric)");
    let re: RegExp;
    try { re = new RegExp(pattern); } catch { return det("regex_match", null, "invalid regex pattern"); }
    return det("regex_match", re.test(outputString(input.output)) ? 1 : 0);
  },

  // latency under threshold. Metric read from output/metadata; absent → can't score (§31).
  latency_threshold(input) {
    const ms = readMetric(input.output, ["latencyMs", "latency_ms", "latency"]);
    if (ms === null) return det("latency_threshold", null, "no latency metric on output/metadata");
    const threshold = typeof input.expected === "number" ? input.expected : DEFAULT_LATENCY_MS;
    return det("latency_threshold", ms <= threshold ? 1 : 0, `latency ${ms}ms vs ${threshold}ms`);
  },

  // cost under threshold. Metric read from output/metadata; absent → can't score (§31).
  cost_threshold(input) {
    const usd = readMetric(input.output, ["costUsd", "cost_estimate_usd", "cost"]);
    if (usd === null) return det("cost_threshold", null, "no cost metric on output/metadata");
    const threshold = typeof input.expected === "number" ? input.expected : DEFAULT_COST_USD;
    return det("cost_threshold", usd <= threshold ? 1 : 0, `cost $${usd} vs $${threshold}`);
  },

  // the produced result did NOT degrade (output.degraded === false). No boolean degraded → can't score.
  non_degraded(input) {
    const o = asObject(input.output);
    if (!o || typeof o.degraded !== "boolean") return det("non_degraded", null, "no boolean `degraded` on output");
    return det("non_degraded", o.degraded === false ? 1 : 0);
  },

  // at least one memory anchor was used (output.anchorsUsed > 0). No numeric anchorsUsed → can't score.
  anchors_used(input) {
    const o = asObject(input.output);
    const n = o?.anchorsUsed;
    if (typeof n !== "number" || !Number.isFinite(n)) return det("anchors_used", null, "no numeric `anchorsUsed` on output");
    return det("anchors_used", n > 0 ? 1 : 0);
  },

  // human ground-truth label (§34-L2 feedback channel) — a chat thumbs rating.
  // "positive" → 1, "negative" → 0. Zero LLM cost: it IS the human's verdict. No
  // label → can't score (never a defaulted pass, §31).
  human_label(input) {
    const label = typeof input.label === "string" ? input.label.trim().toLowerCase() : "";
    if (label === "positive") return det("human_label", 1, "human thumbs-up");
    if (label === "negative") return det("human_label", 0, "human thumbs-down");
    return det("human_label", null, "no human rating on case");
  },

  // the output has a valid StrategyPlan shape: {decomposition[], approach:string, risks[], successCriteria[]}.
  // A structural check is always evaluable — a non-conforming shape is a real 0, not a needs_config.
  structural_valid(input) {
    const o = asObject(input.output);
    const okShape = !!o
      && Array.isArray(o.decomposition)
      && typeof o.approach === "string"
      && Array.isArray(o.risks)
      && Array.isArray(o.successCriteria);
    return det("structural_valid", okShape ? 1 : 0);
  },
};

// ── the LLM judge ─────────────────────────────────────────────────────────────────────────────────
const JUDGE_SYSTEM =
  "You are Paige's eval JUDGE. Score how well the OUTPUT satisfies the RUBRIC on a 0..1 scale " +
  "(1 = fully satisfies, 0 = fails). Judge only against the rubric; be strict and specific. " +
  'Return STRICT JSON with exactly these keys: {"score": <number 0..1>, "rationale": <string>}. ' +
  "Output ONLY the JSON object — no prose, no code fence.";

// The judge's cost comes from the ONE pricing home (§18). This used to be a local copy, with a
// comment explaining that the router did not export its estimator — so the platform carried three
// token-price tables that could drift apart silently. `_shared/llm-trace.ts` owns the rate now, and
// this passes the judge's model so a haiku judge is not booked at reasoning-tier prices.
// Still an estimate recorded on the result, never a bill (§13).
function estimateJudgeCost(model: string | null, tokensIn?: number, tokensOut?: number): number | undefined {
  return estimateTokenCostUsd("anthropic", model, tokensIn, tokensOut);
}

/** Extract the outermost {...} JSON object from a (possibly fenced/prose-wrapped) reply. review.ts idiom. */
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(fenced.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * rubricJudge — score one output against a rubric with a frontier reasoning call (§17). NEVER throws.
 * On any throw/unparseable reply → score:null, status:"low_confidence" (a broken judge must NOT
 * fabricate a pass, §31 — the INVERSE of the visual critic's fail-open-to-SHIP). The single call
 * self-traces to L1 via routedChatCompletion(trace); we wire no second trace (no double-count).
 */
export async function rubricJudge(input: ScorerInput, trace?: TraceCtx, version: "v1" | "v2" | "v3" = "v1"): Promise<ScoreResult> {
  // R3 judge repair: v1 keeps its exact original behavior (500-token budget) so the frozen
  // Q0 baseline stays reproducible. v2 raises ONLY the output budget (1600) — the finding-wise
  // entailment audits degraded at 500 — and stamps the scorer name so results are separable.
  // R6-A G.3 (owner ruling): v3 = the deliberately versioned successor after Sonnet 5's
  // retirement — same rubric, same 1600-token budget, evaluator pinned by the ROUTE the
  // served model reports (Sonnet 5.5 via the #1783 seam), scorer name stamped, and NO
  // dynamic routing / failover of its own: an unavailable evaluator returns null, preserved.
  const maxTokens = version === "v2" || version === "v3" ? 1600 : 500;
  const scorerName = version === "v3" ? "rubric_judge_v3" : version === "v2" ? "rubric_judge_v2" : "rubric_judge";
  const rubric = typeof input.rubric === "string" ? input.rubric.trim() : "";
  if (!rubric) {
    return { scorer: scorerName, scorerKind: "llm_judge", score: null, passed: null, status: "needs_config", rationale: "no rubric supplied" };
  }

  const ctx: TraceCtx = {
    tenant_id: trace?.tenant_id ?? input.tenantId ?? null,
    task_id: trace?.task_id ?? input.taskId ?? null,
    agent_id: trace?.agent_id ?? "paige-eval-judge",
    parent_trace_id: trace?.parent_trace_id ?? null,
    job_kind: trace?.job_kind ?? "eval:rubric_judge",
  };

  let content = "";
  let model: string | null = null;
  let costUsd: number | undefined;
  try {
    // Assemble INSIDE the try so even a stringify throw degrades safely (§13 airtight).
    const expectedBlock = input.expected !== undefined ? `\n\nReference (expected):\n${outputString(input.expected)}` : "";
    const body = {
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: `Rubric:\n${rubric}\n\nOutput to score:\n${outputString(input.output)}${expectedBlock}` },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    };
    const resp = await routedChatCompletion("plan", body, ctx);
    content = resp?.choices?.[0]?.message?.content ?? "";
    model = resp?.model ?? null;
    costUsd = estimateJudgeCost(model, resp?.usage?.prompt_tokens, resp?.usage?.completion_tokens);
  } catch (e) {
    console.error("[eval] rubricJudge call failed (non-fatal):", (e as Error)?.message);
    return { scorer: scorerName, scorerKind: "llm_judge", score: null, passed: null, status: "low_confidence", rationale: "judge call errored", judgeModel: model };
  }

  const parsed = extractJson(content);
  const raw = parsed?.score;
  const score = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null;
  if (score === null) {
    // Unparseable / no numeric score → low_confidence, NEVER a fabricated pass (§31).
    console.error("[eval] rubricJudge unparseable reply:", content.slice(0, 300));
    return { scorer: scorerName, scorerKind: "llm_judge", score: null, passed: null, status: "low_confidence", rationale: "judge reply unparseable", judgeModel: model, costUsd };
  }
  const rationale = typeof parsed?.rationale === "string" ? parsed.rationale.slice(0, 1000) : undefined;
  // A judge's numeric score passes at >= 0.5 (a scored, real verdict — not a fabricated default).
  return { scorer: scorerName, scorerKind: "llm_judge", score, passed: score >= 0.5, status: "scored", rationale, judgeModel: model, costUsd };
}
