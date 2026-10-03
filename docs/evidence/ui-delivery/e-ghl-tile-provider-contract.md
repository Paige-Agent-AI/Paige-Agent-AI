# Integrations: the HighLevel tile carries its provider contract (gohighlevel identity, Token + headers preselect, locationId required)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the Settings → Integrations add-a-tool flow traced against src/solo/settings-integrations-gateway.tsx at this PR's head; the diff adds preset-carried provider identity and a required-header form check to the existing ConnectionForm — the goal, states, transitions and exits of the add flow are unchanged; a provider-contract preset starts one step further along the same path (auth preselected) rather than on a new one.
PAIGE_UI_DESIGN: PASS: the shared Settings drawer, its field layout, tokens and controls are untouched; the change reuses the existing authentication segmented control, the existing Add header row, and the existing validation message placement — no new visual surface.
MATERIAL_FLOW_CHANGE: NO: same screen, same controls, same save transition; a preset with a provider contract preselects an auth mode that was already one click away and refuses a save that the SERVER would refuse anyway (the migration's trigger enforces the same requirement), moving the refusal earlier with clearer words.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change; the provider-contract behavior is a preselect plus a client-side mirror of a server-side rule.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged — a tenant owner adds an outside tool from the catalogue and saves a verified configuration.
VISUAL_DIRECTION: PASS: existing Settings visual direction; no typography, spacing or color change.
AUTOMATED_EVIDENCE: PASS: 116/116 src/solo/settings-integrations-gateway.test.tsx at this PR's head, including the NEW failing-first HighLevel contract test (the tile preselects Token + headers; a save without locationId is refused in the product's words; the create body carries provider_key gohighlevel, auth_kind bearer, custom_headers.locationId) and the updated plain-preset test (no inference without a contract); plus 12/12 src/__tests__/mcp-ghl-connection-lane.test.ts.
STATIC_EVIDENCE: PASS: eslint clean on the changed files (3 pre-existing warnings unchanged from main); impeccable detect exit 0 on the changed tsx.
RENDERED_EVIDENCE: UNVERIFIED: no browser drive for this diff; the behavioral suite exercises the real component tree (dialog, fields, validation copy, edge body) via jsdom.
BEHAVIORAL_EVIDENCE: PASS: the new test drives the actual HighLevel tile through the catalogue → form → refused save (missing locationId) → header added → save, and asserts the exact gateway create body (provider_key/auth_kind/custom_headers).
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated deployed drive; the owner's first real PIT connect is the recorded acceptance for this lane.
KEYBOARD_FOCUS: PASS: no new focusable elements; the preselected segmented button keeps native semantics (aria-pressed), and the existing validation focus effect (first [aria-invalid] control) now also carries the required-header refusal.
ZOOM_REFLOW: UNVERIFIED: not re-driven; the diff adds no layout, only a conditional message using existing message styling.
REDUCED_MOTION: PASS: no animations introduced, removed or altered.
STATE_COVERAGE: PASS: plain presets (no provider contract) covered by the updated no-inference test; the provider-contract state covered by the new HighLevel test including the refusal branch; re-key (tool) paths untouched by the preset change.
TRUTHFUL_STATE_LABELS: PASS: the refusal names the actual missing header ("requires the locationId header on the connection") — a factual server-mirrored rule, not a capability claim.
SOLO_UI: YES: Settings Integrations surface.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this diff.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this diff.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this diff.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this diff.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this diff.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this diff.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no host-shell drive for this diff.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no host-shell drive for this diff.
UNVERIFIED: rendered-viewport and authenticated-runtime proof owed with the owner's first real GHL connect (the recorded acceptance for this lane); every behavioral and static claim above is proven by the recorded suites.
OWNER_INTENT: owner direction 2026-10-03 — "perfect the GHL MCP connection… double-check their requirements and compare to what we have built"; external review identified that the HighLevel tile saved connections as generic-remote (the gohighlevel descriptor never used) and that the locationId requirement needed form-level truth; both corrected here.
MUST_NOT_HAPPEN: no provider-name AUTHENTICATION routing (the provider key is identity, not an auth pathway), no inference of OAuth for plain presets, no change to the four auth choices, no credential reflection.
MUST_PRESERVE: the four-choice auth segmentation, the explicit-choice rule for custom servers, the encrypted header bundle path, the server-side bundle and header validation as the authority (the form check only mirrors it earlier).
ACCEPTANCE_CRITERIA: clicking the HighLevel tile opens the form preselected to Token + headers at the universal GHL address; a save without the locationId header is refused naming the header; a complete save writes provider_key gohighlevel with the bearer PIT and the locationId custom header.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: the gateway client (useMcpGateway) and edge writers are untouched; the create body shape is unchanged apart from the provider_key value the preset carries.
INTERNAL_BUILD_IDENTITY: efcdba609338af238caba66d84726dbd2cd1d10c; deployment=none; environment=local development candidate on ghl-corrections; migrations=PROOF_OWED(20270536000000 provider-row UPDATE + additive trigger — applied with the merge deploy); edge=NOT_APPLICABLE; evidence=this record and the exact candidate head efcdba609338af238caba66d84726dbd2cd1d10c.
RELEASE_CHANNEL: development: pre-merge candidate.
RELEASE_CLASSIFICATION: patch: provider-identity and required-header corrections to one catalogue tile's preset.
CUSTOMER_RELEASE_IDENTITY: none: authenticated outcome not established.
RELEASE_NOTE_REQUIRED: no: internal correction within the Integrations surface.
RELEASE_TRUTH_BOUNDARY: PARTIAL: the drawer contract is behaviorally proven; the live GHL accept is PROOF OWED with the owner's PIT connect.
RELEASE_RECOVERY: position=forward-fix this UI + migration slice; reference=this record; no data conversion beyond the provider-row UPDATE and the additive trigger.
