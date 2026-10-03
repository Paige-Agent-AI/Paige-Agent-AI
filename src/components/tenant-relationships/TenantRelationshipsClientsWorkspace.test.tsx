import { renderToStaticMarkup } from "react-dom/server";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TenantRelationshipsClientsWorkspace,
} from "./TenantRelationshipsClientsWorkspace";
import {
  isLegacyRelationshipOwner,
  relationshipWorkspaceVariant,
  workspaceTabs,
} from "./workspaceModel";

const useTenantContext = vi.fn();
const useSubtabRoute = vi.fn();
const useTenantRelationshipsData = vi.fn();
const ownerHarness = vi.hoisted(() => ({ conversations: 0, calendars: 0, portals: 0 }));
const editorHarness = vi.hoisted(() => ({
  rpc: vi.fn(async (..._args: unknown[]) => ({ data: [] })),
  upsert: vi.fn(async (..._args: unknown[]) => "saved-contact"),
  // What `clients` answers when the editor re-reads a contact after a stale refusal.
  latest: { data: null as unknown, error: null as unknown },
  from: vi.fn((_table: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => editorHarness.latest };
    return chain;
  }),
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => useTenantContext() }));
vi.mock("@/components/tenant-calendar/SoloCalendarWorkspace", async () => {
  const ReactModule = await import("react");
  return {
    SoloCalendarWorkspace: class MockSoloCalendar extends ReactModule.Component {
      mountId = ++ownerHarness.calendars;
      render() { return ReactModule.createElement("div", { "data-mocked-calendar": this.mountId, "data-solo-native": "true" }); }
    },
  };
});
vi.mock("@/components/auth/RoleGate", () => ({ RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/pages/admin/ClientsConversations", async () => {
  const ReactModule = await import("react");
  return {
    default: class MockConversations extends ReactModule.Component {
      mountId = ++ownerHarness.conversations;
      render() { return ReactModule.createElement("div", { "data-conversation-mount": this.mountId }); }
    },
  };
});
vi.mock("@/pages/admin/CalendarAdmin", async () => {
  const ReactModule = await import("react");
  return { default: class MockCalendar extends ReactModule.Component<{ soloSettings?: boolean }> { mountId = ++ownerHarness.calendars; render() { return ReactModule.createElement("div", { "data-mocked-calendar": this.mountId, "data-solo-settings": String(Boolean(this.props.soloSettings)) }); } } };
});
vi.mock("@/pages/admin/PortalStudio", async () => {
  const ReactModule = await import("react");
  return { default: class MockPortal extends ReactModule.Component { mountId = ++ownerHarness.portals; render() { return ReactModule.createElement("div", { "data-mocked-portal-studio": this.mountId }); } } };
});
vi.mock("@/components/admin/contacts/ContactPortalPanel", () => ({ ContactPortalPanel: ({ contactId }: { contactId: string }) => <div data-mocked-contact-access={contactId} /> }));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: (...args: unknown[]) => useSubtabRoute(...args) }));
vi.mock("./useTenantRelationshipsData", () => ({
  useTenantRelationshipsData: (...args: unknown[]) => useTenantRelationshipsData(...args),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: editorHarness.rpc, from: editorHarness.from } }));
vi.mock("./contactUpsert", () => ({
  upsertRelationshipContact: (...args: unknown[]) => editorHarness.upsert(...args),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseData = {
  people: [{
    id: "p-1",
    firstName: "Supplied",
    lastName: "Person",
    name: "Supplied Person",
    recordType: "person",
    company: "Supplied Co",
    email: "person@example.test",
    phone: "+1 202 555 0142",
    contactMethods: [
      { id: "m-e1", kind: "email", value: "person@example.test", label: "Work", isPrimary: true },
      { id: "m-p1", kind: "phone", value: "+1 202 555 0142", label: "Mobile", isPrimary: true },
    ],
    title: "Founder",
    website: "https://example.test",
    location: "Atlanta, GA",
    source: "Referral",
    status: "active",
    tags: ["Priority"],
    doNotContact: false,
    sharedContextConsent: false,
    linkedUserId: null,
    relationship: "client active",
    owner: "Assigned owner",
    lastTouch: null,
    createdAt: "2026-01-10T12:00:00Z",
    updatedAt: "2026-08-24T12:00:00Z",
  }],
  peopleLoading: false,
  peopleError: false,
  retryPeople: vi.fn(),
  peopleAvailable: true,
  portalConfig: { welcome: { headline: "Welcome" } },
  portalLoading: false,
  portalError: false,
  retryPortal: vi.fn(),
};

function render(path = "/solo/42/clients/people", routeTier: "solo" | "agency" | "enterprise" | "sub_account" = "solo") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <TenantRelationshipsClientsWorkspace routeTier={routeTier} openPaige={vi.fn()} />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{location.pathname}{location.search}</output>;
}

describe("tenant Relationships / Clients workspace", () => {
  beforeEach(() => {
    useTenantContext.mockReset();
    useSubtabRoute.mockReset();
    useTenantRelationshipsData.mockReset();
    editorHarness.rpc.mockClear();
    editorHarness.upsert.mockReset();
    editorHarness.upsert.mockImplementation(async () => "saved-contact");
    editorHarness.from.mockClear();
    editorHarness.latest = { data: null, error: null };
    useTenantContext.mockReturnValue({
      activeTenantId: "tenant-solo",
      activeTenant: { id: "tenant-solo", name: "Supplied Workspace", account_type: "standalone", parent_tenant_id: null },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    });
    useSubtabRoute.mockReturnValue(["people", vi.fn()]);
    useTenantRelationshipsData.mockReturnValue(baseData);
  });

  it("returns to the current Solo account without accepting a supplied return URL", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const view = <MemoryRouter initialEntries={["/solo/42/clients/people?origin=sales&returnTo=/solo/99/growth/sales"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()}/><LocationProbe/></MemoryRouter>;
    try {
      act(() => root.render(view));
      const back = host.querySelector(".trc-sales-return button") as HTMLButtonElement;
      expect(back).not.toBeNull();
      act(() => back.click());
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/sales?resume=terms");
      expect(host.querySelector(".trc-sales-return")).toBeNull();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
  it("shows the commercial-terms return only on the Solo client handoff", () => {
    expect(render("/solo/42/clients/people?origin=sales")).toContain("Return to commercial terms");
    expect(render("/solo/42/clients/people")).not.toContain("Return to commercial terms");
    expect(render("/agency/42/clients/people?origin=sales", "agency")).not.toContain("Return to commercial terms");
  });
  it.each([
    ["agency", null, "relationships"],
    ["enterprise", null, "relationships"],
    ["standalone", null, "clients"],
    ["sub_account", "parent", "clients"],
    ["standalone", "parent", "clients"],
  ])("maps server-resolved %s context to %s", (accountType, parent, expected) => {
    expect(relationshipWorkspaceVariant(accountType, parent)).toBe(expected);
  });

  it("exposes the exact approved tab matrices without Pipeline or Delivery", () => {
    expect(workspaceTabs("relationships").map(({ label }) => label)).toEqual(["People", "Conversations", "Calendar", "Segments"]);
    expect(workspaceTabs("clients").map(({ label }) => label)).toEqual(["People", "Conversations", "Calendar", "Portal"]);
    expect(JSON.stringify([...workspaceTabs("relationships"), ...workspaceTabs("clients")])).not.toMatch(/Pipeline|Delivery/);
  });

  it("preserves hidden legacy capability owners without putting them in the visible matrix", () => {
    expect(isLegacyRelationshipOwner("solo", "pipe")).toBe(true);
    expect(isLegacyRelationshipOwner("solo", "deliv")).toBe(true);
    expect(isLegacyRelationshipOwner("agency", "directory")).toBe(true);
    expect(isLegacyRelationshipOwner("sub_account", "pipes")).toBe(true);
    expect(isLegacyRelationshipOwner("solo", "people")).toBe(false);
  });

  it("starts Solo People at the compact Clients tabs and CRM toolbar without a redundant route banner", () => {
    const html = render();
    expect(html).not.toContain("Your client book");
    expect(html).not.toContain('class="trc-heading"');
    expect(html).toContain('class="trc-tabs trc-tabs--people"');
    expect(html).toContain("<h1>People</h1>");
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("Supplied Person");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html.match(/aria-controls="trc-panel"/g)).toHaveLength(4);
    expect(html.match(/id="trc-panel"/g)).toHaveLength(1);
    expect(html).toContain("Tenant read · LIVE");
    expect(html).not.toContain('<header class="trc-people-toolbar"><div><span>Client record</span>');
    expect(html).toContain("Assigned owner");
    expect(html).not.toMatch(/Alex Rivera|Morgan Shaw|Taylor Chen|Sarah&#x27;s Coaching Practice/);
  });

  it("replaces the shallow Solo inspector with the approved client-record workspace and honest truth states", () => {
    const html = render("/solo/42/clients/people?person=p-1");
    expect(html).toContain("1 client · Tenant read · LIVE");
    expect(html).toContain("Person profile");
    expect(html).toContain("Relationship overview");
    expect(html).toContain("Contact details");
    expect(html).toContain("Relationship intelligence");
    expect(html).toContain("Sales owns pipeline");
    expect(html).toContain("Portal access");
    expect(html).toContain("Client files");
    expect(html).toContain("PAIGE enrichment");
    expect(html).toContain("Governed details · UNAVAILABLE");
    expect(html).toContain("Birthday reminders");
    expect(html).toContain("Tenant custom fields");
    expect(html).toContain("Unified activity · UNAVAILABLE");
    expect(html).toContain("Back to People");
    expect(html).not.toMatch(/religion|password|credential|race|ethnicity|political affiliation|sexual orientation|biometric/i);
  });

  it("exposes tenant-governed create and edit entry points without replacing the People layout", () => {
    const html = render("/solo/42/clients/people?person=p-1");
    expect(html).toContain("New contact");
    expect(html).toContain("Edit contact");
    expect(html).toContain("Owner-editable · LIVE");
    expect(html).toContain("Open PAIGE workspace");
    expect(html).toContain("Governed details · UNAVAILABLE");
  });

  it("keeps contact creation reachable from the authenticated empty state", () => {
    useTenantRelationshipsData.mockReturnValue({ ...baseData, people: [] });
    const html = render();
    expect(html).toContain("No people here yet");
    expect(html).toContain("New contact");
    expect(html).toContain("0 clients · Tenant read · LIVE");
    expect(html).not.toContain("Create remains in its existing legacy owner");
  });

  it("runs the approved three-step editor in-place, retains the draft, and restores the exact entry action", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    const origin = host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="toolbar-new"]');
    origin?.focus();
    await act(async () => origin?.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector(".trc-contact-editor-header h1")));
    expect(host.querySelector(".trc-contact-editor")).not.toBeNull();
    expect(host.querySelector(".trc-client-workspace")).toBeNull();

    const identityTab = host.querySelector<HTMLButtonElement>('#trc-contact-step-1');
    identityTab?.focus();
    await act(async () => identityTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const businessTab = host.querySelector<HTMLButtonElement>('#trc-contact-step-2');
    expect(document.activeElement).toBe(businessTab);
    expect(businessTab?.getAttribute("aria-selected")).toBe("true");
    await act(async () => identityTab?.click());

    const firstName = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find((input) => input.previousElementSibling?.textContent === "First name")
      ?? host.querySelectorAll<HTMLInputElement>("input")[0];
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(firstName, "Avery");
      firstName?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const continueButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    expect(
      host.querySelector('.trc-contact-editor-steps [role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Business context");
    const backButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Back");
    await act(async () => backButton?.click());
    expect(Array.from(host.querySelectorAll<HTMLInputElement>("input")).some((input) => input.value === "Avery")).toBe(true);

    const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());
    expect(host.textContent).toContain("Continue editing?");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Resume draft")?.click());
    expect(Array.from(host.querySelectorAll<HTMLInputElement>("input")).some((input) => input.value === "Avery")).toBe(true);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Cancel")?.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Discard and return")?.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('[data-contact-editor-origin="toolbar-new"]')));
    expect(host.querySelector(".trc-contact-editor")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("preserves the draft through a failed save, retries the tenant mutation, and returns to the exact durable contact", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    let persisted = false;
    const retryPeople = vi.fn(async () => { persisted = true; });
    useTenantRelationshipsData.mockImplementation(() => ({
      ...baseData,
      retryPeople,
      people: persisted
        ? [...baseData.people, { ...baseData.people[0], id: "saved-contact", name: "Avery Contact" }]
        : baseData.people,
    }));
    editorHarness.upsert
      .mockRejectedValueOnce(new Error("Retryable save failure"))
      .mockResolvedValueOnce("saved-contact");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /><LocationProbe /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="toolbar-new"]')?.click());
    const firstName = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find((input) => input.previousElementSibling?.textContent === "First name");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(firstName, "Avery");
      firstName?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const finalStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((button) => button.textContent?.includes("Relationship & consent"));
    await act(async () => finalStep?.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Create contact")?.click());
    await vi.waitFor(() => expect(host.textContent).toContain("Retryable save failure"));
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>("button")).some((button) => button.textContent === "Retry save")).toBe(true);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Retry save")?.click());
    await vi.waitFor(() => expect(host.textContent).toContain("Contact saved"));
    expect(editorHarness.upsert).toHaveBeenCalledTimes(2);
    expect(editorHarness.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      tenantId: "tenant-solo",
      contactId: undefined,
      patch: expect.objectContaining({ first_name: "Avery" }),
    }));
    expect(retryPeople).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-location]")?.textContent).toContain("person=saved-contact");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Return to saved contact")?.click());
    expect(host.querySelector("[data-contact-editor]")).toBeNull();
    expect(host.textContent).toContain("Avery Contact");
    act(() => root.unmount());
    host.remove();
  });

  it("edits every address of an existing contact and saves the complete ordered list", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    useTenantRelationshipsData.mockReturnValue(baseData);
    editorHarness.upsert.mockResolvedValueOnce("p-1");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const type = async (input: HTMLInputElement | null | undefined, value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="record-edit"]')?.click());

    // The saved addresses open in the editor, primary first with its orb.
    const emailRows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]'));
    expect(emailRows().map((row) => row.querySelector("input")?.value)).toEqual(["person@example.test"]);
    expect(emailRows()[0].querySelector("[data-ctm-orb]")).not.toBeNull();

    // Add a second email; it lands as a secondary with focus in it.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-ctm-add="email"]')?.click());
    const added = emailRows()[1];
    expect(document.activeElement).toBe(added.querySelector("input"));
    expect(added.classList.contains("is-primary")).toBe(false);
    await type(added.querySelector("input"), "person.home@example.test");

    // Make it primary: it moves to the top and the old primary steps down.
    await act(async () => button("Make primary: person.home@example.test")?.click());
    expect(emailRows().map((row) => `${row.querySelector("input")?.value}${row.classList.contains("is-primary") ? "*" : ""}`))
      .toEqual(["person.home@example.test*", "person@example.test"]);
    await vi.waitFor(() => expect(host.textContent).toContain("person.home@example.test is now the primary email; person@example.test is kept as a secondary."));

    // Relabel it from the label list with the keyboard.
    await act(async () => emailRows()[0].querySelector<HTMLButtonElement>("[data-ctm-label]")?.click());
    const options = () => Array.from(host.querySelectorAll<HTMLLIElement>('[role="option"]'));
    expect(options().map((o) => o.textContent)).toEqual(["Work", "Personal", "Billing", "Other", "No label"]);
    await act(async () => options().find((o) => o.textContent === "Personal")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.querySelector('[role="listbox"]')).toBeNull();

    const finalStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((b) => b.textContent?.includes("Relationship & consent"));
    await act(async () => finalStep?.click());
    await act(async () => button("Save changes")?.click());
    await vi.waitFor(() => expect(editorHarness.upsert).toHaveBeenCalled());
    const { patch, contactId } = editorHarness.upsert.mock.lastCall?.[0] as { patch: Record<string, unknown>; contactId: string };
    expect(contactId).toBe("p-1");
    expect(patch).not.toHaveProperty("email");
    expect(patch).not.toHaveProperty("phone");
    expect(patch.contact_methods).toEqual([
      { kind: "email", value: "person.home@example.test", label: "Personal", is_primary: true },
      { kind: "email", value: "person@example.test", label: "Work", is_primary: false },
      { kind: "phone", value: "+1 202 555 0142", label: "Mobile", is_primary: true },
    ]);
    // Replacing the list names the list the editor loaded, so a change made elsewhere is refused.
    expect(patch.expected_contact_methods).toEqual([
      { kind: "email", value: "person@example.test", label: "Work", is_primary: true },
      { kind: "phone", value: "+1 202 555 0142", label: "Mobile", is_primary: true },
    ]);
    act(() => root.unmount());
    host.remove();
  });

  it("refuses to overwrite a change made elsewhere, shows what is saved and keeps what was added", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    useTenantRelationshipsData.mockReturnValue(baseData);
    editorHarness.upsert
      .mockRejectedValueOnce(new Error("CONTACT_METHODS_STALE: this contact changed since it was loaded"))
      .mockResolvedValueOnce("p-1");
    // Meanwhile an inbound message attached a second email to this contact.
    editorHarness.latest = {
      data: {
        client_contact_methods: [
          { id: "m-e1", kind: "email", value: "person@example.test", label: "Work", is_primary: true, position: 0 },
          { id: "m-e2", kind: "email", value: "inbound@example.test", label: null, is_primary: false, position: 1 },
          { id: "m-p1", kind: "phone", value: "+1 202 555 0142", label: "Mobile", is_primary: true, position: 0 },
        ],
      },
      error: null,
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="record-edit"]')?.click());
    const lastName = host.querySelector<HTMLInputElement>("#trc-last-name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(lastName, "Personson");
      lastName?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[data-ctm-add="email"]')?.click());
    const added = host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(added.querySelector("input"), "mine@example.test");
      added.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const toLastStep = async () => {
      const finalStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((b) => b.textContent?.includes("Relationship & consent"));
      await act(async () => finalStep?.click());
    };
    const save = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Save changes" || b.textContent === "Retry save");
    await toLastStep();
    await act(async () => save()?.click());

    await vi.waitFor(() => expect(host.textContent).toContain("Not saved. Someone else changed this contact after you opened it."));
    expect(host.textContent).toContain("with the address you added kept at the end");
    expect(host.textContent).not.toContain("CONTACT_METHODS_STALE");
    // Back on Identity: what is saved now, then this person's addition. The rest of the draft stands.
    const values = () => Array.from(host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id] input')).map((i) => (i as HTMLInputElement).value);
    expect(values()).toEqual(["person@example.test", "inbound@example.test", "mine@example.test"]);
    expect(host.querySelector<HTMLInputElement>("#trc-last-name")?.value).toBe("Personson");

    // Saving again is built on the list just read, and keeps the address that arrived meanwhile.
    await toLastStep();
    await act(async () => save()?.click());
    await vi.waitFor(() => expect(editorHarness.upsert).toHaveBeenCalledTimes(2));
    const { patch } = editorHarness.upsert.mock.lastCall?.[0] as { patch: Record<string, unknown> };
    expect((patch.expected_contact_methods as Array<{ value: string }>).map((m) => m.value)).toEqual(["person@example.test", "inbound@example.test", "+1 202 555 0142"]);
    expect((patch.contact_methods as Array<{ value: string }>).map((m) => m.value)).toEqual(["person@example.test", "inbound@example.test", "mine@example.test", "+1 202 555 0142"]);
    expect(patch).toMatchObject({ last_name: "Personson" });
    act(() => root.unmount());
    host.remove();
  });

  it("a second Save after a saved address change sends nothing stale", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    useTenantRelationshipsData.mockReturnValue(baseData);
    editorHarness.upsert.mockResolvedValue("p-1");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="record-edit"]')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-ctm-add="email"]')?.click());
    const added = host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(added.querySelector("input"), "second@example.test");
      added.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const finalStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((b) => b.textContent?.includes("Relationship & consent"));
    await act(async () => finalStep?.click());
    const save = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Save changes");
    await act(async () => save()?.click());
    await vi.waitFor(() => expect(editorHarness.upsert).toHaveBeenCalledTimes(1));
    // The saved overlay leaves the footer live; a second click is a no-op on addresses, never a
    // replacement named against the list the editor opened with.
    await act(async () => save()?.click());
    await vi.waitFor(() => expect(editorHarness.upsert).toHaveBeenCalledTimes(2));
    const { patch } = editorHarness.upsert.mock.lastCall?.[0] as { patch: Record<string, unknown> };
    expect(patch).not.toHaveProperty("contact_methods");
    expect(patch).not.toHaveProperty("expected_contact_methods");
    act(() => root.unmount());
    host.remove();
  });

  it("does not send the address list when a save leaves the addresses unchanged", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    useTenantRelationshipsData.mockReturnValue(baseData);
    editorHarness.upsert.mockResolvedValueOnce("p-1");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="record-edit"]')?.click());
    const lastName = host.querySelector<HTMLInputElement>("#trc-last-name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(lastName, "Personson");
      lastName?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const finalStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((b) => b.textContent?.includes("Relationship & consent"));
    await act(async () => finalStep?.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Save changes")?.click());
    await vi.waitFor(() => expect(editorHarness.upsert).toHaveBeenCalled());
    const { patch } = editorHarness.upsert.mock.lastCall?.[0] as { patch: Record<string, unknown> };
    // Addresses that arrived after the editor opened (a merge, Paige, an inbound match) must survive.
    expect(patch).not.toHaveProperty("contact_methods");
    expect(patch).not.toHaveProperty("expected_contact_methods");
    expect(patch).toMatchObject({ last_name: "Personson" });
    act(() => root.unmount());
    host.remove();
  });

  it("searches every address, and treats only phone-like queries as digits", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    useTenantRelationshipsData.mockReturnValue({
      ...baseData,
      people: [
        { ...baseData.people[0], contactMethods: [...baseData.people[0].contactMethods, { id: "m-e9", kind: "email", value: "billing@supplied.test", label: "Billing", isPrimary: false }] },
        { ...baseData.people[0], id: "p-2", firstName: "Other", lastName: "Client", name: "Other Client", company: "Elsewhere", email: "x@y.test", phone: null, contactMethods: [{ id: "m-x", kind: "email", value: "x@y.test", label: null, isPrimary: true }] },
      ],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    const search = async (value: string) => {
      const input = host.querySelector<HTMLInputElement>('input[placeholder^="Search name"]');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return Array.from(host.querySelectorAll(".trc-person-select strong, [data-person-id] strong, strong")).map((n) => n.textContent).filter((t) => t === "Supplied Person" || t === "Other Client");
    };
    expect(await search("billing@supplied")).toEqual(["Supplied Person"]);
    expect(await search("(202) 555")).toEqual(["Supplied Person"]);
    expect(await search("202-555-0142")).toEqual(["Supplied Person"]);
    expect(await search("a2b0c2")).toEqual([]);
    act(() => root.unmount());
    host.remove();
  });

  it("puts an address another contact holds back on its row and keeps the draft", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    useTenantRelationshipsData.mockReturnValue(baseData);
    editorHarness.upsert.mockRejectedValueOnce(new Error("CONTACT_METHOD_TAKEN: taken@example.test already belongs to another contact in this workspace"));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="record-edit"]')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-ctm-add="email"]')?.click());
    const row = host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(row.querySelector("input"), "Taken@example.test");
      row.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // An empty address blocks the save on its own row before anything is sent.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-ctm-add="phone"]')?.click());
    const finalStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((b) => b.textContent?.includes("Relationship & consent"));
    await act(async () => finalStep?.click());
    const save = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Save changes" || b.textContent === "Retry save");
    await act(async () => save()?.click());
    expect(editorHarness.upsert).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Enter a phone number, or remove this row.");
    const blankPhone = host.querySelectorAll<HTMLElement>('[data-ctm-list="phone"] [data-ctm-id]')[1];
    await act(async () => blankPhone.querySelector<HTMLButtonElement>("[data-ctm-remove]")?.click());

    const lastStep = Array.from(host.querySelectorAll<HTMLButtonElement>('.trc-contact-editor-steps [role="tab"]')).find((b) => b.textContent?.includes("Relationship & consent"));
    await act(async () => lastStep?.click());
    await act(async () => save()?.click());
    await vi.waitFor(() => expect(host.textContent).toContain("Another contact in this workspace already uses this address."));
    const refused = host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1];
    expect(refused.classList.contains("has-err")).toBe(true);
    expect(refused.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
    expect(refused.querySelector("input")?.value).toBe("Taken@example.test");
    await vi.waitFor(() => expect(document.activeElement).toBe(refused.querySelector("input")));
    expect(host.textContent).not.toContain("Contact saved");

    // Editing a different row leaves the refusal where it is; changing the refused row clears it.
    const primary = host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[0];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(primary.querySelector("input"), "person+1@example.test");
      primary.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1].classList.contains("has-err")).toBe(true);
    await act(async () => {
      const again = host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1].querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(again, "someone.new@example.test");
      again?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll<HTMLElement>('[data-ctm-list="email"] [data-ctm-id]')[1].classList.contains("has-err")).toBe(false);
    act(() => root.unmount());
    host.remove();
  });

  it("presents business records without forcing person-only fields", () => {
    useTenantRelationshipsData.mockReturnValue({
      ...baseData,
      people: [{
        ...baseData.people[0],
        id: "business-1",
        name: "Supplied Company",
        recordType: "business",
        company: "Supplied Company",
        title: null,
      }],
    });
    const html = render("/solo/42/clients/people?person=business-1");
    expect(html).toContain("Business profile");
    expect(html).toContain("Organization details");
    expect(html).toContain("Related people · PARTIAL");
    expect(html).not.toContain("Birthday reminders");
    expect(html).not.toContain("Family context");
  });

  it("keeps the approved redesign Solo-only and preserves the legacy sub-account People owner", () => {
    const html = render("/agency/1/sub/2/clients/people", "sub_account");
    expect(html).not.toContain("data-solo-client-record");
    expect(html).toContain("trc-table-card");
    expect(html).toContain("Ask PAIGE about this view");
    expect(html).toContain("Your client book");
    expect(html).toContain('class="trc-heading"');
    expect(html).not.toContain("trc-tabs--people");
    expect(useTenantRelationshipsData).toHaveBeenLastCalledWith(expect.objectContaining({ soloPeople: false }));
  });

  it("recovers honestly from a missing or unauthorized client deep link", () => {
    const html = render("/solo/42/clients/people?person=not-authorized");
    expect(html).toContain("Client record unavailable");
    expect(html).toContain("missing, unavailable to this account, or could not be resolved");
    expect(html).not.toContain("Person profile");
  });

  it("does not expose unproven record mutations as operational controls", () => {
    const html = render("/solo/42/clients/people?person=p-1");
    const labels = Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("button"), (button) => button.textContent ?? "").join("|");
    expect(labels).not.toMatch(/Add person|Edit client|Invite client|Upload file|Assign pipeline/i);
    expect(html).toContain("Open PAIGE workspace");
    expect(html).toContain("No automatic write occurs");
  });

  it("keeps the selected identity visible when search excludes its list row", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    const openPaige = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={openPaige} /></MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>(".trc-person-select")?.click());
    const input = host.querySelector<HTMLInputElement>("input[placeholder^='Search']");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "no-match");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("No matching people");
    expect(host.querySelector("#trc-record-title")?.textContent).toBe("Supplied Person");
    const paige = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Open PAIGE workspace"));
    await act(async () => paige?.click());
    expect(openPaige).toHaveBeenCalledTimes(1);
    const back = host.querySelector<HTMLButtonElement>(".trc-record-back");
    await act(async () => back?.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    act(() => root.unmount());
    host.remove();
  });

  it("keeps the Solo record selection keyboard-operable, restorable, and URL-addressable", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /><LocationProbe /></MemoryRouter>));
    const personButton = host.querySelector<HTMLButtonElement>(".trc-person-select");
    personButton?.focus();
    await act(async () => personButton?.click());
    expect(host.querySelector("[data-solo-client-record]")?.getAttribute("data-record-selected")).toBe("true");
    expect(host.querySelector("[data-location]")?.textContent).toContain("person=p-1");
    const back = host.querySelector<HTMLButtonElement>(".trc-record-back");
    expect(back?.getAttribute("aria-label")).toBe("Back to People list");
    await act(async () => back?.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector<HTMLButtonElement>(".trc-person-select")));
    expect(host.querySelector("[data-solo-client-record]")?.getAttribute("data-record-selected")).toBe("false");
    expect(host.querySelector("[data-location]")?.textContent).not.toContain("person=");
    act(() => root.unmount());
    host.remove();
  });

  it("uses the approved compact record header and a People-local responsive overlay contract", () => {
    const html = render("/solo/42/clients/people?person=p-1");
    const css = readFileSync(resolve("src/components/tenant-relationships/tenant-relationships-clients-workspace.css"), "utf8");
    expect(html).toContain('data-record-layout="docked"');
    expect(html).toContain('aria-label="Back to People list"');
    expect(html).toContain("Record · LIVE");
    expect(html).toContain("Enrichment · UNAVAILABLE");
    expect(html.match(/Open PAIGE workspace/g)).toHaveLength(1);
    expect(css).toMatch(/\.trc-record-header\s*\{[^}]*grid-template-columns:[^}]*padding:\s*7px 10px/);
    expect(css).toMatch(/\.trc-record-avatar\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/);
    expect(css).toMatch(/\.trc-solo-people\[data-record-layout="overlay"\][\s\S]*\.trc-client-record\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/);
    expect(css).toMatch(/data-record-selected="false"[\s\S]*\.trc-client-record\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@container solo-people-workspace \(max-width: 920px\)/);
  });

  it("re-measures the People center owner when PAIGE changes geometry without ResizeObserver", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalInnerWidth = window.innerWidth;
    let centerWidth = 1000;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if (this.matches("[data-solo-client-record]")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          right: centerWidth,
          bottom: 600,
          left: 0,
          width: centerWidth,
          height: 600,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(
        <div data-tenant-shell data-nav="expanded" data-paige="closed">
          <MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}>
            <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} />
          </MemoryRouter>
        </div>,
      ));
      const shell = host.querySelector<HTMLElement>("[data-tenant-shell]");
      const workspace = host.querySelector<HTMLElement>("[data-solo-client-record]");
      const list = host.querySelector<HTMLElement>(".trc-client-list");
      expect(workspace?.dataset.recordLayout).toBe("docked");
      expect(list?.inert).toBe(false);

      centerWidth = 650;
      shell?.setAttribute("data-paige", "open");
      await vi.waitFor(() => expect(workspace?.dataset.recordLayout).toBe("overlay"));
      expect(list?.inert).toBe(true);

      centerWidth = 1000;
      shell?.setAttribute("data-paige", "closed");
      await vi.waitFor(() => expect(workspace?.dataset.recordLayout).toBe("docked"));
      expect(list?.inert).toBe(false);
    } finally {
      act(() => root.unmount());
      host.remove();
      rectSpy.mockRestore();
      globalThis.ResizeObserver = originalResizeObserver;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  it("settles the People layout after the shell transition when observer APIs are unavailable", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalInnerWidth = window.innerWidth;
    let centerWidth = 1000;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if (this.matches("[data-solo-client-record]")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          right: centerWidth,
          bottom: 600,
          left: 0,
          width: centerWidth,
          height: 600,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    globalThis.MutationObserver = undefined as unknown as typeof MutationObserver;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(
        <div data-tenant-shell data-nav="expanded" data-paige="open">
          <MemoryRouter initialEntries={["/solo/42/clients/people?person=p-1"]}>
            <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} />
          </MemoryRouter>
        </div>,
      ));
      const workspace = host.querySelector<HTMLElement>("[data-solo-client-record]");
      const list = host.querySelector<HTMLElement>(".trc-client-list");
      expect(workspace?.dataset.recordLayout).toBe("docked");

      centerWidth = 650;
      await act(async () => new Promise((resolve) => window.setTimeout(resolve, 300)));
      expect(workspace?.dataset.recordLayout).toBe("overlay");
      expect(list?.inert).toBe(true);
    } finally {
      act(() => root.unmount());
      host.remove();
      rectSpy.mockRestore();
      globalThis.ResizeObserver = originalResizeObserver;
      globalThis.MutationObserver = originalMutationObserver;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  it("makes only the covered narrow list inert and restores the exact originating row", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalInnerWidth = window.innerWidth;
    let resizeCallback: ResizeObserverCallback | null = null;
    let observerDisconnected = false;
    class NarrowResizeObserver {
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; resizeCallback = callback; }
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 1000 } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() { observerDisconnected = true; }
    }
    globalThis.ResizeObserver = NarrowResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
      useTenantRelationshipsData.mockReturnValue({
        ...baseData,
        people: [
          baseData.people[0],
          { ...baseData.people[0], id: "p-2", name: "Second Supplied Person", email: "second@example.test", contactMethods: [{ id: "m-e2", kind: "email", value: "second@example.test", label: "Work", isPrimary: true }] },
        ],
      });
      document.body.append(host);
      await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
      const workspace = host.querySelector<HTMLElement>("[data-solo-client-record]");
      const rows = host.querySelectorAll<HTMLButtonElement>(".trc-person-select");
      const list = host.querySelector<HTMLElement>(".trc-client-list");
      expect(workspace?.dataset.recordLayout).toBe("docked");
      rows[1]?.focus();
      await act(async () => rows[1]?.click());
      expect(list?.inert).toBe(false);
      expect(document.activeElement).toBe(host.querySelector<HTMLButtonElement>(".trc-record-back"));
      await act(async () => host.querySelector<HTMLButtonElement>(".trc-record-back")?.click());
      await vi.waitFor(() => expect(document.activeElement).toBe(rows[1]));
      await act(async () => rows[1]?.click());
      expect(document.activeElement).toBe(host.querySelector<HTMLButtonElement>(".trc-record-back"));

      rows[1]?.focus();
      await act(async () => resizeCallback?.([{ target: workspace!, contentRect: { width: 700 } as DOMRectReadOnly } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await vi.waitFor(() => {
        expect(workspace?.dataset.recordLayout).toBe("overlay");
        expect(list?.inert).toBe(true);
        expect(document.activeElement).toBe(host.querySelector<HTMLButtonElement>(".trc-record-back"));
      });
      await act(async () => resizeCallback?.([{ target: workspace!, contentRect: { width: 762 } as DOMRectReadOnly } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await vi.waitFor(() => {
        expect(workspace?.dataset.recordLayout).toBe("docked");
        expect(list?.inert).toBe(false);
      });
      await act(async () => resizeCallback?.([{ target: workspace!, contentRect: { width: 1000 } as DOMRectReadOnly } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await vi.waitFor(() => {
        expect(workspace?.dataset.recordLayout).toBe("docked");
        expect(list?.inert).toBe(false);
      });

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
      await act(async () => window.dispatchEvent(new Event("resize")));
      await vi.waitFor(() => {
        expect(workspace?.dataset.recordLayout).toBe("overlay");
        expect(list?.inert).toBe(true);
      });
      await act(async () => host.querySelector<HTMLButtonElement>(".trc-record-back")?.click());
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(rows[1]);
        expect(list?.inert).toBe(false);
      });

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      await act(async () => resizeCallback?.([{ target: workspace!, contentRect: { width: 1000 } as DOMRectReadOnly } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await vi.waitFor(() => expect(workspace?.dataset.recordLayout).toBe("overlay"));
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1536 });
      await act(async () => resizeCallback?.([{ target: workspace!, contentRect: { width: 1000 } as DOMRectReadOnly } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await vi.waitFor(() => expect(workspace?.dataset.recordLayout).toBe("docked"));
    } finally {
      act(() => root.unmount());
      host.remove();
      globalThis.ResizeObserver = originalResizeObserver;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
    expect(observerDisconnected).toBe(true);
  });

  it("clears search, selection, URL, and focus state when the authenticated Solo account changes", async () => {
    let tenantId = "tenant-a";
    useTenantContext.mockImplementation(() => ({
      activeTenantId: tenantId,
      activeTenant: { id: tenantId, name: tenantId === "tenant-a" ? "Account A" : "Account B", account_type: "standalone", parent_tenant_id: null },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    }));
    useTenantRelationshipsData.mockImplementation(({ activeTenantId }: { activeTenantId: string }) => activeTenantId === "tenant-a"
      ? baseData
      : { ...baseData, people: [{ ...baseData.people[0], id: "p-b", name: "Second Account Client", email: "second@example.test", contactMethods: [{ id: "m-eb", kind: "email", value: "second@example.test", label: "Work", isPrimary: true }] }] });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const tree = () => <MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /><LocationProbe /></MemoryRouter>;
    await act(async () => root.render(tree()));
    const search = host.querySelector<HTMLInputElement>("input[placeholder^='Search']");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "Supplied");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
      host.querySelector<HTMLButtonElement>(".trc-person-select")?.click();
    });
    expect(host.querySelector("[data-location]")?.textContent).toContain("person=p-1");
    const editButton = host.querySelector<HTMLButtonElement>('[data-contact-editor-origin="record-edit"]');
    await act(async () => editButton?.click());
    expect(host.querySelector("[data-contact-editor]")).not.toBeNull();
    tenantId = "tenant-b";
    await act(async () => root.render(tree()));
    expect(host.querySelector("[data-contact-editor]")).toBeNull();
    expect(host.querySelector<HTMLInputElement>("input[placeholder^='Search']")?.value).toBe("");
    expect(host.textContent).toContain("Second Account Client");
    expect(host.textContent).not.toContain("Supplied Person");
    expect(host.querySelector("[data-location]")?.textContent).not.toContain("person=");
    expect(useTenantRelationshipsData).toHaveBeenLastCalledWith(expect.objectContaining({ activeTenantId: "tenant-b", deepLinkedContactId: null }));
    act(() => root.unmount());
    host.remove();
  });

  it("keeps native button semantics and does not steal focus on same-record refresh", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const tree = () => <MemoryRouter initialEntries={["/solo/42/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>;
    await act(async () => root.render(tree()));
    const row = host.querySelector<HTMLButtonElement>(".trc-client-rows .trc-person-select");
    expect(row?.getAttribute("role")).toBeNull();
    expect(row?.parentElement?.getAttribute("role")).toBe("listitem");
    await act(async () => row?.click());
    const paige = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Open PAIGE workspace"));
    paige?.focus();
    useTenantRelationshipsData.mockReturnValue({ ...baseData, people: [{ ...baseData.people[0] }] });
    await act(async () => root.render(tree()));
    expect(document.activeElement).toBe(paige);
    act(() => root.unmount());
    host.remove();
  });

  it("encodes narrow record-first containment, visible focus, and reduced-motion behavior without changing Calendar geometry", () => {
    const html = render("/solo/42/clients/people?person=p-1");
    const css = readFileSync(resolve("src/components/tenant-relationships/tenant-relationships-clients-workspace.css"), "utf8");
    expect(html).toContain("trc-workspace--people");
    expect(html).toContain("trc-panel--people");
    useSubtabRoute.mockReturnValue(["conversations", vi.fn()]);
    const conversationsHtml = render("/solo/42/clients/conversations");
    expect(conversationsHtml).not.toMatch(/trc-(workspace|panel)--people/);
    expect(conversationsHtml).toContain("trc-workspace trc-workspace--conversations");
    expect(conversationsHtml).toContain("trc-tabs trc-tabs--conversations");
    expect(conversationsHtml).toContain("trc-panel trc-panel--conversations");
    expect(conversationsHtml).not.toContain("Your client book");
    useSubtabRoute.mockReturnValue(["people", vi.fn()]);
    expect(render("/agency/1/sub/2/clients/people", "agency")).not.toMatch(/trc-(workspace|panel)--people/);
    expect(css).toMatch(/\.trc-workspace--people\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.trc-tabs--people\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.trc-panel--people\s*\{[^}]*min-height:\s*0[^}]*padding:\s*12px 18px 16px[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.trc-workspace--conversations\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.trc-tabs--conversations\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px[^}]*padding-inline:\s*18px/);
    expect(css).toMatch(/\.trc-panel--conversations\s*\{[^}]*min-height:\s*0[^}]*padding:\s*10px 12px 12px[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.trc-workspace--conversations\s+\.trc-conversations\s*>\s*header\s*\{[^}]*display:\s*none/);
    expect(css).toContain("container-name: solo-people-workspace");
    expect(css).toMatch(/@container solo-people-workspace \(max-width: 920px\)/);
    expect(css).toMatch(/trc-client-workspace[^{]*\{[^}]*grid-row:\s*3/);
    expect(css).toMatch(/data-record-layout="overlay"[\s\S]*data-record-selected="true"[\s\S]*trc-client-record[\s\S]*position:\s*absolute/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("container-name: solo-calendar-mount");
    expect(css).toContain("minmax(360px, .9fr)");
  });

  it("keeps parent Conversations and Segments honest without exposing Portal", () => {
    useTenantContext.mockReturnValue({
      activeTenantId: "tenant-agency",
      activeTenant: { id: "tenant-agency", name: "Supplied Parent", account_type: "agency", parent_tenant_id: null },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    });
    useSubtabRoute.mockReturnValue(["conversations", vi.fn()]);
    const html = render("/agency/1/clients/conversations", "agency");
    expect(html).toContain("Relationships");
    expect(html).toContain("Book-wide threads are not connected");
    expect(html).toContain("Segments");
    expect(html).not.toContain('>Portal<');
  });

  it("does not relabel a parent Sub-account roster as People", () => {
    useTenantContext.mockReturnValue({
      activeTenantId: "tenant-agency",
      activeTenant: { id: "tenant-agency", name: "Supplied Parent", account_type: "agency", parent_tenant_id: null },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    });
    useTenantRelationshipsData.mockReturnValue({ ...baseData, peopleAvailable: false, people: [] });
    const html = render("/agency/1/clients/people", "agency");
    expect(html).toContain("Book-wide People are not connected");
    expect(html).not.toContain("Supplied Person");
  });

  it("mounts the canonical Solo Calendar directly with the approved Settings view and no intermediary", async () => {
    useSubtabRoute.mockReturnValue(["calendar", vi.fn()]);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/clients/calendar"]}><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={vi.fn()} /></MemoryRouter>));
    await vi.waitFor(() => expect(host.querySelector("[data-mocked-calendar]")).not.toBeNull());
    expect(host.textContent).not.toContain("Open full Calendar");
    expect(host.textContent).not.toContain("Relationship association is not yet provable");
    expect(host.textContent).not.toContain("Your client book");
    expect(host.querySelector(".trc-workspace--calendar")).not.toBeNull();
    expect(host.querySelector(".trc-heading")).toBeNull();
    expect(host.querySelectorAll("h1")).toHaveLength(0);
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual(["People", "Conversations", "Calendar", "Portal"]);
    expect(host.querySelector("[data-mocked-calendar]")?.getAttribute("data-solo-native")).toBe("true");
    act(() => root.unmount());
  });

  it("preserves the existing partial Calendar lens outside the Solo slice", () => {
    useSubtabRoute.mockReturnValue(["calendar", vi.fn()]);
    const html = render("/agency/1/sub/2/clients/calendar", "agency");
    expect(html).toContain("Open full Calendar");
    expect(html).toContain("Relationship association is not yet provable");
    expect(readFileSync(resolve("src/pages/admin/CalendarAdmin.tsx"), "utf8")).not.toMatch(/from ["'][^"']*fixtures/);
    const source = readFileSync(resolve("src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx"), "utf8");
    expect(source).toContain('lazy(() => import("@/pages/admin/CalendarAdmin"))');
    expect(source).toContain("<CanonicalCalendar key={activeTenantId} />");
    expect(source).not.toContain('to={`/admin/clients-hub/delivery');
  });

  it("opens the canonical Calendar in-place without leaving the active account tree", async () => {
    useSubtabRoute.mockReturnValue(["calendar", vi.fn()]);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/agency/1/sub/2/clients/calendar"]}><TenantRelationshipsClientsWorkspace routeTier="agency" openPaige={vi.fn()} /></MemoryRouter>));
    const open = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Open full Calendar"));
    await act(async () => open?.click());
    await vi.waitFor(() => expect(host.querySelector("[data-mocked-calendar]")).not.toBeNull());
    expect(host.querySelector("[data-canonical-calendar]")?.getAttribute("data-return-address")).toBe("/agency/1/sub/2/clients/calendar");
    const firstMount = Number(host.querySelector("[data-mocked-calendar]")?.getAttribute("data-mocked-calendar"));
    useTenantContext.mockReturnValue({
      activeTenantId: "tenant-calendar-next",
      activeTenant: { id: "tenant-calendar-next", name: "Next Calendar", account_type: "sub_account", parent_tenant_id: "parent" },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    });
    await act(async () => root.render(<MemoryRouter initialEntries={["/agency/1/sub/2/clients/calendar"]}><TenantRelationshipsClientsWorkspace routeTier="agency" openPaige={vi.fn()} /></MemoryRouter>));
    expect(host.querySelector("[data-mocked-calendar]")).toBeNull();
    const reopen = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Open full Calendar"));
    await act(async () => reopen?.click());
    await vi.waitFor(() => expect(Number(host.querySelector("[data-mocked-calendar]")?.getAttribute("data-mocked-calendar"))).toBeGreaterThan(firstMount));
    act(() => root.unmount());
  });

  it("mounts the existing canonical Conversations owner instead of a parallel inbox", () => {
    const source = readFileSync(resolve("src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx"), "utf8");
    expect(source).toContain('lazy(() => import("@/pages/admin/ClientsConversations"))');
    expect(source).toContain("<CanonicalConversations key={activeTenantId} />");
  });

  it("remounts canonical Conversations when authenticated active-tenant context changes", async () => {
    useSubtabRoute.mockReturnValue(["conversations", vi.fn()]);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/business/2/clients/conversations"]}><TenantRelationshipsClientsWorkspace routeTier="sub_account" openPaige={vi.fn()} /></MemoryRouter>));
    await vi.waitFor(() => expect(host.querySelector("[data-conversation-mount]")).not.toBeNull());
    const firstMount = Number(host.querySelector("[data-conversation-mount]")?.getAttribute("data-conversation-mount"));

    useTenantContext.mockReturnValue({
      activeTenantId: "tenant-next",
      activeTenant: { id: "tenant-next", name: "Next Workspace", account_type: "sub_account", parent_tenant_id: "parent" },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    });
    await act(async () => root.render(<MemoryRouter initialEntries={["/business/2/clients/conversations"]}><TenantRelationshipsClientsWorkspace routeTier="sub_account" openPaige={vi.fn()} /></MemoryRouter>));
    await vi.waitFor(() => expect(Number(host.querySelector("[data-conversation-mount]")?.getAttribute("data-conversation-mount"))).toBeGreaterThan(firstMount));
    act(() => root.unmount());
  });

  it("renders the approved Portal audience boundaries only for client contexts", () => {
    useSubtabRoute.mockReturnValue(["portal", vi.fn()]);
    const html = render("/business/2/clients/portal", "sub_account");
    expect(html).toContain("One relationship. Two authorized views.");
    expect(html).toContain("Shared with client");
    expect(html).toContain("Internal team");
    expect(html).toContain("Restricted system evidence");
    expect(html).toContain("Client-visible home");
    expect(html).toContain("Portal conversation");
    expect(html).toContain("Requests and action items");
    expect(html).toContain("Engagement progress");
    expect(html).toContain("Files and agreements");
    expect(html).toContain("Configuration remains owner/admin gated");
    expect(html).toContain("Choose a client to manage access");
    const source = readFileSync(resolve("src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx"), "utf8");
    expect(source).toContain("<RoleGate allow={[\"admin\"]}");
    expect(source).toContain("<PortalStudio key={activeTenantId} />");
    expect(source).toContain("<ContactPortalAccess");
    expect(html).toContain("UNAVAILABLE");
  });

  it("requires explicit keyboard-operable People selection before mounting client access", async () => {
    useSubtabRoute.mockImplementation((_tier: string, _branch: string, initial: string) => React.useState(initial));
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter initialEntries={["/business/2/clients/people"]}><TenantRelationshipsClientsWorkspace routeTier="sub_account" openPaige={vi.fn()} /></MemoryRouter>));
    const personButton = host.querySelector<HTMLButtonElement>(".trc-person-select");
    expect(personButton?.textContent).toContain("Supplied Person");
    await act(async () => personButton?.click());
    const portalTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent === "Portal");
    await act(async () => portalTab?.click());
    const configurationButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Open gated Portal configuration");
    await act(async () => configurationButton?.click());
    await vi.waitFor(() => expect(host.querySelector("[data-mocked-portal-studio]")).not.toBeNull());
    const accessButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Open selected client access");
    expect(accessButton?.disabled).toBe(false);
    await act(async () => accessButton?.click());
    await vi.waitFor(() => expect(host.querySelector("[data-mocked-contact-access='p-1']")).not.toBeNull());
    const firstPortalMount = Number(host.querySelector("[data-mocked-portal-studio]")?.getAttribute("data-mocked-portal-studio"));
    useTenantContext.mockReturnValue({
      activeTenantId: "tenant-portal-next",
      activeTenant: { id: "tenant-portal-next", name: "Next Portal", account_type: "sub_account", parent_tenant_id: "parent" },
      accountContextLoading: false,
      isPlatformOwner: false,
      refresh: vi.fn(),
    });
    await act(async () => root.render(<MemoryRouter initialEntries={["/business/2/clients/portal"]}><TenantRelationshipsClientsWorkspace routeTier="sub_account" openPaige={vi.fn()} /></MemoryRouter>));
    expect(host.querySelector("[data-mocked-portal-studio]")).toBeNull();
    expect(host.querySelector("[data-mocked-contact-access]")).toBeNull();
    expect(host.textContent).toContain("Choose a client to manage access");
    const reopenConfiguration = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Open gated Portal configuration");
    await act(async () => reopenConfiguration?.click());
    await vi.waitFor(() => expect(Number(host.querySelector("[data-mocked-portal-studio]")?.getAttribute("data-mocked-portal-studio"))).toBeGreaterThan(firstPortalMount));
    act(() => root.unmount());
  });

  it("blocks all relationship content while authenticated context is unresolved or absent", () => {
    useTenantContext.mockReturnValue({ activeTenantId: null, activeTenant: null, accountContextLoading: true, refresh: vi.fn() });
    expect(render()).toContain("No relationship data appears until the authenticated account is accepted.");
    useTenantContext.mockReturnValue({ activeTenantId: null, activeTenant: null, accountContextLoading: false, refresh: vi.fn() });
    const failed = render();
    expect(failed).toContain("We couldn&#x27;t resolve this workspace");
    expect(failed).not.toContain("Your client book");
  });

  it("does not mount another PAIGE provider or workspace", () => {
    const html = render();
    expect(html).not.toMatch(/tenant-paige-workspace|PAIGE command workspace|AgentPresenceProvider/);
  });
});
