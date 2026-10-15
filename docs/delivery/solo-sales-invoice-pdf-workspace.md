# Invoice workspace and PDF delivery — owner-approved 2026-10-04

Owner: “okay perfect. You can move forward with live implentation” after reviewing invoice-popout-prototype.html. Existing delivery authorization remains. No test invoice send or payment mutation is authorized by this repair.

## Pre-edit routing answers / maintained contract
1. Outcome: inspect an issued invoice, record/correct payments, download/print an actual PDF and send it as an email attachment without customer-visible technical references.
2. Domain: portfolio family 4 Sales, sales.department; Comms owns provider transport, paige-browser owns browser execution. Marketing email editor PR 1704 is adjacent; no Sales writer transferred.
3. Shared Harness: existing governedExecution and one approval door; A–G remain as recorded in harness-completion-map, not all verified. No new Harness/orchestrator/scheduler. INT-299 remains deferred.
4. Spine: sales_invoice.read, sales_invoice.publish, sales_invoice.record_manual_payment, sales_invoice.reverse_manual_payment, sales_invoice.email_send. PDF read extends the existing document read path, not a new write authority.
5. Provider: Integration Capability Registry resend entry; Gmail/SMTP canonical transport already exists, full provider expense entries remain a missing-entry requirement rather than invented connectivity. PAIGE_BROWSER_URL/SECRET resolve the one shared host. Missing renderer fails closed. Tenant email sender readiness remains mandatory.
6. Authority: high sales_record_manual_payment / sales_reverse_manual_payment / billing_send_invoice governed mutations/external_effect through canonical stored approval. PDF read is read_only. No extra financial confirmation channel.
7. Jobs: immediate canonical invoice delivery operation; no new durable job or scheduler.
8. Proof: current invoice/version, conserved canonical payment ledger, PDF magic/MIME/render, atomic send claim and provider outcome/finalize receipt. Provider acceptance is never customer delivery or payment settlement.
9. Surface: sales.department remains PROOF_OWED; no state promotion from fixtures.
10. Runtime: authenticated owner + second tenant, role guards/account switching, real PDF bytes and provider attachment are required. Native print and authenticated transport remain UNVERIFIED until exercised. No external send during development.

## Flow and protected seams
Register → open actions & records → customer preview / payments / send → guarded canonical review → readback. Unsaved payment edits block close/navigation; review/unknown operation cannot be abandoned via outer close. Close restores invoker. Small-screen workspace fits viewport.

Download and email use the same server-rendered invoice projection. Frozen obligation, branding and immutable document digest survive. Current ledger is separately dated. Original draft UUID stays in historical database facts, never the visible customer artifact.

Protected: tenant resolution/role authority; canonical approval/idempotency/unknown recovery; stored invoice version/frozen facts; token redaction; Comms email transport; shared warm-browser rate/auth/concurrency/network fence. Unaffected: Settings platform Billing, agreements signing/seals, Clients canonical identity, Marketing writer boundary, entitlements, Marketplace installs, schedulers.

Regression: ordinary non-invoice emails keep attachment-free behavior; SMS remains link delivery without PDF; stale invoice or failed PDF refuses provider dispatch. No caller URL/bytes become invoice attachments. Read-only roles gain no writes.
