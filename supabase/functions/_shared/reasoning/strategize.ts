// _shared/reasoning/strategize.ts — §34 Layer 4, PHASE 1: Strategic Pre-Reasoning.
//
// Before Paige generates anything substantive, she THINKS about HOW first — the opposite of firing a
// raw prompt at a model and hoping (§26). This is the "measure twice" step: given a task brief, it
//   (a) recalls what worked for THIS tenant before (recallSimilar — the §14 "get smarter from constant
//       data" loop: past approved wins become few-shot anchors), and
//   (b) makes ONE governed reasoning call to produce a STRATEGY — decompose the task, pick an approach,
//       name the risks, and state the success criteria the downstream generation/verifier will be held to.
//
// It sits beside the Phase-4 bounded loop (engine.ts) and the trace/learning seam (trace.ts) as one home
// (§18). It does NOT clone the prompt-forge: the forge assembles the GENERATION prompt from brand DNA;
// this decides the PLAN the generation should follow. Different jobs, composed later in the pipeline.
//
// HONEST-DEGRADE CONTRACT (§13): pre-reasoning is an ENHANCEMENT. It must NEVER throw into, block, or
// break the actual generation the caller asked for. Every failure path (no tenant, recall miss, LLM
// error, unparseable reply) returns a `degraded` strategy and the caller proceeds exactly as it would
// have without this step.
//
// §17: the default reasoning call is `routedChatCompletion("plan", …)` — "plan" is a reasoning JobKind that
// routes to Claude's reasoning tier and can NEVER route to an open model. That call ALSO writes its own
// paige_llm_trace row (L1.1), so this module wires NO second trace (no double-count) — it just threads
// the correlation ctx onto routedChatCompletion's `trace` param. The existing Research gate may
// select the shared operational Fabric consumer instead; no provider/model policy lives here.
//
// §34: pure in-repo (model-router + prompt-forge). No vendor reasoning SDK.
import { routedChatCompletion } from "../model-router.ts";
import { fabricCompletion } from "../model-fabric.ts";
import { recallSimilar, type RecalledArtifact } from "../prompt-forge.ts";
import type { TraceCtx } from "../llm-trace.ts";

export interface StrategyPlan {
  /** The task broken into the concrete sub-steps the generation should cover. */
  decomposition: string[];
  /** The chosen approach in one or two sentences — HOW Paige will tackle it. */
  approach: string;
  /** What could go wrong / what to guard against (feeds the downstream verifier). */
  risks: string[];
  /** The bar the finished artifact must clear — what "good" looks like for this task. */
  successCriteria: string[];
  /** How many past-win anchors seeded the strategy (0 = none available; honest). */
  anchorsUsed: number;
  /** True when the strategy is a safe fallback (recall/LLM/parse degraded) — the caller proceeds
   *  regardless, but knows this pass added no real strategic lift (§13). */
  degraded: boolean;
}

export interface StrategizeOpts {
  /** The task/brief Paige is about to work on (the user intent). */
  task: string;
  /** Resolved tenant id (§9 — EXPLICIT, never caller-body-trusted). Null/absent → no memory anchors. */
  tenantId?: string | null;
  /** Correlation for the L1 trace row routedChatCompletion writes. */
  agentId?: string | null;
  taskId?: string | null;
  /** How many past-win anchors to seed with (default 3). */
  topN?: number;
  /** Trusted caller's existing release gate, never request/model JSON. Omitted or
   * false preserves the incumbent plan route; Research supplies its ONE false flag. */
  fabricEnabled?: boolean;
  beforeProviderAttempt?: () => boolean | Promise<boolean>;
  signal?: AbortSignal;
}

/** A safe, non-null strategy that lets the caller proceed unblocked when this pass can't add lift (§13). */
function fallback(task: string, anchorsUsed = 0): StrategyPlan {
  return {
    decomposition: [task.trim().slice(0, 300)].filter(Boolean),
    approach: "Proceed directly with the task as briefed.",
    risks: [],
    successCriteria: [],
    anchorsUsed,
    degraded: true,
  };
}

/** Build the anchor block from past approved wins — few-shot "you built these before" context. */
function anchorBlock(anchors: RecalledArtifact[]): string {
  if (!anchors.length) return "";
  const lines = anchors
    .map((a, i) => `  ${i + 1}. intent: ${typeof a.user_intent === "string" ? a.user_intent.slice(0, 200) : "(n/a)"}${typeof a.similarity === "number" ? ` (similarity ${a.similarity.toFixed(2)})` : ""}`)
    .join("\n");
  return `\n\nThis tenant has succeeded on similar work before — use these as anchors for what tends to land here:\n${lines}`;
}

const SYSTEM_PROMPT =
  "You are Paige's strategist. Before any work is produced, you plan HOW to tackle it — you do not do the " +
  "work itself. Given a task, return a tight strategy as STRICT JSON with exactly these keys: " +
  '{"decomposition": string[], "approach": string, "risks": string[], "successCriteria": string[]}. ' +
  "decomposition = the 3-6 concrete sub-steps the work must cover. approach = one or two sentences on the " +
  "method. risks = what could go wrong or must be guarded against. successCriteria = the bar the finished " +
  "result must clear. Be concrete and specific to THIS task. Output ONLY the JSON object, no prose, no code fence.";

/** Extract the first JSON object from a model reply that may be fenced or prose-wrapped.
 *  NOTE: the pure logic here (+ anchorBlock) is mirrored in scratchpad/strategize-test.mjs for a
 *  headless smoke test (the Deno import chain blocks a plain-Node import) — keep the two in sync. */
function parseStrategy(raw: string): Pick<StrategyPlan, "decomposition" | "approach" | "risks" | "successCriteria"> | null {
  if (!raw || typeof raw !== "string") return null;
  // Strip a ```json fence if present, then grab the outermost {...}.
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try { obj = JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : [];
  const approach = typeof o.approach === "string" ? o.approach.trim() : "";
  const decomposition = arr(o.decomposition);
  // A reply with neither an approach nor any steps carried no real strategy — treat as unparseable.
  if (!approach && decomposition.length === 0) return null;
  return { decomposition, approach, risks: arr(o.risks), successCriteria: arr(o.successCriteria) };
}

/**
 * Produce a strategy for a task before Paige generates. Never throws; on any degrade returns a safe
 * fallback the caller can proceed with (§13). The single reasoning call self-traces to L1 (§34).
 */
export async function strategizeBeforeReasoning(opts: StrategizeOpts): Promise<StrategyPlan> {
  const task = (opts.task ?? "").trim();
  if (!task) return fallback("");

  // The recall helper has no cancellation API. Stop waiting on abort and fence
  // every continuation; do not claim that its already-started IO was cancelled.
  const within = <T>(start: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const signal = opts.signal;
    const stop = () => reject(new Error("strategy_attempt_stopped"));
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new Error("strategy_attempt_stopped");
      return start();
    }).then(resolve, reject).finally(() => signal?.removeEventListener("abort", stop));
  });
  const current = async (): Promise<boolean> => {
    if (opts.signal?.aborted) return false;
    try {
      const permitted = !opts.beforeProviderAttempt || await within(async () => await opts.beforeProviderAttempt!() === true);
      return permitted && !opts.signal?.aborted;
    } catch { return false; }
  };
  if (!(await current())) return fallback(task);

  // (a) Seed with past wins — §9 explicit tenant, honest-degrade to [] on any miss (recallSimilar never throws).
  let anchors: RecalledArtifact[] = [];
  if (opts.tenantId) {
    try {
      anchors = await within(() => recallSimilar(task, opts.tenantId!, Math.max(1, Math.min(opts.topN ?? 3, 10))));
    } catch {
      anchors = []; // belt-and-suspenders: recall is already non-throwing, but never let it break pre-reasoning
    }
  }
  if (!(await current())) return fallback(task);

  // (b) One shared reasoning request. The legacy plan route or gated operational Fabric writes
  //     its OWN paige_llm_trace rows — we thread ctx, never add a second trace writer.
  const trace: TraceCtx = {
    tenant_id: opts.tenantId ?? null,
    agent_id: opts.agentId ?? "paige-strategist",
    task_id: opts.taskId ?? null,
    job_kind: "reason:strategize",
  };
  let content = "";
  try {
    // Assemble the request INSIDE the try so even an anchorBlock/assembly throw (e.g. a malformed recall
    // row) degrades to the fallback rather than escaping into the caller's generation (§13 airtight).
    const body = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Task:\n${task}${anchorBlock(anchors)}` },
      ],
      temperature: 0.3,
      max_tokens: 1000, // headroom so a rich strategy doesn't truncate mid-JSON → avoidable silent degrade
    };
    if (!(await current())) return fallback(task, anchors.length);
    const resp = await within(async () => {
      if (opts.fabricEnabled === true) {
        const result = await fabricCompletion({ ...body, cognitive_class: "operational", job: "reason_strategize" },
          { trace, beforeProviderAttempt: current, signal: opts.signal });
        if (!result.ok) throw new Error(`strategy_fabric_failed:${result.route.reason}`);
        return result.response;
      }
      // No callback/signal parameter exists on the legacy transport. The fences
      // here bound waiting and use of results, not its internal budget/HTTP leg.
      return await routedChatCompletion("plan", body, trace);
    });
    if (!(await current())) return fallback(task);
    content = resp?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    console.error("[strategize] reasoning call failed (non-fatal):", (e as Error)?.message);
    return fallback(task, anchors.length); // §13: generation proceeds unblocked
  }

  const parsed = parseStrategy(content);
  if (!parsed) return fallback(task, anchors.length);

  return { ...parsed, anchorsUsed: anchors.length, degraded: false };
}
