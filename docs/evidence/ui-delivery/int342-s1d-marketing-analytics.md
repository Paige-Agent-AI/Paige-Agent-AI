# UI delivery evidence: INT-342 S1d — Solo Marketing › Analytics rebuilt to the owner-approved design

The owner approved prototype version 2 on 2026-10-10 (record copy `docs/prototypes/int342-marketing-convergence.html`,
plan `docs/product/int342-marketing-convergence.md` §K/§L). The same day the owner ruled that Analytics and Ads come
before Campaigns ("I'm not sure why we are going back to improve this before we do Ads and Analytics that have no UI/UX
at all"). This record covers slice S1d: the rebuilt Analytics tab. Frames: `node scripts/live-drive/marketing-views-drive.mjs`;
key frames in `assets/int342-s1d-marketing-analytics/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against the prototype's vAnalytics, the old Analytics (growth2.tsx) and production (read-only: 1 brief, no budget written, no ad copy, 0 ad connections; the email read serves 7, 30 or 90 days and is owner/admin only). Flows: open Analytics by tab and deep link; change the range and keep it in the address; read the funnel, coverage, capture points and channels; open a capture point's form panel on Overview; open Sales performance (Sales in the shell, and not); open Email and Ads; first use; no live form; member (email row only for owners and admins); failed briefs read; failed email read with retry; capped submissions read
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode against the owner-approved prototype; independent compliance review (non-author) returned SHIP-WITH-FIXES and every BLOCKING and SHOULD-FIX item was fixed before this record (warn text contrast, balanced two-up cards, one routing rule shared with Overview, Overview's Ask PAIGE control and its honesty guard on the prompt, the attribution caveat restored); independent adversarial verifier (non-author) found no BLOCKING defect and its SHOULD-FIX items were fixed (Ads row no longer claims nothing is connected, every capped count shows +, removed capabilities named under §58); no gold on this page (no act creates anything)
MATERIAL_FLOW_CHANGE: YES: the four-figure ledger, "Leads by source / by campaign" panels and the "Not measured here" list are replaced by the funnel, source coverage, capture points and channels
FLOW_PROTOTYPE: PASS: owner-approved prototype v2, https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG (record copy docs/prototypes/int342-marketing-convergence.html), approval and the reorder recorded in docs/brain/decision-log.md 2026-10-10
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees in one sentence and one funnel how many leads arrived, how many can be traced to a source and a campaign, and how many became opportunities, then which forms collected them and how each channel did; the primary act is reading the funnel and opening a form's panel to fix its routing
VISUAL_DIRECTION: PASS: Solo tokens only (no hex in src/solo/marketing-analytics.css), violet for data, warn-derived text for a form that doesn't route, no gold; reuses Overview's card, head, summary and link styles so the two tabs read as one system; container queries at 900/720/640; both themes
AUTOMATED_EVIDENCE: PASS: growth2.render.test.tsx 59 tests, 8 new for Analytics (the funnel from real records inside the range, the range in the address moving every figure and the email row, a capture point opening its form panel and Sales performance in both shell modes, the email row's ready/denied/error/retry, a failed briefs read, no leads and no live form, a full read making every count a floor and retired forms still counting, route labels matching Overview); growth2.contract and sales-ops.contract updated (the plain-words guard re-pointed to the new file; the email read stubbed). Shown to fail with each defect reinstated: counts not floored, range ignored, failed briefs read shown as a matched count. Every Solo test: 3193 across 215 files pass on the final tree
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on the base (none in changed files); eslint 0 errors on changed files; lint:tier-features, lint:solo-parity, lint:skeleton, lint:pg-tokens, lint:legacy-mark, lint:user-facing-admin-urls and lint:readiness-copy pass; lint:gold reports one violation in src/components/dashboard/BusinessCreditDashboard.tsx:271, identical on the base and untouched here; lint:impeccable's three advisories are outside this change; impeccable@4.1.0 detect exit 0 on every changed UI file
RENDERED_EVIDENCE: PASS: marketing-views-drive 1606/1606: every Marketing tab x 4 viewports x 3 PAIGE postures x 2 themes, states and flows; Analytics frames assert the four funnel steps with their bars, source rows, capture points and four channels with the email read, no page title, and that new small text meets 4.5:1. The first run caught the grey "Not available" pills at 3.58:1 in light (fixed)
BEHAVIORAL_EVIDENCE: PASS: flows drive in both themes with a real mouse: Week moves the summary and the email row to 7 days and is pressed, a capture point opens that form's panel with its routing and submissions, no page errors
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harness stubs the Marketing, briefs and email reads; the email read is the same RPC the Email tab already uses on production
KEYBOARD_FOCUS: PASS: range buttons, Ask PAIGE, capture rows and links are native buttons reachable by Tab with Overview's focus ring; the email line is announced when it changes
ZOOM_REFLOW: PASS: funnel steps stack their bars under the label below 720px; the two-up pair stacks below 900px; channels stack their acts below 640px; no overflow in any driven frame
REDUCED_MOTION: PASS: the funnel bars grow once on arrival (transform only, per AGENTS.md) and do not animate under reduced motion
STATE_COVERAGE: PASS: loading (skeleton), Marketing read failed (retry), briefs read failed (page stays, matching says it can't be done, retry), email read failed (row says so, retry), member (email row is for owners and admins), no leads (zeros drawn as zero, no bars), no live form (Vibe Studio offered to someone who can build), capped read at 200 submissions (every count a floor), forms no longer live (their leads still counted)
TRUTHFUL_STATE_LABELS: PASS: nothing claims visits, spend, reach or revenue; the Ads row says ad accounts aren't read here rather than that none is connected; the email row names sends through the business's own mail as not tracked; sources are said to come only from the link a lead submitted from
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/analytics

SOLO_1536X770_PAIGE_CLOSED: PASS: Analytics both themes, overflow 0
SOLO_1536X770_PAIGE_OPEN: PASS: docked and expanded, overflow 0
SOLO_1366X768_PAIGE_CLOSED: PASS: overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked and expanded, overflow 0
SOLO_1024X768_PAIGE_CLOSED: PASS: overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Analytics has a real designed interface, like the approved prototype, built from real records, before Ads, Content and Campaigns
MUST_NOT_HAPPEN: an estimated or invented figure; a count shown as exact when the read was capped; one form labelled two ways on two tabs; a failed briefs or email read taking down the page; a claim that no ad account is connected
MUST_PRESERVE: Overview, its form panel and routing write (growth_form_set_intake); Email's own figures; Sales links; leads by source and by campaign tag with the brief each matches
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing › Analytics, switches to Week, reads the funnel and sources, opens a form from Capture points and lands on its panel
MOTION_PURPOSE: the funnel bars grow once on arrival so the eye reads each step against the leads received; off under reduced motion
PROTECTED_SEAMS: tested - tab registry and order, the retired /growth/performance address, the form panel (?form=), Sales links in both shell modes. Unaffected and named - Overview, Campaigns, Audience, Content, Social, Email, Ads, Vibe Studio

INTERNAL_BUILD_IDENTITY: df70b56248333b1cd5258ae4102e28dbfe796d1a; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view over existing records, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: reads only existing data; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Analytics against a real Solo account; no tenant login exists in this session.
