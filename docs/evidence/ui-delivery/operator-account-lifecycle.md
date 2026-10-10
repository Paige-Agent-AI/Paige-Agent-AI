# Operator account lifecycle — controlled proof, production proof owed

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing Fleet popout now has cancel, archive review/confirmation, archive readback, restore, permanent-delete disposition/confirmation, receipt/absence and failed/unknown recovery branches. Transition contract: docs/delivery/operator-account-lifecycle.md.
PAIGE_UI_DESIGN: PASS: Existing Operator tokens and Radix Dialog reused. Impeccable context, craft floor and polish applied; pinned 4.1.0 detector exits 0 with no findings. Independent finish review is required before release. React checklist applied to role/actor binding, stale effects and concurrent writes.
MATERIAL_FLOW_CHANGE: YES: Reversible Archive/Restore and irreversible permanent-deletion execution added to existing details/edit flow.
FLOW_PROTOTYPE: PASS: Existing approved popout direction; owner explicitly requested Archive/Delete and authorized the additional UI with Impeccable without further design approval. Isolated source harness exercises the same committed components and records synthetic Auth/RPC limits.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform Owner or owner-invited Platform Admin retires the exact selected obsolete workspace scope without entering a business workspace. Ordinary Platform members and tenant owners do not receive deletion authority.
VISUAL_DIRECTION: PASS: Operate mode; existing Mineral/Obsidian palette, contextual account popout, scoped disposition table and explicit irreversible control. Current/Archived filtering stays in Fleet Directory.
AUTOMATED_EVIDENCE: PASS: 55 focused Vitest tests. Actual migration/canonical lifecycle replay twice in isolated PostgreSQL/PGlite; populated Agency/child and standalone cleanup, surviving Solo/shared identity preservation, role/ACL refusal, second-Owner refusal, stale/forged confirmations, idempotency and audit rollback. Old-source negative control fails at missing contract 42883.
STATIC_EVIDENCE: PASS: Focused ESLint, migration and gold-discipline checks; direct compiler signatures match the unchanged 10-error baseline; local Vite build passed. The definer/signature ACL guard's exported run() is invoked explicitly on Windows because its command-entry comparison otherwise skips execution; the corrective batch passes the actual guard. Migration lint's INSERT SELECT warning reviewed: root/actor/name/scope come from checked rows, prior-members coalesces to an array, prior-tenants contains the required root.
RENDERED_EVIDENCE: PASS: Actual source in Chrome with network restricted to localhost. Two bounded rounds; first detected ineffective reduced-motion specificity and final round passed. Ten captures at 1536x770, 1366x768, 1024x768, 900x1000 and 390x844, light/dark. Representative committed captures and measured geometry: docs/evidence/ui-delivery/operator-account-lifecycle/.
BEHAVIORAL_EVIDENCE: PASS: Local Chrome Archive, Restore, re-Archive, permanent Delete and directory absence, exact typed scope/irreversible consent, provider blocker/cancel, unknown-response readback without re-execution, and Escape/focus containment. Two real PostgreSQL sessions serialize Archive against work insertion; mixed-tenant worker claim does not stall the surviving tenant.
AUTHENTICATED_RUNTIME: UNVERIFIED: Owner prohibits deployed agent login. Role/actor derivation is a controlled SQL fixture and browser RPC adapter. No live operator usability, real provider cessation, or customer/account mutation is claimed.
KEYBOARD_FOCUS: PASS: Local Tab stays in the Dialog, Escape exits and controls have labels. Complete keyboard-only return-focus and assistive-technology audit remain UNVERIFIED.
ZOOM_REFLOW: UNVERIFIED: Five widths prove measured document/dialog horizontal fit and control reachability; browser 200 percent zoom and screen-reader acceptance are not performed.
REDUCED_MOTION: PASS: Computed dialog animation is none in all ten reduced-motion captures after specificity repair; overlay has the same explicit override.
STATE_COVERAGE: PASS: Local view/edit/review/dirty cancellation, blocked/ready preflight, typed validation, processing, completed/readback, stale refusal, unknown/read-only recovery and unavailable-contract states exercised by the source tests and Chrome harness.
TRUTHFUL_STATE_LABELS: PASS: READY requires authoritative preflight; confirmation never bypasses blockers/stale scope. PROCESSING, FAILED, OUTCOME UNKNOWN and COMPLETED are distinct. Receipt and canonical absence are both required for deletion completion.
SOLO_UI: NO: Platform Operator control plane; no account-specific Solo code or alternate identity/tenant engine.
UNVERIFIED: Production role exclusivity (one additional Admin assignment needs protected reconciliation), hosted exact-head CI, independent review, migration application, deployment, authenticated runtime/zoom/assistive technology, actual external resource cleanup, old-worker cessation and owner acceptance. No real deletion executed.

OWNER_INTENT: Real reversible archive and real eligible data deletion from Fleet, preserving legitimate standalone businesses, shared identities and Platform Operator authority. Canceled is never blanket permission to delete.
MUST_NOT_HAPPEN: Direct/cascading Auth-user deletion, foreign-key disabling, customer/provider actions, archived operational entry, ambiguous success, account-specific exceptions or INT-346 activation.
MUST_PRESERVE: Canonical tenant relationships, base global roles, surviving memberships/business records, documented retention, existing edit/readback, audited Enter and the separate Operator security boundary.
ACCEPTANCE_CRITERIA: Controlled Solo and Agency cleanup works physically and atomically; protections refuse stale/forged/cross-account scope; exact-head review/CI and authorized production delivery remain separate required evidence.
MOTION_PURPOSE: Existing short dialog entrance maintains focus context; reduced-motion users receive no entrance animation. No new ornamental motion.
PROTECTED_SEAMS: Existing protected global roles, tenant lifecycle, active scope pointer, scheduled claims, Communications server floor, audit, FK relationships and storage inventory. Provider/file/legal/financial dependencies require canonical disposition and remain blocked when unavailable. No paid-provider or financial execution authority is added.

INTERNAL_BUILD_IDENTITY: product=edcc4c9fe2cc5f530c2c5291d98464a57839ae69; base=f6e85d3a7852280853d2ac6ba9e3e7a8db45ee0b; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270602000203_operator_account_archive production apply after separately authorized release); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/operator-account-lifecycle.md.
RELEASE_CHANNEL: development: controlled source candidate only; preview/production do not inherit authenticated proof.
RELEASE_CLASSIFICATION: internal-only: privileged Operator lifecycle extension, no customer announcement or product version.
CUSTOMER_RELEASE_IDENTITY: none: owner acceptance and authenticated production proof remain outstanding.
RELEASE_NOTE_REQUIRED: NO: Internal operator capability candidate; no customer release identity/publication requested.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Controlled implementation/tests PASS, live availability and authenticated lifecycle use not yet proved. Actual production deletion is prohibited until exact scope authorization.
RELEASE_RECOVERY: position=pre-deployment; reference=docs/delivery/operator-account-lifecycle.md. Source revert/forward migration restores contracts; completed deletions are irreversible, failed transactions roll back, unknown outcomes read the same protected receipt. Backups follow existing retention and are not claimed immediately destroyed.

## Reproduce

Existing CI's isolated PostgreSQL service: `node scripts/proof/operator-account-archive.mjs --postgres`. Dedicated local loopback fixture: same command with its non-production port and OPERATOR_PROOF_PSQL set to the approved psql path. No remote connection/credentials are accepted. A pinned local PGlite 0.5.8 entry may be passed instead; add --baseline for the failing-first old-contract control.

Vitest: `node node_modules/vitest/vitest.mjs run src/operator/data/accountControls.test.ts src/operator/data/accountLifecycle.test.ts src/operator/surfaces/AccountDetailsDialog.test.tsx src/operator/surfaces/FleetConsole.test.tsx src/operator/surfaces/FleetConsoleEnter.test.tsx --maxWorkers=1`.

Rendered captures derive from scratch work/operator-lifecycle.html, work/operator-lifecycle.tsx and work/render-lifecycle.cjs, under loopback Vite. No scratch route or adapter is included in the product. The captures are illustrative fixture evidence, not authenticated production account evidence.
