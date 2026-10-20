/**
 * E09 Slice H (decision D5): `<slug>.paigeagent.ai` is a PUBLIC entry. It shows the business's brand
 * and links out to the app origin, where sign-in, the session and the signed-in portal live. It never
 * reads a session, never renders signed-in data, and never navigates to a relative `/app` — on a tenant
 * host that path is pinned back to `/portal/<slug>` by host routing, which was a redirect loop. A
 * tenant, unknown or hostile hostname never chooses where a password-reset email sends someone.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PortalGateway from "./PortalGateway";

const f = vi.hoisted(() => ({
  user: null as null | { id: string },
  route: vi.fn(), rpc: vi.fn(), signin: vi.fn(), getUser: vi.fn(), reset: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...a: unknown[]) => f.rpc(...a),
  auth: {
    getUser: () => f.getUser(),
    signInWithPassword: (...a: unknown[]) => f.signin(...a),
    resetPasswordForEmail: (...a: unknown[]) => f.reset(...a),
  },
} }));
vi.mock("@/lib/auth/resolveLandingRoute", () => ({ resolveLandingRoute: (...a: unknown[]) => f.route(...a) }));
vi.mock("@/lib/auth/signOut", () => ({ cachePortalSlug: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => f.toast(...a), success: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type JsdomHandle = { reconfigure(options: { url: string }): void };
const dom = (globalThis as typeof globalThis & { jsdom: JsdomHandle }).jsdom;
const ORIGINAL_URL = window.location.href;
const at = (url: string) => dom.reconfigure({ url });

let host: HTMLDivElement, root: Root;
const acme = { tenant_name: "Acme Studio", tenant_slug: "acme", logo_url: null, primary_color: "#26483e" };
const render = (path: string) => act(async () => root.render(
  <HelmetProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/portal/:tenantSlug" element={<PortalGateway />} />
    <Route path="/app" element={<p>Signed-in customer portal</p>} />
  </Routes></MemoryRouter></HelmetProvider>,
));
const entryLink = () => host.querySelector<HTMLAnchorElement>("a[data-portal-entry]");
const type = (id: string, value: string) => act(async () => {
  const el = host.querySelector<HTMLInputElement>(`#${id}`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (label: string) => act(async () => {
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!.click();
});

beforeEach(() => {
  vi.clearAllMocks();
  f.user = { id: "test-customer" };
  f.route.mockResolvedValue("/app");
  f.getUser.mockImplementation(async () => ({ data: { user: f.user }, error: null }));
  f.rpc.mockImplementation(async (name: string, args?: { _slug?: string }) => (
    name === "peek_tenant_portal_brand" ? { data: [{ ...acme, tenant_slug: args?._slug ?? "acme" }], error: null }
      : { data: [acme], error: null }));
  f.reset.mockResolvedValue({ error: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); at(ORIGINAL_URL); });

it("does not loop a signed-in visitor on a tenant host: it never reads the session or navigates to /app", async () => {
  at("https://acme.paigeagent.ai/portal/acme");
  await render("/portal/acme");
  expect(f.getUser).not.toHaveBeenCalled();
  expect(f.route).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.some(([name]) => name === "get_client_portal_brand")).toBe(false);
  expect(host.textContent).not.toContain("Signed-in customer portal");
});

it("renders the tenant host as a public entry that links out to the app origin", async () => {
  at("https://acme.paigeagent.ai/portal/acme");
  await render("/portal/acme");
  expect(host.textContent).toContain("Welcome back to Acme Studio");
  expect(entryLink()?.getAttribute("href")).toBe("https://paigeagent.ai/portal/acme");
  // No credential is ever collected on the tenant origin, so no session is ever born there.
  expect(host.querySelector("input[type=password]")).toBeNull();
  expect(host.querySelector("#portal-email")).toBeNull();
  expect(f.signin).not.toHaveBeenCalled();
});

it("pins a wrong route slug on a tenant host to the hostname tenant for both the brand and the link", async () => {
  at("https://acme.paigeagent.ai/portal/other-business");
  await render("/portal/other-business");
  expect(f.rpc).toHaveBeenCalledWith("peek_tenant_portal_brand", { _slug: "acme" });
  expect(f.rpc.mock.calls.some(([, args]) => (args as { _slug?: string } | undefined)?._slug === "other-business")).toBe(false);
  expect(entryLink()?.getAttribute("href")).toBe("https://paigeagent.ai/portal/acme");
});

it("keeps the app origin's own gateway unchanged: a signed-in customer goes straight into /app", async () => {
  at("https://paigeagent.ai/portal/acme");
  await render("/portal/acme");
  expect(f.route).toHaveBeenCalledWith("test-customer", { customerPortal: true });
  expect(host.textContent).toContain("Signed-in customer portal");
  expect(entryLink()).toBeNull();
});

it("keeps the app origin's reset link on the app origin", async () => {
  at("https://paigeagent.ai/portal/acme");
  f.user = null;
  await render("/portal/acme");
  await type("portal-email", "recipient@tests.invalid");
  await click("Forgot your password?");
  expect(f.reset).toHaveBeenCalledWith("recipient@tests.invalid", {
    redirectTo: "https://paigeagent.ai/reset-password?portal=acme",
  });
});

it("never lets a hostile host choose where the reset email sends someone", async () => {
  at("https://evil.example/portal/acme");
  f.user = null;
  await render("/portal/acme");
  await type("portal-email", "recipient@tests.invalid");
  await click("Forgot your password?");
  expect(f.reset).toHaveBeenCalledWith("recipient@tests.invalid", {
    redirectTo: "https://paigeagent.ai/reset-password?portal=acme",
  });
});
