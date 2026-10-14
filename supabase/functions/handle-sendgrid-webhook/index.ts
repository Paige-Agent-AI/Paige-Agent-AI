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
// EVENT IDENTITY (ANT-78): `sg:<sg_event_id>` — the provider's own unique
// event identifier, stable across redeliveries regardless of batch composition
// or ordering, so dedup never depends on array position; distinct events never
// collide. Missing/malformed ids follow the quarantine policy below.
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
//
// GOVERNED MESSAGE (Experience 03, migration 20271031000200): the same RPC now also
// moves the governed email the event is about — only when it CORRELATES (sg_message_id
// prefix = the stored provider id of a provider-accepted SendGrid binding, and ALL THREE
// custom_args claims send-message sets — paige_tenant_id / paige_operation_id /
// paige_message_id — match; an absent claim is a non-match). A send whose outcome the
// door could not read (no stored id) is settled only when all three claims AND the
// event's recipient match it exactly. An event for a send that is still being handed
// over comes back 'pending', which this door answers 503 so SendGrid redelivers it
// (bounded in SQL). A claim that does not match changes nothing and is journalled
// 'uncorrelated'. This door only
// READS what the event says and passes it through; every decision (mapping, ordering,
// never-backwards, idempotency) is made once, in SQL. A bounce's `type` ('bounce' |
// 'blocked') is passed so a blocked bounce is recorded as blocked, not as a generic
// bounce; the provider's reason (`reason`, or a deferral's `response`) is passed
// capped, and the database strips addresses from it before keeping it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySendgridEvent } from "../_shared/webhookSig.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-twilio-email-event-webhook-signature, x-twilio-email-event-webhook-timestamp",
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
const MAX_REASON = 1000;

/** A custom_args claim as the event carried it: absent -> null; present -> its text, so a
 *  malformed value reaches the database as a claim that fails correlation (never silently dropped). */
export function claimOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value) ?? "";
  return text.slice(0, 200);
}

/** What the event says about WHY, for the outcomes that carry a reason. */
export function receiptDetail(kind: string, evt: Record<string, unknown>): { bounceType: string | null; reason: string | null } {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.slice(0, MAX_REASON) : null);
  if (kind === "bounce") return { bounceType: text(evt.type)?.slice(0, 32) ?? null, reason: text(evt.reason) };
  if (kind === "dropped") return { bounceType: null, reason: text(evt.reason) };
  if (kind === "deferred") return { bounceType: null, reason: text(evt.response) ?? text(evt.reason) };
  return { bounceType: null, reason: null };
}

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
    signatureB64: req.headers.get("x-twilio-email-event-webhook-signature"),
    timestamp: req.headers.get("x-twilio-email-event-webhook-timestamp"),
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
    // ANT-78 P2: the PROVIDER'S unique event identifier is the stable receipt
    // identity — sg_event_id is stable across redeliveries regardless of batch
    // composition or ordering, so dedup no longer depends on array position.
    const sgEventId = typeof evt.sg_event_id === "string" ? evt.sg_event_id.trim() : "";
    // First dot-segment = the send-time X-Message-Id.
    const sgMessageId = typeof evt.sg_message_id === "string" ? evt.sg_message_id.split(".")[0] : "";
    const timestamp = typeof evt.timestamp === "number" ? new Date(evt.timestamp * 1000).toISOString() : null;
    const email = typeof evt.email === "string" ? evt.email : null;
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(sgEventId) || !sgMessageId) {
      // QUARANTINE POLICY (explicit, auditable, never silent): a recognized
      // event without a usable provider event id or message id is NOT
      // acknowledged as accounted-for and NOT silently ignored — it fails the
      // batch retriable (503) with a loud log so SendGrid redelivers and the
      // trail exists in both provider logs and ours. Deterministic-garbage
      // retries expire on the provider's 24h window rather than being
      // misrepresented as processed.
      console.error(
        "[handle-sendgrid-webhook] quarantined_event",
        JSON.stringify({ kind, hasEventId: !!sgEventId, hasMessageId: !!sgMessageId, timestamp }).slice(0, 200),
      );
      durable = false;
      results.quarantined = (results.quarantined ?? 0) + 1;
      continue;
    }
    const receiptId = `sg:${sgEventId}`;
    try {
      const detail = receiptDetail(kind, evt);
      const { data, error } = await admin.rpc("ingest_sendgrid_receipt", {
        _receipt_id: receiptId, _message_id: sgMessageId, _status: status, _email: email, _event_at: timestamp,
        _tenant_id: claimOf(evt.paige_tenant_id), _operation_id: claimOf(evt.paige_operation_id),
        _paige_message_id: claimOf(evt.paige_message_id),
        _bounce_type: detail.bounceType, _reason: detail.reason,
      });
      if (error) {
        // NOT persisted: retriable failure for the whole batch.
        console.error("[handle-sendgrid-webhook] rpc_error", JSON.stringify(error).slice(0, 200));
        durable = false; results.rpc_error = (results.rpc_error ?? 0) + 1; continue;
      }
      const state = typeof data === "string" ? data : "unknown";
      results[state] = (results[state] ?? 0) + 1;
      if (state === "invalid") {
        // Deterministic rejection (retrying cannot fix it) — ack, but LOUDLY:
        // a silent invalid drops a verified event invisibly.
        console.warn("[handle-sendgrid-webhook] rpc_invalid", JSON.stringify({ receiptId, status }).slice(0, 200));
      }
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
