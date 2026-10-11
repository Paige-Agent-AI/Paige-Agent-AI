// SendGrid Event Webhook receiver — ANT-43/S7 slice 2, corrected per ANT-148.
//
// PUBLIC by necessity (SendGrid calls with no bearer token); the ES256
// signature IS the authentication. Per the official protocol the signed
// content is timestamp + raw body (both headers verified by the canonical
// shared verifier); a request that cannot be verified because the public key
// is unset is rejected too — never accepted "for now".
//
// ACKNOWLEDGMENT CONTRACT (ANT-148 P1-2): HTTP 200 is returned ONLY when every
// recognized event is durably committed (journal state 'processed'), already
// committed ('duplicate' — identical redelivery), or ignored BY MAPPING (no
// canonical state exists). Any RPC error, thrown call, or 'pending' result is
// an unpersisted event -> HTTP 503 so SendGrid retries the batch; the journal's
// identity-keyed dedup makes whole-batch redelivery safe (proven in SQL).
// Batches over 1000 events are refused 413 (retriable after splitting).
//
// EVENT IDENTITY (ANT-148): `sg:<message>:<kind>:<timestamp>:<batch-index>` —
// identical redeliveries replay the identical array and therefore collide into
// the SAME journal identity (dedup); two legitimate same-second events in one
// batch keep distinct identities via the array index.
//
// Event vocabulary (truthful; unknown events acked, never guessed):
//   delivered->delivered, deferred->delivery_delayed, open->opened,
//   click->clicked, bounce->bounced, spamreport->complained, dropped->dropped.
// 'processed' is unmapped (the send path's own 'sent' row already records the
// handoff; appending would collide with the partial unique index).
// 'unsubscribe' is acknowledged and NOT recorded: no canonical unsubscribed
// receipt status exists, and suppression/complaint propagation (the resend
// path writes paige_suppressions from resolved campaign context) is an
// EXPLICIT deferred decision until tenant SendGrid routing exists — recorded
// here so nothing silently claims complaint handling.
// 202-vs-delivered honesty: a receipt here is a PROVIDER-REPORTED outcome; the
// send path's 202 never meant recipient delivery — only a 'delivered' event does.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySendgridEvent } from "../_shared/webhookSig.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-twilio-email-webhook-signature, x-twilio-email-webhook-event-timestamp",
};
const STATUS_MAP: Record<string, string> = {
  delivered: "delivered",
  deferred: "delivery_delayed",
  open: "opened",
  click: "clicked",
  bounce: "bounced",
  spamreport: "complained",
  dropped: "dropped",
};
const MAX_BATCH = 1000;

async function readBody(req: Request): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) { await reader.cancel(); throw new Error("body_limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const publicKey = Deno.env.get("SENDGRID_WEBHOOK_PUBLIC_KEY");
  if (!publicKey) {
    console.error("[handle-sendgrid-webhook] not_configured (SENDGRID_WEBHOOK_PUBLIC_KEY)");
    return new Response("webhook_not_configured", { status: 503 });
  }
  let body: string;
  try { body = await readBody(req); } catch { return new Response("invalid_request", { status: 400 }); }

  // ANT-148 P1-1: the timestamp header is part of the signed content.
  const verdict = await verifySendgridEvent({
    publicKeyPem: publicKey,
    signatureB64: req.headers.get("x-twilio-email-webhook-signature"),
    timestamp: req.headers.get("x-twilio-email-webhook-event-timestamp"),
    body,
  });
  if (!verdict.ok) {
    console.warn("[handle-sendgrid-webhook] rejected", verdict.reason);
    return new Response("invalid_signature", { status: 401 });
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return new Response("invalid_json", { status: 400 }); }
  const events: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (events.length > MAX_BATCH) {
    console.warn("[handle-sendgrid-webhook] batch_over_limit", events.length);
    return new Response("batch_too_large", { status: 413 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const results: Record<string, number> = {};
  let durable = true; // flips false on any unpersisted recognized event
  for (let i = 0; i < events.length; i++) {
    const raw = events[i];
    if (!raw || typeof raw !== "object") { results.ignored = (results.ignored ?? 0) + 1; continue; }
    const evt = raw as Record<string, unknown>;
    const kind = typeof evt.event === "string" ? evt.event : "";
    const status = STATUS_MAP[kind];
    if (!status) { results.ignored = (results.ignored ?? 0) + 1; continue; }
    // First dot-segment = the send-time X-Message-Id.
    const sgMessageId = typeof evt.sg_message_id === "string" ? evt.sg_message_id.split(".")[0] : "";
    if (!sgMessageId) { results.ignored = (results.ignored ?? 0) + 1; continue; }
    const timestamp = typeof evt.timestamp === "number" ? new Date(evt.timestamp * 1000).toISOString() : null;
    const email = typeof evt.email === "string" ? evt.email : null;
    const receiptId = `sg:${sgMessageId}:${kind}:${evt.timestamp ?? "nts"}:${i}`;
    try {
      const { data, error } = await admin.rpc("ingest_sendgrid_receipt", {
        _receipt_id: receiptId, _message_id: sgMessageId, _status: status, _email: email, _event_at: timestamp,
      });
      if (error) {
        // NOT persisted: retriable failure for the whole batch.
        console.error("[handle-sendgrid-webhook] rpc_error", JSON.stringify(error).slice(0, 200));
        durable = false; results.rpc_error = (results.rpc_error ?? 0) + 1; continue;
      }
      const state = typeof data === "string" ? data : "unknown";
      results[state] = (results[state] ?? 0) + 1;
      if (state !== "processed" && state !== "duplicate" && state !== "invalid") {
        // 'pending' = the RPC's outer failure path (journal rolled back);
        // anything unknown is equally not proven durable. Never acknowledge.
        durable = false;
      }
    } catch (e) {
      console.error("[handle-sendgrid-webhook] rpc_exception", (e as Error)?.message);
      durable = false; results.rpc_error = (results.rpc_error ?? 0) + 1;
    }
  }
  if (!durable) {
    // 503: SendGrid retries the batch; committed events dedup on identity.
    return new Response(JSON.stringify({ ok: false, retriable: true, ...results }), {
      status: 503, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return Response.json({ ok: true, ...results }, { headers: cors });
});
