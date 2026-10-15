/**
 * The n8n OAuth grant keepalive — platform-wide, every current and future Solo Shell.
 *
 * Owner report (2026-10-03): "I keep losing my n8n MCP connection and having to reconnect
 * it." Production history: grants re-OAuthed 09-04, 09-05, 09-06, 09-11, 09-13, 09-23,
 * 10-02 — silent deaths discovered mid-task. The access token lives one hour and was
 * refreshed only on chat use; nothing cycled the refresh token on a schedule, and a dead
 * grant surfaced only at the owner's next failure.
 *
 * The keepalive: every 6 hours (pg_cron), for EVERY enabled n8n OAuth connection —
 * acquire the SAME governed lease the chat lane uses (as the tenant's current owner, the
 * fence's own authority check), refresh through the SAME discover → refresh → rotate path,
 * record the honest death state when n8n refuses, always release.
 *
 * This suite pins the contract: the internal-caller gate, the one-home lease usage, the
 * refresh margin, the honest outcomes (including the busy-contended skip that is never a
 * health verdict), the always-release, and the counts-only response that can never leak a
 * tenant id, owner id, or secret material.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const fn = readFileSync(join(root, "supabase/functions/n8n-oauth-keepalive/index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20270535000000_n8n_oauth_keepalive.sql"), "utf8");
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");

describe("the gate: cron-invoked, fails closed to internal callers", () => {
  it("service-role bearer OR a verified x-cron-token — nothing else runs", () => {
    expect(fn).toContain('if (!(await internalCaller(req, admin))) return jsonResponse({ error: "unauthorized" }, 401);');
    expect(fn).toContain('admin.rpc("verify_cron_token", { _token: cronToken } as never)');
    expect(config).toContain("[functions.n8n-oauth-keepalive]");
    expect(config.match(/verify_jwt = false/g)?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("one home: the keepalive drives the EXISTING governed lease", () => {
  it("targets come from the service-role-only RPC with owner resolution via the canonical check", () => {
    expect(fn).toContain('admin.rpc("list_n8n_keepalive_targets")');
    expect(migration).toContain("public._n8n_actor_is_current_owner(m.user_id, c.tenant_id)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_n8n_keepalive_targets() TO service_role;");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.list_n8n_keepalive_targets() FROM PUBLIC, authenticated;");
  });

  it("acquire → refresh → rotate through n8n_oauth_service, as the owner — no parallel credential path", () => {
    expect(fn).toContain('rpc("acquire")');
    expect(fn).toContain("discoverAuthorizationServer(lease.issuer)");
    expect(fn).toContain("await refreshTokens({");
    expect(fn).toContain('rpc("rotate", { tokens })');
    expect(fn).not.toContain("platform_decrypt");
    expect(fn).not.toContain(".from(\"tenant_mcp_connections\")");
  });

  it("a busy lease is skipped, never judged — a live user turn wins over the scheduler", () => {
    expect(fn).toContain('msg.includes("N8N_BUSY") ? "skipped_busy" : "error"');
  });
});

describe("the honest outcomes", () => {
  it("a WITHDRAWN grant records token_expired — the state the tile and readiness surface as reconnect-needed", () => {
    expect(fn).toContain("isGrantWithdrawn(e)");
    expect(fn).toContain('rpc("probe", { state: "token_expired" })');
    expect(fn).toContain('outcome = "reauthorization_required"');
  });

  it("a TRANSIENT failure (network blip, rotate hiccup) records provider_unavailable and NEVER a death — the isGrantWithdrawn split", () => {
    expect(fn).toContain('rpc("probe", { state: "provider_unavailable" }).catch(() => undefined);');
    expect(fn).toContain('outcome = "provider_unavailable";');
    expect(fn).toContain("a stumble and a revocation look");
  });

  it("a successful refresh records RECOVERY (probe connected clears any stale death record)", () => {
    expect(fn).toContain('rpc("probe", { state: "connected" })');
  });

  it("no refresh material is the same honest death, not an error", () => {
    expect(fn).toContain('if (!lease.refresh_token) {');
  });

  it("the refresh margin keeps every scheduled run cycling the token (20 minutes)", () => {
    expect(fn).toContain("const REFRESH_MARGIN_MS = 20 * 60 * 1000;");
  });

  it("the lease is ALWAYS released, even on failure", () => {
    expect(fn).toContain('try { await admin.rpc("n8n_oauth_service", { _operation: "release", _input: bound }); } catch { /* best-effort; the 2-minute lease expires on its own */ }');
  });
});

describe("the response can never leak", () => {
  it("counts only — no tenant ids, owner ids, or secret material cross", () => {
    expect(fn).toContain("// Counts only — never a tenant id, owner id, or any secret material.");
    expect(fn).toContain("return jsonResponse({ ok: true, ...summary });");
    expect(fn).not.toMatch(/console\.(log|warn|error)\([^)]*(token|secret|lease\.)/);
  });

  it("the closed outcome vocabulary", () => {
    expect(fn).toContain('["refreshed", "reauthorization_required", "provider_unavailable", "skipped_uptodate", "skipped_no_owner", "skipped_busy", "error"]');
  });
});

describe("the schedule is platform infrastructure", () => {
  it("pg_cron every 6 hours with the platform cron token, idempotent on re-run", () => {
    expect(migration).toContain("cron.unschedule('n8n-oauth-keepalive')");
    expect(migration).toContain("'0 */6 * * *'");
    expect(migration).toContain("public.cron_token_header()");
  });
});
