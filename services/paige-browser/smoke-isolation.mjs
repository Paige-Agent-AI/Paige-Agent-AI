// PC-1 smoke — per-request browser-context ISOLATION proof (cross-request and, because the host is
// tenant-blind §9/§34, cross-tenant by the same mechanism).
//
// Legs:
//  A. BEHAVIORAL: two contexts from the REAL factory (browse-context.mjs); context 1 stores a
//     non-guessable marker (cookie + localStorage) on a local test origin; context 2 must see NONE
//     of it. The factory is driven with installFences:false ONLY because the read-only egress fence
//     refuses private hosts (which is itself proven by leg C); the server always passes fences on —
//     pinned by leg D's source assertions.
//  B. COUNTERFACTUAL (the check bites): a context that DOES inherit storage state (raw Playwright
//     storageState) shows the marker — proving the probe detects real leakage, so leg A passing is
//     meaningful, not vacuous.
//  C. FENCE-ON: the factory with installFences:true cannot even reach the private test origin.
//  D. SOURCE CONTRACTS: server.js routes browse through the factory + egress proxy, never passes
//     installFences:false, never passes storageState, and closes contexts in a finally.
import http from "node:http";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { createIsolatedBrowseContext } from "./browse-context.mjs";

const fail = (msg) => { console.error(`[smoke-isolation] FAIL: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`[smoke-isolation] ok: ${msg}`);

// Local test origin (private by construction — exactly what the fence must refuse).
const MARKER = `iso_${crypto.randomBytes(12).toString("hex")}`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/seed")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><script>
      document.cookie = "iso_marker=${MARKER}; path=/";
      localStorage.setItem("iso_marker", "${MARKER}");
      document.title = "stored";
    </script>stored</body></html>`);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><script>
      document.title = JSON.stringify({ cookie: document.cookie || "", ls: localStorage.getItem("iso_marker") || "" });
    </script>probe</body></html>`);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  // Leg A — isolation through the REAL factory.
  {
    const ctx1 = await createIsolatedBrowseContext(browser, { installFences: false });
    const p1 = await ctx1.newPage();
    await p1.goto(`${ORIGIN}/seed`, { waitUntil: "load" });
    if ((await p1.title()) !== "stored") fail(`seed page did not store (title=${await p1.title()})`);
    await ctx1.close();

    const ctx2 = await createIsolatedBrowseContext(browser, { installFences: false });
    const p2 = await ctx2.newPage();
    await p2.goto(`${ORIGIN}/probe`, { waitUntil: "load" });
    const seen = JSON.parse((await p2.title()) || "{}");
    if (String(seen.cookie || "").includes(MARKER)) fail(`cookie LEAKED across contexts: ${seen.cookie}`);
    if (String(seen.ls || "").includes(MARKER)) fail(`localStorage LEAKED across contexts: ${seen.ls}`);
    if ((seen.cookie || "") !== "" || (seen.ls || "") !== "") fail(`unexpected state in fresh context: ${JSON.stringify(seen)}`);
    await ctx2.close();
    ok("leg A: a second factory context sees NONE of the first context's cookie/localStorage");
  }

  // Leg B — counterfactual: identical probe DOES see the marker when storage state is inherited.
  {
    const ctxA = await browser.newContext();
    const pA = await ctxA.newPage();
    await pA.goto(`${ORIGIN}/seed`, { waitUntil: "load" });
    const state = await ctxA.storageState();
    await ctxA.close();

    const ctxB = await browser.newContext({ storageState: state });
    const pB = await ctxB.newPage();
    await pB.goto(`${ORIGIN}/probe`, { waitUntil: "load" });
    const seen = JSON.parse((await pB.title()) || "{}");
    if (!String(seen.cookie || "").includes(MARKER) && !String(seen.ls || "").includes(MARKER)) {
      fail(`counterfactual did NOT leak — the probe cannot detect leakage, leg A is vacuous`);
    }
    await ctxB.close();
    ok("leg B: the same probe DOES see the marker when storageState is inherited (check bites)");
  }

  // Leg C — fence-on: the factory's read-only egress fence refuses the private test origin outright.
  {
    const ctx = await createIsolatedBrowseContext(browser, { installFences: true });
    const page = await ctx.newPage();
    let reached = false;
    try {
      const resp = await page.goto(`${ORIGIN}/seed`, { waitUntil: "load", timeout: 8000 });
      reached = !!resp;
    } catch { /* refused — expected */ }
    const titleAfter = await page.title().catch(() => "");
    if (reached || titleAfter === "stored") fail("fence-ON context REACHED a private origin");
    await ctx.close();
    ok("leg C: factory with installFences:true cannot reach a private origin");
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

// Leg D — source contracts (the shipped server really does route browse the proven way).
{
  const serverSrc = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const factorySrc = readFileSync(new URL("./browse-context.mjs", import.meta.url), "utf8");
  if (/installFences\s*:\s*false/.test(serverSrc)) fail("server.js passes installFences:false somewhere — fences are NOT optional in the server");
  if (/storageState\s*:/.test(factorySrc)) fail("browse-context.mjs passes a storageState option — the factory must never inherit state");
  if (!/createIsolatedBrowseContext\(browser, \{/.test(serverSrc)) fail("server.js browse path no longer uses the factory");
  if (!/proxy:\s*egressProxy \? \{ server: egressProxy\.serverUrl \} : null/.test(serverSrc)) fail("server.js browse contexts are not routed through the egress proxy");
  if (!/egress_proxy_unavailable/.test(serverSrc)) fail("server.js missing the fail-closed 503 when the egress proxy is down");
  if (!/if \(ctx\) await ctx\.close\(\)\.catch\(\(\) => \{\}\);/.test(serverSrc)) fail("server.js no longer closes browse contexts in a finally");
  if (!/browser\.newContext\(/.test(factorySrc)) fail("factory no longer creates a fresh context per call");
  ok("leg D: server.js + factory source contracts hold (fences always on, no storageState, proxy wired, fail-closed 503, finally-close)");
}

console.log("[smoke-isolation] PASS — per-request context isolation proven (legs A-D)");
