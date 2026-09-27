import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scope band says which tenant, if any, this operator session is acting as — and it can
 * never disagree with the session's own scope, because it reads the same `activeTenantId` every
 * other consumer is scoped by (loaded from `profiles.active_tenant_id`).
 *
 * The defect this pins: the band was hard-coded to "No tenant · operator surface" and stayed that
 * way while an act-as was open — the platform telling the operator something untrue about its own
 * state — and there was no way out of the tenant from the console.
 */
const h = vi.hoisted(() => ({
  ctx: {
    activeTenantId: null as string | null,
    tenants: [] as Array<{ id: string; name: string }>,
    switchTenant: vi.fn(),
  },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => h.ctx }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));

import LiveScopeBand from "@/operator/shell/LiveScopeBand";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LiveScopeBand", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    h.ctx.activeTenantId = null;
    h.ctx.tenants = [{ id: "t-1", name: "Northwind Studio" }];
    h.ctx.switchTenant = vi.fn();
    h.toastError.mockReset();
    h.toastSuccess.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = () => act(() => root.render(<LiveScopeBand />));
  const band = () => host.querySelector("[data-scope-band]");
  const exitButton = () => host.querySelector<HTMLButtonElement>("button[data-scope-exit]");

  it("at rest, says platform scope and offers no exit", () => {
    render();
    expect(band()?.getAttribute("data-scope-band")).toBe("none");
    expect(host.textContent).toContain("Platform scope");
    expect(exitButton()).toBeNull();
  });

  it("never prints a database column as copy", () => {
    render();
    expect(host.textContent).not.toMatch(/tenant_id|IS NULL|paige_audit_log/);
    h.ctx.activeTenantId = "t-1";
    render();
    expect(host.textContent).not.toMatch(/tenant_id|IS NULL|paige_audit_log/);
  });

  it("while acting as a tenant, names it and offers the exit", () => {
    h.ctx.activeTenantId = "t-1";
    render();
    expect(band()?.getAttribute("data-scope-band")).toBe("act");
    expect(host.textContent).toContain("Acting as");
    expect(host.textContent).toContain("Northwind Studio");
    expect(host.textContent).not.toContain("No tenant");
    expect(exitButton()).not.toBeNull();
  });

  it("says so honestly when the tenant cannot be named, and still offers the exit", () => {
    h.ctx.activeTenantId = "t-unknown";
    render();
    expect(band()?.getAttribute("data-scope-band")).toBe("act");
    expect(host.textContent).toContain("Acting as");
    expect(host.textContent).toContain("a tenant this session cannot name");
    expect(exitButton()).not.toBeNull();
  });

  it("exits through the audited switch, once, however many times it is pressed", async () => {
    h.ctx.activeTenantId = "t-1";
    let resolve!: (v: boolean) => void;
    h.ctx.switchTenant = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    render();
    await act(async () => {
      exitButton()!.click();
      exitButton()!.click();
    });
    expect(h.ctx.switchTenant).toHaveBeenCalledTimes(1);
    expect(h.ctx.switchTenant).toHaveBeenCalledWith(null);
    expect(exitButton()!.disabled).toBe(true);
    await act(async () => { resolve(true); });
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("says the exit failed, and stays acting, when the switch is refused", async () => {
    h.ctx.activeTenantId = "t-1";
    h.ctx.switchTenant = vi.fn(async () => false);
    render();
    await act(async () => { exitButton()!.click(); });
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Acting as");
    expect(exitButton()!.disabled).toBe(false);
  });
});
