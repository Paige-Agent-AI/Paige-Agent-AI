#!/usr/bin/env node
/** Structural-harness evidence only: real component/CSS, deterministic transport stub. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const base = "http://127.0.0.1:5202";
const artifacts = path.join(import.meta.dirname, "artifacts", "solo-team-workspace");
const frames = [{ w: 1536, h: 770 }, { w: 1366, h: 768 }, { w: 1024, h: 768 }, { w: 900, h: 1000 }];
fs.mkdirSync(artifacts, { recursive: true });

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/team-mount/vite.config.ts"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Team harness did not start")), 90_000);
  const ready = (chunk) => { if (/ready in|Local:/.test(String(chunk))) { clearTimeout(timer); resolve(); } };
  vite.stdout.on("data", ready); vite.stderr.on("data", ready); vite.once("exit", (code) => reject(new Error(`Team harness exited ${code}`)));
});

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
let browser;
try {
  // The shared resolvers, so the drive runs wherever the live-drive helper does (a bundled or a
  // provided Chromium), not only where Playwright's own download matches.
  const { chromium } = await resolvePlaywright();
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], ...(resolveExecutablePath() ? { executablePath: resolveExecutablePath() } : {}) });
  const page = await browser.newPage();

  // THE SOLO MATRIX. Every viewport with the PAIGE dock closed AND open (the dock narrows the
  // content column), in both themes, with a teammate's editor opened in each — the editor is where
  // the Title field lives, and a dialog that fits the roster's column can still clip its own footer.
  for (const paige of ["closed", "open"]) {
    for (const theme of ["light", "dark"]) {
      for (const frame of frames) {
        const tag = `${frame.w}x${frame.h} PAIGE ${paige} ${theme}`;
        await page.setViewportSize({ width: frame.w, height: frame.h });
        await page.goto(`${base}/?theme=${theme}&paige=${paige}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.locator(".stw-row").first().waitFor();
        const shell = await page.evaluate(() => {
          const host = document.querySelector("[data-solo-screen-host]");
          return { dock: document.querySelector("[data-tenant-shell]")?.getAttribute("data-paige"), column: Math.round(host.getBoundingClientRect().width), docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, hostOverflow: host.scrollWidth > host.clientWidth };
        });
        check(`${tag} roster fits its column`, shell.dock === paige && !shell.docOverflow && !shell.hostOverflow, JSON.stringify(shell));
        await page.screenshot({ path: path.join(artifacts, `matrix-roster-${frame.w}x${frame.h}-paige-${paige}-${theme}.png`) });
        await page.locator(".stw-row").nth(1).click();
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor();
        const editor = await dialog.evaluate((el) => {
          const labels = Array.from(el.querySelectorAll("label")).map((l) => l.firstChild?.textContent?.trim());
          return { labels, overflow: el.scrollWidth > el.clientWidth, docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
        const save = dialog.getByRole("button", { name: "Save work details" });
        await save.scrollIntoViewIfNeeded();
        const saveBox = await save.boundingBox();
        check(`${tag} editor: Title field present, nothing clipped, Save reachable`,
          editor.labels.includes("Title") && !editor.overflow && !editor.docOverflow && !!saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= frame.h,
          JSON.stringify({ ...editor, save: saveBox && { y: Math.round(saveBox.y), h: Math.round(saveBox.height) } }));
        await page.screenshot({ path: path.join(artifacts, `matrix-editor-${frame.w}x${frame.h}-paige-${paige}-${theme}.png`) });
        await page.keyboard.press("Escape");
      }
    }
  }

  // 200% BROWSER ZOOM. At 200% a 1366x768 window lays out in 683x384 CSS pixels and a 1536x770 one
  // in 768x385; emulated here as exactly that, at device scale 2, so the frame is the zoomed page.
  for (const zoomed of [{ w: 683, h: 384, of: "1366x768" }, { w: 768, h: 385, of: "1536x770" }]) {
    const zoomPage = await browser.newPage({ viewport: { width: zoomed.w, height: zoomed.h }, deviceScaleFactor: 2 });
    await zoomPage.goto(`${base}/?theme=light&paige=open`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await zoomPage.locator(".stw-row").first().waitFor();
    const docOverflow = await zoomPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await zoomPage.locator(".stw-row").nth(1).click();
    const zoomDialog = zoomPage.locator('[role="dialog"]');
    await zoomDialog.waitFor();
    const title = zoomDialog.getByPlaceholder("e.g. Client Success Manager");
    await title.scrollIntoViewIfNeeded();
    const titleVisible = await title.isVisible();
    const zoomSave = zoomDialog.getByRole("button", { name: "Save work details" });
    await zoomSave.scrollIntoViewIfNeeded();
    const box = await zoomSave.boundingBox();
    check(`200% zoom of ${zoomed.of}: no sideways scroll, Title field and Save reachable`,
      !docOverflow && titleVisible && !!box && box.y >= 0 && box.y + box.height <= zoomed.h,
      JSON.stringify({ docOverflow, titleVisible, save: box && Math.round(box.y) }));
    await zoomPage.screenshot({ path: path.join(artifacts, `zoom200-editor-${zoomed.of}.png`) });
    await zoomPage.close();
  }

  // KEYBOARD. From the search field, Tab to a teammate, open them with Enter, Tab to the Title
  // field, and read its accessible name and focus ring from the live page; Escape returns focus.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${base}/?theme=light`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".stw-row").first().waitFor();
  await page.getByPlaceholder("Search people, titles, responsibilities").focus();
  let onRow = false;
  for (let i = 0; i < 40 && !onRow; i++) { await page.keyboard.press("Tab"); onRow = await page.evaluate(() => document.activeElement?.classList.contains("stw-row") ?? false); }
  check("keyboard reaches a teammate row from the search field", onRow);
  const rowName = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
  await page.keyboard.press("Enter");
  await page.locator('[role="dialog"]').waitFor();
  let onTitle = null;
  for (let i = 0; i < 20 && !onTitle; i++) {
    await page.keyboard.press("Tab");
    onTitle = await page.evaluate(() => {
      const el = document.activeElement;
      const name = el instanceof HTMLInputElement ? el.labels?.[0]?.firstChild?.textContent?.trim() : null;
      return name === "Title" ? { name, focusVisible: el.matches(":focus-visible"), ring: getComputedStyle(el).outlineStyle !== "none" || getComputedStyle(el).boxShadow !== "none" } : null;
    });
  }
  check("keyboard reaches the Title field, named Title, with a visible focus ring", !!onTitle && onTitle.focusVisible && onTitle.ring, JSON.stringify(onTitle));
  await page.keyboard.press("Escape");
  check("Escape closes the editor and returns focus to the teammate", await page.evaluate(() => !document.querySelector('[role="dialog"]') && document.activeElement?.classList.contains("stw-row")), rowName ?? "");

  // REDUCED MOTION, on its own page created with the preference already set, so nothing started
  // before it (a hover or a closing transition from the steps above) can be counted against it.
  const calm = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await calm.goto(`${base}/?theme=light`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await calm.locator(".stw-row").first().waitFor();
  await calm.locator(".stw-row").nth(1).click();
  await calm.locator('[role="dialog"]').waitFor();
  const runningList = await calm.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => `${a.animationName ?? a.transitionProperty ?? a.constructor.name}@${String(a.effect?.target?.className ?? a.effect?.target?.tagName ?? "").slice(0, 50)}`));
  check("reduced motion: opening the editor runs no animation", runningList.length === 0, `${runningList.length} running ${JSON.stringify(runningList)}`);
  await calm.close();

  // A SECOND KNOWN-GOOD WORKSPACE, and a LIVE SWITCH between them.
  await page.goto(`${base}/?theme=light&tenant=harbor`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".stw-row").first().waitFor();
  const harbor = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
  check("second workspace: its own people and titles, the untitled one reads Title not set, the long title fits",
    harbor.text.includes("Harbor Wellness") && harbor.text.includes("Mei Tanaka") && harbor.text.includes("Title not set") && !harbor.text.includes("Northstar Studio") && !harbor.overflow);
  await page.screenshot({ path: path.join(artifacts, "workspace-harbor-1366x768-light.png") });
  await page.goto(`${base}/?theme=light`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".stw-row").first().waitFor();
  await page.getByRole("button", { name: "Invite someone" }).first().click();
  await page.locator('[role="dialog"]').waitFor();
  await page.evaluate(() => window.__switchWorkspace("harbor"));
  await page.getByText("You switched workspace, so the invitation for Northstar Studio was closed. Nothing was sent.").waitFor({ timeout: 5_000 });
  await page.getByText("Mei Tanaka").first().waitFor({ timeout: 5_000 });
  check("workspace switch: the open invitation closes and says so, and the roster and invitations become the new workspace's",
    await page.locator('[role="dialog"]').count() === 0 && !(await page.getByText("Antonio Martinez").count())
      && !(await page.getByText("alex@northstar.example").count()));
  await page.screenshot({ path: path.join(artifacts, "workspace-switch-1366x768-light.png") });

  await page.setViewportSize({ width: 1366, height: 768 });
  for (const frame of frames) {
    await page.setViewportSize({ width: frame.w, height: frame.h });
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator(".stw-row").first().waitFor();
    const geometry = await page.evaluate(() => {
      const owner = document.querySelector("[data-solo-screen-host]"); const roster = document.querySelector(".stw-list"); const surface = document.querySelector(".stw-workspace");
      return { docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, ownerOverflow: owner.scrollWidth > owner.clientWidth, ownerScrollable: owner.scrollHeight > owner.clientHeight, rosterOverflow: roster.scrollWidth > roster.clientWidth, rosterScrollOwner: ["auto", "scroll"].includes(getComputedStyle(roster).overflowY), surfaceWidth: Math.round(surface.getBoundingClientRect().width) };
    });
    check(`${frame.w}x${frame.h} no horizontal overflow`, !geometry.docOverflow && !geometry.ownerOverflow && !geometry.rosterOverflow && geometry.surfaceWidth > 500, JSON.stringify(geometry));
    check(`${frame.w}x${frame.h} one reachable page scroll`, geometry.ownerScrollable && !geometry.rosterScrollOwner);
    await page.locator("[data-solo-screen-host]").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    check(`${frame.w}x${frame.h} bottom reachable`, await page.locator(".stw-paige").isVisible());
    await page.screenshot({ path: path.join(artifacts, `team-${frame.w}x${frame.h}.png`), fullPage: false });
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".stw-row").first().waitFor();
  check("large roster starts paged", await page.locator(".stw-row").count() === 25);
  await page.getByRole("button", { name: /Load more/ }).click();
  check("load more reaches remaining people", await page.locator(".stw-row").count() === 34);

  await page.locator(".stw-row").nth(1).click();
  let title = page.getByPlaceholder("e.g. Client Success Manager"); const original = await title.inputValue();
  await title.fill("Account Director"); await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator(".stw-row").nth(1).click(); title = page.getByPlaceholder("e.g. Client Success Manager");
  check("edit cancel restores work title", await title.inputValue() === original);
  await title.fill("Account Director");
  await page.getByRole("button", { name: "Save work details" }).click(); await page.locator(".stw-modal-actions").getByRole("button", { name: "Close" }).click();
  await page.locator(".stw-row").nth(1).click(); check("saved work title survives re-read", await page.getByPlaceholder("e.g. Client Success Manager").inputValue() === "Account Director");
  await page.getByLabel("Enforced permission").selectOption("admin"); check("permission requires confirmation", await page.getByRole("button", { name: "Confirm access change" }).isVisible());
  await page.getByRole("button", { name: "Confirm access change" }).click();

  const inviteButton = page.getByRole("button", { name: "Invite someone" }).first(); await inviteButton.click();
  const email = page.getByPlaceholder("person@company.com"); await email.fill("bad-email");
  check("invalid invitation is blocked", await page.getByRole("button", { name: "Review invitation" }).isDisabled());
  await email.fill("new.person@northstar.example"); await page.getByRole("button", { name: "Review invitation" }).click();
  check("invitation has owner confirmation state", await page.getByRole("button", { name: "Confirm and send invitation" }).isVisible());
  await page.getByRole("button", { name: "Confirm and send invitation" }).click();
  check("confirmed invitation enters lifecycle", await page.getByText("new.person@northstar.example").isVisible());

  await inviteButton.click(); await page.keyboard.press("Escape");
  check("Escape closes and restores trigger focus", await inviteButton.evaluate((el) => el === document.activeElement));
  await page.getByRole("tab", { name: "Roles & access" }).click(); check("roles explanation reachable", await page.getByText("Full workspace authority").isVisible());
  await page.getByRole("tab", { name: "Team" }).click(); await page.getByRole("button", { name: "Open Paige" }).click();
  check("existing Paige workspace opener wired", await page.evaluate(() => document.body.dataset.paigeOpened === "true"));

  await page.goto(`${base}/?state=first`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("Your workspace starts with you").waitFor(); check("first teammate state reachable", true);
  await page.goto(`${base}/?state=denied`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("You don’t have access to this team").waitFor(); check("permission denied state explicit", true);
} finally {
  await browser?.close(); vite.kill();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(artifacts, "results.json"), JSON.stringify({ evidence: "STRUCTURAL-HARNESS", results }, null, 2));
if (failed.length) { console.error(`${failed.length} checks failed`); process.exitCode = 1; } else console.log(`PASS ${results.length}/${results.length} structural-harness checks`);
