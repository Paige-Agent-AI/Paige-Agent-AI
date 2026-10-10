# Operator account-details implementation — partial

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Operator opens Directory account details, edits with review/readback, or reads an authoritative deletion scope; actor/target failure and interruption states are covered locally.
PAIGE_UI_DESIGN: PASS: Existing Operator tokens and Radix Dialog reused; Impeccable context and craft floor applied. Detector returned no findings before the final token correction. Independent finish review remains owed under the sole-agent hold.
MATERIAL_FLOW_CHANGE: YES: New account-details pop-out, edit/review/save/recovery and deletion-preview branches.
FLOW_PROTOTYPE: PASS: Owner approved account-controls-preview.html on 2026-10-09 with “Yes this works for now.” Approval concerns the proposed flow; it does not lift production testing or deployment holds.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform owner manages an account from Fleet Directory without entering or changing the account's tenant relationships.
VISUAL_DIRECTION: PASS: Operate mode; existing Mineral/Obsidian data-pg themes, restrained tokens, contextual pop-out. No new top-level Operator route.
AUTOMATED_EVIDENCE: PASS: Four Vitest files, 42 tests; PostgreSQL adapter script applies/replays actual migration and canonical lifecycle source with positive/negative and weakened-guard checks.
STATIC_EVIDENCE: PASS: Focused ESLint and diff check; tsc ratchet reports baseline 10/current 10; local build passed before final token-only correction. Final build/review/hosted CI still owed.
RENDERED_EVIDENCE: PASS: work/operator-controls-source-{light,dark}-{1536,1366,1024,900,390}.png; actual source components under synthetic RPC adapter in local Chrome, not authenticated production.
BEHAVIORAL_EVIDENCE: PASS: Local Chrome edit/readback, retained input, cancellation, deletion blockers, Escape and ten viewport/theme captures; no document/dialog horizontal overflow.
AUTHENTICATED_RUNTIME: UNVERIFIED: Owner prohibits deployed agent login. Local adapter and PostgreSQL identity fixture do not establish live Auth, RLS or real-account acceptance.
KEYBOARD_FOCUS: UNVERIFIED: Native Radix focus containment and Escape were exercised locally; complete keyboard-only and assistive-technology audit is owed.
ZOOM_REFLOW: UNVERIFIED: Five widths checked, but 200 percent zoom and screen-reader proof not performed.
REDUCED_MOTION: PASS: Local captures and interaction run under reduced motion; pop-out disables entrance animation for that preference.
STATE_COVERAGE: UNVERIFIED: View/edit/review/discard/read errors/unknown save/deletion refusal are implemented locally; hard deletion and recovery are absent and not simulated as delivered.
TRUTHFUL_STATE_LABELS: PASS: Preview explicitly states deletion is blocked and never offers destructive execution. Missing deployed RPC reports account controls not deployed yet.
SOLO_UI: NO: Operator control-plane surface; canonical Solo shell unchanged by this slice.
UNVERIFIED: Production Auth/RLS, complete dependency inventory, storage/provider cessation, restorable archive, actual deletion and recovery, full keyboard/zoom proof, independent review, hosted CI, deployment and owner acceptance.

OWNER_INTENT: Add a Directory pop-out with edit/delete capability, preserve active Solo and Operator accounts and legitimate tenant topology. The implemented subset is details/edit/deletion preview only. This is not fulfillment of the requested deletion capability.
MUST_NOT_HAPPEN: Blind cascades, production agent login, deleting shared identities, changing roles/ownership/account type, weakening Trust/provider restrictions, retaining fabricated deletion success, or activating INT-346.
MUST_PRESERVE: Audited Enter and occupied/unknown/arrival recovery, shared Solo routing, tenant relationships, server-derived owner authority and existing lifecycle transition/audit.
ACCEPTANCE_CRITERIA: Real owner can open details, edit supported fields with confirmed readback, see exact child scope and blockers, and eventually perform recoverable canonical deletion. Last condition remains unmet.
MOTION_PURPOSE: Existing short dialog entrance preserves focus context; reduced-motion override removes animation.
PROTECTED_SEAMS: Affected: platform authority, lifecycle writes/readback, audit, account isolation, responsive popup/accessibility; tested in bounded local fixtures. Unaffected: Solo signup/billing/provisioning source, Chat transcript implementation, Live Conversation, Secure Browser/Vault credentials, provider execution, durable scheduling, Memory/Rail, external sends/payments. Preview reads dependency counts only. No protected-domain records mutated.

INTERNAL_BUILD_IDENTITY: source=c0169032b5f18244e080d473113a5e22bed7a1f0; deployment=NOT_APPLICABLE; environment=development; migrations=PROOF_OWED(20270602000202_operator_account_controls production application); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/operator-account-details.md
RELEASE_CHANNEL: development: source candidate only; hosted preview and production deployment remain PROOF_OWED.
RELEASE_CLASSIFICATION: internal-only: guarded account detail edits and a non-destructive preview are candidate changes; whole-workspace retirement remains unavailable.
CUSTOMER_RELEASE_IDENTITY: none: this is an internal operator capability candidate with no owner-approved customer release identity.
RELEASE_NOTE_REQUIRED: NO: Unreleased local work.
RELEASE_TRUTH_BOUNDARY: PARTIAL: Source details/edit and deletion preview; no actual deletion or production usability claim.
RELEASE_RECOVERY: position=pre-deployment candidate; reference=PR #1890 evidence record and normal revert/forward-fix process. Full deletion recovery has not been implemented or verified.

## Capability routing before implementation

1. Outcome: owner edits or safely removes an Agency tree through Platform Operator.
2. Portfolio family: 15, Platform Operator / Agency. Only this lane is active per owner.
3. Harness/Gateway: existing operator lifecycle/RLS seam; no alternate authority engine or runner. Full deletion lifecycle and recovery seam absent.
4. Spine: UNAVAILABLE for account deletion; do not advertise a Chat-callable delete tool. Existing Operator lifecycle used directly.
5. Providers: no execution; connected-provider cleanup is a blocker, not an invented authority. Read counts only.
6. Approval/risk: privileged destructive operation; existing owner-only server gate and reviewed UI confirmation for lifecycle edits. No autonomous deletion lane.
7. Durable work: none for read/edit. Actual retirement needs supported worker/provider cessation and recovery; not invented here.
8. Evidence/readback: own canonical read after edit, transactionally mandatory existing audit. Preview can never claim deletion.
9. Ledger: operator.platform; this local subset does not promote its authenticated status or create a new surface family.
10. Required proof: real authenticated operator positive/negative, exact-head review/CI, production readback and restore/cleanup acceptance remain owed.

## Reproduction

Vitest: `node node_modules/vitest/vitest.mjs run src/operator/data/accountControls.test.ts src/operator/surfaces/AccountDetailsDialog.test.tsx src/operator/surfaces/FleetConsole.test.tsx src/operator/surfaces/FleetConsoleEnter.test.tsx --maxWorkers=1 --reporter=dot`.

SQL: `node scripts/proof/operator-account-controls.mjs <local-module-entry>` with pinned scratch PGlite 0.5.8. Identity derivation is a fixture; actual SQL functions and canonical status transition execute. New migration replayed twice; owner edit preserves child and Solo rows; stale write, ordinary/anonymous actor, internal edit and missing target refuse; counts do not expose connector contents; grant boundaries and weakened-owner-guard negative control pass.

Scratch source harness: `work/operator-account-controls.html`, Vite on localhost only and `work/render-operator-controls.cjs`. No scratch route or mock is imported into production.

## Remaining work — do not report done

The approved design includes deletion. No deletion function exists in this change. Preview always returns execution_available=false, including empty accounts, because verified recovery and canonical whole-workspace removal are still absent. Resolving protected retained-record and provider dependencies and implementing/testing actual retirement are outstanding engineering. A status change or successful login is not a substitute.

Independent review is in progress for PR #1890. Hosted CI is in progress; merge, migration application, deployment, real-account change and customer acceptance are not asserted.
