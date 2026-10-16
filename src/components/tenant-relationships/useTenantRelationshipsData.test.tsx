import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTenantRelationshipsData } from "./useTenantRelationshipsData";

const { pending, from, selections, filters } = vi.hoisted(() => {
  type Result = { data: unknown; error: null };
  type Deferred = { promise: Promise<Result>; resolve: (value: Result) => void };
  const requests = new Map<string, Deferred>();
  const selectedColumns: Array<{ table: string; columns: string }> = [];
  const queryFilters: Array<{ table: string; column: string; value: string }> = [];
  const createDeferred = (key: string) => {
    let resolve!: Deferred["resolve"];
    const promise = new Promise<Result>((done) => { resolve = done; });
    const value = { promise, resolve };
    requests.set(key, value);
    return value;
  };
  const fromTable = vi.fn((table: string) => {
    let tenant = "";
    let recordId = "";
    const chain = {
      select: (columns: string) => { selectedColumns.push({ table, columns }); return chain; },
      eq: (column: string, value: string) => { queryFilters.push({ table, column, value }); if (column === "tenant_id") tenant = value; if (column === "id") recordId = value; return chain; },
      order: () => chain,
      limit: () => requests.get(`${table}:${tenant}`)?.promise ?? createDeferred(`${table}:${tenant}`).promise,
      maybeSingle: () => requests.get(`${table}:${tenant}:${recordId}`)?.promise ?? createDeferred(`${table}:${tenant}:${recordId}`).promise,
    };
    return chain;
  });
  return { pending: requests, from: fromTable, selections: selectedColumns, filters: queryFilters };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/usePortalConfig", () => ({
  usePortalConfig: () => ({ config: {}, isLoading: false, isError: false, refetch: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ tenantId }: { tenantId: string | null }) {
  const state = useTenantRelationshipsData({ activeTenantId: tenantId, variant: "clients" });
  return <output data-people={state.people.map(({ name }) => name).join(",")} />;
}

function DetailHarness({ tenantId, soloPeople = true }: { tenantId: string | null; soloPeople?: boolean }) {
  const state = useTenantRelationshipsData({ activeTenantId: tenantId, variant: "clients", soloPeople });
  const person = state.people[0];
  return <output data-record={person ? JSON.stringify(person) : ""} />;
}

function DeepLinkHarness({ tenantId, personId }: { tenantId: string | null; personId: string | null }) {
  const state = useTenantRelationshipsData({ activeTenantId: tenantId, variant: "clients", soloPeople: true, deepLinkedContactId: personId });
  return <output data-record={state.deepLinkedPerson ? JSON.stringify(state.deepLinkedPerson) : ""} />;
}

describe("tenant relationship adapter sequencing", () => {
  beforeEach(() => { pending.clear(); selections.length = 0; filters.length = 0; from.mockClear(); });

  const ownerCases = [
    { label: "owner only", lead_owner_user_id: "owner-user", assigned_coach_user_id: null, owner: "Assigned owner" },
    { label: "coach only", lead_owner_user_id: null, assigned_coach_user_id: "coach-user", owner: "Unassigned" },
    { label: "different owner and coach", lead_owner_user_id: "owner-user", assigned_coach_user_id: "coach-user", owner: "Assigned owner" },
    { label: "neither", lead_owner_user_id: null, assigned_coach_user_id: null, owner: "Unassigned" },
  ];
  for (const deepLink of [false, true]) {
    it.each(ownerCases)(`uses the native contact owner for the SOLO ${deepLink ? "deep link" : "list"}: $label`, async ({ lead_owner_user_id, assigned_coach_user_id, owner }) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const host = document.createElement("div");
      const root = createRoot(host);
      const requestKey = deepLink ? "clients:tenant-owner:contact-owner" : "clients:tenant-owner";
      await act(async () => root.render(<QueryClientProvider client={client}>{deepLink
        ? <DeepLinkHarness tenantId="tenant-owner" personId="contact-owner" />
        : <DetailHarness tenantId="tenant-owner" />}</QueryClientProvider>));
      await vi.waitFor(() => expect(pending.has(requestKey)).toBe(true));
      const row = { id: "contact-owner", first_name: "Test", last_name: "Contact", lead_owner_user_id, assigned_coach_user_id, client_contact_methods: [] };
      await act(async () => { pending.get(requestKey)?.resolve({ data: deepLink ? row : [row], error: null }); });
      await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-record")).not.toBe(""));
      expect(JSON.parse(host.querySelector("output")!.getAttribute("data-record")!)).toMatchObject({ owner, assignedCoachUserId: assigned_coach_user_id });
      expect(from.mock.calls.every(([table]) => table === "clients")).toBe(true);
      act(() => root.unmount());
    });
  }

  it.each(ownerCases)("preserves the legacy coach-based roster projection: $label", async ({ lead_owner_user_id, assigned_coach_user_id }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DetailHarness tenantId="tenant-legacy-owner" soloPeople={false} /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-legacy-owner")).toBe(true));
    await act(async () => { pending.get("clients:tenant-legacy-owner")?.resolve({ data: [{ id: "legacy", lead_owner_user_id, assigned_coach_user_id }], error: null }); });
    await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-record")).not.toBe(""));
    expect(JSON.parse(host.querySelector("output")!.getAttribute("data-record")!)).toMatchObject({ owner: assigned_coach_user_id ? "Assigned owner" : "Unassigned", assignedCoachUserId: assigned_coach_user_id });
    expect(selections[0].columns).not.toContain("lead_owner_user_id");
    act(() => root.unmount());
  });

  it("adds only the native owner ID to both closed SOLO projections", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DeepLinkHarness tenantId="tenant-owner-fields" personId="contact-owner" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-owner-fields:contact-owner")).toBe(true));
    const exactColumns = "id,first_name,last_name,entity_name,entity_type,client_contact_methods(id,kind,value,label,is_primary,position),title,website,linkedin_url,street_address,city,state,zip_code,source,status,tags,do_not_contact,paige_shared_context_consent,linked_user_id,lifecycle_stage,primary_offer,current_notes,assigned_coach_user_id,lead_owner_user_id,last_contacted_at,created_at,updated_at";
    expect(selections).toEqual([{ table: "clients", columns: exactColumns }, { table: "clients", columns: exactColumns }]);
    expect(filters).toEqual([{ table: "clients", column: "tenant_id", value: "tenant-owner-fields" }, { table: "clients", column: "tenant_id", value: "tenant-owner-fields" }, { table: "clients", column: "id", value: "contact-owner" }]);
    expect(from.mock.calls).toEqual([["clients"], ["clients"]]);
    act(() => root.unmount());
  });

  it("keeps a wrong-tenant contact unavailable instead of doing an unscoped owner lookup", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DeepLinkHarness tenantId="tenant-b" personId="tenant-a-contact" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-b:tenant-a-contact")).toBe(true));
    await act(async () => { pending.get("clients:tenant-b:tenant-a-contact")?.resolve({ data: null, error: null }); });
    expect(host.querySelector("output")?.getAttribute("data-record")).toBe("");
    expect(filters.filter(({ column }) => column === "tenant_id")).toEqual([{ table: "clients", column: "tenant_id", value: "tenant-b" }, { table: "clients", column: "tenant_id", value: "tenant-b" }]);
    expect(from.mock.calls).toEqual([["clients"], ["clients"]]);
    act(() => root.unmount());
  });

  it("never replaces the current SOLO owner with a delayed earlier account owner", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DetailHarness tenantId="tenant-a" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-a")).toBe(true));
    await act(async () => root.render(<QueryClientProvider client={client}><DetailHarness tenantId="tenant-b" /></QueryClientProvider>));
    expect(host.querySelector("output")?.getAttribute("data-record")).toBe("");
    await vi.waitFor(() => expect(pending.has("clients:tenant-b")).toBe(true));
    await act(async () => { pending.get("clients:tenant-b")?.resolve({ data: [{ id: "b", lead_owner_user_id: null, assigned_coach_user_id: "coach-b" }], error: null }); });
    await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-record")).toContain('"id":"b"'));
    expect(JSON.parse(host.querySelector("output")!.getAttribute("data-record")!)).toMatchObject({ owner: "Unassigned", assignedCoachUserId: "coach-b" });
    await act(async () => { pending.get("clients:tenant-a")?.resolve({ data: [{ id: "a", lead_owner_user_id: "owner-a", assigned_coach_user_id: null }], error: null }); });
    expect(JSON.parse(host.querySelector("output")!.getAttribute("data-record")!)).toMatchObject({ id: "b", owner: "Unassigned", assignedCoachUserId: "coach-b" });
    await act(async () => root.render(<QueryClientProvider client={client}><DetailHarness tenantId={null} /></QueryClientProvider>));
    expect(host.querySelector("output")?.getAttribute("data-record")).toBe("");
    act(() => root.unmount());
  });

  it("never lets an older account response overwrite the newer active account", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><Harness tenantId="tenant-a" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-a")).toBe(true));
    await act(async () => root.render(<QueryClientProvider client={client}><Harness tenantId="tenant-b" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-b")).toBe(true));

    await act(async () => {
      pending.get("clients:tenant-b")?.resolve({ data: [{ id: "b", first_name: "New", last_name: "Account", entity_name: null, email: null, linked_user_id: null, lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null }], error: null });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-people")).toBe("New Account"));
    expect(host.querySelector("output")?.getAttribute("data-people")).toBe("New Account");

    await act(async () => {
      pending.get("clients:tenant-a")?.resolve({ data: [{ id: "a", first_name: "Old", last_name: "Account", entity_name: null, email: null, linked_user_id: null, lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null }], error: null });
      await Promise.resolve();
    });
    expect(host.querySelector("output")?.getAttribute("data-people")).toBe("New Account");
    act(() => root.unmount());
  });

  it("clears accepted account data immediately on sign-out and ignores late work", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><Harness tenantId="tenant-a" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-a")).toBe(true));
    await act(async () => root.render(<QueryClientProvider client={client}><Harness tenantId={null} /></QueryClientProvider>));
    expect(host.querySelector("output")?.getAttribute("data-people")).toBe("");
    await act(async () => {
      pending.get("clients:tenant-a")?.resolve({ data: [{ id: "a", first_name: "Late", last_name: "Account", entity_name: null, client_contact_methods: [], linked_user_id: null, lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null }], error: null });
      await Promise.resolve();
    });
    expect(host.querySelector("output")?.getAttribute("data-people")).toBe("");
    act(() => root.unmount());
  });

  it("maps grounded standard fields and uses an explicit entity type as partial business evidence", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DetailHarness tenantId="tenant-business" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-business")).toBe(true));
    await act(async () => {
      pending.get("clients:tenant-business")?.resolve({
        data: [{
          id: "business-1", first_name: "Supplied", last_name: "Contact", entity_name: "Supplied Company", entity_type: "LLC",
          client_contact_methods: [
            { id: "cm-2", kind: "email", value: "billing@example.test", label: "Billing", is_primary: false, position: 1 },
            { id: "cm-3", kind: "phone", value: "+1 202 555 0142", label: "Mobile", is_primary: true, position: 0 },
            { id: "cm-1", kind: "email", value: "hello@example.test", label: "Work", is_primary: true, position: 0 },
          ],
          title: null, website: "https://example.test",
          linkedin_url: "https://linkedin.com/in/supplied", street_address: "10 Peachtree St", city: "Atlanta", state: "GA", zip_code: "30303",
          primary_offer: "Advisory", current_notes: "Prefers email", source: "referral", status: "active", tags: ["Priority"],
          do_not_contact: false, paige_shared_context_consent: false, linked_user_id: null,
          lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null,
          created_at: "2026-01-10T12:00:00Z", updated_at: "2026-08-24T12:00:00Z",
        }],
        error: null,
      });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-record")).not.toBe(""));
    const mapped = JSON.parse(host.querySelector("output")?.getAttribute("data-record") || "{}");
    expect(mapped).toMatchObject({
      id: "business-1",
      name: "Supplied Company",
      recordType: "business",
      email: "hello@example.test",
      phone: "+1 202 555 0142",
      contactMethods: [
        { id: "cm-1", kind: "email", value: "hello@example.test", label: "Work", isPrimary: true },
        { id: "cm-2", kind: "email", value: "billing@example.test", label: "Billing", isPrimary: false },
        { id: "cm-3", kind: "phone", value: "+1 202 555 0142", label: "Mobile", isPrimary: true },
      ],
      website: "https://example.test",
      linkedinUrl: "https://linkedin.com/in/supplied",
      streetAddress: "10 Peachtree St",
      location: "Atlanta, GA",
      zipCode: "30303",
      primaryOffer: "Advisory",
      notes: "Prefers email",
      tags: ["Priority"],
    });
    act(() => root.unmount());
  });

  it("requests the complete owner-editable People profile projection", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DetailHarness tenantId="tenant-fields" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-fields")).toBe(true));
    const columns = selections.find(({ table }) => table === "clients")?.columns ?? "";
    for (const field of ["street_address", "zip_code", "linkedin_url", "primary_offer", "current_notes"]) {
      expect(columns.split(",")).toContain(field);
    }
    // Every address comes from contact methods; the retired single-value columns are not read.
    expect(columns).toContain("client_contact_methods(id,kind,value,label,is_primary,position)");
    expect(columns.split(",")).not.toContain("email");
    expect(columns.split(",")).not.toContain("phone");
    act(() => root.unmount());
  });

  it("keeps the legacy non-Solo select contract narrow", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><Harness tenantId="tenant-legacy" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-legacy")).toBe(true));
    expect(selections.find(({ table }) => table === "clients")?.columns).toBe("id,first_name,last_name,entity_name,client_contact_methods(id,kind,value,label,is_primary,position),linked_user_id,lifecycle_stage,assigned_coach_user_id,last_contacted_at");
    act(() => root.unmount());
  });

  it("resolves an authorized deep link independently of the capped list", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DeepLinkHarness tenantId="tenant-deep" personId="outside-page" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-deep:outside-page")).toBe(true));
    await act(async () => {
      pending.get("clients:tenant-deep:outside-page")?.resolve({
        data: { id: "outside-page", first_name: "Direct", last_name: "Record", entity_name: null, entity_type: null, email: null, phone: null, title: null, website: null, city: null, state: null, source: null, status: "active", tags: [], do_not_contact: false, paige_shared_context_consent: false, linked_user_id: null, lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
        error: null,
      });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-record")).toContain("Direct Record"));
    act(() => root.unmount());
  });

  it("clears a deep-linked record on account change and rejects the older account response", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><DeepLinkHarness tenantId="tenant-a" personId="person-a" /></QueryClientProvider>));
    await vi.waitFor(() => expect(pending.has("clients:tenant-a:person-a")).toBe(true));
    await act(async () => root.render(<QueryClientProvider client={client}><DeepLinkHarness tenantId="tenant-b" personId="person-b" /></QueryClientProvider>));
    expect(host.querySelector("output")?.getAttribute("data-record")).toBe("");
    await vi.waitFor(() => expect(pending.has("clients:tenant-b:person-b")).toBe(true));
    await act(async () => {
      pending.get("clients:tenant-b:person-b")?.resolve({ data: { id: "person-b", first_name: "New", last_name: "Deep Link", entity_name: null, entity_type: null, email: null, phone: null, title: null, website: null, city: null, state: null, source: null, status: "active", tags: [], do_not_contact: false, paige_shared_context_consent: false, linked_user_id: null, lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector("output")?.getAttribute("data-record")).toContain("New Deep Link"));
    await act(async () => {
      pending.get("clients:tenant-a:person-a")?.resolve({ data: { id: "person-a", first_name: "Old", last_name: "Deep Link", entity_name: null, entity_type: null, email: null, phone: null, title: null, website: null, city: null, state: null, source: null, status: "active", tags: [], do_not_contact: false, paige_shared_context_consent: false, linked_user_id: null, lifecycle_stage: "client_active", assigned_coach_user_id: null, last_contacted_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null });
      await Promise.resolve();
    });
    expect(host.querySelector("output")?.getAttribute("data-record")).toContain("New Deep Link");
    expect(host.querySelector("output")?.getAttribute("data-record")).not.toContain("Old Deep Link");
    await act(async () => root.render(<QueryClientProvider client={client}><DeepLinkHarness tenantId={null} personId={null} /></QueryClientProvider>));
    expect(host.querySelector("output")?.getAttribute("data-record")).toBe("");
    act(() => root.unmount());
  });
});
