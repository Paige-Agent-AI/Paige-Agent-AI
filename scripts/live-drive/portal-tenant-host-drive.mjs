#!/usr/bin/env node
/**
 * E09 Slice H — tenant-host public entry vs the app-origin gateway (decision D5).
 *
 * Serves the real PortalGateway + real host routing (harness/portal-tenant-host) and maps
 * `acme.paigeagent.ai` and `evil.example` to loopback in Chromium, so `window.location.hostname` is
 * exactly what a visitor's browser would report. Every case is "signed in" in the adapter, so the
 * drive proves the tenant host never reads that session, never loops and never collects a password.
 *
 * Measures before it frames: no horizontal overflow, the link-out target height, AA contrast of every
 * text node against its painted background, fonts loaded (document.fonts.ready + check). The label
 * "harness render · not live" is burned in only after the measurements. Not authenticated production proof.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { buildLaunchOptions } from "./live-drive.mjs";

const PORT = 5236;
const OUT = path.resolve(process.env.FRAMES_OUT || "scripts/live-drive/artifacts/portal-tenant-host");
const VIEWPORTS = [[390, 844], [1440, 900]];
const THEMES = ["light", "dark"];
const TENANT = `http://acme.paigeagent.ai:${PORT}`;
const HOSTILE = `http://evil.example:${PORT}`;
const APP = `http://127.0.0.1:${PORT}`;
const results = [];
const record = (name, ok, detail = null) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ""}`);
};

const waitForPort = () => new Promise((resolve, reject) => {
  const started = Date.now();
  const probe = () => {
    const socket = net.createConnection(PORT, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", () => { socket.destroy(); if (Date.now() - started > 60_000) reject(new Error("harness did not start")); else setTimeout(probe, 150); });
  };
  probe();
});

function launchOptions() {
  const base = buildLaunchOptions();
  const args = [...base.args, "--host-resolver-rules=MAP acme.paigeagent.ai 127.0.0.1, MAP evil.example 127.0.0.1"];
  const proxy = base.proxy ? { ...base.proxy, bypass: `${base.proxy.bypass},acme.paigeagent.ai,evil.example` } : undefined;
  return { ...base, args, ...(proxy ? { proxy } : {}) };
}

/** AA over every visible text node, against the nearest opaque painted background. */
async function measure(page) {
  return page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean); return [+r, +g, +b, +a]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.95) return c; } return parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1]; };
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement; const s = t.textContent?.trim(); if (!el || !s) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const fg = parse(getComputedStyle(el).color); const bg = bgOf(el); if (!fg) continue;
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(getComputedStyle(el).fontSize); const large = size >= 24 || (size >= 18.66 && +getComputedStyle(el).fontWeight >= 700);
      texts.push({ s: s.slice(0, 40), ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5 });
    }
    const link = document.querySelector("a[data-portal-entry]");
    const lr = link?.getBoundingClientRect();
    return {
      path: location.pathname,
      href: link?.getAttribute("href") ?? null,
      linkHeight: lr ? Math.round(lr.height) : null,
      password: Boolean(document.querySelector("input[type=password]")),
      signedInSurface: Boolean(document.querySelector("[data-signed-in-surface]")),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      text: document.body.innerText,
      lowContrast: texts.filter((x) => x.ratio < x.need),
      minRatio: texts.length ? Math.min(...texts.map((x) => x.ratio)) : null,
      harness: window.__harness,
    };
  });
}

async function burnLabel(page, label) {
  await page.evaluate((text) => {
    const tag = document.createElement("div");
    tag.id = "harness-label"; tag.textContent = text;
    Object.assign(tag.style, { position: "fixed", left: "8px", bottom: "8px", zIndex: "2147483647", font: "12px/1.4 monospace", padding: "4px 8px", background: "#111", color: "#fff", borderRadius: "4px" });
    document.body.append(tag);
  }, label);
  const h = await page.locator("#harness-label").evaluate((el) => el.getBoundingClientRect().height);
  if (!(h > 0)) throw new Error("refusing to write an unlabelled frame");
}

fs.mkdirSync(OUT, { recursive: true });
let server, browser;
try {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/portal-tenant-host/vite.config.ts", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  await waitForPort();
  browser = await chromium.launch(launchOptions());

  const open = async (url, viewport = { width: 1440, height: 900 }) => {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    return { context, page, errors };
  };

  // Frames: tenant-host public entry and the unchanged app-origin gateway, both themes, phone + desktop.
  for (const theme of THEMES) {
    for (const [width, height] of VIEWPORTS) {
      for (const [kind, url] of [["tenant-host", `${TENANT}/portal/acme?theme=${theme}`], ["app-origin", `${APP}/portal/acme?theme=${theme}&session=none`]]) {
        const label = `${kind}-${theme}-${width}x${height}`;
        const { context, page, errors } = await open(url, { width, height });
        await page.getByText("Welcome back to Northstar Advisory").waitFor({ timeout: 15_000 });
        const m = await measure(page);
        const fonts = await page.evaluate(() => ({ status: document.fonts.status, body: getComputedStyle(document.body).fontFamily.split(",")[0] }));
        record(`${label} runtime`, errors.length === 0, errors);
        record(`${label} fonts ready`, fonts.status === "loaded", fonts);
        record(`${label} no horizontal overflow`, !m.overflow);
        record(`${label} AA text contrast`, m.lowContrast.length === 0, { min: m.minRatio, low: m.lowContrast });
        if (kind === "tenant-host") {
          record(`${label} links out to the app origin`, m.href === "https://paigeagent.ai/portal/acme", m.href);
          record(`${label} 44px link-out target`, (m.linkHeight ?? 0) >= 44, m.linkHeight);
          record(`${label} no credential collected`, !m.password);
          record(`${label} names where sign-in happens`, m.text.includes("You’ll sign in securely on paigeagent.ai."));
        } else {
          record(`${label} keeps the sign-in form`, m.password && m.href === null);
        }
        await burnLabel(page, `harness render · not live   ${label}`);
        await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: false });
        await context.close();
      }
    }
  }

  // Behaviour: a signed-in visitor on the tenant host is not looped and never sees signed-in data.
  {
    const { context, page, errors } = await open(`${TENANT}/portal/acme`);
    await page.waitForTimeout(2_000);
    const m = await measure(page);
    record("tenant host: stays on /portal/acme (no loop)", m.path === "/portal/acme", m.path);
    record("tenant host: session never read", m.harness.getUser === 0, m.harness);
    record("tenant host: signed-in surface never rendered", !m.signedInSurface);
    record("tenant host: no relationship read", !m.harness.rpc.some((r) => r.startsWith("get_client_portal_brand")), m.harness.rpc);
    record("tenant host runtime", errors.length === 0, errors);
    await context.close();
  }
  // Wrong slug and an app route on the tenant host both pin to the hostname tenant.
  for (const p of ["/portal/other-business", "/app", "/auth", "/reset-password"]) {
    const { context, page } = await open(`${TENANT}${p}`);
    await page.waitForTimeout(1_500);
    const m = await measure(page);
    record(`tenant host ${p}: pinned to /portal/acme with the app-origin link`, m.path === "/portal/acme" && m.href === "https://paigeagent.ai/portal/acme" && !m.signedInSurface, { path: m.path, href: m.href });
    record(`tenant host ${p}: brand read only for the hostname tenant`, m.harness.rpc.every((r) => r === "peek_tenant_portal_brand:acme"), m.harness.rpc);
    await context.close();
  }
  // The app origin is unchanged: a signed-in customer goes straight into /app.
  {
    const { context, page } = await open(`${APP}/portal/acme`);
    await page.waitForTimeout(1_500);
    const m = await measure(page);
    record("app origin: signed-in customer enters /app", m.path === "/app" && m.signedInSurface, m.path);
    await context.close();
  }
  // Reset links: app origin keeps itself; a hostile host is sent to the configured app origin.
  for (const [name, base, expected] of [["app origin", APP, `${APP}/reset-password?portal=acme`], ["hostile host", HOSTILE, "https://paigeagent.ai/reset-password?portal=acme"]]) {
    const { context, page } = await open(`${base}/portal/acme?session=none`);
    await page.locator("#portal-email").fill("recipient@tests.invalid");
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await page.waitForTimeout(400);
    const m = await measure(page);
    record(`${name}: reset email returns to ${expected}`, m.harness.reset.length === 1 && m.harness.reset[0] === expected, m.harness.reset);
    await context.close();
  }
} catch (error) {
  record("drive completed", false, String(error?.stack ?? error));
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
  fs.writeFileSync(path.join(OUT, "report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), evidenceClass: "harness render · real PortalGateway + real host routing, deterministic adapter, hostnames mapped to loopback; not authenticated production proof", results }, null, 2)}\n`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
