import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actorA = "e0912000-0000-0000-0000-000000000001";
const actorB = "e0912000-0000-0000-0000-000000000002";
let user: { id: string; email: string } | null;
let listener: ((event: string, session: { user: { id: string } } | null) => void) | null;
const rpc = vi.fn();
const getUser = vi.fn();
const rawRead = vi.fn((..._args: unknown[]) => { throw new Error("raw CRM read forbidden"); });
const unsubscribe = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (...args: unknown[]) => rawRead(...args),
  rpc: (...args: unknown[]) => rpc(...args),
  auth: {
    getUser: () => getUser(),
    onAuthStateChange: (callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    },
  },
} }));
const { useMyContactId } = await import("./useMyContactId");
const profile = (actor = actorA) => ({
  id: actor === actorA ? "e0932000-0000-0000-0000-000000000001" : "e0932000-0000-0000-0000-000000000002",
  tenant_id: actor === actorA ? "e0922000-0000-0000-0000-000000000001" : "e0922000-0000-0000-0000-000000000002",
  linked_user_id: actor, first_name: "Test", last_name: "Customer", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "invited",
  is_signup_contact: false, paige_shared_context_consent: false,
  paige_shared_context_consent_updated_at: null, updated_at: null,
  email: "primary@tests.invalid", phone: "+12025550109",
  contact_methods: [{ kind: "email", value: "primary@tests.invalid", is_primary: true }],
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let state: ReturnType<typeof useMyContactId>;
let host: HTMLDivElement;
let root: Root;
function Probe({ enabled = true }: { enabled?: boolean }) {
  state = useMyContactId(enabled);
  return <output>{state.loading ? "resolving" : state.contactId ?? "no customer scope"}</output>;
}
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function mount(enabled = true) { await act(async () => root.render(<Probe enabled={enabled} />)); await flush(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function auth(event: string, actor: string | null) {
  act(() => listener?.(event, actor ? { user: { id: actor } } : null));
  await flush();
}
beforeEach(() => {
  listener = null; user = { id: actorA, email: "primary@tests.invalid" };
  rpc.mockReset(); getUser.mockReset(); rawRead.mockClear(); unsubscribe.mockClear();
  rpc.mockResolvedValue({ data: profile(), error: null });
  getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("actual-customer activity scope", () => {
  it("resolves only the checked canonical self-profile and never reads raw CRM", async () => {
    await mount();
    expect(state).toEqual({ contactId: profile().id, loading: false });
    expect(host.textContent).toBe(profile().id);
    expect(rpc).toHaveBeenCalledWith("client_portal_self_profile");
    expect(rawRead).not.toHaveBeenCalled();
  });
  it("does not turn a matching sign-in email into a relationship", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await mount();
    expect(state).toEqual({ contactId: null, loading: false });
    expect(rawRead).not.toHaveBeenCalled();
  });
  it.each([
    ["foreign actor", () => profile(actorB)],
    ["widened CRM fields", () => ({ ...profile(), current_notes: "internal" })],
    ["malformed DTO", () => ({ id: profile().id })],
  ])("withholds the Rail for a %s result", async (_name, value) => {
    rpc.mockResolvedValue({ data: value(), error: null });
    await mount();
    expect(state).toEqual({ contactId: null, loading: false });
  });
  it("does not read a profile after failed Auth verification", async () => {
    getUser.mockResolvedValue({ data: { user }, error: { message: "verification failed" } });
    await mount();
    expect(state).toEqual({ contactId: null, loading: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not resolve any contact for an unauthenticated visitor", async () => {
    user = null;
    await mount();
    expect(state).toEqual({ contactId: null, loading: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(rawRead).not.toHaveBeenCalled();
  });
  it("withholds scope after an RPC refusal or thrown transport error", async () => {
    rpc.mockResolvedValue({ data: profile(), error: { message: "forbidden" } });
    await mount();
    expect(state.contactId).toBeNull();
    rpc.mockRejectedValue(new Error("offline"));
    await auth("TOKEN_REFRESHED", actorA);
    expect(state).toEqual({ contactId: null, loading: false });
  });
  it("a late initial lookup cannot restore scope after confirmed sign-out", async () => {
    const pending = deferred<Awaited<ReturnType<typeof supabaseAuthResult>>>();
    getUser.mockReturnValueOnce(pending.promise);
    await mount();
    await auth("SIGNED_OUT", null);
    pending.resolve(supabaseAuthResult(actorA));
    await flush();
    expect(state).toEqual({ contactId: null, loading: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("clears old scope during an actor switch and ignores a late old-actor profile", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpc.mockReturnValueOnce(pending.promise);
    await mount();
    user = { id: actorB, email: "other@tests.invalid" };
    rpc.mockResolvedValue({ data: profile(actorB), error: null });
    await auth("SIGNED_IN", actorB);
    expect(state.contactId).toBe(profile(actorB).id);
    pending.resolve({ data: profile(), error: null });
    await flush();
    expect(state.contactId).toBe(profile(actorB).id);
    expect(host.textContent).not.toContain(profile().id);
  });
  it("withdraws a previously loaded scope on sign-out", async () => {
    await mount();
    await auth("SIGNED_OUT", null);
    expect(host.textContent).toBe("no customer scope");
    expect(state).toEqual({ contactId: null, loading: false });
  });
  it("withholds the old loaded contact while the new actor resolves", async () => {
    await mount();
    const pending = deferred<{ data: unknown; error: null }>();
    user = { id: actorB, email: "other@tests.invalid" };
    rpc.mockReturnValueOnce(pending.promise);
    await auth("SIGNED_IN", actorB);
    expect(state).toEqual({ contactId: null, loading: true });
    expect(host.textContent).not.toContain(profile().id);
    pending.resolve({ data: profile(actorB), error: null });
    await flush();
    expect(state.contactId).toBe(profile(actorB).id);
  });
  it("sign-out also retires an Auth callback read that has not started yet", async () => {
    await mount();
    const calls = rpc.mock.calls.length;
    act(() => {
      listener?.("TOKEN_REFRESHED", { user: { id: actorA } });
      listener?.("SIGNED_OUT", null);
    });
    await flush();
    expect(state).toEqual({ contactId: null, loading: false });
    expect(rpc).toHaveBeenCalledTimes(calls);
  });
  it("does not accept an old verified-user result for a newer Auth actor event", async () => {
    await mount();
    const calls = rpc.mock.calls.length;
    await auth("SIGNED_IN", actorB);
    expect(state).toEqual({ contactId: null, loading: false });
    expect(rpc).toHaveBeenCalledTimes(calls);
  });
  it("clears immediately when disabled and does no disabled identity work", async () => {
    await mount(false);
    expect(state).toEqual({ contactId: null, loading: false });
    expect(getUser).not.toHaveBeenCalled();
    expect(listener).toBeNull();
    await mount(true);
    expect(state.contactId).toBe(profile().id);
    await mount(false);
    expect(state).toEqual({ contactId: null, loading: false });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("a disabled request cannot repopulate its previous contact", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpc.mockReturnValueOnce(pending.promise);
    await mount();
    await mount(false);
    pending.resolve({ data: profile(), error: null });
    await flush();
    expect(state).toEqual({ contactId: null, loading: false });
  });
  it("revalidates on returning to the window instead of retaining a revoked relationship", async () => {
    await mount();
    rpc.mockResolvedValue({ data: null, error: null });
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(state).toEqual({ contactId: null, loading: false });
  });
  it("unsubscribes on unmount and ignores a late profile", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpc.mockReturnValueOnce(pending.promise);
    await mount();
    act(() => root.render(null));
    pending.resolve({ data: profile(), error: null });
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(host.textContent).toBe("");
  });
});

function supabaseAuthResult(id: string) { return { data: { user: { id } }, error: null }; }
