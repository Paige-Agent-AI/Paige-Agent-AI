export * from "../e09-auth-hydration-ui/adapter";
type Seed = { context: "a" | "b"; state: string };
const seed = (window as unknown as { accountSeed: Seed }).accountSeed;
const actor = "00000000-0000-4000-8000-000000000011";
const tenant = seed.context === "a" ? "00000000-0000-4000-8000-000000000021" : "00000000-0000-4000-8000-000000000022";
const user = { id: actor, email: "signin@example.test" };
const listeners = new Set<(event: string, session: unknown) => void>();
let mode = seed.state;
let row = { id: "00000000-0000-4000-8000-000000000031", tenant_id: tenant, linked_user_id: actor,
  first_name: seed.context === "a" ? "Test" : "Second", last_name: "Customer", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "ready", is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
  updated_at: "2026-10-15T18:00:00.000Z", email: "client@example.test", phone: "+12025550101",
  contact_methods: [{ kind: "email", value: "client@example.test", is_primary: true }, { kind: "phone", value: "+12025550101", is_primary: true }] };
const session = { user, access_token: "unit-client-session" };
const calls: string[] = [];
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
      listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    },
  },
  rpc: (name: string, args?: Record<string, unknown>) => {
    const headers = new Headers();
    const request = { setHeader: (key: string, value: string) => { headers.set(key, value); return request; },
      then: (done: (value: unknown) => unknown, failed: (error: unknown) => unknown) => Promise.resolve().then(async () => {
        calls.push(name);
        if (name === "get_client_portal_brand") return { data: [{ tenant_id: tenant, tenant_name: seed.context === "a" ? "Test Service Studio" : "Second Test Business", tenant_slug: `test-${seed.context}`, primary_color: "#26483e", logo_url: null }], error: null };
        if (name === "get_client_portal_config") return { data: {}, error: null };
        if (name === "client_portal_frame") return {data:{actor_id:actor,profile:row,
          brand:{tenant_id:tenant,tenant_name:seed.context==="a"?"Test Service Studio":"Second Test Business",
            tenant_slug:`test-${seed.context}`,primary_color:"#26483e",logo_url:null,support_email:null},
          config:{}},error:null};
        if (name === "paige_chat_thread_create") return {data:"00000000-0000-4000-8000-000000000041",error:null};
        if (name === "client_portal_self_profile") {
          if (mode === "loading") return new Promise(() => {});
          return { data: mode === "unavailable" ? null : mode === "read-error" ? null : row, error: mode === "read-error" ? { code: "08006" } : null };
        }
        if (name !== "client_portal_update_self_profile") throw new Error("Unapproved proof contract");
        if (headers.get("Authorization") !== "Bearer unit-client-session") throw new Error("Request must retain its verified synthetic subject");
        if (mode === "conflict") return { data: null, error: { code: "40001" } };
        if (mode === "unknown") throw new Error("Synthetic transport outcome");
        const patch = args!.p_profile as Partial<typeof row>;
        row = { ...row, ...patch, updated_at: "2026-10-15T18:01:00.000Z" };
        if (patch.phone) row.contact_methods = row.contact_methods.map(m => m.kind === "phone" && m.is_primary ? { ...m, value: patch.phone! } : m);
        return { data: row, error: null };
      }).then(done, failed) };
    return request;
  },
  from: (table: string) => {
    if(table==="paige_chat_threads"||table==="paige_chat_turns"){
      const query={select:()=>query,eq:()=>query,is:()=>query,order:()=>query,
        maybeSingle:async()=>({data:{id:"00000000-0000-4000-8000-000000000041",caller_user_id:actor,
          contact_id:row.id,tenant_id:tenant,lens:"client"},error:null}),
        limit:async()=>({data:[],error:null})};
      return query;
    }
    if (table !== "profiles") throw new Error("No raw CRM or domain proof read");
    return { select: (columns: string) => {
      if (columns !== "avatar_url") throw new Error("Legacy PII/settings loader must not mount in customer view");
      return { eq: () => ({ maybeSingle: async () => ({ data: { avatar_url: null }, error: null }) }) };
    } };
  },
};
export const AvatarUploader = () => null;
export const removeAvatarObject = () => { throw new Error("No legacy avatar/provider mutation"); };
Object.assign(window, { accountProof: { mode: (next: string) => { mode = next; }, calls: () => [...calls] } });
