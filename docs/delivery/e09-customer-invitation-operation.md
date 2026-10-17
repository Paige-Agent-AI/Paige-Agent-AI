# Recoverable customer invitation operation

Pre-edit packet, main0662f2b7311a866a836e614190542f5c76ce9a8c. This is one bounded dependency of Dashboard/typed Chat/Live convergence, not completion of that outcome or the seven pillars.

1. Outcome: an authorized owner reviews one saved CRM recipient, prepares one single-use invitation, and recovers the same native operation after an interrupted response without minting a second token.
2. Owner: Client Portal/Clients and existing Identity contracts; E03 retains delivery. Existing token producer, acceptance, recipient binding and sender remain authoritative. No shared Chat/Live/provider file is leased or edited here.
3. Harness: existing caller Auth and native owner predicates supply present authority. Harness map A/B/F remains PARTIAL; future Chat/Live consumes the canonical confirmation/kernel path, not a new executor. No event/worker activation.
4. Spine: customer invitation action UNAVAILABLE; no existing customer invite key is registered. The team.invite_* capabilities concern staff and are not reused as customer access. Native prerequisites do not claim a callable Chat/Live capability.
5. Provider: existing registry resend entry is PARTIAL and send-portal-invite is the incumbent sender. This change calls no provider, changes no sender/connection/registry authority and creates no delivery infrastructure. A later sender adapter must update the actual provider record and retain INT-346.
6. Approval: later invite/send is high risk, MUTATION_VERB invite/send, canonical confirm lane and one-approval-gate only. The native target hash is a current-recipient/version precondition, never evidence of Chat approval. No extra approval field or approval store.
7. Durability: existing tenant_invite_tokens gains nullable operation binding; existing audit_logs is the atomic receipt. No job, scheduler or additional identity/operation/receipt table. Historic tokens and all other invitation kinds remain unchanged.
8. Readback: exact current owner can recover the scoped operation and original receipt; prepared means a token was created, never sent/delivered/opened/accepted. Existing owner invitation history/email_send_log remains delivery evidence. A missing operation read is not proof a timed-out request cannot still complete.
9. Surface: existing clients.portal stays PARTIAL. No visible mount or capability availability changes in this native-only dependency. Dashboard and Chat/Live integration follow in bounded changes.
10. Proof: actual native producer and owner predicates in isolated PostgreSQL; positive, wrong actor/business/customer, changed recipient, replay/collision, revoked/expired/accepted, atomic receipt rollback and concurrent operation tests; exact-head Independent Review/CI and normal migration/body/ACL readback. Real owner/client/provider workflow remains UNVERIFIED until legitimately authenticated.

Source lease: existing producer body MD5 3a91af3aeb67fb8dbbf450eb3d612ade, matched actual production and committed source. No edits to that producer, acceptance, email log or sender. New native functions must positively verify current Auth/owner permissions before any token lookup or mutation; raw tokens never appear in their public results or audit data.

Recovery: ordinary forward correction, retaining tokens, receipts and history. No historic backfill or destructive rollback. The native dependency alone does not change the current invitation UI flow, activate Chat/Live, send mail or create any production test identity.

## Implemented native dependency

`prepare_client_portal_invitation` reads the current owner/CRM primary recipient and returns a closed, nonsecret target fingerprint. `create_client_portal_invitation` binds one actor/business/operation to the incumbent producer's single-use consumer token and an atomic existing audit_logs receipt. Replays return that recorded operation's current lifecycle, including accepted/revoked/expired history, never a new send. `read_client_portal_invitation_operation` rechecks current authority and the original audit row, not merely a receipt pointer. No public result/audit contains the token.

Existing tokens retain NULL operation fields. The invoker trigger prevents existing browser/service table grants from forging/retargeting a native binding; lifecycle updates and the incumbent contact-FK SET NULL retirement remain possible. There is no new audit FK that could obstruct established cleanup. Private helpers have no API EXECUTE; the three public functions are authenticated-only. Original producer/acceptance/owner predicates, role/identity constraints and email infrastructure are unchanged.

## Verification and release boundary

[Native report](../evidence/customer-invitation-operation-2026-10-17/native-report.json):77 total PASS/0 FAIL, extending the prior history driver with current target/replay/authority/private-data/receipt/rollback/concurrent-caller cases. Uses actual producer and actual lower owner helpers; Auth and narrow schema are explicit isolated stand-ins. Both standalone and enterprise cohorts use the same implementation. The omitted/mismatched source lease, NULL authority, exact-intent collision, contact/recipient changes, missing audit, direct binding forgery and concurrent calls have executable checks. No hosted customer identity or provider was used.

Migration `20271108233000_e09_customer_invitation_operation.sql` SHA256 `9b11aefe6ef317d9d1a49fca5f702b4df7c7b471b4dfa84bb2179faf8e74e72b`; migration lint and Node syntax checks PASS. Full-schema proof is `supabase/tests/customer_invitation_operation.sql` in the existing database-contract job, plus unchanged consumer acceptance regression. That exact-head hosted run, Independent Review, migration deployment/body/ACL readback and authenticated usage remain required; they are not inferred from the local report.

Channel development; deployment PROOF OWED; own Edge NOT_APPLICABLE. No customer release identity or announcement. clients.portal stays PARTIAL; no current UI/Chat/Live availability changes. Integration Registry change NOT_APPLICABLE at this native-only stage: no provider code, connection, scope, transport or activation changes. A subsequent common sender adapter owes that update and actual provider evidence separately.
