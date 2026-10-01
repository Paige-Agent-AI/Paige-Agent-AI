/** Presentation of the canonical ingestion result. HTTP success alone is not a save. */
export type KnowledgeIngestOutcome = {
  kind: "complete" | "partial" | "failed" | "unknown";
  message: string;
  docId?: string;
  chunkCount?: number;
};

const rolledBack = new Set(["embedding_failed", "chunk_write_failed", "chunk_readback_failed", "count_reconcile_failed", "count_readback_failed", "persistence_failed"]);
const unknownMessage = "The save could not be verified. Check your knowledge before retrying to avoid a duplicate.";

export function knowledgeIngestOutcome(value: unknown): KnowledgeIngestOutcome {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const docId = typeof body.doc_id === "string" && body.doc_id.trim() ? body.doc_id : undefined;
  const chunkCount = typeof body.chunk_count === "number" && Number.isSafeInteger(body.chunk_count) && body.chunk_count > 0 ? body.chunk_count : undefined;
  if (body.ingestion_started === false) return { kind: "failed", message: typeof body.error === "string" ? body.error : "Check the document fields and try again. Nothing was indexed." };
  if (body.ok === true && docId && chunkCount && typeof body.embedded === "boolean") {
    if (!body.embedded || body.truncated === true) {
      return { kind: "partial", docId, chunkCount, message: `Partially indexed (${chunkCount} chunks). Some content is missing. Review your knowledge before adding it again.` };
    }
    return { kind: "complete", docId, chunkCount, message: `Indexed (${chunkCount} chunks)` };
  }
  if (body.ok === false && (body.error === "empty_content" || body.error === "ingestion_not_started" || (typeof body.error === "string" && rolledBack.has(body.error)))) {
    return { kind: "failed", message: body.error === "empty_content"
      ? "No readable content was found. Update the content and try again."
      : body.error === "ingestion_not_started"
        ? "The document could not be read. Nothing was indexed; check the input and try again."
        : "Indexing failed and the new entry was removed. Your input is still here to retry." };
  }
  return { kind: "unknown", docId, message: unknownMessage };
}

export async function knowledgeInvokeOutcome(data: unknown, error: unknown): Promise<KnowledgeIngestOutcome> {
  if (!error) return knowledgeIngestOutcome(data);
  // Supabase puts non-2xx JSON in FunctionsHttpError.context, not in data.
  try {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      const result = knowledgeIngestOutcome(await context.json());
      return result.kind === "complete" ? knowledgeIngestOutcome(null) : result;
    }
  } catch { /* A lost/malformed acknowledgement cannot prove that no write happened. */ }
  return knowledgeIngestOutcome(null);
}
