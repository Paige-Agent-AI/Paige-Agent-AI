// @vitest-environment node
// A Studio generation backend writes into the workspace the caller is signed in to, and only for that
// workspace's owner or admin. A tenant id in the request body never chooses the workspace: naming a
// different one is refused, and a platform-wide role grants nothing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStudioCaller } from "../../supabase/functions/_shared/studio-caller.ts";

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function client(opts: { active?: unknown; activeErr?: unknown; roleOk?: unknown; roleErr?: unknown }) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "current_user_tenant_id") return { data: opts.active ?? null, error: opts.activeErr ?? null };
      if (fn === "studio_role_ok") return { data: opts.roleOk ?? null, error: opts.roleErr ?? null };
      return { data: null, error: { message: "unexpected rpc" } };
    },
  };
}

describe("resolveStudioCaller", () => {
  it("returns the session's workspace for its owner or admin", async () => {
    const c = client({ active: MINE, roleOk: true });
    expect(await resolveStudioCaller(c, USER, undefined)).toEqual({ ok: true, tenantId: MINE });
    expect(c.calls.find((x) => x.fn === "studio_role_ok")?.args).toEqual({ _caller: USER });
  });

  it("accepts a body tenant only when it is the session's own workspace", async () => {
    expect(await resolveStudioCaller(client({ active: MINE, roleOk: true }), USER, MINE.toUpperCase())).toEqual({ ok: true, tenantId: MINE });
  });

  it("refuses a body tenant that names another workspace — never swaps it", async () => {
    const r = await resolveStudioCaller(client({ active: MINE, roleOk: true }), USER, THEIRS);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 403 });
  });

  it("refuses a member who is not the owner or an admin", async () => {
    expect((await resolveStudioCaller(client({ active: MINE, roleOk: false }), USER, MINE)).ok).toBe(false);
  });

  it("fails closed when the role check or the workspace lookup errors", async () => {
    expect((await resolveStudioCaller(client({ active: MINE, roleErr: { message: "x" } }), USER, null)).ok).toBe(false);
    expect((await resolveStudioCaller(client({ activeErr: { message: "x" }, roleOk: true }), USER, null)).ok).toBe(false);
    expect((await resolveStudioCaller(client({ active: null, roleOk: true }), USER, null)).ok).toBe(false);
    expect((await resolveStudioCaller(client({ active: "not-a-uuid", roleOk: true }), USER, null)).ok).toBe(false);
  });

  it("treats only a literal true as permission", async () => {
    expect((await resolveStudioCaller(client({ active: MINE, roleOk: "true" }), USER, null)).ok).toBe(false);
    expect((await resolveStudioCaller(client({ active: MINE, roleOk: 1 }), USER, null)).ok).toBe(false);
  });
});

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe.each(["generate-image", "content-draft"])("%s takes its workspace from the session", (fn) => {
  const src = read(`supabase/functions/${fn}/index.ts`);
  it("runs the shared caller check and uses its tenant", () => {
    expect(src).toContain("resolveStudioCaller(authed, user.id, body?.tenant_id)");
    expect(src).toContain("const tenantId: string = caller.tenantId;");
  });
  it("never reads the tenant from the body or grants on a platform-wide role", () => {
    expect(src).not.toMatch(/tenantId\s*=\s*body\?\.tenant_id/);
    expect(src).not.toContain('from("user_roles")');
  });
});
