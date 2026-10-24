# Dependency Advisory Assessment — react-router group (GHSA-jjmj-jmhj-qwj2 · GHSA-337j-9hxr-rhxg · GHSA-wrjc-x8rr-h8h6)

**Assessment record:** canonical security assessment for the react-router advisory group
flagged against this repository's router pin. Assessment date 2026-10-22 (revised same day
after independent review corrected the first draft — revision noted inline). Assessed by EXP10
(zCod) after the advisories surfaced during EXP10 CI.
**Related, already remediated:** the dompurify HIGH set — fixed on main by #2616/#2607
(dompurify 3.4.17). Recorded for completeness; no further action.

## 0. Correction of the first draft (§13 honesty)

The first draft of this assessment claimed the `audit` gate was red because of
GHSA-337j-9hxr-rhxg. **That premise was wrong.** The gate runs
`npm audit --omit=dev --audit-level=high` (.github/workflows/security-audit.yml); a Moderate
advisory cannot fail it. The red runs observed on 2026-10-22 predated the dompurify fix
(#2616 merged later that day) and were driven by that HIGH set. On current main the gate
passes. This revision also adds a sibling advisory the first draft missed (§1) and corrects
the remediation analysis (§4).

## 1. Affected versions and each advisory's applicability (verified 2026-10-22)

Repository pin at assessment start: **react-router-dom 6.30.4** (exact, package.json +
package-lock; resolves react-router 6.30.4). Three advisories flagged by `npm audit`:

| Advisory | Severity | Range (vs 6.30.4) | What it is | Applicability here |
|---|---|---|---|---|
| **GHSA-jjmj-jmhj-qwj2** | **Top-of-Moderate (CVSS 6.9)** | 6.30.2–6.30.5 — **APPLIED** | Open redirect leading to XSS | **Client-applicable**: the app uses `Link`/`useNavigate` throughout; no SSR requirement stated. **The material risk of the group.** |
| GHSA-337j-9hxr-rhxg | Moderate (6.1) | ≥6.4.0 <7.18.0 — applied | Constructor injection via `deserializeErrors()` in **SSR hydration** (Framework/Data Mode) | **Not exploitable here, verified against source**: `src/App.tsx` uses `<BrowserRouter>` + `<Routes>` (Declarative Mode); zero `hydrateRoot`/`renderToString`/SSR entry points in `src/` (all mounts are client `createRoot`). `RouterProvider`+`createMemoryRouter` appear only in three vitest harnesses (client-side memory routers; no hydration) — `src/pages/sign/AgreementSigning.test.tsx`, `src/solo/settings-notifications-retirement.test.tsx`, `src/solo/settings.rendered-copy.test.tsx`. |
| GHSA-wrjc-x8rr-h8h6 | Moderate (5.1) | ≥6.0.0 <7.18.0 — applied | Open redirect via backslash in `<Link>`/`useNavigate` (CVE-2025-68470 bypass) | Client-side class; requires an attacker-influenced `to`/href reaching a router navigation primitive. App routes are overwhelmingly static literals; a dedicated dynamic-link audit is named owed in §5 rather than assumed safe. |

## 2. Remediation performed IN THIS PR (the version-true non-major fix)

**Exact-pin bump react-router-dom 6.30.4 → 6.30.6** (react-router resolves 6.30.6;
published 2026-08-18; non-major — `npm audit` itself advertises it as the fix for jjmj):

- **Closes GHSA-jjmj-jmhj-qwj2** (the group's client-applicable, highest-severity advisory).
- Verified locally on this branch: `npm audit --omit=dev --audit-level=high` — **exit 0**
  (the gate's own command). Remaining findings after the bump: 2 react-router moderates
  (337j, wrjc — dispositioned in §1/§5) and 2 `@vitest/mocker` moderates (dev-tooling scope,
  GHSA-qxg6-89mg-rqv8 / GHSA-xp26-3454-mjgp — test tooling declared under `dependencies` (hence visible
  to --omit=dev) but never bundled into any customer artifact; upgradeable via `npm
  audit fix` in the toolchain lane).
- Regression surface: two patch releases on the same major; the full verify suite (routing
  covered heavily) is the CI gate on this PR.

## 3. Compensating controls (present)

- No SSR surface at all (§1, 337j): static SPA, client `createRoot` mounts only.
- CSP header present (vercel.json); platform network boundaries in force.
- No server-side router error serialization exists to deserialize.

## 4. Remediation options for the two remaining moderates (337j, wrjc)

1. **Full close: react-router-dom 7.18+** — a **6→7 major migration** of the app's routing
   layer (owner-scoped workstream with a compatibility + regression plan: route-tree changes,
   API deltas, full-suite re-run). NOT to be absorbed into another lane's PR.
2. **Hold at 6.30.6 with this assessment as the disposition** — both remaining react-router
   advisories are Moderate and below the gate's high threshold; 337j is verified
   not-exploitable-here; wrjc's exposure is bounded by the dynamic-link audit (§5). npm has
   **no per-advisory audit-exception mechanism** (RFC #227 unimplemented; `ignoreGhsas` is a
   pnpm feature — this repo uses npm); if an owner wants machine-enforced suppression,
   audit-ci/better-npm-audit allowlists are the real mechanism. None is needed while both
   stay below the high gate.
3. **6.x backport** — 6.30.6 already backported jjmj; no further 6.x line is announced for
   337j/wrjc (their ranges run to 7.18.0). Do not assume one.

**Ownership:** the 7.x major-upgrade decision is the owner's; holding at 6.30.6 with this
disposition is the default recorded here. The `@vitest/mocker` moderates belong to the
dev-dependency lane (routine `npm audit fix` when that lane next touches the toolchain).

## 5. What remains owed (named, not assumed)

- **Dynamic-link audit for wrjc**: enumerate every `Link to=` / `useNavigate(...)` call site
  whose target derives from request data (query params, refs, stored URLs) and confirm none
  can carry an attacker-influenced backslash-bearing external target. Until that audit runs,
  wrjc is dispositioned as bounded-not-closed.
- The 7.x migration plan, if/when the owner schedules it.

## 6. What this assessment is NOT

- Not a gate waiver (the high gate stays; nothing here suppresses future findings).
- Not a claim that react-router 7 is unsafe — only that adopting it is a major upgrade
  needing its own plan.
- Not a retroactive redefinition of the 2026-10-22 red runs: those were the dompurify HIGH
  set, fixed by #2616/#2607 — this group never failed the gate.
