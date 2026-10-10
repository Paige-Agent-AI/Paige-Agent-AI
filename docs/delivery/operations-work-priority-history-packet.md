# Operations O2c — priority and recorded activity

Pre-edit routing contract. No production or authenticated acceptance claim.

1. Outcome: adjust a real task's priority and inspect who recorded its creation or update, without inventing an old/new history that the source never retained.
2. Domain: Operations consumes canonical Planning and its existing audit log; Team owns displayed names/photos. No unrelated CRM/Chat/Communications edits.
3. Harness/Gateway: caller JWT, existing manual Planning authority. No shared execution or security activation.
4. Spine: existing `planning.update_item` and `planning.list`. Activity projection has no new model tool in this slice; conversational trajectory and receipts remain owed.
5. Provider: none; no external effects or expenses.
6. Authority: reversible internal work update; creator/staff field-edit permission delegated to the canonical writer. Existing stage/assignment confirmation stays intact; a source-version mismatch refuses stale edits. Activity reads require current tenant membership and canonical item visibility.
7. Durable work: none; no new executor, scheduler or audit stream. Preserve the existing audit writer, and never automatically retry unknown results.
8. Readback/Rail: bounded acknowledgment plus independently refreshed canonical priority. Existing audit is activity evidence, not a Rail receipt or verified customer outcome. Project only allowlisted timestamps/actions/actor and recorded status; do not return raw audit data.
9. Surface: existing task detail/editor in canonical Solo Operations. Binding Ledger remains PROOF_OWED. No new task authority or public raw audit grant.
10. Proof: priority field-match and stale/refused/lost-response tests, audit scope/role/ACL negative SQL, rendered source/error/empty/focus behavior, completed non-author review and exact-head CI. Production migration, authenticated runtime, true client outcomes and governed receipts remain UNVERIFIED.

## Flow and limits

Inspect work, see current priority and recent source-recorded activity. Authorized creators/managers change priority alongside existing fields. Pin the original row version; a concurrent edit requires refresh and review. Success requires refreshed priority to match. Refused/unknown writes keep repeat submission locked until current work is reviewed. Missing activity stays unavailable; no activity means no recorded history, not no work. The canonical legacy audit only records update status and role context, so older due/assignment/priority details are not inferred.

## Local verification checkpoint — October 10, 2026

Twenty assertions PASS across WorkEditor, work-update adapter and Activity tests. Priority success requires matching canonical readback; mismatched readback remains uncertain. Activity refuses foreign scope, changed sessions and malformed projections; explicit retry can recover to an honest empty record.

`docs/evidence/ui-delivery/operations-v3/priority-activity-verification.json` records ten shared-shell browser cases in Obsidian and Mineral at 1536×770, 1366×768, 1024×768, 900×1000 and 390×844. Named source actors render, priority refusal never becomes success, detail containment and invoker focus PASS. Image tiles are synthetic fixture assets, not real employee photo acceptance. Source, identity, audit and RPC-refusal ports are explicitly synthetic. Desktop dark and phone light captures accompany the record.

Sixteen rollback SQL assertions are registered in the existing database-contract CI job, including ACL, stale version, canonical writer/audit, bounded payload projection, cross-tenant and null-assignee refusal, and revoked membership. Execution remains UNVERIFIED until run; registration alone is not SQL proof. This local slice is not merged, deployed or authenticated-runtime accepted. Exact-head CI and completed non-author review remain owed.
