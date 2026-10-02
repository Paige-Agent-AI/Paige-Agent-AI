# Settings copy: Setup admin banner removal + Knowledge add-button label

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Setup and Knowledge library flows traced at 0ad0ce48 against src/solo/SoloBusinessContextSetup.tsx and src/solo/knowledge/KnowledgeLibrary.tsx; the diff removes one non-interactive notice block and swaps one button label — no goal, state, transition or exit changes anywhere in either flow.
PAIGE_UI_DESIGN: PASS: approved Settings design, Solo tokens and layout ownership untouched; this change deletes an element and renames a label, adding no visual surface.
MATERIAL_FLOW_CHANGE: NO: copy-only diff (+1/−7 across two files); no user-visible flow semantics change.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change; owner directed the exact copy outcome by screenshot.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged — admins complete operational Setup fields; tenant users open the multi-mode ingestion dialog from the Knowledge library's primary action.
VISUAL_DIRECTION: PASS: existing Settings visual direction; removing the persistent notice restores vertical space for the working form, which was the owner's stated goal.
AUTOMATED_EVIDENCE: PASS: 91/91 vitest at 0ad0ce48 — 57 src/solo/SoloBusinessContextSetup.test.tsx + 26 src/__tests__/solo-setup-readiness-notice.test.tsx + 8 src/__tests__/knowledge-settings-library.test.tsx.
STATIC_EVIDENCE: PASS: eslint clean on both changed files; tsc --noEmit at the unchanged 12-error pre-existing baseline, count-verified identical on clean main via stash at the same base c4612857.
RENDERED_EVIDENCE: UNVERIFIED: owner-supplied before screenshots show the banner and the old label; no post-change screenshot drive has been run for this copy diff.
BEHAVIORAL_EVIDENCE: PASS: admin lockout behavior stays pinned (NAICS selection and Knowledge editing refused for admin_operational and read_only; rich brief editing refused), read-only callers keep their truthful notice, and the add dialog's trigger/wiring is byte-identical.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated deployed drive for this copy change.
KEYBOARD_FOCUS: PASS: the removed notice was a plain div with no tabIndex or interactive descendants; the renamed button remains a native control with unchanged focus behavior.
ZOOM_REFLOW: UNVERIFIED: not re-driven for this change; the diff is subtractive, so available space only increases.
REDUCED_MOTION: PASS: no animations introduced, removed or altered.
STATE_COVERAGE: PASS: admin_operational, read_only and owner scopes covered by the existing suites; the removed block rendered only for admin_operational with canEdit true, a state the suites still exercise.
TRUTHFUL_STATE_LABELS: PASS: no capability-claim text changed; for admins the perceivable scope signal remains the visibly disabled owner-only fields, and read-only callers keep their explicit notice.
SOLO_UI: YES: Settings Setup surface and Settings Knowledge library.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this copy change.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this copy change.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this copy change.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this copy change.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this copy change.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this copy change.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this copy change.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this copy change.
UNVERIFIED: post-change rendered proof and authenticated runtime for this copy diff; all behavioral and static claims above are otherwise proven by the recorded suites.
OWNER_INTENT: owner (screenshot-driven) asked to remove the persistent Setup banner because it consumed prime space above the working form, and to rename the Knowledge primary action to "Add Knowledge" because its dialog offers multiple ingestion modes (file, link, note).
MUST_NOT_HAPPEN: no change to admin or read-only gating, no removal of the read-only notice, no change to the add dialog's modes or wiring, no new visual surface.
MUST_PRESERVE: disabled owner-only fields for admins, the read-only caller notice, every library behavior and the exact-match test helper's case-sensitivity boundary against the separate lowercase "Add knowledge" setup-references button.
ACCEPTANCE_CRITERIA: an admin visiting Setup sees no persistent scope banner and the working form higher on the page; the Knowledge library primary action reads "Add Knowledge" and opens the same multi-mode dialog.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: DOM-subtractive copy change; no seam code touched.
INTERNAL_BUILD_IDENTITY: 0ad0ce487cde4fae743ee1a3a4e46ba9e6133d61; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/e-settings-copy-banner-removal-add-knowledge.md
RELEASE_CHANNEL: development: internal copy change pending merge.
RELEASE_CLASSIFICATION: internal-only: not deployed or customer-visible.
CUSTOMER_RELEASE_IDENTITY: none: copy change tracked in PR #1632.
RELEASE_NOTE_REQUIRED: NO: no customer release.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: post-change rendered screenshots and authenticated runtime observation.
RELEASE_RECOVERY: position=forward-revert; reference=PR #1632 (reapplying the removed block and prior label restores the previous presentation exactly).

## Boundary

This is a copy-only record: one persistent notice removed (its condition, element and text together) and one button label renamed. The independent review of PR #1632 judged the change behavior-preserving and its sole merge condition was this evidence record, per the ui-delivery-evidence gate's new-file requirement. The historical focus-report.json under knowledge-settings-library/ still records the pre-rename label from its original run; it is an artifact of that run and is intentionally left as recorded.
