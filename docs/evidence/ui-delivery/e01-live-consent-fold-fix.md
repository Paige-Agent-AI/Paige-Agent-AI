# Live consent notice fold repair (#2721) — pinned acceptance actions, narrowed live region

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no new flow — the existing disclose→acknowledge journey keeps every step; this repair changes where the acceptance control lives inside the disclosure state (pinned outside the scroll region instead of below long terms) and narrows the live-announcement scope so a press no longer re-reads the entire notice. Owner objective (2026-10-19 customer-visible rule + PR5 consent gap closure): the person must see the disclosure AND reach the accept control without hunting for it.
PAIGE_UI_DESIGN: PASS: existing Live stage design language only; the gold accept button, refusal copy and layout rhythm are unchanged — restructured, not redesigned.
MATERIAL_FLOW_CHANGE: NO: layout/a11y repair within one existing state; no new goal, state, transition, exit or consequence.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner reading the Live disclosure presses "I understand — turn on Live" — the repair guarantees that control is visible beside the scrolling disclosure rather than beneath it.
VISUAL_DIRECTION: PASS: existing tokens; the notice becomes a flex column (scrollable disclosure + fixed actions row) using the surface's own spacing scale.
AUTOMATED_EVIDENCE: PASS: vitest Live suite 43/43 at head 5bf58a973 (permission-denied/retry, terms-acceptance flow, reconnect/minimize/restore, interruption + mute restore, hold, offline/hidden/disconnected fencing, one-use ticket, barge-in, focus/Escape, card governance) — all green with the restructured DOM.
STATIC_EVIDENCE: PASS: CI at 5bf58a973 — lint, contract, database-contract, postgres-authority, audit, web-fetch-hardening-smoke, Vercel Preview Comments all success; Supabase Preview skipped (no database change in this PR); the present record completes the evidence gate this run flagged.
RENDERED_EVIDENCE: PASS: 4 IHDR-verified PNG frames (fold-1536x770-{dark,light}-terms.png, fold-900x1000-{dark,light}-terms.png) of the REAL component via the synthetic harness (no auth/network/provider/microphone), each ASSERTED BEFORE capture: the disclosure region genuinely overflows its scroll container (72px at 1536x770, 138px at 900x1000 — the fold condition that used to push the button off-screen), the actions row is OUTSIDE that scroll region, and the accept control's bottom edge sits inside the viewport (667px of 770; 781px of 1000). sha256-distinct, dimensions exact. Receipt: docs/evidence/experience-01-foundation/live-consent-fold-2026-10-24/fold-frames.json.
BEHAVIORAL_EVIDENCE: PASS: every frame was driven by a real Playwright click on the real trigger with the state text asserted before capture; keyboard route (initial Shift+Tab, forward/backward trap, Escape to the chat control) suite-covered and untouched by the diff.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated audio session exists; the founder's single evaluation window owns that class, unchanged by this repair.
KEYBOARD_FOCUS: PASS: suite-pinned focus/Escape behavior unchanged; the accept control remains in the ordinary tab order inside the notice.
ZOOM_REFLOW: PASS: narrow-viewport frame (900x1000) proves the scroll-then-pin structure reflows — longer disclosure increases scroll overflow (138px) while the actions stay pinned.
REDUCED_MOTION: PASS: all captures taken under reduced-motion emulation; no motion introduced by this change.
STATE_COVERAGE: PASS: the terms state (the only surface whose DOM changed) is geometry-proven at primary and narrow viewports in both themes; denied/listening share the notice scaffold and are suite-covered; the blocked message renders in the same actions row it replaced; closed state untouched.
TRUTHFUL_STATE_LABELS: PASS: exactly one polite live region (role="status") measured in every frame — the availability line only; the full-notice live region that re-announced ~90 words on every press is gone; the blocked copy still refuses honestly instead of re-offering a button the database would reject.
SOLO_UI: YES: the Live surface is the one Solo shell surface.
UNVERIFIED: the founder's OWN acknowledgement event (and everything downstream of it) remains PROOF OWED — FINAL EVALUATION WINDOW; engineering does not manufacture it.

OWNER_INTENT: owner rule 2026-10-19 (customer-facing changes must be visibly comprehensible) applied to the PR5 consent gate: the disclosure must be readable AND its acceptance reachable — a consent button below the fold is a disclosure the person cannot act on.
MUST_NOT_HAPPEN: the accept control must never depend on scrolling the disclosure to become reachable; the narrowed live region must not silence the availability announcement itself.
MUST_PRESERVE: the two-faced refusal (gold button before the database refusal; honest blocked message after), the disclosure copy and its database-enforced claims, the keyboard trap and Escape route, the notice's role in the disclose→acknowledge→speak journey.
ACCEPTANCE_CRITERIA: with terms long enough to overflow, the actions row is pinned in-viewport and outside the scroll region at every canonical viewport; pressing the accept control produces one polite announcement (the availability line), not a re-read of the whole notice.
MOTION_PURPOSE: NONE: no motion change.

## Scope and collisions

- Classification: Solo Live surface — consent notice layout + live-region scope repair (#2721, 3 files: component, CSS, this record).
- Affected flows: Live disclosure state only.
- Neighboring regressions: none observed — trigger, stage, denied/listening states and their suites untouched (43/43).
- Active-owner/file collisions: none; the immersive-stage work is deliberately stacked AFTER this merge.
- Explicit exclusions: no change to the acceptance RPC, the consent gate SQL, or any edge function.

## User job and state map

The person opens Live, is refused until they acknowledge, reads what the speech provider keeps, and accepts — or is told plainly that Live is not yet open. Scroll owner for the disclosure is the notice's own scroll region; the actions row never scrolls away.

## Evidence index

- Frames + geometry receipt: docs/evidence/experience-01-foundation/live-consent-fold-2026-10-24/ (captured 2026-10-24, reduced-motion emulation, synthetic harness, localhost:4179, Playwright Chromium).
- vitest: `node node_modules/vitest/vitest.mjs run src/components/paige/live` → 2 files, 43/43.
- CI at 5bf58a973 (before this record): 9 success / 1 skipped / 1 failure — the failure being the evidence gate this record completes; verify job re-runs with this commit.
- Prior rendered baseline: docs/evidence/experience-01-foundation/live-verification-2026-10-24/ (merged #2710).

## Review and limitations

Independent review of #2721 (single commit 5bf58a973): DOM faithful, CSS sound, APPROVE with cosmetic notes only (hover-lift parity for the new actions buttons; mobile overflow) — noted for the follow-on immersive-stage PR, not blocking. Limitation: the geometry proof covers the synthetic harness at two canonical viewports; a human finger on a real phone is the founder window's territory. AUTHENTICATED_RUNTIME remains the only unproven class, exactly as in the lane record.

INTERNAL_BUILD_IDENTITY: 5bf58a9734f0f1f926643b073baaae3c195d56dd; deployment=undeployed (UI layout repair; deploys with the next web build); environment=local harness + CI; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + fold-frames.json
RELEASE_CHANNEL: development: repair merged through the normal PR gate before the founder evaluation; no staged rollout concept applies to this surface yet.
RELEASE_CLASSIFICATION: internal-only: pre-evaluation repair of the EXP01 Live surface.
CUSTOMER_RELEASE_IDENTITY: none: Solo Live pilot surface, not yet in the founder evaluation window.
RELEASE_NOTE_REQUIRED: no: internal repair; the disclosure copy is unchanged.
RELEASE_TRUTH_BOUNDARY: PARTIAL: fold repair proven at the rendered+synthetic class (geometry-asserted frames); the founder's own acceptance and audio remain their window.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the review thread on #2721
SOLO_1536X770_PAIGE_CLOSED: PASS: merged #2710 frames live-1536x770-{dark,light}-closed.png — the closed trigger surface is untouched by this diff (DOM change confined to the notice subtree).
SOLO_1536X770_PAIGE_OPEN: PASS: fold-1536x770-{dark,light}-terms.png — geometry-asserted (overflow 72px; accept bottom 667px of 770; actions outside the scroll region).
SOLO_1366X768_PAIGE_CLOSED: PASS: merged #2710 frame live-1366x768-{dark,light}-closed.png (unchanged surface).
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: notice reflow proven at the primary and narrow canonical viewports; no layout mechanism in this diff that varies between those widths (same flex column, same 34vh scroll cap) — mirrors the merged #2710 record's coverage rationale.
SOLO_1024X768_PAIGE_CLOSED: PASS: merged #2710 frame live-1024x768-{dark,light}-closed.png (unchanged surface).
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same primary+narrow coverage rationale as 1366x768.
SOLO_900X1000_PAIGE_CLOSED: PASS: merged #2710 frames live-900x1000-{dark,light}-closed.png (unchanged surface).
SOLO_900X1000_PAIGE_OPEN: PASS: fold-900x1000-{dark,light}-terms.png — geometry-asserted (overflow 138px; accept bottom 781px of 1000; actions outside the scroll region).
