// Sub-Agent: Content & Outreach Drafter
// Drafts a compliance-aware outreach message (lender intro, client follow-up,
// or coach nudge) for a client. Always marks requires_approval=true — the
// draft routes through Approvals before sending.
import { createClient } from "npm:@supabase/supabase-js@2";
import { gatewayCompat } from "../_shared/claude.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Channel = "email" | "sms" | "lender_intro" | "coach_nudge";
interface Input {
  contact_id?: string;
  client_id?: string;
  channel?: Channel;
  goal?: string;
  lender_name?: string;
  funding_product?: string;
  tone?: "warm" | "direct" | "executive";
}

function ok(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const FORBIDDEN_CLAIMS = [
  /guarantee(d)? (approval|funding|results)/i,
  /remove (all|any) negative/i,
  /erase your debt/i,
  /no risk/i,
  /credit repair/i,
];

function complianceScan(text: string) {
  const hits: string[] = [];
  for (const rx of FORBIDDEN_CLAIMS) if (rx.test(text)) hits.push(rx.source);
  return hits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let payload: { input?: Input; context?: { contact_id?: string } } = {};
  try { payload = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }
  const input = payload.input ?? {};
  const contactId = input.contact_id ?? input.client_id ?? payload.context?.contact_id;
  if (!contactId) return ok({ ok: false, error: "contact_id required" }, 400);
  const channel: Channel = input.channel ?? "email";
  const goal = input.goal ?? "follow up on next milestone";
  const tone = input.tone ?? "warm";

  const { data: client } = await supabase
    .from("clients")
    .select("first_name,last_name,entity_name,funding_goal,linked_user_id,tenant_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!client) return ok({ ok: false, error: "Client not found" }, 404);

  // Sprint C.1.6 — Loud-fail tenant branding.
  const clientTenantId = (client as { tenant_id?: string }).tenant_id ?? null;
  let brandName = "";
  if (clientTenantId) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name,brand")
      .eq("id", clientTenantId)
      .maybeSingle();
    const brand = (tenant?.brand ?? {}) as { name?: string; sender_name?: string };
    brandName = (brand.sender_name ?? brand.name ?? tenant?.name ?? "").trim();
  }
  if (!brandName) {
    return ok({
      ok: false,
      error: "TENANT_SENDER_IDENTITY_NOT_CONFIGURED",
      message: "Tenant sender identity not configured. Set tenants.brand.name before drafting tenant-branded content.",
    }, 424);
  }

  let draft = "";
  {
    const system = `You are Paige, drafting a ${tone} ${channel} message on behalf of ${brandName}.
Hard rules: never guarantee approval/funding/results; never promise to remove negatives; never use the phrase "credit repair"; no legal or tax advice; sign as "${brandName}". Keep under 140 words for email, under 50 words for sms.
Doctrine §116 — WHEN GIVING EXAMPLES: never name another specific client, coach, admin, or customer of the platform. Use archetype phrasing only — "a client", "the contact", "their business", "a coach in your tenant". This applies even if the user explicitly names another client in their query — translate them to archetype in your response.`;
    const user = `Recipient: ${client.first_name ?? ""} ${client.last_name ?? ""}
Business: ${client.entity_name ?? "n/a"}
Funding goal: ${client.funding_goal ?? "n/a"}
Channel: ${channel}
Lender: ${input.lender_name ?? "n/a"}
Product: ${input.funding_product ?? "n/a"}
Goal of message: ${goal}`;

    const aiRes = await gatewayCompat("anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!aiRes.ok) {
      return ok({ ok: false, error: `AI gateway ${aiRes.status}`, detail: (await aiRes.text()).slice(0, 400) }, 502);
    }
    const j = await aiRes.json();
    draft = j?.choices?.[0]?.message?.content ?? "";
  }


  const flags = complianceScan(draft);

  // Persist as outreach draft so it shows up in the existing outreach center
  let draftId: string | null = null;
  if (channel === "lender_intro" || channel === "email") {
    const { data } = await supabase
      .from("outreach_drafts")
      .insert({
        client_user_id: client.linked_user_id,
        outreach_type: channel,
        lender_name: input.lender_name ?? null,
        funding_product: input.funding_product ?? null,
        generated_content: draft,
        compliance_status: flags.length > 0 ? "flagged" : "pending_review",
        compliance_flag_count: flags.length,
        compliance_flags: flags,
        metadata: { goal, tone, source: "subagent-content-drafter" },
      })
      .select("id")
      .single();
    draftId = data?.id ?? null;
  }

  return ok({
    ok: true,
    subagent: "content-outreach-drafter",
    summary: `Drafted ${channel} for ${client.first_name ?? "client"}${flags.length > 0 ? ` — ${flags.length} compliance flag(s)` : ""}. Routed to Approvals.`,
    draft,
    channel,
    compliance_flags: flags,
    draft_id: draftId,
    requires_approval: true,
    confidence: flags.length > 0 ? "low" : "medium",
    sources: ["outreach_drafts", "brand voice"],
  });
});
