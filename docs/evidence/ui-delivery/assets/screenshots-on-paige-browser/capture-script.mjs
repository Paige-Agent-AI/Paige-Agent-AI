// Evidence capture: the REAL production bundle's /render-frame, captured by the REAL paige-browser
// render.mjs (validateRenderRequest + renderCapture). The production egress fence refuses loopback, so
// a public IP literal stands in for https://paigeagent.ai and a receiver serves the built dist/ from
// disk with Vercel's SPA rewrite (any non-file path -> index.html). Third-party hosts (Google Fonts,
// images) go through the fence to the real network if the sandbox allows; otherwise they fail and the
// page falls back — recorded honestly in the evidence record.
import { chromium } from "/home/user/Paige-Agent-AI/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { renderConfig, validateRenderRequest, renderCapture } from "/home/user/Paige-Agent-AI/.claude/worktrees/agent-afc7f2bf151a46bc7/services/paige-browser/render.mjs";

const DIST = process.argv[2];
const OUT = process.argv[3];
const ORIGIN = "https://93.184.216.34";
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".txt": "text/plain", ".webp": "image/webp", ".glb": "model/gltf-binary" };
const served = { files: 0, spa: 0 };
async function serveDist(ctx) {
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    let file = path.join(DIST, decodeURIComponent(pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(DIST, "index.html"); served.spa++; } else served.files++;
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
}

const page = {
  tenant_name: "Northwind Advisory",
  brand: { primary_color: "#1f2a5a", accent_color: "#c9a24a" },
  theme: null,
  blocks: [
    { type: "hero_scene", eyebrow: "For consultants and agencies", title: "Get your weekends back", subtitle: "Paige runs intake, follow-ups and scheduling, so every client hears from you on time — without you living in your inbox.", cta_label: "Book a strategy call", cta_href: "#apply" },
    { type: "feature_grid", title: "What changes in the first month", items: [
      { title: "Intake on autopilot", body: "New clients are onboarded the day they sign, with the questions you would have asked." },
      { title: "Follow-ups that land", body: "Every open conversation gets its next step drafted and waiting for your yes." },
      { title: "A calendar that fills itself", body: "Prospects book the right session length without a single back-and-forth." },
    ] },
    { type: "testimonial", items: [{ quote: "I stopped losing leads between calls. Paige handles the chase and I show up prepared.", author: "Dana R.", role: "Brand strategist" }] },
    { type: "pricing", title: "Simple engagement options", tiers: [
      { name: "Advisory", price: "$1,500", period: "mo", features: ["Two strategy sessions", "Async support", "Quarterly plan"], cta_label: "Start", cta_href: "#apply" },
      { name: "Partner", price: "$3,500", period: "mo", features: ["Weekly sessions", "Team workshops", "Priority access"], cta_label: "Start", cta_href: "#apply", featured: true },
    ] },
    { type: "faq", title: "Questions", items: [
      { question: "How fast do we start?", answer: "Within a week of your strategy call." },
      { question: "Can my team join?", answer: "Yes — Partner includes team workshops." },
    ] },
    { type: "embedded_form", form_slug: "intake", title: "Apply to work together" },
    { type: "cta", title: "Ready when you are", body: "One call to see if it fits.", cta_label: "Book a strategy call", cta_href: "#apply" },
  ],
};

const cfg = renderConfig({ PAIGE_RENDER_ALLOWED_ORIGINS: ORIGIN, PAIGE_APP_ORIGIN: ORIGIN });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const summary = {};
try {
  for (const viewport of ["desktop", "mobile"]) {
    const req = await validateRenderRequest({ page, viewport }, cfg);
    if (!req.ok) throw new Error(JSON.stringify(req));
    let dom = null;
    const r = await renderCapture(browser, req, cfg, {
      instrumentContext: serveDist,
      onPage: async (p) => { dom = await p.evaluate(() => ({
        ready: document.querySelector("[data-render-frame]")?.getAttribute("data-render-ready"),
        robots: document.querySelector('meta[name="robots"]')?.getAttribute("content"),
        h1: document.querySelector("h1")?.textContent,
        title: document.title,
        fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).slice(0, 6),
      })); },
    });
    if (!r.ok) { summary[viewport] = r; continue; }
    const files = r.slices.map((s, i) => {
      const f = path.join(OUT, `${viewport}-slice-${i}.jpg`);
      fs.writeFileSync(f, Buffer.from(s.jpeg_base64, "base64"));
      return { file: path.basename(f), y: s.y, height: s.height, bytes: fs.statSync(f).size };
    });
    summary[viewport] = { ok: true, width: r.width, full_height: r.full_height, truncated: r.truncated, duration_ms: r.duration_ms, final_url: r.final_url, dom, files };
  }
} finally {
  await browser.close();
}
summary.served = served;
fs.writeFileSync(path.join(OUT, "capture-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
