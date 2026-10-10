# UI delivery evidence: INT-342 S1a — Solo Marketing Overview rebuilt, Lead capture retired into it

The owner approved prototype version 2 on 2026-10-10 ("Much better I can green light what you created";
record copy `docs/prototypes/int342-marketing-convergence.html`, plan `docs/product/int342-marketing-convergence.md`
§K/§L). The same day the owner ruled "Keep Content for now": Content stays a tab until Vibe Studio lists every
saved piece. This record covers slice S1a: the rebuilt Overview, the one form panel, the retired Lead capture tab
with every old address landing on Overview, the routing-truth fix and the Ads copy fix. Frames:
`node scripts/live-drive/marketing-views-drive.mjs` and `node scripts/live-drive/marketing-overview-interaction-drive.mjs`;
key frames in `assets/int342-s1a-marketing-overview/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding before editing in docs/product/int342-marketing-convergence.md (four scouts, read-only production queries: 5 forms with 0 routed, 0 submissions, 17 marketing_content rows all with work_id null, no ad provider connected). Flows: open Overview by tab, deep link and every retired address; read the chain and act on the broken link; open a form's panel from its card, from Route it, from Needs you and from an old link naming a form; save a route and see the chain change; filter capture points; open a page's details; open a recent lead's deal or contact; first use; member (view only); failed Marketing read; failed briefs read; workspace switch with the panel open
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode against the owner-approved prototype; independent compliance review (non-author) returned SHIP-WITH-FIXES and every SHOULD-FIX was fixed before this record; gold only on New campaign brief; warn-derived line for the broken link instead of a resting gold border
MATERIAL_FLOW_CHANGE: YES: Lead capture is no longer a tab; Overview now carries capture points, the form panel and recent leads; the old Overview dashboard (period switch, donuts, ranking, next-step banner, brief list) is replaced by the approved chain design
FLOW_PROTOTYPE: PASS: owner-approved prototype v2, https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG (record copy docs/prototypes/int342-marketing-convergence.html), approval recorded in docs/brain/decision-log.md 2026-10-10
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees in one line and one chain whether marketing is producing leads and where the chain breaks, and fixes it in place (Route it opens that form's panel); the one gold act is New campaign brief
VISUAL_DIRECTION: PASS: Solo tokens only (no hex in src/solo/marketing-overview.css), violet for data and focus, warn for the broken link, gold on the act; container queries at 1100/1000/900/720/640/620; both themes
AUTOMATED_EVIDENCE: PASS: growth2.render.test.tsx 51 tests (Overview chain, sources, Needs you order, floors at the 200-submission cap, chart scale and keys, first use, view only, capture filter in the address, every retired address and its kept filter/form, missing form, unknown moved key ignored, failed briefs read, email-only form, save re-reads Marketing, panel keeps focus while Marketing re-renders, drawer focus trap and return); useSoloCampaigns.intake-routed.test.ts 3 tests; catalog-offers, growth2.contract, sales-ops.contract and tierBranches tests updated for the eight-tab strip. Shown to fail with each defect reinstated: intake routing ignored, form kept out of the redirect, Route it shown to members, drawer effect keyed on detail/onClose, onSaved removed, briefs failure taking down Overview. Full vitest suite on the final tree: 10541 tests across 707 files pass. A first full-suite run reported 5 failures in operator/platform-entry files; that run overlapped a merge of main into the branch mid-run, and both files pass on the final tree and on the base
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on the base (none in changed files); eslint 0 errors on changed files; lint:tier-features, lint:solo-parity (snapshot re-emitted for the hidden lead-capture slug's new position), lint:skeleton, lint:pg-tokens, lint:legacy-mark, lint:user-facing-admin-urls and lint:readiness-copy pass; lint:gold reports one violation in src/components/dashboard/BusinessCreditDashboard.tsx:271, identical on the base and untouched here; lint:impeccable's three advisories are all in src/agency/
RENDERED_EVIDENCE: PASS: marketing-views-drive 1578/1578: every Marketing tab x 4 viewports x 3 PAIGE postures x 2 themes, plus first-use/loading/error/read-only states and the retired-address and form-panel flows; Overview frames assert the chain with one broken link, the lead line, four capture points, six recent leads and no page title, and that new small text meets 4.5:1. The first full run caught "Not routed" at 3.99:1 in light (fixed) and the harness not stubbing the form panel read (fixed); a rendered frame then showed Open Sales and All sources in Analytics losing their link style to the Solo button reset (fixed). campaigns-nav-fit-drive 216/216 with the eight-tab strip
BEHAVIORAL_EVIDENCE: PASS: marketing-overview-interaction-drive 21/21 in both themes with a real mouse and keyboard: the chain draws on arrival and not under reduced motion, chart hover shows a day with a crosshair, arrow keys step days with a spoken readout and a focus ring, Ask PAIGE sends a question built from the page's own figures, Route it opens the unrouted form's panel, the Pages filter shows only pages, a page card opens its details, no page errors; flows drive (retired address lands with its filter, unrouted form opens its routing and submissions, Escape closes) 12/12 in both themes
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harness stubs the Marketing, briefs and form-intake reads; the growth_forms columns read (auto_create_deal, pipeline_id, stage_id, notify_email) are covered by the existing table grant and tenant RLS, confirmed on production by query
KEYBOARD_FOCUS: PASS: tabs, filter, cards and every act are native buttons; the chart takes focus and steps by day with ArrowLeft/ArrowRight, announced only from the keyboard; the drawer traps Tab and returns focus to its opener; Dismiss on the moved notice moves focus to the summary line; New campaign brief is reachable by Tab with a visible ring
ZOOM_REFLOW: PASS: the chain goes from four columns to two to one by container width; the lead-flow and Needs you pair stacks; the gallery reflows from three columns to one; no overflow in any driven frame
REDUCED_MOTION: PASS: the chain's link draw and the chart's line draw are the only authored motion and both are off under reduced motion (interaction drive asserts no running animations)
STATE_COVERAGE: PASS: loading (skeleton), Marketing read failed (retry), briefs read failed (Overview stays, brief items say they could not load, retry), first use (three steps), no leads in 30 days (quiet layout, zero drawn as zero), capped read at 200 submissions (every count a floor), member view only, form missing or archived (notice), workspace switch with the panel open (panel closes, background not left inert)
TRUTHFUL_STATE_LABELS: PASS: a form counts as routed only by an enabled automation or its own intake route to a pipeline; a form that only emails its leads says so; nothing claims visits, spend, reach or revenue; submission states read in plain words; the Ads tab no longer claims chat tools for ad platforms
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth (Overview) and every retired address under it

SOLO_1536X770_PAIGE_CLOSED: PASS: every Marketing tab, both themes, overflow 0
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px, overflow 0
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px, overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px, overflow 0
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px, overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px, overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Overview looks and works like the approved prototype v2, with no banner repeating "Marketing"; Lead capture's work lives on Overview; Content stays until Vibe Studio lists every saved piece
MUST_NOT_HAPPEN: a copied Lead capture or creative link that dead-ends; a form called routed that sends leads nowhere, or called silent when it emails them; a failed briefs read hiding the capture points; the form panel losing focus or an unsaved route mid-edit; any visits, spend, reach or revenue figure
MUST_PRESERVE: Campaigns, Audience, Content, Social, Email, Ads and Analytics behaviour; the routing write (growth_form_set_intake, unchanged); Sales links; Vibe Studio as the only creator
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing, reads where the chain breaks, presses Route it, sets a pipeline, saves, and sees the chain close without reloading
MOTION_PURPOSE: the chain's links draw once on arrival so the eye reads it left to right and lands on the break; the lead line draws once; both off under reduced motion
PROTECTED_SEAMS: tested - tab registry and order (growth2.contract, growth2.render, sales-ops.contract, tierBranches), catalog redirects (catalog-offers.contract), social-command routing state (unchanged consumer of routingState), form intake panel (form-intake tests). Unaffected and named - Campaigns desk, Audience, Content, Email, Ads, Analytics, Vibe Studio

INTERNAL_BUILD_IDENTITY: a3e4e3fe7a27d3c60094a7f4b510cf13acc02990; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view over existing records, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: reads only existing data; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Overview, the form panel save and the retired addresses against a real Solo account; no tenant login exists in this session.
