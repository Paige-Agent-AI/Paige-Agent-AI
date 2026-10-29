// broadcast-command — the GOVERNED admission door for live broadcasting (EXP07 broadcast
// slice). The one way a tenant goes live:
//
//   authenticated caller → server-derived workspace (owner/admin; resolveStudioCaller) →
//   action status (the panel's truth: unavailable while the adapter is unconfigured —
//   the honest dormant state; ready; live with the session's own facts) →
//   action open: adapter.createMeeting + host addParticipant (ONLY the provider-minted
//   participant token ever reaches the host's browser) → ONE row (the receipt) →
//   action end: best-effort host kick (stops participant-minute accrual) → the row's
//   forward-only walk to ended → usage meters to platform_usage_events (media_usd,
//   exactly-once by job_id under the EXISTING index — no second ledger).
//
//   action probe: READ-ONLY listMeetings — the credential probe. It creates nothing and
//   is how the owner's verdict is settled post-deploy: 200 = the token carries
//   RealtimeKit authority; 401/403 = exact regeneration instructions.
//
// Dormant-fail-closed (the EXP06 hosting-door discipline): no adapter config means status
// honestly answers "unavailable" and every act refuses — zero rooms minted while dormant.
// Anti-abuse retained (billing supersession): bounded opens per hour per user and ONE
// live session per workspace (enforced by the database's partial unique index). No
// monetary ceiling anywhere in this door.
import { resolveStudioCaller } from "../studio-caller.ts";
import type { RealtimeKitAdapter } from "../realtimekit-provider/realtimekit.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client shape is intentionally loose here, exactly as the sibling doors keep it
type Client = any;

export interface BroadcastCommandDeps {
  /** The caller's own client (anon key + their JWT). Reads only. */
  caller: Client;
  /** Service-role client: the session rows and the meter. */
  admin: Client;
  /** The RealtimeKit adapter, injected so tests drive the REAL door with a double. */
  adapter: RealtimeKitAdapter;
}

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTHING_CHANGED = "Nothing changed.";
/** Anti-abuse (technical throughput, not money): bounded room-opens per user per hour. */
const MAX_OPENS_PER_HOUR = 10;
/** The default RealtimeKit preset group hosts get. If the app's preset list differs, the
 *  provider refuses addParticipant and this door reports the honest failure — never a
 *  fallback credential or silent skip. */
const HOST_PRESET = "group_call";
/** LIST-rate estimate for the meter ($0.002 per participant-minute, verified published
 *  rate). The first-invoice readback (the decision doc's named open question) settles
 *  actuals; this constant is a meter estimate, never a customer price. */
const LIST_USD_PER_PARTICIPANT_MIN = 0.002;
/** Slice 1 admits only the host; the meter counts host participant-minutes. Guest
 *  admission (the next slice) adds their minutes to the same row's arithmetic. */
const SLICE_1_PARTICIPANTS = 1;

/** The tenant-facing guest link for a session: the app origin the browser called from,
 *  with the honest fallback when no origin header survives. The /live route ships with
 *  the guest-admission slice in this same branch. */
function guestUrlFor(req: Request, sessionId: string): string {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  const base = origin ? new URL(origin).origin : "https://paigeagent.ai";
  return `${base}/live/${sessionId}`;
}

export async function handleBroadcastCommand(req: Request, deps: BroadcastCommandDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: NOTHING_CHANGED });

  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; } catch { return respond(400, { ok: false, code: "REQUEST_INVALID", error: NOTHING_CHANGED }); }
  const action = typeof body.action === "string" ? body.action : "";
  if (!["status", "open", "end", "probe"].includes(action)) return respond(400, { ok: false, code: "ACTION_INVALID", error: NOTHING_CHANGED });

  // Who is calling — the door never trusts a named tenant or user.
  const { data: userData, error: userErr } = await deps.caller.auth.getUser();
  const user = userErr ? null : (userData as { user?: { id?: string } } | null)?.user;
  if (!user?.id || typeof user.id !== "string") {
    return respond(401, { ok: false, code: "NOT_AUTHENTICATED", error: "Sign in, then try again." });
  }
  const caller = await resolveStudioCaller(deps.caller, body.expected_tenant_id);
  if (!caller.ok) {
    const refused = caller as unknown as { status: number; reason: string; error: string };
    return respond(refused.status, { ok: false, code: `CALLER_${refused.reason.toUpperCase()}`, error: refused.error });
  }
  const tenantId = (caller as unknown as { tenantId: string }).tenantId;
  // Going live is an owner/admin act (resolveStudioCaller proved the workspace + role).

  const configured = deps.adapter.isConfigured();

  // ── status: the Go Live panel's truth. No provider call on this path — a page load
  // must never cost a round trip to Cloudflare; the row + the adapter's own configured
  // state carry everything the panel renders. ─────────────────────────────────────────
  if (action === "status") {
    if (!configured) return respond(200, { ok: true, state: "unavailable" });
    const active = await deps.admin.rpc("tenant_broadcast_session_active", { p_tenant_id: tenantId });
    const row = active.error ? null : (active.data as Record<string, unknown> | null);
    if (row?.id) {
      return respond(200, {
        ok: true, state: "live",
        session: { title: String(row.title), started_at: String(row.created_at), guest_url: guestUrlFor(req, String(row.id)) },
      });
    }
    return respond(200, { ok: true, state: "ready" });
  }

  // ── probe: the read-only credential proof (listMeetings creates nothing). ───────────
  if (action === "probe") {
    if (!configured) return respond(503, { ok: false, code: "BROADCAST_NOT_CONFIGURED", error: "Live broadcasting isn't configured on this account yet." });
    const probed = await deps.adapter.listMeetings();
    if (probed.ok) return respond(200, { ok: true, probe: "reachable", meetings: probed.meetings.length });
    return respond(502, { ok: false, code: "BROADCAST_PROBE_REFUSED", error: "The live service refused the credential check — nothing was changed.", httpStatus: "httpStatus" in probed ? probed.httpStatus : undefined });
  }

  if (!configured) {
    return respond(503, { ok: false, code: "BROADCAST_NOT_ENABLED", error: "Live broadcasting isn't switched on for this workspace yet. Nothing changed." });
  }

  // ── open: one room, one host pass, one row. ─────────────────────────────────────────
  if (action === "open") {
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Live from my business";

    // Anti-abuse (throughput): bounded opens per user per hour.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const recent = await deps.admin.from("tenant_broadcast_sessions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("created_by", user.id).gte("created_at", hourAgo);
    if (!recent.error && Number(recent.count ?? 0) >= MAX_OPENS_PER_HOUR) {
      return respond(429, { ok: false, code: "BROADCAST_RATE_LIMITED", error: "That's a lot of live rooms in one hour. Try again later — nothing is lost." });
    }

    // One live session per workspace — pre-checked here, enforced by the database below.
    const active = await deps.admin.rpc("tenant_broadcast_session_active", { p_tenant_id: tenantId });
    if (!active.error && (active.data as Record<string, unknown> | null)?.id) {
      return respond(409, { ok: false, code: "BROADCAST_ALREADY_LIVE", error: "This workspace is already live. End that broadcast first." });
    }

    const meeting = await deps.adapter.createMeeting({ title });
    if (!meeting.ok) {
      return respond(502, { ok: false, code: "BROADCAST_ROOM_REFUSED", error: "The live service didn't open a room. Nothing changed." });
    }
    const host = await deps.adapter.addParticipant({
      meetingId: meeting.meeting.id, customParticipantId: user.id, presetName: HOST_PRESET, name: "Host",
    });
    if (!host.ok) {
      // The meeting exists at the provider with no PAIGE row — nothing further happens
      // here (the row is the receipt; an unrowed meeting admits nobody and cannot bill).
      return respond(502, { ok: false, code: "BROADCAST_HOST_REFUSED", error: "The live service wouldn't admit the host. Nothing changed." });
    }
    const inserted = await deps.admin.rpc("tenant_broadcast_session_open", {
      p_tenant_id: tenantId, p_title: title, p_meeting_id: meeting.meeting.id,
      p_host_participant_id: host.participant.id, p_created_by: user.id,
    });
    const row = inserted.error ? null : (inserted.data as Record<string, unknown> | null);
    if (inserted.error || !row?.id) {
      // A race won the one-live-slot. No second row exists; the room above stays unrowed
      // (admits nobody through PAIGE) — the honest outcome, reported as-is.
      return respond(409, { ok: false, code: "BROADCAST_ALREADY_LIVE", error: "This workspace went live while you clicked. Refresh — the live session is showing." });
    }
    const sessionId = String(row.id);
    return respond(200, {
      ok: true,
      session: { title, started_at: String(row.created_at), guest_url: guestUrlFor(req, sessionId) },
      // The host's OWN join material — the provider-minted participant pass (never the
      // platform token). The in-page room mount consumes this; the panel passes it through.
      host: { meeting_id: meeting.meeting.id, participant_id: host.participant.id, token: host.participant.token },
    });
  }

  // ── end: the row is the truth; the kick is best-effort billing hygiene. ─────────────
  // action === "end"
  const active = await deps.admin.rpc("tenant_broadcast_session_active", { p_tenant_id: tenantId });
  const row = active.error ? null : (active.data as Record<string, unknown> | null);
  if (!row?.id || typeof row.meeting_id !== "string") {
    return respond(404, { ok: false, code: "BROADCAST_NOT_LIVE", error: "No live broadcast to end." });
  }
  const sessionId = String(row.id);
  const meetingId = String(row.meeting_id);
  const hostParticipantId = typeof row.host_participant_id === "string" ? row.host_participant_id : null;

  // Stop participant-minute accrual for the host (guests arrive with the admission
  // slice; slice 1 admits only the host). A refused kick does NOT block the row's end —
  // the outcome is recorded in the meter metadata, never silently dropped.
  let kickOk = false;
  if (hostParticipantId) {
    const kicked = await deps.adapter.kickParticipant({ meetingId, participantId: hostParticipantId });
    kickOk = kicked.ok;
  }
  const ended = await deps.admin.rpc("tenant_broadcast_session_end", { p_id: sessionId, p_tenant_id: tenantId });
  const endedRow = ended.error ? null : (ended.data as Record<string, unknown> | null);
  if (ended.error || !endedRow?.id) {
    return respond(409, { ok: false, code: "BROADCAST_END_RACE", error: "The broadcast already ended — refresh for its real state." });
  }

  // The meter: host participant-minutes at the list-rate estimate, exactly-once by job_id
  // under the media_usd index the platform already enforces. A failed insert is NAMED in
  // the response (meter_pending) — never a silent gap in the ledger.
  const startedAt = Date.parse(String(row.created_at));
  const endedAt = endedRow.ended_at ? Date.parse(String(endedRow.ended_at)) : Date.now();
  const participantMinutes = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Math.max(0, (endedAt - startedAt) / 60_000) * SLICE_1_PARTICIPANTS
    : 0;
  const usd = Number((participantMinutes * LIST_USD_PER_PARTICIPANT_MIN).toFixed(4));
  const meter = await deps.admin.from("platform_usage_events").insert({
    tenant_id: tenantId, event_type: "media_usd", quantity: usd, unit: "usd",
    metadata: {
      job_id: `broadcast:${sessionId}`, kind: "broadcast_session_end",
      participant_minutes: Math.round(participantMinutes * 100) / 100,
      list_rate_usd_per_participant_min: LIST_USD_PER_PARTICIPANT_MIN, host_kick_ok: kickOk,
    },
  });
  return respond(200, {
    ok: true, state: "ended",
    session: { title: String(row.title), started_at: String(row.created_at), guest_url: guestUrlFor(req, sessionId) },
    ...(meter.error ? { note: "meter_pending" } : {}),
  });
}
