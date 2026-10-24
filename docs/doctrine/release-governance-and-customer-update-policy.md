# Release Governance & Customer Update Policy

<!-- RELEASE_GOVERNANCE_POLICY -->

**Status:** canonical standing delivery policy

**Owner:** Antonio Cook

**Effective:** 2026-09-06

**Applies to:** every agent, pull request, merge, migration, edge deployment, web deployment, staged rollout, release decision, customer update, and Paige-authored answer about what changed.

## Prelaunch release timing — owner tests live (superseding 2026-10-15)

During the owner's explicitly designated **PRELAUNCH / no-paying-customer** period, technical deployment and the owner's final product acceptance are **two different stages**. A reviewed, green, safely scoped source PR is ordinarily merged into `main` and deployed without waiting for a hands-on owner design/UX walkthrough, full customer-journey QA, or a public customer-release version. The owner then tests the real live experience and approves the product or requests revisions. Agents do the routine troubleshooting, evidence and release themselves; approval loops are not a substitute for building a working feature. The release remains an **internal production build** until the existing customer-announcement and named-release rules below are met.

Required security and technical gates still apply: actual material authorization/privacy/tenant defects, unapproved real external sends or financial effects, destructive changes, required exact-head CI and sound non-bypassing migration/deployment procedures. A newly deployed change may have authenticated product acceptance `UNVERIFIED` while the owner tests it; **never** mislabel that as fully accepted, announced or externally verified. Do not demand unrelated provider activation or all-journey/browser acceptance as a precondition of an otherwise safe, independently useful prelaunch release.

When paying-customer onboarding begins, the owner will explicitly replace this prelaunch policy with the higher-assurance customer-release process. The policy transition is an owner decision, not something agents infer from a test account, draft billing flow or potential buyer.

## 1. One truthful release system

This policy is the canonical rule for how Paige Agent AI identifies, proves, names, and explains releases. It does not replace the Master Project Reference, Second Brain, Surface Binding Ledger, Integration Capability Registry, tier matrix, or evidence records. Those remain the authoritative stores for their own facts. This policy tells every delivery path how to use them consistently.

The release chain is:

`internal build identity → release channel → customer release identity (only when earned) → What's New → Paige-readable summary`

No layer may infer the next one. A commit is not a deployment. A deployment is not a customer release. A customer release name is not proof that its outcome works.

## 2. The three identities

### Internal build identity — always recorded

Every PR and deployment closeout records:

- exact 40-character commit SHA;
- deployment/provider ID and environment;
- release channel;
- migration status and exact migration identifiers, or `NOT_APPLICABLE`;
- edge-function status and exact deployed functions/versions, or `NOT_APPLICABLE`;
- CI, security, and required production-check results;
- evidence links or reproducible references;
- any authenticated or production-runtime proof boundary, with a typed affected scope, a typed substantive blocker, the exact claim excluded from `LIVE`, and evidence explaining why proof remains owed;
- rollback or forward-fix position.

Within a release record, each internal build is marked `referenced` when it supplies the customer note's
internal technical reference, or `supporting` when it is retained only as build history. The note resolves
structurally to all and only the `referenced` builds; supporting preview/development evidence cannot satisfy
a publication gate.

This identity is operational truth. It is internal by default and need not appear in customer copy. `main`, a branch name, a PR number, “latest,” or a URL alone is not an exact build identity.

### Release channel — always explicit

- `development`: local or isolated work; not customer-reachable.
- `preview`: hosted review evidence; not production and not customer release proof.
- `production`: deployed to the live production environment.
- `staged`: an owner-approved bounded rollout with the cohort, percentage or eligibility rule, start/stop conditions, monitoring owner, and recovery path recorded.

Promotion between channels never changes evidence labels by itself. Preview proof stays preview proof. Production deployment without an authenticated drive stays `PROOF OWED` for claims that require it.

### Customer release identity — only when earned

A human version and release name exist only when a coherent, owner-visible outcome is ready to explain as one release. Routine commits, migrations, edge deploys, repairs, and internal refactors keep their internal build identity without inventing a customer version.

During the Paige Solo Preview / founding-release period, customer releases use `0.x.y`:

- **Patch (`0.x.y`):** fixes, reliability, performance, or small polish. Record internally; generally do not announce unless the issue materially affected customers or requires action.
- **Minor (`0.x.0`):** a meaningful owner-visible capability or workflow improvement. A release note is required.
- **Major (`x.0.0`):** a coherent platform milestone, never a count of PRs. `1.0` requires Antonio's explicit release decision and demonstrated end-to-end operating-system coherence.

Version numbers are assigned at the customer-outcome boundary, not per PR. Several internal builds may compose one customer release; one PR may also remain unversioned.

## 3. Customer announcement gate

A customer-facing release may be announced only when all are true:

1. The actual user outcome is deployed and evidence-backed.
2. CI, security, and every required production check are green for the exact deployment identity.
3. Required authenticated proof is complete, or the release wording names the exact `PROOF OWED` boundary and excludes it from any `LIVE` claim.
4. No prototype, UI shell, listed integration, planned provider capability, fixture, static render, or unavailable contract is described as live.
5. The release record names scope, affected audience/tier, benefits, limitations, rollback/recovery position, and exact deployment identity.
6. The Master Project Reference, relevant Second Brain record, tier matrix when applicable, Surface Binding Ledger when applicable, and Integration Capability Registry when applicable agree with the claim.
7. The owner has approved the customer release identity and publication. Merging or deploying is not publication authority.

If any required check is red, the release is not announced. If proof is unavailable but the usable outcome is otherwise safe and real, the note may use `PARTIAL` or `PROOF OWED` only when it precisely separates what works from what remains unproven.

## 4. Required status language

- `LIVE`: the stated outcome is deployed and proven at the evidence level it requires.
- `PARTIAL`: a proven subset works; the exact missing portion is named.
- `UNAVAILABLE`: the required contract/provider is absent, disconnected, or not offered.
- `PROOF OWED`: implementation exists, but the required authenticated or production evidence is not complete.

These words describe claims, not optimism. A single release may contain more than one status when each item is clearly separated.

## 5. Required What's New format

Every minor or major customer release note uses this order:

1. **Release name, version, and date**
2. **Plain-English customer outcome** — what the owner can now accomplish
3. **What changed** — concise, outcome-led details
4. **Who can use it** — exact audience, role, tier, cohort, or staged eligibility
5. **Action required** — what the owner must do, or “No action required”
6. **Status** — `LIVE`, `PARTIAL`, `UNAVAILABLE`, and/or `PROOF OWED`, applied to specific claims
7. **Known limitations and safe next step** — for each `PROOF OWED` build area, name the exact deployment, migration/edge or authenticated-runtime area, unproven boundary, and claim excluded from `LIVE`
8. **Exact technical release reference — INTERNAL ONLY** — commit SHA, deployment ID, environment, migrations/edge status, checks, and evidence
9. **Paige-readable summary** — tenant-safe plain language Paige can use to answer, “What changed in my workspace?”

Customer copy never includes secrets, internal sensitive payloads, tenant data from another workspace, raw security findings, or chain-of-thought. The internal technical reference is not displayed in routine customer copy.

## 6. Release record and closeout

The machine-readable contract is `docs/release-governance/release-record.schema.json`. A customer release candidate gets one record under `docs/release-governance/records/` before publication. Internal-only PRs still complete the release-governance fields in the PR body; they do not need a customer release record unless they join a named release train.

Release records are additive historical evidence. Correction history keeps its reason as resolved prose and records each former field value plus its resolved replacement in structured `corrected_values`; unresolved replacement text cannot pass. Correct or retract an error with a new record naming a
different, existing predecessor record and the reason; self-references, missing targets, cycles, deletion, and
rewriting are invalid. Never alter the dated original to imply proof that did not exist at publication time.
The Master Project Reference remains the source for current platform truth.

Every PR answers:

- What is the internal build identity now, and what remains unknown until deployment?
- Which release channel is affected?
- Is this internal-only, patch, minor-candidate, major-candidate, or part of a named train?
- Is customer release-note content required?
- Which claims are `LIVE`, `PARTIAL`, `UNAVAILABLE`, or `PROOF OWED`?
- Which truth stores must update in this same change?

Every deployment closeout replaces anticipated identifiers with exact observed identifiers and records the post-deploy result. A passed CI run never fills in an unobserved production deployment ID.

## 7. First customer-facing release train — recommendation for owner decision

**Decision state: RECOMMENDED; NOT APPROVED; NOT ANNOUNCED.**

- **Train:** `Paige Solo Preview 0.1.x`
- **First candidate label:** `0.1.0 — Governed Workspace Foundations`
- **Why this is truthful:** the current production record shows meaningful owner-visible Solo workflows and governed foundations, while the Surface Binding Ledger explicitly reports no fully `LIVE` end-to-end Paige surface binding and several capabilities remain `PARTIAL`, `UNAVAILABLE`, or `PROOF OWED`.
- **Required scope before publication:** the owner selects the small set of genuinely usable outcomes to include; each included outcome passes the announcement gate above. Unselected or unproven platform breadth stays out of the note.
- **Not authorized by this recommendation:** assigning `1.0`, publishing marketing, sending a customer announcement, or claiming platform-wide operating-system coherence.

## 8. Canonical in-app customer update experience

Canonical release records remain durable internal release evidence. The existing signed-in `PlatformUpdateBanner` is the sole customer-facing update surface for this MVP and the only place to announce an available update or show concise **What's new** content. Do not add an unread badge, workspace/account indicator, standalone Updates page, navigation item, update feed, modal, dashboard, release center, or competing customer destination.

- A routine build without one safely resolved customer-publication record says only **“An update is ready”** and offers Reload.
- A meaningful release may show its approved name/version, owner outcome, and inline **What’s new** details only from the canonical record tied to the exact deployed build.
- Missing, invalid, stale (not bound to the detected build), ambiguous, future-dated, staged, superseded, unapproved, or technically unsafe records fail closed to the generic experience.
- Ordinary owners never receive commit SHAs, deployment identifiers, provider names, architecture, or technical release records.
- Dismissal applies to the detected build; a later build can reappear. The banner remains non-blocking and defers while an editable control has focus.
- Reload is always explicit. Registered unsaved edits, saves, uploads, attached Paige documents, and streaming Paige responses block reload until work is cleared or saved.
- No sign-in-preservation promise is made without authenticated proof. Cache cleanup does not clear application local storage.

The build-time customer manifest is a customer-safe projection, not a second release store: it is derived from `docs/release-governance/records/` through the canonical validator. After a release reload, the same projected record may remain available in the banner for the current session. Authenticated owner behavior, cross-workspace behavior, and deployment identity remain `PROOF OWED` until separately driven.

### Future expansion boundary

The former future Updates handoff is superseded by the canonical banner contract above. A future Updates destination is a separately approved product decision, not an active requirement or fallback implementation. Any later expansion requires a new owner ruling and must not silently revive a second destination, workspace/account indicator, unread badge, navigation item, modal, or feed.

Paige-authored answers may use the same published record’s Paige-readable summary, but this banner does not broaden Paige’s evidence or action authority.

## 9. Authority and conflicts

This policy governs release identity and customer update wording. It does not grant merge, deployment, external-publication, marketing, provider, spending, migration, or destructive-data authority. Current higher-authority owner instructions still control those acts.

If another document conflicts with this policy on release identity or customer updates, stop the conflicting claim, preserve the more conservative evidence state, and record a dated correction in the decision log. Do not create a sibling policy.
