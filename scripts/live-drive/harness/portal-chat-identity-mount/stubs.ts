// Deterministic data boundary for the customer portal chat identity harness (E09 CURA round 2).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera").
// The signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// The customer frame is what client_portal_frame returns, already validated (readClientPortalFrame's output):
//   ?access=ready    a customer of Northwind Studio; ?agent=Ava names the business's agent, otherwise none (Cura)
//   ?access=inactive no customer relationship and no staff standing (a person whose access ended)
// ?push=1 lets the notifications prompt ask (push supported, never asked before).
const params = new URLSearchParams(window.location.search);
const access = params.get("access") === "inactive" ? "inactive" : "ready";
const agent = params.get("agent");

export const TENANT = "e0900000-0000-4000-8000-00000000b011";
const USER = { id: "e0900000-0000-4000-8000-00000000c011", email: "jordan.rivera@example.test", user_metadata: {} };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e", support_email: null };
const FRAME = {
  actorId: USER.id,
  profile: {
    id: "e0900000-0000-4000-8000-00000000a011", tenant_id: TENANT, linked_user_id: USER.id,
    first_name: "Jordan", last_name: "Rivera", entity_name: null, street_address: null, city: null, state: null, zip_code: null,
    onboarding_stage: null, is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
    updated_at: null, email: USER.email, phone: null, contact_methods: [],
  },
  brand: BRAND,
  config: agent ? { assistant: { display_name: agent } } : {},
};

export const harnessUser = USER;

export function useClientPortalFrame(actorId: string | null, enabled = true) {
  const on = enabled && !!actorId;
  return {
    phase: !on ? "not-client" : access === "ready" ? "ready" : "not-client",
    frame: on && access === "ready" ? FRAME : null,
    checking: false, epoch: 0, reload: async () => undefined,
  };
}
export function usePortalStaffStanding(_userId: string | null | undefined, enabled: boolean) {
  return enabled ? { loading: false, staff: false } : { loading: false, staff: null };
}
export async function readPortalStaffStanding() { return false; }
export function clearPortalStaffStanding() { /* harness */ }
export async function readCustomerChat() { return { threadId: "e0900000-0000-4000-8000-00000000d011", messages: [] }; }

export function usePushNotifications() {
  return {
    isSupported: true, isIOS: false, isPWAInstalled: false, isSubscribed: false, permission: "default",
    subscribe: async () => true, unsubscribe: async () => true, dismissPrompt: async () => undefined,
    shouldShowPrompt: async () => params.get("push") === "1",
  };
}
export function usePaigeMemory() {
  return { extractDocumentSummary: () => null, getSessionDocumentContext: () => undefined, trackActivity: () => undefined, generateSessionSummary: async () => undefined, resetSession: () => undefined };
}
export function useChatDocumentUpload() {
  return { attachedDoc: null, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null }, handleFileSelect: () => undefined, handleDragOver: () => undefined, handleDragLeave: () => undefined, handleDrop: () => undefined, removeAttachment: () => undefined, openFilePicker: () => undefined, setAttachedDoc: () => undefined };
}
export function useClientChatContext() { return { contextBlock: "", isLoading: false, hasCreditData: false }; }
export function useProfileSnapshot() { return { snapshot: {}, refresh: () => undefined }; }
export function trackEvent() { return Promise.resolve(); }
export function useBeforeUnloadGuard() { return undefined; }

/** Every table read resolves empty (no tiles' counts, no notifications, no avatar, no authored playbook). */
function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const single = { data: null, error: null };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve(single);
      return () => proxy;
    },
  });
  return proxy;
}
export const supabase = {
  rpc: (name: string) => {
    if (name === "get_client_portal_brand") return Promise.resolve({ data: access === "ready" ? [BRAND] : [], error: null });
    if (name === "get_client_portal_config") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
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
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
