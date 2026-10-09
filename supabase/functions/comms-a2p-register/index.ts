import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { providerExecutionBlocked, QA_NO_PROVIDER_EXECUTION_CODE } from "../_shared/inbox-intelligence/provider-boundary.ts";
import { resolveTwilioCreds, twilioJsonRequest, twilioRequest, masterCreds, type TwilioCreds } from "../_shared/twilio.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const headers = { ...cors, "Content-Type": "application/json" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers });
const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), { status, headers });
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(record) : [];
const safeFailure = (value: string | null | undefined) => text(value).replace(/https:\/\/[^@\\s]+@/gi, "https://sealed@").replace(/\b(?:AC|SK|BU|BN|MG|PN)[0-9a-f]{32}\b/gi, "provider resource").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "contact email").replace(/\+?\d[\d(). -]{7,}\d/g, "sensitive value").replace(/\b[A-Za-z0-9_-]{40,}\b/g, "sealed value").slice(0, 500);

function twilioIndustry(value: unknown): string | undefined {
  const normalized = text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const aliases: Record<string,string> = { BUSINESS_CONSULTING:"PROFESSIONAL_SERVICES", CONSULTING:"PROFESSIONAL_SERVICES", SOFTWARE:"TECHNOLOGY" };
  const allowed = new Set(["AGRICULTURE","AUTOMOTIVE","BANKING","COMMUNICATION","CONSTRUCTION","CONSUMER","EDUCATION","ELECTRONICS","ENERGY","ENGINEERING","FAST_MOVING_CONSUMER_GOODS","FINANCIAL","FINTECH","FOOD_AND_BEVERAGE","GAMBLING","GOVERNMENT","HEALTHCARE","HOSPITALITY","INSURANCE","JEWELRY","LEGAL","MANUFACTURING","MEDIA","NOT_FOR_PROFIT","OIL_AND_GAS","ONLINE","PROFESSIONAL_SERVICES","RAW_MATERIALS","REAL_ESTATE","RELIGION","RETAIL","TECHNOLOGY","TELECOMMUNICATIONS","TRANSPORTATION","TRAVEL"]);
  const candidate = aliases[normalized] || normalized;
  return allowed.has(candidate) ? candidate : undefined;
}
function twilioBusinessType(value: unknown): string | undefined {
  const normalized = text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (["SOLE_PROPRIETOR","SOLE_PROPRIETORSHIP"].includes(normalized)) return "SOLE_PROPRIETOR";
  if (["NON_PROFIT","NONPROFIT"].includes(normalized)) return "NON_PROFIT";
  if (["GOVERNMENT"].includes(normalized)) return "GOVERNMENT";
  if (["PUBLIC_PROFIT","PUBLIC_COMPANY"].includes(normalized)) return "PUBLIC_PROFIT";
  if (["CORPORATION","LLC","PARTNERSHIP","PRIVATE_PROFIT","S_CORPORATION","C_CORPORATION"].includes(normalized)) return "PRIVATE_PROFIT";
  return undefined;
}
// The Edge bundle has no generated Database type; keep the service client intentionally dynamic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EdgeAdminClient = any;
type Context = { tenantId: string; actorId: string; platformOwner: boolean; admin: EdgeAdminClient; creds: TwilioCreds };

async function context(req: Request, body: Record<string, unknown>): Promise<Context | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return fail(401, "UNAUTHENTICATED", "Sign in again to continue.");
  const client = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return fail(401, "UNAUTHENTICATED", "Sign in again to continue.");
  const { data: tenantId, error: tenantError } = await client.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string") return fail(403, "NO_WORKSPACE", "No active workspace could be resolved.");
  if (body.expected_tenant_id !== undefined && body.expected_tenant_id !== tenantId) {
    return fail(409, "WORKSPACE_CHANGED", "Your workspace changed. Reopen registration and try again.");
  }
  const admin = createClient(url, serviceKey);

  // QA #1832: a synthetic QA workspace cannot drive real carrier registration
  // effects (fail-closed at the marker, before any provider call).
  {
    const { data: tenantId, error: tenantError } = await client.rpc("current_user_tenant_id");
    if (!tenantError && tenantId && await providerExecutionBlocked(admin as never, tenantId)) {
      return fail(403, QA_NO_PROVIDER_EXECUTION_CODE, "This is a synthetic QA workspace: real provider effects are disabled on the server.");
    }
  }
  const { data: canManage } = await admin.rpc("is_tenant_admin_as", { _actor: user.id, _tenant: tenantId });
  const { data: platformOwner } = await client.rpc("is_platform_owner");
  if (canManage !== true && platformOwner !== true) return fail(403, "FORBIDDEN", "Workspace owner or administrator access required.");
  const resolved = await resolveTwilioCreds(admin, tenantId);
  if (!resolved.ok || !resolved.data) return fail(422, "TWILIO_NOT_CONNECTED", "This workspace does not have an active Twilio connection.");
  return { tenantId, actorId: user.id, platformOwner: platformOwner === true, admin, creds: resolved.data };
}

async function state(ctx: Context) {
  const [{ data: tenant }, { data: legal }, { data: registration }, { data: numbers }] = await Promise.all([
    ctx.admin.from("tenants").select("name").eq("id", ctx.tenantId).single(),
    ctx.admin.from("tenant_legal_profile").select("legal_business_name,entity_type,website_url,business_identity,business_industry,business_regions_of_operation,business_registration_identifier,business_registration_number_secret_ref,registered_street,registered_street_secondary,registered_city,registered_region,registered_postal_code,registered_iso_country,authorized_representative_first_name,authorized_representative_last_name,authorized_representative_email,authorized_representative_phone,authorized_representative_business_title,authorized_representative_job_position").eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.admin.from("tenant_a2p_registrations").select("*").eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.admin.from("tenant_phone_numbers").select("id,phone_number,twilio_sid,friendly_name,is_primary,status,capabilities").eq("tenant_id", ctx.tenantId).eq("status", "active").order("is_primary", { ascending: false }),
  ]);
  const eligible = (numbers || []).filter((n: Record<string, unknown>) => record(n.capabilities).sms === true && /^PN[0-9a-f]{32}$/i.test(text(n.twilio_sid)));
  return { tenant: record(tenant), legal: record(legal), registration: record(registration), eligible };
}

function missingProfile(legal: Record<string, unknown>): string[] {
  const required: Array<[string, string]> = [
    ["legal_business_name", "legal business name"], ["entity_type", "legal entity type"], ["website_url", "website"], ["business_identity", "business identity"],
    ["business_industry", "business category"], ["business_registration_identifier", "registration type"],
    ["business_registration_number_secret_ref", "tax or registration number"], ["registered_street", "registered street"],
    ["registered_city", "registered city"], ["registered_region", "registered state or region"], ["registered_postal_code", "postal code"],
    ["registered_iso_country", "country"], ["authorized_representative_first_name", "authorized representative"],
    ["authorized_representative_email", "representative email"], ["authorized_representative_phone", "representative phone"],
    ["authorized_representative_business_title", "representative title"], ["authorized_representative_job_position", "representative position"],
  ];
  const missing = required.filter(([key]) => !text(legal[key])).map(([, label]) => label);
  if (!Array.isArray(legal.business_regions_of_operation) || legal.business_regions_of_operation.length === 0) missing.push("regions of operation");
  return missing;
}

function publicState(source: Awaited<ReturnType<typeof state>>) {
  const r = source.registration;
  const l = source.legal;
  const selected = source.eligible.find((n: Record<string, unknown>) => n.id === r.selected_phone_number_id) || source.eligible[0];
  return {
    registration: Object.keys(r).length ? {
      brand_status: r.brand_status, campaign_status: r.campaign_status, status: r.status,
      submission_phase: r.submission_phase || "prepared", number_association_status: r.number_association_status || "not_started",
      number_registration_status: r.number_registration_status || "not_started",
      use_case: r.use_case, campaign_description: r.campaign_description, sample_messages: r.sample_messages,
      optin_flow: r.optin_flow, optin_message: r.optin_message, optout_message: r.optout_message, help_message: r.help_message,
      submitted_at: r.submitted_at, approved_at: r.approved_at, provider_synced_at: r.provider_synced_at,
      failure_code: r.provider_failure_code, failure_reason: r.provider_failure_reason,
      has_brand: Boolean(r.brand_sid), has_campaign: Boolean(r.campaign_sid), has_messaging_service: Boolean(r.messaging_service_sid),
    } : null,
    eligible_number: selected ? { id: selected.id, phone_number: selected.phone_number, label: selected.friendly_name, is_primary: selected.is_primary } : null,
    profile: {
      legal_business_name: l.legal_business_name || null, website_url: l.website_url || null,
      registration_number_saved: Boolean(l.business_registration_number_secret_ref),
      registered_address_complete: [l.registered_street,l.registered_city,l.registered_region,l.registered_postal_code,l.registered_iso_country].every(Boolean),
      business_identity_saved: Boolean(l.business_identity), business_industry_saved: Boolean(l.business_industry),
      regions_saved: Array.isArray(l.business_regions_of_operation) && l.business_regions_of_operation.length > 0,
      authorized_representative_complete: [l.authorized_representative_first_name,l.authorized_representative_last_name,l.authorized_representative_email,l.authorized_representative_phone,l.authorized_representative_business_title,l.authorized_representative_job_position].every(Boolean),
    },
    missing_profile_fields: missingProfile(l),
  };
}

const providerStatus = (raw: unknown) => {
  const s = text(raw).toUpperCase();
  if (["APPROVED","VERIFIED","SUCCESS"].includes(s)) return "approved";
  if (["FAILED","REJECTED","UNVERIFIED"].includes(s)) return "rejected";
  if (["IN_PROGRESS","IN_REVIEW","PENDING_REVIEW"].includes(s)) return "in_review";
  if (["DRAFT","PENDING"].includes(s)) return "pending";
  return "pending";
};

const providerReason = (source: Record<string, unknown>) => {
  const direct = text(source.failure_reason) || text(source.failureReason);
  if (direct) return safeFailure(direct);
  const errors = Array.isArray(source.errors) ? source.errors.map(record) : [];
  return safeFailure(errors.map((item) => text(item.description) || text(item.message) || text(item.code)).filter(Boolean).join("; "));
};

async function finish(ctx: Context, key: string | null, patch: Record<string, unknown>, action: string) {
  return ctx.admin.rpc("finish_tenant_a2p_operation", { _tenant_id: ctx.tenantId, _operation_key: key, _patch: { ...patch, actor_user_id: ctx.actorId }, _audit_action: action });
}

async function syncProvider(ctx: Context, current: Awaited<ReturnType<typeof state>>) {
  const r = current.registration;
  const patch: Record<string, unknown> = { mark_synced: true };
  const syncErrors: string[] = [];
  if (!r.brand_sid && /^BU[0-9a-f]{32}$/i.test(text(r.brand_bundle_sid))) {
    const brands = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, `https://messaging.twilio.com/v1/a2p/BrandRegistrations?A2PProfileBundleSid=${encodeURIComponent(text(r.brand_bundle_sid))}`, "GET");
    if (!brands.ok) syncErrors.push(brands.error || "Brand status could not be read.");
    const match = brands.ok ? list(brands.data?.data).find((item) => text(item.a2p_profile_bundle_sid) === text(r.brand_bundle_sid)) : null;
    if (match && /^BN[0-9a-f]{32}$/i.test(text(match.sid))) {
      const status = providerStatus(match.status);
      patch.brand_sid = text(match.sid);
      patch.customer_profile_sid = text(match.customer_profile_bundle_sid);
      patch.brand_status = status;
      patch.submission_phase = status === "approved" ? "brand_approved" : status === "rejected" ? "action_needed" : "brand_submitted";
      patch.provider_failure_reason = status === "rejected" ? safeFailure(text(match.failure_reason)) : "";
    }
  }
  if (/^BN[0-9a-f]{32}$/i.test(text(r.brand_sid))) {
    const brand = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${encodeURIComponent(text(r.brand_sid))}`, "GET");
    if (!brand.ok) syncErrors.push(brand.error || "Brand status could not be read.");
    if (brand.ok && brand.data) {
      const status = providerStatus(brand.data.status);
      patch.brand_status = status;
      patch.submission_phase = status === "approved" ? "brand_approved" : status === "rejected" ? "action_needed" : "brand_submitted";
      patch.provider_failure_reason = status === "rejected" ? safeFailure(text(brand.data.failure_reason)) : "";
    }
  }
  if (/^MG[0-9a-f]{32}$/i.test(text(r.messaging_service_sid))) {
    const campaign = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, `https://messaging.twilio.com/v1/Services/${encodeURIComponent(text(r.messaging_service_sid))}/Compliance/Usa2p`, "GET");
    if (!campaign.ok) syncErrors.push(campaign.error || "Campaign status could not be read.");
    if (campaign.ok && campaign.data) {
      const campaignRows = list(campaign.data.usa2p_campaigns);
      const campaignState = campaignRows[0] || campaign.data;
      const status = providerStatus(campaignState.campaign_status);
      patch.campaign_status = status;
      if (status === "approved") Object.assign(patch, { status: "approved", submission_phase: "approved", mark_approved: true, number_registration_status: r.number_registration_status === "registered" ? "registered" : "pending" });
      else if (status === "rejected") Object.assign(patch, { status: "rejected", submission_phase: "action_needed", provider_failure_reason: providerReason(campaignState) });
      else if (status === "in_review") Object.assign(patch, { status: "in_review", submission_phase: "campaign_submitted" });
    }
    const senders = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, `https://messaging.twilio.com/v1/Services/${encodeURIComponent(text(r.messaging_service_sid))}/PhoneNumbers?PageSize=100`, "GET");
    if (!senders.ok) syncErrors.push(senders.error || "Number association could not be read.");
    if (senders.ok && list(senders.data?.phone_numbers).some((n) => text(n.phone_number_sid) === text(current.eligible.find((n: Record<string, unknown>) => n.id === r.selected_phone_number_id)?.twilio_sid))) {
      patch.number_association_status = "associated";
    }
  }
  if (syncErrors.length) {
    patch.mark_synced = false;
    patch.provider_failure_code = "PROVIDER_SYNC_FAILED";
    patch.provider_failure_reason = safeFailure(syncErrors[0]);
  }
  await finish(ctx, null, patch, syncErrors.length ? "a2p.provider.sync_failed" : "a2p.provider.synced");
}

async function ensureService(ctx: Context, current: Awaited<ReturnType<typeof state>>, number: Record<string, unknown>) {
  const r = current.registration;
  let serviceSid = text(r.messaging_service_sid);
  if (!serviceSid) {
    const services = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, "https://messaging.twilio.com/v1/Services?PageSize=100", "GET");
    if (!services.ok) throw new Error(services.error || "Existing Messaging Services could not be checked.");
    for (const service of list(services.data?.services)) {
      const sid = text(service.sid);
      if (!/^MG[0-9a-f]{32}$/i.test(sid)) continue;
      const senders = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, `https://messaging.twilio.com/v1/Services/${sid}/PhoneNumbers?PageSize=100`, "GET");
      if (!senders.ok) throw new Error(senders.error || "An existing Messaging Service could not be checked.");
      if (list(senders.data?.phone_numbers).some((p) => text(p.phone_number_sid) === text(number.twilio_sid))) { serviceSid = sid; break; }
    }
  }
  if (!serviceSid) {
    const created = await twilioRequest<Record<string, unknown>>(ctx.creds.accountSid, ctx.creds.authToken,
      "https://messaging.twilio.com/v1/Services", "POST", { FriendlyName: `${text(current.tenant.name).slice(0,42)} SMS`, Usecase: "notifications", UseInboundWebhookOnNumber: true }, ctx.creds.apiKeySid);
    if (!created.ok || !created.data || !/^MG[0-9a-f]{32}$/i.test(text(created.data.sid))) throw new Error(created.error || "Messaging Service could not be created.");
    serviceSid = text(created.data.sid);
  }
  const senders = await twilioJsonRequest<Record<string, unknown>>(ctx.creds, `https://messaging.twilio.com/v1/Services/${serviceSid}/PhoneNumbers?PageSize=100`, "GET");
  if (!senders.ok) throw new Error(senders.error || "The Messaging Service sender pool could not be checked.");
  const associated = list(senders.data?.phone_numbers).some((p) => text(p.phone_number_sid) === text(number.twilio_sid));
  if (!associated) {
    const added = await twilioRequest(ctx.creds.accountSid, ctx.creds.authToken, `https://messaging.twilio.com/v1/Services/${serviceSid}/PhoneNumbers`, "POST", { PhoneNumberSid: text(number.twilio_sid) }, ctx.creds.apiKeySid);
    if (!added.ok) throw new Error(added.error || "The workspace number could not be associated.");
  }
  return serviceSid;
}


const A2P_NUMBER_EVENTS = [
  "com.twilio.messaging.compliance.number-registration.failed",
  "com.twilio.messaging.compliance.number-registration.pending",
  "com.twilio.messaging.compliance.number-registration.successful",
];

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureEventStream(ctx: Context, current: Awaited<ReturnType<typeof state>>, operationKey: string) {
  const r = current.registration;
  let sinkSid = text(r.a2p_event_sink_sid);
  let subscriptionSid = text(r.a2p_event_subscription_sid);
  let secretHash = text(r.event_webhook_secret_hash);
  if (subscriptionSid && (!sinkSid || !secretHash)) throw new Error("The Twilio event subscription is incomplete.");
  if (sinkSid && (!/^DG[0-9a-f]{32}$/i.test(sinkSid) || !/^[0-9a-f]{64}$/i.test(secretHash))) {
    throw new Error("The saved Twilio event sink is invalid.");
  }
  if (subscriptionSid && !/^DF[0-9a-f]{32}$/i.test(subscriptionSid)) {
    throw new Error("The saved Twilio event subscription is invalid.");
  }

  const persist = async (patch: Record<string, unknown>) => {
    const { data, error } = await ctx.admin.from("tenant_a2p_registrations").update(patch)
      .eq("id", r.id).eq("tenant_id", ctx.tenantId).eq("operation_key", operationKey).select("id").single();
    if (error || !data) throw new Error("The event subscription checkpoint could not be saved.");
  };
  const description = "PAIGE A2P " + text(r.id);

  if (!sinkSid) {
    const existing = await twilioRequest<Record<string, unknown>>(ctx.creds.accountSid, ctx.creds.authToken,
      "https://events.twilio.com/v1/Sinks?PageSize=1000", "GET", {}, ctx.creds.apiKeySid);
    if (!existing.ok) throw new Error(existing.error || "Existing Twilio event sinks could not be checked.");
    if (list(existing.data?.sinks).some((item) => text(item.description) === description)) {
      throw new Error("An existing Twilio event sink needs operator reconciliation before another can be created.");
    }

    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
    secretHash = await sha256(secret);
    await persist({ event_webhook_secret_hash:secretHash });
    const destination = new URL(url + "/functions/v1/twilio-a2p-events");
    destination.username = text(r.id);
    destination.password = secret;
    const createdSink = await twilioRequest<Record<string, unknown>>(ctx.creds.accountSid, ctx.creds.authToken,
      "https://events.twilio.com/v1/Sinks", "POST", {
        Description:description, SinkType:"webhook",
        SinkConfiguration:JSON.stringify({ destination:destination.toString(),method:"POST",batch_events:true }),
      }, ctx.creds.apiKeySid);
    sinkSid = text(createdSink.data?.sid);
    if (!createdSink.ok || !/^DG[0-9a-f]{32}$/i.test(sinkSid)) {
      await persist({ event_webhook_secret_hash:null });
      throw new Error(createdSink.error || "Twilio event sink could not be created.");
    }
    await persist({ a2p_event_sink_sid:sinkSid });
  }

  if (!subscriptionSid) {
    const createdSubscription = await twilioRequest<Record<string, unknown>>(ctx.creds.accountSid, ctx.creds.authToken,
      "https://events.twilio.com/v1/Subscriptions", "POST", {
        Description:description, SinkSid:sinkSid,
        Types:A2P_NUMBER_EVENTS.map((type) => JSON.stringify({ type, schema_version:1 })),
      }, ctx.creds.apiKeySid);
    subscriptionSid = text(createdSubscription.data?.sid);
    if (!createdSubscription.ok || !/^DF[0-9a-f]{32}$/i.test(subscriptionSid)) {
      throw new Error(createdSubscription.error || "Twilio event subscription could not be created.");
    }
    await persist({ a2p_event_subscription_sid:subscriptionSid });
  }
  return {
    a2p_event_sink_sid:sinkSid,
    a2p_event_subscription_sid:subscriptionSid,
    event_webhook_secret_hash:secretHash,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "POST only.");
  let body: Record<string, unknown>;
  try { body = record(await req.json()); } catch { return fail(400, "BAD_JSON", "Request body must be JSON."); }
  const resolved = await context(req, body);
  if (resolved instanceof Response) return resolved;
  const ctx = resolved;
  const action = text(body.action) || "status";
  try {
    if (action === "platform_topology") {
      if (!ctx.platformOwner) return fail(403,"FORBIDDEN","Platform owner access required.");
      const master = masterCreds();
      if (!master) return fail(422,"MASTER_TWILIO_NOT_CONNECTED","Platform Twilio credentials are not configured.");
      const profiles = await twilioJsonRequest<Record<string,unknown>>(master,"https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=100","GET");
      if (!profiles.ok) return fail(502,"PROVIDER_DISCOVERY_FAILED","The platform compliance profile could not be verified.");
      const approved = list(profiles.data?.results).filter((profile) => ["TWILIO_APPROVED","APPROVED"].includes(text(profile.status).toUpperCase().replaceAll("-","_")));
      let isIsv = false;
      for (const profile of approved) {
        const profileSid = text(profile.sid);
        if (!/^BU[0-9a-f]{32}$/i.test(profileSid)) continue;
        const assignments = await twilioJsonRequest<Record<string,unknown>>(master,"https://trusthub.twilio.com/v1/CustomerProfiles/" + profileSid + "/EntityAssignments?PageSize=100","GET");
        if (!assignments.ok) continue;
        for (const assignment of list(assignments.data?.results)) {
          const objectSid = text(assignment.object_sid);
          if (!/^IT[0-9a-f]{32}$/i.test(objectSid)) continue;
          const endUser = await twilioJsonRequest<Record<string,unknown>>(master,"https://trusthub.twilio.com/v1/EndUsers/" + objectSid,"GET");
          const identity = text(record(endUser.data?.attributes).business_identity).toLowerCase();
          if (identity === "isv_reseller_or_partner" || identity === "isv" || identity === "reseller") isIsv = true;
        }
      }
      return ok({ model:isIsv ? "isv_subaccount" : "direct_or_unverified", primary_profile_approved:approved.length > 0, isv_or_reseller:isIsv, compliance_embed_prerequisite:isIsv });
    }
    const providerAllowed = await commsProviderExecutionAllowed(ctx.admin, { tenantId: ctx.tenantId, actorUserId: ctx.actorId });
    if (action !== "status" && action !== "cancel" && !providerAllowed) {
      return fail(403,"COMMS_PROVIDER_EXECUTION_DISABLED","Provider execution is disabled for this workspace.");
    }
    let current = await state(ctx);
    if (action === "status") {
      if (providerAllowed && (current.registration.brand_sid || current.registration.brand_bundle_sid || current.registration.messaging_service_sid)) {
        await syncProvider(ctx, current); current = await state(ctx);
      }
      return ok(publicState(current));
    }
    if (action === "cancel") {
      if (["approved","brand_submitted","campaign_submitted"].includes(text(current.registration.submission_phase))) return fail(409,"CANNOT_CANCEL","A carrier review already started and cannot be canceled here.");
      await finish(ctx, null, { submission_phase: "canceled", mark_canceled: true }, "a2p.registration.canceled");
      return ok({ canceled: true });
    }
    if (action === "embedded_submitted") {
      const kind = text(body.kind);
      if (kind !== "brand" && kind !== "campaign") return fail(400, "INVALID_SUBMISSION_KIND", "The submitted registration stage is invalid.");
      if (!Object.keys(current.registration).length) return fail(422,"DRAFT_REQUIRED","Save the messaging details before recording this step.");
      await finish(ctx, null, {}, "a2p." + kind + ".embed_completed");
      return ok({ recorded: true });
    }
    if (!Object.keys(current.registration).length) return fail(422,"DRAFT_REQUIRED","Save the messaging details before starting carrier registration.");
    const number = current.eligible.find((n: Record<string, unknown>) => n.id === body.phone_number_id) || current.eligible[0];
    if (!number) return fail(422,"NUMBER_REQUIRED","This workspace has no active SMS-capable Twilio number.");
    if (body.phone_number_id && number.id !== body.phone_number_id) return fail(403,"NUMBER_NOT_OWNED","That number does not belong to the active workspace.");

    if (action === "start_brand") {
      const missing = missingProfile(current.legal);
      if (missing.length) return fail(422,"PROFILE_INCOMPLETE",`Complete these Setup fields first: ${missing.join(", ")}.`);
      if (!twilioIndustry(current.legal.business_industry) || !twilioBusinessType(current.legal.entity_type)) {
        return fail(422,"PROFILE_UNSUPPORTED","Update the legal entity type and business category in Setup to values supported by Twilio.");
      }
      const existingBrands = await twilioJsonRequest<Record<string,unknown>>(ctx.creds,"https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=100","GET");
      if (!existingBrands.ok) return fail(502,"PROVIDER_DISCOVERY_FAILED",safeFailure(existingBrands.error)||"Existing Twilio registrations could not be checked.");
      const brandRows=list(existingBrands.data?.data).filter((item)=>item.mock!==true);
      if (brandRows.length>1) return fail(409,"AMBIGUOUS_EXISTING_REGISTRATION","More than one existing brand was found in this tenant subaccount. No new registration was created.");
      if (brandRows.length===1) {
        const existing=brandRows[0]; const bundle=text(existing.a2p_profile_bundle_sid); const status=providerStatus(existing.status);
        const inquiryId=bundle?`tri1.us1.account.${ctx.creds.accountSid}.registration.${bundle}`:"";
        await finish(ctx,null,{brand_sid:text(existing.sid),brand_bundle_sid:bundle,trust_product_sid:bundle,customer_profile_sid:text(existing.customer_profile_bundle_sid),brand_inquiry_id:inquiryId,brand_status:status,submission_phase:status==="approved"?"brand_approved":status==="rejected"?"action_needed":"brand_submitted",selected_phone_number_id:number.id,mark_submitted:true},"a2p.brand.reused");
        if(status==="approved") return ok({status_only:true,reused:true});
        if(!inquiryId)return fail(409,"EXISTING_REGISTRATION_INCOMPLETE","An existing Twilio brand could not be resumed automatically.");
        const resumed=await twilioJsonRequest<Record<string,unknown>>(ctx.creds,`https://trusthub.twilio.com/v1/A2PBrandRegistrations/${encodeURIComponent(inquiryId)}/EmbeddedSessions`,"POST",{});
        if(!resumed.ok||!resumed.data)return fail(502,"TWILIO_SESSION_FAILED",safeFailure(resumed.error)||"Twilio could not resume the existing brand.");
        return ok({kind:"brand",inquiry_id:text(resumed.data.id)||inquiryId,inquiry_session_token:text(resumed.data.sessionToken)});
      }
      const profiles=await twilioJsonRequest<Record<string,unknown>>(ctx.creds,"https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=100","GET");
      if(!profiles.ok)return fail(502,"PROVIDER_DISCOVERY_FAILED",safeFailure(profiles.error)||"Existing compliance profiles could not be checked.");
      const profileRows=list(profiles.data?.results);
      if(profileRows.length>1)return fail(409,"AMBIGUOUS_EXISTING_PROFILE","More than one compliance profile was found in this tenant subaccount. No duplicate was created.");
      const reusableProfile=profileRows.length===1&&/^BU[0-9a-f]{32}$/i.test(text(profileRows[0].sid))?text(profileRows[0].sid):undefined;
      const key = crypto.randomUUID();
      const { data: claim } = await ctx.admin.rpc("claim_tenant_a2p_operation", { _tenant_id:ctx.tenantId,_phase:"brand_draft",_operation_key:key });
      if (!record(claim).claimed) return fail(409,"OPERATION_IN_PROGRESS","A registration request is already running. Refresh in a moment.");
      const secret = await ctx.admin.rpc("read_tenant_business_registration_number", { _tenant_id:ctx.tenantId });
      if (secret.error || !text(secret.data)) { await finish(ctx,key,{submission_phase:"action_needed",provider_failure_code:"SEALED_ID_UNAVAILABLE"},"a2p.brand.failed"); return fail(422,"PROFILE_INCOMPLETE","The sealed registration number could not be read."); }
      const l = current.legal;
      const inquiry = await twilioJsonRequest<Record<string, unknown>>(ctx.creds,"https://trusthub.twilio.com/v1/A2PBrandRegistrations","POST",{
        brandType:"STANDARD", customerProfileId:reusableProfile, friendlyName:text(current.tenant.name).slice(0,255), notificationEmail:text(l.authorized_representative_email),
        businessName:text(l.legal_business_name), businessRegistrationAuthority:text(l.business_registration_identifier), businessRegistrationNumber:text(secret.data),
        businessIndustry:twilioIndustry(l.business_industry), businessWebsite:text(l.website_url), businessType:twilioBusinessType(l.entity_type),
        businessStreetAddress:text(l.registered_street), businessStreetAddress2:text(l.registered_street_secondary)||undefined,
        businessCity:text(l.registered_city), businessStateProvinceRegion:text(l.registered_region), businessPostalCode:text(l.registered_postal_code), businessCountry:text(l.registered_iso_country),
        businessContactFirstName:text(l.authorized_representative_first_name), businessContactLastName:text(l.authorized_representative_last_name),
        businessContactEmail:text(l.authorized_representative_email), businessContactPhone:text(l.authorized_representative_phone),
        authorizedContactVerificationEmail:text(l.authorized_representative_email), authorizedContactMobilePhoneNumberE164:text(l.authorized_representative_phone), isTest:false,
      });
      if (!inquiry.ok || !inquiry.data) { const reason=safeFailure(inquiry.error); await finish(ctx,key,{submission_phase:"failed",provider_failure_code:`TWILIO_${inquiry.status}`,provider_failure_reason:reason},"a2p.brand.failed"); return fail(inquiry.status===403?422:502,"TWILIO_REJECTED_REQUEST",reason||"Twilio could not start the registration."); }
      const inquiryId=text(inquiry.data.id); const bundle=inquiryId.split(".registration.")[1]||"";
      await finish(ctx,key,{brand_inquiry_id:inquiryId,brand_bundle_sid:bundle,trust_product_sid:bundle,selected_phone_number_id:number.id,submission_phase:"brand_draft",brand_status:"pending"},"a2p.brand.started");
      return ok({ kind:"brand", inquiry_id:inquiryId, inquiry_session_token:text(inquiry.data.sessionToken) });
    }

    if (action === "resume_brand") {
      const id=text(current.registration.brand_inquiry_id);
      if (!id) return fail(422,"BRAND_NOT_STARTED","Start the brand registration first.");
      const session=await twilioJsonRequest<Record<string,unknown>>(ctx.creds,`https://trusthub.twilio.com/v1/A2PBrandRegistrations/${encodeURIComponent(id)}/EmbeddedSessions`,"POST",{});
      if (!session.ok||!session.data) return fail(502,"TWILIO_SESSION_FAILED",safeFailure(session.error)||"Twilio could not resume the brand registration.");
      return ok({kind:"brand",inquiry_id:text(session.data.id)||id,inquiry_session_token:text(session.data.sessionToken)});
    }

    if (action === "start_campaign" || action === "resume_campaign") {
      if (providerStatus(current.registration.brand_status)!=="approved" || !/^BN[0-9a-f]{32}$/i.test(text(current.registration.brand_sid))) return fail(422,"BRAND_NOT_APPROVED","The brand must be approved before campaign registration starts.");
      if (action === "resume_campaign") {
        const target=text(current.registration.campaign_inquiry_id)||text(current.registration.messaging_service_sid);
        if (!target) return fail(422,"CAMPAIGN_NOT_STARTED","Start the campaign registration first.");
        const session=await twilioJsonRequest<Record<string,unknown>>(ctx.creds,`https://trusthub.twilio.com/v1/A2PCampaignRegistrations/${encodeURIComponent(target)}/EmbeddedSessions`,"POST",{});
        if (!session.ok||!session.data) return fail(502,"TWILIO_SESSION_FAILED",safeFailure(session.error)||"Twilio could not resume the campaign.");
        return ok({kind:"campaign",inquiry_id:text(session.data.id)||target,inquiry_session_token:text(session.data.sessionToken)});
      }
      const key=crypto.randomUUID();
      const {data:claim}=await ctx.admin.rpc("claim_tenant_a2p_operation",{_tenant_id:ctx.tenantId,_phase:"campaign_draft",_operation_key:key});
      if(!record(claim).claimed)return fail(409,"OPERATION_IN_PROGRESS","A registration request is already running. Refresh in a moment.");
      let serviceSid:string;
      try{serviceSid=await ensureService(ctx,current,number);}catch(error){const reason=safeFailure((error as Error).message);await finish(ctx,key,{submission_phase:"failed",number_association_status:"failed",provider_failure_code:"SERVICE_ASSOCIATION_FAILED",provider_failure_reason:reason},"a2p.campaign.failed");return fail(502,"SERVICE_ASSOCIATION_FAILED",reason);}
      let eventStream: Record<string, unknown>;
      try { eventStream = await ensureEventStream(ctx,current,key); }
      catch(error){const reason=safeFailure((error as Error).message);await finish(ctx,key,{messaging_service_sid:serviceSid,selected_phone_number_id:number.id,number_association_status:"associated",submission_phase:"failed",provider_failure_code:"EVENT_STREAM_FAILED",provider_failure_reason:reason},"a2p.campaign.failed");return fail(502,"EVENT_STREAM_FAILED",reason);}
      const r=current.registration; const samples=Array.isArray(r.sample_messages)?r.sample_messages.map(text).filter(Boolean).slice(0,5):[];
      const payload:Record<string,unknown>={a2pBrandRegistrationSid:text(r.brand_sid),messagingServiceSid:serviceSid,
        useCaseDescription:text(r.campaign_description),useCaseCategories:Array.isArray(r.message_categories)&&r.message_categories.length?r.message_categories:undefined,
        useCaseOptInDescription:text(r.optin_flow),useCaseOptInTypes:Array.isArray(r.opt_in_types)&&r.opt_in_types.length?r.opt_in_types:undefined,
        hasEmbeddedLinks:Boolean(r.has_embedded_links),hasEmbeddedPhone:Boolean(r.has_embedded_phone),directLending:Boolean(r.direct_lending),ageGated:Boolean(r.age_gated),
        privacyPolicyUrl:text(r.privacy_policy_url)||undefined,termsAndConditionsUrl:text(r.terms_and_conditions_url)||undefined,
        optInKeywords:["START"],optOutKeywords:["STOP","UNSUBSCRIBE","CANCEL","END","QUIT"],helpKeywords:["HELP"],
        optInMessageSample:text(r.optin_message)||undefined,optOutMessageSample:text(r.optout_message)||undefined,helpMessageSample:text(r.help_message)||undefined};
      samples.forEach((sample,index)=>payload[`useCaseSampleMessage${index+1}`]=sample);
      const inquiry=await twilioJsonRequest<Record<string,unknown>>(ctx.creds,"https://trusthub.twilio.com/v1/A2PCampaignRegistrations","POST",payload);
      if(!inquiry.ok||!inquiry.data){const reason=safeFailure(inquiry.error);await finish(ctx,key,{...eventStream,messaging_service_sid:serviceSid,selected_phone_number_id:number.id,number_association_status:"associated",submission_phase:"failed",provider_failure_code:`TWILIO_${inquiry.status}`,provider_failure_reason:reason},"a2p.campaign.failed");return fail(502,"TWILIO_REJECTED_REQUEST",reason||"Twilio could not start the campaign.");}
      const inquiryId=text(inquiry.data.id);const bundle=inquiryId.split(".registration.")[1]||"";
      await finish(ctx,key,{...eventStream,messaging_service_sid:serviceSid,selected_phone_number_id:number.id,number_association_status:"associated",number_registration_status:"not_started",campaign_inquiry_id:inquiryId,campaign_bundle_sid:bundle,submission_phase:"campaign_draft",campaign_status:"pending"},"a2p.campaign.started");
      return ok({kind:"campaign",inquiry_id:inquiryId,inquiry_session_token:text(inquiry.data.sessionToken)});
    }
    return fail(400,"UNKNOWN_ACTION","That registration action is not supported.");
  } catch (error) {
    console.error("comms-a2p-register failed", action, (error as Error).message);
    return fail(500,"INTERNAL","The registration request could not be completed.");
  }
});
