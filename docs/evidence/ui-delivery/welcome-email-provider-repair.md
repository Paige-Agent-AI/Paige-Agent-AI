# Welcome email provider repair (sender-identity fallback + stranded requeue)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bug-or-repair mode; live diagnosis traced the sole real customer's welcome delivery (enrollment reference givalli44@icloud.com) from send_log_prepare_failed through 8 attempts to terminal needs_attention/provider_rejected; email_send_log carries SendGrid's own 403 body "The from address does not match a verified Sender Identity"; the Oct-18 cutover (d6d700b37) sends the welcome arm via SendGrid while the platform identity notifications@mail.paigeagent.ai is verified only on Resend — the same identity the general arm and send-portal-invite deliver through live (portal_invite sent 2026-10-19T00:06Z); repair = duplicate-safe Resend fallback gated to that exact definitive 403 plus a guarded one-shot requeue migration for the stranded row
PAIGE_UI_DESIGN: PASS: no visual change; the customer-facing surface is the approved solo-beta-welcome email itself, whose copy/layout are untouched — the repair makes that approved email actually arrive instead of dying in a terminal queue state
MATERIAL_FLOW_CHANGE: NO: same template, same recipient, same claim/idempotency/receipt lifecycle; only the provider dispatch gains a fallback arm and the stranded row is re-armed
FLOW_PROTOTYPE: NOT_REQUIRED: no interaction shape change; the delivery flow is machine-to-machine with an unchanged human-readable result
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the brand-new paying-trial Solo customer receives their welcome email with their real workspace destination link and verified trial dates and can click into the workspace; today that customer receives nothing
VISUAL_DIRECTION: PASS: approved transactional email template tokens; no new surfaces
AUTOMATED_EVIDENCE: PASS: transactional-email-relay-closed 22/22 local (4 new proofs: fallback gated to 403+verified-Sender-Identity only, fallback completion carries the same lifecycle receipt with provider marker, ambiguous Resend outcomes recorded uncertain and never retried blind, SendGrid remains primary); welcome_delivery_requeue_after_provider_fix.sql proves re-arm of exactly the stranded shape with two negative shapes and predicate exhaustion in the spine-contract replay database
STATIC_EVIDENCE: PASS: eslint clean on all added lines (5 pre-existing any-errors in untouched general-arm code remain, unchanged from main); workflow step added next to the existing welcome lifecycle proof
RENDERED_EVIDENCE: PROOF_OWED: the delivered email's rendered HTML/text readback is owed from the live re-delivery after merge (Resend receipt + email_send_log metadata); template render path itself is unchanged from production
BEHAVIORAL_EVIDENCE: PASS: duplicate-safety is structural — a definitive SendGrid 403 means nothing was sent, so the fallback cannot double-send; ambiguous outcomes (202-without-id, 5xx, network throw) never fall back; the requeue touches only never-sent rows so no receipt can be fabricated
AUTHENTICATED_RUNTIME: PROOF_OWED: live redelivery of the real stranded welcome (drainer cron → function → Resend → sent receipt → delivered state) is the post-merge production readback
KEYBOARD_FOCUS: NOT_APPLICABLE: email surface; no focusable UI added
ZOOM_REFLOW: NOT_APPLICABLE: email surface; no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: SendGrid primary success; SendGrid sender-identity 403 → Resend fallback success; fallback definitive 4xx → recorded failed/retryable; fallback ambiguous → recorded uncertain, no blind retry; no key → provider_unconfigured unchanged; stranded needs_attention/provider_rejected/never-sent → requeued; other attention rows and non-terminal rows untouched
TRUTHFUL_STATE_LABELS: PASS: email_send_log error messages carry the bounded provider bodies; vendor ids only on acceptance; the requeue never sets sent state; provider marker resend_fallback_after_sendgrid_sender_identity_403 names the exact arm that delivered
SOLO_UI: YES: one welcome path for every current and future Solo enrollment; no tenant-specific branching
UNVERIFIED: live redelivery readback and the rendered email as delivered are owed post-merge; SendGrid primary remains dark until the owner verifies the platform Sender Identity in the SendGrid console — the fallback retires itself when that lands

INTERNAL_BUILD_IDENTITY: f8b931cf174b4ccbdd1e569348923fb74451cf8d; deployment=PROOF_OWED(undeployed fix branch; live redelivery readback owed post-merge); environment=local; migrations=1;edge=1(send-transactional-email); evidence=docs/evidence/ui-delivery/welcome-email-provider-repair.md
RELEASE_CHANNEL: development: local/development build environment; proven by focused vitest suites and the replay-database SQL proof; no deployment performed or claimed yet
RELEASE_CLASSIFICATION: customer-facing-repair: restores the first-touch welcome email for the real paying-trial customer and every future enrollment; email copy unchanged
CUSTOMER_RELEASE_IDENTITY: none: fix branch only
RELEASE_NOTE_REQUIRED: yes: the customer-visible outcome changes from "welcome email never arrives" to "welcome email arrives" once deployed
RELEASE_TRUTH_BOUNDARY: PARTIAL: provider fallback and requeue proven by tests; the actual redelivery to givalli44@icloud.com is PROOF OWED from production after merge and deploy
RELEASE_RECOVERY: position=forward-fix on the live failure class; reference=this record and the requeue migration 20271111030000_welcome_delivery_requeue_after_provider_fix.sql
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no visual change; email-only repair
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no visual change; email-only repair
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change; email-only repair
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change; email-only repair
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change; email-only repair
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change; email-only repair
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no visual change; email-only repair
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no visual change; email-only repair
