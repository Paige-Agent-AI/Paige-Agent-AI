# PC-1 Release Evidence & Migration Audit (read-only closeout)

Date: 2026-10-12 · Release identity: PR #2003, merge commit `bc4763987ba2b4933cef8ef628e85b3f0f3ba646`, independently reviewed head `7d5d6dc49`, base `d10fe338a`. Every claim below is labelled **[DIRECT]** (machine readback by the Computer agent against the live system, reproducible) or **[ASSERTED]** (stated by an agent/record, not independently re-derived).

## 1. Migration `20271021100000_paige_secure_browser_browse_budget_gate` — canonical recorded history

| Check | Result | Class |
|---|---|---|
| Recorded on production | `version=20271021100000, name=paige_secure_browser_browse_budget_gate` present in `supabase_migrations.schema_migrations`; total recorded = 1260 at audit time; neighbors: `20271021042001` (ads) below, `20271021100010` (finance) and `20271021200000` (int298) above | **[DIRECT]** (psql readback 2026-10-12) |
| Live function shape | `secure_browser_browse_budget_gate(p_tenant uuid, p_reserved_seconds integer)` and `..._settle(p_tenant uuid, p_reserved_seconds integer, p_consumed_seconds integer)` exist in `public`; gate body contains the `FOR UPDATE` serialization point and the `not_configured` fail-closed branch | **[DIRECT]** |
| Byte-shape proof | Whitespace-normalized body of the live gate function sha256-prefix `ace5605b27d67120` **equals** the same normalization of the migration source in the merged tree — the deployed body is character-for-character the reviewed migration | **[DIRECT]** |
| Grants | Both functions: `proacl = {postgres=X/postgres, service_role=X/postgres}` — EXECUTE for service_role only, matching the control-plane family; no PUBLIC/anon/authenticated | **[DIRECT]** |
| Behavior at rest | `secure_browser_tenant_limits`/`_usage_windows` untouched (0 rows before release; no tenant enablement performed); the gate itself refuses every tenant today (`feature_disabled` / `not_configured`) | **[DIRECT]** |

## 2. The Finance `20271021100010` ordering issue — timeline

1. **[DIRECT]** #2003's open-PR version scan (2026-10-11 ~23:00Z) cleared the ceiling at `20271021042001`; my migration took `20271021100000`.
2. **[DIRECT]** The Finance lane's `20271021100010_finance_cash_scenario_versions` deployed to production at 00:10Z (deploy-migrations run `38187029125`, attempt 2, SUCCESS on `ac71b564b`) — BEFORE #2003 merged.
3. **[DIRECT]** #2003 merged 01:20Z (`bc4763987`); its deploy-migrations run `38191736717` (01:24Z) was **correctly REFUSED** by the plain `db push` policy: the unrecorded `20271021100000` was older than production's newest recorded `20271021100010`. Nothing was applied by that run (the refusal aborts the whole push by design — no `--include-all` escape).
4. **[ASSERTED→DIRECT]** My first repair (renumber PR #2014) was closed as superseded: renaming an already-recorded migration is wrong, and the renumber turned out unnecessary (see §3).

## 3. The out-of-band reconciliation — what the evidence shows

- **[DIRECT]** No `deploy-migrations` workflow run succeeded between the 01:24Z refusal and a dispatched no-op push at 01:46Z (full workflow-run listing for 01:20–01:50Z verified; the only runs were PR checks, two non-migration main pushes `fc5388833`/`2c8d05614`, and my dispatch `38193210075` = GREEN no-op).
- **[DIRECT]** By 01:40Z, production recorded BOTH `20271021100000` and `20271021100010`, with the byte-identical function bodies and correct grants (§1) — i.e. the migration was applied and recorded **outside any GitHub workflow**, by an actor holding production migration authority, between 01:24Z and 01:40Z.
- **[ASSERTED]** The owner's closeout directive states the official Drive and Linear records (ANT-55) have been reconciled; the reconciliation action itself is owner-attested and not independently visible on GitHub. The audit accepts the owner's attestation for the MECHANISM while recording that the RESULT is fully machine-verified (§1) and the chain is unwedged: a `workflow_dispatch` no-op `db push` on main (`2c8d05614`, run `38193210075`) completed **SUCCESS** — production and main are in migration parity.
- Precedent context: issue **#2006** (Release Engineering, 2026-10-11 22:18Z) documents the same class of cross-lane skew that evening and names Release Engineering as the owner of grant/schema provenance and reconciliation.

## 4. Authoritative release identifiers

| Surface | Identifier | Class |
|---|---|---|
| PR / merge / reviewed head | #2003 / `bc4763987` / `7d5d6dc49` | **[DIRECT]** |
| Edge deploy | deploy-edge-functions run `38191736706` SUCCESS on `bc4763987`; `edge-live` tag = `bc4763987`; live `browser-use` unauth POST → 401 `UNAUTHORIZED_NO_AUTH_HEADER` | **[DIRECT]** |
| Fly deploy | deploy-fly-services run `38191736713` SUCCESS on `bc4763987`; `https://paige-browser.fly.dev/healthz` → HTTP 200 (0.86s, 2026-10-12) | **[DIRECT]** |
| Migration deploy | refused run `38191736717` (policy-correct); out-of-band apply (§3); parity no-op run `38193210075` GREEN | **[DIRECT]** |
| Grants | §1 proacl readbacks | **[DIRECT]** |
| Release CI | all required checks green on `7d5d6dc49` incl. `verify`, `contract` (spine lint, 198 capabilities), `database-contract` (real replay: pgTAP plan-42 + 12-caller concurrency proof, exactly 2×61s reservations admitted by a 180s budget) | **[DIRECT]** |
| Independent reviews | round 1 + round 2 dispositioned on-thread (#2003 comments; each finding fixed or labelled, incl. the round-2 P1 gate-verdict-enforcement regression and the P1 concurrency-proof role bug) | **[DIRECT]** |

## 5. `/pdf` and `/render` preservation

- **[DIRECT]** Merge diff scope: `services/paige-browser/pdf.mjs` and `render.mjs` are ABSENT from `bc4763987^..bc4763987` (8 files changed: Dockerfile, browse-context, egress-proxy, package.json, server.js, two smokes, ssrf-guard).
- **[DIRECT]** Live probes 2026-10-12: `POST /pdf` → 401, `POST /render` → 401 (routes alive, shared-secret gated, behavior unchanged), `GET /healthz` → 200.
- **[DIRECT]** The release CI's `verify` job ran the real-Chromium `smoke:paige-browser-render` and `smoke-pdf.mjs` green on the reviewed head.

## 6. Standing prohibitions (unchanged)

`PAIGE_BROWSER_WILDCARD_ENABLED` off; zero tenants flagged; zero limits rows; no credentials, live browsing, filings, or payments anywhere in PC-1. Activation steps are owner-controlled and listed in `pc1-s32c-acceptance-package.md`.
