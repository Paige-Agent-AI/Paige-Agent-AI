import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { resolvePlaywright, buildLaunchOptions } from "./live-drive.mjs";

// STRUCTURAL-RENDERED only. Actual Settings/shell/PAIGE; synthetic RPCs, no external network.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(process.env.INCOMING_DRIVE_OUTPUT ?? path.join(repo, "scripts/live-drive/artifacts/incoming-contacts"));
const report = { evidenceClass: "STRUCTURAL-RENDERED", checks: [], frames: [], consoleErrors: [],
  externalRequests: [], unverified: ["Authenticated tenant authority", "Real persistence and provider sender", "Physical touch and assistive technology", "200% browser zoom", "Remote fonts blocked in local no-network drive"] };
let server, browser, base, drivePage;
function check(name, pass, detail) {
  report.checks.push({ name, verdict: pass ? "PASS" : "FAIL", ...(detail === undefined ? {} : { detail }) });
  if (!pass) throw new Error(name);
}
async function freePort() {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
async function closedPort(origin) {
  const url = new URL(origin);
  return new Promise(resolve => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) });
    let done = false;
    const finish = verdict => { if (done) return; done = true; socket.destroy(); resolve(verdict); };
    socket.once("connect", () => finish("FAIL"));
    socket.once("error", error => finish(error.code === "ECONNREFUSED" ? "PASS" : "UNVERIFIED"));
    socket.setTimeout(1500, () => finish("UNVERIFIED"));
  });
}
async function geometry(page) {
  return page.evaluate(() => {
    const body = document.querySelector(".ig-panel-body"); const shell = document.querySelector("[data-tenant-shell]");
    return { viewport: [innerWidth, innerHeight], document: [document.documentElement.clientWidth, document.documentElement.scrollWidth,
      document.documentElement.clientHeight, document.documentElement.scrollHeight], body: [document.body.clientWidth, document.body.scrollWidth],
      shellWidth: shell.getBoundingClientRect().width, centerWidth: document.querySelector("[data-solo-screen-host]").getBoundingClientRect().width,
      paigeCount: document.querySelectorAll("#tenant-paige-workspace").length,
      scroll: body ? { height: body.clientHeight, content: body.scrollHeight, width: body.clientWidth, contentWidth: body.scrollWidth,
        gutter: body.offsetWidth - body.clientWidth, overflow: getComputedStyle(body).overflowY,
        state: body.scrollHeight > body.clientHeight + 1 ? "OVERFLOWS" : "FITS" } : null,
      theme: shell.getAttribute("data-pg"), nav: shell.getAttribute("data-nav"), paige: shell.getAttribute("data-paige") };
  });
}
async function open(page, theme = "light", mode = "incoming") {
  await page.goto(`${base}/solo/test-account-a/settings/integrations?theme=${theme}&data=${mode}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("[data-gateway-tool]").first().waitFor({ timeout: 60000 });
  if (await page.locator("[data-tenant-shell]").getAttribute("data-paige") === "open")
    await page.locator("#tenant-paige-workspace").getByRole("button", { name: "Fold PAIGE conversation", exact: true }).click();
}
async function drawer(page, expectUnconfigured = true) {
  await page.locator("[data-gateway-tool]").first().click();
  await page.getByRole("region", { name: "Incoming contacts", exact: true }).waitFor();
  if (expectUnconfigured) await page.getByRole("button", { name: "Set up incoming contacts", exact: true }).waitFor();
}
async function setup(page) {
  await page.getByRole("button", { name: "Set up incoming contacts", exact: true }).click();
  await page.locator(".ig-incoming input[type=password]").fill("synthetic-credential-only-for-local-ui-proof");
  await page.locator(".ig-incoming input[type=checkbox]").check();
}
async function inspectScroll(page, key) {
  const owner = page.locator(".ig-panel-body"); const g = await geometry(page);
  check(`${key}: no document horizontal or vertical overflow`, g.document[1] <= g.document[0] + 1 && g.document[3] <= g.document[2] + 1 && g.body[1] <= g.body[0] + 1, g);
  check(`${key}: one PAIGE`, g.paigeCount === 1);
  check(`${key}: drawer has no horizontal overflow`, g.scroll.contentWidth <= g.scroll.width + 1);
  if (g.scroll.state === "OVERFLOWS") {
    check(`${key}: visible scrollbar gutter`, g.scroll.gutter > 0 && g.scroll.overflow === "auto", g.scroll);
    await owner.focus(); await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop < 2);
    await page.keyboard.press("End");
    await page.waitForFunction(() => { const e = document.querySelector(".ig-panel-body"); return e.scrollTop + e.clientHeight >= e.scrollHeight - 2; });
    check(`${key}: End reaches terminal content`, true);
    await page.keyboard.press("Home"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop < 2);
    await page.keyboard.press("PageDown"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop > 5);
    await page.keyboard.press("Home"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop < 2);
    await page.keyboard.press("Space"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop > 5);
    await page.keyboard.press("Shift+Space"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop < 2);
    check(`${key}: Space and Shift+Space`, true);
    await page.keyboard.press("Home"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop < 2);
    await owner.hover(); await page.mouse.wheel(0, 300); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop > 5);
    check(`${key}: PageDown and wheel`, true);
    await owner.focus(); await page.keyboard.press("Home"); await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop < 2);
    const box = await owner.boundingBox();
    // Hit the measured thumb body, not its leading 20px (which can be track/arrow as the
    // native scroll animation settles). This is pointer input, never a DOM scroll assignment.
    const startY = box.y + Math.max(24, g.scroll.height * g.scroll.height / g.scroll.content / 2);
    const drag = { x: box.x + box.width - g.scroll.gutter / 2, startY, endY: box.y + box.height - 20 };
    await page.mouse.move(drag.x, drag.startY); await page.mouse.down();
    await page.mouse.move(drag.x, drag.endY, { steps: 20 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector(".ig-panel-body").scrollTop > 5);
    check(`${key}: native scrollbar drag travels`, true, { ...drag, scrollTop: await owner.evaluate(e => e.scrollTop) });
  }
  return g;
}

try {
  await fs.mkdir(output, { recursive: true });
  server = await createServer({ configFile: path.join(repo, "scripts/live-drive/harness/incoming-contacts/vite.config.ts"),
    server: { port: await freePort(), host: "127.0.0.1", strictPort: true }, logLevel: "error" });
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  report.origin = base;
  console.log(`Incoming structural drive listening at ${base}`);
  browser = await (await resolvePlaywright()).chromium.launch({ ...buildLaunchOptions(), ignoreDefaultArgs: ["--hide-scrollbars"] });
  if (process.argv.includes("--assert-cleanup-on-failure")) throw new Error("Intentional owned-server cleanup failure-path proof");
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    report.externalRequests.push({ origin: url.origin, resource: route.request().resourceType() }); return route.abort();
  });
  const page = await context.newPage(); drivePage = page; page.setDefaultTimeout(12000);
  page.on("pageerror", e => report.consoleErrors.push(e.message));
  for (const [width, height] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) for (const nav of ["expanded", "compact"]) for (const paige of ["closed", "open"]) {
      const key = `${width}x${height}-${theme}-${nav}-${paige}`;
      if (process.env.INCOMING_DRIVE_FRAME && process.env.INCOMING_DRIVE_FRAME !== key) continue;
      await open(page, theme);
      const shell = page.locator("[data-tenant-shell]");
      if (await shell.getAttribute("data-nav") !== nav) await page.getByRole("button", { name: /^(Fold|Expand) navigation$/ }).click();
      await drawer(page); await setup(page);
      // Narrow PAIGE is an intentional overlay; do not click through its backdrop. Enter the
      // drawer normally, then use the shipped shell keyboard shortcuts for the expanded matrix.
      if (paige === "open") await page.keyboard.press("Control+Backslash");
      if (await shell.getAttribute("data-nav") !== nav) await page.keyboard.press("Control+Alt+Backslash");
      const g = await inspectScroll(page, key);
      check(`${key}: requested actual shell state`, g.nav === nav && g.paige === paige && g.theme === theme, g);
      await page.getByRole("button", { name: "Enable incoming contacts", exact: true }).focus();
      check(`${key}: terminal control reachable`, await page.getByRole("button", { name: "Enable incoming contacts", exact: true }).evaluate(e => {
        const r = e.getBoundingClientRect(); return document.activeElement === e && r.top >= 0 && r.bottom <= innerHeight;
      }));
      await page.keyboard.press("Tab");
      check(`${key}: Tab wraps within drawer`, await page.locator(".ig-panel").evaluate(e => e.contains(document.activeElement)));
      await page.keyboard.press("Shift+Tab");
      check(`${key}: Shift+Tab returns to terminal control`, await page.getByRole("button", { name: "Enable incoming contacts", exact: true }).evaluate(e => document.activeElement === e));
      const motion = await page.locator(".ig-panel").evaluate(e => ({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animation: getComputedStyle(e).animationDuration, transition: getComputedStyle(e).transitionDuration,
        focusOutline: getComputedStyle(document.activeElement).outlineStyle }));
      check(`${key}: reduced motion and visible keyboard focus`, motion.reduced && motion.animation.split(",").every(v => parseFloat(v) <= 0.001)
        && motion.focusOutline !== "none", motion);
      if (nav === "expanded") await page.screenshot({ path: path.join(output, `${key}.png`) });
      report.frames.push({ key, ...g });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 }); await open(page); await drawer(page); await setup(page);
  await page.getByRole("button", { name: "Enable incoming contacts", exact: true }).click();
  await page.getByText("Saved · incoming permission confirmed.", { exact: false }).waitFor();
  check("enable shows confirmed safe presence", await page.getByText("On file · never shown", { exact: true }).isVisible());
  await page.getByRole("button", { name: "View sender setup", exact: true }).click();
  await page.getByText("Request shape · placeholders must be replaced", { exact: true }).click();
  check("sender instructions expose placeholders not credential", !(await page.locator(".ig-incoming").innerText()).includes("synthetic-credential-only"));
  await inspectScroll(page, "expanded-sender-instructions");
  await page.getByRole("button", { name: "Back to connection", exact: true }).click();
  await page.getByRole("button", { name: "Replace sync credential", exact: true }).click();
  await page.locator(".ig-incoming input[type=password]").fill("synthetic-replacement-draft-not-for-provider");
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  check("dirty close keeps credential draft", await page.locator(".ig-incoming input[type=password]").inputValue() === "synthetic-replacement-draft-not-for-provider");
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Discard them", exact: true }).click();
  await drawer(page, false);
  await page.getByRole("button", { name: "Revoke incoming access", exact: true }).click();
  await page.getByRole("button", { name: "Revoke access", exact: true }).click();
  await page.getByText("Incoming access revoked · current settings confirmed.", { exact: true }).waitFor();
  check("revoke clears safe credential presence", await page.locator(".ig-incoming").getByText("Not on file", { exact: true }).isVisible());
  await open(page, "light", "unknown"); await drawer(page); await setup(page);
  await page.getByRole("button", { name: "Enable incoming contacts", exact: true }).click();
  await page.getByRole("button", { name: "Read current settings", exact: true }).waitFor();
  check("unknown write disables a second write", await page.getByRole("button", { name: "Set up incoming contacts", exact: true }).count() === 0);
  check("unknown write preserves focus inside drawer", await page.locator(".ig-panel").evaluate(e => e.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  check("Escape returns focus to the same connection", await page.locator("[data-gateway-tool]").first().evaluate(e => document.activeElement === e));
  await page.locator("[data-gateway-tool]").first().click();
  await page.getByRole("button", { name: "Read current settings", exact: true }).waitFor(); check("uncertainty survives reopen", true);
  await open(page, "light", "readfail"); await page.locator("[data-gateway-tool]").first().click();
  await page.getByRole("button", { name: "Retry reading settings", exact: true }).waitFor();
  check("unavailable read offers no permission action", await page.getByRole("button", { name: "Set up incoming contacts", exact: true }).count() === 0);
  await open(page, "light", "forbidden");
  check("permission denied does not offer incoming creation", await page.getByRole("button", { name: "Add incoming contacts connection", exact: true }).count() === 0);
  await open(page, "light", "unknown");
  await page.getByRole("button", { name: "Add incoming contacts connection", exact: true }).click();
  await page.getByRole("textbox", { name: "Connection name", exact: true }).fill("Test source draft");
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  check("dirty creation keeps source name", await page.getByRole("textbox", { name: "Connection name", exact: true }).inputValue() === "Test source draft");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.getByRole("heading", { name: "Creation not confirmed", exact: true }).waitFor();
  check("unknown creation cannot resubmit", await page.getByRole("button", { name: "Save connection", exact: true }).count() === 0);
  check("unknown creation preserves focus inside drawer", await page.locator(".ig-panel").evaluate(e => e.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  check("creation Escape returns focus to its entry", await page.getByRole("button", { name: "Add incoming contacts connection", exact: true }).evaluate(e => document.activeElement === e));
  await open(page, "dark", "late"); await drawer(page); await setup(page);
  await page.getByRole("button", { name: "Enable incoming contacts", exact: true }).click();
  await page.evaluate(() => dispatchEvent(new Event("incoming-harness-switch")));
  await page.getByRole("button", { name: /Test contact source B/ }).waitFor();
  await page.waitForTimeout(1400);
  check("account switch drops old drawer and late save feedback", await page.locator(".ig-panel").count() === 0 && !(await page.locator("body").innerText()).includes("incoming permission confirmed"));
  await page.setViewportSize({ width: 900, height: 1000 }); await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await open(page); await drawer(page); await setup(page); await inspectScroll(page, "900-forced-colors");
  check("forced colors remains operable", await page.evaluate(() => matchMedia("(forced-colors: active)").matches));
  await page.screenshot({ path: path.join(output, "900x1000-forced-colors.png") });
  check("no JavaScript errors", report.consoleErrors.length === 0, report.consoleErrors);
} catch (error) {
  report.failure = String(error?.stack ?? error);
  if (drivePage) {
    await drivePage.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    report.failureGeometry = await geometry(drivePage).catch(() => null);
    report.pointerHit = await drivePage.evaluate(() => {
      const owner = document.querySelector(".ig-panel-body"); if (!owner) return null;
      const r = owner.getBoundingClientRect(); return { owner: [r.x, r.y, r.width, r.height], scrollTop: owner.scrollTop,
        top: document.elementFromPoint(r.right - 5, r.top + 20)?.outerHTML.slice(0, 600),
        bottom: document.elementFromPoint(r.right - 5, r.bottom - 20)?.outerHTML.slice(0, 600) };
    }).catch(() => null);
  }
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser?.close(); server?.httpServer?.closeAllConnections(); await server?.close();
  if (base) {
    const verdict = await closedPort(base);
    report.checks.push({ name: "owned server port closed after success or failure", verdict, detail: "TCP connect refused required; timeout is UNVERIFIED" });
    if (verdict !== "PASS") process.exitCode = 1;
  }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidenceClass: report.evidenceClass, checks: report.checks.length,
    failures: report.checks.filter(c => c.verdict === "FAIL"), frames: report.frames.length, failure: report.failure, output }));
}
