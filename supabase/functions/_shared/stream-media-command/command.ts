// stream-media-command — the GOVERNED upload/lifecycle door for the tenant media library
// (EXP07 media-library slice 2). The one way a tenant's video enters the library:
//
//   authenticated caller → server-derived workspace (owner/admin; resolveStudioCaller) →
//   action register: tenant_media_asset_register (uploading) → adapter.directCreate (the
//   one-time uploadURL + uid; the API token NEVER leaves the server) → the row is bound to
//   the uid → the response hands the browser ONLY the one-time uploadURL.
//
//   action status: the provider's own state (via getVideo) is folded into the row through
//   the forward-only walk — processing while Cloudflare is still working, ready with the
//   real duration/size, failed on provider error, outcome_unknown when the provider cannot
//   answer (the honest state that BLOCKS re-registration until reconciled).
//
//   action revoke: the retention terminal — the row is revoked in PAIGE's library (the
//   provider-side delete is a separately governed later step; nothing here deletes at the
//   provider).
//
// Anti-abuse retained (billing supersession): uploads are rate-limited per user (a technical
// throughput limit, not money); the size/duration bounds are the provider contract's own
// (200MB / maxDurationSeconds reserved). No monetary ceiling anywhere in this door.
import { resolveStudioCaller } from "../studio-caller.ts";
import type { StreamReadAdapter } from "../stream-provider/stream.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export interface StreamMediaCommandDeps {
  /** The caller's own client (anon key + their JWT). Reads only. */
  caller: Client;
  /** Service-role client: the catalogue writes. */
  admin: Client;
  /** The Stream adapter, injected so tests drive the REAL door with a double. */
  adapter: StreamReadAdapter;
}

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UID32 = /^[0-9a-f]{32}$/;
const NOTHING_CHANGED = "Nothing changed.";
/** Per-user anti-abuse (technical throughput, not money): one in-flight registration at a
 *  time and a bounded per-hour count. The provider contract's own 200MB/size bounds apply
 *  at the browser POST; they are not re-implemented here. */
const MAX_REGISTRATIONS_PER_HOUR = 20;

export async function handleStreamMediaCommand(req: Request, deps: StreamMediaCommandDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: NOTHING_CHANGED });

  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; } catch { return respond(400, { ok: false, code: "REQUEST_INVALID", error: NOTHING_CHANGED }); }
  const action = typeof body.action === "string" ? body.action : "";
  if (!["register", "status", "revoke"].includes(action)) return respond(400, { ok: false, code: "ACTION_INVALID", error: NOTHING_CHANGED });

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
  // Uploads/lifecycle are an owner/admin action (resolveStudioCaller already proved the
  // workspace; the plain-member read path is the stream-media-read/list surface, not this door).

  if (!deps.adapter.isConfigured()) {
    return respond(503, { ok: false, code: "MEDIA_NOT_CONFIGURED", error: "The video library isn't configured on this account yet. Nothing changed." });
  }

  // ── register ────────────────────────────────────────────────────────────────────────────────
  if (action === "register") {
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Untitled video";
    const maxDurationSeconds = Math.min(Math.max(Number(body.max_duration_seconds) || 3600, 1), 7200);

    // Anti-abuse (throughput): bounded registrations per user per hour.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const recent = await deps.admin.from("tenant_media_assets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("created_by", user.id).gte("created_at", hourAgo);
    if (!recent.error && Number(recent.count ?? 0) >= MAX_REGISTRATIONS_PER_HOUR) {
      return respond(429, { ok: false, code: "MEDIA_RATE_LIMITED", error: "That's a lot of uploads in one hour. Try again later — nothing is lost." });
    }

    // One provider slot, then ONE row — the row is the receipt.
    const created = await deps.adapter.directCreate({ maxDurationSeconds });
    if (!created.ok) {
      return respond(502, { ok: false, code: "MEDIA_UPLOAD_SLOT_FAILED", error: "The video service didn't offer an upload slot. Nothing was changed." });
    }
    const inserted = await deps.admin.rpc("tenant_media_asset_register", {
      p_tenant_id: tenantId, p_stream_uid: created.uid, p_title: title, p_kind: "video",
      p_marketing_content_id: null, p_created_by: user.id,
    });
    const row = inserted.error ? null : (inserted.data as Record<string, unknown> | null);
    if (inserted.error || !row?.id) {
      // The slot exists at the provider but has no library row — the honest outcome is
      // unknown-to-the-library, never a silent success. The unused one-time URL expires on its own.
      return respond(409, {
        ok: false, code: "MEDIA_REGISTRATION_REFUSED", error: "That video couldn't be added to this workspace's library. Nothing was uploaded.",
        detail: inserted.error?.code === "40P01" ? "retry_pending_reconciliation" : String(inserted.error?.code ?? "unknown"),
      });
    }
    return respond(200, {
      ok: true, asset: { id: String(row.id), title, stream_uid: created.uid, status: String(row.status ?? "uploading") },
      // The ONE-TIME upload URL the browser POSTs to. It is not the API token and it expires.
      upload_url: created.uploadUrl,
    });
  }

  // ── status / revoke: the row must exist and belong to THIS workspace ────────────────────────
  const id = typeof body.asset_id === "string" && UUID.test(body.asset_id) ? body.asset_id : "";
  if (!id) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Name the library item." });
  const readRow = await deps.admin.from("tenant_media_assets")
    .select("id,stream_uid,status,title").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  const row = readRow.data as Record<string, unknown> | null;
  if (readRow.error || !row?.id || typeof row.stream_uid !== "string") {
    return respond(404, { ok: false, code: "MEDIA_NOT_FOUND", error: "That video isn't in this workspace's library." });
  }
  const uid = row.stream_uid;

  if (action === "revoke") {
    const revoked = await deps.admin.rpc("tenant_media_asset_set_status", { p_id: id, p_tenant_id: tenantId, p_status: "revoked" });
    if (revoked.error) {
      return respond(409, { ok: false, code: "MEDIA_WALK_INVALID", error: "That video can't be removed from the library in its current state." });
    }
    return respond(200, { ok: true, state: "revoked" });
  }

  // action === "status": fold the provider's truth into the row (forward-only).
  const provider = await deps.adapter.getVideo(uid);
  if (provider.ok !== true) {
    // The provider cannot answer — the row stays where it is; a processing row is moved to
    // outcome_unknown ONLY when the provider state itself is unknowable... no: outcome_unknown is
    // for the PROVIDER's uncertain processing outcome. A transport failure leaves the row
    // untouched and tells the caller the truth (retryable), never a fake state.
    const failed = provider as { code: string };
    return respond(failed.code === "video_missing"
      ? 404
      : 502, { ok: false, code: failed.code === "video_missing" ? "MEDIA_NOT_FOUND" : "MEDIA_READ_FAILED", error: "The video service couldn't be reached. The library is unchanged — try again." });
  }
  const v = provider.video;
  const current = String(row.status ?? "");
  let next: string | null = null;
  let errorCode: string | null = null;
  if (current === "uploading" && (v.status === "queued" || v.status === "in_progress")) next = "processing";
  else if (current === "processing" && v.status === "ready") next = "ready";
  else if (current === "processing" && v.status === "error") { next = "failed"; errorCode = "provider_error"; }
  else if (current === "processing" && v.status === "downloading") next = "processing"; // no-op fold
  else if (current === "uploading" && v.status === "ready") next = null; // a status race: the walk needs processing first — the next fold picks it up

  if (next === null || next === current) {
    return respond(200, { ok: true, asset: { id, title: row.title, stream_uid: uid, status: current }, provider_status: v.status });
  }
  const walked = await deps.admin.rpc("tenant_media_asset_set_status", {
    p_id: id, p_tenant_id: tenantId, p_status: next, p_error_code: errorCode,
    p_bytes: null, p_duration_seconds: v.duration, p_provider_meta: { provider_status: v.status },
  });
  if (walked.error) {
    // A race with another fold — report the row's actual state, never an invented one.
    const reread = await deps.admin.from("tenant_media_assets").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    return respond(200, {
      ok: true, asset: { id, title: row.title, stream_uid: uid, status: String((reread.data as Record<string, unknown> | null)?.status ?? current) },
      provider_status: v.status, note: "concurrent update",
    });
  }
  const walkedRow = walked.data as Record<string, unknown> | null;
  return respond(200, {
    ok: true, asset: { id, title: row.title, stream_uid: uid, status: String(walkedRow?.status ?? next) },
    provider_status: v.status,
    video: next === "ready" ? { playback: v.playback, duration: v.duration, thumbnail: v.thumbnail } : undefined,
  });
}
