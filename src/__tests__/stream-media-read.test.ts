// The REAL stream-media-read handler (supabase/functions/_shared/stream-media-read/reader.ts)
// driven through an in-memory world: every branch the handler takes on its own authority chain
// and the adapter's answer classes. resolveStudioCaller is a Deno-runtime module proven by the
// growth-publish door's production use — doubled here exactly as the social-publish-door tests
// double it, so these tests prove THIS handler's branching logic, not the caller chain's.
vi.mock("../../supabase/functions/_shared/studio-caller.ts", () => ({
  resolveStudioCaller: vi.fn(async (caller: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }, requestedTenant: unknown) => {
    const { data: active } = await caller.rpc("current_user_tenant_id");
    if (typeof active !== "string" || !active) return { ok: false, status: 403, error: "Open one of your workspaces first.", reason: "no_workspace" };
    if (requestedTenant != null && requestedTenant !== "" && String(requestedTenant).toLowerCase() !== active) {
      return { ok: false, status: 403, error: "That isn't the workspace you're signed in to.", reason: "other_workspace" };
    }
    return { ok: true, tenantId: active, role: "owner" };
  }),
}));

import { describe, expect, it, vi } from "vitest";
import { FOREIGN_VIDEO, MINE, TEST_VIDEO, world } from "./stream-media-read.world";

const body = async (res: Response) => res.json() as Promise<Record<string, unknown>>;

describe("stream-media-read · the governed Stream library read (EXP07 media slice 1)", () => {
  it("OPTIONS is open and every other verb is refused without touching the adapter", async () => {
    const w = world();
    const options = await handle(w, "OPTIONS");
    expect(options.status).toBe(204);
    const get = await handle(w, "GET");
    expect(get.status).toBe(405);
    expect(w.seen.getVideo).toHaveLength(0);
  });

  it("an unauthenticated caller is refused before the catalogue or Cloudflare is consulted", async () => {
    const w = world({ user: null });
    const res = await w.call();
    expect(res.status).toBe(401);
    expect((await body(res)).code).toBe("NOT_AUTHENTICATED");
    expect(w.seen.getVideo).toHaveLength(0);
  });

  it("a caller with no resolved workspace is refused with the caller chain's own sentence", async () => {
    const w = world({ active: null });
    const res = await w.call();
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("CALLER_NO_WORKSPACE");
    expect(w.seen.getVideo).toHaveLength(0);
  });

  it("a malformed or missing uid is refused before Cloudflare is asked", async () => {
    const w = world();
    expect((await w.call({ uid: "not-a-uid" })).status).toBe(400);
    expect((await w.call({ uid: "" })).status).toBe(400);
    expect((await w.call({ action: "list" })).status).toBe(400);
    expect(w.seen.getVideo).toHaveLength(0);
  });

  it("the catalogue is fail-closed: a uid PAIGE has not registered is refused, provider untouched", async () => {
    const w = world();
    const res = await w.call({ uid: FOREIGN_VIDEO });
    expect(res.status).toBe(404);
    expect((await body(res)).code).toBe("MEDIA_NOT_IN_LIBRARY");
    expect(w.seen.getVideo).toHaveLength(0);
  });

  it("the catalogue's own video is served with its public metadata only", async () => {
    const w = world();
    const res = await w.call();
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.ok).toBe(true);
    const video = parsed.video as Record<string, unknown>;
    expect(video.uid).toBe(TEST_VIDEO);
    expect(video.status).toBe("ready");
    expect((video.playback as Record<string, unknown>).hls).toContain("m3u8");
    // Only non-secret fields exist on the answer — the token never has a place to appear.
    expect(Object.keys(video).sort()).toEqual(["created", "duration", "playback", "readyToStream", "status", "thumbnail", "uid"]);
  });

  it("an unconfigured adapter is the truthful needs-setup state, provider untouched", async () => {
    const w = world({ adapterConfigured: false });
    const res = await w.call();
    expect(res.status).toBe(503);
    expect((await body(res)).code).toBe("MEDIA_NOT_CONFIGURED");
    expect(w.seen.getVideo).toHaveLength(0);
  });

  it("provider refusals map to closed codes — no provider prose, no credential material", async () => {
    for (const [mode, status, code] of [
      ["refused", 502, "MEDIA_READ_FAILED"],
      ["missing", 404, "MEDIA_NOT_IN_LIBRARY"],
      ["transport", 502, "MEDIA_READ_FAILED"],
    ] as const) {
      const w = world({ getVideo: mode });
      const res = await w.call();
      expect(res.status).toBe(status);
      const parsed = await body(res);
      expect(parsed.code).toBe(code);
      expect(parsed.httpStatus).toBeUndefined();
    }
  });

  it("the expected tenant is honored when it matches the caller's active workspace", async () => {
    const w = world();
    const res = await w.call({ expected_tenant_id: MINE });
    expect(res.status).toBe(200);
    const mismatch = await w.call({ expected_tenant_id: "22222222-2222-4222-8222-222222222222" });
    expect(mismatch.status).toBe(403);
  });
});

async function handle(w: { call: (over?: Record<string, unknown>, init?: RequestInit) => Promise<Response> }, method: string) {
  // Reuse the world's wiring for the verb checks (the handler only reads method + body).
  return w.call({}, { method });
}
