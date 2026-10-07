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
//   none → presentation only. In main chat that is the escalation signal below (ask_choices is a
//          Studio-session tool); the cheap class converses and answers in prose.
//
// THE RESCUE (the coordinator's R5b contract): a narrowed round that discovers an executable
// capability, a held approval continuation or an ambiguity operational cognition should resolve does
// not lose the objective — it calls `request_capability`, a PRESENTATION tool owned by this lane,
// not a chat capability. It executes nothing, persists nothing and grants nothing: its handler
// re-resolves the route with the server-observed `capabilityEscalation` fact (route.ts), which
// re-enters the same loop on the operational class with the full set, inside the existing
// continuation budget. No phrase regex reads anyone's words; no second router decides anything; the
// Spine gates judge every widened call exactly as before. It is offered ONLY to `none`/`read`
// rounds — an `act` round already has everything, so there is nothing left to ask for.
//
// Pure TypeScript, no imports with side effects: Deno and Node load it.

import { mutatingTools } from "../action-risk.ts";
import type { ToolExposure } from "./route.ts";

export const REQUEST_CAPABILITY_NAME = "request_capability";

/** Presentation tools that survive a `none` exposure when the turn already carries them. */
export const PRESENTATION_KEEP: ReadonlySet<string> = new Set(["ask_choices"]);

export const REQUEST_CAPABILITY_TOOL = {
  type: "function",
  function: {
    name: REQUEST_CAPABILITY_NAME,
    description:
      "Signal that this turn needs capability beyond the tools you were offered — an action (create, update, send, schedule…), a workspace lookup you cannot perform, or work that needs deeper reasoning. Calling it changes nothing by itself: the turn is re-routed on the operational tier with the full governed tool set, where the normal gates still decide every action and its approval. Call it the moment you realize the person's request cannot be completed with what you have — never answer a request for action in prose you cannot back.",
    parameters: { type: "object", properties: {} },
  },
} as const;

export interface ToolExposureResult {
  /** The tool definitions the round is offered, in their original order (plus the signal, last). */
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
 * adds a definition other than the escalation signal — this can only NARROW what a turn already
 * carried, the same contract the Studio scope holds.
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
  offered.push(REQUEST_CAPABILITY_TOOL);
  return { offered, withheld };
}

/** The tool result a round gets for calling the signal. Nothing executed; the re-route is the act. */
export function requestCapabilityResult(reason: "granted" | "already_granted"): {
  success: true;
  message: string;
} {
  return reason === "granted"
    ? { success: true, message: "Capability escalation accepted. The full governed tool set is now offered to your next round on the operational tier — carry out the person's request with it now; the normal gates still decide every action and its approval." }
    : { success: true, message: "The full governed tool set is already offered on this turn. Continue the task with the tools you have; there is nothing further to escalate to." };
}
