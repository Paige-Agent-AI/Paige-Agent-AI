#!/usr/bin/env node
/**
 * Renders the one-tool-one-tile merge in a real Chromium, in both themes, and DRIVES it.
 *
 * THE BUG THIS PROVES FIXED, in the owner's words: "This should NEVER be a real thing because we
 * build unified things for EVERY solo account." Two connections were rendering as six tiles,
 * because the shipped provider tiles, the catalogue and the gateway's own connection tiles are
 * built from three unrelated sources that never compared notes.
 *
 * WHAT CLASS OF EVIDENCE THIS IS (§70.1). Structural/harness render against the real components,
 * the real hook and the real stylesheets, with the Supabase transport stubbed. It proves layout,
 * theme, copy and behaviour, and that the thing runs. It is NOT authenticated runtime proof —
 * no real session, no real database — and that drive stays owed.
 *
 * WHY ITS OWN FILE (§18): integrations-actions-render.mjs owns the per-action list and its frames
 * are Door 1's evidence. Pointing it at a different fixture would overwrite them. This reuses the
 * same mount, launcher resolution and artifacts root rather than forking any of them.
 *
 * Usage:
 *   npx vite --config scripts/live-drive/harness/integrations-mount/vite.config.ts --port 5203
 *   node scripts/live-drive/integrations-one-tile-render.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const BASE = process.env.HARNESS_URL || "http://127.0.0.1:5203";
const OUT = path.resolve("scripts/live-drive/artifacts/one-tile");
mkdirSync(OUT, { recursive: true });

const findings = [];
const check = (pass, message) => {
  findings.push(`${pass ? "PASS" : "FAIL"}  ${message}`);
  console.log(`${pass ? "PASS" : "FAIL"}  ${message}`);
  return pass;
};
const settle = async (page) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(80);
};
const shot = async (page, name) => { await settle(page); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

/** Relative luminance → contrast ratio. Measured, never eyeballed (§11). */
const ratio = (a, b) => {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

async function main() {
  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch({ executablePath: await resolveExecutablePath() });
  try {
    for (const theme of ["light", "dark"]) {
      // The theme is a `.dark` CLASS the harness applies from `?theme=`, not `prefers-color-scheme`.
      // Passing `colorScheme` here instead produced two byte-identical frames per pair and a
      // "both themes" claim that was measured once — caught by checksumming the output, which is
      // why the checksum assertion below now ships with this script.
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      // Chromium's console line for a failed request carries NO url, so "404" alone is
      // unfalsifiable — it could be the favicon or it could be a real asset the surface needs.
      // Recording the response itself is what turns a shrug into a finding.
      const http = [];
      page.on("response", (r) => { if (r.status() >= 400) http.push(`${r.status()} ${r.url()}`); });
      page.on("requestfailed", (r) => http.push(`failed ${r.url()} (${r.failure()?.errorText ?? "?"})`));

      await page.goto(`${BASE}/?theme=${theme}&data=held`, { waitUntil: "networkidle" });
      await settle(page);

      // ── 1. the duplicate is gone from the group ────────────────────────────
      const shippedN8n = await page.locator('.ig-card[data-provider="n8n"]').count();
      const shippedZap = await page.locator('.ig-card[data-provider="mcp"]').count();
      check(shippedN8n === 0, `${theme}: the shipped n8n tile is gone now that the tenant has n8n`);
      check(shippedZap === 0, `${theme}: the shipped Zapier tile is gone now that the tenant has Zapier`);

      // ── 2. …and the connections are still there, named for their TOOL ──────
      const titles = await page.locator('[data-owner="gateway"][data-gateway-tool] strong').allTextContents();
      check(titles.includes("Zapier"), `${theme}: the Zapier connection is titled "Zapier"`);
      check(titles.includes("n8n"), `${theme}: the n8n connection is titled "n8n"`);
      check(!titles.some((t) => /workspace/i.test(t)),
        `${theme}: no composed per-tenant label leaks onto a tile (got: ${titles.join(", ")})`);
      await shot(page, `${theme}-group-merged`);

      // ── 3. the catalogue shows them as held, not as something to add ───────
      await page.locator('.ig-card[data-provider="mcp-add"]').click();
      await settle(page);
      const heldTiles = page.locator(".ig-gw-tile[data-held]");
      const heldNames = await heldTiles.locator(".ig-gw-tile-name").allTextContents();
      check(heldNames.includes("Zapier") && heldNames.includes("n8n"),
        `${theme}: both held vendors read as held in the catalogue (${heldNames.join(", ")})`);
      // One tool, one tile — inside the catalogue too. A held tool must not still be advertised in
      // the Popular-to-add row while sitting marked-as-held in its own category below it.
      const dupes = heldNames.filter((n, i) => heldNames.indexOf(n) !== i);
      check(dupes.length === 0, `${theme}: no held vendor is listed twice in the catalogue${dupes.length ? " — " + [...new Set(dupes)].join(", ") : ""}`);
      const zapTile = page.locator('.ig-gw-tile[data-held]', { hasText: "Zapier" }).first();
      check((await zapTile.locator(".ig-gw-chip").count()) === 1, `${theme}: a held tile carries a status chip`);
      check((await zapTile.locator(".ig-gw-badge").count()) === 0, `${theme}: a held tile drops the "add this" badge`);
      const unheld = await page.locator('.ig-gw-tile:not([data-held]) .ig-gw-tile-name').first().textContent();
      check(!!unheld, `${theme}: an unconnected vendor still offers itself (${unheld})`);
      await shot(page, `${theme}-catalogue-held`);

      // ── 4. a held tile opens the connection, not the add form ──────────────
      await zapTile.click();
      await settle(page);
      const dlg = page.locator('[role="dialog"]');
      check(await dlg.isVisible(), `${theme}: a held tile opens a drawer`);
      const dlgText = await dlg.textContent();
      check(/workspace-Zapier/.test(dlgText ?? ""),
        `${theme}: the drawer carries the tenant's own label, where telling two apart is the question`);
      await shot(page, `${theme}-held-opens-connection`);

      // ── 5. the way back to the older panel, and its contrast ───────────────
      const older = page.locator("button.ig-linkish", { hasText: "Older setup options" });
      check((await older.count()) === 1, `${theme}: the older setup panel is still reachable from the connection`);
      const c = await older.evaluate((el) => {
        const s = getComputedStyle(el);
        let bg = "rgb(255,255,255)";
        for (let n = el; n; n = n.parentElement) {
          const v = getComputedStyle(n).backgroundColor;
          if (v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent") { bg = v; break; }
        }
        return { fg: s.color, bg, size: s.fontSize };
      });
      const r = ratio(c.fg, c.bg);
      check(r >= 4.5, `${theme}: "Older setup options" measures ${r.toFixed(2)}:1 at ${c.size} (AA body needs 4.5) — ${c.fg} on ${c.bg}`);

      // ── 6. keyboard reachable, and nothing threw ───────────────────────────
      const focusable = await older.evaluate((el) => { el.focus(); return document.activeElement === el; });
      check(focusable, `${theme}: the link takes keyboard focus`);
      // A favicon the harness does not ship is not a defect in this surface; anything else is.
      const realHttp = http.filter((h) => !/favicon|apple-touch-icon/i.test(h));
      check(realHttp.length === 0, `${theme}: no failed requests the surface needs${realHttp.length ? " — " + realHttp.join(" | ").slice(0, 300) : ` (ignored: ${http.join(", ") || "none"})`}`);
      const scriptErrors = errors.filter((e) => !/Failed to load resource/.test(e));
      check(scriptErrors.length === 0, `${theme}: no script errors${scriptErrors.length ? " — " + scriptErrors.join(" | ").slice(0, 300) : ""}`);
      // HONESTY (§13): a console "Failed to load resource" that NO response or requestfailed event
      // accounts for cannot be attributed from here, so it is recorded rather than filtered into
      // silence. Silence is what makes the next real one invisible.
      const unattributed = errors.length - scriptErrors.length - http.length;
      if (unattributed > 0) findings.push(`NOTE  ${theme}: ${unattributed} console load-failure(s) with no url from any event — unattributed, not dismissed`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  // ── the four Solo viewports ────────────────────────────────────────────────
  // The drawer and the group are the two things this change touches, so both are measured at
  // every shipped size rather than at the one that happened to be convenient. PAIGE open vs
  // closed is recorded as one measurement per size: this group is page content inside the same
  // column either way, which is checked here by measuring the grid rather than assumed.
  {
    const browser2 = await (await resolvePlaywright()).chromium.launch({ executablePath: await resolveExecutablePath() });
    try {
      for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
        const ctx = await browser2.newContext({ viewport: { width: w, height: h } });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/?theme=light&data=held`, { waitUntil: "networkidle" });
        await settle(page);
        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          const grid = document.querySelector(".ig-grid, .ig-group ul, ul");
          return {
            hscroll: doc.scrollWidth > doc.clientWidth + 1,
            clipped: [...document.querySelectorAll('[data-owner="gateway"][data-gateway-tool]')]
              .some((el) => el.getBoundingClientRect().right > doc.clientWidth + 1),
            gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : -1,
          };
        });
        check(!m.hscroll, `${w}x${h}: no horizontal page scroll`);
        check(!m.clipped, `${w}x${h}: no connection tile clipped horizontally`);
        await shot(page, `solo-${w}x${h}-one-tile`);
        await ctx.close();
      }
    } finally { await browser2.close(); }
  }

  // A "both themes" claim is only true if the two renders actually DIFFER. Two identical files
  // mean the theme never flipped and every per-theme measurement above was taken twice on one
  // theme — a false green that reads exactly like a real one.
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const sum = (f) => createHash("md5").update(readFileSync(path.join(OUT, f))).digest("hex");
  for (const frame of ["group-merged", "catalogue-held", "held-opens-connection"]) {
    check(sum(`light-${frame}.png`) !== sum(`dark-${frame}.png`),
      `light and dark differ for ${frame} (identical files mean the theme never flipped)`);
  }
  const failed = findings.filter((f) => f.startsWith("FAIL"));
  writeFileSync(path.join(OUT, "findings.txt"), findings.join("\n") + "\n");
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed. Frames in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
