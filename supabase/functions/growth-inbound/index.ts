// Growth OS — inbound webhook bridge for external form builders
// (Webflow, Framer, ClickFunnels, GHL, Typeform, custom HTML, …).
//
// URL shape:  POST /functions/v1/growth-inbound/<webhook_token>
// Body:       arbitrary JSON from the external builder
// Behavior:   look up growth_external_sources, apply field_map_json, upsert
//             contact, write growth_form_submissions, optional deal create.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { findClientIdByAddress } from "../_shared/contact-methods.ts";

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
        const { data: inserted } = await supabase
          .from("clients")
          .insert({
            email,
            first_name: firstName || "New",
            last_name: lastName || "",
            phone: phone || null,
            source: `external:${source.provider}`,
            lifecycle_stage: "new_lead", // #172: 'lead' violates clients_lifecycle_stage_chk (23514)
            status: "active",
            created_by: source.created_by,
            tenant_id: source.tenant_id,
            created_by_channel_type: "form", // #10 channel-of-origin (external form bridge)
          })
          .select("id")
          .single();
        contactId = inserted?.id ?? null;
      }
    }

    // Record submission against the bridge's target form (if mapped) — else a
    // synthetic record by writing only to growth_form_submissions when target_form_id is set.
    if (source.target_form_id) {
      await supabase.from("growth_form_submissions").insert({
        form_id: source.target_form_id,
        tenant_id: source.tenant_id,
        contact_id: contactId,
        source: `external:${source.provider}`,
        external_source_id: source.id,
        payload_json: mapped,
        referrer: req.headers.get("referer") ?? null,
        ip: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      });
    }

    await supabase
      .from("growth_external_sources")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", source.id);

    return new Response(JSON.stringify({ ok: true, contact_id: contactId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
