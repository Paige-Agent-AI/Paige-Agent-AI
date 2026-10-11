# UI delivery evidence: INT-298/INT-342 MBC slice 1 — Marketing Analytics stops presenting Ads

On 2026-10-11 the coordinator's command "Marketing Backend Completion & Analytics Ownership" (owner-authorized;
INT-298, INT-342, Linear ANT-15) made Ads its own top-level department with a dedicated Ads agent, and gave this
lane its first task: remove the Ads-specific channel row and its Open Ads action from Marketing Analytics, keep
paid-source attribution from UTM evidence, keep the approved design, and add no route into Ads until the Ads
agent establishes its destination. Frames: `DRIVE_TABS=analytics node scripts/live-drive/marketing-views-drive.mjs`;
key frames in `assets/int298-mbc1-analytics-ads-ownership/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against the Channels card in src/solo/marketing-analytics.tsx (the Ads row and its onOpenAds prop), its one caller (growth2.tsx AnalyticsTab, setTab("ads")), the render test and the drive that asserted the row, the source-mix derivation in marketing-analytics-model.ts (every lead with a utm_source is counted, the four most-used named and the rest as Other sources) and open PRs and remote branches (no Ads-agent branch touches these files yet). Flows: open Analytics; read how each channel did; trace a lead from a paid link to its source; change the range
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; a removal inside the owner-approved design, no new pattern; one independent non-author review of the real diff
MATERIAL_FLOW_CHANGE: YES: the Channels card loses the Ads row and the Open Ads action, as instructed by the owner-authorized coordinator command (§58 named here); a foot line says where paid leads are counted
FLOW_PROTOTYPE: PASS: no prototype stage: a removal inside an approved design, pre-launch stance (CLAUDE.md §4, §69 pre-launch override)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner reads how their owned channels did and where their leads came from; ad accounts, spend and paid performance are the Ads department's
VISUAL_DIRECTION: PASS: unchanged Solo tokens and classes; the foot uses the existing .mov-foot; both themes; no gold
AUTOMATED_EVIDENCE: PASS: growth2.render.test.tsx Analytics test now asserts the channel rows are exactly Email, Social, Your pages, no ad-account or spend text, no Open Ads button, and the paid-source foot line; shown to fail before the change (expected Email, Social, Your pages; received Email, Ads, Social, Your pages). growth2.render, growth2.contract, marketing-analytics-model and sales-ops.contract: 176 of 176
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on origin/main measured in a separate worktree (none in changed files); eslint clean on changed files; impeccable@4.1.0 detect exit 0 on the changed UI files
RENDERED_EVIDENCE: PASS: DRIVE_TABS=analytics 370/370, now asserting three channels, no Ads row and the paid-source line, at 4 viewports x 3 PAIGE postures x 2 themes, with the contrast check on new small text; frames in both themes looked at
BEHAVIORAL_EVIDENCE: PASS: the drive and render tests change the range and open Email from Channels; no route into Ads remains in Analytics
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session
KEYBOARD_FOCUS: PASS: one fewer button; the remaining Open Email and Try again keep the shared focus ring
ZOOM_REFLOW: PASS: the card reflows as before at every drive viewport
REDUCED_MOTION: PASS: no motion added
STATE_COVERAGE: PASS: the foot line is true in every state (it names where paid leads are counted, not a count): loading, email denied or failed, no leads, capped read
TRUTHFUL_STATE_LABELS: PASS: no claim about ad accounts, spend or connections remains in Analytics; paid leads are described as counted by source tag, which is what Source mix does
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/analytics

SOLO_1536X770_PAIGE_CLOSED: PASS: Analytics both themes, overflow 0 (DRIVE_TABS=analytics)
SOLO_1536X770_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=analytics)
SOLO_1366X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=analytics)
SOLO_1366X768_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=analytics)
SOLO_1024X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=analytics)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=analytics)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Marketing Analytics measures Marketing; Ads owns ad accounts, spend and paid performance; paid leads stay attributed
MUST_NOT_HAPPEN: an invented route into Ads; a redesign of the approved Analytics; paid-source attribution lost; a claim about ad accounts or spend
MUST_PRESERVE: headline figures and sparklines, leads over time, the outcome ring, the funnel, Source mix and Campaign tags, capture points, the heatmap, the Email row and chart, Week/Month/Quarter; the Ads tab itself (owned by the Ads agent, untouched)
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing › Analytics and sees Email, Social and Your pages under Channels, no Ads row, and paid leads in Source mix by their tag
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - the Analytics render test and the drive; unaffected and named - Overview, Campaigns, Audience, Content, Social, Email, Ads (marketing-ads.tsx untouched), the analytics model

INTERNAL_BUILD_IDENTITY: 6cc60b9f5dc01a476eeef6be047a438bb2375883; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view change, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Analytics against a real Solo account; no tenant login exists in this session.
