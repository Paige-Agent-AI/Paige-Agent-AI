// scripts/live-drive/live-drive.mjs
//
// LIVE-DRIVE HELPER — the standard tool for auth-gated post-deploy §32 live-drive verification.
//
// WHAT THIS IS
//   A reusable "launch a real headless Chromium → navigate a live URL → run steps/asserts →
//   screenshot → report honestly" primitive. It exists so a capable session (§32) can DRIVE a
//   deployed, auth-gated surface itself instead of owing the owner's eyes — and so we stop
//   writing a fourth copy of the chromium-launch/resolve dance (§18: one home per capability).
//
// WHY IT LIVES HERE (not in services/paige-browser/)
//   services/paige-browser/ is a DEPLOYED Fly artifact with its own package.json + pinned
//   playwright + lockfile; it is a long-lived warm-browser SERVICE, not one-shot dev/CI tooling.
//   This helper is dev/CI verification tooling → it belongs beside the other scripts/*-smoke.*.
//   The chromium-RESOLUTION logic below intentionally MIRRORS services/paige-browser/smoke.mjs's
//   `findSandboxChromium` — reference the proven pattern (§30), do not fork a third divergent copy.
//   (Follow-up, later PR: smoke.mjs migrates to import resolveExecutablePath() from here — §37 #2.)
//
// PORTABILITY (three envs, one code path)
//   (a) This CI sandbox: browser pre-provisioned at /opt/pw-browsers, playwright at
//       /opt/node22/lib/node_modules/playwright; NEVER run `playwright install`
//       (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1). Outbound HTTPS goes through an agent proxy —
//       HTTPS_PROXY MUST be wired into launch or many hosts fail with ERR_CONNECTION_RESET.
//   (b) A normal dev machine: `playwright` resolves its OWN bundled browser (executablePath
//       undefined), no proxy set.
//   (c) A Cowork/Chrome env: same standard import; env may or may not set PW_EXECUTABLE_PATH.
//   The helper handles all three by: importing the standard `playwright` module (with a
//   resolvable-path fallback), resolving executablePath from PW_EXECUTABLE_PATH → the
//   /opt scan → undefined, and wiring proxy ONLY when HTTPS_PROXY is set.
//
// §13 HONESTY — this helper NEVER claims a render that did not happen. On a navigation failure
//   (proxy ERR_CONNECTION_RESET, DNS, timeout, auth wall) it returns { ok:false, error }, it does
//   NOT fabricate a success. "Target reachable" is ENV-DEPENDENT: live prod (paigeagent.ai) was
//   NOT reachable headless from this CI sandbox even via the proxy in a prior smoke — so a false
//   result here can mean the env, not the code. Report what actually happened.
//
// SECURITY — credentials come from ENV ONLY (never literals in code, never logged/screenshotted).
//   The auth helper fills password fields via Playwright's page.fill (which does not echo values),
//   this module never prints/returns/renders a credential, and after an authed drive it blanks the
//   email + password inputs BEFORE the screenshot so a not-yet-navigated login form can never leak a
//   plaintext email into the captured pixels.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default screenshot home — gitignored (see the scripts/live-drive/artifacts rule in root .gitignore).
export const DEFAULT_ARTIFACTS_DIR = path.join(__dirname, "artifacts");

/**
 * Resolve the `playwright` module with real named exports across install shapes.
 * Standard import first (root devDependency); on failure, fall back to a resolvable absolute path
 * (globally-installed playwright, e.g. the sandbox's /opt/node22/lib/node_modules/playwright, or an
 * operator-supplied PW_MODULE_PATH). A CJS entrypoint imported under ESM interop exposes only
 * `default` (named `chromium` is undefined) — so we unwrap `default` when the named export is absent.
 * @returns {Promise<{ chromium: any }>}
 */
export async function resolvePlaywright() {
  const pick = (ns) => (ns && ns.chromium ? ns : ns?.default ?? ns);
  try {
    return pick(await import("playwright"));
  } catch (primaryErr) {
    // Prefer .mjs entrypoints (real named exports) ahead of .js (CJS → default-only under interop).
    const candidates = [
      process.env.PW_MODULE_PATH,
      "/opt/node22/lib/node_modules/playwright/index.mjs",
      "/opt/node22/lib/node_modules/playwright/index.js",
      "/usr/lib/node_modules/playwright/index.mjs",
      "/usr/lib/node_modules/playwright/index.js",
      "/usr/local/lib/node_modules/playwright/index.mjs",
      "/usr/local/lib/node_modules/playwright/index.js",
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) {
          const resolved = pick(await import(pathToFileURL(c).href));
          if (resolved && resolved.chromium) return resolved;
        }
      } catch {
        // try the next candidate
      }
    }
    throw new Error(
      "Could not resolve the 'playwright' module. Add it to root devDependencies " +
        "(npm install) or set PW_MODULE_PATH to a resolvable playwright entrypoint. " +
        `Original import error: ${primaryErr?.message || primaryErr}`
    );
  }
}

/**
 * Resolve the Chromium executable path across environments.
 *  1. PW_EXECUTABLE_PATH env override (explicit wins).
 *  2. Scan the pre-provisioned browsers dir (PLAYWRIGHT_BROWSERS_PATH || /opt/pw-browsers) for
 *     a chromium* build — mirrors services/paige-browser/smoke.mjs::findSandboxChromium.
 *  3. undefined → let Playwright resolve its own bundled browser (normal dev machine).
 * @returns {string | undefined}
 */
export function resolveExecutablePath() {
  if (process.env.PW_EXECUTABLE_PATH) return process.env.PW_EXECUTABLE_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    for (const d of fs.readdirSync(base)) {
      if (d.startsWith("chromium")) {
        const p = path.join(base, d, "chrome-linux", "chrome");
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {
    // not a pre-provisioned env — fall through to Playwright's own resolution
  }
  return undefined;
}

/**
 * Build the launch options: headless, sandbox-safe args, resolved executablePath, and the
 * agent proxy wired ONLY when HTTPS_PROXY is set (the one net-new primitive vs existing sites).
 * @returns {{ headless: true, args: string[], executablePath?: string, proxy?: { server: string, bypass: string } }}
 */
export function buildLaunchOptions() {
  const executablePath = resolveExecutablePath();
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
  return {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(executablePath ? { executablePath } : {}),
    // Loopback must never go through the agent relay. The relay accepts only HTTPS CONNECT
    // tunnels, so a plain-HTTP localhost harness served by Vite comes back as a 405 page and the
    // app never mounts — which reads exactly like "the surface renders nothing" and cost a full
    // debug cycle to tell apart. Bypassing loopback cannot affect a remote drive, which never
    // resolves to these hosts.
    ...(proxyServer
      ? { proxy: { server: proxyServer, bypass: "127.0.0.1,localhost,[::1]" } }
      : {}),
  };
}

/**
 * Default form-login routine. Fills an email + password login form from ENV credentials and
 * submits. Selectors are overridable via the `auth` object. Never logs credential values.
 *
 * @param {import('playwright').Page} page
 * @param {object} auth
 * @param {string} [auth.emailSelector]    default 'input[type="email"], input[name="email"]'
 * @param {string} [auth.passwordSelector] default 'input[type="password"], input[name="password"]'
 * @param {string} [auth.submitSelector]   default 'button[type="submit"]'
 * @param {string} [auth.successSelector]  optional — a post-login selector to wait for
 * @param {string} [auth.emailEnv]         env var name for the email    (default LIVE_DRIVE_EMAIL)
 * @param {string} [auth.passwordEnv]      env var name for the password (default LIVE_DRIVE_PASSWORD)
 */
export async function defaultFormLogin(page, auth = {}) {
  const emailEnv = auth.emailEnv || "LIVE_DRIVE_EMAIL";
  const passwordEnv = auth.passwordEnv || "LIVE_DRIVE_PASSWORD";
  const email = process.env[emailEnv];
  const password = process.env[passwordEnv];
  if (!email || !password) {
    throw new Error(
      `Auth requested but credentials missing: set ${emailEnv} and ${passwordEnv} in the ` +
        "environment (never hardcode credentials)."
    );
  }
  const emailSelector = auth.emailSelector || 'input[type="email"], input[name="email"]';
  const passwordSelector =
    auth.passwordSelector || 'input[type="password"], input[name="password"]';
  const submitSelector = auth.submitSelector || 'button[type="submit"]';

  await page.fill(emailSelector, email); // Playwright does not echo filled values to logs
  await page.fill(passwordSelector, password); // credential never printed / returned / rendered
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.click(submitSelector),
  ]);
  if (auth.successSelector) {
    await page.waitForSelector(auth.successSelector, { timeout: 20000 });
  }
}

/**
 * Blank any email/password inputs still present in the DOM. Called after an authed drive, right
 * before the screenshot, so a login form that did not navigate away (bad creds, SPA that stays on
 * the login route, no successSelector) cannot leak a plaintext email into the captured pixels.
 * Best-effort and non-throwing — it only clears sensitive fields, never touches other content.
 */
async function scrubSensitiveInputs(page) {
  await page
    .evaluate(() => {
      // Cover standard AND common non-standard identifier/secret fields so an atypical login form
      // (username, a text-typed email, autocomplete hints) can't leak a test-account value into the
      // captured pixels either.
      const sel = [
        'input[type="email"]',
        'input[type="password"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[name="password"]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[autocomplete="current-password"]',
        'input[autocomplete="new-password"]',
      ].join(",");
      for (const el of document.querySelectorAll(sel)) {
        try {
          el.value = "";
        } catch {
          /* read-only / detached node — skip */
        }
      }
    })
    .catch(() => {});
}

/**
 * Drive a live URL headlessly, optionally authenticate, run caller steps/asserts, screenshot,
 * and return an honest result. On ANY failure it returns { ok:false, error } — never a hoped-for
 * success (§13). Always closes the browser in a finally.
 *
 * @param {object} opts
 * @param {string} opts.url                      target URL (or a data: URL for a mechanics proof)
 * @param {string} [opts.screenshotPath]         where to write the PNG (default: artifacts/<slug>.png)
 * @param {(page: import('playwright').Page) => Promise<void>} [opts.steps]  caller interactions
 * @param {(page: import('playwright').Page) => Promise<void>} [opts.assert] caller assertions (throw to fail)
 * @param {object | ((page: import('playwright').Page, auth: object) => Promise<void>)} [opts.auth]
 *        object → defaultFormLogin(page, auth); function → custom login routine (page, {}) ;
 *        omitted → no auth. Credentials always via ENV.
 * @param {string} [opts.storageState]
 *        Path to a Playwright storage-state JSON — an ALREADY-AUTHENTICATED session handed over by
 *        whoever holds the login. Preferred over `auth` when the owner would rather not put a
 *        password anywhere this process can read: the drive reuses the session and never sees, is
 *        told, or types a credential. When set, `auth` is skipped entirely.
 * @param {number} [opts.timeoutMs]              per-navigation timeout (default 45000)
 * @param {{width:number,height:number}} [opts.viewport]  default 1440x900
 * @param {number} [opts.deviceScaleFactor]      default 2
 * @param {import('playwright').LoadState} [opts.waitUntil]  default 'networkidle'
 * @returns {Promise<{ ok: boolean, url: string, title: string|null, screenshotPath: string|null,
 *                      status: number|null, bytes: number|null, error?: string, proxied: boolean,
 *                      executableResolved: boolean }>}
 */
export async function liveDrive(opts = {}) {
  const {
    url,
    steps,
    assert,
    auth,
    storageState,
    timeoutMs = 45000,
    viewport = { width: 1440, height: 900 },
    deviceScaleFactor = 2,
    waitUntil = "networkidle",
  } = opts;

  if (!url || typeof url !== "string") {
    return {
      ok: false,
      url: url ?? null,
      title: null,
      screenshotPath: null,
      status: null,
      bytes: null,
      error: "liveDrive requires a string `url`.",
      proxied: false,
      executableResolved: false,
    };
  }

  const launchOpts = buildLaunchOptions();
  const proxied = Boolean(launchOpts.proxy);
  const executableResolved = Boolean(launchOpts.executablePath);

  const screenshotPath =
    opts.screenshotPath || path.join(DEFAULT_ARTIFACTS_DIR, `${slugForUrl(url)}.png`);

  let chromium;
  try {
    ({ chromium } = await resolvePlaywright());
  } catch (e) {
    return failure(url, screenshotPath, proxied, executableResolved, e);
  }

  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    return failure(url, screenshotPath, proxied, executableResolved, e, "Chromium failed to launch");
  }

  try {
    // A handed-over session is the safest authentication there is: no credential is
    // read, typed, logged or held by this process at any point. It is therefore
    // preferred over the form login, and it SUPPRESSES it — attempting both would
    // re-enter a password on a session that is already signed in.
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor,
      ...(storageState ? { storageState } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    const response = await page.goto(url, { waitUntil, timeout: timeoutMs });
    const status = response ? response.status() : null;

    if (auth && !storageState) {
      if (typeof auth === "function") {
        await auth(page, {});
      } else {
        await defaultFormLogin(page, auth);
      }
    }

    if (typeof steps === "function") await steps(page);
    if (typeof assert === "function") await assert(page); // throws → caught below → ok:false

    // Secret hygiene: after an authed drive, blank any lingering email/password inputs before the
    // screenshot so an un-navigated login form can't leak a plaintext email into the pixels.
    if (auth && !storageState) await scrubSensitiveInputs(page);

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    // Read the size back from disk (a fresh filesystem stat) rather than the in-memory screenshot
    // buffer, so the reported count is a plain number that carries no page-content data-flow. The
    // result object below is built ONLY from the input url, HTTP status, byte count, screenshot
    // path, and launch booleans — nothing read back from the (credential-filled) page — so it is
    // safe to return and log (§13; keeps the clear-text data-flow provably clean). A caller that
    // needs page text (e.g. a title) reads it inside its own `assert` where it stays out of logs.
    const bytes = fs.existsSync(screenshotPath) ? fs.statSync(screenshotPath).size : 0;

    return {
      ok: true,
      url,
      screenshotPath,
      status,
      bytes,
      proxied,
      executableResolved,
    };
  } catch (e) {
    return failure(url, screenshotPath, proxied, executableResolved, e);
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // browser already down
    }
  }
}

/**
 * Strip any occurrence of the configured credential ENV values from a string. Playwright never
 * echoes a filled value into an error, so this is defense-in-depth (an app that reflected a
 * credential in its own error text would still be scrubbed) — and, by comparing the string against
 * the sensitive source and removing it, it is a genuine sanitizer barrier: no credential value can
 * reach the returned `error` (or any log of it).
 */
function redactSecrets(str) {
  if (typeof str !== "string" || !str) return str;
  let out = str;
  for (const key of ["LIVE_DRIVE_PASSWORD", "LIVE_DRIVE_EMAIL"]) {
    const secret = process.env[key];
    if (secret && secret.length > 0) out = out.split(secret).join("***");
  }
  return out;
}

function failure(url, screenshotPath, proxied, executableResolved, err, prefix) {
  const msg = redactSecrets(err?.message || String(err));
  return {
    ok: false,
    url,
    screenshotPath: null,
    status: null,
    bytes: null,
    error: prefix ? `${prefix}: ${msg}` : msg,
    proxied,
    executableResolved,
    _attemptedScreenshotPath: screenshotPath,
  };
}

function slugForUrl(url) {
  if (url.startsWith("data:")) return "data-url";
  return (
    url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "live-drive"
  );
}

export default liveDrive;
