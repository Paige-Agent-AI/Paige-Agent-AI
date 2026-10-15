import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

const actorA = "00000000-0000-4000-8000-000000000011";
const actorB = "00000000-0000-4000-8000-000000000012";
const tenant = "00000000-0000-4000-8000-000000000021";
const profile = (actor = actorA): ClientPortalSelfProfile => ({
  id: "00000000-0000-4000-8000-000000000031", tenant_id: tenant, linked_user_id: actor,
  first_name: "Test", last_name: "Customer", entity_name: null, street_address: null,
  city: null, state: null, zip_code: null, onboarding_stage: "ready", is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
  updated_at: "2026-10-15T18:00:00.000Z", email: "client@example.test", phone: "+12025550101",
  contact_methods: [{ kind: "email", value: "client@example.test", is_primary: true },
    { kind: "phone", value: "+12025550101", is_primary: true }],
});
type Listener = (event: string, session: { user: { id: string } } | null) => void;
let actor: string | null, row: ClientPortalSelfProfile | null, listener: Listener | undefined;
const rpc = vi.fn(), getUser = vi.fn(), getSession = vi.fn(), unsubscribe = vi.fn();
const raw = vi.fn(() => { throw new Error("No raw relationship or global-profile access"); });
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => {
    const request = rpc(...args);
    if (typeof request.setHeader === "function") return request;
    return Object.assign(request, { setHeader: () => request });
  }, from: () => raw(),
  auth: { getUser: (...args: unknown[]) => getUser(...args), getSession: () => getSession(), onAuthStateChange: (cb: Listener) => {
    listener = cb; return { data: { subscription: { unsubscribe } } };
  } },
} }));
const { ClientAccount } = await import("./ClientAccount");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount() { act(() => root.render(<MemoryRouter><ClientAccount /></MemoryRouter>)); await flush(); }
function input(label: string) {
  const id = Array.from(host.querySelectorAll("label")).find(x => x.textContent?.startsWith(label))?.htmlFor;
  return host.querySelector<HTMLInputElement>(`#${id}`)!;
}
function button(label: string) { return Array.from(host.querySelectorAll("button")).find(x => x.textContent?.trim() === label)!; }
async function change(label: string, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(label), value);
    input(label).dispatchEvent(new Event("input", { bubbles: true })); }); await flush();
}
async function submit() { act(() => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush(); }
function writes() { return rpc.mock.calls.filter(x => x[0] === "client_portal_update_self_profile"); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  actor = actorA; row = profile(); listener = undefined;
  rpc.mockReset(); getUser.mockReset(); getSession.mockReset(); raw.mockClear(); unsubscribe.mockClear();
  getSession.mockImplementation(async () => ({ data: { session: actor ? { access_token: `unit-${actor}` } : null }, error: null }));
  getUser.mockImplementation(async () => ({ data: { user: actor ? { id: actor } : null }, error: null }));
  rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === "client_portal_self_profile") return { data: row, error: null };
    if (name !== "client_portal_update_self_profile") throw new Error("Unexpected contract");
    row = { ...row!, ...args!.p_profile as object, updated_at: "2026-10-15T18:01:00.000Z" };
    return { data: row, error: null };
  });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); history.replaceState(null, "", "/"); vi.restoreAllMocks(); });

describe("approved Account personal information", () => {
  it("reads the checked relationship, keeps email read-only and preserves a Settings/security exit", async () => {
    await mount(); expect(input("First name").value).toBe("Test");
    expect(input("Email address").readOnly).toBe(true);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/app/settings?tab=personal");
    expect(raw).not.toHaveBeenCalled(); expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });
  it("saves only permitted changed fields with exact native scope/version and independently reads back", async () => {
    await mount(); await change("First name", "Updated"); await submit();
    expect(writes()).toEqual([["client_portal_update_self_profile", {
      p_expected_updated_at: "2026-10-15T18:00:00.000Z", p_tenant_id: tenant, p_profile: { first_name: "Updated" },
    }]]);
    expect(rpc.mock.calls.filter(x => x[0] === "client_portal_self_profile").length).toBeGreaterThan(1);
    expect(host.textContent).toContain("Information saved"); expect(input("First name").value).toBe("Updated");
  });
  it.each(["missing", "refused", "foreign", "widened"])("withholds form for %s relationship", async kind => {
    if (kind === "missing") row = null;
    if (kind === "foreign") row = profile(actorB);
    rpc.mockImplementation(async () => ({ data: kind === "widened" ? { ...profile(), private_note: "private" } : row,
      error: kind === "refused" ? { code: "42501" } : null }));
    await mount(); expect(host.querySelector("form")).toBeNull(); expect(writes()).toHaveLength(0); expect(raw).not.toHaveBeenCalled();
  });
  it("does not call domain RPC without verified Auth", async () => {
    actor = null; await mount(); expect(rpc).not.toHaveBeenCalled(); expect(host.querySelector("form")).toBeNull();
  });
  it("preserves edits after stale-version refusal and prevents overwrite until explicit reload", async () => {
    await mount(); await change("First name", "Draft");
    rpc.mockImplementation(async name => name === "client_portal_update_self_profile"
      ? { data: null, error: { code: "40001" } } : { data: row, error: null });
    await submit(); expect(input("First name").value).toBe("Draft"); expect(host.textContent).toContain("changed");
    await submit(); expect(writes()).toHaveLength(1);
    act(() => button("Discard edits and reload").click()); await flush();
    expect(input("First name").value).toBe("Test");
  });
  it("unknown write acknowledgement keeps the draft and offers readback without write replay", async () => {
    await mount(); await change("First name", "Draft");
    rpc.mockImplementation(async name => {
      if (name === "client_portal_update_self_profile") throw new Error("connection lost");
      return { data: row, error: null };
    });
    await submit(); expect(input("First name").value).toBe("Draft"); expect(host.textContent).not.toContain("Information saved");
    await submit(); expect(writes()).toHaveLength(1);
    expect(button("Check saved information")).toBeTruthy();
    act(() => button("Check saved information").click()); await flush(); expect(writes()).toHaveLength(1);
  });
  it("duplicate submit does not dispatch a second write", async () => {
    await mount(); await change("Last name", "Changed");
    const pending = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation(name => name === "client_portal_update_self_profile" ? pending.promise : Promise.resolve({ data: row, error: null }));
    await submit(); await submit(); expect(writes()).toHaveLength(1);
    pending.resolve({ data: { ...row!, last_name: "Changed" }, error: null }); await flush();
  });
  it("confirmed sign-out removes private values and retires late response/focus recovery", async () => {
    const pending = deferred<{ data: unknown; error: null }>(); rpc.mockReturnValueOnce(pending.promise);
    await mount(); act(() => listener?.("SIGNED_OUT", null)); await flush();
    const calls = rpc.mock.calls.length; pending.resolve({ data: profile(), error: null });
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain("client@example.test");
    expect(rpc).toHaveBeenCalledTimes(calls);
  });
  it("refuses late initial Auth after sign-out", async () => {
    const pending = deferred<{ data: { user: { id: string } }; error: null }>(); getUser.mockReturnValueOnce(pending.promise);
    await mount(); act(() => listener?.("SIGNED_OUT", null)); await flush();
    pending.resolve({ data: { user: { id: actorA } }, error: null }); await flush();
    expect(rpc).not.toHaveBeenCalled(); expect(host.querySelector("form")).toBeNull();
  });
  it("same-actor token refresh preserves verified in-progress edits", async () => {
    await mount(); await change("First name", "Draft");
    act(() => listener?.("TOKEN_REFRESHED", { user: { id: actorA } })); await flush();
    expect(input("First name").value).toBe("Draft"); expect(writes()).toHaveLength(0);
  });
  it("a read failure during unknown-outcome inspection keeps recoverable edits for retry", async () => {
    await mount(); await change("First name", "Draft");
    rpc.mockRejectedValueOnce(new Error("unknown write")); await submit();
    rpc.mockRejectedValueOnce(new Error("read offline"));
    act(() => button("Check saved information").click()); await flush();
    expect(host.querySelector("form")).toBeNull();
    act(() => button("Try again").click()); await flush();
    expect(input("First name").value).toBe("Draft"); expect(writes()).toHaveLength(1);
    expect(button("Save information").disabled).toBe(true);
  });
  it("foreign Auth before save cannot dispatch a write", async () => {
    await mount(); await change("First name", "Draft"); actor = actorB; await submit();
    expect(writes()).toHaveLength(0); expect(host.querySelector("form")).toBeNull();
  });
  it("does not turn malformed acknowledgement or differing readback into success", async () => {
    await mount(); await change("First name", "Draft");
    rpc.mockImplementation(async name => name === "client_portal_update_self_profile"
      ? { data: { ...profile(), first_name: "Draft", updated_at: "2026-10-15T18:01:00.000Z" }, error: null }
      : { data: profile(), error: null });
    await submit(); expect(host.textContent).not.toContain("Information saved");
    expect(button("Check saved information")).toBeTruthy();
  });
  it("a blank stored phone edit refuses instead of silently dropping the change", async () => {
    await mount(); await change("Phone number", " "); await submit();
    expect(writes()).toHaveLength(0); expect(host.textContent).toContain("Enter a phone number");
  });
  it("a fresh mount reads the canonical record rather than a retained UI cache", async () => {
    await mount(); await change("Last name", "Updated"); await submit();
    act(() => root.unmount()); root = createRoot(host); await mount();
    expect(input("Last name").value).toBe("Updated"); expect(raw).not.toHaveBeenCalled();
  });
  it("retryable Auth verification failure shows a retry rather than a false sign-out", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    await mount(); expect(button("Try again")).toBeTruthy();
    expect(host.textContent).not.toContain("Sign in with your invited account");
  });
  it("overlapping focus revalidation keeps the draft and its unload protection", async () => {
    await mount(); await change("First name", "Retained draft");
    const pending = deferred<{ data: { user: { id: string } }; error: null }>();
    getUser.mockReturnValueOnce(pending.promise);
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => window.dispatchEvent(new Event("focus"))); await flush();
    expect(input("First name").value).toBe("Retained draft");
    pending.resolve({ data: { user: { id: actorA } }, error: null }); await flush();
    expect(input("First name").value).toBe("Retained draft");
  });
  it("guards navigation initiated outside the form through the incumbent router", async () => {
    function OutsideNavigation() { const navigate = useNavigate(); return <button onClick={() => navigate("/outside")}>Outside navigation</button>; }
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => root.render(<MemoryRouter initialEntries={["/account"]}><OutsideNavigation /><Routes>
      <Route path="/account" element={<ClientAccount />} /><Route path="/outside" element={<p>Outside destination</p>} />
    </Routes></MemoryRouter>)); await flush();
    await change("First name", "Retained draft"); act(() => button("Outside navigation").click()); await flush();
    expect(confirm).toHaveBeenCalledOnce(); expect(input("First name").value).toBe("Retained draft");
    confirm.mockRestore();
  });
  it("pins actual installed SDK transport to the verified draft subject during a late token switch", async () => {
    const token = deferred<string>(); let acquiring = false;
    const rows = new Map([[actorA, profile()], [actorB, { ...profile(actorB), id: "00000000-0000-4000-8000-000000000032" }]]);
    const effects: string[] = [];
    const sdk = createClient("https://unit-test.invalid", "unit-test-public-key", {
      accessToken: async () => { acquiring = true; return token.promise; },
      global: { fetch: async (_url, init) => {
        const bearer = new Headers(init?.headers).get("Authorization");
        const subject = bearer === `Bearer unit-${actorA}` ? actorA : actorB;
        const args = JSON.parse(String(init?.body)); const target = rows.get(subject)!;
        if (target.tenant_id === args.p_tenant_id && target.updated_at === args.p_expected_updated_at) {
          rows.set(subject, { ...target, ...args.p_profile, updated_at: "2026-10-15T18:02:00.000Z" }); effects.push(subject);
        }
        return new Response(JSON.stringify(rows.get(subject)), { status: 200, headers: { "Content-Type": "application/json" } });
      } },
    });
    await mount(); await change("First name", "Original draft");
    rpc.mockImplementation((name: string, args: never) => name === "client_portal_update_self_profile"
      ? sdk.rpc(name, args) : Promise.resolve({ data: rows.get(actor!), error: null }));
    await submit(); expect(acquiring).toBe(true);
    actor = actorB; act(() => listener?.("SIGNED_IN", { user: { id: actorB } }));
    token.resolve("unit-switched-actor"); await flush();
    expect(effects).not.toContain(actorB); expect(rows.get(actorB)?.first_name).toBe("Test");
    expect(getUser).toHaveBeenCalledWith(`unit-${actorA}`);
  });
  it("unpinned installed-SDK control demonstrates late token selection with colliding row versions", async () => {
    const rows = new Map([[actorA, profile()], [actorB, { ...profile(actorB), id: "00000000-0000-4000-8000-000000000032" }]]);
    const sdk = createClient("https://unit-test.invalid", "unit-test-public-key", {
      accessToken: async () => `unit-${actorB}`,
      global: { fetch: async (_url, init) => {
        const subject = new Headers(init?.headers).get("Authorization") === `Bearer unit-${actorA}` ? actorA : actorB;
        const args = JSON.parse(String(init?.body)); const p = rows.get(subject)!;
        if (p.tenant_id === args.p_tenant_id && p.updated_at === args.p_expected_updated_at) rows.set(subject, { ...p, ...args.p_profile });
        return new Response(JSON.stringify(rows.get(subject)), { status: 200, headers: { "Content-Type": "application/json" } });
      } },
    });
    await sdk.rpc("client_portal_update_self_profile", { p_tenant_id: tenant,
      p_expected_updated_at: profile().updated_at, p_profile: { first_name: "Control draft" } });
    expect(rows.get(actorB)?.first_name).toBe("Control draft");
    expect(rows.get(actorA)?.first_name).toBe("Test");
  });
  it("does not infer credential authority from the cached session user", async () => {
    await mount(); await change("First name", "Draft");
    getSession.mockResolvedValue({ data: { session: { user: { id: actorA }, access_token: "unit-wrong-subject" } }, error: null });
    getUser.mockImplementation(async credential => ({ data: { user: { id: credential ? actorB : actorA } }, error: null }));
    await submit(); expect(writes()).toHaveLength(0); expect(host.querySelector("form")).toBeNull();
  });
  it("real BrowserRouter back restores the existing entry before discard confirmation", async () => {
    history.replaceState({ idx: 0 }, "", "/outside");
    history.pushState({ idx: 1 }, "", "/app/settings?view=client-account");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => root.render(<BrowserRouter><Routes>
      <Route path="/app/settings" element={<ClientAccount />} />
      <Route path="/outside" element={<p>Outside destination</p>} />
    </Routes></BrowserRouter>)); await flush(); await change("First name", "Retained draft");
    act(() => history.back());
    await vi.waitFor(() => { expect(confirm).toHaveBeenCalledOnce(); expect(location.pathname).toBe("/app/settings"); });
    expect(input("First name").value).toBe("Retained draft");
    confirm.mockReturnValue(true); act(() => history.back());
    await vi.waitFor(() => expect(host.textContent).toContain("Outside destination"));
    expect(writes()).toHaveLength(0); expect(host.querySelector("form")).toBeNull();
  });
  it("forced session/privacy replacement is not held by a dirty draft", async () => {
    function SessionReplacement() { const navigate = useNavigate(); return <button onClick={() => navigate("/auth", { replace: true })}>Session replacement</button>; }
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => root.render(<MemoryRouter initialEntries={["/account"]}><SessionReplacement /><Routes>
      <Route path="/account" element={<ClientAccount />} /><Route path="/auth" element={<p>Sign-in destination</p>} />
    </Routes></MemoryRouter>)); await flush(); await change("First name", "Draft");
    act(() => button("Session replacement").click()); await flush();
    expect(host.textContent).toContain("Sign-in destination"); expect(confirm).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });
});
