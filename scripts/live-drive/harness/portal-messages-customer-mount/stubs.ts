// Deterministic data boundary for the customer portal Messages harness (E09 Slice 1).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name and message is fictional ("Northwind Studio",
// "Jordan Rivera"); the signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientPortalMessages hook, the REAL brand/config readers,
// the REAL playbook resolver and the REAL NotificationBell all run against this client, so the page,
// the chrome and the state machine are the shipped code. The RPC payloads follow the contract in
// supabase/migrations/20271110010000_e09_customer_portal_messages.sql:
//   client_portal_conversation(p_tenant_id, p_before, p_limit)
//     -> { tenant_id, messages: [{ id, author, kind, body, created_at }] newest first, has_more } | null
//   client_portal_send_message(p_body, p_request_id, p_kind, p_tenant_id)
//     -> { ok, replayed, message_id, created_at } | { ok: false, error }
//
//   ?state=populated|empty|help|sending|failed|error|norelationship|multiple|loading
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "populated";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const USER = { id: "e0900000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };

type Msg = { id: string; author: "customer" | "business"; kind: "message" | "help"; body: string; created_at: string };

/** A local wall-clock time `daysAgo` days before the (Playwright-fixed) current date. */
function at(daysAgo: number, h: number, m: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
let seq = 0;
const msg = (author: Msg["author"], body: string, iso: string, kind: Msg["kind"] = "message"): Msg => ({
  id: `e0900000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, author, kind, body, created_at: iso,
});

// Oldest first. Two days of a realistic thread, both authors, one customer help request.
const recent: Msg[] = [
  msg("business", "Morning, Jordan. Your kickoff is booked for Thursday at 10:00. I've put the intake questionnaire in Action items; it takes about ten minutes.", at(1, 9, 14)),
  msg("customer", "Thanks! I'll fill it out tonight. Should I invite our operations lead to the kickoff?", at(1, 9, 41)),
  msg("business", "Yes, please do. The more of your team who hear the plan first-hand, the fewer surprises later.", at(1, 10, 2)),
  msg("customer", "The questionnaire link in Action items keeps spinning and never opens. I've tried two different browsers.", at(1, 16, 27), "help"),
  msg("business", "Sorry about that. We've reset it on our side, so give it another try and tell me if it still sticks.", at(1, 16, 58)),
  msg("customer", "That worked, all submitted.", at(0, 8, 5)),
  msg("customer", "One more thing: could we move Thursday to 11:00? I have a conflict first thing.", at(0, 8, 6)),
  msg("business", "Done. Thursday at 11:00, and you'll get an updated invite shortly.", at(0, 8, 36)),
  msg("business", "Before then, could you skim the brand audit in Documents? Two things to focus on:\n\n1. The audience section: does it match who actually buys from you?\n2. The competitor list: is anyone missing?\n\nNo need to write anything up; we'll go through it together.", at(0, 8, 38)),
  msg("customer", "Will do. See you Thursday.", at(0, 9, 10)),
];
const helpThread: Msg[] = [
  msg("business", "Hi Jordan, thanks for choosing Northwind Studio. I'll be your main point of contact for the brand refresh.", at(2, 14, 2)),
  msg("customer", "Great to meet you. Looking forward to getting started.", at(2, 15, 40)),
];

// The server's store for this page load. Successful sends append to it, as the real RPC would.
let store: Msg[] = state === "empty" ? [] : state === "help" ? [...helpThread] : [...recent];
const pageSize = (limit: unknown) => (typeof limit === "number" && limit > 0 ? limit : 50);
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
let sendCount = 0;

function conversation(args: Record<string, unknown>) {
  if (state === "loading") return new Promise(() => {});
  if (state === "norelationship") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  if (state === "error") return Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
  const before = typeof args.p_before === "string" ? Date.parse(args.p_before) : Infinity;
  // The newest p_limit messages before p_before, newest first; has_more when older ones remain.
  const limit = pageSize(args.p_limit);
  const eligible = store.filter((m) => Date.parse(m.created_at) < before).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const page = eligible.slice(0, limit);
  return Promise.resolve({ data: { tenant_id: TENANT, messages: page, has_more: eligible.length > page.length }, error: null });
}

function send(args: Record<string, unknown>) {
  sendCount += 1;
  if (state === "sending") return new Promise(() => {});
  if (state === "failed") {
    // A help request refused definitively (nothing saved) → "Edit and resend"; a plain message whose
    // transport failed (outcome unknown) → "Retry". Both are real hook paths.
    if (args.p_kind === "help") return Promise.resolve({ data: { ok: false, error: "REQUEST_ID_CONFLICT" }, error: null });
    return Promise.resolve({ data: null, error: { code: "08006", message: "connection failure" } });
  }
  const body = String(args.p_body ?? "").trim();
  const m = msg("customer", body, new Date().toISOString(), args.p_kind === "help" ? "help" : "message");
  store = [...store, m];
  return Promise.resolve({ data: { ok: true, replayed: false, message_id: m.id, created_at: m.created_at }, error: null });
}

function brand() {
  if (state === "norelationship") return Promise.resolve({ data: [], error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

/** Every table read resolves empty (no notifications, no avatar, no authored playbook). */
function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const single = { data: null, error: null };
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve(single);
      return () => proxy;
    },
  });
  return proxy;
}

export const harnessCalls = { get sends() { return sendCount; } };

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_conversation") return conversation(args);
    if (name === "client_portal_send_message") return send(args);
    if (name === "get_client_portal_brand") return brand();
    if (name === "get_client_portal_config") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } });
  },
  from: () => chain(),
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
  functions: { invoke: async () => ({ data: null, error: { message: "harness" } }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export const harnessUser = USER;

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
