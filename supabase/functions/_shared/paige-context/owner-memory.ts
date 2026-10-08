import { contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult } from "./mod.ts";

/** Captured by the handler from its authenticated actor and declared∧validated workspace.
 * This is a read binding, not an authorization resolver or memory confirmation mechanism. */
export interface OwnerMemoryReadScope {
  readonly actorId: string;
  readonly tenantId: string | null;
  readonly focusedClientId: string | null;
  readonly denied: boolean;
}

export interface ConfirmedOwnerMemory {
  readonly id: string;
  readonly memory_type: string;
  readonly content: string;
  readonly source_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly metadata: { readonly confirmation_state: "confirmed"; readonly audience?: string };
}

export interface OwnerMemoryContext {
  readonly scope: { readonly actorId: string; readonly tenantId: string };
  readonly memories: readonly ConfirmedOwnerMemory[];
}

/** Pure eligibility projection over get_paige_memory's existing readback. No reads or writes.
 * Proposed, corrected, retired and unclassified rows are not confirmed task knowledge.
 * SQL owns row scope/activity; returned rows have no actor/tenant columns. Preserve the
 * captured server read binding instead of inventing per-row authority from metadata. */
export function resolveOwnerMemoryContext(
  scope: OwnerMemoryReadScope,
  read: { readonly data?: unknown; readonly error?: unknown },
): ContextSourceResult<OwnerMemoryContext> {
  if (scope.denied || scope.focusedClientId !== null || !scope.actorId || !scope.tenantId) {
    return { ...contextUnavailable("owner_memory_scope_unavailable"), data: null };
  }
  if (read.error) return contextDegraded("owner_memory_read_failed");
  if (!Array.isArray(read.data)) return contextDegraded("owner_memory_read_invalid");
  const memories: ConfirmedOwnerMemory[] = [];
  for (const value of read.data) {
    if (!value || typeof value !== "object") return contextDegraded("owner_memory_read_invalid");
    const row = value as Record<string, unknown>;
    const metadata = row.metadata as Record<string, unknown> | null;
    if (!metadata || metadata.confirmation_state !== "confirmed") continue;
    if (typeof row.id !== "string" || !row.id || typeof row.memory_type !== "string" || !row.memory_type
      || typeof row.content !== "string" || typeof row.created_at !== "string"
      || !Number.isFinite(Date.parse(row.created_at))
      || (row.source_thread_id != null && typeof row.source_thread_id !== "string")
      || (row.updated_at != null && (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))))) {
      return contextDegraded("owner_memory_read_invalid");
    }
    memories.push({
      id: row.id, memory_type: row.memory_type, content: row.content,
      source_thread_id: (row.source_thread_id as string | null) ?? null, created_at: row.created_at,
      ...(typeof row.updated_at === "string" ? { updated_at: row.updated_at } : {}),
      metadata: { confirmation_state: "confirmed", ...(typeof metadata.audience === "string" ? { audience: metadata.audience } : {}) },
    });
  }
  return contextAvailable({ scope: { actorId: scope.actorId, tenantId: scope.tenantId }, memories });
}
