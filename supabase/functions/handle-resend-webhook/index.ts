// handle-resend-webhook — the listener that did not exist.
//
// WHY THIS IS NEW RATHER THAN AN EXTENSION. The platform already has ONE email-truth table
// (`public.email_send_log`) and one suppression receiver (`handle-email-suppression`) — but that
// receiver is Mailgun-shaped, arrives via the Go API, and is verified with the Lovable webhook
// helper. Resend signs with Svix and speaks a different event vocabulary, so its events need their
// own door. Source outcomes still append to the existing email_send_log. A private processing
// journal deduplicates signed receipt identities and retains early arrivals; it is not a second
// delivery history, tenant read surface, or notification store.
//
// A configured sender is not proof that receipt tracking is configured. Only verified provider
// events matched to the existing source can establish delivery facts. This handler changes no
// provider settings and does not replay or modify historical outcomes.
//
// SECURITY POSTURE. This endpoint is PUBLIC by necessity: Resend calls it with no bearer token, so
// `verify_jwt` must be off for it. The signature IS the authentication. An unsigned or badly signed
// request is rejected before a single row is written, and a request that cannot be verified because
// the secret is unset is rejected too — never accepted "for now".
import { createClient } from "npm:@supabase/supabase-js@2";
import { persistVerifiedReceipt, readReceiptBody } from "./handler.ts";
import { verifySvix } from "../_shared/webhookSig.ts";

// Env first, then the operator-manageable settings row (same precedence as
// handle-inbound-email — the gateway lacks Management-API secret routes).
let WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

// Resend's event names, mapped onto the statuses `email_send_log` now accepts. Anything not on this
// list is acknowledged and ignored rather than guessed at: an unrecognised event written as an
// invented status would fail the CHECK constraint and, worse, would make the log say something the
// provider never said.
const EVENT_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  // FAIL CLOSED. With no secret there is no way to tell Resend from anyone who found the URL, and
  // this endpoint writes to a table the product now reports from. Accepting unverified events would
  // let a stranger tell an owner their invitation had been opened.
  if (!WEBHOOK_SECRET) {
    const admin0 = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: row0 } = await admin0.from("admin_app_settings").select("value").eq("key", "resend_webhook_secret").maybeSingle();
    const v0 = (row0 as { value?: unknown } | null)?.value;
    if (typeof v0 === "string" && v0.startsWith("whsec_")) WEBHOOK_SECRET = v0;
  }
  if (!WEBHOOK_SECRET) {
    console.error("receipt_not_configured");
    return json({ ok: false, error: "webhook not configured" }, 503);
  }

  const id = req.headers.get("svix-id") ?? "";
  const timestamp = req.headers.get("svix-timestamp") ?? "";
  const signature = req.headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !signature) return json({ ok: false, error: "unsigned request" }, 401);
  let body: string;
  try { body = await readReceiptBody(req); }
  catch { return json({ ok: false, error: "invalid request" }, 400); }

  // Canonical Svix verification (shared with handle-inbound-email): constant-time
  // v1 comparison, header caps, and the five-minute replay window (Svix's own
  // recommendation — generous for a webhook, fatal to a captured-request replay).
  const verdict = await verifySvix({
    secrets: [WEBHOOK_SECRET],
    svixId: id,
    svixTimestamp: timestamp,
    svixSignature: signature,
    body,
    toleranceSeconds: 300,
  });
  if (!verdict.ok) {
    // Same three responses this door has always given; the reason is logged, not leaked.
    const message = verdict.reason === "missing_headers" ? "unsigned request"
      : verdict.reason === "header_too_large" ? "invalid request"
      : verdict.reason === "timestamp_malformed" || verdict.reason === "timestamp_out_of_tolerance"
        ? "stale or malformed timestamp"
      : "invalid signature";
    console.error("receipt_signature_rejected", verdict.reason);
    return json({ ok: false, error: message }, 401);
  }

  // INBOUND RELAY (#1089): Resend's inbound event is `email.received` — this catch-all
  // webhook carries it, and until now it was acknowledged-and-dropped here (the outbound
  // status map doesn't know it). Relay the VERIFIED request, headers and body untouched,
  // to the dedicated inbound handler: it re-verifies the same Svix signature against the
  // same shared secret, so the relay adds no trust — it only routes. Relay failures are
  // logged but never fail the outbound path; Resend retries the event either way.
  try {
    const parsed = JSON.parse(body) as { type?: string };
    if (parsed?.type === "email.received") {
      const inboundUrl = `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "")}/functions/v1/handle-inbound-email`;
      const relay = await fetch(inboundUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature,
        },
        body,
      });
      if (!relay.ok) console.error("inbound_relay_failed", relay.status);
      else console.info("inbound_relayed");
      // The relayed handler owns the inbound outcome; acknowledge to Resend here.
      return json({ ok: true, relayed: "inbound" });
    }
  } catch { /* non-JSON body falls through to the outbound receipt path */ }

  // Signature verified above. Persist only minimal allowlisted receipt fields;
  // source resolution, deduplication and pending reconciliation are atomic in SQL.
  return persistVerifiedReceipt(body, id, EVENT_STATUS, {
    log: category => console.info(category),
    ingest: async receipt => {
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceKey) return { data: null, error: true };
      const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      return await admin.rpc("ingest_resend_receipt", {
        _receipt_id: receipt.receiptId, _message_id: receipt.messageId,
        _status: receipt.status, _event_at: receipt.eventAt,
      });
    },
  });
});
