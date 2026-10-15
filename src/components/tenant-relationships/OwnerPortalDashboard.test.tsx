import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerPortalDashboard } from "./OwnerPortalDashboard";
import type { useTenantRelationshipsData, RelationshipPerson } from "./useTenantRelationshipsData";

const fixture = vi.hoisted(() => ({
  invitations: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  brand: { state: { effective: { product_name: "Test Service", primary_color: "#26362f", tagline: "A saved welcome", logo_url: null } }, isLoading: false, isError: false, refetch: vi.fn() },
  rail: { events: [] as unknown[], historyStatus: "ready" },
  allowed: true,
}));
vi.mock("@/hooks/useBrandKit", () => ({ useBrandKit: () => fixture.brand }));
vi.mock("@/hooks/useRailEvents", () => ({ useRailEvents: () => fixture.rail }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: [{ key: "home", label: "Home" }, { key: "agreements", label: "Agreements" }] } }) }));
vi.mock("./usePortalInvitations", () => ({ usePortalInvitations: () => fixture.invitations }));
vi.mock("./PortalConfigurationGate", () => ({ PortalConfigurationGate: ({ children }: { children: React.ReactNode }) => fixture.allowed ? <>{children}</> : <p>Configuration access required</p> }));
vi.mock("./PortalInvitationManager", () => ({ PortalInvitationManager: ({ person }: { person: RelationshipPerson }) => <div data-invite-for={person.id}>{person.email}</div> }));
vi.mock("@/pages/admin/PortalStudio", () => ({ default: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => <input aria-label="Welcome draft" defaultValue="Saved" onChange={() => onDirtyChange(true)} /> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const person = { id: "client-a", name: "Test Client", email: "client@example.test", contactMethods: [{ kind: "email", value: "client@example.test" }], company: "Test Company", linkedUserId: null, primaryOffer: null, doNotContact: false, status: "active" } as RelationshipPerson;
let host: HTMLDivElement; let root: Root;
let data: ReturnType<typeof useTenantRelationshipsData>;
const openClient = vi.fn(); const openPaige = vi.fn();
const show = async (tenant = "test-tenant-a") => { await act(async () => root.render(<OwnerPortalDashboard key={tenant} tenantId={tenant} tenantName="Test Service" data={data} openClient={openClient} openPaige={openPaige} />)); };
const button = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); };
beforeEach(() => {
  data = { people: [person], peopleLoading: false, peopleError: false, retryPeople: vi.fn(), portalLoading: false, portalError: false, portalConfig: { welcome: { headline: "Saved greeting" }, modules: [{ key: "agreements", visible: false }] }, retryPortal: vi.fn() } as unknown as ReturnType<typeof useTenantRelationshipsData>;
  fixture.invitations = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  fixture.brand.isError = false; fixture.brand.isLoading = false;
  fixture.rail = { events: [], historyStatus: "ready" }; fixture.allowed = true;
  openClient.mockReset(); openPaige.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
describe("approved owner dashboard is a real scoped product surface", () => {
  it("opens with the approved four tabs and compact hierarchy", async () => {
    await show();
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((node) => node.textContent)).toEqual(["Overview", "Experience", "Client access", "Activity"]);
    expect(host.textContent).toContain("Needs your attention"); expect(host.textContent).toContain("Your clients"); expect(host.textContent).toContain("Portal experience");
    expect(host.querySelector("h1")).toBeNull(); expect(host.textContent).not.toMatch(/Your client book|One relationship\. Two authorized views\.|Client portal/);
    expect(host.textContent).not.toMatch(/Fieldwork|Jordan|\bActive\b/);
  });
  it("opens the canonical selected client record", async () => { await show(); await click("TTest ClientTest Company"); expect(openClient).toHaveBeenCalledWith("client-a"); });
  it("lets the primary invitation action select an existing client", async () => {
    await show(); await click("Invite client");
    const select = document.querySelector<HTMLSelectElement>('select[id$="dialog-client"]')!;
    await act(async () => { select.value = "client-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.querySelector('[data-invite-for="client-a"]')).not.toBeNull();
  });
  it("never mounts invitation controls after a failed invitation check", async () => {
    fixture.invitations.isError = true; await show(); await click("Client access");
    const select = host.querySelector<HTMLSelectElement>('select[id$="invite-client"]')!;
    await act(async () => { select.value = "client-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("Invitations couldn’t be checked"); expect(host.querySelector("[data-invite-for]")).toBeNull(); expect(host.querySelector("tbody")?.textContent).not.toContain("Not invited");
  });
  it("distinguishes client read failure from a real empty book", async () => {
    data.people = []; data.peopleError = true; await show(); expect(host.textContent).toContain("We couldn’t load your clients"); expect(host.textContent).not.toContain("Your first client");
    data.peopleError = false; await show(); expect(host.textContent).toContain("Your first client starts here");
  });
  it("searches and filters actual contacts without replacing a miss", async () => {
    await show(); await click("Client access");
    const select = host.querySelector<HTMLSelectElement>('select[aria-label]') || host.querySelector<HTMLSelectElement>(".opd-filters select")!;
    await act(async () => { select.value = "linked"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("No clients match"); expect(host.querySelector("tbody")).toBeNull();
  });
  it("keeps an unsaved editor mounted across inner navigation and Back", async () => {
    await show(); await click("Customize experience");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Welcome draft"]')!;
    input.value = "Unsaved";
    await click("Overview"); await click("Experience");
    expect(host.querySelector('input[aria-label="Welcome draft"]')).toBe(input); expect(input.value).toBe("Unsaved");
    await click("Back to experience"); await click("Customize experience"); expect(input.value).toBe("Unsaved");
  });
  it("gates the editor and keeps workspace retirement from carrying a draft", async () => {
    await show(); await click("Customize experience"); expect(host.querySelector('input[aria-label="Welcome draft"]')).not.toBeNull();
    await show("test-tenant-b"); expect(host.querySelector('input[aria-label="Welcome draft"]')).toBeNull(); expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("Overview");
    fixture.allowed = false; await click("Customize experience"); expect(host.textContent).toContain("Configuration access required"); expect(host.querySelector('input[aria-label="Welcome draft"]')).toBeNull();
  });
  it("opens the incumbent PAIGE workspace without executing a follow-up", async () => { await show(); await click("Open PAIGE"); expect(openPaige).toHaveBeenCalledTimes(1); });
  it("does not show private/internal rail events as shared activity", async () => {
    fixture.rail.events = [{ id: "private", title: "Private AI discussion", audience: "owner", visibility: "owner_internal", occurred_at: "2026-10-15T12:00:00Z" }, { id: "shared", title: "Document approved", audience: "both", visibility: "client_visible", occurred_at: "2026-10-15T12:00:00Z" }];
    await show(); expect(host.textContent).toContain("Document approved"); expect(host.textContent).not.toContain("Private AI discussion");
  });
  it("does not turn a refused activity read into a quiet period", async () => { fixture.rail.historyStatus = "forbidden"; await show(); expect(host.textContent).toContain("Shared activity requires access"); expect(host.textContent).not.toContain("No recent shared activity"); });
  it("supports the roving keyboard tab pattern", async () => {
    await show(); const overview = host.querySelector<HTMLButtonElement>('[role="tab"]')!; overview.focus();
    await act(async () => overview.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("Experience"); expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("Experience");
  });
  it("previews saved presentation without customer-session navigation", async () => {
    await show(); await click("Preview portal");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Saved greeting"); expect(dialog.textContent).not.toContain("Agreements"); expect(dialog.querySelector('a[href^="/app"]')).toBeNull();
    await act(async () => (dialog.querySelector('button') as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
