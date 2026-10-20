/**
 * Host split: marketing on the apex, the product on app.paigeagent.ai.
 *
 * GHL-style: paigeagent.ai is the storefront (landing, pricing, legal); the
 * authenticated product AND all auth flows live on app.paigeagent.ai so the
 * Supabase session is born on the same origin the app runs on. Public,
 * tenant-facing routes (/book, /store, growth pages) stay reachable on both
 * hosts — they're shown to a coach's clients, never behind app login.
 *
 * DORMANT until the subdomain is live. Redirecting to a host that doesn't
 * resolve yet would break navigation, so nothing here acts until
 * HOST_SPLIT_ENABLED is flipped true (after app.paigeagent.ai resolves in
 * Vercel and app.* is added to Supabase Auth + Google OAuth redirect URLs).
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PAIGE_APP_ORIGIN } from "../../supabase/functions/_shared/canonical-app-url";

export const MARKETING_HOST = "paigeagent.ai";
export const APP_HOST = "app.paigeagent.ai";
export const TENANT_HOST_SUFFIX = `.${MARKETING_HOST}`;

/** Infrastructure and platform labels must never resolve as tenant identities. */
export const RESERVED_TENANT_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "auth", "mail", "notify", "status", "support",
  "cdn", "assets", "static", "docs", "blog", "mcp", "studio", "staging", "preview",
  "operator", "dashboard", "setup",
]);

/**
 * Extract a single-label tenant slug from <slug>.paigeagent.ai.
 *
 * This is routing context, not authorization: PortalGateway still resolves the
 * tenant through the server-owned slug contract and its existing tenant gates.
 */
export function tenantSlugFromHostname(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "").split(":")[0];
  if (!normalized.endsWith(TENANT_HOST_SUFFIX)) return null;

  const label = normalized.slice(0, -TENANT_HOST_SUFFIX.length);
  if (!label || label.includes(".") || RESERVED_TENANT_SUBDOMAINS.has(label)) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  return label;
}

/**
 * Whether the Supabase client may adopt a session from the page URL (an OAuth, magic-link or recovery
 * callback). Never on a tenant host: sessions are born only on the app origin, so tokens that arrive at
 * `<slug>.paigeagent.ai` are ignored, not adopted. Every other host keeps supabase-js's default (true).
 */
export function detectsSessionFromUrl(hostname: string): boolean {
  return tenantSlugFromHostname(hostname) === null;
}

/**
 * The URL parameters supabase-js reads as an auth callback (hash or query): the grant's tokens and
 * errors, plus `sb_flow_id`, the PKCE flow id auth-js reads and deletes alongside them.
 */
export const AUTH_CALLBACK_PARAMS: ReadonlySet<string> = new Set([
  "access_token", "refresh_token", "provider_token", "provider_refresh_token", "expires_at",
  "expires_in", "token_type", "type", "code", "error", "error_code", "error_description", "sb_flow_id",
]);

/**
 * Drop auth-callback parameters from a `?query` or `#fragment`, keeping every other segment byte for
 * byte. Keys are decoded exactly as supabase-js decodes them (URLSearchParams), so an encoded key such
 * as `access%5Ftoken` is still recognised. A part with no auth parameter is returned unchanged.
 */
export function stripAuthCallbackParams(part: string): string {
  const prefix = part[0];
  if (prefix !== "?" && prefix !== "#") return part;
  const segments = part.slice(1).split("&");
  const kept = segments.filter((segment) => {
    const key = new URLSearchParams(segment).keys().next().value;
    return key === undefined || !AUTH_CALLBACK_PARAMS.has(key);
  });
  if (kept.length === segments.length) return part;
  const rest = kept.filter((segment) => segment !== "").join("&");
  return rest ? `${prefix}${rest}` : "";
}

/**
 * On a tenant host, the same-origin URL (path, query, hash) with every auth-callback parameter removed —
 * or null when the host is not a tenant host or nothing needs removing. Pure; used for the in-place
 * clean-up that runs whether or not `computeTenantHostRedirect` redirects.
 */
export function tenantHostUrlWithoutAuthParams(
  hostname: string,
  path: string,
  search: string,
  hash: string,
): string | null {
  if (tenantSlugFromHostname(hostname) === null) return null;
  const cleanSearch = stripAuthCallbackParams(search);
  const cleanHash = stripAuthCallbackParams(hash);
  if (cleanSearch === search && cleanHash === hash) return null;
  return `${path}${cleanSearch}${cleanHash}`;
}

/**
 * Remove auth-callback parameters from the address bar on a tenant host, in place (history.replaceState,
 * no navigation, history state kept). Called once while the Supabase client module is evaluated, so it
 * runs before any app module that reads the full URL (the inline Plausible loader in index.html runs
 * earlier and is not covered). Returns whether the URL changed. App origin and every other non-tenant
 * host: untouched.
 *
 * The replacement is handed over as a full URL on the page's own origin, never a relative one: a path
 * that begins with `//` (`https://acme.paigeagent.ai//evil.example/x`) would otherwise be read as a
 * protocol-relative address on another site, and replaceState would throw while this module loads,
 * stopping the whole app from starting. Prefixing the origin keeps that path byte for byte on this
 * origin. Any failure is logged and swallowed: a clean-up must never block start (§32).
 */
export function scrubTenantHostAuthParams(win: Window | undefined = typeof window !== "undefined" ? window : undefined): boolean {
  if (!win) return false;
  try {
    const { hostname, origin, pathname, search, hash } = win.location;
    const target = tenantHostUrlWithoutAuthParams(hostname, pathname, search, hash);
    if (target === null) return false;
    win.history.replaceState(win.history.state, "", `${origin}${target}`);
    return true;
  } catch (error) {
    console.error("[hostRouting] could not remove auth parameters from the tenant host's address bar", error);
    return false;
  }
}

/** Canonicalize a tenant wildcard host to that tenant\'s one public portal. */
export function computeTenantHostRedirect(
  hostname: string,
  path: string,
  search: string,
  hash: string,
): string | null {
  const slug = tenantSlugFromHostname(hostname);
  if (!slug) return null;

  const canonicalPortal = `/portal/${encodeURIComponent(slug)}`;
  // Auth tokens are never carried into the tenant host's canonical URL; everything else is.
  const withLocation = (target: string) =>
    `${target}${stripAuthCallbackParams(search)}${stripAuthCallbackParams(hash)}`;
  if (path === "/") return withLocation(canonicalPortal);

  // These public routes use opaque booking/form tokens, not tenant slugs. They
  // remain available on a tenant host and still resolve their tenant server-side.
  if (/^\/(?:book(?:\/|$)|booking\/manage(?:\/|$)|form\/[^/]+\/?$|unsubscribe(?:\/|$)|u\/[^/]+\/?$)/.test(path)) {
    return null;
  }

  // Routes whose first segment after the prefix is a tenant slug are always
  // pinned to the hostname tenant. A wildcard host is routing context—not auth.
  const tenantPath = path.match(/^\/(portal|store|p|f)\/([^/]+)(\/.*)?$/);
  if (tenantPath) {
    let routeSlug = "";
    try { routeSlug = decodeURIComponent(tenantPath[2]).toLowerCase(); } catch { /* fail closed */ }
    if (routeSlug === slug) return null;
    return withLocation(`/${tenantPath[1]}/${encodeURIComponent(slug)}${tenantPath[3] ?? ""}`);
  }

  // A tenant host is a deliberately narrow public surface. Product, auth,
  // operator, marketing, and unknown routes fail closed to its canonical portal.
  return withLocation(canonicalPortal);
}

// Flip to true once app.paigeagent.ai is live + auth redirect URLs updated.
// TEMPORARILY REVERTED TO DORMANT: activating this before app.paigeagent.ai
// resolves and app.* is registered in Supabase Auth + Google OAuth redirect
// URLs breaks navigation — on the app host every in-app nav to "/" was 301'd to
// /auth (logo/"back to home" loop) and privileged routes could bounce toward a host
// that isn't wired yet, locking the operator out of the God console. Re-enable
// only as a deliberate cutover once those preconditions are confirmed live.
export const HOST_SPLIT_ENABLED = false;

// Routes that belong on app.paigeagent.ai (product + auth). Hit on the apex → 301.
const APP_PREFIXES = [
  "/auth", "/operator", "/join-platform", "/signup", "/reset-password",
  "/accept-invite", "/join/", "/mcp/authorize", "/app", "/dashboard",
  "/solo", "/business", "/agency", "/onboard", "/broker/app", "/workspace",
];

// Marketing-only routes. Hit on the app host → send back to the apex (canonical).
const MARKETING_ONLY_PREFIXES = [
  "/pricing", "/about", "/blog", "/terms", "/privacy", "/legal", "/affiliates",
];

// Prefix match on path segments: "/app" matches "/app" and "/app/x", not "/appt".
function matches(path: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return path.startsWith(prefix);
  return path === prefix || path.startsWith(prefix + "/");
}

export function isAppRoute(path: string): boolean {
  return APP_PREFIXES.some((p) => matches(path, p));
}
export function isMarketingOnlyRoute(path: string): boolean {
  return MARKETING_ONLY_PREFIXES.some((p) => matches(path, p));
}

/**
 * The absolute URL to redirect to, or null to stay put. Pure so it's testable.
 * No-ops on any host other than the two production hosts (localhost, Vercel
 * previews, custom tenant domains) so dev/preview builds are never redirected.
 */
export function computeHostRedirect(hostname: string, path: string, search: string, hash: string): string | null {
  const tenantTarget = computeTenantHostRedirect(hostname, path, search, hash);
  if (tenantTarget) return tenantTarget;
  if (!HOST_SPLIT_ENABLED) return null;
  const onApex = hostname === MARKETING_HOST || hostname === `www.${MARKETING_HOST}`;
  const onApp = hostname === APP_HOST;
  if (!onApex && !onApp) return null;

  if (onApex && isAppRoute(path)) {
    return `https://${APP_HOST}${path}${search}${hash}`;
  }
  if (onApp) {
    if (path === "/") return `https://${APP_HOST}/auth`; // bare app host → login
    if (isMarketingOnlyRoute(path)) return `https://${MARKETING_HOST}${path}${search}${hash}`;
  }
  return null;
}

/**
 * Build a link to an app route. While the split is off, returns a relative path
 * (same behavior as today); once on, returns an absolute app-host URL so
 * marketing CTAs jump straight to app.paigeagent.ai without a double hop.
 */
export function appUrl(path: string): string {
  return HOST_SPLIT_ENABLED ? `https://${APP_HOST}${path}` : path;
}
export function marketingUrl(path: string): string {
  return HOST_SPLIT_ENABLED ? `https://${MARKETING_HOST}${path}` : path;
}

/**
 * The configured app origin: where sign-in, the Supabase session (localStorage is per origin) and the
 * signed-in client portal live. It comes from the canonical constant, never from the request's host.
 */
export function configuredAppOrigin(): string {
  return HOST_SPLIT_ENABLED ? `https://${APP_HOST}` : PAIGE_APP_ORIGIN;
}

const TRUSTED_APP_HOSTS = new Set([MARKETING_HOST, `www.${MARKETING_HOST}`, APP_HOST]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin for an absolute address that SENDS a person somewhere (a password-reset email, a
 * tenant-host sign-in link). A trusted production app host over https, or local development, keeps
 * its own origin — unchanged. Every other hostname — a tenant wildcard host, a preview, an unknown or
 * hostile Host — resolves to the configured app origin, so the hostname can never pick the target.
 */
export function trustedAppOrigin(location: { hostname: string; origin: string; protocol: string }): string {
  const hostname = location.hostname.trim().toLowerCase();
  if (TRUSTED_APP_HOSTS.has(hostname) && location.protocol === "https:") return location.origin;
  if (LOOPBACK_HOSTS.has(hostname)) return location.origin;
  return configuredAppOrigin();
}

/**
 * On `<slug>.paigeagent.ai`, the one sign-in link: that tenant's gateway on the app origin, pinned to
 * the hostname tenant. Null on any non-tenant host. The tenant host itself never signs anyone in.
 */
export function tenantHostPortalEntryUrl(hostname: string): string | null {
  const slug = tenantSlugFromHostname(hostname);
  return slug ? `${configuredAppOrigin()}/portal/${encodeURIComponent(slug)}` : null;
}

/** Watches the location and cross-navigates to the canonical host when needed. */
export function useHostRouting(): void {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    const target = computeHostRedirect(window.location.hostname, pathname, search, hash);
    if (target) window.location.replace(target);
  }, [pathname, search, hash]);
}
