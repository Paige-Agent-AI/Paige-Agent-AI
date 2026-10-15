import fs from "node:fs";
import path from "node:path";
import { resolvePlaywright, buildLaunchOptions } from "./live-drive.mjs";
const out = path.resolve("scripts/live-drive/artifacts/sales-domain");
fs.mkdirSync(out, { recursive: true });
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const page = await browser.newPage();
const errors = [], observations = [];
page.on("pageerror", error => errors.push(error.message));
const tabs = ["Overview", "Opportunities", "Pipeline", "Offers", "Terms & Agreements", "Payments", "Performance"];
try {
  for (const theme of ["light", "dark"]) for (const [width, height] of [[1536,770], [1366,768], [1024,768], [900,1000]]) for (const paige of ["closed", "open"]) {
    const name = `${width}-${height}-${theme}-${paige}`;
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:5263/solo/test-account/sales/overview?theme=${theme}&paige=${paige}&billing-fixture=populated`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
    await page.getByRole("button", { name: /DRAFT-fixture/ }).waitFor();
    await page.screenshot({ path: path.join(out, `${name}-overview.png`) });
    for (const label of tabs) {
      const slug = ["overview", "opportunities", "pipeline", "offers", "agreements", "payments", "performance"][tabs.indexOf(label)];
      await page.goto(`http://127.0.0.1:5263/solo/test-account/sales/${slug}?theme=${theme}&paige=${paige}&billing-fixture=populated`, { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: label, exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector(".sales-department-body")?.childElementCount > 0);
      const geometry = await page.evaluate(() => ({
        viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        tabs: [...document.querySelectorAll(".sales-tabs button")].map(element => ({ label: element.textContent, rect: element.getBoundingClientRect().toJSON() })),
        host: document.querySelector("[data-solo-screen-host]").getBoundingClientRect().toJSON(),
        scroll: [...document.querySelectorAll(".sales-department-body,.sales-queue-rows,.sales-context-body,.sales-register-scroll,.so-view,.anr-pane-scroll")].map(element => ({ class: element.className, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY })),
      }));
      observations.push({ name, label, geometry });
      if (geometry.document[0] > width + 1 || geometry.document[1] > height + 1) throw Error(`Document overflow ${name}/${label}`);
      if (geometry.tabs.some(tab => tab.rect.right > width + 1 || tab.rect.bottom > height + 1)) throw Error(`Tab clipping ${name}/${label}`);
      await page.screenshot({ path: path.join(out, `${name}-${label.toLowerCase().replaceAll(/[^a-z]+/g, "-")}.png`) });
    }
    if (paige === "open") continue;
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: /Commercial terms/ }).first().click();
    await page.getByRole("button", { name: "Open Terms & Agreements" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Open Terms & Agreements" }).click();
    if (!page.url().includes("/sales/agreements")) throw Error("Queue failed canonical owner handoff");
    await page.getByRole("tab", { name: "Opportunities", exact: true }).click();
    await page.getByRole("button", { name: "Test discovery", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "New Opportunity", exact: false }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ boundary: "Actual source components and TenantCommandCenterShell with visibly synthetic adapters. Not authenticated/provider/payment proof.", errors, observations }, null, 2));
  if (errors.length) throw Error(errors.join("; "));
  console.log(`PASS ${observations.length} surface geometry cases; 8 source handoff/detail/create-open/close flows`);
} finally {
  fs.writeFileSync(path.join(out, "run-status.json"), JSON.stringify({ errors, observations, timestamp: new Date().toISOString() }, null, 2));
  await browser.close();
}
