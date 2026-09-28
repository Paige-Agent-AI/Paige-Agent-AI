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
  enter: (async () => "entered") as (id: string) => Promise<"entered" | "refused" | "unknown">,
  toastError: (() => {}) as (msg: string) => void,
}));

vi.mock("@/operator/data/useFleet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/operator/data/useFleet")>();
  return {
    ...actual,
    useFleet: () => ({ tenants: h.fleet, classificationVisible: false, detailReadFailed: false, loading: false, error: null }),
  };
});
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ enterOperatorActAs: h.enter, tenants: h.ctxTenants, activeUserId: "op" }),
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => h.toastError(m), success: () => {} } }));

import FleetConsole from "@/operator/surfaces/FleetConsole";
import { landAt } from "@/operator/actAs";
import { OPERATOR_ACT_AS_KEY, recordOperatorActAs } from "@/lib/auth/workspaceEntry";

describe("FleetConsole Enter — the act-as lands or does not begin", () => {
  let host: HTMLDivElement;
  let root: Root;
  let go: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(name) && b.textContent?.includes("Enter"));
  }

  it("enters, then takes the operator into the tenant's workspace", async () => {
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.enter).toHaveBeenCalledTimes(1);
    expect(h.enter).toHaveBeenCalledWith("solo");
    expect(go).toHaveBeenCalledWith("/solo/3855/command-center");
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
