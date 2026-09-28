import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  context: {
    loading: false,
    isPlatformStaff: false,
    activeTenant: null as null | { account_number: number; features?: Record<string, unknown> },
  },
  invoke: vi.fn(),
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => h.context }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: h.invoke } },
}));

import { RequireSoloBetaEntitlement } from "./RequireSoloBetaEntitlement";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function LocationProbe() {
  const location = useLocation();
  return <i data-location={`${location.pathname}${location.search}`} />;
}

describe("RequireSoloBetaEntitlement", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    h.context.loading = false;
    h.context.isPlatformStaff = false;
    h.context.activeTenant = null;
    h.invoke.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderAt(path: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={(
              <>
                <RequireSoloBetaEntitlement><b data-workspace>Workspace</b></RequireSoloBetaEntitlement>
                <LocationProbe />
              </>
            )} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    return {
      workspace: () => host.querySelector("[data-workspace]"),
      location: () => host.querySelector("[data-location]")?.getAttribute("data-location"),
    };
  }

  it("preserves existing tenants that predate the Solo Beta marker", async () => {
    h.context.activeTenant = { account_number: 41, features: {} };
    const view = await renderAt("/solo/41/command-center");
    expect(view.workspace()).toBeTruthy();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("opens a marked workspace only after exact server readback", async () => {
    h.context.activeTenant = {
      account_number: 42,
      features: { solo_beta_offer_code: "paige-solo-beta-monthly-v1" },
    };
    h.invoke.mockResolvedValue({
      data: { state: "verified", destination: "/solo/42/command-center" },
      error: null,
    });
    const view = await renderAt("/solo/42/command-center");
    expect(h.invoke).toHaveBeenCalledWith("solo-beta-enrollment-status");
    expect(view.workspace()).toBeTruthy();
    expect(view.location()).toBe("/solo/42/command-center");
  });

  it.each([
    [{ state: "pending" }, null],
    [{ state: "verified", destination: "/app" }, null],
    [{ state: "verified", destination: "/solo/99/command-center" }, null],
    [null, { message: "unavailable" }],
  ])("fails closed to truthful recovery for %j", async (data, error) => {
    h.context.activeTenant = {
      account_number: 42,
      features: { solo_beta_offer_code: "paige-solo-beta-monthly-v1" },
    };
    h.invoke.mockResolvedValue({ data, error });
    const view = await renderAt("/solo/42/growth");
    expect(view.workspace()).toBeFalsy();
    expect(view.location()).toBe("/welcome?checkout=recovery");
  });

  it("keeps the marked workspace billing recovery route reachable", async () => {
    h.context.activeTenant = {
      account_number: 42,
      features: { solo_beta_offer_code: "paige-solo-beta-monthly-v1" },
    };
    const view = await renderAt("/solo/42/settings/billing");
    expect(view.workspace()).toBeTruthy();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  // THE ACT-AS DEFECT (2026-09-27). The entitlement check reads the CALLER's own enrollment,
  // which a platform operator supporting this customer never has, so it sent them to checkout
  // recovery and stranded the act-as that had just been recorded.
  it("admits a platform operator acting in a marked workspace without asking about their enrollment", async () => {
    h.context.isPlatformStaff = true;
    h.context.activeTenant = {
      account_number: 42,
      features: { solo_beta_offer_code: "paige-solo-beta-monthly-v1" },
    };
    const view = await renderAt("/solo/42/command-center");
    expect(view.workspace()).toBeTruthy();
    expect(view.location()).toBe("/solo/42/command-center");
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
