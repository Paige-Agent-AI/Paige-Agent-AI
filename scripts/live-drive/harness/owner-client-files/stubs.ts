// Deterministic data boundary for the owner "Files for {client}" harness (E09 Slice 4).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"); the signed-in Solo record against the real owner file RPCs on a seeded test tenant is owed
// (§32/§70.1).
//
// The record around the section is the owner-shared-work harness's (the REAL exp04 standing fixture through the
// REAL parser/composer). The file RPCs answer in exactly the shapes 20271110070000 returns, from a client_files-
// shaped store that also holds rows the owner list must never return (another client's file, another
// business's file, someone else's unfinished upload):
//
//   client_file_owner_list(p_expected_actor_id, p_expected_tenant_id, p_contact_id, p_limit)
//     -> { ok:true, contact_id, portal_connected, files:[11 keys], has_more } | { ok:false, error } | 42501
//     rows = this tenant AND this client AND (ready OR (not client_upload AND uploaded by the caller)), newest first
//   client_file_owner_begin_upload(...)  -> { ok:true, file } (internal + pending at {tenant}/{contact}/internal/{id})
//   client_file_owner_finish_upload(...) -> { ok:true, replayed, file } once the object exists, else 22023
//   client_file_set_client_share(...)    -> { ok:true, replayed, file_id, shared, shared_at, updated_at, portal_connected }
//                                         | { ok:false, error:'FILE_CHANGED', updated_at } | { ok:false, error:<code> }
//   storage.from('client-files').upload / createSignedUrl(path, 60)
//   The share writes no notification (D4): the stub counts any functions.invoke so the drive can assert none.
//
//   ?state=populated|connected|empty|loading|refused|unavailable|error|pending|confirm|confirm-joined|unshare|
//          changed|uploading|uncertain|saved|open
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


// ── client_files, as the owner RPCs read and write them ─────────────────────────────────────────────
type FileRow = {
  id: string; tenant_id: string; contact_id: string; uploaded_by: string; storage_path: string; original_filename: string;
  mime_type: string; size_bytes: number; visibility: "internal" | "shared" | "client_upload"; upload_state: "pending" | "ready";
  shared_at: string | null; created_at: string; updated_at: string; description: string | null;
};
const OTHER_CLIENT = "e4000000-0000-4000-8000-0000000c0002"; // Sam Okafor, another client of the business
const OTHER_TENANT = "e4000000-0000-4000-8000-00000000bbbb";
const CLIENT_USER = "e0900000-0000-4000-8000-00000000c001";
let ftick = 0;
const fversion = () => `2026-10-13T09:${String(10 + ftick++).padStart(2, "0")}:00.000000+00:00`;
let fid = 0;
const fileId = () => `e5000000-0000-4000-8000-${String(++fid).padStart(12, "0")}`;
function fileRow(o: Partial<FileRow> & Pick<FileRow, "original_filename">): FileRow {
  const id = o.id ?? fileId();
  const visibility = o.visibility ?? "internal";
  const at = o.created_at ?? fversion();
  return {
    id, tenant_id: TENANT, contact_id: CLIENT, uploaded_by: visibility === "client_upload" ? CLIENT_USER : ACTOR,
    storage_path: `${o.tenant_id ?? TENANT}/${o.contact_id ?? CLIENT}/${visibility === "client_upload" ? `client_upload/${CLIENT_USER}` : "internal"}/${id}`,
    mime_type: "application/pdf", size_bytes: 248_000, upload_state: "ready", shared_at: visibility === "shared" ? "2026-10-13T14:00:00.000000+00:00" : null,
    created_at: at, updated_at: at, description: "Internal: pricing assumptions inside", ...o, visibility,
  };
}
const fileStore: FileRow[] = state === "empty" ? [] : [
  fileRow({ original_filename: "Brand guidelines v2.pdf", visibility: "shared", created_at: "2026-10-12T15:00:00.000000+00:00" }),
  fileRow({ original_filename: "Kickoff agenda.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 41_000, visibility: "shared", created_at: "2026-09-12T13:00:00.000000+00:00" }),
  fileRow({ original_filename: "Signed intake form.pdf", visibility: "client_upload", created_at: "2026-10-09T18:30:00.000000+00:00", size_bytes: 1_240_000 }),
  fileRow({ original_filename: "Studio-photo-reference.jpg", mime_type: "image/jpeg", visibility: "client_upload", created_at: "2026-10-08T11:00:00.000000+00:00", size_bytes: 3_400_000 }),
  fileRow({ original_filename: "Discovery report draft.pdf", visibility: "internal", created_at: "2026-10-13T09:00:00.000000+00:00" }),
  fileRow({ original_filename: "Pricing worksheet for the Harbour Lane studio launch and the founder's first-year retainer.pdf", visibility: "internal", created_at: "2026-10-10T10:00:00.000000+00:00" }),
];
// Rows the owner list must never return, present in every state.
fileStore.push(
  fileRow({ original_filename: "Sam's welcome pack.pdf", contact_id: OTHER_CLIENT, visibility: "shared" }),
  fileRow({ original_filename: "Another business's contract.pdf", tenant_id: OTHER_TENANT, visibility: "shared" }),
  fileRow({ original_filename: "Half-sent scan.pdf", visibility: "client_upload", upload_state: "pending" }), // the client's own unfinished upload
);
const objects = new Set(fileStore.filter((f) => f.upload_state === "ready").map((f) => f.storage_path));
let listReads = 0;
const fileWrites: Record<string, unknown>[] = [];
const uploads: string[] = [];
const signed: { path: string; expires: number }[] = [];
let finishCalls = 0;
const ownerRow = (f: FileRow) => ({
  id: f.id, filename: f.original_filename, mime_type: f.mime_type, size_bytes: f.size_bytes, visibility: f.visibility,
  upload_state: f.upload_state, source: f.visibility === "client_upload" ? "client" : "business", shared_at: f.shared_at,
  created_at: f.created_at, updated_at: f.updated_at, storage_path: f.storage_path,
});
function ownerList() {
  listReads += 1;
  if (state === "loading") return new Promise(() => {});
  if (state === "refused") return Promise.resolve({ data: null, error: { code: "42501", message: "FILE_SCOPE_CHANGED" } });
  if (state === "unavailable") return Promise.resolve({ data: { ok: false, error: "CLIENT_FILES_UNAVAILABLE" }, error: null });
  if (state === "error") return Promise.resolve({ data: null, error: { code: "57014", message: "harness failure" } });
  const rows = fileStore.filter((f) => f.tenant_id === TENANT && f.contact_id === CLIENT
    && (f.upload_state === "ready" || (f.visibility !== "client_upload" && f.uploaded_by === ACTOR)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  return Promise.resolve({ data: { ok: true, contact_id: CLIENT, portal_connected: connected, files: rows.slice(0, 100).map(ownerRow), has_more: rows.length > 100 }, error: null });
}
function setFileShare(args: Record<string, unknown>) {
  fileWrites.push({ ...args });
  if (state === "pending") return new Promise(() => {});
  const f = fileStore.find((r) => r.id === args.p_file_id && r.tenant_id === TENANT);
  if (!f) return Promise.resolve({ data: { ok: false, error: "FILE_NOT_FOUND" }, error: null });
  if (f.visibility === "client_upload") return Promise.resolve({ data: { ok: false, error: "FILE_IS_CLIENT_UPLOAD" }, error: null });
  if (f.upload_state !== "ready") return Promise.resolve({ data: { ok: false, error: "FILE_NOT_READY" }, error: null });
  if ((f.visibility === "shared") === args.p_shared) {
    return Promise.resolve({ data: { ok: true, replayed: true, file_id: f.id, shared: args.p_shared, shared_at: f.shared_at, updated_at: f.updated_at, portal_connected: connected }, error: null });
  }
  if (state === "changed") { f.updated_at = fversion(); f.original_filename = f.original_filename.replace(".pdf", " (revised).pdf"); }
  if (args.p_expected_updated_at !== f.updated_at) return Promise.resolve({ data: { ok: false, error: "FILE_CHANGED", updated_at: f.updated_at }, error: null });
  f.visibility = args.p_shared ? "shared" : "internal";
  f.shared_at = args.p_shared ? "2026-10-14T16:00:00.000000+00:00" : null;
  f.updated_at = fversion();
  return Promise.resolve({ data: { ok: true, replayed: false, file_id: f.id, shared: args.p_shared, shared_at: f.shared_at, updated_at: f.updated_at, portal_connected: connected }, error: null });
}
function beginUpload(args: Record<string, unknown>) {
  fileWrites.push({ begin: true, ...args });
  if (state === "uploading") return new Promise(() => {});
  const id = String(args.p_file_id);
  let f = fileStore.find((r) => r.id === id);
  if (!f) {
    f = fileRow({ id, original_filename: String(args.p_filename), mime_type: String(args.p_mime_type), size_bytes: Number(args.p_size_bytes),
      visibility: "internal", upload_state: "pending", created_at: "2026-10-14T16:00:00.000000+00:00", description: null });
    fileStore.push(f);
  }
  return Promise.resolve({ data: { ok: true, file: ownerRow(f) }, error: null });
}
function finishUpload(args: Record<string, unknown>) {
  finishCalls += 1;
  const f = fileStore.find((r) => r.id === args.p_file_id)!;
  // The first finish of an "uncertain" upload lands, but its reply is lost on the way back.
  if (!objects.has(f.storage_path)) return Promise.resolve({ data: null, error: { code: "22023", message: "The saved upload could not be verified." } });
  const replayed = f.upload_state === "ready";
  f.upload_state = "ready";
  if (state === "uncertain" && finishCalls === 1) return Promise.reject(new Error("harness: reply lost"));
  return Promise.resolve({ data: { ok: true, replayed, file: ownerRow(f) }, error: null });
}

let reads = 0;
const writes: Record<string, unknown>[] = [];
let invokes = 0;
/** What the drive reads back: how many status reads and share writes happened, with what arguments. */
export const harness = {
  get reads() { return reads; }, get writes() { return writes; }, get invokes() { return invokes; },
  get listReads() { return listReads; }, get fileWrites() { return fileWrites; }, get uploads() { return uploads; }, get signed() { return signed; },
};
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
    if (name === "client_file_owner_list") return ownerList();
    if (name === "client_file_set_client_share") return setFileShare(args);
    if (name === "client_file_owner_begin_upload") return beginUpload(args);
    if (name === "client_file_owner_finish_upload") return finishUpload(args);
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
  storage: {
    from: () => ({
      upload: async (p: string) => {
        uploads.push(p);
        if (objects.has(p)) return { data: null, error: { message: "The resource already exists" } };
        objects.add(p);
        return { data: { path: p }, error: null };
      },
      createSignedUrl: async (p: string, expires: number) => { signed.push({ path: p, expires }); return { data: { signedUrl: `http://127.0.0.1:5271/signed-file?e=${expires}` }, error: null }; },
    }),
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
