// _shared/eval/gate.ts — §34 Layer 2 (Quality/Evals): the bounded run orchestrator.
//
// runEval takes a RESOLVED tenant id (never body-derived here — the edge fn resolves + authorizes it),
// a set of already-selected cases (or trace rows the caller pre-selected + filtered to the tenant), and
// a scorer set. It runs each scorer over each case, collects ScoreResults, and computes the honest
// aggregate:
//   • aggregateScore = mean over results with a REAL (non-null) score; NULL when nothing scored (never
//     0-coerced — null ≠ zero, §31).
//   • passRate     = fraction passed over the SCORED results; NULL when nothing scored.
//   • degraded     = scoredCount === 0 (the whole run added no real judgment, §13).
//   • costUsd      = sum of the scorer calls' clearly-labeled ESTIMATES.
//
// BOUNDED (§33-style caps so a run can't run away): EVAL_MAX_CASES (default 200) and
// EVAL_COST_CAP_USD (default 5). On either cap it STOPS scoring and marks the run (logged, honest).
//
// NEVER throws into the caller: a scorer throw → an error-status ScoreResult (excluded from the
// aggregate), never a broken run. This module is PURE orchestration; the edge fn does the DB I/O +
// tenant resolution. §34: model-router only (via the judge), no vendor eval SDK.
import type { TraceCtx } from "../llm-trace.ts";
import type { EvalResult, ScoreResult } from "./types.ts";
import { DETERMINISTIC_SCORERS, rubricJudge, type ScorerInput } from "./scorers.ts";

const EVAL_MAX_CASES = Number(Deno.env.get("EVAL_MAX_CASES") ?? "200");
const EVAL_COST_CAP_USD = Number(Deno.env.get("EVAL_COST_CAP_USD") ?? "5");

/** One normalized case the gate scores. `output` is the produced thing to score (the edge fn maps it
 *  from a dataset case's stored output or a trace row's output_excerpt — the gate does NOT execute a
 *  target, that is a later slice). expected/rubric feed the scorers; the ids are for result stamping. */
export interface EvalCase {
  caseId?: string | null;
  sourceTraceId?: string | null;
  output: unknown;
  expected?: unknown;
  rubric?: string;
  /** Human ground-truth label for this case (e.g. a thumbs rating). Feeds the human_label scorer. */
  label?: string | null;
}

export interface RunEvalOpts {
  runId: string;
  /** §9 — RESOLVED tenant id, never body-derived here (the edge fn owns resolution). */
  tenantId: string | null;
  target: { kind: string; ref: string; version?: string };
  cases: EvalCase[];
  /** Scorer names to apply; "rubric_judge" triggers the frontier LLM judge (§17). */
  scorers: string[];
  taskId?: string | null;
  /** Correlation parent so each judge's L1 trace is a child of the run node (§34-L1). */
  parentTraceId?: string | null;
  /** Baseline aggregate to compare against for regressedVsPrev (from prev_run_id); null → no compare. */
  prevAggregateScore?: number | null;
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** PURE aggregate math over a flat list of ScoreResults. Mirrored VERBATIM in scripts/eval-smoke.mjs —
 *  keep the two in sync. aggregateScore/passRate are NULL when nothing scored (never 0-coerced, §31). */
export function aggregateScores(results: ScoreResult[]): {
  scoredCount: number;
  degradedCount: number;
  aggregateScore: number | null;
  passRate: number | null;
  degraded: boolean;
  costUsd: number;
} {
  const real = results.filter((r) => r.score !== null && r.score !== undefined);
  const scoredCount = real.length;
  const degradedCount = results.length - scoredCount;
  const aggregateScore = scoredCount === 0
    ? null
    : round4(real.reduce((s, r) => s + (r.score as number), 0) / scoredCount);
  const passedCount = real.filter((r) => r.passed === true).length;
  const passRate = scoredCount === 0 ? null : round4(passedCount / scoredCount);
  const costUsd = round4(results.reduce((s, r) => s + (typeof r.costUsd === "number" ? r.costUsd : 0), 0));
  return { scoredCount, degradedCount, aggregateScore, passRate, degraded: scoredCount === 0, costUsd };
}

/**
 * Run a bounded eval. Never throws. Returns an EvalResult with the honest aggregate + per-scorer
 * results. Stops early (logged) on the case/cost cap. A scorer error becomes an error-status result,
 * excluded from the aggregate — it never breaks the run.
 */
export async function runEval(opts: RunEvalOpts): Promise<EvalResult> {
  const results: ScoreResult[] = [];
  const scorerNames = Array.isArray(opts.scorers) ? opts.scorers : [];
  const cases = Array.isArray(opts.cases) ? opts.cases : [];

  let processed = 0;
  let runningCost = 0;
  let capped = false;

  outer:
  for (const c of cases) {
    if (processed >= EVAL_MAX_CASES) {
      capped = true;
      console.warn(`[eval] case cap (${EVAL_MAX_CASES}) reached — stopping after ${processed} cases`);
      break;
    }
    processed++;

    const input: ScorerInput = {
      output: c.output,
      expected: c.expected,
      rubric: c.rubric,
      label: c.label ?? null,
      tenantId: opts.tenantId,
      taskId: opts.taskId,
      traceId: c.sourceTraceId ?? null,
    };

    for (const name of scorerNames) {
      if (runningCost >= EVAL_COST_CAP_USD) {
        capped = true;
        console.warn(`[eval] cost cap ($${EVAL_COST_CAP_USD}) reached — stopping (spent ~$${round4(runningCost)})`);
        break outer;
      }

      let result: ScoreResult;
      try {
        if (name === "rubric_judge" || name === "rubric_judge_v2" || name === "rubric_judge_v3") {
          const trace: TraceCtx = {
            tenant_id: opts.tenantId ?? null,
            task_id: opts.taskId ?? null,
            agent_id: "paige-eval-judge",
            parent_trace_id: opts.parentTraceId ?? null,
            job_kind: "eval:rubric_judge",
          };
          result = await rubricJudge(input, trace, name === "rubric_judge_v2" ? "v2" : name === "rubric_judge_v3" ? "v3" : "v1");
          runningCost += typeof result.costUsd === "number" ? result.costUsd : 0;
        } else {
          const scorer = DETERMINISTIC_SCORERS[name];
          if (!scorer) {
            result = { scorer: name, scorerKind: "deterministic", score: null, passed: null, status: "error", rationale: "unknown scorer" };
          } else {
            result = scorer(input); // pure, never throws — try is belt-and-suspenders (§13)
          }
        }
      } catch (e) {
        // A scorer throw must NEVER break the run — record it as an error result, excluded from aggregate.
        console.error(`[eval] scorer "${name}" threw (non-fatal):`, (e as Error)?.message);
        result = { scorer: name, scorerKind: name === "rubric_judge" || name === "rubric_judge_v2" || name === "rubric_judge_v3" ? "llm_judge" : "deterministic", score: null, passed: null, status: "error", rationale: "scorer threw" };
      }
      results.push(result);
    }
  }

  const agg = aggregateScores(results);
  if (capped) console.warn(`[eval] run ${opts.runId} was capped — considered ${processed}/${cases.length} cases`);

  const regressedVsPrev = typeof opts.prevAggregateScore === "number" && agg.aggregateScore !== null
    ? agg.aggregateScore < opts.prevAggregateScore
    : undefined;

  return {
    runId: opts.runId,
    target: opts.target,
    caseCount: processed,
    scoredCount: agg.scoredCount,
    degradedCount: agg.degradedCount,
    aggregateScore: agg.aggregateScore,
    passRate: agg.passRate,
    results,
    costUsd: agg.costUsd,
    degraded: agg.degraded,
    ...(regressedVsPrev !== undefined ? { regressedVsPrev } : {}),
  };
}
