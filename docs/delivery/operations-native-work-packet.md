# Native work unification pre-edit packet

1. Outcome: one Operations Work view over existing Planning and CRM tasks, with native source identity and no copied task records.
2. Source ownership: plan_items/plans remain Planning; tasks remain CRM; Team owns people and photos; no new identity/task store.
3. Authority: canonical current actor/tenant/membership and Solo admission; native CRM read preserves caller RLS plus target-tenant visibility. CRM mutations must use crm-command and its current Trust/CAS/idempotency/Rail path; member write refusals remain legitimate.
4. Existing reuse: canonical tasks user_id/status/due_date/deal_id/biz_id/version and Planning fields. Legacy useTasks credit filters/direct writes are excluded. Assigned-client SELECT policy is read-only, not CRM execution permission.
5. Provider: none; no outbound communications, executor activation or customer testing mutation.
6. Scope: bounded native read/projection first, then Work/detail/Overview/Capacity consumers. Each native source has separate loaded/partial/unavailable truth. Equal IDs from different sources must never collide or enter the wrong writer.
7. Harness/Spine: retain existing CRM/Planning capabilities; register no second task executor. No competing Chat edits.
8. Continuation: current O2a release first; queued bounded slices sequential. Local projection is not a deployed unified workspace until consumers, review, exact-head CI and release proof exist.
9. Recovery/readback: epoch/request fences; source failures do not erase the other source or imply zero work. Unknown command results retain exact idempotency recovery. No automatic cross-source retry.
10. Acceptance: native collisions, malformed/foreign payloads, supported stages/unsupported stages, actual persisted command readback and role/tenant negatives; independent static/visual reviews and required green release. Authenticated/runtime/provider effects remain UNVERIFIED under owner restrictions.

CRM's retired title grants no authority; current assigned staff may read their client tasks through existing RLS but CRM writes remain separately governed. Existing booking windows are not employee working hours; source-recorded task estimates are only estimates. Missing priority, effort and availability stay unknown.

## Local read/projection foundation evidence

Initial native projection/normalization and request-boundary suites PASS: nine tests in two files, scoped lint PASS; initial definer exposure lint PASS. Independent read-only source/security review returned bounded PASS before SQL fixture addition. New invoker read retains caller RLS;15rollback SQL assertions include actual authenticated role, profile lock/table grants, target/private/foreign filtering, assigned-client read, scope refusal, sanitized metadata/unknown effort and explicit200cap/has_more. SQL remains UNEXECUTED and is not yet registered in the shared release workflow. At that initial checkpoint no UI consumer, mutation or render was claimed.

The separate non-author review of the SQL and all 15 rollback assertions returned bounded static PASS. Temporary grants cover assertion helpers only; no API table privileges or canonical triggers are bypassed. Actual full-schema SQL execution remains UNVERIFIED.

## Native Work consumer and command caller checkpoint

Local Work now combines original Planning items and CRM tasks across board/list/deadline views. Source-prefixed identity prevents collisions, each detail keeps the native writer, unsupported CRM blocked/cancellation moves are refused, and dates sort by actual timestamps across offsets. Missing recorded effort or priority remains unknown. Human-readable detail dates, authorized Team name/photo references, restrained existing action tokens and keyboard focus are preserved.

The stage review calls the unchanged crm-command path with a pinned source version, original idempotency key and the existing Trust fingerprint. It confirms before dispatch and requires independently scoped current CRM readback before displaying success. Unknown results retain only bounded exact-command recovery metadata, not task records or permissions. A scoped recovery entry does not depend on the task being inside the loaded read; completion returns the original task identity so another selected task is not falsely credited. Independent static review found and resolved mixed-offset ordering and both recovery findings. No new executor, approval store, receipt ledger, customer mutation or provider effects.

Full local Operations/hook regression:124tests in20files PASS; type ratchet baseline10/current10 PASS before the latest date/copy/action-spacing refinements. Fresh focused tests/lint and independent visual critique remain in progress. Actual shared-shell synthetic render:18cases PASS in both worlds at1536x770,1366x768,1024x768,900x1000, PAIGE open/closed, and390x844 closed. Reduced motion, keyboard inspection, explicit stage confirmation, refusal, unchanged saved lane, containment and invoker focus pass. One immediate post-close sampling run failed one focus check; the corrected check waits up to3seconds for actual close-autofocus, and the complete rerun passed18cases. Actual browser zoom, successful persistence, current full-schema SQL, production and authenticated acceptance remain UNVERIFIED. Overview/Capacity native consumers and native assignment/date controls are still owed; this checkpoint is not complete department delivery.

The actual rebuilt-schema O2a run exposed protected hierarchy setup in the queued rollback tests. Database-owner fixture setup now captures/clears/restores local JWT claims only around fixture hierarchy updates; all API assertions keep their intended caller. Existing triggers and permissions remain intact. Fresh full-schema execution of each queued SQL suite is still required.
