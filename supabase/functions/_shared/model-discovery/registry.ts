// model-discovery/registry.ts — ANT-37: the versioned, source-backed model-candidate registry.
//
// WHAT THIS IS: the data half of the Model Discovery Watch. It records what official sources say
// about models PAIGE might someday consider — every entry names its official source and the
// observation timestamp; unknown is `unknown`/`undefined`, NEVER a guess, never "free" (§13).
//
// WHAT THIS IS NOT: routing authority. `openai-models.ts`, `paige-turn/route.ts` `CLASS_POLICY` and
// `model-fabric.ts` remain the ONLY serving truth (OpenAI primary: Luna cheap / Sol operational /
// Astra frontier; Anthropic governed fallback). Nothing here is read by the fabric, and no entry
// gains production authority by existing — the lifecycle below is informational and owner-gated at
// every advance. A candidate that has not reached `verified_release` is a HYPOTHESIS.
//
// THE LIFECYCLE (ANT-37 §5; enforced no-skip by diff.ts/harness, never auto-advanced):
//   discovered → compatible → benchmark_proposed → measured → owner_review
//   → authorized_validation → verified_release        (rejected is terminal from any state)
// Advancing a candidate is an owner action recorded by hand in this file's history; detection,
// diffing and comparison NEVER move a candidate forward on their own.
//
// PRICE TRUTH: `token-pricing.ts` stays the ONE price home. Incumbent entries CITE it rather than
// restating numbers; challenger prices are source-attributed observations. The comparator
// (compare.ts) reads rates through `tokenRate()` so there is exactly one place a price can drift.
//
// WORKLOAD DISTRIBUTIONS: frozen once, from read-only AGGREGATE `paige_llm_trace` queries (no
// excerpts, no PII, no tenant identifiers — counts and percentiles only). Provenance per entry;
// where PAIGE has no measured traffic (frontier today) the distribution says so and the comparator
// labels every number built on the proxy as an ESTIMATE.

import { OPENAI_MODEL_BY_CLASS, OPENAI_EFFORT_BY_CLASS } from "../openai-models.ts";
import { tokenRate } from "../token-pricing.ts";

// ── Types ─────────────────────────────────────────────────────────────────────────────────────

export type WorkloadClass = "cheap" | "operational" | "frontier";

/** The owner-gated informational lifecycle. Order is enforced; nothing auto-advances. */
export const DISCOVERY_LIFECYCLE = [
  "discovered",
  "compatible",
  "benchmark_proposed",
  "measured",
  "owner_review",
  "authorized_validation",
  "verified_release",
] as const;
export type DiscoveryLifecycle = (typeof DISCOVERY_LIFECYCLE)[number] | "rejected";

/** Where a fact came from. `platform` = PAIGE's own serving/price config (itself source-attributed). */
export interface ModelSource {
  kind: "official_docs" | "official_api" | "platform";
  url: string;
  observed_at: string; // ISO date the fact was observed, never the entry's edit date
}

/** List prices, $/1K tokens, attributed. `cached_input` may be unknown (undefined), never zero-guessed. */
export interface ObservedPricing {
  input_per_1k: number;
  output_per_1k: number;
  cached_input_per_1k?: number;
  basis: "list" | "platform_config";
  source: ModelSource;
}

export interface ObservedCapabilities {
  tools: boolean | "unknown";
  structured_output: boolean | "unknown";
  streaming: boolean | "unknown";
  reasoning: "none" | "low" | "medium" | "high" | "unknown";
  document_input: "native" | "none" | "unknown";
}

export interface ModelCandidate {
  id: string;
  provider: "openai" | "anthropic" | "groq" | "featherless" | "open_weight";
  family: string;
  /** The class this model serves in production — INCUMBENTS ONLY. A challenger has none. */
  serving_class?: WorkloadClass;
  lifecycle: DiscoveryLifecycle;
  availability: "ga" | "preview" | "deprecated" | "retired" | "unknown";
  context_tokens?: number;
  output_tokens?: number;
  pricing?: ObservedPricing;
  capabilities: ObservedCapabilities;
  license_note?: string;
  privacy_note?: string;
  source: ModelSource;
}

/** One frozen workload distribution. `measured: false` means PAIGE has no organic traffic basis. */
export interface WorkloadDistribution {
  workload: WorkloadClass | "classification";
  tokens_in_p50: number;
  tokens_out_p50: number;
  latency_p90_ms?: number;
  sample_rows: number;
  measured: boolean;
  /** Named explicitly when numbers are a proxy, never silently borrowed. */
  proxy_basis?: string;
  provenance: string;
}

// ── Frozen workload distributions (read-only aggregates; provenance per entry) ────────────────
// Derived 2026-10-11 from `paige_llm_trace` (percentile_cont over success rows with tokens, no
// excerpts/PII). Regenerating is an owner-noted edit: these are FROZEN so comparator outputs are
// reproducible, not drifting with each day's traffic.
export const WORKLOAD_DISTRIBUTIONS: Readonly<Record<"classification" | "operational" | "frontier", WorkloadDistribution>> = {
  classification: {
    workload: "classification",
    tokens_in_p50: 501,
    tokens_out_p50: 63,
    latency_p90_ms: 1012,
    sample_rows: 39,
    measured: true,
    provenance: "paige_llm_trace job_kind=turn-classify success rows, 30d to 2026-10-11, percentile_cont(0.5/0.9)",
  },
  operational: {
    workload: "operational",
    tokens_in_p50: 1840,
    tokens_out_p50: 84,
    sample_rows: 57,
    measured: true,
    provenance: "paige_llm_trace route_requested_class=operational success rows, 14d to 2026-10-11, percentile_cont(0.5)",
  },
  frontier: {
    workload: "frontier",
    tokens_in_p50: 1840,
    tokens_out_p50: 84,
    sample_rows: 0,
    measured: false,
    proxy_basis: "no organic frontier traffic exists; the operational distribution is used as an explicitly-labeled proxy",
    provenance: "proxy — zero frontier-class rows in paige_llm_trace to 2026-10-11 (ANT-46 watch open)",
  },
};

// ── The incumbents — DERIVED from the live serving/price sources, never restated ─────────────
// If openai-models.ts or token-pricing.ts changes, these entries change with them (the harness
// cross-checks), so the registry can never quietly disagree with what production actually serves.
const INCUMBENT_SOURCE: ModelSource = {
  kind: "platform",
  url: "supabase/functions/_shared/openai-models.ts + token-pricing.ts",
  observed_at: "2026-10-11",
};
const PLATFORM_CAPS: ObservedCapabilities = {
  tools: true,
  structured_output: true,
  streaming: true,
  reasoning: "unknown", // per-class below
  document_input: "unknown", // the adapter refuses file parts today (EVIDENCE ANT-46 P2s)
};

function incumbentFor(id: string): ModelCandidate {
  const rate = tokenRate("openai", id);
  if (!rate) throw new Error(`model-discovery: incumbent ${id} has no price basis in token-pricing.ts`);
  return {
    id,
    provider: "openai",
    family: id.split("-").slice(0, 2).join("-"),
    lifecycle: "verified_release",
    availability: "ga",
    capabilities: { ...PLATFORM_CAPS },
    source: INCUMBENT_SOURCE,
    pricing: {
      input_per_1k: rate.in,
      output_per_1k: rate.out,
      basis: "platform_config",
      source: { kind: "platform", url: "token-pricing.ts OPENAI_MODEL_PER_1K (list prices from openai.com)", observed_at: "2026-10-11" },
    },
  };
}

const LUNA = { ...incumbentFor(OPENAI_MODEL_BY_CLASS.cheap), serving_class: "cheap" as const };
const SOL = { ...incumbentFor(OPENAI_MODEL_BY_CLASS.operational), serving_class: "operational" as const };
const ASTRA = { ...incumbentFor(OPENAI_MODEL_BY_CLASS.frontier), serving_class: "frontier" as const };
LUNA.capabilities.reasoning = OPENAI_EFFORT_BY_CLASS.cheap;
SOL.capabilities.reasoning = OPENAI_EFFORT_BY_CLASS.operational;
ASTRA.capabilities.reasoning = OPENAI_EFFORT_BY_CLASS.frontier;

// ── The seed registry ────────────────────────────────────────────────────────────────────────
// Incumbents (derived above) + the one challenger the owner named for comparison (ANT-37 directive:
// "Haiku is an example of a model to compare for latency/economics; not approval to make unfunded
// Anthropic an everyday primary route"). Challenger facts are source-attributed; unknowns stay
// unknown. Additional candidates arrive as diff.ts observations from the watch — never hand-waved.
export const MODEL_REGISTRY: Readonly<Record<string, ModelCandidate>> = {
  [LUNA.id]: LUNA,
  [SOL.id]: SOL,
  [ASTRA.id]: ASTRA,
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    family: "claude-haiku",
    lifecycle: "discovered",
    availability: "ga",
    capabilities: {
      // Known from PAIGE's own production use (the classification tier) — platform observation.
      tools: true,
      structured_output: true,
      streaming: true,
      reasoning: "none",
      document_input: "native",
    },
    license_note: "commercial API terms",
    source: {
      kind: "official_docs",
      url: "https://www.anthropic.com/pricing",
      observed_at: "2026-10-10",
    },
    pricing: {
      input_per_1k: 0.001,
      output_per_1k: 0.005,
      basis: "list",
      source: { kind: "official_docs", url: "https://www.anthropic.com/pricing", observed_at: "2026-10-10" },
    },
  },
};

/** The incumbents by workload class — the comparison baseline the comparator argues against. */
export function incumbentForClass(workload: WorkloadClass): ModelCandidate {
  const found = Object.values(MODEL_REGISTRY).find((c) => c.serving_class === workload);
  if (!found) throw new Error(`model-discovery: no incumbent recorded for ${workload}`);
  return found;
}
