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

type R = { data?: unknown; error?: unknown };
function client(opts: { active?: R; admin?: R; manages?: R }) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const answer = (r: R | undefined) => ({ data: r?.data ?? null, error: r?.error ?? null });
  return {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "current_user_tenant_id") return answer(opts.active);
      if (fn === "is_tenant_admin") return answer(opts.admin);
      if (fn === "agency_can_manage_child") return answer(opts.manages);
      return { data: null, error: { message: "unexpected rpc" } };
    },
  };
}

describe("resolveStudioCaller", () => {
  it("returns the session's workspace for its owner or admin, checked against that exact workspace", async () => {
    const c = client({ active: { data: MINE }, admin: { data: true } });
    expect(await resolveStudioCaller(c, undefined)).toEqual({ ok: true, tenantId: MINE });
    expect(c.calls.find((x) => x.fn === "is_tenant_admin")?.args).toEqual({ _tenant: MINE });
  });

  it("admits the agency that manages the workspace", async () => {
    const c = client({ active: { data: MINE }, admin: { data: false }, manages: { data: true } });
    expect(await resolveStudioCaller(c, MINE)).toEqual({ ok: true, tenantId: MINE });
    expect(c.calls.find((x) => x.fn === "agency_can_manage_child")?.args).toEqual({ _child: MINE });
  });

  it("accepts a body tenant only when it is the session's own workspace", async () => {
    expect(await resolveStudioCaller(client({ active: { data: MINE }, admin: { data: true } }), MINE.toUpperCase())).toEqual({ ok: true, tenantId: MINE });
  });

  it("refuses a body tenant that names another workspace — never swaps it, never asks about permissions", async () => {
    const c = client({ active: { data: MINE }, admin: { data: true } });
    expect(await resolveStudioCaller(c, THEIRS)).toMatchObject({ ok: false, status: 403 });
    expect(c.calls.map((x) => x.fn)).toEqual(["current_user_tenant_id"]);
  });

  it("refuses a member who is neither the owner, an admin, nor the managing agency", async () => {
    expect(await resolveStudioCaller(client({ active: { data: MINE }, admin: { data: false }, manages: { data: false } }), MINE))
      .toMatchObject({ ok: false, status: 403 });
  });

  it("refuses when there is no usable workspace", async () => {
    expect(await resolveStudioCaller(client({ active: { data: null }, admin: { data: true } }), null)).toMatchObject({ ok: false, status: 403 });
    expect(await resolveStudioCaller(client({ active: { data: "not-a-uuid" }, admin: { data: true } }), null)).toMatchObject({ ok: false, status: 403 });
  });

  it("fails closed on every lookup error, as a retryable 500 rather than a permission verdict", async () => {
    const boom = { error: { message: "x" } };
    expect(await resolveStudioCaller(client({ active: boom, admin: { data: true } }), null)).toMatchObject({ ok: false, status: 500 });
    expect(await resolveStudioCaller(client({ active: { data: MINE }, admin: boom }), null)).toMatchObject({ ok: false, status: 500 });
    expect(await resolveStudioCaller(client({ active: { data: MINE }, admin: { data: false }, manages: boom }), null)).toMatchObject({ ok: false, status: 500 });
  });

  it("treats only a literal true as permission", async () => {
    expect((await resolveStudioCaller(client({ active: { data: MINE }, admin: { data: "true" }, manages: { data: 1 } }), null)).ok).toBe(false);
  });
});

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe.each(["generate-image", "content-draft"])("%s takes its workspace from the session", (fn) => {
  const src = read(`supabase/functions/${fn}/index.ts`);
  it("runs the shared caller check and uses its tenant", () => {
    expect(src).toContain("resolveStudioCaller(authed, body?.tenant_id)");
    expect(src).toContain("const tenantId: string = caller.tenantId;");
  });
  it("never reads the tenant from the body or grants on a platform-wide role", () => {
    expect(src).not.toMatch(/tenantId\s*=\s*body\?\.tenant_id/);
    expect(src).not.toContain('from("user_roles")');
  });
});
