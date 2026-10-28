// An in-memory world for driving the REAL stream-media-read handler
// (supabase/functions/_shared/stream-media-read/reader.ts). The handler's own code makes every
// decision; only the caller client and the Stream adapter are doubles. The adapter double
// records every getVideo call and answers from options — including every failure class the real
// adapter can return. This is NOT authenticated runtime proof against Supabase or Cloudflare.
import { handleStreamMediaRead } from "../../supabase/functions/_shared/stream-media-read/reader.ts";
import type { StreamReadAdapter, StreamVideoMetadata } from "../../supabase/functions/_shared/stream-provider/stream.ts";

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MINE = "11111111-1111-4111-8111-111111111111";
export const TEST_VIDEO = "650092261481ddfac3d4da12d3b9aff3";
export const FOREIGN_VIDEO = "9999999999999999999999999999aaaa";

export const videoAnswer = (over: Partial<StreamVideoMetadata> = {}): StreamVideoMetadata => ({
  uid: TEST_VIDEO,
  status: "ready",
  duration: 12.5,
  created: "2026-10-24T10:00:00Z",
  readyToStream: true,
  playback: { hls: `https://customer-x.cloudflarestream.com/${TEST_VIDEO}/manifest/video.m3u8`, dash: null },
  thumbnail: `https://customer-x.cloudflarestream.com/${TEST_VIDEO}/thumbnails/thumbnail.jpg`,
  ...over,
});

export interface WorldOptions {
  user?: string | null;
  active?: string | null;
  /** The adapter's configured state. */
  adapterConfigured?: boolean;
  /** The adapter's getVideo answer class. */
  getVideo?: "ok" | "refused" | "missing" | "transport";
  /** tenant_media_assets rows the admin double serves (status must be 'ready' to catalogue). */
  assets?: Array<Record<string, unknown>>;
}

export function world(o: WorldOptions = {}) {
  const seen = {
    getVideo: [] as string[],
    asked: [] as Array<Record<string, unknown>>,
    assetReads: [] as Array<{ tenant: string; uid: string }>,
  };
  const assets = [...(o.assets ?? [])];

  const caller = {
    auth: {
      getUser: async () => o.user === null
        ? { data: { user: null }, error: { message: "no session" } }
        : { data: { user: { id: o.user ?? USER } }, error: null },
    },
    rpc: async (fn: string) => {
      if (fn === "current_user_tenant_id") return { data: o.active === null ? null : (o.active ?? MINE), error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };

  // The service-role double: a PostgREST-shaped from() chain over the assets rows.
  // deno-lint-ignore no-explicit-any
  const admin: any = {
    from: (table: string) => {
      let rows: Record<string, unknown>[] = table === "tenant_media_assets" ? assets : [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select"]) chain[m] = () => chain;
      chain.eq = (c: string, v: unknown) => { if (c === "tenant_id") seen.assetReads.push({ tenant: String(v), uid: "" }); rows = rows.filter((r) => r[c] === v); if (c === "stream_uid" && seen.assetReads.length) seen.assetReads[seen.assetReads.length - 1].uid = String(v); return chain; };
      chain.limit = () => Promise.resolve({ data: rows, error: null });
      return chain;
    },
  };

  const adapter: StreamReadAdapter = {
    isConfigured: () => o.adapterConfigured !== false,
    directCreate: async () => ({ ok: false as const, code: "transport_failed" as const }),
    getVideo: async (uid: string) => {
      seen.getVideo.push(uid);
      switch (o.getVideo ?? "ok") {
        case "refused": return { ok: false, code: "cloudflare_refused", httpStatus: 403 };
        case "missing": return { ok: false, code: "video_missing" };
        case "transport": return { ok: false, code: "transport_failed" };
        default: return { ok: true, video: videoAnswer({ uid }) };
      }
    },
  };

  const call = (over: Record<string, unknown> = {}, init: RequestInit = {}) =>
    handleStreamMediaRead(new Request("https://edge.test/stream-media-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // GET/OPTIONS Requests cannot carry a body — the verb checks pass none.
      body: init.method && init.method !== "POST" ? undefined : JSON.stringify({ action: "video", uid: TEST_VIDEO, ...over }),
      ...init,
    }), { caller, admin, adapter });

  return { seen, call, caller, admin, adapter };
}
