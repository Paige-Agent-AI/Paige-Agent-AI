// Public signup wizard completion endpoint.
// Auth-gated by JWT (the user just signed up via Lovable Cloud auth on the client).
// Creates a `clients` row mirror, classifies routing, and fires sales_dept.handle_new_lead via mma-os-bridge.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import { addClientAddresses, insertClientWithAddresses } from "../_shared/contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WizardSchema = z.object({
  full_legal_name: z.string().trim().min(1).max(200),
  preferred_name: z.string().trim().max(120).optional().nullable(),
  date_of_birth: z.string().trim().max(40).optional().nullable(),
  personal_phone: z.string().trim().max(40).optional().nullable(),
  entity_status: z.enum(["have_entity", "no_entity_yet"]),
  entity_name: z.string().trim().max(200).optional().nullable(),
  entity_structure: z.string().trim().max(60).optional().nullable(),
  entity_state: z.string().trim().max(60).optional().nullable(),
  formation_date: z.string().trim().max(40).optional().nullable(),
  ein: z.string().trim().max(40).optional().nullable(),
  business_address: z.string().trim().max(400).optional().nullable(),
  business_phone: z.string().trim().max(40).optional().nullable(),
  business_email: z.string().trim().email().max(255).optional().nullable(),
  banking_relationship: z.string().trim().max(200).optional().nullable(),
  banking_age_months: z.coerce.number().int().min(0).max(1200).optional().nullable(),
  personal_credit_band: z.enum(["excellent", "good", "fair", "building", "unsure"]).optional().nullable(),
  funding_goal_usd: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  funding_timeline: z.string().trim().max(120).optional().nullable(),
  existing_tradelines_count: z.coerce.number().int().min(0).max(500).optional().nullable(),
  industry: z.string().trim().max(200).optional().nullable(),
  naics: z.string().trim().max(20).optional().nullable(),
  w2_income_usd: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  credit_partner_available: z.boolean().optional().nullable(),
  attribution_source: z.string().trim().max(120).optional().nullable(),
});

function classifyRoute(input: z.infer<typeof WizardSchema>): "workspace" | "coach_qualify" {
  const goal = input.funding_goal_usd ?? 0;
  const hasEntity = input.entity_status === "have_entity";
  if (goal >= 50_000 && hasEntity) return "coach_qualify";
  return "workspace";
}

// Persona vocabulary matches MMA OS sales_dept v4 contract
// (docs/PAIGE-MMA-OS-BRIDGE-CONTRACT.md on mma-os main).
function classifyPersona(input: z.infer<typeof WizardSchema>): "credit" | "funding" | "business" {
  if (input.entity_status === "no_entity_yet") return "credit";
  const goal = input.funding_goal_usd ?? 0;
  if (goal >= 50_000) return "funding";
  return "business";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const json = await req.json().catch(() => ({}));
    const parsed = WizardSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid_input", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: profile } = await admin.from("profiles")
      .select("active_tenant_id").eq("user_id", user.id).maybeSingle();
    const tenantId = profile?.active_tenant_id ?? null;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "workspace_not_provisioned" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [first, ...rest] = data.full_legal_name.split(/\s+/);
    const last = rest.join(" ");
    const route = classifyRoute(data);
    const persona = classifyPersona(data);

    // Upsert or create a client mirror tied to this auth user.
    const { data: existing } = await admin
      .from("clients")
      .select("id")
      .eq("linked_user_id", user.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const clientPatch: Record<string, unknown> = {
      first_name: first || data.full_legal_name,
      last_name: last || null,
      entity_name: data.entity_name ?? null,
      entity_type: data.entity_structure ?? null,
      funding_goal: data.funding_goal_usd ?? null,
      linked_user_id: user.id,
      lifecycle_stage: route === "coach_qualify" ? "qualifying" : "self_serve",
      source: "paige_public_signup",
      tier: route === "coach_qualify" ? "btf_interested" : "self_serve",
      status: "active",
      tenant_id: tenantId,
      current_notes:
        `Attribution: ${data.attribution_source ?? "—"} · Persona: ${persona} · ` +
        `Timeline: ${data.funding_timeline ?? "—"} · Credit: ${data.personal_credit_band ?? "—"} · ` +
        `Industry: ${data.industry ?? "—"} · Banking: ${data.banking_relationship ?? "—"}`,
    };

    // The sign-in email (else the business email) and the personal phone are the contact's
    // addresses: contact methods, each made the contact's primary of its kind.
    const signupEmail = user.email ?? data.business_email ?? null;
    const signupPhone = data.personal_phone ?? null;

    let clientId = existing?.id as string | undefined;
    if (clientId) {
      await admin.from("clients").update(clientPatch).eq("id", clientId);
      // A failure is logged by the helper; like the row update above, it does not fail the signup.
      await addClientAddresses(admin, tenantId, clientId, [
        { kind: "email", value: signupEmail, is_primary: true },
        { kind: "phone", value: signupPhone, is_primary: true },
      ], "complete-signup");
    } else {
      const { data: inserted, error: insErr } = await insertClientWithAddresses(
        admin,
        { ...clientPatch, tenant_id: tenantId, created_by: user.id, created_by_channel_type: "signup" }, // #10 channel-of-origin (self-serve signup)
        { email: signupEmail, phone: signupPhone },
        "complete-signup",
      );
      if (insErr || !inserted) {
        return new Response(JSON.stringify({ error: "client_create_failed", details: insErr?.message ?? "no row" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      clientId = inserted.id;
    }

    // Fire bridge — never blocks the response (EdgeRuntime.waitUntil → wait:false semantics).
    // Field shape per docs/PAIGE-MMA-OS-BRIDGE-CONTRACT.md on mma-os main (sha 1dacf1f7).
    const fundingGoalUsd = data.funding_goal_usd ?? 0;
    const hasEntity = data.entity_status === "have_entity";
    fireAndForgetBridge("handle_new_lead", {
      source: "paige_public_signup",
      paige_client_id: clientId,
      auth_user_id: user.id,
      email: user.email,
      full_legal_name: data.full_legal_name,
      preferred_name: data.preferred_name,
      personal_phone: data.personal_phone,
      persona,
      route,
      has_entity: hasEntity,
      funding_goal_cents: Math.round(fundingGoalUsd * 100),
      funding_goal_usd: data.funding_goal_usd ?? null,
      funding_timeline: data.funding_timeline ?? null,
      entity: {
        status: data.entity_status,
        name: data.entity_name,
        structure: data.entity_structure,
        state: data.entity_state,
        formation_date: data.formation_date,
        ein: data.ein,
      },
      business: {
        address: data.business_address,
        phone: data.business_phone,
        email: data.business_email,
        banking_relationship: data.banking_relationship,
        banking_age_months: data.banking_age_months,
      },
      personal_credit_band: data.personal_credit_band,
      existing_tradelines_count: data.existing_tradelines_count,
      industry: data.industry,
      naics: data.naics,
      w2_income_usd: data.w2_income_usd,
      credit_partner_available: data.credit_partner_available,
      attribution_source: data.attribution_source,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        client_id: clientId,
        route,
        persona,
        next_path: route === "workspace" ? "/workspace" : "/signup/coach-qualify",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[complete-signup] error", e);
    return new Response(JSON.stringify({ error: "server_error", message: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
