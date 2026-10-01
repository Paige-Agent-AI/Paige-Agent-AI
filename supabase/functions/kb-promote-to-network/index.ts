// Platform-owner only: promote a tenant-contributed doc (status=approved or pending)
// into the global knowledge_base canon. Records the canon row ID back on the
// source doc so we never re-promote the same content twice.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  doc_id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  canon_category: z.string().max(60).optional(),
  canon_framework: z.string().max(60).optional(),
  reviewer_notes: z.string().max(2000).optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
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

    const token = auth.replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    if (!claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const { data: isOwner } = await admin.rpc("is_platform_owner");
    if (!isOwner) {
      return new Response(JSON.stringify({ error: "Platform owner only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = BodySchema.safeParse(await req.json());
    if (!body.success) {
      return new Response(JSON.stringify({ error: body.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docErr } = await admin
      .from("tenant_knowledge_docs")
      .select("id,tenant_id,title,content,summary,category,tags,source,source_url,share_to_network,created_by")
      .eq("record_state", "canonical")
      .eq("id", body.data.doc_id)
      .maybeSingle();
    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "doc not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!doc.share_to_network) {
      return new Response(JSON.stringify({ error: "Doc not opted into the network" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.data.decision === "reject") {
      await admin.from("tenant_knowledge_docs").update({
        network_review_status: "rejected",
        network_reviewed_at: new Date().toISOString(),
        network_reviewed_by: userId,
      }).eq("id", doc.id);
      return new Response(JSON.stringify({ ok: true, decision: "rejected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // approve → insert into knowledge_base (global canon)
    const { data: canon, error: canonErr } = await admin
      .from("knowledge_base")
      .insert({
        title: doc.title,
        category: (body.data.canon_category ?? doc.category ?? "general") as string,
        framework: body.data.canon_framework ?? "tenant_contributed",
        content: doc.content,
        summary: doc.summary,
        tags: doc.tags,
        metadata: {
          contributed_by_tenant_id: doc.tenant_id,
          contributed_doc_id: doc.id,
          reviewer_user_id: userId,
          reviewer_notes: body.data.reviewer_notes ?? null,
          promoted_at: new Date().toISOString(),
        },
      })
      .select("id")
      .single();
    if (canonErr || !canon) {
      return new Response(JSON.stringify({ error: canonErr?.message ?? "promote failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("tenant_knowledge_docs").update({
      network_review_status: "approved",
      network_reviewed_at: new Date().toISOString(),
      network_reviewed_by: userId,
      promoted_to_canon_id: canon.id,
    }).eq("id", doc.id);

    return new Response(JSON.stringify({ ok: true, decision: "approved", canon_id: canon.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[kb-promote] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
