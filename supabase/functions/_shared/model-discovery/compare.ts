// model-discovery/compare.ts — ANT-37: the cost-per-COMPLETED-task comparator. PURE.
//
// THE QUESTION IT ANSWERS: for one PAIGE workload (a classification call, an operational round, a
// frontier turn), what would this candidate COST PER SUCCESSFULLY COMPLETED TASK versus the
// incumbent — not per advertised token. Advertised prices are one input; the others are PAIGE's
// frozen workload distributions and, when they exist, MEASURED reliability (success rate, fallback
// incidence). Every output number carries its basis: "estimated" (prices × frozen workload) or
// "measured" (prices × workload ÷ observed reliability). Unknown pricing is `undefined` — a model
// with no price basis is never compared as if it were free (§13).
//
// IT RECOMMENDS NOTHING. It returns arithmetic with labels; the DISCOVERED→…→VERIFIED lifecycle and
// every routing decision remain owner-gated (ANT-37 §5). Latency is REPORTED when measured; it is
// never silently multiplied into a "quality" score — quality comparison belongs to AI-2 (ANT-36).

import { incumbentForClass, type ModelCandidate, type WorkloadClass, type WorkloadDistribution } from "./registry.ts";

export interface ReliabilityMeasured {
  /** 0..1 of calls that completed without a provider-health fallback or terminal failure. */
  success_rate: number;
  /** 0..1 of calls that fell over to the governed fallback (each one still completed the task, at the fallback's cost — excluded here, counted separately by the watch). */
  fallback_rate: number;
  source: string;
}

export interface TaskCostEstimate {
  per_task_usd: number;
  basis: "estimated" | "measured";
  workload_measured: boolean;
  components: { tokens_in: number; tokens_out: number; in_per_1k: number; out_per_1k: number; success_rate?: number };
  /** Present when the workload distribution is a proxy — the label is the honesty, not a footnote. */
  workload_proxy?: string;
}

/** The per-task arithmetic: (in×p_in + out×p_out)/1000, divided by success when measured. */
export function estimateTaskCost(candidate: ModelCandidate, workload: WorkloadDistribution, reliability?: ReliabilityMeasured): TaskCostEstimate | undefined {
  const pricing = candidate.pricing;
  if (!pricing) return undefined; // no price basis → no estimate, never free
  if (reliability && (reliability.success_rate <= 0 || reliability.success_rate > 1)) {
    throw new Error("model-discovery: success_rate must be in (0,1]");
  }
  const gross = (workload.tokens_in_p50 * pricing.input_per_1k + workload.tokens_out_p50 * pricing.output_per_1k) / 1000;
  const success = reliability?.success_rate;
  return {
    per_task_usd: success !== undefined ? gross / success : gross,
    basis: reliability ? "measured" : "estimated",
    workload_measured: workload.measured,
    components: {
      tokens_in: workload.tokens_in_p50,
      tokens_out: workload.tokens_out_p50,
      in_per_1k: pricing.input_per_1k,
      out_per_1k: pricing.output_per_1k,
      ...(success !== undefined ? { success_rate: success } : {}),
    },
    ...(workload.proxy_basis ? { workload_proxy: workload.proxy_basis } : {}),
  };
}

export interface WorkloadComparison {
  workload: WorkloadClass;
  incumbent_id: string;
  candidate_id: string;
  incumbent?: TaskCostEstimate;
  candidate?: TaskCostEstimate;
  /** Percentage the candidate is cheaper (negative = more expensive). Undefined when either side has no basis. */
  cheaper_pct?: number;
  verdict: "candidate_worth_review" | "not_cheaper" | "unknown_basis";
}

/**
 * Compare a challenger against the serving incumbent for ONE workload class. The verdict is
 * arithmetic, not a recommendation: `candidate_worth_review` means "cheaper on the stated bases —
 * a fact for OWNER REVIEW", never "should serve".
 */
export function compareForWorkload(
  candidate: ModelCandidate,
  workload: WorkloadClass,
  workloadDist: WorkloadDistribution,
  incumbentReliability?: ReliabilityMeasured,
  candidateReliability?: ReliabilityMeasured,
): WorkloadComparison {
  const incumbent = incumbentForClass(workload);
  const inc = estimateTaskCost(incumbent, workloadDist, incumbentReliability);
  const chal = estimateTaskCost(candidate, workloadDist, candidateReliability);
  const base: WorkloadComparison = { workload, incumbent_id: incumbent.id, candidate_id: candidate.id, incumbent: inc, candidate: chal, verdict: "unknown_basis" };
  if (!inc || !chal) return base; // unknown pricing on either side → no comparison, never free
  const cheaper = Math.round(((inc.per_task_usd - chal.per_task_usd) / inc.per_task_usd) * 1000) / 10;
  return { ...base, cheaper_pct: cheaper, verdict: cheaper > 0 ? "candidate_worth_review" : "not_cheaper" };
}
