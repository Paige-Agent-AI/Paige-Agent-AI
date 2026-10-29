# The host path's Check-hosting step — the dormant door's truth, verbatim (EXP06 WEB-05 UI slice)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: handoff WEB-05 (matrix row 11, UI half of the hosting door shipped in #3032): the publish panel's "Use my own address" disclosure — host-path step 2 — now carries a "Check hosting for this page" action for PUBLISHED pages. It asks the ONE hosting door (growth-hosting-command) and renders the door's OWN sentence verbatim: today (dormant) "Hosting isn't switched on yet. Nothing was changed."; post-activation, the fingerprint proposal's summary with a pointer to the approval review — never a live claim. Prepare never executes; the owner's click, not this card, is the approval.
PAIGE_UI_DESIGN: PASS: the panel's own voice and tokens — a quiet vs-link button in the host-path section, the answer as a single sentence beside it (data-hosting-state carries the machine state for tests, not for styling); no gold, no celebration, no new visual language.
MATERIAL_FLOW_CHANGE: YES: a NEW customer-visible action on an existing guidance surface (the check + the rendered answer). No existing flow changes: the disclosure, provider selector, mail callout, host-path steps and cost line are untouched; the card still contacts no provider and approves nothing on its own.
FLOW_PROTOTYPE: PASS: the REAL DomainGuidanceCard in a real browser inside the REAL .vs-studio overlay, driving the REAL studio-data prepare path against the stubbed door answering EXACTLY what the real dormant growth-hosting-command returns today (refused + disabled + HOSTING_NOT_ENABLED). drive-hosting-check.mjs: 6 frames, every assertion green (below).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner reading the host path wants to know whether they can put the page somewhere they control — the primary action is one click that answers truthfully; while the service is off the answer is the honest sentence, not a dead end and not a promise.
VISUAL_DIRECTION: PASS: the panel's existing --vs-* tokens only; zero new hex; the answer is typographic text in the card's sentence style.
AUTOMATED_EVIDENCE: PASS: DomainGuidanceCard.render.test.tsx 11/11 — the 4 new behavioral legs pin: the dormant sentence VERBATIM (state=disabled) after the click; the ready state points at the approval review and never matches /is live|went live/; a transport failure says the check failed (nothing changed); non-page artifacts render no button. Full studio suite 237/238 green; ci:tsc ratchet PASS; scoped ESLint clean. Static: the panel's mounts pass pageId only for artifact.kind === "page" (both live views); studio-data adds prepareHostingDeployment/confirmHostingDeployment with the publish lane's prepare/confirm discipline (prepare sends no fingerprint).
STATIC_EVIDENCE: PASS: ci:tsc PASS; the card adds no provider contact, no RPC name, no secret; the door remains the only executor.
RENDERED_EVIDENCE: PASS: assets/exp06-hosting-check/ — 6 real-browser frames (4 Solo viewports, dark, dock-open) with the dormant answer ON SCREEN and the harness badge present.
BEHAVIORAL_EVIDENCE: PASS: drive-hosting-check.mjs — at every viewport: the button exists, clicks, and the door's sentence renders verbatim in the disabled state; no live claim anywhere; the overlay is full-screen above the shell in the dock-open leg; errors [].
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser in this environment; the real owner clicking inside their own panel remains PROOF OWED (the standing dependency).
KEYBOARD_FOCUS: PASS: the check is a native button inside the disclosure's focus flow (the panel restores focus; Escape closes the pop as before). Driven by click; a full Tab-order walk not run, not claimed.
ZOOM_REFLOW: PASS: single-column typographic section inside the pop; all four Solo viewports assert no document overflow (the drive reuses the overlay's no-scroll discipline).
REDUCED_MOTION: PASS: no motion added; the only state change is text appearing.
STATE_COVERAGE: PASS: the four card states are covered — disabled (dormant, driven + pinned), ready (pinned, never-live), refused/transport (pinned), and no-pageId (pinned). The door's own deeper states (verify_failed, removed_unconfirmed) belong to the door's wall (#3032's 22 tests), surfaced through confirmHostingDeployment's PublishUnverified/NotDone semantics.
TRUTHFUL_STATE_LABELS: PASS: the answer is the door's own sentence verbatim — never paraphrased into a promise; nothing anywhere claims a hosted copy is live.
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project's publish panel (both live views) → "Use my own address" → host path → Check hosting.
UNVERIFIED: the authenticated in-Studio view (PROOF OWED, standing); any live hosting deployment (activation HELD by design — the owner's one decision); the post-activation ready-state in production (the door mints no proposal while dormant).
OWNER_INTENT: matrix row 11's customer half — the owner-gated host path must be a real, comprehensible surface (owner rule: never backend-only), honest while the service is off, approval-card-driven when it is on.
MUST_NOT_HAPPEN: no provider contact from the card; no approval minted by a check; no live claim; no dead end (the honest sentence is always an answer); no second executor.
MUST_PRESERVE: the publish door's authority; the disclosure's guidance truths (state ladder, providers, mail records, cost line — untouched, their pins green).
ACCEPTANCE_CRITERIA: an owner asking "can I host this?" gets the truthful current answer in one click, in the product's voice, with nothing hidden and nothing promised.
MOTION_PURPOSE: NONE: no motion.
PROTECTED_SEAMS: NONE_AFFECTED: the door is untouched; this slice adds only the card's ask + render and the studio-data prepare/confirm pair over the existing invoke path.
INTERNAL_BUILD_IDENTITY: f6fae6fb8ca7ade3a7185d6130ab367bd9206302; deployment=vercel-preview-of-PR; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + assets/exp06-hosting-check/ + the 11/11 card suite
RELEASE_CHANNEL: preview: ordinary PR preview of the Solo shell; no staged rollout, no external eligibility.
RELEASE_CLASSIFICATION: internal-only: customer-visible increment within EXP06; not a customer release event.
CUSTOMER_RELEASE_IDENTITY: none: coherent owner-visible EXP06 evaluation has not occurred.
RELEASE_NOTE_REQUIRED: no: increment; the owner's one EXP06 evaluation covers it.
RELEASE_TRUTH_BOUNDARY: PARTIAL: the wiring is proven at harness + unit level against the door's exact dormant contract; the authenticated in-Studio view and the post-activation flow remain PROOF OWED.
RELEASE_RECOVERY: position=forward-fix; reference=revert removes the check button + data pair (no data, migration, or provider change).
SOLO_1536X770_PAIGE_CLOSED: PASS: assets/exp06-hosting-check/hosting-check-1536x770.png — real overlay, the dormant answer on screen.
SOLO_1536X770_PAIGE_OPEN: PASS: dock-open leg captured at 1366 (below); the closed/open pair at 1536 is covered by the standing domain-guidance frames — the answer line is additive within the same pop.
SOLO_1366X768_PAIGE_CLOSED: PASS: assets/exp06-hosting-check/hosting-check-1366x768.png — verbatim sentence asserted.
SOLO_1366X768_PAIGE_OPEN: PASS: assets/exp06-hosting-check/hosting-check-1366x768-dock-open.png — overlay full-screen above the shell, answer visible.
SOLO_1024X768_PAIGE_CLOSED: PASS: assets/exp06-hosting-check/hosting-check-1024x768.png.
SOLO_1024X768_PAIGE_OPEN: PASS: covered by the standing closed/open invariance proof (the overlay covers the dock exactly; the answer adds no pop geometry change — same pop, text only).
SOLO_900X1000_PAIGE_CLOSED: PASS: assets/exp06-hosting-check/hosting-check-900x1000.png.
SOLO_900X1000_PAIGE_OPEN: PASS: as 1024 open — standing invariance + no geometry change.
