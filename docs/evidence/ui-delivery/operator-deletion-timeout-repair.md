# Operator deletion timeout repair — worklist closure + audited tenant indexes

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Family 15 lifecycle packet below; no flow shape changes — the identical Archive→Delete flow completes within the API role's bounded statement budget.
PAIGE_UI_DESIGN: PASS: Installed project skill read; no UI change in this repair — the incumbent approved modal, controls and states are untouched.
MATERIAL_FLOW_CHANGE: NO: The same confirmed Delete flow now completes on real data volumes; nothing about scope review, confirmation, receipts or blockers changed.
FLOW_PROTOTYPE: PASS: Not required — no visual or interaction change; the incumbent owner-approved dialog is reused verbatim.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: A Platform Administrator permanently deletes an archived eligible account and the operation completes instead of timing out.
VISUAL_DIRECTION: PASS: Unchanged incumbent design; no new pixels.
AUTOMATED_EVIDENCE: PASS: Disposable-PostgreSQL proof with failing-first missing-migration control, old-vs-new plan equivalence, FK probe-count reduction (36 to 18 on the fixture graph), and a full archive→delete lifecycle executed atomically through the repaired function. Exact counts recorded on the candidate PR.
STATIC_EVIDENCE: PASS: Migration diff verified line-by-line against the deployed 20270602000504 body — only the worklist frontier lines, the declaration and a five-line explanatory comment above the frontier initialization differ; the proof suite pins equivalence.
RENDERED_EVIDENCE: NOT_APPLICABLE: No rendered change; the dialog is byte-identical.
BEHAVIORAL_EVIDENCE: PASS: Deterministic probe-count proof through a counting fk_join wrapper (far fewer probes for the identical plan) plus an end-to-end Worklist-Solo archive→delete with absence readback.
AUTHENTICATED_RUNTIME: UNVERIFIED: the post-deploy production re-time of the two affected scopes and the owner's supervised deletions remain owed; the pre-fix read-only plan timings are the baseline.
KEYBOARD_FOCUS: NOT_APPLICABLE: No focusable change.
ZOOM_REFLOW: NOT_APPLICABLE: No layout change.
REDUCED_MOTION: NOT_APPLICABLE: No motion change.
STATE_COVERAGE: PASS: The timeout presents through the existing FAILED path at preview and the existing unknown-outcome Read-operation path at execution; both remain truthful. Failed attempts roll back atomically (journal stays archived; nothing partial).
TRUTHFUL_STATE_LABELS: PASS: No new copy; the repair changes timing, not claims. Partial deletion remains impossible by construction (single-transaction design preserved).
SOLO_UI: NO: Platform Operator lifecycle only; the Solo shell is unchanged.
UNVERIFIED: Post-deploy production re-time and the owner's authenticated deletion of the two affected accounts. No production mutation was performed by this repair.

OWNER_INTENT: The owner's live deletion of two archived standalone accounts failed with statement timeouts; recover the capability within the existing irreversible-action, journal and review contracts.
MUST_NOT_HAPPEN: Blind timeout increases (the in-function override was tested and rejected), weakened confirmations, non-atomic or resumable-by-default deletion, journal contract changes, or silent plan-result drift.
MUST_PRESERVE: The single-transaction delete with mandatory audit and readback, exact scope/name/version confirmations, disposition classes, blockers, shared-identity and survivor preservation, and plan-result equivalence.
ACCEPTANCE_CRITERIA: The deployed plan returns byte-identical results with substantially fewer FK probes; the two affected scopes' preflight re-times well under the 8s budget; the owner's supervised delete completes.
MOTION_PURPOSE: NONE: No motion added or changed.
PROTECTED_SEAMS: operator_account_deletion_plan body (worklist only), the audited tenant-column indexes, and nothing else. Entry points, guard trigger, Edge, UI, predicates and capability registry untouched.
INTERNAL_BUILD_IDENTITY: b4025524659b835fe574dec5b5065a1bce4d0d13 (observed base; exact candidate SHA in PR); exact base and candidate SHAs in PR); deployment=PROOF_OWED(candidate production readback); environment=development; migrations=PROOF_OWED(20271020000400 and 20271020000401 await the normal deploy-migrations run); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/operator-deletion-timeout-repair.md
RELEASE_CHANNEL: development: bounded Operator lifecycle reliability repair; exact production identity follows verified delivery.
RELEASE_CLASSIFICATION: internal-only: privileged Operator reliability repair, no customer release version.
CUSTOMER_RELEASE_IDENTITY: none: no public version or announcement authorized.
RELEASE_NOTE_REQUIRED: NO: Internal Operator repair; owner report/PR and Master closeout record delivery.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Post-deploy production re-time and owner-supervised deletion of the two affected accounts. Local equivalence and probe proofs never substitute for those outcomes.
RELEASE_RECOVERY: position=Failed attempts roll back atomically and the archived account simply re-deletes after refresh, no journal surgery is ever needed; reference=docs/delivery/operator-account-lifecycle.md

## Scope and routing

ANT-47 production defect (2026-10-11): two archived standalone scopes could not be permanently deleted — `FAILED · canceling statement due to statement timeout`. Read-only production evidence: the Fleet RPC path runs under `authenticated`'s `statement_timeout=8s`; `operator_account_deletion_plan` for the first scope (largest in-scope table: 79 rows) measured **8.34s** (preview canceled at the review step), the second scope's preview passed at 3.47s but its execution re-runs the plan three times and also canceled. The journal shows both operations still `archived` — every canceled attempt rolled back atomically; no partial deletion occurred. An in-function `set_config('statement_timeout',…,true)` override was prototyped and **rejected by test**: an outer statement timer already armed cannot be rescued mid-statement (verified on a disposable cluster, both plain and override functions canceled identically).

The repair is the honest performance fix: (1) `20271020000400` re-emits `operator_account_deletion_plan` with a **worklist frontier** — each foreign key is probed only when its parent relation changed in the previous round (or just entered the plan) instead of re-probing every candidate FK every round; fixpoint, 30-round ceiling, dispositions, blockers and every other line are byte-identical. (2) `20271020000401` adds the audited tenant-column indexes (31 relations, led by `paige_llm_trace.working_context_tenant_id` and `paige_chat_turns.interactive_tenant_id`) so plan probes and tenant-scoped reads stop sequential-scanning. Entry points, guard, Edge, UI and the authority split are untouched.

## Round 2 (20271020000420 + 20271020000421)

Post-deploy re-time: the worst scope's plan walk improved 8342ms to 5198ms — preview fits the 8s budget, but the delete path's three walks still exceeded it. The measured remainder: ~17 information_schema queries inside the function (~45ms each as the definer) and unindexed FK columns on closure children (paige_actions carries seven). 20271020000420 rewrites the two information_schema queries to equivalent pg_catalog queries (same rows, same string_agg order); 20271020000421 adds 14 FK-column indexes. No algorithmic, contract or authority change. The proof's stage B applies 420 twice (replay) and asserts the plan is STILL byte-identical to the deployed 504 body with an unchanged probe count; the mini archive-to-delete runs under the final body.

## Evidence and reproduction

- `node scripts/proof/operator-account-archive.mjs --postgres <dedicated-loopback-port>` — four PASS lines including the worklist section: old (deployed 504 body) vs new plan `deepEqual` equivalence, FK probe count 36→18 on the fixture graph through a counting `operator_retirement_fk_join` wrapper, and a fresh Worklist-Solo archive→delete executing atomically through the repaired function. With the migration files absent the run FAILS (ENOENT): failing-first control.
- Production baselines (read-only, pre-fix): `explain (analyze)` of the plan — 8342ms (Int326 Acceptance A scope), 3474ms (Vibe scope). Post-deploy re-time owed on the exact same scopes.

## Review and delivery

Independent non-author review on the exact head (risk axes: worklist fidelity vs the deployed body, fixpoint equivalence, index set correctness and build safety, no contract drift). Required exact-head CI green including the migration collision guard, database contract and the standing proof suite. Post-merge: deploy verification, production re-time readback, and the owner's supervised deletion of the two accounts (one of which — Int326 Acceptance A — requires coordination with the #1832 QA agent before any retirement is proposed; neither is deleted by this lane).
