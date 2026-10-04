// Sub-Agent: Fundability Diagnostician
// Maps a client record against the BUILD-to-FUND Phase 0/1/2/3 checklist
// and the Data Consistency 7-channel standard. Returns specific gaps per phase.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface Input {
  contact_id?: string;
  client_id?: string;
}

type Phase =
  | "Phase 0 Intake"
  | "Phase 1 BUILD"
  | "Data Consistency Layer"
  | "Phase 2 STACK"
  | "Phase 3 FUND";

interface Finding {
  phase: Phase;
  gap: string;
  severity: "blocker" | "warning" | "info";
}

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // INT-310 C0 — internal-only specialist. It reads canonical client data with the SERVICE ROLE, so
  // the gateway's verify_jwt (which the public anon key and any user JWT pass) is not authority.
  // Only the canonical internal caller (exact service-role bearer or a verified cron token, e.g. the
  // orchestrator's invokeLocal) may reach the lookup below.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) return ok({ ok: false, error: "unauthorized" }, 401);

  let payload: { input?: Input; context?: { contact_id?: string } } = {};
  try {
    payload = await req.json();
  } catch {
    return ok({ ok: false, error: "Invalid JSON" }, 400);
  }

  const contactId =
    payload.input?.contact_id ?? payload.input?.client_id ?? payload.context?.contact_id;
  if (!contactId) {
    return ok({
      ok: false,
      error: "contact_id required",
      hint: "Pass input.contact_id to diagnose a specific client.",
    });
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select(
      "id,first_name,last_name,entity_name,entity_type,funding_goal,linked_user_id,street_address,city,state,zip_code,onboarding_stage,agreement_signed_at,journey_stage_id,tier,primary_offer",
    )
    .eq("id", contactId)
    .maybeSingle();
  if (clientErr) return ok({ ok: false, error: clientErr.message }, 500);
  if (!client) return ok({ ok: false, error: `Client ${contactId} not found` }, 404);

  const userId = client.linked_user_id;

  // Pull adjacent BTF context (best-effort, parallel)
  const [intakeRes, businessRes, bankRes, readinessRes, vendorsRes] = await Promise.all([
    supabase
      .from("paige_client_intake_submissions")
      .select("id,section,submitted_at")
      .eq("client_id", contactId)
      .limit(20),
    userId
      ? supabase
          .from("businesses")
          .select(
            "id,legal_name,entity_type,state_of_formation,ein,business_street_address,business_city,business_state,business_zip,business_phone,phone_411_listed,business_email,website,naics,dnb_duns_number,has_bank_account,bank_account_opened_date,bank_name,fico_sbss,dnb_paydex_score,experian_intelliscore_score",
          )
          .eq("owner_user_id", userId)
          .eq("is_primary", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("banking_relationships")
          .select("id,institution_name,account_open_date,is_primary_institution,months_at_institution")
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    userId
      ? supabase
          .from("funding_readiness_scores")
          .select(
            "overall_score,personal_credit_score,business_credit_score,entity_structure_score,banking_history_score,revenue_documentation_score,lender_alignment_score,last_calculated_at",
          )
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const intakeSections = (intakeRes.data ?? []).map((r) => r.section as string);
  const biz = businessRes.data as Record<string, unknown> | null;
  const banks = (bankRes.data ?? []) as Array<Record<string, unknown>>;
  const readiness = readinessRes.data as Record<string, unknown> | null;

  // If we have a business, pull its vendors
  let vendors: Array<Record<string, unknown>> = vendorsRes.data;
  if (biz?.id) {
    const { data } = await supabase
      .from("business_vendors")
      .select("id,vendor_name,vendor_type,is_active,reports_to_bureaus,on_time_payments,total_payments")
      .eq("business_id", biz.id as string);
    vendors = data ?? [];
  }

  const findings: Finding[] = [];

  // ---- PHASE 0 INTAKE ----
  if (!client.agreement_signed_at) {
    findings.push({
      phase: "Phase 0 Intake",
      gap: "Service agreement not yet signed.",
      severity: "blocker",
    });
  }
  if (intakeSections.length === 0) {
    findings.push({
      phase: "Phase 0 Intake",
      gap: "Phase 0 intake questionnaire not started — no submissions on file.",
      severity: "blocker",
    });
  } else {
    const expected = ["personal_credit", "funding_goal", "existing_entity", "banking"];
    const missing = expected.filter((s) => !intakeSections.includes(s));
    if (missing.length > 0) {
      findings.push({
        phase: "Phase 0 Intake",
        gap: `Intake sections missing: ${missing.join(", ")}.`,
        severity: "warning",
      });
    }
  }
  if (!readiness?.personal_credit_score) {
    findings.push({
      phase: "Phase 0 Intake",
      gap: "Personal credit not yet captured (3-bureau pull is the basis for the Funding Path Decision).",
      severity: "blocker",
    });
  }

  // ---- PHASE 1 BUILD ----
  if (!biz) {
    findings.push({
      phase: "Phase 1 BUILD",
      gap: "No primary business entity record on file — Phase 1 has not started.",
      severity: "blocker",
    });
  } else {
    if (!biz.legal_name) findings.push({ phase: "Phase 1 BUILD", gap: "Legal business name missing.", severity: "blocker" });
    if (!biz.entity_type) findings.push({ phase: "Phase 1 BUILD", gap: "Entity type (LLC/Corp) not confirmed.", severity: "blocker" });
    if (!biz.state_of_formation) findings.push({ phase: "Phase 1 BUILD", gap: "State of formation not recorded.", severity: "blocker" });
    if (!biz.ein) findings.push({ phase: "Phase 1 BUILD", gap: "EIN not obtained or not stored (CP 575 letter must be on file).", severity: "blocker" });
    if (!biz.business_street_address) findings.push({ phase: "Phase 1 BUILD", gap: "Business address missing — must be commercial/virtual/registered, not residential.", severity: "blocker" });
    if (!biz.business_phone) findings.push({ phase: "Phase 1 BUILD", gap: "Dedicated business phone line missing (not personal cell).", severity: "blocker" });
    if (biz.business_phone && !biz.phone_411_listed) {
      findings.push({ phase: "Phase 1 BUILD", gap: "Business phone is not 411-listed — required for the Data Consistency Layer.", severity: "warning" });
    }
    if (!biz.business_email || /@(gmail|yahoo|hotmail|outlook|icloud)\./i.test(biz.business_email as string)) {
      findings.push({ phase: "Phase 1 BUILD", gap: "Business email is missing or on a free provider — lenders expect a domain email.", severity: "warning" });
    }
    if (!biz.website) findings.push({ phase: "Phase 1 BUILD", gap: "No business website on file — lenders check this.", severity: "warning" });
    if (!biz.naics) findings.push({ phase: "Phase 1 BUILD", gap: "NAICS code not selected (some codes auto-decline; document reasoning).", severity: "warning" });

    if (!biz.has_bank_account) {
      findings.push({
        phase: "Phase 1 BUILD",
        gap: "Business checking account not opened. Banking history clock has not started — lenders want 3+ months.",
        severity: "blocker",
      });
    } else if (biz.bank_account_opened_date) {
      const months = (Date.now() - new Date(biz.bank_account_opened_date as string).getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (months < 3) {
        findings.push({
          phase: "Phase 1 BUILD",
          gap: `Banking history is only ~${months.toFixed(1)} months old. Wait for 3+ months before serious applications.`,
          severity: "warning",
        });
      }
    }
  }
  // Cross-check banking_relationships
  if (banks.length === 0 && biz?.has_bank_account) {
    findings.push({
      phase: "Phase 1 BUILD",
      gap: "Business shows has_bank_account=true but no banking_relationships record — sync the bank profile.",
      severity: "info",
    });
  }

  // ---- DATA CONSISTENCY LAYER ----
  if (biz?.legal_name) {
    findings.push({
      phase: "Data Consistency Layer",
      gap: "Run the 7-channel exact-match audit (SOS · IRS · Bank · 411 · Google · Yelp · LexisNexis) via the Data Consistency Auditor sub-agent before STACK begins.",
      severity: biz.bank_account_opened_date ? "warning" : "info",
    });
  }

  // ---- PHASE 2 STACK ----
  if (biz && !biz.dnb_duns_number) {
    findings.push({
      phase: "Phase 2 STACK",
      gap: "D-U-N-S number not registered with Dun & Bradstreet — required identifier before opening tradelines.",
      severity: "blocker",
    });
  }
  const activeVendors = vendors.filter((v) => v.is_active);
  const reportingVendors = activeVendors.filter((v) => Array.isArray(v.reports_to_bureaus) && (v.reports_to_bureaus as string[]).length > 0);
  if (biz && reportingVendors.length < 3) {
    findings.push({
      phase: "Phase 2 STACK",
      gap: `Only ${reportingVendors.length} of recommended 3-5 vendor tradelines confirmed reporting. Tier 1 vendor must report before Tier 2 retail.`,
      severity: reportingVendors.length === 0 ? "blocker" : "warning",
    });
  }
  if (reportingVendors.length >= 3 && !biz?.dnb_paydex_score) {
    findings.push({
      phase: "Phase 2 STACK",
      gap: "Vendor reporting is in place but PAYDEX score not yet generated — check D&B in 30 days.",
      severity: "info",
    });
  }

  // ---- PHASE 3 FUND ----
  if (readiness?.overall_score && (readiness.overall_score as number) < 70) {
    findings.push({
      phase: "Phase 3 FUND",
      gap: `Composite readiness score is ${readiness.overall_score}/100. Hold FUND applications until the gaps above are closed.`,
      severity: "warning",
    });
  }
  if (biz && !biz.fico_sbss) {
    findings.push({
      phase: "Phase 3 FUND",
      gap: "FICO SBSS not assessed — required for SBA product readiness.",
      severity: "info",
    });
  }

  // Determine current phase by walking forward through blockers
  const hasBlocker = (p: Phase) =>
    findings.some((f) => f.phase === p && f.severity === "blocker");
  let currentPhase: Phase = "Phase 0 Intake";
  if (!hasBlocker("Phase 0 Intake")) currentPhase = "Phase 1 BUILD";
  if (currentPhase === "Phase 1 BUILD" && !hasBlocker("Phase 1 BUILD")) currentPhase = "Phase 2 STACK";
  if (currentPhase === "Phase 2 STACK" && !hasBlocker("Phase 2 STACK")) currentPhase = "Phase 3 FUND";

  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "warning");

  const nextGate =
    blockers.length > 0
      ? `${blockers[0].phase} — close: "${blockers[0].gap}"`
      : `${currentPhase} sign-off`;

  return ok({
    ok: true,
    subagent: "fundability-diagnostician",
    summary: `${client.first_name ?? "Client"} ${client.last_name ?? ""} is in ${currentPhase}. ${blockers.length} blocker(s), ${warnings.length} warning(s). Next gate: ${nextGate}.`,
    current_phase: currentPhase,
    findings,
    recommended_actions: blockers.slice(0, 5).map((f) => f.gap),
    confidence: blockers.length > 0 ? "high" : warnings.length > 0 ? "medium" : "high",
    requires_approval: false,
    metadata: {
      tier: client.tier,
      primary_offer: client.primary_offer,
      readiness_score: readiness?.overall_score ?? null,
      vendors_reporting: reportingVendors.length,
      has_business_record: Boolean(biz),
      has_duns: Boolean(biz?.dnb_duns_number),
    },
    sources: ["BUILD-to-FUND Master Checklist", "Knowledge Base Section 17"],
  });
});
