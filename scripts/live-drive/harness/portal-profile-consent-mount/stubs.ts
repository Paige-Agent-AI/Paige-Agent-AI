// Deterministic data boundary for the customer Your account harness (E09 Slice 6).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera");
// the signed-in customer portal against the real RPCs on a seeded test tenant is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientAccount, useClientPortalPreferences (exact-key reader,
// business pin, fresh-read-before-success), the REAL brand/config readers and the REAL playbook resolver run
// against this client. The payloads follow 20271110100000 as it stands in the worktree:
//
//   client_portal_communication_preferences(p_tenant_id)  -> { schema_version:1, tenant_id, business_name,
//     email:{state,set_by,set_at,can_turn_on,can_turn_off}, sms:{…}, updates:{state,set_by,set_at,can_subscribe,
//     can_unsubscribe}, data_sharing:{allowed,updated_at}, quiet_hours:{start,end,time_zone_known}, read_at }
//   client_portal_set_communication_preference(...)        -> { ok:true, replayed, preferences } | { ok:false, error, preferences }
//   client_portal_set_shared_context_consent(...)          -> { ok:true, replayed, preferences }
//   client_portal_self_profile                             -> the exact 19-key shape readClientPortalSelfProfile accepts
//
//   ?state=default|email-off|email-paused|email-paused-held|texts-on|texts-off|updates-subscribed|sharing-on|
//          no-address|no-number|multiple|unavailable|loading|error|pending|refusal|saved
//   error:   the first preferences read lands and every later one fails (reached by the page's own focus refresh).
//   pending: every write hangs, so the row is framed mid-save.
//   refusal: email is off by the customer, but the business has since paused it: turning it on is refused and
//            the fresh read shows the business pause.
//   saved:   the drive turns Email off through the real switch; the write lands and the fresh read shows it.
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "default";

export const TENANT = "e0960000-0000-4000-8000-00000000b001";
const CONTACT = "e0960000-0000-4000-8000-00000000d001";
const USER = { id: "e0960000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

type Card = { state: string; set_by: string | null; set_at: string | null; can_turn_on: boolean; can_turn_off: boolean };
type Updates = { state: string; set_by: string | null; set_at: string | null; can_subscribe: boolean; can_unsubscribe: boolean };
const card = (s: string, o: Partial<Card> = {}): Card => ({ state: s, set_by: null, set_at: null, can_turn_on: false, can_turn_off: true, ...o });
const upd = (s: string, o: Partial<Updates> = {}): Updates => ({ state: s, set_by: null, set_at: null, can_subscribe: s === "not_subscribed", can_unsubscribe: s === "subscribed" || s === "paused", ...o });

function initial() {
  const p = {
    email: card("on"), sms: card("not_set"), updates: upd("not_subscribed"),
    data_sharing: { allowed: false, updated_at: null as string | null }, time_zone_known: false,
  };
  switch (state) {
    case "email-off": p.email = card("off", { set_by: "you", set_at: ago(6), can_turn_on: true, can_turn_off: false }); p.updates = upd("not_subscribed", { can_subscribe: false }); break;
    case "email-paused": p.email = card("off", { set_by: "business", set_at: ago(3) }); p.updates = upd("not_subscribed", { can_subscribe: false }); break;
    case "email-paused-held": p.email = card("off", { set_by: "business", set_at: ago(3), can_turn_off: false }); p.updates = upd("not_subscribed", { can_subscribe: false }); break;
    case "refusal": p.email = card("off", { set_by: "you", set_at: ago(6), can_turn_on: true, can_turn_off: false }); p.updates = upd("not_subscribed", { can_subscribe: false }); break;
    case "texts-on": p.sms = card("on", { set_by: "reply", set_at: ago(9) }); p.time_zone_known = true; break;
    case "texts-off": p.sms = card("off", { set_by: "reply", set_at: ago(2), can_turn_off: false }); break;
    case "updates-subscribed": p.updates = upd("subscribed", { set_by: "you", set_at: ago(12) }); break;
    case "sharing-on": p.data_sharing = { allowed: true, updated_at: ago(4) }; break;
    case "no-address": p.email = card("no_address", { can_turn_off: true }); p.updates = upd("no_address", { can_subscribe: false }); break;
    case "no-number": p.sms = card("no_number", { can_turn_off: true }); break;
  }
  return p;
}
const store = initial();
const view = () => ({
  schema_version: 1, tenant_id: TENANT, business_name: "Northwind Studio",
  email: { ...store.email }, sms: { ...store.sms }, updates: { ...store.updates },
  data_sharing: { ...store.data_sharing },
  quiet_hours: { start: "20:00", end: "08:00", time_zone_known: store.time_zone_known },
  read_at: new Date().toISOString(),
});

let prefReads = 0;
const writes: Record<string, unknown>[] = [];
export const harness = { get prefReads() { return prefReads; }, get writes() { return writes; } };
(window as unknown as { __harness: typeof harness }).__harness = harness;

function preferences() {
  prefReads += 1;
  if (state === "loading") return new Promise(() => {});
  if (state === "unavailable") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  if (state === "error" && prefReads > 1) return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  return Promise.resolve({ data: view(), error: null });
}

function setPreference(args: Record<string, unknown>) {
  writes.push({ ...args });
  if (state === "pending") return new Promise(() => {});
  const now = new Date().toISOString();
  if (args.p_channel === "email" && args.p_topic === null) {
    if (args.p_enabled === true) {
      if (state === "refusal") {
        // The business paused email after the customer had turned it off: the customer can't lift that.
        store.email = card("off", { set_by: "business", set_at: now, can_turn_off: false });
        return Promise.resolve({ data: { ok: false, error: "EMAIL_PAUSED_BY_BUSINESS", preferences: view() }, error: null });
      }
      store.email = card("on");
      store.updates = upd("not_subscribed");
    } else {
      store.email = store.email.set_by === "business" ? { ...store.email, can_turn_off: false } : card("off", { set_by: "you", set_at: now, can_turn_on: true, can_turn_off: false });
      store.updates = upd("not_subscribed", { can_subscribe: false });
    }
  } else if (args.p_channel === "email") {
    if (args.p_enabled === true && store.email.state !== "on") return Promise.resolve({ data: { ok: false, error: "EMAIL_OFF", preferences: view() }, error: null });
    store.updates = args.p_enabled ? upd("subscribed", { set_by: "you", set_at: now }) : upd("not_subscribed", { set_by: "you", set_at: now });
  } else {
    if (args.p_enabled === true) return Promise.resolve({ data: { ok: false, error: "SMS_OPT_IN_UNAVAILABLE", preferences: view() }, error: null });
    store.sms = card("off", { set_by: "you", set_at: now, can_turn_off: false });
  }
  return Promise.resolve({ data: { ok: true, replayed: false, preferences: view() }, error: null });
}

function setSharing(args: Record<string, unknown>) {
  writes.push({ ...args });
  if (state === "pending") return new Promise(() => {});
  store.data_sharing = { allowed: args.p_allow === true, updated_at: new Date().toISOString() };
  return Promise.resolve({ data: { ok: true, replayed: false, preferences: view() }, error: null });
}

const PROFILE = {
  id: CONTACT, tenant_id: TENANT, linked_user_id: USER.id, first_name: "Jordan", last_name: "Rivera", entity_name: null,
  street_address: state === "no-address" ? null : "12 Harbour Lane", city: "Portland", state: "OR", zip_code: "97201",
  onboarding_stage: null, is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
  updated_at: ago(30), email: state === "no-address" ? null : USER.email, phone: state === "no-number" ? null : "+15035550142",
  contact_methods: [],
};

function brand() {
  if (state === "unavailable") return Promise.resolve({ data: [], error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

/** A thenable that also carries setHeader, as the PostgREST builder does (the writers pin their token). */
function call<T>(p: Promise<T>) { return Object.assign(p, { setHeader: () => p }); }

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_communication_preferences") return call(preferences());
    if (name === "client_portal_set_communication_preference") return call(setPreference(args));
    if (name === "client_portal_set_shared_context_consent") return call(setSharing(args));
    if (name === "client_portal_self_profile") {
      if (state === "unavailable") return call(Promise.resolve({ data: null, error: null }));
      if (state === "multiple") return call(Promise.resolve({ data: null, error: MULTI }));
      return call(Promise.resolve({ data: PROFILE, error: null }));
    }
    if (name === "get_client_portal_brand") return call(brand());
    if (name === "get_client_portal_config") return call(Promise.resolve({ data: null, error: null }));
    if (name === "tenant_has_feature") return call(Promise.resolve({ data: false, error: null }));
    return call(Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } }));
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
  functions: { invoke: async (name: string) => ({ data: null, error: { message: `harness: unstubbed function ${name}` } }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export const harnessUser = USER;

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
