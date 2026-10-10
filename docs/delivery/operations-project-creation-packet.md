# Operations O3a — project and milestone creation

Pre-edit routing and flow contract. Development slice; no production or authenticated acceptance claim.

1. Owner outcome: give a project an accountable person and time window, then establish milestones to which canonical tasks can be attached.
2. Domain: Operations consumes existing Planning plans/items and Team identities. Sales and Clients keep their commitments and acceptance records. No changes to other departments.
3. Harness/Gateway: manual caller JWT and existing Planning permissions. Shared conversational execution remains independently governed; this slice does not change Chat admission or executor security.
4. Spine: existing `planning.create`, `planning.add_milestone`, `planning.list` and `planning.assign_task`. Current declaration is PARTIAL, not verified conversational execution. Arbitrary dependency graph and project lifecycle mutation are not supplied by these creation capabilities.
5. Provider: none. Canonical database records and existing audit only. No customer communication or provider spend.
6. Authority: reversible internal Planning records, source-owned membership and staff/self restrictions. UI reviews intended creation using existing shared confirmation components; no alternate PAIGE approval channel or new role.
7. Durable work: no async job is needed for project/milestone insertion. Existing assignment action bus remains owned by Planning. Non-idempotent creation must never replay an uncertain response.
8. Readback: expected actor/tenant are fenced under the existing profile scope lock, canonical writer returns bounded identity, independent caller-RLS read verifies all intended fields before success. Unknown outcomes retain identity and expose authorized inspection.
9. Surface: canonical Solo Projects and existing item/project detail panels. Binding Ledger stays PROOF_OWED for the full department. Recorded work progress is not verified client acceptance.
10. Proof: rollback SQL membership/role/tenant/relationship and ACL negatives; adapter lost-response, field mismatch and actor-switch tests; actual rendered confirmation, draft/recovery/focus and responsive behavior; completed non-author review; exact-head CI; production migration identity. Named authenticated runtime remains UNVERIFIED under standing restrictions.

## Flow

Open New project, enter name/context, choose scope and an authorized owner, set a real date window and Planning horizon. Review and confirm. Preserve the draft when confirmation is canceled or authority refuses. On a verified canonical readback refresh Projects and allow inspecting its recorded draft status; creation never silently activates it. Add milestone from project detail, choose a name, responsible person, priority and deadline, review and confirm. The server locks the in-scope parent project before delegating the canonical milestone writer. Task creation can reference the same milestone through the existing source relationship.

Busy flows reject abandonment. Unsaved drafts guard workspace switching and reload. Unknown results prohibit repeat save; known identities open the existing authorized details, unknown identities refresh current projects/work. Missing source or Team identity stays unavailable, not fabricated. No browser-only project, cloned identity, independent planning engine or invented client acceptance.

## Development evidence

- Adapter: 12 tests PASS for independently read draft/milestone fields, foreign acknowledgement, actor changes, canonical refusal and lost response without replay.
- Creator: four tests PASS for review/cancel retention, verified-only draft success, uncertain inspection lock and nonstaff milestone refusal. Initial test helper selected Start twice; corrected Finish selection and rerun passed.
- Product/shared-shell browser: 12 cases PASS across Obsidian/Mineral and required four sizes plus phone: project review cancellation, canonical refusal, actual scrolling/containment and focus; milestone refusal and focus in each theme. Explicit synthetic reads/role/refusal ports, not saved-record or authenticated proof.
- Scoped source ESLint, definer grant lint and signature ACL lint PASS. Typecheck is pending.
- Sixteen SQL rollback assertions are registered in database-contract CI. Native PostgreSQL could not start because local loopback binding returned permission denied: SQL execution is UNVERIFIED, not PASS. No customer database write or provider effect was attempted.
- Non-author review, exact-head rebuilt-schema CI, hosted migration/readback and authenticated acceptance remain owed. Project lifecycle editing, arbitrary dependencies and delivery acceptance are later slices, not implied by creation.
