// The REAL stream-media-command door (supabase/functions/_shared/stream-media-command/command.ts)
// driven through an in-memory world whose admin double ENFORCES the forward-only walk and
// bind-once (the RPC's own rules). resolveStudioCaller is doubled exactly as the other door
// tests double it (a Deno-runtime module proven by the growth-publish door's production use).
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
import { MINE, NEW_UID, THEIRS, USER, uploadingAsset, world } from "./stream-media-command.world";

const body = async (res: Response) => res.json() as Promise<Record<string, unknown>>;

describe("stream-media-command — the governed library upload/lifecycle door (EXP07 media slice 2)", () => {
  it("OPTIONS is open; other verbs are refused without touching anything", async () => {
    const w = world();
    const options = await w.call({}, { method: "OPTIONS" } as never);
    expect(options.status).toBe(204);
  });

  it("an unauthenticated caller is refused before the provider or the library is touched", async () => {
    const w = world({ user: null });
    const res = await w.call();
    expect(res.status).toBe(401);
    expect(w.seen.directCreate).toHaveLength(0);
    expect(w.seen.rpc).toHaveLength(0);
  });

  it("register: one provider slot + one library row; the response carries ONLY the one-time upload URL", async () => {
    const w = world();
    const res = await w.call({ title: "Spring webinar" });
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.ok).toBe(true);
    expect(parsed.upload_url).toBe("https://upload.videodelivery.net/one-time");
    const asset = parsed.asset as Record<string, unknown>;
    expect(asset.stream_uid).toBe(NEW_UID);
    expect(asset.status).toBe("uploading");
    // The API token never has a field to appear in.
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer|CLOUDFLARE_STREAM_API_TOKEN/i);
    expect(w.seen.rpc.at(-1)?.fn).toBe("tenant_media_asset_register");
  });

  it("register with a reconcile-pending uid is refused and the slot is not adopted", async () => {
    const w = world({ registerRefusesReconcile: true });
    const res = await w.call();
    expect(res.status).toBe(409);
    const parsed = await body(res);
    expect(parsed.code).toBe("MEDIA_REGISTRATION_REFUSED");
    expect(parsed.detail).toBe("retry_pending_reconciliation");
  });

  it("register anti-abuse: over the hourly per-user bound is a 429 with a retry-later sentence (not money)", async () => {
    const w = world();
    // Pre-seed the count read: 20 rows this hour by this user.
    for (let i = 0; i < 20; i++) w.assets.push(uploadingAsset({ id: `0000000c-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    const res = await w.call();
    expect(res.status).toBe(429);
    expect((await body(res)).code).toBe("MEDIA_RATE_LIMITED");
    expect(w.seen.directCreate).toHaveLength(0);
  });

  it("register on another workspace's name is refused by the caller chain", async () => {
    const w = world();
    const res = await w.call({ expected_tenant_id: THEIRS });
    expect(res.status).toBe(403);
  });

  it("status: uploading folds to processing when the provider says queued", async () => {
    const w = world({ assets: [uploadingAsset()], getVideo: "ok_queued" });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect((parsed.asset as Record<string, unknown>).status).toBe("processing");
  });

  it("status: processing folds to ready with the provider's playback/duration/thumbnail", async () => {
    const w = world({ assets: [uploadingAsset({ status: "processing" })], getVideo: "ok_ready" });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect((parsed.asset as Record<string, unknown>).status).toBe("ready");
    const video = parsed.video as Record<string, unknown>;
    expect((video.playback as Record<string, string>).hls).toContain("m3u8");
    expect(video.duration).toBe(61.5);
  });

  it("status: processing folds to failed on the provider's error", async () => {
    const w = world({ assets: [uploadingAsset({ status: "processing" })], getVideo: "ok_error" });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    expect((await body(res)).asset).toMatchObject({ status: "failed" });
  });

  it("status: a downloading provider state is a no-op fold (still processing, truthfully)", async () => {
    const w = world({ assets: [uploadingAsset({ status: "processing" })], getVideo: "ok_downloading" });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    const parsed = await body(res);
    expect((parsed.asset as Record<string, unknown>).status).toBe("processing");
    expect(parsed.provider_status).toBe("downloading");
  });

  it("status: the uploading→ready RACE is not force-walked — the row waits for processing first", async () => {
    const w = world({ assets: [uploadingAsset()], getVideo: "ok_ready_from_uploading" });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    const parsed = await body(res);
    expect((parsed.asset as Record<string, unknown>).status).toBe("uploading");
    expect(w.seen.rpc.filter((r) => r.fn === "tenant_media_asset_set_status")).toHaveLength(0);
  });

  it("status: a provider transport failure leaves the library UNCHANGED (retryable, never a fake state)", async () => {
    const w = world({ assets: [uploadingAsset({ status: "processing" })], getVideo: "transport" });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    expect(res.status).toBe(502);
    expect((await body(res)).code).toBe("MEDIA_READ_FAILED");
    expect(w.seen.rpc.filter((r) => r.fn === "tenant_media_asset_set_status")).toHaveLength(0);
  });

  it("status: a foreign workspace's asset is not found, never adopted", async () => {
    const w = world({ assets: [uploadingAsset({ tenant_id: THEIRS })] });
    const res = await w.call({ action: "status", asset_id: uploadingAsset().id });
    expect(res.status).toBe(404);
    expect((await body(res)).code).toBe("MEDIA_NOT_FOUND");
  });

  it("revoke: a live row is revoked; a revoked row cannot be touched again", async () => {
    const w = world({ assets: [uploadingAsset({ status: "ready" })] });
    const res = await w.call({ action: "revoke", asset_id: uploadingAsset().id });
    expect(res.status).toBe(200);
    expect((await body(res)).state).toBe("revoked");
    const again = await w.call({ action: "revoke", asset_id: uploadingAsset().id });
    expect(again.status).toBe(409);
  });

  it("a malformed asset id or unknown action is refused before anything is touched", async () => {
    const w = world();
    expect((await w.call({ action: "status", asset_id: "nope" })).status).toBe(400);
    expect((await w.call({ action: "delete" })).status).toBe(400);
    expect(w.seen.getVideo).toHaveLength(0);
    expect(w.seen.rpc).toHaveLength(0);
  });
});
