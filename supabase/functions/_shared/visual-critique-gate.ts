// _shared/visual-critique-gate.ts — the design agent's generate→critique→iterate loop (§25/§33).
//
// This is the thin orchestration the design agent runs AROUND a visual generation: screenshot the
// result (via studio-visual-critique), read the SHIP/ITERATE/BLOCK verdict, and on ITERATE/BLOCK feed
// the critic's refined prompt back into a regenerate step — up to the §33 iteration cap. It lives in
// _shared (not inlined in paige-ai-chat) so the loop is one testable home (§18) and any caller —
// paige-ai-chat OR Paige's headless agent — drives it the same way.
//
// GATED OFF BY DEFAULT: the caller only runs this when STUDIO_VISUAL_CRITIQUE_ENABLED === "true" AND
// the renderer/model are configured. With the flag unset the whole loop is skipped — zero behavior
// change (§13/§32: no live behavior means nothing to have mis-verified).
//
// §34 L4 (Slice 1): the loop logic now lives in the GENERAL engine (_shared/reasoning/engine.ts,
// runReasoning). This file is the VISUAL adapter over it — `critiqueImageAndIterate` keeps its exact
// signature + CritiqueResult so its one live caller (paige-ai-chat) is byte-for-byte unchanged; it just
// injects the visual `generate` (regenerate) + `evaluate` (studio-visual-critique invoke) into the
// engine. §30 "reference the part that works": the proven loop is generalized, not cloned.
import { runReasoning, type ReasoningVerdict } from "./reasoning/engine.ts";

export interface CritiqueResult {
  ok: boolean;
  // NO_VERDICT (ok:false, with `reason`) = the critique was attempted but produced no review — the
  // screenshot, the render or the critic failed. The loop treats it as "no review": it keeps the
  // current artifact and never regenerates from it. `status:"disabled"|"throttled"` = never attempted.
  verdict?: "SHIP" | "ITERATE" | "BLOCK" | "NO_VERDICT";
  reason?: string;
  status?: string;
  summary?: string;
  blockers?: string[];
  should_fix?: string[];
  nits?: string[];
  cheesy_tells_hit?: string[];
  refined_prompt?: string;
  iteration?: number;
  spent_usd?: number;
  cost_estimate_usd?: number;
  capped?: boolean;
  low_confidence?: boolean;
  needs_config?: boolean;
}

/** True only when the design agent should run the visual-critique loop at all. */
export function visualCritiqueEnabled(): boolean {
  return (Deno.env.get("STUDIO_VISUAL_CRITIQUE_ENABLED") ?? "").toLowerCase() === "true";
}

interface FunctionsInvoker {
  functions: { invoke: (name: string, args: { body: unknown }) => Promise<{ data: unknown; error: unknown }> };
}

/**
 * Critique an already-generated IMAGE and, on ITERATE/BLOCK, regenerate from the critic's refined
 * prompt — bounded by the §33 iteration/cost caps (the studio-visual-critique fn enforces them too).
 *
 * @param client      the invoker (user-authed or service-role) used for functions.invoke
 * @param image       the current image result — must carry a public `url`
 * @param brief       the original ask, so the critic judges against intent
 * @param tenantId    for a service-role invoker; a JWT invoker's tenant is derived server-side (§9)
 * @param regenerate  re-run generation from a refined prompt → the new image result (or null on fail)
 * @returns the (possibly-improved) image result + the final critique (or the original image untouched
 *          when the loop is disabled / degrades — never throws into the caller's happy path)
 */
export async function critiqueImageAndIterate<T extends { url?: string }>(opts: {
  client: FunctionsInvoker;
  image: T;
  brief: string;
  tenantId?: string | null;
  regenerate: (refinedPrompt: string) => Promise<T | null>;
}): Promise<{ image: T; critique: CritiqueResult | null }> {
  const { client, brief, tenantId, regenerate } = opts;
  // The last CritiqueResult the evaluator returned — preserved so the return shape is IDENTICAL to the
  // pre-L4 gate (the caller reads `critique` as the raw studio-visual-critique payload).
  let lastCritique: CritiqueResult | null = null;

  const result = await runReasoning<T>({
    initial: opts.image,
    // Replaces the old `!image?.url` viability check — an image is worth critiquing only with a url.
    isViable: (img) => !!img?.url,
    // The visual "generate" plug — regenerate from the critic's refined prompt.
    generate: (refined) => regenerate(refined),
    // The visual "evaluate" plug — invoke the studio-visual-critique edge fn and map its CritiqueResult
    // onto the engine's ReasoningVerdict. NOTE: no onTrace is wired — this evaluator is an edge fn that
    // already traces its own LLM call (callModel), so tracing here too would double-count (§34 L1).
    evaluate: async (img, iteration, spentUsd): Promise<ReasoningVerdict | null> => {
      const { data, error } = await client.functions.invoke("studio-visual-critique", {
        body: {
          image_url: img.url,
          artifact_kind: "image",
          brief,
          iteration,
          spent_usd: spentUsd,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
      });
      if (error) {
        console.error("[visual-critique-gate] invoke error:", error);
        lastCritique = null; // matches the old behavior: an invoke error left `critique` unassigned
        return null;
      }
      const c = (data ?? null) as CritiqueResult | null;
      lastCritique = c; // the old loop assigned `critique` right after a successful invoke, even on !ok
      // NO_VERDICT / disabled / throttled / needs_config: no review — the engine stops and the caller
      // keeps the artifact it already has; nothing is regenerated from a review that did not happen (§13).
      if (!c || !c.ok || c.verdict === "NO_VERDICT") return null;
      return {
        verdict: c.verdict ?? "ITERATE",
        refinedInstruction: c.refined_prompt,
        // spent_usd is the RUNNING total from the critic — the engine threads it exactly as the gate did.
        costUsd: typeof c.spent_usd === "number" ? c.spent_usd : undefined,
        capped: c.capped,
        lowConfidence: c.low_confidence,
        needsConfig: c.needs_config,
        findings: { blockers: c.blockers, should_fix: c.should_fix, nits: c.nits, cheesy_tells_hit: c.cheesy_tells_hit },
      };
    },
  });

  return { image: result.artifact, critique: lastCritique };
}
