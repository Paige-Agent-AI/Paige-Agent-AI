# UI delivery evidence: EXP10 connection catalogue truth (Slack preset + HighLevel · LeadConnector naming + Teams note)

This record covers the EXP10 catalogue-truth slice on the Solo Settings → Integrations gateway panel
(the G1b surface, `src/solo/settings-integrations-gateway.tsx`): three CATALOGUE data/copy changes and
one wiring fix, all inside the already-evidenced surface. No layout, styling, motion, or new component
ships here.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flow is the existing "connect a tool" flow mapped by the G1b record (docs/evidence/ui-delivery/g1b-connections-mcp-gateway.md, owner-approved pack v5); this slice changes WHICH catalogue rows enter that flow and what each row's copy claims — connect (Slack), renamed-with-scope-copy (HighLevel · LeadConnector), and an honest coming-soon note (Teams). No new screen, state machine, or exit.
PAIGE_UI_DESIGN: PASS: Impeccable craft-floor applied to the copy changes only; the surface's approved pack-v5 visual direction is untouched (no tokens, layout, or motion changes) — the owner's 2026-10-19 customer-facing rule is satisfied by the customer now being able to FIND (LeadConnector), UNDERSTAND (token-scope copy; Slack how-to copy), and USE (Slack connect) the capability, not by visual restyling.
MATERIAL_FLOW_CHANGE: NO: the connect flow itself (tile → prefilled form → save → durable readback) is unchanged; a previously guidance-only tile now enters the existing flow, and two tiles' copy tells the truth about scope and readiness.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material flow change; the flow was prototyped and owner-approved at pack v5.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: purpose is that a Solo owner can find, understand, and start a governed Slack or HighLevel connection; audience is the Solo business owner/admin; primary action unchanged — pick the tile and complete the existing connect form.
VISUAL_DIRECTION: PASS: the incumbent panel idiom (tile name, net note line, category grouping, popular rail) reused verbatim; the added copy rides the existing `ig-gw-tile-net` element.
AUTOMATED_EVIDENCE: UNVERIFIED: the suite (src/solo/settings-integrations-gateway.test.tsx) gains two tests — the Slack preset routing (provider_key=slack, bearer preselected, endpoint prefilled) and LeadConnector search findability with the scope copy — plus the unchanged Metricool/HighLevel preset guards; local vitest cannot launch on this Windows shared tree (vitest@4.1.11 vs vite@5.4.21 lane contamination), CI's fresh npm ci run is the authoritative pass and is owed on the PR.
STATIC_EVIDENCE: PASS: integration-registry-lint PASS (36 providers, 124 anchors resolve); ts.transpileModule syntax check clean on both edited TSX files; ui-delivery-evidence validator passes with this record.
RENDERED_EVIDENCE: UNVERIFIED: no local browser render was captured this slice (harness vitest launch blocked by the same shared-tree contamination); the tile rows reuse the exact rendered structures already evidenced at four viewports × light/dark in g1b-connections-mcp-gateway.md, and the added copy introduces no new container.
BEHAVIORAL_EVIDENCE: UNVERIFIED: behavior is pinned by the automated preset/search tests (CI-owed); the interactive drive of a real Slack connect is AUTHENTICATED_RUNTIME and owner-gated below.
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant (including the owner test workspace) has connected Slack through this preset yet; the registry entry records PROOF_OWED for exactly this reason. HighLevel reconnect is likewise owed (the registry's next_slice names the owner's acceptance steps).
KEYBOARD_FOCUS: PASS: unchanged from g1b — tiles are buttons in the existing roving order; the drawer focus trap is untouched.
ZOOM_REFLOW: NOT_APPLICABLE: no fixed-width or layout change; the net-note line wraps in the existing tile body.
REDUCED_MOTION: NOT_APPLICABLE: no motion change (the surface ships no keyframes; the one-pixel hover lift is untouched).
STATE_COVERAGE: PASS: the catalogue states exercised are unchanged (connect/review/setup/zapier modes with their existing drawers); Slack moves setup→connect and is covered by the new preset test; Teams stays zapier-bridged with an added honest note.
TRUTHFUL_STATE_LABELS: PASS: Slack's connect tile states the real prerequisite in its own copy (own Slack app, user token, granted scopes, workspace-admin signoff) and claims nothing more; a vendor appearing in the catalogue is never a claim it is connected (the owed live proof lives in AUTHENTICATED_RUNTIME and the registry entry, not on the tile).
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx renders inside the Solo Settings → Integrations leaf.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: not re-captured this slice; structure unchanged from the g1b sixteen-frame capture (see RENDERED_EVIDENCE).
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same as above.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same as above.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same as above.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same as above.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same as above.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same as above.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same as above.
UNVERIFIED: CI suite pass on the exact head, a rendered capture of the three changed tiles, and any authenticated Slack connect — all owed and named; none claimed.
OWNER_INTENT: owner directive 2026-10-22 (EXP10 Connect My Business): a Solo owner asks "help me connect Slack" and "check our LeadConnector opportunities" and the platform offers the real, governed connection path instead of guidance copy.
MUST_NOT_HAPPEN: never open a provider-prefilled form for a provider with no registry entry (satisfied: slack entry in-commit); never imply a catalogue row is connected; never weaken the Metricool plain-preset or HighLevel headers-preset guards; never leak a token into state beyond the existing encrypted write path.
MUST_PRESERVE: the G1b surface record's MUST_PRESERVE set (legacy n8n/Zapier drawers, Social surface, Automations leaf, truth-boundary tests); the existing HighLevel preset test's provider contract (gohighlevel identity, Token + headers preselected, locationId required).
ACCEPTANCE_CRITERIA: on the real platform a tenant searches "LeadConnector" and finds the HighLevel tile, reads the location-vs-company scope copy, connects Slack via the preset (internal-app user token) and sees the durable readback — none of which this record claims yet.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: the mcp-gateway writer/loader seams are untouched; the catalogue is presentation-layer data over them.

INTERNAL_BUILD_IDENTITY: c88a12d050a41cbca704716bf4bb3f9c62971303 (exp10-pr2-slack-gateway review-fix head; stacks PR1 c36789d28; PR3 catalogue rows follow on top and extend this record); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-connection-catalogue-truth.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: catalogue data and copy truth inside an existing surface; no customer release identity until an authenticated connect is proven
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a real provider connect is proven
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the Slack preset, LeadConnector naming, and Teams note become LIVE only on merge plus deploy, and a real Slack connection is PROOF OWED until a tenant completes one
RELEASE_RECOVERY: position=frontend-plus-one-idempotent-seed-migration, revert restores the prior rows and the guidance tile; reference=this record plus the revert commit
