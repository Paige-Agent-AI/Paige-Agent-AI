# Experience 03 S3 backend: null-safe user id on the unmounted communications admin page

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: The S3 backend flow packet, contracts and reviews are in docs/delivery/exp03-grow-my-business-journey.md (S3 and the Customer Experience Integration Matrix). The only UI file in this PR is a defensive null guard required by the backend change (§37 consumer inventory).
PAIGE_UI_DESIGN: PASS: The project design router was read for S3. This PR changes no rendered design; the customer-facing S3 screens ship in the next PR.
MATERIAL_FLOW_CHANGE: NO: src/pages/admin/CommunicationsAdmin.tsx only stops calling .slice() on a communication_log.user_id that the S3 history rows now leave NULL. The page is not imported or mounted anywhere (grep of src for CommunicationsAdmin finds only the file itself), so no route, state, transition or consequence changes.
FLOW_PROTOTYPE: NOT_REQUIRED: No material flow change; the S3 prototype frames were shown to the owner on 2026-10-13 for the next PR's screens.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Keep the unmounted operator communications log from throwing on S3 history rows (user_id NULL) if it is ever mounted again.
VISUAL_DIRECTION: NOT_APPLICABLE: No rendered change; the guard prints an em dash where a user id is absent.
AUTOMATED_EVIDENCE: PASS: S3 proofs in CI order (exp03_lead_reply_draft, paige_email_sendgrid_door 41 ok, paige_email_sendgrid_receipts 80 PASS, paige_email_sendgrid_sender_integrity 27 ok) and npm suites test:lead-reply 58/58, test:lead-reply-draft 24/24, test:execute-approval 39/39, test:comms-lead-reply-approval 17/17, test:sendgrid-webhook 9/9; exact-head CI on PR #2126 reruns them.
STATIC_EVIDENCE: PASS: ci:tsc ratchet unchanged at baseline 10; lint:migration-versions, definer-fns, views, managed-schema, integration-registry pass; the generated types mark communication_log.user_id nullable.
RENDERED_EVIDENCE: NOT_APPLICABLE: The changed page is not mounted on any route, so there is nothing a person can render; no other UI source changes.
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: No reachable surface changes behaviour; backend behaviour is proven by the SQL proofs listed above.
AUTHENTICATED_RUNTIME: UNVERIFIED: No authenticated session exists for this backend-only PR; the S3 customer screens and their signed-in QA on the Antonio Cook Solo account (ANT-52) are the next PR's obligation.
KEYBOARD_FOCUS: NOT_APPLICABLE: No UI or focus change.
ZOOM_REFLOW: NOT_APPLICABLE: No UI geometry change.
REDUCED_MOTION: NOT_APPLICABLE: No motion change.
STATE_COVERAGE: PASS: The guard covers the one new state the backend introduces for that page (a NULL user id); every other state is unchanged.
TRUTHFUL_STATE_LABELS: PASS: Backend states are truthful by contract: provider acceptance is never shown as delivery, and history rows read "handed to the email provider … delivery not confirmed".
SOLO_UI: NO: The only UI file is an unmounted admin page; S3's Solo screens ship in the next PR with their own record.
UNVERIFIED: Every customer-visible S3 outcome (O5–O9 in the integration matrix) remains to be built and demonstrated in the next PR; deployed behaviour is read back after merge.
OWNER_INTENT: Ship the S3 backend (governed lead replies, legacy approval quarantine, PAIGE Email via SendGrid, truthful receipts) safely and inert, ahead of the customer screens.
MUST_NOT_HAPPEN: Any send outside the governed door, any approval marked sent without its own provider-accepted send, any Resend connection converted, any customer-visible change.
MUST_PRESERVE: Existing approval lifecycles for non-send kinds, existing Resend connections, existing communications history readers.
ACCEPTANCE_CRITERIA: Exact-head CI green; non-author verification of the exact head; migrations applied and readable in production after merge; no customer-visible change.
MOTION_PURPOSE: NONE: No motion change.
PROTECTED_SEAMS: Approval execution, the governed email door, send-message, RLS on communication_log and messages, and the SendGrid webhook are changed and covered by the proofs above; other seams are unaffected.
INTERNAL_BUILD_IDENTITY: 2b99dff26441090dcc5b57ed5fdc1a21a36bb9bb (reviewed head); merged as f2e2a0af6e667ea39f8135d9f2f53b719776e52a; deployment=dpl_ESb718QihoAxET3M9Tw2v7MMfA9Z; environment=production; migrations=PERSISTED(20271031000000, 20271031000100, 20271031000200 and 20271031000250; deploy-migrations run 38499473304 attempt 2); edge=DEPLOYED(execute-approval, comms-email-command, growth-process-submission, paige-action-worker, subagent-email-composer, send-message and handle-sendgrid-webhook; deploy-edge-functions run 38499473356); evidence=https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2126
RELEASE_CHANNEL: production: merged and deployed 2026-10-14; inert there (0 forms opted in, no SendGrid sender); production readback in master §4.0
RELEASE_CLASSIFICATION: internal-only: backend inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version until Experience 03 earns one
RELEASE_NOTE_REQUIRED: no: pre-launch, nothing customer-visible; announced with the journey
RELEASE_TRUTH_BOUNDARY: PARTIAL: backend contracts live in production and read back (2026-10-14); customer screens UNAVAILABLE until the next PR; live SendGrid sending PROOF OWED behind operator steps
RELEASE_RECOVERY: position=forward-fix, because the migrations are additive and the features stay off by default; reference=https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2126

## Scope and collisions

- Classification: backend PR with one defensive UI guard.
- Affected flows: none reachable.
- Neighboring regressions: none; the page is unmounted.
- Active-owner/file collisions: none known on CommunicationsAdmin.tsx.
- Explicit exclusions: all S3 customer screens (next PR).

## Evidence index

PR #2126; proofs and suites listed above; reviews recorded in the S3 section of the Experience 03 delivery report.
