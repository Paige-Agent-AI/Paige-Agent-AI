// studio-learn-from-artifact — the Studio brain's LEARN direction (#310 Slice B, §7/§8/§15).
//
// When a tenant publishes a Studio artifact, this seam feeds its copy back into that tenant's
// OWN knowledge base, so the brain gets smarter with every page/funnel they ship and Slice A's
// retrieval grounds the NEXT draft in what they've already built. It is the WRITE mirror of
// _shared/studio-brain.ts (the READ side): both extend the ONE existing tenant vector KB
// (tenant_knowledge_docs / tenant_knowledge_chunks / Voyage 1024-dim) — never a second store (§18).
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//   Request: { artifact_type: "page"|"funnel"|"form"|"image"|"copy", artifact_id: uuid, confirmed?: boolean }
//   200 { ok:true,  doc_id, chunk_count, learned:true,  message }        — saved to the KB
//   200 { ok:false, needs_confirm:true, proposal }                      — §15: get a yes first
//   200 { ok:false, blocked:true, mode:"off", message }                 — tenant turned learning off
//   200 { ok:false, error, message }                                    — nothing usable to learn / embed failed (§13 honest)
//   4xx { error }                                                       — bad input / auth / not found
//
// ── DOCTRINE ─────────────────────────────────────────────────────────────────
//   §9  — the ingest tenant is resolved FROM THE PUBLISHED ARTIFACT ROW (growth_pages/growth_funnels
//         .tenant_id), never the caller's active tenant or the request body. A JWT caller is then
//         authorized AGAINST that tenant (role + they must be acting in that workspace) — this closes
//         the agency-on-behalf leak (an agency publishing a sub-account's page must not poison the
//         agency's KB). This is the one place Slice B is NOT a copy of Slice A.
//   §15 — NEVER silent. Gated by the existing tenant_tool_autonomy primitive (tool_key
//         'studio_learn_from_publish'): default 'confirm' → Paige must propose and the tenant say yes
//         (confirmed:true); 'auto' → learn directly and report it after; 'off' → never learn.
//   §2  — writes ONLY to the tenant's private tenant_knowledge_docs with share_to_network=false and
//         NEVER touches the platform knowledge_base canon, so a tenant's own funding/credit offer copy
//         stays private to them and never enters a platform default (kb-ingest-core keeps share false).
//   §13 — reports what actually happened: if nothing embeds, kb-ingest-core deletes the orphan and we
//         return ok:false. A fire is not a save.
//   §12 — reuses kb-ingest-core.ts (ingestion) + studio-artifact-extract.ts (content) — no forks.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { ingestDoc } from "../_shared/kb-ingest-core.ts";
import { flattenBlocks, flattenFormSchema } from "../_shared/studio-artifact-extract.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const p = parts[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let ingestionStarted = false;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "A bearer token is required." });
    const token = authHeader.slice("Bearer ".length).trim();
    const isServiceRole = parseJwtClaims(token)?.role === "service_role";

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json(400, { error: "Request body must be JSON." }); }

    const artifactType = str(body.artifact_type).trim();
    const artifactId = str(body.artifact_id).trim();
    const confirmed = body.confirmed === true;
    // The five creative kinds the brain learns from. page/funnel arrive from the publish trigger;
    // form/image/copy arrive from the Media Library's deliberate "Save to my library" keep.
    const SOURCE: Record<string, { table: string; titleCol: string }> = {
      page: { table: "growth_pages", titleCol: "title" },
      funnel: { table: "growth_funnels", titleCol: "name" },
      form: { table: "growth_forms", titleCol: "name" },
      image: { table: "marketing_content", titleCol: "title" },
      copy: { table: "marketing_content", titleCol: "title" },
    };
    const src = SOURCE[artifactType];
    if (!src) return json(400, { error: "artifact_type must be page, funnel, form, image, or copy." });
    if (!UUID_RE.test(artifactId)) return json(400, { error: "artifact_id must be a UUID." });

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // ── Resolve the tenant FROM the artifact row (§9) — never the body/active tenant ──
    // Each kind lives in its own store: page/funnel/form in growth_*, image/copy in marketing_content.
    const { data: artifact, error: aErr } = await admin
      .from(src.table)
      .select(`id, tenant_id, ${src.titleCol}, status`)
      .eq("id", artifactId)
      .maybeSingle();
    if (aErr) return json(500, { error: `Could not read the ${artifactType}: ${aErr.message}` });
    if (!artifact) return json(404, { error: `That ${artifactType} doesn't exist.` });
    const tenantId = str((artifact as Record<string, unknown>).tenant_id);
    if (!UUID_RE.test(tenantId)) return json(500, { error: "Artifact has no valid tenant." });

    // Live-status gate applies ONLY to the publish-triggered kinds. A draft page/funnel is unfinished
    // thinking, not the practice's committed voice — learning from it would poison retrieval (§13/§15).
    // The status value is type-specific: growth_page_publish sets a page 'published', growth_funnel_
    // publish sets a funnel 'active' (a single literal here silently killed the funnel-learn path).
    // image/copy/form are learned when a tenant DELIBERATELY saves them to their library — the keep IS
    // the signal, so there's no publish-state to require (marketing_content.status is draft/archived
    // housekeeping, not a live state).
    if (artifactType === "page" || artifactType === "funnel") {
      const liveStatus = artifactType === "page" ? "published" : "active";
      if (str((artifact as Record<string, unknown>).status) !== liveStatus) {
        return json(200, {
          ok: false, error: "not_published",
          message: `Publish this ${artifactType} first — I only learn from work you've shipped, not drafts.`,
        });
      }
    }

    // ── Authorize the caller against the ARTIFACT's tenant (§9 agency-leak guard) ──
    let userId: string | null = null;
    if (!isServiceRole) {
      const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: uErr } = await authed.auth.getUser();
      if (uErr || !user) return json(401, { error: uErr?.message || "Could not verify this session." });
      userId = user.id;

      const { data: roleRows } = await authed.from("user_roles").select("role").eq("user_id", user.id);
      const roles = (roleRows || []).map((r: Record<string, unknown>) => r.role);
      if (!roles.some((r) => r === "admin" || r === "super_admin")) {
        return json(403, { error: "Admin access required." });
      }
      // The caller must be acting IN the artifact's workspace — this blocks an agency from
      // learning a sub-account's page into the agency's KB (resolve from artifact, authorize
      // the caller against it). super_admin (platform owner) may act across tenants.
      const isPlatformOwner = roles.includes("super_admin");
      if (!isPlatformOwner) {
        const { data: activeTenant } = await authed.rpc("current_user_tenant_id");
        if (str(activeTenant) !== tenantId) {
          return json(403, { error: "Switch into that workspace to teach its Paige from this artifact." });
        }
      }
    }

    // ── §15 autonomy gate — never silent ──────────────────────────────────────
    let mode = "confirm";
    try {
      const { data: m } = await admin.rpc("resolve_tool_autonomy", { _tenant_id: tenantId, _tool_key: "studio_learn_from_publish" });
      const resolved = str(m).trim();
      if (resolved === "auto" || resolved === "confirm" || resolved === "off") mode = resolved;
    } catch { /* default to the stricter 'confirm' on any resolve failure (§13 fail-safe) */ }

    if (mode === "off") {
      return json(200, { ok: false, blocked: true, mode: "off", message: "Learning from published work is turned off for this workspace." });
    }
    if (mode === "confirm" && !confirmed) {
      return json(200, {
        ok: false, needs_confirm: true,
        proposal: `Want me to teach your Paige from this ${artifactType}, so your next drafts sound even more like you?`,
      });
    }

    // ── Extract the artifact's copy (§12 shared extractors) ────────────────────
    const fallbackTitle: Record<string, string> = { page: "Published page", funnel: "Funnel", form: "Form", image: "Image", copy: "Copy" };
    const artifactTitle = str((artifact as Record<string, unknown>)[src.titleCol]).trim() || fallbackTitle[artifactType];
    let content = "";
    if (artifactType === "page") {
      const { data: page } = await admin.from("growth_pages").select("blocks_json").eq("id", artifactId).maybeSingle();
      content = flattenBlocks((page as Record<string, unknown>)?.blocks_json);
    } else if (artifactType === "funnel") {
      const parts: string[] = [];
      const goalRow = await admin.from("growth_funnels").select("goal").eq("id", artifactId).maybeSingle();
      const goal = str((goalRow.data as Record<string, unknown>)?.goal).trim();
      if (goal) parts.push(`Funnel goal: ${goal}`);
      const { data: steps } = await admin
        .from("growth_funnel_steps")
        .select("order_index, step_type, page_id, form_id")
        .eq("funnel_id", artifactId)
        .eq("tenant_id", tenantId)
        .order("order_index", { ascending: true });
      for (const s of (Array.isArray(steps) ? steps : []) as Record<string, unknown>[]) {
        if (s.page_id) {
          const { data: p } = await admin.from("growth_pages").select("blocks_json").eq("id", s.page_id).eq("tenant_id", tenantId).maybeSingle();
          const t = flattenBlocks((p as Record<string, unknown>)?.blocks_json);
          if (t) parts.push(t);
        } else if (s.form_id) {
          const { data: f } = await admin.from("growth_forms").select("schema_json").eq("id", s.form_id).eq("tenant_id", tenantId).maybeSingle();
          const t = flattenFormSchema((f as Record<string, unknown>)?.schema_json);
          if (t) parts.push(t);
        }
      }
      content = parts.join("\n\n");
    } else if (artifactType === "form") {
      const { data: f } = await admin.from("growth_forms").select("schema_json").eq("id", artifactId).maybeSingle();
      content = flattenFormSchema((f as Record<string, unknown>)?.schema_json);
    } else {
      // image | copy — both live in marketing_content. The copy's body carries the practice's voice;
      // an image's brief is the prompt behind it. Titles anchor either.
      const { data: mc } = await admin.from("marketing_content").select("title, body, brief").eq("id", artifactId).maybeSingle();
      const m = (mc ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (str(m.title).trim()) parts.push(str(m.title).trim());
      if (str(m.body).trim()) parts.push(str(m.body).trim());
      if (str(m.brief).trim()) parts.push(str(m.brief).trim());
      content = parts.join("\n\n");
    }

    if (content.trim().length < 40) {
      return json(200, { ok: false, error: "no_content", message: `There wasn't enough text on this ${artifactType} to learn from yet.` });
    }

    // ── Ingest into the tenant's OWN KB (source='sync' + category='studio' provenance, private) ──
    const sourceUrl = `studio://${artifactType}/${artifactId}`;
    // Snapshot predecessors BEFORE ingest. Never delete another in-flight save
    // merely because it shares this source. A failed snapshot permits no cleanup.
    let priorIds: string[] | null = null;
    try {
      const prior = await admin.from("tenant_knowledge_docs").select("id", { count: "exact" })
        .eq("tenant_id", tenantId).eq("source_url", sourceUrl);
      if (!prior.error && Array.isArray(prior.data) && prior.count === prior.data.length) priorIds = prior.data.map((row) => row.id);
    } catch { /* Leave replacement unverified; retain every predecessor. */ }
    const truncated = content.length > 400_000;
    ingestionStarted = true;
    const result = await ingestDoc(admin, {
      tenantId,
      title: `Studio — ${artifactTitle}`,
      content: content.slice(0, 400_000),
      source: "sync",
      source_url: sourceUrl,
      category: "studio",
      tags: ["studio", artifactType],
      share_to_network: false, // §2: never enters the platform promote queue
      created_by: userId,
    });

    if (!result.ok) {
      return json(200, { ...result, learned: false, message: result.detail || "The save could not be verified. Check your knowledge before retrying." });
    }
    if (!result.embedded || truncated) {
      return json(200, { ...result, learned: false, partial: true, truncated,
        message: `Only part of this ${artifactType} was indexed. Earlier knowledge was kept. Review your knowledge before retrying.` });
    }
    let replaced = priorIds !== null;
    if (priorIds?.length) {
      try {
        const removed = await admin.from("tenant_knowledge_docs").delete()
          .eq("tenant_id", tenantId).eq("source_url", sourceUrl).in("id", priorIds);
        const remaining = await admin.from("tenant_knowledge_docs").select("id")
          .eq("tenant_id", tenantId).eq("source_url", sourceUrl).in("id", priorIds).limit(1);
        replaced = !removed.error && !remaining.error && Array.isArray(remaining.data) && remaining.data.length === 0;
      } catch { replaced = false; }
    }
    if (!replaced) {
      return json(200, { ...result, learned: false, error: "replacement_unverified",
        message: `This ${artifactType} was indexed, but replacement of earlier knowledge could not be verified. Review your knowledge before retrying.` });
    }

    return json(200, {
      ok: true,
      doc_id: result.doc_id,
      chunk_count: result.chunk_count,
      embedded: result.embedded,
      learned: true,
      message: `Saved this ${artifactType} to your Paige's knowledge for use in future drafts.`,
    });
  } catch (e) {
    console.error("studio-learn-from-artifact: unhandled error:", e);
    return json(500, { ok: false, learned: false, error: ingestionStarted ? "persistence_unverified" : "ingestion_not_started",
      message: ingestionStarted ? "Learning could not be verified. Check your knowledge before retrying." : "The artifact could not be read for learning. Nothing was indexed." });
  }
});
