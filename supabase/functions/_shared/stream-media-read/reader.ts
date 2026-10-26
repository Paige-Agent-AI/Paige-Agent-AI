// stream-media-read — the GOVERNED read of the shared Stream library (EXP07 media slice 1).
//
// This ABSORBS EXP10's cf-stream-verify canary (its own header says it is "retired or absorbed
// into the governed media door in the implementation PR" — this is that implementation) under
// the house door rules: an authenticated caller, a server-derived workspace, and a CLOSED
// catalogue. Read-only — no action here creates, uploads, modifies or deletes anything in
// Cloudflare; the adapter exposes one GET arm.
//
// The catalogue is fail-closed: the only servable uid today is the owner's public test video
// (owner-published coordination data, not a secret). An arbitrary uid is refused with
// MEDIA_NOT_IN_LIBRARY before Cloudflare is ever asked — this function is not a general-purpose
// Stream reader for the shared account. When the tenant media library lands (slice 2), the
// catalogue check becomes the library's own tenant-scoped row, and this handler's authority
// shape (resolveStudioCaller) is already the one it needs.
//
// The token never appears in any response or log; failures map to closed codes exactly like
// the canary taught.
import { resolveStudioCaller } from "../studio-caller.ts";
import type { StreamReadAdapter } from "../stream-provider/stream.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export interface StreamMediaReadDeps {
  /** The caller's own client (anon key + their JWT). This handler performs NO writes. */
  caller: Client;
  /** The read-only Stream adapter, injected so tests drive the REAL handler with a double. */
  adapter: StreamReadAdapter;
}

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const UID = /^[0-9a-f]{32}$/;

/** The closed catalogue: every uid this handler may serve, until the library table exists. */
const CATALOGUE = new Set(["650092261481ddfac3d4da12d3b9aff3"]);

export async function handleStreamMediaRead(req: Request, deps: StreamMediaReadDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: "Nothing changed." });

  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; } catch { return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Nothing changed." }); }
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "video") return respond(400, { ok: false, code: "ACTION_INVALID", error: "Nothing changed." });
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!UID.test(uid)) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Name the video you want to read." });

  // Who is calling — the handler never trusts a named tenant or user.
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

  // The closed catalogue — BEFORE the provider is asked anything.
  if (!CATALOGUE.has(uid)) {
    return respond(404, { ok: false, code: "MEDIA_NOT_IN_LIBRARY", error: "That video isn't in this workspace's library." });
  }
  if (!deps.adapter.isConfigured()) {
    return respond(503, { ok: false, code: "MEDIA_NOT_CONFIGURED", error: "The video library isn't configured on this account yet. Nothing changed." });
  }

  const read = await deps.adapter.getVideo(uid);
  if (!read.ok) {
    const status = read.code === "video_missing" ? 404 : 502;
    return respond(status, { ok: false, code: read.code === "video_missing" ? "MEDIA_NOT_IN_LIBRARY" : "MEDIA_READ_FAILED", error: "The video couldn't be read right now. Nothing changed." });
  }
  return respond(200, { ok: true, video: read.video });
}
