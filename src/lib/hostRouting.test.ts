import { describe, expect, it } from "vitest";
import {
  HOST_SPLIT_ENABLED,
  computeHostRedirect,
  computeTenantHostRedirect,
  configuredAppOrigin,
  detectsSessionFromUrl,
  stripAuthCallbackParams,
  tenantHostPortalEntryUrl,
  tenantHostUrlWithoutAuthParams,
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

describe("auth callback parameters never ride into a tenant host's canonical URL", () => {
  const TOKENS = "access_token=at&refresh_token=rt&provider_token=pt&provider_refresh_token=prt"
    + "&expires_at=1&expires_in=3600&token_type=bearer&type=recovery";

  it("strips every auth parameter from the hash and keeps the rest byte for byte", () => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", "/x", "", `#${TOKENS}&tab=Two%20words`))
      .toBe("/portal/acme#tab=Two%20words");
  });

  it("strips code and error parameters from the query and keeps the rest", () => {
    expect(computeTenantHostRedirect(
      "acme.paigeagent.ai", "/auth", "?ref=partner&code=abc&error=x&error_code=y&error_description=z&utm=a+b", "",
    )).toBe("/portal/acme?ref=partner&utm=a+b");
  });

  it("strips from both parts on a pinned route-slug rewrite", () => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", "/portal/other", "?code=abc", `#${TOKENS}`))
      .toBe("/portal/acme");
  });

  it("recognises an encoded key exactly as supabase-js decodes it", () => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", "/", "", "#access%5Ftoken=at&keep=1"))
      .toBe("/portal/acme#keep=1");
  });

  it.each(["", "?", "#", "#welcome", "?ref=partner&x=1", "#a=1&&b=2", "?codes=1&typed=2"])(
    "leaves %j untouched when it carries no auth parameter",
    (part) => expect(stripAuthCallbackParams(part)).toBe(part),
  );

  it("strips sb_flow_id, the PKCE flow id auth-js reads, with the other auth parameters", () => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", "/", "?sb_flow_id=f1&code=abc&ref=1", ""))
      .toBe("/portal/acme?ref=1");
    expect(stripAuthCallbackParams("#sb_flow_id=f1")).toBe("");
  });

  it("does not rewrite a URL on a non-tenant host", () => {
    expect(computeTenantHostRedirect("paigeagent.ai", "/x", "?code=abc", "#access_token=at")).toBeNull();
  });

  it("turns off URL session detection on a tenant host only", () => {
    expect(detectsSessionFromUrl("acme.paigeagent.ai")).toBe(false);
    expect(detectsSessionFromUrl("Acme.PaigeAgent.ai.")).toBe(false);
  });

  it.each(["paigeagent.ai", "www.paigeagent.ai", "app.paigeagent.ai", "localhost", "preview-1.vercel.app", ""])(
    "keeps URL session detection on the non-tenant host %j exactly as today",
    (hostname) => expect(detectsSessionFromUrl(hostname)).toBe(true),
  );
});

describe("auth callback parameters are removed in place on a tenant host that is not redirected", () => {
  it.each([
    ["/portal/acme", "", "#access_token=at&refresh_token=rt&tab=1", "/portal/acme#tab=1"],
    ["/book/intro", "?code=abc&ref=partner", "", "/book/intro?ref=partner"],
    ["/form/f1", "?embed=1&sb_flow_id=f1", "#error=x&error_description=y", "/form/f1?embed=1"],
    ["/u/tok", "?type=recovery", "#token_type=bearer", "/u/tok"],
  ])("cleans %s%s%s", (path, search, hash, expected) => {
    expect(computeTenantHostRedirect("acme.paigeagent.ai", path, search, hash)).toBeNull();
    expect(tenantHostUrlWithoutAuthParams("acme.paigeagent.ai", path, search, hash)).toBe(expected);
  });

  it("returns null on a tenant host when nothing needs removing", () => {
    expect(tenantHostUrlWithoutAuthParams("acme.paigeagent.ai", "/book/intro", "?ref=1&codes=2", "#tab")).toBeNull();
  });

  it.each(["paigeagent.ai", "www.paigeagent.ai", "app.paigeagent.ai", "localhost", "preview-1.vercel.app"])(
    "never touches the non-tenant host %j",
    (hostname) => expect(tenantHostUrlWithoutAuthParams(hostname, "/auth", "?code=abc", "#access_token=at")).toBeNull(),
  );
});
