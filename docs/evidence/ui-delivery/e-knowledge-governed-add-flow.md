# Settings Knowledge: the governed add flow (read → review → publish)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bounded flow trace below — choose/submit (paste or text file) → Paige reads (durable work, honest status) → review the exact extracted text (CAS save) → publish through the activated seam → truthful completion; every uncertain state names its recovery and never resolves by a second different write.
PAIGE_UI_DESIGN: PASS: Impeccable context loaded for src/solo/knowledge/KnowledgeLibrary.tsx (Operate mode, incumbent Solo/Settings tokens preserved — no redesign); craft floor applied to states, copy and keyboard paths; existing dialog idiom (KnowledgeMetadataEditor) extended, not replaced.
MATERIAL_FLOW_CHANGE: YES: adding Knowledge in Settings now runs the governed lifecycle (extraction review before anything becomes Knowledge) instead of direct ingestion; the legacy link path remains explicitly labeled until governed URL extraction ships with format parity.
FLOW_PROTOTYPE: WAIVED: owner-decision=OWNER green light for the Knowledge lane through finish, dated 2026-10-01, re-affirmed for this slice on 2026-10-02; reason=the owner-approved prototype (outputs/knowledge-flow-prototype.html, approved 2026-09-30) covers the review surface and the Settings design language this dialog reuses, and the publish step is the packet-exact governed lifecycle already ruled on in that mandate, so another prototype round would repeat an approved flow.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace member adds a source, reviews exactly what Paige read, and publishes the reviewed text as canonical Knowledge.
VISUAL_DIRECTION: PASS: existing Settings design tokens (pg-ink/line/surface/raised/violet, 8px control radius, container query at 620px); one secondary Link action and the primary Add Knowledge action share the incumbent header composition.
AUTOMATED_EVIDENCE: PASS: 161 vitest across the seven affected Knowledge suites including the new 9-test DOM drive of the full flow and its uncertainty paths, plus 13 review-service tests; the SQL seams remain proven by the six behavior suites on record.
STATIC_EVIDENCE: PASS: eslint clean on every changed file; tsc at the unchanged 12-error pre-existing baseline (verified identical on clean main via stash at the same base).
RENDERED_EVIDENCE: UNVERIFIED: no post-change screenshot drive yet; component-level DOM proof only.
BEHAVIORAL_EVIDENCE: PASS: exact-argument drive of submit→review→publish; same-intent retry after an unconfirmed submission; reading-failure halt with no publish path; CAS conflict reload instead of repeat; in-flight publication refusal; outcome-unknown never re-publishes; failed publication may retry under a new intent; unsupported file rejected before any upload.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated deployed drive of this flow yet; the SQL seams underneath are production-live (frontier 20270533200000) and were verified read-only.
KEYBOARD_FOCUS: PASS: native controls only (Radix dialog focus management, labeled inputs, buttons with visible focus rings from the incumbent stylesheet); no new custom widgets.
ZOOM_REFLOW: UNVERIFIED: not driven for this change; the dialog inherits the library's container-query behavior.
REDUCED_MOTION: PASS: no animations introduced.
STATE_COVERAGE: PASS: submitting, reading (polled), reading failed/paused/unconfirmed/still-reading, review unavailable, review save conflict/refused/unconfirmed, publish refused/in-flight/unconfirmed/failed/paused/still-publishing, published; each halts with its named recovery action or an honest close.
TRUTHFUL_STATE_LABELS: PASS: "Publishing continues even if you close this"; unconfirmed states say recovery will reconcile and never claim success; the finish-later path states plainly that an unpublished draft does not appear in Knowledge yet; no capability wording beyond text-file ingestion (other formats named as future).
SOLO_UI: YES: Settings Knowledge bucket — the canonical Knowledge surface in the Solo shell.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this change.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this change.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this change.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this change.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this change.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this change.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this change.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this change.
UNVERIFIED: rendered screenshot drive, zoom, host-shell viewports, and authenticated runtime for this flow; the finish-line acceptance round owns them.
OWNER_INTENT: the owner's Knowledge finish definition — a real Solo user can add → extract → review → publish → manage → retrieve → delete — with the publish step live in the human surface, not only at the seam.
MUST_NOT_HAPPEN: no second store or ingestion path for governed sources, no success wording without a verified readback, no automatic retry of an uncertain write, no duplicate intent after an unconfirmed submission, no loss of the legacy link capability.
MUST_PRESERVE: the Settings library's canonical browse/edit/remove behavior, the admin surface's legacy dialog, the exact-match test-helper boundaries, and every settle/status contract of the worker.
ACCEPTANCE_CRITERIA: a member pastes text or uploads a supported text file, Paige reads it, the member edits and saves the exact reviewed text, publishes it, and the source appears in the Settings library as canonical Knowledge — or the flow truthfully names what stopped and what happens next.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: active workspace fencing (scope refs) in the flow; CAS revision on review save; single unresolved publication per document; recovery-only reconciliation of unknown outcomes — all tested; billing, enrollment and the chat handler untouched.
INTERNAL_BUILD_IDENTITY: cd9e3279e8fb8896fea77715ac90331ce265415a; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/e-knowledge-governed-add-flow.md
RELEASE_CHANNEL: development: internal slice pending merge.
RELEASE_CLASSIFICATION: internal-only: not deployed or customer-visible.
CUSTOMER_RELEASE_IDENTITY: none: governed add flow tracked in its PR.
RELEASE_NOTE_REQUIRED: NO: no customer release.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: rendered and authenticated runtime evidence for the governed add flow.
RELEASE_RECOVERY: position=forward-revert; reference=the slice's PR (restoring AddDocDialog as the primary action and removing AddKnowledgeFlow restores the prior experience exactly; published Knowledge data is canonical and unaffected).

## Boundary

The dialog drives seams that are all production-live and SQL-proven: kb-extract-submit (file/paste), save_tenant_knowledge_review (CAS), submit_tenant_knowledge_publication (activated 20270533200000), get_paige_durable_work status reads. The web-link path intentionally remains on the legacy direct dialog, labeled as such, until governed URL extraction ships with format parity. A review saved but not yet published states plainly that it must be published to become Knowledge; there is no drafts/resuming surface yet, which is queued with the UI follow-ups.
