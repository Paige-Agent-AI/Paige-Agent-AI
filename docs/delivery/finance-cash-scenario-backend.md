# Finance owner-assumption scenario backend

Status: SOURCE IMPLEMENTED / locally TESTED. Independent review, CI, merge,
deployment, production persistence, authenticated runtime and owner acceptance
remain owed. This candidate is not an active provider integration or a complete
Finance department.

Migration `20271020000050` adds company-scoped, versioned owner planning inputs,
not actual bank balances or accounting records. It depends on the source/company
authority and budget migrations. Save/read reuse the canonical workspace and
current company gates. Browser table access is denied. Saves use an expected
revision, immutable history and an atomic canonical capability receipt. Currency
cannot change within a scenario. Missing opening cash stays unknown.

Current-main reconciliation preserves the released account proof and budget
migration `20271020000040`. Service credentials have SELECT-only table access:
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

