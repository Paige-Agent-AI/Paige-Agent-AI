# UI delivery evidence: EXP03 one draft reply per inbound message, and display names with `@` are not first names

The commit range carries a `Visible-Flow-Impact: yes` trailer from already-merged EXP03 commits, recorded as history by an "ours" merge after the #2986 squash. This change is a database index plus an edge-function fix; no UI file changed. It changes what an owner sees in two narrow cases.

- **A reply SendGrid delivers twice at the same moment:** the owner now sees one draft reply for it in the approvals queue, not two.
- **A new sender whose display name is an address** (for example `jordan@example.com <jordan@example.com>`): the new contact's first name is taken from the address's local part instead of the full address.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in this PR. Actors: a client replying to a business email, SendGrid Inbound Parse (which retries), PAIGE's inbound receiver, the business owner who reviews drafts. Goal: one stored reply and one draft reply per inbound message, with a sensible new contact. Central act: filing the draft reply. Exits mapped: first delivery (one draft filed), sequential redelivery (existing draft found, none filed), concurrent redelivery (second insert refused 23505, read as already filed), other insert failure (503, SendGrid retries), display name with `@` (local part used), display name without `@` (unchanged), contact create failure (reply stored unlinked, unchanged on purpose).
PAIGE_UI_DESIGN: PASS: paige-ui-design router read. No visual surface, pack, token or layout is added or changed.
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed; a duplicate draft no longer appears.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface state, copy or transition changes.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is every business receiving replies at a PAIGE-managed address. Primary action: review one draft per reply. Purpose: close re-review findings N1 and N6 of #2976.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed
AUTOMATED_EVIDENCE: PASS: `supabase/functions/handle-inbound-email/index.test.ts` (34/34, `npm run test:inbound-email`, run by CI `verify`). Failing-first: test N1 (a concurrent insert raced by the fault `raceActionInsertTimes`) and the two N6 tests failed before the fix and pass after.
STATIC_EVIDENCE: PASS: migration-version-collision-lint and definer-fn-lint pass. Production read before the index (SELECT only): 4 `comms-draft-reply` actions, all with a message_id, no duplicates, so the index builds without touching a row.
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual surface is rendered or changed.
BEHAVIORAL_EVIDENCE: PASS: the tests drive the real handler with a mocked database: first delivery, redelivery, a concurrent redelivery whose insert hits the unique index, and both display-name shapes.
AUTHENTICATED_RUNTIME: UNVERIFIED: after merge, deploy-migrations applies the index and deploy-edge-functions ships `handle-inbound-email`; both are read back on production. A real concurrent redelivery is not something we can trigger on purpose.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive visual surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: each state is covered by a test:
- first delivery: one draft filed
- sequential redelivery: no second draft
- concurrent redelivery: the unique index refuses the second, read as already filed, 200
- display name holding `@`: local part is the first name
- display name without `@`: unchanged
TRUTHFUL_STATE_LABELS: PASS: a refused duplicate is reported as already filed only for 23505; every other insert error still answers 503 so SendGrid retries.
SOLO_UI: NO: no Solo interface file changed
UNVERIFIED: a real concurrent SendGrid redelivery on production; the unauthenticated-sender inbox badge (UI, needs design) is a separate change

OWNER_INTENT: the owner (Antonio, 2026-10-27) said "merge when green and keep going" across the EXP03 inbound follow-ups.
MUST_NOT_HAPPEN: two draft replies for one inbound message; a lost reply; a non-duplicate insert failure reported as filed
MUST_PRESERVE: SendGrid retry on any real failure (503); business-scoped dedup of stored replies; storing a reply whose contact cannot be created
ACCEPTANCE_CRITERIA: after merge, at most one `comms-draft-reply` action exists per inbound message per business
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: handle-inbound-email's message dedup (`sendgrid-inbound:<tenant>:<Message-ID>`), its 503-on-failure contract, and the `confirm` lane of the draft action

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 3c80e37f626bda041f3e2395f7e7ca6a0558c5b0; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271118110000 applies on merge via deploy-migrations); edge=PROOF_OWED(handle-inbound-email ships on merge via deploy-edge-functions); evidence=this-PR-checks-and-the-tests-above
RELEASE_CHANNEL: development: code on the PR branch; applies to production on merge (pre-launch §4 stance)
RELEASE_CLASSIFICATION: patch: closes a duplicate-draft race and a contact-name defect; no new capability
CUSTOMER_RELEASE_IDENTITY: none: internal hardening, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: nothing a customer sees changes beyond a duplicate no longer appearing
RELEASE_TRUTH_BOUNDARY: PARTIAL: index and fix LIVE after merge; real concurrent redelivery PROOF OWED
RELEASE_RECOVERY: position=forward-fix only — DROP INDEX public.uq_paige_actions_draft_reply_message and revert the handle-inbound-email change; reference=this PR and docs/brain/config-registry.md

## Scope and collisions

- Classification: database index and edge-function fix; no UI source file changed.
- Neighbouring regressions: stored-reply dedup, 503-on-failure, and the draft action's lane (all asserted by the existing tests).
- Active-owner/file collisions: none; built on origin/main `a4d76c41`.
- Explicit exclusions: N7 (a reply whose contact cannot be created stays stored unlinked, on purpose); the unauthenticated-sender badge.

## Evidence index

- `supabase/functions/handle-inbound-email/index.test.ts`: 34/34.
- `supabase/migrations/20271118110000_one_draft_reply_per_inbound_message.sql`.
- Redacted: no secrets or customer data in this record.

## Review and limitations

A real concurrent redelivery cannot be triggered on purpose; the index is the guarantee and the test drives its refusal.
