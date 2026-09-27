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
  switchTenant: (async () => true) as (id: string | null) => Promise<boolean>,
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
  useTenantContext: () => ({ switchTenant: h.switchTenant, tenants: h.ctxTenants, activeUserId: "op" }),
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => h.toastError(m), success: () => {} } }));

import FleetConsole from "@/operator/surfaces/FleetConsole";
import { landAt } from "@/operator/actAs";

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
    h.switchTenant = vi.fn(async () => true);
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
    expect(h.switchTenant).toHaveBeenCalledTimes(1);
    expect(h.switchTenant).toHaveBeenCalledWith("solo");
    expect(go).toHaveBeenCalledWith("/solo/3855/command-center");
  });

  it("does not record an entry for a tenant the operator could not stand in", async () => {
    const enter = await render();
    await act(async () => { enter("Big Agency")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.switchTenant).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("Nothing was entered."));
  });

  it("stays put, and says so, when the server refuses the entry", async () => {
    h.switchTenant = vi.fn(async () => false);
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(go).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("Couldn't enter Solo Co"));
  });

  it("records one entry for presses made while an entry is in flight", async () => {
    let release: (v: boolean) => void = () => {};
    h.switchTenant = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const enter = await render();
    await act(async () => {
      const b = enter("Solo Co");
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { release(true); });
    expect(h.switchTenant).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  // Review finding (2026-09-27): a full load does not unload the page at once, so a press after the
  // landing began would have run a second audited enter.
  it("records nothing more once the landing has begun", async () => {
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { enter("Big Agency")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(h.switchTenant).toHaveBeenCalledTimes(1);
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

  it("leaves the arrival notice for the tenant's shell to show", async () => {
    sessionStorage.clear();
    const enter = await render();
    await act(async () => { enter("Solo Co")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(sessionStorage.getItem("paige.accountSwitch.notice")).toBe(
      "Acting as Solo Co. Everything you do here is recorded.",
    );
  });
});
