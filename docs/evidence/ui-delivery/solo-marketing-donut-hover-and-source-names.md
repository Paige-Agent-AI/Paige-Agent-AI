# UI delivery evidence: Marketing donut hover box removed, Audience source names shown in full

The owner reviewed the live Audience tab (2026-10-04, four screenshots of /solo/{account}/growth/audience at
7, 30 and 90 days and with PAIGE open). Every figure matched production for that workspace (6 contacts; 1, 3 and 6
new; 5 new leads and 1 hot lead; sources 2/2/2; 0 tagged; 0 contacted; 6 with an address). Two defects were
visible: hovering the composition donut drew a box over its centre, which already names the hovered slice, and
with PAIGE open the source names were cut short ("From a conversati…", "PAIGE or a connec…").

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding before editing - the owner's live frames read against a production query of the same workspace's contacts (all figures matched); the donut is shared by Audience and Overview (growth2.tsx Leads by source and Campaign status), and both pass onActiveKey so both centres already name the hovered slice. Flows: hover a donut slice and read its count; read every source name with PAIGE open
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; one place states the hovered value (the centre), nothing covers it; labels wrap rather than truncate; impeccable detect exit 0
MATERIAL_FLOW_CHANGE: YES: the donut no longer draws a hover box on Audience and Overview; the centre and legend highlight carry the hovered value as before
FLOW_PROTOTYPE: PASS: the owner's live screenshots defined the defect; rendered frames of the fix are shown with this PR
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged; the hover reading is clearer and no source name is hidden
VISUAL_DIRECTION: PASS: existing tokens; no new colour; light and dark
AUTOMATED_EVIDENCE: PASS: full vitest suite 7716 tests across 530 files pass
STATIC_EVIDENCE: PASS: tsc 10 errors, the same as the base commit; eslint 0 errors on the changed file; impeccable detect exit 0
RENDERED_EVIDENCE: PASS: marketing-views-drive 1780/1780; hover drive on the Audience and Overview donuts finds no hover box and the centre names the hovered slice (5 Leads); at a 960px content column (the owner's PAIGE-open width) no source name is clipped
BEHAVIORAL_EVIDENCE: PASS: pointer moved onto the donut ring in the harness: centre changes to the slice, legend row highlights, no box drawn
AUTHENTICATED_RUNTIME: PASS: the owner's own live screenshots (2026-10-04) are the authenticated evidence for the defect and for the figures, which a production query of the same workspace matched; the fix itself is UNVERIFIED live until the owner looks again
KEYBOARD_FOCUS: PASS: the period control is native buttons with aria-pressed; Open Clients, Ask PAIGE and Draft a message are native buttons with the existing focus ring; charts carry a text label naming every value
ZOOM_REFLOW: PASS: figures 6 to 3 to 2 to 1 columns by container width; chart rows 3 to 2 to 1; share rows keep name, bar, percent and count aligned
REDUCED_MOTION: PASS: no motion added or changed
STATE_COVERAGE: PASS: unchanged from the Audience record; the hover state is the only state changed
TRUTHFUL_STATE_LABELS: PASS: no figure changed
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/audience and /overview

SOLO_1536X770_PAIGE_CLOSED: PASS: all eight driven tabs, both themes, overflow 0
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px, overflow 0
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px, overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px, overflow 0
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px, overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px, overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: the owner can read every figure and label on Audience without anything covering or cutting it (owner, 2026-10-04, live review)
MUST_NOT_HAPPEN: a hover box over the donut's centre figure; a source name cut short; any figure changed
MUST_PRESERVE: the donut centre and legend highlight on hover; click-through to Clients; every other chart's hover box (stage bars, growth, Overview's time chart)
ACCEPTANCE_CRITERIA: on the live app, hovering the Audience or Overview donut changes the centre with no box over it, and with PAIGE open every source name reads in full
MOTION_PURPOSE: NONE: no motion added
PROTECTED_SEAMS: tested - Overview donuts (Leads by source, Campaign status) render and highlight; stage bars and growth hover boxes untouched. Unaffected and named - Content, Email, Ads, Lead capture, Analytics

INTERNAL_BUILD_IDENTITY: f5432026c4cc44ac9974590bb79e666bcfdf9ab8; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge when CI is green")
RELEASE_CLASSIFICATION: internal-only: two display fixes on a Solo view
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: fixes verified in the harness; the owner's next live look confirms them
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: the fix on the live app, signed in (no tenant login in this session).
