# UI delivery evidence: tool-step lifecycle on every chat client (conversational loop C2a)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: docs/delivery/paige-conversational-loop-c2.md — flows traced for the main chat, portal chat, Studio and Operator (a step that starts and closes, a step that is withdrawn, a read that ends with a step still open, a superseded request), plus a grounding packet with file:line citations for the C2b server half.
PAIGE_UI_DESIGN: PASS: the paige-ui-design router, .agents/skills/paige-ui-design/SKILL.md with references/paige-quality-gates.md and references/review-and-testing.md, and .agents/skills/impeccable/SKILL.md were read; the only new visual is the Studio running glyph, which reuses the Studio's own --vs-link token and the main trace's existing spinner/still-ring pattern; npx impeccable@4.1.0 detect on the touched UI files reported no findings.
MATERIAL_FLOW_CHANGE: NO: no goal, choice, confirmation or exit changes. Clients learn to render a step that opens as running and closes on the same id; the server does not send running until C2b, so today's frames (done/error, or no status) render exactly as before, except the Studio list now upserts by id instead of keeping the first frame (a deliberate, declared pin change).
FLOW_PROTOTYPE: NOT_REQUIRED: no flow change — the step list gains an in-progress state for a row it already shows; the living-turn UI that changes the flow is C3, which keeps its prototype and owner-frame gate.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: purpose — the owner sees which tool PAIGE is running right now and sees it settle; audience — every tenant seat using PAIGE chat or Studio; primary action unchanged (send a message, read the reply).
VISUAL_DIRECTION: PASS: the existing restrained step list; a running row shows the Studio's light lavender --vs-link spinner (measured rgb(185,168,255)) (a still ring under reduced motion) where the green check will appear, and closes in place.
AUTOMATED_EVIDENCE: PASS: client suites (PaigeStepTrace, PaigeAIChat*, PaigeChat*, src/solo/studio, src/lib/paige-stream incl. step-status, reducer) green; client-memory-authz 559/0 (36.11c-e replay fix, 36.8b/36.8c streamed-equals-saved rule); knowledge-scope 419/0 (29.13); mutation proofs for every fix in the PR.
STATIC_EVIDENCE: PASS: ci:tsc 10 at baseline 10; eslint 0 errors (warnings unchanged per file vs base); deno check paige-ai-chat 11 errors, same codes as base; capability-declaration and chat-tool-registry lints pass.
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/studio-steps-running.png, docs/evidence/ui-delivery/assets/c2a-step-lifecycle/studio-steps-done.png and docs/evidence/ui-delivery/assets/c2a-step-lifecycle/studio-steps-reduced-motion-running.png (1366x768: a running row with the light lavender spinner closes in place to a green check with its detail; under reduced motion a still ring), plus the Solo matrix docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-*-paige-*.png at 1536x770, 1366x768, 1024x768 and 900x1000 with PAIGE closed and open (docOverflowX 0 and the running row on screen in all eight). All from the real StudioSession in the studio-mount structural harness via scripts/live-drive/harness/studio-mount/drive-step-lifecycle.mjs; Studio is dark-only; each frame carries a 'harness render · not live' badge.
BEHAVIORAL_EVIDENCE: PASS: stream tests drive each consumer with running then done, running then withdrawn, a running row never closed, an abort, a failed read and a superseded request; the strip and Studio list settle in every case.
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session in this lane, and the server does not emit running until C2b; owed after C2b deploys: an owner turn in main chat and Studio showing a tool row start and settle.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive element added; the running glyph carries role=img with the label 'Working on it'.
ZOOM_REFLOW: NOT_APPLICABLE: no layout changes.
REDUCED_MOTION: PASS: under prefers-reduced-motion: reduce the running row shows a still ring and no animation (frame studio-steps-reduced-motion-running.png; computed animation none).
STATE_COVERAGE: PASS: running, done, error, withdrawn, missing status, unrecognised status, a read ending with a row open, abort, failed read and a superseded request — each pinned.
TRUTHFUL_STATE_LABELS: PASS: an unrecognised status is never drawn as done (no default check); a row that never closed is removed rather than shown as finished; only done/error persist in the saved trace.
SOLO_UI: YES: the Studio 'What Paige did' step list (StudioSession, useStudioChat, StudioStage) gains a running state; layout and geometry are unchanged.
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-1536x770-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors.
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-1536x770-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-1366x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors.
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-1366x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-1024x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors.
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-1024x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-900x1000-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors. The chat is a drawer at this width and was opened.
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/c2a-step-lifecycle/solo-900x1000-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"), mid-turn with the step running: docOverflowX 0, the running row fully on screen, no page errors. The chat is a drawer at this width and was opened. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
UNVERIFIED: the authenticated drive after C2b (the server is what makes rows run), and a second known-good tenant context (the harness renders one fixture workspace; the step list carries no tenant-specific data); every other claim above is proven by the recorded suites and harness frames.
OWNER_INTENT: owner response after C1 (2026-10-04): add truthful tool/action START + FINISH semantics, keep the low-level lifecycle in the expandable 'What PAIGE did' trace, narrate only when useful; and fix the continuation-budget replay gap before C3 so the saved turn and the visible completed turn converge.
MUST_NOT_HAPPEN: no row ever stuck on running; no unknown status drawn as done; no prose per tool start; no change to how today's done/error frames render on the main chat, portal or Operator; the streamed answer never differs from the saved text.
MUST_PRESERVE: the step list layout and glyphs for finished steps, every card and approval path, the saved-thread semantics, and the other consumers' behaviour on today's frames.
ACCEPTANCE_CRITERIA: after C2b, an owner sees a tool row appear as running and settle in place to done or error, or disappear if withdrawn; no spinner survives the end of a turn; a turn that runs out of continuation budget shows and saves exactly the same sentence.
MOTION_PURPOSE: the running spinner communicates 'this tool is executing now'; under reduced motion it becomes a still ring.
PROTECTED_SEAMS: the chat SSE contract (paige_step only, no new key), bundle_ref.turn_trace (outcomes only), the exhausted-budget branch (tested), the other consumers (suites green); NONE_AFFECTED otherwise.
INTERNAL_BUILD_IDENTITY: base 184cd4af418ed46919bba78c95cce5dd8b2be923 (main when this PR was opened; the C2a commits sit directly on it, and the exact reviewed head is the PR head recorded in its merge); deployment=none-pre-merge; environment=local development candidate; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat changes and CI deploys it on merge); evidence=this record and PR #1719
RELEASE_CHANNEL: development: pre-merge candidate; production via merge to main per the pre-launch stance.
RELEASE_CLASSIFICATION: internal-only: client lifecycle readiness with no behaviour change on today's frames, plus a server truthfulness fix.
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change.
RELEASE_NOTE_REQUIRED: no: nothing visible changes.
RELEASE_TRUTH_BOUNDARY: PARTIAL: lifecycle rendering is proven by tests and harness frames; the replay fix is proven by both harnesses; the authenticated drive is PROOF OWED after C2b.
RELEASE_RECOVERY: position=forward-fix or revert the squash, after which CI redeploys paige-ai-chat, with no data conversion; reference=docs/delivery/paige-conversational-loop-c2.md

## Scope and collisions

- Classification: client lifecycle readiness + a server truthfulness fix.
- Affected flows: tool steps in main chat, portal chat and Studio; the continuation-budget exhausted turn.
- Neighboring regressions: Operator chat (ignores steps, unchanged); every card and approval path (suites green).
- Active-owner/file collisions: none.
- Explicit exclusions: the server emitting running (C2b); the living-turn UI (C3).

## User job and state map

While PAIGE works, the owner can see which tool is running and watch it settle; nothing about sending or reading changes.

## Evidence index

See AUTOMATED_EVIDENCE, RENDERED_EVIDENCE and docs/delivery/paige-conversational-loop-c2.md.

## Review and limitations

Independent adversarial verifier (SHIP) and compliance/design officer; a fix round closed their findings (one home for status rules, two test gaps, id collision, reduced-motion glyph, rendered frames) and a second verifier pass returned SHIP. Authenticated runtime is UNVERIFIED until C2b.
