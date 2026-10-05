// paige-browser /render production acceptance — runs INSIDE the paige-browser Fly machine.
//
// Shipped there by .github/workflows/paige-browser-render-acceptance.yml as base64 over
// `flyctl ssh console -C`, then eval'd by `node -e` (CommonJS, so `require` is in scope). The workflow
// prepends one line, `const INPUT = {...};`, carrying the validated dispatch inputs.
//
// SECRET HANDLING (§13 — this file must never print it): the shared secret is read from this machine's
// own environment (or, when the SSH session does not inherit it, from the running server's
// /proc/<pid>/environ) and only ever placed in the X-Browser-Secret header of a request to
// http://127.0.0.1:<port>. Nothing below logs the environment, the header, or the secret's length.
//
// OUTPUT: metadata only — ok, reason, width, full_height, slice count, each slice's decoded byte size,
// whether it carries the JPEG magic (base64 "/9j/" = FF D8 FF), each slice's sha256, duration, final_url.
// The image bytes themselves are never printed. The last line is ACCEPTANCE_RESULT=PASS or =FAIL so
// the workflow does not depend on flyctl propagating the remote exit status.
const fs = require("fs");
const crypto = require("crypto");

function serverEnv() {
  // The SSH session may or may not inherit the machine's secrets; the running server certainly has them.
  try {
    for (const pid of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      let cmd = "";
      try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
      if (!/server\.js/.test(cmd) || !/node/.test(cmd)) continue;
      const env = {};
      for (const kv of fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
        const i = kv.indexOf("=");
        if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return env;
    }
  } catch { /* fall through */ }
  return {};
}

const SAMPLE_PAGE = {
  tenant_name: "Acceptance Sample Co",
  theme: null,
  brand: null,
  blocks: [
    { type: "hero", eyebrow: "Acceptance sample", title: "Your clients, handled.", subtitle: "A bundled sample page rendered through /render-frame — no tenant data involved." },
    { type: "feature_grid", title: "What this checks", items: [
      { title: "Capture", body: "Full-page JPEG slices from the warm browser." },
      { title: "Bounds", body: "Slice height and count stay inside the host caps." },
      { title: "Readiness", body: "The frame signals ready only after it has drawn the payload." },
    ] },
    { type: "faq", title: "Questions", items: [
      { question: "Is any tenant data used?", answer: "No. This page exists only as the request payload." },
      { question: "Where is the secret?", answer: "On the machine. It is never printed." },
    ] },
    { type: "cta", title: "Done checking?", body: "This block closes the sample.", cta_label: "Back to the top", cta_href: "#" },
  ],
};

function validUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "paigeagent.ai" || u.hostname === "app.paigeagent.ai") &&
      !u.username && !u.password && !u.port && /^\/p\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) && !u.search && !u.hash;
  } catch { return false; }
}

(async () => {
  const input = typeof INPUT === "object" && INPUT ? INPUT : {};
  const env = process.env.PAIGE_BROWSER_SHARED_SECRET ? process.env : serverEnv();
  const secret = env.PAIGE_BROWSER_SHARED_SECRET || "";
  const port = Number(env.PORT || process.env.PORT || 8080);
  // The host's own slice bounds (render.mjs loadRenderConfig defaults and clamps), so "bounded" is checked
  // against what this machine is configured to allow, not assumed.
  const bound = (v, d, lo, hi) => { const n = Number.parseInt(v ?? "", 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const maxSlices = bound(env.PAIGE_RENDER_MAX_SLICES, 8, 1, 20);
  const maxSliceHeight = bound(env.PAIGE_RENDER_SLICE_HEIGHT, 1600, 400, 4000);
  if (!secret) {
    console.log(JSON.stringify({ check: "secret", ok: false, reason: "secret_not_found_on_machine" }));
    console.log("ACCEPTANCE_RESULT=FAIL");
    process.exitCode = 1;
    return;
  }
  const modes = input.mode === "both" ? ["page", "url"] : [input.mode === "url" ? "url" : "page"];
  const viewports = String(input.viewports || "desktop,mobile").split(",").map((v) => v.trim()).filter((v) => ["desktop", "tablet", "mobile"].includes(v));
  if (!viewports.length) viewports.push("desktop");
  let allOk = true;
  for (const mode of modes) {
    if (mode === "url" && !validUrl(String(input.url || ""))) {
      console.log(JSON.stringify({ check: "url_input", ok: false, reason: "url_not_a_published_paige_page" }));
      allOk = false;
      continue;
    }
    for (const viewport of viewports) {
      const body = mode === "url" ? { url: input.url, viewport } : { page: SAMPLE_PAGE, viewport };
      const started = Date.now();
      let status = null;
      let json = null;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/render`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-browser-secret": secret },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        });
        status = res.status;
        json = await res.json().catch(() => null);
      } catch (e) {
        json = { ok: false, reason: "request_failed", error: String(e && e.message || e).slice(0, 200) };
      }
      const slices = Array.isArray(json && json.slices) ? json.slices : [];
      const sliceMeta = slices.map((s) => {
        const b64 = String(s.jpeg_base64 || "");
        const buf = Buffer.from(b64, "base64");
        return { y: s.y, height: s.height, bytes: buf.length, jpeg_magic: b64.startsWith("/9j/"), sha256: crypto.createHash("sha256").update(buf).digest("hex") };
      });
      const bounded = slices.length <= maxSlices && sliceMeta.every((m) => Number.isFinite(m.height) && m.height > 0 && m.height <= maxSliceHeight);
      const ok = !!(json && json.ok === true) && slices.length > 0 && bounded && sliceMeta.every((m) => m.jpeg_magic && m.bytes > 0);
      if (!ok) allOk = false;
      console.log(JSON.stringify({
        check: "render", mode, viewport, http_status: status, ok,
        reason: json && json.reason || null,
        error: json && !json.ok && json.error ? String(json.error).slice(0, 300) : null,
        width: json && json.width || null,
        full_height: json && json.full_height || null,
        truncated: json ? json.truncated ?? null : null,
        slice_count: slices.length,
        bounded, max_slices: maxSlices, max_slice_height: maxSliceHeight,
        slices: sliceMeta,
        duration_ms: json && json.duration_ms != null ? json.duration_ms : Date.now() - started,
        final_url: json && json.final_url || null,
        target_url: mode === "url" ? input.url : "(bundled sample page via /render-frame)",
      }));
    }
  }
  console.log(`ACCEPTANCE_RESULT=${allOk ? "PASS" : "FAIL"}`);
  if (!allOk) process.exitCode = 1;
})().catch((e) => {
  console.log(JSON.stringify({ check: "script", ok: false, reason: "script_error", error: String(e && e.message || e).slice(0, 200) }));
  console.log("ACCEPTANCE_RESULT=FAIL");
  process.exitCode = 1;
});
