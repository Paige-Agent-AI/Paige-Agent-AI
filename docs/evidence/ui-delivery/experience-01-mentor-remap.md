# UI delivery evidence: MENTOR role remap — discovery/education/strategy attribution on the E01 grounded panel

**2026-10-19 zCod E01 slice.** Owner-directed MENTOR remit remap (Business Discovery, Education, Knowledge and Strategy — serving EXP01/13/15; supersedes the September roster's MENTOR=VP Operations). Forward-only across four surfaces: the live `paige_subagents` registry row (guarded idempotent UPDATE — display metadata only, no authority/routing/privilege), the chat VP-addressing block, the UI attribution roster remit, and a MENTOR byline on the grounded next-steps panel. PAIGE remains the onboarding conversation and front-door; MENTOR attribution is presentation, never a second assistant.

UI_DELIVERY_EVIDENCE_VERSION: 1

## Owner Intent & Experience Contract

OWNER_INTENT: the owner sees, on the grounded panel, that MENTOR — PAIGE's discovery & education specialist — assembled the where-you-are view, and can ask PAIGE to go deeper; the chat addressing "MENTOR, …" now describes the remapped remit truthfully.
MUST_NOT_HAPPEN: no second onboarding assistant or forced extra conversation; no authority, routing, dispatch, or privilege change from a name/description edit; no roster-name additions/removals (names doctrine-locked); no overwrite of the historical mount migration.
MUST_PRESERVE: the grounded panel's deterministic logic (FIRST_VALUE_LOGIC_VERSION 1, unchanged), all incumbent suites, the addressing detection behavior (name matching untouched), every other roster row.
ACCEPTANCE_CRITERIA: the registry row carries the new remit exactly; addressing still detects "MENTOR, …" with identical mechanics; the panel byline renders; the re-parented scheduling child and retained knowledge children verify in CI SQL.

## Capability routing — pre-edit

1. Outcome: truthful named-specialist attribution on an existing surface. 2. Domain owner: platform roster (presentation); E01 consumes. 3. Harness: none new. 4. Spine: NONE read/written — explicit honest statement: this remap grants no capability; MENTOR-attributed surfaces use existing seams only (the ALG-13 module, chat list_subagents which reads the registry live, and the orchestrator tool_search domain-tag filter — noting honestly that a discovery search on "operations" no longer surfaces MENTOR, which is the correct post-remap behavior for a discovery-tagged search). 5. Providers: none. 6. Approval/risk: display-only (read_only class); no confirm channel created. 7. Events/jobs: none. 8. Readback: the migration's CI SQL contract IS the readback for the row; the panel reads the same inputs as before. 9. Surfaces: existing grounded panel; Binding Ledger unchanged. 10. Proof: SQL contract in spine-contract CI; suites below; live psql readback post-deploy owed.

FLOW_BY_FLOW: PASS: one additive byline on an existing section; no flow change.
PAIGE_UI_DESIGN: PASS: incumbent tokens/composition only; Impeccable craft floor applied (byline integrated into the existing head line, no new visual element).
MATERIAL_FLOW_CHANGE: NO: attribution copy only; behavior byte-identical.
FLOW_PROTOTYPE: NOT_REQUIRED: MATERIAL_FLOW_CHANGE NO — attribution copy on an already-prototyped surface.
SOLO_UI: YES: existing SOLO grounded panel; one shared implementation for every eligible current/future SOLO account — the change is tenant-agnostic registry data + one shared component.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: attribution copy; no rendered layout change beyond one text line — covered by the surface's existing frame set (first-value-2026-10-18).
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: live production row readback post-migration-deploy (owed and planned via the standing read-only psql seam), and authenticated owner appearance of the byline (OWNER WINDOW). Original 23 cases unchanged.

AUTOMATED_EVIDENCE: PASS: vp-address 10/10 incl. a new remit pin (role/scope/next-action wording; no n8n; addressing unchanged), attribution suite green, SoloFirstValue 5/5 incl. the byline assertion; migration SQL contract (6 assertions, pg_temp shim convention per the neighboring psql proofs — corrected from an initial pgTAP-helper draft the independent review caught as unrunnable in this job) wired into paige-spine-contract CI.
STATIC_EVIDENCE: PASS: scoped ESLint clean on touched source files; migration guarded/idempotent (WHERE the superseded seeded values).
RENDERED_EVIDENCE: NOT_APPLICABLE: single-line attribution change on a surface with an existing IHDR-verified frame set.
BEHAVIORAL_EVIDENCE: PASS: addressing detection byte-identical mechanics (name list untouched); panel logic untouched (FIRST_VALUE_LOGIC_VERSION 1).
AUTHENTICATED_RUNTIME: UNVERIFIED: owner-window item.
RELEASE_CHANNEL: development: local/development build environment only — suites and CI; no extension release or activation beyond normal merge/deploy.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the governed status is the live registry row post-migration-deploy — verified through the spine-contract SQL (CI) and a live read-only readback after deploy; no capability claim is made or implied by the remap.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive change.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: NOT_APPLICABLE: no state change.
TRUTHFUL_STATE_LABELS: PASS: the byline states derivation honestly ("derived only from what you confirmed… never padded") and does not claim MENTOR executed anything.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an ordinary SOLO owner reads who assembled the grounded view and keeps choosing next actions through PAIGE; no forced specialist conversation.
VISUAL_DIRECTION: PASS: incumbent panel idiom.
MOTION_PURPOSE: NONE: no motion added.

INTERNAL_BUILD_IDENTITY: 656dcd407cf0eef50dbb28049f034179b55bacf2; deployment=NOT_DEPLOYED; environment=development; migrations=PROOF_OWED(20271111000000 applies on merge via deploy-migrations and the live registry row is read back read-only after deploy — the CI SQL contract verifies the shape in the meantime); edge=NOT_APPLICABLE; evidence=this record plus the CI SQL contract and suites listed.
RELEASE_CLASSIFICATION: internal-only: role-metadata correction and attribution copy.
CUSTOMER_RELEASE_IDENTITY: none: internal role-remap slice.
RELEASE_NOTE_REQUIRED: NO: internal slice with no customer release identity.
RELEASE_RECOVERY: position=ordinary reviewed revert of the slice restoring prior seeded values via the inverse guarded update; reference=docs/evidence/ui-delivery/experience-01-mentor-remap.md.
