# OPS — pipeline & CI runbook

The home for "how the pipeline works so it's never re-derived" (root `CLAUDE.md` §24). Edge-function
deploy mechanics live in the nested `supabase/functions/CLAUDE.md` (auto-loads for function work);
this doc covers the CI **quality gate**.

## CI workflows

| Workflow | File | Gate |
| --- | --- | --- |
| `ci` (verify) | `.github/workflows/ci.yml` | build + test + typecheck-ratchet + changed-file lint + regression lint |
| `migration-lint` | `.github/workflows/migration-lint.yml` | lints added/modified migrations for clean-rebuild safety |
| `Security Audit` | `.github/workflows/security-audit.yml` | `npm audit` prod deps, high+ |
| `deploy-edge-functions` | `.github/workflows/deploy-edge-functions.yml` | auto-deploys changed edge functions on merge to `main` |

<!-- RELEASE_GOVERNANCE_POLICY -->
The `ci / verify` job also runs `lint:release-governance` and its self-test. The guard confirms that
the canonical policy and schema exist, every required agent/PR/closeout entry point routes to them,
and checked-in release records preserve the structural honesty rules. It does not prove a deployment
or customer outcome; those still require the exact evidence defined in
`docs/doctrine/release-governance-and-customer-update-policy.md`.

## The `ci / verify` gate (Lane F Slice 1 — PLATFORM_ASSESSMENT Move 4)

Runs on every PR (and `push: main` for the whole-repo gates). Steps:

- **Build** (`npm run build`) + **Test** (`npm run test`, vitest) — hard gates.
- **Typecheck ratchet** (`npm run ci:tsc` → `scripts/ci/tsc-ratchet.mjs`) — runs `tsc --noEmit` and
  compares the error **multiset** to `scripts/ci/tsc-baseline.txt` (`<count>\t<signature>`, line/col
  stripped). Fails only on a **new** signature/instance; prints any baseline entry now fixed. A
  ci.yml step also fails the PR if `tsc-baseline.txt` **grows** (it may only shrink — fix the error,
  don't whitelist it).
- **Changed-file lint** — ESLint + gold-discipline on the PR's changed `src/**.{ts,tsx}` only.
- **Regression lint** (`npm run ci:regression` → `scripts/ci/regression-lint.mjs`) — scans **added
  diff lines** across shipped surfaces (`src`, `index.html`, `public`, `supabase/functions/*.ts`) for
  §3 banned phrases ("AI-powered"/"streamline"/"seamless"/"empower coaches") + "MMA OS" jargon, and
  new non-restrictive `USING/WITH CHECK (false)` policies in migrations. Added-lines-only so
  pre-existing debt (owned by the §2/§3 cleanup lanes) never blocks. Escape hatch: put
  `ci-allow-regression` on the line.

### ⚠️ Required-check setup (owner, one-time)
A workflow only **blocks** merges when it's a **required status check** in branch protection — which
can't be set from code. Mark `ci / verify` (and `lint`, `audit`) required in **Settings → Branches →
main**. Until then the gate is advisory (runs + reports, doesn't block).

**`ui-delivery-evidence` — the Experience-Quality gate (owner decision, Harness-upgrade Phase 3).**
The `ui-delivery-evidence` workflow (`.github/workflows/ui-delivery-evidence.yml`, job
**`Validate UI delivery evidence`**) validates the UI-delivery evidence record on every PR and routes
a declared backend→visible change (a `Visible-Flow-Impact: yes` commit trailer on a
`supabase/functions/**` / `supabase/migrations/**` change) to the same record. It is **not** in the
documented required-check set above.

**OWNER RULING 2026-09-12: it BECOMES a required status check for merges to `main`.** Its scoped
behaviour is preserved exactly — a UI-affecting change must supply the required evidence; a non-UI
change passes honestly as not-applicable. This supersedes the earlier "let the open-UI-PR window
clear first" sequencing note below.

**The exact required-check context is `ui-delivery-evidence / Validate UI delivery evidence`**
(workflow `name:` / job `name:`). The job name alone does not match, and a context string that does
not match silently protects nothing — which is the failure this ruling exists to end.

**CURRENT STATUS: NOT YET IN FORCE (§13).** This is a repository branch-protection setting, not a
file in this repo, so merging this doc changes nothing about whether merges are blocked. Measured
2026-09-12 from a headless agent session: `GET /repos/.../branches/main/protection` returns
**`403 Resource not accessible by integration`** — this session can neither set the requirement nor
read back the required-check list. **Workflow YAML is never proof that merges are blocked.**

**Owner action to complete it:** Settings → Branches → `main` → *Require status checks to pass* → add
`ui-delivery-evidence / Validate UI delivery evidence` → save, then confirm it is listed. Until that
read-back is confirmed, the gate remains **advisory in practice** and this passage must not be edited
to claim otherwise.

**Measured impact at the time of the ruling:** 41 pull requests were open, a substantial number of
them touching UI paths. Making the check required means any of those that lack a conforming evidence
record will be blocked until one is added. That is the intended effect, recorded so it is not a
surprise. (Prior sequencing note, now superseded: the five-skill evidence fields are
recognized-but-optional and only a dated, announced cutover — never silent — would make any of them
required. Making the workflow itself required does **not** make those optional fields required; it
only enforces that the existing evidence record + routing validate.)

### Regenerating the tsc baseline (ratchet it DOWN)
When you fix pre-existing type errors, shrink the baseline:
```
npx tsc --noEmit -p tsconfig.app.json 2>&1 \
  | grep "error TS" | sed -E 's/\(([0-9]+),([0-9]+)\)//' | sed -E 's/^[[:space:]]+//' \
  | sort | uniq -c | awk '{c=$1;$1="";sub(/^ /,"");print c"\t"$0}' > scripts/ci/tsc-baseline.txt
```
The goal is zero. Do **not** add entries to whitelist a new error — the shrink-only guard will fail the PR.

## Known follow-ups (Lane F)

### Unit-test transport isolation and failure attribution (#1486)

The root Vitest configuration uses `https://unit-test.invalid` and a test-only key.
Its setup blocks default `fetch` and `WebSocket` calls before test imports. A caught
transport error still fails the suite; supply an explicit double at the dependency
that the named test exercises. Do not return successful empty data from a global
transport fallback. Tests of network consumers keep their own recorded doubles.

The existing `ci / verify` Test step retains its failing exit code and writes Vitest
JSON. Its appended diagnostic step emits `unit-failure-attribution.json`, uploaded
under `unit-failure-attribution-<run id>-<attempt>`. It records executed checkout,
workflow and candidate SHAs separately, plus run identity,
totals, failing file/test, and `UNIT_NETWORK_ESCAPE` (Release/CI isolation ownership)
or `TEST_FAILURE_UNCLASSIFIED` (owning test lane). Missing or malformed evidence is
`EVIDENCE_UNAVAILABLE`, never a passing result. Raw exception messages, request
URLs, headers, and bodies are omitted from this diagnostic artifact.

This artifact explains this unit-test leg only. It does not diagnose container,
runner, provider, deployment, database, or product failures by guesswork. Compare
the exact candidate result with a clean-main run and inspect the failing test before
assigning a product regression or nondeterminism label. Historical failed runs
remain failed; a later passing attempt supplies additional evidence.

Verification commands: `node --test scripts/ci/__tests__/unit-network-guard.test.mjs
scripts/ci/__tests__/unit-failure-attribution.test.mjs` and the root `npm run test`.
- Commit a lockfile (or move CI to `bun install --frozen-lockfile`) for reproducible installs +
  cache — CI uses `npm install` today because the canonical lockfile is `bun.lockb` (task #379).
- Drive the tsc baseline to zero.
- Remaining Lane F items (secrets docs / preflight / function manifest) are separate slices.


## One-shot cleanups (Lane B-ii-b housekeeping, 2026-07-26)

### Deleting the orphaned `create-payment` edge function
`create-payment` is deployed on prod but has ZERO repo callers (verified: no `src/**`,
`supabase/**`, or `scripts/**` reference; no local function directory). It is superseded by
`tenant-checkout-session`, `add-business-slot-checkout`, and the new
`marketplace-checkout-session`. Because there is no local `supabase/functions/create-payment/`
dir, CI (`deploy-edge-functions.yml`) never touches it, so the deployed copy must be removed
out-of-band via the Management API:

```
SUPABASE_ACCESS_TOKEN=<token> bash scripts/delete-create-payment.sh
```

The script `DELETE`s `https://api.supabase.com/v1/projects/xygzykjyynhzqytbqnzu/functions/create-payment`
and treats a 404 as already-done (idempotent). Run once; it needs no repeat.

Note: the legacy `orders` TABLE is intentionally NOT dropped -- it still has live read-consumers
(`src/components/dashboard/PaymentHistory.tsx:44`, `supabase/functions/generate-invoice/index.ts:234`)
plus an inbound FK. Left inert; migration to remove it is a tracked follow-up.

## Exact-head CI on a bot-authored PR (2026-09-13)

GitHub withholds `pull_request`/`push` Actions events for a PR authored or pushed by the
session's GitHub App token (recursion prevention), so such a PR never earns a `ci / verify`
run from its own events. `ci.yml` therefore carries a `workflow_dispatch` trigger: dispatch
it against the PR's head branch to run the SAME gate on the exact head.

```
gh workflow run ci.yml --ref <pr-branch>          # or the Actions workflow-dispatch API
```

On a dispatch the changed-file/edge gates resolve their base from the live `origin/main` tip
and head from the dispatched ref, so the changed-set, the tsc-baseline + regression ratchets,
the eslint/gold changed-src gates, and the Deno edge ratchet all run exactly as they would on
a PR. `pull_request` and `push` runs are unchanged. The dispatched ref's own `ci.yml` must
carry the trigger, so sync `main` into a stale branch before dispatching it.
