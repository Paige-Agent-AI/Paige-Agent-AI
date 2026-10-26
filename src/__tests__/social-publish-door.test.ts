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
  return {
    governSocialMutation: vi.fn(async (input: {
      approvedFingerprint?: string | null;
      requestArgs: Record<string, unknown>;
      summary: string;
    }) => {
      if (input.approvedFingerprint) {
        if (consumed.has(input.approvedFingerprint)) {
          return { kind: "refuse", code: "approval_claim_missing", message: "The approval was already used.", decision: { kind: "refuse" } };
        }
        consumed.add(input.approvedFingerprint);
        return { kind: "execute", args: input.requestArgs, confirmationId: "conf-" + input.approvedFingerprint, decision: { kind: "execute" } };
      }
      return {
        kind: "approval_required",
        fingerprint: consumed.size.toString(16).padStart(16, "0"),
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
    expect(r.body.approval.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(r.body.approval.summary).toContain("Spring workshop reminder");
    expect(r.body.approval.summary).toContain("instagram");
    expect(r.body.preview).toMatchObject({ piece_id: PIECE, platform: "instagram", channel_label: "Northfield Coaching (main)" });
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
  });

  it("second call with the fingerprint: claims, executes once, records the receipt with the provider's own id/url", async () => {
    const w = world();
    const first = await w.call(publishBody());
    const fingerprint = first.body.approval.fingerprint;
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
    const fp = first.body.approval.fingerprint;
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
    const r = await w.call(publishBody({ approved_fingerprint: first.body.approval.fingerprint }));
    expect(r.status).toBe(502);
    expect(r.body.state).toBe("failed");
    expect(r.body.code).toBe("PROVIDER_REJECTED");
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish");
    expect(receipt?.outcome).toBe("capability_failed");
  });

  it("a thrown provider error → failed with the provider's own code", async () => {
    const w = world({ createPostThrows: { code: "provider_rate_limited" } });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: first.body.approval.fingerprint }));
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ state: "failed", code: "provider_rate_limited" });
  });

  it("provider accepted but processing (async) → outcome_unknown: the post MAY exist, the message says so", async () => {
    const w = world({ createPost: () => ({ kind: "processing" as const, requestId: "req_789" }) });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: first.body.approval.fingerprint }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, state: "outcome_unknown", request_id: "req_789" });
    expect(r.body.error).toContain("may have posted");
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish");
    expect(receipt?.outcome).toBe("capability_outcome_unknown");
  });

  it("transport uncertainty → outcome_unknown, never failed", async () => {
    const w = world({ createPost: () => ({ kind: "unknown" as const, requestId: null, reason: "AbortError" }) });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: first.body.approval.fingerprint }));
    expect(r.body.state).toBe("outcome_unknown");
    expect(w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish")?.outcome).toBe("capability_outcome_unknown");
  });

  it("the connection recheck after the claim: a revoked connection publishes nothing", async () => {
    const w = world({ revokeAfterClaim: true });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: first.body.approval.fingerprint }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONNECTION_REVOKED");
    expect(r.body.error).toContain("Reconnect it");
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
    expect(w.seen.receipts.find((x) => x.capabilityKey === "social.post_publish")?.outcome).toBe("capability_refused");
  });

  it("a plain member (not owner/admin) is refused by the caller gate", async () => {
    const w = world({ admin: false });
    const r = await w.call(publishBody());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("CALLER_NOT_ADMIN");
  });

  it("a caller in a different workspace than the piece's is refused, never cross-served", async () => {
    const w = world({ active: THEIRS });
    const r = await w.call(publishBody());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("CALLER_OTHER_WORKSPACE");
  });

  it("a custom caption is what the provider receives — the piece title is only the default", async () => {
    const w = world();
    const first = await w.call(publishBody({ caption: "Join us Thursday! #workshop" }));
    const r = await w.call(publishBody({ approved_fingerprint: first.body.approval.fingerprint, caption: "Join us Thursday! #workshop" }));
    expect(r.body.state).toBe("published");
    expect(w.seen.createPost[0].text).toBe("Join us Thursday! #workshop");
  });
});
