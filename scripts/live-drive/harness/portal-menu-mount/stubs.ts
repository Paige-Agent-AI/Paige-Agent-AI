// Deterministic data boundary for the customer portal menu harness (E09 Slice M).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"). The signed-in customer portal and the signed-in Solo editor on the deployed app, against a seeded
// test tenant, are a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL AppNav, assemblePortalNav, normalizePortalConfig, resolvePortalCatalog,
// PortalStudio, PortalMenuEditor, usePortalConfig and usePortalCatalogInput all run against this client. The
// payloads follow the contracts in 20271110060000_e09_customer_portal_menu.sql (backend lane):
//
//   get_client_portal_config()  -> portal_config || { _catalog: { slug, authored_usable, modules } }
//                                  ({} for staff with no relationship; 42501 for a customer of two businesses)
//   set_tenant_portal_config(_tenant_id, _patch) -> the merged portal_config (shallow merge: modules replaced whole)
//   tenants.select("features" | "name,slug,brand") for the owner's own workspace
//
//   ?view=customer&variant=default|renamed|hidden|reordered|staff|multi|stored
//   ?view=owner&variant=default|saving|mismatch   (saving: the write never returns; mismatch: the server drops labels)
//
// PERSISTENCE: the business's stored portal_config lives in sessionStorage, so it survives a reload of the owner page
// and a navigation in the same tab to the customer view (`variant=stored` reads exactly what the owner saved). That
// is the §70.1 shape — save, reload, see it hold, see the customer get it — over a stub, not production.
const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "customer";
const variant = params.get("variant") ?? "default";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const USER = { id: "e0900000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const OWNER = { id: "e0900000-0000-4000-8000-00000000f001", email: "sam.okafor@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
const GENERIC = [
  { key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }, { key: "progress", label: "Progress" },
  { key: "messages", label: "Messages" }, { key: "resources", label: "Resources" }, { key: "billing", label: "Billing" },
];

/** The overlay the business has saved, per customer variant. */
const OVERLAYS: Record<string, unknown[]> = {
  default: [],
  renamed: [{ key: "sessions", label: "Coaching calls" }, { key: "resources", label: "Library" }],
  // Messages is fixed: an overlay that tries to hide it is ignored.
  hidden: [{ key: "actions", visible: false }, { key: "documents", visible: false }, { key: "messages", visible: false }],
  reordered: [{ key: "sessions", order: 0 }, { key: "actions", order: 1 }, { key: "progress", order: 2 }],
};

const STORE_KEY = "e09-portal-menu-harness:portal_config";
function readStored(): Record<string, unknown> {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : { modules: [] };
  } catch { return { modules: [] }; }
}
function writeStored(next: Record<string, unknown>) {
  try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* the drive reports a reload that lost it */ }
}
export const harnessCalls = { writes: [] as unknown[] };

function customerConfig() {
  if (variant === "staff") return Promise.resolve({ data: {}, error: null });
  if (variant === "multi") return Promise.resolve({ data: null, error: MULTI });
  const modules = variant === "stored" ? (readStored().modules ?? []) : (OVERLAYS[variant] ?? []);
  return Promise.resolve({ data: { modules, _catalog: { slug: null, authored_usable: false, modules: null } }, error: null });
}

function brand() {
  if (variant === "staff") return Promise.resolve({ data: [], error: null });
  if (variant === "multi") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

function setConfig(args: Record<string, unknown>) {
  harnessCalls.writes.push(structuredClone(args));
  if (variant === "saving") return new Promise(() => {});
  const patch = structuredClone(args._patch) as Record<string, unknown>;
  if (variant === "mismatch" && Array.isArray(patch.modules)) {
    patch.modules = (patch.modules as Record<string, unknown>[]).map(({ label: _dropped, ...rest }) => rest);
  }
  const stored = { ...readStored(), ...patch };
  writeStored(stored);
  return Promise.resolve({ data: structuredClone(stored), error: null });
}

function chain(table: string): unknown {
  const row = table === "tenants"
    ? { name: "Northwind Studio", slug: "northwind-studio", brand: {}, features: { playbook: null, portal_config: readStored() } }
    : null;
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: row, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

const who = view === "owner" ? OWNER : USER;
export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "get_client_portal_config") return customerConfig();
    if (name === "get_client_portal_brand") return brand();
    if (name === "set_tenant_portal_config") return setConfig(args);
    if (name === "resolve_tenant_brand") return Promise.resolve({ data: {}, error: null });
    return Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } });
  },
  from: (table: string) => chain(table),
  auth: {
    getUser: async () => ({ data: { user: who }, error: null }),
    getSession: async () => ({ data: { session: { user: who, access_token: "harness" } }, error: null }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      queueMicrotask(() => cb("INITIAL_SESSION", { user: who }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => ({ error: null }),
  },
  channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => undefined }; return c; },
  removeChannel: () => undefined,
  functions: { invoke: async (name: string) => ({ data: null, error: { message: `harness: unstubbed function ${name}` } }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }), upload: async () => ({ error: null }) }) },
};

export const harnessUser = USER;
export const harnessGeneric = GENERIC;

// DashboardModeContext: staff only for the staff variant.
export const useDashboardMode = () => ({ isAdmin: variant === "staff", mode: "internal", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }

// useTenantContext: the owner editing their own workspace.
export const useTenantContext = () => ({ activeTenantId: TENANT, activeUserId: OWNER.id, activeTenant: { id: TENANT, name: "Northwind Studio" }, loading: false });
