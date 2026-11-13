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
  world, publishBody, connectedRow, accountRow, pieceRow, MINE, THEIRS, USER, PIECE, FOREIGN_PIECE, CONNECTION, PUBLICATION, ACCOUNT,
} from "./social-publish-door.world.ts";

describe("original publication performance cache",()=>{
  const receipt = (over:Record<string,unknown>={})=>({ id:PUBLICATION,tenant_id:MINE,content_id:PIECE,platform:"threads",status:"published",connection_id:CONNECTION,
    provider_request_id:"original-provider-request",provider_post_id:"original-native-post",provider_post_url:"https://www.threads.com/@fixture/post/one",
    request_args:{account_id:ACCOUNT,caption:"Original caption",platform:"threads",content_id:PIECE},provider_response:{results:[{success:true}]},...over });
  const setup=(over:Parameters<typeof world>[0]={})=>world({...over,tables:{paige_social_connections:[connectedRow({requested_platform:"threads"})],paige_social_accounts:[accountRow({platform:"threads"})],content_publications:[receipt()],...over.tables}});
  const body={action:"performance",expected_tenant_id:MINE,content_id:PIECE,publication_id:PUBLICATION};
  it("reads only the original exact account/post, caches through its original writer and never sends",async()=>{
    const w=setup(),answer=await w.call(body);
    expect(answer.body).toMatchObject({state:"performance",publication_id:PUBLICATION,analytics:{state:"available",metrics:{views:0,likes:2}}});
    expect(w.seen.performanceReads).toMatchObject([{providerAccountId:"zernio-account-1",requestId:"original-provider-request",postId:"original-native-post",platform:"threads"}]);
    expect(w.seen.createPost).toEqual([]);expect(w.seen.readPost).toEqual([]);
    expect(w.tables.content_publications[0]).toMatchObject({id:PUBLICATION,status:"published",provider_post_id:"original-native-post",provider_request_id:"original-provider-request",provider_response:{results:[{success:true}],analytics:{state:"available"}}});
  });
  it("uses the original persisted cache for 60 minutes without another provider read",async()=>{
    const w=setup({tables:{content_publications:[receipt({provider_response:{analytics:{state:"available",checked_at:new Date().toISOString(),metrics:{likes:0},measured_at:null}}})]}});
    expect((await w.call(body)).body).toMatchObject({state:"performance",cached:true,analytics:{metrics:{likes:0}}});expect(w.seen.performanceReads).toEqual([]);
  });
  it.each([{admin:false},{active:THEIRS},{tables:{content_publications:[receipt({tenant_id:THEIRS})]}},{tables:{content_publications:[receipt({status:"outcome_unknown"})]}},{tables:{paige_social_accounts:[accountRow({id:"foreign",platform:"threads"})]} }])("refuses source/role/tenant/terminal mismatch before provider reads %j",async over=>{
    const w=setup(over);expect((await w.call(body)).status).toBeGreaterThanOrEqual(400);expect(w.seen.performanceReads).toEqual([]);expect(w.seen.createPost).toEqual([]);
  });
  it("does not present unrecorded performance when the original native writer refuses",async()=>{
    const w=setup({performanceReceiptFails:true}),answer=await w.call(body);expect(answer.status).toBeGreaterThanOrEqual(400);expect(answer.body.analytics).toBeUndefined();expect(w.seen.createPost).toEqual([]);
  });
  it("rechecks current authority after the provider read and refuses a revoked writer",async()=>{
    const options:Parameters<typeof world>[0]={};options.readPerformance=()=>{options.admin=false;return {state:"available",metrics:{likes:1},measured_at:null};};
    const w=setup(options); // setup copies options, so revoke the actual caller seam after the read.
    w.adapter.readPerformance=async()=>{w.caller.rpc=async()=>({data:false,error:null});return {state:"available",metrics:{likes:1},measured_at:null};};
    expect((await w.call(body)).status).toBe(403);expect(w.seen.rpc.filter(r=>r.fn==="content_publication_record")).toEqual([]);
  });
  it("reads the receipt-bound still-connected account after a different own publishing account is selected",async()=>{
    const w=setup({tables:{paige_social_accounts:[accountRow({platform:"threads",selected:false}),accountRow({id:"99999999-9999-4999-8999-999999999999",platform:"threads",account_id:"another-own-account",selected:true})]}});
    expect((await w.call(body)).body).toMatchObject({state:"performance"});expect(w.seen.performanceReads[0]?.providerAccountId).toBe("zernio-account-1");expect(w.seen.createPost).toEqual([]);
  });
});

const MEDIA_ID = "88888888-8888-4888-8888-888888888888";
const MEDIA_PATH = `${MINE}/saved/${MEDIA_ID}.png`;
const MEDIA_FACTS = { contentType: "image/png", size: 16, etag: '"saved-object"', lastModified: "2026-11-13T12:00:00.000Z" };
function mediaWorld(over: Parameters<typeof world>[0] = {}) {
  return world({ ...over, storageObjects: { [MEDIA_PATH]: { ...MEDIA_FACTS } }, tables: {
    marketing_content: [pieceRow({ channel: "social_post", meta: { media_content_ids: [MEDIA_ID] } }),
      pieceRow({ id: MEDIA_ID, kind: "image", title: "Original saved image", image_path: MEDIA_PATH,
        image_url: `https://test-project.supabase.co/storage/v1/object/public/paige-generated/${MEDIA_PATH}` })],
    paige_social_connections: [connectedRow({ requested_platform: "threads" })],
    paige_social_accounts: [accountRow({ platform: "threads" })],
    ...over.tables,
  } });
}

describe("media on the original governed publication attempt", () => {
  it("previews saved media and dispatches only the exact approved snapshot", async () => {
    const w = mediaWorld();
    const first = await w.call(publishBody({ platform: "threads" }));
    expect(first.status).toBe(202);
    expect((first.body.preview as Record<string, unknown>).media).toEqual([expect.objectContaining({ content_id: MEDIA_ID, type: "image" })]);
    expect(w.seen.createPost).toHaveLength(0);
    const r = await w.call(publishBody({ platform: "threads", approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.body.state).toBe("published");
    expect(w.seen.createPost).toHaveLength(1);
    expect(w.seen.createPost[0].media).toEqual([expect.objectContaining({ type: "image", contentType: "image/png", size: 16, readBytes: expect.any(Function) })]);
    expect(JSON.stringify(w.seen.createPost[0])).not.toContain(MINE);
    expect(w.seen.reads.filter(r => r.table === "marketing_content").every(r => r.client === "caller")).toBe(true);
  });
  it("rejects an unsaved media selection instead of approving different assets", async () => {
    const w = mediaWorld();
    const r = await w.call(publishBody({ platform: "threads", media_content_ids: [FOREIGN_PIECE] }));
    expect(r.body.code).toBe("MEDIA_SELECTION_CHANGED");expect(w.seen.createPost).toHaveLength(0);
  });
  it("invalidates the original approval after the saved asset revision changes", async () => {
    const w = mediaWorld();
    const first = await w.call(publishBody({ platform: "threads" }));
    // The effect-time recheck is independently exercised below. Here the saved asset revision
    // changes between prepare and claim, and must no longer match the stored approval.
    w.tables.marketing_content[1].updated_at = "2026-11-13T12:01:00.000Z";
    const r = await w.call(publishBody({ platform: "threads", approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.body.code).toBe("CLAIM_MISMATCH");expect(w.seen.createPost).toHaveLength(0);
  });
  it("re-reads original media after native binding and refuses a changed asset before dispatch", async () => {
    const w = mediaWorld({ onBind: tables => { tables.marketing_content[1].updated_at = "2026-11-13T12:02:00.000Z"; } });
    const first = await w.call(publishBody({ platform: "threads" }));
    const r = await w.call(publishBody({ platform: "threads", approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.body.code).toBe("MEDIA_CONTEXT_CHANGED");expect(w.seen.createPost).toHaveLength(0);
    expect(w.tables.content_publications[0].status).toBe("refused");
  });
  it("refuses foreign media before privileged storage or provider reads", async () => {
    const w = mediaWorld(); w.tables.marketing_content[1].tenant_id = THEIRS;
    const r = await w.call(publishBody({ platform: "threads" }));
    expect(r.body.code).toBe("MEDIA_NOT_AVAILABLE");
    expect(w.seen.storageReads).toEqual([]);expect(w.seen.destinationReads).toEqual([]);expect(w.seen.createPost).toEqual([]);
  });
  it("states unsupported media truthfully on platforms outside the implemented media contract", async () => {
    const w = mediaWorld();
    const r = await w.call(publishBody({ platform: "instagram" }));
    expect(r.body.code).toBe("MEDIA_PLATFORM_UNSUPPORTED");expect(w.seen.createPost).toEqual([]);
  });
  it.each(["role", "parent", "asset", "connection"])("refuses %s changes during upload at the final dispatch boundary", async changed => {
    const w=mediaWorld(), originalCreate=w.adapter.createPost;
    w.adapter.createPost=async input=>{
      if(changed==="role") {const rpc=w.caller.rpc;w.caller.rpc=async(fn,args)=>fn==="is_tenant_admin"?{data:false,error:null}:rpc(fn,args);}
      if(changed==="parent")w.tables.marketing_content[0].updated_at="2026-11-13T12:10:00.000Z";
      if(changed==="asset")w.tables.marketing_content[1].status="archived";
      if(changed==="connection")w.tables.paige_social_connections[0].status="disconnected";
      await input.beforePublish!();
      return originalCreate(input);
    };
    const first=await w.call(publishBody({platform:"threads"}));
    const result=await w.call(publishBody({platform:"threads",approved_fingerprint:(first.body.approval as Record<string,string>).fingerprint}));
    expect(result.body).toMatchObject({state:"refused",code:"PUBLICATION_CONTEXT_CHANGED"});
    expect(w.seen.createPost).toHaveLength(0);expect(w.tables.content_publications[0].status).toBe("refused");
  });
});

describe("social publish door — proposal, owner approval, provider execution, receipt (EXP07 row 10)", () => {
  it("reads protected content with the signed-in caller before preview and execution despite denied service SELECT", async () => {
    const w = world();
    const preview = await w.call(publishBody());
    expect(preview.status).toBe(202);
    const result = await w.call(publishBody({ approved_fingerprint: (preview.body.approval as Record<string, string>).fingerprint }));
    expect(result.body.state).toBe("published");
    expect(w.seen.createPost).toHaveLength(1);
    expect(w.tables.content_publications).toHaveLength(1);
    expect(w.seen.reads.filter(read => read.table === "marketing_content").every(read => read.client === "caller")).toBe(true);
  });

  it("refuses protected content the caller cannot read before any destination lookup or publication binding", async () => {
    const w = world({ callerContentReadDenied: true });
    const result = await w.call(publishBody());
    expect(result.body.code).toBe("CONTENT_NOT_FOUND");
    expect(w.seen.destinationReads).toHaveLength(0);
    expect(w.seen.createPost).toHaveLength(0);
    expect(w.tables.content_publications).toHaveLength(0);
    expect(w.seen.rpc.some(call => call.fn === "content_publication_bind")).toBe(false);
  });

  it("rechecks protected content with current caller access after binding and refuses a revoked read without posting", async () => {
    const w = world({ revokeContentAfterClaim: true });
    const preview = await w.call(publishBody());
    expect(preview.status).toBe(202);
    const result = await w.call(publishBody({ approved_fingerprint: (preview.body.approval as Record<string, string>).fingerprint }));
    expect(result.body).toMatchObject({ state: "refused", code: "CONNECTION_REVOKED" });
    expect(w.tables.content_publications).toHaveLength(1);
    expect(w.tables.content_publications[0].status).toBe("refused");
    expect(w.seen.createPost).toHaveLength(0);
  });

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
    expect(w.seen.createPost[0]).toMatchObject({
      platform: "instagram", providerAccountId: "zernio-account-1", text: "Spring workshop reminder", externalId: PUBLICATION,
    });
    // The capability receipt was recorded with the succeeded outcome and the URL.
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social_post_publish");
    expect(receipt?.outcome).toBe("capability_succeeded");
    expect(receipt?.detail).toMatchObject({ publication_id: PUBLICATION });
    expect(receipt?.detail).not.toHaveProperty("url");
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
      createPost: () => ({ kind: "published" as const, results: [{ platform: "instagram", success: false, postId: null, postUrl: null, error: "provider_rejected" }] }),
    });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.status).toBe(502);
    expect(r.body.state).toBe("failed");
    expect(r.body.code).toBe("provider_rejected");
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social_post_publish");
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
    expect(r.body).toMatchObject({ ok: false, state: "outcome_unknown", publication_id: PUBLICATION });
    expect(r.body.error).toContain("still processing");
    expect(w.tables.content_publications[0].provider_request_id).toBe("req_789");
    const receipt = w.seen.receipts.find((x) => x.capabilityKey === "social_post_publish");
    expect(receipt?.outcome).toBe("capability_outcome_unknown");
  });

  it("transport uncertainty → outcome_unknown, never failed", async () => {
    const w = world({ createPost: () => ({ kind: "unknown" as const, requestId: null, reason: "AbortError" }) });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.body.state).toBe("outcome_unknown");
    expect(w.seen.receipts.find((x) => x.capabilityKey === "social_post_publish")?.outcome).toBe("capability_outcome_unknown");
  });

  it("the connection recheck after the claim: a revoked connection publishes nothing", async () => {
    const w = world({ revokeAfterClaim: true });
    const first = await w.call(publishBody());
    const r = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONNECTION_REVOKED");
    expect(r.body.error).toContain("Nothing was published");
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
    expect(w.seen.receipts.find((x) => x.capabilityKey === "social_post_publish")?.outcome).toBe("capability_refused");
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
    w.tables.paige_social_accounts.push(accountRow({ connection_id: "55555555-5555-4555-8555-555555555556", platform: "facebook" }));
    const r = await w.call(publishBody({ approved_fingerprint: fp, platform: "facebook" }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CLAIM_MISMATCH");
    expect(w.seen.createPost).toHaveLength(0); // the provider was never called
  });

  it("independent review #2 — an in-flight or crashed attempt (approved/publishing) blocks a second approval entirely", async () => {
    const w = world({ tables: { content_publications: [{ id: "pub-stuck", tenant_id: MINE, content_id: PIECE, platform: "instagram", status: "publishing", created_at: new Date().toISOString() }] as never } });
    const r = await w.call(publishBody());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("RETRY_PENDING_RECONCILIATION");
    expect(w.seen.createPost).toHaveLength(0);
  });

  it("refuses a previously approved post after the saved revision or selected account changes", async () => {
    const draft = world();
    const first = await draft.call(publishBody());
    const fingerprint = (first.body.approval as Record<string, string>).fingerprint;
    draft.tables.marketing_content[0].updated_at = "2026-10-21T10:00:00Z";
    expect((await draft.call(publishBody({ approved_fingerprint: fingerprint }))).body.code).toBe("CLAIM_MISMATCH");
    expect(draft.seen.createPost).toHaveLength(0);

    const destination = world();
    const second = await destination.call(publishBody());
    destination.tables.paige_social_accounts[0].account_id = "another-account";
    expect((await destination.call(publishBody({
      approved_fingerprint: (second.body.approval as Record<string, string>).fingerprint,
    }))).body.code).toBe("CLAIM_MISMATCH");
    expect(destination.seen.createPost).toHaveLength(0);
  });

  it("refuses ambiguous, revoked and platform-provided identities without guessing an account", async () => {
    for (const w of [
      world({ tables: { paige_social_accounts: [accountRow({ selected: false }), accountRow({ selected: false, id: "other" })] } }),
      world({ tables: { paige_social_accounts: [accountRow({ status: "disconnected" })] } }),
      world({ tables: { paige_social_connections: [connectedRow({ provided_by_platform: true })] } }),
    ]) {
      expect((await w.call(publishBody())).status).toBe(409);
      expect(w.seen.createPost).toHaveLength(0);
    }
  });

  it("recovers a lost acknowledgment using the original scoped attempt without another send", async () => {
    const w = world({
      createPost: () => ({ kind: "unknown", requestId: null, reason: "timeout" }),
      readPost: () => ({
        kind: "published", requestId: "zernio-post",
        results: [{ platform: "instagram", success: true, postId: "native-post", postUrl: "https://instagram.com/p/example", error: null }],
      }),
    });
    const first = await w.call(publishBody());
    const approved = await w.call(publishBody({ approved_fingerprint: (first.body.approval as Record<string, string>).fingerprint }));
    expect(approved.body).toMatchObject({ state: "outcome_unknown", publication_id: PUBLICATION });
    expect((await w.call(publishBody())).body.code).toBe("RETRY_PENDING_RECONCILIATION");
    const lookup = { action: "reconcile", content_id: PIECE, publication_id: PUBLICATION };
    expect((await w.call({ ...lookup, content_id: FOREIGN_PIECE })).status).toBe(404);
    const recovered = await w.call(lookup);
    expect(recovered.body).toMatchObject({ state: "published", publication_id: PUBLICATION, post_id: "native-post" });
    expect(w.seen.readPost).toEqual([expect.objectContaining({
      providerId: null, input: expect.objectContaining({ externalId: PUBLICATION, providerAccountId: "zernio-account-1" }),
    })]);
    expect(w.tables.content_publications[0]).toMatchObject({ id: PUBLICATION, status: "published" });
    expect(w.seen.createPost).toHaveLength(1);
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
