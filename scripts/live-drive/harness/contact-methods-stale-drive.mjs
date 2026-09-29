// Drives the stale-save refusal on both contact-method editors (PR 7): an admin saving a teammate's
// list the teammate changed meanwhile, and a client contact that gained an address after the editor
// opened. Asserts nothing is overwritten, the current list is shown with the editor's own addition
// kept, and the retry saves on top of it. Structural harness — NOT the live app.
// Serve first (both):
//   npx vite --config scripts/live-drive/harness/team-mount/vite.config.ts
//   npx vite --config scripts/live-drive/harness/people-contact-methods-mount/vite.config.ts
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const out = process.env.OUT || "scripts/live-drive/artifacts/contact-methods-stale";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = {};
async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "8px", top: "6px", zIndex: "999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
const values = (page, scope) => page.$$eval(`${scope} [data-ctm-id] input`, (inputs) => inputs.map((i) => i.value));

// Team: an admin adds an email to the owner's row while the owner adds a phone.
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on("pageerror", (e) => errors.push(`team ${theme}: ${e}`));
  await page.goto(`http://127.0.0.1:5202/?theme=${theme}&as=admin&stale=1`);
  await page.getByRole("button", { name: /Antonio Martinez/ }).first().click();
  await page.waitForSelector(".stw-contact .ctm-editor");
  await page.click('.stw-contact [data-ctm-add="email"]');
  await page.keyboard.type("antonio.billing@northstar.example");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await page.waitForSelector(".stw-contact-msg.is-bad");
  // Focus moves to the outcome on the next tick; wait for it rather than race it.
  await page.waitForFunction(() => document.activeElement?.classList.contains("stw-contact-msg"), null, { timeout: 2000 }).catch(() => {});
  const refused = {
    message: await page.textContent(".stw-contact-msg"),
    focused: await page.evaluate(() => document.activeElement?.classList.contains("stw-contact-msg")),
    listShown: await values(page, ".stw-contact"),
  };
  await page.mouse.move(2, 2);
  await label(page);
  await (await page.$(".stw-modal")).screenshot({ path: `${out}/team-stale-${theme}.png` });
  if (theme === "light") {
    await page.getByRole("button", { name: "Save contact details" }).click();
    await page.waitForSelector(".stw-contact-msg:not(.is-bad)");
    refused.retry = { message: await page.textContent(".stw-contact-msg"), listStored: await values(page, ".stw-contact") };
  }
  results[`team-${theme}`] = refused;
  await page.close();
}

// People: an inbound message attached jordan@reyes-projects.co after the editor opened.
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on("pageerror", (e) => errors.push(`people ${theme}: ${e}`));
  await page.goto(`http://127.0.0.1:5214/?theme=${theme}&stale=1`);
  await page.waitForSelector('[data-ctm-list="email"]');
  await page.click('[data-ctm-add="email"]');
  await page.keyboard.type("jordan.site@reyesbuild.co");
  const save = async () => {
    await page.click('.trc-contact-editor-steps [role="tab"]:has-text("Relationship & consent")');
    await page.getByRole("button", { name: /^(Save changes|Retry save)$/ }).click();
  };
  await save();
  await page.waitForFunction(() => document.body.textContent.includes("Someone else changed this contact"));
  const refused = {
    message: await page.textContent(".trc-contact-editor-message"),
    messageVisible: await page.evaluate(() => { const r = document.querySelector(".trc-contact-editor-message").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }),
    onIdentity: await page.evaluate(() => document.querySelector('.trc-contact-editor-steps [role="tab"][aria-selected="true"]')?.textContent?.trim()),
    listShown: await values(page, '[data-ctm-list="email"]'),
    upsertsSoFar: await page.evaluate(() => window.__upserts.length),
  };
  await page.mouse.move(2, 2);
  await label(page);
  await page.screenshot({ path: `${out}/people-stale-${theme}.png` });
  if (theme === "light") {
    await save();
    await page.waitForFunction(() => window.__upserts.length === 2);
    const last = await page.evaluate(() => window.__upserts.at(-1).p_patch);
    refused.retry = { expected_updated_at: last.expected_updated_at, emails: last.contact_methods.filter((m) => m.kind === "email").map((m) => m.value) };
  }
  results[`people-${theme}`] = refused;
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ errors, results }, null, 2));
