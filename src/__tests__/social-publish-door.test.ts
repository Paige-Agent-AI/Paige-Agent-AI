// The REAL social publish door (supabase/functions/_shared/social-publish-command/door.ts) driven
// by an in-memory world (social-publish-door.world.ts). The door's own code decides everything;
// only the clients, the provider adapter, and the governance seam (which is Deno-runtime and
// proven separately by paige-social's production use) are doubles.
import { describe, expect, it, vi } from "vitest";

// The governance module (governSocialMutation → decideGovernedExecution) runs in Deno edge
// functions and has Deno-specific dependencies (paige-spine's governedExecution.ts). It is
// production-proven by paige-social. Here we double it to test the DOOR's own logic: every
// branch the door takes on each governance answer (proposal/claim/refusal).
vi.mock("../../supabase/functions/_shared/social-provider/governance.ts", () => {
  // Track fingerprints the double has issued and consumed — mirrors the REAL module's single-use
  // CAS on paige_pending_confirmations.consumed_at.
  const consumed = new Set<string>();
  const proposals = new Map<string, Record<string, unknown>>();
  return {
    governSocialMutation: vi.fn(async (input: {
      approvedFingerprint?: string | null;
      requestArgs: Record<string, unknown>;
      summary: string;
    }) => {
      if (input.approvedFingerprint && !consumed.has(input.approvedFingerprint)) {
        const stored = proposals.get(input.approvedFingerprint);
        if (stored) { consumed.add(input.approvedFingerprint); return { kind: "execute", args: stored, confirmationId: "conf-" + input.approvedFingerprint, decision: { kind: "execute" } }; }
      }
      if (input.approvedFingerprint) {
        if (consumed.has(input.approvedFingerprint)) {
          return { kind: "refuse", code: "approval_claim_missing", message: "The approval was already used.", decision: { kind: "refuse" } };
        }
        consumed.add(input.approvedFingerprint);
        return { kind: "execute", args: input.requestArgs, confirmationId: "conf-" + input.approvedFingerprint, decision: { kind: "execute" } };
      }
      const fingerprint = consumed.size.toString(16).padStart(16, "0");
      proposals.set(fingerprint, input.requestArgs);
      return {
        kind: "approval_required",
        fingerprint,
        summary: input.summary,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        revalidate: false,
        decision: { kind: "approval_required" },
      };
    }),
  };
});

// The capability-record module uses crypto.subtle (Deno-native) and the studio-caller module
// has its own RPC chain — both are Deno-runtime modules proven by the growth-publish door's
// production use. Here we double them so the tests prove THIS door's branching logic.
vi.mock("../../supabase/functions/_shared/capability-record.ts", () => ({
  recordCapabilityRun: vi.fn(async (admin: unknown, args: Record<string, unknown>) => {
    const { rpc } = admin as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
    await rpc("record_capability_run", args);
  }),
  stableRunId: vi.fn(async (parts: Array<string | null | undefined>) =>
    "run-" + (parts ?? []).filter(Boolean).join("-").slice(0, 32)),
}));
vi.mock("../../supabase/functions/_shared/studio-caller.ts", () => ({
  resolveStudioCaller: vi.fn(async (caller: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }, requestedTenant: unknown) => {
    const { data: active } = await caller.rpc("current_user_tenant_id");
    if (typeof active !== "string" || !active) return { ok: false, status: 403, error: "Open one of your workspaces first.", reason: "no_workspace" };
    if (requestedTenant != null && requestedTenant !== "" && String(requestedTenant).toLowerCase() !== active) {
      return { ok: false, status: 403, error: "That isn't the workspace you're signed in to.", reason: "other_workspace" };
    }
    const { data: isAdmin } = await caller.rpc("is_tenant_admin", { _tenant: active });
    if (isAdmin !== true) {
      const { data: manages } = await caller.rpc("agency_can_manage_child", { _child: active });
      if (manages !== true) return { ok: false, status: 403, error: "Only this workspace's owner or an admin can use this.", reason: "not_admin" };
    }
    return { ok: true, tenantId: active };
  }),
}));

import {
  world, publishBody, connectedRow, pieceRow, MINE, THEIRS, USER, PIECE, FOREIGN_PIECE, CONNECTION,
} from "./social-publish-door.world.ts";

describe("social publish door — proposal, owner approval, provider execution, receipt (EXP07 row 10)", () => {
  it("first call: proposes with the exact preview and asks for approval — nothing is executed", async () => {
    const w = world();
    const r = await w.call(publishBody());
    expect(r.status).toBe(202);
    expect(r.body.state).toBe("approval_required");
    expect((r.body.approval as Record<string, string>).fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect((r.body.approval as Record<string, string>).summary).toContain("Spring workshop reminder");
    expect((r.body.approval as Record<string, string>).summary).toContain("instagram");
    expect(r.body.preview).toMatchObject({ piece_id: PIECE, platform: "instagram", channel_label: "Northfield Coaching (main)" });
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
  });

  it("second call with the fingerprint: claims, executes once, records the receipt with the provider's own id/url", async () => {
    const w = world();
    const first = await w.call(publishBody());
    const fingerprint = (first.body.approval as Record<string, string>).fingerprint;
    const r = await w.call(publishBody({ approved_fingerprint: fingerprint }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, state: "published", platform: "instagram", post_url: "https://instagram.com/p/abc123", post_id: "up_123" });
    // The provider was called EXACTLY once, under the claimed args.
    expect(w.seen.createPost).toHaveLength(1);
    expect(w.seen.createPost[0]).toMatchObject({ platform: "instagram", text: "Spring workshop reminder" });
    // The capability receipt was recorded with the succeeded outcome and the URL.
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish");
    expect(receipt?.outcome).toBe("capability_succeeded");
    expect(receipt?.detail).toMatchObject({ url: "https://instagram.com/p/abc123" });
  });

  it("a replayed fingerprint is refused — the claim was consumed, so a duplicate publish is impossible", async () => {
    const w = world();
    const first = await w.call(publishBody());
    const fp = (first.body.approval as Record<string, string>).fingerprint;
    await w.call(publishBody({ approved_fingerprint: fp }));
    const replay = await w.call(publishBody({ approved_fingerprint: fp }));
    expect(replay.status).toBe(409);
    expect(replay.body.state).toBe("refused");
    expect(w.seen.createPost).toHaveLength(1); // still exactly one execution
  });

  it("a foreign workspace's piece is not found, never adopted", async () => {
    const w = world();
    const r = await w.call(publishBody({ content_id: FOREIGN_PIECE }));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("CONTENT_NOT_FOUND");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("a channel with no connection says connect first; needs_reauth says reconnect", async () => {
    const none = world({ tables: { paige_social_connections: [] } });
    expect((await none.call(publishBody())).body.code).toBe("NO_CONNECTION");
    const reauth = world({ tables: { paige_social_connections: [connectedRow({ status: "needs_reauth" })] } });
    const r = await reauth.call(publishBody());
    expect(r.body.code).toBe("NEEDS_REAUTH");
    expect(r.body.error).toContain("Settings → Integrations");
  });

  it("reconcile-before-retry: an outcome_unknown attempt for the same piece+platform blocks a new one", async () => {
    const w = world({ pendingReconcile: true });
    const r = await w.call(publishBody());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("RETRY_PENDING_RECONCILIATION");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("an unconfigured provider answers needs_setup truthfully — nothing runs", async () => {
    const w = world({ adapterConfigured: false });
    const r = await w.call(publishBody());
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("PUBLISHING_NOT_CONFIGURED");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("provider refusal (2xx with per-platform error) → failed, nothing claimed as published", async () => {
    const w = world({
      createPost: () => ({ kind: "published" as const, results: [{ platform: "instagram", success: false, postId: null, postUrl: null, error: "rate limited by platform" }] }),
    });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.status).toBe(502);
    expect(r.body.state).toBe("failed");
    expect(r.body.code).toBe("PROVIDER_REJECTED");
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish");
    expect(receipt?.outcome).toBe("capability_failed");
  });

  it("a thrown provider error → failed with the provider's own code", async () => {
    const w = world({ createPostThrows: { code: "provider_rate_limited" } });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ state: "failed", code: "provider_rate_limited" });
  });

  it("provider accepted but processing (async) → outcome_unknown: the post MAY exist, the message says so", async () => {
    const w = world({ createPost: () => ({ kind: "processing" as const, requestId: "req_789" }) });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, state: "outcome_unknown", request_id: "req_789" });
    expect(r.body.error).toContain("may have posted");
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish");
    expect(receipt?.outcome).toBe("capability_outcome_unknown");
  });

  it("transport uncertainty → outcome_unknown, never failed", async () => {
    const w = world({ createPost: () => ({ kind: "unknown" as const, requestId: null, reason: "AbortError" }) });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.body.state).toBe("outcome_unknown");
    expect(w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish")?.outcome).toBe("capability_outcome_unknown");
  });

  it("the connection recheck after the claim: a revoked connection publishes nothing", async () => {
    const w = world({ revokeAfterClaim: true });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONNECTION_REVOKED");
    expect(r.body.error).toContain("Reconnect it");
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
    expect(w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish")?.outcome).toBe("capability_refused");
  });

  it("a plain member (not owner/admin) is refused — no publish happens", async () => {
    const w = world({ admin: false });
    const r = await w.call(publishBody());
    // 403 (not admin) or 404 (the member can't even see the piece) — both prove no publish.
    expect([403, 404]).toContain(r.status);
    expect(r.body.ok).toBe(false);
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("a caller in a different workspace than the piece's gets not-found — never cross-served", async () => {
    const w = world({ active: THEIRS });
    const r = await w.call(publishBody());
    // The piece is tenant-scoped to MINE; the THEIRS caller's read finds nothing — 404 IS the
    // cross-workspace protection (the piece is never visible outside its workspace).
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("CONTENT_NOT_FOUND");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("a custom caption is what the provider receives — the piece title is only the default", async () => {
    const w = world();
    const first = await w.call(publishBody({ caption: "Join us Thursday! #workshop" }));
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint, caption: "Join us Thursday! #workshop" }));
    expect(r.body.state).toBe("published");
    expect(w.seen.createPost[0].text).toBe("Join us Thursday! #workshop");
  });

  it("independent review #1 — an approve whose body names a DIFFERENT piece/channel than the proposal is refused; the claim never executes", async () => {
    const w = world();
    const first = await w.call(publishBody());
    const fp = (first.body.approval as Record<string, string>).fingerprint;
    // The proposal was for instagram/PIECE; the approve call swaps the channel in its body.
    // Both channels are connected so the pre-claim readiness check passes on the WRONG channel —
    // only the claim binding check can catch it.
    w.tables.paige_social_connections.push(connectedRow({ id: "55555555-5555-4555-8555-555555555556", requested_platform: "facebook", provider_profile_key: "ps_bbbb000000000000000000000000000000000000" }) as never);
    const r = await w.call(publishBody({ approved_fingerprint: fp, platform: "facebook" }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CLAIM_MISMATCH");
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
  });

  it("independent review #2 — an in-flight or crashed attempt (approved/publishing) blocks a second approval entirely", async () => {
    const w = world({ tables: { content_publications: [{ id: "pub-stuck", tenant_id: MINE, content_id: PIECE, platform: "instagram", status: "publishing", created_at: new Date().toISOString() }] as never } });
    const first = await w.call(publishBody()); // a NEW proposal is still allowed…
    expect(first.status).toBe(202);
    const fp = (first.body.approval as Record<string, string>).fingerprint;
    const r = await w.call(publishBody({ approved_fingerprint: fp })); // …but the approve is refused
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("RETRY_PENDING_RECONCILIATION");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("surface-agnostic (Team Hub reachability pin): a request naming a different surface changes NOTHING about the door's authority path", async () => {
    // The owner directive (2026-10-27): EXP07's agent must conduct its work from the Team Hub
    // too. The door admits it because authority derives from resolveStudioCaller (actor JWT +
    // active workspace) — there is no surface token to read. This pins that: a body carrying an
    // origin/surface extra takes the IDENTICAL approval path with the identical preview.
    const w = world();
    const solo = await w.call(publishBody());
    const hub = await w.call(publishBody({ surface: "team_hub", origin: "team-hub" } as never));
    expect(solo.status).toBe(202);
    expect(hub.status).toBe(202);
    expect((hub.body.approval as Record<string, string>).summary).toBe((solo.body.approval as Record<string, string>).summary);
    expect((hub.body.preview as Record<string, unknown>).platform).toBe("instagram");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("the exact body the shipped UI sends on approve (piece + channel + caption + fingerprint) executes and publishes", async () => {
    const w = world();
    const first = await w.call(publishBody());
    const fp = (first.body.approval as Record<string, string>).fingerprint;
    const r = await w.call(publishBody({ approved_fingerprint: fp, caption: "Spring workshop reminder" }));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("published");
    expect(w.seen.createPost).toHaveLength(1);
  });
});
