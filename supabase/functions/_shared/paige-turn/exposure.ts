// INT-334 R5b — WHICH OF THE TURN'S GOVERNED TOOLS A ROUND MAY SEE, from the Turn Route's own
// capability verdict (route.ts `capability.tools`). Until R5a every round was offered the entire
// governed set whatever the route said — sound while the cheap class carried tools, wrong once the
// owner's rule is enforced ("cheap cognition carries no consequential tool authority"): the class
// decision and the tool list have to agree, or a misread turn either wastes the cheaper model or
// hands it capabilities it must not reason over.
//
// THE MAPPING (route.ts owns the vocabulary; this module owns the filter):
//   act  → the full governed set, unchanged. The model reasons over everything; the gates decide.
//   read → the governed set minus every mutating tool (action-risk `mutatingTools()` — the one
//          classification the handler already gates on, kept in step by CI). Lookups, research and
//          presentation survive; writes are simply not in the manifest.
//   none → presentation alone (`ask_choices`, where a surface offers it). In main chat that is an
//          empty manifest: the cheap class converses and answers in prose.
//
// THE RESCUE (the coordinator's R5b contract) IS NOT A TOOL. A narrowed round that discovers an
// executable capability names it — the capability projection in the system prompt advertises every
// governed capability, so the model KNOWS the names — and the handler treats a finished-round call
// to a real governed tool outside the round's manifest as the escalation signal: it executes
// nothing from that round, re-resolves the route with the server-observed `capabilityEscalation`
// fact (route.ts), and the loop's next round runs on the re-resolved class with the widened set,
// inside the same continuation budget and the same gates. No word the person typed is read; no
// phrase regex; no second router; no new tool declaration for a capability-kit guard to vet — the
// discovery channel is the model's own tool call, and the manifest boundary is enforced at dispatch
// for the first time (before R5b a withheld-but-real tool would simply have run).
//
// Pure TypeScript, no imports with side effects: Deno and Node load it.

import { mutatingTools } from "../action-risk.ts";
import type { ToolExposure } from "./route.ts";

/** Presentation tools that survive a `none` exposure when the turn already carries them. */
export const PRESENTATION_KEEP: ReadonlySet<string> = new Set(["ask_choices"]);

export interface ToolExposureResult {
  /** The tool definitions the round is offered, in their original order. Never mutated, never added to. */
  offered: unknown[];
  /** Names withheld from the governed set by this exposure, for the server log line. */
  withheld: string[];
}

function nameOf(def: unknown): string | null {
  const n = (def as { function?: { name?: unknown } } | null)?.function?.name;
  return typeof n === "string" ? n : null;
}

/**
 * Apply a route's tool exposure to the turn's governed tool list. Never mutates `defs` and never
 * adds a definition — this can only NARROW what a turn already carried. An empty `offered` is a
 * legitimate result (a `none` round on a surface with no presentation tools): the request then
 * carries no tools at all, and the model answers in prose.
 */
export function exposureFor(defs: readonly unknown[], exposure: ToolExposure): ToolExposureResult {
  if (exposure === "act") return { offered: [...defs], withheld: [] };
  const mutating = mutatingTools();
  const offered: unknown[] = [];
  const withheld: string[] = [];
  for (const def of defs) {
    const name = nameOf(def);
    const keep = exposure === "read"
      ? !!name && !mutating.has(name)
      : !!name && PRESENTATION_KEEP.has(name);
    if (keep) offered.push(def);
    else withheld.push(name ?? "unnamed");
  }
  return { offered, withheld };
}

/**
 * The dispatch-side result for the rescue: a finished-round call to a real governed tool outside the
 * round's manifest. Nothing executed; the re-route is the whole effect. The model re-issues the call
 * on the widened round, where the normal gates decide it exactly as before.
 */
export function notOfferedThisRound(): { success: false; code: string; message: string } {
  return {
    success: false,
    code: "NOT_OFFERED_THIS_ROUND",
    message: "That capability was not offered to this round. The turn has been re-routed on the operational tier with the full governed tool set — call it again there. The normal gates, approvals and readback still decide every action.",
  };
}
