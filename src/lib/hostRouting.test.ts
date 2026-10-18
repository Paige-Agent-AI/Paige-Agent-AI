import { describe, expect, it } from "vitest";
import {
  HOST_SPLIT_ENABLED,
  computeHostRedirect,
  computeTenantHostRedirect,
  configuredAppOrigin,
  tenantHostPortalEntryUrl,
  tenantSlugFromHostname,
  trustedAppOrigin,
} from "./hostRouting";
import { PAIGE_APP_ORIGIN } from "../../supabase/functions/_shared/canonical-app-url";

describe("tenant wildcard host routing", () => {
  it("extracts a valid tenant slug case-insensitively", () => {
    expect(tenantSlugFromHostname("Acme-Coaching.paigeagent.ai")).toBe("acme-coaching");
  });

  it.each(["app", "www", "mail", "admin", "api", "operator", "dashboard", "setup"])(
    "blocks the reserved %s infrastructure label",
    (label) => expect(tenantSlugFromHostname(`${label}.paigeagent.ai`)).toBeNull(),
  );

  it.each([
    "paigeagent.ai", "www.paigeagent.ai", "too.deep.paigeagent.ai",
    "-bad.paigeagent.ai", "bad-.paigeagent.ai", "tenant.example.com",
  ])("rejects non-tenant host %s", (hostname) => {
    expect(tenantSlugFromHostname(hostname)).toBeNull();
  });

  it("routes a tenant-host root to its canonical portal", () => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", "/", "?ref=partner", "#welcome"))
      .toBe("/portal/acme?ref=partner#welcome");
  });

  it.each([
    ["/portal/other", "/portal/acme"],
    ["/portal/Other/history", "/portal/acme/history"],
    ["/store/other/items", "/store/acme/items"],
    ["/p/other/about", "/p/acme/about"],
    ["/f/other/welcome", "/f/acme/welcome"],
    ["/portal/%E0%A4%A", "/portal/acme"],
  ])("pins %s to the hostname tenant", (path, expected) => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", path, "", "")).toBe(expected);
  });

  it.each([
    "/portal/acme", "/portal/ACME/history", "/store/acme/items", "/p/acme/about", "/f/acme/welcome",
    "/book/discovery", "/booking/manage/token", "/form/form-id", "/unsubscribe/token", "/u/public-token",
  ])("allows deliberate tenant-safe public route %s", (path) => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", path, "", "")).toBeNull();
  });

  it.each([
    "/solo/1/command-center", "/auth/login", "/app", "/operator/tenants", "/dashboard",
    "/setup", "/workspace", "/pricing", "/unknown",
  ])("fails closed for sensitive or unknown route %s", (path) => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", path, "?x=1", "#top"))
      .toBe("/portal/acme?x=1#top");
  });

  it("works while the separate app-host split remains dormant", () => {
    expect(computeHostRedirect("acme.paigeagent.ai", "/", "", "")).toBe("/portal/acme");
    expect(computeHostRedirect("acme.paigeagent.ai", "/solo/1/command-center", "", "")).toBe("/portal/acme");
    expect(computeHostRedirect("paigeagent.ai", "/solo/1/command-center", "", "")).toBeNull();
  });
});

// E09 Slice H (D5): the tenant host is a public entry; sign-in, sessions and recovery live on the
// configured app origin. A tenant, unknown or hostile hostname never chooses where a person is sent.
describe("app-origin resolution for sign-in and recovery", () => {
  const at = (href: string) => {
    const u = new URL(href);
    return { hostname: u.hostname, origin: u.origin, protocol: u.protocol };
  };

  it("names the configured app origin from the canonical constant while the host split is off", () => {
    expect(HOST_SPLIT_ENABLED).toBe(false);
    expect(configuredAppOrigin()).toBe(PAIGE_APP_ORIGIN);
    expect(configuredAppOrigin()).toBe("https://paigeagent.ai");
  });

  it.each(["https://paigeagent.ai", "https://www.paigeagent.ai", "https://app.paigeagent.ai"])(
    "keeps the trusted app host %s exactly as it is today",
    (origin) => expect(trustedAppOrigin(at(`${origin}/portal/acme`))).toBe(origin),
  );

  it.each(["http://localhost:8080", "http://127.0.0.1:4173"])(
    "keeps the local development origin %s",
    (origin) => expect(trustedAppOrigin(at(`${origin}/portal/acme`))).toBe(origin),
  );

  it.each([
    "https://acme.paigeagent.ai",
    "https://evil.example",
    "https://paigeagent.ai.evil.example",
    "https://evilpaigeagent.ai",
    "https://preview-123.vercel.app",
    "http://paigeagent.ai",
  ])("sends %s to the configured app origin instead of itself", (origin) => {
    expect(trustedAppOrigin(at(`${origin}/portal/acme`))).toBe("https://paigeagent.ai");
  });

  it("builds the tenant-host sign-in link on the app origin, pinned to the hostname tenant", () => {
    expect(tenantHostPortalEntryUrl("Acme.paigeagent.ai")).toBe("https://paigeagent.ai/portal/acme");
  });

  it.each(["paigeagent.ai", "app.paigeagent.ai", "evil.example", "localhost"])(
    "has no tenant-host entry link on the non-tenant host %s",
    (hostname) => expect(tenantHostPortalEntryUrl(hostname)).toBeNull(),
  );

  it("never routes the tenant-host entry link back onto a tenant host", () => {
    const target = new URL(tenantHostPortalEntryUrl("acme.paigeagent.ai")!);
    expect(tenantSlugFromHostname(target.hostname)).toBeNull();
    expect(computeHostRedirect(target.hostname, target.pathname, "", "")).toBeNull();
  });
});
