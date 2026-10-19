// Deterministic data boundary for the owner "Shared with {client}" harness (E09 Slice 3).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"); the signed-in Solo record against the real writer on a seeded test tenant is owed (§32/§70.1).
//
// The standing source is the REAL exp04 SQL-output fixture (as client-standing-mount uses it), extended with the
// fields 20271110030000 adds and passed through the REAL parser/composer by the REAL hook. Both RPCs answer in
// exactly the shapes the migration returns:
//
//   read_client_engagement_status(_expected_tenant_id, _contact_id)   — 20271110030000 §1e
//     work = { total, done, cancelled, blocked, open, overdue, undated_open, shared, items:[...], items_has_more }
//     `shared` counts shared AND not cancelled (what the client can see). Cancelling an item clears its share
//     (trg_plan_items_client_share_guard), so the read never returns a cancelled item as shared.
//     each item: id, plan_id, item_type, title, status, due_at, completed_at, assigned, shared, updated_at
//     (milestones and tasks only, open before done/cancelled by due_at, cap 50)
//   plan_item_set_client_share(p_expected_actor_id, p_expected_tenant_id, p_item_id, p_shared, p_expected_updated_at)
//     ok      -> { ok:true, replayed:false, item_id, shared, shared_at, updated_at, portal_connected }
//     replay  -> { ok:true, replayed:true, item_id, shared, shared_at, updated_at }        (state already matches)
//     refusal -> { ok:false, error:'ITEM_CHANGED', updated_at } | { ok:false, error:'ITEM_NOT_SHAREABLE' } (cancelled)
//                | { ok:false, error:<code> }
//     The writer bumps updated_at (trg_plan_items_touch) and writes no notification (D8): the stub counts any
//     functions.invoke so the drive can assert none happened.
//
//   ?state=populated|connected|empty|loading|refused|error|pending|confirm|confirm-joined|unshare|changed|addwork|
//          filter-private          (connected and confirm-joined: the client has joined the portal)
import source from "../../../../src/__tests__/fixtures/exp04-client-status-source.json";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "populated";
export const TENANT = source.tenant_id as string;
export const CLIENT = source.contact_id as string;
const NAME = "Jordan Rivera";
const ACTOR = "e0900000-0000-4000-8000-00000000f001"; // the business owner, signed in
const connected = state === "connected" || state === "confirm-joined";

type Item = {
  id: string; plan_id: string | null; item_type: "milestone" | "task"; title: string; status: string;
  due_at: string | null; completed_at: string | null; assigned: boolean; shared: boolean; updated_at: string;
};
let tick = 0;
const version = () => `2026-10-14T12:${String(10 + tick++).padStart(2, "0")}:00.000000+00:00`;
const base = (source.work.items as Omit<Item, "shared" | "updated_at">[]).map((i) => ({ ...i }));
const items: Item[] = [
  { ...base.find((i) => i.title === "Draft discovery report")!, shared: false, updated_at: version() },
  { ...base.find((i) => i.title === "Strategy review")!, shared: true, updated_at: version() },
  { id: "e4000000-0000-4000-8000-000000090004", plan_id: null, item_type: "task", title: "Brand workshop prep", status: "blocked", due_at: "2026-10-20T15:00:00+00:00", completed_at: null, assigned: true, shared: true, updated_at: version() },
  { id: "e4000000-0000-4000-8000-000000090006", plan_id: null, item_type: "task", title: "Homepage wireframe with the founder's notes on the studio's first year in Harbour Lane", status: "open", due_at: null, completed_at: null, assigned: false, shared: false, updated_at: version() },
  { ...base.find((i) => i.title === "Kickoff workshop")!, shared: true, updated_at: version() },
  { id: "e4000000-0000-4000-8000-000000090005", plan_id: null, item_type: "task", title: "Old proposal draft", status: "cancelled", due_at: null, completed_at: null, assigned: false, shared: false, updated_at: version() },
  // Shared, then cancelled inside the business: the cancel cleared the share, so it reads as not shared and a
  // later reopening never puts it back in front of the client without a new explicit share.
  { id: "e4000000-0000-4000-8000-000000090007", plan_id: null, item_type: "task", title: "Retired brief", status: "cancelled", due_at: null, completed_at: null, assigned: false, shared: false, updated_at: version() },
];

let reads = 0;
const writes: Record<string, unknown>[] = [];
let invokes = 0;
/** What the drive reads back: how many status reads and share writes happened, with what arguments. */
export const harness = { get reads() { return reads; }, get writes() { return writes; }, get invokes() { return invokes; } };
(window as unknown as { __harness: typeof harness }).__harness = harness;

function standing() {
  const src = { ...structuredClone(source), client_name: NAME } as Record<string, unknown>;
  delete src.receipt_id;
  const listed = state === "empty" ? [] : items;
  const order = [...listed].sort((a, b) => {
    const ac = ["done", "cancelled"].includes(a.status) ? 1 : 0, bc = ["done", "cancelled"].includes(b.status) ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const x = a.due_at ? Date.parse(a.due_at) : null, y = b.due_at ? Date.parse(b.due_at) : null;
    if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
    return a.id < b.id ? -1 : 1;
  });
  const openish = (s: string) => ["open", "in_progress", "blocked"].includes(s);
  const readAt = Date.parse(source.read_at as string);
  const work = {
    total: listed.length,
    done: listed.filter((i) => i.status === "done").length,
    cancelled: listed.filter((i) => i.status === "cancelled").length,
    blocked: listed.filter((i) => i.status === "blocked").length,
    open: listed.filter((i) => openish(i.status)).length,
    overdue: listed.filter((i) => openish(i.status) && i.due_at && Date.parse(i.due_at) < readAt).length,
    undated_open: listed.filter((i) => openish(i.status) && !i.due_at).length,
    shared: listed.filter((i) => i.shared && i.status !== "cancelled").length,
    items: order.slice(0, 50).map((i) => ({ ...i })),
    items_has_more: order.length > 50,
  };
  return { ...src, work };
}

function setShare(args: Record<string, unknown>) {
  writes.push({ ...args });
  if (state === "pending") return new Promise(() => {});
  const item = items.find((i) => i.id === args.p_item_id);
  if (!item) return Promise.resolve({ data: { ok: false, error: "ITEM_NOT_FOUND" }, error: null });
  if (item.shared === args.p_shared) {
    return Promise.resolve({ data: { ok: true, replayed: true, item_id: item.id, shared: item.shared, shared_at: item.shared ? item.updated_at : null, updated_at: item.updated_at }, error: null });
  }
  if (state === "changed") {
    // Someone moved the item on since the owner read it: the writer refuses and returns the current version.
    item.status = "in_progress";
    item.updated_at = version();
    return Promise.resolve({ data: { ok: false, error: "ITEM_CHANGED", updated_at: item.updated_at }, error: null });
  }
  if (args.p_expected_updated_at !== item.updated_at) {
    return Promise.resolve({ data: { ok: false, error: "ITEM_CHANGED", updated_at: item.updated_at }, error: null });
  }
  if (args.p_shared === true && item.status === "cancelled") return Promise.resolve({ data: { ok: false, error: "ITEM_NOT_SHAREABLE" }, error: null });
  item.shared = args.p_shared === true;
  item.updated_at = version();
  return Promise.resolve({
    data: { ok: true, replayed: false, item_id: item.id, shared: item.shared, shared_at: item.shared ? item.updated_at : null, updated_at: item.updated_at, portal_connected: connected },
    error: null,
  });
}

export const supabase = {
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    if (name === "read_client_engagement_status") {
      reads += 1;
      if (state === "loading") return new Promise(() => {});
      if (state === "refused") return { data: null, error: { code: "42501", message: "harness refusal" } };
      if (state === "error") return { data: null, error: { code: "57014", message: "harness failure" } };
      return { data: standing(), error: null };
    }
    if (name === "plan_item_set_client_share") return setShare(args);
    // The work creator ("Add work for {client}"): its team read, its projects read, its admin check.
    if (name === "get_solo_team_workspace") {
      return {
        data: {
          tenant_id: TENANT, tenant_name: "Northwind Studio", viewer_permission: "owner", can_manage_profiles: true,
          can_manage_invitations: true, can_change_permissions: true, total_members: 2, invitations: [],
          members: [
            { membership_id: "e0900000-0000-4000-8000-0000000f1001", user_id: ACTOR, full_name: "Avery Lin", email: "avery@northwind.example", avatar_url: null, status: "active", permission: "owner", is_owner: true, job_title: "Founder", responsibilities: null, last_sign_in_at: null },
            { membership_id: "e0900000-0000-4000-8000-0000000f1002", user_id: "e0900000-0000-4000-8000-00000000f002", full_name: "Sam Okafor", email: "sam@northwind.example", avatar_url: null, status: "active", permission: "member", is_owner: false, job_title: "Designer", responsibilities: null, last_sign_in_at: null },
          ],
        },
        error: null,
      };
    }
    if (name === "plan_list_operations_scoped" || name === "plan_list") return { data: { plans: [], loose_items: [] }, error: null };
    if (name === "is_tenant_admin") return { data: true, error: null };
    return { data: null, error: { message: `harness: unstubbed rpc ${name}` } };
  },
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "in", "order", "limit", "is"]) chain[k] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
    return chain;
  },
  auth: {
    getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: ACTOR }, access_token: "harness" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => undefined,
  functions: { invoke: async (name: string) => { invokes += 1; return { data: null, error: { message: `harness: unstubbed function ${name}` } }; } },
};

export function useTenantContext() {
  return {
    activeTenantId: TENANT, activeUserId: ACTOR,
    activeTenant: { id: TENANT, name: "Northwind Studio (synthetic)", account_type: "standalone", parent_tenant_id: null, account_number: 42 },
    accountContextLoading: false, accountContextStatus: "ready", loading: false, isPlatformStaff: false, isPlatformOwner: false, refresh: () => undefined,
  };
}
export function useUserRoles() { return { loading: false, userId: ACTOR, roles: ["admin"], isAdmin: true, isClient: false, isStaff: true }; }

const person = {
  id: CLIENT, firstName: "Jordan", lastName: "Rivera", name: NAME, recordType: "person", entityType: null, company: "Rivera Design",
  contactMethods: [{ id: "e1", kind: "email", value: "jordan@rivera.example", label: "Work", isPrimary: true }],
  email: "jordan@rivera.example", phone: null, title: null, website: null, linkedinUrl: null, streetAddress: null, city: null, state: null, zipCode: null,
  location: null, source: "referral", status: "active", tags: [], doNotContact: false, sharedContextConsent: false,
  linkedUserId: connected ? "e0900000-0000-4000-8000-00000000c001" : null, relationship: "client active",
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
