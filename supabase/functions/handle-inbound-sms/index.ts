// Twilio inbound SMS webhook receiver — Paige OS Phase 1.
// Handles STOP/START/HELP keywords inline; otherwise inserts into paige_conversations
// and fires customer_support_intake to the MMA OS bridge so n8n CS Triage can draft a reply.
//
// Comms C-2s-C (compliance loop) EXTENDS this handler (§18 one home — this is the
// richer of the two STOP handlers, so the suppression WRITER lives here, not in a new fn):
//   • A STOP-class keyword (and a conservative NL opt-out) now writes a tenant-scoped
//     paige_suppressions row (channel=sms, reason=user_stop, source=inbound_message) +
//     appends a paige_consent_events (revoked) — the WRITERS behind the pre-send gate's
//     READ (runPreSend step 2/3). The legacy communication_preferences flag write is
//     KEPT for back-compat (§37 no producer regression) — the new writes are ADDED.
//   • A START-class keyword LIFTS: deletes the matching paige_suppressions row + appends
//     a paige_consent_events (granted).
//   • §9 CRITICAL FIX: the tenant is derived from the RECEIVING tenant_phone_numbers row
//     (the To/receiving number), NOT from an unscoped clients.phone lookup — a shared or
//     reused number must never resolve a contact belonging to another tenant. The contact
//     lookup is then SCOPED to that resolved tenant.
import { authenticateTwilioWebhook, inboundSecretForNumber, type WebhookAuthOutcome } from "../_shared/twilio-webhook-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
// Reuse the ONE canonical phone normalizer (§18) — the same helper the pre-send READER
// uses to compute address_normalized, so the WRITER stores a key the reader will match.
// (pre-send-pipeline.ts's only heavy imports are `import type`, erased at runtime — cheap.)
import { normalizePhone } from "../_shared/pre-send-pipeline.ts";
import { findClientIdByAddress } from "../_shared/contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_KEYWORDS = ["START", "YES", "UNSTOP"];

// ─────────────────────────────────────────────────────────────────────────────
// Conservative natural-language opt-out classifier.
//
// PRECISION TRADEOFF (documented, deliberate): a false positive here would wrongly
// and (until a START) permanently suppress a REAL client, so this is tuned for
// PRECISION over recall. Every pattern requires an EXPLICIT messaging-scoped
// stop/remove intent — a bare "stop", "cancel", or "end" is NOT matched here
// (those are handled only by the exact-keyword lists above, where Twilio's own
// Advanced Opt-Out also participates). When NO pattern matches, we DO NOT suppress;
// we fall through to the normal conversation path. This is a purely DETERMINISTIC
// phrase matcher — NOT a model call — so it can never hallucinate an opt-out (§13).
// Recall is intentionally sacrificed: an ambiguous message ("this is too much",
// "I'm busy") is left to a human via the normal CS-intake flow rather than risk a
// wrongful suppression.
// ─────────────────────────────────────────────────────────────────────────────
const NL_OPT_OUT_PATTERNS: RegExp[] = [
  // "stop texting me", "stop messaging", "stop sending me texts", "stop the texts"
  /\bstop\s+(texting|messaging|contacting|emailing|sending|the\s+texts?|these\s+texts?|all\s+texts?|texts?|messages?)\b/,
  // "quit texting me", "cease messaging"
  /\b(quit|cease)\s+(texting|messaging|contacting|emailing)\b/,
  // "don't text me", "do not message me", "never text me", "no more texting"
  /\b(don'?t|do\s?not|never|no\s+more|please\s+no\s+more)\s+(text|texting|message|messaging|contact|contacting|email|emailing)\b/,
  // "no more texts", "no more messages", "no more emails"
  /\bno\s+more\s+(texts?|messages?|emails?)\b/,
  // "remove me from your list", "remove me off" — but NOT "take me from" (e.g.
  // "take me from the airport at 5" is a real client request, not an opt-out — verifier F4).
  // "take me off …" intent is covered by the dedicated pattern below.
  /\bremove\s+me\s+(off|from)\b/,
  /\btake\s+me\s+off\s+(your|the|this)\b/,
  // "opt out", "opt-out", "opted out", "opt me out"
  /\bopt(ed)?\s*[-\s]?\s*out\b/,
  /\bopt\s+me\s+out\b/,
  // "please unsubscribe me", "unsubscribe me from this" (bare "unsubscribe" is an exact keyword)
  /\bunsubscribe\s+me\b/,
  // strong, unambiguous stop signal in an SMS context
  /\bleave\s+me\s+alone\b/,
];

function isNlOptOut(body: string): boolean {
  const t = (body ?? "").toLowerCase();
  return NL_OPT_OUT_PATTERNS.some((re) => re.test(t));
}

function twiml(message?: string): Response {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  return new Response(xml, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } });
}

/**
 * FAIL CLOSED. The previous implementation returned `true` when
 * TWILIO_AUTH_TOKEN was unset — and this deployment deliberately does not set
 * one (`_shared/twilio.ts:222-234`), so every unsigned POST was accepted and
 * could write to any tenant's suppression and consent ledger by naming that
 * tenant's number in `To`. Authentication now delegates to the one shared home,
 * which accepts a valid signature or the per-tenant stamped secret and refuses
 * anything else.
 */
async function verifyTwilio(
  req: Request,
  rawBody: string,
  admin: Admin,
  toPhone: string,
): Promise<WebhookAuthOutcome> {
  const expectedSecret = toPhone
    ? await inboundSecretForNumber(admin, normalizePhone(toPhone))
    : null;
  return await authenticateTwilioWebhook(req, rawBody, { expectedSecret });
}

// deno-lint-ignore no-explicit-any
type Admin = any;

// -----------------------------------------------------------------------------
// §9 — resolve the tenant that OWNS the receiving number (the Twilio `To`). This
// is the authoritative tenant for the opt-out: the sender texted THIS tenant's
// number, so the suppression belongs to THIS tenant. We do NOT infer the tenant
// from the sender's phone (a number could be reused across tenants). Returns null
// when the To matches no tenant number (e.g. the +1 470 platform/super-admin
// number, which has no tenant_id) — in which case we honestly SKIP the tenant
// suppression write (§13) rather than attribute it to the wrong tenant.
// -----------------------------------------------------------------------------
async function resolveReceivingTenant(admin: Admin, toPhone: string): Promise<string | null> {
  if (!toPhone) return null;
  const norm = normalizePhone(toPhone);
  const { data, error } = await admin
    .from("tenant_phone_numbers")
    .select("tenant_id")
    .eq("phone_number", norm)
    .maybeSingle();
  if (error) {
    console.error("[handle-inbound-sms] receiving-tenant lookup failed:", error.code, error.message);
    return null;
  }
  return (data?.tenant_id as string | undefined) ?? null;
}

// Contact lookup SCOPED to the resolved receiving tenant (§9): the contact holding the
// sender's number as ANY of its phone numbers, matched on the last ten digits, so stored-format
// drift cannot hide it. null when no contact belongs to this tenant — the suppression is then
// written contactless (by address).
async function resolveContactForTenant(
  admin: Admin,
  tenantId: string,
  fromPhoneRaw: string,
  normalizedFrom: string,
): Promise<string | null> {
  return await findClientIdByAddress(admin, tenantId, "phone", normalizedFrom || fromPhoneRaw, "handle-inbound-sms");
}

// Legacy back-compat: flip the user-keyed communication_preferences.sms_enabled flag.
// KEPT (§37) — the C-2 pre-send gate never reads this, but other legacy paths may, so
// we do NOT remove it; we ADD the tenant-scoped paige_suppressions write alongside it.
async function legacyToggleSms(admin: Admin, fromPhone: string, enabled: boolean): Promise<void> {
  try {
    const { data: prefs } = await admin
      .from("communication_preferences")
      .select("user_id")
      .eq("sms_phone_number", fromPhone)
      .maybeSingle();
    if (prefs?.user_id) {
      await admin.from("communication_preferences")
        .update({ sms_enabled: enabled }).eq("user_id", prefs.user_id);
    }
  } catch (e) {
    console.warn("[handle-inbound-sms] legacy communication_preferences toggle skipped:", (e as Error)?.message);
  }
}

// -----------------------------------------------------------------------------
// STOP / NL opt-out WRITER — the C-2 compliance write behind the pre-send gate.
// Writes a tenant-scoped paige_suppressions row (channel=sms, reason=user_stop,
// source=inbound_message) + appends a paige_consent_events (revoked). Wrapped so a
// write fault NEVER breaks the Twilio 200 response (§13 — degrade loudly, log).
//
// UPSERT / repeat-STOP safety (§37): the suppression unique index is over the
// EXPRESSION (tenant_id, channel, coalesce(contact_id::text, address_normalized)),
// which PostgREST on_conflict cannot target by name. So we get on-conflict-do-nothing
// semantics by treating a 23505 unique violation as SUCCESS (already suppressed) —
// a repeat STOP therefore never throws and never duplicates a row.
//
// §9 tenant on the service-role path: we set tenant_id EXPLICITLY to the receiving
// tenant. The BEFORE-INSERT trigger set_contact_scoped_tenant() derives the tenant
// from the contact parent when contact_id is present (which, being tenant-scoped
// above, equals the same tenant); for a CONTACTLESS opt-out on the service-role path
// the trigger's current fallback is current_user_tenant_id() (null for service_role),
// so the explicit tenant_id is what a contactless write depends on — see the §9/§13
// caveat in the slice report.
// -----------------------------------------------------------------------------
async function recordSmsOptOut(
  admin: Admin,
  tenantId: string | null,
  fromPhone: string,
  evidenceRef: string,
): Promise<void> {
  if (!tenantId) {
    console.warn(
      "[handle-inbound-sms] opt-out: To number resolved to NO tenant — tenant suppression NOT written (§13 honest skip; legacy flag still handled by caller)",
    );
    return;
  }
  const normalizedFrom = normalizePhone(fromPhone);
  try {
    const contactId = await resolveContactForTenant(admin, tenantId, fromPhone, normalizedFrom);

    // 1) Suppression row (upsert / on-conflict-do-nothing via 23505-as-success).
    const { error: supErr } = await admin.from("paige_suppressions").insert({
      tenant_id: tenantId,              // explicit resolved tenant (§9 service-role/webhook path)
      contact_id: contactId,            // nullable — contactless STOP still recorded by address
      address_normalized: normalizedFrom,
      channel: "sms",
      reason: "user_stop",
      source: "inbound_message",
    });
    if (supErr && supErr.code !== "23505") {
      console.error("[handle-inbound-sms] suppression insert failed:", supErr.code, supErr.message);
    }

    // 2) Consent revoke (append-only; a revocation is a NEW row, never an edit).
    //    evidence_ref = the inbound Twilio MessageSid — REAL opt-out proof (§13).
    const { error: consErr } = await admin.from("paige_consent_events").insert({
      tenant_id: tenantId,
      contact_id: contactId,
      address_normalized: normalizedFrom,
      channel: "sms",
      action: "revoked",
      source: "inbound_message",
      evidence_ref: evidenceRef,
    });
    if (consErr) {
      console.error("[handle-inbound-sms] consent revoke insert failed:", consErr.code, consErr.message);
    }
  } catch (e) {
    console.error("[handle-inbound-sms] recordSmsOptOut fault (degrading, twiml still 200):", (e as Error)?.message);
  }
}

// -----------------------------------------------------------------------------
// START opt-in WRITER — LIFT the suppression + append a granted consent event.
// Lifting a suppression = DELETE the row (per the table's design). Wrapped so a
// write fault never breaks the Twilio 200 response.
// -----------------------------------------------------------------------------
async function recordSmsOptIn(
  admin: Admin,
  tenantId: string | null,
  fromPhone: string,
  evidenceRef: string,
): Promise<void> {
  if (!tenantId) {
    console.warn("[handle-inbound-sms] opt-in: To number resolved to NO tenant — suppression not lifted (§13 honest skip)");
    return;
  }
  const normalizedFrom = normalizePhone(fromPhone);
  try {
    const contactId = await resolveContactForTenant(admin, tenantId, fromPhone, normalizedFrom);

    // 1) LIFT: delete the sms suppression row(s) for this recipient on THIS tenant.
    let del = admin.from("paige_suppressions").delete().eq("tenant_id", tenantId).eq("channel", "sms");
    del = contactId
      ? del.or(`contact_id.eq.${contactId},address_normalized.eq.${normalizedFrom}`)
      : del.eq("address_normalized", normalizedFrom);
    const { error: delErr } = await del;
    if (delErr) {
      console.error("[handle-inbound-sms] suppression lift (delete) failed:", delErr.code, delErr.message);
    }

    // 2) Consent granted (append-only) — records the re-subscribe with real evidence.
    const { error: consErr } = await admin.from("paige_consent_events").insert({
      tenant_id: tenantId,
      contact_id: contactId,
      address_normalized: normalizedFrom,
      channel: "sms",
      action: "granted",
      source: "inbound_message",
      evidence_ref: evidenceRef,
    });
    if (consErr) {
      console.error("[handle-inbound-sms] consent grant insert failed:", consErr.code, consErr.message);
    }
  } catch (e) {
    console.error("[handle-inbound-sms] recordSmsOptIn fault (degrading, twiml still 200):", (e as Error)?.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const fromPhone = params.get("From") ?? "";
  const toPhone = params.get("To") ?? "";

  // Authenticate BEFORE any read or write. A refusal is logged loudly with its
  // reason — a silently-dropped callback is indistinguishable from one that
  // never arrived, which is how the fail-open branch stayed invisible.
  const auth = await verifyTwilio(req, rawBody, admin, toPhone);
  if (!auth.ok) {
    console.error(`[handle-inbound-sms] REFUSED unauthenticated callback: ${auth.reason}`);
    return new Response("unauthenticated", { status: 401 });
  }
  const messageSid = params.get("MessageSid") ?? crypto.randomUUID();
  const bodyRaw = (params.get("Body") ?? "").trim();
  const bodyUpper = bodyRaw.toUpperCase();

  // §9 — resolve the RECEIVING tenant from the To number ONCE; reused by every
  // compliance write below (STOP / START / NL opt-out).
  const receivingTenantId = await resolveReceivingTenant(admin, toPhone);

  // Keyword handling — preserve existing twilio-inbound-webhook behavior, and ADD
  // the tenant-scoped paige_suppressions / paige_consent_events writes (C-2s-C).
  if (STOP_KEYWORDS.includes(bodyUpper)) {
    await legacyToggleSms(admin, fromPhone, false);       // legacy back-compat (kept)
    await recordSmsOptOut(admin, receivingTenantId, fromPhone, messageSid); // C-2 suppression + revoke
    return twiml();
  }
  if (START_KEYWORDS.includes(bodyUpper)) {
    await legacyToggleSms(admin, fromPhone, true);        // legacy back-compat (kept)
    await recordSmsOptIn(admin, receivingTenantId, fromPhone, messageSid);  // C-2 lift + grant
    return twiml("You are re-subscribed to PaigeAgent SMS. Reply STOP to opt out.");
  }
  if (bodyUpper === "HELP" || bodyUpper === "INFO") {
    return twiml("PaigeAgent support: support@paigeagent.ai. Reply STOP to unsubscribe.");
  }

  // Conservative NL opt-out — runs AFTER the exact-keyword checks and BEFORE the
  // conversation insert. On a confident match, treat exactly like STOP (suppress +
  // revoke + legacy flag) and reply with the standard opt-out confirmation. On no
  // match, fall through to the normal conversation path — we NEVER suppress on doubt.
  if (isNlOptOut(bodyRaw)) {
    await legacyToggleSms(admin, fromPhone, false);
    await recordSmsOptOut(admin, receivingTenantId, fromPhone, messageSid);
    return twiml("You're unsubscribed and won't get more messages from us. Reply START to opt back in.");
  }

  // Look up the contact — SCOPED TO THE TENANT THAT OWNS THE RECEIVING NUMBER.
  //
  // Both lookups were previously unscoped, so a text arriving at tenant A's
  // number from a phone that also exists as a contact in tenant B was filed into
  // TENANT B's conversation and broadcast into tenant B's rail. The suppression
  // path above was scoped correctly; this one was missed, and the file header
  // claimed the fix covered both.
  //
  // When the receiving number belongs to no tenant we attribute NO contact
  // rather than guessing from the sender's number alone — an unattributed row is
  // honest, a misattributed one is a cross-tenant leak.
  let contactId: string | null = null;
  if (receivingTenantId) {
    const { data: prefs } = await admin
      .from("communication_preferences")
      .select("user_id")
      .eq("sms_phone_number", fromPhone)
      .maybeSingle();
    if (prefs?.user_id) {
      const { data: c } = await admin.from("clients").select("id")
        .eq("linked_user_id", prefs.user_id)
        .eq("tenant_id", receivingTenantId)
        .maybeSingle();
      contactId = c?.id ?? null;
    }
    if (!contactId) {
      contactId = await findClientIdByAddress(admin, receivingTenantId, "phone", fromPhone, "handle-inbound-sms");
    }
  }

  const { data: convo, error: insertErr } = await admin
    .from("paige_conversations")
    .insert({
      channel: "sms",
      // The tenant that owns the receiving number, resolved above and used for
      // every compliance write — and then, until now, omitted here. A NULL tenant
      // on this table is not merely unscoped: the restrictive RLS policy admitted
      // `tenant_id IS NULL`, so an untenanted row was readable AND writable by the
      // admin of every other tenant (C-7). Service-role bypasses RLS, so no policy
      // can put this right after the fact — it has to be correct at the write.
      tenant_id: receivingTenantId,
      contact_id: contactId,
      direction: "inbound",
      body: bodyRaw,
      source_message_id: messageSid,
      status: "new",
      metadata: { from: fromPhone, to: params.get("To") ?? null },
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") return twiml(); // already processed
    console.error("[handle-inbound-sms] insert_error", insertErr);
    return twiml();
  }

  fireAndForgetBridge("customer_support_intake", {
    conversation_id: convo.id,
    contact_phone: fromPhone,
    channel: "sms",
    body: bodyRaw,
  });

  // ── Paige Context Rail — COMMS emitter: file 'comms.inbound' when a real client
  // SMS arrives, so the OWNER rail AND the client's OWN live feed both reflect the
  // two-way conversation in real time (§7/§8). comms.inbound is a client_visible
  // kind, so record_rail_event correctly broadcasts it to both the client feed and
  // the owner rail. Telemetry ONLY (§13): the whole emit is wrapped so a rail
  // failure can NEVER affect the Twilio response or the real message handling. We
  // emit AFTER the conversation row was actually inserted (a real inbound), and
  // ONLY when the sender's contact resolved above (contactId) — no contact means we
  // SKIP rather than fabricate one (§13 truthful). We read the contact's tenant to
  // pass p_tenant_id explicitly, because inside record_rail_event this service-role
  // call has auth.uid() = NULL (trusted service path).
  if (contactId) {
    try {
      const { data: contactRow } = await admin
        .from("clients")
        .select("tenant_id")
        .eq("id", contactId)
        .maybeSingle();
      const tenantId = contactRow?.tenant_id ?? null;
      if (tenantId) {
        const preview = bodyRaw.length > 140 ? bodyRaw.slice(0, 137) + "…" : bodyRaw;
        await admin.rpc("record_rail_event", {
          p_contact_id: contactId,
          p_event_kind: "comms.inbound",
          p_surface: "client_portal",
          p_actor_type: "client",
          p_title: "Message received",
          p_summary: preview,
          p_ref_table: "paige_conversations",
          p_ref_id: convo.id,
          p_from_department: "client_experience",
          p_tenant_id: tenantId,
        });
      }
    } catch (e) {
      console.warn("[handle-inbound-sms] comms.inbound rail emit skipped:", (e as Error)?.message);
    }
  }

  return twiml();
});
