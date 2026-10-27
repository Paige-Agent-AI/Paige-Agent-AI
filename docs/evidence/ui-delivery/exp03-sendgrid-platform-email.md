# UI delivery evidence: EXP03 PAIGE's own email moves from Resend to SendGrid

Declared via a `Visible-Flow-Impact: yes` commit trailer. This is an edge-function and provider-contract change with no UI file changed. It alters what customers see in three ways:

- **Platform email arrives again, from a different address.** The welcome email, platform and client-portal invites, booking emails and transactional email had stopped arriving when the Resend account was emptied on 2026-10-26. They now arrive again, sent from `@mail.paigeagent.ai`.
- **An unconfirmed client-portal invite is never re-sent.** A canonical portal invite whose first attempt has an unknown outcome stays in the existing `outcome_unknown` state; recovery no longer re-sends it.
- **An unconfirmed booking reminder is recorded as unconfirmed.** It is no longer counted as sent and is not re-sent.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in PR #2958 — actors = a new business owner (welcome), an invited teammate or client (platform/portal invite), a booking guest and host (confirm, reschedule, cancel, reminder, follow-up), any recipient of transactional email; goal = each receives the email; central act = the platform send through one shared SendGrid transport; failure, unknown-outcome and recovery exits mapped per function
PAIGE_UI_DESIGN: PASS: paige-ui-design router read; no visual surface, pack, token or layout is added or changed — the email bodies and templates are byte-identical, only the transport, the From address and the unknown-outcome handling change
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed — `outcome_unknown` ("delivery unconfirmed") is an existing invitation state with its existing exit; what changes is that a recovery attempt now lands there instead of re-sending, because SendGrid cannot deduplicate a resend; email bodies, subjects and templates are unchanged
FLOW_PROTOTYPE: NOT_REQUIRED: no interface state, copy or transition changes to prototype; the change is the backend path that reaches an existing state; not a convenience skip
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = every tier that receives PAIGE's own email; primary action = the platform sends the email it already sent before; purpose = restore delivery after Resend's removal without ever sending one business's mail as another business
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed; email templates unchanged
AUTOMATED_EVIDENCE: PASS: src/__tests__/platform-sendgrid.test.ts 9/9; 5 touched vitest files 102/102; supabase/functions/_shared/booking-provider-boundary.test.mjs 111/111 (Node 24); send-portal-invite canonical-delivery.test.mjs 48/48 and command.test.mjs 35/35; scripts/ci c0b-*.test.mjs 249/249; each new test was run against the defect reinstated and failed (reconcile guard, Reply-To fallback, business local-part reuse, unconfirmed-booking ledger state)
STATIC_EVIDENCE: PASS: comms-provider-boundary-wiring PASS; tsc ratchet no new errors; eslint clean on touched files; deno check error counts unchanged from main on every converted function; forbid-sendgrid-admin-key-refs exit 0; full PR CI green on the pre-merge head 35fea866
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual surface is rendered; email bodies are unchanged and this is a backend transport change
BEHAVIORAL_EVIDENCE: PASS: headless drives of the real functions against a fake SendGrid — 202 accepted, 400 definitive refusal, 503 and timeout unconfirmed, thrown request, missing key — for welcome, backfill, platform invite, plan reminder, public booking, booking change, booking notifications, both portal-invite paths and transactional email; the From domain lock was probed with case, trailing dot, subdomains, quoted local parts, double @ and CRLF in the name
AUTHENTICATED_RUNTIME: UNVERIFIED: no real email has yet been sent through the deployed functions; delivery of each converted email is proven only when a real send is observed and its SendGrid events are journalled (owner test sign-up / test invite or booking owed after merge)
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive visual surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: sent (provider accepted, X-Message-Id kept), failed (definitive 4xx or nothing attempted, claim released), unconfirmed (5xx/timeout — portal invite reports not-confirmed, canonical invite settles outcome_unknown, booking reminder ledger `unconfirmed`), refused locally (no key, invalid recipient, no content) — each covered by a test
TRUTHFUL_STATE_LABELS: PASS: no state reports an email as sent without SendGrid's acceptance; an unconfirmed send is never relabelled sent or failed; the email_send_log message_id is SendGrid's X-Message-Id
SOLO_UI: NO: no Solo interface file changed; shared backend email transport
UNVERIFIED: real delivery through the deployed functions (authenticated runtime above); settling an outcome_unknown canonical invite from SendGrid evidence (custom_args now journalled, the settle RPC is a tracked backend follow-up); SendGrid delivery and bounce events reaching invitation history (ingest_sendgrid_receipt writes no tenant/invite id yet — tracked follow-up)

OWNER_INTENT: the owner (Antonio, 2026-10-26) ruled every PAIGE email moves to SendGrid after emptying Resend; target actors are everyone who receives platform email; required outcome is that the email arrives again, from Paige's own domain, with no duplicates and no cross-business sending
MUST_NOT_HAPPEN: a business's mail sent from another business's address or domain; a duplicate invite or reminder from a blind resend; an unconfirmed send reported as sent; the admin SendGrid key read anywhere
MUST_PRESERVE: every email body, subject and template; the business as Reply-To on booking and portal email; commsProviderExecutionAllowed gates; response shapes and email_send_log rows; the canonical invitation claim, payload digest and refusal codes
ACCEPTANCE_CRITERIA: a new sign-up receives the welcome email; a client-portal invite and a booking confirmation each arrive from @mail.paigeagent.ai with replies going to the business; a SendGrid timeout never produces a second copy
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: comms provider execution floor (tested, wiring PASS); canonical invitation claim/finalize (tested 48/48 + 35/35); booking notification ledger (tested 111/111); governed send-message SendGrid arm and its c0b digest pin (unaffected — send-message not touched)

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 35fea8664e4eb21861bad9e84ad0d68e599785da; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(deploy-edge-functions-on-merge-for-the-converted-functions); evidence=PR-2958-checks-and-the-tests-listed-above
RELEASE_CHANNEL: development: code on the PR #2958 branch; the converted edge functions deploy to production on merge via deploy-edge-functions (pre-launch §4 stance, no staged rollout)
RELEASE_CLASSIFICATION: patch: restores platform email delivery on a new provider; no new capability
CUSTOMER_RELEASE_IDENTITY: none: internal provider move, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: email that had stopped arrives again; nothing new for customers to learn
RELEASE_TRUTH_BOUNDARY: PARTIAL: transport and converted functions LIVE after deploy; real delivery PROOF OWED until a real send is observed; outcome_unknown invite settlement and invitation-history delivery events UNAVAILABLE (tracked follow-ups)
RELEASE_RECOVERY: position=forward-fix only — reverting cannot restore delivery because the Resend account is gone; reference=PR #2958 and docs/brain/decision-log.md October27

## Scope and collisions

- Classification: backend edge-function and provider-contract change with a declared visible-flow impact; no UI source file changed.
- Affected flows: welcome email, platform invite, client-portal invite (legacy and canonical), plan reminder, booking confirm/reschedule/cancel, booking reminder and follow-up, transactional email.
- Neighboring regressions: send-message's governed SendGrid arm and campaign lane are not touched; the remaining Resend senders (send-message Resend arm, skill-runner, paige-mcp, manage-tenant-domain, resend-admin-probe) are the next PR.
- Active-owner/file collisions: none — main was merged in and the only conflict was docs/brain/decision-log.md.
- Explicit exclusions: Supabase Auth email (an SMTP setting the owner re-pointed to SendGrid); inbound replies (SendGrid Inbound Parse, later).

## User job and state map

Purpose: the people PAIGE emails receive those emails again. Audience: every tier. Primary action: the platform sends through `_shared/email/platform-sendgrid.ts`. States: sent / failed / unconfirmed / refused locally, as above. No visual surface and no scroll owner.

## Evidence index

- `npx vitest run src/__tests__/platform-sendgrid.test.ts src/__tests__/portal-invitation-sender.test.ts src/__tests__/portal-invite-held-leaves-no-pending.test.tsx src/__tests__/transactional-email-relay-closed.test.ts src/solo/team-invite-lifecycle-migration.test.ts` → 102 passed.
- `node --test supabase/functions/_shared/booking-provider-boundary.test.mjs` → 111 passed.
- `node --test supabase/functions/send-portal-invite/canonical-delivery.test.mjs` → 48 passed; `command.test.mjs` → 35 passed.
- `node --test scripts/ci/c0b-*.test.mjs` → 249 passed; `node scripts/ci/comms-provider-boundary-wiring.mjs` → PASS.
- Independent adversarial review of the full diff; its two HIGH findings (business local-part reuse; unknown invites with no settle key) are fixed in this PR. Codex review findings (booking unconfirmed ledger state; this record) are fixed in this PR.
- Redacted: no secrets or customer data in this record.

## Review and limitations

Headless proof only; no real email has been sent through the deployed functions yet. The owner's post-merge test sign-up and a test invite or booking are the authenticated-runtime proof.
