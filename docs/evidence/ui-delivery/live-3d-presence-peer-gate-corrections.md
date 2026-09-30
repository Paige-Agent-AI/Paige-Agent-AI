# What the peer-gate found after the 3D presence merged

Existing Project / R3 Deep. PR [#1440](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/1440)
merged with an honest headline — *"nobody has seen this render"* — and that is exactly the gap an
independent adversarial read of the pushed diff was for. It returned 17 findings after the merge.
These are the ones that were real, each verified against the source before being acted on.

## The one that mattered most, and why nothing could have caught it

`.plc-presence` is a two-column grid whose left track is `minmax(0,.8fr)`, and
`paige-live-conversation.css` granted `grid-column: 1 / -1` to `.plc-presence > .paige-presence`.
When the 3D wrapper replaced the flat presence as the mounted component it stopped matching that
rule — its root class is `.paige-presence-3d` — and was auto-placed into the narrow track. Paige
rendered at roughly 61% of her size, off-axis from the "Listening" label directly beneath her, which
still spanned the full column. The no-WebGL path returns the bare flat presence and DID match, so a
device without WebGL got the correct design and a device with it got the broken one, while the
stylesheet's own comment claimed the two frames were interchangeable.

jsdom computes no layout, the headless smoke never mounts React, and `tsc` cannot read CSS. Every
proof in that PR was structurally blind to it, which is the argument for the read that found it.

## The rest

- **A throw inside `useFrame` escaped the error boundary entirely.** R3F calls frame subscribers from inside a `requestAnimationFrame` callback with no try/catch, and React boundaries catch render and lifecycle errors only — so an exception would have repeated ~60×/s forever, frozen the canvas on its last painted frame, and never printed the one console line the whole degrade contract rests on. Now caught in the loop, logged once, and the scene stands down to the flat presence.
- **`acceptTerms` had no `catch`.** `acceptPaigeLiveTerms` dynamically imports the Supabase client, and a hashed chunk goes stale the moment a deploy lands under an open tab — routine, shipping straight to main. The button flipped back from "Turning on Live…" with no message: a press that does nothing and says nothing, which is the failure this control exists to remove.
- **A stale refusal code left the audio-consent panel under unrelated failures.** `reason` was written on every refusal and cleared in one place, so after the first "not open yet" a later dropped socket or expired session still rendered the retention consent panel — inviting someone to accept provider retention to fix a network error.
- **A lost WebGL context does not throw.** Browsers cap live contexts and evict the oldest by firing `webglcontextlost`; with no listener the canvas simply blanks, the boundary never fires and nothing is logged. That is the empty corner with no signal the component exists to make impossible. Now listened for.
- **A fifth copy of `supportsWebGL`,** weaker than `src/lib/webgl.ts` (no `webgl2` probe, no `document` guard) — in a file whose own header records catching the fourth. Replaced with the shared one.
- **The halo teleported.** Its rotation was an absolute angle from elapsed time multiplied by a rate that changed with state, so leaving `thinking` at ten seconds moved it 4.3 radians backwards in one frame. Now integrated from `delta`, and stopped outright in settled states, because a ring turning under "the live connection ended" reads as work that is not happening.
- **Reduced motion toggled on mid-session froze her at an arbitrary pose** rather than settling into the designed portrait, because the constant props R3F had already applied were never re-applied. Now set explicitly and repainted.
- **The floor was the one hardcoded colour** — a 45%-opaque near-black ellipse with no light variant, in a rule whose comment claimed depth does not come from darkening. Now derived from the foreground token.
- **A mutating button label sat inside a `role="status"` live region,** so pressing it re-announced ~90 words of terms on top of the separate polite announcement the same action already makes. The live region is now scoped to the availability line.
- **The smoke asserted against a hand-copy of the scene's constants** behind a "keep in sync" comment. It now reads them back out of the component and fails if they diverge — mutation-checked.
- **One assertion could never fail:** `expect(getUserMedia).not.toHaveBeenCalled()`, where nothing in `src/` calls `getUserMedia` outside tests and the relay is mocked. Replaced with assertions that can.
- **A test name claimed more than it proved.** The scene's drift and turn ARE timers and do move in silence — inherited verbatim from the owner-approved flat presence, where that is identity rather than a claim about hearing. Renamed to what it actually proves: no audio-derived cue moves without audio.

Two findings were checked and are not defects: the per-mount material IS disposed (the reviewer read
a pre-push revision), and the Suspense-fallback geometry is sound.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing Project / R3 Deep; corrective pass over the flow shipped in #1440, driven by an independent §39 adversarial read of the pushed diff
PAIGE_UI_DESIGN: PASS: no new surface or control; the layout fix restores the approved geometry and the live-region fix scopes an existing one
MATERIAL_FLOW_CHANGE: NO: no goal, step, state, exit or consequence changes; a control that could fail silently now reports, and a panel that could appear over the wrong failure no longer does
FLOW_PROTOTYPE: NOT_REQUIRED: corrections to a shipped flow, restoring the approved layout rather than designing anything
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged from #1440 — a Solo operator turns Live on and talks to Paige about their own book
VISUAL_DIRECTION: PASS: the layout regression is reverted to the approved full-column placement and the one hardcoded colour is now a token; Impeccable detector clean
AUTOMATED_EVIDENCE: PASS: 88 tests across the Live surfaces, including two new ones driving the thrown-failure and stale-refusal paths, each mutation-checked against its own fix (removing the catch's message breaks the first and only the first; removing all nine refusal clears breaks the second and only the second). The smoke's new drift guard is mutation-checked too: changing the scene's framing height to 2.6 turns it red
STATIC_EVIDENCE: PASS: tsc ratchet clean (baseline 12, current 12); ESLint clean across src/components/paige/live; build green; Impeccable detector exit 0 on all five files
RENDERED_EVIDENCE: UNVERIFIED: still no browser in this session. The layout fix is a CSS selector restored to the rule the approved design already had, verified by reading the grid definition; it has not been seen
BEHAVIORAL_EVIDENCE: PASS: both new failure paths are driven in a real DOM and both mutation-checked
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive of the deployed surface (§32)
KEYBOARD_FOCUS: PASS: no control added or moved; the focus trap query is unchanged
ZOOM_REFLOW: UNVERIFIED: no fresh capture; the fix restores the width behaviour the approved design had rather than introducing new geometry
REDUCED_MOTION: PASS: mid-session activation now settles the figure into the designed portrait and repaints it, instead of stopping the loop wherever it was
STATE_COVERAGE: PASS: loop throw, lost context, thrown acceptance, stale refusal followed by a different failure, reduced motion at mount and mid-session, and settled states are each handled
TRUTHFUL_STATE_LABELS: PASS: the corrected test name claims only what it proves, and the new failure copy says nothing was recorded, sent or saved because nothing was
SOLO_UI: YES: the Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session
UNVERIFIED: every rendered claim. The layout regression was found by reading a stylesheet, and its fix is verified the same way; nobody has seen either state. Also still owed: the three fallback paths (streaming, boundary throw, lost context) have no executed test, because jsdom reports no WebGL and every Live test takes the early return before those components mount — that is a real coverage gap this pass did not close

OWNER_INTENT: The 3D Paige and the acceptance control work as described rather than as intended
MUST_NOT_HAPPEN: Paige rendering at the wrong size or off-axis; a frozen canvas with no log; a control that fails silently; the consent panel appearing over a failure it cannot fix; a blank corner on a lost context
MUST_PRESERVE: Everything #1439 and #1440 shipped — the tier gate, the acceptance flow, the flat presence as fallback, the stage's layout, focus trap and honest unavailable state
ACCEPTANCE_CRITERIA: Paige renders full-column at the approved size on every desktop viewport; a loop throw or lost context stands the flat presence back up and says so in the console; a thrown acceptance tells the person; and the consent panel appears only for the refusal it can actually resolve
MOTION_PURPOSE: The halo now integrates from delta so it never jumps between states, and stops entirely when the session is settled — motion that would otherwise imply work that is not happening. Reduced motion settles into the designed portrait rather than freezing mid-pose
PROTECTED_SEAMS: Affected and tested: the Live stage's refusal states, the acceptance seam, the presence fallback chain. Unchanged: Live admission, rollout authority, the three admission edge contracts, relay transport, thread and transcript behaviour, account isolation
INTERNAL_BUILD_IDENTITY: pr=PENDING; base=2b75afdd5a273e42b0b791b10cd1676901304314; deployment=vercel-preview(live-3d-peer-gate-corrections); environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=src/components/paige/live/PaigeLiveConversation.test.tsx
RELEASE_CHANNEL: preview: the PR preview build only; no migration and no edge change
RELEASE_CLASSIFICATION: internal-only: corrections to a surface whose rollout remains shut
CUSTOMER_RELEASE_IDENTITY: none: the rollout is still closed, so nothing customer-visible changes
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the behavioural corrections are driven and mutation-checked; the layout fix and the rendered result remain PROOF OWED
RELEASE_RECOVERY: position=revert this commit, which returns to the state merged in #1440 including its layout regression, so forward-fix is strongly preferred over rollback here; reference=the finding list at the head of this record

## Evidence index

- `npx vitest run src/components/paige/live src/lib/paigeLiveConversation` — 9 files, 88 tests, all passing.
- Mutation checks: removing the catch's explanation breaks the thrown-failure test and only that one; removing all nine refusal clears breaks the stale-refusal test and only that one; changing the scene's framing height to 2.6 turns the smoke's drift guard red.
- `npm run smoke:paige-presence-3d`, `smoke:live-relay`, `smoke:live-ticket`, `smoke:live-relay-bridge` — all passing.
- `npm run ci:tsc`, ESLint, `npm run build`, Impeccable detector — all clean.

## Review and limitations

The layout regression is the finding worth dwelling on: it shipped through a full CI run, a
compliance pass and a merge, because every automated proof in that PR was blind to layout by
construction. The corrections here are verified the same way the defect was found — by reading the
source — and the rendered result is still owed to a live look.
