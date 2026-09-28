#!/usr/bin/env node
/**
 * Drives the real local Paige application through the signed-out Solo Beta acquisition surfaces.
 * This is rendered public-flow evidence, not authenticated, database, or Stripe provider proof.
 */
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SOLO_BETA_URL || "http://127.0.0.1:4173";
const OUT = path.resolve("scripts/live-drive/artifacts/solo-beta-acquisition");
const VIEWPORTS = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];
const THEMES = ["light", "dark"];
const CANONICAL_SIGNUP = "/auth?mode=signup&plan=solo&billing=monthly";
const failures = [];
const observations = [];
const record = (ok, message, detail = undefined) => {
  (ok ? observations : failures).push({ message, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "OK" : "FAIL"} ${message}`);
};

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("body").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(800);
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const interactive = [...document.querySelectorAll("a[href],button")]
      .filter((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      })
      .map((node) => ({
        text: (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim(),
        href: node instanceof HTMLAnchorElement ? node.getAttribute("href") : null,
        bottom: Math.round(node.getBoundingClientRect().bottom),
      }));
    const runningAnimations = document.getAnimations().filter((animation) => animation.playState === "running");
    const animations = runningAnimations.map((animation) => {
      const target = animation.effect?.target;
      return {
        animationName: target instanceof Element ? getComputedStyle(target).animationName : "",
        className: target instanceof Element ? target.className : "",
        tag: target instanceof Element ? target.tagName : "",
      };
    });
    return {
      title: document.title,
      body: document.body.innerText.replace(/\s+/g, " ").trim(),
      interactive,
      animations,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "",
      htmlClass: document.documentElement.className,
      viewportHeight: window.innerHeight,
    };
  });
}

async function checkFocus(page, label) {
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement)) return null;
    const style = getComputedStyle(node);
    return {
      tag: node.tagName,
      text: (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim(),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  const visible = Boolean(focus && (focus.outlineStyle !== "none" && focus.outlineWidth !== "0px" || focus.boxShadow !== "none"));
  record(visible, `${label}: first keyboard target has visible focus`, focus);
}

const { chromium } = await resolvePlaywright();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(resolveExecutablePath() ? { executablePath: resolveExecutablePath() } : {}),
});
mkdirSync(OUT, { recursive: true });

try {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport,
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      // Rendered/UI evidence only: provider readiness is separately PROOF OWED.
      // This response exercises the exact safe public contract without exposing
      // or pretending to create Stripe objects.
      await context.route("**/functions/v1/solo-beta-offer-status", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          offer: { name: "Paige Solo Beta", unit_amount_cents: 7450, currency: "usd", interval: "month", interval_count: 1, trial_days: 30 },
        }),
      }));
      await context.addInitScript((selectedTheme) => localStorage.setItem("theme", selectedTheme), theme);
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await settle(page);
      await page.getByRole("button", { name: /Start your 30-day trial/i }).waitFor({ state: "visible", timeout: 20_000 });
      const pricing = await pageFacts(page);
      const prefix = `${theme} ${viewport.name} pricing`;
      record(!pricing.horizontalOverflow, `${prefix}: no horizontal overflow`);
      record(/\$74\.50/.test(pricing.body) && /Paige Solo Beta/i.test(pricing.body), `${prefix}: approved Solo Beta offer is visible`);
      record(/30-day trial/i.test(pricing.body) && !/\$149|14-day|no trial/i.test(pricing.body), `${prefix}: exact 30-day trial replaces obsolete offers`);
      const unsupportedActions = pricing.interactive.filter(({ text, href }) =>
        /(agency|enterprise|platform operator|client portal|subaccount)/i.test(`${text} ${href || ""}`));
      record(unsupportedActions.length === 0, `${prefix}: no unsupported enrollment action`, unsupportedActions);
      const soloActions = pricing.interactive.filter(({ text }) => /Start your 30-day trial/i.test(text));
      record(soloActions.length === 1, `${prefix}: exactly one Solo continuation action is present`, soloActions);
      record(pricing.animations.length === 0, `${prefix}: reduced motion leaves no running animation`, { animations: pricing.animations });
      record(!/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(pricing.viewportMeta), `${prefix}: zoom is not disabled`, { viewportMeta: pricing.viewportMeta });
      await checkFocus(page, prefix);
      await page.screenshot({ path: path.join(OUT, `pricing-${theme}-${viewport.name}.png`), fullPage: true });

      await page.getByRole("button", { name: /Start your 30-day trial/i }).click({ noWaitAfter: true });
      await page.waitForURL((url) => url.pathname === "/auth" && url.searchParams.get("mode") === "signup", { timeout: 15_000 });
      record(page.url().includes(CANONICAL_SIGNUP), `${prefix}: the real CTA reaches canonical paid Solo signup`, { finalUrl: new URL(page.url()).pathname + new URL(page.url()).search });

      await settle(page);
      const auth = await pageFacts(page);
      const authPrefix = `${theme} ${viewport.name} auth`;
      record(!auth.horizontalOverflow, `${authPrefix}: no horizontal overflow`);
      record(/Solo Beta/i.test(auth.body) && /30-day trial/i.test(auth.body) && /\$74\.50\/month/i.test(auth.body), `${authPrefix}: signup names the exact trial and renewal offer`);
      record(!/\$149|14-day|no trial|create.*agency|create.*portal/i.test(auth.body), `${authPrefix}: no obsolete or unsupported signup promise`);
      record(auth.interactive.some(({ text }) => /Create Solo Beta account/i.test(text)), `${authPrefix}: one truthful primary signup action is present`);
      const countrySelector = page.locator("#mobile-country");
      record(await countrySelector.inputValue() === "US", `${authPrefix}: phone country defaults to United States`);
      record(await countrySelector.locator("option").count() > 200, `${authPrefix}: international phone-country choices are available`);
      await page.locator("#mobile").fill("4244575247");
      record(await page.locator("#mobile").inputValue() === "4244575247", `${authPrefix}: ordinary US number entry does not require +1`);
      const signupAction = auth.interactive.find(({ text }) => /Create Solo Beta account/i.test(text));
      record(Boolean(signupAction && signupAction.bottom <= auth.viewportHeight), `${authPrefix}: primary signup action fits in the initial viewport`, { signupAction, viewportHeight: auth.viewportHeight });
      record(auth.animations.length === 0, `${authPrefix}: reduced motion leaves no running animation`, { animations: auth.animations });
      await checkFocus(page, authPrefix);
      await page.screenshot({ path: path.join(OUT, `auth-${theme}-${viewport.name}.png`), fullPage: true });
      record(pageErrors.length === 0, `${theme} ${viewport.name}: no uncaught page errors`, pageErrors);
      await context.close();
    }
  }

  const unavailableContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await unavailableContext.route("**/functions/v1/solo-beta-offer-status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ available: false }),
  }));
  const unavailablePage = await unavailableContext.newPage();
  await unavailablePage.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await settle(unavailablePage);
  const unavailableFacts = await pageFacts(unavailablePage);
  record(/Enrollment is not open yet/i.test(unavailableFacts.body), "pricing unavailable: exact offer not ready has a truthful intentional state");
  record(!unavailableFacts.interactive.some(({ text }) => /Start your 30-day trial/i.test(text)), "pricing unavailable: enrollment action is absent");
  await unavailableContext.close();

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await settle(page);
  // The public site's acts are real links (they work without JS and on middle-click), not buttons.
  await page.getByRole("link", { name: "Hire Paige", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  const home = await pageFacts(page);
  const acquisitionLinks = home.interactive.filter(({ text, href }) =>
    /(start|get started|join|signup|sign up|trial|beta)/i.test(`${text} ${href || ""}`));
  const unsupportedHome = acquisitionLinks.filter(({ text, href }) =>
    /(agency|enterprise|platform|portal|subaccount|premium|legacy)/i.test(`${text} ${href || ""}`));
  record(unsupportedHome.length === 0, "homepage: no unsupported acquisition action", unsupportedHome);
  record(acquisitionLinks.length > 0, "homepage: meaningful acquisition actions are present", acquisitionLinks);
  for (const label of [{ name: "Hire Paige", exact: true }, { name: /Start your 30-day trial/i }]) {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.getByRole("link", label).first().click({ noWaitAfter: true });
    await page.waitForURL((url) => url.pathname === "/auth" && url.searchParams.get("mode") === "signup", { timeout: 15_000 });
    record(page.url().includes(CANONICAL_SIGNUP), `homepage ${label.name}: reaches canonical paid Solo signup`, { finalUrl: new URL(page.url()).pathname + new URL(page.url()).search });
  }

  for (const route of ["/premium", "/legacy", "/get-started", "/signup/coach-qualify"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const recovered = new URL(page.url());
    const safe = recovered.pathname === "/" || recovered.pathname === "/pricing" || recovered.pathname === "/auth";
    record(safe && recovered.pathname !== "/app", `${route}: legacy public entry recovers to the Solo acquisition flow`, { finalUrl: recovered.pathname + recovered.search });
  }

  for (const state of ["cancelled", "failed", "expired", "recovery"]) {
    await page.goto(`${BASE}/welcome?checkout=${state}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const facts = await pageFacts(page);
    record(!/Payment confirmed/i.test(facts.body), `checkout ${state}: never claims unverified payment confirmation`);
    record(facts.interactive.some(({ text, href }) => /sign in|try|retry|return|support|pricing|Solo/i.test(`${text} ${href || ""}`)), `checkout ${state}: has a viable recovery action`, facts.interactive);
  }
  await context.close();
} finally {
  await browser.close();
}

const report = { base: BASE, generatedAt: new Date().toISOString(), observations, failures };
writeFileSync(path.join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ checks: observations.length + failures.length, failures: failures.length }, null, 2));
process.exitCode = failures.length ? 1 : 0;
