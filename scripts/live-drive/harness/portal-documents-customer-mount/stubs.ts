// Deterministic data boundary for the customer portal Documents harness (E09 Slice 4).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"); the signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientDocuments / useClientPortalReleasedWork / usePortalDocumentsGlance
// hooks (exact-key validators included), the REAL Operations review component, the REAL brand/config readers, the
// REAL playbook resolver and the REAL NotificationBell all run against this client. The documents read is computed
// the way 20271110200000 §1e computes it, from a client_files-shaped store that deliberately holds rows the customer
// must NOT see:
//
//   client_portal_documents(p_tenant_id, p_limit, p_before, p_before_id)
//     -> { tenant_id, client_id, summary:{shared,from_you}, files:[9 keys], has_more } | null | 42501 (several businesses)
//     visible = this tenant AND this client AND ((shared AND ready) OR (client_upload AND uploaded by the caller))
//     order created_at DESC, id DESC; limit clamped 1..50; summary counts every visible row.
//   operations_delivery_client_reviews_scoped(p_expected_actor_id, p_expected_tenant_id, p_limit=40)
//     -> { actor_id, tenant_id, releases:[7 keys], unavailable_count, has_more } | 42501 DELIVERY_CLIENT_REVIEWS_UNAVAILABLE
//   operations_delivery_client_read_scoped / operations_delivery_client_decide_scoped — 20271031005010 / 20271022000050
//   storage.from('client-files').createSignedUrl(path, 60[, { download }])
//
//   ?state=populated|empty|loading|pending|released|accepted|release-unavailable|unavailable|multiple|sign-error|home|home-empty
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "populated";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const OTHER_TENANT = "e0900000-0000-4000-8000-00000000b002";
const CONTACT = "e0900000-0000-4000-8000-00000000d001"; // Jordan Rivera, the signed-in customer
const OTHER_CONTACT = "e0900000-0000-4000-8000-00000000d002"; // Sam Okafor, another customer of the business
const OWNER = "e0900000-0000-4000-8000-00000000e001"; // the business owner (never projected)
const USER = { id: "e0900000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const OTHER_USER = "e0900000-0000-4000-8000-00000000c002";
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
const DAY = 86_400_000;
const at = (days: number, h = 15) => { const d = new Date(Date.now() + days * DAY); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };

type File = {
  id: string; tenant_id: string; contact_id: string; uploaded_by: string; visibility: "internal" | "shared" | "client_upload";
  upload_state: "pending" | "ready"; original_filename: string; mime_type: string; size_bytes: number; created_at: string;
  shared_at: string | null; storage_path: string; description: string | null;
};
let seq = 0;
const file = (o: Partial<File> & Pick<File, "original_filename">): File => {
  const id = o.id ?? `e0900000-0000-4000-9100-${String(++seq).padStart(12, "0")}`;
  const visibility = o.visibility ?? "shared";
  const uploader = o.uploaded_by ?? (visibility === "client_upload" ? USER.id : OWNER);
  return {
    id, tenant_id: TENANT, contact_id: CONTACT, uploaded_by: uploader, visibility, upload_state: "ready", mime_type: "application/pdf",
    size_bytes: 248_000, created_at: at(-3), shared_at: visibility === "shared" ? at(-2) : null, description: "Internal: margin notes",
    storage_path: `${o.tenant_id ?? TENANT}/${o.contact_id ?? CONTACT}/${visibility === "client_upload" ? `client_upload/${uploader}` : "internal"}/${id}`, ...o,
  };
};

/** Every string the customer must never see, whatever the state. The drive asserts each is absent. */
export const PRIVATE_NAMES = ["Pricing worksheet.pdf", "Unfinished owner draft.pdf", "Sam's welcome pack.pdf", "Another business's contract.pdf",
  "Sam's upload.pdf", "Internal: margin notes", OWNER];

function store(): File[] {
  const hidden: File[] = [
    file({ original_filename: "Pricing worksheet.pdf", visibility: "internal" }), // private to the team
    file({ original_filename: "Unfinished owner draft.pdf", visibility: "shared", upload_state: "pending" }), // shared but never finished
    file({ original_filename: "Sam's welcome pack.pdf", contact_id: OTHER_CONTACT }), // another customer's
    file({ original_filename: "Another business's contract.pdf", tenant_id: OTHER_TENANT }), // another business
    file({ original_filename: "Sam's upload.pdf", visibility: "client_upload", uploaded_by: OTHER_USER }), // someone else's upload
  ];
  if (state === "empty" || state === "home-empty") return hidden;
  const visible: File[] = [
    file({ original_filename: "Brand guidelines v2.pdf", created_at: at(-1) }),
    file({ original_filename: "Moodboard - autumn launch.png", mime_type: "image/png", size_bytes: 1_840_000, created_at: at(-2) }),
    file({ original_filename: "Kickoff agenda.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 41_000, created_at: at(-9) }),
    file({ original_filename: "Signed intake form.pdf", visibility: "client_upload", size_bytes: 1_240_000, created_at: at(-5) }),
    file({ original_filename: "Studio photo reference with the founder's notes on the Harbour Lane space.jpg", visibility: "client_upload", mime_type: "image/jpeg", size_bytes: 3_400_000, created_at: at(-6) }),
  ];
  if (state === "pending") visible.push(file({ original_filename: "Insurance certificate.pdf", visibility: "client_upload", upload_state: "pending", created_at: at(0, 9) }));
  return [...hidden, ...visible];
}
const rows = store();
const listed = (f: File) => ({
  id: f.id, filename: f.original_filename, mime_type: f.mime_type, size_bytes: f.size_bytes, source: f.visibility === "client_upload" ? "you" : "business",
  state: f.upload_state, shared_at: f.shared_at, created_at: f.created_at, storage_path: f.storage_path,
});

let documentReads = 0;
const signed: { path: string; expires: number; download: string | null }[] = [];
const decisions: Record<string, unknown>[] = [];
export const harness = { get documentReads() { return documentReads; }, get signed() { return signed; }, get decisions() { return decisions; } };
(window as unknown as { __harness: typeof harness }).__harness = harness;

function documents(args: Record<string, unknown>) {
  documentReads += 1;
  if (state === "loading") return new Promise(() => {});
  if (state === "unavailable") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  const limit = Math.min(Math.max(typeof args.p_limit === "number" ? args.p_limit : 50, 1), 50);
  const visible = rows.filter((f) => f.tenant_id === TENANT && f.contact_id === CONTACT
    && ((f.visibility === "shared" && f.upload_state === "ready") || (f.visibility === "client_upload" && f.uploaded_by === USER.id)));
  // The server's keyset: strictly after the (created_at, id) of the last row shown.
  const page = visible.filter((f) => !args.p_before || f.created_at < String(args.p_before)
      || (f.created_at === String(args.p_before) && f.id < String(args.p_before_id)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  return Promise.resolve({ data: {
    tenant_id: TENANT, client_id: CONTACT,
    summary: { shared: visible.filter((f) => f.visibility === "shared").length, from_you: visible.filter((f) => f.visibility === "client_upload").length },
    files: page.slice(0, limit).map(listed), has_more: page.length > limit,
  }, error: null });
}

// ── Released work (4B) ───────────────────────────────────────────────────────────────────────────────
const RELEASE = "e0900000-0000-4000-9200-000000000001", SUBMISSION = "e0900000-0000-4000-9300-000000000001";
const DIGEST = "d".repeat(64);
const ARTIFACT = {
  title: "Autumn launch plan",
  body: "Week one — the new homepage goes live with the moodboard palette.\n\nWeek two — the announcement email to your list, and the three launch posts.\n\nWeek three — the follow-up offer for anyone who opened the announcement.",
};
const release = { state: state === "accepted" ? "accepted" : "awaiting_client", updated_at: at(-1, 12), decision_at: state === "accepted" ? at(-1, 13) : null as string | null, note: null as string | null };
const releasesOn = ["released", "accepted", "home"].includes(state);
function reviews(args: Record<string, unknown>) {
  if (state === "release-unavailable") return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  if (!releasesOn) return Promise.resolve({ data: { actor_id: USER.id, tenant_id: TENANT, releases: [], unavailable_count: 0, has_more: false }, error: null });
  if (args.p_expected_actor_id !== USER.id || args.p_expected_tenant_id !== TENANT) return Promise.resolve({ data: null, error: { code: "42501", message: "DELIVERY_CLIENT_REVIEWS_UNAVAILABLE" } });
  return Promise.resolve({ data: { actor_id: USER.id, tenant_id: TENANT, releases: [{ release_id: RELEASE, submission_id: SUBMISSION, state: release.state, revision_no: 2,
    artifact_digest: DIGEST, title: ARTIFACT.title, updated_at: release.updated_at }], unavailable_count: 0, has_more: false }, error: null });
}
const artifact = () => ({ actor_id: USER.id, tenant_id: TENANT, release_id: RELEASE, submission_id: SUBMISSION, state: release.state, revision_no: 2,
  artifact_digest: DIGEST, title: ARTIFACT.title, body: ARTIFACT.body, updated_at: release.updated_at,
  decision_by: release.state === "awaiting_client" ? null : USER.id, decision_at: release.decision_at, client_note: release.note });
function decide(args: Record<string, unknown>) {
  decisions.push({ ...args });
  if (args.p_expected_updated_at !== release.updated_at) return Promise.resolve({ data: null, error: { code: "40001", message: "DELIVERY_CLIENT_CHANGED" } });
  release.state = String(args.p_decision); release.note = (args.p_note as string | null) ?? null;
  release.updated_at = at(0, 16); release.decision_at = at(0, 16);
  return Promise.resolve({ data: artifact(), error: null });
}

const PROFILE = {
  id: CONTACT, tenant_id: TENANT, linked_user_id: USER.id, first_name: "Jordan", last_name: "Rivera", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: at(-30), email: USER.email,
  phone: null, contact_methods: [],
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

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_documents") return documents(args);
    if (name === "client_portal_self_profile") {
      if (state === "unavailable") return Promise.resolve({ data: null, error: null });
      if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
      return Promise.resolve({ data: PROFILE, error: null });
    }
    if (name === "operations_delivery_client_reviews_scoped") return reviews(args);
    if (name === "operations_delivery_client_read_scoped") return Promise.resolve(releasesOn ? { data: artifact(), error: null } : { data: null, error: { code: "42501", message: "DELIVERY_CLIENT_UNAVAILABLE" } });
    if (name === "operations_delivery_client_decide_scoped") return decide(args);
    if (name === "client_portal_progress") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), summary: { shared: 0, done: 0, open: 0, overdue: 0 }, items: [], has_more: false }, error: null });
    }
    if (name === "client_portal_sessions") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), sessions: [], next_before: null }, error: null });
    }
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
  functions: { invoke: async (name: string) => ({ data: null, error: { message: `harness: unstubbed function ${name}` } }) },
  storage: { from: () => ({
    getPublicUrl: () => ({ data: { publicUrl: "" } }),
    createSignedUrl: async (path: string, expires: number, options?: { download?: string }) => {
      signed.push({ path, expires, download: options?.download ?? null });
      if (state === "sign-error") return { data: null, error: { message: "Object not found" } };
      // A same-origin stand-in for Storage, so the preview <img> really loads (the network is blocked).
      const image = /\.(png|jpe?g)$/.test(path) || rows.some((f) => f.storage_path === path && f.mime_type.startsWith("image/"));
      return { data: { signedUrl: `http://127.0.0.1:5272/${image ? "harness-image.svg" : "harness-file.txt"}?e=${expires}${options?.download ? `&download=${encodeURIComponent(options.download)}` : ""}` }, error: null };
    },
  }) },
};

export const harnessUser = USER;

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
