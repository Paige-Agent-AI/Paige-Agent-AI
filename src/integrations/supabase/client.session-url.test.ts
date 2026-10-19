/**
 * E09 Slice H: a session is born only on the app origin. This drives the REAL Supabase client module
 * (real supabase-js / auth-js, real storage) with a URL carrying implicit-grant tokens, on a tenant host
 * and on the app origin. The only double is fetch, standing in for the Auth server's /user endpoint.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type JsdomHandle = { reconfigure(options: { url: string }): void };
const dom = (globalThis as typeof globalThis & { jsdom: JsdomHandle }).jsdom;
const ORIGINAL_URL = window.location.href;
const STORAGE_KEY = "sb-unit-test-auth-token";
const now = () => Math.round(Date.now() / 1000);
const tokens = () =>
  `access_token=attacker-at&refresh_token=attacker-rt&expires_in=3600&expires_at=${now() + 3600}&token_type=bearer&type=magiclink`;

let userCalls: string[];
let loaded: { auth: { getSession(): Promise<{ data: { session: unknown } }>; stopAutoRefresh(): Promise<void> } } | null;

async function loadClientAt(url: string) {
  dom.reconfigure({ url });
  vi.resetModules();
  ({ supabase: loaded } = await import("./client") as unknown as { supabase: NonNullable<typeof loaded> });
  const { data } = await loaded.auth.getSession();
  await loaded.auth.stopAutoRefresh();
  return data.session as { access_token?: string } | null;
}

beforeEach(() => {
  window.localStorage.clear();
  userCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const href = String(input instanceof Request ? input.url : input);
    if (!href.startsWith("https://unit-test.invalid/auth/v1/user")) throw new Error("unexpected transport in test");
    userCalls.push(href);
    return new Response(JSON.stringify({ id: "attacker-user", aud: "authenticated", role: "authenticated" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  loaded = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
  dom.reconfigure({ url: ORIGINAL_URL });
});

it.each([
  ["hash", (t: string) => `https://acme.paigeagent.ai/portal/acme#${t}`],
  ["any path", (t: string) => `https://acme.paigeagent.ai/app/anything#${t}`],
])("never adopts a session from URL tokens on a tenant host (%s)", async (_label, url) => {
  const session = await loadClientAt(url(tokens()));
  expect(session).toBeNull();
  expect(userCalls).toEqual([]);
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("still adopts a session from URL tokens on the app origin, exactly as today (§58)", async () => {
  const session = await loadClientAt(`https://paigeagent.ai/auth#${tokens()}`);
  expect(session?.access_token).toBe("attacker-at");
  expect(userCalls).toHaveLength(1);
  expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
});

it("removes auth parameters from the tenant host's address bar while the client module loads", async () => {
  const replaceState = vi.spyOn(window.history, "replaceState");
  await loadClientAt(`https://acme.paigeagent.ai/book/intro?ref=partner&code=abc&sb_flow_id=f1#${tokens()}&tab=Two%20words`);
  expect(window.location.href).toBe("https://acme.paigeagent.ai/book/intro?ref=partner#tab=Two%20words");
  expect(replaceState).toHaveBeenCalledTimes(1);
});

it("leaves the app origin's address bar to supabase-js, exactly as today (§58)", async () => {
  const url = "https://paigeagent.ai/book/intro?ref=partner&code=abc&sb_flow_id=f1#tab=1";
  const replaceState = vi.spyOn(window.history, "replaceState");
  await loadClientAt(url);
  expect(window.location.href).toBe(url);
  expect(replaceState).not.toHaveBeenCalled();
});
