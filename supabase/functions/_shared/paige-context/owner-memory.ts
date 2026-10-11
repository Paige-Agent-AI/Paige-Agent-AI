import { contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult } from "./mod.ts";

/** Captured by the handler from its authenticated actor and declared∧validated workspace.
 * This is a read binding, not an authorization resolver or memory confirmation mechanism. */
export interface OwnerMemoryReadScope {
  readonly actorId: string;
  readonly tenantId: string | null;
  readonly focusedClientId: string | null;
  readonly denied: boolean;
}

/** C6 consumption dials (INT-326 accepted contract, clarification 3 — the consuming
 *  implementer's explicit decision, 2026-10-10, from the Memory lane's measured evidence):
 *  - max items 10 (recommended range 8–12; measured max subject rows 8);
 *  - proposed/unconfirmed capped at 3 per turn, framed downstream as recollection;
 *  - precedence confirmed > corrected > proposed (retired/unclassified never admitted;
 *    missing confirmation_state is UNCONFIRMED — a candidate, per clarification 1);
 *  - no freshness window at measured scale (1–4 rows/week, no decay observed; a 90–180d
 *    soft window stays available as a future dial, not a default).
 *  Supersession is SQL-owned: the seam returns active rows only, so a corrected row here
 *  is the LATEST correction, never beside the row it replaced. */
export const C6_MAX_ITEMS = 10;
export const C6_PROPOSED_CAP = 3;

export interface OwnerMemoryItem {
  readonly id: string;
  readonly memory_type: string;
  readonly content: string;
  readonly source_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at?: string;
  /** confirmed and corrected rows are task knowledge; proposed rows are CANDIDATES —
   *  quotable as recollection, never asserted as truth (INT-326 contract clause 8). */
  readonly state: "confirmed" | "corrected" | "proposed";
  readonly candidate: boolean;
  readonly audience?: string;
}

export interface OwnerMemoryContext {
  readonly scope: { readonly actorId: string; readonly tenantId: string };
  readonly memories: readonly OwnerMemoryItem[];
}

const PRECEDENCE: Record<OwnerMemoryItem["state"], number> = { confirmed: 0, corrected: 1, proposed: 2 };

/** Pure eligibility projection over get_paige_memory's existing readback. No reads or writes.
 * SQL owns row scope/activity/supersession; returned rows have no actor/tenant columns.
 * Preserve the captured server read binding instead of inventing per-row authority from
 * metadata. Admits confirmed and corrected rows as knowledge and at most C6_PROPOSED_CAP
 * proposed rows as candidates, at most C6_MAX_ITEMS total in precedence order. */
export function resolveOwnerMemoryContext(
  scope: OwnerMemoryReadScope,
  read: { readonly data?: unknown; readonly error?: unknown },
): ContextSourceResult<OwnerMemoryContext> {
  if (scope.denied || scope.focusedClientId !== null || !scope.actorId || !scope.tenantId) {
    return { ...contextUnavailable("owner_memory_scope_unavailable"), data: null };
  }
  if (read.error) return contextDegraded("owner_memory_read_failed");
  if (!Array.isArray(read.data)) return contextDegraded("owner_memory_read_invalid");
  const admitted: OwnerMemoryItem[] = [];
  let proposedCount = 0;
  for (const value of read.data) {
    if (!value || typeof value !== "object") return contextDegraded("owner_memory_read_invalid");
    const row = value as Record<string, unknown>;
    const metadata = row.metadata as Record<string, unknown> | null;
    // Missing confirmation_state is UNCONFIRMED — a candidate, never defaulted to confirmed.
    const rawState = metadata?.confirmation_state;
    const state: OwnerMemoryItem["state"] | null =
      rawState === "confirmed" ? "confirmed"
      : rawState === "corrected" ? "corrected"
      : rawState === "proposed" || rawState === undefined ? "proposed"
      : null;
    if (state === null) continue; // retired/unclassified/garbage states are never admitted
    if (state === "proposed" && proposedCount >= C6_PROPOSED_CAP) continue;
    if (typeof row.id !== "string" || !row.id || typeof row.memory_type !== "string" || !row.memory_type
      || typeof row.content !== "string" || typeof row.created_at !== "string"
      || !Number.isFinite(Date.parse(row.created_at))
      || (row.source_thread_id != null && typeof row.source_thread_id !== "string")
      || (row.updated_at != null && (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))))) {
      return contextDegraded("owner_memory_read_invalid");
    }
    if (state === "proposed") proposedCount++;
    admitted.push({
      id: row.id, memory_type: row.memory_type, content: row.content,
      source_thread_id: (row.source_thread_id as string | null) ?? null, created_at: row.created_at,
      ...(typeof row.updated_at === "string" ? { updated_at: row.updated_at } : {}),
      state, candidate: state === "proposed",
      ...(typeof metadata?.audience === "string" ? { audience: metadata.audience } : {}),
    });
  }
  // Precedence confirmed > corrected > proposed; stable within a class (seam order).
  const memories = admitted
    .map((item, index) => ({ item, index }))
    .sort((a, b) => PRECEDENCE[a.item.state] - PRECEDENCE[b.item.state] || a.index - b.index)
    .map((entry) => entry.item)
    .slice(0, C6_MAX_ITEMS);
  return contextAvailable({ scope: { actorId: scope.actorId, tenantId: scope.tenantId }, memories });
}
