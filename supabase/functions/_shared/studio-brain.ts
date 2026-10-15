// _shared/studio-brain.ts — the Vibe Studio's brain (#310, §7/§8/§15).
//
// The Studio does NOT get its own knowledge store — the platform already has a two-tier
// vector KB (tenant_knowledge_docs / tenant_knowledge_chunks / match_tenant_knowledge,
// Voyage 1024-dim), the same one paige-ai-chat retrieves from. This is the ONE seam that
// lets the Studio's generators (growth-page-draft / growth-funnel-draft / growth-form-draft)
// draft against the tenant's OWN knowledge instead of generic-to-the-brief (§18 — extend the
// existing KB, never fork a second retriever; §12 — one home, shared by all three generators).
//
// Two exports:
//   retrieveTenantKnowledge() — embed the brief, pull the top-k most relevant tenant chunks.
//   buildKnowledgeBlock()     — turn those chunks into a SYSTEM-prompt block, size-capped.
//
// Doctrine:
//   §13 — NON-FATAL by construction. No VOYAGE key, no tenant, an embed/RPC error, or an empty
//         KB all resolve to "" so the generator degrades to its brand/playbook-only prompt
//         rather than failing. A page that drafts without KB context is still a real page; a
//         500 because the KB was slow is not.
//   §9  — reads ONLY the tenant_id the CALLER already resolved server-side (never the request
//         body). match_tenant_knowledge is SECURITY DEFINER over an explicit p_tenant_id, so
//         passing a foreign tenant would be an IDOR — callers MUST pass the tenant they pinned
//         via current_user_tenant_id() (JWT path) or the service-role-named tenant (§10).
//   §15 — the block frames chunks as the practice's own source material to GROUND in, and says
//         plainly they do NOT license inventing anything beyond them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { embeddingsCompat } from "./voyage.ts";

export interface KnowledgeChunk {
  content: string;
  similarity: number;
  title?: string;
  /** True when this chunk came from a Studio-published artifact (category='studio'). Used by
   *  buildKnowledgeBlock to keep the model's own re-published output from crowding out the
   *  tenant's authentic uploaded material (#310 Slice B feedback-loop guard, §13). */
  studioOrigin?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Metadata-only telemetry hash (never store the raw brief text — same posture as kb-search). */
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Retrieve the tenant's own knowledge most relevant to a brief. Returns [] on ANY problem
 * (no tenant, short brief, missing VOYAGE key, embed/RPC failure) — the caller degrades to
 * brand/playbook-only context (§13). `tenantId` MUST be a server-resolved tenant the caller
 * is entitled to (§9) — this function trusts it and passes it straight to the SECURITY DEFINER
 * RPC.
 */
export async function retrieveTenantKnowledge(
  tenantId: string | null,
  brief: string,
  matchCount = 5,
): Promise<KnowledgeChunk[]> {
  const q = (brief ?? "").trim();
  // Defense-in-depth (§9): callers already pass a server-resolved tenant, but the helper is one
  // step from a SECURITY DEFINER RPC over the service-role key — so reject anything that isn't a
  // well-formed UUID rather than trust the argument blindly.
  if (!tenantId || !UUID_RE.test(tenantId) || q.length < 5) return [];

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return [];

  try {
    const r = await embeddingsCompat("voyage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: q.slice(0, 2000) }),
    });
    if (!r.ok) {
      console.warn("studio-brain: embed failed:", r.status);
      return [];
    }
    const j = await r.json();
    const vec = j?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return [];

    const admin = createClient(url, serviceKey);
    const { data, error } = await admin.rpc("match_tenant_knowledge", {
      p_tenant_id: tenantId,
      p_query_embedding: vec as unknown as string,
      p_match_count: Math.min(Math.max(matchCount, 1), 10),
    });
    if (error) {
      console.warn("studio-brain: match_tenant_knowledge failed:", error.message);
      return [];
    }
    const chunks: (KnowledgeChunk & { docId?: string })[] = (Array.isArray(data) ? data : [])
      .map((row: Record<string, unknown>) => ({
        content: typeof row?.content === "string" ? row.content : "",
        similarity: Number(row?.similarity ?? 0),
        title: typeof row?.title === "string" ? row.title : undefined,
        docId: typeof row?.doc_id === "string" ? row.doc_id : undefined,
      }))
      .filter((c) => c.content.trim().length > 0);

    // Feedback-loop guard (§13): flag chunks that came from a Studio-published artifact so
    // buildKnowledgeBlock can stop the model's own re-published copy from crowding out the
    // practice's authentic uploaded material (the echo-chamber risk when generation → publish →
    // re-ingest → generation). Migration-free: a cheap docs lookup by id (studio origin is marked
    // by category='studio' / source_url 'studio://…', set by the Slice B ingest seam). Best-effort
    // — retrieval still works if this annotation fails.
    try {
      const docIds = [...new Set(chunks.map((c) => c.docId).filter(Boolean))] as string[];
      if (docIds.length) {
        const { data: docs } = await admin
          .from("tenant_knowledge_docs")
          .select("id, category, source_url")
          .eq("record_state", "canonical")
          .eq("tenant_id", tenantId)
          .in("id", docIds);
        const studioDocs = new Set(
          (Array.isArray(docs) ? docs : [])
            .filter((d: Record<string, unknown>) =>
              d?.category === "studio" ||
              (typeof d?.source_url === "string" && d.source_url.startsWith("studio://")))
            .map((d: Record<string, unknown>) => d.id as string),
        );
        for (const c of chunks) if (c.docId && studioDocs.has(c.docId)) c.studioOrigin = true;
      }
    } catch (_e) { /* annotation is best-effort; retrieval still works without it */ }

    // Fire-and-forget telemetry — metadata ONLY (sha256 of the brief, never the raw text), so the
    // platform's KB-quality dashboard sees Studio grounding just like it sees kb-search/chat
    // retrieval. Non-blocking: a telemetry failure never touches the §13 non-fatal contract.
    try {
      const hash = await sha256(q);
      admin
        .from("kb_query_telemetry")
        .insert({
          tenant_id: tenantId,
          query_hash: hash,
          query_length: q.length,
          query_intent_tags: ["studio"],
          result_count: chunks.length,
          top_similarity: Number(chunks[0]?.similarity ?? 0).toFixed(4),
          had_tenant_match: chunks.length > 0,
          had_global_match: false,
        })
        .then(({ error: tErr }) => {
          if (tErr) console.warn("studio-brain: telemetry insert:", tErr.message);
        });
    } catch (_e) { /* telemetry is best-effort only */ }

    return chunks;
  } catch (e) {
    console.warn("studio-brain: retrieval failed:", (e as Error)?.message);
    return [];
  }
}

/**
 * Turn retrieved tenant knowledge into a SYSTEM-prompt block. Keeps only chunks above a
 * relevance floor (a weak semantic match is noise, not signal) and hard-caps total size so a
 * large KB can never blow the prompt budget. Returns "" when nothing relevant survived — the
 * caller then omits the block entirely (§13, degrade cleanly).
 */
export function buildKnowledgeBlock(
  chunks: KnowledgeChunk[],
  opts?: { minSimilarity?: number; maxChars?: number; maxChunks?: number; maxStudioChunks?: number },
): string {
  const min = opts?.minSimilarity ?? 0.25;
  const maxChars = opts?.maxChars ?? 2400;
  const maxChunks = opts?.maxChunks ?? 5;
  const maxStudio = opts?.maxStudioChunks ?? 2;

  // Feedback-loop guard (§13): rank Studio-origin chunks with a small penalty and cap how many can
  // appear, so the model's own re-published copy reinforces voice without drowning out the tenant's
  // authentic uploaded/pasted/scanned material (their real transcripts, methods, proof).
  const scored = chunks
    .filter((c) => c.content.trim().length >= 40 && c.similarity >= min)
    .map((c) => ({ c, score: c.studioOrigin ? c.similarity * 0.85 : c.similarity }))
    .sort((a, b) => b.score - a.score);
  const kept: KnowledgeChunk[] = [];
  let studioUsed = 0;
  for (const { c } of scored) {
    if (kept.length >= maxChunks) break;
    if (c.studioOrigin) {
      if (studioUsed >= maxStudio) continue;
      studioUsed++;
    }
    kept.push(c);
  }
  if (!kept.length) return "";

  let budget = maxChars;
  const snippets: string[] = [];
  for (const c of kept) {
    if (budget <= 40) break;
    const take = c.content.trim().replace(/\s+/g, " ").slice(0, Math.min(600, budget));
    if (take.length < 40) continue;
    snippets.push(`- ${take}`);
    budget -= take.length;
  }
  if (!snippets.length) return "";

  return (
    `\n\nWHAT THIS PRACTICE ACTUALLY KNOWS — excerpts from this business's OWN knowledge base ` +
    `(their materials, methods, offers, proof, and the language they and their clients use). ` +
    `Ground the copy in these specifics — reuse their real terminology, offers, and framing so ` +
    `the result reads native to THEM, not a generic template. This is source material to draw ` +
    `from, NOT text to quote verbatim or print on the page, and it does NOT license inventing ` +
    `anything beyond what's here (§15):\n${snippets.join("\n")}`
  );
}
