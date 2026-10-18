// Deterministic data boundary for the customer portal Agreements harness (E09 Slice A).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"); the signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientPortalAgreements / usePortalAgreementsGlance hooks (exact-key
// parsers included), the REAL Agreements page, the REAL AppNav + useCustomerPortalNav, the REAL brand/config readers,
// the REAL MyAgreements and the REAL, FROZEN AgreementSigning page (§28) all run against this client. The payloads
// follow the contracts in supabase/migrations/20271110220000_e09_customer_portal_agreements.sql, and the list is
// computed the way the SQL computes it, from a paige_agreements-shaped store that deliberately holds rows and
// columns the customer must NOT see:
//
//   client_portal_agreements(p_tenant_id, p_limit)
//     -> { tenant_id, business_name, server_now, summary:{awaiting_you,signed}, agreements:[...], has_more } | null
//     visible = tenant AND this contact AND status <> 'draft'
//     order   = awaiting_you first (the binding deadline ASC NULLS LAST), then coalesce(completed_at, sent_at) DESC, id
//     expires_at on an awaiting_you row = least(agreement deadline, emailed link expiry); otherwise the agreement's
//     each row has EXACTLY: id, title, engagement_title, state, sent_at, completed_at, expires_at, can_sign,
//       can_download, sign_note — never the body, a storage key, a hash, a token, a signer, an amount or an offer.
//   client_portal_open_agreement_signing(p_agreement_id, p_tenant_id)
//     -> { ok:true, token, expires_at } | { ok:false, error, note? }  (?open=ok|here|later|fail|pending)
//   agreement-document?portal=1&agreementId=…[&download=1]       (?copy=ok|fail|pending)
//   peek_agreement_signing(_token): the FROZEN signing page's read. The emailed token is valid until the portal
//     issues a link; the portal's token is valid after. One token per signer (D-A4), persisted in sessionStorage so
//     the full-page navigation to /sign/:token is a real reload.
//
//   ?state=mixed|waiting|signed|empty|loading|staff|staff-error|multiple|error|home|home-none
//     staff-error: the agreements read FAILS (function missing) for a login the brand resolver does not know as a
//     customer — the page must keep the platform terms (§58), never the customer error card.
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "mixed";
const openMode = params.get("open") ?? "ok";
const copyMode = params.get("copy") ?? "ok";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const OTHER_TENANT = "e0900000-0000-4000-8000-00000000b002";
const CONTACT = "e0900000-0000-4000-8000-00000000d001"; // Jordan Rivera, the signed-in customer
const OTHER_CONTACT = "e0900000-0000-4000-8000-00000000d002"; // Sam Okafor, another customer of the business
const USER = { id: "e0900000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
const DAY = 86_400_000;
export const EMAIL_TOKEN = "e".repeat(64);
export const PORTAL_TOKEN = "f0".repeat(32);
const ISSUED = "harness-agreements-portal-link-issued";

function at(days: number, h = 17, m = 0) {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

type Signer = {
  role: "counterparty" | "tenant_signatory" | "witness"; order: number; status: "pending" | "viewed" | "signed" | "declined"; email: string; name: string;
  /** The emailed link's own expiry, and whether it was revoked (null / false = as the agreement). */
  token_expires_at?: string | null; revoked?: boolean;
};
type AgreementRow = {
  id: string; tenant_id: string; contact_id: string; title: string; status: string; sent_at: string | null;
  completed_at: string | null; expires_at: string | null; commercial_title: string | null; commercial_contact: string;
  sealed_storage_key: string | null; signers: Signer[];
  // Private columns that live on the row and must never reach the customer.
  body: string; amount_minor: number; token_hash: string; offer_id: string;
};

let seq = 0;
const nid = () => `e0900000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;
const me = (status: Signer["status"] = "pending", email = USER.email): Signer => ({ role: "counterparty", order: 2, status, email, name: "Jordan Rivera" });
const owner = (status: Signer["status"] = "signed"): Signer => ({ role: "tenant_signatory", order: 1, status, email: "owner@northwind.example.test", name: "Alex Moreno" });
const row = (o: Partial<AgreementRow> & Pick<AgreementRow, "title">): AgreementRow => ({
  id: nid(), tenant_id: TENANT, contact_id: CONTACT, status: "sent", sent_at: at(-6, 10), completed_at: null, expires_at: at(14),
  commercial_title: null, commercial_contact: CONTACT, sealed_storage_key: null, signers: [owner(), me()],
  body: "PRIVATE BODY: payment of $4,800 on signature", amount_minor: 480000, token_hash: "deadbeef".repeat(8), offer_id: "offer-private-77", ...o,
});

/** Every string the customer must never see, whatever the state. The drive asserts each is absent. */
export const NEVER_SHOWN = [
  "Sam's onboarding agreement", "Northwind internal NDA", "Unsent draft retainer", "PRIVATE BODY", "$4,800", "4,800",
  "owner@northwind", "deadbeef", "offer-private", "tenant-agreements/", "Alex Moreno",
];

function store(): AgreementRow[] {
  const hidden: AgreementRow[] = [
    row({ title: "Unsent draft retainer", status: "draft", sent_at: null }), // drafts never reach the customer
    row({ title: "Sam's onboarding agreement", contact_id: OTHER_CONTACT }), // another customer
    row({ title: "Northwind internal NDA", tenant_id: OTHER_TENANT }), // another business
  ];
  if (state === "empty" || state === "home-none") return hidden;
  const signedRow = row({
    title: "Brand strategy retainer", status: "completed", sent_at: at(-30, 9), completed_at: at(-27, 15), expires_at: at(-10),
    commercial_title: "Brand strategy", sealed_storage_key: `tenant-agreements/${TENANT}/x/sealed.pdf`, signers: [owner(), me("signed")],
  });
  if (state === "signed") return [...hidden, signedRow];
  const waiting = row({ title: "Website build agreement", commercial_title: "Website build", expires_at: at(5) });
  if (state === "waiting" || state === "home") return [...hidden, waiting, ...(state === "home" ? [row({ title: "Photo usage release", expires_at: at(9) })] : [])];
  return [
    ...hidden,
    waiting,
    row({ title: "Photo usage release", expires_at: at(9) }),
    // The emailed link's own expiry has passed while the agreement is still open: that link is dead.
    row({ title: "Consulting retainer renewal", sent_at: at(-16, 9), expires_at: at(20), signers: [owner(), { ...me(), token_expires_at: at(-1, 9) }] }),
    // A co-signer: two counterparty rows, so the portal cannot tell which is this login (D-A3): waiting on a
    // signature, not counted as theirs.
    row({ title: "Joint services agreement with your business partner", expires_at: at(12), signers: [owner(), me(), { ...me(), email: "partner@example.test", name: "Partner" }] }),
    // The business signs first (signing order): waiting on them.
    row({ title: "Event photography terms", signers: [{ ...owner("pending") }, me()] }),
    // The customer signed; only the business's own signatory still has to.
    row({ title: "Mutual NDA", status: "partially_signed", signers: [owner("pending"), { ...me("signed"), order: 1 }] }),
    signedRow,
    // Completed, but the sealed copy is not there yet.
    row({ title: "Discovery workshop terms", status: "completed", sent_at: at(-20, 9), completed_at: at(-1, 11), expires_at: at(10), signers: [owner(), me("signed")] }),
    row({ title: "Original website proposal", status: "declined", sent_at: at(-40, 9), signers: [owner(), me("declined")] }),
    row({ title: "Spring launch pilot", status: "sent", sent_at: at(-45, 9), expires_at: at(-15) }),
    row({ title: "Social media add-on", status: "voided", sent_at: at(-12, 9) }),
  ];
}

const rows = store();

/** The SQL's least(): NULLs ignored, NULL only when both are. */
const least = (a: string | null, b: string | null | undefined) => (a === null ? b ?? null : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b);

function stateOf(r: AgreementRow) {
  const counter = r.signers.filter((s) => s.role === "counterparty");
  const mine = counter.length === 1 ? counter[0] : null;
  let s: string; let note: string | null = null; let deadline: string | null = null;
  const nowMs = Date.now();
  if (r.status === "completed") s = "signed";
  else if (r.status === "declined" || mine?.status === "declined") s = "declined";
  else if (r.status === "voided") s = "withdrawn";
  else if (r.status === "expired" || (r.expires_at && Date.parse(r.expires_at) <= nowMs)) s = "expired";
  else if (!["sent", "viewed", "partially_signed"].includes(r.status)) s = "unavailable";
  else if (counter.length !== 1) { s = "awaiting_signature"; note = "use_email_link"; }
  else if (mine!.status === "signed") {
    const left = r.signers.filter((x) => x.status !== "signed");
    s = left.length > 0 && left.every((x) => x.role === "tenant_signatory") ? "awaiting_countersign" : "awaiting_others";
  } else if (r.signers.some((x) => x.order < mine!.order && x.status !== "signed")) s = "awaiting_business";
  else if (mine!.email !== USER.email) { s = "awaiting_signature"; note = "use_email_link"; }
  else {
    s = "awaiting_you";
    deadline = least(r.expires_at, mine!.token_expires_at);
    if (deadline === null) note = "use_email_link";
    else if (Date.parse(deadline) <= nowMs) note = "link_expired";
    if (mine!.revoked) note = "link_revoked";
  }
  return { state: s, can_sign: s === "awaiting_you" && note === null, sign_note: note, deadline };
}

/** client_portal_agreements, computed the way the SQL computes it (see the header). */
function project(pLimit: unknown) {
  const limit = Math.min(Math.max(typeof pLimit === "number" ? pLimit : 50, 1), 50);
  const visible = rows.filter((r) => r.tenant_id === TENANT && r.contact_id === CONTACT && r.status !== "draft").map((r) => {
    const st = stateOf(r);
    return { r, st, expires: st.state === "awaiting_you" ? st.deadline ?? r.expires_at : r.expires_at };
  });
  const t = (v: string | null) => (v === null ? null : Date.parse(v));
  const ranked = [...visible].sort((a, b) => {
    const aw = a.st.state === "awaiting_you" ? 0 : 1, bw = b.st.state === "awaiting_you" ? 0 : 1;
    if (aw !== bw) return aw - bw;
    if (!aw) {
      const x = t(a.expires), y = t(b.expires);
      if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
    }
    const x = t(a.r.completed_at ?? a.r.sent_at), y = t(b.r.completed_at ?? b.r.sent_at);
    if (x !== y) return x === null ? 1 : y === null ? -1 : y - x;
    return a.r.id < b.r.id ? -1 : 1;
  });
  return {
    tenant_id: TENANT,
    business_name: "Northwind Studio",
    server_now: new Date().toISOString(),
    summary: { awaiting_you: visible.filter((v) => v.st.state === "awaiting_you").length, signed: visible.filter((v) => v.r.status === "completed").length },
    agreements: ranked.slice(0, limit).map(({ r, st, expires }) => ({
      id: r.id, title: r.title.slice(0, 200),
      engagement_title: r.commercial_title && r.commercial_contact === CONTACT ? r.commercial_title : null,
      state: st.state, sent_at: r.sent_at, completed_at: r.completed_at, expires_at: expires,
      can_sign: st.can_sign, can_download: r.status === "completed" && r.sealed_storage_key !== null, sign_note: st.sign_note,
    })),
    has_more: visible.length > limit,
  };
}

let reads = 0;
export const harnessCalls = { opens: [] as unknown[], copies: [] as string[] };
function agreements(args: Record<string, unknown>) {
  reads += 1;
  if (state === "loading") return new Promise(() => {});
  if (state === "staff") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  if (state === "staff-error") return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.client_portal_agreements" } });
  if (state === "error" && reads > 1) return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  return Promise.resolve({ data: project(args.p_limit), error: null });
}

function open(args: Record<string, unknown>) {
  harnessCalls.opens.push(args);
  if (openMode === "pending") return new Promise(() => {});
  if (openMode === "here") return Promise.resolve({ data: { ok: false, error: "NOT_SIGNABLE_HERE", note: "link_expired" }, error: null });
  if (openMode === "later") return Promise.resolve({ data: { ok: false, error: "TRY_AGAIN_LATER" }, error: null });
  if (openMode === "fail") return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  const target = rows.find((r) => r.id === args.p_agreement_id);
  if (!target || !stateOf(target).can_sign) return Promise.resolve({ data: { ok: false, error: "NOT_SIGNABLE_HERE", note: stateOf(target ?? rows[0]).sign_note ?? "use_email_link" }, error: null });
  try { window.sessionStorage.setItem(ISSUED, "1"); } catch { /* the drive reads the result off the page */ }
  return Promise.resolve({ data: { ok: true, token: PORTAL_TOKEN, expires_at: target.expires_at }, error: null });
}

/** The frozen signing page's read: one live token per signer (D-A4). */
function peek(args: Record<string, unknown>) {
  let issued = false;
  try { issued = window.sessionStorage.getItem(ISSUED) === "1"; } catch { issued = false; }
  const valid = (args._token === EMAIL_TOKEN && !issued) || (args._token === PORTAL_TOKEN && issued);
  if (!valid) return Promise.resolve({ data: [{ is_valid: false }], error: null });
  const r = rows.find((x) => x.title === "Website build agreement")!;
  return Promise.resolve({
    data: [{
      document_title: r.title,
      document_body: "Northwind Studio will design and build a five-page website for Jordan Rivera.\n\nScope: discovery, wireframes, design, build and launch.\n\nTimeline: six weeks from signature.",
      document_path: null, business_name: "Northwind Studio", brand: { logo_url: null, primary_color: "#26483e" },
      signer_display_name: "Jordan Rivera", amount_minor: 480000, amount_currency: "usd", term_summary: "One-time project",
      expires_at: r.expires_at, signature_state: "pending", is_valid: true,
    }],
    error: null,
  });
}

const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
function invoke(name: string) {
  if (!name.startsWith("agreement-document?")) return Promise.resolve({ data: null, error: { message: `harness: unstubbed function ${name}` } });
  harnessCalls.copies.push(name);
  const q = new URLSearchParams(name.split("?")[1]);
  const target = rows.find((r) => r.id === q.get("agreementId"));
  if (copyMode === "pending") return new Promise(() => {});
  if (copyMode === "fail" || q.get("portal") !== "1" || !target || target.contact_id !== CONTACT || target.status !== "completed" || !target.sealed_storage_key) {
    return Promise.resolve({ data: { error: "Not available" }, error: null });
  }
  return Promise.resolve({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
}

const PROFILE = {
  id: CONTACT, tenant_id: TENANT, linked_user_id: USER.id, first_name: "Jordan", last_name: "Rivera", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: at(-30), email: USER.email,
  phone: null, contact_methods: [],
};

function brand() {
  if (state === "staff" || state === "staff-error") return Promise.resolve({ data: [], error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

/** MyAgreements' platform-terms reads: one synthetic acceptance. Every other table read resolves empty. */
const ACCEPTANCES = [{ id: "e0900000-0000-4000-a000-000000000001", document_slug: "terms", document_version: 3, accepted_at: at(-60, 10), user_agent: "Harness", context: null }];
const DOCS = [{ slug: "terms", title: "PaigeAgent Terms of Service", version: 3 }];
function chain(table: string): unknown {
  const data = table === "legal_acceptances" ? ACCEPTANCES : table === "legal_documents" ? DOCS : [];
  const result = { data, error: null, count: data.length };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_agreements") return agreements(args);
    if (name === "client_portal_open_agreement_signing") return open(args);
    if (name === "peek_agreement_signing") return peek(args);
    if (name === "client_portal_self_profile") {
      if (state === "staff" || state === "staff-error") return Promise.resolve({ data: null, error: null });
      if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
      return Promise.resolve({ data: PROFILE, error: null });
    }
    if (name === "client_portal_sessions") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), sessions: [], next_before: null }, error: null });
    }
    if (name === "client_portal_progress") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), summary: { shared: 0, done: 0, open: 0, overdue: 0 }, items: [], has_more: false }, error: null });
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
  functions: { invoke: (name: string) => invoke(name) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export const harnessUser = USER;

// DashboardModeContext: staff only in the `staff` and `staff-error` states (the platform-terms fallback); a customer otherwise.
const staffish = state === "staff" || state === "staff-error";
export const useDashboardMode = () => ({ isAdmin: staffish, mode: staffish ? "admin" : "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
