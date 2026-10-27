# Hosting cost line follows the billing supersession (EXP06 correction — one copy line + harness repair)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: correction to the PR7 "Use my own address" guidance surface (WEB-05/09/13, matrix rows 9+11): the cost line's superseded claim ("any spend stays under an owner-set ceiling with alerts") is replaced with the supersession truth — static-asset requests are free and unlimited (verified current official Cloudflare docs), anything billable is scoped/priced/approved by the workspace owner BEFORE activation, and real usage is attributed to the workspace and metered, never capped. No flow changes: reading guidance only, no DNS read, no provider API, no mutation (purity re-asserted by the retained model scan).
PAIGE_UI_DESIGN: PASS: unchanged design — the same quiet bordered disclosure in the panel's voice, the same --vs-* tokens; only one sentence of copy changed. Zero visual delta in the captured frames (the line sits below the pop's fold in every viewport, as in PR7).
MATERIAL_FLOW_CHANGE: NO: a truthful-copy correction to an existing guidance surface, required by the owner's billing supersession (ANT-162 2010d550) and packet review (80189cce). No new capability, no changed flow, no authority change.
FLOW_PROTOTYPE: PASS: the REAL DomainGuidanceCard in a real browser (harness ?domain= mode) re-driven end-to-end after the copy change — drive-domain.mjs all 12 frames, every honesty assertion green, errors [].
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner reading hosting guidance gets the truthful cost statement: what is free (static-asset requests, storage), what an owner approves BEFORE activation, and that real usage is metered and attributed — never capped and never silently provisioned.
VISUAL_DIRECTION: PASS: no visual change (frames byte-identical — the corrected line is below the pop's fold in every viewport; the cost line's truth is carried by unit pins and the live DOM assertion, not frame pixels).
AUTOMATED_EVIDENCE: PASS: domain-guidance.test.ts 18/18 — the retained cost-line pins (free tier / BEFORE activation / never provisions hosting) PLUS the new supersession pins: "static-asset requests are free and unlimited" present, "metered, not capped" present, "owner-set ceiling" and "ceiling with alerts" ABSENT. DomainGuidanceCard.render tests green (24 total across the two files). The model's purity scan retained (no network surface).
STATIC_EVIDENCE: PASS: scoped ESLint clean on the changed files; the changed source is one exported string constant plus test pins plus the harness vite config (below).
RENDERED_EVIDENCE: PASS: drive-domain.mjs re-run — all 12 frames re-captured (4 viewports × dock closed/open, dark, conflict, Wix swap, keyboard-Enter); byte-identical to the committed set because the corrected line is below the pop's fold in every viewport (precision stated; no false claim that frames show the line).
BEHAVIORAL_EVIDENCE: PASS: a real-browser text assertion on the live card in the harness: the metered line present, "free and unlimited" present, the old "owner-set ceiling" phrasing ABSENT, "never provisions hosting" retained; drive errors []. Harness repair carried in the same head: the studio-mount vite config now pins its postcss plugins to the repo tailwind.config.ts (tailwind's postcss plugin resolves config from process.cwd(); started from the harness directory it silently fell back to a default theme and index.css's @apply border-border failed — the harness now serves identically from any cwd; root vite build of the real app unaffected and verified green).
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser in this environment; the authenticated in-Studio view remains PROOF OWED (the named authenticated-session dependency, unchanged from PR7).
KEYBOARD_FOCUS: PASS: unchanged from PR7 (native details/summary + select; keyboard-Enter leg re-driven green).
ZOOM_REFLOW: PASS: unchanged from PR7; no layout change (one copy line swapped inside an existing section).
REDUCED_MOTION: PASS: no motion; unchanged.
STATE_COVERAGE: PASS: unchanged from PR7 — this correction touches no state logic; the full ladder and overrides keep their unit coverage (18/18).
TRUTHFUL_STATE_LABELS: PASS: the cost line now states exactly what is verified true today — free and unlimited static-asset requests, owner approval BEFORE any billable activation, usage attributed and metered (never a ceiling, per the supersession); nothing claims a spend limit that no longer exists, and nothing claims live hosting.
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project's publish panel (both live views) → "Use my own address" disclosure.
UNVERIFIED: the authenticated in-Studio view (PROOF OWED, unchanged); any real DNS/hosting/provider effect (owner-gated BY DESIGN — WEB-05 stays BLOCKED until the owner's service-enable go; the corrected decision packet is prepared; no monetary ceiling exists).
OWNER_INTENT: the billing supersession (2010d550 — no PAIGE-imposed ceilings; attributed metered usage) and the packet review (80189cce — verified facts, no implied caps) applied to this lane's customer-visible copy.
MUST_NOT_HAPPEN: no claim of an owner-set spend ceiling (superseded); no implied cost where the verified fact is free; no provider/DNS/hosting mutation; no authority change.
MUST_PRESERVE: the PR7 guidance surface's truths (state ladder, provider profiles, mail preservation, owner-gated host path); the pinned test phrases; the harness's real-component structure.
ACCEPTANCE_CRITERIA: an owner reading the host path sees the truthful, current cost statement — free static delivery today, owner approval before anything billable, metered attribution without ceilings.
MOTION_PURPOSE: NONE: no motion.
PROTECTED_SEAMS: NONE_AFFECTED: one copy constant, its test pins, and the harness vite config; no authority, write, provider, or isolation surface touched.
INTERNAL_BUILD_IDENTITY: 5a1268d87732851a485f42d8452b0aed913c40df; deployment=vercel-preview-of-PR; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + assets/exp06-domain-guidance/ (frames re-captured, below-fold precision stated) + the live card text assertion
RELEASE_CHANNEL: preview: ordinary PR preview of the Solo shell; no staged rollout, no external eligibility.
RELEASE_CLASSIFICATION: internal-only: truthful-copy correction within EXP06; not a customer release event.
CUSTOMER_RELEASE_IDENTITY: none: coherent owner-visible EXP06 evaluation has not occurred.
RELEASE_NOTE_REQUIRED: no: correction increment; the owner's one EXP06 evaluation covers it.
RELEASE_TRUTH_BOUNDARY: PARTIAL: copy truth pinned by unit tests and a real-browser DOM assertion on the real component; frames prove the surface unchanged; the authenticated in-Studio view remains PROOF OWED.
RELEASE_RECOVERY: position=forward-fix; reference=revert of this PR restores the prior sentence (no data, migration, or provider change).
SOLO_1536X770_PAIGE_CLOSED: PASS: assets/exp06-domain-guidance/solo-1536x770-paige-closed.png — re-captured on this tree; byte-identical (the corrected line is below the pop's fold; no visible change).
SOLO_1536X770_PAIGE_OPEN: PASS: assets/exp06-domain-guidance/solo-1536x770-paige-open.png — re-captured; pop geometry invariance re-asserted by the drive.
SOLO_1366X768_PAIGE_CLOSED: PASS: assets/exp06-domain-guidance/solo-1366x768-paige-closed.png — re-captured; core truth set green.
SOLO_1366X768_PAIGE_OPEN: PASS: assets/exp06-domain-guidance/solo-1366x768-paige-open.png — re-captured; dock-open invariance green.
SOLO_1024X768_PAIGE_CLOSED: PASS: assets/exp06-domain-guidance/solo-1024x768-paige-closed.png — re-captured.
SOLO_1024X768_PAIGE_OPEN: PASS: assets/exp06-domain-guidance/solo-1024x768-paige-open.png — re-captured.
SOLO_900X1000_PAIGE_CLOSED: PASS: assets/exp06-domain-guidance/solo-900x1000-paige-closed.png — re-captured; single column holds.
SOLO_900X1000_PAIGE_OPEN: PASS: assets/exp06-domain-guidance/solo-900x1000-paige-open.png — re-captured.
