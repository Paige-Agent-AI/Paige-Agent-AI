/**
 * Data-boundary stub for the brand-typeface harness mount. MOCKS THE PROVIDER, NEVER THE CONTRACT: the
 * shipped PortalStudio, useBrandKit and usePortalConfig run unchanged; only the transport answers, with
 * the shapes the real seams return (a `tenants` row with `brand` / `features`, `resolve_tenant_brand`).
 * Every `set_tenant_brand` call is recorded on window.__brandWrites so a drive reads the exact payload.
 *
 * `?font=` seeds the stored brand.font (absent = System default). The workspace is visibly synthetic
 * ("Harness workspace"); no real tenant or person appears in a frame (§63).
 */
const params = new URLSearchParams(window.location.search);
const brand: Record<string, unknown> = {};
if (params.get("font")) brand.font = params.get("font");

declare global {
  interface Window { __brandWrites?: unknown[] }
}
window.__brandWrites = [];

const row = () => ({ data: { name: "Harness workspace", slug: "harness", brand: { ...brand }, features: {} }, error: null });
const chain: Record<string, unknown> = {};
Object.assign(chain, {
  select: () => chain,
  eq: () => chain,
  in: () => chain,
  order: () => chain,
  limit: () => chain,
  maybeSingle: () => Promise.resolve(row()),
  single: () => Promise.resolve(row()),
  then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
});

export const supabase = {
  from: () => chain,
  rpc: (fn: string, args: Record<string, unknown>) => {
    if (fn === "set_tenant_brand") {
      window.__brandWrites!.push({ fn, args });
      Object.assign(brand, (args._patch ?? {}) as Record<string, unknown>);
      return Promise.resolve({ data: null, error: null });
    }
    if (fn === "resolve_tenant_brand") return Promise.resolve({ data: { font: brand.font ?? null }, error: null });
    return Promise.resolve({ data: null, error: null });
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};

export default supabase;
