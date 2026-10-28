# UI delivery evidence: EXP03 a send scheduled for later is not refused by the business's do-not-disturb now

This changes only the governed email door (`comms-email-command`) and its readiness check. No UI file changes in this PR. It does change what a person can finish: the owner chose "ask to schedule" for do-not-disturb, and before this change that answer was a dead end.

- **Before.** During the business's own do-not-disturb, the door asked the person to schedule the email for later. When they picked a later time, the door refused again with `QUEUED_TENANT_DND`, because readiness was judged against the current time even for a send with `send_at`.
- **After.**
  - A send with a time passes that one hold at the card and at the confirm.
  - Every other hold still refuses at the card: unsubscribed or bounced, no consent, the client's own do-not-disturb, quiet hours, and an errored check.
  - When the email falls due, the scheduled drainer re-runs every pre-send check. If the hold is still in force then, the email is refused and closed with its reason. It is never sent into a hold.
- **Also.** The door's 202 now carries `expires_in_ms`, the check's remaining life by the server's clock.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in PR #3011. Actors: a business owner or admin replying or composing in Conversations (from piece 3), and Paige chat. Goal: send a business email later while the business's own do-not-disturb is on now. Central act: the door's check and confirm for a send with `send_at`. Exits mapped:
- scheduled email accepted at the card while the business's do-not-disturb is on;
- confirm accepted and scheduled;
- released after the hold ends (sent);
- released while the hold still holds (refused, closed with its reason);
- every other hold (refused at the card, unchanged);
- immediate send during the hold (refused at the card, unchanged).
PAIGE_UI_DESIGN: PASS: paige-ui-design router read. No visual surface, token or layout is added or changed in this PR. The composer copy for this answer ("Schedule it for later") ships with piece 3's own evidence record.
MATERIAL_FLOW_CHANGE: YES: the "schedule it for later" exit during the business's own do-not-disturb now completes instead of refusing again. No screen, control or copy changes here.
FLOW_PROTOTYPE: WAIVED: owner-decision=owner answer "Ask to schedule" in this session, 2026-10-27; reason=the owner already chose the interaction and this PR changes no screen, only makes the door honour it
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is owners and admins of Solo, Sub-account and Agency-as-tenant businesses scheduling an email during their own do-not-disturb. Primary action: schedule the email and have it go out when the hold ends. Purpose: the owner's "ask to schedule" answer works instead of dead-ending.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed
AUTOMATED_EVIDENCE: PASS: readiness.test.ts new case (the business do-not-disturb holds an immediate send but not a scheduled one, every other hold still refuses a scheduled one) and two new comms-email-command.test.ts cases (readiness told scheduled on card and confirm, not for an immediate send; the 202 carries expires_in_ms), all three failing first on main's source; vitest.sales-invoice-delivery.config.ts 13 files / 209 passed, comms-email-command.test.ts 77 passed.
STATIC_EVIDENCE: PASS: C0b pin for readiness.ts renewed after reproducing the old digest from main 5a4bfb1f0, node --test scripts/ci/c0b-*.test.mjs 249/249, paige-spine-registry-lint and --self-test PASS, non-strict and strict tsc on readiness.ts clean.
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual surface is rendered or changed in this PR. The composer frames for this answer come with piece 3 (`docs/evidence/ui-delivery/exp03-composer-inline-check.md`).
BEHAVIORAL_EVIDENCE: PASS: the handler tests drive the real door handler with its readiness seam observed on the card and on the confirm. The release-time refusal was confirmed by reading the source:
- the drainer calls `readCommsEmailReadiness` without `scheduled` (`comms-scheduled-drain/index.ts:44`);
- send-message refuses a governed email on any pre-send queue disposition (INT-328 branch).
AUTHENTICATED_RUNTIME: UNVERIFIED: an authenticated scheduled send during a live business do-not-disturb window has not been driven. The first product surface that reaches it is piece 3's composer.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive visual surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: each state is covered by an assertion or by the drainer source:
- immediate send during the business's do-not-disturb (held, unchanged)
- scheduled send during it (card raised)
- scheduled send's confirm (readiness told scheduled)
- every other hold with a send time (held)
- release while the hold still holds (refused at release by the drainer's own readiness)
TRUTHFUL_STATE_LABELS: PASS: no state is reported as sent that was not; a refused release closes the email as Not sent with its reason (existing piece 1 behaviour).
SOLO_UI: NO: no Solo interface file changed; door and readiness only
UNVERIFIED: authenticated runtime drive of a scheduled send across a real do-not-disturb window; the composer surfacing it ships with piece 3

OWNER_INTENT: the owner (Antonio, 2026-10-27) chose "Ask to schedule" for quiet hours and do-not-disturb on the Conversations email reply box.
MUST_NOT_HAPPEN: an email sent while the business's do-not-disturb is in force; any other hold (unsubscribed, no consent, client do-not-disturb) being bypassed by adding a send time
MUST_PRESERVE: immediate sends still held by do-not-disturb; every other refusal; the drainer's release-time re-check; scheduled cancel and the release grace
ACCEPTANCE_CRITERIA: during the business's do-not-disturb, a send with a later time gets a card and can be confirmed; it is released only if the hold has ended, otherwise it is refused and closed with its reason
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: `_shared/comms-email/readiness.ts` (C0b-pinned), `comms-email-command` card and confirm readiness calls, `comms-scheduled-drain` release readiness (unchanged)

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 0743db1c2185ea89bedf3e6c0c4918d1f297c1d3; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(comms-email-command and every function bundling readiness.ts deploy on merge); evidence=PR-3011-checks-and-tests-above
RELEASE_CHANNEL: development: code on the PR #3011 branch; edge functions deploy to production on merge via deploy-edge-functions (pre-launch §4 stance)
RELEASE_CLASSIFICATION: patch: makes an owner-chosen answer work; no new capability
CUSTOMER_RELEASE_IDENTITY: none: folded into the Conversations email reply release (piece 3)
RELEASE_NOTE_REQUIRED: NO: no product surface reaches it until piece 3, whose record carries the note
RELEASE_TRUTH_BOUNDARY: PARTIAL: door behaviour LIVE after deploy; authenticated drive PROOF OWED
RELEASE_RECOVERY: position=forward-fix or revert of PR #3011, no data action; reference=PR #3011 and docs/brain/decision-log.md

## Scope and collisions

- Classification: edge function and shared readiness change; no UI file changed.
- Affected flows:
  - scheduling a governed email during the business's own do-not-disturb (door card and confirm);
  - the check's lifetime field in the 202.
- Neighbouring regressions, each asserted:
  - immediate sends during do-not-disturb;
  - every other hold;
  - an immediate send not marked scheduled.
- Active-owner/file collisions:
  - `readiness.ts` is C0b-pinned; renewed with a comment.
  - EXP08 was told in ANT-161 that EXP03 edits these comms-email files.
- Explicit exclusions: no change to the drainer or to send-message.

## Evidence index

- `supabase/functions/_shared/comms-email/readiness.test.ts`: new do-not-disturb case.
- `src/__tests__/comms-email-command.test.ts`: two new door cases.
- `scripts/ci/c0b-incumbent-resource-binding.mjs`: renewed pin with its comment.
- Redacted: no secrets or customer data in this record.

## Review and limitations

The release-time refusal is read from source, not driven: no live do-not-disturb window was exercised.
