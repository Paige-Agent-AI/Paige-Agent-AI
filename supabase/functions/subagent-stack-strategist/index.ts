// Sub-Agent: Business Credit Strategist (Phase 2 STACK)
// Recommends the next vendor tradelines based on what the business already has,
// gating Tier 1 → Tier 2 → Tier 3 → revolving per BUILD Business doctrine.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

interface Recommendation {
  tier: "Tier 1 Vendor" | "Tier 2 Retail" | "Tier 3 Fleet/Fuel" | "Business Revolving";
  vendor: string;
  reports_to: string[];
  why: string;
  prerequisite_met: boolean;
}

// Curated, conservative recommendation set — kept short to stay readable.
const CATALOG: Recommendation[] = [
  { tier: "Tier 1 Vendor", vendor: "Uline", reports_to: ["D&B"], why: "Net-30, low barrier, reports to D&B. Foundational PAYDEX builder.", prerequisite_met: true },
  { tier: "Tier 1 Vendor", vendor: "Quill", reports_to: ["D&B"], why: "Office supplies, reports to D&B. Pairs with Uline.", prerequisite_met: true },
  { tier: "Tier 1 Vendor", vendor: "Grainger", reports_to: ["D&B", "Experian"], why: "Industrial supplies, multi-bureau reporter.", prerequisite_met: true },
  { tier: "Tier 1 Vendor", vendor: "Crown Office Supplies", reports_to: ["D&B", "Equifax"], why: "Reports to Equifax — fills the third bureau gap.", prerequisite_met: true },
  { tier: "Tier 2 Retail", vendor: "Home Depot Commercial Revolving", reports_to: ["D&B", "Experian", "Equifax"], why: "Retail revolving once 3+ Tier-1 vendors are reporting.", prerequisite_met: false },
  { tier: "Tier 2 Retail", vendor: "Lowe's Commercial Account", reports_to: ["D&B", "Experian"], why: "Same gating as Home Depot.", prerequisite_met: false },
  { tier: "Tier 3 Fleet/Fuel", vendor: "WEX Fleet Card", reports_to: ["D&B", "Experian"], why: "Fleet card after 5+ months of reporting tradelines.", prerequisite_met: false },
  { tier: "Tier 3 Fleet/Fuel", vendor: "Shell Small Business Card", reports_to: ["D&B"], why: "Fleet card, similar gating.", prerequisite_met: false },
  { tier: "Business Revolving", vendor: "Amex Business Plum / Gold", reports_to: ["SBFE"], why: "After PAYDEX 80+, FICO SBSS qualifying, and 6+ months of clean reporting.", prerequisite_met: false },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // INT-310 C0 — internal-only specialist. It reads canonical client data with the SERVICE ROLE, so
  // the gateway's verify_jwt (which the public anon key and any user JWT pass) is not authority.
  // Only the canonical internal caller (exact service-role bearer or a verified cron token, e.g. the
  // orchestrator's invokeLocal) may reach the lookup below.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) return ok({ ok: false, error: "unauthorized" }, 401);

  let body: { input?: { contact_id?: string }; context?: { contact_id?: string } } = {};
  try { body = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }

  const contactId = body.input?.contact_id ?? body.context?.contact_id;
  if (!contactId) return ok({ ok: false, error: "contact_id required" });

  const { data: client } = await supabase
    .from("clients")
    .select("id,first_name,last_name,linked_user_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!client) return ok({ ok: false, error: `Client ${contactId} not found` }, 404);

  let biz: Record<string, unknown> | null = null;
  let vendors: Array<Record<string, unknown>> = [];
  if (client.linked_user_id) {
    const { data: b } = await supabase
      .from("businesses")
      .select("id,legal_name,ein,dnb_duns_number,dnb_paydex_score,fico_sbss,has_bank_account,bank_account_opened_date")
      .eq("owner_user_id", client.linked_user_id)
      .eq("is_primary", true)
      .maybeSingle();
    biz = b;
    if (biz?.id) {
      const { data: v } = await supabase
        .from("business_vendors")
        .select("vendor_name,vendor_type,is_active,reports_to_bureaus,on_time_payments,total_payments,account_opened_date")
        .eq("business_id", biz.id as string);
      vendors = v ?? [];
    }
  }

  const activeReporting = vendors.filter(
    (v) => v.is_active && Array.isArray(v.reports_to_bureaus) && (v.reports_to_bureaus as string[]).length > 0,
  );
  const existingNames = new Set(vendors.map((v) => (v.vendor_name as string)?.toLowerCase()).filter(Boolean));
  const tier1Count = activeReporting.filter((v) => (v.vendor_type as string) === "tier_1" || /uline|quill|grainger|crown/i.test(v.vendor_name as string)).length;
  const monthsOldest = activeReporting.reduce((max, v) => {
    if (!v.account_opened_date) return max;
    const m = (Date.now() - new Date(v.account_opened_date as string).getTime()) / (1000 * 60 * 60 * 24 * 30);
    return Math.max(max, m);
  }, 0);

  // Build recommendations dynamically
  const recs: Recommendation[] = CATALOG
    .filter((r) => !existingNames.has(r.vendor.toLowerCase()))
    .map((r) => {
      let prerequisite_met = true;
      if (r.tier === "Tier 2 Retail") prerequisite_met = tier1Count >= 3;
      if (r.tier === "Tier 3 Fleet/Fuel") prerequisite_met = tier1Count >= 3 && monthsOldest >= 5;
      if (r.tier === "Business Revolving") {
        prerequisite_met = Boolean(biz?.dnb_paydex_score) && (biz!.dnb_paydex_score as number) >= 80 && monthsOldest >= 6;
      }
      return { ...r, prerequisite_met };
    });

  const blockers: string[] = [];
  if (!biz) blockers.push("No business record — Phase 1 BUILD not started.");
  if (biz && !biz.ein) blockers.push("EIN missing — required before any vendor application.");
  if (biz && !biz.dnb_duns_number) blockers.push("D-U-N-S not registered — required before D&B-reporting vendors.");
  if (biz && !biz.has_bank_account) blockers.push("No business bank account — required for vendor applications.");

  const phase =
    blockers.length > 0 ? "Cannot start STACK yet"
    : tier1Count < 3 ? "Tier 1 build-out"
    : monthsOldest < 5 ? "Aging Tier 1 to 5+ months"
    : tier1Count >= 3 && monthsOldest >= 6 && biz?.dnb_paydex_score && (biz.dnb_paydex_score as number) >= 80 ? "Ready for revolving"
    : "Tier 2 expansion";

  const next3 = recs.filter((r) => r.prerequisite_met).slice(0, 3);
  const later = recs.filter((r) => !r.prerequisite_met).slice(0, 4);

  return ok({
    ok: true,
    subagent: "business-credit-strategist",
    summary: `${biz?.legal_name ?? "Business"} is in: ${phase}. ${activeReporting.length} reporting tradeline(s), oldest ~${monthsOldest.toFixed(1)} months.`,
    phase,
    blockers,
    recommended_next: next3,
    queued_for_later: later,
    metrics: {
      reporting_tradelines: activeReporting.length,
      tier1_count: tier1Count,
      oldest_months: Number(monthsOldest.toFixed(1)),
      paydex: biz?.dnb_paydex_score ?? null,
      duns: biz?.dnb_duns_number ?? null,
    },
    requires_approval: false,
    sources: ["Knowledge Base Section 13 (BUILD Business 2.0)", "Knowledge Base Section 15"],
  });
});
