// The honest outcome of a Studio form act (growth_form_save / growth_form_publish), for the
// capability receipt. Classified from the act's OWN result and error shape, never from a bare
// `success:false`: a server refusal (not allowed, a live slug, a form still in use) is a refusal;
// an answer that never came back may have landed and is recorded as unknown. Pure: no I/O.
import type { CapabilityOutcome } from "./capability-record.ts";

export const GROWTH_FORM_CAPABILITY_KEYS = new Set(["growth_form_save", "growth_form_publish"]);

// Postgres codes the growth RPCs raise when they refuse: forbidden, invalid/locked, not found,
// and a duplicate.
const REFUSAL_CODES = new Set(["42501", "22023", "P0002", "23505"]);
const TRANSPORT = /\b(fetch|network|timed? ?out|timeout|ECONN|socket|aborted)\b/i;

export function classifyGrowthFormRun(input: {
  capability: string;
  result?: unknown;
  thrown?: unknown;
  threw?: boolean;
}): CapabilityOutcome | null {
  if (!GROWTH_FORM_CAPABILITY_KEYS.has(input.capability)) return null;
  if (!input.threw) {
    const r = input.result as { success?: unknown } | null | undefined;
    if (r && r.success === true) return "capability_succeeded";
    // The handler refused before any write (no questions, a malformed question, no form id).
    return "capability_refused";
  }
  const e = input.thrown as { code?: unknown; message?: unknown } | null | undefined;
  // postgrest-js reports a fetch that never got an answer as { code: "" }: that is no server code.
  if (e && typeof e.code === "string" && e.code !== "") return REFUSAL_CODES.has(e.code) ? "capability_refused" : "capability_failed";
  if (e && typeof e.message === "string" && TRANSPORT.test(e.message)) return "capability_outcome_unknown";
  return "capability_failed";
}
