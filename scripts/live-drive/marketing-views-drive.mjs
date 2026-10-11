#!/usr/bin/env node
// Solo Marketing department views, rendered for real at every Solo geometry.
//
// WHAT IT PROVES. It mounts the REAL GrowthHub (src/solo/growth2.tsx) with only the Campaigns read,
// the owner-briefs read and the offers read stubbed (scripts/live-drive/harness/marketing-mount), and
// renders every Marketing tab (Lead capture retired into Overview, INT-342) at the four Solo sizes, in both themes,
// with PAIGE docked, expanded and closed, at the content-column widths the shell actually hands this
// surface. For each frame it asserts: no page error, no harness crash, no horizontal overflow inside
// the scroll owner (.campaigns-scroll), no element pushed past its right edge, and no sideways
// document scroll. It also renders first-use, loading, error and read-only states.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions, or the authenticated production surface
// (§32.c). Those stay owed to a session that can drive the deployed app.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5224;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/marketing-views");
const REPO = path.resolve(import.meta.dirname, "../..");
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];
const POSTURES = ["docked", "wide", "closed"];
// DRIVE_TABS=analytics,ads re-runs the frames for only those tabs (the full set takes ~20 min).
const TABS = ["overview", "campaigns", "audience", "content", "email", "ads", "analytics"].filter((tab) => !process.env.DRIVE_TABS || process.env.DRIVE_TABS.split(",").includes(tab));

// Same model as campaigns-nav-fit-drive.mjs (TenantCommandCenterShell.tsx:483, verified there).
function contentWidth(viewport, posture) {
  const overlay = viewport <= 1080;
  const rail = overlay ? 72 : 216;
  if (overlay || posture === "closed") return Math.floor(viewport - rail);
  const paige = posture === "wide" ? Math.max(620, viewport * 0.52) : Math.max(440, viewport * 0.34);
  return Math.floor(viewport - rail - paige);
}

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  if (!ok) console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
}

function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${PORT} is already in use.`)));
    probe.once("listening", () => probe.close(resolve));
    probe.listen(PORT, "127.0.0.1");
  });
}
async function stopTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 300));
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}
// node:http, NOT fetch: fetch honours HTTPS_PROXY and can return a relay page for a dead loopback port.
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

async function open(page, { tab, theme = "light", mode = "populated" }) {
  await page.goto(`${BASE}?tab=${tab}&theme=${theme}&mode=${mode}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".campaigns-scroll, [data-harness-error]", { timeout: 30000 });
}
async function setContentWidth(page, width) {
  await page.addStyleTag({ content: `main.paige-solo{width:${width}px!important;max-width:${width}px!important}` });
  await page.waitForTimeout(150);
  // A width change crosses container queries, and .btn animates every property for 150ms. Measure
  // once those transitions have settled, not mid-collapse (the Overview lazily loads its charts in
  // the same window, so a fixed delay is not enough there).
  await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running").length === 0, null, { timeout: 5000 }).catch(() => {});
}
async function measure(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector(".campaigns-scroll");
    if (!scroll) return null;
    const box = scroll.getBoundingClientRect();
    // A child of a DECLARED horizontal scroller (overflow-x auto/scroll, e.g. the approved desk's
    // growth-loop track) is reachable by design, so it is not "pushed"; those scrollers are listed
    // separately so the exception is visible in the evidence, never silent.
    const scrollers = [...scroll.querySelectorAll("*")].filter((el) => el !== scroll && ["auto", "scroll"].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
    const inScroller = (el) => scrollers.some((sc) => sc !== el && sc.contains(el));
    const pushed = [...scroll.querySelectorAll("*")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > box.right + 1 && !inScroller(el); })
      .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    return {
      crashed: Boolean(document.querySelector("[data-harness-error]")),
      overflowX: scroll.scrollWidth - scroll.clientWidth,
      pushed,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      innerScrollers: scrollers.map((el) => String(el.className).split(" ")[0]),
      // WCAG contrast of the new small text against what is actually painted behind it.
      contrast: (() => {
        const ctx = document.createElement("canvas").getContext("2d");
        const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
        const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
        const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
        let worst = { ratio: 99, what: "" };
        for (const el of document.querySelectorAll(".mov-sum, .mov-k, .mov-s, .mov-head p, .mov-src h3, .mov-srcrow span:first-child, .mov-n, .mov-rate, .mov-lnk, .mov-att small, .mov-cp-s, .mov-cp-m, .mov-cp-r, .mov-foot, .mov-note, .mov-lead-main small, .mov-moved p, .mov-chart text, .mk-flag, .mk-row-main small, .mk-stat dt, .mk-stat span, .mk-view .mk-link, .mk-view .btn-g, .mo-stat h3, .mo-delta, .mo .mo-link, .mo-keys span, .mo-keys em, .mo-note, .mo-panel-head p, .mo-head p, .mp-list-main small, .mp-facts dt, .mp-facts dd small, .mo-task-main small, .mo-rank-name, .mo-next p, .mo-donut-center span, .mo-ask, .mo-readout, .ma-share-row em, .ma-share-row b, .ma-growth-badge, .ma-next p, .ma-group small, .me-starters small, .me-total span, .me-name small, .me-cell small, .me-kind, .me-activity time, .me-auto-empty p, .me-table thead th, .mva-step-l small, .mva-step-t, .mva-bar em, .mva-row-t small, .mva-cov-l span, .mva-sub, .mva .pill-n, .mva-cap, .mva .mov-foot code, .mva-kpi-h, .mva-kpi-f, .mva-kpi-d, .mva-legend li, .mva-heat-x, .mva-heat-y, .mva-heat-key, .mva .mo-keys span, .mva .mo-keys em, .mad .pill-n, .mad-prov-b small, .mad-row-b small, .mad-nums dt, .mad-nums dd, .mad-plan, .mad-plan small, .mad-prev-h small, .mad-cta, .mad-meta small, .mad-note, .mad-empty p, .mad .campaigns-segmented button, .mad-missing, .mad-cta.is-missing, .mad-ini, .mct-sum, .mct .campaigns-segmented button, .mct-n, .mct-note, .mct-kind, .mct-meta small, .mct-cover small, .mct-cover span, .mct-cover em, .mct-words, .mct-foot, .mct-pub dt, .mct-missing, .mct .mo-keys span, .mct .mo-keys em, .mct-facts, .mct-asked span, .mct-act-note, .mct-pub-h p, .mct-channels, .mct-ad i, .mct-adfull small")) {
          const fg = rgb(getComputedStyle(el).color), bg = bgOf(el);
          const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (hi + 0.05) / (lo + 0.05);
          if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${el.className || el.tagName}:${el.textContent.trim().slice(0, 24)}` };
        }
        return worst;
      })(),
      // The Vibe Studio launcher must contain its own label (a collapsed launcher shows only the icon).
      launcherSpills: (() => { const b = document.querySelector(".campaigns-studio"); return b ? b.scrollWidth > b.clientWidth + 1 : false; })(),
      heading: document.querySelector(".campaigns-scroll h2, .campaigns-scroll .mk-command p, .campaigns-scroll .mo-head p")?.textContent?.trim().slice(0, 60) ?? "",
    };
  });
}

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  const geometry = [];
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { ready = await probeOnce(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);
    browser = await chromium.launch(buildLaunchOptions());
    const warm = await browser.newPage(); await open(warm, { tab: "overview" }); await warm.close();

    // DRIVE_ONLY=flows re-runs only the retired-address and form-panel flows (the frames take ~20 min).
    const only = process.env.DRIVE_ONLY;
    for (const theme of only === "flows" ? [] : ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const posture of POSTURES) {
          const width = contentWidth(frame.width, posture);
          // Reduced motion so the Overview charts paint their final state, not a frame of their entrance.
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          for (const tab of TABS) {
            const page = await ctx.newPage();
            const errors = [];
            page.on("pageerror", (e) => errors.push(String(e.message)));
            await open(page, { tab, theme });
            await setContentWidth(page, width);
            // Overview's one chart is inline SVG: wait for its line.
            if (tab === "overview") await page.waitForSelector(".mov-line", { timeout: 15000 }).catch(() => {});
            // Audience: the composition donut, the stage bars and the growth area also load lazily.
            if (tab === "audience") await page.waitForFunction(() => document.querySelector(".ma .mo-donut .recharts-pie-sector") && document.querySelector(".ma-chart-stages .recharts-bar-rectangle") && document.querySelector(".ma-chart-growth .recharts-area-area"), null, { timeout: 15000 }).catch(() => {});
            // Analytics: the leads chart, the rings and the email chart load lazily.
            if (tab === "analytics") await page.waitForFunction(() => document.querySelector(".mva-chart-trend .recharts-bar-rectangle") && document.querySelectorAll(".mva .mo-donut .recharts-pie-sector").length >= 3 && document.querySelector(".mva-ch-chart .recharts-area-curve"), null, { timeout: 15000 }).catch(() => {});
            // Email: the rate chart loads lazily too.
            if (tab === "email") await page.waitForFunction(() => document.querySelector(".me-chart-rates .recharts-area-curve"), null, { timeout: 15000 }).catch(() => {});
            const id = `${theme}/${frame.name}/paige-${posture}@${width}px/${tab}`;
            const m = await measure(page);
            check(Boolean(m) && !m.crashed, `${id}: renders`);
            if (m) {
              check(errors.length === 0, `${id}: no page errors`, errors[0] ?? "");
              check(m.overflowX <= 0, `${id}: no horizontal overflow in the scroll owner`, `overflow=${m.overflowX}px`);
              // Populated fixtures must render populated: a failed read here is a harness or code defect.
              const failed = await page.evaluate(() => [...document.querySelectorAll(".campaigns-scroll h2, .campaigns-scroll h3")].map((h) => h.textContent ?? "").filter((t) => /could not load/.test(t)));
              check(failed.length === 0, `${id}: every read lands (no error state on populated data)`, failed.join(" | "));
              if (tab === "ads") {
                const drawn = await page.evaluate(() => ({ sum: document.querySelector(".mad .mov-sum")?.textContent ?? "", views: document.querySelectorAll('.mad .campaigns-segmented button').length, prov: Boolean(document.querySelector(".mad-prov")), nums: [...document.querySelectorAll(".mad-nums dd")].map((dd) => dd.textContent), plan: document.querySelector(".mad-plan")?.textContent ?? "", h1: document.querySelectorAll(".campaigns-scroll h1:not(.campaigns-sr-only)").length }));
                check(/nothing here is estimated/.test(drawn.sum) && /3 ad copy drafts/.test(drawn.sum) && drawn.views === 5 && drawn.prov && drawn.nums.every((n) => n === "—") && /About \$2,000 for April/.test(drawn.plan) && drawn.h1 === 0, `${id}: the desk opens on nothing estimated, five views, the provider strip, a ghost spend card and the brief's budget quoted as a plan`, JSON.stringify(drawn));
              }
              if (tab === "content") {
                await page.waitForFunction(() => [...document.querySelectorAll(".mct-frame img")].every((img) => img.complete), null, { timeout: 5000 }).catch(() => {});
                const drawn = await page.evaluate(() => ({ first: document.querySelector(".mct > section h2")?.textContent ?? "", cards: document.querySelectorAll(".mct-card").length, pictures: [...document.querySelectorAll(".mct-frame img")].filter((img) => img.naturalWidth > 0).length, covers: document.querySelectorAll(".mct-cover").length, words: document.querySelectorAll(".mct-words").length, ads: document.querySelectorAll(".mct-ad").length, ring: Boolean(document.querySelector(".mct-ring")), pub: [...document.querySelectorAll(".mct-pub dd")].map((dd) => dd.textContent), sum: document.querySelector(".mct .mov-sum")?.textContent ?? "", missing: document.querySelectorAll(".mct-missing").length, h1: document.querySelectorAll(".campaigns-scroll h1:not(.campaigns-sr-only)").length }));
                check(drawn.first === "Your library" && drawn.cards === 11 && drawn.pictures === 3 && drawn.covers === 2 && drawn.words === 6 && drawn.ads === 2 && drawn.ring && drawn.pub.length === 3 && /11 pieces in your library/.test(drawn.sum) && drawn.missing === 0 && drawn.h1 === 0, `${id}: the gallery leads and draws every piece as itself (three pictures, two document covers, six pieces of copy, the two with labels laid out as ads) with the mix ring and published work`, JSON.stringify(drawn));
              }
              if (tab === "email") {
                const drawn = await page.evaluate(() => ({ stats: document.querySelectorAll(".me-stats > *").length, starters: document.querySelectorAll(".me-starters button").length, rows: document.querySelectorAll(".me-table tbody tr").length, rates: Boolean(document.querySelector(".me-chart-rates .recharts-area-curve")) }));
                check(drawn.stats === 5 && drawn.starters === 6 && drawn.rows > 0 && drawn.rates, `${id}: five figures, six ways to start, the campaigns table and the rate chart are drawn`, JSON.stringify(drawn));
              }
              check(m.pushed.length === 0, `${id}: nothing pushed past the right edge`, m.pushed.join(","));
              check(!m.sideways, `${id}: document does not scroll sideways`);
              check(!m.launcherSpills, `${id}: the Vibe Studio launcher contains its label`);
              if (tab === "overview") {
                const drawn = await page.evaluate(() => ({ nodes: document.querySelectorAll(".mov-node").length, broken: document.querySelectorAll(".mov-node.is-broken").length, line: Boolean(document.querySelector(".mov-line")?.getAttribute("d")), cards: document.querySelectorAll(".mov-cp").length, leads: document.querySelectorAll(".mov-leads li").length, h1: document.querySelectorAll(".campaigns-scroll h1:not(.campaigns-sr-only)").length }));
                check(drawn.nodes === 4 && drawn.broken === 1 && drawn.line && drawn.cards === 4 && drawn.leads === 6 && drawn.h1 === 0, `${id}: the chain (one broken link), the lead line, four capture points and six recent leads are drawn, with no page title`, JSON.stringify(drawn));
              }
              if (tab === "analytics") {
                const drawn = await page.evaluate(() => ({ kpis: document.querySelectorAll(".mva-kpi").length, sparks: document.querySelectorAll(".mva-kpi .mva-spark").length, trend: document.querySelectorAll(".mva-chart-trend .recharts-bar-rectangle").length, rings: document.querySelectorAll(".mva .mo-donut .recharts-pie-sector").length, steps: document.querySelectorAll(".mva-step").length, bars: [...document.querySelectorAll(".mva-bar i")].filter((i) => i.getBoundingClientRect().width > 0).length, heat: document.querySelectorAll(".mva-heat i.is-on").length, emailChart: Boolean(document.querySelector(".mva-ch-chart .recharts-area-curve")), capture: document.querySelectorAll(".mva-cap-row").length, channels: document.querySelectorAll(".mva-ch li").length, adsRow: [...document.querySelectorAll(".mva-ch li")].some((li) => /Ad accounts|Open Ads/.test(li.textContent ?? "")), paidNote: document.querySelector("[aria-labelledby='mva-ch-h'] .mov-foot")?.textContent ?? "", email: document.querySelector(".mva-ch li small")?.textContent ?? "", leads: document.querySelector(".mva-kpi .mva-kpi-v")?.textContent ?? "", firstStep: document.querySelector(".mva-step .mva-n")?.textContent ?? "", ring: document.querySelector("[aria-labelledby='mva-out-h'] .mo-donut-center strong")?.textContent ?? "", serverReads: globalThis.__marketingMetricReads ?? 0, h1: document.querySelectorAll(".campaigns-scroll h1:not(.campaigns-sr-only)").length }));
                check(drawn.kpis === 5 && drawn.sparks === 5 && drawn.trend > 0 && drawn.rings >= 3 && drawn.steps === 4 && drawn.bars === 4 && drawn.heat > 0 && drawn.emailChart && drawn.capture > 0 && drawn.channels === 3 && !drawn.adsRow && /paid ones included/.test(drawn.paidNote) && /sent ·/.test(drawn.email) && drawn.serverReads >= 8 && drawn.leads !== "" && drawn.firstStep === drawn.leads && drawn.ring === drawn.leads && drawn.h1 === 0, `${id}: five figures with sparklines, the leads chart, three rings, the funnel, the heatmap, the email chart and three channels (no Ads row; paid leads pointed to Source mix) are drawn, the headline and funnel are the server's count and agree with the outcome ring when the read is complete, with no page title`, JSON.stringify(drawn));
              }
              if (tab === "audience") {
                const drawn = await page.evaluate(() => ({ donut: Boolean(document.querySelector(".ma .mo-donut .recharts-pie-sector")), stages: document.querySelectorAll(".ma-chart-stages .recharts-bar-rectangle").length, growth: Boolean(document.querySelector(".ma-chart-growth .recharts-area-area")), stats: document.querySelectorAll(".ma-stats > *").length }));
                check(drawn.donut && drawn.stages > 0 && drawn.growth && drawn.stats === 6, `${id}: six figures, the composition donut, the stage bars and the growth area are drawn`, JSON.stringify(drawn));
              }
              check(m.contrast.ratio >= 4.5, `${id}: new small text meets AA (4.5:1)`, `worst ${m.contrast.ratio} ${m.contrast.what}`);
              geometry.push({ id, width, overflowX: m.overflowX, innerScrollers: m.innerScrollers, worstContrast: m.contrast });
            }
            if (posture !== "wide" && frame.name !== "1024x768") {
              await page.screenshot({ path: path.join(OUT, `${tab}-${theme}-${frame.name}-${posture}.png`) });
            }
            await page.close();
          }
          await ctx.close();
        }
      }
    }

    // States, at the ordinary 1366 docked session, both themes.
    for (const theme of only === "flows" ? [] : ["light", "dark"]) {
      for (const mode of ["first", "loading", "error", "readonly"]) {
        for (const tab of ["overview", "analytics", "audience", "content", "email", "ads"]) {
          const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          await open(page, { tab, theme, mode });
          await setContentWidth(page, contentWidth(1366, "docked"));
          const id = `${theme}/state-${mode}/${tab}`;
          const m = await measure(page);
          check(Boolean(m) && !m.crashed && errors.length === 0, `${id}: renders without error`, errors[0] ?? "");
          if (m) check(m.overflowX <= 0 && !m.sideways, `${id}: no overflow`);
          const text = await page.evaluate(() => document.querySelector(".campaigns-scroll")?.textContent ?? "");
          if (mode === "error") check(/could not load/.test(text), `${id}: a failed read says so`);
          if (mode === "loading") check(await page.$(".campaigns-skeleton") !== null, `${id}: loading shows a skeleton`);
          if (mode === "readonly" && tab === "analytics") {
            // A member is refused the server figures, so the page keeps the counts from its own records.
            const member = await page.evaluate(() => ({ leads: document.querySelector(".mva-kpi .mva-kpi-v")?.textContent ?? "", reads: globalThis.__marketingMetricReads ?? 0 }));
            check(member.leads !== "" && member.reads > 0, `${id}: the server refuses a member and the page keeps its own counts`, JSON.stringify(member));
          }
          if (mode === "readonly" && tab === "overview") check(!/New campaign brief|Route it|Route the forms|Finish in Vibe/.test(text), `${id}: no create, route or finish act for a read-only member`);
          if (mode === "first" && tab === "overview") {
            check(/Nothing is being marketed yet/.test(text) && /Three steps to your first lead/.test(text), `${id}: first use is guided`);
            check((await page.$$(".btn-g")).length === 1, `${id}: exactly one gold act`);
          }
          await page.screenshot({ path: path.join(OUT, `state-${mode}-${tab}-${theme}.png`) });
          await ctx.close();
        }
      }
    }

    // A full read: the server counts every lead in the range; the record-drawn parts stay floors and the page says so.
    for (const theme of only === "flows" ? [] : ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      await open(page, { tab: "analytics", theme, mode: "full" });
      await setContentWidth(page, contentWidth(1366, "docked"));
      await page.waitForFunction(() => document.querySelector(".mva .mo-donut-center strong"), null, { timeout: 15000 }).catch(() => {});
      const id = `${theme}/state-full/analytics`;
      const full = await page.evaluate(() => ({ leads: document.querySelector(".mva-kpi .mva-kpi-v")?.textContent ?? "", firstStep: document.querySelector(".mva-step .mva-n")?.textContent ?? "", ring: document.querySelector("[aria-labelledby='mva-out-h'] .mo-donut-center strong")?.textContent ?? "", cap: document.querySelector(".mva-cap")?.textContent ?? "", sum: document.querySelector(".mva .mov-sum")?.textContent ?? "" }));
      check(errors.length === 0 && full.leads === "340" && full.firstStep === "340" && /^340 leads in/.test(full.sum) && full.ring === "200+" && /count every lead in this range/.test(full.cap) && /so their counts are floors/.test(full.cap), `${id}: the headline, funnel and summary count all 340 leads; the outcome ring stays a floor (200+) and the note says which is which`, JSON.stringify(full));
      const m = await measure(page);
      if (m) check(m.overflowX <= 0 && !m.sideways, `${id}: no overflow`);
      await page.screenshot({ path: path.join(OUT, `state-full-analytics-${theme}.png`), fullPage: false });
      await page.evaluate(() => document.querySelector(".mva-cap")?.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(OUT, `state-full-analytics-note-${theme}.png`) });
      await ctx.close();
    }

    // Retired addresses and the one form panel, both themes, at the ordinary 1366 docked session.
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      await open(page, { tab: "lead-capture?type=form", theme });
      await setContentWidth(page, contentWidth(1366, "docked"));
      const notice = await page.textContent(".mov-moved").catch(() => "");
      check(/Lead capture moved here/.test(notice ?? ""), `${theme}/moved: an old Lead capture link lands on Overview and says so`);
      const pressed = await page.evaluate(() => document.querySelector('#mov-capture [aria-pressed="true"]')?.textContent);
      check(pressed === "Forms", `${theme}/moved: its form filter is kept`, String(pressed));
      await page.screenshot({ path: path.join(OUT, `flow-moved-${theme}.png`) });
      await page.locator("button.mov-cp", { hasText: "Scorecard opt-in" }).click();
      await page.waitForSelector(".campaigns-drawer", { timeout: 5000 }).catch(() => {});
      const panel = await page.textContent(".campaigns-drawer").catch(() => "");
      check(/Not routed: no pipeline, no alert/.test(panel ?? "") && /When someone submits/.test(panel ?? ""), `${theme}/form panel: an unrouted form opens its routing and submissions`);
      await page.screenshot({ path: path.join(OUT, `flow-form-panel-${theme}.png`) });
      await page.keyboard.press("Escape");
      const closed = await page.$(".campaigns-drawer");
      check(!closed, `${theme}/form panel: Escape closes it`);
      // Analytics: the range moves every figure and stays in the address; a capture point opens its form panel.
      await open(page, { tab: "analytics", theme });
      await setContentWidth(page, contentWidth(1366, "docked"));
      await page.locator(".mva .campaigns-segmented button", { hasText: "Week" }).click();
      const week = await page.evaluate(() => ({ sum: document.querySelector(".mva .mov-sum")?.textContent ?? "", pressed: document.querySelector('.mva .campaigns-segmented [aria-pressed="true"]')?.textContent, email: document.querySelector(".mva-ch li small")?.textContent ?? "" }));
      check(/last 7 days/.test(week.sum) && week.pressed === "Week" && /sent ·/.test(week.email), `${theme}/analytics: Week moves the summary and the email row to 7 days`, JSON.stringify(week));
      await page.screenshot({ path: path.join(OUT, `flow-analytics-week-${theme}.png`) });
      await page.locator(".mva-cap-row", { hasText: "Scorecard opt-in" }).click();
      await page.waitForSelector(".campaigns-drawer", { timeout: 5000 }).catch(() => {});
      const opened = await page.textContent(".campaigns-drawer").catch(() => "");
      check(/Scorecard opt-in/.test(opened ?? "") && /When someone submits/.test(opened ?? ""), `${theme}/analytics: a capture point opens that form's panel`);
      // Ads: Creative previews each saved ad; the view stays in the address.
      await open(page, { tab: "ads", theme });
      await setContentWidth(page, contentWidth(1366, "docked"));
      await page.locator(".mad .campaigns-segmented button", { hasText: "Creative" }).click();
      const creative = await page.evaluate(() => ({ cards: document.querySelectorAll(".mad-card").length, first: document.querySelector(".mad-prev-f")?.textContent ?? "" }));
      check(creative.cards === 3 && /Plan your quarter in 30 minutes/.test(creative.first), `${theme}/ads: Creative previews each saved ad with its headline and call to action`, JSON.stringify(creative));
      await page.screenshot({ path: path.join(OUT, `flow-ads-creative-${theme}.png`) });
      // Content: every control in the preview is live (the drawer must not sit inside the region it makes
      // inert); a document prints whole; an image downloads; the filter keeps to one kind.
      await open(page, { tab: "content", theme });
      await setContentWidth(page, contentWidth(1366, "docked"));
      const openPiece = async (name, ready) => {
        // The first open loads the Studio renderer; in the dev harness Vite may reload the page once while
        // it prepares that code, so open again if the panel was lost.
        for (let attempt = 0; attempt < 3; attempt++) {
          await page.locator(".mct-card", { hasText: name }).click();
          if (await page.waitForSelector(ready, { timeout: 8000, state: "attached" }).catch(() => null)) return true;
          await page.waitForSelector(".mct-card", { timeout: 15000 }).catch(() => {});
        }
        return false;
      };
      await openPiece("Spring advisory offer", ".campaigns-drawer [data-paige-doc-sheet]");
      const docPanel = await page.evaluate(() => ({ wide: document.querySelector(".campaigns-drawer")?.getBoundingClientRect().width ?? 0, inert: Boolean(document.querySelector(".campaigns-drawer")?.closest("[inert]")), focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName, acts: [...document.querySelectorAll(".campaigns-detail-actions .btn")].map((b) => b.textContent), facts: document.querySelector(".mct-facts")?.textContent ?? "" }));
      check(docPanel.wide > 600 && !docPanel.inert && docPanel.focus === "Close details" && docPanel.acts.join("|") === "Print / Save as PDF|Revise with PAIGE" && /^Document · Sales offer/.test(docPanel.facts), `${theme}/content: a document opens wide and live (not inert, focus on Close), with Print / Save as PDF beside Revise`, JSON.stringify(docPanel));
      await page.screenshot({ path: path.join(OUT, `flow-content-document-${theme}.png`) });
      // Print: the same class the button sets, then the page as a PDF; the whole document must be in it.
      await page.evaluate(() => document.documentElement.classList.add("paige-doc-printing"));
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ format: "Letter", printBackground: true });
      await page.emulateMedia({ media: "screen" });
      await page.evaluate(() => document.documentElement.classList.remove("paige-doc-printing"));
      const pdfPath = path.join(OUT, `flow-content-print-${theme}.pdf`);
      fs.writeFileSync(pdfPath, pdf);
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      check(pages >= 2, `${theme}/content: Print / Save as PDF carries the whole long document, not one clipped page`, `pages=${pages}`);
      await page.locator(".campaigns-drawer button[aria-label='Close details']").click({ timeout: 5000 }).catch(() => {});
      check(!(await page.$(".campaigns-drawer")), `${theme}/content: the Close button closes the preview`);
      await openPiece("Spring workshop hero", ".mct-full img");
      await page.waitForFunction(() => { const img = document.querySelector(".mct-full img"); return img && img.complete && img.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
      const download = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
      await page.locator(".campaigns-detail-actions button", { hasText: "Download" }).click({ timeout: 5000 }).catch(() => {});
      const file = await download;
      const imgPanel = await page.evaluate(() => ({ img: (document.querySelector(".mct-full img")?.naturalWidth ?? 0) > 0, acts: [...document.querySelectorAll(".campaigns-detail-actions .btn")].map((b) => b.textContent), note: document.querySelector(".mct-act-note")?.textContent ?? "" }));
      check(imgPanel.img && imgPanel.acts.join("|") === "Download|Open full size|Revise with PAIGE" && Boolean(file) && /\.svg$/.test(file?.suggestedFilename() ?? "") && imgPanel.note === "Download started.", `${theme}/content: an image opens full size and Download really downloads it`, JSON.stringify({ ...imgPanel, file: file?.suggestedFilename() ?? null }));
      await page.screenshot({ path: path.join(OUT, `flow-content-image-${theme}.png`) });
      await page.keyboard.press("Escape");
      await page.locator(".mct .campaigns-segmented button", { hasText: "Documents" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".mct-card").length === 2, null, { timeout: 5000 }).catch(() => {});
      const filtered = await page.evaluate(() => ({ cards: document.querySelectorAll(".mct-card").length, covers: document.querySelectorAll(".mct-cover").length, pressed: document.querySelector('.mct .campaigns-segmented [aria-pressed="true"]')?.textContent ?? "" }));
      check(filtered.cards === 2 && filtered.covers === 2 && /^Documents/.test(filtered.pressed), `${theme}/content: Documents shows only documents`, JSON.stringify(filtered));
      check(errors.length === 0, `${theme}/flows: no page errors`, errors[0] ?? "");
      await ctx.close();
    }

    // Keyboard: the Overview's act is reachable by Tab and shows a visible focus indicator.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      await open(page, { tab: "overview" });
      let found = false;
      for (let i = 0; i < 40 && !found; i++) {
        await page.keyboard.press("Tab");
        found = await page.evaluate(() => document.activeElement?.textContent?.includes("New campaign brief") ?? false);
      }
      check(found, "keyboard: New campaign brief is reachable by Tab");
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
      check(ring, "keyboard: focused act shows a focus indicator");
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopTree(vite);
  }
  if (process.env.DRIVE_ONLY !== "flows") fs.writeFileSync(path.join(OUT, "geometry.json"), JSON.stringify(geometry, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1; else console.log(`frames written to ${OUT}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
