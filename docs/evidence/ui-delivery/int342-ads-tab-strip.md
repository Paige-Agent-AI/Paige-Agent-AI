# UI delivery evidence: Ads department tab strip matches the Solo shell

Owner, 2026-10-11, with screenshots of Ads, Marketing, Clients and Sales side by side: the Ads views
looked nothing like the other departments' sub-menus. He asked for the same standard, allowing each
department its own feel within the same parameters.

**What was wrong.** Ads still drew the small pill group (`campaigns-segmented`) it had as a Marketing
tab, squeezed beside the summary sentence. Every other department carries a full-width strip under the
header (`campaigns-nav` / `campaigns-tabs`). That strip has an icon and a label per view, the active
view underlined, and the department's own action at the far end.

**What changed.** Ads now carries that strip. Overview, Campaigns, Creative, Audiences and Performance
each get an icon. "Ask PAIGE for ad copy" moves into the action slot where Marketing has Vibe Studio,
and collapses to its icon at narrow widths the same way. The desk below is unchanged apart from losing
its pill group.

**Frames:**
- `node scripts/live-drive/ads-department-drive.mjs`: the real tenant shell around the real Ads route.
- Key frames are in `assets/int342-ads-tab-strip/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding read the four strips side by side. Marketing (growth2.tsx MarketingTabs) and Sales (SalesWorkspace.tsx) both use .campaigns-nav/.campaigns-tabs with role=tablist and an icon per tab. Ads (marketing-ads.tsx) used a .campaigns-segmented role=group inside .mov-top. One actor-goal flow: a Solo owner switches between Ads views from the department strip; the address and Back/Forward behaviour are unchanged
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode. It reuses the shell's own strip (solo-campaigns.css), with no new CSS. Gold appears only on the existing active-tab underline. The action button matches Marketing's Vibe Studio slot (btn btn-s btn-p campaigns-studio)
MATERIAL_FLOW_CHANGE: NO: the same five views at the same addresses, and the same Ask PAIGE prompt; only where the switcher and the ask sit changes
FLOW_PROTOTYPE: PASS: the owner named the target directly (the other departments' strips, shown in his screenshots of 2026-10-11); no new visual world, so no separate prototype
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner moves between Ads views from the same kind of strip as every other department, and asks PAIGE for ad copy from its action slot
VISUAL_DIRECTION: PASS: identical structure to Marketing's strip. The drive asserts the Ads strip sits at Marketing's top and height, with Marketing's tab font size and weight, and an icon on all five tabs. Ads keeps its own icons (Activity, Layers, Image, Users, TrendingUp)
AUTOMATED_EVIDENCE: PASS: AdsWorkspace.route.test.tsx, 10 tests. New tests cover: a real tablist with one tab in the Tab order; arrow keys and Home moving between views and updating the address; the panel labelled by its tab; and Ask PAIGE in the action slot on every view, for an owner and for a member, opening PAIGE with the unchanged prompt. All six strip-dependent tests fail with the strip removed. Solo/shell/routing suites on b2145e77: 3484 passed, 0 failed on two of three runs. The third run failed one test, team-workspace.remove-member (a timing-sensitive Team test that also failed on base during #1949; not touched here)
STATIC_EVIDENCE: PASS: tsc ratchet baseline 10, current 10. eslint has 0 errors and 4 warnings on the changed files, the same 4 as before the change. impeccable@4.1.0 detect exits 0. The Solo parity guard passes SP1–SP5
RENDERED_EVIDENCE: PASS: on b2145e77, ads-department-drive passed 157/157. It ran the real shell at 1536x770, 1366x768, 1024x768 and 900x1000, in both themes, with the rail open and folded. New: the Ads strip sits where Marketing's does, at its height and type, with an icon on every tab. marketing-views-drive (ads, overview) passed 636/636. New: at 1366 with PAIGE expanded (439px of content) the strip scrolls, and an old Performance bookmark opens with its tab fully in view, clear of the end fade. This check fails without the fix
BEHAVIORAL_EVIDENCE: PASS: the drive clicks each strip tab and asserts the address, the selected tab and the lit rail item after each. It also follows an old /growth/ads bookmark and asserts it opens under the Ads strip
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harnesses stub the library and briefs reads
KEYBOARD_FOCUS: PASS: roving tabindex (one tab in the Tab order). ArrowLeft, ArrowRight, Home and End move to and focus the next tab, using preventScroll; the selected tab is scrolled into the strip separately. The shell's violet focus ring applies (solo-campaigns.css)
ZOOM_REFLOW: PASS: the strip's existing container queries apply. Icons drop below 860px of content, and the action collapses to its icon. With PAIGE expanded the strip itself scrolls horizontally, as Marketing's does. The selected view is scrolled into it, clear of the 28px end fade (scroll-padding). The page and the desk never scroll sideways
REDUCED_MOTION: PASS: no authored motion
STATE_COVERAGE: PASS: the strip is the same in every desk state (loading, empty, read failed, member). For a member the ask stays available from the strip, as it was before (§58)
TRUTHFUL_STATE_LABELS: PASS: no copy or figure changed; provider figures still read "Not read yet"
SOLO_UI: YES: /solo/{account}/ads/{view}

SOLO_1536X770_PAIGE_CLOSED: PASS: strip and desk, both themes, rail open and folded, overflow 0 (ads-department-drive)
SOLO_1536X770_PAIGE_OPEN: PASS: desk at docked and expanded PAIGE widths, overflow 0 (marketing-views-drive, ads)
SOLO_1366X768_PAIGE_CLOSED: PASS: strip and desk, both themes, rail open and folded, overflow 0 (ads-department-drive)
SOLO_1366X768_PAIGE_OPEN: PASS: at docked and expanded PAIGE widths the page and desk do not overflow. At expanded width the strip scrolls with the selected view in view (marketing-views-drive, ads)
SOLO_1024X768_PAIGE_CLOSED: PASS: strip and desk, both themes, rail open and folded, overflow 0 (ads-department-drive)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: strip with icons dropped and the action as an icon, both themes, overflow 0 (ads-department-drive)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: the Ads sub-menu meets the same standard as the rest of the Solo shell, while each department keeps its own feel within the same parameters
MUST_NOT_HAPPEN: a different strip pattern for Ads; a lost view, address or Back/Forward step; Ask PAIGE for ad copy disappearing for anyone who had it
MUST_PRESERVE: the five views at /solo/{account}/ads/{view}; old /growth/ads links; Ask PAIGE for ad copy (same prompt) for owners, admins and members; the desk's reads and states
ACCEPTANCE_CRITERIA: on the live app the Ads views sit in a strip under the header that looks like Marketing's and Sales', with Ask PAIGE for ad copy at its right
MOTION_PURPOSE: none; no authored motion
PROTECTED_SEAMS: tested: the route and redirect (AdsWorkspace.route.test), the desk (marketing-ads.render.test), Marketing's strip (growth2 tests, marketing-views-drive), the rail (TenantCommandCenterShell tests). AskPaigeButton's new optional props leave every existing caller unchanged

INTERNAL_BUILD_IDENTITY: b2145e77360fd2a64d6289c3dd67611d2bdcbe4a (the tested tree: the strip change and its review fixes, over main 9290a63c9; the suites and both drives ran on it); later commits on the branch change only this record; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/ads-department-drive.mjs, scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo navigation-style change, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: the strip ships; Ads remains not end-to-end operational (int342 §M); authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): the strip against a real Solo account; no tenant login exists in this session.
