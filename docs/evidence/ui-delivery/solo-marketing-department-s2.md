# UI delivery evidence: Solo Campaigns becomes the Marketing department (S2, Marketing in place)

The proposal, research and owner decisions D1–D5 are in `docs/product/solo-marketing-ia-proposal.md`.
Render frames are reproducible with `node scripts/live-drive/marketing-views-drive.mjs` and
`npm run drive:campaigns-nav`. Both write to the gitignored `scripts/live-drive/artifacts/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding packet and ownership map in docs/product/solo-marketing-ia-proposal.md §2–§9 (current-state map with file:line, production read-only queries, collision check against open PRs #1657/#1668/#1403); flows covered: department overview, brief creation hand-off to the Campaigns desk, lead-capture routing and submission follow-up, source analytics, legacy-address recovery, Sales-lane tabs kept reachable
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md and references/paige-quality-gates.md read before implementation; Impeccable run on the new views (context loaded, craft-floor.md and operate.md applied, detector clean on growth2.tsx, solo-campaigns.css, campaign-desk.tsx)
MATERIAL_FLOW_CHANGE: YES: the Solo menu item and branch become Marketing; three new views (Overview, Lead capture, Analytics); published Vibe work moves from Catalog to Lead capture; Performance becomes Analytics; Overview's create act opens the brief builder on the Campaigns desk; old addresses redirect
FLOW_PROTOTYPE: PASS: interactive prototype docs/prototypes/solo-marketing-ia.html (published as claude.ai artifact PTLQYGcasqPrbCDPpgKm5y, PR #1671); owner approved 2026-10-03 ("Approved. Go with your recommendations.")
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees what is being marketed, what is stuck and what came in, then acts; primary act per surface is Create campaign brief (Overview, Campaigns); Lead capture's act is Vibe Studio; see "User job and state map"
VISUAL_DIRECTION: PASS: existing Solo Mineral/Obsidian tokens (src/solo/solo-tokens.css) and Campaigns geometry (src/solo/solo-campaigns.css); no hard-coded colour in new rules; gold spent only on Create campaign brief (.btn-g) and the existing selected-tab underline; lint:gold clean on changed files
AUTOMATED_EVIDENCE: PASS: vitest src/lib/routing src/solo src/components/tenant-shell src/components/tenant-relationships = 156 files, 2649 passed, 2 skipped; 9 new render tests in growth2.render.test.tsx; two of them (window floor, Studio launcher) shown to fail with the defect reinstated and pass with it fixed; full-suite baseline on the parent commit: 499 files, 7382 passed, 2 skipped
STATIC_EVIDENCE: PASS: node scripts/ci/tsc-ratchet.mjs = no new errors (12/12); eslint on changed ts/tsx = 0 errors (1 pre-existing warning, growth2.tsx GR export); gold-discipline lint clean; impeccable detect exit 0 on changed UI files
RENDERED_EVIDENCE: PASS: scripts/live-drive/marketing-views-drive.mjs = 644/644 checks across Overview, Campaigns, Lead capture and Analytics × 4 viewports × 3 PAIGE postures × 2 themes, plus first-use / loading / error / read-only states; frames in scripts/live-drive/artifacts/marketing-views/; campaigns-nav-fit-drive = 216/216 for the eight-tab strip
BEHAVIORAL_EVIDENCE: PASS: render tests drive Create campaign brief → /growth/campaigns with the builder open; Lead capture Open deal → /growth/pipeline?deal=; tab arrow keys move route and focus; legacy /growth/pages → Go to Lead capture; redirects performance→analytics, active→campaigns, catalog?type=form→lead-capture?type=form; desk Open Vibe Studio now reaches the Studio handoff with a real launcher (previously ignored by SoloApp)
AUTHENTICATED_RUNTIME: UNVERIFIED: this headless session cannot reach the deployed app with a tenant login; the render harness stubs only the three network reads (Campaigns snapshot, briefs, offers); the authenticated live check is owed to a browser-capable session (§32.c)
KEYBOARD_FOCUS: PASS: tablist keeps roving tabindex and Arrow/Home/End; the divider is aria-hidden and outside tab order; Create campaign brief reached by Tab with a visible focus indicator (drive check); icon-only Vibe Studio launcher keeps its text as accessible name and a title
ZOOM_REFLOW: PASS: the views size against their own container (.mk-view, container queries) so they reflow at the narrowest real column (439px, PAIGE expanded at 1366), which is equivalent to high zoom of the content column; no horizontal overflow at any measured width
REDUCED_MOTION: PASS: no motion added; the existing prefers-reduced-motion guard on .solo-campaigns covers every new element
STATE_COVERAGE: PASS: resolving, loading (skeleton), error with retry, unavailable workspace, first use (guided, one act), populated, read-only member (no create act), empty filter, no submissions, drafts that collect nothing, a full 200-row window shown as a floor (200+)
TRUTHFUL_STATE_LABELS: PASS: every figure is a read of campaign_briefs, published/draft growth_pages/funnels/forms or growth_form_submissions (source from utm_json); email, ads, spend, visits, multi-touch and revenue-by-campaign shown as Not available with the reason; plain truth words only (desk's raw LIVE/PARTIAL labels replaced)
SOLO_UI: YES: Solo Marketing (formerly Campaigns), /solo/{account}/growth/{overview|campaigns|lead-capture|social|analytics|catalog|sales|pipeline}

SOLO_1536X770_PAIGE_CLOSED: PASS: content column 1320px; all four views, both themes, horizontal overflow 0; frames *-1536x770-closed.png
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px; overflow 0; eight tabs fit when docked; strip scrolls when expanded with the selected tab kept in view; frames *-1536x770-docked.png
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px; overflow 0; frames *-1366x768-closed.png
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px (tightest); overflow 0; ledger reflows 4→2 columns; eight tabs fit when docked; frames *-1366x768-docked.png
SOLO_1024X768_PAIGE_CLOSED: PASS: rail compacts to 72px, content column 952px; overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: below 1080px PAIGE is an overlay and does not reflow the column; layout equals PAIGE-closed at 952px; overflow 0
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px; overflow 0; frames *-900x1000-closed.png
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed; overflow 0

OWNER_INTENT: Campaigns becomes Marketing, a true department; Campaigns is one function in it; Sales leaves (built by the Sales lane); Solo Analytics retires after its useful consumers move; Vibe stays the only creator; one owner per capability (owner handoff 2026-10-03, D1–D5 approved)
MUST_NOT_HAPPEN: Sales, Pipeline or Offers becoming unreachable before the Sales destination exists; a fabricated metric (reach, spend, CPL, conversion, revenue by campaign); Vibe creation controls copied into Marketing; a copied /growth link dying; Platform Operator analytics (/operator/analytics/*) touched
MUST_PRESERVE: the Campaign Command Desk (brief builder, dossier, loop, readiness); the approved Pipeline board (APPROVED-FROZEN, unchanged); Social Mission Control (only its eyebrow text changes to Marketing · Social); the form intake drawer (moved with Lead capture); retired creative-address landings; Sales' Return to Sales banner
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing from the menu, sees Overview with their briefs, capture points and leads; creates a brief from Overview and lands in the builder; opens Lead capture, sees published and draft work and routes a form; opens Analytics and sees leads by tracking tag; still reaches Offers, Sales and Pipeline from the same strip
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tested — Campaigns snapshot read (useSoloCampaigns, still 4 tenant-filtered reads, contract test), briefs write seam (unchanged, campaign-briefs.contract), form intake panel (growth2.render form tests), Vibe Studio handoff (shell ownership tests + new launcher test), Systems Check destinations (systems-check-destinations.contract). Unaffected and named — Sales ops internals, catalog-offers internals, Pipeline command desk, operator analytics tree (OPERATOR_BRANCHES unchanged), Agency/Enterprise/sub-account trees (AGENCY_BRANCHES and SUB_ACCOUNT_BRANCHES unchanged)

INTERNAL_BUILD_IDENTITY: ad2df87005886c5e1b7362d955f10386bf9b331d; deployment=local-render; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production deployment follows the merge to main under the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: information-architecture reorganization of an existing Solo surface; no new capability promise
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: briefs, published and draft capture points, submissions and their tracking tags are read from tenant records; email broadcasts, paid ads, spend, visit counts, multi-touch attribution and revenue by campaign are UNAVAILABLE; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit (no migration, no edge change); reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c), owed to a browser-capable session: the Marketing menu item, the three new views against a real tenant's data, and the brief hand-off on the deployed app. Sub-accounts (/business) run the Agency tree and still read "Growth" (owner decision D4: left for the /business → Solo-shell migration).

## Scope and collisions

- **Classification:** material Solo IA change (S2 of docs/product/solo-marketing-ia-proposal.md §11).
- **Affected flows:**
  - department overview
  - campaign briefs, including Overview → builder
  - lead capture and form routing
  - source analytics
  - legacy-address recovery
  - the reachable Sales-lane tabs
- **Neighboring regressions checked:**
  - Sales ops and catalog-offers contract tests, re-pointed only where they pinned the old tab list or the old Catalog split
  - Systems Check destinations
  - shell ownership and Vibe Studio round-trip
  - Clients workspace card
  - PAIGE Mind offers copy
- **Active-owner/file collisions:**
  - The Sales lane owns `catalog-offers.*` and `sales-ops.*`. Neither source file was edited.
  - Two of the Sales lane's test files were re-pointed to the new tab strip: `catalog-offers.contract.test.tsx` and `sales-ops.contract.test.tsx`.
  - PR #1668 had already merged into this branch before the change.
- **Explicit exclusions:**
  - no migration, edge or RPC change
  - no new feature key
  - no change to Sales, Pipeline or Offers internals
  - the `growth` URL slug is unchanged (S5)
  - Solo Analytics is unchanged (S4, after Sales hosts the sales funnel)

## User job and state map

**Purpose.** A Solo owner runs their marketing in one place:
- **Overview:** what's running, stuck and new.
- **Campaigns:** plan each initiative.
- **Lead capture:** where people come in and where they go.
- **Social:** the accounts the business posts from.
- **Analytics:** where leads came from, and what can't be proved.

**Primary act.** Create campaign brief. Vibe Studio stays the only place work is created.

**Scroll owner.** `.campaigns-scroll`; nothing adds a nested scroller. The desk's own `loop-track` is a pre-existing, intended inner horizontal scroller, reported in `geometry.json`.

**States.** Listed in `STATE_COVERAGE` above.

## Evidence index

- `node scripts/live-drive/marketing-views-drive.mjs`: 644/644. Artifacts in `scripts/live-drive/artifacts/marketing-views/`, with `geometry.json` recording any inner scroller per frame.
- `npm run drive:campaigns-nav`: 216/216.
- `npx vitest run src/lib/routing src/solo src/components/tenant-shell src/components/tenant-relationships`: 2649 passed, 2 skipped.
- `node scripts/ci/tsc-ratchet.mjs`: 12/12, no new errors.
- **Fixtures** are a fictional business, never a real owner account (§63). They live in `scripts/live-drive/harness/marketing-mount/`.
