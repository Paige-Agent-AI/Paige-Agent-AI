# Operations O3b — canonical project lifecycle

Pre-edit contract. This extends existing Planning plans; no separate project engine.

1. Outcome: activate a recorded draft project, manage its accountable owner/date window and mark internal completion only when unresolved work is absent.
2. Domain: Operations manages canonical Planning records. Team owns identities; Sales and Clients own commercial commitments and acceptance. No shared Chat executor edits.
3. Harness/Gateway: manual caller JWT. Conversation execution remains governed by existing Harness/Trust and is not activated by this slice.
4. Spine: `planning.create` and `planning.list` exist. Project lifecycle mutation is UNAVAILABLE: no existing canonical plan-update capability was found. Add a narrow source-owned Planning RPC; callable Spine registration and modality proof remain later O6 work, never implied here.
5. Provider: none. No notification, provider activation or expense.
6. Authority: existing Planning staff roles admin/super_admin/coach, or accountable owner/creator for eligible own plan. Reassigning owner requires staff. Current member, actor/tenant lock and raw row version are mandatory. Existing shared confirmation components review consequential changes; this is not a second Trust system.
7. Durable work: none for synchronous internal record edit. No new scheduler, action bus, audit store or execution ledger.
8. Readback: lock existing plan, check version and permission, update same source row and append existing audit. Bounded acknowledgement plus independently refreshed plan fields are required before saved success. Existing audit is not Rail or client outcome evidence.
9. Surface: existing canonical Projects detail. Keep draft/active/completed/archived source vocabulary; preserve V3. Completion and archive refuse unresolved task/milestone work, never hide or cancel children automatically. Client acceptance remains separate.
10. Proof: actor/tenant/role/owner/version/date/unresolved-work negatives, no partial writes, UI confirmation/refusal/concurrency/readback, responsive/focus, independent review and exact-head CI. Hosted migration and authenticated runtime remain UNVERIFIED under owner restrictions.

Inspect project; edit recorded status/date/owner; review and confirm; save through server authority; refresh and compare. Background updates cannot lend a new version to an old draft. Refusal and uncertain results lock repeat save until refreshed review. Missing version is inspect-only. No fabricated deadlines, capacity or delivery acceptance.
