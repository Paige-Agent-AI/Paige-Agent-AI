// Ingest a tenant-private knowledge doc: chunk it, embed via Voyage voyage-3
// (1024-dim), and write to tenant_knowledge_docs + tenant_knowledge_chunks. The
// chunk→embed→write pipeline lives in _shared/kb-ingest-core.ts (§12 — one home,
// shared with studio-learn-from-artifact); this function owns request parsing,
// auth, and tenant resolution, then hands the resolved tenant + content to
// ingestDoc(). The doc row is still inserted through the caller's user-scoped
// (RLS) client so row-level ownership is enforced on insert — passed via docClient.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { ingestDoc } from "../_shared/kb-ingest-core.ts";
import { bindKnowledgeIngestScope, KnowledgeIngestScopeError } from "../_shared/knowledge-ingest-scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(500_000),
  summary: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  source: z.enum(["upload", "url", "paste", "sync", "scan"]).optional(),
  source_url: z.string().url().max(2000).optional(),
  share_to_network: z.boolean().optional(),
  tenant_id: z.string().uuid().optional(), // equality precondition against the selected workspace
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let ingestionStarted = false;
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized", ingestion_started: false }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = BodySchema.safeParse(await req.json());
    if (!body.success) {
      return new Response(JSON.stringify({ error: body.error.flatten(), ingestion_started: false }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Plain-function adapter for the shared scope port: relating supabase-js's generic
    // from()/rpc() signatures to a structural caller trips TS2345 under deno check.
    const scopeCaller = {
      auth: supabase.auth,
      readActiveTenant: (userId: string) => supabase.from("profiles").select("active_tenant_id").eq("user_id", userId).maybeSingle(),
      rpc: (name: string, args?: Record<string, unknown>) => supabase.rpc(name, args as never),
    };
    const scope = await bindKnowledgeIngestScope(scopeCaller, body.data.tenant_id);
    const { tenantId, userId } = scope;

    // Full chunk→embed→write pipeline (shared, §12). docClient = the user-scoped client so the
    // doc-row INSERT is RLS-enforced (the caller can only write into a tenant they belong to);
    // chunks/cleanup/reconcile run on admin exactly as before.
    ingestionStarted = true;
    const result = await ingestDoc(admin, {
      tenantId,
      title: body.data.title,
      content: body.data.content,
      summary: body.data.summary ?? null,
      category: body.data.category ?? null,
      tags: body.data.tags ?? [],
      source: body.data.source ?? "paste",
      source_url: body.data.source_url ?? null,
      share_to_network: body.data.share_to_network ?? false,
      created_by: userId,
    }, { docClient: supabase, authorize: scope.assert });

    await scope.assert();
    // Preserve every core outcome field, including the document to inspect when
    // persistence is uncertain. Keep the legacy embedding-failure HTTP status.
    return new Response(JSON.stringify(result), {
      status: result.ok || result.error === "embedding_failed" ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof KnowledgeIngestScopeError && !ingestionStarted) {
      return new Response(JSON.stringify({ ok: false, error: e.message, ingestion_started: false }), {
        status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("[kb-ingest] error:", e);
    return new Response(JSON.stringify({ ok: false, error: ingestionStarted ? "persistence_unverified" : "ingestion_not_started", detail: ingestionStarted ? "The save could not be verified. Check your knowledge before retrying." : "The request could not be read. Nothing was indexed." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
