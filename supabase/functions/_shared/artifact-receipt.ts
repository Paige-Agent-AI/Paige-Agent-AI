// Honest artifact-creation receipts — Paige Capability System, slice 1 (§13/§70/§32).
//
// The problem this closes: a chat artifact tool (generate_image, draft_marketing_content,
// content_save, document_generate, growth_page_save) calls an edge fn or RPC that can return
// HTTP 200 while carrying no real artifact — a null public URL, an empty drafts array, a null
// saved id. A 200-with-empty-payload does not throw, so the handler's success branch runs and
// emits `{ success: true, ... }`. That receipt is the SAME evidence three consumers read:
//   • the model narrates it ("here's your image") — now a lie,
//   • `describeStep` sets the status label from `success !== false` — shows "done"/"image ready",
//   • the artifact card pushes when `result.success` — a card with no artifact.
// So one dishonest field becomes a dishonest receipt in three places (the §13/§70 defect).
//
// This module is the ONE pure home (§18) for the decision "did the sub-call actually produce the
// artifact this kind promises?" Each handler wraps its own success shape in it, so the honest
// signal is computed once and every downstream consumer inherits it. It is deliberately pure (no
// imports, no Deno/network) so the contract test drives its BEHAVIOUR, not its source text.
//
// What this does NOT do: it does not record a Rail outcome (that is slice 3 / F05 — the ~43
// audit-log-only actions), and it does not touch the going-live publish handlers (external
// publishing is slice 6/7 and needs the publish RPCs' URL return contract verified first). It
// only makes the CREATION receipt truthful.

/**
 * The shape of "the real artifact" for a creation tool:
 *  - `file_url`   the artifact IS a stored file, addressed by a non-empty public URL (images).
 *  - `draft_list` the artifact IS a non-empty list of generated drafts (copy drafting).
 *  - `saved_id`   the artifact IS a persisted row, identified by a non-empty saved id
 *                 (a marketing_content id, a growth_pages row id).
 */
export type ArtifactShape = "file_url" | "draft_list" | "saved_id";

/**
 * True only when `value` is the real artifact the shape promises. Whitespace-only strings and
 * empty arrays are NOT artifacts — the classic 200-with-empty-payload that must degrade to an
 * honest failure rather than a success-shaped receipt.
 */
export function artifactProduced(shape: ArtifactShape, value: unknown): boolean {
  switch (shape) {
    case "file_url":
      return typeof value === "string" && value.trim().length > 0;
    case "draft_list":
      return Array.isArray(value) && value.length > 0;
    case "saved_id":
      // a saved id may arrive as a scalar (RPC return) or be read off a row; both reduce to
      // "is there a non-empty identifier". Reject null/undefined and empty/whitespace strings.
      // A non-string, non-null id (should not happen for these RPCs) is treated as present.
      if (value === null || value === undefined) return false;
      if (typeof value === "string") return value.trim().length > 0;
      return true;
  }
}

/**
 * Honest, non-leaky failure copy for a 200 that returned no real artifact. Plain and factual —
 * no table/function names, no SQLSTATE, no internal jargon (§11) — in the same voice as the
 * existing document_generate guards. The model relays this to the owner as the failure receipt.
 */
export const ARTIFACT_ABSENT_ERROR: Record<ArtifactShape, string> = {
  file_url:
    "The image generator finished but returned no image, so there's nothing to show yet. Try again, or adjust the prompt.",
  draft_list:
    "No draft content came back, so there's nothing to save yet. Try describing what you want again.",
  saved_id:
    "That finished but didn't return a saved item, so it may not have saved. Try it again.",
};

/**
 * Filter a content-draft `drafts` array to the entries that carry usable copy — a
 * non-whitespace string `content` field. `content-draft` normalizes a content-less model
 * item to `{ content: "" }` (`content-draft/index.ts` maps `content: String(d?.content ?? "")`),
 * so a NON-EMPTY array is not proof of usable copy: `[{ title: "Draft" }]` becomes
 * `[{ content: "" }]` and would otherwise pass `artifactProduced("draft_list", …)` with zero
 * words (§13/§70, Codex P2). Pass this result to `artifactProduced("draft_list", …)` so a
 * batch of empty drafts degrades to an honest failure. Non-array input → `[]`.
 */
export function usableDrafts(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (d) => d != null && typeof (d as { content?: unknown }).content === "string" &&
      ((d as { content: string }).content).trim().length > 0,
  );
}
