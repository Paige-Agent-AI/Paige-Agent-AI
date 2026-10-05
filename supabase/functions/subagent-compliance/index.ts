// Sub-Agent: Legal & Compliance Reviewer
// Compliance gate before Paige sends external comms or runs irreversible actions.
// Checks: CROA/FCRA/GLBA flags, consent state, required disclaimers, do-not-contact,
// and whether the proposed action requires human approval.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

interface ReviewInput {
  contact_id?: string;
  action_type?: string; // "email" | "sms" | "credit_dispute" | "lender_outreach" | "data_share" | "other"
  draft_text?: string;
  channel?: "email" | "sms" | "voice" | "in_app";
}

const REQUIRED_DISCLAIMERS: Record<string, RegExp> = {
  credit_dispute: /not legal advice|educational purposes|FCRA/i,
  lender_outreach: /not a guarantee|underwriting|subject to (lender )?approval/i,
  data_share: /consent|opt[- ]?in/i,
};

const RED_FLAG_PATTERNS: { pattern: RegExp; flag: string; severity: "blocker" | "warning" }[] = [
  { pattern: /\bguarantee(d|s)?\b/i, flag: "Uses 'guarantee' language — CROA risk.", severity: "blocker" },
  { pattern: /\beras(e|ing)\b.*credit/i, flag: "Promises to 'erase' credit — CROA violation.", severity: "blocker" },
  { pattern: /\bremove\s+(all\s+)?negative/i, flag: "Promises to remove negatives — CROA violation.", severity: "blocker" },
  { pattern: /\bcpn\b|credit privacy number/i, flag: "References CPN — federal fraud territory. Never recommend.", severity: "blocker" },
  { pattern: /\bfile\s+segregation\b/i, flag: "References file segregation — fraud. Never recommend.", severity: "blocker" },
  { pattern: /\bapproved\s+for\s+\$/i, flag: "Pre-states approval amount — needs underwriting disclaimer.", severity: "warning" },
  { pattern: /SSN\s*[:#]\s*\d/i, flag: "Raw SSN detected in draft — strip before sending.", severity: "blocker" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, flag: "SSN pattern detected in draft — strip before sending.", severity: "blocker" },
];

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
  // orchestrator's invokeLocal and email-composer's compliance review) may reach the lookup below.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) return ok({ ok: false, error: "unauthorized" }, 401);

  let body: { input?: ReviewInput; context?: { contact_id?: string } } = {};
  try { body = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }

  const input = body.input ?? {};
  const contactId = input.contact_id ?? body.context?.contact_id;
  const actionType = input.action_type ?? "other";
  const draft = (input.draft_text ?? "").trim();

  const findings: { severity: "blocker" | "warning" | "info"; message: string }[] = [];

  // Red-flag scan
  for (const rf of RED_FLAG_PATTERNS) {
    if (draft && rf.pattern.test(draft)) findings.push({ severity: rf.severity, message: rf.flag });
  }

  // Required disclaimers
  const required = REQUIRED_DISCLAIMERS[actionType];
  if (draft && required && !required.test(draft)) {
    findings.push({
      severity: "warning",
      message: `Action '${actionType}' requires standard disclaimer language (regex: ${required}).`,
    });
  }

  // Contact-level checks
  let contactSummary: Record<string, unknown> | null = null;
  if (contactId) {
    // `email` in the summary is the contact's PRIMARY email.
    const { data: row } = await supabase
      .from("clients")
      .select(`id,first_name,last_name,do_not_contact,agreement_signed_at,linked_user_id,tenant_id,${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", contactId)
      .maybeSingle();
    const client = withPrimaryAddresses(row);

    if (!client) {
      findings.push({ severity: "blocker", message: `Contact ${contactId} not found.` });
    } else {
      contactSummary = {
        name: `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim(),
        email: client.email,
      };
      if (client.do_not_contact && (input.channel === "email" || input.channel === "sms" || input.channel === "voice")) {
        findings.push({ severity: "blocker", message: "Contact is flagged do_not_contact — outbound channel blocked." });
      }
      if (!client.agreement_signed_at && (actionType === "credit_dispute" || actionType === "lender_outreach")) {
        findings.push({ severity: "blocker", message: "Service agreement not signed — required before this action." });
      }

      // Consent check for data-sensitive actions (latest event per consent_type wins)
      if (["credit_dispute", "lender_outreach", "data_share"].includes(actionType) && client.linked_user_id) {
        const { data: consents } = await supabase
          .from("consent_events")
          .select("consent_type,granted,created_at")
          .eq("user_id", client.linked_user_id)
          .order("created_at", { ascending: false })
          .limit(50);
        const latest = new Map<string, boolean>();
        for (const c of consents ?? []) {
          if (!latest.has(c.consent_type as string)) latest.set(c.consent_type as string, Boolean(c.granted));
        }
        const need =
          actionType === "credit_dispute" ? "credit_data_use" :
          actionType === "lender_outreach" ? "lender_sharing" :
          "data_processing";
        if (!latest.get(need)) {
          findings.push({
            severity: "blocker",
            message: `Active consent of type '${need}' not on file. Capture consent before proceeding.`,
          });
        }
      }
    }
  }

  // Approval routing
  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "warning");
  const requires_approval =
    blockers.length > 0 ||
    actionType === "credit_dispute" ||
    actionType === "lender_outreach" ||
    (actionType === "email" && draft.length > 500);

  const verdict: "approved" | "needs_human_approval" | "blocked" =
    blockers.length > 0 ? "blocked" : requires_approval ? "needs_human_approval" : "approved";

  return ok({
    ok: true,
    subagent: "legal-compliance-reviewer",
    verdict,
    requires_approval,
    summary:
      verdict === "blocked"
        ? `BLOCKED — ${blockers.length} compliance blocker(s).`
        : verdict === "needs_human_approval"
        ? `Hold for human approval. ${warnings.length} warning(s).`
        : "Cleared. No blockers detected; safe to proceed.",
    findings,
    contact: contactSummary,
    action_type: actionType,
    sources: ["FCRA", "FDCPA", "CROA §1679", "GLBA", "Knowledge Base Section 17/18"],
  });
});
