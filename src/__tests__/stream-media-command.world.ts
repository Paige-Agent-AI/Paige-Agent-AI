// An in-memory world for driving the REAL stream-media-command door
// (supabase/functions/_shared/stream-media-command/command.ts). The door's own code decides
// everything; only the two Supabase clients and the Stream adapter are doubles. The admin
// double implements a PostgREST-shaped chain over an in-memory tenant_media_assets table
// with the SAME forward-only walk the RPC enforces, so a dropped predicate or a walk
// violation fails a test rather than passing a fixture.
import { handleStreamMediaCommand } from "../../supabase/functions/_shared/stream-media-command/command.ts";
import type { StreamReadAdapter, StreamVideoMetadata } from "../../supabase/functions/_shared/stream-provider/stream.ts";

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MINE = "11111111-1111-4111-8111-111111111111";
export const THEIRS = "22222222-2222-4222-8222-222222222222";
export const NEW_UID = "dddddddddddddddddddddddddddddddd";
export const ASSET_ID = "eeee0000-0000-4000-8000-00000000a001";

type Row = Record<string, unknown>;

export interface WorldOptions {
  user?: string | null;
  active?: string | null;
  adapterConfigured?: boolean;
  /** register: the directCreate answer class. */
  directCreate?: "ok" | "refused" | "transport";
  /** status: the provider getVideo answer class. */
  getVideo?: "ok_queued" | "ok_ready" | "ok_error" | "ok_downloading" | "ok_ready_from_uploading" | "refused" | "missing" | "transport";
  /** Pre-seeded library rows. */
  assets?: Row[];
  /** Make the register RPC refuse with the reconcile code. */
  registerRefusesReconcile?: boolean;
}

const WALK: Record<string, Set<string>> = {
  uploading: new Set(["processing", "failed", "revoked"]),
  processing: new Set(["ready", "failed", "outcome_unknown", "revoked"]),
  ready: new Set(["revoked"]),
  failed: new Set(["revoked"]),
  outcome_unknown: new Set(["revoked"]),
  revoked: new Set(),
};

function providerVideo(kind: NonNullable<WorldOptions["getVideo"]>): StreamVideoMetadata {
  const base = { uid: NEW_UID, created: "2026-10-28T00:00:00Z", readyToStream: null, playback: { hls: null, dash: null }, thumbnail: null };
  switch (kind) {
    case "ok_queued": return { ...base, status: "queued", duration: null };
    case "ok_downloading": return { ...base, status: "downloading", duration: null };
    case "ok_ready": return { ...base, status: "ready", duration: 61.5, readyToStream: true, playback: { hls: "https://customer-x.cloudflarestream.com/dddd/manifest/video.m3u8", dash: null }, thumbnail: "https://customer-x/thumbs/dddd.jpg" };
    case "ok_error": return { ...base, status: "error", duration: null };
    case "ok_ready_from_uploading": return { ...base, status: "ready", duration: 61.5 };
    case "ok_ready_from_uploading": return { ...base, status: "ready", duration: 61.5, readyToStream: true, playback: { hls: "https://customer-x/dddd.m3u8", dash: null }, thumbnail: null };
    default: return { ...base, status: "queued", duration: null };
  }
}

export function world(o: WorldOptions = {}) {
  const seen = {
    directCreate: [] as number[],
    getVideo: [] as string[],
    rpc: [] as Array<{ fn: string; args: Row }>,
    reads: [] as Array<{ table: string; filters: string[][] }>,
  };
  const assets: Row[] = [...(o.assets ?? [])];

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

  // deno-lint-ignore no-explicit-any
  const admin: any = {
    from(table: string) {
      const filters: string[][] = [];
      // deno-lint-ignore no-explicit-any
      const chain: any = {};
      const run = () => {
        seen.reads.push({ table, filters: [...filters] });
        let rows = table === "tenant_media_assets" ? [...assets] : [];
        for (const [op, col, value] of filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === value);
          else if (op === "gte") rows = rows.filter((r) => String(r[col]) >= String(value));
        }
        return rows;
      };
      chain.select = (_sel: unknown, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head && opts.count === "exact") {
          const rows = run();
          // Thenable like Postgrest: await resolves the count; .eq continues the chain.
          const counting = {
            eq: (c: string, v: unknown) => { filters.push(["eq", c, String(v)]); return countingThenable(); },
            gte: (c: string, v: unknown) => { filters.push(["gte", c, String(v)]); return countingThenable(); },
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: rows.length }).then(ok),
          };
          const countingThenable = () => counting;
          return counting;
        }
        return chain;
      };
      chain.eq = (c: string, v: unknown) => { filters.push(["eq", c, String(v)]); return chain; };
      chain.gte = (c: string, v: unknown) => { filters.push(["gte", c, String(v)]); return chain; };
      chain.maybeSingle = () => Promise.resolve({ data: run()[0] ?? null, error: null });
      return chain;
    },
    rpc: async (fn: string, args: Row) => {
      seen.rpc.push({ fn, args });
      if (fn === "tenant_media_asset_register") {
        if (o.registerRefusesReconcile) return { data: null, error: { code: "40P01", message: "retry" } };
        const row: Row = {
          id: ASSET_ID, tenant_id: args.p_tenant_id, stream_uid: args.p_stream_uid, title: args.p_title,
          kind: args.p_kind ?? "video", status: "uploading", created_by: args.p_created_by,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        if (assets.some((a) => a.tenant_id === args.p_tenant_id && a.stream_uid === args.p_stream_uid)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        assets.push(row);
        return { data: { ...row }, error: null };
      }
      if (fn === "tenant_media_asset_set_status") {
        const row = assets.find((a) => a.id === args.p_id && a.tenant_id === args.p_tenant_id);
        if (!row) return { data: null, error: { code: "22023", message: "missing" } };
        const from = String(row.status);
        const to = String(args.p_status);
        if (from === to || !(WALK[from] ?? new Set()).has(to)) return { data: null, error: { code: "22023", message: "walk" } };
        row.status = to;
        row.updated_at = new Date().toISOString();
        if (args.p_duration_seconds != null) row.duration_seconds = args.p_duration_seconds;
        return { data: { ...row }, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };

  const adapter: StreamReadAdapter = {
    isConfigured: () => o.adapterConfigured !== false,
    getVideo: async (uid: string) => {
      seen.getVideo.push(uid);
      if (o.getVideo === "refused") return { ok: false, code: "cloudflare_refused", httpStatus: 403 };
      if (o.getVideo === "missing") return { ok: false, code: "video_missing" };
      if (o.getVideo === "transport") return { ok: false, code: "transport_failed" };
      if (o.getVideo) return { ok: true, video: providerVideo(o.getVideo) };
      return { ok: true, video: providerVideo("ok_queued") };
    },
    directCreate: async (input: { maxDurationSeconds: number }) => {
      seen.directCreate.push(input.maxDurationSeconds);
      if (o.directCreate === "refused") return { ok: false, code: "cloudflare_refused" };
      if (o.directCreate === "transport") return { ok: false, code: "transport_failed" };
      return { ok: true, uid: NEW_UID, uploadUrl: "https://upload.videodelivery.net/one-time" };
    },
  };

  const call = (over: Record<string, unknown> = {}, init: RequestInit = {}) =>
    handleStreamMediaCommand(new Request("https://edge.test/stream-media-command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: init.method && init.method !== "POST" ? undefined : JSON.stringify({ action: "register", ...over }),
      ...init,
    }), { caller, admin, adapter });

  return { seen, call, caller, admin, adapter, assets };
}

export const uploadingAsset = (over: Row = {}): Row => ({
  id: ASSET_ID, tenant_id: MINE, stream_uid: NEW_UID, title: "Webinar", status: "uploading",
  created_by: USER, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
});
