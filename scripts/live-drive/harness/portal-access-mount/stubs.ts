// Deterministic data boundary for the portal access harness (E09 Slice 7).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Avery Lin"); the signed-in owner pause/restore/end and the signed-in customer's paused/ended page against the
// real migration on a seeded test tenant are owed (§32/§70.1).
//
// The RPCs answer in exactly the shapes the plan's server contract names (slice7-plan §1c/§1d):
//   read_client_portal_access(_expected_tenant_id, _contact_id)
//     -> { state, joined, since, changed_by_name, reason, note, invitation:{status}, can:{pause,restore,end,invite},
//          restore_blocked_by }
//   set_client_portal_access(p_expected_actor_id, p_expected_tenant_id, p_contact_id, p_action, p_reason, p_note,
//                            p_expected_changed_at)
//     -> { ok:true, replayed:false, ... } | { ok:false, error:'ACCESS_CHANGED' | ... }
//     Version guard on portal_access_changed_at (the read's `since`). No notification is sent (D4): the stub
//     counts any functions.invoke so the drive can assert none happened.
//   client_portal_access_state() -> { state:'paused'|'ended', business:{name, logo_url}, since } | { state:'open'|'none' }
//   client_portal_frame() -> the Slice 1 frame, or NULL once access is withheld (the resolver predicate).
import source from "../../../../src/__tests__/fixtures/exp04-client-status-source.json";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "joined";
const surface = params.get("surface") ?? "owner";
/** §60/§61: the contact panel reaches Solo, Sub-account and Enterprise (customer_portal_invite). */
const tier = params.get("tier") ?? "standalone";
export const TENANT = source.tenant_id as string;
export const CLIENT = source.contact_id as string;
const NAME = "Jordan Rivera";
const ACTOR = "e0900000-0000-4000-8000-00000000f001"; // the business owner, signed in
export const CUSTOMER = "e0900000-0000-4000-8000-00000000c001"; // the client's own login
const BUSINESS = "Northwind Studio";

type Access = { state: "open" | "paused" | "ended"; joined: boolean; since: string | null; changed_by_name: string | null; reason: string | null; note: string | null; invitation: { status: string } };
let tick = 0;
const stamp = () => `2026-10-18T14:${String(10 + tick++).padStart(2, "0")}:00.000000+00:00`;
const initial: Access =
  state === "paused" || state === "confirm-restore" || state === "shared-paused" || state === "header-paused"
    ? { state: "paused", joined: true, since: "2026-10-16T15:20:00.000000+00:00", changed_by_name: "Avery Lin", reason: "payment", note: "Waiting on the October retainer — restore as soon as it clears.", invitation: { status: "accepted" } }
    : state === "ended" || state === "reinvite" || state === "header-ended"
      ? { state: "ended", joined: false, since: "2026-10-12T09:05:00.000000+00:00", changed_by_name: "Avery Lin", reason: "engagement_ended", note: null, invitation: { status: "accepted" } }
      : state === "notjoined"
        ? { state: "open", joined: false, since: null, changed_by_name: null, reason: null, note: null, invitation: { status: "pending" } }
        : { state: "open", joined: true, since: null, changed_by_name: null, reason: null, note: null, invitation: { status: "accepted" } };
const access: Access = { ...initial };

let reads = 0;
const writes: Record<string, unknown>[] = [];
let invokes = 0;
let customerPaused = (surface === "customer" && state !== "midsession") || surface === "invite";
export const harness = {
  get reads() { return reads; }, get writes() { return writes; }, get invokes() { return invokes; },
  /** Mid-session: the owner pauses while the customer's portal is open. */
  pauseNow() { customerPaused = true; },
};
(window as unknown as { __harness: typeof harness }).__harness = harness;

const projection = () => ({
  ...access,
  can: {
    pause: access.state === "open" && access.joined,
    restore: access.state === "paused",
    end: access.state === "paused" || (access.state === "open" && access.joined),
    invite: access.state === "ended" || (access.state === "open" && !access.joined),
  },
  restore_blocked_by: null,
});

function setAccess(args: Record<string, unknown>) {
  writes.push({ ...args });
  if (state === "changed") {
    // Someone else paused this client a moment ago: the writer refuses, the read returns the new state.
    Object.assign(access, { state: "paused", joined: true, since: stamp(), changed_by_name: "Sam Okafor", reason: "client_request", note: null });
    return Promise.resolve({ data: { ok: false, error: "ACCESS_CHANGED", state: "paused" }, error: null });
  }
  if ((args.p_expected_changed_at ?? null) !== access.since) return Promise.resolve({ data: { ok: false, error: "ACCESS_CHANGED" }, error: null });
  const action = args.p_action;
  if (action === "pause") Object.assign(access, { state: "paused", since: stamp(), changed_by_name: "Avery Lin", reason: args.p_reason, note: args.p_note ?? null });
  if (action === "restore") Object.assign(access, { state: "open", since: stamp(), changed_by_name: "Avery Lin", reason: null, note: null });
  if (action === "end") Object.assign(access, { state: "ended", joined: false, since: stamp(), changed_by_name: "Avery Lin", reason: args.p_reason, note: args.p_note ?? null });
  return Promise.resolve({ data: { ok: true, replayed: false, ...projection() }, error: null });
}

function standing() {
  const src = { ...structuredClone(source), client_name: NAME } as Record<string, unknown>;
  delete src.receipt_id;
  return { ...src, work: { total: 0, done: 0, cancelled: 0, blocked: 0, open: 0, overdue: 0, undated_open: 0, shared: 0, items: [], items_has_more: false } };
}

const frame = () => ({
  actor_id: CUSTOMER,
  profile: { id: CLIENT, tenant_id: TENANT, linked_user_id: CUSTOMER, first_name: "Jordan", last_name: "Rivera", entity_name: null, street_address: null, city: null, state: null, zip_code: null,
    onboarding_stage: "completed", is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: null,
    email: "jordan@rivera.example", phone: null, contact_methods: [] },
  brand: { tenant_id: TENANT, tenant_name: BUSINESS, tenant_slug: "northwind-studio", logo_url: null, primary_color: "#304E42", support_email: null },
  config: {},
});

async function answer(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (name === "read_client_portal_access") {
      reads += 1;
      if (state === "loading") return new Promise(() => {});
      if (state === "refused") return { data: null, error: { code: "42501", message: "harness refusal" } };
      if (state === "error") return { data: null, error: { code: "57014", message: "harness failure" } };
      return { data: projection(), error: null };
    }
    if (name === "set_client_portal_access") return setAccess(args);
    // The old invitation link, opened after the business paused or ended access (ConsumerInvitation).
    if (name === "client_portal_invite_status") return { data: { tenant_id: TENANT, client_id: CLIENT, accepted_at: "2026-09-02T09:00:00Z", status: state === "ended" ? "ended" : "paused" }, error: null };
    if (name === "read_client_engagement_status") return { data: standing(), error: null };
    if (name === "client_portal_owner_invitations") {
      return { data: { actor_id: ACTOR, tenant_id: TENANT, invitations: [
        { id: "e0900000-0000-4000-8000-0000000a0001", contact_id: CLIENT, email: "jordan@rivera.example", created_at: "2026-09-01T12:00:00Z", expires_at: "2026-10-01T12:00:00Z", last_used_at: "2026-09-02T09:00:00Z", revoked_at: null, delivery: { history: [], truncated: false } },
        ...(state.startsWith("roster") ? ROSTER_INVITES : []),
      ] }, error: null };
    }
    if (name === "can_manage_tenant_brand") return { data: true, error: null };
    if (name === "is_tenant_admin") return { data: true, error: null };
    // Customer surface.
    if (name === "client_portal_frame") return { data: customerPaused ? null : frame(), error: null };
    if (name === "client_portal_access_state") {
      if (!customerPaused) return { data: { state: "open" }, error: null };
      const logo = state === "paused-logo" ? { logo_url: LOGO_LIGHT, logo_dark_url: LOGO_DARK } : { logo_url: null };
      return { data: { state: state === "ended" ? "ended" : "paused", business: { name: BUSINESS, ...logo }, since: "2026-10-18T14:00:00Z" }, error: null };
    }
    return { data: null, error: { message: `harness: unstubbed rpc ${name}` } };
}

export const supabase = {
  // The invitation history read chains .abortSignal() onto the call, as the real client allows.
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    const call = answer(name, args);
    return Object.assign(call, { abortSignal: () => call });
  },
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "in", "order", "limit", "is"]) chain[k] = () => chain;
    // The contact panel's own reads: the contact's link and access columns, its invitation tokens.
    if (surface === "panel" && table === "clients") {
      chain.maybeSingle = async () => ({ data: { linked_user_id: access.joined ? CUSTOMER : null, portal_access_state: access.state, portal_access_changed_at: access.since }, error: null });
      chain.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
      return chain;
    }
    if (surface === "panel" && table === "tenant_invite_tokens") {
      chain.then = (r: (v: unknown) => unknown) => r({ data: [{ id: "tok-1", email: "jordan@rivera.example", expires_at: "2026-10-01T12:00:00Z", last_used_at: "2026-09-02T09:00:00Z", created_at: "2026-09-01T12:00:00Z", revoked_at: null }], error: null });
      return chain;
    }
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.abortSignal = () => chain;
    chain.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
    return chain;
  },
  auth: {
    getUser: async () => ({ data: { user: surface === "invite"
      ? { id: CUSTOMER, email: "jordan@rivera.example", email_confirmed_at: "2026-09-02T08:00:00Z" }
      : { id: surface === "customer" ? CUSTOMER : ACTOR } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: surface === "customer" ? CUSTOMER : ACTOR }, access_token: "harness" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => undefined,
  functions: { invoke: async (name: string) => { invokes += 1; return { data: null, error: { message: `harness: unstubbed function ${name}` } }; } },
};

export function useTenantContext() {
  return {
    activeTenantId: TENANT, activeUserId: ACTOR,
    activeTenant: { id: TENANT, name: BUSINESS, account_type: tier, parent_tenant_id: tier === "sub_account" ? "e0900000-0000-4000-8000-0000000a9999" : null, account_number: 42 },
    accountContextLoading: false, accountContextStatus: "ready", loading: false, isPlatformStaff: false, isPlatformOwner: false, refresh: () => undefined,
  };
}
export function useUserRoles() { return { loading: false, userId: ACTOR, roles: ["admin"], isAdmin: true, isClient: false, isStaff: true }; }

const person = {
  id: CLIENT, firstName: "Jordan", lastName: "Rivera", name: NAME, recordType: "person", entityType: null, company: "Rivera Design",
  contactMethods: [{ id: "e1", kind: "email", value: "jordan@rivera.example", label: "Work", isPrimary: true }],
  email: "jordan@rivera.example", phone: null, title: null, website: null, linkedinUrl: null, streetAddress: null, city: null, state: null, zipCode: null,
  location: null, source: "referral", status: "active", tags: [], doNotContact: false, sharedContextConsent: false,
  linkedUserId: initial.joined ? CUSTOMER : null, portalAccess: initial.state, portalAccessChangedAt: initial.since, relationship: "client active",
  lifecycleStage: "client_active", primaryOffer: null, notes: null, assignedCoachUserId: null, owner: "Unassigned", lastTouch: null, createdAt: null, updatedAt: null,
};
const other = (id: string, first: string, last: string, portalAccess: "open" | "paused" | "ended", linked: boolean) => ({
  ...person, id, firstName: first, lastName: last, name: `${first} ${last}`, company: null, email: `${first.toLowerCase()}@example.test`,
  contactMethods: [{ id: `${id}-e`, kind: "email", value: `${first.toLowerCase()}@example.test`, label: "Work", isPrimary: true }],
  linkedUserId: linked ? `${id}-login` : null, portalAccess, portalAccessChangedAt: portalAccess === "open" ? null : "2026-10-14T10:00:00Z",
});
// The Portal dashboard's roster (state=roster): one paused, one ended, one joined, one not invited.
const ROSTER = [
  { ...person, linkedUserId: CUSTOMER, portalAccess: "paused" as const, portalAccessChangedAt: "2026-10-16T15:20:00Z" },
  other("e4000000-0000-4000-8000-0000000c0002", "Sam", "Okafor", "ended", false),
  other("e4000000-0000-4000-8000-0000000c0003", "Maya", "Ortiz", "open", true),
  other("e4000000-0000-4000-8000-0000000c0004", "Theo", "Barnes", "open", false),
];
const ROSTER_INVITES = [
  { id: "e0900000-0000-4000-8000-0000000a0002", contact_id: "e4000000-0000-4000-8000-0000000c0002", email: "sam@example.test", created_at: "2026-08-01T12:00:00Z", expires_at: "2026-08-31T12:00:00Z", last_used_at: "2026-08-02T09:00:00Z", revoked_at: null, delivery: { history: [], truncated: false } },
  { id: "e0900000-0000-4000-8000-0000000a0003", contact_id: "e4000000-0000-4000-8000-0000000c0003", email: "maya@example.test", created_at: "2026-09-10T12:00:00Z", expires_at: "2026-10-10T12:00:00Z", last_used_at: "2026-09-11T09:00:00Z", revoked_at: null, delivery: { history: [], truncated: false } },
];
// A synthetic wordmark for the business (no real brand): light and dark variants, as the access read returns.
const mark = (fg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="56" viewBox="0 0 220 56"><rect x="2" y="10" width="36" height="36" rx="9" fill="${fg}"/><path d="M12 38V18l16 20V18" stroke="${fg === "#1f3b33" ? "#f4efe6" : "#14231f"}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="48" y="36" font-family="Georgia, serif" font-size="20" fill="${fg}">Northwind Studio</text></svg>`)}`;
const LOGO_LIGHT = mark("#1f3b33");
const LOGO_DARK = mark("#e7efe9");
export function useTenantRelationshipsData() {
  return {
    people: state.startsWith("roster") ? ROSTER : [person], peopleLoading: false, peopleError: false, retryPeople: async () => undefined, peopleAvailable: true,
    refreshPeopleAfterTurn: async () => undefined,
    deepLinkedPerson: person, deepLinkLoading: false, deepLinkError: false, retryDeepLink: async () => undefined,
    portalConfig: {}, portalLoading: false, portalError: false, retryPortal: async () => undefined,
  };
}
export type RelationshipWorkspaceVariant = "clients" | "relationships";
