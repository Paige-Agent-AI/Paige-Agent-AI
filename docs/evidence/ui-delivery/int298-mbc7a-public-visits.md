# UI delivery evidence: INT-298 MBC slice 7a — visits are recorded, and the screens say so truthfully

Coordinator item 1 (2026-10-12; INT-298 / ANT-87 / P-ANT-5): "funnel-session and page-view evidence… real source
attribution, tenant isolation, accurate denominators and honest unavailable states". The slice is backend evidence
(`docs/delivery/public-visit-evidence-contract.md`). The UI change is copy only: three sentences that said visits are
not recorded would have become false on deploy, so they now say visits are recorded but not counted here yet. Frames:
`DRIVE_TABS=analytics node scripts/live-drive/marketing-views-drive.mjs`; key frames in
`assets/int298-mbc7a-public-visits/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding by three read-only scouts (traffic producers, proof matrix and acceptance conventions, the remaining campaign-step gaps) and production reads (0 page_view rows of 62 events, 0 funnel sessions, 0 submissions, 1 published page). Searched page_view, pageview, funnel_session, visit, beacon, sendBeacon, track-event, utm, referrer, page.viewed, denominator, doNotTrack, consent across supabase/migrations, supabase/functions, src and docs. Flows: a visitor opens a published page, live funnel or standalone form and a visit is recorded for that business; the same tab continues it; a browser asking not to be tracked is never recorded; a submission links to its visit; the owner reads Analytics and sees that visits are recorded but not yet counted
PAIGE_UI_DESIGN: PASS: copy only, inside the owner-approved INT-342 S1d Analytics layout; the existing "Not available" flag and row structure are unchanged; the sentence fits on one line at the drive widths (frames)
MATERIAL_FLOW_CHANGE: NO: copy only; nothing previously shipped is removed (§58)
FLOW_PROTOTYPE: NOT_REQUIRED: copy only; no layout, control or interaction change
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner reading Analytics or Overview is told truthfully that page visits are recorded but not counted here yet
VISUAL_DIRECTION: PASS: unchanged tokens and components; light and dark frames looked at
AUTOMATED_EVIDENCE: PASS: growth2.render.test.tsx and growth2.contract.test.tsx (87) assert the new sentence and keep the plain-words rule ("aren’t counted here yet"); growth-public-visit.test.ts (12) covers the browser visit module and the submit link; marketing-overview-interaction-drive asserts the Ask PAIGE prompt's new wording
STATIC_EVIDENCE: PASS: tsc ratchet baseline 10, current 10; deno check 0 errors on the changed function code; every repo lint exit 0 except lint:gold and lint:impeccable, which fail identically on main (clean worktree) in files this change does not touch
RENDERED_EVIDENCE: PASS: DRIVE_TABS=analytics 472/472 in both themes; the Your pages row reads "Visits are recorded, but aren’t counted here yet" with its Not available flag, one line, no overflow (frames analytics-your-pages-light.png, analytics-your-pages-dark.png)
BEHAVIORAL_EVIDENCE: PASS: marketing-overview-interaction-drive 21/21, including Ask PAIGE sending a question built from the page's own figures with the corrected sentence about visits
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; a real signed-out visit on production is owed to the ANT-87 acceptance run
KEYBOARD_FOCUS: NOT_APPLICABLE: no control added or changed
ZOOM_REFLOW: PASS: the changed sentence is shorter than the one it replaces; it wraps as text
REDUCED_MOTION: NOT_APPLICABLE: no motion
STATE_COVERAGE: PASS: the Analytics full, note, read-only and error states are drawn by the drive with the new row text
TRUTHFUL_STATE_LABELS: PASS: no figure is shown for visits; the row still says Not available; the copy no longer claims visits go unrecorded once they are recorded
SOLO_UI: YES: Solo Marketing › Analytics and Overview (copy only)

SOLO_1536X770_PAIGE_CLOSED: PASS: copy only in an existing row; layout unchanged
SOLO_1536X770_PAIGE_OPEN: PASS: as above
SOLO_1366X768_PAIGE_CLOSED: PASS: Analytics frames at 1366, no overflow
SOLO_1366X768_PAIGE_OPEN: PASS: docked content width, no overflow
SOLO_1024X768_PAIGE_CLOSED: PASS: the sentence wraps as text
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: as 1024
SOLO_900X1000_PAIGE_OPEN: PASS: as 1024

OWNER_INTENT: marketing evidence is real, tenant-scoped and honest; the screens never claim something that has stopped being true
MUST_NOT_HAPPEN: a visit counted for another business; a visitor identified; a Do Not Track or Global Privacy Control browser counted; a submission refused because of its visit; a visit figure shown before it is computed
MUST_PRESERVE: the Analytics layout and every existing figure; growth-public-submit saving every valid submission as before
ACCEPTANCE_CRITERIA: on the live app a signed-out visitor opens a published form and one visit is recorded for its business; a submission carries that visit; Analytics still shows no visit figure and says visits are recorded but not counted yet
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - growth-public-submit (optional visit field; save unchanged without one), the form.submitted payload (named fields only, no token); unaffected and named - Overview figures, Campaigns, Content, Email, Ads

INTERNAL_BUILD_IDENTITY: e82613b97cd0570f8e4839e3fa76c7b4368a9e93; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(applied on merge by deploy-migrations: 20271024100000); edge=PROOF_OWED(deployed on merge: growth-public-visit, growth-public-submit); evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: additive evidence store and copy
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - the table and column are additive and the renderers ignore a failed visit call; reference=git revert of this PR merge
UNVERIFIED: a real visit to a published page on production, a submission linked to it, and the deployed function's answer to real DNT and Sec-GPC requests (§32.c); the visit and conversion figures are slice 7b
