# Paige UI Delivery Standard

Status: canonical repository delivery doctrine for visible interface work.

## Scope

This standard applies to any agent designing, redesigning, or materially changing a visible Paige interface: product pages, settings, modals, drawers, forms, onboarding, funnels, landing pages, dashboards, tabs, empty states, responsive/mobile layouts, interaction states, animation, and styling.

## Mandatory skill order

1. Start every software assignment with the installed Flow-by-Flow skill.
2. For any visible UI impact, read `.agents/skills/paige-ui-design/SKILL.md` and every routed file before design or implementation.
3. For a new or materially changed user flow, use the installed Flow Prototype skill before production implementation.

A material flow change changes a user's goal, choice, step, state, transition, confirmation, exit, recovery path, or side effect. Forms, onboarding, funnels, drawers, modals, settings, payment and connection flows, destructive actions, and multi-state interactions normally qualify. A presentation-only change may record a reason that Flow Prototype was not required.

### Owner waivers (governance rule)

The owner may waive exactly two of these gates, and the UI delivery evidence validator enforces the grammar:

- **Flow-by-Flow** may be recorded as `FLOW_BY_FLOW: WAIVED: owner-decision=<substantive reference>; reason=<substantive reason>` when the skill is genuinely unavailable in the delivery environment and the owner has accepted a grounded flow trace in its place. A waiver is never a substitute for reading the skill when the skill is available; the FLOW_BY_FLOW waiver's reason must establish the skill's genuine unavailability in its own words, and CI checks this fail-closed: exactly two unambiguous forms qualify — a negator immediately before an availability word ("not installed", "not present", "not available", "never installed", "no longer available") or an affirmative unavailability word in otherwise negation-free prose ("unavailable", "absent"). ANY other negation anywhere in the reason ("not unavailable", "not currently unavailable", "does not appear to be unavailable", "anything but unavailable") rejects it, as does a reason that admits availability ("available but inconvenient"). Keep the reason to the unavailability statement itself, and assert it OF the gate: CI requires at least one clause whose unavailability predicate is bound directly to Flow-by-Flow — the predicate follows the mention itself, optionally through "skill" and a simple copula, e.g. "the Flow-by-Flow skill is not installed", "Flow by Flow is absent from this environment". A mere mention is not binding: "Flow-by-Flow documents that the screenshot skill is unavailable" predicates unavailability of ANOTHER subject and never qualifies, and the bare word "skill" is not identifying either ("the screenshot skill is unavailable" is another skill's claim). No clause in the reason may affirm availability after canonical stripping — whether it names the gate, another subject, or only a pronoun referring back to it ("unavailable here; it is installed and available"): the reason is an unavailability statement, not an availability commentary. The affirmation is a PREDICATE about a subject, not a bare word: "unavailable at present" (temporal) and "absent from the present delivery environment" (adjectival — including the "present-day" compound only; a hyphenated predicative assertion like "is present-here today" is NOT adjectival) are unavailability statements and pass, while a predicative "present" rejects — whatever ordinary adverbs or verb phrases sit between the verb and the word ("is present", "is currently present", "continues to be present"); a bare "installed" or "available" rejects. 'neither/nor' denials anywhere reject.
- **Flow Prototype**, only when the flow change is material (`MATERIAL_FLOW_CHANGE: YES:`), may be recorded with the same `WAIVED: owner-decision=...; reason=...` grammar when the owner has ruled the changed flow itself and waived the prototype gate for it. When the change is not material, `NOT_REQUIRED: reason` remains the only non-PASS form.

The reference must be recognizable and reviewable (a PR/issue number, a URL, or a dated ruling) and the reason must be meaningful prose — an interjection pair like `owner-decision=no; reason=ok` is a bypass, not a waiver. A waiver with an empty, placeholder, or unresolved owner-decision or reason is rejected exactly like any other non-substantive value. `WAIVED` is invalid for every other gate, including `PAIGE_UI_DESIGN`. A waiver records an owner decision on the record; it is never a default, and it never weakens any other check.

## Design contract

Start with the user's actual job, audience, primary action, data and permission truth, and a stated visual direction. Reuse Paige tokens and established patterns before inventing replacements. Avoid generic cards, decorative gradients, oversized empty space, redundant banners, filler copy, static-looking selectors, and dashboard chrome without a user purpose.

Complete the usable flow, not just the primary screen. Include relevant first-use, loading, empty, populated, validation, success, refusal, error, retry, cancellation, close, Back, permission, destructive confirmation, and workspace-switch behavior.

Do not fabricate metrics, activity, history, health, providers, entitlements, authorization, tenant data, or success. Tenant context may change content and permission truth, never the canonical Solo shell.

## Evidence contract

A render, fixture, mock, static test, or checked box is not proof that a feature works. UI delivery evidence is separated into:

- automated tests and negative controls;
- static lint/type/build and contract inspection;
- rendered evidence at the required geometry and themes;
- behavioral browser evidence for actions, exits, errors, and recovery;
- authenticated runtime evidence for tenant/role/server-contract claims;
- exact `UNVERIFIED` items.

Every UI PR adds a `docs/evidence/ui-delivery/*.md` record based on the template and links it from the UI PR template. The CI workflow validates the record's presence and required fields for recognized UI paths. It is a routing guardrail, not independent proof; reviewers inspect the artifacts and rerun risk-proportionate flows.

The workflow runs for pull requests and direct pushes to `main`. It blocks before merge only when repository rules require the `Validate UI delivery evidence` check; that external ruleset status must be verified rather than inferred from this file.

## Solo requirements

Verify 1536x770, 1366x768, 1024x768, and 900x1000 with PAIGE closed and open. Test the affected tenant/context and one different known-good Solo tenant/context. Inspect the actual scroll owner, clipping, reachability, keyboard path, focus handling, zoom/reflow, reduced motion, and relevant loading/empty/error/retry/permission/success/cancellation/workspace-switch states.

No tenant/account number, tenant name, fixture, demo state, or URL value may fork shell layout, navigation, responsive behavior, page host, or PAIGE workspace.

## Browser, device, 4K and scaling — shared release standard (owner 2026-10-15)

[**Canonical browser/display support and evidence matrix**](paige-browser-display-compatibility.md) extends, never replaces, the existing eight SOLO viewport checks above, Impeccable, Flow-by-Flow, actual authenticated QA or the one shared SOLO product rule.

- **Supported browsers:** current and previous stable major Chrome, Edge, Firefox and Safari on vendor-supported desktops; iPhone/iPad Safari and Android Chrome. Maintain feature parity of permitted Chat/Live/departmental/business actions; only genuine browser hardware/permission behavior may vary, with truthful supported fallbacks.
- **Browser engines and real hardware are separate classes:** PR-risk-weighted Chromium, Firefox and WebKit automation; separately prove branded Safari, Edge and real iOS/Android when a changed flow depends on OAuth, voice/media, file picker, touch, virtual keyboard, or OS storage/permission behavior. Playwright WebKit is not the Safari binary. Record actual versions, route, user action and outcome.
- **Responsive geometry:** preserve required 900x1000, 1024x768, 1366x768, 1536x770 with PAIGE open and closed; add 320 and 390 CSS-pixel phone width, 768 tablet, 1920 Full HD, 2560 QHD and 3840 4K-width checks according to change impact. Prefer existing shared layout/tokens, responsive min/max widths, crisp SVG/retina-safe media and charts, readable density, measured scroll owners and no clipped approval/Send/recovery controls.
- **Display fidelity:** distinguish CSS viewport vs *physical* pixels, devicePixelRatio and OS/browser scaling. Sample 125/150/200% OS scaling and 200/400% browser zoom or their actual CSS-pixel reflow equivalents, including 320 CSS px without unintended horizontal scrolling. 3840 CSS-pixel screenshot does not prove real 4K hardware.
- **Affected customer journeys:** check keyboard focus, touch targets, reduced motion, theme, Chat open/closed, Live permissions and denied microphone fallback, session/login/reload, OAuth return, upload/download, client invite/Welcome and truthful readback as applicable. Use anonymized fixture/authorized QA rather than leaking business data.
- **Evidence and CI truth:** document a Browser / Device / High-resolution Coverage subsection in the **existing** `docs/evidence/ui-delivery/*.md` file, with tested engine/actual device, CSS viewport, OS scale, zoom, themes, artifacts, `PASS`/`FAIL`/`BLOCKED`/`UNVERIFIED` and exact untested boundaries. Current evidence validator does not require these as separate machine fields; build and validate the additive multi-engine Playwright and actual-device acceptance suite before enabling a new required CI status. Do not silently break active PRs, waive material UI defects, or advertise broad certification from fixture tests.

## Truth labels

- `LIVE`: proven usable contract in the tested environment.
- `PARTIAL`: proven subset with the missing part named.
- `UNAVAILABLE`: required provider/backend/entitlement is absent.
- `UNVERIFIED`: evidence was not collected at the stated level.

Use `PASS`, `FAIL`, `BLOCKED`, `INVALID`, and `UNVERIFIED` for delivery outcomes without softening them.

## The five composable quality skills

The standard above is executed through five composable skill modules. They are not five competing
policies: each is an operational module that routes back to this doctrine, the
`.agents/skills/paige-ui-design/references/paige-quality-gates.md` reference, and the one evidence
template. `paige-ui-design` remains the mandatory entry router (`CLAUDE.md` §00); it routes to these
five, in order, for any visible, interactive, user-flow, domain-contract, or behaviorally
significant change. A module adds no new source of truth; it points at the slice of this doctrine it
governs and names the evidence fields that prove it.

| # | Skill | Governs (this doctrine's slice) | Evidence it requires |
|---|---|---|---|
| 1 | `paige-owner-intent-fidelity` | the Owner Intent & Experience Contract — the [Design contract](#design-contract) extended with **what must NOT happen** and **what must be preserved** | `OWNER_INTENT`, `MUST_NOT_HAPPEN`, `MUST_PRESERVE`, `ACCEPTANCE_CRITERIA` |
| 2 | `paige-visual-immersive-quality` | the [Design contract](#design-contract) visual bar + the premium/motion standard | `VISUAL_DIRECTION`, `MOTION_PURPOSE` |
| 3 | `paige-interaction-geometry-accessibility` | [Solo requirements](#solo-requirements) + accessibility | the eight `SOLO_*` records, `KEYBOARD_FOCUS`, `ZOOM_REFLOW`, `REDUCED_MOTION`, `STATE_COVERAGE` |
| 4 | `paige-protected-behavior-regression` | `CLAUDE.md` §58 anti-regression + the protected-seam declaration | `PROTECTED_SEAMS` — each impacted seam tested, each unaffected seam named |
| 5 | `paige-release-acceptance-evidence` | the [Evidence contract](#evidence-contract) + [Truth labels](#truth-labels) + release governance | the six evidence classes + the seven `RELEASE_*` fields |

**Backward compatibility (so the upgrade breaks no in-flight work).** The new evidence fields
(`OWNER_INTENT`, `MUST_NOT_HAPPEN`, `MUST_PRESERVE`, `ACCEPTANCE_CRITERIA`, `MOTION_PURPOSE`,
`PROTECTED_SEAMS`) are in `docs/evidence/ui-delivery/TEMPLATE.md`, and the CI guardrail now **recognizes
them**: it validates each only when present (it must not be a placeholder — CI checks non-placeholder
only; whether the statement is genuinely substantive is a reviewer judgment) and **never requires** it —
so records with or without them pass and open UI PRs do not break. They become required only per a
dated, announced step once the open-PR window clears — never silently.

**Backend-to-visible routing.** A backend, RPC, edge-function, entitlement, or provider-contract
change that alters a visible customer flow is in scope for this standard **even when it touches no UI
file** — the author declares the visible-flow impact and adds the evidence record, and omitting it
when a visible flow changed is a reviewable defect. The guardrail (`scripts/ci/ui-delivery-evidence.mjs`)
now **routes a DECLARED impact**: a `Visible-Flow-Impact: yes` (or `true`) commit trailer on a change
under `supabase/functions/**` or `supabase/migrations/**` requires an evidence record even when no UI
file changed. The CI route is scoped to those two directories; a declared entitlement or
provider-contract change that lives in another path (e.g. a non-UI `src/**` client) is **not**
CI-routed and falls to author declaration and review. An **undeclared** backend change is likewise
caught by author declaration and review, never by CI — declaration is the trigger, so do not rely on CI
to catch an impact nobody declared.

## Ownership and exceptions

This doctrine, the project skill, the five composable quality skills, the evidence schema, and the CI
guardrail are owned together. A change to their meaning requires an explicit standards review. Exceptions must name their scope, reason, approver, expiry or follow-up, and remaining `UNVERIFIED` behavior; silence is not an exception.

The owner-facing process is summarized in `docs/guides/how-paige-ui-work-gets-designed-tested-released.md`.
