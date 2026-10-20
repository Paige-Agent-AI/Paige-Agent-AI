/** Deterministic adapter. `?session=none` signs the visitor out; otherwise a customer session exists. */
type HarnessWindow = Window & { __harness?: { getUser: number; signIn: number; reset: string[]; rpc: string[] } };
const w = window as HarnessWindow;
w.__harness = { getUser: 0, signIn: 0, reset: [], rpc: [] };
const params = new URLSearchParams(window.location.search);
const signedIn = params.get("session") !== "none";
const brand = { tenant_name: "Northstar Advisory", tenant_slug: "acme", logo_url: null, primary_color: "#2f4b7c" };

export const supabase = {
  rpc: async (name: string, args?: { _slug?: string }) => {
    w.__harness!.rpc.push(`${name}:${args?._slug ?? ""}`);
    if (name === "peek_tenant_portal_brand") return { data: [{ ...brand, tenant_slug: args?._slug ?? "acme" }], error: null };
    if (name === "get_client_portal_brand") return { data: [brand], error: null };
    return { data: null, error: null };
  },
  auth: {
    getUser: async () => { w.__harness!.getUser += 1; return { data: { user: signedIn ? { id: "harness-customer" } : null }, error: null }; },
    signInWithPassword: async () => { w.__harness!.signIn += 1; return { data: { user: { id: "harness-customer" } }, error: null }; },
    resetPasswordForEmail: async (_email: string, options: { redirectTo: string }) => { w.__harness!.reset.push(options.redirectTo); return { error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
  },
  from: () => { throw new Error("harness: no table reads expected on the portal gateway"); },
};
