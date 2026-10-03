// @vitest-environment node
// Media seam SECURITY CONTRACT — the owner's pre-merge correction #4 proofs.
//
// EVIDENCE CLASS (§32): source-level contract proof (the paige-team-capability
// precedent — "source-level proof, not runtime proof") plus importable-seam
// assertions. The signature vectors themselves live in
// media-fal-webhook-seam.test.ts (missing/invalid/stale/replay all denied
// against REAL Ed25519 keys). What this file pins:
//
//   1. The webhook is COMPLETION-ONLY: its source contains no insert into
//      paige_media_jobs and no provider submit — an unauthenticated caller
//      cannot mint work or spend through it (verification precedes everything).
//   2. Webhook completion cannot resurrect a cancelled/failed/succeeded job:
//      the completion guards move only MEDIA_NON_TERMINAL_STATES, which by
//      construction excludes every terminal state.
//   3. Cross-tenant: the webhook matches jobs ONLY by the globally-unique
//      provider_request_id (+ provider='fal'); no caller-controlled tenant
//      parameter exists in the matching path, and the migration enforces
//      request-id uniqueness.
//   4. paige-media derives the tenant SERVER-SIDE (resolveTenantForUser) and
//      never reads a body tenant_id; auth + role gate precede every action.
//   5. The legacy generate-image executor keeps its own authorized behavior
//      (role gate + tenant membership check) and the Vibe client invokes ONLY
//      paige-media — no silent bypass lane around the media budget model.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEDIA_NON_TERMINAL_STATES, MEDIA_TERMINAL_STATES } from "../../supabase/functions/_shared/media-provider/mod.ts";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8");
const webhookSrc = read("supabase/functions/paige-media-webhook/index.ts");
const mediaSrc = read("supabase/functions/paige-media/index.ts");
const migrationSrc = read("supabase/migrations/20270121000000_vibe_media_operations.sql");
const generateImageSrc = read("supabase/functions/generate-image/index.ts");
const hookSrc = read("src/solo/useMediaJobs.ts");

describe("correction #4 — webhook proofs (completion-only, no bypass)", () => {
  it("the webhook never inserts a media job (no unauthenticated job creation)", () => {
    const inserts = webhookSrc.match(/\.insert\(/g) ?? [];
    expect(inserts.length).toBe(0);
    expect(webhookSrc).not.toContain("falAdapter.submit");
  });

  it("the webhook never dispatches new provider spend — it only completes existing work", () => {
    expect(webhookSrc).toContain("completeMediaJob");
    expect(webhookSrc).not.toContain(".update({\n      state: \"created\"");
  });

  it("verification runs BEFORE any store access (the 401 fail-closed path leads)", () => {
    const verifyAt = webhookSrc.indexOf("verifyFalCallback({");
    const clientAt = webhookSrc.indexOf("createClient(");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(verifyAt);
  });

  it("job matching is by globally-unique provider_request_id + provider only — no caller-controlled tenant parameter", () => {
    expect(webhookSrc).toContain('.eq("provider_request_id", requestId)');
    expect(webhookSrc).toContain('.eq("provider", "fal")');
    expect(webhookSrc).not.toMatch(/body\.tenant|_tenant_id\s*:=|p_tenant/);
  });

  it("the migration enforces provider-request-id uniqueness (one job per provider request)", () => {
    expect(migrationSrc).toMatch(/create unique index if not exists idx_pmj_provider_request/);
  });

  it("an unknown request id is a 200 no-op — nothing is acted on, creation included", () => {
    expect(webhookSrc).toContain("{ ignored: true, reason: \"unknown_request_id\" }");
  });
});

describe("correction #4 — no resurrection of terminal jobs", () => {
  it("MEDIA_NON_TERMINAL_STATES excludes succeeded/failed/cancelled by construction", () => {
    for (const terminal of MEDIA_TERMINAL_STATES) {
      expect(MEDIA_NON_TERMINAL_STATES).not.toContain(terminal);
    }
  });

  it("the completion claim and terminal update guard on exactly the non-terminal set", () => {
    const completeSrc = read("supabase/functions/_shared/media-provider/complete.ts");
    const guarded = completeSrc.match(/\.in\("state", NON_TERMINAL_STATES\)/g) ?? [];
    expect(guarded.length).toBeGreaterThanOrEqual(3);
    // The early return honors terminal states too (duplicate redelivery no-op).
    expect(completeSrc).toContain("TERMINAL_STATES.has(job.state)");
  });

  it("the webhook defers unknown (non-OK, non-ERROR) statuses to the sweeper instead of failing a good asset", () => {
    expect(webhookSrc).toContain('event.status === "ERROR"');
    expect(webhookSrc).toContain("deferred: true");
  });
});

describe("correction #4 — paige-media auth precedence (no unauthenticated submit)", () => {
  it("auth + server-derived active workspace + that workspace's owner/admin gate precede every action handler", () => {
    const authAt = mediaSrc.indexOf("auth.getUser()");
    const tenantAt = mediaSrc.indexOf('authed.rpc("current_user_tenant_id")');
    const roleAt = mediaSrc.indexOf('authed.rpc("is_tenant_admin", { _tenant: tenantId })');
    const firstActionAt = mediaSrc.indexOf('action === "capabilities"');
    expect(authAt).toBeGreaterThan(-1);
    expect(tenantAt).toBeGreaterThan(authAt);
    expect(roleAt).toBeGreaterThan(tenantAt);
    expect(firstActionAt).toBeGreaterThan(roleAt);
  });

  it("a global role never opens the Studio (§59: user_roles admin is tenant-agnostic)", () => {
    expect(mediaSrc).not.toContain('from("user_roles")');
  });

  it("the tenant is NEVER read from the request body (H2 — no cross-tenant primitive)", () => {
    expect(mediaSrc).not.toMatch(/body\??\.tenant_id/);
  });

  it("the budget ladder precedes job creation (nothing mints spend ungated)", () => {
    const budgetAt = mediaSrc.indexOf("decideMediaBudget({");
    const insertAt = mediaSrc.indexOf(".insert(");
    expect(budgetAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(budgetAt);
  });

  it("within the submit ladder: music is refused before video gates, which precede the secret gate", () => {
    // Scoped to the submit handler: the capabilities action also references
    // videoEnabled/isConfigured earlier in the file, by design.
    const submitAt = mediaSrc.indexOf('action === "submit"');
    expect(submitAt).toBeGreaterThan(-1);
    const ladder = mediaSrc.slice(submitAt);
    const musicAt = ladder.indexOf('mode_hint ?? ""');
    const videoFlagAt = ladder.indexOf("config.videoEnabled");
    const secretAt = ladder.indexOf("falAdapter.isConfigured()");
    expect(musicAt).toBeGreaterThan(-1);
    expect(videoFlagAt).toBeGreaterThan(musicAt);
    expect(secretAt).toBeGreaterThan(videoFlagAt);
  });
});

describe("correction #4 — generate-image audit (existing authorized behavior, no silent bypass)", () => {
  it("generate-image keeps its own user-JWT auth + role gate + tenant membership check", () => {
    expect(generateImageSrc).toContain("auth.getUser()");
    expect(generateImageSrc).toContain('r === "admin" || r === "super_admin")');
    expect(generateImageSrc).not.toContain('r === "coach"');
    expect(generateImageSrc).toContain("is_tenant_member");
  });

  it("the Vibe client invokes ONLY the governed seam — there is no direct generate-image lane in the Studio", () => {
    expect(hookSrc).toContain('supabase.functions.invoke<T>("paige-media"');
    expect(hookSrc).not.toContain("generate-image");
  });

  it("paige-media's legacy dispatch forwards the CALLER's JWT — the executor's auth runs natively, never bypassed", () => {
    expect(mediaSrc).toContain("callerJwt: opts.authHeader");
  });
});
