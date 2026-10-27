// Scheduled-send drainer (Comms C-1.5). Cron wakes this every minute; it CLAIMS due
// queued rows (claim_due_scheduled_messages, FOR UPDATE SKIP LOCKED + 5-min lease so two
// ticks never double-fire and a crashed drain self-heals) and RE-ENTERS send-message under
// the service role with message_id set + scheduled_for OMITTED — so the FULL pre-send
// pipeline (steps 1-5, C-2a) re-runs on release (SEND-MESSAGE-CONTRACT §4). A row that now
// hits quiet hours / DND simply re-queues; that is correct, not an error (§13).
//
// "Approve now, send later": a row carrying meta.comms_email_binding is a SCHEDULED GOVERNED EMAIL.
// It never takes the generic re-post below; releaseScheduledCommsEmail (_shared/comms-email/adapter.ts)
// re-proves it as the person who approved it and asks send-message to send exactly the bound row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { releaseScheduledCommsEmail, scheduledDrainRoute, type ScheduledReleaseDependencies } from "../_shared/comms-email/adapter.ts";
import { resolveCommsEmailParties, readCommsEmailReadiness, emailProvidersFor, type CommsEmailAdmin } from "../_shared/comms-email/readiness.ts";
import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
import { runPreSend } from "../_shared/pre-send-pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
// How long one run keeps taking rows. Cron fires every minute; one governed release may take ~25 s.
const DRAIN_BUDGET_MS = 40_000;
// The same bound the governed release puts on its send-message call.
const GENERIC_RELEASE_TIMEOUT_MS = 25_000;
// A governed email with files: send-message first reads and re-hashes up to 10 MiB of governed copies (in
// parallel) before its claim, so the release waits 40 s (the door's own wait with files). One such release
// can therefore run past DRAIN_BUDGET_MS, which is checked only before a row is taken; the run stays well
// inside the function's wall-clock limit.
const GOVERNED_RELEASE_TIMEOUT_MS = 25_000;
const GOVERNED_RELEASE_WITH_FILES_TIMEOUT_MS = 40_000;
// Governed email files no send will ever need (list_governed_comms_attachment_orphans) are removed once an
// hour — the run whose minute is this one — at most this many per run, and only with this much budget left.
const ORPHAN_SWEEP_MINUTE = 7;
const ORPHAN_SWEEP_LIMIT = 100;
const ORPHAN_SWEEP_MIN_BUDGET_MS = 5_000;
const COMMS_ATTACHMENTS_BUCKET = "comms-attachments";

// The release's database/network edges, bound to the service client. Every read is keyed by the
// binding's own tenant and scheduler; nothing is taken from the leased row beyond what the binding says.
const senderProviders = () => emailProvidersFor({ sendgridConfigured: !!Deno.env.get("SENDGRID_MAIL_SEND_API_KEY") });
const releaseDependencies: ScheduledReleaseDependencies = {
  now: () => Date.now(),
  providerExecutionAllowed: ({ tenantId, actorUserId }) => commsProviderExecutionAllowed(admin, { tenantId, actorUserId }),
  resolveParties: (input) => resolveCommsEmailParties(admin as unknown as CommsEmailAdmin, input, senderProviders()),
  readiness: ({ tenantId, actorUserId, parties }) => readCommsEmailReadiness(admin as unknown as CommsEmailAdmin,
    { tenantId, actorUserId, contactId: parties.contactId, recipient: parties.recipient, connectorId: parties.connectorId }, (key) => Deno.env.get(key), runPreSend),
  readBinding: async (messageId) => {
    const { data, error } = await admin.rpc("read_comms_email_send_binding", { _message_id: messageId });
    if (error) throw new Error(String(error.message ?? "comms_email_binding_unavailable"));
    return data;
  },
  send: async (payload, options) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), options?.withFiles ? GOVERNED_RELEASE_WITH_FILES_TIMEOUT_MS : GOVERNED_RELEASE_TIMEOUT_MS);
    try {
      const sent = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/send-message`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify(payload), signal: abort.signal,
      });
      const answer = await sent.json().catch(() => null) as Record<string, unknown> | null;
      const code = typeof answer?.code === "string" ? answer.code : typeof answer?.error === "string" ? answer.error : null;
      return { answered: sent.status < 500 && answer !== null, code };
    } finally { clearTimeout(timer); }
  },
  closeRefused: async ({ messageId, operationId, reason }) => {
    // No closing person: the Rail names the scheduler while they are still a member, else nobody (and
    // the audit row says why). It closes even when the scheduler has left the business.
    const { data, error } = await admin.rpc("close_scheduled_comms_email", { _message_id: messageId, _operation_id: operationId, _reason: reason, _closing_actor: null });
    return !error && (data as { closed?: unknown } | null)?.closed === true;
  },
  markSupportCase: async (messageId) => { await admin.rpc("mark_support_case_outbound", { _message_id: messageId }); },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

function json(status: number, b: unknown) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Internal-caller auth: a service-role bearer OR a valid x-cron-token (mirrors readiness-scan).
async function isAuthorizedInternalCaller(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer.length > 0 && bearer === SERVICE_ROLE_KEY) return true;
  const cronToken = req.headers.get("x-cron-token") ?? "";
  if (!cronToken) return false;
  const { data, error } = await admin.rpc("verify_cron_token", { _token: cronToken });
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!(await isAuthorizedInternalCaller(req))) return json(401, { error: "unauthorized" });

  const startedAt = Date.now();
  // Scheduled governed emails still waiting past their release grace are closed as missed (nothing went
  // out) instead of being leased again. Best-effort: a failure here never stops the drain itself.
  const { data: missed, error: missedErr } = await admin.rpc("close_missed_scheduled_comms_emails", { _limit: 50 });
  if (missedErr) console.warn("[comms-scheduled-drain] missed-release sweep failed", missedErr.message);

  // Atomic claim (FOR UPDATE SKIP LOCKED + lease marker) — returns due rows this tick owns.
  const { data: due, error: claimErr } = await admin.rpc("claim_due_scheduled_messages", { _limit: 50 });
  if (claimErr) return json(500, { error: "claim_failed", detail: claimErr.message });

  const rows = (due ?? []) as Array<{
    id: string; channel_type: string; recipients: { address?: string }[] | null;
    body_text: string | null; body_html: string | null; subject: string | null;
    contact_id: string | null; connector_id: string | null; thread_key: string | null;
    attachments: unknown[] | null; meta: Record<string, unknown> | null;
  }>;

  let released = 0, requeued = 0, failed = 0;
  // Scheduled governed emails, counted apart: released (the email service took it), refused (closed,
  // nothing went out), left (nothing written; the next lease decides).
  const governed = { released: 0, refused: 0, left: 0 };
  // Rows are released one at a time and a governed release can wait up to 25 s on send-message, so the
  // run stops TAKING new rows after its budget and hands the rest of the leases back: they are picked up
  // by the next minute's run instead of sitting leased for five minutes (and drifting past their grace).
  const unreached: string[] = [];
  for (const m of rows) {
    if (Date.now() - startedAt > DRAIN_BUDGET_MS) { unreached.push(m.id); continue; }
    if (scheduledDrainRoute(m) === "comms_email") {
      const r = await releaseScheduledCommsEmail(m.meta?.comms_email_binding, m.id, releaseDependencies);
      if (r.result === "released") governed.released++;
      else if (r.result === "refused") governed.refused++;
      else governed.left++;
      if (r.result === "left" || r.result === "invalid") console.warn("[comms-scheduled-drain] governed email left", m.id, r.result === "left" ? r.reason : "invalid_binding");
      continue;
    }
    const to = m.recipients?.[0]?.address ?? "";
    const bodyStr = m.channel_type === "email"
      ? (m.body_html ?? m.body_text ?? "")
      : (m.body_text ?? m.body_html ?? "");
    if (!to || !bodyStr) {
      // Unsendable row — mark failed so the queue surfaces it (§13), never silently drop.
      await admin.from("messages").update({ status: "failed", error: "drain_missing_recipient_or_body" }).eq("id", m.id);
      failed++;
      continue;
    }
    // Bounded like the governed release: an answer that never comes leaves the row to send-message's own
    // write (or the next lease), and the run moves on instead of hanging past its budget.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), GENERIC_RELEASE_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/send-message`, {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          channel: m.channel_type,
          to,
          subject: m.subject ?? undefined,
          body: bodyStr,
          contact_id: m.contact_id ?? undefined,
          thread_key: m.thread_key ?? undefined,
          connector_id: m.connector_id ?? undefined,
          message_id: m.id,          // patch THIS queued row (release)
          attachments: m.attachments ?? undefined,
          // scheduled_for OMITTED → send-message runs the full pipeline, no re-queue-for-schedule
        }),
      });
    } catch {
      console.warn("[comms-scheduled-drain] release did not answer in time", m.id);
      failed++;
      continue;
    } finally { clearTimeout(timer); }
    const r = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const outcome = String(r.outcome ?? r.status ?? "");
    if (outcome === "sent") released++;
    else if (outcome.startsWith("queued_")) requeued++;   // hit DND/quiet-hours on release — correct
    else failed++;
  }
  // Hand back only THIS run's leases: each row carries the drain_claimed_at stamp this run's claim wrote,
  // and the database frees a row only while that stamp is still on it (a row another run has re-leased
  // since is left alone, so it can never be released twice).
  const unreachedByStamp = new Map<string, string[]>();
  for (const m of rows) {
    if (!unreached.includes(m.id)) continue;
    const stamp = m.meta?.drain_claimed_at;
    if (typeof stamp !== "string" || !stamp) continue;
    unreachedByStamp.set(stamp, [...(unreachedByStamp.get(stamp) ?? []), m.id]);
  }
  for (const [stamp, ids] of unreachedByStamp) {
    const { error: unleaseErr } = await admin.rpc("unlease_scheduled_messages", { _ids: ids, _stamp: stamp });
    if (unleaseErr) console.warn("[comms-scheduled-drain] unlease failed; rows re-lease in 5 min", unleaseErr.message);
  }
  // Retention for governed email files: a copy no binding names (an approval that never prepared) after a
  // day, and the copies of a send that was refused or failed a week after it closed. A sent email's files
  // are kept as its record. Once an hour, bounded, inside this run's time budget; a failure only logs.
  let orphansRemoved = 0;
  // "Is this the hour's sweep run" is decided from when the run STARTED: a long run that ends in the next
  // minute must neither skip the hour's sweep nor run a second one.
  if (Math.floor(startedAt / 60_000) % 60 === ORPHAN_SWEEP_MINUTE && DRAIN_BUDGET_MS - (Date.now() - startedAt) > ORPHAN_SWEEP_MIN_BUDGET_MS) {
    try {
      const { data: orphans, error: orphanErr } = await admin.rpc("list_governed_comms_attachment_orphans", { _limit: ORPHAN_SWEEP_LIMIT });
      const paths = Array.isArray(orphans)
        ? (orphans as unknown[]).map((o) => typeof o === "string" ? o : (o as { name?: unknown } | null)?.name).filter((n): n is string => typeof n === "string" && n.split("/")[1] === "governed")
        : [];
      if (orphanErr) console.warn("[comms-scheduled-drain] governed file retention read failed", orphanErr.message);
      else if (paths.length) {
        const { data: removed, error: removeErr } = await admin.storage.from(COMMS_ATTACHMENTS_BUCKET).remove(paths);
        if (removeErr) console.warn("[comms-scheduled-drain] governed file retention remove failed", removeErr.message);
        else orphansRemoved = Array.isArray(removed) ? removed.length : 0;
      }
    } catch (e) { console.warn("[comms-scheduled-drain] governed file retention failed", (e as Error)?.message); }
  }
  return json(200, { claimed: rows.length, released, requeued, failed, governed, unreached: unreached.length,
    missed_closed: typeof missed === "number" ? missed : 0, governed_files_removed: orphansRemoved });
});
