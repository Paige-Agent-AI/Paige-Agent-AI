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

export interface StreamReadAdapter {
  isConfigured(): boolean;
  getVideo(uid: string): Promise<{ ok: true; video: StreamVideoMetadata } | { ok: false; code: "adapter_not_configured" | "cloudflare_refused" | "transport_failed" | "video_missing"; httpStatus?: number }>;
}

const API_ROOT = "https://api.cloudflare.com/client/v4/accounts";

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

export const streamReadAdapter: StreamReadAdapter = {
  isConfigured() {
    return Boolean(Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN")) && Boolean(Deno.env.get("CLOUDFLARE_ACCOUNT_ID"));
  },
  async getVideo(uid: string) {
    const token = Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN");
    const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
    if (!token || !account) return { ok: false as const, code: "adapter_not_configured" as const };
    try {
      const res = await fetch(`${API_ROOT}/${account}/stream/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
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
};
