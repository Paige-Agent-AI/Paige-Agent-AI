# UI delivery evidence: EXP10 PR7 — the connections_healthy Systems Check destination

Covers THIS branch's UI delta, which is exactly one file: src/solo/systems-check-areas.ts —
the review's P3-3 completion of the file's own documented 4-step job for a new tenant check.
The check id joins the SystemsCheckId union and CHECK_DESTINATIONS (title "Connected apps
health"; destination the real Settings › Integrations route the destinations contract test
resolves), and the integrations area's coveredBy now includes it so a finding renders with a
plain-English title and a working next action instead of "unassigned". No layout, motion,
copy, or visual change of any kind — a labelling-layer data addition to a surface whose
grouping/status rendering is untouched.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no flow changes; the destinations map is the exit layer the Systems Check surface already renders through.
PAIGE_UI_DESIGN: PASS: Impeccable context loaded this session; incumbent identity untouched — this delta adds map entries, not pixels.
MATERIAL_FLOW_CHANGE: NO: a new finding's exit lands on an existing route through the existing map mechanism.
FLOW_PROTOTYPE: NOT_REQUIRED: no surface change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner with an unhealthy connection finding gets a real destination (Settings › Integrations) instead of the unassigned group.
VISUAL_DIRECTION: PASS: unchanged — the surface renders the destination from this map with its existing chrome.
AUTOMATED_EVIDENCE: PASS: the destinations contract test (systems-check-destinations.contract.test.ts) resolves every entry against the real route tree, so this addition is machine-proven to land somewhere real; the runner's 12 Deno tests cover the check itself.
STATIC_EVIDENCE: PASS: ts.transpileModule clean; the validator PASSes with this record (post-commit).
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered change — the map feeds the existing renderer, whose captures stand.
BEHAVIORAL_EVIDENCE: PASS: the contract test's route resolution IS the behavior that matters here (a dead exit is invisible without it, the file's own header explains).
AUTHENTICATED_RUNTIME: UNVERIFIED: no scheduled run has produced a connections_healthy finding yet; the destination's first real render is owed to a live run (post-merge observation).
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable change.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: the finding's states are the check runner's (pass/fail/error) rendered by the existing surface.
TRUTHFUL_STATE_LABELS: PASS: the integrations area's coveredBy addition changes status derivation for that area only, from the check's real finding — the NOT CHECKED contract for uncovered areas is untouched.
SOLO_UI: YES: the destination path is the Solo Settings → Integrations leaf.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered change; the surface's captures stand.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: the first live scheduled run's finding render — owed post-merge, named here.
OWNER_INTENT: the check surfaces connection failures as owner actions (ALG-12); the owner's console must never show a finding with a dead or missing exit.
MUST_NOT_HAPPEN: never leave the check unmapped (unassigned renders without a plain-English title); never break the NOT CHECKED contract for the three uncovered areas.
MUST_PRESERVE: the coveredBy arrays of the other eight areas; the three uncovered areas' load-bearing empty arrays.
ACCEPTANCE_CRITERIA: a failing connections_healthy finding renders in the Systems Check surface's integrations area with "Connected apps health" and a working Settings › Integrations exit.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: the labelling layer only — no check runner, registry, or surface rendering change.

INTERNAL_BUILD_IDENTITY: 3e3000e9c254182d0544c2efb6b2a75fed114603 (exp10-pr7-alg12-recheck head on merged-main cbb837593); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-systems-check-connections-destination.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: a labelling-layer map addition; no customer release identity until a live finding renders
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until the first live finding
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the destination ships on merge plus deploy; its first real render stays PROOF OWED until a scheduled run files a finding
RELEASE_RECOVERY: position=frontend-revert-removes-the-map-entries; reference=this record plus the revert commit
