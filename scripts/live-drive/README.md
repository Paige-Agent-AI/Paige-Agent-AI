# Live-Drive Helper

The standard tool for **auth-gated, post-deploy §32 live-drive verification** — launch a real
headless Chromium, navigate a deployed surface, (optionally) log in, run assertions, screenshot,
and report **honestly**. It exists so a capable session drives the deployed surface *itself*
instead of owing the owner's eyes, and so we keep **one home** for the chromium launch/resolve
dance (§18) instead of forking it a fourth time.

## What it is

`live-drive.mjs` exports `liveDrive({ url, steps?, assert?, screenshotPath?, auth? })` plus the
building blocks (`resolvePlaywright`, `resolveExecutablePath`, `buildLaunchOptions`,
`defaultFormLogin`). It returns:

```js
{ ok, url, screenshotPath, status, bytes, error?, proxied, executableResolved }
```

`ok:false` carries the **real** error (nav failure, launch failure, failed assertion) — it never
fabricates a success (§13). The result is built only from the input URL, HTTP status, byte count,
screenshot path, and launch booleans — deliberately **nothing read back from the (credential-filled)
page** — so it is always safe to log. A caller that needs page text (e.g. a `<title>`) reads it
inside its own `assert` callback, where it stays out of any log.

## When to use it

- **§32 post-deploy scan on an auth-gated surface**, when the session has browser-driving
  capability. Drive the DEPLOYED surface, assert the intended behavior actually renders, capture
  the pixels — that is a first-class verification step, not owner burden.
- **Not** for HTTP/JSON edge-function smokes (those stay `fetch`-based, no browser) and **not** for
  the deployed paige-browser Fly service (that's a separate long-lived warm-browser artifact).

## Environment variables

| Var | Purpose |
|---|---|
| `PW_EXECUTABLE_PATH` | Explicit Chromium binary path. Wins over auto-resolution. Leave unset on a normal dev machine so Playwright uses its own bundled browser. |
| `PLAYWRIGHT_BROWSERS_PATH` | Pre-provisioned browsers dir to scan (default `/opt/pw-browsers`). Set in the CI sandbox. |
| `HTTPS_PROXY` | Agent proxy. Wired into launch as `proxy:{ server }` **only when set** — required in this CI sandbox or many hosts fail with `ERR_CONNECTION_RESET`. Unset on a normal dev machine. |
| `PW_MODULE_PATH` | Optional fallback path to a `playwright` entrypoint if the standard import can't resolve (e.g. a globally-installed playwright). |
| `LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` | Login credentials for auth-gated drives. **ENV only — never hardcoded, never logged, never screenshotted.** Use a scoped test-tenant account, not owner PII. |
| `LIVE_DRIVE_URL` | Target URL for the Example B template. |

Do **not** run `playwright install` — the sandbox pre-provisions the browser
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). The root `playwright` devDep is pinned to `1.62.1` to match
the pre-provisioned build.

## Running the examples

```bash
# Example A — mechanics proof. Runnable here. No network, no auth, no prod data.
node scripts/live-drive/example-a-mechanics-proof.mjs

# Example B — auth-gated prod template. Runs only where prod is reachable + creds are set;
# self-skips (exit 0) otherwise.
LIVE_DRIVE_URL=https://paigeagent.ai/login \
LIVE_DRIVE_EMAIL=... LIVE_DRIVE_PASSWORD=... \
node scripts/live-drive/example-b-authed-prod.template.mjs
```

Screenshots land in `scripts/live-drive/artifacts/` (gitignored — never committed).

## Honest environment constraints (§13) — read this

**"Target reachable" is env-dependent; this helper makes no universal prod-reachability claim.**
In this CI sandbox, live prod (`paigeagent.ai`) was **not** reachable headless in a prior smoke
**even through the agent proxy** (the proxy forwards tool/MCP hosts, not arbitrary web egress —
`example.com` and `paigeagent.ai` both return `ERR_CONNECTION_RESET`). Consequences:

- **Example A** uses a `data:` URL precisely because it needs no network — a green there proves the
  helper's *mechanics*, not that prod is reachable.
- **Example B** self-skips when prod/creds are unavailable. A skip is the honest outcome, not a
  pass.
- When `liveDrive` returns `ok:false`, **distinguish "the surface is broken" from "prod is
  unreachable from this env" before reporting.** Never report a broken surface on an env-reachability
  failure, and never claim a pass that did not happen.

The chromium-resolution logic here mirrors `services/paige-browser/smoke.mjs::findSandboxChromium`
on purpose (§30 — reference the proven pattern). A later PR migrates that smoke to import
`resolveExecutablePath()` from here so there is truly one home (§37 follow-up).
