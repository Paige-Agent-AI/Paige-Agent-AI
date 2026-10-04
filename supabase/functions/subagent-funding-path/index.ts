// Sub-Agent: Funding Path Architect (Phase 3 FUND)
// Recommends a no-doc → low-doc → full-doc capital stack tailored to the client's
// current FICO, business credit, banking depth, and stated funding goal.

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

interface Product {
  name: string;
  type: "no-doc-card" | "no-doc-line" | "low-doc-line" | "term-loan" | "sba";
  bureau: string;
  est_amount: string;
  fico_min: number;
  reports_to_consumer: boolean;
  notes: string;
}

const CATALOG: Product[] = [
  { name: "Chase Ink Business Unlimited",   type: "no-doc-card", bureau: "Experian",  est_amount: "$5K–$25K",   fico_min: 700, reports_to_consumer: false, notes: "Payment history only to personal — safe for stacking." },
  { name: "Amex Business Plum",             type: "no-doc-card", bureau: "Experian",  est_amount: "$10K–$50K+", fico_min: 700, reports_to_consumer: false, notes: "Payment history only. Pairs with Ink for diversification." },
  { name: "Capital One Spark Cash Plus",    type: "no-doc-card", bureau: "TransUnion",est_amount: "$5K–$30K",   fico_min: 720, reports_to_consumer: true,  notes: "FULL reporting to personal — warn client before stacking." },
  { name: "BoA Business Advantage Cash",    type: "no-doc-card", bureau: "Equifax",   est_amount: "$5K–$25K",   fico_min: 700, reports_to_consumer: false, notes: "Business-bureau-only — safer for stacking." },
  { name: "US Bank Business Triple Cash",   type: "no-doc-card", bureau: "Experian",  est_amount: "$5K–$20K",   fico_min: 700, reports_to_consumer: false, notes: "Business-bureau-only." },
  { name: "Bluevine Line of Credit",        type: "no-doc-line", bureau: "Experian",  est_amount: "$5K–$250K",  fico_min: 625, reports_to_consumer: false, notes: "Soft pull pre-qual. 6+ months in business, $10K+/mo revenue." },
  { name: "Fundbox Line of Credit",         type: "no-doc-line", bureau: "Experian",  est_amount: "$1K–$150K",  fico_min: 600, reports_to_consumer: false, notes: "Low barrier, good for first-line." },
  { name: "OnDeck Term Loan",               type: "term-loan",   bureau: "Experian",  est_amount: "$5K–$250K",  fico_min: 625, reports_to_consumer: false, notes: "Higher cost; use after no-doc options exhausted." },
  { name: "SBA 7(a)",                       type: "sba",         bureau: "FICO SBSS", est_amount: "$50K–$5M",   fico_min: 680, reports_to_consumer: false, notes: "Full-doc; requires FICO SBSS 155+, 2yrs tax returns." },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // INT-310 C0 — internal-only specialist. It reads canonical client data with the SERVICE ROLE, so
  // the gateway's verify_jwt (which the public anon key and any user JWT pass) is not authority.
  // Only the canonical internal caller (exact service-role bearer or a verified cron token, e.g. the
  // orchestrator's invokeLocal) may reach the lookup below.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) return ok({ ok: false, error: "unauthorized" }, 401);

  let body: { input?: { contact_id?: string; goal_amount?: number }; context?: { contact_id?: string } } = {};
  try { body = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }

  const contactId = body.input?.contact_id ?? body.context?.contact_id;
  if (!contactId) return ok({ ok: false, error: "contact_id required" });

  const { data: client } = await supabase
    .from("clients")
    .select("id,first_name,last_name,linked_user_id,funding_goal,monthly_revenue")
    .eq("id", contactId)
    .maybeSingle();
  if (!client) return ok({ ok: false, error: `Client ${contactId} not found` }, 404);

  const [bizRes, readinessRes] = await Promise.all([
    client.linked_user_id
      ? supabase
          .from("businesses")
          .select("legal_name,dnb_paydex_score,fico_sbss,has_bank_account,bank_account_opened_date,experian_intelliscore_score")
          .eq("owner_user_id", client.linked_user_id).eq("is_primary", true).maybeSingle()
      : Promise.resolve({ data: null }),
    client.linked_user_id
      ? supabase
          .from("funding_readiness_scores")
          .select("personal_credit_score,business_credit_score,overall_score")
          .eq("user_id", client.linked_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const biz = bizRes.data as Record<string, unknown> | null;
  const readiness = readinessRes.data as Record<string, unknown> | null;
  const fico = (readiness?.personal_credit_score as number | undefined) ?? null;
  const goal = body.input?.goal_amount ?? client.funding_goal ?? null;

  const months = biz?.bank_account_opened_date
    ? (Date.now() - new Date(biz.bank_account_opened_date as string).getTime()) / (1000 * 60 * 60 * 24 * 30)
    : 0;

  const blockers: string[] = [];
  if (!biz) blockers.push("No business record on file.");
  if (biz && !biz.has_bank_account) blockers.push("No business bank account.");
  if (months < 3) blockers.push(`Banking history is ~${months.toFixed(1)} mo — most lenders require 3+ months.`);
  if (fico === null) blockers.push("Personal FICO not on file — required to filter products.");

  const eligible = CATALOG.filter((p) => {
    if (fico !== null && fico < p.fico_min) return false;
    if (p.type === "no-doc-line" || p.type === "term-loan") return months >= 6;
    if (p.type === "sba") return (biz?.fico_sbss as number | undefined ?? 0) >= 155;
    return true;
  });

  // Order: no-doc cards first, then lines, then term, then SBA
  const order = ["no-doc-card", "no-doc-line", "low-doc-line", "term-loan", "sba"];
  eligible.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  // Stack to roughly hit goal
  const stack: Product[] = [];
  let estimatedHigh = 0;
  for (const p of eligible) {
    stack.push(p);
    const high = Number((p.est_amount.match(/\$([\d.]+)([KM])\+?$/) ?? p.est_amount.match(/\$([\d.]+)([KM])/))?.[1] ?? 0) *
      ((p.est_amount.includes("M")) ? 1_000_000 : 1_000);
    estimatedHigh += high;
    if (goal && estimatedHigh >= Number(goal) * 1.2 && stack.length >= 3) break;
    if (stack.length >= 6) break;
  }

  return ok({
    ok: true,
    subagent: "funding-path-architect",
    summary: blockers.length
      ? `Hold — ${blockers.length} blocker(s) before applications.`
      : `${stack.length} recommended product(s). Stack ceiling ~$${estimatedHigh.toLocaleString()} vs goal ${goal ? `$${Number(goal).toLocaleString()}` : "unset"}.`,
    blockers,
    recommended_stack: stack,
    consumer_reporting_warning: stack.some((p) => p.reports_to_consumer)
      ? "One or more recommended products report balances to personal consumer bureaus. Disclose to client before applying."
      : null,
    inputs_used: {
      fico,
      paydex: biz?.dnb_paydex_score ?? null,
      intelliscore: biz?.experian_intelliscore_score ?? null,
      sbss: biz?.fico_sbss ?? null,
      months_banking: Number(months.toFixed(1)),
      goal_amount: goal,
    },
    requires_approval: true,
    sources: ["Knowledge Base Section 11 (FUND)", "No-Doc Funding Intelligence memory", "Consumer Report Impact Warning memory"],
  });
});
