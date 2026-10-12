// PC-1 — the ONE factory for per-request isolated browse contexts (§18 one home).
//
// ISOLATION CONTRACT (proven by smoke-isolation.mjs):
//   • every call creates a FRESH browser.newContext() — cookies, localStorage, sessionStorage,
//     service workers and cache live in that context's in-memory storage ONLY and die with it;
//   • storageState is NEVER passed and storage is NEVER copied between contexts, so two requests
//     (same tenant or different tenants — the host is tenant-blind §9/§34) cannot observe each
//     other's page state;
//   • the caller MUST close the context in a finally (server.js does; the smoke asserts it).
//
// `proxy` routes every network dial from the context through the loopback egress proxy
// (egress-proxy.mjs) so connections are pinned to guard-validated addresses (#138 closure).
// `installFences` exists ONLY so the isolation smoke can drive this factory against a local test
// origin (the read-only egress fence refuses private hosts — which is exactly the point). The
// server always passes true; smoke-isolation.mjs pins that fact against server.js source.
import { installReadOnlyBrowserEgress } from "./ssrf-guard.mjs";

export async function createIsolatedBrowseContext(browser, { viewport, userAgent, proxy, installFences = true } = {}) {
  const ctx = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(proxy ? { proxy } : {}),
    serviceWorkers: "block",
  });
  if (installFences) await installReadOnlyBrowserEgress(ctx);
  return ctx;
}
