# Operations reviewer recovery

## Capability routing before implementation

1. Outcome: an accountable person can replace an unavailable reviewer on an undecided submission without resubmitting or changing the artifact.
2. Operations owns submission/reviewer facts. Planning owns item authority; Team owns identities; Studio owns immutable source. No shared executor or owner changes.
3. Manual execution uses the existing scoped database writer pattern. Harness/Trust/Rail conversational wiring is not present for this capability and remains UNAVAILABLE here.
4. No registered Spine capability for reviewer reassignment; UNAVAILABLE until its separately reviewed governed integration. This function is not a tool registration.
5. No provider or connection requirement; no external effects or registry entry is invented.
6. Assignment mutation is consequential and requires exact old/new reviewer and reason confirmation when mounted. Server authority is current item creator/assignee or the released backed target-tenant admin intersection. No autonomous or conversational approval path is added.
7. Synchronous domain mutation; no job, scheduler, notification or new event bus.
8. Existing audit records previous/new reviewer, reason and source revision. Independent scoped submission readback is required by any future caller. Audit is not claimed as an executor Rail receipt.
9. Existing Operations Delivery surface; currently unmounted reviewer controls. Binding state does not move to authenticated LIVE.
10. Native PostgreSQL role/stale/immutability proof and exact-head review/CI are required. Mounted confirmation/readback, shared QA ANT-21 and authenticated acceptance remain owed under #1832/ANT-7/ANT-86.

Applied migrations320/20/30/50 remain unchanged. Production frontier20271023000200 and active peer2050 reservation20271023100000 were checked October12; proposed forward version20271024000010 must be checked again before release. No duplicate records, credentials, customer account access or INT-346 activation.

Only a latest `in_review` submission with no decision may change reviewer. Original source/version/digest/submitter/client/work and completed decisions remain immutable. Replacement must be a currently active same-tenant member, distinct from submitter, with actual Studio source permission. A documented reason and original timestamp prevent silent or stale reassignment. Plan-level ownership alone never grants this action. Historical reviewer identity remains in existing audit.

Local minimal-schema proof is preparation, not full deployed-schema or authenticated runtime acceptance. Full rollback-only native CI must also run against the complete migration tree.

## Native preparation checkpoint

Failing-first88e06f4aa asserts the missing scoped function and fails on native PostgreSQL16 before implementation. Forward migration20271024000010 then passes27 actual authenticated-role assertions in the disposable minimal-schema fixture, including original source, old reviewer read/decision loss, exact admin intersection, source-only unrelated plan owner refusal, active replacement, stale intent, completed history and existing audit. One ambiguous test column was qualified without weakening its assertion. Full-schema CI, independent security review, release and mounted/authenticated proof remain pending.
