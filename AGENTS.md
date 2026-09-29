# Paige agent delivery rules

These instructions apply to Codex, Claude, and every other implementation agent working in this repository.

## Mandatory routing

1. Every software assignment starts by reading the installed Flow-by-Flow skill completely and following every routed reference.
2. Before designing or implementing any visible-interface change, read `.agents/skills/paige-ui-design/SKILL.md` completely and follow every routed reference. Visible interface includes product screens, settings, modals, drawers, forms, onboarding, funnels, landing pages, dashboards, tabs, empty states, responsive/mobile layouts, interaction states, motion, and visual styling.
3. A new or materially changed user flow also requires the installed Flow Prototype skill before production implementation. This includes forms, signup/onboarding, funnels, drawers, modals, settings, payments, connections, destructive actions, and any flow with multiple states or exits.
4. **Impeccable is MANDATORY for every UI/UX design, redesign, visual-polish, or interaction task.** Before design or implementation, read the installed Impeccable skill and cite it (canonical upstream source: `https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md`); report which of its checks were applied and their results. If the skill is not available in your environment, STOP and report it — never silently skip Impeccable. The finish-review is still required before delivery.

Do not begin design or implementation until the applicable skills have been read. A wrapper, summary, checkbox, fixture, or rendered screenshot is not a substitute.

## Capability routing (MANDATORY pre-edit gate)

Paige is **one governed operating platform**, not a collection of apps. The binding rule, the
required capability entry path, and the truthful completion rule live in
`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` → "Capability Portfolio — the One Paige Operating Platform
rule". Read it before any substantive feature work. Where a capability belongs, and what proof it
owes, is `docs/doctrine/paige-capability-portfolio.md`.

**This is a PRE-EDIT gate, answered before the first line of code — not a second ship-time
checklist.** The ship-time gate already exists and is unchanged: the six-part checklist in
`docs/brain/paige-brain-wiring-standard.md` §3 (second-brain entry · callable seam · context · tool ·
tier availability · honest-when-it-cannot-answer · modality-neutral acceptance). Answer the ten
questions below to decide **where the work goes and what it must reuse**; answer those six to decide
**whether it is done**. They are two moments in one lifecycle, never two competing lists.

State the answers out loud in the plan or the first message of the build. "I checked" with nothing
named did not happen.

1. **Intended owner outcome** — the real job a human completes, not the component that renders.
2. **Domain owner** — which portfolio family owns this (matrix, column 1), and who else is in flight.
3. **Harness / Gateway dependency** — which shared layer (A–G) it needs, and whether that layer is
   real today per `docs/delivery/harness-completion-map.md`. If the layer is absent, say so; do not
   route around it.
4. **Spine capability** — the exact `domain.capability` key it reads or registers in
   `supabase/functions/_shared/paige-spine/registry.ts`, **or** an explicit honest `UNAVAILABLE`
   with its reason. Never a key you intend to add later, stated as if present.
5. **Provider / connection requirement** — the Integration Capability Registry entry
   (`docs/integration-registry/`) read before, updated before merge. No entry yet → record the
   missing-entry requirement in the work packet and proceed only with work that does not invent
   provider authority. **Listed is never connected** (R1).
6. **Approval / budget / autonomy lane** — its `action-risk` class, its `MUTATION_VERB`, its
   Trust-Compass lane (§67/§68), and the one approval gate
   (`docs/doctrine/one-approval-gate.md`). No slice builds its own confirm channel.
7. **Durable job / event need** — whether it needs the native-event bus or a durable job, and which
   existing producer/drainer it extends. Never a parallel scheduler.
8. **Readback / receipt / Rail** — what proves the act actually happened, and what Paige is allowed
   to say about it. An act with no readback may not be reported as done (R8).
9. **Visible surface + Binding Ledger state** — the `surface` row in
   `docs/binding-ledger/surface-binding-ledger.json`, its current state, and the state this change
   moves it to. A surface not in the ledger is not owner-visible yet.
10. **Authenticated / provider proof required** — the exact evidence class that will make the claim
    true, and what stays `PROOF OWED` or `UNVERIFIED` at merge.

**Prohibited, and blocking.** No domain may create a second Harness, authority or execution engine,
tool registry, job system, browser system, evidence or receipt stream, provider registry, memory, or
orchestrator. If a capability appears to need one, that is a routing conversation, not a build.

**Fixture-backed capability claims are prohibited.** A capability is not real because a component
renders, a tool exists, a fixture or structural test passes, a provider name appears in
documentation, a flag is set, a migration merged, a preview deployed, or a previous agent's report
said so. State `UNVERIFIED` or `UNAVAILABLE` honestly instead — that is always an acceptable answer,
and a false `LIVE` never is.

## Solo-shell product — one build for every tenant

**Standing rule (owner, 2026-09-22).** Everything is built for the one **Solo shell** product — identical for every tenant. No tenant-specific code, config, migrations, or UI, and no tenant IDs, names, or one-account special cases in committed artifacts (or in shared prototypes and design surfaces). Owner-account setup steps (e.g. the owner reconnecting his own connections) are product usage, not code. Paige's core chat is identical for every account; optional capabilities (e.g. business funding) arrive as **opt-in Marketplace add-ons**, never built into the core. Apply the §200 platform-independence checklist on every PR. When an example or fixture tenant is genuinely needed, use a `test-tenant-*` row or a neutral placeholder, never a real account name. This is a go-forward choosing rule for product, example, demo, and tenant-conditional artifacts, not a purge; legitimate historical records — §13 corrections, decision-log entries, data-fix migrations, and audit/portfolio docs — may name real accounts and are never removed (§63/§58). Cross-refs: §9 (platform vs tenant seam), §2 (funding/credit is opt-in, never a platform default), §200 (platform independence), §63 (owner's real accounts are never example/reference targets).

## Interface standard

Design around the user's actual job, real data contracts, permissions, and complete flow. Reuse Paige's established tokens and design system before creating replacements. Do not fabricate metrics, activity, history, health, providers, authorization, or capabilities. Do not ship generic card grids, decorative gradients, empty dashboard chrome, static-looking controls, or purposeless effects.

**Owner UI principle — performance and interaction quality over wording.** Cut redundant banner and intro copy; do not repeat context the user already has from where they are. Prefer usable space for the real work over decorative headers. Motion must be purposeful and performant — animate `transform`/`opacity` only, and be reduced-motion safe (honor `prefers-reduced-motion`).

Interface authority is `CLAUDE.md` §00 (owner ruling, 2026-09-22): Claude Code owns the interface, executed as Flow-by-Flow first, then Impeccable, and the owner approves the design before it ships. Claude Design is out of the loop; a prior design pack is reference material, not an authority that outranks Impeccable's craft floor. (This line previously said agents "faithfully port the approved Claude Design pack"; §00 voids that and it is struck here, as it was in `.agents/skills/paige-ui-design/SKILL.md` on 2026-09-24.)

All states must be honest:

- `LIVE`: backed by a proven, usable contract in the tested environment.
- `PARTIAL`: a proven subset works and the missing part is named.
- `UNAVAILABLE`: the required provider or backend contract does not exist or is not connected.
- `UNVERIFIED`: the claim was not proven at the evidence level stated.

A UI feature is not working merely because it renders, has fixtures, passes a structural test, or has an attestation. Claims require appropriate static, automated, rendered, behavioral, and authenticated-runtime evidence, with untested behavior labeled `UNVERIFIED`.

## Release identity and customer updates

<!-- RELEASE_GOVERNANCE_POLICY -->

Before opening or closing a PR, merging, deploying, assigning a version, or describing a change to a customer, read `docs/doctrine/release-governance-and-customer-update-policy.md`. Record the exact internal build identity and release channel for every delivery. Create a customer release name/version only for a coherent owner-visible outcome that passes the policy's announcement gate. Never turn a commit, preview, prototype, shell, listed provider, or `PROOF OWED` capability into a `LIVE` customer claim.

## Merge gate

**Independent review is the lane's own to run** (owner ruling, Antonio Cook, 2026-09-29): before asking to merge, the lane spawns a separate reviewer that did not write the code, and records it as such. Codex may review and its findings are handled like any reviewer's, but Codex is never a gate and no lane holds a merge waiting on one.

1. **Run the independent review on the exact head, and let it COMPLETE before merging.** The reviewer is spawned separately, did not write the code, and reads the real diff. Never merge while it is running.
2. **Disposition every finding** — fix it, or record a reasoned decline. If you push a fix, the head changed: have the reviewer re-check the new head, repeating from step 1 **once**. If a further round would be needed, stop and escalate rather than merging.
3. **Record the review in the PR** — that the reviewer did not write the code, what it checked, and its verdict. Findings from Codex or any other reviewer that does report are dispositioned the same way; no step waits for one.
4. **Docs-only closeout PRs get the independent review too** — they are small and it is fast.

This is in addition to every existing gate (exact-head required CI green, mergeability, evidence). It exists because a PR marked Ready and merged seconds later has had real defects — including a P1 — surfaced by the auto review only after merge.

## Shipped Delivery Log

At workstream startup and before PR preparation, read `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` Section 4.0. After every merge to `main`, append one verified row to its Shipped Delivery Log in the same closeout change: exact PR and main commit, what shipped and why, actual delivery/proof boundary, canonical evidence, and customer-release eligibility. A workstream may not be reported complete until that row exists, or its closeout records an explicit `N/A` because the PR did not reach `main`. Never create a second shipped log, delivery ledger, master file, roadmap, or program registry.

A closeout-only PR whose sole change is recording the exact post-merge identity of the preceding delivery closes that preceding row and is not logged recursively. Git remains the evidence for that mechanical closeout commit. This exception may not carry product, policy, capability, or status change.

## Evidence and review

Every UI pull request must add a record under `docs/evidence/ui-delivery/` based on `docs/evidence/ui-delivery/TEMPLATE.md` and use `.github/PULL_REQUEST_TEMPLATE/ui-delivery.md`. The `ui-delivery-evidence` workflow checks recognized UI paths for that record. The guardrail validates structure only; reviewers must inspect the evidence and the user-visible flow. A backend, RPC, edge-function, entitlement, or provider-contract change that alters a visible customer flow declares it with a `Visible-Flow-Impact: yes` commit trailer and adds the evidence record. The CI guardrail auto-routes such a declared change when it touches `supabase/functions/**` or `supabase/migrations/**`; a declared change on any other path (e.g. a non-UI `src/**` client) is review-routed, not CI-routed, so reviewers must inspect the flow.

For Solo UI, cover 1536x770, 1366x768, 1024x768, and 900x1000 with PAIGE closed and open. Test a relevant tenant and a different known-good tenant. Verify the real scroll owner, clipping, reachability, keyboard path, focus, zoom/reflow, reduced motion, relevant states, cancellation, and workspace switching.

See `docs/doctrine/paige-ui-delivery-standard.md` for the binding standard and `docs/guides/how-paige-ui-work-gets-designed-tested-released.md` for the owner-facing release map.
