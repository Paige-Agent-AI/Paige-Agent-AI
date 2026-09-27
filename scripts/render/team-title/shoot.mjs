// Render the real Solo Team screen (see main.tsx) and capture it for the "title" copy change.
//
//   node scripts/render/team-title/shoot.mjs <label>
//
// Writes PNGs and a text transcript under docs/evidence/ui-delivery/team-title/, prefixed <label>
// (for example "before" on main and "after" on the change). The Supabase client and tenant hook are
// the stubs beside this file; nothing is fetched from a real backend and no write is performed.
import { createServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const label = process.argv[2];
if (!/^[a-z0-9-]+$/.test(label ?? "")) {
  console.error("usage: node scripts/render/team-title/shoot.mjs <label>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const out = path.join(repo, "docs/evidence/ui-delivery/team-title");
mkdirSync(out, { recursive: true });

const server = await createServer({
  configFile: false,
  root: here,
  logLevel: "error",
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/integrations/supabase/client", replacement: path.join(here, "stubs/supabase-client.ts") },
      { find: "@/hooks/useTenantContext", replacement: path.join(here, "stubs/tenant-context.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  server: { port: 0, host: "127.0.0.1", fs: { allow: [repo] } },
});
await server.listen();
const base = server.resolvedUrls.local[0];

// The sandbox ships its own Chromium build; the pinned Playwright may expect another. Same
// resolution order as the other render script: an explicit path, then the provided build.
const provided = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync(provided) ? provided : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const transcript = [];
const errors = [];

async function open(width, height, theme) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${width}x${height} ${theme}: ${e.message}`));
  await page.goto(`${base}?theme=${theme}`, { waitUntil: "networkidle" });
  await page.getByText("Sam Rivera").first().waitFor({ timeout: 20000 });
  return page;
}

async function titleLines(page, scene) {
  const lines = await page.evaluate(() =>
    document.body.innerText.split("\n").map((l) => l.trim()).filter((l) => /title/i.test(l)));
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label, dt")).map((n) => n.firstChild?.textContent?.trim() ?? "")
      .filter((t) => /title/i.test(t)));
  transcript.push(`## ${scene}`, ...lines.map((l) => `- ${l}`), ...labels.map((l) => `- label: ${l}`), "");
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${label}-${name}.png`), fullPage: false });
}

try {
  for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
    const page = await open(w, h, "light");
    await shot(page, `roster-${w}x${h}-light`);
    if (w === 1366) await titleLines(page, "roster");
    await page.close();
  }

  for (const theme of ["light", "dark"]) {
    const page = await open(1366, 768, theme);
    await page.getByText("Sam Rivera").first().click();
    await page.getByRole("dialog").waitFor();
    await shot(page, `editor-1366x768-${theme}`);
    if (theme === "light") await titleLines(page, "member editor");
    await page.close();
  }

  {
    const page = await open(1366, 768, "light");
    await page.getByRole("button", { name: /^Invite someone$/ }).first().click();
    await page.getByRole("dialog").waitFor();
    await shot(page, "invite-1366x768-light");
    await titleLines(page, "invite dialog");
    await page.close();
  }

  {
    const page = await open(1366, 768, "light");
    await page.getByText("Roles & access", { exact: true }).first().click();
    await page.getByText("Permissions are enforced").first().waitFor();
    await shot(page, "roles-1366x768-light");
    await titleLines(page, "roles and access");
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

// .txt, not .md: the UI evidence validator reads every .md under docs/evidence/ui-delivery as a record.
writeFileSync(path.join(out, `${label}-copy.txt`), [`Visible "title" copy: ${label}`, "", ...transcript].join("\n"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`wrote ${label} captures to ${path.relative(repo, out)}`);
