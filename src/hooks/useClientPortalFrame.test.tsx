import {act, StrictMode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {useClientPortalFrame} from "./useClientPortalFrame";

const f = vi.hoisted(() => ({getUser: vi.fn(), rpc: vi.fn(), unsubscribe: vi.fn(),
  listener: null as null | ((event: string, session: {user: {id: string}} | null) => void)}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {
  auth: {getUser: () => f.getUser(), onAuthStateChange: (cb: typeof f.listener) => {
    f.listener = cb; return {data: {subscription: {unsubscribe: f.unsubscribe}}};
  }}, rpc: (...args: unknown[]) => f.rpc(...args),
}}));
const actor = "e0915000-0000-0000-0000-000000000001", other = "e0915000-0000-0000-0000-000000000002";
const tenant = "e0925000-0000-0000-0000-000000000001", foreign = "e0925000-0000-0000-0000-000000000002";
const contact = "e0935000-0000-0000-0000-000000000001";
const snapshot = (subject = actor, business = tenant) => ({actor_id: subject,
  profile: {id: contact, tenant_id: business, linked_user_id: subject, first_name: "Jordan", last_name: "Test",
    entity_name: null, street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "invited",
    is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
    updated_at: null, email: "customer@tests.invalid", phone: null, contact_methods: []},
  brand: {tenant_id: business, tenant_name: "Test business", tenant_slug: "test-business", logo_url: null, primary_color: "#304E42", support_email: null},
  config: {welcome: {headline: "Your next step"}, modules: [{key: "documents", visible: true}]},
});
let state: ReturnType<typeof useClientPortalFrame>, root: Root, host: HTMLDivElement, mounted: boolean;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function Probe({subject = actor, enabled = true, required = false}: {subject?: string; enabled?: boolean; required?: boolean}) {
  state = useClientPortalFrame(subject, enabled, required); return <output>{state.phase}:{state.frame?.brand.tenant_name}</output>;
}
const flush = async () => act(async () => {for (let i = 0; i < 30; i++) await Promise.resolve();});
const mount = async (props: Parameters<typeof Probe>[0] = {}, strict = false) => {
  mounted = true; await act(async () => root.render(strict ? <StrictMode><Probe {...props}/></StrictMode> : <Probe {...props}/>)); await flush();
};
function deferred<T>() {let resolve!: (v: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};}
beforeEach(() => {
  vi.clearAllMocks(); f.listener = null;
  f.getUser.mockResolvedValue({data: {user: {id: actor}}, error: null});
  f.rpc.mockResolvedValue({data: snapshot(), error: null});
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); mounted = false;
});
afterEach(() => {if (mounted) act(() => root.unmount()); host.remove(); vi.useRealTimers();});

it("admits only the closed native own-relationship and matching brand snapshot", async () => {
  await mount(); expect(state.phase).toBe("ready"); expect(state.frame?.profile.id).toBe(contact);
  expect(state.frame?.config.welcome?.headline).toBe("Your next step");
  expect(f.rpc).toHaveBeenCalledWith("client_portal_frame"); expect(f.getUser).toHaveBeenCalledTimes(2);
});
it("keeps an initial canonical noncustomer in the incumbent branch without a brand lookup", async () => {
  f.rpc.mockResolvedValue({data: null, error: null}); await mount(); expect(state.phase).toBe("not-client"); expect(state.frame).toBeNull();
});
it("does not replace explicitly requested customer access with legacy on an absent relationship", async () => {
  f.rpc.mockResolvedValue({data: null, error: null}); await mount({required: true}); expect(state.phase).toBe("unavailable");
});
it("does not use a brand or invented role as proof of a client relationship", async () => {
  f.rpc.mockResolvedValue({data: {brand: snapshot().brand, role: "client"}, error: null}); await mount();
  expect(state.phase).toBe("error"); expect(state.frame).toBeNull();
});
it.each(["42501"])("refuses canonical denied or ambiguous relationship %s without fallback", async code => {
  f.rpc.mockResolvedValue({data: null, error: {code}}); await mount(); expect(state.phase).toBe("unavailable");
});
it.each(["actor", "profile", "brand", "widened", "config"])("rejects a foreign or invalid %s envelope", async kind => {
  const value: Record<string, unknown> = snapshot();
  if (kind === "actor") value.actor_id = other;
  if (kind === "profile") value.profile = {...snapshot().profile, linked_user_id: other};
  if (kind === "brand") value.brand = {...snapshot().brand, tenant_id: foreign};
  if (kind === "widened") value.internal_notes = "private";
  if (kind === "config") value.config = [];
  f.rpc.mockResolvedValue({data: value, error: null}); await mount(); expect(state.phase).toBe("error"); expect(state.frame).toBeNull();
});
it("checks the actual current Auth actor again before publishing a snapshot", async () => {
  f.getUser.mockResolvedValueOnce({data: {user: {id: actor}}, error: null}).mockResolvedValue({data: {user: {id: other}}, error: null});
  await mount(); expect(state.phase).toBe("unavailable"); expect(state.frame).toBeNull();
});
it("preserves a same-scope mount epoch on focus or token refresh", async () => {
  await mount(); const epoch = state.epoch;
  act(() => window.dispatchEvent(new Event("focus"))); await flush(); expect(state.phase).toBe("ready"); expect(state.epoch).toBe(epoch);
  act(() => f.listener?.("TOKEN_REFRESHED", {user: {id: actor}})); await flush(); expect(state.epoch).toBe(epoch);
});
it("keeps a prior draft's frame retained but unverified after transient read failure", async () => {
  await mount(); const epoch = state.epoch; f.rpc.mockRejectedValueOnce(new Error("offline"));
  await act(async () => state.reload()); expect(state.phase).toBe("error"); expect(state.frame?.profile.id).toBe(contact);
  await act(async () => state.reload()); expect(state.phase).toBe("ready"); expect(state.epoch).toBe(epoch);
});
it("retires prior access after authoritative relationship loss instead of showing legacy", async () => {
  await mount(); f.rpc.mockResolvedValue({data: null, error: null}); await act(async () => state.reload());
  expect(state.phase).toBe("unavailable"); expect(state.frame).toBeNull();
});
it("does not mistake an unreadable Auth check for confirmed relationship loss", async () => {
  await mount(); const epoch = state.epoch;
  f.getUser.mockResolvedValueOnce({data: {user: null}, error: {message: "offline"}});
  await act(async () => state.reload()); expect(state.phase).toBe("error"); expect(state.frame?.profile.id).toBe(contact); expect(state.epoch).toBe(epoch);
});
it("retires old content on sign-out and ignores its late RPC", async () => {
  await mount(); const pending = deferred<{data: ReturnType<typeof snapshot>; error: null}>();
  f.rpc.mockReturnValueOnce(pending.promise); let job!: Promise<void>; act(() => {job = state.reload();}); await flush();
  act(() => f.listener?.("SIGNED_OUT", null)); pending.resolve({data: snapshot(), error: null}); await act(async () => job);
  expect(state.phase).toBe("unavailable"); expect(state.frame).toBeNull();
});
it("cannot publish the previous actor's reply after a subject change", async () => {
  const pending = deferred<{data: ReturnType<typeof snapshot>; error: null}>(); f.rpc.mockReturnValueOnce(pending.promise);
  await mount(); f.getUser.mockResolvedValue({data: {user: {id: other}}, error: null}); f.rpc.mockResolvedValue({data: snapshot(other, foreign), error: null});
  await mount({subject: other}); pending.resolve({data: snapshot(), error: null}); await flush();
  expect(state.phase).toBe("ready"); expect(state.frame?.actorId).toBe(other); expect(state.frame?.profile.tenant_id).toBe(foreign);
});
it("changes the mount epoch when a newly verified relationship changes", async () => {
  await mount(); const epoch = state.epoch; f.rpc.mockResolvedValue({data: snapshot(actor, foreign), error: null});
  await act(async () => state.reload()); expect(state.epoch).toBeGreaterThan(epoch); expect(state.frame?.profile.tenant_id).toBe(foreign);
});
it("cleans up subscriptions and rejects late unmount replies in strict mode", async () => {
  await mount({}, true); const pending = deferred<{data: ReturnType<typeof snapshot>; error: null}>(); f.rpc.mockReturnValueOnce(pending.promise);
  let job!: Promise<void>; act(() => {job = state.reload();}); await flush(); act(() => root.unmount()); mounted = false;
  pending.resolve({data: snapshot(), error: null}); await job; expect(f.unsubscribe).toHaveBeenCalledTimes(2);
});
it("does not read native customer state for an explicit impersonation/legacy branch", async () => {
  await mount({enabled: false}); expect(state.phase).toBe("not-client"); expect(f.getUser).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
});
it("bounds a hung admission read and leaves it unverified", async () => {
  vi.useFakeTimers(); f.rpc.mockReturnValue(new Promise(() => {})); await mount();
  await act(async () => vi.advanceTimersByTimeAsync(20_001)); expect(state.phase).toBe("error"); expect(state.frame).toBeNull();
});

// E09 Slice 7 — a paused or ended relationship is told so, in EVERY branch that would otherwise
// refuse or fall back to the platform shell (review HIGH-1: the mid-session pause is the case the
// owner's confirm copy promises, "they'll see that access is paused the next time they open it").
const withheld = (state: "paused" | "ended") => ({state, business: {name: "Test business", logo_url: null}, since: "2026-10-18T12:00:00Z"});
const routed = (frame: unknown, access: unknown) => (name: string) =>
  Promise.resolve(name === "client_portal_access_state" ? access : name === "client_portal_frame" ? frame : {data: null, error: null});
it.each(["paused", "ended"] as const)("names a %s relationship instead of the platform shell on first open", async kind => {
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: withheld(kind), error: null})); await mount();
  expect(state.phase).toBe(kind); expect(state.access?.businessName).toBe("Test business"); expect(state.frame).toBeNull();
});
it("a pause that lands while the portal is open shows paused on the next read, not 'unavailable'", async () => {
  await mount(); expect(state.phase).toBe("ready");
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: withheld("paused"), error: null}));
  await act(async () => state.reload()); expect(state.phase).toBe("paused"); expect(state.frame).toBeNull();
});
it("explicitly requested customer access that has ended reads ended, not 'unavailable'", async () => {
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: withheld("ended"), error: null})); await mount({required: true});
  expect(state.phase).toBe("ended");
});
it("a 42501 refusal is checked for a withheld relationship before it becomes 'unavailable'", async () => {
  f.rpc.mockImplementation(routed({data: null, error: {code: "42501"}}, {data: withheld("paused"), error: null})); await mount();
  expect(state.phase).toBe("paused");
});
it("more than one business keeps the existing refusal (Slice 8 owns the choice)", async () => {
  f.rpc.mockImplementation(routed({data: null, error: {code: "42501"}}, {data: {state: "multiple"}, error: null})); await mount();
  expect(state.phase).toBe("unavailable");
});
it("nothing recorded keeps the incumbent non-customer branch", async () => {
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: {state: "none"}, error: null})); await mount();
  expect(state.phase).toBe("not-client"); expect(state.access).toBeNull();
});
it("before the access reader exists (PGRST202) the incumbent branch is unchanged", async () => {
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: null, error: {code: "PGRST202"}})); await mount();
  expect(state.phase).toBe("not-client");
});
it("an unanswerable access check never falls back to the platform shell", async () => {
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: null, error: {code: "500"}})); await mount();
  expect(state.phase).toBe("error"); expect(state.frame).toBeNull();
});
it("the customer read never carries a reason or note into the frame state", async () => {
  f.rpc.mockImplementation(routed({data: null, error: null}, {data: {...withheld("paused"), reason: "payment", note: "private"}, error: null})); await mount();
  expect(JSON.stringify(state.access)).not.toMatch(/payment|private/);
});
// Review 7: a staff member or non-customer on /app must not be told their "customer session couldn't
// be checked" because one access read dropped. The access read is retried once on its own deadline.
it("a dropped access read is asked once more before it becomes 'error'", async () => {
  let accessCalls = 0;
  f.rpc.mockImplementation(async (name: string) => {
    if (name !== "client_portal_access_state") return {data: null, error: null};
    accessCalls += 1;
    return accessCalls === 1 ? {data: null, error: {code: "500"}} : {data: {state: "none"}, error: null};
  });
  await mount();
  expect(state.phase).toBe("not-client"); expect(accessCalls).toBe(2);
});
