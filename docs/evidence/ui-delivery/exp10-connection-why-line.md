# UI delivery evidence: EXP10 PR15 — the honest WHY line under the connection status

Covers THIS branch's visible delta on the Integrations gateway surface: the connection drawer's
facts list gains one warning line (`whyLine`) under Status/Last checked — the probe's closed
error code rendered as its owner sentence, or the one derived staleness fact (connected but
unchecked for over a week). The chip, facts, and every other structure are unchanged; a healthy,
recently checked row renders nothing extra. `get_mcp_connections_v2` now carries `last_error_code`
(closed vocabulary, schema-enforced shape; the client re-validates the same shape and drops
anything else), and PR14's `http_rate_limited` truth reaches the settings screen.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flow is the existing open-connection-drawer flow; this delta adds one truth line under the status facts and changes nothing else in the flow.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded before the edit (standing EXP10 discipline); the line uses the incumbent ig-gw-warn idiom, renders only when earned, and names the problem and the recovery per the floor's copy rule — no new components, tokens, or layout bytes.
MATERIAL_FLOW_CHANGE: NO: the same drawer opens with the same controls; one additional truthful sentence renders in states that already showed a warning-tone chip.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material; the surface was prototyped and evidenced across the g1b/#2726/#2854 records.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner whose tool broke sees the remedy that fits the failure — "wait a moment and check again — reconnecting will not help" for rate-limiting, "reconnect with a fresh token" for a refused credential — instead of a bare "Couldn't reach it".
VISUAL_DIRECTION: PASS: the incumbent warning-line style; nothing new is drawn.
AUTOMATED_EVIDENCE: PASS: 4 new UI cases in the panel suite (rate-limited wording incl. both halves; prose dropped at the browser edge; week-stale flagged; fresh clean) + the replayed-DB SQL pin (code verbatim in the owner's list, closed shape everywhere listed, prose refused at the write, foreign tenant clean); both run in CI (local vitest is the known-broken shared install; transpile checks clean locally).
STATIC_EVIDENCE: PASS: ts.transpileModule clean on all three edited TS/TSX files (0 diagnostics).
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice (local runner env-broken); the line renders inside structures prior captures evidenced — owed with the authenticated drive.
BEHAVIORAL_EVIDENCE: PASS: the four UI cases drive the real drawer open against real hook state and assert the rendered sentences, including the negative (no warning line for a fresh healthy row) and the prose-drop.
AUTHENTICATED_RUNTIME: UNVERIFIED: no live errored connection exists to drive; the line's runtime truth rides the closed-code chain proven by the SQL pin.
KEYBOARD_FOCUS: PASS: no focusable change — a text line inside the existing drawer.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change; the line wraps in the existing facts flow.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: every closed code the whyLine maps has a sentence; a code outside the map falls to one honest generic line; non-closed values render nothing (dropped at both edges); the derived staleness state covers the connected-but-unverified case the scheduled connections_healthy Systems Check flags.
TRUTHFUL_STATE_LABELS: PASS: the rate-limit line states the actual condition and rules out the wrong remedy; the rejected-connection line names both possible causes honestly (address first, credential second) because the code covers both; staleness names the week threshold the scheduled connections_healthy Systems Check uses (registry row 11, on the existing scheduled engine).
SOLO_UI: YES: settings-integrations-gateway.tsx renders the Solo Settings → Integrations surface.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: one text line inside the evidenced drawer structure; owed with the authenticated drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same.
UNVERIFIED: CI suite pass on the exact head, the replayed-DB SQL pin, and (owed, named) a rendered capture plus an authenticated drive against a real errored/stale connection — none of that live proof is claimed here.
OWNER_INTENT: owner directives 2026-10-25/26/27 — truthful denied/unavailable/partially-configured outcomes with the honest remedy per state; "a connected account never implies working"; A6's answer must be visible where the owner looks.
MUST_NOT_HAPPEN: provider prose or any non-closed value may never reach the browser via this field (dropped at both edges, pinned both directions); a rate-limited tool must never read as unreachable or credential-rejected; healthy rows must not grow warning chrome.
MUST_PRESERVE: the chip vocabulary and tones; every existing facts row; the drawer's existing interactions and copy.
ACCEPTANCE_CRITERIA: an owner opening a failed connection reads one sentence naming the condition and the remedy that works; a healthy connection looks exactly as before.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: presentation-only consumer; the RPC change is one additive field on the existing redacted list.

INTERNAL_BUILD_IDENTITY: 42d08798b63d0eef23883f6a590ffb0e52296323 (exp10-pr15-connection-health-truth changeset on origin/main 2aa4d23e8); deployment=vercel-preview-per-push; environment=preview; migrations=PROOF_OWED(20271117000000 applies via deploy-migrations on merge); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-connection-why-line.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: one truthful line in an existing surface; no customer release identity until the authenticated drive exercises it
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a live errored/stale connection is driven
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the line ships on merge; rendered capture and authenticated errored/stale drives remain owed with the broader acceptance matrix
RELEASE_RECOVERY: position=revert-restores-the-chip-only-drawer; reference=this record plus the revert commit
