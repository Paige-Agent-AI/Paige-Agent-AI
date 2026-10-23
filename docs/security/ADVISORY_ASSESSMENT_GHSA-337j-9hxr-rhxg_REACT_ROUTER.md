# Dependency Advisory Assessment — GHSA-337j-9hxr-rhxg (react-router SSR hydration)

**Assessment record:** canonical security assessment for the npm-advisory currently failing the
repo's `audit` gate. One assessment per advisory; this is the react-router record. Assessment
date 2026-10-22. Assessed by EXP10 (zCod) — the advisory surfaced during EXP10 CI and blocks
indistinguishably across every lane's PRs.
**Related remediated advisory (recorded for completeness):** GHSA dompurify sanitization-bypass
set — REMEDIATED on main by #2616/#2607 (dompurify 3.4.17); no further action.

## 1. Affected versions (verified)

- Advisory: **GHSA-337j-9hxr-rhxg** — "React Router: Arbitrary Constructor Injection via
  `deserializeErrors()` in React Router SSR Hydration". Moderate severity (CVSS 6.1).
- Affected range: **react-router / react-router-dom >= 6.4.0, < 7.18.0** (per the GitHub
  advisory). Patched: **7.18.0 only** — no 6.x patch release exists.
- This repository pins **react-router-dom 6.30.4** (package.json + package-lock) → **in range,
  unpatched on the 6.x line.**

## 2. Application exposure (assessed against our actual usage)

- The flaw is in **SSR hydration error deserialization**, explicitly scoped by React Router's
  advisory to **Framework Mode and Data Mode applications doing SSR/hydration**. Declarative
  Mode applications are stated not affected.
- PAIGE's customer application is a **Vite SPA using React Router in Declarative Mode**
  (`createBrowserRouter`-less `<Routes>` composition; no server rendering, no hydration, no
  `RouterProvider` SSR error serialization anywhere in `src/`).
- **Exposure conclusion: NOT EXPLOITABLE in this application** as deployed. No code path feeds
  server-caught router errors into client hydration — the vulnerable code does not execute.
- `npm audit` flags the version range regardless of mode; that is why the `audit` gate is red.

## 3. Compensating controls (present today)

- No SSR surface: the app ships as a static SPA; there is no Node SSR process deserializing
  router errors.
- User interaction is required by the advisory itself, plus attacker input shaping SSR-caught
  errors — a precondition our architecture does not create.
- Standard content-security and network boundaries of the platform remain in force.

## 4. Severity (for THIS repository)

- Upstream: Moderate (CVSS 6.1) in vulnerable configurations.
- **Here: effectively informational** (not reachable), but the red `audit` gate is a real CI
  signal that must be dispositioned, not ignored.

## 5. Remediation options (with risk)

1. **Major upgrade to react-router-dom 7.18+** — the only version-true fix. This is a
   **6→7 major migration** touching the app's entire routing layer (API changes across
   `react-router-dom` v7; requires a scoped compatibility + regression plan: route-tree
   migration, lazy-loading, relative-link semantics, full suite re-run). **High regression
   surface; must not be done opportunistically inside another lane's PR.**
2. **Documented audit exception / override for this advisory** — `npm audit` supports
  `overrides`/`auditConfig` exceptions (npm ≥ 10.5) recording the assessment rationale in the
  repo. Low risk; keeps the gate red-free for FUTURE advisories (the exception is
  advisory-id-scoped, not a gate bypass). Requires owner acceptance of the "not exploitable
  here" assessment.
3. **Wait for a 6.x backport** — none announced as of 2026-10-22; do not assume one.

## 6. Ownership & recommended path

- **Decision owner: the platform owner** (remediation option 1 is a major dependency upgrade —
  an owner-scoped engineering item, not a lane-absorbable chore; option 2 records his
  acceptance of the exposure assessment).
- **Recommended:** option 2 now (scoped exception citing this assessment) + option 1 scheduled
  as its own workstream with a compatibility plan. This keeps every future advisory visible —
  the exception is per-advisory, not per-gate.
- Until either lands, the honest CI status on every PR is: `audit` red, GHSA-337j-9hxr-rhxg,
  assessed not-exploitable-here (this document), remediation owner-decision pending.

## 7. What this assessment is NOT

- Not a waiver of the audit gate's future findings (the gate stays; only this advisory is
  dispositioned).
- Not a claim that react-router 7 is unsafe to adopt — only that adopting it is a major
  upgrade that needs its own plan.
