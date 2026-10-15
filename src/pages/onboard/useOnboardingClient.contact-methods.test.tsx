// Mounted hook tests: canonical primary addresses, no email claiming, and stale-session fencing.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { ClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

const actorA = "e0911000-0000-0000-0000-000000000001";
const actorB = "e0911000-0000-0000-0000-000000000002";
let user: { id: string; email: string } | null;
let authError: { name: string; status?: number } | null;
let authListener: ((event: string, session: Session | null) => void) | null;
const rpc = vi.fn();
const getUser = vi.fn();
const rawRead = vi.fn((..._args: unknown[]) => { throw new Error("raw CRM access is forbidden in this hook"); });
const unsubscribe = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => rawRead(...args),
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      getUser: () => getUser(),
      onAuthStateChange: (callback: typeof authListener) => {
        authListener = callback;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  },
}));
const { useOnboardingClient } = await import("./useOnboardingClient");
const profile = (actorId = actorA): ClientPortalSelfProfile => ({
  id: actorId === actorA ? "e0931000-0000-0000-0000-000000000001" : "e0931000-0000-0000-0000-000000000002",
  tenant_id: actorId === actorA ? "e0921000-0000-0000-0000-000000000001" : "e0921000-0000-0000-0000-000000000002",
  linked_user_id: actorId, first_name: "Test", last_name: "Customer", entity_name: null,
  street_address: "1 Test Road", city: "Test City", state: "TS", zip_code: "00000",
  onboarding_stage: "invited", is_signup_contact: false, paige_shared_context_consent: false,
  paige_shared_context_consent_updated_at: null, updated_at: null,
  email: "primary@tests.invalid", phone: "+12025550109",
  contact_methods: [
    { kind: "email", value: "primary@tests.invalid", is_primary: true },
    { kind: "email", value: "secondary@tests.invalid", is_primary: false },
    { kind: "phone", value: "+12025550109", is_primary: true },
  ],
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let state: ReturnType<typeof useOnboardingClient> | null = null;
function Probe() { state = useOnboardingClient(); return null; }
let host: HTMLDivElement;
let root: Root;
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function mount() { await act(async () => { root.render(<Probe />); }); await flush(); }
const deferred = () => {
  let resolve!: (value: { data: unknown; error: unknown }) => void;
  const promise = new Promise<{ data: unknown; error: unknown }>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  state = null; user = { id: actorA, email: "secondary@tests.invalid" }; authError = null; authListener = null;
  rpc.mockReset(); getUser.mockReset(); rawRead.mockClear(); unsubscribe.mockClear();
  getUser.mockImplementation(() => Promise.resolve({ data: { user }, error: authError }));
  rpc.mockResolvedValue({ data: profile(), error: null });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
describe("safe onboarding relationship", () => {
  it("hydrates canonical primary addresses and postal fields through the checked RPC", async () => {
    await mount();
    expect(state?.client).toMatchObject({ email: "primary@tests.invalid", phone: "+12025550109", street_address: "1 Test Road" });
    expect(rpc).toHaveBeenCalledWith("client_portal_self_profile");
    expect(rawRead).not.toHaveBeenCalled();
  });
  it("a matching sign-in email cannot claim a missing relationship", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await mount();
    expect(state?.error).toBe("no_client_record");
    expect(state?.client).toBeNull();
    expect(rawRead).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("backend refusal is unavailable rather than evidence of a missing account", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "scope refusal" } });
    await mount();
    expect(state?.error).toBe("profile_unavailable");
    expect(state?.client).toBeNull();
  });
  it("refuses a foreign actor projection", async () => {
    rpc.mockResolvedValue({ data: profile(actorB), error: null });
    await mount();
    expect(state?.error).toBe("profile_unavailable");
    expect(state?.client).toBeNull();
  });
  it("refuses a widened private-field response", async () => {
    rpc.mockResolvedValue({ data: { ...profile(), current_notes: "PRIVATE" }, error: null });
    await mount();
    expect(state?.error).toBe("profile_unavailable");
    expect(state?.client).toBeNull();
  });
  it("signed-out callers do not query client records", async () => {
    user = null;
    await mount();
    expect(state?.error).toBe("not_authenticated");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a denied Auth session requires sign-in before any client read", async () => {
    user = null; authError = { name: "AuthApiError", status: 401 };
    await mount();
    expect(state?.error).toBe("not_authenticated");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an unavailable Auth read stays retryable rather than guessing sign-out", async () => {
    user = null; authError = { name: "AuthRetryableFetchError", status: 0 };
    await mount();
    expect(state?.error).toBe("profile_unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sign-out invalidates the initial pending Auth lookup before any profile request", async () => {
    const oldUser = user;
    const pending = deferred(); getUser.mockImplementationOnce(() => pending.promise);
    await mount(); user = null;
    act(() => authListener?.("SIGNED_OUT", null));
    await act(async () => { pending.resolve({ data: { user: oldUser }, error: null }); });
    expect(state?.loading).toBe(false);
    expect(state?.error).toBe("not_authenticated");
    expect(state?.client).toBeNull();
    expect(state?.userEmail).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sign-out fences a late response and clears prior client identity", async () => {
    const pending = deferred(); rpc.mockImplementationOnce(() => pending.promise);
    await mount(); user = null;
    act(() => authListener?.("SIGNED_OUT", null));
    await act(async () => { pending.resolve({ data: profile(), error: null }); });
    expect(state?.error).toBe("not_authenticated");
    expect(state?.client).toBeNull();
    expect(state?.userEmail).toBeNull();
  });
  it("an initial null-session event preserves a retryable Auth failure", async () => {
    const pending = deferred(); getUser.mockImplementationOnce(() => pending.promise);
    await mount();
    act(() => authListener?.("INITIAL_SESSION", null));
    await act(async () => {
      pending.resolve({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    });
    expect(state?.loading).toBe(false);
    expect(state?.error).toBe("profile_unavailable");
    expect(state?.client).toBeNull();
    expect(state?.userEmail).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an initial null-session event still requires sign-in after a confirmed missing user", async () => {
    const pending = deferred(); getUser.mockImplementationOnce(() => pending.promise);
    await mount();
    act(() => authListener?.("INITIAL_SESSION", null));
    await act(async () => { pending.resolve({ data: { user: null }, error: null }); });
    expect(state?.error).toBe("not_authenticated");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an account switch keeps the new subject's record when the old request finishes later", async () => {
    const pending = deferred(); rpc.mockImplementationOnce(() => pending.promise);
    await mount(); user = { id: actorB, email: "other@tests.invalid" };
    rpc.mockResolvedValue({ data: profile(actorB), error: null });
    act(() => authListener?.("SIGNED_IN", { user } as Session));
    await flush();
    expect(state?.client?.linked_user_id).toBe(actorB);
    await act(async () => { pending.resolve({ data: profile(), error: null }); });
    expect(state?.client?.linked_user_id).toBe(actorB);
    expect(state?.userEmail).toBe("other@tests.invalid");
  });
  it("retry recovers from a refused read without stale client state", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await mount();
    expect(state?.error).toBe("profile_unavailable");
    rpc.mockResolvedValue({ data: profile(), error: null });
    await act(async () => { await state?.refresh(); });
    expect(state?.error).toBeNull();
    expect(state?.client?.linked_user_id).toBe(actorA);
  });
  it("projects only the same native relationship after a confirmed save without clearing the parent", async () => {
    await mount();const calls=rpc.mock.calls.length;
    const saved={...profile(),first_name:"Saved",onboarding_stage:"signing_agreement"};
    act(()=>{expect(state?.acceptSavedProfile(saved)).toBe(true);});
    expect(state?.client?.first_name).toBe("Saved");expect(state?.client?.onboarding_stage).toBe("signing_agreement");
    expect(state?.loading).toBe(false);expect(rpc.mock.calls).toHaveLength(calls);
  });
  it("refuses foreign or widened saved-profile projections", async () => {
    await mount();const original=state?.client;
    act(()=>{
      expect(state?.acceptSavedProfile(profile(actorB))).toBe(false);
      expect(state?.acceptSavedProfile({...profile(),tenant_id:"e0921000-0000-0000-0000-000000000099"})).toBe(false);
      expect(state?.acceptSavedProfile({...profile(),current_notes:"PRIVATE"} as ReturnType<typeof profile>)).toBe(false);
    });expect(state?.client).toEqual(original);
  });
  it("a save projection cannot resurrect a signed-out parent even before React commits", async () => {
    await mount();act(()=>{authListener?.("SIGNED_OUT",null);expect(state?.acceptSavedProfile(profile())).toBe(false);});
    expect(state?.client).toBeNull();expect(state?.error).toBe("not_authenticated");
  });
});
