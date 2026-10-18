import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPortalReleasedWork, useClientPortalReleasedWork } from "./useClientPortalReleasedWork";

const f = vi.hoisted(() => ({
  user: { id: "e0914000-0000-4000-8000-000000000001" } as { id: string } | null,
  rpc: vi.fn(), from: vi.fn(),
  listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    getUser: async () => ({ data: { user: f.user }, error: null }),
    onAuthStateChange: (cb: typeof f.listener) => { f.listener = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
  },
  rpc: (...a: unknown[]) => f.rpc(...a),
  // Released work must never be scoped through the CRM table a customer cannot read.
  from: (...a: unknown[]) => f.from(...a),
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const actor = "e0914000-0000-4000-8000-000000000001", tenant = "e0924000-0000-4000-8000-000000000001", contact = "e0934000-0000-4000-8000-000000000001";
const profile = (id = contact, tenantId = tenant) => ({ id, tenant_id: tenantId, linked_user_id: actor, first_name: "Jordan", last_name: "Rivera", entity_name: null, street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: "2026-01-01T00:00:00Z", email: "jordan@example.test", phone: null, contact_methods: [] });
const release = (n: number, state = "awaiting_client") => ({ release_id: `e0954000-0000-4000-8000-${String(n).padStart(12, "0")}`, submission_id: `e0964000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  state, revision_no: 1, artifact_digest: "a".repeat(64), title: `Launch plan ${n}`, updated_at: "2026-01-02T00:00:00Z" });
const reviews = (releases: unknown[], extra: Record<string, unknown> = {}) => ({ data: { actor_id: actor, tenant_id: tenant, releases, unavailable_count: 0, has_more: false, ...extra }, error: null });

let profiles: unknown[] = [];
beforeEach(() => {
  vi.clearAllMocks(); f.user = { id: actor }; f.listener = null; profiles = [];
  f.rpc.mockImplementation(async (name: string) => {
    if (name === "client_portal_self_profile") return { data: profiles.length ? profiles.shift() : profile(), error: null };
    if (name === "operations_delivery_client_reviews_scoped") return reviews([release(1)]);
    throw new Error(`unexpected rpc ${name}`);
  });
});

describe("readPortalReleasedWork", () => {
  it("scopes from the customer's own relationship and never reads the clients table", async () => {
    const work = await readPortalReleasedWork(() => true);
    expect(work.kind).toBe("ready");
    expect(work.kind === "ready" && work.scope).toEqual({ actorId: actor, tenantId: tenant, clientId: contact });
    expect(f.rpc).toHaveBeenCalledWith("operations_delivery_client_reviews_scoped", { p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_limit: 40 });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("keeps #2156's 40-row limit and partial-list counts", async () => {
    f.rpc.mockImplementation(async (name: string) => name === "client_portal_self_profile" ? { data: profile(), error: null }
      : reviews(Array.from({ length: 38 }, (_, i) => release(i + 1)), { unavailable_count: 2, has_more: true }));
    const work = await readPortalReleasedWork(() => true);
    expect(work.kind === "ready" && [work.releases.length, work.unavailableCount, work.hasMore]).toEqual([38, 2, true]);
    f.rpc.mockImplementation(async (name: string) => name === "client_portal_self_profile" ? { data: profile(), error: null }
      : reviews(Array.from({ length: 40 }, (_, i) => release(i + 1)), { unavailable_count: 1 }));
    expect((await readPortalReleasedWork(() => true)).kind).toBe("unavailable");
  });
  it("hides the section where the business cannot release work (not a failure the customer can fix)", async () => {
    f.rpc.mockImplementation(async (name: string) => name === "client_portal_self_profile" ? { data: profile(), error: null }
      : { data: null, error: { code: "42501", message: "DELIVERY_CLIENT_REVIEWS_UNAVAILABLE" } });
    expect((await readPortalReleasedWork(() => true)).kind).toBe("hidden");
  });
  it("reports any other failed read as unavailable", async () => {
    f.rpc.mockImplementation(async (name: string) => name === "client_portal_self_profile" ? { data: profile(), error: null }
      : { data: null, error: { code: "PGRST000", message: "network" } });
    expect((await readPortalReleasedWork(() => true)).kind).toBe("unavailable");
  });
  it("refuses a list whose relationship changed while it was read", async () => {
    profiles = [profile(), profile("e0934000-0000-4000-8000-000000000002")];
    expect((await readPortalReleasedWork(() => true)).kind).toBe("unavailable");
  });
  it.each([["signed out", null], ["no relationship", "none"], ["more than one business", "multi"]])("is hidden when %s", async (_label, mode) => {
    if (mode === null) f.user = null;
    f.rpc.mockImplementation(async (name: string) => name !== "client_portal_self_profile" ? reviews([])
      : mode === "multi" ? { data: null, error: { code: "42501", message: "select an authorized customer relationship" } } : { data: null, error: null });
    expect((await readPortalReleasedWork(() => true)).kind).toBe("hidden");
    expect(f.rpc).not.toHaveBeenCalledWith("operations_delivery_client_reviews_scoped", expect.anything());
  });
});

describe("useClientPortalReleasedWork", () => {
  let root: Root, host: HTMLDivElement, state: ReturnType<typeof useClientPortalReleasedWork>;
  function Probe() { state = useClientPortalReleasedWork(); return null; }
  const flush = async () => act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  it("drops a read that lands after the signed-in actor changed, and clears the list", async () => {
    await act(async () => root.render(<Probe />)); await flush();
    expect(state.work?.kind).toBe("ready");
    let resolve!: (v: unknown) => void;
    f.rpc.mockImplementation((name: string) => name === "client_portal_self_profile" ? Promise.resolve({ data: profile(), error: null })
      : new Promise(r => { resolve = r; }));
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    const epoch = state.epoch;
    f.user = { id: "e0914000-0000-4000-8000-000000000002" };
    act(() => f.listener?.("SIGNED_IN", { user: f.user! }));
    expect(state.epoch).toBeGreaterThan(epoch);
    expect(state.work).toBeNull();
    resolve(reviews([release(9)])); await flush();
    expect(state.work === null || state.work.kind !== "ready" || !state.work.releases.some(r => r.title === "Launch plan 9")).toBe(true);
  });
});
