// paige-browser /render smoke (§32 — a green build is NOT a working capture).
//
// Runs the REAL ./render.mjs (validateRenderRequest + renderCapture — the code server.js calls), not a
// mirror. Chromium is real; the "Paige app origin" is a public IP literal whose responses a test
// receiver fulfills, so no outbound network or DNS is needed and the production egress fence still
// decides FIRST on every request (receivers are registered before the fence, exactly as in
// smoke-readonly-egress.mjs).
//
// Proves:
//   1. page mode — the payload reaches the /render-frame document (it sizes the page from it), the
//      ready marker is honoured, full-page capture comes back as JPEG slices of the right geometry.
//   2. the payload is NOT injected into a third-party child frame (a draft must not leak to an embed).
//   3. mobile preset — 390px wide, touch + mobile UA visible to the page.
//   4. the slice cap truncates honestly (truncated:true, never a pretend-complete capture).
//   5. url mode — allowlisted origin renders; the [data-app-ready] default ready selector works.
//   6. honest failures — not_ready, http_404, off-origin redirect: ok:false, a reason, NO image.
//   7. refusals — origin outside the allowlist, a private host even when allowlisted, payload over the
//      cap, unknown viewport, both/neither targets.
//
// Run:  node smoke-render.mjs   (or: npm run smoke:render)
import { chromium } from "playwright";
import { renderConfig, validateRenderRequest, renderCapture } from "./render.mjs";

const ORIGIN = "https://93.184.216.34";      // stands in for https://paigeagent.ai
const THIRD_PARTY = "https://93.184.216.35";  // stands in for a media embed host

let fails = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`ok  ${label}`);
  else { fails++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

const FRAME_HTML = `<!doctype html><html><head><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font:16px system-ui">
<div id="root"></div>
<iframe id="embed" src="${THIRD_PARTY}/embed" style="position:absolute;top:0;right:0;width:300px;height:100px;border:0"></iframe>
<script>
  const p = window.__PAIGE_RENDER_PAYLOAD__;
  const root = document.getElementById("root");
  if (!p) { root.textContent = "nothing to render"; }
  else {
    for (const b of p.blocks) {
      const s = document.createElement("section");
      s.style.height = "1000px";
      s.style.background = b.color || "#334";
      s.textContent = b.title || "";
      root.appendChild(s);
    }
    document.body.dataset.touch = String(navigator.maxTouchPoints > 0);
    document.body.dataset.mobileUa = String(/Mobile/.test(navigator.userAgent));
  }
  document.fonts.ready.then(() => root.setAttribute("data-render-ready", "true"));
</script></body></html>`;

const EMBED_HTML = `<!doctype html><body><script>
  window.__sawPayload = typeof window.__PAIGE_RENDER_PAYLOAD__ !== "undefined";
</script>embed</body>`;

const PUBLISHED_HTML = `<!doctype html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">
<div style="height:2500px;background:linear-gradient(#123,#c93)">published</div>
<div data-app-ready hidden></div></body>`;

const NEVER_READY_HTML = `<!doctype html><body><div style="height:1200px">still loading…</div></body>`;

async function instrument(ctx) {
  await ctx.route(`${THIRD_PARTY}/**`, (route) => {
    // The off-origin redirect target even carries a ready marker: only the origin re-check can stop it.
    if (new URL(route.request().url()).pathname === "/elsewhere") {
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><body><div style="height:900px">elsewhere</div><div data-app-ready hidden></div></body>` });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: EMBED_HTML });
  });
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/render-frame") return route.fulfill({ status: 200, contentType: "text/html", body: FRAME_HTML });
    if (pathname === "/p/demo/home") return route.fulfill({ status: 200, contentType: "text/html", body: PUBLISHED_HTML });
    if (pathname === "/p/demo/slow") return route.fulfill({ status: 200, contentType: "text/html", body: NEVER_READY_HTML });
    // A client-side redirect lands AFTER page.goto resolves (a fulfilled 30x cannot be driven in this
    // sandbox — Chromium resets it), so it is the stricter case for the origin re-check anyway.
    if (pathname === "/p/demo/away") return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><script>setTimeout(() => location.replace("${THIRD_PARTY}/elsewhere"), 50)</script>` });
    return route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html>not found" });
  });
}

const isJpeg = (b64) => {
  const b = Buffer.from(b64, "base64");
  return b.length > 500 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
};
const jpegSize = (b64) => {
  // Walk the JPEG markers to the SOF0/SOF2 frame header and read height/width.
  const b = Buffer.from(b64, "base64");
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc2) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
};

const cfg = renderConfig({
  PAIGE_RENDER_ALLOWED_ORIGINS: `${ORIGIN},https://127.0.0.1`,
  PAIGE_APP_ORIGIN: ORIGIN,
  PAIGE_RENDER_READY_TIMEOUT_MS: "2500",
});
const blocks = (n) => Array.from({ length: n }, (_, i) => ({ type: "hero", title: `Section ${i + 1}`, color: i % 2 ? "#223" : "#552" }));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  // ── 1 + 2: page mode, desktop ─────────────────────────────────────────────────────────────────
  const req = await validateRenderRequest({ page: { blocks: blocks(4), theme: { primary: "#123456" }, tenant_name: "Demo Co", extra: "dropped" } }, cfg);
  check("page request validates", req.ok, JSON.stringify(req));
  check("only known payload fields cross into the browser", req.ok && !("extra" in req.payload) && req.payload.tenant_name === "Demo Co");
  let embedSaw = null;
  const r1 = await renderCapture(browser, req, cfg, {
    instrumentContext: instrument,
    onPage: async (page) => {
      const embed = page.frames().find((f) => f.url().startsWith(THIRD_PARTY));
      embedSaw = embed ? await embed.evaluate(() => window.__sawPayload) : "no-embed-frame";
    },
  });
  check("page mode ok", r1.ok === true, JSON.stringify({ ...r1, slices: undefined }));
  check("payload sized the page (4 blocks x 1000px)", r1.full_height === 4000, `full_height=${r1.full_height}`);
  check("desktop width 1440", r1.width === 1440);
  check("three slices at y 0/1600/3200", JSON.stringify((r1.slices || []).map((s) => [s.y, s.height])) === "[[0,1600],[1600,1600],[3200,800]]",
    JSON.stringify((r1.slices || []).map((s) => [s.y, s.height])));
  check("every slice is a real JPEG", (r1.slices || []).length === 3 && r1.slices.every((s) => isJpeg(s.jpeg_base64)));
  const d0 = r1.slices?.[0] && jpegSize(r1.slices[0].jpeg_base64);
  const d2 = r1.slices?.[2] && jpegSize(r1.slices[2].jpeg_base64);
  check("slice pixels match CSS px at DPR 1", d0?.width === 1440 && d0?.height === 1600 && d2?.height === 800, JSON.stringify({ d0, d2 }));
  check("not truncated", r1.truncated === false);
  check("draft payload NOT visible to a third-party child frame", embedSaw === false, `embed saw=${embedSaw}`);
  const total = (r1.slices || []).reduce((n, s) => n + s.jpeg_base64.length, 0);
  console.log(`    (3 desktop slices, ${(total / 1024).toFixed(0)} KB base64 total)`);

  // ── 3: mobile preset ──────────────────────────────────────────────────────────────────────────
  const reqM = await validateRenderRequest({ page: { blocks: blocks(1) }, viewport: "mobile" }, cfg);
  let mobileFlags = null;
  const r3 = await renderCapture(browser, reqM, cfg, {
    instrumentContext: instrument,
    onPage: async (page) => { mobileFlags = await page.evaluate(() => ({ ...document.body.dataset })); },
  });
  check("mobile ok, 390 wide, one slice", r3.ok && r3.width === 390 && r3.slices.length === 1 && jpegSize(r3.slices[0].jpeg_base64)?.width === 390,
    JSON.stringify({ ...r3, slices: r3.slices?.length }));
  check("mobile preset is touch + mobile UA", mobileFlags?.touch === "true" && mobileFlags?.mobileUa === "true", JSON.stringify(mobileFlags));

  // ── 4: slice cap truncates honestly ───────────────────────────────────────────────────────────
  const capped = { ...cfg, maxSlices: 2 };
  const r4 = await renderCapture(browser, await validateRenderRequest({ page: { blocks: blocks(5) } }, capped), capped, { instrumentContext: instrument });
  check("slice cap: 2 slices, truncated:true, full_height still reported", r4.ok && r4.slices.length === 2 && r4.truncated === true && r4.full_height === 5000,
    JSON.stringify({ ...r4, slices: r4.slices?.length }));

  // ── 5: url mode ───────────────────────────────────────────────────────────────────────────────
  const r5 = await renderCapture(browser, await validateRenderRequest({ url: `${ORIGIN}/p/demo/home`, viewport: "tablet" }, cfg), cfg, { instrumentContext: instrument });
  check("url mode ok via [data-app-ready], tablet 834, two slices", r5.ok && r5.width === 834 && r5.full_height === 2500 && r5.slices.length === 2,
    JSON.stringify({ ...r5, slices: r5.slices?.length }));

  // ── 6: honest failures carry a reason and no image ────────────────────────────────────────────
  for (const [label, path, reason] of [["never ready", "/p/demo/slow", "not_ready"], ["404", "/p/demo/missing", "http_404"], ["off-origin redirect", "/p/demo/away", "blocked_redirect"]]) {
    const r = await renderCapture(browser, await validateRenderRequest({ url: `${ORIGIN}${path}` }, cfg), cfg, { instrumentContext: instrument });
    check(`${label}: ok:false, reason ${reason}, no slices`, r.ok === false && r.reason === reason && !("slices" in r), JSON.stringify({ ...r, slices: r.slices?.length }));
  }

  // ── 7: refusals before the browser is touched ─────────────────────────────────────────────────
  const refusals = [
    ["origin outside allowlist", { url: "https://example.com/p/x/y" }, 403, "origin_not_allowed"],
    ["private host even when allowlisted", { url: "https://127.0.0.1/p/x/y" }, 400, "blocked:ssrf:loopback"],
    ["credentials in url", { url: `https://u:p@93.184.216.34/p/x` }, 400, "invalid_url"],
    ["both targets", { url: `${ORIGIN}/p/x`, page: { blocks: [] } }, 400, "bad_request"],
    ["neither target", {}, 400, "bad_request"],
    ["unknown viewport", { page: { blocks: [] }, viewport: "watch" }, 400, "invalid_viewport"],
    ["blocks not an array", { page: { blocks: "x" } }, 400, "invalid_page"],
    ["payload over the cap", { page: { blocks: [{ type: "rich_text", html: "x".repeat(cfg.maxPayloadBytes) }] } }, 413, "payload_too_large"],
  ];
  for (const [label, body, status, reason] of refusals) {
    const v = await validateRenderRequest(body, cfg);
    check(`refuses ${label} (${status} ${reason})`, v.ok === false && v.status === status && v.reason === reason, JSON.stringify(v));
  }
} finally {
  await browser.close();
}

// ── 8: the HTTP route itself — the REAL server.js, its secret gate and its refusals ──────────────
// Spawned as a child (server.js listens on import). Only refusal paths are driven over HTTP: they
// return before the browser opens a page, so no outbound network is needed. The default allowlist
// (paigeagent.ai) is what the server reads — this also proves no env var is required to boot /render.
let expressAvailable = true;
try { await import("express"); } catch { expressAvailable = false; }
if (!expressAvailable) {
  // Said out loud, never a silent pass (§13): CI installs the service deps before this step.
  console.log("SKIP HTTP route checks — express is not installed (npm install --prefix services/paige-browser --omit=dev --no-package-lock)");
} else {
  const { spawn } = await import("node:child_process");
  const port = 18000 + Math.floor(Math.random() * 2000);
  const secret = "smoke-secret-" + port;
  const child = spawn(process.execPath, [new URL("./server.js", import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), PAIGE_BROWSER_SHARED_SECRET: secret, PAIGE_BROWSER_DENYLIST_PATH: "/nonexistent" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const post = (body, headers = { "X-Browser-Secret": secret }) =>
      fetch(`${base}/render`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const noSecret = await post({ url: "https://paigeagent.ai/p/x/y" }, {});
    check("HTTP /render without the secret → 401", noSecret.status === 401, `status=${noSecret.status}`);
    const foreign = await post({ url: "https://example.com/" });
    const fj = await foreign.json();
    check("HTTP /render foreign origin → 403 origin_not_allowed (default allowlist)", foreign.status === 403 && fj.reason === "origin_not_allowed", JSON.stringify(fj));
    const badVp = await post({ page: { blocks: [] }, viewport: "watch" });
    check("HTTP /render bad viewport → 400 invalid_viewport", badVp.status === 400 && (await badVp.json()).reason === "invalid_viewport");
    const health = await fetch(`${base}/healthz`);
    check("HTTP /healthz still 200 with /render mounted", health.status === 200);
  } finally {
    child.kill("SIGTERM");
  }
}

if (fails) { console.error(`\n✗ ${fails} /render check(s) failed`); process.exit(1); }
console.log("\n✓✓ paige-browser /render captures Paige pages as honest full-page JPEG slices.");
