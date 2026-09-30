// Sub-Agent: Onboarding / Intake Concierge
// Reads BTF document requests + intake submissions for a client and tells
// them exactly what's missing, what's pending review, and what's expired.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const EXPECTED_INTAKE = [
  "personal_credit",
  "funding_goal",
  "existing_entity",
  "banking",
  "business_profile",
  "revenue_documentation",
];

function ok(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let payload: { input?: { contact_id?: string; client_id?: string }; context?: { contact_id?: string } } = {};
  try { payload = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }
  const contactId = payload.input?.contact_id ?? payload.input?.client_id ?? payload.context?.contact_id;
  if (!contactId) return ok({ ok: false, error: "contact_id required" }, 400);

  const { data: client } = await supabase
    .from("clients")
    .select("id,first_name,last_name,agreement_signed_at,onboarding_stage")
    .eq("id", contactId)
    .maybeSingle();
  if (!client) return ok({ ok: false, error: `Client ${contactId} not found` }, 404);

  const [intakeRes, docsRes] = await Promise.all([
    supabase.from("paige_client_intake_submissions").select("section,submitted_at").eq("client_id", contactId),
    supabase
      .from("btf_document_requests")
      .select("id,title,description,status,requested_at,uploaded_at,approved_at,rejection_reason")
      .eq("client_id", contactId)
      .order("requested_at", { ascending: false }),
  ]);

  const sections = (intakeRes.data ?? []).map((r) => r.section as string);
  const missingIntake = EXPECTED_INTAKE.filter((s) => !sections.includes(s));
  const docs = docsRes.data ?? [];

  const pendingUpload = docs.filter((d) => d.status === "requested" || d.status === "pending");
  const pendingReview = docs.filter((d) => d.status === "uploaded" || d.status === "submitted");
  const rejected = docs.filter((d) => d.status === "rejected");
  const approved = docs.filter((d) => d.status === "approved");

  // "Expired" heuristic — uploaded financial docs older than 90 days
  const ninetyDays = 1000 * 60 * 60 * 24 * 90;
  const possiblyStale = approved.filter((d) =>
    d.uploaded_at && Date.now() - new Date(d.uploaded_at as string).getTime() > ninetyDays &&
    /bank|statement|tax|p&l|profit|loss|revenue/i.test(d.title ?? "")
  );

  const action_items: Array<{ priority: "high" | "medium" | "low"; action: string; ref?: string }> = [];

  if (!client.agreement_signed_at) {
    action_items.push({ priority: "high", action: "Sign the BTF service agreement before any documents are processed." });
  }
  for (const s of missingIntake) {
    action_items.push({ priority: "high", action: `Complete intake section: ${s.replace(/_/g, " ")}`, ref: s });
  }
  for (const d of rejected) {
    action_items.push({
      priority: "high",
      action: `Re-upload "${d.title}" — rejected: ${d.rejection_reason ?? "see coach notes"}`,
      ref: d.id as string,
    });
  }
  for (const d of pendingUpload.slice(0, 8)) {
    action_items.push({ priority: "medium", action: `Upload "${d.title}"`, ref: d.id as string });
  }
  for (const d of possiblyStale) {
    action_items.push({
      priority: "medium",
      action: `Refresh "${d.title}" — last upload is older than 90 days, lenders want current statements.`,
      ref: d.id as string,
    });
  }

  const summary = `${client.first_name ?? "Client"}: ${missingIntake.length} intake section(s) missing, ${pendingUpload.length} document(s) awaiting upload, ${pendingReview.length} in coach review, ${rejected.length} rejected, ${possiblyStale.length} possibly stale.`;

  return ok({
    ok: true,
    subagent: "intake-concierge",
    summary,
    action_items,
    counts: {
      intake_missing: missingIntake.length,
      docs_pending_upload: pendingUpload.length,
      docs_pending_review: pendingReview.length,
      docs_rejected: rejected.length,
      docs_stale: possiblyStale.length,
      docs_approved: approved.length,
    },
    confidence: "high",
    requires_approval: false,
    sources: ["paige_client_intake_submissions", "btf_document_requests", "BUILD-to-FUND Master Checklist"],
  });
});
