import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entering a tenant is an audited act: one press is one entry. Production recorded two entries
 * about 120ms apart for single intents — the row button had no in-flight state, so a double
 * press ran the act twice and wrote two audit rows.
 */
const h = vi.hoisted(() => ({ switchTenant: vi.fn() }));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ switchTenant: h.switchTenant }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/operator/data/useFleet", async (orig) => {
  const actual = await orig<typeof import("@/operator/data/useFleet")>();
  return {
    ...actual,
    useFleet: () => ({
      tenants: [
        {
          id: "t-1", slug: null, name: "Northwind Studio", status: "active", accountType: "standalone",
          parentTenantId: null, planOffer: null, revenueClass: "promotional", seats: 1, customers: 0, trialEndsAt: null,
        },
      ],
      classificationVisible: true,
      detailReadFailed: false,
      loading: false,
      error: null,
    }),
  };
});

import FleetConsole from "@/operator/surfaces/FleetConsole";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FleetConsole — Enter", () => {
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

  it("enters once however many times the row is pressed while the entry is in flight", async () => {
    let resolve!: (v: boolean) => void;
    h.switchTenant.mockImplementation(() => new Promise<boolean>((r) => { resolve = r; }));
    act(() => root.render(<FleetConsole isPlatformOwner />));
    const row = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Northwind Studio"))!;
    await act(async () => {
      row.click();
      row.click();
      row.click();
    });
    expect(h.switchTenant).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(true); });
  });
});
