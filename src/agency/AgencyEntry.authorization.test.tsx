import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  context: {
    accountContextLoading: false,
    accountContextStatus: "ready",
    activeUserId: "user-1",
    activeTenant: null as Record<string, unknown> | null,
    isPlatformStaff: false,
  },
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => state.context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => state.rpc(...args) } }));
vi.mock("@/components/admin/AgencyLayout", () => ({ default: () => <div>Legacy agency board</div> }));
vi.mock("@/agency/AgencyApp", () => ({ default: () => <div>Canonical agency app</div> }));
vi.mock("@/components/ui/page", () => ({ PageSkeleton: () => <div>Resolving</div> }));

const { default: AgencyEntry } = await import("./AgencyEntry");

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

let host: HTMLDivElement;
let root: Root;

async function mount(path: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/agency/*" element={<AgencyEntry />} />
          <Route path="/choose-account" element={<div>Chooser</div>} />
          <Route path="/operator/*" element={<div>Operator</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.context.accountContextLoading = false;
  state.context.accountContextStatus = "ready";
  state.context.activeUserId = "user-1";
  state.context.activeTenant = null;
  state.context.isPlatformStaff = false;
  state.rpc.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});

describe("AgencyEntry server-resolved authority", () => {
  it("canonicalizes a spoofed account URL to the server-returned account", async () => {
    state.rpc.mockResolvedValue({ data: { is_agency_manager: true, agency_account_number: 2222222 }, error: null });
    await mount("/agency/1111111/clients");
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe("/agency/2222222/command-center");
    expect(host.textContent).toContain("Canonical agency app");
  });

  it("fails a non-manager closed to account selection", async () => {
    state.rpc.mockResolvedValue({ data: { is_agency_manager: false, agency_account_number: 2222222 }, error: null });
    await mount("/agency/2222222/clients");
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe("/choose-account");
    expect(host.textContent).toContain("Chooser");
  });

  it("routes platform staff to the governed operator context without probing agency authority", async () => {
    state.context.isPlatformStaff = true;
    await mount("/agency/2222222/clients");
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe("/operator/fleet/directory");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("shows a truthful refusal when authority resolution fails", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await mount("/agency/2222222/clients");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn't verify your agency access");
    expect(host.textContent).not.toContain("Canonical agency app");
  });
});