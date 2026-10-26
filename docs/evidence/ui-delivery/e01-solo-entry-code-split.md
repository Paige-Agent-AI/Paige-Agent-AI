# Solo chat-first entry code-split (PR9) — the first load is Chat again

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no journey changes — every tab and route keeps its exact steps; the only new states are the honest "Opening …" loading fallbacks while a lazily-loaded view's chunk arrives (same pattern the Live 3D scene and the sales-ops agreement workspace already ship).
PAIGE_UI_DESIGN: PASS: existing design language; the fallback is the workspace's own spw-state / centered "Opening {view}…" pattern, no new visual system.
MATERIAL_FLOW_CHANGE: NO: identical destinations, permissions, navigation and state; heavy screens load on first visit instead of at entry.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a coach or consultant signing in to meet PAIGE opens Chat first — the first download now contains Chat, not every department screen; when they open Setup or Growth, that screen loads then, with an honest opening line while it arrives.
VISUAL_DIRECTION: PASS: loading fallback reuses existing tokens (spw-state, surface ink colors); no new styling.
AUTOMATED_EVIDENCE: PASS: 136/136 across 11 suites at the PR tree (the original 80/80 plus the three SoloApp-level suites the first pass missed, the four new ScreenLoadBoundary tests, and the suite-level reruns) — NEW SoloPaigeWorkspace.tabSplit.test.tsx (5 tests: first Chat load intact and free of panel content; each of the four affected views opens, is left, and reopens with its content and Chat intact — the lazy chunk resolving through the REAL dynamic import, nothing mocked); SoloPaigeWorkspace.contract, SoloParityTruthfulness, PaigeAIChat.honesty, onboarding, SoloOnboardingStage.integration, solo-approval-executes all green; `npm run typecheck` exits with only pre-existing baseline errors (none in this PR's files) and `ci:tsc` (the ratchet CI runs) reports no NEW errors.
STATIC_EVIDENCE: PASS: solo-entry-size-guard.mjs wired into the verify job immediately after `npm run build` — fails the build if SoloEntry exceeds 520 kB raw (measured 385) or if any of twelve named lazy chunks (panels, research, growth2, TeamHub, Sales, Finance, Operations, marketplace, Ads, ClientsConversations) stops being produced (the silent re-merge failure mode). Zero "dynamically imported … but also statically imported" warnings in the build.
RENDERED_EVIDENCE: UNVERIFIED: the only new visual states are the transient "Opening …" fallbacks (asserted textually in the behavioral suite); the tmp-capture rendered harness drives the Live surface, not the workspace, and a static frame of a sub-second loading state would not represent the customer experience honestly. Real-browser tab behavior is covered by the deployed readback and the founder window.
BEHAVIORAL_EVIDENCE: PASS: the tab suite drives real tab buttons through open→leave→reopen for Knowledge, Research, Helpers and Capabilities with the panels' data hooks mocked but the panels themselves loading through the real dynamic import; the chat-first DOM is asserted free of all four panels' content before any visit.
AUTHENTICATED_RUNTIME: UNVERIFIED: first-entry experience on the designated ordinary account is the founder's single evaluation window; the local throttled-browser measurements below are synthetic by construction.
KEYBOARD_FOCUS: PASS: tab order and the rail are untouched; the fallback is a status line, not a focusable trap.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change beyond the loading line.
REDUCED_MOTION: NOT_APPLICABLE: no motion added.
STATE_COVERAGE: PASS: all five tabs covered open/leave/reopen plus the never-visited state; route-level fallbacks cover every lazy screen through the same one Suspense mount.
TRUTHFUL_STATE_LABELS: PASS: the fallback says exactly what is happening ("Opening the Knowledge view…", role="status"); no screen claims to be present before its chunk arrives; chunk-load failures propagate to the existing SoloScreenBoundary, the same recovery any module failure has today.
SOLO_UI: YES: the Solo shell and workspace — EXP01's own surface.
UNVERIFIED: authenticated first-entry timing and tab behavior on production are the founder window's legs; engineering provides the synthetic measurements and the deployed-asset readback.

OWNER_INTENT: owner directive 2026-10-25 — proceed with the bounded code-splitting improvement after live shared-file reservation checks; resolve the three-named-tabs-versus-four-mounts ambiguity; verify dependencies actually leave the initial download; add a meaningful bundle-size guard; test first Chat load plus opening, leaving and reopening each affected tab; report bundle reduction separately from measured loading-speed improvement.
MUST_NOT_HAPPEN: a customer's first download compiling every department screen; a lazy screen silently re-merging into the entry; a loading state that lies or traps focus; an incoming call waiting on a chunk fetch (the three voice surfaces stay EAGER by decision).
MUST_PRESERVE: the #2401 Chat reservation (PaigeAIChat.tsx regions — untouched); every lane's screen component source (only HOW the shell loads them changed — no screen file was edited); navigation semantics, deep links, the Capabilities per-subject remount key, the Operations departure guard, settings deep links.
ACCEPTANCE_CRITERIA: same build command before/after; the four affected views and the ambiguity resolution documented; the guard fails on re-merge; the tab suite green; bundle and speed reported separately.
MOTION_PURPOSE: NONE: no motion change.

## The ambiguity, resolved

The checkpoint named three tabs and four mounts. The FOUR components and their owning files:
1. **KnowledgeView** — was a local function in SoloPaigeWorkspace.tsx (:64); now in **src/solo/SoloWorkspacePanels.tsx**
2. **HelpersView** — was local (:143); now in SoloWorkspacePanels.tsx
3. **CapabilitiesView** — was local (:243); now in SoloWorkspacePanels.tsx
4. **ResearchView** — was a static import from **src/solo/paige-research.tsx**; now lazy from the same module.
All four mount through React.lazy + Suspense at the existing conditional mounts; TruthPill moved to its own tiny module (src/solo/TruthPill.tsx) because the workspace's static import of it re-pinned the panels chunk — the build's own warning caught that first attempt.

## The decisive measurement, and the slice's honest extension

The four tabs' panels are ~47 kB. Splitting them alone moved nothing (SoloEntry briefly GREW 7 kB). Source-map attribution of the real entry showed the weight was the ROUTE TABLE: SoloApp.tsx statically imported every department screen, compiling sales-ops (89 kB), TeamHub (101 kB), the settings family (~200 kB), the marketing suite (~150 kB), vault, operations, finance, pipeline, clients and more into the first download. The fix for the checkpoint's stated customer outcome (a chat-first first load) is route-level splitting — applied within the same authorization, in SoloApp.tsx ONLY: twelve screens became React.lazy behind the shell's single Suspense mount. No screen's source was edited; every lane keeps its component exactly as shipped. Deliberately EAGER: the three voice surfaces (an incoming call must never wait on a chunk fetch), CommandHub (the post-login landing), and SoloPaigeWorkspace itself — Chat IS the first load.

## Measured results (same build command both sides)

**Bundle reduction (the primary, deterministic metric):**
- BEFORE: SoloEntry 2,609.64 kB raw / 739.26 kB gzip (main at 03edfad8a tree)
- AFTER: SoloEntry 392.42 kB raw / 118.75 kB gzip — **−85% raw / −84% gzip (−2,217 kB raw / −620 kB gzip)**
- On first visit only: settings 734 kB, growth2 681–696 kB, ClientsConversations 232 kB, OperationsRoute 226 kB, TeamHub 106 kB, Sales 92 kB, marketplace 18 kB, Ads 6 kB, the panels 16 kB and research 26 kB — all now separate chunks, verified as produced (guard) and NOT statically referenced by the entry (zero build warnings; entry's static import set enumerated).
- The app shell (main, ~1.2 MB) loads first for every route, before and after; the numbers above are the /solo route's increment — the honest comparable.

**Loading-speed improvement (synthetic, reported separately):** local Playwright Chromium, 4× CPU throttle + 1.6 Mbps/100 ms RTT network (a budget Android profile), cold-cache dynamic import of the built SoloEntry chunk graph from a local static server, 3 runs per side, median of first-run:
- BEFORE: 35.8 s cold; cached ~6 ms
- AFTER: 17.5 s cold; cached ~5 ms — **−18.3 s under this profile**, dominated by the app-shell chunks both builds share; the split's own contribution is the removed ~2.2 MB. On unthrottled connections the absolute numbers shrink proportionally; the byte reduction is the durable fact, the seconds are profile-dependent.

## Scope, coordination and rollback

- Live reservation check 2026-10-25 before editing: no open PR touched SoloPaigeWorkspace.tsx or SoloApp.tsx (file lists of #2873/#2872/#2871/#2870/#2868/#2848/#2566/#2401/#2191/#2186/#1315/#2040 enumerated); dated notices posted to EXP02 (#2873), EXP05 (#2871), EXP09 (#2872), then widened to cover SoloApp.tsx when the route table proved to be the weight. The #2401 chat reservation is untouched (PaigeAIChat.tsx is not modified by this PR beyond nothing — it is NOT modified at all).
- Rollback: revert the one PR; the build returns to the pre-split graph; no data, migration, edge or runtime-config involvement.


## Addendum (same PR, before first merge) — failed-download recovery, browser check, review findings applied

- **Failed-download recovery (owner directive 2026-10-25):** `ScreenLoadBoundary` in SoloApp wraps every lazy screen mount INSIDE the shell. A failed screen download costs exactly one screen — Chat (the paige column lives outside the boundary) and navigation always survive — with honest recovery and a loud console cause (§32): "Try again" recovers transient render-time failures (React.lazy caches a rejected import for the session, so an in-session retry cannot re-fetch a failed chunk), and "Reload PAIGE" is the real cached-download remedy — the on-screen copy names both without guessing which case a person is in. LAYERING RULE: the boundary catches DOWNLOAD failures only (detector covers Chromium/Firefox/Safari/vite phrasings); any other error is rethrown so the shell's existing SoloScreenBoundary keeps exactly its "Page unavailable" contract — pinned by the operations-retention suite's failure-injection test. Four focused tests cover: recovery+retry, the rethrow layering, the reload remedy, and reset-on-navigation.
- **Real-browser check on the built bundle** (no auth touched; receipt + script at docs/evidence/experience-01-foundation/solo-entry-split-2026-10-25/): real Chromium against the production build served locally — the entry graph totals 385 kB and completes; the settings chunk is NOT fetched at entry (lazy verified at the network level, not inferred); an aborted settings chunk rejects with `TypeError: Failed to fetch dynamically imported module: …`, exactly the shape the boundary detector matches.
- **Review findings applied (REQUEST_CHANGES → fixed):** P1 both type errors (ReactNode import; HTMLElement query typing); P2 the record previously cited a vacuous `tsc -p tsconfig.json` (solution root, zero files) — now cites `npm run typecheck` + `ci:tsc`; P3 guard tripwires extended (vibe, TenantCanonicalCalendarWorkspace); P3 fallback labels cover every screen; P3 the dangling identity SHA rebound to the final code commit below. The VibeStudio Suspense null-fallback was retained deliberately (a slide-over should not push layout).
- **Test-infrastructure lesson (recorded):** three SoloApp-level suites the first pass missed failed under the split — all lazy-timing. Fix pattern: module-scope pre-warm imports (paying vitest's on-first-import transform where the eager world paid it) + bounded screen-ready waits. NOT fixed by mocking: the ownership suite's Vibe tests and both SoloApp suites exercise the real screens.
- **Capabilities truthfulness pass:** the panel's rows are unchanged by this PR — every row's claim (Voice input Available; Live Conversation per-account consent state; Onboarding Active; execution Unavailable) remains pinned by the SoloParityTruthfulness suite, which passes against the moved panel module. No copy was changed because no fact changed; the panel now loads on first visit exactly like the screens it describes.
- **EXP02 coordination:** #2891 (Finance release + navigation proof) is docs-only with no source overlap; a dated note on its thread records that this PR changes Finance's LOAD TIMING (lazy on first visit) without changing its navigation semantics.
- **Approvals/status/results findability:** untouched by construction — the Rail receipt projection (record_capability_run), the CommandHub approvals badge (usePendingApprovals in the shell), and the paige Rail itself are outside the diff; their suites pass at this head. No registry, inbox, engine or store was created.

## Evidence index

- vitest: `node node_modules/vitest/vitest.mjs run src/solo/SoloPaigeWorkspace.tabSplit.test.tsx src/solo/SoloPaigeWorkspace.contract.test.tsx src/solo/SoloParityTruthfulness.test.tsx src/components/dashboard/PaigeAIChat.honesty.test.tsx src/solo/SoloPaigeWorkspace.onboarding.test.tsx src/solo/SoloOnboardingStage.integration.test.tsx src/solo/solo-approval-executes.test.tsx` → 80/80.
- Guard: `node scripts/ci/solo-entry-size-guard.mjs` (also wired into ci.yml verify after Build).
- Source-map attribution + import-set enumeration scripts (one-off, not committed); both builds with `npm run build`.

INTERNAL_BUILD_IDENTITY: bbd4829486910bca27072bc293fd2371e127c1bc; deployment=undeployed at authoring (ships with the next web build; deployed readback follows the merge); environment=local build + throttled-browser synthetic + CI; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + the guard + the tab suite
RELEASE_CHANNEL: development: merges through the normal PR gate; performance slice, no rollout concept change.
RELEASE_CLASSIFICATION: internal-only: pre-evaluation performance improvement of the EXP01 entry surface.
CUSTOMER_RELEASE_IDENTITY: none: not yet in the founder evaluation window.
RELEASE_NOTE_REQUIRED: no: no user-visible flow change; screens load their content as before, one honest opening line while a first-visited screen arrives.
RELEASE_TRUTH_BOUNDARY: PARTIAL: bundle reduction is deterministic build fact; loading seconds are synthetic local measurements; authenticated first-entry experience is the founder window.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the PR thread
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no visual change to steady states; the only new visual is the transient loading line (behavioral suite asserts its text; rendered class UNVERIFIED above).
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same rationale.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no visual change.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
