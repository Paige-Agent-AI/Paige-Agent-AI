// Isolated throwaway prototype review; synthetic data/effects, never customer acceptance.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";
const root = path.resolve(import.meta.dirname, "../..");
const destination = path.resolve(root, "../../outputs/e04-agreements-prototype");
const target = "http://127.0.0.1:5291/agreements-preparation.html";
assert.equal(new URL(target).hostname, "127.0.0.1");
const { chromium } = await resolvePlaywright();
const launch = buildLaunchOptions();
// This fixed loopback-only driver has no remote destination or auth. External
// traffic is denied below. Do not carry a remote relay into this local review.
delete launch.proxy;
const browser = await chromium.launch(launch);
const errors = [], blocked = [], frames = [], paths = [];
const sources = ["scripts/live-drive/harness/sales-mount/agreements-preparation.tsx", "scripts/live-drive/harness/sales-mount/agreements-preparation.css", "src/index.css", "src/components/tenant-shell/TenantCommandCenterShell.tsx"];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async p => [p, createHash("sha256").update((await fs.readFile(path.join(root, p), "utf8")).replaceAll("\r\n", "\n")).digest("hex")])));
const before = await hashes();
await fs.mkdir(destination, { recursive: true });
const context = await browser.newContext({ reducedMotion: "reduce" });
await context.route("**/*", r => {
  const url = new URL(r.request().url());
  if (url.origin === "http://127.0.0.1:5291" || ["blob:", "data:"].includes(url.protocol)) return r.continue();
  blocked.push(url.origin); return r.abort();
});
const page = await context.newPage();
page.on("pageerror", e => errors.push(e.message));
const route = (theme = "light", step = "document", paige = "closed") => `${target}?theme=${theme}&step=${step}&paige=${paige}`;
const capture = async name => {
  const fit = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, host: document.querySelector(".agp-host")?.scrollHeight, bodyScroll: scrollY }));
  assert.ok(fit.scroll <= fit.width + 1, JSON.stringify(fit));
  await page.screenshot({ path: path.join(destination, `${name}.png`) });
  frames.push({ name, fit });
};
try {
  for (const theme of process.argv.includes("--paths-only") ? [] : ["light", "dark"]) for (const [width, height] of [[1536,770], [1366,768], [1024,768], [900,1000], [390,844], [320,740]]) {
    for (const paige of width >= 900 ? ["closed", "open"] : ["closed"]) {
      await page.setViewportSize({ width, height });
      await page.goto(route(theme, "document", paige), { waitUntil: "domcontentloaded", timeout:20000 });
      await page.getByRole("heading", { name:"Client services agreement", exact:true }).waitFor({ timeout:20000 });
      await capture(`${width}-${height}-${theme}-${paige}`);
    }
  }
  await page.setViewportSize({ width:1366, height:768 });
  await page.goto(route("light", "register"), { waitUntil:"domcontentloaded" });
  await page.getByRole("button", { name:"New agreement", exact:true }).click();
  await page.getByRole("button", { name:/Business template/ }).click();
  await page.getByRole("button", { name:"Continue to Recipients" }).click();
  await page.getByRole("alert").filter({ hasText:"Select a client" }).waitFor();
  paths.push("Missing client refuses continuation");
  await page.getByLabel("Client", { exact:true }).selectOption("Fern Studio");
  await page.getByRole("button", { name:"Continue to Recipients" }).click();
  await page.getByRole("button", { name:"Continue to Fields" }).click();
  await page.getByRole("button", { name:"Continue to Review" }).click();
  await page.getByRole("alert").filter({ hasText:"required signature" }).waitFor();
  paths.push("Missing assigned signature refuses continuation");
  await page.getByRole("button", { name:"Signature", exact:true }).click();
  await page.getByLabel("Left (%)", { exact:true }).fill("12");
  await page.getByRole("button", { name:"Continue to Review" }).click();
  await page.getByRole("button", { name:"Request authorization", exact:true }).click();
  await page.getByRole("heading", { name:"Awaiting authorization" }).waitFor();
  await capture("approval-pending-light");
  await page.getByRole("button", { name:"Cancel request", exact:true }).click();
  await page.getByRole("button", { name:"Request authorization", exact:true }).click();
  await page.getByRole("button", { name:"Simulate canonical approval", exact:true }).click();
  await page.getByRole("status").filter({ hasText:"No customer message" }).waitFor();
  paths.push("Prepare → pending → cancel → mock approval → same detail; no delivery inferred");
  await page.getByRole("button", { name:"Inspect recipient review path" }).click();
  assert.equal(await page.getByRole("button", { name:"Simulate signing decision", exact:true }).isDisabled(), true);
  await page.getByLabel("I have reviewed the entire document").check();
  await page.getByLabel(/I consent to electronic records/).check();
  await page.getByLabel("Type your full name").fill("Avery Lee");
  await page.getByRole("button", { name:"Simulate signing decision", exact:true }).click();
  await page.getByRole("status").filter({ hasText:"No signature" }).waitFor();
  paths.push("Recipient review/consent/name gating and explicit synthetic decision receipt");
  await page.getByRole("button", { name:"Prepare a new revision" }).click();
  await page.getByRole("button", { name:"Save draft", exact:true }).click();
  await page.reload({ waitUntil:"domcontentloaded" });
  assert.equal(await page.getByLabel("Client", { exact:true }).inputValue(), "Fern Studio");
  paths.push("Synthetic same-business draft reload");
  await page.getByRole("button", { name:"Close preparation" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state:"hidden" });
  assert.equal(await page.getByRole("button", {name:"Close preparation"}).evaluate(el => el === document.activeElement), true);
  paths.push("Leave dialog Escape restores exact keyboard focus");
  const review = page.locator(".agp-review-tools");
  await review.locator("summary").click();
  for (const state of ["loading", "error", "denied", "expired", "offline", "stale", "uncertain", "empty", "ready"]) {
    await review.getByLabel("State", { exact:true }).selectOption(state);
    if (state === "offline") { await page.getByRole("button", { name:"Save draft", exact:true }).click(); await page.getByRole("alert").filter({ hasText:"could not be confirmed" }).waitFor(); }
    await capture(`state-${state}`);
  }
  paths.push("All deterministic refusal/recovery states reachable; uncertain save retains edits");
  await review.getByRole("button", { name:"Switch synthetic business" }).click();
  await review.getByLabel("Path", { exact:true }).selectOption("document");
  assert.equal(await page.getByLabel("Client", { exact:true }).inputValue(), "");
  await review.getByRole("button", { name:"Switch synthetic business" }).click();
  await review.getByLabel("Path", { exact:true }).selectOption("document");
  assert.equal(await page.getByLabel("Client", { exact:true }).inputValue(), "Fern Studio");
  paths.push("Synthetic workspace switch withholds other-business draft and restores original");
  await review.locator("summary").click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button", {name:"Preview document",exact:true}).click();
  await page.getByRole("article", {name:"Draft document preview"}).waitFor();
  await capture("mobile-preview-confirmation");
  await page.getByRole("button", {name:"Return to preparation",exact:true}).click();
  await page.getByLabel("Client", {exact:true}).waitFor();
  await page.getByRole("button",{name:"Continue to Recipients"}).scrollIntoViewIfNeeded();
  assert.ok(await page.locator(".agp-host").evaluate(el => el.scrollTop) > 0);
  paths.push("Mobile preview and return with retained edits; footer reachable in named scroll owner");
  assert.deepEqual(await hashes(), before, "Prototype source changed during capture");
  assert.deepEqual(errors, [], errors.join("\n"));
  await fs.writeFile(path.join(destination,"result.json"), JSON.stringify({ proofClass:"Synthetic local prototype ONLY", frames, paths, sourceSHA256:before, errors, blocked, productionAcceptance:"UNVERIFIED", designDecision:"PENDING actual rendered review" }, null, 2));
  console.log(JSON.stringify({ frames:frames.length, paths, errors, blockedOrigins:[...new Set(blocked)] }));
} catch (e) {
  await page.screenshot({ path:path.join(destination,"failure.png") }).catch(()=>{});
  await fs.writeFile(path.join(destination,"failure.json"), JSON.stringify({ error:String(e), errors, frames, paths, sourceSHA256:before },null,2));
  throw e;
} finally { await browser.close(); }
