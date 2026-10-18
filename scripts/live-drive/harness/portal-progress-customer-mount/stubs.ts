// Deterministic data boundary for the customer portal Progress harness (E09 Slice 3).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"); the signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientPortalProgress / usePortalProgressGlance hooks (exact-key
// parsers included), the REAL useMyActions, the REAL brand/config readers, the REAL playbook resolver and the
// REAL NotificationBell all run against this client. The payloads follow the contracts as they stand in the
// worktree, and the progress read is computed the way the SQL computes it, from a plan_items-shaped store that
// deliberately holds rows the customer must NOT see:
//
//   client_portal_progress(p_tenant_id, p_limit)         — 20271110030000_e09_customer_portal_progress.sql §1c
//     -> { tenant_id, server_now, summary:{shared,done,open,overdue}, items:[...], has_more } | null
//     visible = tenant AND this contact AND client_shared_at IS NOT NULL AND item_type IN (milestone,task)
//               AND status <> 'cancelled'   (and cancelling clears client_shared_at, so a cancelled row is never shared)
//     order   = open first (due_at ASC NULLS LAST, id), then done (completed_at DESC NULLS LAST, id)
//     each item has EXACTLY: id, kind, title (left 200), state (done|not_started for open|in_progress
//       otherwise, so blocked reads as in_progress), due_at, completed_at, shared_at,
//       parent_id (only a VISIBLE milestone parent, else null)
//     limit clamped 1..100; has_more = visible count > limit; summary counts every visible row.
//     no relationship -> null; more than one business -> 42501 "select an authorized customer relationship".
//   client_portal_self_profile                           — the exact 19-key shape readClientPortalSelfProfile accepts
//   paige_customer_actions select (useMyActions)         — the exact 11-key row useMyActions accepts
//   client_portal_sessions                               — an empty, valid page (the home's Next session tile)
//
//   ?state=populated|empty|alldone|loading|unavailable|multiple|error|hasmore|home|home-empty|home-error
//   error: the FIRST read succeeds and every later read fails, so "error with stale data" is reached by the
//   page's own refresh (a window focus), never by injecting state.
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "populated";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const OTHER_TENANT = "e0900000-0000-4000-8000-00000000b002";
const CONTACT = "e0900000-0000-4000-8000-00000000d001"; // Jordan Rivera, the signed-in customer
const OTHER_CONTACT = "e0900000-0000-4000-8000-00000000d002"; // Sam Okafor, another customer of the business
const USER = { id: "e0900000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
const DAY = 86_400_000;

/** A local (viewer, America/Chicago in the drive) wall-clock time `days` from the (Playwright-fixed) now. */
function at(days: number, h = 17, m = 0) {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

type PlanItem = {
  id: string; tenant_id: string; contact_id: string | null; item_type: "milestone" | "task" | "reminder";
  title: string; status: "open" | "in_progress" | "blocked" | "done" | "cancelled"; due_at: string | null;
  completed_at: string | null; client_shared_at: string | null; parent_item_id: string | null;
  // Private columns that live on the row and must never reach the customer.
  summary: string | null; priority: string; assigned_to_user_id: string | null;
};

let seq = 0;
const nid = () => `e0900000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;
const M_BRAND = nid(), M_SITE = nid(), M_ADS = nid(), M_KICKOFF = nid();
const row = (o: Partial<PlanItem> & Pick<PlanItem, "title">): PlanItem => ({
  id: nid(), tenant_id: TENANT, contact_id: CONTACT, item_type: "task", status: "open", due_at: null, completed_at: null,
  client_shared_at: at(-10, 9), parent_item_id: null, summary: "Internal note: margin is thin on this one",
  priority: "high", assigned_to_user_id: "e0900000-0000-4000-8000-00000000e001", ...o,
});

/** Every string the customer must never see, whatever the state. The drive asserts each is absent. */
export const PRIVATE_TITLES = [
  "Internal pricing review", "Paid ads plan", "Old proposal draft", "Call Jordan back", "Sam's onboarding pack",
  "Northwind internal retro",
];

function store(): PlanItem[] {
  // Rows the customer must never see, present in every state.
  const hidden: PlanItem[] = [
    row({ title: "Internal pricing review", parent_item_id: M_BRAND, due_at: at(4), client_shared_at: null }), // not shared
    row({ id: M_ADS, item_type: "milestone", title: "Paid ads plan", due_at: at(40), client_shared_at: null }), // private milestone
    // Shared, then cancelled: the share guard (trg_plan_items_client_share_guard) cleared the share on cancel, so
    // reopening it never re-exposes it without a new explicit share. Hidden twice over: unshared AND cancelled.
    row({ title: "Old proposal draft", status: "cancelled", client_shared_at: null }),
    row({ item_type: "reminder", title: "Call Jordan back", due_at: at(1), client_shared_at: null }), // reminders are never shareable
    row({ contact_id: OTHER_CONTACT, title: "Sam's onboarding pack", due_at: at(2) }), // another customer's shared work
    row({ tenant_id: OTHER_TENANT, title: "Northwind internal retro", due_at: at(6) }), // another business entirely
  ];
  if (state === "empty" || state === "home-empty") return hidden;
  const done: PlanItem[] = [
    row({ title: "Discovery questionnaire", status: "done", due_at: at(-7), completed_at: at(-6, 11) }),
    row({ id: M_KICKOFF, item_type: "milestone", title: "Kickoff", status: "done", completed_at: at(-9, 10) }),
    row({ title: "Sign the engagement letter", status: "done", completed_at: at(-12, 9), parent_item_id: M_KICKOFF }),
  ];
  if (state === "alldone") return [...hidden, ...done];
  const open: PlanItem[] = [
    row({ id: M_BRAND, item_type: "milestone", title: "Brand identity", status: "in_progress", due_at: at(9) }),
    // Blocked inside the business: the customer reads it as In progress (D3). Past due.
    row({ title: "Send the brand assets folder", status: "blocked", due_at: at(-2), parent_item_id: M_BRAND }),
    row({ title: "First logo concepts", status: "in_progress", due_at: at(3), parent_item_id: M_BRAND }),
    row({ title: "Colour palette and type pairing", due_at: at(8), parent_item_id: M_BRAND }),
    row({ id: M_SITE, item_type: "milestone", title: "Website launch", due_at: at(30) }),
    row({ title: "Homepage wireframe", due_at: at(18), parent_item_id: M_SITE }),
    row({ title: "Review the moodboard", due_at: at(0, 17) }), // due later today
    // Shared, under a milestone that is NOT shared: parent_id comes back null, so it sits in Other work.
    row({ title: "Ad copy first draft", due_at: at(12), parent_item_id: M_ADS }),
    row({ title: "Book the product photographer", due_at: at(5) }),
    row({ title: "Draft the About page copy with your notes on the founding story and the studio's first year in Harbour Lane", due_at: null }),
  ];
  const many: PlanItem[] = state === "hasmore"
    ? Array.from({ length: 96 }, (_, k) => row({ title: `Weekly check-in ${String(k + 1).padStart(2, "0")}`, due_at: at(31 + k) }))
    : [];
  return [...hidden, ...open, ...many, ...done];
}

/** client_portal_progress, computed exactly as the SQL computes it (see the header). */
function project(rows: PlanItem[], pLimit: unknown, nowMs: number) {
  const limit = Math.min(Math.max(typeof pLimit === "number" ? pLimit : 100, 1), 100);
  const visible = rows.filter((r) => r.tenant_id === TENANT && r.contact_id === CONTACT && r.client_shared_at !== null
    && (r.item_type === "milestone" || r.item_type === "task") && r.status !== "cancelled");
  const t = (v: string | null) => (v === null ? null : Date.parse(v));
  const ranked = [...visible].sort((a, b) => {
    const ad = a.status === "done" ? 1 : 0, bd = b.status === "done" ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (!ad) {
      const x = t(a.due_at), y = t(b.due_at);
      if (x !== y) return x === null ? 1 : y === null ? -1 : x - y; // ASC NULLS LAST
    } else {
      const x = t(a.completed_at), y = t(b.completed_at);
      if (x !== y) return x === null ? 1 : y === null ? -1 : y - x; // DESC NULLS LAST
    }
    return a.id < b.id ? -1 : 1;
  });
  const byId = new Map(visible.map((r) => [r.id, r]));
  const items = ranked.slice(0, limit).map((r) => ({
    id: r.id,
    kind: r.item_type,
    title: r.title.slice(0, 200),
    state: r.status === "done" ? "done" : r.status === "open" ? "not_started" : "in_progress",
    due_at: r.due_at,
    completed_at: r.completed_at,
    shared_at: r.client_shared_at,
    parent_id: r.parent_item_id && byId.get(r.parent_item_id)?.item_type === "milestone" ? r.parent_item_id : null,
  }));
  const open = visible.filter((r) => r.status !== "done");
  return {
    tenant_id: TENANT,
    server_now: new Date(nowMs).toISOString(),
    summary: {
      shared: visible.length,
      done: visible.length - open.length,
      open: open.length,
      overdue: open.filter((r) => r.due_at !== null && Date.parse(r.due_at) < nowMs).length,
    },
    items,
    has_more: visible.length > limit,
  };
}

const rows = store();
let progressReads = 0;
export const harnessCalls = { get progressReads() { return progressReads; } };

function progress(args: Record<string, unknown>) {
  progressReads += 1;
  if (state === "loading") return new Promise(() => {});
  if (state === "unavailable") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  if (state === "home-error") return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  // A first read that lands, then a connection that drops: the page must keep the list and say so.
  if (state === "error" && progressReads > 1) return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  return Promise.resolve({ data: project(rows, args.p_limit, Date.now()), error: null });
}

const PROFILE = {
  id: CONTACT, tenant_id: TENANT, linked_user_id: USER.id, first_name: "Jordan", last_name: "Rivera", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: at(-30), email: USER.email,
  phone: null, contact_methods: [],
};

/** The customer's own action items (useMyActions): two waiting in the populated states, none elsewhere. */
const ACTIONS = state === "populated" || state === "home" || state === "error"
  ? ["Confirm the photoshoot date", "Upload your logo files"].map((title, k) => ({
    id: `e0900000-0000-4000-a000-00000000000${k + 1}`, tenant_id: TENANT, contact_id: CONTACT, updated_at: at(-1), action_type: "task",
    title, body: null, status: "customer_notified", expires_at: at(20), created_at: at(-1, 9 + k), paige_customer_responses: [],
  }))
  : [];

function brand() {
  if (state === "unavailable") return Promise.resolve({ data: [], error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

/** Table reads: paige_customer_actions answers useMyActions; every other read resolves empty. */
function chain(table: string): unknown {
  const result = table === "paige_customer_actions" ? { data: ACTIONS, error: null, count: ACTIONS.length } : { data: [], error: null, count: 0 };
  const single = { data: null, error: null };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve(single);
      return () => proxy;
    },
  });
  return proxy;
}

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_progress") return progress(args);
    if (name === "client_portal_self_profile") {
      if (state === "unavailable") return Promise.resolve({ data: null, error: null });
      if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
      return Promise.resolve({ data: PROFILE, error: null });
    }
    if (name === "client_portal_sessions") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), sessions: [], next_before: null }, error: null });
    }
    if (name === "get_client_portal_brand") return brand();
    if (name === "get_client_portal_config") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } });
  },
  from: (table: string) => chain(table),
  auth: {
    getUser: async () => ({ data: { user: USER }, error: null }),
    getSession: async () => ({ data: { session: { user: USER, access_token: "harness" } }, error: null }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      queueMicrotask(() => cb("INITIAL_SESSION", { user: USER }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => ({ error: null }),
  },
  channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => undefined }; return c; },
  removeChannel: () => undefined,
  functions: { invoke: async (name: string) => ({ data: null, error: { message: `harness: unstubbed function ${name}` } }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export const harnessUser = USER;

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
