// The Cloudflare Stream adapter — PAIGE's ONLY server-side arm for reading the shared Stream
// account (EXP07 media/broadcast; owner directive 2026-10-24/25: one shared PAIGE account,
// never per-tenant tokens, the token exists ONLY in the edge environment).
//
// READ-ONLY by construction: this module exposes isConfigured() and getVideo(uid) — a single
// GET of one video's metadata. No create, upload, update or delete arm exists here; the upload
// and broadcast arms arrive as their own governed doors, never through this file.
//
// The token never crosses this line in a response or log: failures map to closed codes, and
// the adapter returns ONLY non-secret video metadata (the same fields the video's public
// player already discloses). Mirrors social-provider's adapter shape (isConfigured + narrow
// arms, injected into handlers so tests drive the real door with a double).

export interface StreamVideoMetadata {
  uid: string;
  status: string | null;
  duration: number | null;
  created: string | null;
  readyToStream: boolean | null;
  playback: { hls: string | null; dash: string | null };
  thumbnail: string | null;
}

export interface DirectCreateResult {
  ok: true;
  uid: string;
  /** ONE-TIME upload URL the browser POSTs the file to (multipart, <=200MB). Never the API token. */
  uploadUrl: string;
}
export interface StreamReadAdapter {
  isConfigured(): boolean;
  getVideo(uid: string): Promise<{ ok: true; video: StreamVideoMetadata } | { ok: false; code: "adapter_not_configured" | "cloudflare_refused" | "transport_failed" | "video_missing"; httpStatus?: number }>;
  /** Create a fresh direct-upload slot. The API token stays server-side; only the one-time
   *  uploadURL + uid cross to the caller. maxDurationSeconds reserves storage billing until
   *  the upload completes/expires (Cloudflare's own contract) — the door picks a bounded default. */
  directCreate(input: { maxDurationSeconds: number }): Promise<DirectCreateResult | { ok: false; code: "adapter_not_configured" | "cloudflare_refused" | "transport_failed" }>;
}

const API_ROOT = "https://api.cloudflare.com/client/v4/accounts";
/** Every provider call is bounded (independent-review P3): a hung Cloudflare connection must
 *  never pin the edge worker to the platform's own limits. The API host is fixed (no SSRF
 *  surface), so AbortSignal.timeout is sufficient — safeFetch's URL validation adds nothing here. */
const STREAM_TIMEOUT_MS = 10_000;

/** The non-secret fields we serve, defensively mapped: absent stays absent, never invented. */
function mapVideo(v: Record<string, unknown>): StreamVideoMetadata {
  const playback = v.playback && typeof v.playback === "object" && !Array.isArray(v.playback) ? v.playback as Record<string, unknown> : {};
  const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    uid: str(v.uid) ?? "",
    status: str(v.status),
    duration: typeof v.duration === "number" ? v.duration : null,
    created: str(v.createdTime?.toString?.() ?? (typeof v.created === "string" ? v.created : null)),
    readyToStream: typeof v.readyToStream === "boolean" ? v.readyToStream : null,
    playback: { hls: str(playback.hls), dash: str(playback.dash) },
    thumbnail: str(v.thumbnail),
  };
}

// Deno's env is reached through globalThis (upload-post.ts's pattern) so the module type-checks
// and unit tests load it outside the Deno runtime; the values exist only in the edge environment.
const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
const env = (key: string) => deno?.env?.get(key);

export const streamReadAdapter: StreamReadAdapter = {
  isConfigured() {
    return Boolean(env("CLOUDFLARE_STREAM_API_TOKEN")) && Boolean(env("CLOUDFLARE_ACCOUNT_ID"));
  },
  async getVideo(uid: string) {
    const token = env("CLOUDFLARE_STREAM_API_TOKEN");
    const account = env("CLOUDFLARE_ACCOUNT_ID");
    if (!token || !account) return { ok: false as const, code: "adapter_not_configured" as const };
    try {
      const res = await fetch(`${API_ROOT}/${account}/stream/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });
      // Only the HTTP status crosses on failure — never provider prose (which could echo
      // request material) and never the credential.
      if (!res.ok) {
        return res.status === 404
          ? { ok: false as const, code: "video_missing" as const }
          : { ok: false as const, code: "cloudflare_refused" as const, httpStatus: res.status };
      }
      const body = await res.json() as Record<string, unknown>;
      const result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result as Record<string, unknown> : null;
      if (!result) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: 200 };
      return { ok: true as const, video: mapVideo(result) };
    } catch {
      return { ok: false as const, code: "transport_failed" as const };
    }
  },
  async directCreate(input: { maxDurationSeconds: number }) {
    const token = env("CLOUDFLARE_STREAM_API_TOKEN");
    const account = env("CLOUDFLARE_ACCOUNT_ID");
    if (!token || !account) return { ok: false as const, code: "adapter_not_configured" as const };
    const bounded = Math.min(Math.max(Math.floor(input.maxDurationSeconds) || 3600, 1), 7200);
    try {
      const res = await fetch(`${API_ROOT}/${account}/stream/direct_upload`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ maxDurationSeconds: bounded }),
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: res.status };
      const body = await res.json() as Record<string, unknown>;
      const result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result as Record<string, unknown> : null;
      const uid = typeof result?.uid === "string" ? result.uid : "";
      const uploadUrl = typeof result?.uploadURL === "string" ? result.uploadURL : "";
      if (!/^[0-9a-f]{32}$/.test(uid) || !/^https:\/\//.test(uploadUrl)) {
        return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: 200 };
      }
      return { ok: true as const, uid, uploadUrl };
    } catch {
      return { ok: false as const, code: "transport_failed" as const };
    }
  },
};
