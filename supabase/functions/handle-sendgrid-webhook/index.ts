// SendGrid Event Webhook receiver — ANT-43/S7 slice 2.
//
// PUBLIC by necessity (SendGrid calls with no bearer token); the ES256
// signature IS the authentication. A request that cannot be verified because
// the public key is unset is rejected too — never accepted "for now".
// Verification is the canonical shared verifier (_shared/webhookSig.ts,
// verifySendgridEvent) — the same crypto home as the Svix doors.
//
// Event vocabulary (mapped truthfully onto email_send_log statuses; unknown
// events are acknowledged and ignored, never guessed at):
//   delivered→delivered, deferred→delivery_delayed,
//   open→opened, click→clicked, bounce→bounced, spamreport→complained,
//   dropped→dropped. 'unsubscribe' and anything unknown: ack, no row.
// 202-vs-delivered honesty: a receipt here is a PROVIDER-REPORTED outcome.
// The send path's "sent" (SendGrid 202 Accepted) never meant recipient
// delivery; only a 'delivered' event does.
//
// Replay/duplicate protection: the journal (sendgrid_receipt_processing) keys
// each event identity (sg_message_id + event + timestamp digest); a redelivered
// identical event returns 'duplicate' and writes nothing.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySendgridEvent } from "../_shared/webhookSig.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-twilio-email-event-webhook-signature",
};
// 'processed' is deliberately NOT mapped: the send path already recorded the
// handoff (its own 'sent' row under the partial unique index); appending again
// would collide — ack, no row (the resend mirror does the same).
const STATUS_MAP: Record<string, string> = {
  delivered: "delivered",
  deferred: "delivery_delayed",
  open: "opened",
  click: "clicked",
  bounce: "bounced",
  spamreport: "complained",
  dropped: "dropped",
};
// Same bounded body contract as the Svix doors (256 KiB, fatal UTF-8).
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

  const verdict = await verifySendgridEvent({
    publicKeyPem: publicKey,
    signatureB64: req.headers.get("x-twilio-email-event-webhook-signature"),
    body,
  });
  if (!verdict.ok) {
    console.warn("[handle-sendgrid-webhook] rejected", verdict.reason);
    return new Response("invalid_signature", { status: 401 });
  }

  let events: unknown;
  try { events = JSON.parse(body); } catch { return new Response("invalid_json", { status: 400 }); }
  const eventList: unknown[] = Array.isArray(events) ? events : [events];

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const results: Record<string, number> = {};
  for (const raw of eventList.slice(0, 1000)) {
    if (!raw || typeof raw !== "object") continue;
    const evt = raw as Record<string, unknown>;
    const kind = typeof evt.event === "string" ? evt.event : "";
    const status = STATUS_MAP[kind];
    if (!status) { results.ignored = (results.ignored ?? 0) + 1; continue; } // ack, never guess
    // Correlation: the event's sg_message_id is "<X-Message-Id>.<n>.filterdrecv-...";
    // the FIRST DOT-SEGMENT is the send-time X-Message-Id the send path recorded.
    const sgMessageId = typeof evt.sg_message_id === "string" ? evt.sg_message_id.split(".")[0] : "";
    if (!sgMessageId) { results.ignored = (results.ignored ?? 0) + 1; continue; }
    const timestamp = typeof evt.timestamp === "number" ? new Date(evt.timestamp * 1000).toISOString() : null;
    const email = typeof evt.email === "string" ? evt.email : null;
    // Stable identity per event: a provider redelivery carries the same fields,
    // so the digest dedups on the journal's primary key.
    const receiptId = `sg:${sgMessageId}:${kind}:${timestamp ?? "nts"}`;
    try {
      const { data } = await admin.rpc("ingest_sendgrid_receipt", {
        _receipt_id: receiptId, _message_id: sgMessageId, _status: status, _email: email, _event_at: timestamp,
      });
      const state = typeof data === "string" ? data : "unknown";
      results[state] = (results[state] ?? 0) + 1;
    } catch (e) {
      console.warn("[handle-sendgrid-webhook] ingest_deferred", (e as Error)?.message);
      results.deferred = (results.deferred ?? 0) + 1;
    }
  }
  // 200 always: the events were signature-verified and either journaled or
  // ignored-by-mapping; provider retries would only duplicate.
  return Response.json({ ok: true, ...results }, { headers: cors });
});
