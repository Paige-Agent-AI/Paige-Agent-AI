// Growth OS — inbound webhook bridge for external form builders
// (Webflow, Framer, ClickFunnels, GHL, Typeform, custom HTML, …).
//
// URL shape:  POST /functions/v1/growth-inbound/<webhook_token>
// Body:       arbitrary JSON from the external builder
// Behavior:   look up growth_external_sources, apply field_map_json, upsert
//             contact, write growth_form_submissions (the form processor routes its deal);
//             with no target form, file the contact into the default pipeline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { findClientIdByAddress, insertClientWithAddresses } from "../_shared/contact-methods.ts";
import { sanitizeUtm } from "../_shared/growth-intake.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function pickPath(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts[parts.length - 1];
    if (!token || token === "growth-inbound") {
      return new Response(JSON.stringify({ error: "missing webhook token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: source, error: srcErr } = await supabase
      .from("growth_external_sources")
      .select("*")
      .eq("webhook_token", token)
      .eq("active", true)
      .maybeSingle();
    if (srcErr || !source) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json().catch(() => ({}));

    // Apply field map: { "email": "data.email", "first_name": "fields.firstName" }
    const fieldMap = (source.field_map_json ?? {}) as Record<string, string>;
    const mapped: Record<string, any> = { ...payload };
    for (const [target, sourcePath] of Object.entries(fieldMap)) {
      const v = pickPath(payload, sourcePath);
      if (v !== undefined) mapped[target] = v;
    }

    const email = (mapped.email ?? "").toString().trim().toLowerCase();
    const firstName = (mapped.first_name ?? mapped.firstName ?? "").toString();
    const lastName = (mapped.last_name ?? mapped.lastName ?? "").toString();
    const phone = (mapped.phone ?? "").toString();

    let contactId: string | null = null;
    if (email) {
      // Upsert contact by email — scoped to this source's tenant to prevent
      // cross-tenant contact linkage when the same email exists in another tenant —
      // and matched against ANY of a contact's addresses, not only its primary.
      contactId = await findClientIdByAddress(supabase, source.tenant_id, "email", email, "growth-inbound");
      if (!contactId) {
        // The form's email (and phone, when it carried one) become the new contact's first
        // contact methods. A create whose address cannot be attached writes nothing: no contact.
        const { data: inserted } = await insertClientWithAddresses(
          supabase,
          {
            first_name: firstName || "New",
            last_name: lastName || "",
            source: `external:${source.provider}`,
            lifecycle_stage: "new_lead", // #172: 'lead' violates clients_lifecycle_stage_chk (23514)
            status: "active",
            created_by: source.created_by,
            tenant_id: source.tenant_id,
            created_by_channel_type: "form", // #10 channel-of-origin (external form bridge)
          },
          { email, phone: phone || null },
          "growth-inbound",
        );
        contactId = inserted?.id ?? null;
      }
    }

    // Record submission against the bridge's target form (if mapped) — else a
    // synthetic record by writing only to growth_form_submissions when target_form_id is set.
    if (source.target_form_id) {
      // Campaign and click tags, read the way public intake reads them (sanitizeUtm: the same keys, each a
      // short trimmed string): from the webhook URL's query, a `utm` object in the body, or the body's own
      // top-level keys (after the field map), later sources winning. They are what lets the lead funnel
      // count this lead under its campaign and ad.
      const bodyUtm = mapped.utm && typeof mapped.utm === "object" && !Array.isArray(mapped.utm) ? mapped.utm : {};
      const utm = sanitizeUtm({ ...Object.fromEntries(url.searchParams), ...bodyUtm, ...mapped });
      await supabase.from("growth_form_submissions").insert({
        form_id: source.target_form_id,
        tenant_id: source.tenant_id,
        contact_id: contactId,
        source: `external:${source.provider}`,
        external_source_id: source.id,
        payload_json: mapped,
        utm_json: utm,
        referrer: req.headers.get("referer") ?? null,
        ip: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      });
    }

    // No target form means no submission for the form processor to route, so the lead is filed here:
    // into the business's default pipeline, first open stage (owner ruling 2026-10-11). The contact is
    // this request's outcome; a filing failure is logged and reported, never a failed request and
    // never a deal that was not made. Such a lead writes no submission, so the lead funnel counts its
    // deal in the stage counts but not in leads (see growth_attach_inbound_default_deal's COMMENT).
    let deal: Record<string, unknown> | null = null;
    if (!source.target_form_id && contactId) {
      try {
        const { data: filed, error: dealErr } = await supabase.rpc("growth_attach_inbound_default_deal", {
          p_tenant_id: source.tenant_id, p_contact_id: contactId, p_source: `external:${source.provider}`,
        });
        if (dealErr || !filed) {
          console.error("[growth-inbound] default_pipeline_deal_failed", { code: dealErr?.code ?? null, message: dealErr?.message ?? "no result" });
          deal = { filed: false, error: "default_pipeline_deal_failed" };
        } else {
          deal = filed as Record<string, unknown>;
        }
      } catch (e) {
        console.error("[growth-inbound] default_pipeline_deal_failed", { message: String((e as Error)?.message ?? e) });
        deal = { filed: false, error: "default_pipeline_deal_failed" };
      }
    }

    await supabase
      .from("growth_external_sources")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", source.id);

    return new Response(JSON.stringify({ ok: true, contact_id: contactId, ...(deal ? { deal } : {}) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
