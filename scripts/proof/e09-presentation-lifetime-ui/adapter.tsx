import { coachingDefault } from "@/lib/playbook/presets";
type Listener = (event: string, session: { user: { id: string } } | null) => void;
const listeners = new Set<Listener>();
let actor: string | null = "test-actor-a";
let hold = false;
const pending: (() => void)[] = [];
const name = (id: string) => id === "test-actor-a" ? "Test Studio A" : "Test Studio B";
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: actor ? { id: actor } : null }, error: null }),
    onAuthStateChange: (listener: Listener) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
  },
  rpc: async (key: string) => {
    const subject = actor;
    if (hold) await new Promise<void>(resolve => pending.push(resolve));
    if (key === "get_client_portal_brand") return { data: subject ? [{ tenant_id: `test-tenant-${subject}`, tenant_name: name(subject), tenant_slug: subject, primary_color: "#26483e", logo_url: null }] : [], error: null };
    if (key === "get_client_portal_config") return { data: subject ? { modules: [{ key: "resources", visible: subject !== "test-actor-a" }] } : {}, error: null };
    throw new Error("Only native read-only presentation RPCs allowed");
  },
  from: (table: string) => {
    if (table !== "profiles") throw new Error("Raw CRM and other reads forbidden");
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { avatar_url: null }, error: null }) }) }) };
  },
};
Object.assign(window, { presentationProof: {
  switchActor: () => { actor = "test-actor-b"; hold = true; for (const listener of listeners) listener("SIGNED_IN", { user: { id: actor } }); },
  release: () => { hold = false; pending.splice(0).forEach(resolve => resolve()); },
  signOut: () => { actor = null; for (const listener of listeners) listener("SIGNED_OUT", null); },
} });
export const usePlaybook = () => coachingDefault;
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => {} });
export const useUnreadSupportCount = () => ({ count: 0 });
export const NotificationBell = () => <button aria-label="Notifications" type="button">◇</button>;
export const isAvatarBucketUrl = () => false;
export const cachePortalSlug = () => {};
export const customerSignOutTarget = () => "/auth";
export const performSignOut = () => { throw new Error("No Auth/provider operation allowed"); };
