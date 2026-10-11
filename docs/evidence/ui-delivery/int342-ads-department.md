# UI delivery evidence: INT-342 / ANT-15 — Ads becomes its own Solo department, directly below Marketing

Owner ruling 2026-10-10 (Linear ANT-15): Ads leaves Marketing and becomes a first-level main-navigation
destination directly below it. It is not a Marketing submenu. The existing desk is rehomed, not rebuilt.

The owner's One-PAIGE integration addendum, the same day, made the following permanent:
- every department participates in the one PAIGE architecture;
- Chat and Live consume the same capabilities;
- Ads is not end-to-end operational until those exist and are verified.

The Capability Integration & Proof Matrix and the Chat/Live contract are in
`docs/product/int342-marketing-convergence.md` §M.

**Frames:**
- `node scripts/live-drive/ads-department-drive.mjs`: the real tenant shell around the real Ads route.
- `DRIVE_TABS=ads,overview node scripts/live-drive/marketing-views-drive.mjs`: the desk at every PAIGE posture.
- Key frames: `assets/int342-ads-department/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against main 82bd888. The live Solo rail is SOLO_SHELL_DESTINATIONS (tenantShellRoutes.ts, the only rail TenantCommandCenterShell renders for an authenticated standalone account); routing is the TIER_BRANCHES registry plus useSubtabRoute; the desk is marketing-ads.tsx, mounted by growth2.tsx with `?view=`. Producers of the old address searched as growth/ads, "ads", 'ads', onOpenAds, MarketingAds and Marketing › Ads across src and supabase/functions: only Marketing's own tab, its Analytics "Open Ads" link and the desk's links out. Flows: open Ads from the rail (open and folded); switch each of the five views, each its own address, Back and Forward; reload a view address; open an old /growth/ads[?view=] bookmark; follow every link out (Integrations, campaign briefs, Audience, Analytics); Ask PAIGE for ad copy and Revise with PAIGE (unchanged handoff); member (saved copy is for owners and admins); workspace switch (the route is keyed to the active workspace; reads scoped to it); reach the rail item by keyboard
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode. No department header added (the lit rail item and the command row already say "Ads"; the page has only a screen-reader h1). Ads gets its own Target icon, distinct from Marketing's megaphone. The approved desk is unchanged (§28). An independent non-author review ran on the real diff before merge, and again on the Codex fixes (recorded in the PR)
MATERIAL_FLOW_CHANGE: YES: Ads moves from a Marketing tab to its own main-navigation destination below Marketing; Marketing's strip drops to seven tabs; every earlier act on the desk remains and every old address resolves
FLOW_PROTOTYPE: PASS: the desk is the owner-approved prototype v2 (record copy docs/prototypes/int342-marketing-convergence.html); the relocation is the owner's own information-architecture ruling of 2026-10-10 (ANT-15), recorded in docs/brain/decision-log.md, and adds no new visual design beyond a rail item in the existing shell pattern
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner opens Ads straight from the main menu, below Marketing, sees what paid acquisition can and cannot show today, and reviews or asks PAIGE for ad copy; nothing runs, pauses, pays for or publishes an ad
VISUAL_DIRECTION: PASS: no new CSS; the rail item is the shell's own pattern (Solo tokens, indigo active state, gold only on the existing active marker); the desk keeps marketing-ads.css unchanged
AUTOMATED_EVIDENCE: PASS: AdsWorkspace.route.test.tsx, 8 tests, the real route, redirect and registry, network stubbed. It covers the old address map (every view, unknown view, identity and redirect keys stripped, hash kept), a bookmark replaced before any Marketing reader mounts, each view its own history entry with Back and Forward, `?view=` on the new address, every link out, reads scoped to the active workspace, member read policy, and nothing estimated. The redirect tests were made to fail by removing the redirect and pass with it. tierBranches (Ads directly after Marketing, five subtabs, registry keys match the desk's rendered views), TenantCommandCenterShell (rail order and hrefs, Ads lit on its addresses, no Ads in sub-account or unauthenticated menus) and growth2/sales-ops contract and render tests were updated. Solo, tenant-shell and routing suites: 3460 passed with 1 failure on this change, the same command on base 82bd888 3451 passed with 1 failure. The change's one failure (growth2.render tab order) is fixed. The base's one failure (team-workspace.remove-member) passes on this change and was not touched
STATIC_EVIDENCE: PASS: tsc ratchet baseline 10, current 10; eslint 0 errors on changed files; impeccable@4.1.0 detect exit 0 on the new UI files; gold-discipline lint unchanged from base (its one finding is in BusinessCreditDashboard.tsx, not touched)
RENDERED_EVIDENCE: PASS: ads-department-drive 155/155 (re-run 2026-10-11 on the merged tree 929a9e32). The real shell at 1536x770, 1366x768, 1024x768 and 900x1000, both themes, rail open and folded, asserting all of: the rail order Command Center · Operations · Clients · Marketing · Ads · Sales · Finance · Marketplace · Settings with Ads lit; the command row naming Ads; its own icon; shell and desk sharing a theme; the desk on Overview with no Marketing strip; no sideways overflow. Its first run caught a harness theming fault that left the shell light behind a dark desk (fixed in the harness; the product shell resolves one theme). marketing-views-drive (ads, overview) at every PAIGE posture: 1796/1796 on 929a9e32; it now also asserts Marketing's seven tabs without Ads and an old bookmark opening Ads › Performance
BEHAVIORAL_EVIDENCE: PASS: the drive clicks the rail's Ads, each view, an old bookmark, Open your campaign briefs and Open Integrations, and asserts the address and the lit rail item after each; the route tests drive the same in jsdom
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harnesses stub the library and briefs reads and the shell's PAIGE presence
KEYBOARD_FOCUS: PASS: the rail's Ads is a native link reached by Tab with a visible focus indicator, and Enter opens the department (drive); the view switcher and every link out are native buttons
ZOOM_REFLOW: PASS: 900x1000 with the rail folded reflows the desk's header and cards with no overflow; the desk's own container queries are unchanged
REDUCED_MOTION: PASS: no authored motion added; the shell's own transitions are unchanged
STATE_COVERAGE: PASS: populated, empty library, loading, read failed and member states are the desk's own (unchanged, covered by marketing-ads.render.test and marketing-views-drive states). New for the move: an unknown legacy view lands on Overview, an inline mount with no account degrades to local view state, and a workspace switch remounts the route
TRUTHFUL_STATE_LABELS: PASS: no spend, reach, click, cost-per-lead or return figure is shown; provider figures read "Not read yet"; a brief's budget stays "a plan, never spend"; §M records the department as NOT end-to-end operational
SOLO_UI: YES: Solo main navigation and /solo/{account}/ads/{view}

SOLO_1536X770_PAIGE_CLOSED: PASS: shell, rail open and folded, both themes, overflow 0 (ads-department-drive)
SOLO_1536X770_PAIGE_OPEN: PASS: desk at docked and expanded PAIGE widths, overflow 0 (marketing-views-drive, ads)
SOLO_1366X768_PAIGE_CLOSED: PASS: shell, rail open and folded, both themes, overflow 0 (ads-department-drive)
SOLO_1366X768_PAIGE_OPEN: PASS: desk at docked and expanded PAIGE widths, overflow 0 (marketing-views-drive, ads)
SOLO_1024X768_PAIGE_CLOSED: PASS: shell, rail open and folded, both themes, overflow 0 (ads-department-drive)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: shell, rail open and folded, both themes, overflow 0 (ads-department-drive)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Ads is a first-class PAIGE department directly below Marketing, the existing desk rehomed, every old link still working, and honest that the department is not end-to-end operational yet
MUST_NOT_HAPPEN: a rebuilt or second Ads implementation; Ads as a Marketing submenu or tab; a dead old link; any spend, provider call, publish or data mutation; a claim that Ads is operational end to end
MUST_PRESERVE: saved ad copy for owners and admins, Ask PAIGE for ad copy, Revise with PAIGE, Open Integrations, a brief's budget quoted as a plan; Marketing's Overview, Campaigns, Audience, Content, Social, Email and Analytics
ACCEPTANCE_CRITERIA: on the live app a Solo owner sees Ads directly below Marketing, opens it, switches to Creative and back, reloads, follows an old Marketing Ads link, and sees Marketing without an Ads tab
MOTION_PURPOSE: none; no authored motion
PROTECTED_SEAMS: tested: the registry and screen-source contract (tierBranches), the rail (TenantCommandCenterShell tests), Marketing's strip and redirects (growth2, sales-ops), the desk (marketing-ads.render), the library read policy (useLibraryAccess). Unaffected and named: Vibe Studio (its launcher focus-return is Marketing-only and Ads launches none), Sales, Finance, Settings

INTERNAL_BUILD_IDENTITY: 929a9e32e86728c1ecb34140b09855e7ba6d7e21 (the tested tree: merge over main 893c6e23c4d8545997f7eb528ccd4c679a4252ef; the Solo/shell/routing suites 3474 passed, ads-department-drive 155/155 and marketing-views-drive 1796/1796 ran on it; grounding was first done against main 82bd888); later commits on the branch are docs-only (Binding Ledger, tier matrix, this record); deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/ads-department-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo navigation change over existing records, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: navigation and desk ship; provider read, attribution, approvals, execution and Chat/Live ads capabilities are UNAVAILABLE or GATED (§M); authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): the Ads department against a real Solo account; no tenant login exists in this session.
