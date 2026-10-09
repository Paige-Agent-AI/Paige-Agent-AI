// #1140 — gmail-mailbox-sync: the personal Gmail read engine. Cron-token gated
// (service-role bearer OR x-cron-token, exactly like comms-scheduled-drain), so
// verify_jwt=false in config.toml and the in-function gate is the auth.
//
// Bounded and never destructive:
//   1. Load every ACTIVE gmail connector whose granted scopes include read
//      (gmail.readonly OR gmail.modify) — the inbox consent recorded them.
//   2. First sync: the bounded initial window (14 days, ≤200 messages).
//   3. Incremental: users.getProfile historyId vs the stored cursor → history.list
//      deltas; messageAdded → fetch+insert (idempotent on provider_message_id),
//      messageDeleted → SOFT meta mark (the canonical row is never deleted).
//   4. Expired history (404/410) → bounded re-reconcile via messages.list newer
//      than the last synced internal date (missed events recovered, still capped).
//   5. Classify each new inbound through the model router's `classify` job kind
//      (the Model Intelligence Fabric's cheap band — never a direct provider
//      selection), apply auto labels, and run the ONE shared inbound engine RPC
//      (personal: no cases by construction; shared: case upsert + follow-up state).
//   6. refresh_support_followups: stale unresolved shared cases get ONE tracked
//      follow-up (bounded 5/case, cancelled by any customer reply).
//
// There is no Gmail write anywhere in this function: organization is the approved
// door's job (comms-mailbox-command). A classifier failure never drops mail — the
// message lands first, classification is best-effort after it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routedChatCompletion } from "../_shared/model-router.ts";
import { autoLabelsFor, buildClassifyPrompt, parseClassificationReply } from "../_shared/inbox-intelligence/classify.ts";
import { classifyHistoryEvents, gmailHistoryIsExpired, normalizeGmailMessage, planInitialSync, type GmailMessageEnvelope } from "../_shared/inbox-intelligence/sync.ts";
import { GMAIL_SCOPE_MODIFY, GMAIL_SCOPE_READ_ONLY, hasReadScope } from "../_shared/inbox-intelligence/policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function isAuthorizedInternalCaller(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer.length > 0 && bearer === SERVICE_ROLE_KEY) return true;
  const cronToken = req.headers.get("x-cron-token") ?? "";
  if (!cronToken) return false;
  const { data, error } = await admin.rpc("verify_cron_token", { _token: cronToken });
  return !error && data === true;
}

const FETCH_TIMEOUT = 20000;
async function gmailFetch(accessToken: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: abort.signal,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

const MESSAGE_FIELDS = "id,threadId,internalDate,labelIds,snippet,headers";
const HEADER_NAMES = ["From", "To", "Delivered-To", "Subject", "List-Unsubscribe"];

interface ConnectorRow {
  id: string; tenant_id: string; provider: string | null; status: string; active: boolean;
  mailbox_class: string; mailbox_owner_user_id: string | null; mailbox_scopes: unknown;
  inbound_address: string | null; credentials_vault_ref: string | null;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!(await isAuthorizedInternalCaller(req))) return json(401, { error: "unauthorized" });

  const { data: connectors, error: connectorError } = await admin.from("channel_connectors")
    .select("id,tenant_id,provider,status,active,mailbox_class,mailbox_owner_user_id,mailbox_scopes,inbound_address,credentials_vault_ref")
    .eq("channel_type", "email").eq("provider", "gmail").eq("status", "active").eq("active", true)
    .limit(25);
  if (connectorError) return json(500, { error: "connector_read_failed" });

  const report: Record<string, unknown>[] = [];
  for (const connector of (connectors ?? []) as ConnectorRow[]) {
    if (!connector.credentials_vault_ref || !hasReadScope(connector) || !connector.inbound_address) continue;
    try {
      const outcome = await syncOneConnector(connector);
      report.push({ connector_id: connector.id, mailbox_class: connector.mailbox_class, ...outcome });
    } catch (error) {
      try { await admin.rpc("record_mailbox_sync_outcome", { _connector_id: connector.id, _status: "failed", _error: String((error as Error)?.message ?? error).slice(0, 400), _history_id: null }); } catch { /* the failure record is best-effort; the tick stays green */ }
      report.push({ connector_id: connector.id, mailbox_class: connector.mailbox_class, error: "failed" });
    }
  }

  // Shared-support follow-up bookkeeping (bounded, cancellable, never auto-sends).
  let followups = 0;
  try {
    const { data: scheduled } = await admin.rpc("refresh_support_followups", { _stale_after_hours: 24 });
    followups = typeof scheduled === "number" ? scheduled : 0;
  } catch { /* the tick stays green; the next tick retries */ }

  return json(200, { ok: true, mailboxes: report.length, followups_scheduled: followups, report });
});

async function accessTokenFor(refreshRef: string): Promise<string | null> {
  const { data: refreshToken, error } = await admin.rpc("read_channel_secret", { _ref: refreshRef });
  if (error || typeof refreshToken !== "string" || !refreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => null);
  return res.ok && body?.access_token ? body.access_token : null;
}

async function syncOneConnector(connector: ConnectorRow): Promise<Record<string, unknown>> {
  const accessToken = await accessTokenFor(connector.credentials_vault_ref!);
  if (!accessToken) {
    await admin.rpc("record_mailbox_sync_outcome", { _connector_id: connector.id, _status: "failed", _error: "token_refresh_failed", _history_id: null });
    return { outcome: "failed", reason: "token_refresh_failed" };
  }

  const { data: state } = await admin.from("mailbox_sync_state").select("*").eq("connector_id", connector.id).maybeSingle();
  const mailbox = { tenantId: connector.tenant_id, connectorId: connector.id, ownerAddress: connector.inbound_address!.toLowerCase() };

  let inserted = 0, softMarked = 0, classified = 0;
  let lastHistoryId: number | null = typeof state?.last_history_id === "number" ? state.last_history_id : null;

  const insertMessages = async (envelopes: GmailMessageEnvelope[]) => {
    for (const envelope of envelopes.slice(0, 200)) {
      const normalized = normalizeGmailMessage(envelope, mailbox);
      const { error } = await admin.from("messages").insert({
        tenant_id: normalized.tenant_id, connector_id: normalized.connector_id, thread_key: normalized.thread_key,
        direction: normalized.direction, status: normalized.status, sender: normalized.sender, recipients: normalized.recipients,
        subject: normalized.subject, body_text: normalized.body_text, provider_message_id: normalized.provider_message_id,
        meta: normalized.meta, sent_at: normalized.sent_at,
      });
      // A duplicate provider_message_id is the idempotency contract holding: skip.
      if (error && String(error?.code) !== "23505") continue;
      if (!error) {
        inserted += 1;
        if (normalized.direction === "inbound") {
          await runInboundIntelligence(connector, normalized, envelope);
          classified += 1;
        }
      }
    }
  };

  const fetchEnvelope = async (id: string): Promise<GmailMessageEnvelope | null> => {
    const { status, body } = await gmailFetch(accessToken, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=${HEADER_NAMES.join("&metadataHeaders=")}&fields=${MESSAGE_FIELDS}`);
    return status === 200 && body && typeof body === "object" ? body as GmailMessageEnvelope : null;
  };

  if (!state?.initial_sync_completed_at) {
    // ── Bounded initial sync ──
    const plan = planInitialSync(new Date());
    const afterSeconds = Math.floor(plan.after.getTime() / 1000);
    let pageToken: string | null = null;
    const collected: GmailMessageEnvelope[] = [];
    do {
      const query = new URLSearchParams({ q: `after:${afterSeconds}`, maxResults: String(Math.min(100, plan.maxMessages - collected.length)) });
      if (pageToken) query.set("pageToken", pageToken);
      const { status, body } = await gmailFetch(accessToken, `/messages?${query.toString()}`);
      const payload = body as { messages?: { id: string }[]; nextPageToken?: string } | null;
      if (status !== 200 || !payload) break;
      for (const ref of payload.messages ?? []) {
        const envelope = await fetchEnvelope(ref.id);
        if (envelope) collected.push(envelope);
        if (collected.length >= plan.maxMessages) break;
      }
      pageToken = payload.nextPageToken ?? null;
    } while (pageToken && collected.length < plan.maxMessages);
    await insertMessages(collected);

    const profile = await gmailFetch(accessToken, "/profile");
    const historyId = (profile.body as { historyId?: string } | null)?.historyId;
    lastHistoryId = historyId ? Number(historyId) : lastHistoryId;
    await admin.rpc("record_mailbox_sync_outcome", {
      _connector_id: connector.id, _status: "ok", _error: null, _history_id: lastHistoryId,
      _initial_completed: true, _last_message_date: latestInternalDate(collected),
    });
    return { outcome: "initial_sync", inserted, classified };
  }

  // ── Incremental history sync ──
  const profile = await gmailFetch(accessToken, "/profile");
  const profileHistoryId = Number((profile.body as { historyId?: string } | null)?.historyId ?? 0);
  if (lastHistoryId === null || profileHistoryId > lastHistoryId) {
    const since = lastHistoryId ?? profileHistoryId;
    const history = await gmailFetch(accessToken, `/history?startHistoryId=${since}&maxResults=500`);
    if (history.status === 200) {
      const events = ((history.body as { history?: unknown[] } | null)?.history ?? []) as never[];
      const plan2 = classifyHistoryEvents(events);
      const envelopes: GmailMessageEnvelope[] = [];
      for (const id of plan2.toFetch) {
        const envelope = await fetchEnvelope(id);
        if (envelope) envelopes.push(envelope);
      }
      await insertMessages(envelopes);
      for (const id of plan2.toMarkRemoved) {
        // SOFT mark only: the canonical row keeps the thread's truthful history.
        await admin.from("messages").update({ meta: { gmail_removed_at: new Date().toISOString() } }).eq("tenant_id", connector.tenant_id).eq("connector_id", connector.id).eq("provider_message_id", id);
        softMarked += 1;
      }
      lastHistoryId = profileHistoryId || lastHistoryId;
    } else if (gmailHistoryIsExpired(history.status, history.body)) {
      // ── Missed events: bounded re-reconcile newer than the last synced date ──
      const after = state?.last_message_internal_date ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const afterSeconds = Math.floor(new Date(after).getTime() / 1000);
      const query = new URLSearchParams({ q: `after:${afterSeconds}`, maxResults: "100" });
      const list = await gmailFetch(accessToken, `/messages?${query.toString()}`);
      const payload = list.body as { messages?: { id: string }[] } | null;
      const envelopes: GmailMessageEnvelope[] = [];
      for (const ref of (payload?.messages ?? []).slice(0, 100)) {
        const envelope = await fetchEnvelope(ref.id);
        if (envelope) envelopes.push(envelope);
      }
      await insertMessages(envelopes);
      lastHistoryId = profileHistoryId || lastHistoryId;
    } else {
      await admin.rpc("record_mailbox_sync_outcome", { _connector_id: connector.id, _status: "partial", _error: `history_${history.status}`, _history_id: lastHistoryId });
      return { outcome: "partial", reason: `history_${history.status}`, inserted, classified, soft_marked: softMarked };
    }
  }

  await admin.rpc("record_mailbox_sync_outcome", {
    _connector_id: connector.id, _status: "ok", _error: null, _history_id: lastHistoryId,
    _initial_completed: true, _last_message_date: null,
  });
  return { outcome: "incremental", inserted, classified, soft_marked: softMarked };
}

function latestInternalDate(envelopes: GmailMessageEnvelope[]): string | null {
  const times = envelopes.map((e) => (e.internalDate && /^\d+$/.test(e.internalDate) ? Number(e.internalDate) : 0)).filter(Boolean);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * The ONE inbound intelligence engine both mailbox paths share. Runs AFTER the
 * message row exists: the row is resolved by provider id, the shared-engine RPC
 * runs (case upsert + follow-up cancellation — a no-op by construction on
 * personal mailboxes), then classification through the model router's cheap
 * band (the Model Intelligence Fabric's classify lane — never a direct provider
 * selection). A classifier failure leaves the message landed and unclassified —
 * honest, never dropped.
 */
async function runInboundIntelligence(connector: ConnectorRow, normalized: { provider_message_id: string; subject: string | null; sender: { address: string | null } }, envelope: GmailMessageEnvelope): Promise<void> {
  try {
    const { data: messageRow } = await admin.from("messages").select("id").eq("tenant_id", connector.tenant_id).eq("provider_message_id", normalized.provider_message_id).maybeSingle();
    if (!messageRow?.id) return;

    await admin.rpc("record_inbound_message_intelligence", { _message_id: messageRow.id });

    const prompt = buildClassifyPrompt({
      mailboxClass: connector.mailbox_class === "personal" ? "personal" : "shared_support",
      subject: normalized.subject,
      fromAddress: normalized.sender?.address ?? null,
      snippet: envelope.snippet ?? "",
    });
    const reply = await routedChatCompletion("classify", {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const text = (reply as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    const outcome = parseClassificationReply(text);
    if (!outcome) return; // unclassified stays landed; the next tick may retry
    await admin.rpc("apply_message_classification", {
      _message_id: messageRow.id, _intent: outcome.intent, _confidence: outcome.confidence,
      _summary: outcome.summary, _model_route: { job_kind: "classify" }, _labels: JSON.stringify(autoLabelsFor(outcome.intent, normalized.sender?.address ?? null)),
    });
  } catch {
    // Classification is best-effort by contract; the message itself already landed.
  }
}
