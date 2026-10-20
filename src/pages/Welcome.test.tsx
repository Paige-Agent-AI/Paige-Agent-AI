import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  status: {
    state: "choose_account",
    reference_id: "reference-1",
    retryable: false,
    message: "Choose an authorized workspace to continue.",
    destination: "/choose-account",
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: harness.status, error: null })),
    },
  },
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  accountContextStatus: "ready", accountContextLoading: false, activeUserId: "user-1",
  activeTenantId: null, activeTenant: null, tenants: [], refresh: vi.fn(async () => {}),
}) }));

import Welcome from "./Welcome";

function LocationProbe() {
  const location = useLocation();
  return <i data-location={location.pathname} data-search={location.search} />;
}

describe("Welcome account recovery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("replaces a stale successful-checkout URL with the account chooser for established access", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/welcome?checkout=success"]}>
          <Welcome />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(host.querySelector("[data-location]")?.getAttribute("data-location")).toBe("/choose-account");
    expect(host.querySelector("[data-location]")?.getAttribute("data-search")).toBe("");
    expect(host.textContent).not.toContain("We could not verify enrollment");
  });
});
