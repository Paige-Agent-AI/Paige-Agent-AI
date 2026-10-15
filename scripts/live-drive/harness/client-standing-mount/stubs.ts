// Deterministic data boundary for the client-standing harness. HARNESS RENDER · NOT LIVE: every value is
// synthetic; the signed-in Solo record is a separate, owed check (§32/§70.1). The standing source is the
// REAL SQL output fixture (exp04 SQL proof), passed through the real parser and composer by the real hook.
import source from "../../../../src/__tests__/fixtures/exp04-client-status-source.json";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "populated";
export const TENANT = source.tenant_id as string;
export const CLIENT = source.contact_id as string;
const NAME = "Jordan Reyes";

function standing() {
  const base = { ...structuredClone(source), client_name: NAME } as Record<string, unknown>;
  delete base.receipt_id; // PR beta: the read returns no receipt id
  if (state === "empty") return { ...base, terms: [], signings: [], invoices: [], work: { ...(source.work as object), total: 0, done: 0, open: 0, overdue: 0, blocked: 0, cancelled: 0, undated_open: 0, items: [] } };
  if (state === "nozone") return { ...base, business_time_zone: { state: "missing", zone: null }, as_of_date: null };
  return base;
}

export const supabase = {
  rpc: async (name: string) => {
    if (name === "read_client_engagement_status") {
      if (state === "loading") return new Promise(() => {});
      if (state === "refused") return { data: null, error: { code: "42501", message: "harness refusal" } };
      if (state === "error") return { data: null, error: { code: "57014", message: "harness failure" } };
      return { data: standing(), error: null };
    }
    return { data: null, error: { message: `unstubbed rpc ${name}` } };
  },
  from: () => { const chain: Record<string, unknown> = {}; for (const k of ["select", "eq", "in", "order", "limit", "is"]) chain[k] = () => chain; chain.maybeSingle = async () => ({ data: null, error: null }); chain.then = (r: (v: unknown) => unknown) => r({ data: [], error: null }); return chain; },
  auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => undefined,
  functions: { invoke: async () => ({ data: null, error: { message: "harness" } }) },
};

export function useTenantContext() {
  return {
    activeTenantId: TENANT, activeTenant: { id: TENANT, name: "Reyes Build Co. (synthetic)", account_type: "standalone", parent_tenant_id: null, account_number: 42 },
    accountContextLoading: false, loading: false, isPlatformStaff: false, isPlatformOwner: false, refresh: () => undefined,
  };
}
export function useUserRoles() { return { loading: false, userId: "harness-owner", roles: ["admin"], isAdmin: true, isClient: false, isStaff: true }; }

const person = {
  id: CLIENT, firstName: "Jordan", lastName: "Reyes", name: NAME, recordType: "person", entityType: null, company: "Reyes Build Co.",
  contactMethods: [{ id: "e1", kind: "email", value: "jordan@reyesbuild.example", label: "Work", isPrimary: true }],
  email: "jordan@reyesbuild.example", phone: null, title: null, website: null, linkedinUrl: null, streetAddress: null, city: null, state: null, zipCode: null,
  location: null, source: "referral", status: "active", tags: [], doNotContact: false, sharedContextConsent: false, linkedUserId: null, relationship: "client active",
  lifecycleStage: "client_active", primaryOffer: null, notes: null, assignedCoachUserId: null, owner: "Unassigned", lastTouch: null, createdAt: null, updatedAt: null,
};
export function useTenantRelationshipsData() {
  return {
    people: [person], peopleLoading: false, peopleError: false, retryPeople: async () => undefined, peopleAvailable: true,
    deepLinkedPerson: person, deepLinkLoading: false, deepLinkError: false, retryDeepLink: async () => undefined,
    portalConfig: {}, portalLoading: false, portalError: false, retryPortal: async () => undefined,
  };
}
export type RelationshipWorkspaceVariant = "clients" | "relationships";
