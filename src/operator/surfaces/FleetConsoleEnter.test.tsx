// THE ACT-AS DEFECT (2026-09-27). Enter recorded `operator.tenant.enter` on the server and then
// left the operator on the directory: no tenant view, no exit, and an audit row asserting access
// that never happened. An act-as must complete on both sides or on neither.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FleetTenant } from "@/operator/data/useFleet";

const row = (over: Partial<FleetTenant>): FleetTenant => ({
  id: "t",
  slug: null,
  name: "Tenant",
  status: "active",
  accountType: "standalone",
  parentTenantId: null,
  planOffer: null,
  revenueClass: null,
  seats: 1,
  customers: 0,
  trialEndsAt: null,
  ...over,
});

const h = vi.hoisted(() => ({
  fleet: [] as unknown[],
  ctxTenants: [] as Array<Record<string, unknown>>,
  enter: (async () => "entered") as (id: string) => Promise<"entered" | "refused" | "unknown" | "occupied">,
  exit: (async () => true) as () => Promise<boolean>,
  toastError: (() => {}) as (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => void,
  // The tenant row a fresh read returns when the provider's snapshot is older than the directory.
  freshRow: null as Record<string, unknown> | null,
  freshReads: [] as string[],
  retirementAdmin: false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name:string) => ({data:name==='operator_can_retire_accounts' && h.retirementAdmin,error:null}),
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            h.freshReads.push(id);
            return { data: h.freshRow, error: null };
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/operator/data/useFleet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/operator/data/useFleet")>();
  return {
    ...actual,
    useFleet: () => ({ tenants: h.fleet, classificationVisible: false, detailReadFailed: false, loading: false, error: null }),
  };
});
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ enterOperatorActAs: h.enter, exitOperatorActAs: h.exit, tenants: h.ctxTenants, activeUserId: "op" }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string, opts?: { action?: { label: string; onClick: () => void } }) => (opts ? h.toastError(m, opts) : h.toastError(m)),
    success: () => {},
  },
}));

import FleetConsole from "@/operator/surfaces/FleetConsole";
import { landAt } from "@/operator/actAs";
import { OPERATOR_ACT_AS_KEY, recordOperatorActAs } from "@/lib/auth/workspaceEntry";

describe("FleetConsole Enter — the act-as lands or does not begin", () => {
  let host: HTMLDivElement;
  let root: Root;
  let go: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    h.retirementAdmin=false;
    h.fleet = [
      row({ id: "solo", name: "Solo Co" }),
      row({ id: "big", name: "Big Agency", accountType: "agency" }),
    ];
    h.ctxTenants = [
      { id: "solo", name: "Solo Co", account_type: "standalone", parent_tenant_id: null, account_number: 3855 },
      { id: "big", name: "Big Agency", account_type: "agency", parent_tenant_id: null, account_number: 12 },
    ];
    sessionStorage.clear();
    // As the real provider does: a successful audited enter records the act-as for this user.
    h.enter = vi.fn(async (id: string) => {
      recordOperatorActAs("op", id);
      return "entered" as const;
    });
    h.toastError = vi.fn();
    h.freshRow = null;
    h.freshReads = [];
    go = vi.spyOn(landAt, "go").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    go.mockRestore();
  });

  async function render() {
    await act(async () => { root.render(<FleetConsole isPlatformOwner={true} />); });
    return (name: string) =>
      Array.from(host.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === `Enter ${name}`);
  }

  it('an ordinary platform member receives no account lifecycle controls',async()=>{
    await act(async()=>root.render(<FleetConsole isPlatformOwner={false}/>));
    expect(host.querySelector('[aria-label="Account details for Solo Co"]')).toBeNull();
  });
  it('a server-confirmed Platform Admin receives account lifecycle controls',async()=>{
    h.retirementAdmin=true;await act(async()=>root.render(<FleetConsole isPlatformOwner={false}/>));
    await vi.waitFor(()=>expect(host.querySelector('[aria-label="Account details for Solo Co"]')).not.toBeNull());
  });
  it('archived workspaces are excluded from Current and have no operational Enter',async()=>{
    h.fleet=[...h.fleet,row({id:'test-archived',name:'Archived Co',status:'canceled',archivedAt:'2026-01-01'})];
    await render();expect(host.textContent).not.toContain('Archived Co');
    const archived=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Archived accounts')!;
    await act(async()=>archived.click());expect(host.textContent).toContain('Archived Co');expect(host.querySelector('[aria-label="Enter Archived Co"]')).toBeNull();expect(h.enter).not.toHaveBeenCalled();
  });

  it("enters, then takes the operator into the tenant's workspace", async () => {
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.enter).toHaveBeenCalledTimes(1);
    expect(h.enter).toHaveBeenCalledWith("solo");
    expect(go).toHaveBeenCalledWith("/solo/3855/command-center");
  });

  // Codex review of 02235ca4: the directory can list a tenant the provider's snapshot does not have
  // yet. Its landing is read fresh rather than refused as though it did not exist.
  it("lands in a tenant newer than the provider's snapshot, read fresh", async () => {
    h.fleet = [...h.fleet, row({ id: "new-solo", name: "New Solo" })];
    h.freshRow = { id: "new-solo", name: "New Solo", account_type: "standalone", parent_tenant_id: null, account_number: 4000 };
    const enter = await render();
    await act(async () => { enter("New Solo")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.freshReads).toEqual(["new-solo"]);
    expect(h.enter).toHaveBeenCalledWith("new-solo");
    expect(go).toHaveBeenCalledWith("/solo/4000/command-center");
  });

  it("records nothing when the fresh read cannot find the tenant", async () => {
    h.fleet = [...h.fleet, row({ id: "gone", name: "Gone Co" })];
    const enter = await render();
    await act(async () => { enter("Gone Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.enter).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("Nothing was entered."));
  });

  it("does not record an entry for a tenant the operator could not stand in", async () => {
    const enter = await render();
    await act(async () => { enter("Big Agency")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.enter).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("Nothing was entered."));
  });

  it("stays put, and says so, when the server refuses the entry", async () => {
    h.enter = vi.fn(async () => "refused" as const);
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(go).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("Couldn't enter Solo Co"));
  });

  // Codex review of e29f174c: an enter that committed but whose response was lost is not a refusal.
  // When the provider cannot tell, the console must not claim that nothing was recorded.
  it("does not claim nothing was recorded when the outcome is unknown", async () => {
    h.enter = vi.fn(async () => "unknown" as const);
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(go).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("couldn't confirm"));
    expect(h.toastError).not.toHaveBeenCalledWith(expect.stringContaining("Nothing was recorded"));
  });

  // Codex review of ab5ef150: after an unknown outcome and a reload, the console shows platform scope
  // with no exit, so a second Enter would record a duplicate or overwrite the open act-as. The
  // provider now refuses to enter over an open act-as; the console says so and offers the way out.
  it("enters nothing over an open act-as, and offers its audited exit", async () => {
    h.enter = vi.fn(async () => "occupied" as const);
    h.exit = vi.fn(async () => true);
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(go).not.toHaveBeenCalled();
    const [message, opts] = (h.toastError as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain("Nothing was entered");
    expect(opts?.action?.label).toBeTruthy();
    await act(async () => { opts?.action?.onClick(); });
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it("records one entry for presses made while an entry is in flight", async () => {
    let release: (v: "entered") => void = () => {};
    h.enter = vi.fn(() => new Promise<"entered" | "refused" | "unknown">((resolve) => { release = resolve; }));
    const enter = await render();
    await act(async () => {
      const b = enter("Solo Co");
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { release("entered"); });
    expect(h.enter).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  // Review finding (2026-09-27): a full load does not unload the page at once, so a press after the
  // landing began would have run a second audited enter.
  it("records nothing more once the landing has begun", async () => {
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { enter("Big Agency")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.enter).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  // Codex review of 88b651b8: with storage blocked, the arrival must still know an act-as is open.
  it("flags the arrival address when storage cannot hold the act-as", async () => {
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      const enter = await render();
      await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      // The flag names the operator who opened the act-as, so no one else can claim it.
      expect(go).toHaveBeenCalledWith("/solo/3855/command-center?acting-as=op");
    } finally {
      blocked.mockRestore();
    }
  });

  // Codex review of b22716a6: a store that accepts writes but reads back nothing looked usable, so
  // the flag was dropped while the record could never be read on arrival.
  it("flags the arrival address when storage accepts writes but reads back nothing", async () => {
    const forgetful = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => null);
    try {
      const enter = await render();
      await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(go).toHaveBeenCalledWith("/solo/3855/command-center?acting-as=op");
    } finally {
      forgetful.mockRestore();
    }
  });

  // Codex review of 221ffbc5: a store with room for a small probe but not for the record looked
  // usable, so the flag was dropped while the record was never written. Decide on the record itself.
  it("flags the arrival address when the act-as record itself cannot be stored", async () => {
    const setItem = Storage.prototype.setItem;
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === OPERATOR_ACT_AS_KEY) throw new Error("quota");
      return setItem.call(this, key, value);
    });
    try {
      const enter = await render();
      await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(go).toHaveBeenCalledWith("/solo/3855/command-center?acting-as=op");
    } finally {
      full.mockRestore();
    }
  });

  it("leaves the arrival notice for the tenant's shell to show", async () => {
    sessionStorage.clear();
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(sessionStorage.getItem("paige.accountSwitch.notice")).toBe(
      "Acting as Solo Co. Everything you do here is recorded.",
    );
  });
});
