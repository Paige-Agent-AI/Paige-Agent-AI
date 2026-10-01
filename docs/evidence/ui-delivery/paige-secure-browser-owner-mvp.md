# UI delivery evidence: Paige Secure Browser owner MVP foundation

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: `docs/prototypes/paige-secure-browser-mvp-flow.md` records first use, empty, cancel/close, retry, authority, tenant switch, expiry, pause/revoke/delete, failure, and regression states before implementation.
PAIGE_UI_DESIGN: PASS: implementation followed `.agents/skills/paige-ui-design/SKILL.md`, PACK-FIRST, the Paige visual-system references, and the accessibility checklist; the owner directed this work to use the established Paige UI process while preserving the unapproved Live Voice boundary.
MATERIAL_FLOW_CHANGE: YES: adds a feature-flagged owner review flow for requesting an unavailable Secure Browser run and a Vault Connected Accounts lifecycle surface.
FLOW_PROTOTYPE: PASS: `docs/prototypes/paige-secure-browser-mvp-flow.md` is the approved interaction/state packet under the owner's 2026-09-07 implementation authorization; no immersive Live Voice or provider-backed design is implied.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace owner reviews a business purpose, HTTPS target, read/propose-only scope, and authority before asking Paige to prepare the capability; Vault owners can inspect and control safe account metadata.
VISUAL_DIRECTION: PASS: the isolated cards use existing Paige ink, muted, lift, radius, gold-action, and focus conventions with no provider branding or new shell/navigation pattern.
AUTOMATED_EVIDENCE: PASS: 12 focused Vitest cases passed for the request card, Vault Connected Accounts states including truthful expiry, tenant switching, contract validation, and recursive sensitive-value refusal; both Secure Browser smoke suites passed.
STATIC_EVIDENCE: PASS: focused ESLint, migration lint, definer-function lint, migration-version lint, Paige-token lint (44/44), production build, diff check, and `ci:tsc` ratchet passed with no new errors (baseline 13, current 13).
RENDERED_EVIDENCE: UNVERIFIED: the real Paige components have not been browser-rendered across the required viewport/theme matrix; the chat card remains deliberately unmounted while PR #1044 owns the shared workspace files.
BEHAVIORAL_EVIDENCE: PASS: jsdom tests prove review, cancel, unavailable, retry, empty, failure, pause, revoke, delete, tenant-change reset, and disabled-connect outcomes; this is automated component evidence, not authenticated browser proof.
AUTHENTICATED_RUNTIME: UNVERIFIED: no deployed migration or Edge revision, enabled tenant flag, real connected account, credential, external session, Context, provider call, or authenticated owner browser run exists in this draft.
KEYBOARD_FOCUS: UNVERIFIED: controls use labels, buttons, disabled states, and visible focus styling, but a real browser Tab/Shift+Tab/Escape/focus-return route has not been driven while the chat mount is collision-blocked.
ZOOM_REFLOW: UNVERIFIED: responsive CSS is present, but 200% zoom and narrow reflow have not been observed in the real Solo shell.
REDUCED_MOTION: PASS: `prefers-reduced-motion: reduce` disables the only new continuous animation, the resolving spinner.
STATE_COVERAGE: PASS: the flow packet and tests cover first use, empty, loading, unavailable, cancel/close, retry, owner/representative authority, tenant switch, expiry contract, pause, revoke, delete, failure, and regressions while keeping consequential actions disabled.
TRUTHFUL_STATE_LABELS: PASS: customer copy names only Paige Secure Browser and states unavailable/not connected/under setup; the internal worker is inert and Browserbase remains PROPOSED with all seven gates open.
SOLO_UI: YES: the Vault Connected Accounts tab is mounted behind the exact-tenant `secure_browser` flag; the chat request card is isolated pending the active PR #1044 workspace collision.
UNVERIFIED: real-shell rendering and geometry, keyboard/focus travel, zoom/reflow, authenticated runtime, deployed database/Edge identities, chat mounting, provider-backed work, and credentialed account behavior remain unverified or explicitly unavailable.

INTERNAL_BUILD_IDENTITY: a9982463283260cbdceed7c7b7257f9265d7f7b5; deployment=7qG8r3SyVmzuagTknQ82HbLekCf7; environment=preview; migrations=PROOF_OWED(production-application-excluded-from-this-preview); edge=PROOF_OWED(browser-use-revision-awaits-merge); evidence=Vercel-and-GitHub-CI-status-for-a9982463283260cbdceed7c7b7257f9265d7f7b5
RELEASE_CHANNEL: preview: Vercel preview `7qG8r3SyVmzuagTknQ82HbLekCf7` succeeded for `a9982463283260cbdceed7c7b7257f9265d7f7b5`; no production deployment, customer enablement, Supabase preview branch, or deployed Edge revision exists
RELEASE_CLASSIFICATION: internal-only: draft foundation is feature-flagged, provider-unavailable, and not yet mounted in the shared chat workspace
CUSTOMER_RELEASE_IDENTITY: none: no customer release or live capability is claimed from this draft
RELEASE_NOTE_REQUIRED: NO: internal-only draft with no customer enablement
RELEASE_TRUTH_BOUNDARY: UNAVAILABLE: Paige-owned policy, storage, unavailable request response, and Vault read-only/lifecycle surfaces exist in code; external browser sessions, connected accounts, credentials, downloads, and authenticated capability proof do not
RELEASE_RECOVERY: position=keep the tenant feature flag disabled and revert PR #1046 before any customer enablement if review fails; reference=docs/prototypes/paige-secure-browser-mvp-flow.md

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: real Solo shell screenshot and overflow/reachability check await shared chat integration
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: real Paige-open shell screenshot and chat-card reachability check await PR #1044 collision clearance
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: real Solo shell screenshot and overflow/reachability check await shared chat integration
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: real Paige-open shell screenshot and chat-card reachability check await PR #1044 collision clearance
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: real Solo shell screenshot and intended-scroll-owner check await shared chat integration
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: real Paige-open shell screenshot and card reflow/reachability check await PR #1044 collision clearance
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: real narrow Solo shell screenshot and intended-scroll-owner check await shared chat integration
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: real narrow Paige-open shell screenshot and card reflow/reachability check await PR #1044 collision clearance

## Scope and collisions

- Classification: owner-visible MVP foundation, internal-only and provider-unavailable.
- Affected flows: Secure Browser request review/unavailable/retry/cancel; Vault Connected Accounts loading/error/empty and future metadata lifecycle controls; server-resolved request and durable receipt path.
- Neighboring regressions: tenant-switch data clearing, ordinary Vault tabs, exact chat thread attribution, existing browser-use prerequisite behavior, and Live Voice ownership.
- Active-owner/file collisions: draft PR #1044 owns `PaigeAIChat.tsx`, `SoloPaigeWorkspace.tsx`, `solo-paige-workspace.css`, `paige-ai-chat/index.ts`, and the Surface Binding Ledger. This PR does not edit or fork those files.
- Explicit exclusions: Browserbase wiring/secrets/sessions/Contexts; external login; credentials, cookies, tokens, HTML, screenshots, recordings, and session material; credentialed Connected Account creation; real downloads; CAPTCHA solving; production enablement; immersive Live Voice UI.

## User job and state map

The owner states a business purpose and public HTTPS target, reviews the fixed read/propose-only scope and authority, and asks Paige to prepare the Secure Browser. Paige resolves the active tenant and actor server-side and returns a durable, truthful unavailable state while the worker path is gated. The owner can cancel before submission or retry without creating external activity. In Vault, the owner sees loading, failure/retry, empty/not-connected, and future safe-metadata pause/revoke/delete states. Tenant changes clear prior state. No new surface may display or capture secrets, and quarantined-download metadata cannot claim availability without a canonical Vault quarantine row. The existing Solo shell remains the scroll owner.

## Evidence index

- 2026-09-07, local development, no customer account or secret: `npm run smoke:secure-browser-security` — PASS.
- 2026-09-07, local development: `npm run smoke:secure-browser-control-plane` — PASS.
- 2026-09-07, jsdom: three focused test files, 12 tests — PASS.
- 2026-09-07: focused ESLint, SQL migration lint, definer-function lint, migration-version lint, token lint 44/44, production build, and diff check — PASS.
- 2026-09-07: `npm run ci:tsc` — PASS, no new errors; repository baseline 13 and current 13.
- 2026-09-07, GitHub PR #1046 at `a9982463283260cbdceed7c7b7257f9265d7f7b5`, including current `main` `ae0a16a0d5147a4652a06925356c427c4d543d56`: `database-contract` — PASS after a clean migration replay, including all 28 Secure Browser pgTAP assertions. Earlier failures were owned: first migration ordering, then unsafe JSONPath recursion, then an incorrect expected SQLSTATE; all were repaired and rerun. The later #1047 migration-version collision was repaired by moving the still-unreleased Secure Browser migration to `20270106000000` and rerunning clean.
- 2026-09-07, GitHub PR #1046 at `a9982463283260cbdceed7c7b7257f9265d7f7b5`: aggregate `verify` — PASS, including 274 test files / 3,889 tests and every post-test security smoke. The previously reported unrelated full-suite path did not fail on this required CI rerun.
- 2026-09-07, independent repair review of `fc8174ba..2d121360` — PASS: generic secret/token rejection, exact actor provenance, tenant-coupled quarantine, budget settlement/expiry, truthful Connected Account expiry, and the provider boundary were confirmed with no remaining blocker.
- 2026-09-07, Vercel preview: deployment `7qG8r3SyVmzuagTknQ82HbLekCf7` — READY; this is preview evidence only and the Secure Browser chat card remains unmounted.
- Automated evidence is distinct from rendered evidence. No authenticated, provider-backed, credentialed, deployed, or customer-account evidence was collected.

## Review and limitations

The initial CI UI-evidence failure correctly detected that the owner-visible code lacked this record. Later database-contract failures exposed and drove repairs to migration ordering, recursive sensitive-value validation, and the negative tenant-link assertion. The exact implementation head is now green and independently reviewed; this evidence-only follow-up preserves missing rendered/authenticated proof as `UNVERIFIED`. Shared-chat mounting and its rendered matrix must wait for PR #1044 to merge or relinquish ownership. Provider work remains gated by the seven independently documented vendor gates.


> **CORRECTION, 2026-09-24.** That repair did not hold, and the sentence above is kept as the record of what was
> done rather than rewritten. Moving to `20270106000000` escaped the #1047 collision and walked into a new one:
> `20270106000000_durable_job_weekly_summary_claims.sql` landed on `main` on 2026-09-10, three days after this
> renumber, so by the time PR #1046 merged the version was taken. `schema_migrations` is keyed on the version
> alone, so **this migration was silently skipped** — MEASURED on production: one row at `20270106000000`, and it
> belongs to the durable-job migration, whose index exists, while `secure_browser_sessions`,
> `secure_browser_tenant_limits` and `_secure_browser_safe_text` do not. The control plane merged and its schema
> never arrived.
>
> Moved forward-only to `20270419000000`. Renumbering it is safe precisely because it never applied; the rule
> against renumbering a migration is about applied ones. This is the class filed as #1425 — a branch whose
> version was free against `main` when it was chosen and taken by the time it merged, which no lint catches,
> because each branch only ever compares itself to trunk.
