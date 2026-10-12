// paige-deep-research/fabric.ts — R6-B (#1851): the research-owned consumer adapter onto the
// shared Model Fabric class seam (INT-334 #1831 `fabricCompletion`). ONE job: take a research
// phase + the engine's OWN declared cognitive class (RESEARCH_COGNITIVE_CLASSES, R6-A), and
// dispatch the model call — WITHOUT research ever naming a provider, a model, a policy, a
// candidate order, or a fallback rule. The fabric owns all of that (one CLASS_POLICY, one
// mayFallback, one failure classifier — no second route table anywhere in this file).
//
// DORMANT BY CONSTRUCTION. RESEARCH_FABRIC_ENABLED ships false; while false every call is
// byte-parity with the R5/R6-A shipped path (routedChatCompletion under the SAME job kinds,
// the SAME body, no trace arg, no telemetry side-effects). Flipping it is an owner-gated
// release decision (#1851: the cheap planners move from the open-pool extract route to the
// fabric's cheap class — a MATERIAL provider-economics change that needs a measured diff and
// explicit authority first; the fabric path also makes research calls tenant-attributed and
// budget-gated where today's tenantless calls are ungated).
//
// WHAT RIDES THE FABRIC PATH WHEN ENABLED (and only then):
//   • the request carries `cognitive_class` (from the call site's RESEARCH_COGNITIVE_CLASSES
//     value — this adapter never invents a class) and a stable research job identity;
//   • the trace carries the SERVER-resolved tenant (M0 lineage), the research agent id, and
//     the run correlation. An unresolved tenant stays NULL — never a membership guess, never
//     a fabricated UUID (#1851 §5: no service-role subject invention);
//   • the fabric's served-route evidence (served class carrier, fallback flag, closed reason)
//     is projected into CLOSED diagnostic values — no attempt detail, no raw provider error
//     text, no model-choice guesses.
import { routedChatCompletion } from "../_shared/model-router.ts";
import { fabricCompletion } from "../_shared/model-fabric.ts";
import type { TraceCtx } from "../_shared/llm-trace.ts";

/** The release gate. False = the shipped R5/R6-A path, unchanged. Typed `boolean` so the
 * disabled branch does not narrow away at check time. */
export const RESEARCH_FABRIC_ENABLED: boolean = false;

/** The research phases that call a model. Deterministic phases never reach this adapter. */
export type ResearchFabricPhase = "hop_query_planner" | "unit_planner" | "unit_synthesis" | "dossier_synthesis";

/** The job kind each phase used before R6-B — the flag-OFF path must stay byte-identical. */
const ROUTED_JOB_KINDS: Record<ResearchFabricPhase, Parameters<typeof routedChatCompletion>[0]> = {
  hop_query_planner: "extract",
  unit_planner: "extract",
  unit_synthesis: "doc_draft",
  dossier_synthesis: "doc_draft",
};

/** Research's own stable job identities on the fabric route + trace rows. */
const FABRIC_JOBS: Record<ResearchFabricPhase, string> = {
  hop_query_planner: "research_hop_planner",
  unit_planner: "research_unit_planner",
  unit_synthesis: "research_unit_synthesis",
  dossier_synthesis: "research_dossier_synthesis",
};

/** Server-resolved run context (M0 lineage rules): what the engine may LAWFULLY report. */
export interface RunRequestCtx {
  /** M0-resolved tenant (JWT → current_user_tenant_id; service-role → active_tenant_id). NULL = unresolved — stays null. */
  tenantId: string | null;
  /** The research run id for trace correlation. */
  runId: string | null;
}

/** CLOSED served-route telemetry for dossier/unit diagnostics. No attempt detail, no errors. */
export interface FabricRouteDiag {
  requested_class: string | null;
  job: string | null;
  served_provider: string | null;
  served_model: string | null;
  fallback: boolean;
  reason: string;
  attempt_count: number;
}

/** Project the fabric's route evidence into closed diagnostic values. Degrades to honest
 * nulls/zero — never a fabricated route, never provider error text. */
export function projectRoute(route: unknown): FabricRouteDiag {
  const r = (route ?? {}) as {
    requested_class?: unknown; job?: unknown; served?: { provider?: unknown; model?: unknown } | null;
    fallback?: unknown; reason?: unknown; attempts?: unknown[];
  };
  return {
    requested_class: typeof r.requested_class === "string" ? r.requested_class : null,
    job: typeof r.job === "string" ? r.job : null,
    served_provider: typeof r.served?.provider === "string" ? r.served.provider : null,
    served_model: typeof r.served?.model === "string" ? r.served.model : null,
    fallback: r.fallback === true,
    reason: typeof r.reason === "string" ? r.reason : "failed",
    attempt_count: Array.isArray(r.attempts) ? r.attempts.length : 0,
  };
}

interface ResearchCompletionDeps {
  /** Test seam (the house pattern): defaults to the real shared transports. Never set in production. */
  routed: typeof routedChatCompletion;
  fabric: typeof fabricCompletion;
}
const DEFAULT_DEPS: ResearchCompletionDeps = { routed: routedChatCompletion, fabric: fabricCompletion };

/**
 * One research model call. `cognitiveClass` comes from the CALL SITE's
 * RESEARCH_COGNITIVE_CLASSES value; `body` is the exact request that phase has always sent.
 * Returns the chat-shaped response the call sites already parse plus (fabric path only) the
 * closed served-route telemetry. Throws on transport failure exactly like the legacy path —
 * callers' existing conservative catch/degrade contracts own every failure shape.
 */
export async function researchCompletion(
  phase: ResearchFabricPhase,
  cognitiveClass: string,
  body: Record<string, unknown>,
  ctx: RunRequestCtx,
  deps: ResearchCompletionDeps = DEFAULT_DEPS,
): Promise<{ resp: unknown; route: FabricRouteDiag | null }> {
  // NOTE: this vocabulary check runs BEFORE the flag check — deliberate fail-closed: an
  // invalid class is a caller bug in EVERY mode, and the dormant path does not silently
  // absorb it (the check inspects the value but consults no routing).
  if (cognitiveClass !== "cheap" && cognitiveClass !== "operational" && cognitiveClass !== "frontier") {
    // Deterministic phases are code and never call a model; refusing here keeps the class
    // vocabulary the engine's own declaration, not this adapter's invention.
    throw new Error(`researchCompletion: phase ${phase} declared ${cognitiveClass}; deterministic phases never call a model`);
  }
  if (!RESEARCH_FABRIC_ENABLED) {
    // BYTE-PARITY: same job kind, same body, no trace arg — the R5/R6-A shipped path.
    const resp = await deps.routed(ROUTED_JOB_KINDS[phase], body as unknown as Parameters<typeof routedChatCompletion>[1]);
    return { resp, route: null };
  }
  const job = FABRIC_JOBS[phase];
  const trace: TraceCtx = {
    tenant_id: ctx?.tenantId ?? null,
    agent_id: "paige-deep-research",
    task_id: ctx?.runId ?? null,
    job_kind: job,
  };
  const result = await deps.fabric(
    { ...body, cognitive_class: cognitiveClass as "cheap" | "operational" | "frontier", job } as Parameters<typeof fabricCompletion>[0],
    { trace },
  );
  if (!result.ok) {
    // The closed route reason only — provider text and identifiers never cross this line.
    throw new Error(`research_fabric_route_failed:${result.route?.reason ?? "failed"}`);
  }
  return { resp: result.response, route: projectRoute(result.route) };
}
