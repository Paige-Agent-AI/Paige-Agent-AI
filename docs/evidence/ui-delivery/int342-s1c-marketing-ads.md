# UI delivery evidence: INT-342 S1c — Solo Marketing › Ads rebuilt as the paid-acquisition desk

The owner approved prototype version 2 on 2026-10-10 (record copy `docs/prototypes/int342-marketing-convergence.html`,
plan `docs/product/int342-marketing-convergence.md` §G/§K/§L) and the same day ruled "Desk now, Meta read next": the
desk ships with honest not-read states, then a read-only Meta Ads backend (S5). This record covers slice S1c. Frames:
`DRIVE_TABS=ads node scripts/live-drive/marketing-views-drive.mjs`; key frames in `assets/int342-s1c-marketing-ads/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against the prototype's vAds/pacing/adsOverview/adsCampaigns/adsCreative/adsAud/adsPerf (not-connected branches), the old Ads tab (marketing-planned.tsx), PAIGE's ad-copy writer (supabase/functions/content-draft: labelled headline, primary text, call to action) and production (read-only: 1 brief, no budget written, 0 ad-copy rows, 0 ad connections; the existing Meta functions are retired stubs). Flows: open Ads by tab and deep link; switch views and keep the view in the address; read the spend card and any budget written in a brief; open Creative from Ready now; preview each saved ad; ask PAIGE for ad copy and to revise one; open Integrations, Audience, Analytics and Campaigns; member (saved copy is for owners and admins); read failure and retry; empty library; workspace switch mid-read
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode against the owner-approved prototype; an independent review (non-author) found no BLOCKING and nine SHOULD-FIX items, all fixed before this record (the ad preview readable by assistive tech, no invented headline or "Learn more", the call to action never cut mid-word, the parser hardened against the chat model's varied formats, "Not read yet" for connectable platforms, no claim the ad is or isn't live, briefs quoted with their status and completed ones left out, Ask PAIGE kept for members as on the earlier tab, the view switcher's light-mode contrast); one deliberate copy change from the prototype, "No ad account connected" became "Paige can't read an ad account yet" because Meta or Metricool can be connected in Integrations while nothing reads them; rendered frames looked at in both themes and fixed before this record (a short Ready now card now names the newest drafts, preview headlines wrap to two lines, the image slot is labelled, cards cap at 400px); no gold (nothing here spends or publishes)
MATERIAL_FLOW_CHANGE: YES: the Ads tab moves from a saved-copy list and a not-available list to a five-view desk; every earlier act (saved ad copy, Ask PAIGE, Open Integrations) remains
FLOW_PROTOTYPE: PASS: owner-approved prototype v2, https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG (record copy docs/prototypes/int342-marketing-convergence.html), approval and the "Desk now, Meta read next" ruling recorded in docs/brain/decision-log.md 2026-10-10
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees what paid acquisition can and can't show today, reviews the ad copy PAIGE wrote as it would read in a feed, and asks PAIGE for more; nothing on the page runs, pauses, pays for or publishes anything
VISUAL_DIRECTION: PASS: Solo tokens only (no hex in src/solo/marketing-ads.css), reuses Overview's card, head and summary styles, container queries at 900/640, both themes
AUTOMATED_EVIDENCE: PASS: marketing-ads.render.test.tsx 11 tests (parseAdCopy on labelled, unlabelled and empty copy and on the formats the chat model varies between, headings, list markers, bold and italic labels, dashes, words after a call to action, a sentence starting with "Text"; Overview read failure with a retry and loading skeleton; Overview with nothing estimated, the spend card empty, a brief's budget quoted verbatim and an archived brief's left out, the newest drafts named; no budget written and briefs failed; Creative previews with headline and call to action and a draft-first revise; member not read; read failure and retry then empty; Performance's sources; Campaigns and Audiences routing; a stale answer dropped on workspace switch); marketing-planned and sales-ops contract tests updated for the move. Every Solo test: 3241 across 223 files pass
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on the base (none in changed files); eslint 0 errors on changed files; impeccable@4.1.0 detect exit 0 on the new UI files
RENDERED_EVIDENCE: PASS: DRIVE_TABS=ads 360/360 on the final build: Ads at 4 viewports x 3 PAIGE postures x 2 themes plus every tab's states and the flows, asserting the desk opens on nothing estimated with five views, the ad-account strip, an empty spend card and the brief's budget quoted as a plan, three Creative previews with headline and call to action, and that new small text (view switcher included) meets 4.5:1; the first run caught Overview with no retry after a failed read and no loading skeleton (fixed)
BEHAVIORAL_EVIDENCE: PASS: the drive's flow switches to Creative with a real click and asserts three previews with headline and call to action; the render tests drive every view switch, ask, revise, retry and routing act
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harness stubs the library and briefs reads; production holds no ad copy today, so the live desk will show its empty and not-read states
KEYBOARD_FOCUS: PASS: view buttons, asks, Open Creative, Open Integrations and every routing link are native buttons with the shared focus ring
ZOOM_REFLOW: PASS: the spend figures stack below 640px, the Ready now and platforms pair stacks below 900px, previews reflow from three columns to one
REDUCED_MOTION: PASS: no authored motion on the desk
STATE_COVERAGE: PASS: loading (skeleton on Overview and Creative), read failed (retry on Overview and Creative), empty library (ask PAIGE), member (saved copy is for owners and admins, Ask PAIGE still offered), briefs failed (budget line says so), no budget written, a draft with no headline or call to action (named as missing in the preview, never filled in), workspace switch mid-read (stale answer dropped)
TRUTHFUL_STATE_LABELS: PASS: no spend, reach, clicks, cost per lead or return is shown; a budget is a brief's own words with its status, labelled "a plan, never spend" (completed and archived briefs left out); no claim that an ad is or isn't live, only "Not run by Paige"; the desk never claims nothing is connected; provider figures read "Not read yet", return "Not available"
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/ads

SOLO_1536X770_PAIGE_CLOSED: PASS: Ads both themes, overflow 0 (DRIVE_TABS=ads)
SOLO_1536X770_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=ads)
SOLO_1366X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=ads)
SOLO_1366X768_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=ads)
SOLO_1024X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=ads)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=ads)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Ads has a real designed interface like the approved prototype, honest that no ad platform can be read yet, ahead of the read-only Meta backend
MUST_NOT_HAPPEN: any spend, reach, click or return figure; a brief's budget shown as spend; a claim that nothing is connected; a member shown someone else's ad copy; anything run, paused, paid for or published
MUST_PRESERVE: saved ad copy for owners and admins, Ask PAIGE for ad copy, Open Integrations; Content, Email, Analytics and the rest of Marketing
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing › Ads, switches to Creative and back, asks PAIGE for ad copy, and sees the desk say plainly that no ad account is read yet
MOTION_PURPOSE: none; the desk has no authored motion
PROTECTED_SEAMS: tested - tab registry and order (growth2, sales-ops contract), the library read policy (useLibraryAccess), Content's library (marketing-planned tests). Unaffected and named - Overview, Campaigns, Audience, Social, Email, Analytics, Vibe Studio

INTERNAL_BUILD_IDENTITY: 4a7052b056b85b44fe07061535004aeeb5f71ab4; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view over existing records, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: reads only existing data; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Ads against a real Solo account; no tenant login exists in this session.
