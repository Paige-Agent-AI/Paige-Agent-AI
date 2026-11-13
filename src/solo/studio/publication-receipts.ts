import { STUDIO_SESSION_ID } from "./studio-reference";

export type StudioPublicationReceipt = { id: string; occurredAt: string; action: "publish" | "unpublish"; outcome: "succeeded" | "failed" | "refused" | "unknown" | "unreachable" | "unrecorded" };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Decode only the bounded native receipt projection, never an execution
 * response, page status or model claim. Unknown detail cannot reach the UI. */
export function parseStudioPublicationReceipts(value: unknown): StudioPublicationReceipt[] | null {
  const result = object(value);
  if (result?.ok !== true || !Array.isArray(result.receipts)) return null;
  const outcomes: Record<string, StudioPublicationReceipt["outcome"]> = { capability_succeeded: "succeeded", capability_failed: "failed", capability_refused: "refused", capability_outcome_unknown: "unknown", capability_unreachable: "unreachable", capability_completed_unrecorded: "unrecorded" };
  return result.receipts.slice(0, 5).flatMap(value => {
    const row = object(value);
    if (!row) return [];
    const outcome = typeof row.outcome === "string" && Object.prototype.hasOwnProperty.call(outcomes, row.outcome) ? outcomes[row.outcome] : undefined;
    return typeof row.id === "string" && STUDIO_SESSION_ID.test(row.id)
      && typeof row.occurred_at === "string" && row.occurred_at.length <= 64
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.occurred_at)
      && Number.isFinite(Date.parse(row.occurred_at)) && outcome
      && (row.capability_key === "growth_page_publish" || row.capability_key === "growth_page_unpublish")
      ? [{ id: row.id, occurredAt: row.occurred_at, action: row.capability_key === "growth_page_publish" ? "publish" as const : "unpublish" as const, outcome }] : [];
  });
}
