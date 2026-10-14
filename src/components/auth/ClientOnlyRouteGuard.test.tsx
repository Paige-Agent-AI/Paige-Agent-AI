import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guard decides one thing: whether a signed-in account is a CLIENT, and if so keeps it off
 * the operator and broker surfaces. It must never class a platform operator as a client.
 *
 * The defect this pins: `platform_admin` (§53's delegated operator tier) was missing from the
 * staff roles, so an account holding only that role was treated as a client and every
 * `/operator` address sent it to `/app`. The account could not reach the console it is
 * authorised for, and clicking Platform on the chooser appeared to do nothing.
 */
const h = vi.hoisted(() => ({
  roles: [] as string[],
  /** The server's operator answer for this caller; `undefined` = the read fails. */
  tier: null as string | null | undefined,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    // The one server answer to operator standing. The guard names no operator role itself.
    rpc: async (name: string) =>
      name !== "operator_standing"
        ? { data: null, error: { message: `unexpected rpc ${name}` } }
        : h.tier === undefined
          ? { data: null, error: { message: "network" } }
          : { data: [{ tier: h.tier, active_tenant_id: null }], error: null },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: h.roles.map((role) => ({ role })), error: null }),
      }),
    }),
  },
}));

import { ClientOnlyRouteGuard } from "./ClientOnlyRouteGuard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function LocationProbe() {
  const location = useLocation();
  return <i data-location={location.pathname} />;
}

describe("ClientOnlyRouteGuard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    h.roles = [];
    h.tier = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function landOn(path: string): Promise<string | null> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <ClientOnlyRouteGuard />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    // Let the role read resolve and the redirect effect run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return host.querySelector("[data-location]")?.getAttribute("data-location") ?? null;
  }

  it("keeps a platform_admin-only account on the operator console", async () => {
    h.roles = ["platform_admin"];
    h.tier = "platform_admin";
    expect(await landOn("/operator/fleet/directory")).toBe("/operator/fleet/directory");
  });

  it("keeps a super_admin account on the operator console", async () => {
    h.roles = ["super_admin"];
    h.tier = "super_admin";
    expect(await landOn("/operator/fleet/directory")).toBe("/operator/fleet/directory");
  });

  it("still sends a client-only account away from the operator console", async () => {
    h.roles = ["client"];
    expect(await landOn("/operator/fleet/directory")).toBe("/app");
  });

  it("still sends an account with no role away from the operator console", async () => {
    h.roles = [];
    expect(await landOn("/operator/fleet/directory")).toBe("/app");
  });

  it("does not send anyone away when their operator standing could not be read", async () => {
    // "Could not verify" is not "you are a client". Before this, a failed read was classed as
    // a client and bounced the person, operator or not.
    h.roles = [];
    h.tier = undefined;
    expect(await landOn("/operator/fleet/directory")).toBe("/operator/fleet/directory");
  });
});
