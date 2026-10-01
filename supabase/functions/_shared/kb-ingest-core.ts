// _shared/kb-ingest-core.ts — the ONE knowledge-ingestion pipeline (§12 — extract, never fork).
//
// The chunk → embed → write logic used to live only inside kb-ingest-doc/index.ts. The Studio
// brain's learn-from-published-work seam (studio-learn-from-artifact, #310 Slice B) needs the
// EXACT same pipeline — same 1000/150 chunking, same Voyage 1024-dim embedding, same honesty
// guard (a doc that embeds zero chunks is deleted, never left as a phantom un-retrievable row),
// same chunk_count reconcile. So it lives here once and both functions import it — a WRITE-side
// mirror of how Slice A extracted the READ side into _shared/studio-brain.ts.
//
// Doctrine:
//   §13 — HONESTY: if nothing embeds, the doc is not retrievable, so it is NOT a save. We delete
//         the orphan row and return ok:false so the caller (Paige) never claims a save that isn't
//         real. A fire is not a delivery.
//   §12 — one home; kb-ingest-doc and studio-learn-from-artifact both call ingestDoc().
import { embeddingsCompat, VOYAGE_DIMS } from "./voyage.ts";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

/** Sliding-window chunker — identical to kb-ingest-doc's original (1000 chars, 150 overlap). */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + CHUNK_SIZE, clean.length);
    out.push(clean.slice(i, end));
    if (end === clean.length) break;
    i = end - CHUNK_OVERLAP;
  }
  return out;
}

/** Embed one string via Voyage (voyage-3, 1024-dim) through the shared gateway. Throws on failure
 *  so the caller's per-chunk try/catch can drop just that chunk (kb-ingest's proven behavior). */
export async function embed(text: string): Promise<number[]> {
  const r = await embeddingsCompat("voyage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: text }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const vector = j?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== VOYAGE_DIMS ||
      !vector.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("invalid_embedding");
  }
  const storedVector = vector.map((value: number) => Math.fround(value));
  if (!storedVector.every(Number.isFinite) || !storedVector.some((value: number) => value !== 0)) {
    // pgvector stores float32; zero vectors cannot participate in the cosine index.
    throw new Error("invalid_embedding");
  }
  return storedVector;
}

export interface IngestDocParams {
  tenantId: string;
  title: string;
  content: string;
  source: string;            // 'upload'|'url'|'paste'|'sync'|'scan' (CHECK-constrained)
  source_url?: string | null;
  category?: string | null;
  tags?: string[];
  summary?: string | null;
  share_to_network?: boolean; // MUST stay false for auto-ingested content (§2)
  created_by?: string | null;
}

export interface IngestResult {
  ok: boolean;
  doc_id?: string;
  chunk_count: number;
  embedded: boolean;         // true only if EVERY chunk embedded
  error?: string;
  detail?: string;
}

/**
 * Run the full ingestion pipeline for one doc: insert the doc row, embed each chunk, write the
 * chunks, delete-the-orphan-on-zero-embeds (§13 honesty), and reconcile chunk_count to what
 * actually embedded.
 *
 * `admin` is a service-role client used for chunk writes + cleanup + reconcile. `opts.docClient`
 * is the client that INSERTS the doc row — pass a user-scoped (RLS) client to keep kb-ingest-doc's
 * RLS-on-insert enforcement; omit it (defaults to `admin`) for callers that have already authorized
 * the tenant server-side (the Studio seam resolves the tenant from the artifact row and checks
 * membership before calling, so it inserts via admin).
 */
export async function ingestDoc(
  // deno-lint-ignore no-explicit-any
  admin: any,
  params: IngestDocParams,
  // deno-lint-ignore no-explicit-any
  opts?: { docClient?: any },
): Promise<IngestResult> {
  const docClient = opts?.docClient ?? admin;
  const chunks = chunkText(params.content);
  if (chunks.length === 0) {
    return { ok: false, chunk_count: 0, embedded: false, error: "empty_content", detail: "Nothing to save — the content was empty after cleanup." };
  }

  const share = params.share_to_network ?? false;
  const { data: doc, error: docErr } = await docClient
    .from("tenant_knowledge_docs")
    .insert({
      tenant_id: params.tenantId,
      title: params.title,
      content: params.content,
      summary: params.summary ?? null,
      category: params.category ?? null,
      tags: params.tags ?? [],
      source: params.source,
      source_url: params.source_url ?? null,
      share_to_network: share,
      network_review_status: share ? "pending" : "none",
      token_count: Math.ceil(params.content.length / 4),
      chunk_count: 0,
      created_by: params.created_by ?? null,
    })
    .select("id, tenant_id")
    .single();
  if (docErr || !doc) {
    return { ok: false, chunk_count: 0, embedded: false, error: docErr?.message ?? "insert_failed" };
  }

  // The row is new to this call. Cleanup must prove absence before claiming nothing was saved.
  const fail = async (error: string): Promise<IngestResult> => {
    try {
      await admin.from("tenant_knowledge_docs").delete()
        .eq("tenant_id", params.tenantId).eq("id", doc.id);
      const { data: remaining, error: readError } = await admin.from("tenant_knowledge_docs")
        .select("id").eq("tenant_id", params.tenantId).eq("id", doc.id).maybeSingle();
      if (!readError && remaining === null) {
        return { ok: false, chunk_count: 0, embedded: false, error,
          detail: "Indexing could not be verified. The new entry was removed; nothing was saved." };
      }
    } catch { /* A lost cleanup response is not proof of deletion. */ }
    return { ok: false, doc_id: doc.id, chunk_count: 0, embedded: false,
      error: "persistence_unverified",
      detail: "The save could not be verified, and removal could not be confirmed. Check this entry before retrying." };
  };

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const vec = await embed(chunks[i]);
      rows.push({ tenant_id: doc.tenant_id, doc_id: doc.id, chunk_index: i,
        content: chunks[i], embedding: vec, token_count: Math.ceil(chunks[i].length / 4) });
    } catch {
      // Provider response bodies may contain sensitive data. Keep the diagnostic bounded.
      console.warn(`[kb-ingest-core] chunk ${i} embedding unavailable`);
    }
  }
  if (!rows.length) return fail("embedding_failed");

  try {
    const { error: chunkError } = await admin.from("tenant_knowledge_chunks").insert(rows);
    if (chunkError) return fail("chunk_write_failed");

    // Read only searchable rows. Paginate to avoid a server row-limit truncating large documents.
    const expected = new Set(rows.map(row => row.chunk_index));
    const seen = new Set<number>();
    for (let offset = 0; offset < rows.length; offset += 200) {
      const { data: persisted, error: readError, count } = await admin.from("tenant_knowledge_chunks")
        .select("chunk_index", { count: "exact" })
        .eq("tenant_id", params.tenantId).eq("doc_id", doc.id)
        .not("embedding", "is", null).order("chunk_index")
        .range(offset, offset + 199);
      if (readError || count !== rows.length || !Array.isArray(persisted) ||
          persisted.length !== Math.min(200, rows.length - offset)) return fail("chunk_readback_failed");
      for (const row of persisted) {
        if (!expected.has(row.chunk_index) || seen.has(row.chunk_index)) return fail("chunk_readback_failed");
        seen.add(row.chunk_index);
      }
    }
    if (seen.size !== rows.length) return fail("chunk_readback_failed");

    const { error: updateError } = await admin.from("tenant_knowledge_docs")
      .update({ chunk_count: seen.size }).eq("tenant_id", params.tenantId).eq("id", doc.id);
    if (updateError) return fail("count_reconcile_failed");
    const { data: saved, error: docReadError } = await admin.from("tenant_knowledge_docs")
      .select("id, tenant_id, chunk_count").eq("tenant_id", params.tenantId).eq("id", doc.id).single();
    if (docReadError || saved?.id !== doc.id || saved?.tenant_id !== params.tenantId ||
        saved?.chunk_count !== seen.size) return fail("count_readback_failed");

    return { ok: true, doc_id: doc.id, chunk_count: seen.size, embedded: seen.size === chunks.length };
  } catch {
    return fail("persistence_failed");
  }
}
