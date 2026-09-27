// export-document — turn a document a workspace ALREADY created (a marketing_content row, kind
// 'document', the output of document_generate) into a real, DOWNLOADABLE file (pdf / docx / pptx / md)
// and return a private, 30-day signed URL. Authorized IN-BODY by an owner/admin manage role in the
// row's tenant, or a platform operator (super_admin/platform_admin) — NOT by RLS.
//
// WHY THIS EXISTS (§18/§13). The binary renderer (_shared/doc-render.ts) and the model router's
// persist+sign lane already existed and were UNREACHED — no caller ever invoked the doc-render
// modality, so `document_generate` produced only on-canvas block-JSON (a browser Print→PDF was the
// only "download"). This function is the missing caller: it reads a document the tenant owns, renders
// it to a real file via `callModel("doc-render", …)` — which uploads the bytes to the private,
// tenant-scoped `studio-deliverables` bucket, mints a 30-day signed URL, and writes a
// `studio_deliverable` provenance row — and returns that URL. It is the callable seam (§10): Paige's
// `document_generate` invokes it when a caller asks for a downloadable format, and a future download
// control can call it too.
//
// TENANT ISOLATION (§9/§59). The source row is read with the SERVICE-ROLE client (a privileged, RLS-bypassing
// read — `marketing_content` RLS refuses a legitimate fresh Solo owner AND a platform_admin, so a caller-JWT
// read would 404 them). The read is therefore NOT the access decision: the caller is authorized IN-BODY,
// BEFORE any kind/tenant-shape response, by a MANAGE role in the ROW's tenant (owner/admin via is_tenant_admin)
// OR the platform-operator role; a non-authorized caller fails CLOSED as a 404 so
// the by-id endpoint never reveals an out-of-scope row. The in-body check — NOT RLS — is the load-bearing
// boundary. The file is filed under the ROW's tenant_id, never a value from the body.
//
// HONEST DEGRADE (§13/§32). Each doc-render format is independently fail-closed: if a format's lib
// cannot load on the Deno runtime it returns needs_config, and this function reports that honestly
// (never a broken or empty file). md is a pure serializer and never degrades. The Rail records the
// true outcome (succeeded / failed / outcome_unknown) via record_capability_run (service-role).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { callModel } from "../_shared/model-router.ts";
import { recordCapabilityRun } from "../_shared/capability-record.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The formats the in-band renderer serves today. Owner MVP set is md/docx/pptx/pdf; xlsx (a different,
// tabular content model needing a new lib) is a named follow-up, so it is deliberately NOT offered here
// rather than accepted and silently failed (§13).
const FORMATS = new Set(["pdf", "docx", "pptx", "md"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "No authorization header" });
    const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await authed.auth.getUser();
    if (uErr || !user) return json(401, { error: "Unauthorized" });
    const { data: roleRows } = await authed.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    // NO coarse global-role gate here. `user_roles` is GLOBAL and tenant-agnostic, and a freshly-provisioned
    // Solo owner holds ONLY the global `user` role — their authority is an active OWNER membership that
    // `is_tenant_admin` recognizes (migration 20261180000000, the §59 "WRONGLY REFUSES" half). A coarse
    // `admin` global gate would 403 that owner before the tenant check even runs — they'd be unable to
    // export their OWN document (§70). Authorization is decided ENTIRELY by the tenant-scoped check below
    // (owner/admin via is_tenant_admin) OR the platform-operator role — so a
    // non-member/non-operator still fails there. The global roles are read ONLY to detect operators.

    const body = await req.json().catch(() => ({}));
    const format = String(body?.format ?? "").toLowerCase();
    const contentId = String(body?.content_id ?? "");
    if (!FORMATS.has(format)) {
      return json(400, { error: `Unsupported format "${format}". Choose one of: pdf, docx, pptx, md.` });
    }
    if (!UUID_RE.test(contentId)) {
      return json(400, { error: "A valid document content_id is required." });
    }

    // A platform operator (super_admin/platform_admin, §53) can export ACROSS tenants. Derive that from
    // the VERIFIED JWT's global roles (user_roles) — those two ARE platform-global tiers by design (§53),
    // so reading them here is correct, not §59's global-role trap (that trap is about TENANT-level roles).
    const isOperator = roles.some((r: string) => r === "super_admin" || r === "platform_admin");
    const service = createClient(supabaseUrl, supabaseServiceKey);

    // §9/§59 — PRIVILEGED READ, then AUTHORIZE IN-BODY. `marketing_content` RLS admits only users holding a
    // GLOBAL admin role in the active tenant (or is_platform_owner), so a caller-JWT read returns NULL
    // for a freshly-provisioned Solo OWNER (global role only `user`) AND for a platform_admin — both would
    // 404 before their tenant-scoped authority could be checked (Codex L1/F1; the §59 "WRONGLY REFUSES"
    // half). So the row is read with the SERVICE-ROLE client (RLS-bypassing) — this read is NOT the access
    // decision; the tenant-scoped check below IS. That is the §59 pattern: a privileged read fenced by an
    // in-body caller-scope check (is_tenant_admin / has_tenant_role on the caller's own auth.uid(), or the
    // operator role). A caller with no authority over the doc's tenant is denied there — as a 404, so the
    // by-id endpoint never reveals whether an out-of-scope document exists.
    const { data: doc, error: docErr } = await service
      .from("marketing_content")
      .select("id, tenant_id, title, body, kind")
      .eq("id", contentId)
      .maybeSingle();
    if (docErr) return json(500, { error: "Could not read that document." });
    if (!doc) return json(404, { error: "Document not found, or you don't have access to it." });
    const tenantId = doc.tenant_id as string | null;

    // §9/§59 — AUTHORIZE FIRST, before ANY response that depends on the row's kind or tenant shape.
    // The service-role read above can see EVERY tenant's row, so a `kind !== "document"` 400 or a
    // null-tenant 422 emitted before this check would turn the by-id endpoint into a cross-tenant
    // existence/type ORACLE: an authenticated caller could probe another tenant's `marketing_content`
    // UUID and learn from the 400-vs-404-vs-422 which rows exist and what kind they are (Codex M1 — §9).
    // So the authorization is the FIRST branch after the null-row guard, and every downstream response
    // (kind, null-tenant, render) is reachable only by a caller already proven authorized over the row.
    //
    // The real access decision: `user_roles` is GLOBAL and tenant-agnostic, so a coarse role gate (and
    // `marketing_content`'s own RLS, which carries a global-`admin` OR-branch) would let a caller who is
    // admin in workspace A but only a PLAIN member of the doc's tenant B export B's documents (Codex F2 —
    // §59's global-role trap; the documented pattern in 20261180000000). A bare `is_tenant_member` check
    // does NOT close it — a plain member passes. RE-ENFORCE a MANAGE role IN THE DOC'S TENANT, tenant-scoped
    // on the caller's own auth.uid(): owner/admin via `is_tenant_admin`
    // (SECURITY DEFINER, keyed on the caller's own identity — never a passed actor). A null `tenantId`
    // makes it return false (no row matches `tenant_id = null`), so a non-operator hitting a
    // null-tenant row of any kind is denied as a 404 — never reaching the 422 that would confirm the row.
    // Operators (super_admin/platform_admin, §53) span tenants and skip this. (The RLS OR-branch is a
    // platform-wide §9/§59 gap reachable via raw PostgREST — its own follow-up (#1023); this gate closes
    // the export vector regardless.)
    if (!isOperator) {
      const { data: isAdmin } = await authed.rpc("is_tenant_admin", { _tenant: tenantId });
      const allowed = isAdmin === true;
      // Fail CLOSED as a 404 (not 403): the service-role read above can see any tenant's row, so a 403 here
      // would reveal that an out-of-scope document exists. 404 keeps it indistinguishable from "not found".
      if (!allowed) return json(404, { error: "Document not found, or you don't have access to it." });
    }

    // Only an authorized caller (operator, or admin of THIS doc's tenant) reaches these branches, so
    // the kind/tenant-shape responses below cannot reveal another tenant's row (Codex M1).
    if (doc.kind !== "document") {
      return json(400, { error: "That content isn't a document — only documents can be exported to a file." });
    }
    if (!tenantId) return json(422, { error: "That document has no workspace and cannot be exported." });

    // The document body is the block JSON document_generate saved: `{ docType, title, blocks }`. Unwrap
    // to the blocks array; renderDoc coerces defensively, so a legacy/plain body still produces a file.
    let content: unknown = doc.body;
    if (typeof doc.body === "string") {
      try {
        const parsed = JSON.parse(doc.body);
        content = Array.isArray(parsed?.blocks) ? parsed.blocks : parsed;
      } catch {
        content = doc.body; // not JSON — hand the raw text to the renderer's markdown/plain path
      }
    }
    const title = (typeof body?.title === "string" && body.title.trim())
      ? body.title.trim().slice(0, 200)
      : String((doc.title as string) ?? "Document").slice(0, 200);

    // Rail record is for TENANT (member) callers. `record_capability_run` requires the actor to be a
    // member of the target tenant (§52), so an OPERATOR export (super_admin/platform_admin, not a member)
    // would raise CAPABILITY_RUN_FORBIDDEN and log a false-alarm error for a legitimate God action. An
    // operator export is still audited via the studio_deliverable provenance row + the router audit, so
    // we skip the Rail row for operators rather than emit a spurious error (§5 finding; §13 — loud logs
    // for real faults only).
    const record = (outcome: Parameters<typeof recordCapabilityRun>[1]["outcome"]) =>
      isOperator
        ? Promise.resolve(false)
        : recordCapabilityRun(service, { tenantId, actorId: user.id, capabilityKey: "document_export", outcome });

    let rendered: Awaited<ReturnType<typeof callModel>>;
    try {
      rendered = await callModel(
        "doc-render",
        "frontier",
        { format, title, content },
        { tenantId, actorUserId: user.id, callerFunction: "export-document" },
      );
    } catch (e) {
      // A pre-produce throw: nothing was rendered or persisted. Honest `failed` (§947 — writeAttempted
      // is false; the deliverable never reached storage).
      await record("capability_failed");
      console.error("[export-document] render threw:", (e as Error)?.message);
      return json(200, { success: false, status: "failed", format, note: "The file could not be produced." });
    }

    // Honest degrade: the format's renderer lib isn't available on the runtime yet (or the PDF charset guard
    // rejected) — `callModel` returns needs_config BEFORE any persistence, so this is a DETERMINISTIC
    // pre-persistence non-effect: nothing was rendered, nothing landed. Record `capability_failed` (same as
    // the pre-produce throw above), NOT `capability_outcome_unknown` — the latter's Rail copy says the action
    // may have taken effect and prompts a needless "check before retry" for a case we KNOW did nothing (Codex).
    if (rendered?.needs_config) {
      await record("capability_failed");
      return json(200, {
        success: false,
        needs_config: true,
        format,
        note: `The ${format.toUpperCase()} file couldn't be generated for this document. Try Markdown — it's the one format that never fails to export.`,
      });
    }
    const url = rendered?.artifact_url ?? null;
    if (!url) {
      // The render succeeded but persistence returned no URL — the file may or may not have landed.
      await record("capability_outcome_unknown");
      return json(200, { success: false, status: "unknown", format, note: "The file could not be prepared for download right now." });
    }

    await record("capability_succeeded");
    return json(200, {
      success: true,
      format,
      download_url: url,
      deliverable_id: rendered.deliverable_id ?? null,
      title,
      content_id: contentId,
    });
  } catch (err) {
    console.error("[export-document] error:", (err as Error)?.message);
    return json(500, { error: "Export failed." });
  }
});
