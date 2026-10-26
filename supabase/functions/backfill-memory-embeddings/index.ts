// Backfills embeddings for client_memory rows where embedding IS NULL.
// Platform Operator only (EXP08 stage 0). Processes in batches of 20 with 500ms delay between batches.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { embeddingsCompat } from "../_shared/voyage.ts";
import { requireOperator } from "../_shared/operatorAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = "unused";

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // EXP08 stage 0 (owner ruling 2026-10-26): this job embeds EVERY business's client_memory with the
    // service role, so it is a PLATFORM act — the Platform Operator's (§53), from the VERIFIED JWT.
    // It used to admit the global `admin` row, which an owner/admin seat in ANY workspace writes.
    const guard = await requireOperator(req);
    if (!guard.ok) return guard.response;
    // Service-role client for read/write bypassing RLS
    const admin = guard.admin;

    // Fetch all rows without an embedding
    const { data: rows, error: fetchErr } = await admin
      .from("client_memory")
      .select("id, content")
      .is("embedding", null)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (fetchErr) {
      return new Response(JSON.stringify({ error: "Fetch failed", detail: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalProcessed = rows?.length || 0;
    let totalUpdated = 0;
    const errors: { id: string; error: string }[] = [];

    for (let i = 0; i < totalProcessed; i += BATCH_SIZE) {
      const batch = rows!.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((r) =>
        (r.content || "").length > 8000 ? r.content.slice(0, 8000) : (r.content || "")
      );

      try {
        const resp = await embeddingsCompat("voyage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
        });

        if (!resp.ok) {
          const t = await resp.text();
          for (const r of batch) errors.push({ id: r.id, error: `OpenAI ${resp.status}: ${t.slice(0, 200)}` });
        } else {
          const json = await resp.json();
          const embeddings: number[][] = (json.data || []).map((d: any) => d.embedding);

          await Promise.all(
            batch.map(async (row, idx) => {
              const emb = embeddings[idx];
              if (!emb) {
                errors.push({ id: row.id, error: "No embedding returned" });
                return;
              }
              const { error: updErr } = await admin
                .from("client_memory")
                .update({ embedding: emb as any })
                .eq("id", row.id);
              if (updErr) errors.push({ id: row.id, error: updErr.message });
              else totalUpdated++;
            })
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const r of batch) errors.push({ id: r.id, error: msg });
      }

      if (i + BATCH_SIZE < totalProcessed) await sleep(BATCH_DELAY_MS);
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_processed: totalProcessed,
        total_updated: totalUpdated,
        error_count: errors.length,
        errors: errors.slice(0, 50),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("backfill-memory-embeddings error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
