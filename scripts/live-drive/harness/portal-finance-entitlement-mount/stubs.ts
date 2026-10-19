// Deterministic data boundary for the E09 F2 finance-entitlement harness.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera").
//
// The customer's portal read (get_client_portal_config, 20271111040000) carries `entitlements.finance`; the
// business's Playbook catalog is the generic one (`fresh`, a freshly provisioned Solo business) or the funding
// preset (`funding-off`: chose the Playbook but holds no install; `funding-on`: a deliberate install). The customer
// has credit reports, funding applications, credit alerts and credit factor scores on file in EVERY state, so the
// only thing that differs between frames is the entitlement — never the data.
const params = new URLSearchParams(window.location.search);
export const business = (params.get("business") ?? "fresh") as "fresh" | "funding-off" | "funding-on";
export const entitled = business === "funding-on";

export const TENANT = "e0f20000-0000-4000-8000-00000000b001";
const CONTACT = "e0f20000-0000-4000-8000-00000000d001";
const USER = { id: "e0f20000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
export const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e", support_email: null };
export const PROFILE = {
  id: CONTACT, tenant_id: TENANT, linked_user_id: USER.id, first_name: "Jordan", last_name: "Rivera", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: new Date().toISOString(), email: USER.email,
  phone: null, contact_methods: [],
};
export const CONFIG = {
  modules: [],
  _catalog: { slug: business === "fresh" ? null : "funding", authored_usable: false, modules: null },
  entitlements: { finance: entitled },
};

/** What the customer has on file, identical in every state. */
const COUNTS: Record<string, number> = { credit_report_uploads: 3, funding_journey_applications: 2, client_goals: 0, chat_messages: 0, client_files: 0 };
const ROWS: Record<string, unknown[]> = {
  credit_alerts: [
    { id: "e0f20000-0000-4000-a000-000000000001", client_id: USER.id, alert_type: "score_change", alert_severity: "informational", alert_title: "Your score moved", alert_description: "Up 6 points this month.", previous_value: null, new_value: null, bureau: null, related_account_id: null, is_read: false, is_dismissed: false, created_at: new Date(Date.now() - 3_600_000).toISOString(), read_at: null, dismissed_at: null, dismissed_by: null },
  ],
  credit_factor_scores: [{ user_id: USER.id, payment_history_score: 82, utilization_score: 64, credit_age_score: 55, credit_mix_score: 71, inquiry_score: 90, calculated_at: new Date().toISOString() }],
  notifications: [],
};
// The checklist's analytics call (trackEvent → functions/v1/track-event) is answered in-page; nothing leaves.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
  if (url.hostname === "harness.invalid") return new Response(null, { status: 204 });
  return realFetch(input, init);
};
const realBeacon = navigator.sendBeacon?.bind(navigator);
navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) =>
  new URL(String(url), window.location.href).hostname === "harness.invalid" ? true : (realBeacon ? realBeacon(url, data) : false);
const reads: string[] = [];
(window as unknown as { __harnessReads: string[] }).__harnessReads = reads;
function chain(table: string): unknown {
  reads.push(table);
  const result = { data: ROWS[table] ?? [], error: null, count: COUNTS[table] ?? 0 };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: table === "profiles" ? { full_name: "Jordan Rivera" } : null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

export const supabase = {
  rpc: (name: string) => {
    reads.push(`rpc:${name}`);
    if (name === "get_client_portal_brand") return Promise.resolve({ data: [BRAND], error: null });
    if (name === "get_client_portal_config") return Promise.resolve({ data: CONFIG, error: null });
    if (name === "client_portal_self_profile") return Promise.resolve({ data: PROFILE, error: null });
    if (name === "client_portal_sessions") return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), sessions: [], next_before: null }, error: null });
    if (name === "client_portal_progress") return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), summary: { shared: 0, done: 0, open: 0, overdue: 0 }, items: [], has_more: false }, error: null });
    if (name === "client_portal_documents") return Promise.resolve({ data: { tenant_id: TENANT, files: [], summary: { shared: 0, from_you: 0 }, has_more: false }, error: null });
    // funding_readiness is off for every production business (0 of 12), so it is off here.
    if (name === "tenant_has_feature") return Promise.resolve({ data: false, error: null });
    return Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } });
  },
  from: (table: string) => chain(table),
  auth: {
    getUser: async () => ({ data: { user: USER }, error: null }),
    getSession: async () => ({ data: { session: { user: USER, access_token: "harness-not-a-real-token" } }, error: null }),
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
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }

// Not F2 surfaces (see vite.config.ts): an empty Documents glance and no activity feed.
export const usePortalDocumentsGlance = () => ({ state: "ready", shared: 0, fromYou: 0, awaitingReview: 0, awaitingReviewMore: false });
export type PortalDocumentsGlance = ReturnType<typeof usePortalDocumentsGlance>;
export const ClientActivityFeed = () => null;
