// The exit control had NO tests. Round six proved it: deleting its status filter
// left the entire suite green, while the component's own comment calls that filter
// load-bearing — without it someone is offered a way out, clicks it, and the chooser
// sends them straight back into the shell they were trying to leave.
//
// It also carries the unsaved-Setup guard that `main` added to the control this one
// replaces. Leaving is where the work is lost, so leaving is where the question gets
// asked — and nothing asserted that until now.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Tenant = { id: string; name: string; status: string };

const h = vi.hoisted(() => ({
  ctx: {
    tenants: [] as Tenant[],
    isPlatformStaff: false,
    activeTenantId: "a" as string | null,
    activeTenant: null as Tenant | null,
    switchTenant: (async () => true) as (id: string | null) => Promise<boolean>,
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => h.ctx }));

import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { WorkspaceExitControl } from "./WorkspaceExitControl";

const active = (id: string): Tenant => ({ id, name: `Workspace ${id}`, status: "active" });

function LocationProbe() {
  const loc = useLocation();
  return <i data-loc={loc.pathname} />;
}

describe("WorkspaceExitControl", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    h.ctx.tenants = [active("a"), active("b")];
    h.ctx.isPlatformStaff = false;
    h.ctx.activeTenantId = "a";
    h.ctx.activeTenant = active("a");
    h.ctx.switchTenant = vi.fn(async () => true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/1/command-center"]}>
          <Routes>
            <Route path="*" element={<><WorkspaceExitControl /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
    });
    return {
      button: Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Switch workspace")),
      exit: () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Exit tenant")),
      location: () => host.querySelector("[data-loc]")?.getAttribute("data-loc") ?? null,
    };
  }

  it("offers the exit to a genuinely multi-workspace person", async () => {
    const { button } = await render();
    expect(button).toBeTruthy();
  });

  it("offers nothing to a single-workspace person — there is nothing to choose", async () => {
    h.ctx.tenants = [active("a")];
    const { button } = await render();
    expect(button).toBeFalsy();
  });

  // THE FILTER ROUND SIX FOUND UNGUARDED. A second workspace that cannot be entered
  // is not a second workspace: offering the exit here sends someone to a chooser that
  // will find one choice and return them to the shell they were leaving.
  it("does not count a workspace that cannot be entered", async () => {
    h.ctx.tenants = [active("a"), { id: "b", name: "Gone", status: "canceled" }];
    const { button } = await render();
    expect(button).toBeFalsy();
  });

  it("does not count a suspended workspace either", async () => {
    h.ctx.tenants = [active("a"), { id: "b", name: "Held", status: "suspended" }];
    const { button } = await render();
    expect(button).toBeFalsy();
  });

  // ROUND SEVEN'S F1 — the regression the narrower status rule introduced. Being
  // parked ON a suspended workspace is exactly when the exit matters most, and
  // counting only the OFFER list made that person look like they had nowhere to go.
  // The control this PR deletes had no status filter, so before this fix the change
  // removed the only in-app way out of a suspended workspace (§58).
  it("still offers the exit to someone parked on a suspended workspace", async () => {
    h.ctx.tenants = [{ id: "a", name: "Held", status: "suspended" }, active("b")];
    h.ctx.activeTenantId = "a";
    const { button } = await render();
    expect(button).toBeTruthy();
  });

  it("counts a trial workspace, which is a live state someone works in", async () => {
    h.ctx.tenants = [active("a"), { id: "b", name: "Trialling", status: "trial" }];
    const { button } = await render();
    expect(button).toBeTruthy();
  });

  it("lets platform staff leave a tenant for the deliberate account chooser", async () => {
    h.ctx.isPlatformStaff = true;
    const { button, location } = await render();
    expect(button).toBeTruthy();
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(location()).toBe("/choose-account");
  });

  it("navigates OUT to the chooser rather than switching anything itself", async () => {
    const { button, location } = await render();
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(location()).toBe("/choose-account");
  });

  // Carried across from the deleted switcher (§58). Registration is tied to Setup
  // being mounted, and navigating away unmounts it — so a guard consulted only at
  // the switch would already be gone, and the unsaved edits gone with it.
  it("asks the unsaved-work guard BEFORE leaving, and stays put when it refuses", async () => {
    const release = registerAccountSwitchGuard(async () => false);
    const { button, location } = await render();
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(location()).toBe("/solo/1/command-center");
    release();
  });

  it("leaves once the guard allows it", async () => {
    const release = registerAccountSwitchGuard(async () => true);
    const { button, location } = await render();
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(location()).toBe("/choose-account");
    release();
  });

  // THE ACT-AS DEFECT (2026-09-27). An operator who entered a tenant had no control that ended
  // the act-as: Solo offered only the chooser detour, the sub-account shell offered nothing that
  // exited. An operator inside a tenant must always have a visible way out that records the exit.
  describe("a platform operator acting as a tenant", () => {
    beforeEach(() => {
      h.ctx.isPlatformStaff = true;
      h.ctx.activeTenantId = "a";
    });

    it("shows Exit tenant, and keeps Switch workspace beside it", async () => {
      const { button, exit } = await render();
      expect(exit()).toBeTruthy();
      expect(exit()?.getAttribute("aria-label")).toBe("Stop acting as Workspace a and return to the platform");
      expect(button).toBeTruthy();
    });

    it("exits through the audited seam and returns to the console", async () => {
      const { exit, location } = await render();
      await act(async () => { exit()?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(h.ctx.switchTenant).toHaveBeenCalledTimes(1);
      expect(h.ctx.switchTenant).toHaveBeenCalledWith(null);
      expect(location()).toBe("/operator/fleet/directory");
    });

    it("stays put and keeps the exit when the exit is refused", async () => {
      h.ctx.switchTenant = vi.fn(async () => false);
      const { exit, location } = await render();
      await act(async () => { exit()?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(location()).toBe("/solo/1/command-center");
      expect(exit()?.textContent).toContain("Exit tenant");
      expect(exit()?.hasAttribute("disabled")).toBe(false);
    });

    it("asks the unsaved-work guard first, and does not exit when it refuses", async () => {
      const release = registerAccountSwitchGuard(async () => false);
      const { exit, location } = await render();
      await act(async () => { exit()?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(h.ctx.switchTenant).not.toHaveBeenCalled();
      expect(location()).toBe("/solo/1/command-center");
      release();
    });
  });

  it("offers no Exit tenant to a member, or to an operator at rest", async () => {
    const member = await render();
    expect(member.exit()).toBeFalsy();
    h.ctx.isPlatformStaff = true;
    h.ctx.activeTenantId = null;
    const atRest = await render();
    expect(atRest.exit()).toBeFalsy();
  });
});
