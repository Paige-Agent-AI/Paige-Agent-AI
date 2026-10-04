// Sub-Agent: Data Consistency Auditor
// 7-channel exact-match audit on a client's primary business: legal name,
// address, phone, email/domain across IRS/EIN, SOS state, banking, business
// website/email, 411 listing flag, and CRM client record. Pure local — no
// external calls. Returns a per-channel match matrix and blocking mismatches.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function ok(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const norm = (s?: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[.,'"#!?]/g, "")
    .replace(/\b(llc|l\.l\.c\.|inc|incorporated|corp|corporation|co|company|ltd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normPhone = (s?: string | null) => (s ?? "").replace(/\D/g, "").slice(-10);
const normZip = (s?: string | null) => (s ?? "").replace(/\D/g, "").slice(0, 5);
const domainOf = (email?: string | null) => (email ?? "").split("@")[1]?.toLowerCase() ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // INT-310 C0 — internal-only specialist. It reads canonical client data with the SERVICE ROLE, so
  // the gateway's verify_jwt (which the public anon key and any user JWT pass) is not authority.
  // Only the canonical internal caller (exact service-role bearer or a verified cron token, e.g. the
  // orchestrator's invokeLocal) may reach the lookup below.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) return ok({ ok: false, error: "unauthorized" }, 401);
  let payload: { input?: { contact_id?: string; client_id?: string }; context?: { contact_id?: string } } = {};
  try { payload = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }
  const contactId = payload.input?.contact_id ?? payload.input?.client_id ?? payload.context?.contact_id;
  if (!contactId) return ok({ ok: false, error: "contact_id required" }, 400);

  // The CRM record's phone is the contact's PRIMARY phone.
  const { data: row } = await supabase
    .from("clients")
    .select(`id,first_name,last_name,entity_name,linked_user_id,street_address,city,state,zip_code,${CLIENT_CONTACT_METHODS_EMBED}`)
    .eq("id", contactId)
    .maybeSingle();
  const client = withPrimaryAddresses(row);
  if (!client) return ok({ ok: false, error: "Client not found" }, 404);

  const userId = client.linked_user_id;
  const [bizRes, banksRes] = await Promise.all([
    userId
      ? supabase
          .from("businesses")
          .select("legal_name,ein,state_of_formation,business_street_address,business_city,business_state,business_zip,business_phone,business_email,website,phone_411_listed,dnb_duns_number")
          .eq("owner_user_id", userId)
          .eq("is_primary", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("banking_relationships")
          .select("institution_name,account_holder_name,account_address_line1,account_city,account_state,account_zip,account_phone")
          .eq("user_id", userId)
          .eq("is_primary_institution", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const biz = bizRes.data as Record<string, string | boolean | null> | null;
  const bank = banksRes.data as Record<string, string | null> | null;

  if (!biz) {
    return ok({
      ok: true,
      subagent: "data-consistency-auditor",
      summary: "No primary business record on file — cannot run 7-channel audit.",
      channels: {},
      mismatches: [],
      recommended_actions: ["Create the primary business record before running the consistency audit."],
      confidence: "high",
      requires_approval: false,
      sources: ["businesses", "banking_relationships"],
    });
  }

  // Reference name = legal_name (the SOS-of-record value). Everything else
  // must match it exactly (after normalization).
  const refName = norm(biz.legal_name as string);
  const refPhone = normPhone(biz.business_phone as string);
  const refStreet = norm(biz.business_street_address as string);
  const refCity = norm(biz.business_city as string);
  const refState = (biz.business_state as string ?? "").toUpperCase();
  const refZip = normZip(biz.business_zip as string);
  const refDomain = domainOf(biz.business_email as string) || (biz.website as string ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();

  type Channel = "SOS / Legal Name" | "IRS / EIN" | "Bank Records" | "411 Listing" | "Business Website" | "Business Email" | "CRM Client Record";
  interface ChannelResult { status: "match" | "mismatch" | "missing"; detail?: string }
  const channels: Record<Channel, ChannelResult> = {} as Record<Channel, ChannelResult>;

  channels["SOS / Legal Name"] = biz.legal_name && biz.state_of_formation
    ? { status: "match", detail: `${biz.legal_name} · ${biz.state_of_formation}` }
    : { status: "missing", detail: "Legal name or state of formation missing." };

  channels["IRS / EIN"] = biz.ein ? { status: "match", detail: `EIN on file (${String(biz.ein).slice(-4).padStart(9, "*")})` } : { status: "missing", detail: "EIN not stored." };

  // Bank
  if (!bank) {
    channels["Bank Records"] = { status: "missing", detail: "No primary banking record on file." };
  } else {
    const bankName = norm(bank.account_holder_name);
    const bankStreet = norm(bank.account_address_line1);
    const bankCity = norm(bank.account_city);
    const bankState = (bank.account_state ?? "").toUpperCase();
    const bankZip = normZip(bank.account_zip);
    const bankPhone = normPhone(bank.account_phone);
    const fails: string[] = [];
    if (bankName && refName && bankName !== refName) fails.push(`name "${bank.account_holder_name}" ≠ "${biz.legal_name}"`);
    if (bankStreet && refStreet && bankStreet !== refStreet) fails.push("street address");
    if (bankCity && refCity && bankCity !== refCity) fails.push("city");
    if (bankState && refState && bankState !== refState) fails.push("state");
    if (bankZip && refZip && bankZip !== refZip) fails.push("zip");
    if (bankPhone && refPhone && bankPhone !== refPhone) fails.push("phone");
    channels["Bank Records"] = fails.length === 0
      ? { status: "match", detail: bank.institution_name ?? "" }
      : { status: "mismatch", detail: `Bank record diverges on: ${fails.join(", ")}` };
  }

  channels["411 Listing"] = biz.phone_411_listed === true
    ? { status: "match", detail: refPhone || "listed" }
    : biz.phone_411_listed === false
      ? { status: "mismatch", detail: "Business phone is not 411-listed." }
      : { status: "missing", detail: "411 listing not verified." };

  channels["Business Website"] = biz.website
    ? { status: "match", detail: biz.website as string }
    : { status: "missing", detail: "No website on file." };

  if (!biz.business_email) {
    channels["Business Email"] = { status: "missing", detail: "No business email on file." };
  } else if (/@(gmail|yahoo|hotmail|outlook|icloud|aol)\./i.test(biz.business_email as string)) {
    channels["Business Email"] = { status: "mismatch", detail: "Business email is on a free consumer provider." };
  } else if (refDomain && !(biz.business_email as string).toLowerCase().endsWith(`@${refDomain}`)) {
    channels["Business Email"] = { status: "mismatch", detail: `Email domain does not match website domain ${refDomain}.` };
  } else {
    channels["Business Email"] = { status: "match", detail: biz.business_email as string };
  }

  // CRM
  const crmFails: string[] = [];
  if (client.entity_name && norm(client.entity_name) !== refName) crmFails.push(`entity_name "${client.entity_name}" ≠ "${biz.legal_name}"`);
  if (client.street_address && norm(client.street_address) !== refStreet) crmFails.push("address");
  if (client.zip_code && normZip(client.zip_code) !== refZip) crmFails.push("zip");
  if (client.phone && normPhone(client.phone) && refPhone && normPhone(client.phone) !== refPhone) crmFails.push("phone");
  channels["CRM Client Record"] = crmFails.length === 0
    ? { status: "match" }
    : { status: "mismatch", detail: `Client record diverges on: ${crmFails.join(", ")}` };

  const mismatches = Object.entries(channels)
    .filter(([_, v]) => v.status === "mismatch")
    .map(([k, v]) => ({ channel: k, detail: v.detail }));
  const missing = Object.entries(channels)
    .filter(([_, v]) => v.status === "missing")
    .map(([k, v]) => ({ channel: k, detail: v.detail }));

  const recommended_actions = [
    ...mismatches.map((m) => `Reconcile ${m.channel}: ${m.detail}`),
    ...missing.map((m) => `Populate ${m.channel}: ${m.detail}`),
  ].slice(0, 8);

  const passed = Object.values(channels).filter((c) => c.status === "match").length;
  const total = Object.keys(channels).length;

  return ok({
    ok: true,
    subagent: "data-consistency-auditor",
    summary: `Consistency: ${passed}/${total} channels match. ${mismatches.length} mismatch(es), ${missing.length} missing.`,
    channels,
    mismatches,
    missing,
    recommended_actions,
    score: Math.round((passed / total) * 100),
    confidence: "high",
    requires_approval: false,
    sources: ["businesses", "banking_relationships", "clients"],
  });
});
