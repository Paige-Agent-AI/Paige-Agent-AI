# The presence is a pulsing 3D orb, and the console stops scrolling

Existing Project / R3 Deep. Three defects the owner found within minutes of opening the Live surface
on production, plus one this work caught on the way past.

## The figure was wrong, and it was wrong because nobody looked

[#1440](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/1440) shipped a sculpted humanoid GLB
carrying the honest headline *"nobody has seen this render"*. Writing that sentence is not the same as
discharging it. What reached the owner's screen was an unlit brown mannequin standing in a void, and
the owed visual check became his problem — the §32 failure mode in its exact shape.

It is replaced, not retextured (§30). The loader, the model, the normalisation pass and the lighting
rig are gone from the file, and the smoke asserts their absence rather than trusting it.

## What replaces it took three rejected attempts to find

Recorded because the path is the evidence. **Hairline strands** were rejected as a bleep — a stroke
has no mass. **A filled waveform ribbon** was rejected as a streaming audio meter — a form travelling
left to right is a level display, not someone speaking. What the owner asked for, and what ships, is
an **isolated orb in real 3D that pulses as a whole object** while its surface carries the wave.

The motion is deliberately two things at once. The BODY pulses: the entire radius swells and settles
with her amplitude, which is the beat. The SURFACE waves: travelling bands run across it, with fine
chop added on bright consonants so a consonant reads differently from a vowel. A body that only
pulsed would be a throbbing ball; a surface that only rippled would be a textured sphere sitting
still. The shading normal is recomputed from the displaced neighbours rather than inherited from the
undeformed sphere, so light travels across the real shape — that, plus a perspective camera, is what
makes it read as an object instead of a lit disc.

The platform's other orbs are explicitly NOT referenced: not the flat presence's lobe silhouette, not
the landing hero, not the studio field.

**Calm while she is being spoken to.** `presenceFrame` reports energy for listening as well as
speaking, which is right for a generic presence and wrong for this one: when someone interrupts her
she is receiving, so the body settles and the gold drains out. The gate lives in presentation and can
only ever REMOVE motion, never manufacture it, so the honesty contract is untouched.

**Working and thinking are visible states.** They were indistinguishable from idle in the first
build, because `presenceFrame`'s busy cadence feeds fields the presence does not read. Each now
carries its own steady ripple at its own amplitude — not an audio cue and making no claim about
hearing, driven by the job state the product already resolves.

**The controls show their own state.** A footer of five identical outline buttons could not tell
anyone they were muted, that the session was held, or that Paige was talking. Engaged toggles carry
indigo because that is state; Interrupt carries gold, and only while she is actually speaking, so the
body turning gold and the control that stops her are one signal in two places rather than two accents
competing (§11).

## The stage never scrolls

`.plc-stage__main` was `overflow: auto`. That produced the page scrollbar the owner reported and pushed
the consent panel down behind the footer where it could not be reached. Every region now owns its own
overflow and the stage owns none; the bar itself is removed, and the transcript already auto-follows
the newest turn, so scrolling was never something a person had to do. The phone breakpoint had set the
inner regions to `overflow: visible` and relied on that page scroll — left alone it would have clipped
the transcript and the controls unreachably, so both rows are now bounded and scroll internally.

## The consent button was dead to a human

On refusal the handler set the explanation to the byte-for-byte sentence already on screen and left the
panel and the button exactly as they were. Pressing it changed nothing visible, and the suite passed
the entire time — §70 in its purest form: the code path ran and a person could not tell. It now draws
the refusal as an outcome and stops offering a control that has already proven it cannot succeed. The
rollout is shut platform-wide (`pilot_enabled=false`, `pilot_rollout_scope='off'`, queried on prod), so
the person's consent was never what was missing.

## Caught while wiring the shader

The rim colour was read from `--ring`, which resolves to a pale gold (`41 100% 91%`) on the dark theme.
That would have made the wave gold while nothing was being said — gold spent on idling, the one thing
§11 forbids. It reads `--primary` now.

## What the rewritten smoke is for

A uniform the GLSL reads and the JavaScript never supplies does not throw. It is silently zero, and the
wave renders as an invisible flat line indistinguishable from "Paige isn't talking". No type checker
catches it, because the shader is a string. The smoke cross-checks uniforms in both directions, links
varyings across stages, proves both previous designs are stripped, and pins the calm-while-listening
gate. It earned itself immediately: it caught a backtick inside a GLSL doc comment that terminated the
template literal — a build break, found before CI.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing Project / R3 Deep; affected flow is the Solo operator opening Live Conversation and either speaking with Paige or being told honestly that Live is not open, with the presence, the scroll owner and the consent exit all changing
PAIGE_UI_DESIGN: PASS: router read at .claude/skills/paige-ui-design, then the Impeccable skill and reference/craft-floor.md read immediately before the first pixel edit; the craft floor's browser-surfaces rule is what decided the scrollbar treatment
MATERIAL_FLOW_CHANGE: YES: the consent exit changed — a refusal now terminates the offer instead of re-presenting it, and the presence and scroll owner of the whole stage are replaced
FLOW_PROTOTYPE: PASS: interactive prototype at https://claude.ai/artifact/BjEKooqqvuJv81Btmiv288 running the exact shipped shader with a driver for idle, her speaking, being spoken to, and thinking; published to the owner for approval before merge, and this PR is held as a draft until he rules
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo operator talks to Paige about their own book; the primary action is speaking, and when that is unavailable the surface says so without asking for anything it cannot use
VISUAL_DIRECTION: PASS: indigo ground with gold reserved for her own speech, both read from live design tokens at mount so the two themes genuinely differ (§23); the `--ring` to `--primary` correction is what keeps gold off the resting state (§11)
AUTOMATED_EVIDENCE: PASS: 88/88 tests across the Live surfaces and the presence library; the refusal test now asserts the outcome is drawn and the unusable control is gone, and fails if either regresses. Presence smoke green, including the uniform cross-check, the strip-proof and the listening-calm guard. ci:regression green
STATIC_EVIDENCE: PASS: tsc ratchet clean (baseline 12, current 12); ESLint clean across src/components/paige/live and the smoke script; production build green; lint:migration-versions clean. lint:gold and lint:impeccable fail on clean main in files this branch does not touch, verified by stashing — pre-existing, not ported
RENDERED_EVIDENCE: UNVERIFIED: the product console has not been rendered at any viewport, because this session has no browser. The wave itself IS rendered and drivable at https://claude.ai/artifact/BjEKooqqvuJv81Btmiv288, running the same GLSL that ships against a synthesised voice envelope, but that prototype is not the product surface and is not offered as a substitute for it
BEHAVIORAL_EVIDENCE: PASS: the refusal path is driven in a real DOM and asserts both that the blocked message appears and that no button remains; the wave's four states are driven by hand in the prototype
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive of the deployed surface; this session has no browser (§32). Affected claims: the console's fit at real viewports, the absence of the page scrollbar in the product shell, and the wave's appearance inside the product rather than the prototype
KEYBOARD_FOCUS: PASS: no control added or moved; the consent button is removed on refusal, which shortens the tab order rather than trapping it, and the focus trap query is unchanged
ZOOM_REFLOW: UNVERIFIED: no fresh capture. The stage is now a bounded three-row grid whose regions each scroll internally, which is strictly more reflow-tolerant than the page-scrolling version it replaces, but that has not been observed
REDUCED_MOTION: PASS: the canvas drops to `demand`, the uniforms are put in their resting pose by hand and one frame is requested, so the wave settles to a still line rather than vanishing or freezing mid-deformation
STATE_COVERAGE: PASS: idle, listening, her speaking, thinking, working, held, interrupted, disconnected and unavailable all resolve; plus loop throw, lost WebGL context, absent WebGL, thrown acceptance and refused acceptance
TRUTHFUL_STATE_LABELS: PASS: the refusal copy says nothing was recorded, sent or saved because nothing was, and it now names the real blocker — the rollout is not open — instead of implying the person's acceptance was the missing piece
SOLO_UI: YES: the Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session
UNVERIFIED: the product console has not been seen at any viewport, so the scroll fix and the wave's placement inside the real shell are both owed to a session with a browser or to the owner's live look. The prototype proves the shader and the interaction model, not the surface that hosts them. Also owed and not closed here: the fallback chain (streaming, boundary throw, lost context) still has no executed test, because jsdom reports no WebGL and every Live test takes the early return before those components mount

OWNER_INTENT: Replace the rejected humanoid with something representing Paige talking — a wave that pulses with her real voice and moves with her expressions, calm while she is being interrupted — and remove every scrollbar from the live screen
MUST_NOT_HAPPEN: The wave must not move when nothing was said; gold must not appear while she is silent or listening; the stage must not scroll; the consent panel must not be clipped or unreachable; a control must not accept a press and show nothing
MUST_PRESERVE: The tier admission gate, the acceptance seam and its database authority, the flat presence as the no-WebGL and crash fallback, the thread and transcript behaviour, the focus trap, the honest unavailable state, and account isolation
ACCEPTANCE_CRITERIA: On the real platform a Solo operator opens Live and sees a wave that is still while silent, lifts only when Paige speaks, and settles below rest while he speaks; no scrollbar appears anywhere on the stage at any supported viewport; and pressing the consent control produces a visible outcome rather than nothing
MOTION_PURPOSE: The wave communicates who is speaking and how — amplitude for loudness, spectral brightness for the character of the sound — so the surface shows her talking rather than announcing it. Reduced motion settles it to a still line and stops the loop, retaining the presence without the animation
PROTECTED_SEAMS: Affected and tested: the Live stage refusal states, the acceptance seam, the presence fallback chain, the stage's scroll ownership. Named and unaffected: Live admission authority, the rollout scope and its operator control, the three admission edge contracts, relay transport, thread and transcript persistence, tenant isolation
INTERNAL_BUILD_IDENTITY: pr=1443; base=328e585a37e1cbd6c6e1c135c91ac535bdf8ea11; deployment=vercel-preview(live-presence-is-her-voice); environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/paige-presence-3d-smoke.mjs and src/components/paige/live/PaigeLiveConversation.test.tsx
RELEASE_CHANNEL: preview: the PR preview build only; no migration and no edge change, and the PR is held as a draft awaiting the owner's ruling on the prototype
RELEASE_CLASSIFICATION: internal-only: a surface whose rollout remains shut, so no customer can reach the changed behaviour
CUSTOMER_RELEASE_IDENTITY: none: the rollout is still closed, so nothing customer-visible changes
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the shader, the consent outcome and the calm-while-listening rule are driven and asserted; the console's rendered fit and the absence of the scrollbar in the product shell are PROOF OWED
RELEASE_RECOVERY: position=forward-fix; reference=this record plus the prototype linked under FLOW_PROTOTYPE, noting that reverting restores the rejected humanoid, the page scrollbar and the silently-dead consent button

## Scope and collisions

- Classification: Existing Project / R3 Deep — a visible surface with a shader, a layout model and a consent exit all changing.
- Affected flows: Solo operator opens Live Conversation; Solo operator is refused Live and is told why.
- Neighboring regressions: the phone breakpoint depended on the page scroll this change removes and was rebuilt in the same commit rather than left to fail.
- Active-owner/file collisions: none; `main` at `328e585` carries this session's four previous merges and no other author touched these files.
- Explicit exclusions: the rollout remains shut and is not opened here; distinguishing the refusal codes server-side (so the consent panel never appears when consent cannot help) is named as follow-up rather than done.

## User job and state map

A Solo operator wants to talk to Paige about their own book. The stage is a fixed frame: header, a
stage column carrying the wave and the status, a transcript rail, and a control footer. The stage owns
no scroll; the transcript and the two panels each own their own and show no bar. States: idle, her
speaking, being spoken to, thinking, working, held, interrupted, disconnected, unavailable — plus the
degrade chain when WebGL is absent, the context is lost, or the loop throws, each of which logs and
then shows the flat presence rather than a blank.

## Evidence index

- `node scripts/paige-presence-3d-smoke.mjs` — green; uniform cross-check both directions, varying link check, §30 strip proof, listening-calm guard, geometry build, 1566-vertex budget.
- `npx vitest run src/components/paige/live src/lib/paigeLiveConversation` — 9 files, 88 tests, all passing.
- `npm run ci:tsc` — baseline 12, current 12.
- `npm run build` — green.
- `npm run ci:regression` — green.
- Prod state read for the refusal claim: `paige_voice_readiness` → `pilot_enabled=false`, `pilot_rollout_scope='off'`; `paige_live_tenant_availability` → 0 enabled, 0 suppressed; 10 Solo-class tenants.
- Prototype: https://claude.ai/artifact/BjEKooqqvuJv81Btmiv288

## Review and limitations

The build-breaking backtick inside the GLSL doc comment was caught by the smoke written in this same
change, not by a type checker, and not by review. The `--ring` gold-at-rest defect was caught by
reading the token file rather than by any gate. Both are recorded because they argue for the smoke and
against trusting that a shader compiles because the file does.

Limitations: nobody has seen the product console. The prototype proves the shader and the interaction
model; it does not prove the surface that hosts them, and it cannot, because it is not that surface.
