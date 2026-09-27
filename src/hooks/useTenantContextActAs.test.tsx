// THE ACT-AS DEFECT, second half (Codex review of #1547, 2026-09-27). An operator whose Enter
// succeeded lands on a full page load; if that load's account read fails, the Solo and business
// entries show "Couldn't verify your workspace" before any shell — and so before any exit — mounts.
// At that moment the provider does not even know the caller is an operator, so `switchTenant(null)`
// would take the member path: a profile write that clears the pointer with no exit recorded.
//
// So the provider (a) remembers, per browser session, that this session opened an act-as, and
// (b) offers an exit that goes to the audited RPC whatever its own read concluded. The server
// decides who may exit; the marker only decides whether the control is offered.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  staff: { data: true, error: null as unknown },
  activeTenant: null as string | null,
  rpcCalls: [] as string[],
  enterError: null as unknown,
  exitError: null as unknown,
  profileWrites: 0,
  authListener: null as null | ((event: string) => void),
  signedIn: true,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: h.signedIn ? { user: { id: "op", last_sign_in_at: null } } : null } }),
      getUser: () => Promise.resolve({ data: { user: { id: "op" } } }),
      onAuthStateChange: (listener: (event: string) => void) => {
        h.authListener = listener;
        return { data: { subscription: { unsubscribe: () => { h.authListener = null; } } } };
      },
    },
    rpc: (name: string) => {
      h.rpcCalls.push(name);
      if (name === "is_platform_owner") return Promise.resolve({ data: false, error: null });
      if (name === "is_platform_admin") return Promise.resolve(h.staff);
      if (name === "operator_enter_tenant") return Promise.resolve({ data: null, error: h.enterError });
      if (name === "operator_exit_tenant") return Promise.resolve({ data: null, error: h.exitError });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { active_tenant_id: h.activeTenant, agency_login_default: null }, error: null }) }) }),
          update: () => {
            h.profileWrites += 1;
            return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: "op" }, error: null }) }) }) };
          },
        };
      }
      if (table === "tenants") {
        return { select: () => ({ order: () => Promise.resolve({ data: [{ id: "t1", name: "Solo Co", status: "active", account_type: "standalone", parent_tenant_id: null, account_number: 3855, features: {} }], error: null }) }) };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

import { TenantProvider, useTenantContext } from "@/hooks/useTenantContext";
import { operatorActAsRecorded, recordOperatorActAs } from "@/lib/auth/workspaceEntry";

const acting = () => operatorActAsRecorded("op");

type Ctx = ReturnType<typeof useTenantContext>;

describe("the operator act-as marker and its audited exit", () => {
  let host: HTMLDivElement;
  let root: Root;
  let ctx: Ctx | null;

  function Probe() {
    ctx = useTenantContext();
    return null;
  }

  beforeEach(() => {
    sessionStorage.clear();
    h.staff = { data: true, error: null };
    h.activeTenant = null;
    h.signedIn = true;
    h.rpcCalls = [];
    h.enterError = null;
    h.exitError = null;
    h.profileWrites = 0;
    ctx = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TenantProvider><Probe /></TenantProvider>
        </QueryClientProvider>,
      );
    });
    return ctx as unknown as Ctx;
  }

  it("records an act-as when an operator enters, and forgets it when they exit", async () => {
    const c = await mount();
    expect(c.isPlatformStaff).toBe(true);
    await act(async () => { await c.switchTenant("t1"); });
    expect(h.rpcCalls).toContain("operator_enter_tenant");
    expect(acting()).toBe(true);
    // It is this user's record, not a flag any later user of the tab inherits.
    expect(operatorActAsRecorded("someone-else")).toBe(false);
    await act(async () => { await (ctx as Ctx).switchTenant(null); });
    expect(acting()).toBe(false);
  });

  // Independent review of 88b651b8: nothing pinned that a refused enter records nothing.
  it("records nothing when the server refuses the entry", async () => {
    h.enterError = { message: "refused" };
    const c = await mount();
    let ok = true;
    await act(async () => { ok = await c.switchTenant("t1"); });
    expect(ok).toBe(false);
    expect(acting()).toBe(false);
  });

  // Independent review of 88b651b8: scope can move without enter/exit (the fresh-login reset,
  // another tab, a duplicated tab's copied storage). A readable server is the authority.
  it("drops a record the server contradicts on a successful load", async () => {
    recordOperatorActAs("op", "t1");
    h.activeTenant = null;
    await mount();
    expect(acting()).toBe(false);
  });

  it("restores the record for an act-as the server still holds", async () => {
    h.activeTenant = "t1";
    await mount();
    expect(acting()).toBe(true);
  });

  it("gives a member no record, whatever the tab held", async () => {
    recordOperatorActAs("op", "t1");
    h.staff = { data: false, error: null };
    h.activeTenant = "t1";
    await mount();
    expect(acting()).toBe(false);
  });

  it("forgets the act-as on sign-out", async () => {
    h.activeTenant = "t1";
    await mount();
    expect(acting()).toBe(true);
    h.signedIn = false;
    await act(async () => { h.authListener?.("SIGNED_OUT"); });
    expect(acting()).toBe(false);
  });

  it("exits through the audited RPC even when its own account read failed", async () => {
    h.staff = { data: false, error: { message: "network" } };
    recordOperatorActAs("op", "t1");
    const c = await mount();
    expect(c.accountContextStatus).toBe("error");
    expect(c.isPlatformStaff).toBe(false);
    let ok = false;
    await act(async () => { ok = await c.exitOperatorActAs(); });
    expect(ok).toBe(true);
    expect(h.rpcCalls).toContain("operator_exit_tenant");
    // Never the member path: that would clear the pointer with no exit recorded.
    expect(h.profileWrites).toBe(0);
    expect(acting()).toBe(false);
  });

  // Codex review of 88b651b8: the console leaves an "Acting as … recorded" notice for the tenant's
  // shell. If the shell never mounted, a later workspace would announce an act-as already ended.
  it("drops the pending arrival notice with the act-as it announced", async () => {
    h.staff = { data: false, error: { message: "network" } };
    recordOperatorActAs("op", "t1");
    sessionStorage.setItem("paige.accountSwitch.notice", "Acting as Solo Co. Everything you do here is recorded.");
    const c = await mount();
    await act(async () => { await c.exitOperatorActAs(); });
    expect(sessionStorage.getItem("paige.accountSwitch.notice")).toBeNull();
  });

  it("keeps the act-as recorded when the server refuses the exit", async () => {
    h.exitError = { message: "refused" };
    // A failed read, so the load does not reset the record either way.
    h.staff = { data: false, error: { message: "network" } };
    recordOperatorActAs("op", "t1");
    const c = await mount();
    let ok = true;
    await act(async () => { ok = await c.exitOperatorActAs(); });
    expect(ok).toBe(false);
    expect(acting()).toBe(true);
  });
});
