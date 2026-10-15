#!/usr/bin/env node
/**
 * Shared MCP configuration journey: actual SoloSettings/view/hooks, synthetic transport only.
 * No provider, credential, real account, production save or authenticated capability proof.
 * Replaces the provider-name OAuth drive. Owns and closes its local server on every exit.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5417;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve("scripts/live-drive/artifacts/shared-mcp");
const frames = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const results = [];
const record = (name, pass, details = {}) => {
  results.push({ name, status: pass ? "PASS" : "FAIL", details });
  if (!pass) throw new Error(name + ": " + JSON.stringify(details));
  console.log("PASS " + name);
};
const portFree = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(PORT, "127.0.0.1", () => server.close(resolve));
});
async function stop(server) {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const task = spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      task.once("error", reject); task.once("exit", resolve);
    });
  } else { server.kill("SIGTERM"); await new Promise(resolve => server.once("exit", resolve)); }
}
const field = (page, name) => page.getByLabel(name, { exact: true });
async function openForm(page, name = "Any MCP server") {
  await page.locator('.ig-card[data-provider="mcp-add"]').click();
  await page.locator('.ig-gw-tile').filter({ has: page.locator('.ig-gw-tile-name', { hasText: name }) }).first().click();
  await field(page, "Name").waitFor();
}
async function fill(page, auth = "Token + headers") {
  await field(page, "Name").fill("Synthetic MCP example");
  await field(page, "Server URL").fill("https://tools.example.com/api/mcp/");
  await page.getByRole("button", { name: auth, exact: true }).click();
  if (auth === "Token + headers" || auth === "Token") await field(page, "Token").fill("synthetic-browser-token");
  if (auth === "Token + headers") {
    await page.getByRole("button", { name: "Add header", exact: true }).click();
    await field(page, "Header 1 name").fill("Workspace-Reference");
    await field(page, "Header 1 value").fill("synthetic-workspace-reference");
  }
}
async function geometry(page, label) {
  const audit = await page.evaluate(() => {
    const owner = document.querySelector(".ig-panel-body");
    const box = document.querySelector(".ig-panel")?.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
      panel: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null,
      owner: owner ? { scrollHeight: owner.scrollHeight, clientHeight: owner.clientHeight, scrollWidth: owner.scrollWidth, clientWidth: owner.clientWidth, overflowY: getComputedStyle(owner).overflowY } : null };
  });
  record(label + " geometry", audit.documentWidth <= audit.width + 1 && audit.documentHeight <= audit.height + 1 && audit.panel?.right <= audit.width + 1 && audit.panel?.bottom <= audit.height + 1 && audit.owner.scrollWidth <= audit.owner.clientWidth + 1, audit);
  return audit;
}
async function main() {
  await portFree(); fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/integrations-mount/vite.config.ts", "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let serverLog = "";
  const capture = chunk => { serverLog = (serverLog + String(chunk)).slice(-20000); };
  server.stdout.on("data", capture); server.stderr.on("data", capture);
  let browser;
  let lastPage;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(BASE)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Local harness did not start");
    browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    for (const [width, height] of frames) for (const theme of ["light", "dark"]) for (const paige of ["closed", "open"]) {
      const label = `${width}x${height}-${theme}-${paige}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      const page = await context.newPage();
      lastPage = page;
      const errors = [];
      const external = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        if (new URL(route.request().url()).origin === BASE) return route.continue();
        // Existing public typography assets are not MCP/provider traffic. No auth or tenant data.
        if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(new URL(route.request().url()).hostname)) return route.continue();
        external.push(new URL(route.request().url()).origin);
        return route.abort();
      });
      // Readiness is the actual control below, not global network silence (Vite HMR and
      // optional typography requests can outlive a usable page).
      await page.goto(`${BASE}/?theme=${theme}&data=empty&paige=${paige}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await openForm(page);
      record(label + " explicit auth choices", await page.locator('[aria-label="Authentication"] button').count() === 4);
      await fill(page);
      const sameAuth = page.getByRole("button", { name: "Token + headers", exact: true });
      await sameAuth.click(); await sameAuth.focus(); await page.keyboard.press("Enter");
      record(label + " unchanged auth retains draft", await field(page, "Token").inputValue() === "synthetic-browser-token" && await field(page, "Header 1 value").inputValue() === "synthetic-workspace-reference");
      await page.screenshot({ path: path.join(OUT, label + "-initial-form.png") });
      const geometryResult = await geometry(page, label);
      const owner = page.getByRole("region", { name: "Tool setup and details", exact: true });
      record(label + " visible scroll affordance", await owner.evaluate(el => getComputedStyle(el).scrollbarWidth !== "none" && el.offsetWidth - el.clientWidth > 0));
      if (geometryResult.owner.scrollHeight > geometryResult.owner.clientHeight + 1) {
        await owner.focus();
        await page.keyboard.press("End");
        await page.waitForTimeout(150);
        record(label + " End reaches terminal content", await owner.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2));
        await page.keyboard.press("Home");
        await page.waitForTimeout(100);
        await page.keyboard.press("PageDown");
        await page.waitForTimeout(150);
        record(label + " PageDown travels owner", await owner.evaluate(el => el.scrollTop > 0));
        await page.keyboard.press("Home");
        await page.waitForTimeout(100);
        await page.keyboard.press("Space");
        await page.waitForTimeout(150);
        record(label + " Space travels owner", await owner.evaluate(el => el.scrollTop > 0));
        await owner.hover(); await page.mouse.wheel(0, 650); await page.waitForTimeout(150);
        record(label + " wheel travels owner", await owner.evaluate(el => el.scrollTop > 0));
      }
      await page.screenshot({ path: path.join(OUT, label + "-form.png") });
      const save = page.getByRole("button", { name: "Save configuration", exact: true });
      await save.focus();
      record(label + " terminal action focus reachable", await save.evaluate(el => {
        const r = el.getBoundingClientRect(); return document.activeElement === el && r.top >= 0 && r.bottom <= innerHeight;
      }));
      await page.keyboard.press("Enter");
      await page.getByText("Saved — configuration confirmed.", { exact: true }).waitFor();
      record(label + " receipt focus handoff", await page.locator('.ig-panel [role="status"]').evaluate(el => document.activeElement === el));
      record(label + " no secret reflected", !(await page.locator(".ig-panel").innerHTML()).includes("synthetic-browser-token") && !(await page.locator(".ig-panel").innerHTML()).includes("synthetic-workspace-reference"));
      record(label + " no automatic provider action", await page.evaluate(() => window.__mcpHarnessCalls.every(call => call.action === "create")));
      await page.screenshot({ path: path.join(OUT, label + "-saved.png") });
      await page.getByRole("button", { name: "Review saved tool", exact: true }).click();
      record(label + " saved is not checked", (await page.locator(".ig-panel").innerText()).includes("Not checked yet"));
      await page.getByRole("button", { name: "Check now", exact: true }).click();
      await page.getByText(/Checked just now/).waitFor();
      record(label + " explicit check shows returned empty catalogue", (await page.locator(".ig-panel").innerText()).includes("offered nothing"));
      await page.keyboard.press("Escape");
      record(label + " Escape exits drawer", await page.locator('[role="dialog"]').count() === 0);
      record(label + " no runtime errors or external calls", errors.length === 0 && external.length === 0, { errors, external });
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    for (const width of [1024, 1366]) {
      await page.setViewportSize({ width, height: 768 });
      await page.goto(`${BASE}/?theme=dark&data=empty`);
      await openForm(page);
      await page.getByRole("button", { name: "Save configuration", exact: true }).focus();
      await page.keyboard.press("Enter");
      record(`${width} invalid field focus`, await field(page, "Name").evaluate(el => document.activeElement === el));
      await fill(page);
      for (let index = 0; index < 4; index++) await page.getByRole("button", { name: "Add header", exact: true }).click();
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      await cancel.focus(); await page.keyboard.press("Enter");
      const keep = page.getByRole("button", { name: "Keep editing", exact: true });
      record(`${width} discard visible and focused`, await keep.evaluate(el => {
        const r = el.closest('[role="alertdialog"]').getBoundingClientRect();
        const owner = el.closest('.ig-panel-body').getBoundingClientRect();
        return document.activeElement === el && r.top >= owner.top && r.bottom <= owner.bottom;
      }));
      await page.screenshot({ path: path.join(OUT, `${width}-discard.png`) });
      await page.keyboard.press("Enter");
      record(`${width} cancel focus restored`, await cancel.evaluate(el => document.activeElement === el));
      await page.keyboard.press("Escape");
      record(`${width} Escape guard focused`, await keep.evaluate(el => document.activeElement === el));
      await page.keyboard.press("Escape");
      record(`${width} Escape guard returns focus`, await cancel.evaluate(el => document.activeElement === el));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Tab");
      record(`${width} discard keyboard loop`, await page.getByRole("button", { name: "Discard them", exact: true }).evaluate(el => document.activeElement === el));
      await page.keyboard.press("Enter");
      record(`${width} discard exits`, await page.locator('[role="dialog"]').count() === 0);
    }
    for (const mode of ["gateway-save-fail", "readback-fail", "signin-fail"]) {
      await page.goto(`${BASE}/?theme=light&data=${mode}`);
      await openForm(page);
      await fill(page, mode === "signin-fail" ? "OAuth" : "None");
      await page.getByRole("button", { name: "Save configuration", exact: true }).click();
      if (mode === "gateway-save-fail") {
        await page.locator(".ig-panel [role=alert]").waitFor();
        record("refused save stays editable", await field(page, "Server URL").inputValue() === "https://tools.example.com/api/mcp/");
      } else if (mode === "readback-fail") {
        await page.getByRole("button", { name: "Retry confirmation", exact: true }).waitFor();
        await page.getByRole("button", { name: "Retry confirmation", exact: true }).click();
        record("readback retry never creates twice", await page.evaluate(() => window.__mcpHarnessCalls.filter(call => call.action === "create").length === 1));
      } else {
        await page.getByRole("button", { name: "Authorize with server", exact: true }).click();
        await page.getByText(/configuration is saved, but sign-in did not start/).waitFor();
        await page.getByRole("button", { name: "Authorize with server", exact: true }).click();
        record("OAuth retries reuse saved row", await page.evaluate(() => window.__mcpHarnessCalls.filter(call => call.action === "create").length === 1 && window.__mcpHarnessCalls.filter(call => call.action === "oauth_begin").length === 2));
      }
      await page.screenshot({ path: path.join(OUT, mode + ".png") });
    }
    await context.close();
  } catch (error) {
    results.push({ name: "drive interruption", status: "FAIL", detail: String(error) });
    console.error(serverLog.slice(-6000));
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({ path: path.join(OUT, "failure.png") });
      console.error((await lastPage.locator("body").innerText()).slice(0, 2500));
    }
    throw error;
  } finally {
    await browser?.close();
    await stop(server);
    await portFree();
    results.push({ name: "server port cleanup", status: "PASS" });
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ evidenceClass: "STRUCTURAL-RENDERED; synthetic transport, no authenticated/provider proof", results }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
