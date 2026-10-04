# Deep Research R1+R2: the PAIGE workspace research home + start-research flow

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the PAIGE workspace tab flow traced (Chat → Knowledge → Deep Research → Helpers → Capabilities) against src/solo/SoloPaigeWorkspace.tsx and src/lib/routing/tierBranches.ts at this PR's head; the new flow is one tab (Deep Research) with two states — the home (list + open) and Start Research (question + depth → run → result) — each state's goal, transition, and exit enumerated in the contract suite; no existing flow changed (Chat/Knowledge/Helpers/Capabilities identical in behavior; the route registry gains one subtab row).
PAIGE_UI_DESIGN: PASS: the committed spw design vocabulary (Obsidian/Mineral tokens, the card/truth-pill/eyebrow system, 980px/640px breakpoints, reduced-motion) reused; dr-* adds only research-unique marks (grade marks, citation chips, coverage line) in the same tokens.
MATERIAL_FLOW_CHANGE: YES: a new tab and a new action (Start Research) — the first owner-facing write path into research_runs through the canonical engine.
FLOW_PROTOTYPE: NOT_REQUIRED: bounded, single-purpose operational flow inside the committed workspace pattern; no new interaction paradigm (form → wait → result card).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the owner (or an admin/member of the workspace) investigates a question with cited sources; the primary action (Start research) is the first and only CTA on an empty home.
VISUAL_DIRECTION: PASS: intelligence-workspace register — scannable run history cards, tabular elapsed time, grade-marked sources; one authored moment (the running pulse) that respects reduced motion.
AUTOMATED_EVIDENCE: PASS: 25/25 src/solo/deep-research-workspace.test.tsx at this PR's head + 41/41 tierBranches (counts updated for the +1 subtab) + 23/23 SoloPaigeWorkspace.contract + 6/6 paigeClientScope.
STATIC_EVIDENCE: PASS: eslint clean on all changed files; tsc -p tsconfig.app.json clean; Impeccable context + craft-floor read; the changed-file detector pass runs in CI.
RENDERED_EVIDENCE: UNVERIFIED: no browser drive in this slice; the owner's authenticated drive is the recorded acceptance (ruling §16).
BEHAVIORAL_EVIDENCE: PASS: the contract suite pins the scope fence (the discard checks + the reset effect), the persistence-readback gate, the distinct error/empty states, the depth-to-bounds mapping, and the no-fake-progress rule.
AUTHENTICATED_RUNTIME: UNVERIFIED: owner's authenticated production drive owed (ruling §16's 13-point acceptance); recorded as the acceptance step.
KEYBOARD_FOCUS: PASS: the workspace's existing roving-tabindex strip covers the new tab; the detail card takes programmatic focus on open (tabIndex -1 + focus); all actions are native buttons; focus-visible rings inherited from spw-root.
ZOOM_REFLOW: UNVERIFIED: not driven at 200 percent this slice; the layout is the same 1040px grid + 980/640 breakpoints the Knowledge view uses.
REDUCED_MOTION: PASS: the running pulse is the only animation and it is disabled under prefers-reduced-motion (pinned by test).
STATE_COVERAGE: PASS: empty, list, loading, list-error, detail, detail-error, running (incl. over-budget wording), done-saved, done-unsaved, failed by class (search_unconfigured / engine_unreachable / workspace_changed / not_signed_in), no-findings — each deliberate and distinct (pinned).
TRUTHFUL_STATE_LABELS: PASS: "saved" only after readback; "saving could not be confirmed" for the unsaved state; stop reasons in owner words; no fake statistics or sample research.
SOLO_UI: YES: the PAIGE workspace (Deep Research tab) — one home, cross-domain.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no host-shell drive this slice.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no host-shell drive this slice.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive this slice.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive this slice.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no host-shell drive this slice.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no host-shell drive this slice.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no host-shell drive this slice.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no host-shell drive this slice.
UNVERIFIED: rendered-viewport proofs, 200 percent zoom, and the authenticated production drive (ruling §16's 13-point acceptance) — owed at closeout; every behavioral and static claim above is proven by the recorded suites.
OWNER_INTENT: owner ruling 2026-10-04 (INT-303): couple R1+R2 so the first experience is a working product loop — open Deep Research, start research, see the run saved, open it, inspect findings and evidence; no empty-state-only destination.
MUST_NOT_HAPPEN: no second research engine/API; no browser-written research rows; no client-supplied tenant authority; no fabricated progress steps; no fake sample runs; no base-table grants; no R3-R7 scope pulled in.
MUST_PRESERVE: the canonical engine call path; the M0 governed read RPCs as the only read door; the existing chat research tool; one research history (caller workspace joins caller chat in the same tables); the PAIGE workspace's existing four tabs unchanged in behavior.
ACCEPTANCE_CRITERIA: Deep Research appears between Knowledge and Helpers in PAIGE; the home lists this workspace's runs with question/date/domain/type/sources/state; Start Research (question + depth) runs the canonical engine and the result appears saved; the run opens with findings, citations, confidence, coverage, and grade-marked sources; dossiers reuse EntityDossier; switching workspace mid-run discards the result from the new view.
MOTION_PURPOSE: STATE: one pulse (research running) — conveys the engine is working; disabled under reduced motion.
PROTECTED_SEAMS: research_runs/research_sources (M0 lineage contract); the governed RPC pair; the tier-branch registry (route + nav drift-proof); the spw tab strip's roving tabindex.
INTERNAL_BUILD_IDENTITY: 83ab34c5c686be2f42936450a3acf9ffcdd2d84a; deployment=none-pre-merge; environment=local development candidate; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record and the AUTOMATED_EVIDENCE suites at the exact candidate head.
RELEASE_CHANNEL: development: pre-merge candidate.
RELEASE_CLASSIFICATION: feature: the first owner-facing Deep Research product surface (R1+R2 coupled).
CUSTOMER_RELEASE_IDENTITY: none: authenticated outcome not established until the owner's drive.
RELEASE_NOTE_REQUIRED: no: internal workspace activation.
RELEASE_TRUTH_BOUNDARY: PARTIAL: the workspace flow is behaviorally proven and CI-pinned; authenticated runtime proof OWED (the §16 drive). No LIVE capability claim beyond the engine's existing honest states.
RELEASE_RECOVERY: position=forward-fix or revert this UI slice; reference=this record; no data conversion (the substrate is M0's, already live).

## Boundary
- R3-R7 deliberately OUT (ruling §11): no watchlists, refresh/versioning, knowledge promotion, harness/rail convergence, market-research retirement, export, comments, filters, async redesign.
- Depth labels map onto EXISTING max_hops bounds (1 / the engine default / 3); freshness and objective omitted this release — the engine contract cannot truthfully represent them (ruling §3's omit rule).
