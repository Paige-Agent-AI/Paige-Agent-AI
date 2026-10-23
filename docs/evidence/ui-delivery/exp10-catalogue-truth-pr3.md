# UI delivery evidence: EXP10 PR3 — catalogue truth (LeadConnector findability, agency/location scope copy, Teams note)

PR2 (merged dd46cc412) landed the Slack preset and carries the surface's base record
(docs/evidence/ui-delivery/exp10-connection-catalogue-truth.md). THIS record covers THIS
branch's remaining catalogue-truth delta on the same G1b surface: the HighLevel tile renamed
"HighLevel · LeadConnector" (findable under both names — the owner's own vocabulary), its
agency-vs-location token-scope net copy (a location token stays inside one sub-account; a
company/agency token reaches every location — connect the narrowest), the Microsoft 365 Teams
coming-soon note naming the Azure AD app registration prerequisite, the LeadConnector search
test, and the gohighlevel-mcp registry next_slice refresh. Copy-only; no layout/motion change.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the existing connect flow mapped by the G1b record; this delta changes two tiles' copy and one tile's name, never the flow.
PAIGE_UI_DESIGN: PASS: Impeccable craft-floor applied to copy; the approved pack-v5 visual direction is untouched.
MATERIAL_FLOW_CHANGE: NO: copy/name changes on existing tiles inside the evidenced flow.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material flow change; flow prototyped at pack v5.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner searching "LeadConnector" finds the HighLevel tile, reads the token-scope truth, and enters the existing connect form.
VISUAL_DIRECTION: PASS: incumbent tile idiom (name + net line) reused verbatim.
AUTOMATED_EVIDENCE: UNVERIFIED: the LeadConnector search test runs in CI's fresh install; local vitest is env-broken on this shared tree (vitest@4.1.11/vite@5.4.21 contamination).
STATIC_EVIDENCE: PASS: integration-registry-lint PASS (36 providers); ts.transpileModule clean on both edited TSX files.
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; tile structure identical to the g1b sixteen-frame capture.
BEHAVIORAL_EVIDENCE: UNVERIFIED: pinned by the search/preset tests in CI; interactive drive is owner acceptance (matrix A1/A3).
AUTHENTICATED_RUNTIME: UNVERIFIED: no GHL connection exists to connect; the acceptance matrix names the reconnect proof.
KEYBOARD_FOCUS: PASS: unchanged from g1b (buttons in the existing roving order).
ZOOM_REFLOW: NOT_APPLICABLE: no layout change; the net line wraps in the existing tile body.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: catalogue modes unchanged; the renamed tile still enters the connect drawer; Teams stays zapier-bridged with an added note.
TRUTHFUL_STATE_LABELS: PASS: the scope copy states what each token type can reach and never claims a connection exists; a vendor in the catalogue is never a claim it is connected.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx renders inside the Solo Settings → Integrations leaf.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: structure unchanged from the g1b captures.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same.
UNVERIFIED: CI suite pass on the exact head and any authenticated GHL reconnect — owed and named; none claimed.
OWNER_INTENT: owner directive 2026-10-22 (EXP10): the owner's vocabulary is LeadConnector; the catalogue must be findable and honest about token scopes.
MUST_NOT_HAPPEN: never break the HighLevel preset contract (gohighlevel identity, Token + headers, locationId required); never imply an agency token is safe by default; never claim Teams is connectable.
MUST_PRESERVE: the G1b record's MUST_PRESERVE set; the Metricool plain-preset and Slack preset guards.
ACCEPTANCE_CRITERIA: on the real platform a tenant searches LeadConnector, finds the tile, reads the scope copy, and connects GHL per the registry's next_slice.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: presentation-layer catalogue data only.

INTERNAL_BUILD_IDENTITY: 4d1fb779c32ccc700a545a792fecab53ae49a64e (exp10-pr3-ghl-catalogue head on merged-main dd46cc412); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-catalogue-truth-pr3.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: catalogue copy truth inside an existing surface; no customer release identity until an authenticated connect is proven
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a real provider connect is proven
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the renamed tile and scope copy ship on merge plus deploy; a real GHL/LeadConnector connect remains PROOF OWED
RELEASE_RECOVERY: position=frontend-revert-restores-prior-rows; reference=this record plus the revert commit
