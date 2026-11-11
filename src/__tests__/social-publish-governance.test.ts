import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { world, publishBody, USER, THEIRS } from "./social-publish-door.world.ts";

// No module doubles: the original door, Social governance, fingerprint, risk map,
// decision seam, caller resolution and receipt writer run together. Only the
// database/provider boundaries are synthetic; this is not live provider proof.
describe("Social publication through the real governance path", () => {
  it("classifies the existing approval identity as high risk", () => {
    expect(classifyAction("social_post_publish")).toBe("high");
  });

  it.each(["confirm", "auto"])("requires a stored preview in the %s lane, then consumes it once", async lane => {
    const w = world({ lane });
    const preview = await w.call(publishBody());
    expect(preview.status).toBe(202);
    expect(preview.body.state).toBe("approval_required");
    expect(w.seen.createPost).toHaveLength(0);
    expect(w.seen.rpc.filter(call => call.fn === "resolve_tool_autonomy").map(call => call.args?._tool_key))
      .toEqual(["social.post_publish", "social_post_publish"]);
    const approval = w.tables.paige_pending_confirmations[0];
    expect(approval).toMatchObject({ user_id: USER, tool_name: "social.post_publish", consumed_at: null });
    const fingerprint = (preview.body.approval as Record<string, string>).fingerprint;
    expect(approval.fingerprint).toBe(fingerprint);
    const result = await w.call(publishBody({ approved_fingerprint: fingerprint }));
    expect(result.body.state).toBe("published");
    expect(w.seen.createPost).toHaveLength(1);
    expect(approval.consumed_at).toEqual(expect.any(String));
    expect(w.tables.content_publications[0].confirmation_id).toBe(approval.id);
    expect(w.seen.receipts).toHaveLength(1);
    expect(w.seen.receipts[0]).toMatchObject({ _capability_key: "social_post_publish", _outcome: "capability_succeeded" });
    const replay = await w.call(publishBody({ approved_fingerprint: fingerprint }));
    expect(replay.body.state).toBe("approval_required");
    expect(w.seen.createPost).toHaveLength(1);
    expect(w.seen.receipts).toHaveLength(1);
  });

  it.each(["off", "unrecognized"])("refuses the %s lane without minting an approval or posting", async lane => {
    const w = world({ lane });
    const result = await w.call(publishBody());
    expect(result.status).toBe(409);
    expect(w.tables.paige_pending_confirmations ?? []).toHaveLength(0);
    expect(w.seen.createPost).toHaveLength(0);
  });

  it.each([
    { lane: "off", canonicalLane: "auto" },
    { lane: "auto", canonicalLane: "off" },
    { lane: "auto", canonicalLaneError: true },
    { lane: "auto", canonicalLane: "unrecognized" },
  ])("retains both autonomy brakes and refuses an unreadable canonical control: %o", async options => {
    const w = world(options);
    const result = await w.call(publishBody());
    expect(result.status).toBe(409);
    expect(w.tables.paige_pending_confirmations ?? []).toHaveLength(0);
    expect(w.seen.createPost).toHaveLength(0);
  });

  it.each([
    ["actor", { user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["tenant", { tenant_id: THEIRS }],
    ["action", { tool_name: "social_connection_start" }],
    ["expiry", { expires_at: "2000-01-01T00:00:00Z" }],
    ["fingerprint", { fingerprint: "0000000000000000" }],
    ["consumption", { consumed_at: "2026-01-01T00:00:00Z" }],
    ["server issuance", { server_issued_at: null }],
    ["request issuance", { issued_in_request: null }],
    ["thread scope", { thread_id: "another-thread" }],
    ["client scope", { scoped_client_id: "another-client" }],
  ])("does not claim an approval with changed %s", async (_name, patch) => {
    const w = world();
    const preview = await w.call(publishBody());
    expect(preview.status).toBe(202);
    const fingerprint = (preview.body.approval as Record<string, string>).fingerprint;
    Object.assign(w.tables.paige_pending_confirmations[0], patch);
    const result = await w.call(publishBody({ approved_fingerprint: fingerprint }));
    expect(result.body.state).toBe("approval_required");
    expect(w.seen.createPost).toHaveLength(0);
    expect(w.tables.content_publications).toHaveLength(0);
  });

  it("refuses a changed caption after the original stored approval is claimed", async () => {
    const w = world();
    const preview = await w.call(publishBody());
    expect(preview.status).toBe(202);
    const fingerprint = (preview.body.approval as Record<string, string>).fingerprint;
    const result = await w.call(publishBody({ caption: "Changed words", approved_fingerprint: fingerprint }));
    expect(result.body).toMatchObject({ state: "refused", code: "CLAIM_MISMATCH" });
    expect(w.seen.createPost).toHaveLength(0);
    expect(w.tables.content_publications).toHaveLength(0);
  });
});
