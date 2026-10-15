import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(project, process.argv[2] ?? ".impeccable/review/e09-dashboard");
await fs.mkdir(output, { recursive: true });
const adapter = path.join(project, "scripts/proof/e09-dashboard-ui/adapter.tsx");
const replace = /^(?:@\/(?:hooks\/(?:useTenantContext|useBrandKit|usePortalConfig|useRailEvents|useTierFeatures)|integrations\/supabase\/client|lib\/playbook|components\/ui\/paige|components\/admin\/voice\/DialPadTrigger|components\/dashboard\/PaigeAIChat|components\/tenant-calendar\/TenantCanonicalCalendarWorkspace)|\.\/(?:usePortalInvitations|useTenantRelationshipsData|ClientStanding|PeopleContactEditor))$/;
const bundled = await build({ entryPoints: [path.join(project, "scripts/proof/e09-dashboard-ui/source.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, plugins: [{ name: "read-only-source-fixtures", setup(api) {
  api.onResolve({ filter: replace }, () => ({ path: adapter }));
  api.onResolve({ filter: /^next-themes$/ }, () => ({ path: adapter }));
  api.onResolve({ filter: /^@\/pages\/admin\/(ClientsConversations|CalendarAdmin)$/ }, () => ({ path: adapter }));
  api.onResolve({ filter: /^@\/components\/admin\/contacts\/ContactPortalPanel$/ }, () => ({ path: adapter }));
} }] });
const styles = (await fs.readdir(path.join(project, "dist/assets"))).filter((file) => file.endsWith(".css"));
let css = (await Promise.all(styles.map((file) => fs.readFile(path.join(project, "dist/assets", file), "utf8")))).join("\n");
// Load the shipped font bytes locally; every browser network request is still blocked.
for (const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]) {
  const url = match[1].replace(/["']/g, "");
  if (!url.startsWith("/assets/")) continue;
  const bytes = await fs.readFile(path.join(project, "dist", url.slice(1)));
  css = css.replaceAll(match[0], `url(data:font/woff2;base64,${bytes.toString("base64")})`);
}
const options = { headless: true }; try { await fs.access(chromium.executablePath()); } catch { options.executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"; }
const browser = await chromium.launch(options); const cases = []; const errors = [];
async function renderCase({ width, height, open, theme, tenant, state = "content", tab = "Overview" }) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<html data-pg="${theme}"><head></head><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.evaluate((proof) => { window.portalProof = proof; }, { open, theme, tenant, state });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.getByRole("region", { name: "Portal dashboard" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (tab !== "Overview") await page.getByRole("tab", { name: tab, exact: true }).click();
  const geometry = await page.evaluate(() => ({ documentOverflow: document.documentElement.scrollWidth > innerWidth, shellHeight: document.querySelector("[data-tenant-shell]").getBoundingClientRect().height, scrollOwner: getComputedStyle(document.querySelector(".trc-panel--portal")).overflowY, clientTableReachable: !!document.querySelector(".opd-clients"), forbiddenHeadings: [...document.querySelectorAll("h1,h2")].some((node) => /Your client book|One relationship\. Two authorized views\.|Client portal/i.test(node.textContent)), portalWidth: document.querySelector(".opd-dashboard").getBoundingClientRect().width, actualPaigeState: document.querySelector("[data-tenant-shell]").dataset.paige }));
  assert.equal(geometry.documentOverflow, false); assert.equal(geometry.forbiddenHeadings, false); assert.equal(geometry.scrollOwner, "auto");
  const clippedControls = await page.evaluate(() => { const panel = document.querySelector(".trc-panel--portal").getBoundingClientRect(); return [...document.querySelectorAll(".opd-dashboard button,.opd-dashboard input,.opd-dashboard select")].filter((node) => node.getClientRects().length && !node.closest(".opd-table-wrap")).filter((node) => { const r = node.getBoundingClientRect(); return r.left < panel.left - 1 || r.right > panel.right + 1; }).map((node) => node.textContent || node.getAttribute("aria-label")); });
  assert.deepEqual(clippedControls, [], "non-table controls must fit their actual scroll owner");
  const name = `${width}-${height}-${open ? "open" : "closed"}-${theme}-${tenant}-${state}-${tab.replaceAll(" ", "-")}.png`;
  await page.screenshot({ path: path.join(output, name), fullPage: true });
  cases.push({ width, height, open, theme, tenant, state, tab, geometry, screenshot: name });
  if (width === 1536 && !open && theme === "light" && state === "content" && tab === "Overview") {
    await page.getByRole("button", { name: "Preview portal", exact: true }).focus();
    await page.getByRole("button", { name: "Preview portal", exact: true }).click();
    await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Preview portal");
    await page.getByRole("button", { name: "Invite client", exact: true }).focus();
    await page.getByRole("button", { name: "Invite client", exact: true }).click();
    await page.getByLabel("Existing client", { exact: true }).selectOption("test-contact-1");
    await page.getByRole("button", { name: "Send invitation email", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "invitation-dialog.png") });
    // Do not click: source fixtures cannot send or create an invitation.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Invite client");
    await page.getByRole("button", { name: "Customize experience", exact: true }).click();
    await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Unsaved source-proof greeting");
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.getByRole("tab", { name: /Experience/, exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Headline", exact: true }).inputValue(), "Unsaved source-proof greeting");
    const save = page.getByRole("button", { name: "Save portal", exact: true });
    assert.equal(await save.evaluate((node) => getComputedStyle(node).boxShadow), "none");
    await save.hover();
    assert.equal(await save.evaluate((node) => getComputedStyle(node).boxShadow), "none");
    assert.equal(await page.locator(".opd-editor .overflow-hidden.rounded-xl.border").first().evaluate((node) => getComputedStyle(node).boxShadow), "none");
    await page.getByRole("textbox", { name: "Headline", exact: true }).focus();
    await page.screenshot({ path: path.join(output, "experience-editor-draft.png") });
  }
  await page.close();
}
try {
  for (const [width, height] of [[1536,770],[1366,768],[1024,768],[900,1000]]) for (const open of [false,true]) for (const theme of ["light","dark"]) await renderCase({width,height,open,theme,tenant:"test-tenant-a"});
  for (const tab of ["Overview","Experience","Client access","Activity"]) await renderCase({width:1536,height:900,open:false,theme:"light",tenant:"test-tenant-b",tab});
  for (const state of ["empty","error","loading"]) await renderCase({width:1366,height:768,open:false,theme:"light",tenant:"test-tenant-a",state});
  await renderCase({width:390,height:844,open:false,theme:"light",tenant:"test-tenant-a"});
  await renderCase({width:768,height:385,open:false,theme:"light",tenant:"test-tenant-a"});
  assert.equal(errors.length, 0, JSON.stringify(errors));
} finally { await browser.close(); }
const sources = ["src/components/tenant-shell/TenantCommandCenterShell.tsx","src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx","src/components/tenant-relationships/OwnerPortalDashboard.tsx","src/components/tenant-relationships/PortalInvitationManager.tsx","src/components/tenant-relationships/owner-portal-dashboard.css","src/pages/admin/PortalStudio.tsx"];
const sourceHashes = await Promise.all(sources.map(async (file) => ({file,sha256:createHash("sha256").update(await fs.readFile(path.join(project,file))).digest("hex")})));
const boundary = "Actual Solo shell, workspace, dashboard and native editor source; read-only neutral test transports and placeholder PAIGE content. Network blocked. No real session, account acceptance, production read/write, provider send or owner acceptance is proven.";
await fs.writeFile(path.join(output,"result.json"),JSON.stringify({sourceHashes,cases,errors,boundary},null,2));
console.log(JSON.stringify({cases:cases.length,output,errors,boundary}));
