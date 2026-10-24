# Live immersive stage (#immersive PR) — the room she stands in, commissioned by the owner

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no step of the disclose→acknowledge→speak journey changed. The owner commissioned a visual upgrade on 2026-10-24 ("improve the 3D animated look and more immersive than it currently looks"); it is delivered entirely inside the existing Live states — the same states, transitions, exits and contracts, now standing in a room instead of on a flat panel.
PAIGE_UI_DESIGN: PASS: 12 rendered frames below; every colour resolves from the existing --primary/--accent/background/card tokens, so both themes stay unmistakably their own room (§23) and the gold budget is untouched (§11 — gold still arrives only with her own speech, now in three agreeing places: rim, halo, presence glow).
MATERIAL_FLOW_CHANGE: NO: visual depth only; no goal, state, transition, exit or consequence moved.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged — a Solo owner discloses→acknowledges→speaks; the upgrade makes the frame they do it in read as a space rather than a form.
VISUAL_DIRECTION: PASS: existing Live design language deepened, not replaced — dust-field parallax, an additive halo behind the body, a slow camera drift, a drifting nebula ground, glass panels with a solid no-blur fallback, a glass state pill, and her light bleeding onto the presence column.
AUTOMATED_EVIDENCE: PASS: vitest Live suite 43/43 and tsc --noEmit clean at the code commit; the capture run asserts per frame that the 3D scene MOUNTED (a canvas inside .paige-presence-3d, never the flat fallback), that the presence region rendered non-flat content, that the #2721 fold contract still holds in the terms state, plus sha256 distinctness and IHDR==viewport.
STATIC_EVIDENCE: PASS: two files changed (PaigePresenceScene.tsx, paige-live-conversation.css); every new scene resource (two dust geometries+materials, halo geometry+material) is disposed on unmount; the loop-throw guard and the wrapper's lost-context/error-boundary degrades cover the new children; no new dependency (§22 — three.js was already on the surface).
RENDERED_EVIDENCE: PASS: 12 IHDR-verified PNG frames — immersive-{1536x770,900x1000}-{dark,light}-{terms,denied,listening}.png — of the REAL component via the synthetic harness (no auth/network/provider/microphone), each state ASSERTED by its own text before capture and each frame guarded as above. Receipt: docs/evidence/experience-01-foundation/live-immersive-stage-2026-10-24/immersive-frames.json. Independent numeric readback: the presence region's distinct 4-bit colours rose 53→80 versus the merged #2710 listening frame — the dust field and halo are measurably present, not asserted into existence.
BEHAVIORAL_EVIDENCE: PASS: every frame driven by a real Playwright click on the real trigger; reduced-motion emulation used throughout, so every capture shows the SETTLED pose (frameloop=demand renders one frame; nebula keyframes disabled) — the honest static floor a motion-sensitive person gets.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated audio session exists; the founder's single evaluation window owns that class, unchanged.
KEYBOARD_FOCUS: PASS: no DOM change in this PR (CSS + scene internals only); the suite-pinned trap and Escape route are untouched.
ZOOM_REFLOW: PASS: 900x1000 frames carry the same assertions; the glass panels keep their existing scroll owners and the fold guard held at the narrow viewport.
REDUCED_MOTION: PASS: the halo settles to its resting dim indigo alongside the body (settled uniforms in the demand frame); the nebula's drift animation is disabled under prefers-reduced-motion; the dust and camera stop ticking when frameloop goes to demand.
STATE_COVERAGE: PASS: terms (disclosure + pinned actions + fold guard), denied (permission refusal), listening (settled ready pose) at both viewports and both themes; denied and listening share the notice scaffold proven in #2721.
TRUTHFUL_STATE_LABELS: PASS: environment motion is ambient and labelled as such in-source (the room does not claim anything was heard); only real analyser energy moves the body and lifts the halo (§13); gold remains exclusively her-own-speech in rim, halo and glow (§11); the settled reduced-motion frames show what a motion-sensitive person actually gets.
SOLO_UI: YES: the Live surface is the one Solo shell surface.
UNVERIFIED: the founder's OWN acknowledgement, microphone and bidirectional audio remain PROOF OWED — FINAL EVALUATION WINDOW; the room is ready for them.

OWNER_INTENT: owner directive 2026-10-24 — "I want to improve the 3D animated look and more immersive than it currently looks" — against the standing 2026-10-19 rule that customer-facing changes must be visibly comprehensible; the immersion is the deliverable, not a by-product.
MUST_NOT_HAPPEN: no motion may claim speech that is not happening (no timer-driven pulse, no idle gold); the flat fallback must not be removed (§58); a WebGL loss must not leave a blank corner (§32); the fixed frame, the fold-pinned consent actions and the no-scrollbar ruling must all survive.
MUST_PRESERVE: the disclose→acknowledge→speak journey, the two-faced refusal, the disclosure copy, the keyboard trap and Escape route, the energy-honesty construction, both themes' distinctness, the lazy three.js load for non-Live users.
ACCEPTANCE_CRITERIA: open Live in each state and see a body standing in a parallax dust field whose halo and glow lift with her real voice and warm only then; panels read as glass over a deep ground; with reduced motion the whole room holds still into a settled frame; without WebGL or on a throw, the flat presence stands in and nothing is blank.
MOTION_PURPOSE: the room's ambient motion (dust drift, camera sway, nebula) communicates that this is a place, not a page — it runs while she is silent and settles entirely under reduced motion; the body's pulse, the halo's rise and the gold rim communicate HER voice, keyed only to real analyser energy, decaying to a dim indigo breath at rest.

## Scope and collisions

- Classification: Solo Live surface — visual immersion upgrade (2 files + this record + frames).
- Affected flows: none structurally; every Live state visually.
- Neighboring regressions: 43/43 suite green; fold guard re-proven; the docked chat panel and its composer are untouched.
- Active-owner/file collisions: stacked directly on fix/live-consent-fold (#2721); merge order is #2721 then this PR.
- Explicit exclusions: no change to consent gating, RPCs, edge functions, transcript behavior, or controls' semantics.

## User job and state map

Unchanged journey; the stage it happens in now has depth: header glass, presence column lit from within, glass workspace floating over a nebula ground, vignette gathering attention toward the conversation, controls as a glass footer.

## Evidence index

- Frames + receipt: docs/evidence/experience-01-foundation/live-immersive-stage-2026-10-24/ (2026-10-24, reduced-motion emulation, synthetic harness localhost:4179, Playwright Chromium, SwiftShader WebGL).
- vitest: `node node_modules/vitest/vitest.mjs run src/components/paige/live` → 2 files, 43/43. tsc: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0.
- Numeric scene-readback: presence-region distinct 4-bit colours 53 (merged #2710 frame) → 80 (this PR); stage corner tint shifts 19,20,27 → 19,20,28 (nebula present but subtle); light-theme corner 247,247,247.
- Baseline records: live-verification-2026-10-24 (#2710) and live-consent-fold-2026-10-24 (#2721).

## Review and limitations

Independent agent review of the code diff (round 1): REQUEST-CHANGES with two P2s and six P3s, all fixed in the follow-up commit:
- P2 (dead code): the speaking under-glow selector `[data-live-state="speaking"] .plc-presence` could never match — the attribute lives ON the section. Fixed to the compound form `.plc-presence[data-live-state="speaking"]`.
- P2 (reduced motion): Dust and CameraDrift ticked on demand-rendered frames with unclamped deltas (verified against installed @react-three/fiber 8.18 — a 30s gap would jump the far cloud ~19deg and snap the camera fully to target). Both now stop cold under reduced motion, same rule as the body.
- P3s: throw-guards + onCrash parity added to both new frame subscribers; unused halo ref removed; halo fragment raised to highp (mediump + long falloff = banding); sticky section-title fade re-opaquened (.94→.88) against the glass beneath; .plc-state added to the forced-colors border list; light-room dust re-derived.
- The light-room dust itself needed a second pass: the first fix (deep normal-blend motes) washed to invisibility on the bright canvas — the capture run's flat-region guard FAILED it objectively (23 distinct sampled bytes < 24) before any human saw it. Corrected to pale-violet normal-blend motes catching the bright ground; the re-run passes with 25-87 variety across frames and the light frames verified visually (orb, displacement, near particles and panels legible; far dust deliberately faint in a bright room).

Review provenance: the reviewer was an independent agent (read-only Explore instance) examining the diff with file:line evidence and the installed three/R3F sources; it is recorded here as agent review, not human approval. Limitations: captures prove the settled (reduced-motion) pose on SwiftShader; the animated pose is source-proven (uniforms fed only by presenceFrame's real energy; integrated rotations that cannot jump); the speaking under-glow is live CSS proven by selector review, not by a speaking frame (no truthful synthetic speaking frame exists — synthesizing one would manufacture the very speech claim this surface forbids). Mobile portrait captures belong to the pass after the founder sees the desktop room. AUTHENTICATED_RUNTIME remains the only unproven class.

INTERNAL_BUILD_IDENTITY: PENDING_SHA; deployment=undeployed (deploys with the next web build); environment=local harness + CI; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + immersive-frames.json
RELEASE_CHANNEL: development: visual upgrade merged through the normal PR gate ahead of the founder evaluation; no rollout concept applies to this pilot surface yet.
RELEASE_CLASSIFICATION: internal-only: pre-evaluation immersion upgrade of the EXP01 Live surface.
CUSTOMER_RELEASE_IDENTITY: none: Solo Live pilot surface, not yet in the founder evaluation window.
RELEASE_NOTE_REQUIRED: no: internal visual upgrade ahead of the single founder evaluation.
RELEASE_TRUTH_BOUNDARY: PARTIAL: rendered+synthetic classes proven (settled pose captured, animated pose source-proven); the founder's own audio window remains theirs.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the PR thread
SOLO_1536X770_PAIGE_CLOSED: PASS: merged #2710 frames live-1536x770-{dark,light}-closed.png — the closed trigger surface is untouched (no DOM change in this PR).
SOLO_1536X770_PAIGE_OPEN: PASS: immersive-1536x770-{dark,light}-{terms,denied,listening}.png — scene-mounted, state-text-asserted, fold guard held in terms.
SOLO_1366X768_PAIGE_CLOSED: PASS: merged #2710 frame live-1366x768-{dark,light}-closed.png (unchanged surface).
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: the stage's grid does not change mechanism between 1366 and the captured 1536/900 widths; the #2710 record set the same coverage rationale.
SOLO_1024X768_PAIGE_CLOSED: PASS: merged #2710 frame live-1024x768-{dark,light}-closed.png (unchanged surface).
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same rationale as 1366x768.
SOLO_900X1000_PAIGE_CLOSED: PASS: merged #2710 frames live-900x1000-{dark,light}-closed.png (unchanged surface).
SOLO_900X1000_PAIGE_OPEN: PASS: immersive-900x1000-{dark,light}-{terms,denied,listening}.png — same guards at the narrow viewport.
