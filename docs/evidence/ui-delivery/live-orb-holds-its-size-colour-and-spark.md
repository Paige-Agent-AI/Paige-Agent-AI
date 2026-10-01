# The orb holds its size, gains colour, and sparks on her stresses

Existing Project / R2 Standard. A follow-up to [#1443](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/1443),
driven entirely by the owner's first look at the live surface.

## What he reported, and what it actually was

He said the connection kept "failing": the surface looked right on one load and wrong on the next,
and hitting **Retry setup check** brought the good version back.

It was not a connection fault. The good frame was the transient `Checking availability` state —
before the availability call returns and before any notice is on screen. The bad frame was the
settled state, where `UNAVAILABLE` is the correct and honest answer, because the rollout is still
shut (`pilot_enabled = false`, `pilot_rollout_scope = 'off'`). He was comparing a loading frame
against a resolved one, and retry simply put the loading frame back for a moment.

## The real defect the comparison exposed

`.plc-presence` row 4 was `minmax(0,auto)`, so the roughly 500px consent notice took its full
**content** height and the orb's row — the `1fr` above it — received only what was left. The presence
collapsed to a dot precisely when Live reported unavailable, which is the state a person spends the
most time looking at while the rollout stays shut.

The orb does not shrink to make room for a notice. Both rows are fractions now
(`minmax(9rem,1.15fr)` and `minmax(0,.85fr)`), so the presence keeps a floor it cannot fall below and
the notice scrolls inside its own share. The body also fills more of the frame (fit divisor 2.65 to
2.25).

## The two things he asked for

**More colour.** The body travels from the deep core toward a lighter violet as it turns into the
light, rather than being one tint at two brightnesses. Derived from the same `--primary` token rather
than a second hardcoded hue, so both themes stay coherent and the gold budget is untouched.

**The spark.** On a peak in her voice the crests riding highest catch a brief highlight that decays
fast. It is keyed to the RISE in amplitude rather than its level: a flash on loudness alone would
glow steadily through a long vowel, while a flash on the rise fires on the stresses in a sentence. It
cannot fire on silence, because the amplitude it reads is zero unless she is the one speaking — so
the honesty contract is unchanged.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing Project / R2 Standard; the affected flow is unchanged — a Solo operator opens Live Conversation and is either heard or told honestly that Live is not open. This corrects how that flow LOOKS in its settled state, which is where the owner spends his time today
PAIGE_UI_DESIGN: PASS: router at .claude/skills/paige-ui-design read earlier this session, with the Impeccable craft floor re-read before this edit; no new surface or control is introduced
MATERIAL_FLOW_CHANGE: NO: no goal, step, state, exit or consequence changes; a presence that collapsed under a notice now holds its size, and two visual qualities were added to an existing state
FLOW_PROTOTYPE: NOT_REQUIRED: a correction to the flow shipped in #1443, restoring the proportion the owner already green-lit rather than designing anything new. The interactive prototype was nonetheless updated and published so he could judge it before merge
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged — a Solo operator talks to Paige about their own book; when that is unavailable the surface says so without shrinking the presence to a dot
VISUAL_DIRECTION: PASS: indigo body travelling toward a lighter violet in the light, gold still reserved entirely for her own speech; both colours derived from live tokens at mount so the two themes genuinely differ (§23), and the spark reuses the same two rather than introducing a third hue (§11)
AUTOMATED_EVIDENCE: PASS: 88/88 tests across the Live surfaces and the presence library; presence smoke green, including the uniform cross-check that proves `uFlash` and `uGlow` are both supplied rather than silently zero — the exact failure mode a shader has and a type checker cannot see
STATIC_EVIDENCE: PASS: tsc ratchet clean (baseline 12, current 12); ESLint clean across src/components/paige/live; production build green
RENDERED_EVIDENCE: UNVERIFIED: the product console has not been rendered at any viewport, because this session has no browser. The orb IS rendered and drivable at https://claude.ai/artifact/BjEKooqqvuJv81Btmiv288 running the same GLSL that ships, but that prototype is not the product surface and is not offered as a substitute for it
BEHAVIORAL_EVIDENCE: PASS: the five presence states are driven by hand in the prototype, including the spark firing on amplitude rises and staying dark through silence
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive of the deployed surface (§32). Affected claims: that the orb holds its size beside the real consent notice at real viewports, and that the added colour and spark read as intended in the product shell
KEYBOARD_FOCUS: PASS: no control added, removed or moved; the focus trap and tab order are untouched
ZOOM_REFLOW: UNVERIFIED: no fresh capture. The change makes the stage strictly MORE reflow-tolerant — the notice can no longer take unbounded height — but that has not been observed
REDUCED_MOTION: PASS: the reduced-motion settle zeroes the new flash uniform along with the rest, so the body rests without a highlight rather than freezing mid-spark
STATE_COVERAGE: PASS: idle, listening, speaking, thinking, working, held, interrupted, disconnected and unavailable all resolve; the collapse this fixes occurred specifically in the unavailable state
TRUTHFUL_STATE_LABELS: PASS: unchanged copy. The spark cannot fire without a real amplitude rise from her own output, so no visual implies audio that did not happen
SOLO_UI: YES: the Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session
UNVERIFIED: the rendered result in the product. The grid change is verified by reading the computed track definition and by the prototype, not by seeing the real stage beside the real notice; the owner's live look remains the check that closes it

OWNER_INTENT: The presence must not shrink when Live reports unavailable, and the orb should carry more colour and flash on her stresses
MUST_NOT_HAPPEN: The orb must not collapse behind a notice; the spark must not fire on silence or while she is being spoken to; gold must not appear at rest; the stage must not regain a scrollbar; the notice must not become unreachable
MUST_PRESERVE: Everything #1443 shipped — the pulsing body, the travelling surface bands, calm-while-listening, the visible working and thinking states, the lit controls, the honest refusal, the fixed non-scrolling frame, and the flat presence as the no-WebGL and crash fallback
ACCEPTANCE_CRITERIA: On the real platform, opening Live while the rollout is shut shows the orb at full size beside the consent notice rather than reduced to a dot; the body reads as a coloured object rather than one tint; and a highlight fires on the stresses of her speech and never in silence
MOTION_PURPOSE: The spark marks the stresses in her voice, which is information the pulse alone does not carry — amplitude shows how loud, the flash shows where the emphasis landed. Reduced motion zeroes it entirely along with the pulse and the bands
PROTECTED_SEAMS: Affected and tested: the Live stage's presence rendering and the stage's row allocation. Named and unaffected: Live admission authority, the rollout scope and its operator control, the acceptance seam, the three admission edge contracts, relay transport, thread and transcript persistence, tenant isolation
INTERNAL_BUILD_IDENTITY: pr=1445; base=7fb0bc7b6a9dbde335a8706d6d6f3bd646f847e8; deployment=vercel-preview(live-orb-holds-its-size); environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/paige-presence-3d-smoke.mjs
RELEASE_CHANNEL: preview: the PR preview build only; no migration and no edge change, and the PR is held as a draft awaiting the owner's look at the rendered result
RELEASE_CLASSIFICATION: internal-only: the rollout remains shut, so no customer can reach the changed surface
CUSTOMER_RELEASE_IDENTITY: none: nothing customer-visible changes while the rollout is closed
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the shader changes and the new uniforms are asserted and driven; the rendered proportion of the orb beside the real notice is PROOF OWED
RELEASE_RECOVERY: position=forward-fix; reference=this record, noting that reverting restores a presence that collapses to a dot in the state the owner looks at most

## Scope and collisions

- Classification: Existing Project / R2 Standard — two files, one grid rule and one shader.
- Affected flows: Solo operator opens Live Conversation and is refused, which is today's every case.
- Neighboring regressions: none introduced; the row change only bounds a track that was previously unbounded.
- Active-owner/file collisions: none; `main` at `7fb0bc7` carries this session's merges and no other author touched these files.
- Explicit exclusions: the rollout is not opened here, and the server-side refusal-code split (so the consent panel never appears when consent cannot help) remains a named follow-up.

## Evidence index

- `node scripts/paige-presence-3d-smoke.mjs` — green; 12 uniforms cross-checked in both directions, varyings linked, §30 strip proof, perspective camera, displaced-normal recomputation, body pulse, travelling bands, listening-calm gate, geometry budget.
- `npx vitest run src/components/paige/live src/lib/paigeLiveConversation` — 9 files, 88 tests, all passing.
- `npm run ci:tsc` — baseline 12, current 12.
- `npm run build` — green.
- Prototype: https://claude.ai/artifact/BjEKooqqvuJv81Btmiv288

## Review and limitations

The owner's misread of the symptom was itself useful: comparing a loading frame against a settled one
is exactly what surfaced a row-allocation bug that no test could see, because jsdom computes no
layout and the smoke never mounts React. That remains the gap — every layout claim on this surface is
verified by reading the track definition, not by seeing it.
