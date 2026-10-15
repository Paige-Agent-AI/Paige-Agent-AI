// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tenantId: "tenant-a",
  title: "Tenant A document",
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId }),
}));

// The drawer-boundary test owns Vault data, not the connected-accounts flag RPC.
// Keep that unrelated capability disabled without contacting a backend.
vi.mock("@/hooks/useTenantFeature", () => ({
  useTenantFeature: () => ({ enabled: false, loading: false }),
}));

vi.mock("./useBusinessVault", () => ({
  useBusinessVault: () => ({
    state: "allowed",
    snapshot: {
      records: [
        {
          id: `${harness.tenantId}-record`,
          title: harness.title,
          section: "library",
          recordType: "Evidence",
          handlingMode: "store_only",
          lifecycleState: "active",
          truthState: "owner_entered",
          sourceState: "current",
          originalFilename: `${harness.tenantId}.pdf`,
          visibility: "owner_admin",
          createdAt: "2026-09-05T00:00:00Z",
          updatedAt: "2026-09-05T00:00:00Z",
        },
      ],
      obligations: [],
      contracts: [],
      facts: [],
      contractsNeedingAttention: 0,
      awaitingReview: 0,
      recentlyReviewed: 0,
    },
    error: null,
    canArchive: true,
    reload: vi.fn(),
    upload: vi.fn(),
    saveContract: vi.fn(),
    saveObligation: vi.fn(),
    archiveRecord: vi.fn(),
    proposeFact: vi.fn(),
    reviewFact: vi.fn(),
  }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  harness.tenantId = "tenant-a";
  harness.title = "Tenant A document";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("Business Vault workspace boundary", () => {
  it("destroys tenant-bound drawer state synchronously when the workspace changes", async () => {
    const { VaultView } = await import("../vault");
    await act(async () => root.render(<VaultView />));

    const recordButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Tenant A document"));
    expect(recordButton).toBeTruthy();
    await act(async () => recordButton?.click());
    expect(document.body.textContent).toContain("Tenant A document");
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

    harness.tenantId = "tenant-b";
    harness.title = "Tenant B document";
    await act(async () => root.render(<VaultView />));

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("tenant-a.pdf");
    expect(document.body.textContent).toContain("Tenant B document");
  });
});
