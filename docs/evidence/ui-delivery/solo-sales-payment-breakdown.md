# Solo Sales invoice payment breakdown

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bounded Sales invoice display/readback packet below; canonical write and approval paths preserved.
PAIGE_UI_DESIGN: PASS: project overlay, modules and Impeccable clarify/craft floor read; https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md.
MATERIAL_FLOW_CHANGE: NO: presentation and read projection refinement; no new customer choice, write, confirmation or side effect.
FLOW_PROTOTYPE: NOT_REQUIRED: existing approved invoice/payment flow retained; itemized read-only document activity added.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owners and customers understand the invoice number, recorded receipts/corrections and remaining balance.
VISUAL_DIRECTION: PASS: existing Mineral/Obsidian operating surfaces and invoice templates; readable dated ledger with aligned monetary amounts.
AUTOMATED_EVIDENCE: PASS: 448 tests across 36 Sales suites plus 15 document-focused tests; isolated PostgreSQL proof with 20 ledger assertions plus negative controls, replay and actual concurrent stale-page rejection.
STATIC_EVIDENCE: PASS: production build, changed-file ESLint, Impeccable detector, Deno document check, explicit definer ACL baseline and migration replay.
RENDERED_EVIDENCE: PASS: 24 actual Solo lifecycle cases and eight actual document-renderer captures; assets/solo-sales-payment-breakdown/lifecycle-geometry.json and renderer-geometry.json.
BEHAVIORAL_EVIDENCE: PASS: real React components in fixture-backed Chromium; record payment, review, canonical prepare, cancel and dirty exit across 24 viewport/theme/dock cases.
AUTHENTICATED_RUNTIME: UNVERIFIED: signed-in owner and second-tenant browser proof unavailable; local fixture and SQL proof cannot substitute.
KEYBOARD_FOCUS: PASS: dialog focus inside and restored to payment review in all 24 component cases; authenticated full keyboard journey UNVERIFIED.
ZOOM_REFLOW: PASS: narrow reflow at 390px without outer horizontal overflow in component and renderer; native browser zoom UNVERIFIED.
REDUCED_MOTION: UNVERIFIED: no animation changes; real production reduced-motion journey not performed.
STATE_COVERAGE: PASS: draft/issued/void distinct from business-recorded partially-paid/paid; malformed balances fail closed; missing invoice number never substitutes internal UUID.
TRUTHFUL_STATE_LABELS: PASS: human records never become provider settlement; recurring terms do not create automatic collection or a new invoice.
SOLO_UI: YES: shared Sales Payments; no account-specific changes.
UNVERIFIED: authenticated owner/second-tenant runtime and production acceptance; no external message/payment executed for this pass.
OWNER_INTENT: Itemize invoice total, dated received payments and corrections, with arithmetic to outstanding; display real invoice number rather than internal ID; preserve truthful invoice/receipt/statement distinctions.
MUST_NOT_HAPPEN: Erase test records, rewrite issued document facts, infer draft from a historic number, invent a customer invoice number, assert provider settlement, hide truncated history, duplicate financial stores.
MUST_PRESERVE: Frozen issued snapshots/digests, canonical tenant/role authorization, stored approval/fingerprint/operation identity, retry recovery, receipts/reversals and delivery readiness.
ACCEPTANCE_CRITERIA: Each current invoice displays its canonical number, issued status and exact recorded balance; downloaded/customer invoice includes dated receipt/correction activity and arithmetic; partial history is explicitly labelled; cross-tenant/token reads refuse.
MOTION_PURPOSE: NONE: no new animation.
PROTECTED_SEAMS: Affected: scoped invoice readers/public-token checks, canonical financial readback, privacy, document rendering, responsive geometry/accessibility. Preserved unchanged: authentication/account choice, entitlement/platform billing/provisioning, approval/autonomy/Spine mutations/Rail writers, chat transcript/Live Conversation, Secure Browser/Vault, provider sends and durable scheduling/recovery.
INTERNAL_BUILD_IDENTITY: 2ea64909353287087b96fa09be77dc70d34e16b6; deployment=dpl_7yDhbhe4nrhzmJQhRHR3Jv4Wskjb; environment=production; migrations=APPLIED(20270555000000); edge=APPLIED(sales-invoice-document@7); evidence=this record.
RELEASE_CHANNEL: production: exact merged build, database migration and document edge verified; authenticated customer acceptance remains UNVERIFIED.
RELEASE_CLASSIFICATION: patch: existing invoice/payment evidence presentation correction.
CUSTOMER_RELEASE_IDENTITY: none: authenticated customer outcome not proven.
RELEASE_NOTE_REQUIRED: no: no customer release claim.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local read/presentation implementation; authenticated usability PROOF OWED; provider evidence unchanged.
RELEASE_RECOVERY: position=forward-fix scoped read/document projection; reference=existing immutable financial history remains intact.

## Flow and collision packet

Fresh main 154dc1e6; branch sales/invoice-payment-breakdown. Open PR1704 touches Marketing email reads/master and PR1657 owns isolated address lookup; neither owns changed invoice files. Preserve shared master changes during closeout.

Sales owns tenant-customer money. Spine keys sales_invoice.read, sales_invoice.record_manual_payment and sales_invoice.reverse_manual_payment already bind canonical RPC/command paths. Writes retain high/confirm and canonical one-approval-gate; this slice adds only scoped read projection, no execution engine/provider/scheduler. Existing sales.department binding stays PROOF_OWED. Existing Rail/operation records remain proof of writes, while invoice statements use canonical business records only.

Owner initially authorized legacy sequence numbering, then said legacy numbering need not be addressed because these are test records. No bulk historic renumber or dynamic immutable-guard rewrite is included. New invoices already receive canonical tenant sequence numbers; historic DRAFT references remain preserved as original references, with issued state displayed separately.

Invoice requests payment; receipt acknowledges recorded payment; statement summarizes dated charges/payments/balance. This pass adds invoice payment activity, not a second account-statement engine or periodic invoice generator. Research: https://www.xero.com/us/glossary/invoice/ and https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-statements/create-send-customer-statements-quickbooks-online/L8bvb69Gg_US_en_US?uid=ljj5suqx.
SOLO_1536X770_PAIGE_CLOSED: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_1536X770_PAIGE_OPEN: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_1366X768_PAIGE_CLOSED: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_1366X768_PAIGE_OPEN: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_1024X768_PAIGE_CLOSED: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_1024X768_PAIGE_OPEN: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_900X1000_PAIGE_CLOSED: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.
SOLO_900X1000_PAIGE_OPEN: PASS: lifecycle-geometry.json records both themes, no outer overflow, dialog controls reachable and focus restored; fixture-only authentication.

## Independent review repair

Non-writer collections_independent_review completed initial exact-head review acf6c2efeca5c62ffc265d244cfb60a258f5cb7d: P1 canonical SQL receipt vocabulary mismatched renderer payment fixture; P2 a draft lifecycle number inherited issued display. Both repaired, plus redundant legacy document title removed. The SQL proof now feeds actual database ledger JSON into the production renderer and asserts successful dated receipt/correction output and conserved balance. The combined repair recheck completed PASS at 3fdfe954aaab322b49e328755b29249ce614373e; independent reviewer ran 32 focused tests and real SQL-to-renderer/concurrency proof and inspected the repaired captures.

## Verified production delivery

PR1707 merged to main 2ea64909353287087b96fa09be77dc70d34e16b6 after all seven required workflows passed on reviewed head3fdfe954aaab322b49e328755b29249ce614373e. Non-writer review and repair recheck completed before merge.

- Vercel dpl_7yDhbhe4nrhzmJQhRHR3Jv4Wskjb READY, exact2ea64909 source; aliases paigeagent.ai and app.paigeagent.ai verified. Public version.json buildId2ea64909353287087b96fa09be77dc70d34e16b6-muua0ypi; customerUpdate null.
- deploy-migrations37232433365 SUCCESS; hosted catalog confirms20270555000000 and both scoped document-ledger RPC signatures. db-live exact2ea64909.
- deploy-edge-functions37232433463 SUCCESS; sales-invoice-document@7 ACTIVE. edge-live exact2ea64909.
- No external invoice email/SMS/payment was executed for this correction. Hosted signed-in owner/second-tenant and public bearer-document acceptance remain UNVERIFIED: CUA getState failed with trusted Node process unexpectedly exited/kernel reset. Local SQL and component fixtures are separate evidence classes.
- Recovery: forward-fix document/read projection if needed; frozen invoices, payment receipts/corrections and original references were never rewritten. No legacy numbering backfill, test-record deletion or provider activation occurred.