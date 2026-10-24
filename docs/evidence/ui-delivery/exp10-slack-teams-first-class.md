# UI delivery evidence: EXP10 PR9 — Slack & Teams first-class Integrations tiles (the owner's live finding)

Covers THIS branch's delta on the Solo Settings → Integrations surface: a new Team chat group
with a first-class Slack tile (state from the tenant's REAL gateway connection; its drawer is
the gateway's own ConnectionForm carrying the shared SLACK_MCP_PRESET — endpoint prefilled,
Token mode preselected) and an honest Microsoft Teams tile (real Azure AD prerequisite stated,
no connect path). Letter-marks on the brands' grounds (Slack #4A154B, Teams #5059C9) in the
plaid/docusign precedent; provider-mark accents in the established per-provider CSS pattern.
Refinement of the incumbent surface — no layout, motion, or visual-world change beyond the two
new tiles and their group.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flow is the surface's existing open-tile → drawer → connect flow; this delta adds a first-class door to it and a second honest tile, and reuses the G1b connect form unchanged.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded before editing; incumbent Obsidian/Mineral identity preserved (existing tokens, ig-card/ig-panel/ig-field idioms, no new color system — the two brand grounds follow the existing per-provider accent pattern).
MATERIAL_FLOW_CHANGE: NO: a previously buried connect flow gains a first-class entry point; the flow itself is unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material flow change; the surface was prototyped at pack v5 and evidenced at g1b.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner looking for Slack on the Integrations screen finds it in seconds, sees its real state, and opens the actual connect form; Teams states its prerequisite truthfully.
VISUAL_DIRECTION: PASS: incumbent tile/grid/drawer idioms reused; the drawer chrome mirrors the sibling drawers (focus on open, Tab trapped, focus restored, dirty-guarded close).
AUTOMATED_EVIDENCE: UNVERIFIED: the four new tests run in CI's fresh install (group render + real state words; live-row Connected read; drawer prefill + create carrying provider_key=slack/bearer/mcp.slack.com/mcp; Teams prerequisite with no create); local vitest is env-broken on this shared tree (vitest@4.1.11/vite@5.4.21 contamination, CI npm ci authoritative).
STATIC_EVIDENCE: PASS: ts.transpileModule clean on all five touched files; the validator PASSes with this record (post-commit).
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; the tiles and drawer reuse the exact structures the g1b sixteen-frame capture evidenced at four viewports; owed and named.
BEHAVIORAL_EVIDENCE: UNVERIFIED: pinned by the new automated tests; the interactive drive is the owner's own connect (the acceptance matrix A2 step — he has accounts ready).
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant has connected Slack through this door yet; PROOF OWED until the owner connects on the designated account.
KEYBOARD_FOCUS: PASS: the drawer mirrors N8nDrawer's keyboard contract (focus to close on open, Tab trapped, Escape guarded by the dirty discard choice, focus restored to the opener); the tiles are buttons in the existing grid roving order.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change; the group is the existing auto-fill grid row.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: Slack tile carries five real states (absent/turned off/connected/needs attention/setup not finished) from the gateway row; Teams carries its honest not-available state; the drawer carries the form's full existing state set (validation, busy, ack/readback).
TRUTHFUL_STATE_LABELS: PASS: the tile reads the tenant's REAL connection via connectionForProvider — never a label guess; a vendor in the catalogue is never a claim it is connected; Teams never implies a native path exists.
SOLO_UI: YES: src/solo/settings-integrations.tsx renders inside the Solo Settings → Integrations leaf.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: structure unchanged from the g1b captures; owed with the authenticated drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same.
UNVERIFIED: CI suite pass on the exact head, a rendered capture, and the owner's authenticated Slack connect — owed and named; none claimed.
OWNER_INTENT: owner 2026-10-24 live finding — "Slack is not available but yes I would like it and or Microsoft Teams if possible"; Integrations (not Connections) is where this work belongs.
MUST_NOT_HAPPEN: never fork the connect form or its writer (the gateway's ConnectionForm is the one home); never render a Slack state the gateway row does not back; never imply Teams is connectable; never regress the covered-tile suppression or the existing drawer guards.
MUST_PRESERVE: the G1b and PR3 evidence records' MUST_PRESERVE sets; the one-tool-one-tile suppression; the n8n/Zapier drawers; the legacy provider panels' note pattern.
ACCEPTANCE_CRITERIA: on the real platform the owner opens Settings → Integrations, sees Team chat with Slack and Microsoft Teams, connects Slack in under a minute (endpoint prefilled, token pasted), and the tile turns Connected from the real gateway row.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: presentation-layer doors; the create/verify writer seams are untouched.

INTERNAL_BUILD_IDENTITY: b0a325d93d7da923ebf475387bc4504e6a742d09 (exp10-pr9-slack-first-class head on origin/main ae1317252); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-slack-teams-first-class.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: first-class catalogue doors inside an existing surface; no customer release identity until the owner's authenticated connect
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a real Slack connect is proven
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the tiles ship on merge plus deploy; the owner's Slack connect remains PROOF OWED
RELEASE_RECOVERY: position=frontend-revert-restores-the-prior-catalogue; reference=this record plus the revert commit
