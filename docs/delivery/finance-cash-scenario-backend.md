# Finance owner-assumption scenario backend

Status: SOURCE IMPLEMENTED / locally TESTED. Independent review, CI, merge,
deployment, production persistence, authenticated runtime and owner acceptance
remain owed. This candidate is not an active provider integration or a complete
Finance department.

Migration `20271021100010` adds company-scoped, versioned owner planning inputs,
not actual bank balances or accounting records. It depends on the source/company
authority and budget migrations. Save/read reuse the canonical workspace and
current company gates. Browser table access is denied. Saves use an expected
revision, immutable history and an atomic canonical capability receipt. Currency
cannot change within a scenario. Missing opening cash stays unknown.

Current-main reconciliation preserves the released account proof and budget
migration `20271020000330`. Service credentials have SELECT-only table access:
raw inserts, updates and deletes cannot bypass the authenticated save contract.
The preceding raw-write grant failed the new six negative controls in disposable
fixtures; the repaired schema passed both fresh scenario replays.

The pure `projectOwnerCashScenario` adapter consumes an authorized RPC response
and reuses the existing cash calculator for 30/60/90-day planning. It uses exact
integer arithmetic internally and returns decimal major amounts; six arithmetic
decimal places do not establish a currency minor-unit convention. Every event
and opening amount remains an owner assumption. Recorded timestamp and effective
scenario start date are separate. No provider freshness or complete business
coverage is claimed, and duplicate occurrence references are refused.

Local proof: actual SQL missing-RPC negative control, two fresh migration replays,
immutable revisions, receipt rollback, workspace switching, revoked membership,
cross-tenant read refusal, concurrent revision conflict, Auth actor anonymization
and canonical scoped retirement passed. The preceding budget fixture also runs.
53 focused TypeScript tests passed; strict TypeScript and focused ESLint passed.

Remaining bindings: governed Spine save/read actions, canonical planning evidence
issuance, actual company cash and scheduled obligations, UI data hooks, Fabric
consumption and Chat/Live acceptance. None is inferred from a saved assumption
or from a prompt launcher. No provider call or customer mutation was performed.

Retained-history foreign-key coverage: the new four-index assertion failed before
the correction and passed after it in both fresh SQL replays. All four indexes
are valid and non-partial, including nullable actor references retained after
Auth anonymization.


Current-main replay also executes the actual later canonical retirement policy.
The preceding scenario guard fails this new control; the corrected forward
20271021100010 migration passes both replays without changing unrelated table
dispositions. Focused lint and strict TypeScript completed successfully after
the interrupted run. No hosted review, CI, release or runtime acceptance is
inferred from these local results.

## Current-main release recovery and forecast direction correction

Owner-authorized continuation reconciles current main `6a44d86d05f1676ae5b6c1a630e6db26cfa73c55`. Production metadata confirms the scenario tables are absent and the latest applied version is `20271021042001`. All 27 open PR migration inventories were inspected; a peer reserves `20271021100000`. Finance's own never-applied `20271020000340` collided with the applied SendGrid version. It is renamed to the checked-free forward version `20271021100010`, with SQL bytes unchanged and fixture/document references updated. Applied and peer migrations are preserved. Prior incomplete browser-review attempts and failed source/production-skew CI remain historical evidence, not code findings or passing gates.

The #2000 post-merge P2 is corrected in the shared Finance cash calculator: scheduled obligations permit outflows, collection estimates permit inflows, and owner assumptions permit either direction. The typed contract preserves these combinations; runtime validation independently refuses invalid JSON before producing a curve or minimum-balance warning. Two new negative controls failed against the preceding calculator, then passed after correction. Owner assumptions remain attributable and partial; they never become verified cash.

Current recovery proof: **58 controlled calculation tests PASS**, strict TypeScript including contract assertions and focused ESLint PASS, actual missing-contract negative control and two fresh PostgreSQL authorization/tenancy/company/version/receipt/immutable-history/erasure/retirement/concurrency replays PASS. Final independent non-author review, exact-head hosted CI and this scenario's merge/deployment/persistence remain pending. No customer credentials, provider calls, financial effects or interface redesign.
