# UI delivery evidence: EXP10 PR11 — curated auth selector for provider presets (GHL / Slack)

Covers THIS branch's delta on the G1b gateway surface (settings-integrations-gateway.tsx + its
suite): a curated preset (providerKey set, auth resolved by the catalogue row) now LOCKS the
auth selector to the provider's one proven mode and names it in the provider's own words, with
a note stating the real contract. GHL shows one button — "Private Integration Token" — with the
PIT + locationId path named and GHL OAuth honestly stated as not-yet-verified; Slack shows
"Slack user token" with the no-DCR reality. The generic "Any MCP server" entry keeps all four
modes; editing an existing connection keeps every mode reachable. Same writer, same wire — the
locked mode maps to the identical auth_kind the preset always produced.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flow is the existing catalogue → connect-form flow; this delta changes the auth selector's OFFERED choices for curated presets and adds a truthful note, nothing else.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded this session; incumbent Obsidian/Mineral identity preserved (the existing ig-gw-seg segmented control renders the curated set — no new components or tokens).
MATERIAL_FLOW_CHANGE: NO: the same single mode is offered and preselected that the preset always preselected; the change removes dishonest options and labels the proven one in provider language.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material flow change; the surface was prototyped at pack v5 and evidenced at g1b.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner connecting GHL sees "Private Integration Token" and a one-line explanation of exactly where it comes from — not an engineering auth-mode wall he must decode.
VISUAL_DIRECTION: PASS: the incumbent segmented-control idiom renders the curated set; the note is the existing ig-note line.
AUTOMATED_EVIDENCE: UNVERIFIED: the updated/new tests run in CI's fresh install (GHL: exactly one curated button, no None/OAuth/generic labels, the note present; Slack: exactly "Slack user token" pressed; generic entry: all four modes); local vitest is env-broken on this shared tree (CI npm ci authoritative).
STATIC_EVIDENCE: PASS: ts.transpileModule clean on both files; validator PASSes with this record (post-commit).
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; the selector and note reuse structures the g1b captures evidenced; owed and named.
BEHAVIORAL_EVIDENCE: UNVERIFIED: pinned by the automated tests; the interactive drive is the owner's GHL connect (matrix A3).
AUTHENTICATED_RUNTIME: UNVERIFIED: no GHL connection exists yet; the owner's PIT connect remains PROOF OWED (his stated next step).
KEYBOARD_FOCUS: PASS: the selector buttons are the existing roving segmented control — no focusable change.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change; the note wraps in the existing form body.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: the curated contract applies to CREATE only; EDIT (tool set) keeps every mode — a re-key may legitimately change headers; the generic entry is untouched.
TRUTHFUL_STATE_LABELS: PASS: GHL's note states GHL OAuth is not yet verified for Paige (the registry's own truth) rather than offering it; Slack's note states the no-DCR reality; no provider capability is implied beyond the proven mode.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx renders inside the Solo Settings → Integrations leaf.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: structure unchanged from the g1b captures; owed with the authenticated drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same.
UNVERIFIED: CI suite pass on the exact head, a rendered capture, and the owner's authenticated GHL connect — owed and named; none claimed.
OWNER_INTENT: owner 2026-10-24 — "We should very likely have Token Oauth, and API options for GHL. Not a 'None' or 'Token + Headers'" — provider-real options, not the generic wall; PAIGE must utilize GHL for EXP10.
MUST_NOT_HAPPEN: never offer GHL OAuth (not verified — the registry's own truth); never lock the generic entry; never change the wire contract (the locked mode maps to the identical auth_kind).
MUST_PRESERVE: the G1b record's MUST_PRESERVE set; the Metricool plain-preset guard (the generic path keeps four modes); the existing HighLevel create-body assertions (auth_kind + custom_headers unchanged).
ACCEPTANCE_CRITERIA: the owner opens the HighLevel tile and sees one clearly-named option — Private Integration Token — with instructions in his language; he pastes the PIT, adds the locationId, saves, and the tile reports its real state.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: presentation-layer curation; the create/verify writer seams are untouched.

INTERNAL_BUILD_IDENTITY: 2d6dc94ee0c528dc0b298232eb57419f830a164e (exp10-pr11-ghl-auth-ux head on origin/main fd295dde8); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp11-ghl-curated-auth.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: presentation curation inside an existing surface; no customer release identity until the owner's authenticated GHL connect
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a real GHL connect is proven
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the curated selector ships on merge plus deploy; the owner's GHL connect remains PROOF OWED
RELEASE_RECOVERY: position=frontend-revert-restores-the-generic-selector; reference=this record plus the revert commit
