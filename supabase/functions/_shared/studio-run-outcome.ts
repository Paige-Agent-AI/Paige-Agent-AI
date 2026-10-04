// The honest receipt for a Vibe Studio act (page, funnel, form, copy and image saves and publishes).
// Classified from the act's OWN result and error shape, never from a bare `success:false`: a server
// refusal (not allowed, a live slug, a form still in use) is a refusal; a publish the readback could
// not prove live, and an answer that never came back, may have landed and are recorded as unknown; a
// funnel build that stopped after an earlier write is a failure that left drafts behind. Pure: no I/O.
//
// One receipt per act, under one key. An image is filed under `vibe_media_image` whichever door made
// it. In a Studio project paige-media files the receipt once a job exists (the render's success or
// failure) and for a budget refusal, so the chat files none for those; every other outcome there (a
// synchronous refusal, an answer that never came back) and every image outside a project is filed by
// the chat. Two receipts for one image would be a lie of a different kind; none would be too.
import type { CapabilityOutcome } from "./capability-record.ts";

/** Chat tool → the capability key its receipt is filed under. */
export const STUDIO_RECEIPT_KEYS: ReadonlyMap<string, string> = new Map([
  ["growth_page_save", "growth_page_save"],
  ["growth_page_publish", "growth_page_publish"],
  ["growth_form_save", "growth_form_save"],
  ["growth_form_publish", "growth_form_publish"],
  ["growth_funnel_build", "growth_funnel_build"],
  ["growth_funnel_publish", "growth_funnel_publish"],
  ["content_save", "content_save"],
  ["generate_image", "vibe_media_image"],
  // V2b — the acts only the publish door performs (growth-publish-command). It files their receipt
  // under the act's own key, exactly once; no chat tool reaches them.
  ["growth_page_unpublish", "growth_page_unpublish"],
  ["growth_form_unpublish", "growth_form_unpublish"],
  ["growth_funnel_unpublish", "growth_funnel_unpublish"],
  ["studio_image_publish", "studio_image_publish"],
  ["studio_image_unpublish", "studio_image_unpublish"],
]);

/**
 * The chat publish tools whose receipt the publish door files (V2b, growth-publish-command). The chat
 * hands these to the door and must file nothing for them itself: two receipts for one publish would
 * be a lie of a different kind.
 */
export const DOOR_FILED_STUDIO_TOOLS: ReadonlySet<string> = new Set([
  "growth_page_publish", "growth_form_publish", "growth_funnel_publish",
]);

// Postgres codes the Studio RPCs raise when they refuse: forbidden, invalid/locked, not found, and a
// duplicate.
const REFUSAL_CODES = new Set(["42501", "22023", "P0002", "23505"]);
const TRANSPORT = /\b(fetch|network|timed? ?out|timeout|ECONN|socket|aborted)\b/i;

export interface StudioReceipt { key: string; outcome: CapabilityOutcome }

export function classifyStudioRun(input: {
  capability: string;
  result?: unknown;
  thrown?: unknown;
  threw?: boolean;
}): StudioReceipt | null {
  const key = STUDIO_RECEIPT_KEYS.get(input.capability);
  if (!key) return null;
  if (!input.threw) {
    const r = (input.result ?? {}) as Record<string, unknown>;
    // A Studio image still rendering: paige-media files the receipt when it finishes.
    if (input.capability === "generate_image" && r.pending === true) return null;
    if (r.success === true) return { key, outcome: "capability_succeeded" };
    if (r.outcome_unknown === true || r.outcome === "unknown" || r.outcome === "unverified") {
      return { key, outcome: "capability_outcome_unknown" };
    }
    if (r.outcome === "partial") return { key, outcome: "capability_failed" };
    if (r.needs_config === true) return { key, outcome: "capability_unreachable" };
    // The handler or the backend refused before any write (a malformed request, no id, not this
    // workspace's owner/admin, nothing usable came back).
    return { key, outcome: "capability_refused" };
  }
  const e = input.thrown as { code?: unknown; message?: unknown } | null | undefined;
  // postgrest-js reports a fetch that never got an answer as { code: "" }: that is no server code.
  if (e && typeof e.code === "string" && e.code !== "") {
    return { key, outcome: REFUSAL_CODES.has(e.code) ? "capability_refused" : "capability_failed" };
  }
  if (e && typeof e.message === "string" && TRANSPORT.test(e.message)) return { key, outcome: "capability_outcome_unknown" };
  return { key, outcome: "capability_failed" };
}

/** What the receipt carries beyond its outcome: how it was approved and which record it touched.
 *  Ids only — never copy, prompts, or anything a tenant typed. */
export function studioReceiptDetail(
  result: unknown,
  approval: string | null | undefined,
): Record<string, unknown> {
  const r = (result ?? {}) as Record<string, unknown>;
  const detail: Record<string, unknown> = {};
  if (approval) detail.approval = approval;
  for (const k of ["page_id", "funnel_id", "form_id", "content_id", "job_id", "status"]) {
    const v = r[k];
    if (typeof v === "string" && v) detail[k] = v;
  }
  const saved = r.saved_drafts;
  if (saved && typeof saved === "object") detail.saved_drafts = saved;
  return detail;
}
