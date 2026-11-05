# UI delivery evidence: EXP10 — one chip truth for a held row (wall, catalogue tile, drawer header)

Follow-up to exp10-connect-finish-dont-duplicate (merged d797bf004). Owner finding
2026-11-05 8:11am EST: the HighLevel catalogue tile still read "Turned off" about his
half-done September row — and so did the detail drawer header — while the wall card read
"Setup not finished". The 2026-11-04 fix wired the never-finished override at the wall site
only; the catalogue tile (tile()) and the drawer header still called statusChip raw, where
"!enabled" answers first, so a saved-but-never-finished row was labeled as if somebody had
deliberately switched it off. This changeset extracts one shared pair —
neverFinishedRow()/heldStatusChip() — and feeds ALL three held-row surfaces through it, so
one row says one thing everywhere: "Setup not finished" when it never reached a working
state; its true state ("Couldn't reach it", "Needs attention", "Turned off") when it did.
The held tile's screen-reader label now says "already added" instead of claiming
"connected" for a row that never connected, and ChipTone gains the "neutral" value the wall
chip already emitted (it renders with the incumbent muted base style; no CSS change).
Files: src/solo/settings-integrations-gateway.tsx + its test — copy and routing only.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flows are read-only states of existing surfaces (the Integrations wall card, the catalogue tile inside the add drawer, the detail drawer header); no screen, route, drawer or form step changes — a held row's chip and the tile's screen-reader sentence are the entire visible delta.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded this session (standing EXP10 discipline); zero component, token, layout or CSS bytes change — the incumbent chip element renders with different, truthful strings, and the neutral tone uses the existing base muted style.
MATERIAL_FLOW_CHANGE: NO: no flow's visible steps change; what changes is honesty and consistency of one status label across three surfaces that show the same row.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material; the chip, tile and drawer-header structures are the incumbent ones the prior record (exp10-connect-finish-dont-duplicate) evidenced.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a non-technical owner looking at HighLevel after a half-done connect sees "Setup not finished" everywhere he looks — on the card, in the catalogue, and when he opens it — instead of a wrong "Turned off" that implies an action he never took.
VISUAL_DIRECTION: PASS: incumbent visual language only; same chip classes and tones already in the surface.
AUTOMATED_EVIDENCE: PASS: new regression test drives all three surfaces — wall card, detail drawer header, catalogue tile — for a never-finished GoHighLevel row (asserting "Setup not finished" and no "Turned off" anywhere, plus the "already added, setup not finished" screen-reader label) and keeps the errored row's "Couldn't reach it" in the drawer header; tsc --noEmit clean on the changed files.
STATIC_EVIDENCE: PASS: typecheck filtered clean; the chip choice is a pure function of the row's existing shape.
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; the touched chip renders in the exact incumbent structures prior captures evidenced; owed and named.
BEHAVIORAL_EVIDENCE: PASS: the three-surface agreement and the error-row boundary are driven by automated tests through real clicks (wall card open, Escape, catalogue open, drawer header read).
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive this slice; the owner's own Integrations page on the deployed surface (his dead HighLevel row reading "Setup not finished" on card, tile and drawer) is the owed proof.
KEYBOARD_FOCUS: PASS: unchanged — no focus behavior touched; the tile button and drawer keep their incumbent focus effects.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: never-finished rows (unconfigured, or disabled before ever connecting) read "Setup not finished" on all three surfaces; error, needs-attention and deliberately-turned-off rows keep their true chips everywhere; the screen-reader label matches the visible one.
TRUTHFUL_STATE_LABELS: PASS: "Turned off" now appears only for a row somebody actually turned off — never as the default for a half-done save; the tile's aria-label no longer claims "connected" for a row that never did.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx is the Solo settings Integrations surface.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendering structure changes; the chip renders in the incumbent structure prior records evidenced at these viewports.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.

MUST_PRESERVE: statusChip's own vocabulary and tones for genuinely-finished rows ("Ready", "Needs attention", "Couldn't reach it", "Turned off" for a real disable) are byte-identical; the wall's "View incoming setup" case keeps precedence; every other surface behavior unchanged.
ACCEPTANCE_CRITERIA: the owner's dead HighLevel row reads "Setup not finished" on its wall card, its catalogue tile and its drawer header — and nothing on the Integrations page says "Turned off" about a setup that never finished.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: gateway writers, server guards, catalogue routing and forms are untouched; this delta is chip routing and copy only.

INTERNAL_BUILD_IDENTITY: ad9be0a44 (exp10-tile-chip-truth changeset off origin/main b19e5d00e); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-tile-chip-truth.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: status-label honesty on the authenticated Solo Integrations surface; no customer release identity until the owner's own page drive exercises it
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: ships on merge; the owner's Integrations page showing his dead HighLevel row as "Setup not finished" everywhere (and later finishing it) is the owed live proof
RELEASE_RECOVERY: position=revert-restores-raw-statuschip-at-tile-and-drawer-header; reference=this record plus the revert commit
