# The orb gets the room, and the notice row collapses when Live opens

Existing Project / R1 Standard. Two owner adjustments after his live look at `a4bd016`, plus a bug
his own remark exposed.

## What he asked for

The presence should be bigger, and the "Paige is working on" card and the notice beside it should sit
lower. Straightforward: the orb's row takes a larger floor (`9rem` to `11rem`) and the fit divisor
drops from 2.25 to 1.95.

## The bug his next sentence exposed

He said: *"I think we'll lose that unavailable area completely once we get it live."* He is right, and
that made the row allocation I had just written wrong in the opposite direction from the original.

`minmax(0,.62fr)` bounds a tall notice, which fixed the collapse in [#1445](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/1445).
But an `fr` track keeps its share of free space **even when it holds nothing**. The moment Live is
actually open and the notice disappears, the orb would have been left staring at a dead gap where the
panel used to be — a fault nobody would have seen until the rollout opened, which is exactly when
nobody would be looking for a layout regression.

Row 4 is `auto` now, so it collapses to zero when empty and hands the whole column back to the
presence. The panels carry their own `34vh` cap with internal scroll, so a long notice still cannot
starve the orb. Both failure modes are closed at once rather than traded against each other.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing Project / R1 Standard; no flow changes — this is proportion and track allocation on the Live stage the owner has just reviewed live
PAIGE_UI_DESIGN: PASS: router and Impeccable craft floor read earlier this session; no new surface, control or copy
MATERIAL_FLOW_CHANGE: NO: no goal, step, state, exit or consequence changes; the presence takes more of the column and the notice row collapses when there is no notice
FLOW_PROTOTYPE: NOT_REQUIRED: proportion adjustments to a surface the owner reviewed live and approved as an image, made at his direct request
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged — a Solo operator talks to Paige about their own book
VISUAL_DIRECTION: PASS: unchanged palette and motion; only the presence's share of the column and its scale change
AUTOMATED_EVIDENCE: PASS: 41/41 tests across the Live surfaces; presence smoke green, including the uniform cross-check and the §30 strip proof
STATIC_EVIDENCE: PASS: tsc ratchet clean (baseline 12, current 12); ESLint clean across src/components/paige/live; production build green
RENDERED_EVIDENCE: UNVERIFIED: not rendered in this session, which has no browser. The owner reviewed the previous revision live and asked for these specific adjustments
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: no behaviour changes; this is track allocation and a scale constant
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive of the deployed surface (§32). Affected claims: the orb's rendered proportion, and that row 4 collapses cleanly once the notice is gone — the latter cannot be observed at all until the rollout opens
KEYBOARD_FOCUS: PASS: no control added, removed or moved
ZOOM_REFLOW: UNVERIFIED: no fresh capture; the notice cap moves from a percentage to 34vh, which is stable under zoom rather than circular against a content-sized track
REDUCED_MOTION: PASS: unchanged; the reduced-motion settle path is untouched
STATE_COVERAGE: PASS: the adjustment covers both the notice-present state (today, while the rollout is shut) and the notice-absent state (once Live opens), which is the case the bug would have hit
TRUTHFUL_STATE_LABELS: PASS: no copy changes
SOLO_UI: YES: the Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session
UNVERIFIED: the rendered result, and specifically the notice-absent case, which cannot be seen on production at all while the rollout is shut. It is reasoned from the track definition rather than observed, and that limitation is the reason the bug existed in the first place

OWNER_INTENT: Make the voice bigger, drop the working card and the notice beside it lower, and do not leave a hole where the notice is once Live is open
MUST_NOT_HAPPEN: The orb must not collapse under a notice, and must not be left with dead space when the notice is absent; the stage must not regain a scrollbar; the notice must not become unreachable
MUST_PRESERVE: Everything #1443 and #1445 shipped — the pulsing body, travelling bands, the spark, calm-while-listening, visible working and thinking states, lit controls, the honest refusal, and the fixed non-scrolling frame
ACCEPTANCE_CRITERIA: With the notice present the orb reads clearly larger than before and the panels sit lower; with the notice absent the presence occupies the full column with no gap
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Affected and tested: the Live stage's row allocation. Named and unaffected: Live admission authority, the rollout scope and its operator control, the acceptance seam, the admission edge contracts, relay transport, thread and transcript persistence, tenant isolation
INTERNAL_BUILD_IDENTITY: pr=PENDING; base=a4bd016e3d77ef6aa6051e68f2cf90aa63eb3053; deployment=vercel-production(main); environment=production; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=src/components/paige/live/paige-live-conversation.css
RELEASE_CHANNEL: production: merged straight to main per the pre-launch stance, because the owner reviews on the live site and a preview link is not a deliverable
RELEASE_CLASSIFICATION: internal-only: the rollout remains shut, so no customer can reach the changed surface
CUSTOMER_RELEASE_IDENTITY: none: nothing customer-visible changes while the rollout is closed
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the track allocation is asserted from the computed definition; the rendered proportion is PROOF OWED, and the notice-absent case is unobservable until the rollout opens
RELEASE_RECOVERY: position=forward-fix; reference=this record, noting that reverting restores either a collapsing orb or a dead gap depending on which revision is returned to

## Scope and collisions

- Classification: Existing Project / R1 Standard — one grid rule and one scale constant.
- Affected flows: Solo operator opens Live Conversation, in both the notice-present and notice-absent cases.
- Neighboring regressions: none; the cap moves from a circular percentage to a stable viewport unit.
- Active-owner/file collisions: none.
- Explicit exclusions: the rollout is not opened here. The nine unmet transport gates are reported to the owner separately and are his decision, not a layout change.

## Evidence index

- `npx vitest run src/components/paige/live` — 2 files, 41 tests, all passing.
- `node scripts/paige-presence-3d-smoke.mjs` — green.
- `npm run ci:tsc` — baseline 12, current 12.
- `npm run build` — green.

## Review and limitations

The `fr`-track fault is worth recording as a class, not an incident: a bounded track and a collapsing
track are different requirements, and satisfying one silently broke the other. It would not have
surfaced until the rollout opened. The owner caught it in conversation before it could.
