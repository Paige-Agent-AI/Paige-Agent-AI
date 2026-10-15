// @vitest-environment node
//
// C0a — the workspace-authority resolver (_shared/workspace-authority.ts), tested directly. It decides
// every owner/admin chat tool, the doors' description in the capability projection, and Layer C's
// authority, so each guard below is pinned with a case that fails if the guard is removed (§71.4).
import { describe, expect, it } from "vitest";
import {
  authorityAdmits,
  NO_WORKSPACE_AUTHORITY,
  requiresWorkspaceAdmin,
  resolveWorkspaceAuthority,
  resolveWorkspaceAuthorityAs,
  workspaceAdminRefusal,
  type WorkspaceAuthority,
} from "../../supabase/functions/_shared/workspace-authority";

const ACTING = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

type Rpc = { data: unknown; error: unknown } | "reject";
type Fake = {
  studioRoleOk?: Rpc; currentTenant?: Rpc; roles?: string[] | "error"; memberRole?: string | null | "error";
  tenantAdminAs?: Rpc; agencyManages?: Rpc;
};

function settle(r: Rpc | undefined) {
  if (r === "reject") return Promise.reject(new Error("network"));
  return Promise.resolve(r ?? { data: null, error: null });
}

function clients(f: Fake) {
  const serviceRpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const caller = {
    rpc: (fn: string) => settle(fn === "studio_role_ok" ? f.studioRoleOk : fn === "current_user_tenant_id" ? f.currentTenant : undefined),
  };
  type FakeQuery = {
    select: () => FakeQuery;
    eq: (k: string, v: unknown) => FakeQuery;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise<unknown>;
  };
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q: FakeQuery = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      maybeSingle: () => {
        if (f.memberRole === "error") return Promise.resolve({ data: null, error: { message: "boom" } });
        const hit = filters.tenant_id === ACTING && filters.user_id === USER && filters.status === "active" && f.memberRole;
        return Promise.resolve({ data: hit ? { role: f.memberRole, status: "active" } : null, error: null });
      },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        if (table !== "user_roles") return Promise.resolve({ data: [], error: null }).then(ok, bad);
        if (f.roles === "error") return Promise.resolve({ data: null, error: { message: "boom" } }).then(ok, bad);
        return Promise.resolve({ data: (f.roles ?? []).map((role) => ({ role })), error: null }).then(ok, bad);
      },
    };
    return q;
  };
  const service = {
    from: query,
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      serviceRpcCalls.push({ fn, args });
      return settle(fn === "is_tenant_admin_as" ? f.tenantAdminAs : fn === "agency_can_manage_child" ? f.agencyManages : undefined);
    },
  };
  return { caller, service, serviceRpcCalls };
}

const resolve = (f: Fake, acting: string | null = ACTING) => {
  const { caller, service } = clients(f);
  return resolveWorkspaceAuthority(caller, service, USER, acting);
};

describe("resolveWorkspaceAuthority (chat): one explicit verdict about the acting workspace", () => {
  // The seat fact is asked of the ACTING workspace with an explicit actor (is_tenant_admin_as /
  // agency_can_manage_child); the active workspace is only a gate. `studioRoleOk` is scripted TRUE in
  // the cases below that must NOT admit, to prove the active-workspace answer no longer decides.
  const seated: Fake = {
    tenantAdminAs: { data: true, error: null }, agencyManages: { data: false, error: null },
    currentTenant: { data: ACTING, error: null }, memberRole: "owner",
  };

  it("an owner of the acting workspace is admin AND seated", async () => {
    expect(await resolve(seated)).toEqual({ workspaceAdmin: true, seat: true, platformOperator: false });
  });

  it("asks about the ACTING workspace and the verified user, never the active-workspace shortcut", async () => {
    const c = clients(seated);
    await resolveWorkspaceAuthority(c.caller, c.service, USER, ACTING);
    expect(c.serviceRpcCalls).toContainEqual({ fn: "is_tenant_admin_as", args: { _actor: USER, _tenant: ACTING } });
    expect(c.serviceRpcCalls).toContainEqual({ fn: "agency_can_manage_child", args: { _child: ACTING, _actor: USER } });
  });

  it("an admin verdict for some other active workspace never admits (the Codex P1 race)", async () => {
    const r = await resolve({ ...seated, studioRoleOk: { data: true, error: null }, tenantAdminAs: { data: false, error: null }, memberRole: null });
    expect(r).toEqual(NO_WORKSPACE_AUTHORITY);
  });

  it("a seat counts only in the workspace PAIGE is acting in (sameWorkspace gate)", async () => {
    expect(await resolve({ ...seated, currentTenant: { data: OTHER, error: null } }))
      .toEqual({ workspaceAdmin: false, seat: false, platformOperator: false });
  });

  it("fails closed when the explicit question errors or rejects", async () => {
    expect(await resolve({ ...seated, tenantAdminAs: { data: true, error: { message: "x" } } })).toEqual(NO_WORKSPACE_AUTHORITY);
    expect(await resolve({ ...seated, tenantAdminAs: "reject" })).toEqual(NO_WORKSPACE_AUTHORITY);
  });

  it("fails closed when the active workspace cannot be read", async () => {
    expect(await resolve({ ...seated, currentTenant: "reject" })).toEqual(NO_WORKSPACE_AUTHORITY);
  });

  it("a member seat is neither admin nor door-seated", async () => {
    const r = await resolve({ ...seated, tenantAdminAs: { data: false, error: null }, memberRole: "member" });
    expect(r).toEqual({ workspaceAdmin: false, seat: false, platformOperator: false });
  });

  it("an agency manager / platform admin is workspace admin but holds no door seat", async () => {
    const r = await resolve({ ...seated, tenantAdminAs: { data: false, error: null }, agencyManages: { data: true, error: null }, memberRole: null });
    expect(r).toEqual({ workspaceAdmin: true, seat: false, platformOperator: false });
  });

  it("the global super_admin is the operator — and that grants no seat", async () => {
    const r = await resolve({ currentTenant: { data: ACTING, error: null }, roles: ["super_admin"], tenantAdminAs: { data: false, error: null }, agencyManages: { data: false, error: null } });
    expect(r).toEqual({ workspaceAdmin: false, seat: false, platformOperator: true });
  });

  it("the global `admin` row is NOT authority (ADMIN IS A TENANT ROLE)", async () => {
    const r = await resolve({ currentTenant: { data: ACTING, error: null }, roles: ["admin"], tenantAdminAs: { data: false, error: null }, agencyManages: { data: false, error: null } });
    expect(r).toEqual(NO_WORKSPACE_AUTHORITY);
  });

  it("no acting workspace means no workspace authority (the operator flag still reads)", async () => {
    const r = await resolve({ ...seated, roles: ["super_admin"] }, null);
    expect(r).toEqual({ workspaceAdmin: false, seat: false, platformOperator: true });
  });
});

describe("resolveWorkspaceAuthorityAs (Layer C, explicit actor)", () => {
  it("composes the same three facts from the service-only RPCs", async () => {
    const { service } = clients({ tenantAdminAs: { data: true, error: null }, agencyManages: { data: false, error: null }, memberRole: "admin", roles: [] });
    expect(await resolveWorkspaceAuthorityAs(service, USER, ACTING))
      .toEqual({ ok: true, authority: { workspaceAdmin: true, seat: true, platformOperator: false } });
  });
  it("an agency manager is workspace admin without a seat", async () => {
    const { service } = clients({ tenantAdminAs: { data: false, error: null }, agencyManages: { data: true, error: null }, memberRole: null });
    expect(await resolveWorkspaceAuthorityAs(service, USER, ACTING))
      .toEqual({ ok: true, authority: { workspaceAdmin: true, seat: false, platformOperator: false } });
  });
  it("an RPC error is a RETRYABLE failure, never a settled refusal", async () => {
    const { service } = clients({ tenantAdminAs: { data: null, error: { message: "down" } } });
    expect((await resolveWorkspaceAuthorityAs(service, USER, ACTING)).ok).toBe(false);
  });
});

describe("authorityAdmits", () => {
  const BUILD = new Set(["studio_build"]);
  const DOOR = new Set(["crm_archive_contact", "invoice_send"]);
  const a = (over: Partial<WorkspaceAuthority>): WorkspaceAuthority => ({ ...NO_WORKSPACE_AUTHORITY, ...over });

  it("door tools need the SEAT — an agency manager and the operator are refused", () => {
    expect(authorityAdmits("crm_archive_contact", a({ seat: true, workspaceAdmin: true }), BUILD, DOOR)).toBe(true);
    expect(authorityAdmits("crm_archive_contact", a({ workspaceAdmin: true }), BUILD, DOOR)).toBe(false);
    expect(authorityAdmits("invoice_send", a({ platformOperator: true }), BUILD, DOOR)).toBe(false);
  });
  it("build tools need the workspace admin — the operator does not build in a customer workspace", () => {
    expect(authorityAdmits("studio_build", a({ workspaceAdmin: true }), BUILD, DOOR)).toBe(true);
    expect(authorityAdmits("studio_build", a({ platformOperator: true }), BUILD, DOOR)).toBe(false);
  });
  it("other admin tools admit the workspace admin or the operator", () => {
    expect(authorityAdmits("team_invite_member", a({ workspaceAdmin: true }), BUILD, DOOR)).toBe(true);
    expect(authorityAdmits("team_invite_member", a({ platformOperator: true }), BUILD, DOOR)).toBe(true);
    expect(authorityAdmits("team_invite_member", NO_WORKSPACE_AUTHORITY, BUILD, DOOR)).toBe(false);
  });
});

describe("requiresWorkspaceAdmin + refusal copy", () => {
  it("capability_status and n8n tools are not admin-gated; owner-ops and delegation tools are", () => {
    const n8n = new Set(["n8n_list_workflows"]);
    expect(requiresWorkspaceAdmin("capability_status", n8n)).toBe(false);
    expect(requiresWorkspaceAdmin("n8n_list_workflows", n8n)).toBe(false);
    expect(requiresWorkspaceAdmin("team_invite_member", n8n)).toBe(true);
    expect(requiresWorkspaceAdmin("delegate_to_subagent", n8n)).toBe(true);
    expect(requiresWorkspaceAdmin("web_search", n8n)).toBe(false);
  });
  it("a read refusal never says 'nothing was changed'", () => {
    expect(workspaceAdminRefusal(false)).not.toMatch(/nothing was changed/i);
    expect(workspaceAdminRefusal(true)).toMatch(/nothing was changed/i);
    expect(workspaceAdminRefusal(false)).toMatch(/owner or an admin/);
  });
});
